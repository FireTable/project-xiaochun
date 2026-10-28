import { Player, getContext, start as toneStart } from 'tone';
import type { AudioDirective } from './schema';

export interface StoryAudioDirectorConfig {
  defaultBgmVolume: number;
  duckedBgmRatio: number; // 0.25 即闪避至 25% 音量 (-12dB)
  duckedAmbienceRatio: number;
  duckRampTime: number;    // 闪避过渡秒数
  unduckRampTime: number;  // 恢复过渡秒数
  defaultFadeSec: number;
  defaultAmbienceVolume: number;
}

/** 程序化 BGM 的情绪预设：和弦进行 + 稀疏旋律，全部由 WebAudio 振荡器合成，不依赖任何音频文件 (也就没有版权问题) */
interface MoodSpec {
  /** 每步一个和弦 (MIDI 音高)，循环 */
  chords: number[][];
  /** 每个和弦持续秒数 */
  stepSec: number;
  /** 旋律音阶 (MIDI)，空数组 = 无旋律 */
  melody: number[];
  /** 每 0.5 个 step 触发旋律音的概率 */
  melodyProb: number;
  /** pad 低通截止 */
  lowpass: number;
  /** pad 音量系数 */
  padLevel: number;
}

export const BGM_MOODS: Record<string, MoodSpec> = {
  // 空无：低沉的五度长音，几乎没有起伏
  void_drone: { chords: [[45, 52, 57]], stepSec: 9, melody: [], melodyProb: 0, lowpass: 520, padLevel: 0.9 },
  // 黄昏暖意：Fmaj7 → Am7 → Dm9 → C，五声音阶轻点缀
  dusk_warm: {
    chords: [[53, 57, 60, 64], [57, 60, 64, 67], [50, 57, 60, 64], [48, 55, 60, 64]],
    stepSec: 6, melody: [72, 74, 76, 79, 81], melodyProb: 0.45, lowpass: 1900, padLevel: 0.8,
  },
  // 思念：Am → F → C → G，低而疏
  longing: {
    chords: [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62]],
    stepSec: 7, melody: [69, 72, 74, 76], melodyProb: 0.3, lowpass: 1300, padLevel: 0.85,
  },
  // 点亮：C → G → Am → F，明亮、旋律更密
  lights_on: {
    chords: [[48, 60, 64, 67], [43, 59, 62, 67], [45, 60, 64, 69], [41, 60, 65, 69]],
    stepSec: 4.5, melody: [76, 79, 81, 84, 86], melodyProb: 0.8, lowpass: 3400, padLevel: 0.75,
  },
  // 告别：Dm → Bb → F → C，缓慢、旋律极少
  farewell: {
    chords: [[50, 57, 62, 65], [46, 58, 62, 65], [41, 57, 60, 65], [48, 55, 60, 64]],
    stepSec: 8, melody: [74, 77, 79, 81], melodyProb: 0.25, lowpass: 1500, padLevel: 0.85,
  },
};

/** 故事生成器 (LLM) 提示词里使用的 bgmMood 名 → 程序化预设 */
export const BGM_MOOD_ALIASES: Record<string, string> = {
  gentle_daily: 'dusk_warm',
  cinematic_epic: 'lights_on',
  melancholy_piano: 'longing',
  mysterious_ambient: 'void_drone',
};

export const AMBIENCE_IDS = ['sea_waves', 'wind'] as const;
export const SFX_IDS = ['crystal_chime', 'heartbeat_pulse', 'camera_shutter', 'whoosh', 'bell', 'soft_tap'] as const;

const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** 可复现的伪随机 (mulberry32)，让同一个 mood 每次的旋律走向一致 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 平滑改变一个 AudioParam：从当前值线性过渡到目标 */
function rampParam(param: AudioParam, target: number, seconds: number, ctx: AudioContext): void {
  const now = ctx.currentTime;
  try {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    if (seconds <= 0) param.setValueAtTime(target, now);
    else param.linearRampToValueAtTime(target, now + seconds);
  } catch {
    try {
      param.value = target;
    } catch {
      /* ignore */
    }
  }
}

interface Handle {
  key: string;
  /** 淡出并释放；seconds=0 立即 */
  stop(seconds: number): void;
}

class ProceduralBgm {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextAt = 0;
  private nextMelodyAt = 0;
  private stepIdx = 0;
  private stopped = false;
  private readonly rand: () => number;
  private readonly padFilter: BiquadFilterNode;

  private readonly ctx: AudioContext;
  private readonly out: AudioNode;
  private readonly spec: MoodSpec;

  constructor(ctx: AudioContext, out: AudioNode, spec: MoodSpec, seed: string) {
    this.ctx = ctx;
    this.out = out;
    this.spec = spec;
    this.rand = seededRandom(hashString(seed));
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = spec.lowpass;
    this.padFilter.Q.value = 0.4;
    this.padFilter.connect(out);
  }

  start(): void {
    this.nextAt = this.ctx.currentTime + 0.05;
    this.nextMelodyAt = this.nextAt + this.spec.stepSec * 0.5;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 400);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // 已调度的音符按各自的 release 自然收尾；voice 总增益的淡出负责压住余音
    setTimeout(() => {
      try {
        this.padFilter.disconnect();
      } catch {
        /* ignore */
      }
    }, 6000);
  }

  private schedule(): void {
    if (this.stopped) return;
    const horizon = this.ctx.currentTime + 1.6;
    while (this.nextAt < horizon) {
      const chord = this.spec.chords[this.stepIdx % this.spec.chords.length];
      this.playChord(chord, this.nextAt);
      this.stepIdx++;
      this.nextAt += this.spec.stepSec;
    }
    while (this.spec.melody.length > 0 && this.nextMelodyAt < horizon) {
      if (this.rand() < this.spec.melodyProb) {
        const note = this.spec.melody[Math.floor(this.rand() * this.spec.melody.length)];
        this.playBell(note, this.nextMelodyAt);
      }
      this.nextMelodyAt += this.spec.stepSec * 0.5;
    }
  }

  private playChord(chord: number[], at: number): void {
    const dur = this.spec.stepSec;
    const attack = Math.min(2.0, dur * 0.35);
    const release = Math.min(3.0, dur * 0.5);
    chord.forEach((midi, i) => {
      const gain = this.ctx.createGain();
      const peak = (0.05 * this.spec.padLevel) / Math.sqrt(chord.length);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(peak, at + attack);
      gain.gain.setValueAtTime(peak, at + dur);
      gain.gain.linearRampToValueAtTime(0.0001, at + dur + release);
      gain.connect(this.padFilter);
      const types: OscillatorType[] = ['sine', 'triangle'];
      types.forEach((type, k) => {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = (k === 0 ? -4 : 5) + i * 0.7;
        const g = this.ctx.createGain();
        g.gain.value = k === 0 ? 1 : 0.35;
        osc.connect(g);
        g.connect(gain);
        osc.start(at);
        osc.stop(at + dur + release + 0.1);
      });
    });
  }

  private playBell(midi: number, at: number): void {
    const freq = midiToFreq(midi);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.045, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
    gain.connect(this.out);
    [1, 2.0, 3.01].forEach((mult, k) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      const g = this.ctx.createGain();
      g.gain.value = [1, 0.28, 0.1][k];
      osc.connect(g);
      g.connect(gain);
      osc.start(at);
      osc.stop(at + 2.7);
    });
  }
}

export class StoryAudioDirector {
  private config: StoryAudioDirectorConfig = {
    defaultBgmVolume: 0.35,
    duckedBgmRatio: 0.25,
    duckedAmbienceRatio: 0.6,
    duckRampTime: 0.25,
    unduckRampTime: 0.6,
    defaultFadeSec: 1.5,
    defaultAmbienceVolume: 0.25,
  };

  private isInitialized = false;
  private ctx: AudioContext | null = null;
  // 总线：voices → muffle(lowpass) → bgmLevel → bgmDuck → destination；ambience → ambLevel → ambDuck → destination
  private muffle: BiquadFilterNode | null = null;
  private bgmLevel: GainNode | null = null;
  private bgmDuck: GainNode | null = null;
  private ambLevel: GainNode | null = null;
  private ambDuck: GainNode | null = null;

  private bgm: Handle | null = null;
  private ambience: Handle | null = null;
  private baseBgmVolume = 0.35;
  private isDucked = false;
  private isMuffled = false;
  private bgmGeneration = 0;
  private sfxTimers = new Set<ReturnType<typeof setTimeout>>();
  private noiseBuffer: AudioBuffer | null = null;
  /** 加载失败过的 BGM URL：之后的指令直接用 bgmMood 兜底，不再每拍重试 (避免一拍一个 404) */
  private failedTracks = new Set<string>();

  public init(): void {
    if (this.isInitialized) return;
    if (typeof window === 'undefined') return;

    try {
      const ctx = getContext().rawContext as unknown as AudioContext;
      if (!ctx || typeof ctx.createGain !== 'function') return;
      this.ctx = ctx;

      this.muffle = ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000; // 默认不过滤
      this.bgmLevel = ctx.createGain();
      this.bgmLevel.gain.value = this.baseBgmVolume;
      this.bgmDuck = ctx.createGain();
      this.bgmDuck.gain.value = 1;
      this.muffle.connect(this.bgmLevel);
      this.bgmLevel.connect(this.bgmDuck);
      this.bgmDuck.connect(ctx.destination);

      this.ambLevel = ctx.createGain();
      this.ambLevel.gain.value = this.config.defaultAmbienceVolume;
      this.ambDuck = ctx.createGain();
      this.ambDuck.gain.value = 1;
      this.ambLevel.connect(this.ambDuck);
      this.ambDuck.connect(ctx.destination);

      this.isInitialized = true;
    } catch (e) {
      console.warn('[StoryAudioDirector] init failed, falling back:', e);
    }
  }

  /**
   * 解锁 AudioContext。必须在用户手势 (点击 / 触摸) 的同步调用栈里调用：
   * 浏览器只允许手势内的 resume 成功。引擎在“轻触屏幕唤醒”那一下调用它，之后整个剧情都可以无点击自动推进。
   */
  public unlock(): void {
    if (typeof window === 'undefined') return;
    try {
      void toneStart().catch(() => undefined);
      const ctx = getContext().rawContext as unknown as AudioContext;
      if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        void ctx.resume().catch(() => undefined);
      }
    } catch (e) {
      console.warn('[StoryAudioDirector] unlock failed:', e);
    }
    this.init();
  }

  /** 供测试与调试读取当前状态 */
  public getState(): { bgm: string | null; ambience: string | null; ducked: boolean; muffled: boolean } {
    return {
      bgm: this.bgm?.key ?? null,
      ambience: this.ambience?.key ?? null,
      ducked: this.isDucked,
      muffled: this.isMuffled,
    };
  }

  /**
   * 执行舞台音频指令
   */
  public async executeDirective(directive?: AudioDirective): Promise<void> {
    if (!directive) return;
    this.init();

    const hasMusic = Boolean(directive.bgmTrack || directive.bgmMood);
    const fadeSec = directive.bgmFadeSec;

    // 1. BGM 指令
    switch (directive.bgmAction) {
      case 'stop_cut':
        this.stopBgm(true);
        break;
      case 'fade_out':
        this.stopBgm(false, fadeSec);
        break;
      case 'muffle':
        this.setMuffle(true);
        break;
      case 'duck':
        this.duckBgm();
        break;
      case 'fade_in':
        if (hasMusic) {
          this.setMuffle(false);
          await this.startBgm({ track: directive.bgmTrack, mood: directive.bgmMood, volume: directive.bgmVolume, fadeSec: fadeSec ?? 3 });
        }
        break;
      case 'play':
      default:
        if (hasMusic) {
          this.setMuffle(false);
          await this.startBgm({ track: directive.bgmTrack, mood: directive.bgmMood, volume: directive.bgmVolume, fadeSec });
        }
        break;
    }

    // 2. 环境声
    if (directive.ambience !== undefined) {
      if (directive.ambience === 'none') this.stopAmbience(fadeSec);
      else this.startAmbience(directive.ambience, directive.ambienceVolume);
    }

    // 3. 拟音 SFX
    if (directive.playSfx) {
      this.playSfx(directive.playSfx);
    }
    if (directive.sfx && directive.sfx.length > 0) {
      directive.sfx.forEach((item) => {
        const delayMs = (item.delaySec || 0) * 1000;
        if (delayMs > 0) {
          const timer = setTimeout(() => {
            this.sfxTimers.delete(timer);
            this.playSfx(item.id, item.volume);
          }, delayMs);
          this.sfxTimers.add(timer);
        } else {
          this.playSfx(item.id, item.volume);
        }
      });
    }
  }

  /** 取消尚未触发的延迟音效 (换拍 / 打断 / 剧终时调用，避免音效“串场”) */
  public cancelPendingSfx(): void {
    this.sfxTimers.forEach((t) => clearTimeout(t));
    this.sfxTimers.clear();
  }

  /**
   * 播放 / 切换背景音乐。track 是文件 URL (循环)；加载失败回退到 mood；两者都不可用则静音继续。
   * 相同的 track / mood 再次触发只更新音量，不重启。
   */
  public async startBgm(opts: { track?: string; mood?: string; volume?: number; fadeSec?: number }): Promise<void> {
    this.init();
    if (!this.ctx || !this.muffle) return;

    const volume = opts.volume ?? this.config.defaultBgmVolume;
    const fadeSec = opts.fadeSec ?? this.config.defaultFadeSec;
    const track = opts.track && !this.failedTracks.has(opts.track) ? opts.track : undefined;
    const mood = opts.mood ? BGM_MOOD_ALIASES[opts.mood] ?? opts.mood : undefined;
    const key = track ? `track:${track}` : mood ? `mood:${mood}` : null;
    if (!key) return;

    this.setBgmVolume(volume);
    if (this.bgm?.key === key) return;

    const generation = ++this.bgmGeneration;
    // 旧曲淡出 (交叉淡化)
    this.bgm?.stop(fadeSec);
    this.bgm = null;

    const ctx = this.ctx;
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 0.0001;
    voiceGain.connect(this.muffle);

    const fadeInVoice = () => rampParam(voiceGain.gain, 1, fadeSec, ctx);
    const makeHandle = (handleKey: string, dispose: () => void): Handle => ({
      key: handleKey,
      stop: (seconds: number) => {
        rampParam(voiceGain.gain, 0.0001, seconds, ctx);
        setTimeout(() => {
          try {
            dispose();
            voiceGain.disconnect();
          } catch {
            /* ignore */
          }
        }, Math.max(0, seconds) * 1000 + 120);
      },
    });

    const startMood = (mood: string): boolean => {
      const spec = BGM_MOODS[mood];
      if (!spec) {
        console.warn(`[StoryAudioDirector] unknown bgmMood "${mood}" (known: ${Object.keys(BGM_MOODS).join(', ')})`);
        return false;
      }
      const synth = new ProceduralBgm(ctx, voiceGain, spec, mood);
      synth.start();
      fadeInVoice();
      this.bgm = makeHandle(`mood:${mood}`, () => synth.stop());
      return true;
    };

    if (track) {
      try {
        const player = await new Promise<Player>((resolve, reject) => {
          const p = new Player({
            url: track,
            loop: true,
            onload: () => resolve(p),
            onerror: (err: Error) => reject(err),
          });
        });
        if (generation !== this.bgmGeneration) {
          player.dispose();
          voiceGain.disconnect();
          return;
        }
        player.connect(voiceGain);
        player.start();
        fadeInVoice();
        this.bgm = makeHandle(key, () => {
          player.stop();
          player.dispose();
        });
        return;
      } catch (e) {
        this.failedTracks.add(track);
        console.warn(`[StoryAudioDirector] BGM track failed to load (${track}); ${mood ? 'falling back to mood' : 'continuing silently'}.`, e);
        if (generation !== this.bgmGeneration) {
          voiceGain.disconnect();
          return;
        }
      }
    }

    if (mood && startMood(mood)) return;
    voiceGain.disconnect();
  }

  /** 兼容旧调用：按 URL 播放 BGM */
  public async playBgm(trackUrl: string, volume: number = 0.35): Promise<void> {
    await this.startBgm({ track: trackUrl, volume });
  }

  /** 停止 BGM。immediate=true 立刻断；否则淡出 fadeSec 秒 (默认 1.5s，淡出后增益复位，下次播放不会是静音) */
  public stopBgm(immediate = false, fadeSec?: number): void {
    this.bgmGeneration++;
    if (!this.bgm) return;
    this.bgm.stop(immediate ? 0 : fadeSec ?? this.config.defaultFadeSec);
    this.bgm = null;
  }

  public setBgmVolume(volume: number): void {
    this.baseBgmVolume = Math.max(0, Math.min(1, volume));
    if (this.ctx && this.bgmLevel) rampParam(this.bgmLevel.gain, this.baseBgmVolume, 0.8, this.ctx);
  }

  /** 角色说话 / 用户开口时，BGM (与环境声) 自动闪避下潜 */
  public duckBgm(): void {
    if (this.isDucked) return;
    this.isDucked = true;
    if (!this.ctx) return;
    if (this.bgmDuck) rampParam(this.bgmDuck.gain, this.config.duckedBgmRatio, this.config.duckRampTime, this.ctx);
    if (this.ambDuck) rampParam(this.ambDuck.gain, this.config.duckedAmbienceRatio, this.config.duckRampTime, this.ctx);
  }

  /** 说话完毕，BGM 恢复原声量 */
  public restoreBgmDucking(): void {
    if (!this.isDucked) return;
    this.isDucked = false;
    if (!this.ctx) return;
    if (this.bgmDuck) rampParam(this.bgmDuck.gain, 1, this.config.unduckRampTime, this.ctx);
    if (this.ambDuck) rampParam(this.ambDuck.gain, 1, this.config.unduckRampTime, this.ctx);
  }

  /** 内心独白 / 黑幕时的低通滤波水下效果 */
  public setMuffle(muffled: boolean): void {
    this.isMuffled = muffled;
    if (!this.muffle || !this.ctx) return;
    rampParam(this.muffle.frequency, muffled ? 380 : 20000, 0.8, this.ctx);
  }

  // ───────────────────────── 环境声 (程序化噪声) ─────────────────────────

  public startAmbience(id: string, volume?: number): void {
    this.init();
    if (!this.ctx || !this.ambLevel) return;
    if (!(AMBIENCE_IDS as readonly string[]).includes(id)) {
      console.warn(`[StoryAudioDirector] unknown ambience "${id}" (known: ${AMBIENCE_IDS.join(', ')}, none)`);
      return;
    }
    rampParam(this.ambLevel.gain, volume ?? this.config.defaultAmbienceVolume, 0.8, this.ctx);
    if (this.ambience?.key === id) return;
    this.ambience?.stop(1.5);
    this.ambience = this.buildAmbience(id);
  }

  public stopAmbience(fadeSec?: number): void {
    if (!this.ambience) return;
    this.ambience.stop(fadeSec ?? this.config.defaultFadeSec);
    this.ambience = null;
  }

  /** 停掉所有持续声音 (剧终 / 退出剧场) */
  public stopAll(fadeSec = 1.2): void {
    this.cancelPendingSfx();
    this.stopBgm(false, fadeSec);
    this.stopAmbience(fadeSec);
    this.restoreBgmDucking();
    this.setMuffle(false);
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0; // 棕噪声：积分白噪声，低频更厚，像海与风
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private buildAmbience(id: string): Handle | null {
    const ctx = this.ctx;
    const out = this.ambLevel;
    if (!ctx || !out) return null;

    const voice = ctx.createGain();
    voice.gain.value = 0.0001;
    voice.connect(out);
    rampParam(voice.gain, 1, 2.5, ctx);

    const nodes: Array<AudioScheduledSourceNode> = [];
    const addLayer = (opts: { filter: BiquadFilterType; freq: number; q: number; level: number; lfoHz: number; lfoDepth: number; offset: number }) => {
      const src = ctx.createBufferSource();
      src.buffer = this.getNoiseBuffer(ctx);
      src.loop = true;
      src.loopStart = opts.offset;
      const filter = ctx.createBiquadFilter();
      filter.type = opts.filter;
      filter.frequency.value = opts.freq;
      filter.Q.value = opts.q;
      const amp = ctx.createGain();
      amp.gain.value = opts.level;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = opts.lfoHz;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = opts.lfoDepth;
      lfo.connect(lfoGain);
      lfoGain.connect(amp.gain);
      src.connect(filter);
      filter.connect(amp);
      amp.connect(voice);
      src.start();
      lfo.start();
      nodes.push(src, lfo);
    };

    if (id === 'sea_waves') {
      // 浪涌 (低频厚噪声缓慢起伏) + 退潮泡沫 (高频嘶嘶，相位错开)
      addLayer({ filter: 'lowpass', freq: 650, q: 0.5, level: 0.5, lfoHz: 0.11, lfoDepth: 0.35, offset: 0 });
      addLayer({ filter: 'highpass', freq: 2600, q: 0.4, level: 0.05, lfoHz: 0.13, lfoDepth: 0.04, offset: 1.3 });
    } else {
      // 风：带通噪声，起伏更慢
      addLayer({ filter: 'bandpass', freq: 420, q: 0.8, level: 0.4, lfoHz: 0.07, lfoDepth: 0.28, offset: 0 });
      addLayer({ filter: 'bandpass', freq: 1100, q: 1.2, level: 0.08, lfoHz: 0.17, lfoDepth: 0.06, offset: 2.1 });
    }

    return {
      key: id,
      stop: (seconds: number) => {
        rampParam(voice.gain, 0.0001, seconds, ctx);
        setTimeout(() => {
          nodes.forEach((n) => {
            try {
              n.stop();
              n.disconnect();
            } catch {
              /* ignore */
            }
          });
          try {
            voice.disconnect();
          } catch {
            /* ignore */
          }
        }, Math.max(0, seconds) * 1000 + 120);
      },
    };
  }

  // ───────────────────────── 拟音 (原生合成，零网络) ─────────────────────────

  /**
   * 播放拟音 (原生高保真合成与回退，保证零网络也能发出纯净音效)
   */
  public playSfx(id: string, volume = 0.8): void {
    this.init();
    if (typeof window === 'undefined') return;

    try {
      const ctx = getContext().rawContext as unknown as AudioContext;
      if (!ctx || ctx.state === 'suspended') return;

      if (id === 'crystal_chime') {
        // 清脆通透的星铁质感晶体微光音 (玻璃瞬态击打 + 晶莹三音微琶音 + 空气感高频泛音，告别沉闷)
        const now = ctx.currentTime;

        // 1. 玻璃微瞬态敲击 (Glass Transient Strike: 产生清脆利落的“叮”触感)
        const clickOsc = ctx.createOscillator();
        const clickGain = ctx.createGain();
        clickOsc.type = 'triangle';
        clickOsc.frequency.setValueAtTime(4186, now); // C8
        clickOsc.frequency.exponentialRampToValueAtTime(2093, now + 0.025); // C7
        clickGain.gain.setValueAtTime(volume * 0.20, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
        clickOsc.connect(clickGain);
        clickGain.connect(ctx.destination);
        clickOsc.start(now);
        clickOsc.stop(now + 0.035);

        // 2. 辅助发声函数：生成带有八度微泛音的清脆晶体音符
        const playCrystalNote = (freq: number, startTime: number, noteGain: number, duration: number) => {
          // 基频纯净正弦波
          const osc1 = ctx.createOscillator();
          const g1 = ctx.createGain();
          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(freq, startTime);
          g1.gain.setValueAtTime(volume * noteGain, startTime);
          g1.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
          osc1.connect(g1);
          g1.connect(ctx.destination);
          osc1.start(startTime);
          osc1.stop(startTime + duration);

          // 高八度晶体泛音 (Shimmer Overtone: 赋予空气感与剔透感，消灭纯正弦的沉闷感)
          const osc2 = ctx.createOscillator();
          const g2 = ctx.createGain();
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(freq * 2.0, startTime);
          g2.gain.setValueAtTime(volume * noteGain * 0.38, startTime);
          g2.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.65);
          osc2.connect(g2);
          g2.connect(ctx.destination);
          osc2.start(startTime);
          osc2.stop(startTime + duration * 0.65);

          // 五度泛音微共鸣 (5th harmonic sparkle)
          const osc3 = ctx.createOscillator();
          const g3 = ctx.createGain();
          osc3.type = 'sine';
          osc3.frequency.setValueAtTime(freq * 1.5, startTime);
          g3.gain.setValueAtTime(volume * noteGain * 0.22, startTime);
          g3.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.5);
          osc3.connect(g3);
          g3.connect(ctx.destination);
          osc3.start(startTime);
          osc3.stop(startTime + duration * 0.5);
        };

        // 3. 晶莹微琶音 (音符1: A6 1760Hz -> 音符2: E7 2637Hz 通透点亮 -> 音符3: A7 3520Hz 星芒余韵)
        playCrystalNote(1760.0, now, 0.22, 0.70);         // A6 晶体起音
        playCrystalNote(2637.0, now + 0.065, 0.26, 0.90); // E7 高音点亮，通透空灵
        playCrystalNote(3520.0, now + 0.125, 0.14, 0.65); // A7 星芒微光余韵
      } else if (id === 'heartbeat_pulse') {
        // 低频心跳重击 (Sub-bass thud 55Hz)
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(75, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);

        gain.gain.setValueAtTime(volume * 0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (id === 'camera_shutter') {
        // 相机快门拟音 (清脆白噪音脉冲 + 机械弹片咔嚓)
        const now = ctx.currentTime;
        const bufferSize = ctx.sampleRate * 0.08;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume * 0.3, now);

        noise.connect(gain);
        gain.connect(ctx.destination);
        noise.start(now);
      } else if (id === 'whoosh') {
        // 掠风声：带通噪声的频率上扫 + 起落包络 (配合运镜 / 白闪)
        const now = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = this.getNoiseBuffer(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 1.1;
        filter.frequency.setValueAtTime(300, now);
        filter.frequency.exponentialRampToValueAtTime(2400, now + 0.7);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(volume * 0.5, now + 0.28);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start(now);
        src.stop(now + 0.9);
      } else if (id === 'bell') {
        // 低沉温柔的钟声 (基频 + 非整数泛音，长衰减)，用于幕转 / 重要时刻
        const now = ctx.currentTime;
        [[392, 1], [392 * 2.76, 0.32], [392 * 5.4, 0.1]].forEach(([freq, amp]) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(volume * 0.28 * amp, now + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 3.3);
        });
      } else if (id === 'soft_tap') {
        // 轻点：短促的木质“嗒”，给“你点了一下”的即时反馈
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(420, now + 0.06);
        gain.gain.setValueAtTime(volume * 0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
      } else {
        console.warn(`[StoryAudioDirector] unknown sfx "${id}" (known: ${SFX_IDS.join(', ')})`);
      }
    } catch (e) {
      console.warn('[StoryAudioDirector] playSfx error:', e);
    }
  }
}

export const storyAudioDirector = new StoryAudioDirector();
