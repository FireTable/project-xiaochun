/**
 * chatDirector — 全本地说话链路:
 *   1. POST /director/plan        → {speech}
 *   2. POST /director/synthesize  → wav (Audio8 / MiniMax)
 *   3. EMAGE 流式用音频生成全身手势 (无限自回归长会话模式：整场回答会话长驻，跨段特征不断，Checkpoint 增量结算)[cite: 13]
 *   4. 起播 audio + EMAGE; RMS → 口型
 * 思考阶段仍用 thinking.vrma。
 */

import type * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { makeClipSeamless } from '@/motion/vrmaRetarget';
import type { VRMAMotionPlayer } from '@/motion/sources/vrma';
import { type EmagePlayer, type EmageMotionData } from '@/motion/sources/emage';
import { generateSpeechReply } from '@/llm/chatWorkflow';
import { MPEGDecoder } from 'mpg123-decoder';
import { rememberTurn } from '@/memory';
import type { MotionPipeline } from '@/motion/pipeline/motionPipeline';
import type { Lang } from '@/i18n';
import { APP_CONFIG } from '@/config';
import { StreamResampler16k, PcmSlicer, HOST_AUDIO, clampPlaybackRate, clampVolume, type HostAudioInput } from '@/director/hostAudio';

interface Plan { speech: string; llm_provider?: string }

import { splitIntoSpeechChunks, stripForTTS } from '@/lib/utils';
export { splitIntoSpeechChunks, stripForTTS };

/**
 * 流式线性重采样辅助器：将任意采样率输入以 16000Hz 流式产出
 */
class Resampler16k {
  private inSampleRate = 0;
  private srcFrac = 0;

  setSourceSampleRate(sr: number) {
    this.inSampleRate = sr;
  }

  resample(input: Float32Array): Float32Array {
    if (!this.inSampleRate || this.inSampleRate === 16000) {
      return input;
    }
    const ratio = this.inSampleRate / 16000;
    const outLen = Math.floor((input.length - this.srcFrac) / ratio);
    if (outLen <= 0) return new Float32Array(0);

    const out = new Float32Array(outLen);
    let curr = this.srcFrac;
    for (let i = 0; i < outLen; i++) {
      const idx = Math.floor(curr);
      const next = Math.min(input.length - 1, idx + 1);
      const frac = curr - idx;
      out[i] = input[idx]! * (1 - frac) + input[next]! * frac;
      curr += ratio;
    }
    this.srcFrac = curr - input.length;
    return out;
  }
}

/**
 * 计算 PCM 片段能量均方根 (RMS)
 */
function getChunkRMS(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    sum += pcm[i]! * pcm[i]!;
  }
  return Math.sqrt(sum / pcm.length);
}

/**
 * 单切片音频合成与流式注入 (会话不关闭，通过 Checkpoint 增量结算动作，前置拦截尾静音对齐时钟)[cite: 13]
 */
async function streamChunkAudioToCheckpoint(
  text: string,
  ctx: AudioContext,
  emage: EmagePlayer,
  isStopped: () => boolean,
  onEmagePhase?: (durationSec: number) => void,
): Promise<{ audioBuffer: AudioBuffer; motion: EmageMotionData }> {
  const ttsText = stripForTTS(text);
  if (!ttsText) {
    const dummy = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    return {
      audioBuffer: dummy,
      motion: {
        rot6d: new Float32Array(0),
        trans: new Float32Array(0),
        frameCount: 0,
        duration: 0.1,
        fps: 30,
      },
    };
  }

  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: ttsText,
      voice: 'zh-CN-XiaoyiNeural',
      pitch: '+10Hz',
    }),
  });

  if (!res.ok) throw new Error(`语音合成服务异常: HTTP ${res.status}`);
  if (!res.body) throw new Error('语音合成响应无 body');

  const reader = res.body.getReader();
  const decoder = new MPEGDecoder();
  await decoder.ready;

  let srcSampleRate = 0;
  const committedMonoChunks: Float32Array[] = [];
  let totalCommittedSamples = 0;
  const resampler = new Resampler16k();

  // ── 前置流式尾静音拦截器 ──
  // 维护待确认的静音 chunks，避免 TTS 尾部的死寂大段静音提前喂进 EMAGE 造成动作垮掉[cite: 13]
  let pendingSilenceMono: Float32Array[] = [];
  let pendingSilence16k: Float32Array[] = [];
  let pendingSamples = 0;
  const silenceThreshold = 0.005;

  try {
    while (true) {
      if (isStopped()) {
        reader.cancel();
        break;
      }
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      const r = decoder.decode(value);
      if (r.samplesDecoded <= 0) continue;

      if (srcSampleRate === 0) {
        srcSampleRate = r.sampleRate;
        resampler.setSourceSampleRate(srcSampleRate);
      }

      // 提取当前 chunk 的 Mono PCM[cite: 13]
      const numCh = r.channelData.length;
      const chunkMono = new Float32Array(r.samplesDecoded);
      for (let ch = 0; ch < numCh; ch++) {
        const chData = r.channelData[ch]!;
        for (let i = 0; i < r.samplesDecoded; i++) {
          chunkMono[i] += chData[i]! / numCh;
        }
      }

      const chunk16k = resampler.resample(chunkMono);
      const isSilent = getChunkRMS(chunkMono) < silenceThreshold;

      if (isSilent) {
        // 低能量静音 chunk 先存入待定缓冲区，暂不 push 给 EMAGE，也不入已提交队列[cite: 13]
        pendingSilenceMono.push(chunkMono);
        if (chunk16k.length > 0) pendingSilence16k.push(chunk16k);
        pendingSamples += r.samplesDecoded;
      } else {
        // 检测到正常声能！说明之前的静音只是词语间的正常气口/顿挫，立即全部释放并推给 EMAGE[cite: 13]
        if (pendingSilenceMono.length > 0) {
          for (let i = 0; i < pendingSilenceMono.length; i++) {
            committedMonoChunks.push(pendingSilenceMono[i]!);
            if (pendingSilence16k[i] && pendingSilence16k[i]!.length > 0) {
              emage.pushAudioChunk(pendingSilence16k[i]!);
            }
          }
          totalCommittedSamples += pendingSamples;
          pendingSilenceMono = [];
          pendingSilence16k = [];
          pendingSamples = 0;
        }

        // 提交当前有声 chunk[cite: 13]
        committedMonoChunks.push(chunkMono);
        totalCommittedSamples += r.samplesDecoded;
        if (chunk16k.length > 0) {
          emage.pushAudioChunk(chunk16k);
        }
      }
    }

    // ── 流读取完毕（EOF）：处理待定尾部静音 ──
    // 此时 pendingSilence 队列里的内容被证实是句末尾部静音！
    // 仅保留最多 0.20 秒自然余响缓冲，多余的死寂静音直接丢弃，绝不喂给 EMAGE[cite: 13]
    const maxKeepSamples = Math.floor(srcSampleRate * 0.20);
    let keepSamplesCount = 0;
    for (let i = 0; i < pendingSilenceMono.length; i++) {
      const pMono = pendingSilenceMono[i]!;
      const p16k = pendingSilence16k[i];
      if (keepSamplesCount + pMono.length <= maxKeepSamples) {
        committedMonoChunks.push(pMono);
        totalCommittedSamples += pMono.length;
        if (p16k && p16k.length > 0) {
          emage.pushAudioChunk(p16k);
        }
        keepSamplesCount += pMono.length;
      } else {
        // 超过 200ms 的纯死寂静音全部抛弃，主线程与 Worker 完全同步截止[cite: 13]
        break;
      }
    }
  } finally {
    decoder.free();
  }

  if (totalCommittedSamples === 0) {
    throw new Error('语音合成数据为空');
  }

  // ponytail: TTS 字节流已收完,EMAGE 还在收尾窗+decode → 这就是"emage 阶段",
  // 给气泡一个独立的切换点(老 batch 路径靠串行天然分两阶段,streaming 把它压扁了)。[cite: 13]
  onEmagePhase?.(totalCommittedSamples / srcSampleRate);

  // 核心改动：调用 checkpointAudioStream() 增量提取切片动作，绝不关流，特征栈完整保留[cite: 13]
  const motion = await emage.checkpointAudioStream();

  // 将同步裁剪后的 Mono PCM 组装并重采样为 AudioBuffer[cite: 13]
  const mono = new Float32Array(totalCommittedSamples);
  let off = 0;
  for (const seg of committedMonoChunks) {
    mono.set(seg, off);
    off += seg.length;
  }

  const targetSR = ctx.sampleRate;
  const ratioCtx = srcSampleRate / targetSR;
  const nCtx = Math.max(1, Math.floor(mono.length / ratioCtx));
  const pcmCtx = new Float32Array(nCtx);
  for (let i = 0; i < nCtx; i++) {
    pcmCtx[i] = mono[Math.min(mono.length - 1, Math.floor(i * ratioCtx))]!;
  }

  const audioBuffer = ctx.createBuffer(1, pcmCtx.length, targetSR);
  audioBuffer.copyToChannel(pcmCtx, 0);

  return { audioBuffer, motion };
}

interface PipelineSliceRow {
  '#': number;
  'Text Preview': string;
  'Chars': number;
  'TTS & EMAGE Stream': string;
  'Playback': string;
  'Transition Mode': string;
}

class PipelineTableTracker {
  private rows: PipelineSliceRow[] = [];

  constructor(chunks: string[]) {
    this.rows = chunks.map((c, i) => ({
      '#': i,
      'Text Preview': c.length > 20 ? c.slice(0, 20) + '…' : c,
      'Chars': c.length,
      'TTS & EMAGE Stream': '⏳ 等待中',
      'Playback': '⏸️ 待播放',
      'Transition Mode': i === 0 ? '首段0.6s淡入' : '无缝切段混合',
    }));
    if (typeof window !== 'undefined') {
      (window as any).__pipelineTable = this.rows;
    }
    this.print('⚡ 无限自回归长流管线初始化');
  }

  update(index: number, patch: Partial<PipelineSliceRow>, stageInfo?: string): void {
    if (this.rows[index]) {
      Object.assign(this.rows[index]!, patch);
      this.print(stageInfo ?? `切片 #${index} 阶段更新`);
    }
  }

  private print(stageInfo: string): void {
    const inPlace = typeof window !== 'undefined' && Boolean((window as any).__pipelineInPlace);
    if (inPlace && typeof console.clear === 'function') {
      console.clear();
      console.log(`📊 [ChatDirector] 无限自回归长流管线状态表 (${stageInfo})`);
      console.table(this.rows);
      return;
    }

    console.log(`\n📊 [ChatDirector] 流式管线切片更新 ➔ 【${stageInfo}】`);
    console.table(this.rows);
  }
}

export class ChatDirector {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuf: Uint8Array | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGain: GainNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private audioDone = false;
  private audioDoneTime = 0;

  private plan: Plan | null = null;
  public speaking = false;
  private stopped = false;
  private onEnd: (() => void) | null = null;
  private player: VRMAMotionPlayer | null = null;
  private emage: EmagePlayer | null = null;
  private currentVRM: VRM | null = null;
  private pipeline: MotionPipeline | null = null;
  private stopPlaySegment: (() => void) | null = null;
  /** speakAudio 会话号: 被新的说话请求抢占后, 旧会话的循环据此退出 (旧 TTS 路径不受影响)。 */
  private speakSession = 0;
  /** 唤醒 speakAudio 里正在等下一片的主循环 (stop() 抢占时调用, 否则它会一直挂在 notifyReady 上)。 */
  private wakeSpeakAudio: (() => void) | null = null;
  /**
   * 宿主音频的时钟通知: 首段 AudioBuffer 真正 start 时调用一次。
   * 思考动作和 EMAGE 首窗都发生在这之前, 宿主靠它把自己的播放对齐。
   */
  private hostClockStart: (() => void) | null = null;
  /** 宿主音频倍速。只作用于 speakAudio, TTS 仍是 1。 */
  private playbackRate = 1;
  /** 宿主音频音量 0~1。audible:false 时不送到扬声器。 */
  private volume = 1;
  /** 当前这次 speakAudio 正在用上面的倍速和音量。 */
  private followTransport = false;
  /** 当前 BufferSource 的内容时间原点, 以及对应的 AudioContext 时间。改倍速时改写, 播放头不跳。 */
  private clockOriginContent = 0;
  private clockOriginCtx = 0;
  private clockAudible = true;
  /** 宿主音频可关闭口型 (lipsync:false)。stop() 会复位, 所以 say/speakText 路径永远是开的。 */
  private lipsyncDisabled = false;

  bindPipeline(pipeline: MotionPipeline): void {
    this.pipeline = pipeline;
  }

  public translateSync: ((key: string, vars?: Record<string, unknown>) => string) | null = null;
  public getSystemPrompt: (() => string) | null = null;
  public getSystemContext: (() => Promise<{ prompt: string; lang: Lang }>) | null = null;

  public onSuspendRendering: (() => void) | null = null;
  public onResumeRendering: (() => void) | null = null;

  private thinkingVRMABuf: ArrayBuffer | null = null;
  private cachedThinkingClip: THREE.AnimationClip | null = null;

  resetClipCache(): void {
    this.cachedThinkingClip = null;
  }

  async preloadThinking(): Promise<void> {
    try {
      const vrmaRes = await fetch('/vrm/motion/thinking.vrma');
      if (vrmaRes.ok) {
        this.thinkingVRMABuf = await vrmaRes.arrayBuffer();
      }
    } catch (e) {
      console.warn('预加载思考动作失败', e);
    }
  }

  async warmThinkingClip(vrm: VRM, player: VRMAMotionPlayer): Promise<void> {
    if (!this.thinkingVRMABuf) await this.preloadThinking();
    if (!this.thinkingVRMABuf) return;
    try {
      const clip = await player.parseBufferToClip(this.thinkingVRMABuf, vrm);
      makeClipSeamless(clip);
      this.cachedThinkingClip = clip;
    } catch (e) {
      console.warn('预解析思考动作失败', e);
    }
  }

  private async playThinking(vrm: VRM, player: VRMAMotionPlayer): Promise<void> {
    document.body.classList.add('chat-playing');
    this.currentVRM = vrm;

    if (!this.thinkingVRMABuf) {
      await this.preloadThinking();
    }
    if (this.thinkingVRMABuf) {
      try {
        if (!this.cachedThinkingClip) {
          const clip = await player.parseBufferToClip(this.thinkingVRMABuf, vrm);
          makeClipSeamless(clip);
          this.cachedThinkingClip = clip;
        }
        this.pipeline?.playThinkingClip(this.cachedThinkingClip, vrm, 0.65);
      } catch (e) {
        console.warn('播放 thinking.vrma 动作失败', e);
        this.pipeline?.setIdleThinkSway(true);
      }
    } else {
      this.pipeline?.setIdleThinkSway(true);
    }
  }

  async say(
    text: string,
    vrm: VRM,
    player: VRMAMotionPlayer,
    emage: EmagePlayer,
    status: (
      key: string,
      vars?: Record<string, unknown>,
      isError?: boolean,
      speechText?: string,
      segmentIndex?: number,
      totalSegments?: number,
    ) => void,
  ): Promise<void> {
    this.stop();
    this.stopped = false;
    this.audioDone = false;
    this.speaking = false;
    this.player = player;
    this.emage = emage;
    await this.playThinking(vrm, player);

    const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const staggerDelay = isMobile ? 380 : 50;
    await new Promise((r) => setTimeout(r, staggerDelay));
    if (this.stopped) return;

    let speechText = '';
    try {
      const ctx = await (this.getSystemContext?.() ?? Promise.resolve({
        prompt: this.getSystemPrompt?.() ?? '',
        lang: 'zh-CN' as Lang,
      }));
      speechText = await generateSpeechReply(
        text,
        (key, vars) => status(key, vars),
        ctx.prompt,
        ctx.lang,
      );
    } catch (e: any) {
      console.error('[ChatDirector] LLM failed:', e);
      const rawMsg = (e?.message ?? String(e) ?? '').trim();
      status('error.llm', { message: rawMsg || 'Unknown error' }, true);
      this.stop();
      return;
    }
    if (this.stopped || !speechText.trim()) {
      speechText = this.translateSync?.('bubble.greeting') ?? '';
      if (!speechText.trim()) return;
    }
    this.plan = { speech: speechText.trim(), llm_provider: 'WebLLM (q4f16_1)' };
    await this.runSpeechPipeline(text, player, emage, status);
  }

  async speakText(
    text: string,
    vrm: VRM,
    player: VRMAMotionPlayer,
    emage: EmagePlayer,
    status: (
      key: string,
      vars?: Record<string, unknown>,
      isError?: boolean,
      speechText?: string,
      segmentIndex?: number,
      totalSegments?: number,
    ) => void,
  ): Promise<void> {
    this.stop();
    this.stopped = false;
    this.audioDone = false;
    this.speaking = false;
    this.player = player;
    this.emage = emage;
    await this.playThinking(vrm, player);

    const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const staggerDelay = isMobile ? 380 : 50;
    await new Promise((r) => setTimeout(r, staggerDelay));
    if (this.stopped) return;

    await new Promise((r) => requestAnimationFrame(r));
    if (this.stopped) return;

    this.plan = { speech: text, llm_provider: 'DEV_BYPASS' };
    await this.runSpeechPipeline(text, player, emage, status);
  }

  /**
   * 宿主直接给音频: 不走 LLM / TTS, 音频 → (16 kHz) EMAGE 窗口推理 → 动作, 同一段音频播放 + RMS 口型。
   *
   * 与 speakText 共用: EmagePlayer 流式会话 (startAudioStream / pushAudioChunk / checkpointAudioStream / endAudioStream)、
   * P0a A/V 同步 (首块动作缓冲, 等 AudioBufferSourceNode.start 之后 releaseMotionForAudio)、tick() 里的 RMS 口型。
   * 差异: 音频被切成 HOST_AUDIO 配置的切片 (首片短, 降低起播延迟), 每片一次 checkpoint → 一个 AudioBuffer 排队播放;
   * 流式输入 (chunks 逐块到达) 与整段输入走同一条路径。
   *
   * opts.motion=false: 只播放音频 (+ 可选口型), 完全不加载/不调用 EMAGE。
   * opts.lipsync=false: 不驱动嘴型 ('aa')。
   * opts.audible=false: 增益为 0, 不送到扬声器; 音频时钟和口型照常, 给宿主自己播放同一段声音时用。
   * 返回时机: 全部音频播完 (或被新的说话/stop 抢占)。producer 出错会在清理后抛出。
   */
  async speakAudio(
    input: HostAudioInput,
    vrm: VRM,
    player: VRMAMotionPlayer,
    emage: EmagePlayer,
    status: (
      key: string,
      vars?: Record<string, unknown>,
      isError?: boolean,
      speechText?: string,
      segmentIndex?: number,
      totalSegments?: number,
    ) => void,
    opts: { motion?: boolean; lipsync?: boolean; audible?: boolean; text?: string; playbackRate?: number; volume?: number; onAudibleStart?: () => void } = {},
  ): Promise<void> {
    const useMotion = opts.motion !== false;
    this.stop();
    const session = ++this.speakSession;
    this.hostClockStart = opts.onAudibleStart ?? null;
    this.followTransport = true;
    const rate = clampPlaybackRate(opts.playbackRate);
    const volume = clampVolume(opts.volume);
    if (rate !== undefined) this.playbackRate = rate;
    if (volume !== undefined) this.volume = volume;
    const gone = () => this.stopped || session !== this.speakSession;
    this.stopped = false;
    this.audioDone = false;
    this.speaking = false;
    this.player = player;
    this.emage = emage;
    this.lipsyncDisabled = opts.lipsync === false;

    if (useMotion) {
      await this.playThinking(vrm, player);
      const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      await new Promise((r) => setTimeout(r, isMobile ? 380 : 50));
    }
    if (gone()) return;

    this.ctx = this.ctx ?? new AudioContext();
    if (this.ctx.state === 'suspended') {
      // 没有用户激活 (且宿主 iframe 没有 allow="autoplay") 时 resume() 会一直 pending: 给个明确的错误而不是静默挂死。
      const resumed = await Promise.race([
        this.ctx.resume().then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 10_000)),
      ]);
      if (!resumed && (this.ctx.state as AudioContextState) !== 'running') {
        this.stop();
        throw new Error('AudioContext is blocked by the autoplay policy (needs a user gesture in the host page + iframe allow="autoplay")');
      }
    }
    if (gone()) return;
    const ctx = this.ctx;
    const sr = input.sampleRate;

    this.plan = { speech: opts.text ?? '', llm_provider: 'HOST_AUDIO' };

    if (useMotion) {
      emage.loop = false;
      emage.playAudio = false;
      emage.holdLastFrame = false;
      emage.onMotionChunk = null;
      await emage.startAudioStream({
        continueFromPrevious: false,
        profileStages: false,
        emitPerWindow: true,
        advanceFrames: APP_CONFIG.emage.motion.advanceFrames,
      });
      if (gone()) { emage.abortAudioStream(); return; }
    }

    interface HostSegment { audioBuffer: AudioBuffer; motion: EmageMotionData }
    const emptyMotion: EmageMotionData = {
      rot6d: new Float32Array(0), trans: new Float32Array(0), frameCount: 0, duration: 0, fps: 30,
    };
    const readyQueue: HostSegment[] = [];
    const notifyReady: (() => void)[] = [];
    const wake = () => { for (const cb of notifyReady.splice(0)) cb(); };
    this.wakeSpeakAudio = wake;
    let producerFinished = false;
    let producerError: unknown = null;
    let totalSamples = 0;
    let segmentCount = 0;

    const resampler = new StreamResampler16k(sr);
    const slicer = new PcmSlicer(sr);

    const makeSegment = async (slice: Float32Array): Promise<void> => {
      let motion = emptyMotion;
      if (useMotion) {
        if (gone()) return; // 被抢占后绝不能再往 (可能已属于新会话的) EMAGE 流里灌 PCM
        const p16 = resampler.push(slice); // 新数组, 可 transfer
        if (p16.length > 0) emage.pushAudioChunk(p16);
        motion = await emage.checkpointAudioStream();
      }
      if (gone()) return;
      const buf = ctx.createBuffer(1, slice.length, sr);
      buf.copyToChannel(slice as Float32Array<ArrayBuffer>, 0);
      segmentCount++;
      readyQueue.push({ audioBuffer: buf, motion });
      wake();
    };

    const producer = (async () => {
      try {
        for await (const chunk of input.chunks) {
          if (gone()) break;
          totalSamples += chunk.length;
          if (totalSamples > sr * HOST_AUDIO.maxSec) throw new Error(`audio exceeds ${HOST_AUDIO.maxSec}s`);
          for (const slice of slicer.push(chunk)) {
            await makeSegment(slice);
            if (gone()) break;
          }
        }
        if (!gone()) {
          const tail = slicer.flush();
          if (tail) await makeSegment(tail);
        }
        if (!gone() && totalSamples === 0) throw new Error('audio is empty');
      } catch (e) {
        producerError = e;
      } finally {
        producerFinished = true;
        // 只在自己仍是当前会话时收尾; 被抢占时 currentStreamId 可能已属于新会话, 绝不能去关它
        if (useMotion && !gone()) { try { await emage.endAudioStream(); } catch { /* ignore */ } }
        wake();
      }
    })();

    while (readyQueue.length === 0 && !producerFinished && !gone()) {
      await new Promise<void>((resolve) => notifyReady.push(resolve));
    }

    let timeline = 0;
    let played = 0;
    while (!gone()) {
      if (readyQueue.length === 0) {
        if (producerFinished) break;
        // 下一片还在推理: 保持 EMAGE 末姿 (streamingMotionActive) 等待, 不进 SpeakIdle (避免姿态回弹)
        if (useMotion && !emage.streamingMotionActive) { emage.clearExternalClock(); emage.enterSpeakIdle(); }
        while (readyQueue.length === 0 && !producerFinished && !gone()) {
          await new Promise<void>((resolve) => notifyReady.push(resolve));
        }
        if (useMotion && !emage.streamingMotionActive) emage.exitSpeakIdle();
        if (gone()) break;
        if (readyQueue.length === 0) break;
      }
      const seg = readyQueue.shift()!;
      this.audioBuffer = seg.audioBuffer;
      if (played === 0 && opts.text) status('speaking', undefined, false, opts.text, 1, 1);
      if (useMotion && seg.motion.frameCount > 0) {
        // 一律走 appendMotionChunk: 首块只缓冲 (awaitingAudioStart), 等 playAudioSource 里音频 start 后再 release;
        // 后续块 concat + 接缝缝合。不能用 applyMotionData/switchSegment (首片短于一个窗口时, 之后到达的 motion_chunk
        // 会被当成"首块"重置 playhead)。
        emage.appendMotionChunk(seg.motion);
      }
      const offset = timeline;
      const isInitial = played === 0;
      await new Promise<void>((resolve) => {
        if (gone()) { resolve(); return; }
        this.stopPlaySegment = () => resolve();
        this.playAudioSource(seg.audioBuffer, () => {
          this.stopPlaySegment = null;
          timeline = offset + seg.audioBuffer.duration;
          if (useMotion && emage.streamingMotionActive) {
            const frozen = timeline;
            emage.setExternalClock(() => frozen); // 片间冻结时钟, 防 playhead 回跳
          }
          resolve();
        }, emage, player, isInitial, offset, useMotion, opts.audible !== false, true);
      });
      played++;
    }

    const preempted = gone();
    if (!preempted) {
      this.audioDone = true;
      this.audioDoneTime = performance.now();
      if (useMotion) { emage.onMotionChunk = null; emage.clearExternalClock(); emage.stop(); }
      this.stop();
      this.onEnd?.();
    }
    if (this.wakeSpeakAudio === wake) this.wakeSpeakAudio = null;
    // 被抢占时不等 producer: 它可能正挂在已被 emage.stop() 丢弃的推理 promise 上, 等它会让宿主的 speakAudio 永远不返回
    if (preempted) { void producer.catch(() => { }); return; }
    await producer.catch(() => { });
    void segmentCount;
    if (producerError) throw producerError instanceof Error ? producerError : new Error(String(producerError));
  }

  /**
   * 无限自回归长流主流水线：
   * 1. 整场对话期间，startAudioStream 仅在最外层打开一次[cite: 13]
   * 2. 遍历各段切片持续 pushAudioChunk，通过 checkpointAudioStream() 增量提取切片动作[cite: 13]
   * 3. 彻底删除 setTimeout(220) 硬挂起，动作切换由 switchSegment 的 Slerp 自动吸收断层[cite: 11]
   * 4. 所有切片全部生成完毕后，在最外层调用 endAudioStream() 正式收尾闭环[cite: 13]
   */
  private async runSpeechPipeline(
    userText: string,
    player: VRMAMotionPlayer,
    emage: EmagePlayer,
    status: (
      key: string,
      vars?: Record<string, unknown>,
      isError?: boolean,
      segText?: string,
      segmentIndex?: number,
      totalSegments?: number,
    ) => void,
  ): Promise<void> {
    console.log('[ChatDirector] speech:', this.plan!.speech, 'llm:', this.plan!.llm_provider);
    void rememberTurn(userText, this.plan!.speech);

    this.ctx = this.ctx ?? new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const chunks = splitIntoSpeechChunks(this.plan!.speech);
    const tracker = new PipelineTableTracker(chunks);

    // ponytail: 不再调 emage.resetSeed() —— 下面的 startAudioStream({continueFromPrevious:false})
    // 会在 Worker 内部全清状态(feed_audio_start handler 已 reset seed/buffer/features/cursor)。
    emage.loop = false;
    emage.playAudio = false;
    emage.holdLastFrame = false;

    // ── 开启全局长会话：整场回答期间状态机长驻，特征绝不中途清空[cite: 13] ──
    // P0a: 窗级 motion_chunk；首块早于段 EOF 即可 status('emage')
    // P0a-AV: 首块仅缓冲，可见动作等 playAudioSource → releaseMotionForAudio
    let p0aFirstMotionLogged = false;
    emage.onMotionChunk = (data, isFirst) => {
      if (!isFirst || p0aFirstMotionLogged) return;
      p0aFirstMotionLogged = true;
      console.log('[P0a-AV] first motion_chunk buffered (before TTS play)', {
        frameCount: data.frameCount,
        duration: data.duration,
        fps: data.fps,
        awaitingAudioStart: emage.awaitingAudioStart,
      });
      status('emage', { seconds: data.duration.toFixed(1) }, false);
    };
    // ponyx-experiment: 003 patch 验证用,跑稳后改回 false
    await emage.startAudioStream({
      continueFromPrevious: false,
      profileStages: true,
      emitPerWindow: true,
      advanceFrames: APP_CONFIG.emage.motion.advanceFrames,
    });

    interface SpeechSegment {
      index: number;
      text: string;
      audioBuffer: AudioBuffer;
      motion: EmageMotionData;
    }

    const readyQueue: SpeechSegment[] = [];
    let producerFinished = false;
    const notifyReady: (() => void)[] = [];
    /** P0a-AV: 跨段累计已播 TTS 秒数，驱动连续 motion playhead */
    let audioTimelineOffsetSec = 0;

    const wakeConsumer = () => {
      while (notifyReady.length > 0) {
        const cb = notifyReady.shift();
        cb?.();
      }
    };

    // ── 后台生产者：持续灌入同一个长流，按 Checkpoint 增量提帧[cite: 13] ──
    const producerPromise = (async () => {
      for (let i = 0; i < chunks.length; i++) {
        if (this.stopped) break;
        try {
          const cText = chunks[i]!;
          if (readyQueue.length === 0 && i === 0) {
            status('tts', undefined, false);
          }

          tracker.update(i, { 'TTS & EMAGE Stream': '⚡ 无限自回归推演中…' }, `切片 #${i} 连续推演`);

          // 保持同一流式会话，持续 push PCM 并增量结算该段动作[cite: 13]
          const result = await streamChunkAudioToCheckpoint(
            cText,
            this.ctx!,
            emage,
            () => this.stopped,
            // ponytail: 仅 #0 触发 emage 阶段气泡 — 后续段切到 speaking 状态,避免重复刷屏。[cite: 13]
            i === 0 ? (sec) => status('emage', { seconds: sec.toFixed(1) }, false) : undefined,
          );
          if (this.stopped) break;

          tracker.update(i, {
            'TTS & EMAGE Stream': `✅ 就绪 (${result.audioBuffer.duration.toFixed(1)}s / ${result.motion.frameCount}帧)`,
          }, `切片 #${i} 流式就绪`);

          readyQueue.push({
            index: i,
            text: cText,
            audioBuffer: result.audioBuffer,
            motion: result.motion,
          });
          wakeConsumer();
        } catch (e) {
          console.warn(`[ChatDirector] 生产第 ${i} 段动作异常:`, e);
          tracker.update(i, { 'TTS & EMAGE Stream': '❌ 异常中断' }, `切片 #${i} 异常中断`);
          producerFinished = true;
          wakeConsumer();
          break;
        }
      }
      producerFinished = true;
      // 所有切片 push 完毕，调用全局唯一一次 endAudioStream 结清收尾[cite: 13]
      try {
        await emage.endAudioStream();
      } catch { }
      wakeConsumer();
    })();

    // 首段就绪立即起播 (流式下首段生成极快)[cite: 13]
    const targetPreload = 1;

    while (readyQueue.length < targetPreload && !producerFinished && !this.stopped) {
      await new Promise<void>((resolve) => notifyReady.push(resolve));
    }
    if (this.stopped) return;

    const playSegmentAudio = (buf: AudioBuffer, isInitial: boolean): Promise<void> => {
      return new Promise<void>((resolve) => {
        if (this.stopped) {
          resolve();
          return;
        }
        this.stopPlaySegment = () => resolve();
        const offset = audioTimelineOffsetSec;
        this.playAudioSource(buf, () => {
          this.stopPlaySegment = null;
          audioTimelineOffsetSec = offset + buf.duration;
          // E1: freeze streaming clock between TTS segments (avoid playhead rewind yank)
          if (emage.streamingMotionActive) {
            const frozen = audioTimelineOffsetSec;
            emage.setExternalClock(() => frozen);
          }
          resolve();
        }, emage, player, isInitial, offset);
      });
    };

    // ── 消费者播放循环 ──
    for (let i = 0; i < chunks.length; i++) {
      if (this.stopped) break;

      if (readyQueue.length === 0 && !producerFinished && !this.stopped) {
        // P0c: streaming 路径勿 SpeakIdle、勿清 clock；段间空隙由 playhead 停帧 + catch-up 吸收
        if (!emage.streamingMotionActive) {
          emage.clearExternalClock();
          emage.enterSpeakIdle();
        }
        tracker.update(
          i,
          { 'Playback': emage.streamingMotionActive ? '⏳ 等待下段 TTS（保持 EMAGE 末姿）' : '☕ 等待推理 (言谈微动待机)' },
          `等待切片 #${i} 就绪`,
        );
        while (readyQueue.length === 0 && !producerFinished && !this.stopped) {
          await new Promise<void>((resolve) => notifyReady.push(resolve));
        }
        if (!emage.streamingMotionActive) {
          emage.exitSpeakIdle();
        }
      }
      if (this.stopped) break;

      const seg = readyQueue.shift();
      if (!seg) break;

      this.audioBuffer = seg.audioBuffer;
      status('speaking', undefined, false, seg.text, i + 1, chunks.length);
      tracker.update(i, { 'Playback': '▶️ 播放中' });

      // P0a: 若已在 motion_chunk 流式播，勿 applyMotionData/switchSegment（会重置 playhead）
      // checkpoint 若仍带回未交付尾巴（frameCount>0），追加即可
      if (emage.streamingMotionActive) {
        if (seg.motion.frameCount > 0) {
          emage.appendMotionChunk(seg.motion);
        }
        await playSegmentAudio(seg.audioBuffer, i === 0);
      } else if (i === 0) {
        emage.applyMotionData(seg.motion, APP_CONFIG.emage.motion.fadeInDuration);
        await playSegmentAudio(seg.audioBuffer, true);
      } else {
        // 后续段切段：P0c.1 时长自适应 Slerp（默认 ~0.24s）
        emage.switchSegment(seg.motion, APP_CONFIG.emage.motion.switchSegmentCrossFade);
        await playSegmentAudio(seg.audioBuffer, false);
      }
      tracker.update(i, { 'Playback': '🏁 播放完成' });
    }

    if (this.stopped) return;

    this.audioDone = true;
    this.audioDoneTime = performance.now();
    emage.onMotionChunk = null;
    emage.clearExternalClock();
    emage.stop();
    this.stop();
    this.onEnd?.();

    await producerPromise.catch(() => { });
  }

  private playAudioSource(
    buf: AudioBuffer,
    onEnded: () => void,
    emage: EmagePlayer,
    _player: VRMAMotionPlayer | null,
    isInitial = true,
    audioTimelineOffsetSec = 0,
    /** false: 只播放音频 (宿主音频 motion:false), 不碰 EMAGE / 动作管线。 */
    useMotion = true,
    /** false: 增益为 0。分析器仍接在增益前面, 口型看得到波形, 动作时钟照走。 */
    audible = true,
    /** true: 用宿主倍速和音量, 动作时钟按倍速走。TTS 不传, 保持 1 倍。 */
    followTransport = false,
  ): void {
    if (!this.ctx || this.stopped) {
      onEnded();
      return;
    }

    if (isInitial && useMotion) this.pipeline?.beginEmageSpeech();
    this.speaking = true;
    this.audioDone = false;
    this.audioDoneTime = 0;
    document.body.classList.add('chat-playing');

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyserBuf = new Uint8Array(this.analyser.fftSize);
    this.currentGain = this.ctx.createGain();
    const gain = followTransport ? (audible ? this.volume : 0) : (audible ? 1 : 0);
    this.currentGain.gain.value = gain;
    // 分析器在增益前面: audible=false 时扬声器静音, 口型仍跟着原始波形
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = followTransport ? this.playbackRate : 1;
    src.connect(this.analyser);
    this.analyser.connect(this.currentGain);
    this.currentGain.connect(this.ctx.destination);
    this.currentSource = src;

    // P0a-AV: 连续流 playhead 用累计 TTS 时间，跨段不回跳；
    // clock 原点与 src.start(when) 对齐，避免 motion 早于可听 PCM。
    const when = this.ctx.currentTime;
    if (followTransport) this.clockAudible = audible;
    if (useMotion && followTransport) {
      this.clockOriginCtx = when;
      this.clockOriginContent = audioTimelineOffsetSec;
      emage.setExternalClock(() => {
        if (!this.ctx || this.stopped || this.audioDone) return -1;
        return Math.max(0, this.clockOriginContent + (this.ctx.currentTime - this.clockOriginCtx) * this.playbackRate);
      });
    } else if (useMotion) {
      emage.setExternalClock(() => {
        if (!this.ctx || this.stopped || this.audioDone) return -1;
        return Math.max(0, audioTimelineOffsetSec + (this.ctx.currentTime - when));
      });
    }

    console.log('[P0a-AV] audio_start', {
      isInitial,
      bufDuration: buf.duration,
      audioTimelineOffsetSec,
      streamingMotionActive: emage.streamingMotionActive,
      awaitingAudioStart: emage.awaitingAudioStart,
      when,
    });

    src.onended = () => {
      if (this.currentSource === src) {
        this.currentSource = null;
        onEnded();
      }
    };
    // 先 start 可听 TTS，再释放可见动作（满足 motion 不早于 speech）
    src.start(when);
    if (isInitial) this.emitHostClockStart();
    console.log('[P0a-AV] AudioBufferSourceNode.start', {
      when,
      ctxTime: this.ctx.currentTime,
      audioTimelineOffsetSec,
    });

    // P0a-AV: audio 已 start 后释放；已在播的后续段不重置 playhead
    if (!useMotion) return;
    if (emage.streamingMotionActive) {
      if (emage.awaitingAudioStart || !emage.isPlaying()) {
        emage.releaseMotionForAudio(APP_CONFIG.emage.motion.fadeInDuration);
      }
    } else if (isInitial) {
      emage.play();
    }
  }

  setOnEnd(cb: () => void) { this.onEnd = cb; }

  isActive(): boolean {
    return !this.stopped && (this.ctx !== null);
  }

  tick(vrm: VRM, _player: VRMAMotionPlayer): void {
    if (!this.ctx || this.stopped) return;

    if (this.audioBuffer && !this.audioDone && this.analyser && this.analyserBuf && !this.lipsyncDisabled) {
      this.analyser.getByteTimeDomainData(this.analyserBuf as any);
      let sum = 0;
      for (let i = 0; i < this.analyserBuf.length; i++) {
        const v = (this.analyserBuf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.analyserBuf.length);
      const mouth = Math.min(1, rms * 4);
      if (vrm.expressionManager) vrm.expressionManager.setValue('aa', mouth);
    } else if ((this.audioDone || this.lipsyncDisabled) && vrm.expressionManager) {
      vrm.expressionManager.setValue('aa', 0);
    }

    if (this.speaking && this.audioDone) {
      const emagePlaying = this.emage?.isPlaying() ?? false;
      const vrmaPlaying = this.player?.isPlaying() ?? false;
      const timeoutReached = this.audioDoneTime > 0 && (performance.now() - this.audioDoneTime > 1500);

      if ((!emagePlaying && !vrmaPlaying) || timeoutReached) {
        this.stop();
        this.onEnd?.();
      }
    }
  }

  private emitHostClockStart(): void {
    const fn = this.hostClockStart;
    this.hostClockStart = null;
    fn?.();
  }

  /**
   * 改当前宿主音频的倍速或音量。没在 speakAudio 里时先记下, 下一次开口用。
   * 正在播时改倍速会重算时钟原点, 播放头不跳。
   */
  setTransport(opts: { playbackRate?: number; volume?: number }): void {
    const rate = clampPlaybackRate(opts.playbackRate);
    const volume = clampVolume(opts.volume);
    if (rate !== undefined) this.playbackRate = rate;
    if (volume !== undefined) this.volume = volume;
    if (!this.followTransport) return;
    if (this.currentGain) this.currentGain.gain.value = this.clockAudible ? this.volume : 0;
    if (!this.ctx || !this.currentSource) return;
    const now = this.ctx.currentTime;
    const oldRate = this.currentSource.playbackRate.value || 1;
    this.clockOriginContent += (now - this.clockOriginCtx) * oldRate;
    this.clockOriginCtx = now;
    this.currentSource.playbackRate.value = this.playbackRate;
  }

  stop(): void {
    this.followTransport = false;
    this.hostClockStart = null;
    this.speakSession++; // 让进行中的 speakAudio 会话失效 (即使之后 stopped 被新请求复位)
    this.wakeSpeakAudio?.();
    if (this.stopped && !this.ctx) return;
    this.stopped = true;
    this.pipeline?.resetChatMotion();
    this.speaking = false;
    this.audioDoneTime = 0;
    this.onResumeRendering?.();
    if (this.stopPlaySegment) {
      this.stopPlaySegment();
      this.stopPlaySegment = null;
    }
    if (this.currentVRM) {
      if (this.currentVRM.expressionManager) {
        this.currentVRM.expressionManager.setValue('aa', 0);
        this.currentVRM.expressionManager.setValue('ou', 0);
      }
    }
    try { this.currentSource?.stop(); } catch { }
    this.currentSource = null;
    this.audioBuffer = null;
    this.plan = null;
    this.audioDone = true;
    document.body.classList.remove('chat-playing');
    this.emage?.clearExternalClock();
    this.emage?.stop();
    this.player?.stop();
    this.lipsyncDisabled = false;
  }
}