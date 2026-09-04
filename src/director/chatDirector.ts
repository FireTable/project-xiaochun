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
import { pcmFromAudioBuffer, type EmagePlayer } from '@/motion/emagePlayer';
import { generateSpeechReply } from '@/llm/webLLM';

interface Plan { speech: string; llm_provider?: string }

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
  /** ponytail: 由 vrmEngine.translateSync 注入,LLM 空输出兜底走 i18n。 */
  public translateSync: ((key: string, vars?: Record<string, unknown>) => string) | null = null;

  /** 由 vrmEngine.bindSystemPrompt 注入,根据当前 i18n 语言挑对应 system prompt。 */
  public getSystemPrompt: (() => string) | null = null;

  private thinkingVRMABuf: ArrayBuffer | null = null;
  private cachedThinkingClip: THREE.AnimationClip | null = null;

  resetClipCache(): void {
    this.cachedThinkingClip = null;
  }

  // 预加载 thinking.vrma 思考动作
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

  // 播放思考等待姿态 (静默等待，不再展示与播报"让我想一下喔")
  private async playThinking(vrm: VRM, player: VRMAMotionPlayer): Promise<void> {
    document.body.classList.add('chat-playing');
    this.isThinking = true;

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
        player.playLoop(this.cachedThinkingClip, vrm, 0.65);
      } catch (e) {
        console.warn('播放 thinking.vrma 动作失败', e);
      }
    }
  }

  // ponytail: 主入口
  async say(
    text: string,
    vrm: VRM,
    player: VRMAMotionPlayer,
    emage: EmagePlayer,
    status: (key: string, vars?: Record<string, unknown>, isError?: boolean, speechText?: string) => void,
  ): Promise<void> {
    this.stop();
    this.stopped = false;
    this.audioDone = false;
    this.speaking = false;
    this.player = player;
    this.emage = emage;

    await this.playThinking(vrm, player);

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

    this.ctx = this.ctx ?? new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    // 1. 整体专属 TTS 语音合成 (微软 Edge-TTS 小蠢 +10Hz)
    status('tts', undefined, false, this.plan.speech);
    const buffer = await synthesizeSentenceAudio(this.plan.speech, this.ctx);
    if (this.stopped) return;
    this.audioBuffer = buffer;

    // 2. 整体动作时序生成 (EMAGE Dedicated Web Worker 异步多核推理，绝不阻塞 3D 渲染)
    status(
      'emage',
      { seconds: this.audioBuffer.duration.toFixed(1) },
      false,
      this.plan.speech,
    );
    const pcm = pcmFromAudioBuffer(this.audioBuffer);
    emage.loop = false;
    emage.playAudio = false;
    emage.holdLastFrame = false;
    try {
      // ponytail: emage worker 内部进度太碎,不再喂给 status(避免状态文本刷屏)。
      await emage.generate(pcm, () => undefined, false);
    } catch (err) {
      this.stop();
      throw err;
    }

    if (this.stopped) return;

    // 3. 动作与音频一并就绪后无缝起播 (60 FPS 满帧丝滑驱动)
    status('speaking', undefined, false, this.plan.speech);
    this.playAudioSource(this.audioBuffer, () => {
      this.audioDone = true;
      this.audioDoneTime = performance.now();
      emage.clearExternalClock();
      // 音频已播放完毕，口型即刻停闭；若动作进度已达尾声 (>=80%) 或已停播，立即自然淡出归入待机；绝不循环复读！
      if (!emage.isPlaying() || emage.getProgress() >= 0.8) {
        emage.fadeOutToIdle(0.6);
      }
    }, emage, player);
  }

  /**
   * 统一音频源播放与 LipSync/Analyser 连接调度
   */
  private playAudioSource(
    buf: AudioBuffer,
    onEnded: () => void,
    emage: EmagePlayer,
    player: VRMAMotionPlayer | null
  ): void {
    if (!this.ctx || this.stopped) return;

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

    const startAudioTime = this.ctx.currentTime;
    emage.setExternalClock(() => {
      if (!this.ctx || this.stopped || this.audioDone) return -1;
      return Math.max(0, this.ctx.currentTime - startAudioTime);
    });
    emage.play();
    player?.stop();

    src.onended = () => {
      if (this.currentSource === src) {
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