/**
 * duplexAudioWorklet.ts — Off-main-thread AudioWorklet processor source, streaming
 * arbitrary-rate -> 16 kHz linear resampler, and 8.0s (128,000-sample) rolling ring buffer.
 *
 * Supports:
 *  - Zero-copy `SharedArrayBuffer` + `Atomics` ring writes when `crossOriginIsolated` is true;
 *  - Seamless `MessagePort` Float32 transfer fallback when `SharedArrayBuffer` is unavailable.
 */

export const DUPLEX_SAMPLE_RATE = 16_000;
export const DUPLEX_RING_SECONDS = 8;
export const DUPLEX_RING_SAMPLES = DUPLEX_SAMPLE_RATE * DUPLEX_RING_SECONDS; // 128000
export const DUPLEX_WORKLET_NAME = 'xc-duplex-ear-processor';

// Header layout in Int32 elements at start of SharedArrayBuffer
export const RING_HEADER_INT32_COUNT = 4; // [0]=writeIndex, [1]=totalWrittenLow, [2]=totalWrittenHigh, [3]=flags
export const RING_HEADER_BYTES = RING_HEADER_INT32_COUNT * 4;
export const RING_SAB_BYTES = RING_HEADER_BYTES + DUPLEX_RING_SAMPLES * 4;

/**
 * Phase-continuous streaming linear resampler from any hardware sample rate to 16 kHz.
 */
export class StreamingLinearResampler {
  private readonly targetRate: number;
  private sourceRate = 0;
  private srcFrac = 0;
  private lastSample = 0;
  private hasLastSample = false;

  constructor(targetRate = DUPLEX_SAMPLE_RATE) {
    this.targetRate = targetRate;
  }

  reset(): void {
    this.srcFrac = 0;
    this.lastSample = 0;
    this.hasLastSample = false;
  }

  resample(input: Float32Array, fromRate: number): Float32Array {
    if (input.length === 0) return new Float32Array(0);
    if (fromRate === this.targetRate) {
      return new Float32Array(input);
    }
    if (this.sourceRate !== fromRate) {
      this.sourceRate = fromRate;
      this.srcFrac = 0;
      this.hasLastSample = false;
    }

    const ratio = fromRate / this.targetRate;
    const out: number[] = [];
    let pos = this.srcFrac;

    while (pos < input.length) {
      let s0: number;
      let s1: number;
      let frac: number;
      if (pos < 0) {
        s0 = this.hasLastSample ? this.lastSample : input[0]!;
        s1 = input[0]!;
        frac = pos + 1;
      } else {
        const i0 = Math.floor(pos);
        const i1 = i0 + 1;
        if (i1 >= input.length) break;
        s0 = input[i0]!;
        s1 = input[i1]!;
        frac = pos - i0;
      }
      out.push(s0 * (1 - frac) + s1 * frac);
      pos += ratio;
    }

    this.srcFrac = pos - input.length;
    this.lastSample = input[input.length - 1]!;
    this.hasLastSample = true;

    return Float32Array.from(out);
  }
}

/**
 * Continuous 8.0s (128,000-sample) rolling 16 kHz ring buffer.
 * Supports SharedArrayBuffer (Atomics) as well as plain ArrayBuffer backing.
 */
export class DuplexRingBuffer16k {
  readonly capacity: number;
  readonly shared: boolean;
  readonly buffer: ArrayBufferLike;
  private readonly header: Int32Array;
  private readonly samples: Float32Array;

  constructor(options: { capacity?: number; shared?: boolean; sab?: SharedArrayBuffer } = {}) {
    this.capacity = options.capacity ?? DUPLEX_RING_SAMPLES;
    if (options.sab) {
      this.shared = true;
      this.buffer = options.sab;
    } else if (options.shared && typeof SharedArrayBuffer !== 'undefined') {
      this.shared = true;
      this.buffer = new SharedArrayBuffer(RING_HEADER_BYTES + this.capacity * 4);
    } else {
      this.shared = false;
      this.buffer = new ArrayBuffer(RING_HEADER_BYTES + this.capacity * 4);
    }
    this.header = new Int32Array(this.buffer, 0, RING_HEADER_INT32_COUNT);
    this.samples = new Float32Array(this.buffer, RING_HEADER_BYTES, this.capacity);
  }

  getSharedArrayBuffer(): SharedArrayBuffer | null {
    return this.shared ? (this.buffer as SharedArrayBuffer) : null;
  }

  clear(): void {
    this.samples.fill(0);
    if (this.shared) {
      Atomics.store(this.header, 0, 0);
      Atomics.store(this.header, 1, 0);
      Atomics.store(this.header, 2, 0);
    } else {
      this.header[0] = 0;
      this.header[1] = 0;
      this.header[2] = 0;
    }
  }

  getWriteIndex(): number {
    return this.shared ? Atomics.load(this.header, 0) : this.header[0]!;
  }

  getTotalWritten(): number {
    if (this.shared) {
      const lo = Atomics.load(this.header, 1) >>> 0;
      const hi = Atomics.load(this.header, 2) >>> 0;
      return hi * 0x100000000 + lo;
    }
    const lo = this.header[1]! >>> 0;
    const hi = this.header[2]! >>> 0;
    return hi * 0x100000000 + lo;
  }

  write(chunk: Float32Array): void {
    if (chunk.length === 0) return;
    const cap = this.capacity;
    let writeIdx = this.getWriteIndex();

    if (chunk.length >= cap) {
      // Keep only the trailing `cap` samples
      const tail = chunk.subarray(chunk.length - cap);
      this.samples.set(tail, 0);
      writeIdx = 0;
    } else {
      const firstLen = Math.min(chunk.length, cap - writeIdx);
      this.samples.set(chunk.subarray(0, firstLen), writeIdx);
      const rem = chunk.length - firstLen;
      if (rem > 0) {
        this.samples.set(chunk.subarray(firstLen), 0);
      }
      writeIdx = (writeIdx + chunk.length) % cap;
    }

    const nextTotal = this.getTotalWritten() + chunk.length;
    const lo = nextTotal >>> 0;
    const hi = Math.floor(nextTotal / 0x100000000) >>> 0;

    if (this.shared) {
      Atomics.store(this.header, 0, writeIdx);
      Atomics.store(this.header, 1, lo | 0);
      Atomics.store(this.header, 2, hi | 0);
    } else {
      this.header[0] = writeIdx;
      this.header[1] = lo | 0;
      this.header[2] = hi | 0;
    }
  }

  /**
   * Returns an exact `capacity`-sample (8.0s @ 16 kHz = 128,000 samples) **end-aligned**
   * left-zero-padded Float32Array (latest sample at index `capacity - 1`).
   */
  readEndAlignedWindow(out?: Float32Array): Float32Array {
    const cap = this.capacity;
    const dest = out && out.length === cap ? out : new Float32Array(cap);
    const total = this.getTotalWritten();
    const writeIdx = this.getWriteIndex();

    if (total === 0) {
      dest.fill(0);
      return dest;
    }

    if (total < cap) {
      const zeroPad = cap - total;
      dest.fill(0, 0, zeroPad);
      // Since total < cap and ring started at 0, active samples sit at [0 .. writeIdx)
      const count = Math.min(total, writeIdx);
      dest.set(this.samples.subarray(0, count), zeroPad + (total - count));
      return dest;
    }

    // Full ring: oldest sample at writeIdx, newest at (writeIdx - 1)
    const firstLen = cap - writeIdx;
    dest.set(this.samples.subarray(writeIdx, cap), 0);
    if (writeIdx > 0) {
      dest.set(this.samples.subarray(0, writeIdx), firstLen);
    }
    return dest;
  }
}

/**
 * Self-contained AudioWorkletProcessor code executed off-main-thread.
 */
export const DUPLEX_WORKLET_SOURCE = `
class XcDuplexEarProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const po = (options && options.processorOptions) || {};
    this.targetRate = 16000;
    this.cap = ${DUPLEX_RING_SAMPLES};
    this.sab = po.sab || null;
    this.header = this.sab ? new Int32Array(this.sab, 0, ${RING_HEADER_INT32_COUNT}) : null;
    this.ring = this.sab ? new Float32Array(this.sab, ${RING_HEADER_BYTES}, this.cap) : null;
    this.srcFrac = 0;
    this.lastSample = 0;
    this.hasLast = false;
    this.frameBuf = new Float32Array(512);
    this.framePos = 0;
    this.totalWritten = 0;
    this.stopped = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stop') {
        this.stopped = true;
      }
    };
  }

  _writeRing(samples, count) {
    if (!this.ring || !this.header || count <= 0) return;
    let writeIdx = Atomics.load(this.header, 0);
    const cap = this.cap;
    const first = Math.min(count, cap - writeIdx);
    this.ring.set(samples.subarray(0, first), writeIdx);
    const rem = count - first;
    if (rem > 0) {
      this.ring.set(samples.subarray(first, count), 0);
    }
    writeIdx = (writeIdx + count) % cap;
    this.totalWritten += count;
    const lo = (this.totalWritten >>> 0) | 0;
    const hi = (Math.floor(this.totalWritten / 4294967296) >>> 0) | 0;
    Atomics.store(this.header, 0, writeIdx);
    Atomics.store(this.header, 1, lo);
    Atomics.store(this.header, 2, hi);
  }

  _emitFrame(samples, count) {
    let sumSq = 0;
    for (let i = 0; i < count; i++) {
      const v = samples[i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / count);
    if (this.ring) {
      this._writeRing(samples, count);
    }
    const copy = new Float32Array(count);
    copy.set(samples.subarray(0, count));
    this.port.postMessage({ type: 'pcm', pcm: copy, rms }, [copy.buffer]);
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs && inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    if (sampleRate === this.targetRate) {
      for (let i = 0; i < input.length; i++) {
        this.frameBuf[this.framePos++] = input[i];
        if (this.framePos >= this.frameBuf.length) {
          this._emitFrame(this.frameBuf, this.framePos);
          this.framePos = 0;
        }
      }
      return true;
    }

    const ratio = sampleRate / this.targetRate;
    let pos = this.srcFrac;
    while (pos < input.length) {
      let s0;
      let s1;
      let frac;
      if (pos < 0) {
        s0 = this.hasLast ? this.lastSample : input[0];
        s1 = input[0];
        frac = pos + 1;
      } else {
        const i0 = Math.floor(pos);
        const i1 = i0 + 1;
        if (i1 >= input.length) break;
        s0 = input[i0];
        s1 = input[i1];
        frac = pos - i0;
      }
      this.frameBuf[this.framePos++] = s0 * (1 - frac) + s1 * frac;
      if (this.framePos >= this.frameBuf.length) {
        this._emitFrame(this.frameBuf, this.framePos);
        this.framePos = 0;
      }
      pos += ratio;
    }
    this.srcFrac = pos - input.length;
    this.lastSample = input[input.length - 1];
    this.hasLast = true;
    return true;
  }
}

registerProcessor('${DUPLEX_WORKLET_NAME}', XcDuplexEarProcessor);
`;

export function createDuplexWorkletBlobUrl(): string {
  const blob = new Blob([DUPLEX_WORKLET_SOURCE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}
