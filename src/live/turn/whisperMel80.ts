/**
 * whisperMel80.ts — Zero-GC, HuggingFace-exact Whisper 80-bin log-mel extractor
 * for 8.0s end-aligned left-zero-padded 16 kHz audio (`[1, 80, 800]`).
 *
 * Matches `transformers.WhisperFeatureExtractor(chunk_length=8)`:
 *  - `sampling_rate = 16000`, `n_samples = 128000` (left-zero-padded / right-aligned)
 *  - `n_fft = 400`, `hop_length = 160`, periodic Hann window
 *  - `center = true`, `pad_mode = 'reflect'` (200 samples each side -> 801 frames, drop last -> 800)
 *  - 80 Slaney-normalized triangular mel filters across `[0, 8000]` Hz
 *  - `log10(max(S, 1e-10))`, global `max - 8.0` dynamic range clamp, `(x + 4.0) / 4.0`
 */

export const WHISPER_SAMPLE_RATE = 16000;
export const WHISPER_MAX_SAMPLES = 128000;
export const WHISPER_N_MELS = 80;
export const WHISPER_N_FRAMES = 800;

const N_FFT = 400;
const HALF_FFT = N_FFT >> 1; // 200
const HOP_LENGTH = 160;
const N_FREQ_BINS = HALF_FFT + 1; // 201
const MEL_FLOOR = 1e-10;
const LOG10_FLOOR = -10.0; // Math.log10(1e-10)
const FFT_POW2 = 1024; // >= 2 * N_FFT - 1 (799) for Bluestein convolution
const LOG2_FFT_POW2 = 10;

function hertzToMelSlaney(freq: number): number {
  const minLogHz = 1000.0;
  const minLogMel = 15.0;
  const logStep = 27.0 / Math.log(6.4);
  if (freq >= minLogHz) {
    return minLogMel + Math.log(freq / minLogHz) * logStep;
  }
  return (3.0 * freq) / 200.0;
}

function melToHertzSlaney(mel: number): number {
  const minLogHz = 1000.0;
  const minLogMel = 15.0;
  const logStep = Math.log(6.4) / 27.0;
  if (mel >= minLogMel) {
    return minLogHz * Math.exp(logStep * (mel - minLogMel));
  }
  return (200.0 * mel) / 3.0;
}

function buildBitRevTable(n: number, log2n: number): Uint16Array {
  const rev = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < log2n; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r;
  }
  return rev;
}

function radix2FftInPlace(
  re: Float64Array,
  im: Float64Array,
  n: number,
  bitRev: Uint16Array,
  twRe: Float64Array,
  twIm: Float64Array,
  inverse: boolean,
): void {
  for (let i = 0; i < n; i++) {
    const j = bitRev[i]!;
    if (i < j) {
      const tr = re[i]!;
      const ti = im[i]!;
      re[i] = re[j]!;
      im[i] = im[j]!;
      re[j] = tr;
      im[j] = ti;
    }
  }

  const sign = inverse ? 1.0 : -1.0;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const twIdx = j * step;
        const wr = twRe[twIdx]!;
        const wi = sign * twIm[twIdx]!;
        const evenIdx = i + j;
        const oddIdx = evenIdx + half;
        const or = re[oddIdx]!;
        const oi = im[oddIdx]!;
        const tr = wr * or - wi * oi;
        const ti = wr * oi + wi * or;
        re[oddIdx] = re[evenIdx]! - tr;
        im[oddIdx] = im[evenIdx]! - ti;
        re[evenIdx] = re[evenIdx]! + tr;
        im[evenIdx] = im[evenIdx]! + ti;
      }
    }
  }

  if (inverse) {
    const invN = 1.0 / n;
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! * invN;
      im[i] = im[i]! * invN;
    }
  }
}

export class WhisperMel80Extractor {
  private readonly hannWindow = new Float64Array(N_FFT);
  private readonly melWeights = new Float64Array(WHISPER_N_MELS * N_FREQ_BINS);
  private readonly melStartBin = new Int16Array(WHISPER_N_MELS);
  private readonly melEndBin = new Int16Array(WHISPER_N_MELS);

  // Preallocated Bluestein FFT tables for N_FFT = 400 inside M = 1024
  private readonly bitRev = buildBitRevTable(FFT_POW2, LOG2_FFT_POW2);
  private readonly twRe = new Float64Array(FFT_POW2 >> 1);
  private readonly twIm = new Float64Array(FFT_POW2 >> 1);
  private readonly chirpRe = new Float64Array(N_FFT);
  private readonly chirpIm = new Float64Array(N_FFT);
  private readonly bFftRe = new Float64Array(FFT_POW2);
  private readonly bFftIm = new Float64Array(FFT_POW2);

  // Preallocated per-call scratch buffers (zero heap allocations in extract())
  private readonly signalBuf = new Float64Array(WHISPER_MAX_SAMPLES + 2 * HALF_FFT);
  private readonly aRe = new Float64Array(FFT_POW2);
  private readonly aIm = new Float64Array(FFT_POW2);
  private readonly specRe1 = new Float64Array(N_FFT);
  private readonly specIm1 = new Float64Array(N_FFT);
  private readonly pow1 = new Float64Array(N_FREQ_BINS);
  private readonly pow2 = new Float64Array(N_FREQ_BINS);
  private readonly logMelScratch = new Float64Array(WHISPER_N_MELS * WHISPER_N_FRAMES);
  private readonly outputBuf = new Float32Array(WHISPER_N_MELS * WHISPER_N_FRAMES);

  constructor() {
    // 1. Periodic Hann window of length 400 (equivalent to np.hanning(401)[:-1])
    for (let n = 0; n < N_FFT; n++) {
      this.hannWindow[n] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * n) / N_FFT));
    }

    // 2. Exact Slaney 80-channel mel filterbank (201 freq bins across [0, 8000] Hz)
    const melMin = hertzToMelSlaney(0.0);
    const melMax = hertzToMelSlaney(WHISPER_SAMPLE_RATE / 2);
    const numFilterEdges = WHISPER_N_MELS + 2;
    const filterFreqs = new Float64Array(numFilterEdges);
    for (let i = 0; i < numFilterEdges; i++) {
      const mel = melMin + ((melMax - melMin) * i) / (numFilterEdges - 1);
      filterFreqs[i] = melToHertzSlaney(mel);
    }

    const fftFreqs = new Float64Array(N_FREQ_BINS);
    for (let k = 0; k < N_FREQ_BINS; k++) {
      fftFreqs[k] = ((WHISPER_SAMPLE_RATE / 2) * k) / (N_FREQ_BINS - 1);
    }

    for (let m = 0; m < WHISPER_N_MELS; m++) {
      const fLeft = filterFreqs[m]!;
      const fCenter = filterFreqs[m + 1]!;
      const fRight = filterFreqs[m + 2]!;
      const invLeftWidth = 1.0 / (fCenter - fLeft);
      const invRightWidth = 1.0 / (fRight - fCenter);
      const enorm = 2.0 / (fRight - fLeft);

      let first = -1;
      let last = -1;
      const rowOffset = m * N_FREQ_BINS;
      for (let k = 0; k < N_FREQ_BINS; k++) {
        const f = fftFreqs[k]!;
        const down = (f - fLeft) * invLeftWidth;
        const up = (fRight - f) * invRightWidth;
        const tri = Math.max(0.0, Math.min(down, up)) * enorm;
        this.melWeights[rowOffset + k] = tri;
        if (tri > 0.0) {
          if (first < 0) first = k;
          last = k;
        }
      }
      this.melStartBin[m] = first >= 0 ? first : 0;
      this.melEndBin[m] = last >= 0 ? last + 1 : 0;
    }

    // 3. Radix-2 twiddle factors (positive angle magnitude stored; sign applied in radix2FftInPlace)
    for (let k = 0; k < FFT_POW2 >> 1; k++) {
      const angle = (2.0 * Math.PI * k) / FFT_POW2;
      this.twRe[k] = Math.cos(angle);
      this.twIm[k] = Math.sin(angle);
    }

    // 4. Bluestein chirp sequence & filter FFT for N = 400
    for (let n = 0; n < N_FFT; n++) {
      const angle = (Math.PI * ((n * n) % (2 * N_FFT))) / N_FFT;
      this.chirpRe[n] = Math.cos(angle);
      this.chirpIm[n] = -Math.sin(angle);
    }

    this.bFftRe[0] = 1.0;
    this.bFftIm[0] = 0.0;
    for (let k = 1; k < N_FFT; k++) {
      const angle = (Math.PI * ((k * k) % (2 * N_FFT))) / N_FFT;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      this.bFftRe[k] = c;
      this.bFftIm[k] = s;
      this.bFftRe[FFT_POW2 - k] = c;
      this.bFftIm[FFT_POW2 - k] = s;
    }
    radix2FftInPlace(this.bFftRe, this.bFftIm, FFT_POW2, this.bitRev, this.twRe, this.twIm, false);
  }

  /**
   * Computes `[80, 800]` log-mel spectrogram (row-major `Float32Array(64000)`)
   * from 16 kHz mono PCM. Shorter clips are left-zero-padded so audio ends at t = 8.0s;
   * longer clips take the trailing 128,000 samples.
   *
   * Zero heap allocations when reusing internal buffer or passing preallocated `out`.
   */
  extract(pcm16k: Float32Array, out?: Float32Array): Float32Array {
    const dest = out ?? this.outputBuf;
    if (dest.length < WHISPER_N_MELS * WHISPER_N_FRAMES) {
      throw new RangeError(`Expected output buffer of length >= ${WHISPER_N_MELS * WHISPER_N_FRAMES}`);
    }

    const sig = this.signalBuf;
    const len = pcm16k.length;
    let zeroPadCount = 0;

    if (len >= WHISPER_MAX_SAMPLES) {
      const start = len - WHISPER_MAX_SAMPLES;
      for (let i = 0; i < WHISPER_MAX_SAMPLES; i++) {
        sig[HALF_FFT + i] = pcm16k[start + i]!;
      }
    } else {
      zeroPadCount = WHISPER_MAX_SAMPLES - len;
      sig.fill(0.0, HALF_FFT, HALF_FFT + zeroPadCount);
      for (let i = 0; i < len; i++) {
        sig[HALF_FFT + zeroPadCount + i] = pcm16k[i]!;
      }
    }

    // Center=True reflect padding (200 samples on left, 200 samples on right)
    for (let i = 0; i < HALF_FFT; i++) {
      sig[i] = sig[2 * HALF_FFT - i]!;
      sig[HALF_FFT + WHISPER_MAX_SAMPLES + i] = sig[HALF_FFT + WHISPER_MAX_SAMPLES - 2 - i]!;
    }

    // Samples strictly before `activeReflectStart` in `sig` are identically 0
    // (when zeroPadCount > HALF_FFT, left reflect region is also 0).
    const activeSigStart = zeroPadCount > HALF_FFT ? HALF_FFT + zeroPadCount : 0;

    const win = this.hannWindow;
    const aRe = this.aRe;
    const aIm = this.aIm;
    const specRe = this.specRe1;
    const specIm = this.specIm1;
    const pow1 = this.pow1;
    const pow2 = this.pow2;
    const chirpRe = this.chirpRe;
    const chirpIm = this.chirpIm;
    const bRe = this.bFftRe;
    const bIm = this.bFftIm;
    const melW = this.melWeights;
    const melStart = this.melStartBin;
    const melEnd = this.melEndBin;
    const logMel = this.logMelScratch;

    let globalMax = -Infinity;

    // Pack two consecutive real frames (t, t+1) into one complex Bluestein FFT
    for (let t = 0; t < WHISPER_N_FRAMES; t += 2) {
      const off1 = t * HOP_LENGTH;
      const off2 = off1 + HOP_LENGTH;

      const f1AllZero = off1 + N_FFT <= activeSigStart;
      const f2AllZero = off2 + N_FFT <= activeSigStart;

      if (f1AllZero && f2AllZero) {
        for (let m = 0; m < WHISPER_N_MELS; m++) {
          const base = m * WHISPER_N_FRAMES;
          logMel[base + t] = LOG10_FLOOR;
          logMel[base + t + 1] = LOG10_FLOOR;
        }
        if (LOG10_FLOOR > globalMax) globalMax = LOG10_FLOOR;
        continue;
      }

      aRe.fill(0.0);
      aIm.fill(0.0);
      for (let n = 0; n < N_FFT; n++) {
        const w = win[n]!;
        const xr = sig[off1 + n]! * w;
        const xi = sig[off2 + n]! * w;
        const cr = chirpRe[n]!;
        const ci = chirpIm[n]!;
        // (xr + i*xi) * (cr + i*ci)
        aRe[n] = xr * cr - xi * ci;
        aIm[n] = xr * ci + xi * cr;
      }

      radix2FftInPlace(aRe, aIm, FFT_POW2, this.bitRev, this.twRe, this.twIm, false);

      for (let k = 0; k < FFT_POW2; k++) {
        const ar = aRe[k]!;
        const ai = aIm[k]!;
        const br = bRe[k]!;
        const bi = bIm[k]!;
        aRe[k] = ar * br - ai * bi;
        aIm[k] = ar * bi + ai * br;
      }

      radix2FftInPlace(aRe, aIm, FFT_POW2, this.bitRev, this.twRe, this.twIm, true);

      for (let k = 0; k < N_FFT; k++) {
        const yr = aRe[k]!;
        const yi = aIm[k]!;
        const cr = chirpRe[k]!;
        const ci = chirpIm[k]!;
        specRe[k] = yr * cr - yi * ci;
        specIm[k] = yr * ci + yi * cr;
      }

      // Unpack two real DFTs from complex DFT Z = X1 + i*X2
      pow1[0] = specRe[0]! * specRe[0]!;
      pow2[0] = specIm[0]! * specIm[0]!;
      for (let k = 1; k < HALF_FFT; k++) {
        const nk = N_FFT - k;
        const zr = specRe[k]!;
        const zi = specIm[k]!;
        const znr = specRe[nk]!;
        const zni = specIm[nk]!;
        const r1 = 0.5 * (zr + znr);
        const i1 = 0.5 * (zi - zni);
        const r2 = 0.5 * (zi + zni);
        const i2 = 0.5 * (znr - zr);
        pow1[k] = r1 * r1 + i1 * i1;
        pow2[k] = r2 * r2 + i2 * i2;
      }
      pow1[HALF_FFT] = specRe[HALF_FFT]! * specRe[HALF_FFT]!;
      pow2[HALF_FFT] = specIm[HALF_FFT]! * specIm[HALF_FFT]!;

      // Mel projection + log10
      for (let m = 0; m < WHISPER_N_MELS; m++) {
        const k0 = melStart[m]!;
        const k1 = melEnd[m]!;
        const wRow = m * N_FREQ_BINS;
        let sum1 = 0.0;
        let sum2 = 0.0;
        for (let k = k0; k < k1; k++) {
          const w = melW[wRow + k]!;
          sum1 += w * pow1[k]!;
          sum2 += w * pow2[k]!;
        }
        const lm1 = Math.log10(sum1 > MEL_FLOOR ? sum1 : MEL_FLOOR);
        const lm2 = Math.log10(sum2 > MEL_FLOOR ? sum2 : MEL_FLOOR);
        const outIdx = m * WHISPER_N_FRAMES;
        logMel[outIdx + t] = lm1;
        logMel[outIdx + t + 1] = lm2;
        if (lm1 > globalMax) globalMax = lm1;
        if (lm2 > globalMax) globalMax = lm2;
      }
    }

    const clampMin = globalMax - 8.0;
    const total = WHISPER_N_MELS * WHISPER_N_FRAMES;
    for (let i = 0; i < total; i++) {
      const v = logMel[i]!;
      const clamped = v > clampMin ? v : clampMin;
      dest[i] = (clamped + 4.0) * 0.25;
    }

    return dest;
  }
}
