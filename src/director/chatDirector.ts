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
import type { VRMAMotionPlayer } from '@/motion/vrmaPlayer';
import { type EmagePlayer, type EmageMotionData } from '@/motion/emagePlayer';
import { generateSpeechReply } from '@/llm/chatWorkflow';
import { MPEGDecoder } from 'mpg123-decoder';
import { rememberTurn } from '@/memory';
import type { MotionTransitionManager } from '@/motion/motionTransition';
import type { Lang } from '@/i18n';
import { APP_CONFIG } from '@/config';

interface Plan { speech: string; llm_provider?: string }

/**
 * 智能分句与切段器 (Smart Speech Chunk Slicer)
 * 目标:
 * 1. 统一各段语义完整度与抑扬顿挫 (约 30~60 个字，在句号、感叹号、问号或换行处自然切分)[cite: 13]。
 * 2. 绝不在词语中硬切，严格在标点处分段；若长句超过 65 字无句号，则在逗号、分号处切分换气[cite: 13]。
 */
export function splitIntoSpeechChunks(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];

  if (clean.length <= 45) {
    return [clean];
  }

  const chunks: string[] = [];
  let remaining = clean;

  const sentenceDelims = /(?:[。！？!?\n]|\.(?:\s+|$))/g;
  const commaDelims = /(?:[，,；;]|,(?:\s+|$)|;(?:\s+|$))/g;

  while (remaining.length > 0) {
    if (remaining.length <= 55) {
      chunks.push(remaining);
      break;
    }

    let cutIdx = -1;
    sentenceDelims.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = sentenceDelims.exec(remaining)) !== null) {
      const idx = match.index + match[0].length;
      if (idx >= 25 && idx <= 65) {
        cutIdx = idx;
        break;
      }
      if (idx > 65) {
        break;
      }
    }

    if (cutIdx === -1) {
      commaDelims.lastIndex = 0;
      while ((match = commaDelims.exec(remaining)) !== null) {
        const idx = match.index + match[0].length;
        if (idx >= 25 && idx <= 60) {
          cutIdx = idx;
        }
      }
    }

    if (cutIdx === -1) {
      sentenceDelims.lastIndex = 0;
      if ((match = sentenceDelims.exec(remaining)) !== null) {
        const idx = match.index + match[0].length;
        if (idx >= 15 && idx <= 75) {
          cutIdx = idx;
        }
      }
    }

    if (cutIdx === -1) {
      const target = Math.min(50, remaining.length);
      const lastSpace = remaining.lastIndexOf(' ', target);
      if (lastSpace > 20) {
        cutIdx = lastSpace + 1;
      } else {
        cutIdx = target;
      }
    }

    const chunk = remaining.slice(0, cutIdx).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(cutIdx).trim();
  }

  return chunks;
}

function stripForTTS(s: string): string {
  return s
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  public isThinking = false;
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
  public transition: MotionTransitionManager | null = null;
  private stopPlaySegment: (() => void) | null = null;

  bindTransitionManager(tm: MotionTransitionManager): void {
    this.transition = tm;
  }

  public translateSync: ((key: string, vars?: Record<string, unknown>) => string) | null = null;
  public getSystemPrompt: (() => string) | null = null;
  public getSystemContext: (() => Promise<{ prompt: string; lang: Lang }>) | null = null;

  public onSuspendRendering: (() => void) | null = null;
  public onResumeRendering: (() => void) | null = null;
  public onInferenceStart: (() => void) | null = null;
  public onInferenceEnd: (() => void) | null = null;

  private thinkingVRMABuf: ArrayBuffer | null = null;
  private cachedThinkingClip: THREE.AnimationClip | null = null;

  resetClipCache(): void {
    this.cachedThinkingClip = null;
  }

  async preloadThinking(): Promise<void> {
    try {
      const vrmaRes = await fetch('/thinking.vrma');
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
    this.isThinking = true;
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
        player.playLoop(this.cachedThinkingClip, vrm, 0.65);
      } catch (e) {
        console.warn('播放 thinking.vrma 动作失败', e);
      }
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

    this.onInferenceStart?.();
    await new Promise((r) => requestAnimationFrame(r));
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
    } finally {
      this.onInferenceEnd?.();
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
    player: VRMAMotionPlayer | null,
    isInitial = true,
    audioTimelineOffsetSec = 0,
  ): void {
    if (!this.ctx || this.stopped) {
      onEnded();
      return;
    }

    this.isThinking = false;
    this.speaking = true;
    this.audioDone = false;
    this.audioDoneTime = 0;
    document.body.classList.add('chat-playing');

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyserBuf = new Uint8Array(this.analyser.fftSize);
    this.currentGain = this.ctx.createGain();
    this.currentGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.currentGain);
    this.currentSource = src;

    // P0a-AV: 连续流 playhead 用累计 TTS 时间，跨段不回跳；
    // clock 原点与 src.start(when) 对齐，避免 motion 早于可听 PCM。
    const when = this.ctx.currentTime;
    emage.setExternalClock(() => {
      if (!this.ctx || this.stopped || this.audioDone) return -1;
      return Math.max(0, audioTimelineOffsetSec + (this.ctx.currentTime - when));
    });

    console.log('[P0a-AV] audio_start', {
      isInitial,
      bufDuration: buf.duration,
      audioTimelineOffsetSec,
      streamingMotionActive: emage.streamingMotionActive,
      awaitingAudioStart: emage.awaitingAudioStart,
      when,
    });

    if (isInitial) {
      player?.stop();
    }

    src.onended = () => {
      if (this.currentSource === src) {
        this.currentSource = null;
        onEnded();
      }
    };
    // 先 start 可听 TTS，再释放可见动作（满足 motion 不早于 speech）
    src.start(when);
    console.log('[P0a-AV] AudioBufferSourceNode.start', {
      when,
      ctxTime: this.ctx.currentTime,
      audioTimelineOffsetSec,
    });

    // P0a-AV: audio 已 start 后释放；已在播的后续段不重置 playhead
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

    if (this.audioBuffer && !this.audioDone && this.analyser && this.analyserBuf) {
      this.analyser.getByteTimeDomainData(this.analyserBuf as any);
      let sum = 0;
      for (let i = 0; i < this.analyserBuf.length; i++) {
        const v = (this.analyserBuf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.analyserBuf.length);
      const mouth = Math.min(1, rms * 4);
      if (vrm.expressionManager) vrm.expressionManager.setValue('aa', mouth);
    } else if (this.audioDone && vrm.expressionManager) {
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

  stop(): void {
    if (this.stopped && !this.ctx) return;
    this.stopped = true;
    this.isThinking = false;
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
  }
}