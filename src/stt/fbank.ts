/**
 * Kaldi-compatible log-mel fbank for SenseVoice (sherpa-onnx / knf OnlineFbank).
 *
 * Matches scripts/sense-voice/test.py defaults:
 *   dither=0, snip_edges=false, hamming, 80 bins, 25ms/10ms, preemph 0.97
 * Samples should be float PCM in [-1,1]; we scale by 32768 like knf accept_waveform.
 *
 * WORKS: mel energy + log — sufficient for SenseVoice when followed by LFR+CMVN.
 * TODO: bit-exact parity with kaldi_native_fbank OnlineFbank (pow/floor edge cases).
 */
const PI = Math.PI;

export type FbankOpts = {
  sampleRate: number;
  numBins?: number;
  frameLengthMs?: number;
  frameShiftMs?: number;
  preemph?: number;
  lowFreq?: number;
  highFreq?: number; // 0 = Nyquist
};

function hamming(n: number): Float32Array {
  const w = new Float32Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) {
    w[i] = 0.54 - 0.46 * Math.cos((2 * PI * i) / (n - 1));
  }
  return w;
}

function hzToMel(hz: number): number {
  return 1127 * Math.log(1 + hz / 700);
}
function melToHz(mel: number): number {
  return 700 * (Math.exp(mel / 1127) - 1);
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place radix-2 FFT; real[]/imag[] length = n (power of 2). */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j]!;
        const uIm = im[i + j]!;
        const vRe = re[i + j + len / 2]! * wRe - im[i + j + len / 2]! * wIm;
        const vIm = re[i + j + len / 2]! * wIm + im[i + j + len / 2]! * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
}

function buildMelBanks(
  numBins: number,
  sampleRate: number,
  nFft: number,
  lowFreq: number,
  highFreq: number,
): Float32Array[] {
  const nyquist = sampleRate / 2;
  const hi = highFreq > 0 ? Math.min(highFreq, nyquist) : nyquist;
  const minMel = hzToMel(lowFreq);
  const maxMel = hzToMel(hi);
  const nBinsFft = Math.floor(nFft / 2) + 1;
  const points = new Float32Array(numBins + 2);
  for (let i = 0; i < numBins + 2; i++) {
    const mel = minMel + ((maxMel - minMel) * i) / (numBins + 1);
    points[i] = Math.floor(((nFft + 1) * melToHz(mel)) / sampleRate);
  }
  const banks: Float32Array[] = [];
  for (let m = 0; m < numBins; m++) {
    const left = points[m]!;
    const center = points[m + 1]!;
    const right = points[m + 2]!;
    const w = new Float32Array(nBinsFft);
    for (let k = left; k < center; k++) {
      if (center !== left && k >= 0 && k < nBinsFft) {
        w[k] = (k - left) / (center - left);
      }
    }
    for (let k = center; k < right; k++) {
      if (right !== center && k >= 0 && k < nBinsFft) {
        w[k] = (right - k) / (right - center);
      }
    }
    banks.push(w);
  }
  return banks;
}

/**
 * Compute [T, numBins] log-mel fbank from mono float PCM [-1,1].
 */
export function computeLogMelFbank(samples: Float32Array, opts: FbankOpts): Float32Array {
  const sampleRate = opts.sampleRate;
  const numBins = opts.numBins ?? 80;
  const frameLengthMs = opts.frameLengthMs ?? 25;
  const frameShiftMs = opts.frameShiftMs ?? 10;
  const preemph = opts.preemph ?? 0.97;
  const lowFreq = opts.lowFreq ?? 20;
  const highFreq = opts.highFreq ?? 0;

  const frameLen = Math.round((frameLengthMs / 1000) * sampleRate);
  const frameShift = Math.round((frameShiftMs / 1000) * sampleRate);
  const nFft = nextPow2(frameLen);
  const window = hamming(frameLen);
  const melBanks = buildMelBanks(numBins, sampleRate, nFft, lowFreq, highFreq);

  // knf: snip_edges=false → pad so first frame centered at 0
  const pad = Math.floor(frameLen / 2);
  const scaled = new Float32Array(samples.length + 2 * pad);
  for (let i = 0; i < samples.length; i++) {
    scaled[pad + i] = samples[i]! * 32768;
  }
  // reflect pad edges
  for (let i = 0; i < pad; i++) {
    scaled[pad - 1 - i] = scaled[pad + i]!;
    scaled[pad + samples.length + i] = scaled[pad + samples.length - 1 - i]!;
  }

  const nFrames = 1 + Math.floor((scaled.length - frameLen) / frameShift);
  const out = new Float32Array(Math.max(0, nFrames) * numBins);
  const re = new Float32Array(nFft);
  const im = new Float32Array(nFft);
  const eps = 1e-10;

  for (let t = 0; t < nFrames; t++) {
    const offset = t * frameShift;
    re.fill(0);
    im.fill(0);
    let prev = 0;
    for (let i = 0; i < frameLen; i++) {
      const x = scaled[offset + i]!;
      const y = i === 0 ? x : x - preemph * prev;
      prev = x;
      re[i] = y * window[i]!;
    }
    fft(re, im);
    const nBinsFft = Math.floor(nFft / 2) + 1;
    const power = new Float32Array(nBinsFft);
    for (let k = 0; k < nBinsFft; k++) {
      power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
    }
    const base = t * numBins;
    for (let m = 0; m < numBins; m++) {
      const bank = melBanks[m]!;
      let e = 0;
      for (let k = 0; k < nBinsFft; k++) {
        e += power[k]! * bank[k]!;
      }
      out[base + m] = Math.log(Math.max(e, eps));
    }
  }
  return out;
}

/** LFR stack: m frames with stride n → [T', m*featDim]. */
export function applyLfr(
  fbank: Float32Array,
  numFrames: number,
  featDim: number,
  windowSize: number,
  windowShift: number,
): { data: Float32Array; frames: number } {
  if (numFrames < windowSize) {
    return { data: new Float32Array(0), frames: 0 };
  }
  const T = Math.floor((numFrames - windowSize) / windowShift) + 1;
  const outDim = featDim * windowSize;
  const data = new Float32Array(T * outDim);
  for (let t = 0; t < T; t++) {
    const src0 = t * windowShift * featDim;
    data.set(fbank.subarray(src0, src0 + outDim), t * outDim);
  }
  return { data, frames: T };
}

/** CMVN: (x + neg_mean) * inv_stddev per LFR frame. */
export function applyCmvn(
  lfr: Float32Array,
  frames: number,
  dim: number,
  negMean: Float32Array,
  invStddev: Float32Array,
): Float32Array {
  const out = new Float32Array(lfr.length);
  for (let t = 0; t < frames; t++) {
    const base = t * dim;
    for (let d = 0; d < dim; d++) {
      out[base + d] = (lfr[base + d]! + negMean[d]!) * invStddev[d]!;
    }
  }
  return out;
}
