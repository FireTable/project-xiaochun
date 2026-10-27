import {
  Gain,
  Filter,
  Player,
  getContext,
} from 'tone';
import type { AudioDirective } from './schema';

export interface StoryAudioDirectorConfig {
  defaultBgmVolume: number;
  duckedBgmRatio: number; // 0.25 即闪避至 25% 音量 (-12dB)
  duckRampTime: number;    // 闪避过渡秒数
  unduckRampTime: number;  // 恢复过渡秒数
}

export class StoryAudioDirector {
  private config: StoryAudioDirectorConfig = {
    defaultBgmVolume: 0.35,
    duckedBgmRatio: 0.25,
    duckRampTime: 0.25,
    unduckRampTime: 0.6,
  };

  private isInitialized = false;
  private bgmGain: Gain | null = null;
  private bgmFilter: Filter | null = null;
  private currentBgmPlayer: Player | null = null;
  private currentBgmTrack: string | null = null;
  private baseBgmVolume = 0.35;
  private isDucked = false;

  public init(): void {
    if (this.isInitialized) return;
    if (typeof window === 'undefined') return;

    try {
      // 建立 BGM 声学主总线
      this.bgmGain = new Gain(this.config.defaultBgmVolume);
      this.bgmFilter = new Filter({
        frequency: 20000, // 默认不过滤
        type: 'lowpass',
        rolloff: -12,
      });

      // 路由: Player ➔ Filter ➔ Gain ➔ Destination
      this.bgmFilter.connect(this.bgmGain);
      this.bgmGain.toDestination();
      this.isInitialized = true;
    } catch (e) {
      console.warn('[StoryAudioDirector] init failed, falling back:', e);
    }
  }

  /**
   * 执行舞台音频指令
   */
  public async executeDirective(directive?: AudioDirective): Promise<void> {
    if (!directive) return;
    this.init();

    // 1. 处理 BGM 指令
    if (directive.bgmTrack && directive.bgmTrack !== this.currentBgmTrack) {
      await this.playBgm(directive.bgmTrack, directive.bgmVolume ?? 0.35);
    }

    if (directive.bgmAction === 'stop_cut') {
      this.stopBgm(true);
    } else if (directive.bgmAction === 'fade_out') {
      this.stopBgm(false);
    } else if (directive.bgmAction === 'muffle') {
      this.setMuffle(true);
    } else if (directive.bgmAction === 'play') {
      this.setMuffle(false);
    }

    // 2. 处理拟音 SFX
    if (directive.sfx && directive.sfx.length > 0) {
      directive.sfx.forEach((item) => {
        const delayMs = (item.delaySec || 0) * 1000;
        if (delayMs > 0) {
          setTimeout(() => this.playSfx(item.id, item.volume), delayMs);
        } else {
          this.playSfx(item.id, item.volume);
        }
      });
    }
  }

  /**
   * 播放背景音乐
   */
  public async playBgm(trackUrl: string, volume: number = 0.35): Promise<void> {
    this.init();
    this.baseBgmVolume = volume;

    if (this.currentBgmTrack === trackUrl && this.currentBgmPlayer?.state === 'started') {
      return;
    }

    try {
      // 若已有 BGM 在播，平滑淡出旧曲
      if (this.currentBgmPlayer) {
        this.currentBgmPlayer.stop('+1');
        this.currentBgmPlayer.dispose();
        this.currentBgmPlayer = null;
      }

      this.currentBgmTrack = trackUrl;
      const player = new Player({
        url: trackUrl,
        loop: true,
        autostart: true,
        fadeIn: 1.5,
      });

      if (this.bgmFilter) {
        player.connect(this.bgmFilter);
      } else if (this.bgmGain) {
        player.connect(this.bgmGain);
      }

      this.currentBgmPlayer = player;
      this.restoreBgmDucking();
    } catch (e) {
      console.warn('[StoryAudioDirector] playBgm error:', e);
    }
  }

  /**
   * 停止 BGM
   */
  public stopBgm(immediate = false): void {
    if (!this.currentBgmPlayer) return;
    if (immediate) {
      this.currentBgmPlayer.stop();
      this.currentBgmTrack = null;
    } else {
      this.currentBgmGain()?.gain.rampTo(0, 1.5);
      setTimeout(() => {
        this.currentBgmPlayer?.stop();
        this.currentBgmTrack = null;
      }, 1500);
    }
  }

  /**
   * 角色说话 / 用户开口时，BGM 自动闪避下潜 -8dB
   */
  public duckBgm(): void {
    if (!this.bgmGain || this.isDucked) return;
    this.isDucked = true;
    const target = this.baseBgmVolume * this.config.duckedBgmRatio;
    this.bgmGain.gain.rampTo(target, this.config.duckRampTime);
  }

  /**
   * 说话完毕，BGM 恢复原声量
   */
  public restoreBgmDucking(): void {
    if (!this.bgmGain || !this.isDucked) return;
    this.isDucked = false;
    this.bgmGain.gain.rampTo(this.baseBgmVolume, this.config.unduckRampTime);
  }

  /**
   * 内心独白 / 黑幕时的低通滤波水下效果
   */
  public setMuffle(muffled: boolean): void {
    if (!this.bgmFilter) return;
    const targetFreq = muffled ? 380 : 20000;
    this.bgmFilter.frequency.rampTo(targetFreq, 0.8);
  }

  /**
   * 播放拟音 (原生高保真合成与回退，保证零网络也能发出纯净音效)
   */
  public playSfx(id: string, volume = 0.8): void {
    this.init();
    if (typeof window === 'undefined') return;

    try {
      const ctx = getContext().rawContext as AudioContext;
      if (!ctx || ctx.state === 'suspended') return;

      if (id === 'crystal_chime') {
        // 空灵晶体卡片微光音 (正弦双音共鸣)
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1318.5, now); // E6
        osc.frequency.exponentialRampToValueAtTime(1760.0, now + 0.15); // A6

        gain.gain.setValueAtTime(volume * 0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.6);
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
      }
    } catch (e) {
      console.warn('[StoryAudioDirector] playSfx error:', e);
    }
  }

  private currentBgmGain(): Gain | null {
    return this.bgmGain;
  }
}

export const storyAudioDirector = new StoryAudioDirector();
