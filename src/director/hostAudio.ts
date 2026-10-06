/**
 * hostAudio.ts — 「宿主直接给音频」链路的纯工具 (无 DOM / three 依赖, 可在 node 里单测)。
 *
 * 背景: 现有说话链路是 文字 → /api/tts → MP3 流式解码 → 16 kHz PCM → EMAGE (窗口推理) → 动作,
 *       同一段 PCM 也被做成 AudioBuffer 播放, 口型是 AnalyserNode 的 RMS (见 chatDirector.tick)。
 *       EMAGE 的输入本来就是「16 kHz 单声道 PCM」, 与音频来源无关, 因此宿主音频只需要
 *       解码 → 单声道 → 16 kHz (喂 EMAGE) + 原采样率 AudioBuffer (播放), 无需 TTS。
 */

/** 宿主音频链路的可调参数。 */
export const HOST_AUDIO = {
  /**
   * 首个切片时长 (秒)。范围 0.5~4。
   * 调小: 首帧动作/起播更早 (TTFA 更低), 但首窗的上下文更少, 起手动作可能更"散";
   * 调大: 起播前要先等更多音频推理完, 延迟增加。EMAGE 一个窗口 ≈ 64 帧 / 30 fps ≈ 2.13 s, 2 s 约等于一个窗口。
   */
  firstSliceSec: 2.0,
  /**
   * 后续切片时长 (秒)。范围 1~8。
   * 调小: 每片都做一次 checkpoint (尾窗不满, 推理效率低、CPU 占用高), 切片接缝更多;
   * 调大: 效率更高、接缝更少, 但低端设备上每片推理时间更长, 追不上实时播放就会出现"等下一片"的停顿。
   */
  sliceSec: 4.0,
  /** 单次/单流最长音频 (秒)。调大允许更长音频但内存占用线性增加 (48 kHz mono float ≈ 11.5 MB/分钟); 调小更安全。 */
  maxSec: 120,
  /** 单个编码音频 (ArrayBuffer/Blob/URL) 的最大字节数。调大允许更高码率/更长音频; 调小防止恶意宿主塞爆内存。 */
  maxBytes: 32 * 1024 * 1024,
  /** 解码用 OfflineAudioContext 采样率 (Hz)。decodeAudioData 会把音频重采样到该值; 48000 保证播放质量, 再另行降采样到 16k 喂 EMAGE。 */
  decodeSampleRate: 48000,
  /** 允许的输入采样率范围 (Hz)。AudioBuffer 规范下限 8000, 上限 96000。 */
  minSampleRate: 8000,
  maxSampleRate: 96000,
  /** EMAGE 要求的采样率 (Hz), 模型导出契约, 不要改。 */
  emageSampleRate: 16000,
  /** 宿主音频倍速。和页面播放器的 0.5~2 对齐, 并留出 VRMA timeScale 一样的 0.25~3。 */
  minPlaybackRate: 0.25,
  maxPlaybackRate: 3,
  /** 宿主音频音量。0 静音, 1 原来的增益。audible:false 时扬声器仍是 0。 */
  minVolume: 0,
  maxVolume: 1,
} as const;

/** 合法倍速夹到范围内。不是有限数字则返回 undefined, 调用方保持原值。 */
export function clampPlaybackRate(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(HOST_AUDIO.maxPlaybackRate, Math.max(HOST_AUDIO.minPlaybackRate, v));
}

/** 合法音量夹到 0~1。不是有限数字则返回 undefined。 */
export function clampVolume(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(HOST_AUDIO.maxVolume, Math.max(HOST_AUDIO.minVolume, v));
}

/** 主线程里"一段原始音频"的统一表示: 单声道 Float32 PCM + 采样率。 */
export interface HostAudioInput {
  sampleRate: number;
  /** 单声道 PCM 块 (任意长度)。整段音频就是只 yield 一次。 */
  chunks: AsyncIterable<Float32Array>;
}

/** 交错多声道 → 单声道 (均值)。channels<=1 时原样返回 (不拷贝)。 */
export function downmixToMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += interleaved[i * channels + c]!;
    out[i] = s / channels;
  }
  return out;
}

/** PCM16 (小端 Int16) → Float32 [-1, 1)。 */
export function pcm16ToFloat32(src: Int16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i]! / 32768;
  return out;
}

/**
 * 流式降采样到 16 kHz (盒式滤波 = 区间平均)。
 * 比"取最近点/线性插值"多了一道低通, 48k→16k 时不会把高频混叠进 EMAGE 的声学特征。
 * 跨块保持小数相位, 因此分块喂入与整段喂入输出一致。
 */
export class StreamResampler16k {
  private ratio: number;
  private pos = 0; // 在"当前块起点"坐标系下, 下一个输出样本窗口的起点 (输入样本单位)
  private tail: Float32Array = new Float32Array(0);

  constructor(sourceRate: number, targetRate: number = HOST_AUDIO.emageSampleRate) {
    this.ratio = sourceRate / targetRate;
  }

  /** 返回的数组是全新分配的 (可安全 transfer)。 */
  push(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice();
    let buf = input;
    if (this.tail.length > 0) {
      buf = new Float32Array(this.tail.length + input.length);
      buf.set(this.tail, 0);
      buf.set(input, this.tail.length);
    }
    const out: number[] = [];
    let pos = this.pos;
    while (pos + this.ratio <= buf.length) {
      const a = pos;
      const b = pos + this.ratio;
      let i0 = Math.floor(a);
      const i1 = Math.ceil(b);
      let sum = 0;
      let wsum = 0;
      for (; i0 < i1; i0++) {
        const lo = Math.max(a, i0);
        const hi = Math.min(b, i0 + 1);
        const w = hi - lo;
        if (w <= 0) continue;
        sum += buf[i0]! * w;
        wsum += w;
      }
      out.push(wsum > 0 ? sum / wsum : 0);
      pos = b;
    }
    const keepFrom = Math.floor(pos);
    this.tail = buf.slice(keepFrom);
    this.pos = pos - keepFrom;
    return Float32Array.from(out);
  }
}

/**
 * 把任意大小的 PCM 块重新打成「首片 firstSec、其后 sliceSec」的切片。
 * 每个切片对应 EMAGE 的一次 checkpoint 与一段独立 AudioBuffer。
 */
export class PcmSlicer {
  private parts: Float32Array[] = [];
  private samples = 0;
  private emitted = 0;

  private sampleRate: number;
  private firstSec: number;
  private sliceSec: number;

  constructor(
    sampleRate: number,
    firstSec: number = HOST_AUDIO.firstSliceSec,
    sliceSec: number = HOST_AUDIO.sliceSec,
  ) {
    this.sampleRate = sampleRate;
    this.firstSec = firstSec;
    this.sliceSec = sliceSec;
  }

  private target(): number {
    return Math.max(1, Math.floor(this.sampleRate * (this.emitted === 0 ? this.firstSec : this.sliceSec)));
  }

  /** 写入一块 PCM, 返回此刻凑满的所有切片。 */
  push(chunk: Float32Array): Float32Array[] {
    const out: Float32Array[] = [];
    let rest: Float32Array | null = chunk;
    while (rest && rest.length > 0) {
      const need = this.target() - this.samples;
      if (rest.length < need) {
        this.parts.push(rest);
        this.samples += rest.length;
        break;
      }
      this.parts.push(rest.subarray(0, need));
      this.samples += need;
      out.push(this.take());
      rest = rest.length > need ? rest.subarray(need) : null;
    }
    return out;
  }

  /** 流结束: 取出不足一片的尾巴 (可能为 null)。 */
  flush(): Float32Array | null {
    return this.samples > 0 ? this.take() : null;
  }

  private take(): Float32Array {
    const out = new Float32Array(this.samples);
    let off = 0;
    for (const p of this.parts) { out.set(p, off); off += p.length; }
    this.parts = [];
    this.samples = 0;
    this.emitted++;
    return out;
  }
}

/** 极简异步队列: 生产者 push / close, 消费者 for await。支持中途 abort (消费者立即结束)。 */
export class AsyncChunkQueue implements AsyncIterable<Float32Array> {
  private items: Float32Array[] = [];
  private waiters: Array<(r: IteratorResult<Float32Array>) => void> = [];
  private closed = false;
  /** 已入队、尚未被消费的采样数 (用于背压/上限判断)。 */
  pendingSamples = 0;

  push(c: Float32Array): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) { w({ value: c, done: false }); return; }
    this.items.push(c);
    this.pendingSamples += c.length;
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  /** 丢弃未消费数据并结束。 */
  abort(): void {
    this.items = [];
    this.pendingSamples = 0;
    this.close();
  }

  [Symbol.asyncIterator](): AsyncIterator<Float32Array> {
    return {
      next: () => {
        const it = this.items.shift();
        if (it) { this.pendingSamples -= it.length; return Promise.resolve({ value: it, done: false }); }
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/** 整段 PCM → 只 yield 一次的 HostAudioInput。 */
export function singleChunkInput(pcm: Float32Array, sampleRate: number): HostAudioInput {
  return {
    sampleRate,
    chunks: (async function* () { yield pcm; })(),
  };
}

/**
 * 解码编码音频 (mp3/wav/ogg/aac/webm/flac…, 取决于浏览器) → 单声道 Float32 + 采样率。
 * 用 OfflineAudioContext: 不受自动播放策略影响 (suspended 的 AudioContext 也能解, 但这里更干净)。
 */
export async function decodeEncodedAudio(buf: ArrayBuffer): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const Ctor: typeof OfflineAudioContext | undefined =
    (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctor) throw new Error('OfflineAudioContext is not available');
  const ctx = new Ctor(1, 1, HOST_AUDIO.decodeSampleRate);
  const decoded = await ctx.decodeAudioData(buf);
  const ch = decoded.numberOfChannels;
  if (decoded.length === 0) throw new Error('decoded audio is empty');
  if (ch === 1) return { pcm: decoded.getChannelData(0).slice(), sampleRate: decoded.sampleRate };
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < ch; c++) {
    const d = decoded.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += d[i]! / ch;
  }
  return { pcm: mono, sampleRate: decoded.sampleRate };
}
