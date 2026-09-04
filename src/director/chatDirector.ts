/**
 * chatDirector — 全本地说话链路:
 *   1. POST /director/plan        → {speech}
 *   2. POST /director/synthesize  → wav (Audio8 / MiniMax)
 *   3. EMAGE 用这段音频生成全身手势
 *   4. 起播 audio + EMAGE; RMS → 口型
 * 思考阶段仍用 thinking.vrma。
 */

import type * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { makeClipSeamless } from '@/motion/vrmaRetarget';
import type { VRMAMotionPlayer } from '@/motion/vrmaPlayer';
import { pcmFromAudioBuffer, type EmagePlayer, type EmageMotionData } from '@/motion/emagePlayer';
import { generateSpeechReply } from '@/llm/webLLM';
import { rememberTurn } from '@/memory';
import type { MotionTransitionManager } from '@/motion/motionTransition';

interface Plan { speech: string; llm_provider?: string }

/**
 * 智能分句与切段器 (Smart Speech Chunk Slicer)
 * 目标:
 * 1. 首句追求极致低延迟响应 (约 15~28 个字，遇标点即切)，让用户在 1 秒以内听到数字人开口！
 * 2. 后续段追求自然的语义完整度与抑扬顿挫 (约 30~60 个字，在句号、感叹号、问号或换行处切)。
 * 3. 绝不在词语中硬切，严格在标点处分段；若长句超过 65 字无句号，则在逗号处切分。
 */
export function splitIntoSpeechChunks(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];

  // 如果总字数较少 (<= 35 字)，无需分段，单段直接开播体验最佳
  if (clean.length <= 35) {
    return [clean];
  }

  const chunks: string[] = [];
  let remaining = clean;

  // 标点匹配：包括中英文句号、问号、感叹号、换行符（英文点号要求后面跟空格或结尾，避免小数 3.14 断开）
  const sentenceDelims = /(?:[。！？!?\n]|\.(?:\s+|$))/g;
  const commaDelims = /(?:[，,；;]|,(?:\s+|$)|;(?:\s+|$))/g;

  // 1. 首句截取：目标长度 15~28 字以求毫秒级开口响应
  let firstEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = sentenceDelims.exec(remaining)) !== null) {
    const endIdx = match.index + match[0].length;
    if (endIdx >= 10) {
      firstEnd = endIdx;
      break;
    }
  }

  // 若第一个句号太远 (> 30 字) 或未找到，但在 12~28 字之间有逗号/分号，则首句在逗号处断句以求极速响应
  if (firstEnd === -1 || firstEnd > 30) {
    commaDelims.lastIndex = 0;
    while ((match = commaDelims.exec(remaining)) !== null) {
      const endIdx = match.index + match[0].length;
      if (endIdx >= 12 && endIdx <= 28) {
        firstEnd = endIdx;
        break;
      }
    }
  }

  // 若仍未找到合适标点，且首部 > 32 字，在 15~28 字间找任意空格或标点
  if (firstEnd === -1) {
    if (remaining.length > 32) {
      const anySpaceOrPunct = /[，,；;。！？!?\s]/g;
      let candidate = -1;
      while ((match = anySpaceOrPunct.exec(remaining)) !== null) {
        if (match.index >= 12 && match.index <= 28) {
          candidate = match.index + match[0].length;
        }
      }
      firstEnd = candidate > 0 ? candidate : 25;
    } else {
      firstEnd = remaining.length;
    }
  }

  const firstChunk = remaining.slice(0, firstEnd).trim();
  if (firstChunk) chunks.push(firstChunk);
  remaining = remaining.slice(firstEnd).trim();

  // 2. 后续段落截取：每段目标 30~60 字
  while (remaining.length > 0) {
    if (remaining.length <= 50) {
      chunks.push(remaining);
      break;
    }

    let cutIdx = -1;
    sentenceDelims.lastIndex = 0;
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

    // 若无任何标点，尽量在空格处切断，避免在英文单词中间截断
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

/**
 * 裁剪 AudioBuffer 末尾死寂静音 (保留 minKeepSec 自然缓冲)
 */
function trimAudioBufferTrailingSilence(ctx: AudioContext, buf: AudioBuffer, threshold = 0.005, minKeepSec = 0.25): AudioBuffer {
  const data = buf.getChannelData(0);
  let lastActive = data.length - 1;
  while (lastActive > 0 && Math.abs(data[lastActive]!) < threshold) {
    lastActive--;
  }
  const pad = Math.floor(buf.sampleRate * minKeepSec);
  const endSample = Math.min(data.length, lastActive + pad);
  if (endSample >= data.length - 16 || endSample <= pad) return buf;

  const trimmed = ctx.createBuffer(buf.numberOfChannels, endSample, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    trimmed.getChannelData(ch).set(buf.getChannelData(ch).subarray(0, endSample));
  }
  return trimmed;
}

/**
 * 喂给 Edge-TTS 前先把表情符号剥掉。
 * ponytail: emoji 会被 Edge-TTS 解读成 prosody hint,触发"羞涩微笑/愉悦"等情绪变调。
 */
function stripForTTS(s: string): string {
  return s
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 专一专属语音合成 — 微软 Edge-TTS (小蠢 · 元气少女 +10Hz,跨语种恒定)
 */
async function synthesizeSentenceAudio(
  text: string,
  ctx: AudioContext,
): Promise<AudioBuffer> {
  const ttsText = stripForTTS(text);
  // ponytail: emoji-only 输入剥完为空,跳过合成返回静音 buffer,避免 400。
  if (!ttsText) {
    return ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
  }

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: ttsText,
        voice: 'zh-CN-XiaoyiNeural',
        pitch: '+10Hz',
      }),
    });

    if (!res.ok) {
      throw new Error(`语音合成服务异常: HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength < 64) {
      throw new Error(`语音合成数据无效或为空 (byteLength: ${arrayBuffer?.byteLength ?? 0})`);
    }

    const rawDecoded = await ctx.decodeAudioData(arrayBuffer);
    return trimAudioBufferTrailingSilence(ctx, rawDecoded);
  } catch (err) {
    console.warn('[ChatDirector] 语音合成或解码失败，启动平稳降级轨道:', err);
    // 降级轨道：按字数预估朗读时长生成轻柔静音轨道，驱动 EMAGE 动作与字幕正常播放，绝不崩溃中断
    const fallbackDuration = Math.max(1.5, Math.min(8, ttsText.length * 0.2));
    return ctx.createBuffer(1, Math.floor(ctx.sampleRate * fallbackDuration), ctx.sampleRate);
  }
}

interface PipelineSliceRow {
  '#': number;
  'Text Preview': string;
  'Chars': number;
  'TTS': string;
  'EMAGE': string;
  'Playback': string;
  'Transition Mode': string;
}

/**
 * 流式分段管线表格跟踪器 (Pipeline Table Tracker)
 * 实时以 console.table 输出与刷新各切片的 TTS 合成、EMAGE 推理和播放进度
 */
class PipelineTableTracker {
  private rows: PipelineSliceRow[] = [];

  constructor(chunks: string[]) {
    this.rows = chunks.map((c, i) => ({
      '#': i,
      'Text Preview': c.length > 20 ? c.slice(0, 20) + '…' : c,
      'Chars': c.length,
      'TTS': '⚡ 并发合成中…',
      'EMAGE': '⏳ 等待中',
      'Playback': '⏸️ 待播放',
      'Transition Mode': i === 0 ? '首段起播' : '物理角速度自收敛',
    }));
    if (typeof window !== 'undefined') {
      (window as any).__pipelineTable = this.rows;
    }
    this.print('⚡ 智能分段流式管线初始化');
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
      console.log(`📊 [ChatDirector] 智能分段流式管线状态表 (${stageInfo})`);
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
  private audioDone = false;          // 语音是否已结束 (与 VRMA 独立)
  private audioDoneTime = 0;

  private plan: Plan | null = null;
  public speaking = false;
  private stopped = false;
  private onEnd: (() => void) | null = null;
  private player: VRMAMotionPlayer | null = null;
  private emage: EmagePlayer | null = null;
  private currentVRM: VRM | null = null;
  private transition: MotionTransitionManager | null = null;
  private stopPlaySegment: (() => void) | null = null;

  bindTransitionManager(tm: MotionTransitionManager): void {
    this.transition = tm;
  }

  /** ponytail: 由 vrmEngine.translateSync 注入,LLM 空输出兜底走 i18n。 */
  public translateSync: ((key: string, vars?: Record<string, unknown>) => string) | null = null;

  /** 由 vrmEngine.bindSystemPrompt 注入,根据当前 i18n 语言挑对应 system prompt。 */
  public getSystemPrompt: (() => string) | null = null;

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

  /** VRM 就绪后就把 thinking.vrma 解析成 clip,发送时不再卡主线程。 */
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

  // 播放思考等待姿态 (静默等待，不再展示与播报"让我想一下喔")
  private async playThinking(vrm: VRM, player: VRMAMotionPlayer): Promise<void> {
    document.body.classList.add('chat-playing');
    this.isThinking = true;
    this.currentVRM = vrm;

    // 起播 3D 思考动作文件 (thinking.vrma 无缝循环播放)
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
        // 全局动作平滑过渡：从当前自然待机 (Natural Idle) 毫秒级快照平滑过渡到思考
        this.transition?.startTransition(vrm, 0.65);
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
    this.currentVRM = vrm;

    await this.playThinking(vrm, player);

    // 先让手机键盘收完再抢 GPU,否则收键盘动画会和推理卡在一起。
    await new Promise((r) => setTimeout(r, 280));
    if (this.stopped) return;

    let speechText = '';
    try {
      // ponytail: webLLM 内部已用 onMilestone 转发 i18n key;worker 高频进度不进 bubble,避免刷屏。
      // 系统 prompt 走当前 i18n 语言,实现"用户用什么语言问,就用什么语言答"。
      speechText = await generateSpeechReply(
        text,
        (key, vars) => status(key, vars),
        this.getSystemPrompt?.() ?? '',
      );
    } catch (e: any) {
      status('error.llm', { message: e?.message ?? String(e) }, true);
      this.stop();
      return;
    }
    if (this.stopped || !speechText.trim()) {
      // ponytail: LLM 空输出时塞 i18n greeting,不再硬编码中文。
      speechText = this.translateSync?.('bubble.greeting') ?? '';
      if (!speechText.trim()) return;
    }
    this.plan = { speech: speechText.trim(), llm_provider: 'WebLLM (q4f16_1)' };
    console.log('[ChatDirector] speech:', this.plan.speech, 'llm:', this.plan.llm_provider);
    void rememberTurn(text, this.plan.speech);

    this.ctx = this.ctx ?? new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    // 智能分句与切段 (首句追求毫秒级开口，后续段追求完整抑扬顿挫)
    const chunks = splitIntoSpeechChunks(this.plan.speech);
    const tracker = new PipelineTableTracker(chunks);

    emage.resetSeed();
    emage.loop = false;
    emage.playAudio = false;
    emage.holdLastFrame = false;

    // ── 全量并发启动 TTS 语音合成 (纯 I/O 无自回归依赖，全部段落并行拉取，彻底消除 TTS 瓶颈) ──
    const ttsAudioPromises = chunks.map(async (cText, i) => {
      try {
        const aBuf = await synthesizeSentenceAudio(cText, this.ctx!);
        tracker.update(i, { 'TTS': `✅ 就绪 (${aBuf.duration.toFixed(1)}s)` }, `切片 #${i} TTS 语音合成就绪`);
        return aBuf;
      } catch (err) {
        tracker.update(i, { 'TTS': '❌ 合成失败' }, `切片 #${i} TTS 语音合成失败`);
        throw err;
      }
    });

    // ── 步骤 1: 首段 (Chunk 0) 音频就绪后立即触发 EMAGE 推理 ──
    status('tts', undefined, false, chunks[0]);
    const buf0 = await ttsAudioPromises[0];
    if (this.stopped) return;
    tracker.update(0, { 'EMAGE': '⚙️ 推理中…' }, '切片 #0 EMAGE 动作推理启动');

    status('emage', { seconds: buf0.duration.toFixed(1) }, false, chunks[0]);
    const pcm0 = pcmFromAudioBuffer(buf0);
    let motion0: EmageMotionData;
    try {
      motion0 = await emage.generate(pcm0, () => undefined, false, false);
    } catch (err) {
      this.stop();
      throw err;
    }
    if (this.stopped) return;
    tracker.update(0, { 'EMAGE': `✅ 就绪 (${motion0.frameCount}帧)` }, '切片 #0 EMAGE 动作推理就绪');

    // ── 步骤 2: 准备后台生产者预取队列 (Ready Queue) ──
    interface SpeechSegment {
      index: number;
      text: string;
      audioBuffer: AudioBuffer;
      motion: EmageMotionData;
    }

    const readyQueue: SpeechSegment[] = [];
    let producerFinished = false;
    const notifyReady: (() => void)[] = [];

    const wakeConsumer = () => {
      while (notifyReady.length > 0) {
        const cb = notifyReady.shift();
        cb?.();
      }
    };

    // 启动后台异步生产者：并行顺序生成后续段落动作 (仅 EMAGE 自回归跨段种子继承)
    const producerPromise = (async () => {
      for (let i = 1; i < chunks.length; i++) {
        if (this.stopped) break;
        try {
          const cText = chunks[i]!;
          // 直接取并发已在后台下载完成的 TTS 音频 (0ms 网络等待！)
          const aBuf = await ttsAudioPromises[i]!;
          if (this.stopped) break;

          tracker.update(i, { 'EMAGE': '⚙️ 推理中…' }, `切片 #${i} EMAGE 动作推理启动`);
          const pcm = pcmFromAudioBuffer(aBuf);
          const mot = await emage.generate(pcm, () => undefined, false, true); // continueFromPrevious = true!
          if (this.stopped) break;
          tracker.update(i, { 'EMAGE': `✅ 就绪 (${mot.frameCount}帧)` }, `切片 #${i} EMAGE 动作推理就绪`);

          readyQueue.push({ index: i, text: cText, audioBuffer: aBuf, motion: mot });
          wakeConsumer();
        } catch (e) {
          console.warn(`[ChatDirector] 后台预生成第 ${i} 段异常:`, e);
          tracker.update(i, { 'EMAGE': '❌ 异常中断' }, `切片 #${i} 异常中断`);
          producerFinished = true;
          wakeConsumer();
          break;
        }
      }
      producerFinished = true;
      wakeConsumer();
    })();

    // ── 步骤 3: 消费者播放循环 ──
    this.audioBuffer = buf0;
    status('speaking', undefined, false, chunks[0], 1, chunks.length);
    tracker.update(0, { 'Playback': '▶️ 播放中' });
    emage.applyMotionData(motion0, 0.60);

    const playSegmentAudio = (buf: AudioBuffer, isInitial: boolean): Promise<void> => {
      return new Promise<void>((resolve) => {
        if (this.stopped) {
          resolve();
          return;
        }
        this.stopPlaySegment = () => resolve();
        this.playAudioSource(buf, () => {
          this.stopPlaySegment = null;
          resolve();
        }, emage, player, isInitial);
      });
    };

    await playSegmentAudio(buf0, true);
    tracker.update(0, { 'Playback': '🏁 播放完成' });

    // 连续消费后续段落
    for (let i = 1; i < chunks.length; i++) {
      if (this.stopped) break;

      // 等待第 i 段进入 readyQueue
      while (readyQueue.length === 0 && !producerFinished && !this.stopped) {
        await new Promise<void>((resolve) => notifyReady.push(resolve));
      }
      if (this.stopped) break;

      const seg = readyQueue.shift();
      if (!seg) break;

      // 标点呼吸微停顿 (220ms，人类生理换气停顿，消除接缝爆音且给动作留足惯性减速期)
      await new Promise((r) => setTimeout(r, 220));
      if (this.stopped) break;

      this.audioBuffer = seg.audioBuffer;
      status('speaking', undefined, false, seg.text, i + 1, chunks.length);
      tracker.update(i, { 'Playback': '▶️ 播放中' });
      // 完全不依赖固定时间，由生理角速度上限在物理空间自收敛平滑切入
      emage.switchSegment(seg.motion);

      await playSegmentAudio(seg.audioBuffer, false);
      tracker.update(i, { 'Playback': '🏁 播放完成' });
    }

    if (this.stopped) return;

    // 全部段落播放完毕
    this.audioDone = true;
    this.audioDoneTime = performance.now();
    emage.clearExternalClock();
    if (!emage.isPlaying() || emage.getProgress() >= 0.8) {
      emage.fadeOutToIdle(0.6);
    }

    await producerPromise.catch(() => {});
  }

  /**
   * 统一音频源播放与 LipSync/Analyser 连接调度
   */
  private playAudioSource(
    buf: AudioBuffer,
    onEnded: () => void,
    emage: EmagePlayer,
    player: VRMAMotionPlayer | null,
    isInitial = true,
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

    // 全局动作平滑过渡：仅首段从思考姿态 (托腮/倾头) 平滑切入 EMAGE 说话全身手势
    if (isInitial && this.currentVRM) {
      this.transition?.startTransition(this.currentVRM, 0.55);
    }

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

    const startAudioTime = this.ctx.currentTime;
    emage.setExternalClock(() => {
      if (!this.ctx || this.stopped || this.audioDone) return -1;
      return Math.max(0, this.ctx.currentTime - startAudioTime);
    });
    if (isInitial) {
      emage.play();
      player?.stop();
    }

    src.onended = () => {
      if (this.currentSource === src) {
        this.currentSource = null;
        onEnded();
      }
    };
    src.start(0);
  }

  setOnEnd(cb: () => void) { this.onEnd = cb; }

  // ponytail: 外部判断"现在是否有 chat 在播",给 main.ts 的 idle 接管用
  isActive(): boolean {
    return !this.stopped && (this.ctx !== null);
  }

  tick(vrm: VRM, _player: VRMAMotionPlayer): void {
    if (!this.ctx || this.stopped) return;

    // 1) 口型驱动 (音频 RMS → aa)
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

    // 2) 动作完整播放检查：音频播完 且 手势动作（EMAGE/VRMA）已彻底演完收势归位后，才正式结束说话态
    if (this.speaking && this.audioDone) {
      const emagePlaying = this.emage?.isPlaying() ?? false;
      const vrmaPlaying = this.player?.isPlaying() ?? false;
      // 超时保护设置为 1.5 秒 (足够 0.6s 动作平滑淡出收势，绝不在角色面前多卡停滞或循环)
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
    if (this.stopPlaySegment) {
      this.stopPlaySegment();
      this.stopPlaySegment = null;
    }
    if (this.currentVRM) {
      this.transition?.startTransition(this.currentVRM, 0.65);
      if (this.currentVRM.expressionManager) {
        this.currentVRM.expressionManager.setValue('aa', 0);
        this.currentVRM.expressionManager.setValue('ou', 0);
      }
    }
    try { this.currentSource?.stop(); } catch {}
    this.currentSource = null;
    this.audioBuffer = null;
    this.plan = null;
    this.audioDone = true;
    document.body.classList.remove('chat-playing');
    this.emage?.clearExternalClock();
    this.emage?.fadeOutToIdle(0.85);
    this.player?.fadeOutToIdle(0.85);
  }
}