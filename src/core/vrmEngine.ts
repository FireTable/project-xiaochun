import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, type VRMExpressionPresetName } from '@pixiv/three-vrm';

import { VRMAMotionPlayer } from '@/motion/vrmaPlayer';
import { EmagePlayer } from '@/motion/emagePlayer';
import { NaturalIdleSystem } from '@/motion/naturalIdle';
import { ChatDirector } from '@/director/chatDirector';
import { MotionTransitionManager } from '@/motion/motionTransition';
import { BodyTurnSystem } from '@/motion/bodyTurn';
import { MotionPipeline, type PipelineMotionSource } from '@/motion/pipeline/motionPipeline';
import type { PlayMotionOptions, UniversalMotionHandle } from '@/motion/pipeline/universalMotion';
import { preloadWebLLM, unloadWebLLM } from '@/llm/webLLMProvider';
import { APP_CONFIG, type LightConfig } from '@/config';
import type { Lang } from '@/i18n';
import { langFromSystemPrompt } from '@/llm/prompts';

// ── 抽离子系统导入 ──
import { LineworkWorld } from './scene/lineworkWorld';
import { StudioLighting } from './lighting/studioLighting';
import {
  VRMMaterialManager,
  type MaterialSaturationSettings,
  type MaterialSaturationPresetKey,
} from './material/vrmMaterialManager';
import { GazeController } from '@/motion/gazeController';
import { BubbleTracker, type BubbleState } from './ui/bubbleTracker';

export type { BubbleState, MaterialSaturationSettings, MaterialSaturationPresetKey };

export interface LoadingState {
  active: boolean;
  subtitleKey: string;
  subtitleVars?: Record<string, unknown>;
  progress: number;
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
  private naturalIdle = new NaturalIdleSystem();
  private bodyTurn = new BodyTurnSystem();
  private chatDirector = new ChatDirector();

  // ── 实体状态 ──
  public currentVRM: VRM | null = null;
  private currentUrl: string = APP_CONFIG.model.defaultVrm;
  private activePlayer: PipelineMotionSource = 'idle';
  private manualExpression: string | null = null;
  private bodyTurnIsStepping = false;

  private vrmSoleOffset = 0.08;
  private vrmBaseSceneY = 0;
  private shadowPlane: THREE.Mesh | null = null;

  // 临时向量复用
  private tempSoleA = new THREE.Vector3();
  private tempSoleB = new THREE.Vector3();
  private _footLevelQ = new THREE.Quaternion();
  private _footLevelParentInv = new THREE.Quaternion();

  // ── 外部状态与回调 ──
  public translateSync: ((key: string, vars?: Record<string, unknown>) => string) | null = null;
  public onLoadingChange?: (state: LoadingState) => void;
  private readyListeners = new Set<(ready: boolean) => void>();
  public isRenderingSuspended = true;

  constructor() {
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
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
  // 推远 3.3 倍作为起点,1.1s 内 easeOutCubic 拉回当前位(默认位或用户已调过的位)。
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
    const finalPos = camera.position.clone();
    const finalTarget = controls.target.clone();
    // 沿 camera→target 反方向 ×3.3 = 从同视角的远处起步,VRM 一开始是个小点
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

    // 实体阴影平面
    const shadowPlaneGeo = new THREE.PlaneGeometry(12, 12);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.25 });
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

  public attachCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, APP_CONFIG.renderer.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.lastRenderWidth = window.innerWidth;
    this.renderer.toneMapping = THREE.LinearToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.position.set(...APP_CONFIG.camera.defaultPosition);
    this.camera.updateProjectionMatrix();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...APP_CONFIG.camera.defaultTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1.0;
    this.controls.maxDistance = 8.0;

    window.addEventListener('resize', this.handleResize);

    if (this.canvas) {
      this.canvas.style.filter = 'none';
    }

    // 构建线稿场景世界并启动主循环
    this.lineworkWorld.build(this.scene);
    this.startAnimation();
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
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, APP_CONFIG.renderer.maxPixelRatio));
      this.renderer.setSize(newWidth, newHeight);
    });
  };

  // ── 外部控制代理 API ──
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

  public setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  public fitCamera(): void {
    const head = this.currentVRM?.humanoid?.getNormalizedBoneNode('head');
    if (head && this.controls) {
      const p = new THREE.Vector3();
      head.getWorldPosition(p);
      this.controls.target.set(p.x, p.y - 0.25, p.z);
      this.camera.position.set(p.x, p.y - 0.1, p.z + 2.2);
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
  public loadVRM(url: string, filename = '小蠢 (xiaochun_v1)'): void {
    this.currentUrl = url;
    this.onLoadingChange?.({
      active: true,
      subtitleKey: 'loadingModel',
      subtitleVars: { name: filename },
      progress: 0,
    });

    if (this.currentVRM) {
      this.scene.remove(this.currentVRM.scene);
      VRMUtils.deepDispose(this.currentVRM.scene);
      this.currentVRM = null;
      this.notifyReady(false);
    }
    this.chatDirector.resetClipCache();
    this.vrmaPlayer.stop();
    this.emagePlayer.stop();
    this.motionTransition.stop();
    this.manualExpression = null;
    this.activePlayer = 'idle';

    this.loader.load(
      url,
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM;
        if (!vrm) {
          alert(this.translateSync!('error.loadVrmFailed'));
          this.onLoadingChange?.({ active: false, subtitleKey: '', progress: 0 });
          this.notifyReady(false);
          return;
        }
        this.currentVRM = vrm;
        this.notifyReady(true);

        this.vrmaPlayer.bind(vrm);
        this.vrmaPlayer.resetHipsRest();
        this.motionPipeline.bind(vrm);
        this.motionPipeline.finalPose.sampleFromVRM(vrm);

        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);

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
        this.scene.add(vrm.scene);

        this.resetBones(vrm);
        vrm.scene.updateMatrixWorld(true);

        const bbox = new THREE.Box3().setFromObject(vrm.scene);
        vrm.scene.position.y += -bbox.min.y;
        this.vrmBaseSceneY = vrm.scene.position.y;
        vrm.scene.updateMatrixWorld(true);

        const lf = vrm.humanoid?.getNormalizedBoneNode('leftFoot');
        const rf = vrm.humanoid?.getNormalizedBoneNode('rightFoot');
        if (lf && rf) {
          const lfPos = new THREE.Vector3(); const rfPos = new THREE.Vector3();
          lf.getWorldPosition(lfPos); rf.getWorldPosition(rfPos);
          this.vrmSoleOffset = Math.max(0.02, Math.min(lfPos.y, rfPos.y));
        }

        this.emagePlayer.bind(vrm);
        this.naturalIdle.bind(vrm);
        this.bodyTurn.bind(vrm);
        if (typeof window !== 'undefined') {
          (window as any).emagePlayer = this.emagePlayer;
        }

        // 后台预热大模型与语音动作模型
        if (!this.emagePlayer.ready) void this.emagePlayer.ensureLoaded();
        preloadWebLLM();

        this.fitCamera();
        void this.chatDirector.warmThinkingClip(vrm, this.vrmaPlayer);
        this.renderSingleFrame();

        this.onLoadingChange?.({ active: false, subtitleKey: '', progress: 100 });
      },
      (progress) => {
        if (progress.lengthComputable) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          this.onLoadingChange?.({
            active: true,
            subtitleKey: 'loadingModel',
            subtitleVars: { name: filename },
            progress: pct,
          });
        }
      },
      (error) => {
        console.error('加载 VRM 错误:', error);
        alert(this.translateSync!('error.loadFailed'));
        this.onLoadingChange?.({ active: false, subtitleKey: '', progress: 0 });
      }
    );
  }

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

  public releaseHeavyResources(): void {
    try { this.chatDirector.stop(); } catch { }
    try { unloadWebLLM(); } catch (e) { console.warn('[VRMEngine] 释放 WebLLM 异常:', e); }
    try { this.emagePlayer.dispose(); } catch (e) { console.warn('[VRMEngine] 释放 EMAGE 异常:', e); }
    console.log('[VRMEngine] 已成功释放 WebLLM 显存与 EMAGE 运行内存');
  }

  public renderSingleFrame(): void {
    if (this.renderer && this.currentVRM) {
      this.renderer.render(this.scene, this.camera);
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
          vrm.scene.position.y = this.vrmBaseSceneY;
          this.motionPipeline.universalMotion.update(delta);
        } else if (emageLive) {
          this.emagePlayer.update(delta);
        } else if (vrmaLive) {
          vrm.scene.position.y = this.vrmBaseSceneY;
          this.vrmaPlayer.update(delta);
        } else {
          vrm.scene.position.y = this.vrmBaseSceneY;
          this.naturalIdle.update(time, 1.0, this.bodyTurn.isStepping());
        }

        // 3. 全局平滑过渡器加权 Slerp 统一接管
        this.motionTransition.apply(vrm, delta);

        // 4. 同步管线最终姿态快照 (非破坏性只读采样)
        this.motionPipeline.finalPose.sampleFromVRM(vrm);

        // 5. 转身物理踱步系统 (BodyTurn)
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

        if (vrmaLive || universalLive || !emageLive) {
          this.levelFeet(vrm);
        }

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

        // 7. 实体脚下影子平面高度贴合
        if (this.shadowPlane && vrm.humanoid) {
          const lf = vrm.humanoid.getNormalizedBoneNode('leftFoot');
          const rf = vrm.humanoid.getNormalizedBoneNode('rightFoot');
          if (lf && rf) {
            lf.getWorldPosition(this.tempSoleA);
            rf.getWorldPosition(this.tempSoleB);
            const minAnkleY = Math.min(this.tempSoleA.y, this.tempSoleB.y);
            this.shadowPlane.position.y = minAnkleY - this.vrmSoleOffset + 0.002;
          }
        }

        // 8. 委托 BubbleTracker 更新 3D 头部气泡屏幕坐标 (带 1.5px 死区过滤)
        this.bubbleTracker.update(vrm, this.camera);
      }

      this.controls?.update();
      this.renderer?.render(this.scene, this.camera);
    };

    animate(0);
  }

  private handleBodyTurnHandoff(vrm: VRM): void {
    const isStepping = this.bodyTurn.isStepping();
    if (isStepping === this.bodyTurnIsStepping) return;
    this.bodyTurnIsStepping = isStepping;
    this.motionTransition.startTransition(vrm, 0.30, undefined, BODY_TURN_BONES);
  }

  private levelFeet(vrm: VRM): void {
    if (this.bodyTurn.isStepping()) return;

    const h = vrm.humanoid;
    if (!h) return;
    const lf = h.getNormalizedBoneNode('leftFoot');
    const rf = h.getNormalizedBoneNode('rightFoot');
    const ll = h.getNormalizedBoneNode('leftLowerLeg');
    const rl = h.getNormalizedBoneNode('rightLowerLeg');

    const levelOne = (foot: THREE.Object3D | null | undefined, lower: THREE.Object3D | null | undefined) => {
      if (!foot || !lower) return;
      foot.updateWorldMatrix(true, false);
      foot.getWorldQuaternion(this._footLevelQ);
      const euler = new THREE.Euler().setFromQuaternion(this._footLevelQ, 'YXZ');
      euler.x = 0;
      euler.z = 0;
      this._footLevelQ.setFromEuler(euler);

      lower.getWorldQuaternion(this._footLevelParentInv).invert();
      this._footLevelParentInv.multiply(this._footLevelQ);
      foot.quaternion.copy(this._footLevelParentInv);
      foot.updateWorldMatrix(true, false);
    };

    levelOne(lf, ll);
    levelOne(rf, rl);
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
