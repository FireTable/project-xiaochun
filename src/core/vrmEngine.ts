import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
// @pixiv/three-vrm inlines stock MToon in its bundle — load fork explicitly (pnpm override → packages/...)
import { MToonMaterial, MToonMaterialLoaderPlugin } from '@pixiv/three-vrm-materials-mtoon';

/** Give the event loop (rAF, hero warp, input) a turn between heavy VRM setup steps. */
const yieldToMain = (): Promise<void> => {
  const sch = (globalThis as any).scheduler;
  if (sch?.yield) return sch.yield();
  return new Promise((r) => setTimeout(r, 0));
};
import { CAMERA_STATE_KEY, BODY_YAW_KEY, CAMERA_PITCH_KEY, SCENE_THEME_KEY, CAMERA_Y_OFFSET_KEY } from '@/lib/constants';

import { VRMBodyMorph } from './morph/vrmBodyMorph';
import { postFxPipeline, type PostFxPipeline } from './postfx/postFxPipeline';
import { ChatDirector, type TurnState } from '@/director/chatDirector';
import type { VocalAudioProcessor } from '@/director/vocalProcessor';
import type { HostAudioInput } from '@/director/hostAudio';
import { MotionPipeline } from '@/motion/pipeline/motionPipeline';
import type { PlayMotionOptions, UniversalMotionHandle } from '@/motion/sources/clip';
import { MOTION_CATALOG, type MotionCatalogId, type MotionGroupName, isMotionCatalogId, selectMotionFromGroup } from '@/motion/catalog';
import { motionAssetManager } from '@/motion/pipeline/motionAssetManager';
import { resolveMotionUrl } from '@/motion/motionResolver';
import { preloadWebLLM, unloadWebLLM } from '@/llm/webLLMProvider';
import { isHeavyPreloadAllowed, isLlmPreloadAllowed } from '@/lib/heavyPreload';
import { APP_CONFIG, type LightConfig, type VocalAudioConfig, type VocalPresetKey } from '@/config';
import { loadPostFxEnabledFromStorage, getRenderPixelRatio, resolveInitialSceneTheme } from '@/lib/utils';
import { isMobile, isTauri } from '@/lib/platform';
import type { Lang } from '@/i18n';
import { langFromSystemPrompt } from '@/llm/prompts';

// ── 抽离子系统导入 ──
import { LineworkWorld } from './scene/lineworkWorld';
import { Beach3DWorld } from './scene/beach3d/beach3dWorld';
import { VoidWorld } from './scene/void/voidWorld';
import type { EnvironmentTimeMode, EnvironmentTimeOptions, EnvironmentTimeState } from './scene/environmentTime';
import { resolveEffectiveHour } from './scene/beach3d/beach3dTime';
import type { SceneThemeId, LineworkTheme } from '@/types/config';
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
import { bindBustArmContact, clearBustArms, updateBustArmContact } from './contact/bustArmContact';
import { applyBustClothFit, bustJointHitRadius } from './spring/bustClothFit';
import { CharacterShadowSystem } from './scene/characterShadow';
import { adjustZoomInWhileClamped, solveGroundClamp, visibleRatioCap } from './camera/groundClamp';
import { cameraDirector } from './scene/cameraDirector';
import { expressionController } from './morph/expressionController';
import { VRMTexturePool, extractParserImageHashes } from './texturePool';
import { StaggeredDisposer } from './staggeredDisposer';
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
  TurnState,
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

/**
 * 按 FOV 反推"主体取景"视距 (m): distance = shotExtent / (2·tan(fov/2))。
 * 保证不同焦距下主体在画面里的大小一致 (fov 越小镜头越远)。
 * 引擎里所有"默认取景"(初始机位 / fitCamera / 推镜头终点) 都走这一个函数, 传入当前相机 fov。
 */
export function getDefaultCameraDistance(fovDeg: number = APP_CONFIG.camera.defaultFov): number {
  const fovRad = (fovDeg * Math.PI) / 180;
  return APP_CONFIG.camera.defaultShotExtent / (2 * Math.tan(fovRad / 2));
}

/**
 * 宿主 (SDK / ?camera*=) 可覆盖的相机选项。缺省键 = 不覆盖, 走 iframe 保存值 / 默认值。
 * 范围见 APP_CONFIG.camera (fov: minFov..maxFov, distance: hostMin/MaxDistance, height: ±hostMaxYOffset)。
 */
export interface CameraOverride {
  fov?: number;
  distance?: number;
  height?: number;
  intro?: boolean;
}
/** setCameraConfig 的入参: 缺省键 = 不变, null = 清除该项覆盖 (恢复默认)。 */
export type CameraOverridePatch = { [K in keyof CameraOverride]?: CameraOverride[K] | null };

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
function computeDefaultCameraPosition(fovDeg: number): [number, number, number] {
  const target = new THREE.Vector3(...APP_CONFIG.camera.defaultTarget);
  const originalOffset = new THREE.Vector3(...APP_CONFIG.camera.defaultPosition).sub(target);
  const direction = originalOffset.clone().normalize();
  const distance = getDefaultCameraDistance(fovDeg);
  return target.clone().add(direction.multiplyScalar(distance)).toArray() as [number, number, number];
}

/**
 * Official three-vrm post-parse opts (`basic.html` / `dnd.html`). Global — not
 * platform-gated: skeleton matrix work and morph-target caps exist on every GPU.
 * Order matches pixiv: vertices → skeletons → morphs.
 * `removeUnnecessaryJoints` is deprecated; `combineSkeletons` replaced it.
 */
function applyVrmUtilsOptimizations(scene: THREE.Object3D, vrm: VRM): void {
  VRMUtils.removeUnnecessaryVertices(scene);
  VRMUtils.combineSkeletons(scene);
  VRMUtils.combineMorphs(vrm);
}

export interface SwapOutfitOptions {
  /** 是否在换装成功且非对话时自动播放 showFullBody 展示动作（默认 true，冷启动时自动为 false） */
  showcase?: boolean;
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
  /** 阴影隔帧更新帧计数器 */
  private _shadowFrameCount = 0;
  // ── 模块化独立子系统 ──
  public readonly lineworkWorld = new LineworkWorld();
  /** 海滩 3D 场景 (beach3d): 纯 Three.js 天空 / 云 / 远山 / 沙地 + 海 / 棕榈 / 礁石; 首次进入该场景时构建; 其余场景隐藏 (0 次绘制), 资源保留到引擎 dispose。 */
  public readonly beach3d = new Beach3DWorld();
  /** 虚空静谧场景 (void): 双层径向光晕 + 浮游微尘，营造专注静谧的纯背景感 */
  public readonly voidWorld = new VoidWorld();
  private _currentSceneTheme: SceneThemeId = 'light';
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
  /** 冷启动内存登记的历史 bodyYaw 偏角（用于进入时先正脸迎客招手推镜头，结束后自然迈步转身复位） */
  private _pendingColdStartTargetYaw: number | null = null;
  private _coldStartIntroTimer: ReturnType<typeof setTimeout> | null = null;
  private _coldStartTurnTimer: ReturnType<typeof setTimeout> | null = null;
  private rawHitRadiusMap = new WeakMap<object, number>();
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

  public getControls(): OrbitControls | null {
    return this.controls;
  }

  public getCamera(): THREE.PerspectiveCamera | null {
    return this.camera;
  }

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
  private texturePool = new VRMTexturePool();
  private staggeredDisposer = new StaggeredDisposer();

  public get texturePoolStats() {
    return this.texturePool.getStats();
  }

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
  private _lastLoadingProgress = 0;

  /** 发送 Loading 进度：内置严格单调递增保护，杜绝异步各阶段因事件乱序或重设导致进度条倒退或突跳 */
  public reportLoading(state: LoadingState): void {
    if (state.active) {
      this._lastLoadingProgress = Math.max(
        this._lastLoadingProgress,
        Math.max(0, Math.min(100, state.progress))
      );
      this.onLoadingChange?.({ ...state, progress: this._lastLoadingProgress });
    } else {
      this._lastLoadingProgress = 100;
      this.onLoadingChange?.({ ...state, progress: 100 });
    }
  }

  /** 重设 Loading 进度追踪（冷启动开始时调用） */
  public resetLoadingProgress(): void {
    this._lastLoadingProgress = 0;
  }
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
  /** /embed 专用: true 时 OrbitControls 不响应滚轮缩放 (在 attachCanvas 前设置)。 */
  public lockWheelZoom = false;
  /** /embed 专用: 宿主显式 xc.pause 后为 true, resumeRendering() 会被忽略直到 xc.resume。 */
  public hostPaused = false;
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
      const mtoonPlugin = new MToonMaterialLoaderPlugin(parser, {
        materialType: MToonMaterial,
      });
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

  /**
   * 订阅 3D 头部/状态气泡变更 (支持多组件并行监听)
   */
  public subscribeBubbleChange(cb: (state: BubbleState) => void): () => void {
    return this.bubbleTracker.subscribe(cb);
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
    // /embed: 宿主 xc.pause 期间, 前台恢复/pageshow 也不唤醒渲染 (宿主 xc.resume 才放行)
    if (this.hostPaused) return;
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

  /** 取消进行中的推镜头并还给用户控制; 返回是否真的取消了一个。 */
  private cancelCinematicIntro(): boolean {
    if (this.cinematicIntroRafId === null) return false;
    cancelAnimationFrame(this.cinematicIntroRafId);
    this.cinematicIntroRafId = null;
    if (this.controls) {
      this.controls.enabled = true;
      this.controls.update();
    }
    return true;
  }

  /**
   * 取消冷启动待机迎客演出（推镜头与延迟迈步复位），将控制权无延迟归还给用户
   */
  public cancelColdStartWelcoming(): void {
    if (this._coldStartIntroTimer !== null) {
      clearTimeout(this._coldStartIntroTimer);
      this._coldStartIntroTimer = null;
    }
    if (this._coldStartTurnTimer !== null) {
      clearTimeout(this._coldStartTurnTimer);
      this._coldStartTurnTimer = null;
    }
    this._pendingColdStartTargetYaw = null;
    this.cancelCinematicIntro();
  }

  // ── 宿主相机覆盖 (/embed 的 camera 选项) ──
  private cameraOverride: CameraOverride = {};

  /**
   * 统一取景解算 (俯仰角 + 视距), 初始机位 / fitCamera / 推镜头终点共用。
   * 优先级: 宿主显式 distance (applyExplicit=true 时) > iframe 保存的 pitch/distance > 按当前 fov 的默认取景。
   * 显式 distance 生效时一并忽略保存的 pitch (宿主在定镜头, 俯仰也回默认)。
   * applyExplicit=false (换装 / 换场景的重新取景) 且已有显式 distance: 沿用相机当前的俯仰/视距,
   * 不把用户滚轮缩放过的镜头拽回宿主给的值。
   * 结果按 controls 的 min/max 视距钳制。
   */
  private resolveShot(applyExplicit: boolean): { pitch: number; distance: number } {
    const explicit = this.cameraOverride.distance;
    let pitch: number;
    let distance: number;
    if (explicit !== undefined && !applyExplicit && this.controls && this._sceneInitialized) {
      pitch = this.controls.getPolarAngle();
      distance = this.getDesiredCameraDistance();
    } else if (explicit !== undefined) {
      pitch = getDefaultCameraPitch();
      distance = explicit;
    } else {
      const saved = loadSavedCameraPitch();
      pitch = saved ? saved.pitch : getDefaultCameraPitch();
      distance = saved?.distance ?? getDefaultCameraDistance(this.getBaseFov());
    }
    const min = this.controls?.minDistance ?? APP_CONFIG.camera.defaultMinDistance;
    const max = this.controls?.maxDistance ?? APP_CONFIG.camera.defaultMaxDistance;
    return { pitch, distance: Math.min(Math.max(distance, min), max) };
  }

  /**
   * 宿主 (SDK camera 选项 / ?cameraFov= 等 / xc.setConfig{camera}) 设置相机。
   * patch 缺省键 = 不变, null = 清除该项 (恢复 iframe 保存值 / 默认); 值需已由调用方校验到合法范围。
   * 已有模型时立刻重新取景并取消进行中的推镜头 (起点之前就设置则只记录, 首次取景时生效)。
   */
  public setCameraConfig(patch: CameraOverridePatch): void {
    const c: CameraOverride = { ...this.cameraOverride };
    (['fov', 'distance', 'height', 'intro'] as const).forEach((k) => {
      const v = patch[k];
      if (v === undefined) return;
      if (v === null) delete c[k];
      else (c as Record<string, number | boolean>)[k] = v;
    });
    this.cameraOverride = c;
    if (patch.fov !== undefined) {
      this.camera.fov = c.fov ?? APP_CONFIG.camera.defaultFov;
      this._groundClamp.fovBase = this.camera.fov;
      this.camera.updateProjectionMatrix();
    }
    this.cancelCinematicIntro();
    if (this.currentVRM && this.controls) {
      // 只改 height / fov / intro 时沿用相机当前视距 (不把用户缩放过的镜头拽回); 动了 distance 才重新定距
      this.fitCamera(patch.distance !== undefined);
      this.renderSingleFrame();
    }
  }

  /**
   * 将相机设置在入场全景预备机位 (中远景)，为开屏 greeting 留出全身视距，并在之后平滑推向特写
   */
  public prepareCinematicCamera(multiplier = 2.0): void {
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls || this.cameraOverride.intro === false) return;
    const finalTarget = controls.target.clone();
    const { pitch, distance: dist } = this.resolveShot(true);
    const finalPos = new THREE.Vector3(...computeCameraPositionFromPitch(pitch, dist, finalTarget));
    const offset = finalPos.clone().sub(finalTarget);
    const startPos = finalTarget.clone().add(offset.clone().multiplyScalar(multiplier));
    camera.position.copy(startPos);
    camera.lookAt(finalTarget);
    controls.target.copy(finalTarget);
    controls.update();
  }

  public cinematicIntro(durationMs: number = 1100, multiplier = 2.0): void {
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls) return;
    if (this.cinematicIntroRafId !== null) {
      cancelAnimationFrame(this.cinematicIntroRafId);
      this.cinematicIntroRafId = null;
    }
    const finalTarget = controls.target.clone();
    const { pitch, distance: dist } = this.resolveShot(true);
    const finalPos = new THREE.Vector3(...computeCameraPositionFromPitch(pitch, dist, finalTarget));
    // 宿主 camera.intro=false: 不推镜头, 直接放到终点
    if (this.cameraOverride.intro === false) {
      camera.position.copy(finalPos);
      camera.lookAt(finalTarget);
      controls.target.copy(finalTarget);
      controls.enabled = true;
      controls.update();
      return;
    }
    // 把相机立即设到终点,让 tween 期间 render-loop 读者(gaze 等)看到正确值;
    // 再跳到 startPos 准备推进。
    camera.position.copy(finalPos);
    controls.target.copy(finalTarget);
    // 从同视角的较远机位起步推进
    const offset = finalPos.clone().sub(finalTarget);
    const startPos = finalTarget.clone().add(offset.clone().multiplyScalar(multiplier));
    // 若当前相机已处于中远景预备机位，则以当前位置为起点无缝推近；否则跳到 startPos 推进
    const fromPos = camera.position.distanceTo(finalTarget) > dist * 1.15
      ? camera.position.clone()
      : startPos;
    camera.position.copy(fromPos);
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
      camera.position.lerpVectors(fromPos, finalPos, eased);
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
    // 场景世界初始化并挂载
    this.lineworkWorld.attach(this.scene);
    // 海滩 3D: 挂进场景 (默认不可见, 首次进入时才构建); 太阳方向取主方向光
    this.beach3d.attach(this.scene, this.lighting.dirLight);
    this.beach3d.setEnvironmentTime(this._environmentTime);
    // 虚空场景: 挂进场景 (默认不可见, 首次进入时才构建浮游微尘)
    this.voidWorld.attach(this.scene);
    // 夜空需要知道后期调色参数, 以反向补偿 OutputPass 对深色的压黑 (保证与 CSS 渐变同色)
    this.voidWorld.setGradingSource(() => this.postFx.config);

    // 动作与聊天控制器事件绑定
    this.vrmaPlayer.bindTransitionManager(this.motionTransition);
    this.chatDirector.bindPipeline(this.motionPipeline);
    this.chatDirector.onSuspendRendering = () => this.suspendRendering();
    this.chatDirector.onResumeRendering = () => this.resumeRendering();
    this.chatDirector.setOnEnd(() => this.bubbleTracker.hide());
    this.chatDirector.onSpeakingChange = (speaking) => {
      this.speakingListeners.forEach((cb) => {
        try { cb(speaking); } catch (e) { console.error(e); }
      });
    };
    this.chatDirector.onTurnStateChange = (state) => {
      this.turnStateListeners.forEach((cb) => {
        try { cb(state); } catch (e) { console.error(e); }
      });
    };

    // 绑定电影级镜头调度器 (采用 getControls 动态取用，防止 constructor 时期 controls 为 null)
    cameraDirector.bind({
      camera: this.camera,
      getControls: () => this.controls,
      controls: this.controls,
      getVRM: () => this.currentVRM,
      getSunDirection: () => this.lighting.dirLight.position.clone().normalize(),
      onApplyGroundClamp: () => this.applyGroundClamp(null),
    });
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
  private _viewportDirty = true;

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

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    console.warn('[VRMEngine] WebGL context lost. Suspending rendering loop...');
    this.isRenderingSuspended = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  };

  private handleContextRestored = (): void => {
    console.info('[VRMEngine] WebGL context restored. Recreating renderer context...');
    try {
      this.recreateRendererContext();
      this.isRenderingSuspended = false;
      this.startAnimation();
    } catch (e) {
      console.error('[VRMEngine] Failed to recreate WebGL context upon restoration:', e);
    }
  };

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
    this.renderer.shadowMap.autoUpdate = (APP_CONFIG.shadow.updateIntervalFrames ?? 1) <= 1;
    this.renderer.shadowMap.needsUpdate = true;
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
    if (this.canvas && this.canvas !== canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    }
    window.removeEventListener('resize', this.handleResize);

    this.canvas = canvas;
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

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
    this.renderer.shadowMap.autoUpdate = (APP_CONFIG.shadow.updateIntervalFrames ?? 1) <= 1;
    this.renderer.shadowMap.needsUpdate = true;

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.controls = new OrbitControls(this.camera, canvas);
    this._groundClamp.active = false;
    this.installGroundClamp(this.controls);

    const defaultTarget = new THREE.Vector3(...APP_CONFIG.camera.defaultTarget);
    // 只有场景真正初始化过 (HMR / 上下文重建) 才沿用旧相机; 模型比 canvas 先加载完 (缓存命中) 时旧相机还是初始机位, 要按冷启动重新取景
    const target = (prevCamTarget && this._sceneInitialized)
      ? prevCamTarget
      : defaultTarget;
    this.controls.target.copy(target);

    if (prevCamPos && this._sceneInitialized) {
      this.camera.position.copy(prevCamPos);
    } else if (this.cameraOverride.distance !== undefined || loadSavedCameraPitch()) {
      const shot = this.resolveShot(true);
      this.camera.position.set(...computeCameraPositionFromPitch(shot.pitch, shot.distance, target));
    } else {
      this.camera.position.set(...computeDefaultCameraPosition(this.getBaseFov()));
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
    // /embed: 宿主 ?controls=0 可锁滚轮缩放 (默认放开, 与主站一致; 缩放范围仍受 min/maxDistance 限制)
    if (this.lockWheelZoom) this.controls.enableZoom = false;

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

    // 用户主动操作 OrbitControls (滚轮缩放或指针交互) 立即让位
    this.controls.addEventListener('start', () => {
      this.cancelColdStartWelcoming();
    });

    const onCanvasWheel = () => {
      this.cancelColdStartWelcoming();
    };
    canvas.addEventListener('wheel', onCanvasWheel, { passive: true });

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
      onUserInteractionStart: () => this.cancelColdStartWelcoming(),
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
    if (this.currentVRM && !this._sceneInitialized) {
      // 模型比 canvas 先加载完 (缓存命中/快网络): loadVRM 回调时 controls 还不存在, 没做过冷启动初始化, 这里补上
      this._sceneInitialized = true;
      this.fitCamera(true);
      const storedTheme = resolveInitialSceneTheme();
      this.setScene(storedTheme, false);
      this.startAnimation();
      this.prepareCinematicCamera(2.0);
    } else if (this.currentVRM || this._sceneInitialized) {
      this.startAnimation();
    }
  }



  /** 保存当前人物 bodyTurn 目标自转偏角 */
  public saveCurrentBodyYaw(): void {
    if (this._coldStartTurnTimer !== null) {
      clearTimeout(this._coldStartTurnTimer);
      this._coldStartTurnTimer = null;
    }
    this._pendingColdStartTargetYaw = null;
    const normalizedYaw = THREE.MathUtils.euclideanModulo(this.motionPipeline.targetYawOffset + Math.PI, Math.PI * 2) - Math.PI;
    this.motionPipeline.targetYawOffset = normalizedYaw;
    persistBodyYaw(normalizedYaw);
  }

  /** 将角色朝向初始化为背对镜头并保持静止 (用于序章电影级初醒演出) */
  public setFacingBackwards(): void {
    if (!this.currentVRM) return;
    this.motionPipeline.setFacingBackwards(this.currentVRM, this.camera);
    this.currentVRM.scene.updateMatrixWorld(true);
    this.settleSpringBones(this.currentVRM);
  }

  /** 触发角色转身面向镜头 (激活 4-phase stepping FSM 迈步转身) */
  public triggerBodyTurnToFront(): void {
    this.motionPipeline.triggerBodyTurnToFront();
  }

  /** 保存当前相机垂直俯仰角与视距 */
  public saveCurrentCameraPitch(): void {
    if (!this.controls) return;
    // 宿主显式指定了 camera.distance (在定镜头): 不把这次镜头写成 iframe 的用户偏好, 免得去掉该选项后仍残留宿主的取景
    if (this.cameraOverride.distance !== undefined) return;
    persistCameraPitch({
      pitch: this.controls.getPolarAngle(),
      // 相机不穿地推近时存用户想要的视距, 不存推近后的实际视距
      distance: this.getDesiredCameraDistance(),
    });
  }

  /**
   * 将持久化的人物 bodyTurn 目标角度还原至 VRM 实例与动作管线
   * @param isColdStart 是否为冷启动。仅当历史偏角在背面半球（不在镜头视线范围内，|yaw| > 90°）时，才先正脸迎客招手，结束后自然迈步转回；若本来就在正面视线内，直接保持朝向迎客
   */
  private applySavedBodyYawToVRM(vrm: VRM, isColdStart = false): void {
    const rawSavedYaw = loadSavedBodyYaw();
    if (rawSavedYaw !== null) {
      const isVrm0 = vrm.meta?.metaVersion === '0';
      const baseYaw = isVrm0 ? Math.PI : 0;
      // 规范化到 [-π, π] 最短角空间，杜绝累计圈数导致转一整圈
      const savedYaw = THREE.MathUtils.euclideanModulo(rawSavedYaw + Math.PI, Math.PI * 2) - Math.PI;

      // 视线范围判定：仅当历史偏角绝对值 > 90° (Math.PI * 0.5 ≈ 1.57 rad) 时，角色才处于背面（背对镜头看不到脸）
      // 此时才需要在冷启动时先正面迎客招手，待招手完成后由 bodyTurn 迈步转回背面；
      // 若在正面 180° 视线区内（|savedYaw| <= π/2），角色本来就在正面/侧面视线范围内，头部 Gaze 可自然看向镜头，
      // 直接在原位迎客，绝不平白无故转圈！
      const isFacingBackwards = Math.abs(savedYaw) > Math.PI * 0.5;

      if (isColdStart && isFacingBackwards) {
        this._pendingColdStartTargetYaw = savedYaw;
        vrm.scene.rotation.y = baseYaw;
        this.motionPipeline.targetYawOffset = 0;
        this.motionPipeline.resetLocomotion();
        return;
      }

      this._pendingColdStartTargetYaw = null;
      vrm.scene.rotation.y = baseYaw + savedYaw;
      this.motionPipeline.targetYawOffset = savedYaw;
      this.motionPipeline.resetLocomotion();
    }
  }

  /**
   * Cold start / outfit swap: upload textures and link programs before the first frame, in small
   * steps that yield to the event loop, so the first render is no longer one ~600ms synchronous task (texture uploads
   * + program links) that stalls the loading overlay's hero warp. Programs compile into the post-fx input target so
   * their cache keys (tone mapping / colour space) match the real RenderPass; compileAsync uses
   * KHR_parallel_shader_compile when available.
   */
  private async prewarmGpu(root: THREE.Object3D = this.scene): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    const textures = new Set<THREE.Texture>();
    root.traverse((obj) => {
      const mats = (obj as THREE.Mesh).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        for (const k in m) {
          const v = (m as any)[k];
          if (v && (v as THREE.Texture).isTexture) textures.add(v);
        }
        const u = (m as any).uniforms;
        if (u) for (const uk in u) { const v = u[uk]?.value; if (v && (v as THREE.Texture).isTexture) textures.add(v); }
      }
    });
    let since = performance.now();
    for (const t of textures) {
      if ((t as any).isRenderTargetTexture) continue;
      try { renderer.initTexture(t); } catch { /* first render uploads it instead */ }
      if (performance.now() - since > 12) { await yieldToMain(); since = performance.now(); }
    }
    await yieldToMain();
    // three r18x silently downgrades PCFSoftShadowMap to PCFShadowMap inside the first shadow render; apply the same
    // downgrade up front, otherwise every precompiled program's cache key (shadowMapType) misses and relinks.
    if (renderer.shadowMap.type === THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFShadowMap;
    const prevTarget = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(this.postFx.composer?.readBuffer ?? null);
      const p = root === this.scene ? renderer.compileAsync(this.scene, this.camera) : renderer.compileAsync(root, this.camera, this.scene);
      renderer.setRenderTarget(prevTarget);
      await p;
    } catch (e) {
      renderer.setRenderTarget(prevTarget);
      console.warn('[VRMEngine] prewarm compileAsync failed; first render will compile:', e);
    }
    await yieldToMain();
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
      if (!this.renderer.shadowMap.autoUpdate) {
        this.renderer.shadowMap.needsUpdate = true;
      }
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
    this._viewportDirty = true;

    // 当主动画循环未在运行时（如挂起或模型加载前），兜底同步重绘
    if (this.animFrameId === null || this.isRenderingSuspended) {
      this.applyResize(w, h);
    }
  };

  public setLineworkTheme(theme: LineworkTheme, persist: boolean = true): void {
    this.setScene(theme, persist);
  }

  private _beachPrewarmed = false;
  private _pendingScene: SceneThemeId | null = null;

  public setScene(theme: SceneThemeId, persist: boolean = true): void {
    // Live switch to beach3d: build it hidden and link its programs (KHR_parallel_shader_compile, yielding) while the
    // current scene keeps rendering, then switch. Its first render otherwise linked ~800 ms of shaders in one frame.
    if (theme === 'beach3d' && !this._beachPrewarmed && this.renderer && this.animFrameId !== null) {
      this._pendingScene = theme;
      const group = this.beach3d.prepare();
      void this.prewarmGpu(group).finally(() => {
        this._beachPrewarmed = true;
        if (this._pendingScene === theme) { this._pendingScene = null; this.setScene(theme, persist); }
      });
      return;
    }
    this._pendingScene = null;
    if (theme === 'beach3d') this._beachPrewarmed = true;
    this._currentSceneTheme = theme;
    const isLinework = theme === 'light' || theme === 'dark';
    this.lineworkWorld.setActive(isLinework, this.scene);
    if (isLinework) {
      this.lineworkWorld.setTheme(theme, this.scene);
    }
    this.beach3d.setActive(theme === 'beach3d');
    this.voidWorld.setActive(theme === 'void', this.scene);

    if (theme === 'transparent' || theme === 'beach3d') {
      this.scene.background = null;
    }

    this.updateShadowForTheme(theme === 'dark' || theme === 'void');
    this.syncSceneBackdrop(theme);
    // 纯虚空 (void) 场景彻底隐藏地面侧向硬投影，营造纯净空灵的真实三维悬浮感；其余场景正常开启
    if (this.shadow.group) this.shadow.group.visible = theme !== 'void';
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

  private _environmentTime: EnvironmentTimeMode | number = (() => {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('xiaochun_environment_time');
        if (saved) {
          const num = parseFloat(saved);
          if (!isNaN(num) && saved.trim() === String(num)) return num;
          if (['auto', 'weeHours', 'dawn', 'noon', 'dusk', 'day', 'sunset', 'night'].includes(saved)) return saved as EnvironmentTimeMode;
        }
      } catch {}
    }
    return 'auto';
  })();

  /**
   * 切场景时同步背景: beach3d 背景层显隐; 灯色 (StudioLighting.applyTheme) 与角色落影配色 (CharacterShadowSystem.applyTheme)
   *   重置为所有场景共用的默认值, 没有场景专属的灯光 / 落影微调。
   * 不改任何角色材质。
   */
  private syncSceneBackdrop(theme: SceneThemeId): void {
    this.beach3d.setActive(theme === 'beach3d');
    if (theme === 'beach3d') {
      this.beach3d.setEnvironmentTime(this._environmentTime);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('environment-time-changed', { detail: this._environmentTime }));
      }
    }
    // 场景退场时先把"接管灯光"还回去 (否则 beach 的主光会漏到别的场景)
    this.lighting.clearEnvironmentLight();
    this.shadow.setOpacityScale(1);
    this.lighting.applyTheme(theme);
    this.shadow.applyTheme(theme);
    this.chatDirector.vocalProcessor.applySceneTheme(theme);
  }

  /**
   * 把当前激活场景提供的光照 (太阳 / 月亮的方向与颜色) 应用到引擎主光。
   * 角色 (MToon) 与角色脚下落影都用这套主光, 于是角色的影子和场景里椅子、棕榈、沙堡的影子指向同一边。
   * 没有提供光照的场景 (void / light / transparent) 走默认摄影棚灯。
   */
  private applyEnvironmentLight(): void {
    if (!this.beach3d.isActive()) {
      this.lighting.clearEnvironmentLight();
      this.shadow.setOpacityScale(1);
      return;
    }
    this.beach3d.updateEnvironmentTime();
    const light = this.beach3d.getEnvironmentLight();
    this.lighting.applyEnvironmentLight(light);
    this.shadow.setOpacityScale(light.keyScale);
  }

  /**
   * 通用场景环境时间调度接口
   * 引擎保持通用抽象，不绑定任何具体场景名词；
   * 若当前激活场景支持时间（如 beach3d），则实时分发响应；未来新增场景可直接并列接入。
   */
  public setEnvironmentTime(time: EnvironmentTimeMode | number, options?: EnvironmentTimeOptions): void {
    this._environmentTime = time;
    if (typeof localStorage !== 'undefined' && !options?.isDragging) {
      try {
        localStorage.setItem('xiaochun_environment_time', String(time));
      } catch {}
    }
    if (this.beach3d.isActive()) {
      this.beach3d.setEnvironmentTime(time, options);
    }
    if (typeof window !== 'undefined' && !options?.isDragging) {
      window.dispatchEvent(new CustomEvent('environment-time-changed', { detail: time }));
    }
  }

  /**
   * 当前激活的场景是否支持环境时间变化
   */
  public isEnvironmentTimeSupported(): boolean {
    return this.beach3d.isActive();
  }

  /**
   * 读取当前环境时间状态（模式、当前生效小时、是否支持）
   */
  public getEnvironmentTime(): EnvironmentTimeState {
    if (this.beach3d.isActive()) {
      const state = this.beach3d.getEnvironmentTime();
      return { ...state, isSupported: true };
    }
    const mode = typeof this._environmentTime === 'string'
      ? this._environmentTime
      : (this._environmentTime >= 6.5 && this._environmentTime < 16.5 ? 'day' : (this._environmentTime >= 16.5 && this._environmentTime < 19.5 ? 'sunset' : 'night'));
    const hour = typeof this._environmentTime === 'number'
      ? this._environmentTime
      : resolveEffectiveHour(this._environmentTime);
    return { mode, currentHour: hour, isSupported: false };
  }

  public getLineworkTheme(): LineworkTheme {
    return this._currentSceneTheme;
  }

  public getSceneTheme(): SceneThemeId {
    return this._currentSceneTheme;
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

  public setFaceShadowIsolation(enable: boolean): void {
    this.materialManager.setFaceShadowIsolation(enable);
  }

  public setFabricSheenStrength(strength: number): void {
    this.materialManager.setFabricSheenStrength(strength);
  }

  // ── 骨骼体型微调系统 (Bone Morphing) ──
  public setBodyPartScale(part: import('@/config').BodyMorphPartKey, value: number): void {
    this.bodyMorph.setPart(part, value);
    if (part.startsWith('bust')) {
      this.applySpringBoneTuning();
    }
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
    this.applySpringBoneTuning();
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
    this.applySpringBoneTuning();
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

  public setListening(listening: boolean): void {
    if (listening) {
      if (this.turnState === 'idle') {
        this.setTurnState('listening');
      }
    } else {
      if (this.turnState === 'listening') {
        this.setTurnState('idle');
      }
    }
  }

  public isListening(): boolean {
    return this.turnState === 'listening';
  }

  /**
   * 设置全局动作过渡时长倍率 (基准为 0.75s ± 0.25s，默认 1.0)
   */
  public setCrossfadeScale(scale: number): void {
    const s = Math.max(0.2, scale);
    this.motionPipeline.crossfadeScale = s;
    this.motionPipeline.listening.crossfadeScale = s;
  }

  public getCrossfadeScale(): number {
    return this.motionPipeline.crossfadeScale;
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
    this._groundClamp.fovBase = fov;
    this.camera.updateProjectionMatrix();
  }

  // ── 相机不穿地 (APP_CONFIG.camera.groundClamp, 纯解算见 camera/groundClamp.ts) ──
  private readonly _groundClamp = {
    /** 相机当前是否处于夹取后的机位。 */
    active: false,
    /** 夹取后写入的 (相机 − 目标点), 用来识别"之后有没有别人改过相机"。 */
    applied: new THREE.Vector3(),
    /** 夹取前的 (相机 − 目标点) = 用户想要的机位。 */
    free: new THREE.Vector3(),
    /** 夹取后的实际视距 (m)。 */
    effective: 0,
    /** 用户 / 宿主设定的 FOV (deg); NaN = 尚未记录, 取 camera.fov。 */
    fovBase: NaN,
    /** 上一次由夹取写入的 FOV (deg)。 */
    fovApplied: NaN,
  };
  private readonly _gcV = new THREE.Vector3();

  /**
   * 把相机不穿地的夹取包进 controls.update(): 每次 update (主循环 / 滚轮与双指缩放的事件回调 / fitCamera / 推镜头收尾)
   * 之前先把相机放回用户想要的视距, 缩放与俯仰都作用在它上面; 之后再按地面夹取。夹取后的机位一直保留到下一次 update,
   * 所以渲染、命中检测、视线追踪看到的都是同一个相机。
   */
  private installGroundClamp(controls: OrbitControls): void {
    const update = controls.update.bind(controls);
    controls.update = (deltaTime?: number | null): boolean => {
      const zoomBase = this.restoreGroundClamp();
      const changed = update(deltaTime);
      this.applyGroundClamp(zoomBase);
      return changed;
    };
  }

  /** 用户 / 宿主设定的 FOV (夹取时 camera.fov 是补偿后的值)。 */
  private getBaseFov(): number {
    const gc = this._groundClamp;
    if (Number.isNaN(gc.fovBase) || this.camera.fov !== gc.fovApplied) return this.camera.fov;
    return gc.fovBase;
  }

  /** 用户想要的视距 (m): 夹取时是推近前的视距, 否则就是当前视距。 */
  public getDesiredCameraDistance(): number {
    if (!this.controls) return 0;
    const gc = this._groundClamp;
    if (gc.active && this._gcV.copy(this.camera.position).sub(this.controls.target).distanceToSquared(gc.applied) < 1e-10) {
      return gc.free.length();
    }
    return this.controls.getDistance();
  }

  /**
   * 把相机放回夹取前 (用户想要) 的机位。只有相机仍停在上一次夹取写入的机位时才放回 (相对目标点比较,
   * 所以相机 Y 偏移整体平移不影响); 推镜头 / fitCamera 等外部写入过相机时以外部机位为准。
   * 返回本帧缩放的起点视距 (放回成功时), 供 applyGroundClamp 判断"夹取时拉近"。
   */
  private restoreGroundClamp(): { prevDesired: number; effective: number } | null {
    const gc = this._groundClamp;
    if (!gc.active || !this.controls) return null;
    gc.active = false;
    const target = this.controls.target;
    if (this._gcV.copy(this.camera.position).sub(target).distanceToSquared(gc.applied) >= 1e-10) return null;
    this.camera.position.copy(target).add(gc.free);
    this.camera.lookAt(target);
    return { prevDesired: gc.free.length(), effective: gc.effective };
  }

  /** controls.update() 之后: 请求的机位低于 地面 + minHeight 时沿视线推近 (必要时抬高中心), 并做 FOV 补偿。 */
  private applyGroundClamp(zoomBase: { prevDesired: number; effective: number } | null): void {
    const controls = this.controls;
    if (!controls) return;
    const gc = this._groundClamp;
    const cfg = APP_CONFIG.camera.groundClamp;
    const camera = this.camera;
    const baseFov = this.getBaseFov();
    gc.fovBase = baseFov;
    const settings = {
      minHeight: cfg.minHeight,
      minDollyDistance: cfg.minDollyDistance,
      fovCompensation: cfg.fovCompensation,
      baseFov,
      maxFov: APP_CONFIG.camera.maxFov,
    };
    const target = controls.target;
    const on = cfg.enabled && this.getLineworkTheme() !== 'transparent';
    let fov = baseFov;
    if (on) {
      const free = gc.free.copy(camera.position).sub(target);
      let desired = free.length();
      // 夹取时拉近立刻生效: 从画面开始有变化的视距起算 (拉远只改想要的视距, 由 FOV 补偿体现, 俯仰回到地面以上时生效)
      if (zoomBase && desired > 1e-6) {
        const cap = visibleRatioCap(baseFov, cfg.fovCompensation, settings.maxFov);
        const next = Math.max(controls.minDistance, adjustZoomInWhileClamped(zoomBase.prevDesired, desired, zoomBase.effective, cap));
        if (next < desired) {
          free.setLength(next);
          camera.position.copy(target).add(free);
          desired = next;
        }
      }
      const r = solveGroundClamp({ targetY: target.y, polar: controls.getPolarAngle(), distance: desired, floorY: 0 }, settings);
      if (r.clamped && desired > 1e-6) {
        camera.position.copy(target).addScaledVector(free, r.distance / desired);
        camera.position.y += r.pivotRaise;
        camera.lookAt(target.x, target.y + r.pivotRaise, target.z);
        gc.applied.copy(camera.position).sub(target);
        gc.effective = r.distance;
        gc.active = true;
        fov = r.fov;
      }
    }
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    gc.fovApplied = fov;
  }

  /**
   * ponytail: 临时偏移相机 Y (调试视角用, 修饰键+滑条触发)。
   * 同时平移 camera.position.y 和 controls.target.y (相对偏移),
   * OrbitControls 内部 spherical 不变 (两向量同步移动), 用户输入保持不变。
   * offset 米, 正向上抬 (相机+目标一起上移, 视觉上场景下移), 负向下压。
   */
  public setCameraYOffset(offset: number, persist: boolean = true): void {
    if (!this.controls) return;
    const delta = offset - this._cameraYOffsetAccum;
    this.controls.target.y += delta;
    this.camera.position.y += delta;
    this._cameraYOffsetAccum = offset;
    // ponytail: 单向数据流 — vrmEngine 是 source of truth, 写 localStorage 并通知 App 同步 state
    if (typeof window !== 'undefined') {
      // 宿主显式 camera.height 不写入保存值 (persist=false), 避免宿主配置污染 iframe 自己的用户偏好
      if (persist) {
        try {
          window.localStorage.setItem(CAMERA_Y_OFFSET_KEY, String(offset));
        } catch { }
      }
      window.dispatchEvent(new CustomEvent('camera-y-offset-change', { detail: { offset } }));
    }
  }
  private _cameraYOffsetAccum = 0;

  // ponytail: devDrawer 调相机推拉上下限 — minDistance/maxDistance 是 OrbitControls
  // 的钳位属性,clamp 当前 camera-to-target 距离落在新范围内,避免改完后视角"跳"。
  public setCameraDistanceRange(minDist: number, maxDist: number): void {
    if (!this.controls) return;
    this.restoreGroundClamp(); // 按用户想要的视距钳制, 不按推近后的实际视距
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

  /**
   * 重新取景。applyExplicit=true (首次取景 / 宿主 setCameraConfig) 时宿主显式 camera.distance 生效;
   * 换装 / 换场景的重新取景用默认 false, 沿用相机当前视距 (见 resolveShot)。camera.height 每次都重新应用
   * (target 每次都从头骨重算, 偏移必须跟着重来)。
   */
  public fitCamera(applyExplicit: boolean = false): void {
    if (this.controls) {
      this.controls.enabled = true;
    }
    const head = this.currentVRM?.humanoid?.getNormalizedBoneNode('head');
    if (head && this.controls) {
      const p = new THREE.Vector3();
      head.getWorldPosition(p);
      const target = new THREE.Vector3(p.x, p.y - 0.25, p.z);
      // 距离按当前 FOV + shotExtent 算，结合宿主显式值 / 保存的俯仰角与视距还原 (resolveShot)。
      // 必须在改 controls.target 之前解算: 它可能读"相机当前相对旧目标点"的俯仰 / 视距。
      const { pitch, distance: dist } = this.resolveShot(applyExplicit);
      this.controls.target.copy(target);
      this._cameraYOffsetAccum = 0; // target 刚按头骨重算, 累计偏移归零再应用
      this.camera.position.set(...computeCameraPositionFromPitch(pitch, dist, target));
      this.controls.update();

      // 宿主显式 camera.height: 优先于保存的偏移, 且不写入保存值
      if (this.cameraOverride.height !== undefined) {
        this.setCameraYOffset(this.cameraOverride.height, false);
        return;
      }

      // ponytail: 应用持久化的 camera Y 偏移 (调试视角用), 避免 outfit swap / 重置
      // 覆盖默认 fitCamera 的 camera.position. accum 也要同步, 否则下次 setCameraYOffset
      // 会算 delta 出错.
      if (typeof window !== 'undefined') {
        try {
          const raw = window.localStorage.getItem(CAMERA_Y_OFFSET_KEY);
          if (raw !== null) {
            const v = Number(raw);
            if (Number.isFinite(v) && v !== 0) {
              this.setCameraYOffset(v);
            }
          }
        } catch { }
      }
    }
  }

  public setExpression(name: string, intensity?: number): void {
    if (!this.currentVRM?.expressionManager) return;
    this.manualExpression = name === 'neutral' ? null : name;
    expressionController.setExpression(name, intensity);
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
      this.staggeredDisposer.enqueueScene(this.currentVRM.scene, this.texturePool);
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

          const asyncInit = !preserveMotion;
          await yieldToMain();
          applyVrmUtilsOptimizations(gltf.scene, vrm);
          await yieldToMain();

          // 贴图智能共享与去重：重用头部/五官/发丝已驻留显存的纹理 (零冗余上传与显存节省)
          try {
            const imageHashes = await extractParserImageHashes(gltf.parser);
            const dedupStats = this.texturePool.deduplicateModel(vrm, gltf.parser, imageHashes);
            if (dedupStats.sharedCount > 0) {
              console.log(`[VRMEngine] 贴图去重命中: 复用 ${dedupStats.sharedCount} 张共享贴图，新增 ${dedupStats.uniqueCount} 张`);
            }
          } catch (e) {
            console.warn('[VRMEngine] 贴图去重异常 (不影响正常加载):', e);
          }
          await yieldToMain();

          vrm.scene.traverse((obj) => {
            obj.frustumCulled = false;
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              const meshName = (mesh.name || '').toLowerCase();

              // 仅剔除纯口腔内部的牙齿/舌头构件，坚决保证 Face/Head/Hair/衣服等外轮廓网格 100% 完整投射阴影
              const isPureInnerMesh =
                (meshName.includes('tooth') ||
                 meshName.includes('teeth') ||
                 meshName.includes('tongue')) &&
                !meshName.includes('face') &&
                !meshName.includes('head') &&
                !meshName.includes('hair');

              // 剔除贴脸五官细碎贴花：眼球内部、眼部高光、睫毛、眉毛、眼线紧贴脸颊，
              // 且脸部网格自身不接收阴影(receiveShadow=false)，让其投射阴影不仅徒增 Shadow Pass Draw Call，且视觉贡献为 0
              const isFacialDecal =
                (meshName.includes('iris') ||
                 meshName.includes('highlight') ||
                 meshName.includes('eyelash') ||
                 meshName.includes('eyebrow') ||
                 meshName.includes('eyeline')) &&
                !meshName.includes('hair');

              mesh.castShadow = !isPureInnerMesh && !isFacialDecal;

              const isFaceMesh =
                meshName.includes('face') ||
                meshName.includes('head') ||
                meshName.includes('eye') ||
                meshName.includes('mouth') ||
                meshName.includes('brow');
              mesh.receiveShadow = !isFaceMesh;
            }
          });

          // 委托材质管理器进行 MToon 优化与 Shader 注入
          await yieldToMain();
          this.materialManager.optimize(vrm);
          await yieldToMain();
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
            // Outfit swap: upload the new model's textures and link its programs (yielding) while the old model keeps
            // animating, instead of inside the first renderSingleFrame after the atomic swap (~400–700 ms freeze).
            await this.prewarmGpu(vrm.scene);
            // 1. 在交接瞬间抓取旧模型的最新姿态/时间戳/表情/惯性
            const swapState = this.captureAnimationState();

            // 2. 暂停/解绑旧动画控制器
            this.vrmaPlayer.stop();
            try { this.motionPipeline.universalMotion.stop(0); } catch { /* ok if idle */ }
            this.motionTransition.stop();
            this.emagePlayer.pause();

            // 3. 将所有控制器重定向绑定到新模型
            this.motionPipeline.bind(vrm);
            this.chatDirector.bindVRM(vrm);
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
            const settledBaseY = this.vrmBaseSceneY - this.footIK.getSinkOffset() + this.bodyMorph.getLegHeightDelta();
            vrm.scene.position.y = settledBaseY;
            vrm.scene.updateMatrixWorld(true);
            this.settleSpringBones(vrm);

            // 5. 同步原子切换：移除旧模型、挂入已处于正确动作姿势的新模型
            this.scene.remove(previousVrm.scene);
            this.staggeredDisposer.enqueueScene(previousVrm.scene, this.texturePool);
            this.currentVRM = vrm;
            this.scene.add(vrm.scene);
            this.notifyReady(true);

            this.preloadHeavyResources();

            if (this.controls) {
              this.renderSingleFrame();
            }
            void this.chatDirector.warmThinkingClip(vrm, this.vrmaPlayer);
            resolve(vrm);
            return;
          }

          // 常规/冷启动加载路径
          if (asyncInit && this.renderer) {
            // Compile the VRM programs off the critical frame (KHR_parallel_shader_compile when available) instead of
            // a synchronous link on the first render; scene lights are passed so the programs match the live scene.
            try {
              await this.renderer.compileAsync(vrm.scene, this.camera, this.scene);
            } catch (e) {
              console.warn('[VRMEngine] compileAsync failed, falling back to first-render compile:', e);
            }
            await yieldToMain();
          }
          this.currentVRM = vrm;
          this.scene.add(vrm.scene);
          this.notifyReady(true);

          this.motionPipeline.bind(vrm);
          this.chatDirector.bindVRM(vrm);
          this.vrmaPlayer.resetHipsRest();
          this.motionPipeline.finalPose.sampleFromVRM(vrm);
          this.bodyMorph.bind(vrm);
          this.applySpringBoneTuning(vrm);
          this.applySavedBodyYawToVRM(vrm, !preserveMotion);
          const initialBaseY = this.vrmBaseSceneY - this.footIK.getSinkOffset() + this.bodyMorph.getLegHeightDelta();
          vrm.scene.position.y = initialBaseY;
          this.motionPipeline.tick(vrm, {
            camera: this.camera,
            delta: 0,
            time: performance.now() * 0.001,
            enableBodyTurn: false,
            isSpeaking: false,
            isListening: false,
            manualExpression: this.manualExpression,
          });
          vrm.scene.updateMatrixWorld(true);
          this.settleSpringBones(vrm);
          if (typeof window !== 'undefined') {
            (window as any).emagePlayer = this.emagePlayer;
            (window as any).vrmEngine = this;
          }

          if (asyncInit) await yieldToMain();
          this.preloadHeavyResources();

          if (this.controls && !this._sceneInitialized) {
            this._sceneInitialized = true;
            this.fitCamera(true);
            const storedTheme = resolveInitialSceneTheme();
            this.setScene(storedTheme, false);
            // Cold start: upload textures / link programs in yielding steps before the first frame.
            await this.prewarmGpu();
            this.startAnimation();
            this.prepareCinematicCamera(2.0);
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
            if (!preserveMotion) {
              const scaledProgress = Math.min(45, Math.round(pct * 0.45));
              this.reportLoading({ ...state, progress: scaledProgress });
            }
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
   * Bust spring stiffness, arm colliders, and cloth fit.
   * Joint hitRadius tracks the bust bone's world scale. Cloth clearance lives on the
   * bust collider spheres, not on this radius.
   */
  public applySpringBoneTuning(vrm: VRM | null = this.currentVRM): void {
    const mgr = vrm?.springBoneManager;
    if (!mgr || !vrm) return;
    const cfg = APP_CONFIG.springBone.bust;
    const visualScale = this.bodyMorph.getBustVisualScale();

    const armColliderGroups = mgr.colliderGroups.filter((cg) => {
      const name = (cg.name ?? '').toLowerCase();
      return name.includes('arm') || name.includes('hand');
    });

    for (const joint of mgr.joints) {
      const name = joint.bone?.name ?? '';
      if (/bust/i.test(name)) {
        const isTip = /bust2/i.test(name);
        const tipRatio = cfg.tipStiffnessRatio ?? 0.9;
        joint.settings.stiffness = isTip ? cfg.stiffness * tipRatio : cfg.stiffness;
        joint.settings.dragForce = cfg.dragForce;
        joint.settings.gravityPower = cfg.gravityPower;

        if (!this.rawHitRadiusMap.has(joint)) {
          const initialRadius = joint.settings.hitRadius > 0 ? joint.settings.hitRadius : cfg.hitRadius;
          this.rawHitRadiusMap.set(joint, initialRadius);
        }
        const rawHitRadius: number = this.rawHitRadiusMap.get(joint)!;
        joint.settings.hitRadius = bustJointHitRadius(rawHitRadius, visualScale);

        // VRoid leaves bust colliderGroups empty, so the arm passes through the chest.
        if (armColliderGroups.length > 0) {
          const currentGroups = new Set(joint.colliderGroups);
          for (const acg of armColliderGroups) {
            currentGroups.add(acg);
          }
          joint.colliderGroups = Array.from(currentGroups);
        }
      }
    }

    applyBustClothFit(vrm, visualScale, cfg.clothClearance);
    bindBustArmContact(vrm);
    this.windForce.resetGravityCache();
  }

  /**
   * 弹簧骨骼加载瞬间零速预热与碰撞松弛 (两阶段防炸裙):
   * 阶段一: 临时分离/清空碰撞体 (colliderGroups = []) 并 reset 骨骼，在重力场中零冲击下垂 8 步，消除初始大穿透与瞬移爆冲；
   * 阶段二: 恢复碰撞体，迭代 16 步小物理步长，并在每步强制将 _prevTail 对齐 _currentTail，清空碰撞反弹累积动能。
   * 确保无论是初次加载、换装原子交接、还是从黑幕/隐藏切回显示并 180 度调转朝向时，裙摆与发丝均能 100% 平稳落地，绝不狂甩。
   */
  public settleSpringBones(vrm: VRM | null = this.currentVRM, disableCollidersFirst = true): void {
    if (!vrm) return;
    const mgr = vrm.springBoneManager;
    if (!mgr) return;

    vrm.scene.updateMatrixWorld(true);

    for (const joint of mgr.joints) {
      (joint as any).reset?.();
    }

    // 1. 临时保存并断开所有 joint 的碰撞体组，避免瞬间深穿透引发物理爆炸推斥
    const savedColliderGroups = new Map<any, any[]>();
    if (disableCollidersFirst) {
      for (const joint of mgr.joints) {
        savedColliderGroups.set(joint, joint.colliderGroups);
        joint.colliderGroups = [];
      }
    }

    const subDelta = 0.016;

    // 阶段一: 无碰撞重力垂顺迭代 (8 步)，让布料自然沉降
    const freeSteps = disableCollidersFirst ? 8 : 0;
    for (let step = 0; step < freeSteps; step++) {
      mgr.update(subDelta);
      for (const joint of mgr.joints) {
        const j = joint as unknown as { _currentTail?: THREE.Vector3; _prevTail?: THREE.Vector3 };
        if (j._currentTail && j._prevTail) {
          j._prevTail.copy(j._currentTail);
        }
      }
      vrm.scene.updateMatrixWorld(true);
    }

    // 恢复碰撞体组
    if (disableCollidersFirst) {
      for (const joint of mgr.joints) {
        const saved = savedColliderGroups.get(joint);
        if (saved) joint.colliderGroups = saved;
      }
    }

    // 阶段二: 开启碰撞体进行松弛贴合迭代 (16 步)，每步清零初速度 (prevTail = currentTail)
    for (let step = 0; step < 16; step++) {
      mgr.update(subDelta);
      for (const joint of mgr.joints) {
        const j = joint as unknown as { _currentTail?: THREE.Vector3; _prevTail?: THREE.Vector3 };
        if (j._currentTail && j._prevTail) {
          j._prevTail.copy(j._currentTail);
        }
      }
      vrm.scene.updateMatrixWorld(true);
    }
  }

  /**
   * 动态调节胸部弹簧骨骼刚度与阻尼物理属性
   */
  public updateBustSpringPhysics(params?: {
    stiffness?: number;
    dragForce?: number;
    gravityPower?: number;
    tipStiffnessRatio?: number;
  }): void {
    if (!params) {
      this.applySpringBoneTuning();
      return;
    }
    const mgr = this.currentVRM?.springBoneManager;
    if (!mgr) return;
    const cfg = APP_CONFIG.springBone.bust;
    const tipRatio = params.tipStiffnessRatio ?? cfg.tipStiffnessRatio ?? 0.9;
    for (const joint of mgr.joints) {
      const name = joint.bone?.name ?? '';
      if (/bust/i.test(name)) {
        const isTip = /bust2/i.test(name);
        if (params.stiffness !== undefined) {
          joint.settings.stiffness = isTip ? params.stiffness * tipRatio : params.stiffness;
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
          const clip = await this.vrmaPlayer.parseBufferToClip(buf, vrm, { antiClip: true });
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
          const clip = await this.vrmaPlayer.parseBufferToClip(buf, vrm, { antiClip: true });
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
  public async swapOutfit(
    url: string,
    filename: string,
    options?: SwapOutfitOptions,
  ): Promise<void> {
    // ponytail: addon URL 走 composeOutfit 路径(worker 内 unzip + 合成完整 GLB),
    // 普通 URL (.vrm / blob:) 走 loadVRM 直通。.vrmbase 是 cold-start 的 whole-glb zip,
    // 跟 .vrmaddon 走同一条 worker 通道。
    //
    // 进度事件分发:
    //   - onSwapProgress — 始终发,TopHeader 按钮 spinner 用。
    //   - onLoadingChange — 只在 preserveMotion=false 时发(冷启动),LoadingOverlay 用。
    //   中途换装 (preserveMotion=true) overlay 已被 loadVRM 跳过,只靠按钮反馈。
    const preserveMotion = this.currentVRM !== null;
    const wasSpeakingOrThinkingAtStart = this.turnState === 'thinking' || this.turnState === 'speaking' || this.chatDirector.speaking;
    const phaseLabel = preserveMotion ? 'swappingOutfit' : 'loadingModel';
    const subtitleVars = { name: filename };
    if (!preserveMotion) {
      this.resetLoadingProgress();
      this.reportLoading({ active: true, subtitleKey: phaseLabel, subtitleVars, progress: 0 });
      // 冷启动期并行提前拉取 EMAGE 模型，与 VRM 下载/Worker 组装充分并发
      if (isHeavyPreloadAllowed()) {
        void this.emagePlayer.ensureLoaded();
      }
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
        if (!preserveMotion) {
          this.reportLoading({ active: true, subtitleKey: 'parsingModel', subtitleVars, progress: 45 });
        }
        await this.loadVRMFromBuffer(composed, filename, { preserveMotion });
        if (!preserveMotion) {
          this.reportLoading({ active: true, subtitleKey: 'parsingModel', subtitleVars, progress: 55 });
        }
        this.notifyOutfitChange(addonKey);
      } else if (!this.currentVRM) {
        if (!preserveMotion) {
          this.reportLoading({ active: true, subtitleKey: 'parsingModel', subtitleVars, progress: 45 });
        }
        await this.loadVRM(url, filename);
        if (!preserveMotion) {
          this.reportLoading({ active: true, subtitleKey: 'parsingModel', subtitleVars, progress: 55 });
        }
        this.notifyOutfitChange('__upload__');
      } else {
        await this.loadVRM(url, filename, { preserveMotion: true });
        this.notifyOutfitChange('__upload__');
      }

      // 运行时换衣且当前未在对话/思考/倾听（且非会话中换装），自动从走秀动作组按权重随机抽取并展示
      const isChatActive = this.turnState === 'thinking' || this.turnState === 'speaking' || this.turnState === 'listening' || this.chatDirector.speaking;
      const shouldShowcase = preserveMotion && !wasSpeakingOrThinkingAtStart && !isChatActive && (options?.showcase ?? true);
      if (shouldShowcase) {
        const showcaseMotion = selectMotionFromGroup('outfitShowcase');
        void this.playMotion(showcaseMotion, { fadeDuration: 0.6, loop: false }).catch((e) => {
          console.warn('[vrmEngine] outfit showcase motion notice:', e);
        });
      }

      // 冷启动阶段：等待 EMAGE 动作模型加载就绪，使 LoadingOverlay 的 04 动作管线就绪名副其实
      // 破次元进入 3D 舞台后小春开口第一句话可直接无缝做出灵动肢体动作
      if (!preserveMotion && isHeavyPreloadAllowed()) {
        let emageProgress = 55;
        this.reportLoading({ active: true, subtitleKey: 'madMotionSync', subtitleVars, progress: emageProgress });
        try {
          // 最多等待 25s（容纳 25~50 Mbps 宽带与移动网络冷启动拉取 68MB ONNX 及 WASM 会话编译），超时兜底放行
          await Promise.race([
            this.emagePlayer.ensureLoaded((msg) => {
              const match = msg.match(/\[(\d+)\/(\d+)\]/);
              if (match) {
                const current = Number(match[1]);
                const total = Number(match[2]);
                if (total > 0) {
                  emageProgress = Math.min(98, Math.round(55 + (current / total) * 43));
                  this.reportLoading({ active: true, subtitleKey: 'madMotionSync', subtitleVars, progress: emageProgress });
                }
              }
            }),
            new Promise((resolve) => setTimeout(resolve, 25000)),
          ]);
        } catch (e) {
          console.warn('[vrmEngine] cold-start emage load notice:', e);
        }
      }
    } finally {
      // ponytail: 末尾回调 — 成功 / 失败都发,UI 收起 spinner + overlay。
      // 用 progress:100 而非 0 — 上一版本用 0 让 bar 倒带回 0%,看着像失败。
      this.onSwapProgress?.({ active: false, subtitleKey: '', progress: 100 });
      if (!preserveMotion) {
        this.reportLoading({ active: false, subtitleKey: '', progress: 100 });
        // 冷启动进入 3D 舞台：遮罩淡出时立即起播 greeting (热情招手问候)，在招手展开时平滑推镜头
        const isChatActive = this.turnState === 'thinking' || this.turnState === 'speaking' || this.turnState === 'listening' || this.chatDirector.speaking;
        if (!isChatActive && this.turnState === 'idle' && !this.interaction.getState().isDragging && (options?.showcase ?? true)) {
          // 1. 立即播放 greeting 招手（遮罩淡出的同时小春已在正向迎客抬手，零等待延迟）
          void this.playMotionGroup('greeting', { fadeDuration: 0.65, loop: false, isColdStartGreeting: true }).catch((e) => {
            console.warn('[vrmEngine] cold-start greeting motion notice:', e);
          });
          // 2. 然后推镜头 (在小春抬手热情招手展开至高位时，镜头平滑推向角色特写)
          this._coldStartIntroTimer = setTimeout(() => {
            this._coldStartIntroTimer = null;
            const stillClean = this.turnState === 'idle' && !this.chatDirector.speaking && !this.interaction.getState().isDragging;
            if (stillClean) {
              this.cinematicIntro(1200);
            }
          }, 600);
          // 3. 招手致意与镜头落定后（约 2.8s）：若有待恢复的历史偏角，启动 bodyTurn 迈步自然转回记录点
          this._coldStartTurnTimer = setTimeout(() => {
            this._coldStartTurnTimer = null;
            if (this._pendingColdStartTargetYaw !== null) {
              const targetYaw = this._pendingColdStartTargetYaw;
              this._pendingColdStartTargetYaw = null;
              const stillClean = this.turnState === 'idle' && !this.chatDirector.speaking && !this.interaction.getState().isDragging;
              if (stillClean && this.currentVRM) {
                this.motionPipeline.targetYawOffset = targetYaw;
              }
            }
          }, 2800);
        } else {
          this.cinematicIntro(1100);
          if (this._pendingColdStartTargetYaw !== null) {
            const targetYaw = this._pendingColdStartTargetYaw;
            this._pendingColdStartTargetYaw = null;
            this.motionPipeline.targetYawOffset = targetYaw;
          }
        }
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
      this.staggeredDisposer.enqueueScene(this.currentVRM.scene, this.texturePool);
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

          await yieldToMain();
          applyVrmUtilsOptimizations(gltf.scene, vrm);
          await yieldToMain();

          // 贴图智能共享与去重：重用头部/五官/发丝已驻留显存的纹理 (零冗余上传与显存节省)
          try {
            const imageHashes = await extractParserImageHashes(gltf.parser);
            const dedupStats = this.texturePool.deduplicateModel(vrm, gltf.parser, imageHashes);
            if (dedupStats.sharedCount > 0) {
              console.log(`[VRMEngine] 贴图去重命中: 复用 ${dedupStats.sharedCount} 张共享贴图，新增 ${dedupStats.uniqueCount} 张`);
            }
          } catch (e) {
            console.warn('[VRMEngine] 贴图去重异常 (不影响正常加载):', e);
          }
          await yieldToMain();

          vrm.scene.traverse((obj) => {
            obj.frustumCulled = false;
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              const meshName = (mesh.name || '').toLowerCase();

              // 仅剔除纯口腔内部的牙齿/舌头构件，坚决保证 Face/Head/Hair/衣服等外轮廓网格 100% 完整投射阴影
              const isPureInnerMesh =
                (meshName.includes('tooth') ||
                 meshName.includes('teeth') ||
                 meshName.includes('tongue')) &&
                !meshName.includes('face') &&
                !meshName.includes('head') &&
                !meshName.includes('hair');

              // 剔除贴脸五官细碎贴花：眼球内部、眼部高光、睫毛、眉毛、眼线紧贴脸颊，
              // 且脸部网格自身不接收阴影(receiveShadow=false)，让其投射阴影不仅徒增 Shadow Pass Draw Call，且视觉贡献为 0
              const isFacialDecal =
                (meshName.includes('iris') ||
                 meshName.includes('highlight') ||
                 meshName.includes('eyelash') ||
                 meshName.includes('eyebrow') ||
                 meshName.includes('eyeline')) &&
                !meshName.includes('hair');

              mesh.castShadow = !isPureInnerMesh && !isFacialDecal;

              const isFaceMesh =
                meshName.includes('face') ||
                meshName.includes('head') ||
                meshName.includes('eye') ||
                meshName.includes('mouth') ||
                meshName.includes('brow');
              mesh.receiveShadow = !isFaceMesh;
            }
          });

          await yieldToMain();
          this.materialManager.optimize(vrm);
          await yieldToMain();
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
            // Outfit swap: upload the new model's textures and link its programs (yielding) while the old model keeps
            // animating, instead of inside the first renderSingleFrame after the atomic swap (~400–700 ms freeze).
            await this.prewarmGpu(vrm.scene);
            // 1. 在交接瞬间抓取旧模型的最新姿态/时间戳/表情/惯性
            const swapState = this.captureAnimationState();

            // 2. 暂停/解绑旧动画控制器
            this.vrmaPlayer.stop();
            try { this.motionPipeline.universalMotion.stop(0); } catch { /* ok if idle */ }
            this.motionTransition.stop();
            this.emagePlayer.pause();

            // 3. 将所有控制器重定向绑定到新模型
            this.motionPipeline.bind(vrm);
            this.chatDirector.bindVRM(vrm);
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
            const settledBaseY = this.vrmBaseSceneY - this.footIK.getSinkOffset() + this.bodyMorph.getLegHeightDelta();
            vrm.scene.position.y = settledBaseY;
            vrm.scene.updateMatrixWorld(true);
            this.settleSpringBones(vrm);

            // 5. 同步原子切换：移除旧模型、挂入已处于正确动作姿势的新模型
            this.scene.remove(previousVrm.scene);
            this.staggeredDisposer.enqueueScene(previousVrm.scene, this.texturePool);
            this.currentVRM = vrm;
            this.scene.add(vrm.scene);
            this.notifyReady(true);

            this.preloadHeavyResources();

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
          this.chatDirector.bindVRM(vrm);
          this.vrmaPlayer.resetHipsRest();
          this.motionPipeline.finalPose.sampleFromVRM(vrm);
          this.bodyMorph.bind(vrm);
          this.applySpringBoneTuning(vrm);
          this.applySavedBodyYawToVRM(vrm, !preserveMotion);
          const initialBaseY = this.vrmBaseSceneY - this.footIK.getSinkOffset() + this.bodyMorph.getLegHeightDelta();
          vrm.scene.position.y = initialBaseY;
          this.motionPipeline.tick(vrm, {
            camera: this.camera,
            delta: 0,
            time: performance.now() * 0.001,
            enableBodyTurn: false,
            isSpeaking: false,
            isListening: false,
            manualExpression: this.manualExpression,
          });
          vrm.scene.updateMatrixWorld(true);
          this.settleSpringBones(vrm);
          if (typeof window !== 'undefined') {
            (window as any).emagePlayer = this.emagePlayer;
            (window as any).vrmEngine = this;
          }

          this.preloadHeavyResources();

          if (this.controls && !this._sceneInitialized) {
            this._sceneInitialized = true;
            this.fitCamera(true);
            const storedTheme = resolveInitialSceneTheme();
            this.setScene(storedTheme, false);
            // Cold start: upload textures / link programs in yielding steps before the first frame.
            await this.prewarmGpu();
            this.startAnimation();
            this.prepareCinematicCamera(2.0);
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
        const rawPct = e.data.pct;
        this.onSwapProgress?.({ active: true as const, subtitleKey: phaseLabel, subtitleVars: meta?.subtitleVars, progress: rawPct });
        if (meta && !meta.preserveMotion) {
          // compose 占整个冷启动加载的 0% ~ 45% 空间，留出后段给模型解析(45~55%)与动作引擎预热(55~98%)
          const scaledProgress = Math.min(45, Math.round(rawPct * 0.45));
          this.reportLoading({ active: true, subtitleKey: phaseLabel, subtitleVars: meta.subtitleVars, progress: scaledProgress });
        }
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

  // ── 待机自发小动作调度器 (Idle Flavor / Fidget Scheduler) ──
  private idleFlavorTimer = 0;
  private nextIdleFlavorInterval = 14 + Math.random() * 10; // 14s ~ 24s 随机冷却窗口
  private enableIdleFlavor = (APP_CONFIG as any)?.idleFlavor?.enabled ?? true;

  /** 是否开启待机自发小动作 */
  public setEnableIdleFlavor(enable: boolean): void {
    this.enableIdleFlavor = enable;
    if (!enable) this.idleFlavorTimer = 0;
  }

  public get isIdleFlavorEnabled(): boolean {
    return this.enableIdleFlavor;
  }

  /** 是否处于 DevDrawer 打开状态（打开调试抽屉期间彻底静默 idleFlavor 自发小动作，防动作调试串流冲突） */
  public isDevDrawerOpen = false;

  public setDevDrawerOpen(isOpen: boolean): void {
    this.isDevDrawerOpen = isOpen;
    if (isOpen) {
      this.resetIdleFlavorTimer();
    }
  }

  /** 重置待机小动作计时器（在用户交互、发消息、换装时调用） */
  public resetIdleFlavorTimer(): void {
    this.idleFlavorTimer = 0;
    const minSec = (APP_CONFIG as any)?.idleFlavor?.minIntervalSec ?? 14;
    const maxSec = (APP_CONFIG as any)?.idleFlavor?.maxIntervalSec ?? 24;
    this.nextIdleFlavorInterval = minSec + Math.random() * Math.max(1, maxSec - minSec);
  }

  /** 待机小动作逐帧心跳（在 render 循环中驱动） */
  private updateIdleFlavor(delta: number): void {
    if (!this.enableIdleFlavor || !this.currentVRM || this.isDevDrawerOpen) return;

    // 前置守卫：必须处于纯粹待机（idle），且无对话、无动作播放、无过渡融合
    const isCleanIdle =
      this.turnState === 'idle' &&
      !this.chatDirector.speaking &&
      !this.motionPipeline.isMotionPlaying() &&
      !this.motionPipeline.isTransitioning();

    if (!isCleanIdle) {
      this.idleFlavorTimer = 0;
      return;
    }

    // 若用户正在拖拽镜头或与角色进行 3D 交互，重置计时器并清除冷启动待转角度
    if (this.interaction.getState().isDragging) {
      this._pendingColdStartTargetYaw = null;
      this.idleFlavorTimer = 0;
      return;
    }

    this.idleFlavorTimer += delta;
    if (this.idleFlavorTimer >= this.nextIdleFlavorInterval) {
      this.idleFlavorTimer = 0;
      const minSec = (APP_CONFIG as any)?.idleFlavor?.minIntervalSec ?? 14;
      const maxSec = (APP_CONFIG as any)?.idleFlavor?.maxIntervalSec ?? 24;
      this.nextIdleFlavorInterval = minSec + Math.random() * Math.max(1, maxSec - minSec);
      const motionId = selectMotionFromGroup('idleFlavor');
      void this.playMotion(motionId, { fadeDuration: 0.85, loop: false }).catch((e) => {
        console.warn('[VRMEngine] 待机小动作播放提示:', e);
      });
    }
  }

  // ── 万能动作播放接口 ──
  public async playMotion(
    input: MotionCatalogId | string | ArrayBuffer | THREE.AnimationClip,
    options: PlayMotionOptions = {},
  ): Promise<UniversalMotionHandle> {
    this.resetIdleFlavorTimer();
    if (!options.isColdStartGreeting) {
      this.cancelColdStartWelcoming();
    }
    if (!this.currentVRM) {
      throw new Error('[VRMEngine] 模型尚未就绪，无法播放动作');
    }
    let targetInput: string | ArrayBuffer | THREE.AnimationClip = input;
    let mergedOptions: PlayMotionOptions = { ...options };

    if (typeof input === 'string') {
      if (isMotionCatalogId(input)) {
        const catalogItem = MOTION_CATALOG[input];
        targetInput = catalogItem.url;
        mergedOptions = { ...catalogItem, ...options };
      } else {
        targetInput = resolveMotionUrl(input);
      }
    }

    const lookAtOffsets = this.gazeController.getLookAtOffsets();
    return this.motionPipeline.playMotion(this.currentVRM, targetInput, mergedOptions, lookAtOffsets);
  }

  /**
   * 从指定动作组按权重随机抽取动作并播放
   * @param groupName 动作组名 (如 'greeting' | 'outfitShowcase' | 'praiseCute' 等)
   * @param options 播放配置
   */
  public playMotionGroup(
    groupName: MotionGroupName,
    options: PlayMotionOptions = {},
  ): Promise<UniversalMotionHandle> {
    const motionId = selectMotionFromGroup(groupName);
    return this.playMotion(motionId, options);
  }

  public stopMotion(fadeDuration = 0.75): void {
    const lookAtOffsets = this.gazeController.getLookAtOffsets();
    this.motionPipeline.stopMotion(fadeDuration, lookAtOffsets);
  }

  public pauseMotion(): void {
    this.motionPipeline.universalMotion.pause();
  }

  public resumeMotion(): void {
    this.motionPipeline.universalMotion.resume();
  }

  public isMotionPaused(): boolean {
    return this.motionPipeline.universalMotion.isPaused();
  }

  public setMotionTimeScale(scale: number): void {
    this.motionPipeline.universalMotion.setTimeScale(scale);
  }

  public getMotionTimeScale(): number {
    return this.motionPipeline.universalMotion.getTimeScale();
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
  public async speakText(text: string, voiceOverride?: string): Promise<void> {
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

    await this.chatDirector.speakText(text, this.currentVRM, this.vrmaPlayer, this.emagePlayer, setStatus, voiceOverride);
  }

  /**
   * 宿主直接给音频: 跳过 LLM 与 TTS, 音频 → EMAGE → 动作 + 播放 + 口型 (见 ChatDirector.speakAudio / director/hostAudio.ts)。
   * 首次调用才会加载 EMAGE (heavy 资源仍然懒加载); opts.motion=false 时完全不加载。
   * opts.audible=false 时不把声音送到扬声器, 动作时钟和口型照常。
   * opts.playbackRate (0.25~3) 与 opts.volume (0~1) 只作用于这次宿主音频; 正在播时用 setTransport。
   * 整段音频与流式音频走同一入口: input.chunks 只 yield 一次 = 整段。
   */
  public async speakAudio(
    input: HostAudioInput,
    opts: {
      motion?: boolean;
      lipsync?: boolean;
      audible?: boolean;
      text?: string;
      playbackRate?: number;
      volume?: number;
      hostClock?: boolean;
      onAudibleStart?: () => void;
    } = {},
  ): Promise<void> {
    if (!this.currentVRM) return;
    const setStatus = (
      key: string,
      vars?: Record<string, unknown>,
      isError = false,
      speechText?: string,
      segmentIndex?: number,
      totalSegments?: number,
    ) => {
      if (this.currentVRM) this.bodyMorph.getHeadTopWorldPosition(this.tempHeadTopPos);
      this.bubbleTracker.setStatus(
        key, this.currentVRM, this.camera, vars, isError, speechText, segmentIndex, totalSegments,
        this.currentVRM ? this.tempHeadTopPos : undefined,
      );
    };
    await this.chatDirector.speakAudio(input, this.currentVRM, this.vrmaPlayer, this.emagePlayer, setStatus, opts);
  }

  /** 改当前宿主音频的倍速或音量。没在说话时先记下, 下一次 speakAudio 用。不影响 TTS。 */
  public setTransport(opts: { playbackRate?: number; volume?: number }): void {
    this.chatDirector.setTransport(opts);
  }

  /** 宿主时钟 (xc.clock): 宿主音频当前位置 / 是否在走 / 倍速。只在 speakAudio hostClock 模式下生效。 */
  public setHostClock(c: { time: number; playing: boolean; playbackRate?: number; seek?: boolean }): void {
    this.chatDirector.setHostClock(c);
  }

  /** 打断当前说话（文字和音频），并收掉头顶字幕。 */
  public stopSpeaking(): void {
    try {
      this.chatDirector.stop();
      this.bubbleTracker.hide();
    } catch { /* ignore */ }
  }

  /** TTS 语音后处理插件处理器 (Tone.js) */
  public get vocalProcessor(): VocalAudioProcessor {
    return this.chatDirector.vocalProcessor;
  }

  /** 获取当前 TTS 语音美化声学配置 */
  public getVocalConfig(): VocalAudioConfig {
    return this.chatDirector.vocalProcessor.getConfig();
  }

  /** 更新 TTS 语音美化参数 (实时生效) */
  public setVocalConfig(partial: Partial<VocalAudioConfig>): void {
    this.chatDirector.vocalProcessor.updateConfig(partial);
  }

  /** 切换 TTS 语音美化预设风格 */
  public setVocalPreset(preset: VocalPresetKey): void {
    this.chatDirector.vocalProcessor.setPreset(preset);
  }

  /** 当前是否正在说话中 */
  public get isSpeaking(): boolean {
    return this.chatDirector.speaking;
  }

  private speakingListeners = new Set<(speaking: boolean) => void>();

  public onSpeakingChange(cb: (speaking: boolean) => void): () => void {
    this.speakingListeners.add(cb);
    cb(this.isSpeaking);
    return () => this.speakingListeners.delete(cb);
  }

  /** 当前对话状态 ('idle' | 'listening' | 'thinking' | 'speaking') */
  public get turnState(): TurnState {
    return this.chatDirector.turnState;
  }

  public setTurnState(state: TurnState): void {
    this.resetIdleFlavorTimer();
    if (state !== 'idle') {
      this.cancelColdStartWelcoming();
    }
    this.chatDirector.setTurnState(state);
  }

  private turnStateListeners = new Set<(state: TurnState) => void>();

  public onTurnStateChange(cb: (state: TurnState) => void): () => void {
    this.turnStateListeners.add(cb);
    cb(this.turnState);
    return () => this.turnStateListeners.delete(cb);
  }



  /**
   * 预加载重资源 (EMAGE ONNX + WebLLM)。
   * 主站: VRM 加载完成即自动预热 (行为不变)。
   * /embed 默认 heavy=lazy: 跳过自动预热, 宿主 `xc.setConfig{heavy:'eager'|'motion'}` 或首次互动时再显式调用。
   * heavy=motion 只预热 EMAGE, 从不预热 WebLLM。
   * force=true 忽略 lazy 开关 (显式预热)。opts.llm 不传时按 heavy 策略决定是否预热 WebLLM。
   */
  public preloadHeavyResources(force = false, opts: { llm?: boolean } = {}): void {
    if (!force && !isHeavyPreloadAllowed()) return;
    if (!this.emagePlayer.ready) void this.emagePlayer.ensureLoaded();
    if (opts.llm ?? isLlmPreloadAllowed()) preloadWebLLM();
    if (this.currentVRM) {
      void motionAssetManager.warmCatalogMotions(this.currentVRM, (input, vrm, options) =>
        this.motionPipeline.universalMotion.parseToClip(input, vrm, options),
      );
    }
    // new AudioContext() is a ~150 ms synchronous main-thread call (macOS CoreAudio); do it now, behind the loading
    // overlay, instead of mid-chat where it froze the VRM for a frame burst right as speech starts.
    setTimeout(() => this.chatDirector.prewarmAudio(), 0); // own task, not stacked on VRM setup
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
      this.applyEnvironmentLight();
      if (!this.renderer.shadowMap.autoUpdate) {
        this.renderer.shadowMap.needsUpdate = true;
      }
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
      // 用累加 interval 锁相 + 半帧容差（避免纳秒级时钟抖动造成意外丢帧）；掉队超过 1 拍则重置。
      if (this._animFrameIntervalMs > 0) {
        const tolerance = Math.min(4, this._animFrameIntervalMs * 0.25);
        if (this._lastAnimTs === 0) {
          // 本帧立刻跑，下一拍锁在 +interval
          this._lastAnimTs = timestamp + this._animFrameIntervalMs;
        } else if (timestamp < this._lastAnimTs - tolerance) {
          return;
        } else {
          this._lastAnimTs += this._animFrameIntervalMs;
          if (this._lastAnimTs < timestamp - this._animFrameIntervalMs) {
            this._lastAnimTs = timestamp + this._animFrameIntervalMs;
          }
        }
      }

      // 视口动态物理尺寸跟随（由 resize 事件标记驱动，避免每帧无谓轮询 innerWidth/innerHeight）
      if (this._viewportDirty) {
        this._viewportDirty = false;
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
      }

      const delta = Math.min(this.clock.getDelta(), 0.1);
      const time = this.clock.getElapsedTime();

      // 持续驱动线稿背景世界的动态喷水花坛（水珠物理重力飞溅与同心涟漪波纹）
      this.lineworkWorld.update(delta, time);
      // 持续驱动虚空星尘粒子的微动悬浮
      this.voidWorld.update(delta, time);

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
          isListening: this.turnState === 'listening',
          manualExpression: this.manualExpression,
        });

        this.chatDirector.tick(vrm, this.vrmaPlayer);
        this.updateIdleFlavor(delta);

        // The spring hits raw arm colliders. Swing the normalized arm first;
        // vrm.update copies it onto those bones. The shader cannot move them.
        clearBustArms(vrm);

        // 活体动态表情系统逐帧更新 (眉眼与口型解耦、呼吸微波动与眨眼)
        expressionController.update(delta, vrm, this.chatDirector.speaking);

        // ponytail: 注入 wind (ambient + 鼠标冲量) 到 springBone joints 的 gravityDir/Power,
        // 必须在 vrm.update(delta) 之前, 因为 springBoneManager.update() 内部读取这些 settings.
        this.windForce.applyTo(vrm, delta, this.camera);
        vrm.update(delta);

        // ponytail: 3D 引导轨 (TurnGuide + PitchGuide + CameraYGuide) 全在 interaction 内每帧 update,
        // 这里什么都不做 — interaction.update() 在下面 shadow.update() 之后调一次。

        if (this.bodyMorph.isCompatible) {
          this.bodyMorph.update(vrm);
        }
        updateBustArmContact(vrm);

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

      // 相机不穿地的夹取包在 controls.update 里 (见 installGroundClamp)
      this.controls?.update();

      // 实时驱动语音后处理插件的镜头空间声学衰减 (推近贴耳、拉远空气高频衰减、俯仰离轴遮蔽)
      if (this.controls && this.chatDirector.vocalProcessor.ready) {
        const dist = this.controls.getDistance();
        const pitch = this.controls.getPolarAngle();
        const bodyYaw = vrm?.scene.rotation.y ?? 0;
        this.chatDirector.vocalProcessor.updateCameraAcoustics({ distance: dist, pitch, bodyYaw });
      }
      try {
        // 场景时间 → 引擎主光 (角色的受光与脚下落影跟随场景的太阳 / 月亮)
        this.applyEnvironmentLight();
        if (this.renderer && !this.renderer.shadowMap.autoUpdate) {
          const interval = Math.max(1, APP_CONFIG.shadow.updateIntervalFrames ?? 2);
          this._shadowFrameCount++;
          if (this._shadowFrameCount % interval === 0) {
            this.renderer.shadowMap.needsUpdate = true;
          }
        }
        if (this.postFx.isReady() && this.postFx.config.enabled) {
          this.postFx.render(delta);
        } else {
          this.renderer?.render(this.scene, this.camera);
        }

        // 命中检测请求: 趁这一帧刚渲染完, 读指针处 1 个像素的 alpha (见 hitTest)
        if (this._hitReqs.length > 0) this.flushHitRequests();

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
  // 命中检测的缓存: SkinnedMesh.raycast 是 CPU 蒙皮 + 逐三角形求交, 单次可达十几毫秒 (实测占主线程大头),
  // 所以先用"骨骼包围盒"粗筛 (指针不在角色附近就零成本), 再只对可见网格求交, 命中即返回。
  private _hitMeshes: THREE.Mesh[] = [];
  private _hitBones: THREE.Bone[] = [];
  private _hitMeshesAt = 0;
  private _hitMeshesScene: THREE.Object3D | null = null;
  private _hitBox = new THREE.Box3();
  private _hitBoxAt = 0;
  private _hitVec = new THREE.Vector3();

  // ── 像素级命中检测 (透明穿透用) ──
  // SkinnedMesh 射线检测是 CPU 蒙皮 + 逐三角形, 实测单次约 10~25ms, 指针一动就卡住 3D 渲染。
  // 改成: 请求先排队, 在 animate 里这一帧渲染完后读指针处 1×1 像素的 alpha (透明背景下 alpha>0 即角色),
  // 与画面 100% 一致、零 CPU 蒙皮。读不了 (背景不透明 / 暂停渲染超时 / WebGL 异常) 时退回上面的射线检测。
  private _hitReqs: { x: number; y: number; resolve: (hit: boolean) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private _hitPixel = new Uint8Array(4);

  public hitTest(clientX: number, clientY: number): Promise<boolean> {
    return new Promise((resolve) => {
      const renderer = this.renderer;
      if (!renderer || !this.currentVRM || renderer.getClearAlpha() > 0.01) {
        resolve(this.isHitModel(clientX, clientY)); // 非透明场景: 像素 alpha 恒为 1, 没有意义
        return;
      }
      const req = {
        x: clientX,
        y: clientY,
        resolve,
        // 渲染被暂停 (页面不可见 / 离屏) 时一直等不到帧: 150ms 后退回射线检测
        timer: setTimeout(() => {
          const i = this._hitReqs.indexOf(req);
          if (i >= 0) this._hitReqs.splice(i, 1);
          resolve(this.isHitModel(clientX, clientY));
        }, 150),
      };
      this._hitReqs.push(req);
    });
  }

  private flushHitRequests(): void {
    const renderer = this.renderer;
    const reqs = this._hitReqs.splice(0);
    if (!renderer || reqs.length === 0) return;
    const canvas = renderer.domElement;
    const gl = renderer.getContext();
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? canvas.width / rect.width : 1;
    const sy = rect.height > 0 ? canvas.height / rect.height : 1;
    for (const r of reqs) {
      clearTimeout(r.timer);
      let hit: boolean;
      try {
        const px = Math.floor((r.x - rect.left) * sx);
        const py = Math.floor(canvas.height - (r.y - rect.top) * sy - 1);
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) {
          hit = false;
        } else {
          gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._hitPixel);
          hit = this._hitPixel[3] >= 128;
        }
      } catch {
        hit = this.isHitModel(r.x, r.y);
      }
      r.resolve(hit);
    }
  }

  private refreshHitCandidates(now: number, root: THREE.Object3D): void {
    if (this._hitMeshesScene === root && now - this._hitMeshesAt < 1000) return;
    this._hitMeshesScene = root;
    this._hitMeshesAt = now;
    this._hitBoxAt = 0;
    const meshes: THREE.Mesh[] = [];
    const bones = new Set<THREE.Bone>();
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const skinned = obj as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh && skinned.skeleton) for (const b of skinned.skeleton.bones) bones.add(b);
      meshes.push(obj);
    });
    this._hitMeshes = meshes;
    this._hitBones = [...bones];
  }

  /**
   * 射线检测屏幕坐标 (clientX, clientY) 是否击中小春 3D 角色模型实体
   */
  public isHitModel(clientX: number, clientY: number): boolean {
    if (!this.currentVRM || !this.camera || typeof window === 'undefined') return false;
    const now = performance.now();
    const root = this.currentVRM.scene;
    this._hitNdc.x = (clientX / window.innerWidth) * 2 - 1;
    this._hitNdc.y = -(clientY / window.innerHeight) * 2 + 1;
    this._hitRaycaster.setFromCamera(this._hitNdc, this.camera);
    this.refreshHitCandidates(now, root);

    // 粗筛: 骨骼世界坐标的包围盒 (每 150ms 重算一次, 跟得上动作) + 边距覆盖头发/裙摆
    if (this._hitBones.length > 0) {
      if (now - this._hitBoxAt > 150) {
        this._hitBoxAt = now;
        this._hitBox.makeEmpty();
        for (const b of this._hitBones) this._hitBox.expandByPoint(b.getWorldPosition(this._hitVec));
        const size = this._hitBox.getSize(this._hitVec);
        const pad = Math.max(0.3, Math.max(size.x, size.y, size.z) * 0.2);
        this._hitBox.expandByScalar(pad);
      }
      if (!this._hitRaycaster.ray.intersectsBox(this._hitBox)) return false;
    }

    for (const mesh of this._hitMeshes) {
      if (!mesh.visible) continue;
      const mat = mesh.material;
      const opaque = Array.isArray(mat) ? mat.some((m) => m.visible && m.opacity > 0.05) : !!mat && mat.visible && mat.opacity > 0.05;
      if (!opaque) continue;
      if (this._hitRaycaster.intersectObject(mesh, false).length > 0) return true; // 命中即返回
    }
    return false;
  }

  public dispose(): void {
    this.cancelColdStartWelcoming();
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
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    }
    this.controls?.dispose();

    this.staggeredDisposer.dispose();
    this.texturePool.clear();
    if (this.currentVRM) {
      this.scene.remove(this.currentVRM.scene);
      VRMUtils.deepDispose(this.currentVRM.scene);
      this.currentVRM = null;
    }

    this.renderer?.dispose();
    this.lineworkWorld.dispose(this.scene);
    this.voidWorld.dispose(this.scene);
    this.beach3d.dispose(this.scene);
    // ponytail: 角色阴影系统释放 (含 shadowPlane geometry/material + mask texture)
    this.shadow.dispose();
    this.postFx.dispose();
  }
}

export const vrmEngine = new VRMEngine();
if (typeof window !== 'undefined') {
  (window as any).vrmEngine = vrmEngine;
}
export type { LineworkTheme, SceneThemeId } from '@/types/config';
