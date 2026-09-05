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
 * 1. 统一各段语义完整度与抑扬顿挫 (约 30~60 个字，在句号、感叹号、问号或换行处自然切分)。
 * 2. 绝不在词语中硬切，严格在标点处分段；若长句超过 65 字无句号，则在逗号、分号处切分换气。
 */
export function splitIntoSpeechChunks(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];

  // 如果总字数较少 (<= 45 字)，无需分段，单段直接开播体验最佳
  if (clean.length <= 45) {
    return [clean];
  }

  const chunks: string[] = [];
  let remaining = clean;

  // 标点匹配：包括中英文句号、问号、感叹号、换行符（英文点号要求后面跟空格或结尾，避免小数 3.14 断开）
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

    // 1. 优先在 25 ~ 65 字之间的句末标点处断句
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

    // 2. 若未在 25~65 字找到句末标点，但在 25~60 字之间有逗号/分号，则在逗号处切分换气
    if (cutIdx === -1) {
      commaDelims.lastIndex = 0;
      while ((match = commaDelims.exec(remaining)) !== null) {
        const idx = match.index + match[0].length;
        if (idx >= 25 && idx <= 60) {
          cutIdx = idx;
        }
      }
    }

    // 3. 若仍未找到合适标点，但在 15~75 字内有任意句末标点，顺畅断开
    if (cutIdx === -1) {
      sentenceDelims.lastIndex = 0;
      if ((match = sentenceDelims.exec(remaining)) !== null) {
        const idx = match.index + match[0].length;
        if (idx >= 15 && idx <= 75) {
          cutIdx = idx;
        }
      }
    }

    // 4. 若无任何标点，尽量在空格处切断，避免在英文单词中间截断
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

  /** 移动端推理期间挂起 3D WebGL 渲染，消除与 WebGPU 的资源争抢 */
  public onSuspendRendering: (() => void) | null = null;
  public onResumeRendering: (() => void) | null = null;

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
        // 起播思考循环动作，动作平滑过渡由 vrmEngine 统一调度
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
    this.isThinking = true;

    await this.playThinking(vrm, player);

    // 先让手机键盘收完再抢 GPU,否则收键盘动画会和推理卡在一起。
    await new Promise((r) => setTimeout(r, 280));
    if (this.stopped) return;

    // 手机端让出 100% GPU 给 WebGPU 推理，防止 WebGL 60FPS 与 WebLLM 争抢触发 Android Vulkan TDR 驱动重置 (mapAsync 崩溃)
    const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if (isMobile) {
      this.onSuspendRendering?.();
    }

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
      // ponytail: 1) console 必打,方便手机 chrome 用户从 DevTools 复制原文反馈;
      //          2) message 为空时硬编码英文兜底("Unknown error"),避免出现
      //             "Local LLM error: "秃尾巴 + 不依赖未定义的 i18n key;
      //          3) HeadBubble 渲染时硬加 "bubble." 前缀 → 传 "error.llm" 实际查
      //             "bubble.error.llm",所以 i18n 里要定义在 bubble.error.llm 而非 error.llm。
      console.error('[ChatDirector] LLM failed:', e);
      const rawMsg = (e?.message ?? String(e) ?? '').trim();
      status('error.llm', { message: rawMsg || 'Unknown error' }, true);
      this.stop();
      return;
    } finally {
      if (isMobile) {
        this.onResumeRendering?.();
      }
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

    // ── 准备后台生产者预取队列 (Ready Queue) ──
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

    // 启动后台异步生产者：顺序生成所有切片的 EMAGE 动作 (自回归跨段连续继承种子)
    const producerPromise = (async () => {
      for (let i = 0; i < chunks.length; i++) {
        if (this.stopped) break;
        try {
          const cText = chunks[i]!;
          if (readyQueue.length === 0 && i === 0) {
            status('tts', undefined, false);
          }

          // 取并发已就绪的 TTS 音频 (0ms 网络等待)
          const aBuf = await ttsAudioPromises[i]!;
          if (this.stopped) break;

          tracker.update(i, { 'EMAGE': '⚙️ 推理中…' }, `切片 #${i} EMAGE 动作推理启动`);
          if (readyQueue.length === 0 && i === 0) {
            status('emage', { seconds: aBuf.duration.toFixed(1) }, false);
          }

          const pcm = pcmFromAudioBuffer(aBuf);
          const mot = await emage.generate(pcm, () => undefined, false, i > 0);
          if (this.stopped) break;

          tracker.update(i, { 'EMAGE': `✅ 就绪 (${mot.frameCount}帧)` }, `切片 #${i} EMAGE 动作推理就绪`);
          readyQueue.push({ index: i, text: cText, audioBuffer: aBuf, motion: mot });
          wakeConsumer();
        } catch (e) {
          console.warn(`[ChatDirector] 生产第 ${i} 段动作异常:`, e);
          tracker.update(i, { 'EMAGE': '❌ 异常中断' }, `切片 #${i} 异常中断`);
          producerFinished = true;
          wakeConsumer();
          break;
        }
      }
      producerFinished = true;
      wakeConsumer();
    })();

    // ── 双条件预缓冲等待起播 ──
    // 条件 1: 比例原则 — 约 1/3 切片数 Math.ceil(chunks.length / 3)
    // 条件 2: 上下限约束 — 最多预缓冲 2 段 (2段音频时长通常 8~12s，足够后台产生后续段，防止段数很多时初始久等)
    const targetPreload = chunks.length <= 1
      ? 1
      : Math.min(chunks.length, Math.min(2, Math.max(1, Math.ceil(chunks.length / 3))));

    console.log(`[ChatDirector] 智能分段: 共 ${chunks.length} 段, 双条件预缓冲目标: ${targetPreload} 段`);

    // 等待预缓冲切片达到 targetPreload，或者生产者已提前全部完成
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
        this.playAudioSource(buf, () => {
          this.stopPlaySegment = null;
          resolve();
        }, emage, player, isInitial);
      });
    };

    // ── 消费者播放循环 ──
    for (let i = 0; i < chunks.length; i++) {
      if (this.stopped) break;

      // 如果待播切片尚未就绪，立即切入 SpeakIdle 言谈间歇微动待机 (胸腔呼吸、手臂微浮沉、头部微动)
      if (readyQueue.length === 0 && !producerFinished && !this.stopped) {
        emage.clearExternalClock();
        emage.enterSpeakIdle();
        tracker.update(i, { 'Playback': '☕ 等待推理 (言谈微动待机)' }, `等待切片 #${i} 就绪`);
        while (readyQueue.length === 0 && !producerFinished && !this.stopped) {
          await new Promise<void>((resolve) => notifyReady.push(resolve));
        }
        emage.exitSpeakIdle();
      }
      if (this.stopped) break;

      const seg = readyQueue.shift();
      if (!seg) break;

      if (i > 0) {
        // 标点呼吸微停顿 (220ms，人类生理换气停顿，消除接缝爆音且给动作留足惯性减速期)
        await new Promise((r) => setTimeout(r, 220));
        if (this.stopped) break;
      }

      this.audioBuffer = seg.audioBuffer;
      status('speaking', undefined, false, seg.text, i + 1, chunks.length);
      tracker.update(i, { 'Playback': '▶️ 播放中' });

      if (i === 0) {
        emage.applyMotionData(seg.motion, 0.60);
        await playSegmentAudio(seg.audioBuffer, true);
      } else {
        // 段落间由 emagePlayer.switchSegment 在内部以生理角速度上限与惯性阻尼自适应连续收敛
        emage.switchSegment(seg.motion);
        await playSegmentAudio(seg.audioBuffer, false);
      }
      tracker.update(i, { 'Playback': '🏁 播放完成' });
    }

    if (this.stopped) return;

    // 全部段落播放完毕：立即由全局 motionTransition 统一接管 55 根骨骼从当前说话姿态丝滑融入 NaturalIdle
    this.audioDone = true;
    this.audioDoneTime = performance.now();
    emage.clearExternalClock();
    emage.stop();
    this.stop();
    this.onEnd?.();

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

    // 思考到说话动作平滑过渡由 vrmEngine 在活跃播放器状态转换时统一调度

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
    try { this.currentSource?.stop(); } catch {}
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