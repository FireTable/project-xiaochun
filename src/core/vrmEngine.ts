import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, MToonMaterialLoaderPlugin, VRMUtils, type VRMExpressionPresetName } from '@pixiv/three-vrm';
import { CAMERA_STATE_KEY, BODY_YAW_KEY, CAMERA_PITCH_KEY, SCENE_THEME_KEY, CAMERA_Y_OFFSET_KEY } from '@/lib/constants';

import { VRMBodyMorph } from './morph/vrmBodyMorph';
import { postFxPipeline, type PostFxPipeline } from './postfx/postFxPipeline';
import { ChatDirector } from '@/director/chatDirector';
import { MotionPipeline } from '@/motion/pipeline/motionPipeline';
import type { PlayMotionOptions, UniversalMotionHandle } from '@/motion/sources/clip';
import { preloadWebLLM, unloadWebLLM } from '@/llm/webLLMProvider';
import { APP_CONFIG, type LightConfig } from '@/config';
import { loadPostFxEnabledFromStorage, getRenderPixelRatio, resolveInitialSceneTheme } from '@/lib/utils';
import { isMobile, isTauri } from '@/lib/platform';
import type { Lang } from '@/i18n';
import { langFromSystemPrompt } from '@/llm/prompts';

// ── 抽离子系统导入 ──
import { LineworkWorld, type LineworkTheme } from './scene/lineworkWorld';
import { passthroughManager } from './scene/passthroughManager';
import { StudioLighting } from './lighting/studioLighting';
import {
  VRMMaterialManager,
  type MaterialSaturationSettings,
  type MaterialSaturationPresetKey,
  type ModelPartDefinition,
  type ModelPartCategory,
  MODEL_PARTS_CONFIG,
  MODEL_PART_CATEGORIES,
} from './material/vrmMaterialManager';
import { BubbleTracker, type BubbleState } from './ui/bubbleTracker';
import { InteractionController } from './interaction/interactionController';
import { WindForceController } from './wind/windForce';
import { CharacterShadowSystem } from './scene/characterShadow';
import {
  captureExpressions,
  restoreExpressions,
  captureSpringBones,
  restoreSpringBones,
  captureLookAtTarget,
  type OutfitSwapState,
} from './outfitSwap';

export type {
  BubbleState,
  MaterialSaturationSettings,
  MaterialSaturationPresetKey,
  ModelPartDefinition,
  ModelPartCategory,
};
export { MODEL_PARTS_CONFIG, MODEL_PART_CATEGORIES };

export interface LoadingState {
  active: boolean;
  subtitleKey: string;
  subtitleVars?: Record<string, unknown>;
  progress: number;
}

/** Options for loadVRM — preserveMotion used by outfit swap (方案 A). */
export interface LoadVRMOptions {
  preserveMotion?: boolean;
}

export interface LightChannelState {
  base: number;
  enabled: boolean;
}

// ── 1. 角色 bodyTurn 自转偏角持久化 ──
function loadSavedBodyYaw(): number | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BODY_YAW_KEY);
    if (!raw) return null;
    const val = Number(raw);
    if (Number.isFinite(val)) return val;
  } catch (e) {
    console.warn('[vrmEngine] Failed to load body yaw:', e);
  }
  return null;
}

function persistBodyYaw(yaw: number): void {
  if (typeof localStorage === 'undefined' || !Number.isFinite(yaw)) return;
  try {
    localStorage.setItem(BODY_YAW_KEY, yaw.toString());
  } catch (e) {
    console.warn('[vrmEngine] Failed to save body yaw:', e);
  }
}

// ── 2. 镜头俯仰角与视距持久化 ──
export interface SavedCameraPitch {
  pitch: number;          // 垂直极角 (rad, controls.getPolarAngle())
  distance?: number;      // 视距 (m, controls.getDistance())
}

function loadSavedCameraPitch(): SavedCameraPitch | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    // 废弃并清理旧 key
    if (localStorage.getItem(CAMERA_STATE_KEY)) {
      localStorage.removeItem(CAMERA_STATE_KEY);
    }
    const raw = localStorage.getItem(CAMERA_PITCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pitch === 'number' && Number.isFinite(parsed.pitch)) {
      return {
        pitch: parsed.pitch,
        distance: typeof parsed.distance === 'number' && Number.isFinite(parsed.distance) ? parsed.distance : undefined,
      };
    }
  } catch (e) {
    console.warn('[vrmEngine] Failed to load camera pitch:', e);
  }
  return null;
}

function persistCameraPitch(state: SavedCameraPitch): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CAMERA_PITCH_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[vrmEngine] Failed to save camera pitch:', e);
  }
}

/** 获取相机默认视距 (m) */
function getDefaultCameraDistance(): number {
  const fovRad = (APP_CONFIG.camera.defaultFov * Math.PI) / 180;
  return APP_CONFIG.camera.defaultShotExtent / (2 * Math.tan(fovRad / 2));
}

/** 获取相机默认俯仰角 (rad) */
function getDefaultCameraPitch(): number {
  const target = new THREE.Vector3(...APP_CONFIG.camera.defaultTarget);
  const originalOffset = new THREE.Vector3(...APP_CONFIG.camera.defaultPosition).sub(target);
  const distance = originalOffset.length();
  return Math.acos(originalOffset.y / distance);
}

/**
 * 根据俯仰角 (pitch) 与视距 (distance) 计算相机三维世界坐标。
 * 水平方位角严格锁定为 0（正前方），保证世界背景不发生水平横移，左键专职驱动角色自转。
 */
function computeCameraPositionFromPitch(
  pitch: number,
  distance: number,
  target: THREE.Vector3,
): [number, number, number] {
  const y = target.y + distance * Math.cos(pitch);
  const z = target.z + distance * Math.sin(pitch);
  return [target.x, y, z];
}

/**
 * ponytail: 默认相机位置按 FOV + shotExtent 反推距离,保证不同焦距下"主体框选
 * 大小"一致。distance = extent / (2 * tan(fov/2)),方向沿用 config 里 defaultPosition
 * 减 defaultTarget 的方向(保留原本"略高于 target 看下来"的角度)。
 */
function computeDefaultCameraPosition(): [number, number, number] {
  const target = new THREE.Vector3(...APP_CONFIG.camera.defaultTarget);
  const originalOffset = new THREE.Vector3(...APP_CONFIG.camera.defaultPosition).sub(target);
  const direction = originalOffset.clone().normalize();
  const distance = getDefaultCameraDistance();
  return target.clone().add(direction.multiplyScalar(distance)).toArray() as [number, number, number];
}

export class VRMEngine {
  // ── Three.js 核心基础设施 ──
  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(
    APP_CONFIG.camera.defaultFov,
    1,
    0.1,
    100.0
  );
  private controls: OrbitControls | null = null;
  private loader = new GLTFLoader();
  private clock = new THREE.Clock();
  private animFrameId: number | null = null;
  /** 下一帧允许跑重活的 rAF 时间戳；targetFpsMobile / targetFpsDesktop（≤0 不限） */
  private _lastAnimTs = 0;
  private _animFrameIntervalMs = 0;
  // ── 模块化独立子系统 ──
  private lineworkWorld = new LineworkWorld();
  public readonly lighting = new StudioLighting();
  public readonly materialManager = new VRMMaterialManager();
  public readonly bubbleTracker = new BubbleTracker();
  public readonly interaction = new InteractionController();
  public readonly windForce = new WindForceController();

  // ── 动作管线（sources + constraints 由 pipeline 持有）──
  public readonly motionPipeline = new MotionPipeline();
  public get gazeController() { return this.motionPipeline.gaze; }
  public get footIK() { return this.motionPipeline.footIK; }
  public get emagePlayer() { return this.motionPipeline.emage; }
  private get motionTransition() { return this.motionPipeline.transition; }
  private get vrmaPlayer() { return this.motionPipeline.vrma; }
  private get bodyTurn() { return this.motionPipeline.bodyTurn; }
  public readonly bodyMorph = new VRMBodyMorph(APP_CONFIG.bodyMorph.default);
  // ponytail: 后期管线单例 — attachCanvas 时 init,render() 走 composer
  public readonly postFx: PostFxPipeline = postFxPipeline;
  // ponytail: dev 探针 (浏览器 console 调试用),生产不影响 bundle tree-shake
  private __dev_expose_once(): void {
    if (typeof window === 'undefined') return;
    (window as any).postFxPipeline = this.postFx;
    (window as any).vrmEngine = this;
  }
  private heightListeners = new Set<() => void>();
  // ponytail: 标记首次 VRM 加载完成。attachCanvas 只装 renderer/controls 不渲染,
  // 等 loadVRM 回调把场景 + 角色 + linework 一起 build 完,再 startAnimation + 推镜。
  // 中途换模型不重建场景,只 fitCamera。
  private _sceneInitialized = false;

  public onHeightChange(callback: () => void): () => void {
    this.heightListeners.add(callback);
    return () => {
      this.heightListeners.delete(callback);
    };
  }

  public notifyHeightChange(): void {
    this.heightListeners.forEach((cb) => {
      try { cb(); } catch (e) { console.warn('[VRMEngine] onHeightChange 回调异常:', e); }
    });
  }
  private chatDirector = new ChatDirector();

  // ── 实体状态 ──
  public currentVRM: VRM | null = null;
  private currentUrl: string = APP_CONFIG.model.defaultSource;
  private manualExpression: string | null = null;
  public enableBodyTurn: boolean = APP_CONFIG.camera.defaultEnableBodyTurn ?? true;

  // ── 服装状态与监听 ──
  public currentOutfitKey: string | null = null;
  private outfitChangeListeners = new Set<(outfitKey: string | null) => void>();

  public onOutfitChange(callback: (outfitKey: string | null) => void): () => void {
    this.outfitChangeListeners.add(callback);
    return () => {
      this.outfitChangeListeners.delete(callback);
    };
  }

  public notifyOutfitChange(outfitKey: string | null): void {
    this.currentOutfitKey = outfitKey;
    this.outfitChangeListeners.forEach((cb) => {
      try { cb(outfitKey); } catch (e) { console.warn('[VRMEngine] onOutfitChange error:', e); }
    });
  }

  /**
   * 获取指定服装的基准体型配置（全局默认 + 服装特定覆盖）
   */
  public getOutfitBaselineMorph(outfitKey: string | null): import('@/config').BodyMorphConfig {
    const globalDefault = APP_CONFIG.bodyMorph.default;
    if (!outfitKey) return { ...globalDefault };
    const addon = APP_CONFIG.model.addons[outfitKey];
    if (!addon?.bodyMorph) return { ...globalDefault };
    return {
      ...globalDefault,
      ...addon.bodyMorph,
    };
  }

  // ─── 头顶实时身高测量指示线与 HUD 标牌 (Height Ruler) ───
  public isHeightRulerVisible = false;
  private tempHeadTopPos = new THREE.Vector3();
  private tempRulerEdgePos = new THREE.Vector3();
  private _lastRenderedHeight = 0;

  private vrmBaseSceneY = 0;
  /** Outfit swap: ease floor baseY after matching previous hips height (reduces body-proportion pop). */
  private _outfitBaseYFrom = 0;
  private _outfitBaseYTo = 0;
  private _outfitBaseYEase = 1; // 1 = idle
  // ponytail: 角色阴影系统拆到 CharacterShadowSystem, 这里只持有引用 + 调它。
  private shadow = new CharacterShadowSystem();
  private _springBoneTunedVRM: VRM | null = null;

  // 临时向量复用
  private tempSoleA = new THREE.Vector3();
  private tempSoleB = new THREE.Vector3();

  // ── 外部状态与回调 ──
  public translateSync: ((key: string, vars?: Record<string, unknown>) => string) | null = null;
  public onLoadingChange?: (state: LoadingState) => void;
  // ponytail: 换装进度专给 TopHeader 按钮用 — 即便冷启动 LoadingOverlay 不显示
  // (preserveMotion=true 时 overlay 被跳过),按钮也要有 spinner 反馈。
  // shape 跟 LoadingState 一致,这样 UI 可以用同一个 component / 同样的字段。
  public onSwapProgress?: (state: LoadingState) => void;
  private readyListeners = new Set<(ready: boolean) => void>();
  // ponytail: 渲染不再默认 suspend。LoadingOverlay 只是个视觉遮罩,不挡渲染循环。
  // 旧逻辑:prod 默认 isRenderingSuspended=true,要等 onBreakStart 触发 resumeRendering;
  // 但 prod 初次访问 __VRM_ALREADY_READY__ 还没设过,onBreakStart 没机会跑,
  // 渲染永远被卡住,黑屏。现在:dev / prod 都从 startAnimation 立即开始渲染,
  // overlay 只是叠加在上层的 UI。VRM 加载完后,fitCamera + cinematicIntro 直接显示。
  public isRenderingSuspended = false;
  /** document.visibilitychange → 后台 suspend / 前台 resume */
  private visibilityPauseHandler: (() => void) | null = null;
  /** 当前 WebGL 上下文属性指纹（antialias / preserveDrawingBuffer / powerPreference） */
  private _rendererContextKey = '';
  /** 电池未充电 → low-power；插电或未知桌面 → high-performance */
  private _onBattery = typeof navigator !== 'undefined' && isMobile();
  private _batteryUnsub: (() => void) | null = null;
  private _rendererContextDirty = false;
  private _rulerLastHx = -1;
  private _rulerLastHy = -1;
  private _rulerLastBx = -1;
  private _rulerLastBy = -1;
  private _rulerLastInView: boolean | null = null;

  constructor() {
    this.loader.register((parser) => {
      const mtoonPlugin = new MToonMaterialLoaderPlugin(parser);
      // 根据全局配置 APP_CONFIG.outline.enabled 控制是否在加载阶段生成 (Outline) 材质与几何体 Group
      if (!APP_CONFIG.outline.enabled) {
        (mtoonPlugin as any)._shouldGenerateOutline = () => false;
      }
      return new VRMLoaderPlugin(parser, { mtoonMaterialPlugin: mtoonPlugin });
    });
    this.initScene();
  }

  // ── Facade 门面属性代理 (保障外部 100% 零破坏兼容) ──
  public get lightChannels(): LightConfig {
    return this.lighting.channels;
  }

  public get materialSaturation(): MaterialSaturationSettings {
    return this.materialManager.saturation;
  }

  public get onBubbleChange(): ((state: BubbleState) => void) | undefined {
    return this.bubbleTracker.onBubbleChange;
  }

  public set onBubbleChange(cb: ((state: BubbleState) => void) | undefined) {
    this.bubbleTracker.onBubbleChange = cb;
  }

  public getCurrentUrl(): string {
    return this.currentUrl;
  }

  public getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  public isReady(): boolean {
    return this.currentVRM !== null;
  }

  public onReadyChange(cb: (ready: boolean) => void): () => void {
    cb(this.isReady());
    this.readyListeners.add(cb);
    return () => {
      this.readyListeners.delete(cb);
    };
  }

  private notifyReady(ready: boolean): void {
    this.readyListeners.forEach((cb) => {
      try { cb(ready); } catch { }
    });
  }

  public bindI18n(fn: ((key: string, vars?: Record<string, unknown>) => string) | null): void {
    this.translateSync = fn;
    this.chatDirector.translateSync = fn;
  }

  public bindSystemPrompt(getter: () => string): void {
    // ponytail: 旧 API 保留兼容 — 内部包装成 context 形式,lang 走 prompt 反推(用户没改 prompt 时正确)。
    this.chatDirector.getSystemContext = async () => {
      const prompt = getter();
      return { prompt, lang: langFromSystemPrompt(prompt) };
    };
  }

  /**
   * ponytail: 新 API — 同时返回 prompt + lang。chatWorkflow 用 lang 给 user 消息打 lang 标记,
   * 不再靠「prompt 内容反推 lang」(用户改 prompt 后那个 trick 会失效)。
   */
  public bindSystemContext(provider: () => Promise<{ prompt: string; lang: Lang }>): void {
    this.chatDirector.getSystemContext = provider;
  }

  private bindVisibilityPause(): void {
    if (typeof document === 'undefined' || this.visibilityPauseHandler) return;
    this.visibilityPauseHandler = () => {
      if (document.hidden) {
        this.suspendRendering();
      } else {
        this.resumeForeground();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityPauseHandler);
    document.addEventListener('freeze', this.onPageFreeze);
    document.addEventListener('resume', this.onPageResume);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
  }

  private unbindVisibilityPause(): void {
    if (!this.visibilityPauseHandler || typeof document === 'undefined') return;
    document.removeEventListener('visibilitychange', this.visibilityPauseHandler);
    document.removeEventListener('freeze', this.onPageFreeze);
    document.removeEventListener('resume', this.onPageResume);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    this.visibilityPauseHandler = null;
  }

  private onPageFreeze = (): void => {
    this.suspendRendering();
  };

  private onPageResume = (): void => {
    this.resumeForeground();
  };

  private onPageHide = (): void => {
    this.suspendRendering();
  };

  private onPageShow = (): void => {
    this.resumeForeground();
  };

  /** 仅当前台可见时恢复；后台 pageshow/resume 不把 GPU 叫醒。 */
  private resumeForeground(): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    this.resumeRendering();
  }

  public suspendRendering(): void {
    this.isRenderingSuspended = true;
    // 真正停 rAF，避免后台仍每帧空转烧电发热
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.cinematicIntroRafId !== null) {
      cancelAnimationFrame(this.cinematicIntroRafId);
      this.cinematicIntroRafId = null;
      if (this.controls) this.controls.enabled = true;
    }
  }

  public resumeRendering(): void {
    if (!this.isRenderingSuspended && this.animFrameId !== null) {
      return;
    }
    this.isRenderingSuspended = false;
    this._lastAnimTs = 0;
    this.clock.start();
    // 有画布且场景已就绪时重启主循环；startAnimation 会立刻跑一帧，避免回前台空白
    if (this.animFrameId === null && this.renderer && (this.currentVRM || this._sceneInitialized)) {
      this.startAnimation();
    }
  }

  // ponytail: 启动期 cinematic 推镜 — LoadingOverlay 破次元时调,沿当前相机方向
  // 推远 3.3 倍作为起点,1.1s 内 easeOutCubic 拉回终点。
  // 终点 = loadSavedViewOrientation() 的记录点(若有);否则回退到默认相机位。
  // 解耦于「调用瞬间 camera.position」,任何时机调都明确推向上次保存的视角。
  // 视觉上 VRM 是个小点,镜头平滑推进,跟 overlay 的 scale-125 + blur-md 同步。
  // Tween 期间禁用 OrbitControls,避免用户输入跟动画抢 camera。
  private cinematicIntroRafId: number | null = null;
  public cinematicIntro(durationMs: number = 1100): void {
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls) return;
    if (this.cinematicIntroRafId !== null) {
      cancelAnimationFrame(this.cinematicIntroRafId);
      this.cinematicIntroRafId = null;
    }
    const savedPitch = loadSavedCameraPitch();
    const finalTarget = controls.target.clone();
    const dist = savedPitch?.distance ?? getDefaultCameraDistance();
    const pitch = savedPitch ? savedPitch.pitch : getDefaultCameraPitch();
    const finalPos = new THREE.Vector3(...computeCameraPositionFromPitch(pitch, dist, finalTarget));
    // 把相机立即设到终点,让 tween 期间 render-loop 读者(gaze 等)看到正确值;
    // 再跳到 startPos 准备推进。
    camera.position.copy(finalPos);
    controls.target.copy(finalTarget);
    // 沿 finalPos→finalTarget 反方向 ×3.3 = 从同视角的远处起步,VRM 一开始是个小点
    const offset = finalPos.clone().sub(finalTarget);
    const startPos = finalTarget.clone().add(offset.clone().multiplyScalar(3.3));
    camera.position.copy(startPos);
    camera.lookAt(finalTarget);
    controls.target.copy(finalTarget);
    const wasEnabled = controls.enabled;
    controls.enabled = false;
    const startTime = performance.now();
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = () => {
      this.cinematicIntroRafId = null;
      const t = Math.min(1, (performance.now() - startTime) / durationMs);
      const eased = easeOutCubic(t);
      camera.position.lerpVectors(startPos, finalPos, eased);
      camera.lookAt(finalTarget);
      if (t < 1) {
        this.cinematicIntroRafId = requestAnimationFrame(tick);
      } else {
        camera.position.copy(finalPos);
        controls.target.copy(finalTarget);
        controls.enabled = wasEnabled;
        controls.update();
      }
    };
    this.cinematicIntroRafId = requestAnimationFrame(tick);
  }

  // ── 场景与画布初始化 ──
  private initScene(): void {
    this.scene.background = new THREE.Color(0x0b0f19);

    // 实体阴影平面（自适应昼白/极夜深色主题的透明度，确保地面永远有扎实的接触阴影）
    // ponytail: 全部塞 CharacterShadowSystem, 这边只 init。
    const initialTheme = resolveInitialSceneTheme();
    this.shadow.init(this.scene, initialTheme);



    // 初始化视线系统与灯光系统
    this.gazeController.init(this.scene);
    this.gazeController.enabled = APP_CONFIG.camera.defaultEnableGaze ?? true;
    this.lighting.init(this.scene);

    // 动作与聊天控制器事件绑定
    this.vrmaPlayer.bindTransitionManager(this.motionTransition);
    this.chatDirector.bindPipeline(this.motionPipeline);
    this.chatDirector.onSuspendRendering = () => this.suspendRendering();
    this.chatDirector.onResumeRendering = () => this.resumeRendering();
    this.chatDirector.setOnEnd(() => this.bubbleTracker.hide());
  }

  /**
   * 控制头顶身高标尺与 HUD 胶囊显示隐藏
   */
  public setHeightRulerVisible(visible: boolean): void {
    this.isHeightRulerVisible = visible;
    const badgeEl = typeof document !== 'undefined' ? document.getElementById('height-ruler-badge') : null;
    if (badgeEl) {
      badgeEl.style.display = visible ? 'flex' : 'none';
      if (!visible) {
        badgeEl.style.opacity = '0';
      }
    }
    const svgEl = typeof document !== 'undefined' ? document.getElementById('height-ruler-svg') : null;
    if (svgEl) {
      svgEl.style.display = visible ? 'block' : 'none';
    }
    if (visible) {
      this._refreshHeightRulerText();
      if (!this._unsubHeightRuler) {
        this._unsubHeightRuler = this.onHeightChange(() => this._refreshHeightRulerText());
      }
    } else {
      this._unsubHeightRuler?.();
      this._unsubHeightRuler = null;
      this._rulerLastHx = -1;
      this._rulerLastHy = -1;
      this._rulerLastBx = -1;
      this._rulerLastBy = -1;
      this._rulerLastInView = null;
    }
  }

  private _unsubHeightRuler: (() => void) | null = null;

  private _refreshHeightRulerText(): void {
    if (typeof document === 'undefined') return;
    const heightStr = `${this.bodyMorph.getCurrentHeightCm().toFixed(1)}cm`;
    const textEl = document.getElementById('height-ruler-text');
    if (textEl) {
      textEl.textContent = heightStr;
    }
  }

  public getHeightCm(): number {
    return this.bodyMorph.getCurrentHeightCm();
  }

  private lastRenderWidth = 0;
  private lastRenderHeight = 0;

  /**
   * 统一获取渲染像素比：
   * 统一走 @/lib/utils 的 getRenderPixelRatio()，无论 PostFX 是否启用，
   * 均严格使用 getRenderPixelRatio()（按 mobile/desktop 封顶），消除额外超采样开销。
   */
  public getTargetPixelRatio(): number {
    return getRenderPixelRatio();
  }

  public updatePixelRatio(): void {
    if (!this.renderer) return;
    const ratio = this.getTargetPixelRatio();
    this.renderer.setPixelRatio(ratio);
    const width = this.lastRenderWidth || window.innerWidth;
    const height = this.lastRenderHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    if (this.postFx.isReady()) {
      this.postFx.resize(width, height, ratio);
    }
    this.renderFrameNow();
  }

  public get isCanvasAttached(): boolean {
    return Boolean(this.canvas && this.renderer);
  }

  /**
   * PostFX 开：默认帧缓冲不开 MSAA（抗锯齿来自 composer 主 RT）。
   * 穿透桌宠才 preserveDrawingBuffer；电池 low-power，插电 high-performance。
   */
  private getRendererContextAttributes(): THREE.WebGLRendererParameters {
    const theme = this.getLineworkTheme();
    const composerDraws = this.postFx.config.enabled;
    const preserve = isTauri() && (
      theme === 'transparent' || passthroughManager.isPassthroughEnabled()
    );
    return {
      canvas: this.canvas ?? undefined,
      // composer 主 RT 已带 MSAA；只有直出 framebuffer 时才开默认 AA
      antialias: !composerDraws,
      alpha: true,
      powerPreference: this._onBattery ? 'low-power' : 'high-performance',
      preserveDrawingBuffer: preserve,
    };
  }

  private rendererContextKey(): string {
    const a = this.getRendererContextAttributes();
    return `${a.antialias ? 1 : 0}|${a.preserveDrawingBuffer ? 1 : 0}|${a.powerPreference}`;
  }

  private bindBatteryPowerPreference(): void {
    if (this._batteryUnsub || typeof navigator === 'undefined') return;
    type BatteryLike = {
      charging: boolean;
      addEventListener(type: 'chargingchange', listener: () => void): void;
      removeEventListener(type: 'chargingchange', listener: () => void): void;
    };
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery !== 'function') {
      this._onBattery = isMobile();
      return;
    }
    void nav.getBattery().then((bat) => {
      const apply = () => {
        const next = !bat.charging;
        if (next === this._onBattery) return;
        this._onBattery = next;
        this.syncRendererContextIfNeeded();
      };
      this._onBattery = !bat.charging;
      bat.addEventListener('chargingchange', apply);
      this._batteryUnsub = () => bat.removeEventListener('chargingchange', apply);
      this.syncRendererContextIfNeeded();
    }).catch(() => {
      this._onBattery = isMobile();
    });
  }

  private syncRendererContextIfNeeded(): void {
    if (!this.canvas || !this.renderer) return;
    if (this.rendererContextKey() === this._rendererContextKey) {
      this._rendererContextDirty = false;
      return;
    }
    if (this.chatDirector.speaking) {
      this._rendererContextDirty = true;
      return;
    }
    this.recreateRendererContext();
  }

  private recreateRendererContext(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.renderer = new THREE.WebGLRenderer(this.getRendererContextAttributes());
    this._rendererContextKey = this.rendererContextKey();
    this._rendererContextDirty = false;
    this.renderer.setClearColor(0x000000, 0);
    const ratio = this.getTargetPixelRatio();
    const width = this.lastRenderWidth || (typeof window !== 'undefined' ? window.innerWidth : 1);
    const height = this.lastRenderHeight || (typeof window !== 'undefined' ? window.innerHeight : 1);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.LinearToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.postFx.init(this.renderer, this.scene, this.camera);
    this.postFx.applyConfig();
    this.postFx.resize(width, height, ratio);
    if (this.currentVRM || this._sceneInitialized) {
      this.syncSceneToNewRenderer();
    }
    this.renderFrameNow();
  }

  public attachCanvas(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas && this.renderer) {
      if (!this.animFrameId && (this.currentVRM || this._sceneInitialized)) {
        this.startAnimation();
      }
      return;
    }

    const prevCamPos = this.camera ? this.camera.position.clone() : null;
    const prevCamTarget = this.controls ? this.controls.target.clone() : null;

    // HMR 与重挂载防御：清理旧动画循环与旧 WebGL 实例，防止上下文泄露或循环叠加卡死
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    window.removeEventListener('resize', this.handleResize);

    this.canvas = canvas;

    const storedEnabled = loadPostFxEnabledFromStorage();
    this.postFx.config = {
      enabled: storedEnabled ?? APP_CONFIG.postfx.enabled,
      bloom: { ...APP_CONFIG.postfx.bloom },
      vignette: { ...APP_CONFIG.postfx.vignette },
      toneMapping: { ...APP_CONFIG.postfx.toneMapping },
      bc: { ...APP_CONFIG.postfx.bc },
      hs: { ...APP_CONFIG.postfx.hs },
    };

    this.bindBatteryPowerPreference();
    this.renderer = new THREE.WebGLRenderer(this.getRendererContextAttributes());
    this._rendererContextKey = this.rendererContextKey();
    this.renderer.setClearColor(0x000000, 0);

    const ratio = this.getTargetPixelRatio();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.lastRenderWidth = window.innerWidth;
    this.lastRenderHeight = window.innerHeight;
    this.renderer.toneMapping = THREE.LinearToneMapping;  // ponytail: 保持原 toneMapping,postfx 不接管 (避免双重映射)
    this.renderer.toneMappingExposure = 1.08;

    this.postFx.init(this.renderer, this.scene, this.camera);
    // PostFX 开关会改默认帧缓冲是否需要 MSAA，必要时重建上下文；同时刷新 pixelRatio
    this.postFx.onEnabledChange = () => {
      this.syncRendererContextIfNeeded();
      this.updatePixelRatio();
    };
    this.postFx.applyConfig();
    this.postFx.resize(window.innerWidth, window.innerHeight, ratio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.controls = new OrbitControls(this.camera, canvas);

    const savedPitch = loadSavedCameraPitch();
    const defaultTarget = new THREE.Vector3(...APP_CONFIG.camera.defaultTarget);
    const target = (prevCamTarget && (this.currentVRM || this._sceneInitialized))
      ? prevCamTarget
      : defaultTarget;
    this.controls.target.copy(target);

    if (prevCamPos && (this.currentVRM || this._sceneInitialized)) {
      this.camera.position.copy(prevCamPos);
    } else if (savedPitch) {
      const dist = savedPitch.distance ?? getDefaultCameraDistance();
      this.camera.position.set(...computeCameraPositionFromPitch(savedPitch.pitch, dist, target));
    } else {
      this.camera.position.set(...computeDefaultCameraPosition());
    }
    this.camera.updateProjectionMatrix();

    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.enablePan = false; // 彻底禁用平移相机 (Pan)，相机焦点永远锁定在角色身上，杜绝镜头乱晃漂移
    this.controls.minDistance = APP_CONFIG.camera.defaultMinDistance;
    this.controls.maxDistance = APP_CONFIG.camera.defaultMaxDistance;
    this.controls.minPolarAngle = APP_CONFIG.camera.minPolarAngle;
    this.controls.maxPolarAngle = APP_CONFIG.camera.maxPolarAngle;

    // 禁用 OrbitControls 左键与右键平移/旋转，OrbitControls 仅保留中键/滚轮缩放，镜头焦点绝对死锁角色
    this.controls.mouseButtons = {
      LEFT: -1 as any,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: -1 as any,
    };
    this.controls.enableRotate = false;
    this.controls.enablePan = false;

    // 监听 OrbitControls change，防抖 500ms 写入 localStorage，
    // 避免在滚轮缩放与阻尼平滑期间每帧同步阻塞写磁盘导致渲染微卡顿
    let cameraSaveReady = false;
    let cameraSaveTimeout: ReturnType<typeof setTimeout> | null = null;
    this.controls.addEventListener('change', () => {
      if (!cameraSaveReady) return;
      if (cameraSaveTimeout !== null) {
        clearTimeout(cameraSaveTimeout);
      }
      cameraSaveTimeout = setTimeout(() => {
        cameraSaveTimeout = null;
        this.saveCurrentCameraPitch();
      }, 500);
    });
    setTimeout(() => { cameraSaveReady = true; }, 2000);

    window.addEventListener('resize', this.handleResize);
    this.__dev_expose_once();

    // 插件化挂载多端统一交互控制器 (修饰键检测、指针手势拖拽、光标反馈与持久化)
    // ponytail: 3 个 3D 引导轨 (TurnGuide + PitchGuide + CameraYGuide) 全在 InteractionController 内管理,
    // 这里只透传回调 (camera + setCameraYOffset) + 透传 scene/controls/motionPipeline。
    this.interaction.bindCanvas(canvas, {
      scene: this.scene,
      controls: this.controls,
      camera: this.camera,
      motionPipeline: this.motionPipeline,
      onSaveBodyYaw: () => this.saveCurrentBodyYaw(),
      onSaveCameraPitch: () => this.saveCurrentCameraPitch(),
      onSetCameraYOffset: (offset) => this.setCameraYOffset(offset),
    });

    if (this.canvas) {
      this.canvas.style.filter = 'none';
    }

    // 若当前已有场景对象或已加载模型，执行新 WebGL 上下文的自愈与材质/纹理重建同步
    if (this.currentVRM || this._sceneInitialized) {
      this.syncSceneToNewRenderer();
    }

    // ponytail: 这里初次冷启时不构建场景、不起渲染、不推镜,等 loadVRM 回调里一起初始化；
    // 但在 Vite HMR 重新挂载 canvas 时：模型早已就绪，必须立即唤醒 startAnimation() 接续渲染，杜绝卡死黑屏！
    if (this.currentVRM || this._sceneInitialized) {
      this.startAnimation();
    }
  }



  /** 保存当前人物 bodyTurn 目标自转偏角 */
  public saveCurrentBodyYaw(): void {
    persistBodyYaw(this.motionPipeline.targetYawOffset);
  }

  /** 保存当前相机垂直俯仰角与视距 */
  public saveCurrentCameraPitch(): void {
    if (!this.controls) return;
    persistCameraPitch({
      pitch: this.controls.getPolarAngle(),
      distance: this.controls.getDistance(),
    });
  }

  /**
   * 将持久化的人物 bodyTurn 目标角度还原至 VRM 实例与动作管线
   */
  private applySavedBodyYawToVRM(vrm: VRM): void {
    const savedYaw = loadSavedBodyYaw();
    if (savedYaw !== null) {
      const isVrm0 = vrm.meta?.metaVersion === '0';
      const baseYaw = isVrm0 ? Math.PI : 0;
      vrm.scene.rotation.y = baseYaw + savedYaw;
      this.motionPipeline.targetYawOffset = savedYaw;
      this.motionPipeline.resetLocomotion();
    }
  }

  /**
   * 当 WebGL 上下文在 HMR 或重新挂载重建时，深度同步所有 Mesh、MToon 材质、纹理与阴影
   */
  private syncSceneToNewRenderer(): void {
    if (!this.renderer) return;

    // 1. 深度遍历场景所有 Mesh，通知新 WebGLContext 重新编译着色器与重新上传显存纹理
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          if (m) {
            m.needsUpdate = true;
            for (const k in m) {
              const val = (m as any)[k];
              if (val && (val as THREE.Texture).isTexture) {
                (val as THREE.Texture).needsUpdate = true;
              }
            }
            if ((m as any).uniforms) {
              for (const uk in (m as any).uniforms) {
                const uVal = (m as any).uniforms[uk]?.value;
                if (uVal && (uVal as THREE.Texture).isTexture) {
                  (uVal as THREE.Texture).needsUpdate = true;
                }
              }
            }
          }
        });
      }
    });

    // 2. 重新应用 VRM MToon 材质的深度分层防穿模 (polygonOffset)、边缘光、阴影色与独立饱和度 Uniform
    if (this.currentVRM) {
      this.materialManager.optimize(this.currentVRM);
    }

    // 3. 刷新地面阴影材质
    this.shadow.markNeedsUpdate();

    // 4. 着色器预热编译，杜绝首帧错误与丢帧
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch (compileErr) {
      console.warn('[VRMEngine] compile warning during WebGL context re-sync:', compileErr);
    }
  }

  /**
   * 同步立即补绘当前帧：
   * 在 setSize 重建 WebGL DrawingBuffer 后立即同步执行，
   * 确保在交还事件循环给浏览器/OS合成器之前，画布就已经被渲染填满，
   * 从根源彻底消灭因 WebGL setSize 清空机制导致的“一闪而过透明背景”与“一直拖一直闪”！
   */
  public renderFrameNow(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    try {
      if (this.postFx.isReady() && this.postFx.config.enabled) {
        this.postFx.render(0.016);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    } catch (err) {
      // 容错保护：避免 resize 期间偶发着色器未就绪抛出异常
      console.warn('[VRMEngine] renderFrameNow skipped frame:', err);
    }
  }

  /**
   * 真正执行物理分辨率与 GPU Framebuffer 重建：
   * 采用逐帧 rAF 合并（Vsync Coalescing）：
   * 在每一次显示器刷新周期内仅执行一次精确的物理尺寸变更与同步绘制，
   * 彻底根除因 CSS 双线性拉伸延迟产生的“果冻拉伸/忽胖忽瘦”形变感，
   * 同时 renderFrameNow() 保证绝对零闪烁。
   */
  private applyResize = (newWidth: number, newHeight: number): void => {
    if (!this.renderer || !this.camera) return;
    if (newWidth <= 0 || newHeight <= 0) return;
    if (this.lastRenderWidth === newWidth && this.lastRenderHeight === newHeight) return;

    this.lastRenderWidth = newWidth;
    this.lastRenderHeight = newHeight;

    this.camera.aspect = newWidth / newHeight;
    this.camera.updateProjectionMatrix();

    const ratio = this.getTargetPixelRatio();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(newWidth, newHeight);
    if (this.postFx.isReady()) {
      this.postFx.resize(newWidth, newHeight, ratio);
    }

    // ★ 关键防闪核心：在 WebGL 清空 DrawingBuffer 后，同步立即将场景补绘上屏！
    this.renderFrameNow();
  };

  /**
   * 视口尺寸同步策略（单主循环原生高刷驱动）：
   * 1. 彻底消除双重 rAF 竞争：
   *    原本 handleResize 自己启动一个 requestAnimationFrame，与 startAnimation 的 rAF
   *    在同一帧内两度争抢 GPU 并导致 PostFX 每一帧被双重重绘（30+ 次离屏 Pass），造成严重掉帧卡顿；
   * 2. 现改由单一的主渲染循环 (animate) 统一驱动：
   *    handleResize 仅同步更新相机 aspect；主循环在每一帧开头检测窗口尺寸变化，
   *    一帧内仅执行一次 setSize 并紧接着随 VRM 物理动画直接上屏，保证 120Hz 丝滑流畅、零闪烁、零形变！
   */
  private handleResize = () => {
    if (!this.camera) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= 0 || h <= 0) return;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    // 当主动画循环未在运行时（如挂起或模型加载前），兜底同步重绘
    if (this.animFrameId === null || this.isRenderingSuspended) {
      this.applyResize(w, h);
    }
  };

  // ── 外部控制代理 API ──
  public setLineworkTheme(theme: LineworkTheme, persist: boolean = true): void {
    this.lineworkWorld.setTheme(theme, this.scene);
    this.updateShadowForTheme(theme === 'dark');
    // ponytail: shadowPlane 现在带 radial alpha mask, 边缘自然 fade 到全透明,
    // 不再有"12x12 大网格污染穿透位图"的隐患, transparent 下保持显示让 directional
    // 影子投到带 mask 的 plane 上, 边界软渐隐 (ani 风格)。visibility 不再随 theme 切换。
    if (this.shadow.group) this.shadow.group.visible = true;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('scene-transparent', theme === 'transparent');
    }
    // 切换到透明背景时立即应用专属定死镜头；切回普通场景时恢复正常控制与 FOV
    this.fitCamera();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('scene-theme-changed', { detail: theme }));
    }
    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(SCENE_THEME_KEY, theme);
      } catch { }
    }
    this.syncRendererContextIfNeeded();
  }

  public updateShadowForTheme(isDark: boolean): void {
    this.shadow.updateOpacity(isDark);
  }

  public getLineworkTheme(): LineworkTheme {
    return this.lineworkWorld.currentTheme;
  }

  public setLight(key: string, enabled: boolean, value: number): void {
    this.lighting.setLight(key, enabled, value);
  }

  public setGlobalLight(mult: number): void {
    this.lighting.setGlobalMult(mult);
  }

  public setMaterialSaturation(settings: Partial<MaterialSaturationSettings>): void {
    this.materialManager.setSaturation(settings);
  }

  public applyMaterialPreset(presetKey: MaterialSaturationPresetKey): void {
    this.materialManager.applyPreset(presetKey);
  }

  public setClothingVisibility(part: string, visible: boolean): void {
    this.materialManager.setPartVisibility(part, visible);
    this.notifyHeightChange();
  }

  public setPartVisibility(part: string, visible: boolean): void {
    this.materialManager.setPartVisibility(part, visible);
    this.notifyHeightChange();
  }

  public resetAllPartsVisibility(): void {
    this.materialManager.resetAllPartsVisibility();
    this.notifyHeightChange();
  }

  public undressAllClothing(): void {
    this.materialManager.undressAllClothing();
    this.notifyHeightChange();
  }

  public dressAllClothing(): void {
    this.materialManager.dressAllClothing();
    this.notifyHeightChange();
  }

  public setCategoryVisibility(category: ModelPartCategory, visible: boolean): void {
    this.materialManager.setCategoryVisibility(category, visible);
    this.notifyHeightChange();
  }

  // ── 骨骼体型微调系统 (Bone Morphing) ──
  public setBodyPartScale(part: import('@/config').BodyMorphPartKey, value: number): void {
    this.bodyMorph.setPart(part, value);
    this.notifyHeightChange();
  }

  public getBodyPartScale(part: import('@/config').BodyMorphPartKey): number {
    return this.bodyMorph.getPart(part);
  }

  public getBodyMorphConfig(): import('@/config').BodyMorphConfig {
    return this.bodyMorph.getConfig();
  }

  public resetBodyMorph(): void {
    this.bodyMorph.reset();
    this.notifyHeightChange();
  }

  public resetPostFx(): void {
    this.postFx.resetToDefault();
  }

  // 保持旧接口 100% 兼容
  public setHipScale(scale: number): void {
    this.bodyMorph.setPart('hips', scale);
  }

  public getHipScale(): number {
    return this.bodyMorph.getPart('hips');
  }

  public setBustScale(scale: number): void {
    this.bodyMorph.setPart('bust', scale);
  }

  public getBustScale(): number {
    return this.bodyMorph.getPart('bust');
  }

  public setEnableBodyTurn(enabled: boolean): void {
    this.enableBodyTurn = enabled;
  }

  public getEnableBodyTurn(): boolean {
    return this.enableBodyTurn;
  }

  public setEnableGaze(enabled: boolean): void {
    this.gazeController.enabled = enabled;
  }

  public getEnableGaze(): boolean {
    return this.gazeController.enabled;
  }

  /** DevDrawer / P0b: thin forward to EmagePlayer.getPerfSnapshot(). */
  public getEmagePerfSnapshot() {
    return this.emagePlayer.getPerfSnapshot();
  }

  public clearEmagePerfProfiles(): void {
    this.emagePlayer.clearPerfProfiles();
  }

  public setEmagePreferProfileStages(prefer: boolean): void {
    this.emagePlayer.preferProfileStages = prefer;
  }

  public setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * ponytail: 临时偏移相机 Y (调试视角用, 修饰键+滑条触发)。
   * 同时平移 camera.position.y 和 controls.target.y (相对偏移),
   * OrbitControls 内部 spherical 不变 (两向量同步移动), 用户输入保持不变。
   * offset 米, 正向上抬 (相机+目标一起上移, 视觉上场景下移), 负向下压。
   */
  public setCameraYOffset(offset: number): void {
    if (!this.controls) return;
    const delta = offset - this._cameraYOffsetAccum;
    this.controls.target.y += delta;
    this.camera.position.y += delta;
    this._cameraYOffsetAccum = offset;
    // ponytail: 单向数据流 — vrmEngine 是 source of truth, 写 localStorage 并通知 App 同步 state
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(CAMERA_Y_OFFSET_KEY, String(offset));
      } catch { }
      window.dispatchEvent(new CustomEvent('camera-y-offset-change', { detail: { offset } }));
    }
  }
  private _cameraYOffsetAccum = 0;

  // ponytail: devDrawer 调相机推拉上下限 — minDistance/maxDistance 是 OrbitControls
  // 的钳位属性,clamp 当前 camera-to-target 距离落在新范围内,避免改完后视角"跳"。
  public setCameraDistanceRange(minDist: number, maxDist: number): void {
    if (!this.controls) return;
    this.controls.minDistance = Math.max(0.1, minDist);
    this.controls.maxDistance = Math.max(this.controls.minDistance + 0.1, maxDist);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const current = offset.length();
    if (current < this.controls.minDistance || current > this.controls.maxDistance) {
      const clamped = Math.min(Math.max(current, this.controls.minDistance), this.controls.maxDistance);
      offset.setLength(clamped);
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
    }
  }

  public fitCamera(): void {
    if (this.controls) {
      this.controls.enabled = true;
    }
    const head = this.currentVRM?.humanoid?.getNormalizedBoneNode('head');
    if (head && this.controls) {
      const p = new THREE.Vector3();
      head.getWorldPosition(p);
      const target = new THREE.Vector3(p.x, p.y - 0.25, p.z);
      this.controls.target.copy(target);
      // 距离按当前 FOV + shotExtent 算，结合保存的俯仰角 pitch 与视距还原
      const savedPitch = loadSavedCameraPitch();
      const fovRad = (this.camera.fov * Math.PI) / 180;
      const defaultDist = APP_CONFIG.camera.defaultShotExtent / (2 * Math.tan(fovRad / 2));
      const dist = savedPitch?.distance ?? defaultDist;
      const pitch = savedPitch ? savedPitch.pitch : getDefaultCameraPitch();
      this.camera.position.set(...computeCameraPositionFromPitch(pitch, dist, target));
      this.controls.update();

      // ponytail: 应用持久化的 camera Y 偏移 (调试视角用), 避免 outfit swap / 重置
      // 覆盖默认 fitCamera 的 camera.position. accum 也要同步, 否则下次 setCameraYOffset
      // 会算 delta 出错.
      if (typeof window !== 'undefined') {
        try {
          const raw = window.localStorage.getItem(CAMERA_Y_OFFSET_KEY);
          if (raw !== null) {
            const v = Number(raw);
            if (Number.isFinite(v) && v !== 0) {
              this._cameraYOffsetAccum = 0;       // 重置 accum 让 delta = v - 0 = v
              this.setCameraYOffset(v);
            }
          }
        } catch { }
      }
    }
  }

  public setExpression(name: string): void {
    if (!this.currentVRM?.expressionManager) return;
    this.manualExpression = name === 'neutral' ? null : name;
    const mgr = this.currentVRM.expressionManager;
    const presets: VRMExpressionPresetName[] = [
      'happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral', 'aa', 'ih', 'ou', 'ee', 'oh'
    ];
    presets.forEach((p) => {
      try { mgr.setValue(p, 0); } catch { }
    });
    if (name !== 'neutral') {
      try { mgr.setValue(name as VRMExpressionPresetName, 1); } catch { }
    }
    mgr.update();
  }

  // ── 模型生命周期加载 ──
  /**
   * ponytail: 加载 (或替换) 当前 VRM — 返回 Promise 让 swap 能 await bind 完成。
   * options.preserveMotion=true 时自动 capture→load→restore 动画状态
   * (动作/表情/视线/弹簧骨/转身/IK),同 swapOutfit 的语义。
   * Existing callers may ignore the return value.
   */
  public loadVRM(
    url: string,
    filename = '小蠢 (xiaochun_v1)',
    options: LoadVRMOptions = {},
  ): Promise<VRM> {
    const preserveMotion = !!options.preserveMotion;
    const previousVrm = preserveMotion ? this.currentVRM : null;
    this.currentUrl = url;

    // ponytail: 非 preserveMotion 时(冷启动/完全重置)，立即清理旧模型并归零动作
    if (this.currentVRM && !preserveMotion) {
      this.scene.remove(this.currentVRM.scene);
      VRMUtils.deepDispose(this.currentVRM.scene);
      this.currentVRM = null;
      this.notifyReady(false);
      this.vrmaPlayer.stop();
      try { this.motionPipeline.universalMotion.stop(0); } catch { /* ok if idle */ }
      this.motionTransition.stop();
      this.emagePlayer.stop();
      this.manualExpression = null;
      this.motionPipeline.setMotionSource('idle', 0.01);
    }

    // 强制清理场景中历史遗留的任何 3D 标尺 mesh (彻底杜绝蓝色方块残留)
    const oldRulers: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if (obj.name && (obj.name.includes('heightRuler') || obj.name.includes('rulerMesh'))) {
        oldRulers.push(obj);
      }
    });
    oldRulers.forEach((m) => {
      this.scene.remove(m);
      if ((m as THREE.Mesh).geometry) (m as THREE.Mesh).geometry.dispose();
    });
    this.chatDirector.resetClipCache();

    return new Promise<VRM>((resolve, reject) => {
      this.loader.load(
        url,
        async (gltf) => {
          const vrm = gltf.userData.vrm as VRM;
          if (!vrm) {
            alert(this.translateSync!('error.loadVrmFailed'));
            if (!preserveMotion) this.notifyReady(false);
            reject(new Error('VRM missing in gltf.userData'));
            return;
          }

          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          // ponytail: combineSkeletons 取代了 removeUnnecessaryJoints (three-vrm 新版弃用旧 API)。
          VRMUtils.combineSkeletons(gltf.scene);

          vrm.scene.traverse((obj) => {
            obj.frustumCulled = false;
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              mesh.castShadow = true;
              const meshName = (mesh.name || '').toLowerCase();
              mesh.receiveShadow = !(meshName.includes('face') || meshName.includes('head') || meshName.includes('eye'));
            }
          });

          // 委托材质管理器进行 MToon 优化与 Shader 注入
          this.materialManager.optimize(vrm);
          VRMUtils.rotateVRM0(vrm);
          vrm.scene.position.set(0, 0, 0);
          if (vrm.meta?.metaVersion !== '0') {
            vrm.scene.rotation.y = 0;
          }

          this.resetBones(vrm);
          vrm.scene.updateMatrixWorld(true);

          // 角色出生点 (从 config.model.spawn 读 x/z, y 在 floor snap 后再加偏移)
          const spawn = APP_CONFIG.model.spawn;
          vrm.scene.position.set(spawn.x, 0, spawn.z);
          vrm.scene.updateMatrixWorld(true);

          const bbox = new THREE.Box3().setFromObject(vrm.scene);
          vrm.scene.position.y += -bbox.min.y + spawn.y;
          this.vrmBaseSceneY = vrm.scene.position.y;
          vrm.scene.updateMatrixWorld(true);

          // ponytail: 无缝换装核心时序 —— 旧模型全速运动直到此时，新模型在内存就绪后原子交接
          if (preserveMotion && previousVrm) {
            // 1. 在交接瞬间抓取旧模型的最新姿态/时间戳/表情/惯性
            const swapState = this.captureAnimationState();

            // 2. 暂停/解绑旧动画控制器
            this.vrmaPlayer.stop();
            try { this.motionPipeline.universalMotion.stop(0); } catch { /* ok if idle */ }
            this.motionTransition.stop();
            this.emagePlayer.pause();

            // 3. 将所有控制器重定向绑定到新模型
            this.motionPipeline.bind(vrm);
            this.vrmaPlayer.resetHipsRest();
            this.motionPipeline.finalPose.sampleFromVRM(vrm);
            this.bodyMorph.bind(vrm);
            this.applySpringBoneTuning(vrm);
            if (typeof window !== 'undefined') {
              (window as any).emagePlayer = this.emagePlayer;
              (window as any).vrmEngine = this;
            }

            // 4. 在新模型上屏前，先在内存中预先恢复姿态与动画帧 (seek 到精准时刻)
            try {
              await this.restoreAnimationState(swapState, vrm);
            } catch (e) {
              console.warn('[vrmEngine] restoreAnimationState before scene attach failed:', e);
            }
            vrm.scene.updateMatrixWorld(true);

            // 4b. 体型差：对齐旧髋世界高度，再缓回真实贴地 baseY（减轻穿脱瞬间抖）
            const trueFloorY = this.vrmBaseSceneY;
            this.applyOutfitHeightContinuity(previousVrm, vrm, trueFloorY);

            // 5. 同步原子切换：移除旧模型、挂入已处于正确动作姿势的新模型
            this.scene.remove(previousVrm.scene);
            VRMUtils.deepDispose(previousVrm.scene);
            this.currentVRM = vrm;
            this.scene.add(vrm.scene);
            this.notifyReady(true);

            if (!this.emagePlayer.ready) void this.emagePlayer.ensureLoaded();
            preloadWebLLM();

            if (this.controls) {
              this.renderSingleFrame();
            }
            void this.chatDirector.warmThinkingClip(vrm, this.vrmaPlayer);
            resolve(vrm);
            return;
          }

          // 常规/冷启动加载路径
          this.currentVRM = vrm;
          this.scene.add(vrm.scene);
          this.notifyReady(true);

          this.motionPipeline.bind(vrm);
          this.vrmaPlayer.resetHipsRest();
          this.motionPipeline.finalPose.sampleFromVRM(vrm);
          this.bodyMorph.bind(vrm);
          this.applySpringBoneTuning(vrm);
          this.applySavedBodyYawToVRM(vrm);
          if (typeof window !== 'undefined') {
            (window as any).emagePlayer = this.emagePlayer;
            (window as any).vrmEngine = this;
          }

          if (!this.emagePlayer.ready) void this.emagePlayer.ensureLoaded();
          preloadWebLLM();

          if (this.controls && !this._sceneInitialized) {
            this._sceneInitialized = true;
            this.fitCamera();
            const storedTheme = resolveInitialSceneTheme();
            this.lineworkWorld.build(this.scene, storedTheme);
            this.updateShadowForTheme(storedTheme === 'dark');
            this.startAnimation();
            this.cinematicIntro(1100);
          } else if (this.controls) {
            this.fitCamera();
            this.renderSingleFrame();
          }
          void this.chatDirector.warmThinkingClip(vrm, this.vrmaPlayer);
          resolve(vrm);
        },
        (progress) => {
          if (progress.lengthComputable) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            // ponytail: HTTP fetch 字节进度 — swapOutfit 没拦截到这一步,所以这里直接
            // emit 到 onSwapProgress (按钮) + onLoadingChange (overlay,仅 cold-start)。
            const state = { active: true as const, subtitleKey: preserveMotion ? 'swappingOutfit' : 'loadingModel', subtitleVars: { name: filename }, progress: pct };
            this.onSwapProgress?.(state);
            if (!preserveMotion) this.onLoadingChange?.(state);
          }
        },
        (error) => {
          console.error('加载 VRM 错误:', error);
          alert(this.translateSync!('error.loadFailed'));
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  /**
   * 应用胸部等 SpringBone 动力学物理调优：
   * 将 VRoid 官方默认的高刚度硬塑料参数 (stiffness 0.75) 优化为富有弹性、反应自然的仿生乳摇效果。
   */
  public applySpringBoneTuning(vrm: VRM | null = this.currentVRM): void {
    const mgr = vrm?.springBoneManager;
    if (!mgr) return;
    const cfg = APP_CONFIG.springBone.bust;
    for (const joint of mgr.joints) {
      const name = joint.bone?.name ?? '';
      if (/bust/i.test(name)) {
        const isTip = /bust2/i.test(name);
        joint.settings.stiffness = isTip ? cfg.stiffness * 0.85 : cfg.stiffness;
        joint.settings.dragForce = cfg.dragForce;
        joint.settings.gravityPower = cfg.gravityPower;
        if (cfg.hitRadius > 0) {
          joint.settings.hitRadius = cfg.hitRadius;
        }
      }
    }
    this.windForce.resetGravityCache();
  }

  /**
   * 动态调节胸部弹簧骨骼刚度与阻尼物理属性
   */
  public updateBustSpringPhysics(params?: {
    stiffness?: number;
    dragForce?: number;
    gravityPower?: number;
  }): void {
    if (!params) {
      this.applySpringBoneTuning();
      return;
    }
    const mgr = this.currentVRM?.springBoneManager;
    if (!mgr) return;
    for (const joint of mgr.joints) {
      const name = joint.bone?.name ?? '';
      if (/bust/i.test(name)) {
        const isTip = /bust2/i.test(name);
        if (params.stiffness !== undefined) {
          joint.settings.stiffness = isTip ? params.stiffness * 0.85 : params.stiffness;
        }
        if (params.dragForce !== undefined) {
          joint.settings.dragForce = params.dragForce;
        }
        if (params.gravityPower !== undefined) {
          joint.settings.gravityPower = params.gravityPower;
        }
      }
    }
  }

  /** Snapshot animation / expression / gaze / spring state before whole-VRM outfit reload. */
  public captureAnimationState(): OutfitSwapState {
    const vrm = this.currentVRM;
    const vrmaPlayback = this.vrmaPlayer.getPlayback();
    const emagePlayback = this.emagePlayer.getPlayback();
    const universalPlayback = this.motionPipeline.universalMotion.getPlayback();
    const writer = this.motionPipeline.getLiveWriter();
    const emageActive = this.emagePlayer.isPlaying() || this.emagePlayer.streamingMotionActive;
    const thinking = this.motionPipeline.vrma.traits.thinkSway || this.motionPipeline.idle.traits.thinkSway;

    let motionSource: OutfitSwapState['motionSource'] = 'idle';
    if (writer === 'clip') motionSource = 'motion';
    else if (emageActive || writer === 'emage') motionSource = 'emage';
    else if (thinking) motionSource = 'thinking';
    else if (writer === 'vrma') motionSource = 'vrma';

    return {
      motionSource,
      vrmaUrl: this.vrmaPlayer.getLastUrl(),
      vrmaBuffer: this.vrmaPlayer.getLastBuffer(),
      vrmaTime: vrmaPlayback?.time ?? 0,
      vrmaLoop: this.vrmaPlayer.isLooping(),
      thinking,
      emageActive,
      emageStreaming: this.emagePlayer.streamingMotionActive,
      emageTime: emagePlayback?.time ?? this.emagePlayer.getCurrentTime(),
      emagePlaying: this.emagePlayer.isPlaying(),
      universalUrl: this.motionPipeline.universalMotion.getLastUrl(),
      universalBuffer: this.motionPipeline.universalMotion.getLastBuffer(),
      universalTime: universalPlayback?.time ?? 0,
      universalLoop: !!(this.motionPipeline.universalMotion.getCurrentOptions().loop),
      blendshapes: captureExpressions(vrm),
      manualExpression: this.manualExpression,
      gaze: this.gazeController.captureSwapState(),
      lookAtTarget: captureLookAtTarget(vrm),
      springBones: captureSpringBones(vrm),
      sceneYaw: vrm?.scene.rotation.y ?? 0,
      metaVersion: vrm?.meta?.metaVersion,
      bodyTurn: this.bodyTurn.captureSwapState(),
      footIK: this.footIK.captureSwapState(),
    };
  }

  /** Re-apply captured state after a new VRM has been bound (can pre-restore onto targetVrm before scene attach). */
  public async restoreAnimationState(state: OutfitSwapState, targetVrm?: VRM): Promise<void> {
    const vrm = targetVrm ?? this.currentVRM;
    if (!vrm) return;

    restoreExpressions(vrm, state.blendshapes);
    if (state.manualExpression) {
      this.manualExpression = state.manualExpression;
      this.setExpression(state.manualExpression);
    }
    if (state.gaze) {
      this.gazeController.restoreSwapState(state.gaze);
    }
    if (vrm.lookAt) {
      vrm.lookAt.target = this.gazeController.gazeTarget;
      if (state.lookAtTarget) {
        this.gazeController.gazeTarget.position.set(...state.lookAtTarget);
      }
    }
    restoreSpringBones(vrm, state.springBones);

    // Facing: loadVRM preserves VRM 0.0 Math.PI rotation; adapt relative yaw across versions.
    const prevBaseYaw = state.metaVersion === '0' ? Math.PI : 0;
    const targetBaseYaw = vrm.meta?.metaVersion === '0' ? Math.PI : 0;
    vrm.scene.rotation.y = targetBaseYaw + ((state.sceneYaw ?? 0) - prevBaseYaw);
    if (state.bodyTurn) this.bodyTurn.restoreSwapState(state.bodyTurn);
    if (state.footIK) this.footIK.restoreSwapState(state.footIK);

    // EMAGE: bones rebound in loadVRM; resume buffer without forcing idle.
    if (state.emageActive) {
      if (state.emageTime > 0) {
        try { this.emagePlayer.seek(state.emageTime); } catch (e) {
          console.warn('[outfitSwap] EMAGE seek failed:', e);
        }
      }
      if (state.emagePlaying || state.emageStreaming) {
        this.emagePlayer.resume();
      }
      this.motionPipeline.setMotionSource('emage', 0.01);
    }

    // Thinking clip (buffer) — re-warm then seek.
    if (state.thinking || state.motionSource === 'thinking') {
      try {
        await this.chatDirector.warmThinkingClip(vrm, this.vrmaPlayer);
        let buf = state.vrmaBuffer;
        if (!buf) {
          const res = await fetch('/vrm/motion/thinking.vrma');
          if (res.ok) buf = await res.arrayBuffer();
        }
        if (buf) {
          const clip = await this.vrmaPlayer.parseBufferToClip(buf, vrm);
          this.motionPipeline.playThinkingClip(clip, vrm, 0.01);
          this.vrmaPlayer.seek(state.vrmaTime);
        } else {
          this.motionPipeline.setIdleThinkSway(true);
        }
      } catch (e) {
        console.warn('[outfitSwap] thinking restore failed:', e);
      }
      return;
    }

    // VRMA from in-memory buffer or URL
    if (state.motionSource === 'vrma' && (state.vrmaBuffer || state.vrmaUrl)) {
      try {
        let buf = state.vrmaBuffer;
        if (!buf && state.vrmaUrl) {
          const res = await fetch(state.vrmaUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buf = await res.arrayBuffer();
        }
        if (buf) {
          const clip = await this.vrmaPlayer.parseBufferToClip(buf, vrm);
          if (state.vrmaLoop) {
            this.vrmaPlayer.playLoop(clip, vrm, 0.01);
          } else {
            this.vrmaPlayer.playClipOnMixer(clip, vrm, 0.01);
          }
          this.vrmaPlayer.seek(state.vrmaTime);
          this.motionPipeline.setMotionSource('vrma', 0.01);
        }
      } catch (e) {
        console.warn('[outfitSwap] VRMA restore failed:', e);
      }
      return;
    }

    // Universal pipeline motion (buffer or URL)
    if (state.motionSource === 'motion' && (state.universalBuffer || state.universalUrl)) {
      try {
        const lookAtOffsets = this.gazeController.getLookAtOffsets();
        const prevOpts = this.motionPipeline.universalMotion.getCurrentOptions();
        const motionInput = state.universalBuffer ?? state.universalUrl!;
        await this.motionPipeline.playMotion(
          vrm,
          motionInput,
          {
            ...prevOpts,
            loop: state.universalLoop,
            fadeDuration: 0.01,
            onEnd: prevOpts.onEnd,
          },
          lookAtOffsets,
        );
        this.motionPipeline.universalMotion.seek(state.universalTime);
        this.motionPipeline.setMotionSource('motion', 0.01);
      } catch (e) {
        console.warn('[outfitSwap] universal motion restore failed:', e);
      }
      return;
    }

    if (!state.emageActive) {
      this.motionPipeline.setMotionSource('idle', 0.01);
    }
  }

  /**
   * ponytail: 保留动画状态地加载新模型 — outfit swap / 上传文件 / 冷启动共用。
   * 非-addon URL 走 loadVRM(内置 capture/restore);addon 走 worker 合成路径。
   * 冷启动调到这里时 currentVRM 为 null,但 addon 路径仍然要走 (loadVRM 接 .vrmaddon URL 会挂),
   * 所以 addon 检测放在 currentVRM 检查之前。
   */
  public async swapOutfit(url: string, filename: string): Promise<void> {
    // ponytail: addon URL 走 composeOutfit 路径(worker 内 unzip + 合成完整 GLB),
    // 普通 URL (.vrm / blob:) 走 loadVRM 直通。.vrmbase 是 cold-start 的 whole-glb zip,
    // 跟 .vrmaddon 走同一条 worker 通道。
    //
    // 进度事件分发:
    //   - onSwapProgress — 始终发,TopHeader 按钮 spinner 用。
    //   - onLoadingChange — 只在 preserveMotion=false 时发(冷启动),LoadingOverlay 用。
    //   中途换装 (preserveMotion=true) overlay 已被 loadVRM 跳过,只靠按钮反馈。
    const preserveMotion = this.currentVRM !== null;
    const phaseLabel = preserveMotion ? 'swappingOutfit' : 'loadingModel';
    const subtitleVars = { name: filename };
    if (!preserveMotion) {
      this.onLoadingChange?.({ active: true, subtitleKey: phaseLabel, subtitleVars, progress: 0 });
    }
    this.onSwapProgress?.({ active: true, subtitleKey: phaseLabel, subtitleVars, progress: 0 });
    try {
      if (url.endsWith('.vrmaddon') || url.endsWith('.vrmbase')) {
        // ponytail: 从 config.ts 找 sha — addon 按文件名后缀匹配(addon source 的 basename
        // = addon key 在 config 里),base 直接读 defaultSha。找不到就传空,worker 跳过 cache。
        const addonKey = Object.keys(APP_CONFIG.model.addons).find(
          (k) => APP_CONFIG.model.addons[k].source === url,
        ) ?? null;
        const addonSha = addonKey ? APP_CONFIG.model.addons[addonKey].sha : '';
        const composed = await this.composeVRMFromAddon(url, addonSha, { phaseLabel, subtitleVars, preserveMotion });
        await this.loadVRMFromBuffer(composed, filename, { preserveMotion });
        this.notifyOutfitChange(addonKey);
        return;
      }
      if (!this.currentVRM) {
        await this.loadVRM(url, filename);
        this.notifyOutfitChange('__upload__');
        return;
      }
      await this.loadVRM(url, filename, { preserveMotion: true });
      this.notifyOutfitChange('__upload__');
    } finally {
      // ponytail: 末尾回调 — 成功 / 失败都发,UI 收起 spinner + overlay。
      // 用 progress:100 而非 0 — 上一版本用 0 让 bar 倒带回 0%,看着像失败。
      this.onSwapProgress?.({ active: false, subtitleKey: '', progress: 100 });
      if (!preserveMotion) {
        this.onLoadingChange?.({ active: false, subtitleKey: '', progress: 100 });
      }
    }
  }

  // ─── Delta 路线 (A 方案) ────────────────────────────────────────────

  /** ponytail: 直接喂 ArrayBuffer 进 GLTFLoader (合成好的 v1_1 GLB)。options.preserveMotion=true 时内联 capture/restore。 */
  public loadVRMFromBuffer(
    buffer: ArrayBuffer,
    filename = '小蠢 (xiaochun_v1)',
    options: LoadVRMOptions = {},
  ): Promise<VRM> {
    this.currentUrl = `data:glb-buffer:${filename}`;
    const preserveMotion = !!options.preserveMotion;
    const previousVrm = preserveMotion ? this.currentVRM : null;

    // ponytail: 非 preserveMotion 时(冷启动/完全重置)，立即清理旧模型并归零动作
    if (this.currentVRM && !preserveMotion) {
      this.scene.remove(this.currentVRM.scene);
      VRMUtils.deepDispose(this.currentVRM.scene);
      this.currentVRM = null;
      this.notifyReady(false);
      this.vrmaPlayer.stop();
      try { this.motionPipeline.universalMotion.stop(0); } catch { /* ok if idle */ }
      this.motionTransition.stop();
      this.emagePlayer.stop();
      this.manualExpression = null;
      this.motionPipeline.setMotionSource('idle', 0.01);
    }

    return new Promise<VRM>((resolve, reject) => {
      this.loader.parse(
        buffer,
        '',
        async (gltf) => {
          const vrm = gltf.userData.vrm as VRM | undefined;
          if (!vrm) {
            reject(new Error('[loadVRMFromBuffer] gltf.userData.vrm is empty'));
            return;
          }

          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          // ponytail: combineSkeletons 取代了 removeUnnecessaryJoints (three-vrm 新版弃用旧 API)。
          VRMUtils.combineSkeletons(gltf.scene);

          vrm.scene.traverse((obj) => {
            obj.frustumCulled = false;
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              mesh.castShadow = true;
              const meshName = (mesh.name || '').toLowerCase();
              mesh.receiveShadow = !(meshName.includes('face') || meshName.includes('head') || meshName.includes('eye'));
            }
          });

          this.materialManager.optimize(vrm);
          VRMUtils.rotateVRM0(vrm);
          vrm.scene.position.set(0, 0, 0);
          if (vrm.meta?.metaVersion !== '0') {
            vrm.scene.rotation.y = 0;
          }

          this.resetBones(vrm);
          vrm.scene.updateMatrixWorld(true);

          // 角色出生点 (从 config.model.spawn 读 x/z, y 在 floor snap 后再加偏移)
          const spawn = APP_CONFIG.model.spawn;
          vrm.scene.position.set(spawn.x, 0, spawn.z);
          vrm.scene.updateMatrixWorld(true);

          const bbox = new THREE.Box3().setFromObject(vrm.scene);
          vrm.scene.position.y += -bbox.min.y + spawn.y;
          this.vrmBaseSceneY = vrm.scene.position.y;
          vrm.scene.updateMatrixWorld(true);

          // ponytail: 无缝换装核心时序 —— 旧模型全速运动直到此时，新模型在内存就绪后原子交接
          if (preserveMotion && previousVrm) {
            // 1. 在交接瞬间抓取旧模型的最新姿态/时间戳/表情/惯性
            const swapState = this.captureAnimationState();

            // 2. 暂停/解绑旧动画控制器
            this.vrmaPlayer.stop();
            try { this.motionPipeline.universalMotion.stop(0); } catch { /* ok if idle */ }
            this.motionTransition.stop();
            this.emagePlayer.pause();

            // 3. 将所有控制器重定向绑定到新模型
            this.motionPipeline.bind(vrm);
            this.vrmaPlayer.resetHipsRest();
            this.motionPipeline.finalPose.sampleFromVRM(vrm);
            this.bodyMorph.bind(vrm);
            this.applySpringBoneTuning(vrm);
            if (typeof window !== 'undefined') {
              (window as any).emagePlayer = this.emagePlayer;
              (window as any).vrmEngine = this;
            }

            // 4. 在新模型上屏前，先在内存中预先恢复姿态与动画帧 (seek 到精准时刻)
            try {
              await this.restoreAnimationState(swapState, vrm);
            } catch (e) {
              console.warn('[vrmEngine] restoreAnimationState before scene attach failed:', e);
            }
            vrm.scene.updateMatrixWorld(true);

            // 4b. 体型差：对齐旧髋世界高度，再缓回真实贴地 baseY（减轻穿脱瞬间抖）
            const trueFloorY = this.vrmBaseSceneY;
            this.applyOutfitHeightContinuity(previousVrm, vrm, trueFloorY);

            // 5. 同步原子切换：移除旧模型、挂入已处于正确动作姿势的新模型
            this.scene.remove(previousVrm.scene);
            VRMUtils.deepDispose(previousVrm.scene);
            this.currentVRM = vrm;
            this.scene.add(vrm.scene);
            this.notifyReady(true);

            if (!this.emagePlayer.ready) void this.emagePlayer.ensureLoaded();
            preloadWebLLM();

            if (this.controls) {
              this.renderSingleFrame();
            }
            void this.chatDirector.warmThinkingClip(vrm, this.vrmaPlayer);
            resolve(vrm);
            return;
          }

          // 常规/冷启动加载路径
          this.currentVRM = vrm;
          this.scene.add(vrm.scene);
          this.notifyReady(true);

          this.motionPipeline.bind(vrm);
          this.vrmaPlayer.resetHipsRest();
          this.motionPipeline.finalPose.sampleFromVRM(vrm);
          this.bodyMorph.bind(vrm);
          this.applySpringBoneTuning(vrm);
          this.applySavedBodyYawToVRM(vrm);
          if (typeof window !== 'undefined') {
            (window as any).emagePlayer = this.emagePlayer;
            (window as any).vrmEngine = this;
          }

          if (!this.emagePlayer.ready) void this.emagePlayer.ensureLoaded();
          preloadWebLLM();

          if (this.controls && !this._sceneInitialized) {
            this._sceneInitialized = true;
            this.fitCamera();
            const storedTheme = resolveInitialSceneTheme();
            this.lineworkWorld.build(this.scene, storedTheme);
            this.updateShadowForTheme(storedTheme === 'dark');
            this.startAnimation();
            this.cinematicIntro(1100);
          } else if (this.controls) {
            this.renderSingleFrame();
          }
          void this.chatDirector.warmThinkingClip(vrm, this.vrmaPlayer);
          resolve(vrm);
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
  }

  /**
   * ponytail: 主线程只发两个 URL 给 vrmWorker — baseUrl + addonUrl。
   * worker 内 fetch base + addon → extractBin → unzip → bspatch → packGLB,
   * 主线程零网络、零 CPU、零 16MB bin 拷贝。
   */
  private composeVRMFromAddon(addonUrl: string, addonSha: string, meta: { phaseLabel: string; subtitleVars?: Record<string, unknown>; preserveMotion: boolean }): Promise<ArrayBuffer> {
    // ponytail: base 复用 /vrm/xiaochun_base.vrmbase — addon 里 whole-glb.bin 就是裸 BIN chunk,
    // worker 解出后直接当 bspatch 输入。base 跟 cold-start 共用同一份资产。
    // sha 透传给 worker 当 IDB cache key — 没传 sha 时 worker 跳过 cache。
    return this.runComposeOutfit('/vrm/xiaochun_base.vrmbase', APP_CONFIG.model.defaultSha, addonUrl, addonSha, meta);
  }

  // ponytail: bspatch 现在跑在 vrmWorker,主线程不再被 ~450ms 同步 C 调用阻塞。
  // Worker 通过 postMessage + Transferable ArrayBuffer 通信,零拷贝。
  private bspatchWorker: Worker | null = null;
  private bspatchRequestId = 0;
  private bspatchPending = new Map<number, {
    resolve: (out: ArrayBuffer | Uint8Array) => void;
    reject: (err: Error) => void;
  }>();
  // ponytail: 每个 compose 请求带 i18n 文案/相位标签 — worker 发 compose_progress
  // 时只带 raw pct,这里取 meta 转成完整 LoadingState 转发到 onSwapProgress。
  // preserveMotion:false 时 cold-start,LoadingOverlay 也需要 progress 推;
  // preserveMotion:true 时中途换装,只推 TopHeader 按钮,overlay 被 loadVRM 跳过。
  private bspatchPendingMeta = new Map<number, {
    phaseLabel: string;
    subtitleVars?: Record<string, unknown>;
    preserveMotion: boolean;
  }>();

  private ensureBspatchWorker(): Worker {
    if (this.bspatchWorker) return this.bspatchWorker;
    // ponytail: vite 自动识别这个 pattern,产出独立 worker bundle
    this.bspatchWorker = new Worker(new URL('./vrmWorker.ts', import.meta.url), { type: 'module' });
    this.bspatchWorker.onmessage = (e: MessageEvent<
      | { id: number; type: 'compose_ok'; composedGLB: ArrayBuffer; elapsedMs: number }
      | { id: number; type: 'compose_err'; error: string }
      | { id: number; type: 'compose_progress'; phase: string; loaded?: number; total?: number; pct: number }
      | { id: number; type: 'bspatch_ok'; newBin: ArrayBuffer; elapsedMs: number }
      | { id: number; type: 'bspatch_err'; error: string }
      | { id: number; type: 'log'; level: 'log' | 'error'; args: string[] }
    >) => {
      // ponytail: worker 内的 console.log/error 通过 postMessage 转发到主线程,
      // 这里 forward 到主线程 console,DevTools 主页面 console 面板就能看到。
      if (e.data.type === 'log') {
        (e.data.level === 'error' ? console.error : console.log)(
          `[vrmWorker] ${e.data.args.join(' ')}`,
        );
        return;
      }
      // ponytail: compose_progress 不 resolve/reject — 仅 forward 到 onSwapProgress,
      // 让 TopHeader 按钮 spinner / LoadingOverlay 滚动条拿到实时进度。loading 文本
      // 跟 swapOutfit 启动时设的保持一致(挂在 pending meta 上,见 runComposeOutfit)。
      // cold-start 路径 (preserveMotion=false) 同时推 onLoadingChange,LoadingOverlay 才
      // 看到中段进度;中途换装只推 onSwapProgress 给 TopHeader。
      if (e.data.type === 'compose_progress') {
        const meta = this.bspatchPendingMeta.get(e.data.id);
        const phaseLabel = meta?.phaseLabel ?? 'swappingOutfit';
        const state = { active: true as const, subtitleKey: phaseLabel, subtitleVars: meta?.subtitleVars, progress: e.data.pct };
        this.onSwapProgress?.(state);
        if (meta && !meta.preserveMotion) this.onLoadingChange?.(state);
        return;
      }
      const req = this.bspatchPending.get(e.data.id);
      if (!req) return;
      this.bspatchPending.delete(e.data.id);
      this.bspatchPendingMeta.delete(e.data.id);
      if (e.data.type === 'compose_ok') {
        req.resolve(e.data.composedGLB);
      } else if (e.data.type === 'bspatch_ok') {
        req.resolve(new Uint8Array(e.data.newBin));
      } else {
        req.reject(new Error(`[vrmWorker ${e.data.type}] ${e.data.error}`));
      }
    };
    this.bspatchWorker.onerror = (e) => {
      // ponytail: worker 整个崩了,把所有 pending 都拒掉,下次调用会重启 worker
      console.error('[vrmWorker] worker error:', e.message);
      const pending = Array.from(this.bspatchPending.values());
      this.bspatchPending.clear();
      this.bspatchPendingMeta.clear();
      this.bspatchWorker?.terminate();
      this.bspatchWorker = null;
      pending.forEach((p) => p.reject(new Error(`[vrmWorker] crashed: ${e.message}`)));
    };
    return this.bspatchWorker;
  }

  /**
   * ponytail: 主线程入口 — 发 baseUrl + addonUrl 给 worker。
   * worker 全权负责 fetch / extract / unzip / bspatch / packGLB,
   * transfer 回 GLB ArrayBuffer。
   *
   * meta 跟 promise 一起存 — worker 发 compose_progress 时只带 raw pct,
   * 这里拼上 i18n 文本转发到 onSwapProgress。addons (raw bsdiff 直接调)
   * 不走 progress,不需要 meta。
   */
  private async runComposeOutfit(
    baseUrl: string,
    baseSha: string,
    addonUrl: string,
    addonSha: string,
    meta: { phaseLabel: string; subtitleVars?: Record<string, unknown>; preserveMotion: boolean },
  ): Promise<ArrayBuffer> {
    const worker = this.ensureBspatchWorker();
    const id = ++this.bspatchRequestId;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      this.bspatchPending.set(id, { resolve: resolve as (out: ArrayBuffer | Uint8Array) => void, reject });
      this.bspatchPendingMeta.set(id, meta);
      worker.postMessage({ id, type: 'compose_outfit', baseUrl, baseSha, addonUrl, addonSha });
    });
  }

  // ──────────────────────────────────────────────────────────────────


  /**
   * After floor-snap on a replacement VRM: match previous hips world Y (body-size continuity),
   * then ease vrmBaseSceneY back to the true floor over ~280ms so feet settle without a hard pop.
   */
  private applyOutfitHeightContinuity(previousVrm: VRM, nextVrm: VRM, trueFloorY: number): void {
    const scratch = new THREE.Vector3();
    const prevHips = previousVrm.humanoid?.getNormalizedBoneNode('hips');
    const nextHips = nextVrm.humanoid?.getNormalizedBoneNode('hips');
    if (!prevHips || !nextHips) {
      this.vrmBaseSceneY = trueFloorY;
      this._outfitBaseYEase = 1;
      return;
    }
    previousVrm.scene.updateMatrixWorld(true);
    nextVrm.scene.updateMatrixWorld(true);
    prevHips.getWorldPosition(scratch);
    const prevY = scratch.y;
    nextHips.getWorldPosition(scratch);
    const dy = prevY - scratch.y;
    if (Math.abs(dy) > 1e-4) {
      nextVrm.scene.position.y += dy;
      nextVrm.scene.updateMatrixWorld(true);
    }
    this.vrmBaseSceneY = nextVrm.scene.position.y;
    this._outfitBaseYFrom = this.vrmBaseSceneY;
    this._outfitBaseYTo = trueFloorY;
    // Only ease when the jump is meaningful (different body / shoes)
    this._outfitBaseYEase = Math.abs(this._outfitBaseYFrom - this._outfitBaseYTo) > 0.008 ? 0 : 1;
  }

  private resetBones(vrm: VRM): void {
    if (!vrm.humanoid) return;
    try {
      vrm.humanoid.resetNormalizedPose();
    } catch {
      // fallback
    }
    const boneNames = [
      'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
      'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
      'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
      'leftEye', 'rightEye'
    ];
    boneNames.forEach((name) => {
      const node = vrm.humanoid?.getNormalizedBoneNode(name as any);
      if (node) node.rotation.set(0, 0, 0);
    });
  }

  // ── 万能动作播放接口 ──
  public async playMotion(
    input: string | ArrayBuffer | THREE.AnimationClip,
    options: PlayMotionOptions = {},
  ): Promise<UniversalMotionHandle> {
    if (!this.currentVRM) {
      throw new Error('[VRMEngine] 模型尚未就绪，无法播放动作');
    }
    const lookAtOffsets = this.gazeController.getLookAtOffsets();
    return this.motionPipeline.playMotion(this.currentVRM, input, options, lookAtOffsets);
  }

  public stopMotion(fadeDuration = 0.75): void {
    const lookAtOffsets = this.gazeController.getLookAtOffsets();
    this.motionPipeline.stopMotion(fadeDuration, lookAtOffsets);
  }

  public isMotionPlaying(): boolean {
    return this.motionPipeline.getLiveWriter() !== 'idle';
  }

  // ── 聊天与气泡追踪 ──
  public async sendMessage(text: string): Promise<void> {
    if (!this.currentVRM) return;

    const setStatus = (
      key: string,
      vars?: Record<string, unknown>,
      isError = false,
      speechText?: string,
      segmentIndex?: number,
      totalSegments?: number,
    ) => {
      if (this.currentVRM) {
        this.bodyMorph.getHeadTopWorldPosition(this.tempHeadTopPos);
      }
      this.bubbleTracker.setStatus(
        key,
        this.currentVRM,
        this.camera,
        vars,
        isError,
        speechText,
        segmentIndex,
        totalSegments,
        this.currentVRM ? this.tempHeadTopPos : undefined,
      );
    };

    await this.chatDirector.say(text, this.currentVRM, this.vrmaPlayer, this.emagePlayer, setStatus);
  }

  /**
   * ponytail: 跳过 LLM,直接跑 TTS → EMAGE → 播放流水线。
   * 当前仅 dev 测试按钮调用;函数本身通用,后续其他 "直接念" 场景也可复用。
   */
  public async speakText(text: string): Promise<void> {
    if (!this.currentVRM) return;

    const setStatus = (
      key: string,
      vars?: Record<string, unknown>,
      isError = false,
      speechText?: string,
      segmentIndex?: number,
      totalSegments?: number,
    ) => {
      if (this.currentVRM) {
        this.bodyMorph.getHeadTopWorldPosition(this.tempHeadTopPos);
      }
      this.bubbleTracker.setStatus(
        key,
        this.currentVRM,
        this.camera,
        vars,
        isError,
        speechText,
        segmentIndex,
        totalSegments,
        this.currentVRM ? this.tempHeadTopPos : undefined,
      );
    };

    await this.chatDirector.speakText(text, this.currentVRM, this.vrmaPlayer, this.emagePlayer, setStatus);
  }


  public releaseHeavyResources(): void {
    try { this.chatDirector.stop(); } catch { }
    try { unloadWebLLM(); } catch (e) { console.warn('[VRMEngine] 释放 WebLLM 异常:', e); }
    try { this.emagePlayer.dispose(); } catch (e) { console.warn('[VRMEngine] 释放 EMAGE 异常:', e); }
    console.log('[VRMEngine] 已成功释放 WebLLM 显存与 EMAGE 运行内存');
  }

  // ponytail: 清 IDB 里 .vrmaddon / .vrmbase 缓存。DeviceStatusDialog 的释放按钮调,
  // 主要给 custom provider (没显存可释放,但 IDB cache 仍要清理的场景)用。
  // 失败也不抛 — UI 反馈靠 await idbClearAll 的 reason 字段。
  public async clearVrmAssetCache(): Promise<{ cleared: boolean; reason?: string }> {
    const { idbClearAll } = await import('@/lib/idb-vrm-cache');
    const result = await idbClearAll();
    console.log('[VRMEngine] VRM asset cache cleared:', result);
    return result;
  }

  public renderSingleFrame(): void {
    if (this.renderer && this.currentVRM) {
      if (this.postFx.isReady() && this.postFx.config.enabled) {
        this.postFx.render(0);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    }
  }

  // ── 核心高内聚主渲染循环 ──
  private startAnimation(): void {
    this.bindVisibilityPause();
    if (typeof document !== 'undefined' && document.hidden) {
      this.suspendRendering();
      return;
    }
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    const targetFps = isMobile()
      ? (APP_CONFIG.renderer.targetFpsMobile ?? 0)
      : (APP_CONFIG.renderer.targetFpsDesktop ?? 0);
    this._animFrameIntervalMs = targetFps > 0 ? 1000 / targetFps : 0;
    this._lastAnimTs = 0;

    const animate = (timestamp: number) => {
      this.animFrameId = requestAnimationFrame(animate);
      if (this.isRenderingSuspended) return;
      if (this._rendererContextDirty && !this.chatDirector.speaking) {
        this.syncRendererContextIfNeeded();
      }

      // 平台限帧：仍按 vsync 挂 rAF，未到下一拍则跳过 update/render。
      // 用累加 interval 锁相（避免严格 < 在 ~33.3ms 时连跳成 ~20fps）；掉队超过 1 拍则重置。
      if (this._animFrameIntervalMs > 0) {
        if (this._lastAnimTs === 0) {
          // 本帧立刻跑，下一拍锁在 +interval
          this._lastAnimTs = timestamp + this._animFrameIntervalMs;
        } else if (timestamp < this._lastAnimTs) {
          return;
        } else {
          this._lastAnimTs += this._animFrameIntervalMs;
          if (this._lastAnimTs < timestamp - this._animFrameIntervalMs) {
            this._lastAnimTs = timestamp + this._animFrameIntervalMs;
          }
        }
      }

      // 视口动态物理尺寸跟随（单主循环同步驱动，消除多重 rAF 竞争与双重绘制开销）
      const curW = window.innerWidth;
      const curH = window.innerHeight;
      if (curW > 0 && curH > 0 && (curW !== this.lastRenderWidth || curH !== this.lastRenderHeight)) {
        const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        if (isMobile && this.lastRenderWidth === curW) {
          this.camera.aspect = curW / curH;
          this.camera.updateProjectionMatrix();
        } else {
          this.lastRenderWidth = curW;
          this.lastRenderHeight = curH;
          this.camera.aspect = curW / curH;
          this.camera.updateProjectionMatrix();
          const ratio = this.getTargetPixelRatio();
          this.renderer?.setPixelRatio(ratio);
          this.renderer?.setSize(curW, curH);
          if (this.postFx.isReady()) {
            this.postFx.resize(curW, curH, ratio);
          }
        }
      }

      const delta = Math.min(this.clock.getDelta(), 0.1);
      const time = this.clock.getElapsedTime();

      // 持续驱动线稿背景世界的动态喷水花坛（水珠物理重力飞溅与同心涟漪波纹）
      this.lineworkWorld.update(delta, time);

      const vrm = this.currentVRM;
      if (vrm) {
        if (this._springBoneTunedVRM !== vrm) {
          this.applySpringBoneTuning(vrm);
          this._springBoneTunedVRM = vrm;
        }
        const isShoesOff = this.materialManager.partsVisibility['shoes'] === false;
        this.footIK.updateBarefoot(isShoesOff, delta);

        if (this._outfitBaseYEase < 1) {
          this._outfitBaseYEase = Math.min(1, this._outfitBaseYEase + delta / 0.28);
          const u = this._outfitBaseYEase;
          const t = u * u * (3 - 2 * u);
          this.vrmBaseSceneY = THREE.MathUtils.lerp(this._outfitBaseYFrom, this._outfitBaseYTo, t);
        }
        const currentSceneBaseY = this.vrmBaseSceneY - this.footIK.getSinkOffset() + this.bodyMorph.getLegHeightDelta();
        vrm.scene.position.y = currentSceneBaseY;
        this.emagePlayer.baseY = currentSceneBaseY;

        this.motionPipeline.tick(vrm, {
          camera: this.camera,
          delta,
          time,
          enableBodyTurn: this.enableBodyTurn,
          isSpeaking: this.chatDirector.speaking,
          manualExpression: this.manualExpression,
        });

        this.chatDirector.tick(vrm, this.vrmaPlayer);

        // ponytail: 注入 wind (ambient + 鼠标冲量) 到 springBone joints 的 gravityDir/Power,
        // 必须在 vrm.update(delta) 之前, 因为 springBoneManager.update() 内部读取这些 settings.
        this.windForce.applyTo(vrm, delta, this.camera);
        vrm.update(delta);

        // ponytail: 3D 引导轨 (TurnGuide + PitchGuide + CameraYGuide) 全在 interaction 内每帧 update,
        // 这里什么都不做 — interaction.update() 在下面 shadow.update() 之后调一次。

        if (this.bodyMorph.isCompatible) {
          this.bodyMorph.update(vrm);
        }

        // 7. 实体脚下影子平面中心与地面高度贴合 — ponytail: 全部交给 CharacterShadowSystem
        if (vrm.humanoid) {
          const lf = vrm.humanoid.getNormalizedBoneNode('leftFoot');
          const rf = vrm.humanoid.getNormalizedBoneNode('rightFoot');
          if (lf && rf) {
            lf.getWorldPosition(this.tempSoleA);
            rf.getWorldPosition(this.tempSoleB);
            this.shadow.feetWorld.set(
              (this.tempSoleA.x + this.tempSoleB.x) * 0.5,
              0,
              (this.tempSoleA.z + this.tempSoleB.z) * 0.5,
            );
          } else {
            this.shadow.feetWorld.set(vrm.scene.position.x, 0, vrm.scene.position.z);
          }
          this.shadow.update(this.camera, this.getLineworkTheme() === 'transparent');
        }

        // 8. 头顶世界坐标同帧只采一次：气泡 / 身高 / 尺子共用
        this.bodyMorph.getHeadTopWorldPosition(this.tempHeadTopPos);
        this.bubbleTracker.update(vrm, this.camera, this.tempHeadTopPos);

        // 9. 头顶实时身高指示折线与 3D 浮动 HUD 胶囊标牌 (彻底去掉蓝色方块，发光指示线优雅连接)
        // ponytail: liveHeight 每帧无条件读,与 canvas ruler / drawer chip 共用同一个值;
        // 只有当数字变化 ≥0.05cm 才广播 notifyHeightChange,drawer 收到后再读一次
        // (这次 scene Y 已经更新到最新),从而消灭"chip 显示旧 sceneY 虚高"的串号 bug。
        const liveHeight = this.bodyMorph.heightCmFromHeadTopY(this.tempHeadTopPos.y);
        if (Math.abs(liveHeight - this._lastRenderedHeight) >= 0.05) {
          this._lastRenderedHeight = liveHeight;
          this.notifyHeightChange();
        }
        if (this.isHeightRulerVisible && this.camera) {
          this.tempRulerEdgePos.copy(this.tempHeadTopPos).project(this.camera);

          const inView = this.tempRulerEdgePos.z <= 1.0;
          if (inView) {
            const hx = Math.round((this.tempRulerEdgePos.x * 0.5 + 0.5) * window.innerWidth);
            const hy = Math.round((-this.tempRulerEdgePos.y * 0.5 + 0.5) * window.innerHeight);
            const bx = hx + 42;
            const by = hy - 28;
            if (
              this._rulerLastInView !== true
              || hx !== this._rulerLastHx
              || hy !== this._rulerLastHy
              || bx !== this._rulerLastBx
              || by !== this._rulerLastBy
            ) {
              this._rulerLastHx = hx;
              this._rulerLastHy = hy;
              this._rulerLastBx = bx;
              this._rulerLastBy = by;
              this._rulerLastInView = true;
              const badgeEl = document.getElementById('height-ruler-badge');
              const svgEl = document.getElementById('height-ruler-svg');
              const lineEl = document.getElementById('height-ruler-line');
              const dotEl = document.getElementById('height-ruler-dot');
              if (badgeEl) {
                badgeEl.style.transform = `translate3d(${bx}px, ${by}px, 0)`;
                badgeEl.style.opacity = '1';
              }
              if (svgEl && lineEl && dotEl) {
                svgEl.style.display = 'block';
                lineEl.setAttribute('d', `M ${hx} ${hy} L ${hx + 20} ${hy - 14} L ${bx} ${by + 13}`);
                dotEl.setAttribute('cx', String(hx));
                dotEl.setAttribute('cy', String(hy));
              }
            }
          } else if (this._rulerLastInView !== false) {
            this._rulerLastInView = false;
            const badgeEl = document.getElementById('height-ruler-badge');
            const svgEl = document.getElementById('height-ruler-svg');
            if (badgeEl) badgeEl.style.opacity = '0';
            if (svgEl) svgEl.style.display = 'none';
          }
        }
      }

      if (vrm) {
        this.interaction.update(delta, vrm.scene.position, this._cameraYOffsetAccum, this.camera);
      }

      this.controls?.update();
      try {
        if (this.postFx.isReady() && this.postFx.config.enabled) {
          this.postFx.render(delta);
        } else {
          this.renderer?.render(this.scene, this.camera);
        }

        // 真实像素提取：在 WebGL 画布渲染完成的第一时间提取 Alpha 蒙版，保证动作姿态零延迟、100% 对应画面
        if (this.canvas && passthroughManager.isPassthroughEnabled()) {
          passthroughManager.updateCanvasAlphaMask(this.canvas);
        }
      } catch (renderErr) {
        // 渲染异常安全降级：避免 HMR 期间 WebGL 瞬态错误无限轰炸导致主线程卡死
        console.warn('[VRMEngine] skipped frame render error during HMR/resize:', renderErr);
      }
    };

    animate(0);
  }

  private _hitRaycaster = new THREE.Raycaster();
  private _hitNdc = new THREE.Vector2();

  /**
   * 射线检测屏幕坐标 (clientX, clientY) 是否击中小春 3D 角色模型实体
   */
  public isHitModel(clientX: number, clientY: number): boolean {
    if (!this.currentVRM || !this.camera || typeof window === 'undefined') return false;
    this._hitNdc.x = (clientX / window.innerWidth) * 2 - 1;
    this._hitNdc.y = -(clientY / window.innerHeight) * 2 + 1;
    this._hitRaycaster.setFromCamera(this._hitNdc, this.camera);
    const intersects = this._hitRaycaster.intersectObject(this.currentVRM.scene, true);
    for (const hit of intersects) {
      const obj = hit.object;
      if (!obj.visible) continue;
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material;
        if (mat) {
          if (Array.isArray(mat)) {
            if (mat.some((m) => m.visible && m.opacity > 0.05)) return true;
          } else if (mat.visible && mat.opacity > 0.05) {
            return true;
          }
        }
      }
    }
    return false;
  }

  public dispose(): void {
    this.unbindVisibilityPause();
    this._batteryUnsub?.();
    this._batteryUnsub = null;
    this.suspendRendering();

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    this.interaction.dispose();
    this.windForce.dispose();
    window.removeEventListener('resize', this.handleResize);
    this.controls?.dispose();
    this.renderer?.dispose();
    this.lineworkWorld.dispose(this.scene);
    // ponytail: 角色阴影系统释放 (含 shadowPlane geometry/material + mask texture)
    this.shadow.dispose();
  }
}

export const vrmEngine = new VRMEngine();
export type { LineworkTheme } from './scene/lineworkWorld';
