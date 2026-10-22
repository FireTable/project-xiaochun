import {
  setContext,
  connect,
  Gain,
  Filter,
  EQ3,
  Compressor,
  Freeverb,
} from 'tone';
import {
  APP_CONFIG,
  type VocalAudioConfig,
  type VocalPresetKey,
  type SceneThemeId,
  VOCAL_PRESETS,
} from '@/config';

/**
 * VocalAudioProcessor (TTS 语音后处理插件模块 - 基于 Tone.js)
 *
 * 核心设计与架构规范:
 * 1. 独立解耦：纯净的音频 DSP 管线封装，插件化接入 ChatDirector。
 * 2. 动效解耦：口型分析器 (AnalyserNode) 与 EMAGE 动作生成依然获取原始未加工音频，
 *    彻底杜绝混响/动态对肢体预测与嘴形咬字的污染；处理后的音频专门送入扬声器。
 * 3. 准实时调节：所有声学参数均支持 `rampTo` 纳秒级无爆音渐变，DevDrawer 拖动滑块时无需打断正在播放的音频，
 *    边听边调实时响应。
 * 4. 稳健降级：在 SSR、Node.js 单元测试或缺少 Web Audio API 的环境中平滑降级为直通 (Passthrough)。
 */
export class VocalAudioProcessor {
  private ctx: AudioContext | null = null;
  private initialized = false;
  private config: VocalAudioConfig = { ...APP_CONFIG.vocal.default };

  // Tone.js 节点与路由 (采用按需命名导入，避免全量打包 Synth/Transport/MIDI 等非必需模块)
  private inputNode: Gain | null = null;
  private outputNode: Gain | null = null;
  private dryGain: Gain | null = null;
  private wetGain: Gain | null = null;
  private lowCut: Filter | null = null;
  private eq: EQ3 | null = null;
  private compressor: Compressor | null = null;
  private reverb: Freeverb | null = null;

  // 扬声器已连标志，避免重复绑定 destination
  private destinationConnected = false;

  // 场景联动与状态订阅
  private currentScene: SceneThemeId = 'light';
  private listeners = new Set<(config: VocalAudioConfig) => void>();

  // 镜头视距与俯仰角姿态状态
  private currentCameraDistance = 2.2;
  private currentCameraPitch = Math.PI * 0.5;
  private currentBodyYaw = 0;

  // 兜底原生节点 (Mock / 降级测试)
  private fallbackPassthrough: GainNode | null = null;

  public get ready(): boolean {
    return this.initialized;
  }

  /**
   * 初始化 Tone.js 音频图并绑定到宿主 AudioContext。
   */
  public init(ctx: AudioContext): void {
    if (this.initialized && this.ctx === ctx) return;
    if (typeof window === 'undefined' || !ctx || typeof ctx.createGain !== 'function') {
      return;
    }

    try {
      this.ctx = ctx;
      // 绑定现有的 AudioContext 到 Tone.js
      setContext(ctx);

      // 创建输入和输出总线
      this.inputNode = new Gain(1);
      this.outputNode = new Gain(1);

      // 干湿切分支：若未开启美化或选用原声直通，走 100% 纯干声直通
      const isRawBypass = !this.config.enabled || this.config.preset === 'bypass';
      const initialDry = isRawBypass ? (this.config.enabled ? this.config.outputGain : 1) : 0;
      const initialWet = isRawBypass ? 0 : this.config.outputGain;
      this.dryGain = new Gain(initialDry);
      this.wetGain = new Gain(initialWet);

      // 1. 低切滤波 (Highpass Filter, 滤掉低频爆破音与麦克风闷感)
      this.lowCut = new Filter({
        frequency: this.config.lowCutFreq,
        type: 'highpass',
        rolloff: -12,
      });

      // 2. 三段均衡器 (EQ3, 胸腔共鸣 + 中频清晰度 + 空气感高频)
      this.eq = new EQ3({
        low: this.config.chestResonance,
        mid: this.config.midGain,
        high: this.config.airGain,
        lowFrequency: 350,   // 人声胸腔基频敏感区
        highFrequency: 3500, // 人声气声泛音敏感区
      });

      // 3. 动态压限器 (Compressor, 带来广播级电台贴耳感)
      this.compressor = new Compressor({
        threshold: this.config.compressorThreshold,
        ratio: this.config.compressorRatio,
        attack: 0.01,
        release: 0.15,
      });

      // 4. 空间微混响 (Freeverb, 营造临场空间感，消除死板干音)
      this.reverb = new Freeverb({
        roomSize: this.config.reverbRoomSize,
        dampening: this.config.reverbDampening,
        wet: this.config.reverbWet,
      });

      // 信号流连接：
      // 干声旁路 (Bypass): input -> dryGain -> output
      this.inputNode.connect(this.dryGain);
      this.dryGain.connect(this.outputNode);

      // 湿声效果链: input -> lowCut -> eq -> compressor -> reverb -> wetGain -> output
      this.inputNode.connect(this.lowCut);
      this.lowCut.connect(this.eq);
      this.eq.connect(this.compressor);
      this.compressor.connect(this.reverb);
      this.reverb.connect(this.wetGain);
      this.wetGain.connect(this.outputNode);

      this.initialized = true;
      this.destinationConnected = false;
    } catch (err) {
      console.warn('[VocalAudioProcessor] Failed to initialize Tone.js graph, using passthrough:', err);
      try {
        this.fallbackPassthrough = ctx.createGain();
      } catch {}
    }
  }

  /**
   * 将当前音效模块串入 ChatDirector 播放管线：
   * sourceNode (例如 currentGain) -> inputNode -> ... -> outputNode -> destination
   */
  public connectChain(sourceNode: AudioNode, destination: AudioNode): void {
    if (!this.initialized || !this.inputNode || !this.outputNode) {
      if (typeof sourceNode?.connect === 'function') {
        if (this.fallbackPassthrough) {
          sourceNode.connect(this.fallbackPassthrough);
          this.fallbackPassthrough.connect(destination);
        } else {
          sourceNode.connect(destination);
        }
      }
      return;
    }

    try {
      // 1. sourceNode (原生 AudioNode) 连接到 inputNode (Gain.input)
      connect(sourceNode, this.inputNode);

      // 2. outputNode 连接到扬声器 (只在初次或重置后连接一次)
      if (!this.destinationConnected) {
        connect(this.outputNode, destination);
        this.destinationConnected = true;
      }
    } catch (e) {
      console.warn('[VocalAudioProcessor] connectChain fallback to direct connect:', e);
      try {
        if (typeof sourceNode?.connect === 'function') {
          sourceNode.connect(destination);
        }
      } catch {}
    }
  }

  /** 获取当前声学配置副本 */
  public getConfig(): VocalAudioConfig {
    return { ...this.config };
  }

  /** 获取当前所在 3D 场景 */
  public get scene(): SceneThemeId {
    return this.currentScene;
  }

  /** 订阅配置变化 (供 DevDrawer 滑块与预设响应场景自动切换) */
  public subscribe(fn: (config: VocalAudioConfig) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notifyListeners(): void {
    const cfg = this.getConfig();
    this.listeners.forEach((fn) => {
      try {
        fn(cfg);
      } catch (e) {
        console.warn('[VocalAudioProcessor] Listener error:', e);
      }
    });
  }

  /**
   * 跟随 3D 场景自动适配声学环境特征 (开阔海滩 / 贴耳桌宠 / 虚空ASMR / 室内画室)
   * 采用 500ms 自然斜率渐变，与场景背景镜头淡入完美对齐
   */
  public applySceneTheme(theme: SceneThemeId): void {
    this.currentScene = theme;
    if (!this.config.sceneLinkage || !this.config.enabled || this.config.preset === 'bypass') return;

    const profile = (APP_CONFIG.vocal as any)?.sceneProfiles?.[theme] as Partial<VocalAudioConfig> | undefined;
    if (!profile) return;

    const TRANSITION_TIME = 0.5; // 500ms 场景切换声学平滑过渡
    try {
      if (profile.reverbWet !== undefined) {
        this.config.reverbWet = profile.reverbWet;
        this.safeRampParam(this.reverb?.wet, profile.reverbWet, TRANSITION_TIME);
      }
      if (profile.reverbRoomSize !== undefined) {
        this.config.reverbRoomSize = profile.reverbRoomSize;
        this.safeRampParam(this.reverb?.roomSize, profile.reverbRoomSize, TRANSITION_TIME);
      }
      if (profile.reverbDampening !== undefined) {
        this.config.reverbDampening = profile.reverbDampening;
        if (this.reverb) {
          try { this.reverb.dampening = profile.reverbDampening; } catch {}
        }
      }
      if (profile.lowCutFreq !== undefined) {
        this.config.lowCutFreq = profile.lowCutFreq;
        this.safeRampParam(this.lowCut?.frequency, profile.lowCutFreq, TRANSITION_TIME);
      }
      if (profile.airGain !== undefined) {
        this.config.airGain = profile.airGain;
        this.safeRampParam(this.eq?.high, profile.airGain, TRANSITION_TIME);
      }
      if (profile.compressorThreshold !== undefined) {
        this.config.compressorThreshold = profile.compressorThreshold;
        this.safeRampParam(this.compressor?.threshold, profile.compressorThreshold, TRANSITION_TIME);
      }
      if (profile.compressorRatio !== undefined) {
        this.config.compressorRatio = profile.compressorRatio;
        this.safeRampParam(this.compressor?.ratio, profile.compressorRatio, TRANSITION_TIME);
      }

      this.notifyListeners();
    } catch (e) {
      console.warn('[VocalAudioProcessor] Error applying scene acoustics:', theme, e);
    }
  }


  /**
   * 安全平滑调节任意 AudioParam / Tone.Signal 节点
   * 采用 targetRampTo / linearRampTo 彻底杜绝 Web Audio 在负分贝与零值时抛出 exponentialRamp DOMException
   */
  private safeRampParam(param: any, value: number, rampTime = 0.03): void {
    if (!param) return;
    try {
      if (typeof param.targetRampTo === 'function') {
        param.targetRampTo(value, rampTime);
      } else if (typeof param.linearRampTo === 'function') {
        param.linearRampTo(value, rampTime);
      } else if (typeof param.rampTo === 'function') {
        param.rampTo(value, rampTime);
      } else if ('value' in param) {
        param.value = value;
      }
    } catch {
      try {
        if ('value' in param) {
          param.value = value;
        }
      } catch {}
    }
  }

  /**
   * 刷新干湿声路由：
   * 当美化关闭（enabled === false）或选用「原声直通」（preset === 'bypass'）时，
   * 必须走 100% 数字纯干声直通 (dryGain, wetGain = 0)，绝对不经过 lowCut、EQ3、Compressor、Freeverb，零相位失真、零音染！
   * 若此时开启了镜头距离衰减，由 dryGain 纯净调控输出音量，保持 100% 原始 TTS 音质。
   */
  public updateRouting(smoothTime = 0.03): void {
    if (!this.initialized) return;

    const isRawBypass = !this.config.enabled || this.config.preset === 'bypass';

    if (isRawBypass) {
      // 原声直通分支：仅通过单级 dryGain，绝不穿过滤波器或效果器节点
      const { gainOffset } = this.computeCameraAcousticOffsets();
      const effDry = this.config.enabled
        ? this.config.outputGain * gainOffset
        : 1.0;

      this.safeRampParam(this.dryGain?.gain, effDry, smoothTime);
      this.safeRampParam(this.wetGain?.gain, 0, smoothTime);
    } else {
      // 湿声效果链分支：走完整美化链路
      this.safeRampParam(this.dryGain?.gain, 0, smoothTime);
      this.applyEffectiveAcoustics(smoothTime);
    }
  }

  /**
   * 计算镜头距离产生的声学调制偏移量 (仅管声音大小与胸腔共鸣)
   */
  public computeCameraAcousticOffsets(): {
    chestOffset: number;
    gainOffset: number;
  } {
    if (!this.config.distanceAttenuation || !this.config.enabled) {
      return { chestOffset: 0, gainOffset: 1.0 };
    }

    const acoustics = (APP_CONFIG.vocal as any)?.cameraAcoustics ?? {
      referenceDistance: 2.2,
      minDistance: 0.6,
      maxDistance: 15.0,
      attenuationStartDistance: 8.0,
      proximityGainBoostDb: 3.0,
      proximityLowBoost: 3.0,
      maxVolumeDropDb: 8.0,
    };

    const refDist = acoustics.referenceDistance;
    const minDist = acoustics.minDistance;
    const maxDist = acoustics.maxDistance;
    const dropStartDist = acoustics.attenuationStartDistance ?? 8.0;
    const dist = this.currentCameraDistance;

    let chestOffset = 0;
    let gainOffset = 1.0;

    // 1. 距离推近 (0.6m ~ 2.2m: 音量饱满增大至 +3.0dB + 胸腔低频共鸣增强至 +3.0dB)
    if (dist < refDist) {
      const t = Math.max(0, Math.min(1, (refDist - dist) / Math.max(0.1, refDist - minDist)));
      chestOffset += acoustics.proximityLowBoost * t; // 近场低频胸腔共鸣提升，最多 +3.0dB (贴耳浑厚)
      const boostDb = (acoustics.proximityGainBoostDb ?? 3.0) * t;
      gainOffset = Math.pow(10, boostDb / 20); // 推近到 0.6m 时增大至 +3.0dB 饱满靠前
    } else if (dist > dropStartDist) {
      // 2. 距离拉远 (声音衰减仅在 8m 以后发生；从 8m 的 0dB 平滑衰减至 15m 的 -8.0dB 约0.4x)
      const s = Math.max(0, Math.min(1, (dist - dropStartDist) / Math.max(0.1, maxDist - dropStartDist)));
      const dropDb = acoustics.maxVolumeDropDb * s; // 8m 之前完全不衰减 (0dB / 1.0x)，8m 以后平滑衰减至 -8.0dB
      gainOffset = Math.pow(10, -dropDb / 20);
      // chestOffset 保持 0，平滑归零保持原本清爽干净
    }
    // 3. 正常机位与中景 (2.2m ~ 8.0m): 完全不作音量衰减 (0 dB / 1.0x)，胸腔共鸣为 0，声音稳定清爽

    return { chestOffset, gainOffset };
  }

  /**
   * 应用融合了镜头距离偏移的声学参数 (仅影响低频胸腔与主输出音量)
   */
  public applyEffectiveAcoustics(rampTime = 0.03): void {
    if (!this.initialized) return;
    if (!this.config.enabled || this.config.preset === 'bypass') return;

    const { chestOffset, gainOffset } = this.computeCameraAcousticOffsets();

    // 关键保底：无论效果器调节如何，湿声输出通道第一时间无条件打开，绝不静音
    const effOut = this.config.outputGain * gainOffset;
    this.safeRampParam(this.wetGain?.gain, effOut, rampTime);

    try {
      // 1. 低切滤波
      this.safeRampParam(this.lowCut?.frequency, this.config.lowCutFreq, rampTime);

      // 2. 三段均衡器：基础设定 + 镜头推近共鸣增强 (safeRampParam 完美支持负分贝与零值)
      this.safeRampParam(this.eq?.low, this.config.chestResonance + chestOffset, rampTime);
      this.safeRampParam(this.eq?.mid, this.config.midGain, rampTime);
      this.safeRampParam(this.eq?.high, this.config.airGain, rampTime);

      // 3. 动态压限器：threshold >= 0 时彻底关闭压缩 (ratio 置 1)
      if (this.config.compressorThreshold < 0) {
        this.safeRampParam(this.compressor?.threshold, this.config.compressorThreshold, rampTime);
        this.safeRampParam(this.compressor?.ratio, this.config.compressorRatio, rampTime);
      } else {
        this.safeRampParam(this.compressor?.threshold, 0, rampTime);
        this.safeRampParam(this.compressor?.ratio, 1, rampTime);
      }

      // 4. 空间微混响
      this.safeRampParam(this.reverb?.wet, this.config.reverbWet, rampTime);
      if (this.reverb) {
        this.safeRampParam(this.reverb.roomSize, this.config.reverbRoomSize, rampTime);
        try {
          this.reverb.dampening = this.config.reverbDampening;
        } catch {}
      }
    } catch (e) {
      console.warn('[VocalAudioProcessor] Error applying effective acoustics:', e);
    }
  }

  /**
   * 响应相机镜头视距更新 (每帧或相机移动时由 vrmEngine 驱动)
   */
  public updateCameraAcoustics(params: { distance: number; pitch?: number; bodyYaw?: number }): void {
    const { distance, pitch, bodyYaw } = params;
    if (pitch !== undefined) this.currentCameraPitch = pitch;
    if (bodyYaw !== undefined) this.currentBodyYaw = bodyYaw;

    const distDelta = Math.abs(distance - this.currentCameraDistance);
    if (distDelta < 0.015) {
      return;
    }

    this.currentCameraDistance = distance;

    if (!this.initialized) return;
    if (this.config.distanceAttenuation) {
      this.updateRouting(0.06);
    }
  }

  /**
   * 获取当前相机镜头声学状态摘要 (供 DevDrawer 实时显示近场/中景/远场徽章)
   * 空间区域划界：
   * • near (< 1.6m): 贴耳近场特写 (低频共鸣增强 + 音量增大)
   * • standard (1.6m ~ 4.5m): 标准对话机位 (默认 2.2m 位于此处)
   * • mid (4.5m ~ 8.0m): 中景适度空间 (轻微自然衰减)
   * • far (>= 8.0m): 远景空间 (8m 起算远景，衰减至 -8.0dB 约0.4x)
   */
  public getCameraAcousticSummary(): {
    distance: number;
    pitch: number;
    bodyYaw: number;
    distanceMode: 'near' | 'standard' | 'mid' | 'far';
  } {
    const d = this.currentCameraDistance;
    const distanceMode = d < 1.6 ? 'near' : d < 4.5 ? 'standard' : d < 8.0 ? 'mid' : 'far';
    return {
      distance: d,
      pitch: this.currentCameraPitch,
      bodyYaw: this.currentBodyYaw,
      distanceMode,
    };
  }

  /**
   * 准实时更新单一参数（供 DevDrawer 拖拽滑块时每帧调用）
   * 采用 rampTo 平滑过渡，确保完全无爆音（Pop / Click）
   */
  public updateParam<K extends keyof VocalAudioConfig>(key: K, val: VocalAudioConfig[K]): void {
    this.config[key] = val;
    if (!this.initialized) return;

    try {
      const RAMP_TIME = 0.03; // 30ms 平滑渐变
      switch (key) {
        case 'enabled': {
          this.updateRouting(0.05);
          if (Boolean(val) && this.config.sceneLinkage && this.config.preset !== 'bypass') {
            this.applySceneTheme(this.currentScene);
          }
          break;
        }
        case 'preset': {
          this.updateRouting(RAMP_TIME);
          break;
        }
        case 'sceneLinkage': {
          const isLinked = Boolean(val);
          if (isLinked && this.config.enabled && this.config.preset !== 'bypass') {
            this.applySceneTheme(this.currentScene);
          }
          break;
        }
        case 'distanceAttenuation': {
          this.updateRouting(0.08);
          break;
        }
        case 'chestResonance':
        case 'midGain':
        case 'airGain':
        case 'compressorThreshold':
        case 'reverbWet':
          this.applyEffectiveAcoustics(RAMP_TIME);
          break;
        case 'outputGain':
          if (this.config.preset === 'bypass') {
            this.updateRouting(RAMP_TIME);
          } else {
            this.applyEffectiveAcoustics(RAMP_TIME);
          }
          break;
        case 'lowCutFreq':
          this.safeRampParam(this.lowCut?.frequency, val as number, RAMP_TIME);
          break;
        case 'compressorRatio':
          this.safeRampParam(this.compressor?.ratio, val as number, RAMP_TIME);
          break;
        case 'reverbRoomSize':
          if (this.reverb) {
            this.safeRampParam(this.reverb.roomSize, val as number, RAMP_TIME);
          }
          break;
        case 'reverbDampening':
          if (this.reverb) {
            try { this.reverb.dampening = val as number; } catch {}
          }
          break;
      }
    } catch (e) {
      console.warn('[VocalAudioProcessor] Error updating param:', key, val, e);
    }
  }

  /**
   * 批量更新配置
   */
  public updateConfig(partial: Partial<VocalAudioConfig>): void {
    (Object.keys(partial) as Array<keyof VocalAudioConfig>).forEach((k) => {
      const v = partial[k];
      if (v !== undefined) {
        this.updateParam(k, v);
      }
    });
    this.updateRouting(0.03);
  }

  /**
   * 切换音效预设 (Sweet / Oneesan / Radio / Whisper / Bypass)
   * 关键架构原则：预设切换（包括原声直通与各音色）只改变下方声学调节滑块与 DSP 滤波数值，
   * 绝不篡改上方的系统开关 (enabled, sceneLinkage, distanceAttenuation)
   */
  public setPreset(presetKey: VocalPresetKey): void {
    this.config.preset = presetKey;
    if (presetKey === 'custom') {
      this.updateRouting(0.03);
      this.notifyListeners();
      return;
    }
    const target = VOCAL_PRESETS[presetKey];
    if (!target) return;

    // 仅提取声学调节滑块与 DSP 滤波属性，保留当前用户配置的系统开关状态
    const { enabled, sceneLinkage, distanceAttenuation, ...acousticParams } = target;
    this.updateConfig({
      ...acousticParams,
      preset: presetKey,
    });
    this.updateRouting(0.03);
  }

  /**
   * 释放资源
   */
  public dispose(): void {
    try {
      this.inputNode?.dispose();
      this.outputNode?.dispose();
      this.dryGain?.dispose();
      this.wetGain?.dispose();
      this.lowCut?.dispose();
      this.eq?.dispose();
      this.compressor?.dispose();
      this.reverb?.dispose();
    } catch {}
    this.initialized = false;
    this.destinationConnected = false;
    this.ctx = null;
  }
}
