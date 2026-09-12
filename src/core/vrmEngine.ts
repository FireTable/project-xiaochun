import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, type VRMExpressionPresetName } from '@pixiv/three-vrm';
import { CAMERA_STATE_KEY, SCENE_THEME_KEY } from '@/lib/constants';

import { VRMAMotionPlayer } from '@/motion/vrmaPlayer';
import { EmagePlayer } from '@/motion/emagePlayer';
import { FootIKSolver } from '@/motion/footIK';
import { VRMBodyMorph } from './morph/vrmBodyMorph';
import { postFxPipeline, type PostFxPipeline } from './postfx/postFxPipeline';
import { NaturalIdleSystem } from '@/motion/naturalIdle';
import { ChatDirector } from '@/director/chatDirector';
import { MotionTransitionManager } from '@/motion/motionTransition';
import { BodyTurnSystem } from '@/motion/bodyTurn';
import { MotionPipeline, type PipelineMotionSource } from '@/motion/pipeline/motionPipeline';
import type { PlayMotionOptions, UniversalMotionHandle } from '@/motion/pipeline/universalMotion';
import { preloadWebLLM, unloadWebLLM } from '@/llm/webLLMProvider';
import { APP_CONFIG, type LightConfig } from '@/config';
import { loadPostFxEnabledFromStorage, getRenderPixelRatio, resolveInitialSceneTheme } from '@/lib/utils';
import type { Lang } from '@/i18n';
import { langFromSystemPrompt } from '@/llm/prompts';

// ── 抽离子系统导入 ──
import { LineworkWorld, type LineworkTheme } from './scene/lineworkWorld';
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
import { GazeController } from '@/motion/gazeController';
import { BubbleTracker, type BubbleState } from './ui/bubbleTracker';
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
  /**
   * Outfit-swap / mid-session reload mode:
   * - Keep EMAGE motion buffer (pause + rebind instead of stop).
   * - Keep old VRM visible until the new one is ready (no empty-scene flash).
   * - Do not fitCamera / cinematic (preserve current orbit).
   * - Do not drive the full-screen loading overlay.
   * VRMA / universal mixers still detach (bound to disposed scene).
   * Caller restores via restoreAnimationState.
   */
  preserveMotion?: boolean;
}

export interface LightChannelState {
  base: number;
  enabled: boolean;
}

// 踱步转身过渡专用骨骼清单：仅限于下半身腿部与髋部，绝对不污染头颈视线追踪与上身呼吸手势
const BODY_TURN_BONES = [
  'hips',
  'leftUpperLeg', 'rightUpperLeg',
  'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot',
  'leftToes', 'rightToes',
] as const;

// ponytail: 相机视点持久化 — 用户在 OrbitControls 里调过的位置 / target
// 写到 localStorage,下次构造 OrbitControls 时直接还原,免得每次刷新都回默认。
// 不暴露 UI 旋钮,纯无感持久化。
const CAMERA_STATE_STORAGE_KEY = CAMERA_STATE_KEY;
interface SavedCameraState {
  position: [number, number, number];
  target: [number, number, number];
}
function loadSavedCameraState(): SavedCameraState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CAMERA_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed?.position) && parsed.position.length === 3 &&
      Array.isArray(parsed?.target) && parsed.target.length === 3 &&
      parsed.position.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)) &&
      parsed.target.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
    ) {
      return parsed as SavedCameraState;
    }
  } catch (e) {
    console.warn('[vrmEngine] Failed to load camera state:', e);
  }
  return null;
}
function persistCameraState(state: SavedCameraState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CAMERA_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[vrmEngine] Failed to save camera state:', e);
  }
}

/**
 * VRMEngine — 3D 核心渲染引擎中枢 (Core Engine Facade)
 * 
 * 职责：
 * 1. 负责 Three.js WebGLRenderer, PerspectiveCamera, OrbitControls 与 Scene 核心基础设施；
 * 2. 调度模型加载卸载、材质优化与骨架绑定；
 * 3. 作为高层中枢统一编排各专用子系统：
 *    - LineworkWorld (线稿场景环境)
 *    - StudioLighting (影棚 6 通道灯光系统)
 *    - VRMMaterialManager (MToon 材质分类与 Shader 饱和度注入)
 *    - MotionPipeline (统一动作融合管线)
 *    - GazeController (人机视线伴随、眨眼与神态微动)
 *    - BubbleTracker (3D 头部空间投影与气泡追踪)
 *    - ChatDirector / WebLLM (聊天流程编排)
 */
/**
 * ponytail: 默认相机位置按 FOV + shotExtent 反推距离,保证不同焦距下"主体框选
 * 大小"一致。distance = extent / (2 * tan(fov/2)),方向沿用 config 里 defaultPosition
 * 减 defaultTarget 的方向(保留原本"略高于 target 看下来"的角度)。
 */
function computeDefaultCameraPosition(): [number, number, number] {
  const target = new THREE.Vector3(...APP_CONFIG.camera.defaultTarget);
  const originalOffset = new THREE.Vector3(...APP_CONFIG.camera.defaultPosition).sub(target);
  const direction = originalOffset.clone().normalize();
  const fovRad = (APP_CONFIG.camera.defaultFov * Math.PI) / 180;
  const distance = APP_CONFIG.camera.defaultShotExtent / (2 * Math.tan(fovRad / 2));
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

  // ── 模块化独立子系统 ──
  private lineworkWorld = new LineworkWorld();
  public readonly lighting = new StudioLighting();
  public readonly materialManager = new VRMMaterialManager();
  public readonly gazeController = new GazeController();
  public readonly bubbleTracker = new BubbleTracker();

  // ── 动作管线与驱动模块 ──
  public readonly motionPipeline = new MotionPipeline();
  private motionTransition = new MotionTransitionManager();
  private vrmaPlayer = new VRMAMotionPlayer();
  private emagePlayer = new EmagePlayer();
  public readonly footIK = new FootIKSolver();
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
  private naturalIdle = new NaturalIdleSystem();
  private bodyTurn = new BodyTurnSystem();
  private chatDirector = new ChatDirector();

  // ── 实体状态 ──
  public currentVRM: VRM | null = null;
  private currentUrl: string = APP_CONFIG.model.defaultSource;
  private activePlayer: PipelineMotionSource = 'idle';
  private manualExpression: string | null = null;
  private bodyTurnIsStepping = false;
  public enableBodyTurn: boolean = APP_CONFIG.camera.defaultEnableBodyTurn ?? true;

  // ─── 头顶实时身高测量指示线与 HUD 标牌 (Height Ruler) ───
  public isHeightRulerVisible = false;
  private tempHeadTopPos = new THREE.Vector3();
  private tempRulerEdgePos = new THREE.Vector3();
  private _lastRenderedHeight = 0;

  private vrmBaseSceneY = 0;
  private shadowPlane: THREE.Mesh | null = null;

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

  constructor() {
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
    this.emagePlayer.footIK = this.footIK;
    this.emagePlayer.getLookAtOffsets = () => this.gazeController.getLookAtOffsets();
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

  public suspendRendering(): void {
    this.isRenderingSuspended = true;
  }

  public resumeRendering(): void {
    this.isRenderingSuspended = false;
    this.clock.start();
  }

  // ponytail: 启动期 cinematic 推镜 — LoadingOverlay 破次元时调,沿当前相机方向
  // 推远 3.3 倍作为起点,1.1s 内 easeOutCubic 拉回终点。
  // 终点 = loadSavedCameraState() 的记录点(若有);否则回退到默认相机位。
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
    const saved = loadSavedCameraState();
    const finalPos = saved ? new THREE.Vector3(...saved.position) : camera.position.clone();
    const finalTarget = saved ? new THREE.Vector3(...saved.target) : controls.target.clone();
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
    const initialTheme = resolveInitialSceneTheme();
    const shadowPlaneGeo = new THREE.PlaneGeometry(12, 12);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: initialTheme === 'dark' ? 0.45 : 0.20 });
    this.shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = 0;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);



    // 初始化视线系统与灯光系统
    this.gazeController.init(this.scene);
    this.lighting.init(this.scene);

    // 动作与聊天控制器事件绑定
    this.vrmaPlayer.bindTransitionManager(this.motionTransition);
    this.chatDirector.bindTransitionManager(this.motionTransition);
    this.chatDirector.onSuspendRendering = () => this.suspendRendering();
    this.chatDirector.onResumeRendering = () => this.resumeRendering();
    this.chatDirector.onInferenceStart = () => this.setInferenceMode(true);
    this.chatDirector.onInferenceEnd = () => this.setInferenceMode(false);
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

  // ── 推理期间动态调频 (稳态 30FPS + 阴影降级) ──
  private isInferenceMode = false;
  private lastFrameTime = 0;
  private lastRenderWidth = 0;
  private resizeRAFId: number | null = null;

  public setInferenceMode(enabled: boolean): void {
    this.isInferenceMode = enabled;
    if (!this.renderer) return;
    if (enabled) {
      // 大模型推理期间挂起阴影贴图高频重绘，将 GPU 算力让出给 WebGPU Prefill
      if (this.renderer.shadowMap.enabled) {
        this.renderer.shadowMap.autoUpdate = false;
      }
    } else {
      if (this.renderer.shadowMap.enabled) {
        this.renderer.shadowMap.autoUpdate = true;
        this.renderer.shadowMap.needsUpdate = true;
      }
    }
  }

  /**
   * 统一获取渲染像素比：
   * 统一走 @/lib/utils 的 getRenderPixelRatio()，无论 PostFX 是否启用，
   * 均严格使用 Math.min(window.devicePixelRatio, maxPixelRatio)，消除额外超采样开销。
   */
  public getTargetPixelRatio(): number {
    return getRenderPixelRatio();
  }

  public updatePixelRatio(): void {
    if (!this.renderer) return;
    const ratio = this.getTargetPixelRatio();
    this.renderer.setPixelRatio(ratio);
    const width = this.lastRenderWidth || window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    if (this.postFx.isReady()) {
      this.postFx.resize(width, height, ratio);
    }
  }

  public attachCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });

    const storedEnabled = loadPostFxEnabledFromStorage();
    this.postFx.config = {
      enabled: storedEnabled ?? APP_CONFIG.postfx.enabled,
      bloom: { ...APP_CONFIG.postfx.bloom },
      vignette: { ...APP_CONFIG.postfx.vignette },
      toneMapping: { ...APP_CONFIG.postfx.toneMapping },
      bc: { ...APP_CONFIG.postfx.bc },
      hs: { ...APP_CONFIG.postfx.hs },
    };

    const ratio = this.getTargetPixelRatio();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.lastRenderWidth = window.innerWidth;
    this.renderer.toneMapping = THREE.LinearToneMapping;  // ponytail: 保持原 toneMapping,postfx 不接管 (避免双重映射)
    this.renderer.toneMappingExposure = 1.08;

    this.postFx.init(this.renderer, this.scene, this.camera);
    // 当 PostFX 开关切换时动态更新 pixelRatio，关闭时彻底还原原始基线分辨率
    this.postFx.onEnabledChange = () => {
      this.updatePixelRatio();
    };
    this.postFx.applyConfig();
    this.postFx.resize(window.innerWidth, window.innerHeight, ratio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.position.set(...computeDefaultCameraPosition());
    this.camera.updateProjectionMatrix();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...APP_CONFIG.camera.defaultTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = APP_CONFIG.camera.defaultMinDistance;
    this.controls.maxDistance = APP_CONFIG.camera.defaultMaxDistance;

    // 监听 OrbitControls change,rAF 节流写入 localStorage。
    // 前 2s 屏蔽 — 覆盖 cinematicIntro tween(1.1s) + 初始 damping 收敛,
    // 避免把 tween 中间过渡位 / 默认位写进去覆盖真实状态。
    // 还原由 cinematicIntro 自己处理,这里不重复。
    let cameraSaveReady = false;
    let cameraSaveRaf: number | null = null;
    this.controls.addEventListener('change', () => {
      if (!cameraSaveReady) return;
      if (cameraSaveRaf !== null) return;
      cameraSaveRaf = requestAnimationFrame(() => {
        cameraSaveRaf = null;
        if (!this.controls) return;
        persistCameraState({
          position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
          target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
        });
      });
    });
    setTimeout(() => { cameraSaveReady = true; }, 2000);

    window.addEventListener('resize', this.handleResize);
    this.__dev_expose_once();

    if (this.canvas) {
      this.canvas.style.filter = 'none';
    }

    // ponytail: 这里不构建场景、不起渲染、不推镜,等 loadVRM 回调里
    // 跟 VRM 一起初始化,避免「空场景在 default 角度先露脸 → 角色出现 → 推镜
    // 终点又被 fitCamera 头部框选位覆盖」的三段撕裂。
  }

  private handleResize = () => {
    if (!this.renderer) return;

    if (this.resizeRAFId !== null) {
      cancelAnimationFrame(this.resizeRAFId);
    }

    this.resizeRAFId = requestAnimationFrame(() => {
      this.resizeRAFId = null;
      if (!this.renderer) return;

      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;

      // 移动端软键盘解耦保护：
      // 在移动端，软键盘弹起与收起仅改变高度 (宽度完全不变)，
      // 绝不调用昂贵的 renderer.setSize 销毁重建 WebGL Framebuffer，
      // 仅更新相机纵横比即可消除所有视觉拉伸与 100ms+ 的重建掉帧！
      const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      if (isMobile && this.lastRenderWidth === newWidth) {
        this.camera.aspect = newWidth / newHeight;
        this.camera.updateProjectionMatrix();
        return;
      }

      this.lastRenderWidth = newWidth;
      this.camera.aspect = newWidth / newHeight;
      this.camera.updateProjectionMatrix();
      const ratio = this.getTargetPixelRatio();
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(newWidth, newHeight);
      this.postFx.resize(newWidth, newHeight, ratio);
    });
  };

  // ── 外部控制代理 API ──
  public setLineworkTheme(theme: LineworkTheme, persist: boolean = true): void {
    this.lineworkWorld.setTheme(theme, this.scene);
    this.updateShadowForTheme(theme === 'dark');
    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(SCENE_THEME_KEY, theme);
      } catch {}
    }
  }

  public updateShadowForTheme(isDark: boolean): void {
    if (this.shadowPlane && this.shadowPlane.material instanceof THREE.ShadowMaterial) {
      this.shadowPlane.material.opacity = isDark ? 0.45 : 0.20;
      this.shadowPlane.material.needsUpdate = true;
    }
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
    const head = this.currentVRM?.humanoid?.getNormalizedBoneNode('head');
    if (head && this.controls) {
      const p = new THREE.Vector3();
      head.getWorldPosition(p);
      this.controls.target.set(p.x, p.y - 0.25, p.z);
      // ponytail: 同 computeDefaultCameraPosition — 距离按当前 FOV + shotExtent 算,
      // 不再硬编码 z+2.2,这样 FOV 改了 fitCamera 也不会糊脸。
      const fovRad = (this.camera.fov * Math.PI) / 180;
      const distance = APP_CONFIG.camera.defaultShotExtent / (2 * Math.tan(fovRad / 2));
      this.camera.position.set(p.x, p.y - 0.1, p.z + distance);
      this.controls.update();
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
      this.activePlayer = 'idle';
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
          vrm.scene.rotation.y = 0;

          this.resetBones(vrm);
          vrm.scene.updateMatrixWorld(true);

          const bbox = new THREE.Box3().setFromObject(vrm.scene);
          vrm.scene.position.y += -bbox.min.y;
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
            this.vrmaPlayer.bind(vrm);
            this.vrmaPlayer.resetHipsRest();
            this.motionPipeline.bind(vrm);
            this.motionPipeline.finalPose.sampleFromVRM(vrm);
            this.footIK.bind(vrm);
            this.bodyMorph.bind(vrm);
            this.emagePlayer.bind(vrm);
            this.naturalIdle.bind(vrm);
            this.bodyTurn.bind(vrm);
            if (typeof window !== 'undefined') {
              (window as any).emagePlayer = this.emagePlayer;
            }

            // 4. 在新模型上屏前，先在内存中预先恢复姿态与动画帧 (seek 到精准时刻)
            try {
              await this.restoreAnimationState(swapState, vrm);
            } catch (e) {
              console.warn('[vrmEngine] restoreAnimationState before scene attach failed:', e);
            }
            vrm.scene.updateMatrixWorld(true);

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

          this.vrmaPlayer.bind(vrm);
          this.vrmaPlayer.resetHipsRest();
          this.motionPipeline.bind(vrm);
          this.motionPipeline.finalPose.sampleFromVRM(vrm);
          this.footIK.bind(vrm);
          this.bodyMorph.bind(vrm);
          this.emagePlayer.bind(vrm);
          this.naturalIdle.bind(vrm);
          this.bodyTurn.bind(vrm);
          if (typeof window !== 'undefined') {
            (window as any).emagePlayer = this.emagePlayer;
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

  /** Snapshot animation / expression / gaze / spring state before whole-VRM outfit reload. */
  public captureAnimationState(): OutfitSwapState {
    const vrm = this.currentVRM;
    const vrmaPlayback = this.vrmaPlayer.getPlayback();
    const emagePlayback = this.emagePlayer.getPlayback();
    const universalPlayback = this.motionPipeline.universalMotion.getPlayback();
    const thinking = this.chatDirector.isThinking;
    const emageActive = this.emagePlayer.isPlaying() || this.emagePlayer.streamingMotionActive;
    const universalLive = this.motionPipeline.isMotionPlaying();
    const vrmaLive = this.vrmaPlayer.isPlaying() || thinking;

    let motionSource: OutfitSwapState['motionSource'] = 'idle';
    if (universalLive) motionSource = 'motion';
    else if (emageActive) motionSource = 'emage';
    else if (thinking) motionSource = 'thinking';
    else if (vrmaLive) motionSource = 'vrma';

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

    // Facing: loadVRM zeros scene.rotation.y — put it back before motion resumes.
    vrm.scene.rotation.y = state.sceneYaw ?? 0;
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
      this.activePlayer = 'emage';
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
          this.vrmaPlayer.playLoop(clip, vrm, 0.01);
          this.vrmaPlayer.seek(state.vrmaTime);
          this.activePlayer = 'vrma';
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
          this.activePlayer = 'vrma';
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
        this.activePlayer = 'motion';
      } catch (e) {
        console.warn('[outfitSwap] universal motion restore failed:', e);
      }
      return;
    }

    if (!state.emageActive) {
      this.activePlayer = 'idle';
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
        );
        const addonSha = addonKey ? APP_CONFIG.model.addons[addonKey].sha : '';
        const composed = await this.composeVRMFromAddon(url, addonSha, { phaseLabel, subtitleVars, preserveMotion });
        await this.loadVRMFromBuffer(composed, filename, { preserveMotion });
        return;
      }
      if (!this.currentVRM) {
        await this.loadVRM(url, filename);
        return;
      }
      await this.loadVRM(url, filename, { preserveMotion: true });
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
      this.activePlayer = 'idle';
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
          vrm.scene.rotation.y = 0;

          this.resetBones(vrm);
          vrm.scene.updateMatrixWorld(true);

          const bbox = new THREE.Box3().setFromObject(vrm.scene);
          vrm.scene.position.y += -bbox.min.y;
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
            this.vrmaPlayer.bind(vrm);
            this.vrmaPlayer.resetHipsRest();
            this.motionPipeline.bind(vrm);
            this.motionPipeline.finalPose.sampleFromVRM(vrm);
            this.footIK.bind(vrm);
            this.bodyMorph.bind(vrm);
            this.emagePlayer.bind(vrm);
            this.naturalIdle.bind(vrm);
            this.bodyTurn.bind(vrm);
            if (typeof window !== 'undefined') {
              (window as any).emagePlayer = this.emagePlayer;
            }

            // 4. 在新模型上屏前，先在内存中预先恢复姿态与动画帧 (seek 到精准时刻)
            try {
              await this.restoreAnimationState(swapState, vrm);
            } catch (e) {
              console.warn('[vrmEngine] restoreAnimationState before scene attach failed:', e);
            }
            vrm.scene.updateMatrixWorld(true);

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

          this.vrmaPlayer.bind(vrm);
          this.vrmaPlayer.resetHipsRest();
          this.motionPipeline.bind(vrm);
          this.motionPipeline.finalPose.sampleFromVRM(vrm);
          this.footIK.bind(vrm);
          this.bodyMorph.bind(vrm);
          this.emagePlayer.bind(vrm);
          this.naturalIdle.bind(vrm);
          this.bodyTurn.bind(vrm);
          if (typeof window !== 'undefined') (window as any).emagePlayer = this.emagePlayer;

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

  private resetBones(vrm: VRM): void {
    if (!vrm.humanoid) return;
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
    return (
      this.motionPipeline.isMotionPlaying() ||
      this.vrmaPlayer.isPlaying() ||
      this.emagePlayer.isPlaying() ||
      this.chatDirector.isThinking
    );
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
      this.bubbleTracker.setStatus(
        key,
        this.currentVRM,
        this.camera,
        vars,
        isError,
        speechText,
        segmentIndex,
        totalSegments
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
      this.bubbleTracker.setStatus(
        key,
        this.currentVRM,
        this.camera,
        vars,
        isError,
        speechText,
        segmentIndex,
        totalSegments
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
      // ponytail: postfx enabled 时走 composer,disabled 时回退 renderer 直接渲
      if (this.postFx.isReady() && this.postFx.config.enabled) {
        this.postFx.render(0);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    }
  }

  // ── 核心高内聚主渲染循环 ──
  private startAnimation(): void {
    const animate = (timestamp: number) => {
      this.animFrameId = requestAnimationFrame(animate);
      if (this.isRenderingSuspended) return;

      // 移动端/推理期动态调频 (Throttle to ~30 FPS):
      // 将 GPU 瞬时算力让渡给 WebGPU Prefill，保持角色 30FPS 稳定动态呼吸，消除卡死与掉帧
      if (this.isInferenceMode) {
        const elapsedSinceLast = timestamp - this.lastFrameTime;
        if (elapsedSinceLast < 31) {
          return;
        }
      }
      this.lastFrameTime = timestamp;

      const delta = Math.min(this.clock.getDelta(), 0.1);
      const time = this.clock.getElapsedTime();

      const vrm = this.currentVRM;
      if (vrm) {
        const universalLive = this.motionPipeline.isMotionPlaying();
        const emageLive = this.emagePlayer.isPlaying();
        const vrmaLive = this.vrmaPlayer.isPlaying() || this.chatDirector.isThinking;
        const lookAtOffsets = this.gazeController.getLookAtOffsets();

        // 1. 统一动作源判定与流转 (Universal Motion State Graph)
        let targetSource: PipelineMotionSource = 'idle';
        let targetDuration = 0.88;

        if (universalLive) {
          targetSource = 'motion';
          targetDuration = this.motionPipeline.universalMotion.getCurrentOptions().fadeDuration ?? 0.75;
        } else if (emageLive) {
          targetSource = 'emage';
          targetDuration = 0.70;
        } else if (vrmaLive) {
          targetSource = 'vrma';
          targetDuration = 0.78;
        } else {
          targetSource = 'idle';
          targetDuration = 0.88;
        }

        if (this.activePlayer !== targetSource) {
          this.motionPipeline.setMotionSource(targetSource, targetDuration, lookAtOffsets);
          this.motionTransition.startTransition(vrm, targetDuration, lookAtOffsets);
          this.activePlayer = targetSource;
        }

        // 2. 驱动对应主动作更新
        if (universalLive) {
          this.motionPipeline.universalMotion.update(delta);
        } else if (emageLive) {
          this.emagePlayer.update(delta);
        } else if (vrmaLive) {
          this.vrmaPlayer.update(delta);
        } else {
          this.naturalIdle.update(time, 1.0, this.bodyTurn.isStepping());
        }

        // 裸足地锚与高度自适应：由 FootIK 解算器统一管理下沉量与背屈
        const isShoesOff = this.materialManager.partsVisibility['shoes'] === false;
        this.footIK.updateBarefoot(isShoesOff, delta);

        const currentSceneBaseY = this.vrmBaseSceneY - this.footIK.getSinkOffset() + this.bodyMorph.getLegHeightDelta();
        vrm.scene.position.y = currentSceneBaseY;
        if (this.emagePlayer) this.emagePlayer.baseY = currentSceneBaseY;

        // 3. 全局平滑过渡器加权 Slerp 统一接管 (Quintic Smootherstep 抹平一切跨状态切入切出)
        this.motionTransition.apply(vrm, delta);

        // 4. 同步管线最终姿态快照 (非破坏性只读采样)
        this.motionPipeline.finalPose.sampleFromVRM(vrm);

        // 5. 转身物理踱步系统 (BodyTurn)
        if (this.enableBodyTurn) {
          const _btHead = vrm.humanoid?.getNormalizedBoneNode('head');
          const _btPos = new THREE.Vector3();
          if (_btHead) _btHead.getWorldPosition(_btPos);
          else _btPos.copy(vrm.scene.position);
          const _dx = this.camera.position.x - _btPos.x;
          const _dz = this.camera.position.z - _btPos.z;
          const _targetYaw = Math.atan2(_dx, _dz) - vrm.scene.rotation.y;
          const normYaw = Math.atan2(Math.sin(_targetYaw), Math.cos(_targetYaw));
          const yawDelta = this.bodyTurn.update(delta, normYaw, emageLive);
          vrm.scene.rotation.y += yawDelta;

          this.handleBodyTurnHandoff(vrm);
        }

        const isStepping = this.enableBodyTurn && this.bodyTurn.isStepping();
        this.footIK.levelFeet(vrm, isStepping);

        this.chatDirector.tick(vrm, this.vrmaPlayer);

        // 6. 委托 GazeController 处理眨眼、视线追踪、思考神态与头颈微晃
        this.gazeController.update(
          vrm,
          delta,
          time,
          this.camera,
          this.chatDirector.isThinking,
          this.chatDirector.speaking,
          emageLive,
          this.manualExpression,
        );

        vrm.update(delta);
        this.bodyMorph.update(vrm);

        // 7. 实体脚下影子平面中心与地面高度贴合
        if (this.shadowPlane && vrm.humanoid) {
          const lf = vrm.humanoid.getNormalizedBoneNode('leftFoot');
          const rf = vrm.humanoid.getNormalizedBoneNode('rightFoot');
          if (lf && rf) {
            lf.getWorldPosition(this.tempSoleA);
            rf.getWorldPosition(this.tempSoleB);
            this.shadowPlane.position.x = (this.tempSoleA.x + this.tempSoleB.x) * 0.5;
            this.shadowPlane.position.z = (this.tempSoleA.z + this.tempSoleB.z) * 0.5;
          } else {
            this.shadowPlane.position.x = vrm.scene.position.x;
            this.shadowPlane.position.z = vrm.scene.position.z;
          }
          // 阴影平面高度永远紧密贴合在世界地面表面 (Y = 0.0015)，彻底杜绝空中浮空或地表错位
          this.shadowPlane.position.y = 0.0015;
        }

        // 8. 委托 BubbleTracker 更新 3D 头部气泡屏幕坐标 (带 1.5px 死区过滤)
        this.bubbleTracker.update(vrm, this.camera);

        // 9. 头顶实时身高指示折线与 3D 浮动 HUD 胶囊标牌 (彻底去掉蓝色方块，发光指示线优雅连接)
        // ponytail: liveHeight 每帧无条件读,与 canvas ruler / drawer chip 共用同一个值;
        // 只有当数字变化 ≥0.05cm 才广播 notifyHeightChange,drawer 收到后再读一次
        // (这次 scene Y 已经更新到最新),从而消灭"chip 显示旧 sceneY 虚高"的串号 bug。
        const liveHeight = this.bodyMorph.getCurrentHeightCm();
        if (Math.abs(liveHeight - this._lastRenderedHeight) >= 0.05) {
          this._lastRenderedHeight = liveHeight;
          this.notifyHeightChange();
        }
        if (this.isHeightRulerVisible) {
          this._refreshHeightRulerText();

          if (this.camera) {
            this.bodyMorph.getHeadTopWorldPosition(this.tempHeadTopPos);
            this.tempRulerEdgePos.copy(this.tempHeadTopPos).project(this.camera);

            const inView = this.tempRulerEdgePos.z <= 1.0;
            const badgeEl = typeof document !== 'undefined' ? document.getElementById('height-ruler-badge') : null;
            const svgEl = typeof document !== 'undefined' ? document.getElementById('height-ruler-svg') : null;
            const lineEl = typeof document !== 'undefined' ? document.getElementById('height-ruler-line') : null;
            const dotEl = typeof document !== 'undefined' ? document.getElementById('height-ruler-dot') : null;

            if (inView) {
              const hx = (this.tempRulerEdgePos.x * 0.5 + 0.5) * window.innerWidth;
              const hy = (-this.tempRulerEdgePos.y * 0.5 + 0.5) * window.innerHeight;

              // 标牌放置于角色头顶右上方
              const bx = Math.round(hx + 42);
              const by = Math.round(hy - 28);

              if (badgeEl) {
                badgeEl.style.transform = `translate3d(${bx}px, ${by}px, 0)`;
                badgeEl.style.opacity = '1';
              }

              if (svgEl && lineEl && dotEl) {
                svgEl.style.display = 'block';
                const midX = Math.round(hx + 20);
                const midY = Math.round(hy - 14);
                const targetY = Math.round(by + 13);
                lineEl.setAttribute('d', `M ${Math.round(hx)} ${Math.round(hy)} L ${midX} ${midY} L ${bx} ${targetY}`);
                dotEl.setAttribute('cx', String(Math.round(hx)));
                dotEl.setAttribute('cy', String(Math.round(hy)));
              }
            } else {
              if (badgeEl) badgeEl.style.opacity = '0';
              if (svgEl) svgEl.style.display = 'none';
            }
          }
        }
      }

      this.controls?.update();
      // ponytail: postfx 接管 render,disabled 时回退到原始 renderer
      if (this.postFx.isReady() && this.postFx.config.enabled) {
        this.postFx.render(delta);
      } else {
        this.renderer?.render(this.scene, this.camera);
      }
    };

    animate(0);
  }

  private handleBodyTurnHandoff(vrm: VRM): void {
    const isStepping = this.bodyTurn.isStepping();
    if (isStepping === this.bodyTurnIsStepping) return;
    this.bodyTurnIsStepping = isStepping;
    this.motionTransition.startTransition(vrm, 0.30, undefined, BODY_TURN_BONES);
  }

  public dispose(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    window.removeEventListener('resize', this.handleResize);
    this.controls?.dispose();
    this.renderer?.dispose();
    this.lineworkWorld.dispose(this.scene);
  }
}

export const vrmEngine = new VRMEngine();
export type { LineworkTheme } from './scene/lineworkWorld';
