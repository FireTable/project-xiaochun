import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, type VRMExpressionPresetName } from '@pixiv/three-vrm';

import { VRMAMotionPlayer } from '@/motion/vrmaPlayer';
import { EmagePlayer } from '@/motion/emagePlayer';
import { NaturalIdleSystem } from '@/motion/naturalIdle';
import { ChatDirector } from '@/director/chatDirector';
import { MotionTransitionManager } from '@/motion/motionTransition';
import { preloadWebLLM } from '@/llm/webLLM';
import { APP_CONFIG, type LightConfig, type MaterialSaturationConfig } from '@/config';

/**
 * 状态文案走 i18n key (例如 'loading.loadingModel'),由 HeadBubble/LoadingOverlay 用 t() 翻译。
 * 引擎不再直接持有最终文案,避免与 React 树耦合。
 */
export interface LoadingState {
  active: boolean;
  subtitleKey: string;
  subtitleVars?: Record<string, unknown>;
  progress: number;
}

export interface BubbleState {
  visible: boolean;
  statusKey: string;
  statusVars?: Record<string, unknown>;
  speechText: string;
  isError: boolean;
  x: number;
  y: number;
}

export interface LightChannelState {
  base: number;
  enabled: boolean;
}

export type MaterialSaturationSettings = MaterialSaturationConfig;
export type MaterialSaturationPresetKey = keyof typeof APP_CONFIG.saturation.presets;

export class VRMEngine {
  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(
    APP_CONFIG.camera.defaultFov,
    1,
    0.1,
    20.0
  );
  private controls: OrbitControls | null = null;

  /** 由 App.tsx 注入,用于把引擎内部少数原生字符串(i18n 缺位时的兜底)走翻译。 */
  public translateSync: ((key: string, vars?: Record<string, unknown>) => string) | null = null;

  /** ponytail: App.tsx 一处调用,自动同步给 chatDirector(它没暴露给外部)。 */
  public bindI18n(fn: ((key: string, vars?: Record<string, unknown>) => string) | null) {
    this.translateSync = fn;
    this.chatDirector.translateSync = fn;
  }

  /**
   * 注入 system prompt getter,根据当前 i18n 语言动态挑中/英/日版。
   * ponytail: 同 bindI18n 一样一次性传给 chatDirector,App.tsx 不用两边赋值。
   */
  public bindSystemPrompt(getter: () => string) {
    this.chatDirector.getSystemPrompt = getter;
  }

  public currentVRM: VRM | null = null;
  private motionTransition = new MotionTransitionManager();
  private vrmaPlayer = new VRMAMotionPlayer();
  private emagePlayer = new EmagePlayer();
  private naturalIdle = new NaturalIdleSystem();
  private chatDirector = new ChatDirector();

  private activePlayer: 'vrma' | 'emage' | 'idle' = 'idle';
  private manualExpression: string | null = null;
  public materialSaturation: MaterialSaturationSettings = { ...APP_CONFIG.saturation.default };
  private categorizedMaterials: {
    skin: any[];
    hair: any[];
    clothing: any[];
    eyes: any[];
  } = {
    skin: [],
    hair: [],
    clothing: [],
    eyes: [],
  };
  private currentUrl: string = APP_CONFIG.model.defaultVrm;

  public getCurrentUrl(): string {
    return this.currentUrl;
  }

  public getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  // Constants & optimal animation variables
  private readonly isAutoBlink = true;
  private readonly isAutoRotate = false;
  private readonly isIdleBreath = true;
  private readonly isLookAtEyes = true;
  private readonly isLookAtHead = true;
  private readonly isLockHead = true;

  private thinkingWeight = 0.0;
  private turnStepPhase = 0.0;
  private isTurningBody = false;
  private stepWeight = 0.0;

  private blinkTimer = 0;
  private blinkInterval = 3.0;
  private blinkDuration = 0.15;
  private isBlinking = false;
  private blinkProgress = 0;

  private vrmSoleOffset = 0.08;
  private vrmBaseSceneY = 0;
  private shadowPlane: THREE.Mesh | null = null;

  private gazeTarget = new THREE.Object3D();
  private gazeShiftTimer = 0;
  private gazeShiftInterval = 3.5;
  private gazeOffsetTarget = new THREE.Vector3(0, 0, 0);
  private gazeCurrentOffset = new THREE.Vector3(0, 0, 0);
  private isGlancingAway = false;

  // Lights
  private hemiLight = new THREE.HemisphereLight(0xfffaf4, 0x6e6268, 0.60);
  private dirLight = new THREE.DirectionalLight(0xfffbf5, 1.00);
  private fillLight = new THREE.DirectionalLight(0xe8edff, 0.80);
  private frontFill = new THREE.SpotLight(0xfff8f2, 0.70, 2.5, Math.PI / 7.5, 0.45, 1.2);
  private legLight = new THREE.SpotLight(0xfff8f2, 0.45, 4.0, Math.PI / 4.0, 0.85, 1.0);
  private leftArmLight = new THREE.SpotLight(0xfffbf7, 0.50, 1.5, Math.PI / 11, 0.4, 1.5);
  private rightArmLight = new THREE.SpotLight(0xfffbf7, 0.50, 1.5, Math.PI / 11, 0.4, 1.5);

  public lightChannels: LightConfig = {
    dir: { ...APP_CONFIG.lights.dir },
    hemi: { ...APP_CONFIG.lights.hemi },
    front: { ...APP_CONFIG.lights.front },
    fill: { ...APP_CONFIG.lights.fill },
    leg: { ...APP_CONFIG.lights.leg },
    arm: { ...APP_CONFIG.lights.arm },
    globalMult: APP_CONFIG.lights.globalMult,
  };

  private loader = new GLTFLoader();
  private clock = new THREE.Clock();
  private animFrameId: number | null = null;

  // Callbacks to React
  public onLoadingChange?: (state: LoadingState) => void;
  public onBubbleChange?: (state: BubbleState) => void;
  private readyListeners = new Set<(ready: boolean) => void>();

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
      try { cb(ready); } catch {}
    });
  }

  private currentBubbleState: BubbleState = {
    visible: false,
    statusKey: '',
    speechText: '',
    isError: false,
    x: 0,
    y: 0,
  };
  private lastBubbleX = 0;
  private lastBubbleY = 0;

  constructor() {
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
    this.initScene();
  }

  private initScene(): void {
    this.scene.background = new THREE.Color(0xffffff);

    // 实体影子平面
    const shadowPlaneGeo = new THREE.PlaneGeometry(12, 12);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.25 });
    this.shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = 0;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);

    this.scene.add(this.gazeTarget);

    // 灯光装配
    this.scene.add(this.hemiLight);

    this.dirLight.position.set(10, 14, -22);
    this.dirLight.target.position.set(0, 1, 0);
    this.scene.add(this.dirLight.target);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.bias = -0.00015;
    this.dirLight.shadow.radius = 2.5;
    // ponytail: shadow camera 范围 — 光从 (10,14,-22) 打向原点,够覆盖场景中的角色 + 周围道具。
    this.dirLight.shadow.camera.left = -8;
    this.dirLight.shadow.camera.right = 8;
    this.dirLight.shadow.camera.top = 8;
    this.dirLight.shadow.camera.bottom = -8;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 40.0;
    this.scene.add(this.dirLight);

    this.fillLight.position.set(-1.5, 1.8, -1.2);
    this.scene.add(this.fillLight);

    this.frontFill.position.set(0.0, 1.65, 1.3);
    const faceTarget = new THREE.Object3D();
    faceTarget.position.set(0.0, 1.50, 0.0);
    this.scene.add(faceTarget);
    this.frontFill.target = faceTarget;
    this.scene.add(this.frontFill);

    this.legLight.position.set(0.15, 0.65, 1.6);
    const legTarget = new THREE.Object3D();
    legTarget.position.set(0.0, 0.35, 0.0);
    this.scene.add(legTarget);
    this.legLight.target = legTarget;
    this.scene.add(this.legLight);

    this.leftArmLight.position.set(-0.95, 1.10, 0.45);
    const leftArmTarget = new THREE.Object3D();
    leftArmTarget.position.set(-0.40, 1.00, 0.0);
    this.scene.add(leftArmTarget);
    this.leftArmLight.target = leftArmTarget;
    this.scene.add(this.leftArmLight);

    this.rightArmLight.position.set(0.95, 1.10, 0.45);
    const rightArmTarget = new THREE.Object3D();
    rightArmTarget.position.set(0.40, 1.00, 0.0);
    this.scene.add(rightArmTarget);
    this.rightArmLight.target = rightArmTarget;
    this.scene.add(this.rightArmLight);

    this.updateAllLights();

    this.vrmaPlayer.bindTransitionManager(this.motionTransition);
    this.chatDirector.bindTransitionManager(this.motionTransition);

    this.chatDirector.setOnEnd(() => {
      this.currentBubbleState.visible = false;
      this.onBubbleChange?.({ ...this.currentBubbleState });
    });
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

    try {
      const saved = localStorage.getItem('xiaochun.mat_saturation_settings');
      if (saved) {
        this.materialSaturation = { ...APP_CONFIG.saturation.default, ...JSON.parse(saved) };
      }
    } catch {}
    if (this.canvas) {
      this.canvas.style.filter = 'none';
    }

    this.buildLineworkScene();
    this.startAnimation();
  }

  public setMaterialSaturation(settings: Partial<MaterialSaturationSettings>): void {
    this.materialSaturation = { ...this.materialSaturation, ...settings };
    this.applyMaterialSaturations();
    try {
      localStorage.setItem('xiaochun.mat_saturation_settings', JSON.stringify(this.materialSaturation));
    } catch {}
  }

  public applyMaterialPreset(presetKey: MaterialSaturationPresetKey): void {
    const preset = APP_CONFIG.saturation.presets[presetKey];
    this.setMaterialSaturation({ preset: presetKey, ...preset });
  }

  public applyMaterialSaturations(): void {
    const { skin, hair, clothing, eyes } = this.materialSaturation;
    this.categorizedMaterials.skin.forEach((m) => {
      if (m.uniforms?.uMatSaturation) m.uniforms.uMatSaturation.value = skin;
    });
    this.categorizedMaterials.hair.forEach((m) => {
      if (m.uniforms?.uMatSaturation) m.uniforms.uMatSaturation.value = hair;
    });
    this.categorizedMaterials.clothing.forEach((m) => {
      if (m.uniforms?.uMatSaturation) m.uniforms.uMatSaturation.value = clothing;
    });
    this.categorizedMaterials.eyes.forEach((m) => {
      if (m.uniforms?.uMatSaturation) m.uniforms.uMatSaturation.value = eyes;
    });
  }

  /**
   * 线稿世界场景:白底 + 几何体全部 wireframe,太阳 + 远景城市剪影 + 地面网格,
   * 角色 VRM 通过 OutlinePass 自动描边。
   * ponytail: 纯代码,零外部资产;轨道相机转动时整个线稿世界跟着转,达到"身临其境"。
   */
  private buildLineworkScene(): void {
    if (!this.renderer) return;
    this.scene.background = new THREE.Color(0xffffff);

    // 太阳 — 实心圆 + 12 条辐射线,放在角色斜对角远处,跟 dirLight 方向对齐
    // ponytail: 位置 (10, 14, -22),distance ≈ 28,direction 指向原点 — 视觉与脚下的影子成对角。
    //          半径 1.5,远距离下不至于过小看不见;用实体填充保证存在感。
    const sunGroup = new THREE.Group();
    const sunFill = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 64),
      new THREE.MeshBasicMaterial({ color: 0x222222 }),
    );
    sunFill.position.set(10, 14, -22);
    sunGroup.add(sunFill);
    const sunRays = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const inner = new THREE.Vector3(Math.cos(a) * 2.0, Math.sin(a) * 2.0, 0);
          const outer = new THREE.Vector3(Math.cos(a) * 2.7, Math.sin(a) * 2.7, 0);
          return [inner, outer];
        }).flat(),
      ),
      new THREE.LineBasicMaterial({ color: 0x222222 }),
    );
    sunRays.position.copy(sunFill.position);
    sunGroup.add(sunRays);
    this.scene.add(sunGroup);

    // 远景城市天际线 — 5 种造型混搭(box / tower / pyramid / stepped / antenna),
    // 高度各异但都比角色(约 1.5m)高
    // ponytail: 用不同几何体组合做天际线节奏,比全 box 立体很多。
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true });

    type BuildingShape = 'box' | 'tower' | 'pyramid' | 'stepped' | 'antenna';
    const buildBuilding = (
      shape: BuildingShape,
      w: number,
      height: number,
      d: number,
    ): THREE.Group => {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), wireMat);
      box.position.y = height / 2;
      g.add(box);

      if (shape === 'pyramid') {
        // 锥顶金字塔
        const roofH = height * 0.25;
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(Math.max(w, d) * 0.75, roofH, 4),
          wireMat,
        );
        roof.position.y = height + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        g.add(roof);
      } else if (shape === 'stepped') {
        // 阶梯塔 — 顶部小方块 + 细天线
        const tierW = w * 0.55;
        const tierH = height * 0.35;
        const tier = new THREE.Mesh(
          new THREE.BoxGeometry(tierW, tierH, d * 0.55),
          wireMat,
        );
        tier.position.y = height + tierH / 2;
        g.add(tier);
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.6, 4),
          wireMat,
        );
        pole.position.y = height + tierH + 0.3;
        g.add(pole);
      } else if (shape === 'antenna') {
        // 顶层一根细天线
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4),
          wireMat,
        );
        pole.position.y = height + 0.6;
        g.add(pole);
      }
      // 'box' / 'tower' 只用底座盒子;tower 通过高瘦比例与 box 区分。
      return g;
    };

    const buildingSpecs: Array<{
      x: number; w: number; height: number; d: number; shape: BuildingShape;
    }> = [
      { x: -12,   w: 1.4, height: 4.0,  d: 1.5, shape: 'box' },
      { x: -10.7, w: 1.2, height: 7.5,  d: 1.5, shape: 'tower' },
      { x: -9.4,  w: 1.6, height: 5.0,  d: 1.5, shape: 'pyramid' },
      { x: -8.1,  w: 1.3, height: 6.5,  d: 1.5, shape: 'stepped' },
      { x: -6.8,  w: 1.4, height: 3.5,  d: 1.5, shape: 'box' },
      { x: -5.5,  w: 1.0, height: 9.0,  d: 1.5, shape: 'antenna' },
      { x: -4.2,  w: 1.5, height: 5.5,  d: 1.5, shape: 'pyramid' },
      { x: -2.9,  w: 1.2, height: 4.5,  d: 1.5, shape: 'box' },
      { x: -1.6,  w: 1.4, height: 7.0,  d: 1.5, shape: 'stepped' },
      { x: -0.3,  w: 1.6, height: 11.0, d: 1.5, shape: 'tower' },
      { x: 1.0,   w: 1.3, height: 5.5,  d: 1.5, shape: 'box' },
      { x: 2.3,   w: 1.5, height: 8.0,  d: 1.5, shape: 'pyramid' },
      { x: 3.6,   w: 1.2, height: 4.0,  d: 1.5, shape: 'antenna' },
      { x: 4.9,   w: 1.4, height: 6.0,  d: 1.5, shape: 'box' },
      { x: 6.2,   w: 1.3, height: 8.5,  d: 1.5, shape: 'tower' },
      { x: 7.5,   w: 1.5, height: 5.5,  d: 1.5, shape: 'pyramid' },
      { x: 8.8,   w: 1.2, height: 4.0,  d: 1.5, shape: 'stepped' },
      { x: 10.1,  w: 1.4, height: 6.5,  d: 1.5, shape: 'box' },
      { x: 11.4,  w: 1.3, height: 4.5,  d: 1.5, shape: 'antenna' },
    ];
    const cityGroup = new THREE.Group();
    for (const { x, w, height, d, shape } of buildingSpecs) {
      const building = buildBuilding(shape, w, height, d);
      building.position.set(x, 0, -10);
      cityGroup.add(building);
    }
    this.scene.add(cityGroup);

    // 地面 — 大平面,wireframe
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    this.scene.add(ground);

    // 几根抽象的"树",4 种造型混搭,高度随机但都比角色(约 1.5m)高
    // ponytail: 用同一种 wireframe 材质,靠几何体形状区分(尖塔 / 圆球 / 层叠 / 笔柏)。
    const treeMat = new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true });

    type TreeShape = 'conifer' | 'fan' | 'layered' | 'cypress' | 'oval';
    const buildTree = (shape: TreeShape, totalH: number): THREE.Group => {
      // ponytail: 树干至少 ≥ 1.7m(角色 1.5m,留点余量),树冠半径按比例缩小,避免吞噬角色。
      const trunkH = Math.max(1.7, totalH * 0.35);
      const topH = totalH - trunkH;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.14, trunkH, 8),
        treeMat,
      );
      trunk.position.y = trunkH / 2;
      tree.add(trunk);

      if (shape === 'conifer') {
        // 单个圆锥 — 标准圣诞树
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.35 + totalH * 0.08, topH, 8),
          treeMat,
        );
        cone.position.y = trunkH + topH / 2;
        tree.add(cone);
      } else if (shape === 'fan') {
        // 扇形 — 浅开口圆锥(openEnded),半径/高 ≈ 1.3 → 更圆,不像打开的折扇更像伞盖
        // ponytail: segments=24 圆周更平滑,从远处看像球冠
        const fan = new THREE.Mesh(
          new THREE.ConeGeometry(topH * 0.65, topH * 0.5, 24, 1, true),
          treeMat,
        );
        fan.position.y = trunkH + topH * 0.25;
        tree.add(fan);
      } else if (shape === 'layered') {
        // 3 层叠加圆锥 — 宝塔 / 黑松造型
        const layers = 3;
        const layerH = topH / (layers + 0.5);
        for (let i = 0; i < layers; i++) {
          const radius = (0.35 + totalH * 0.08) * (1 - i * 0.25);
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(radius, layerH, 8),
            treeMat,
          );
          cone.position.y = trunkH + (i + 0.5) * (layerH * 1.05);
          tree.add(cone);
        }
      } else if (shape === 'cypress') {
        // 细长笔柏 — 意大利柏树
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.2 + totalH * 0.04, topH, 6),
          treeMat,
        );
        cone.position.y = trunkH + topH / 2;
        tree.add(cone);
      } else if (shape === 'oval') {
        // 椭圆树冠 — 球体纵向拉长,像鸡蛋形 / 高瘦树冠(白杨、银杏苗)
        // ponytail: X/Z 压扁 0.7x、Y 拉高 1.4x;半径 0.32,实际 Y 半径 = 0.448×topH;
        //          center 放 trunkH + 0.45×topH → bottom ≈ trunkH,视觉上贴树干顶。
        const oval = new THREE.Mesh(
          new THREE.IcosahedronGeometry(topH * 0.32, 1),
          treeMat,
        );
        oval.scale.set(0.7, 1.4, 0.7);
        oval.position.y = trunkH + topH * 0.448;
        tree.add(oval);
      }
      return tree;
    };

    const treeSpecs: Array<{ pos: [number, number]; height: number; shape: TreeShape }> = [
      // ponytail: 两棵 fan 砍了 — 它们扇冠太宽,容易和别树冠打架,只保留右半边的树。
      { pos: [5, -3],  height: 6.5, shape: 'cypress' },
      { pos: [-4, 4],  height: 5.0, shape: 'conifer' },
      { pos: [4, 4],   height: 8.0, shape: 'layered' },
      { pos: [6, 0],   height: 6.0, shape: 'cypress' },
      // ponytail: 加一棵椭圆树冠在左前,平衡左半边空荡 + 引入新造型
      { pos: [-5, -2], height: 5.5, shape: 'oval' },
    ];
    for (const { pos, height, shape } of treeSpecs) {
      const tree = buildTree(shape, height);
      tree.position.set(pos[0], 0, pos[1]);
      this.scene.add(tree);
    }
  }

  private handleResize = () => {
    if (!this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, APP_CONFIG.renderer.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  public updateAllLights(): void {
    const m = this.lightChannels.globalMult;
    this.dirLight.intensity = this.lightChannels.dir.enabled ? this.lightChannels.dir.base * m : 0;
    this.hemiLight.intensity = this.lightChannels.hemi.enabled ? this.lightChannels.hemi.base * m : 0;
    this.frontFill.intensity = this.lightChannels.front.enabled ? this.lightChannels.front.base * m : 0;
    this.fillLight.intensity = this.lightChannels.fill.enabled ? this.lightChannels.fill.base * m : 0;
    this.legLight.intensity = this.lightChannels.leg.enabled ? this.lightChannels.leg.base * m : 0;
    this.leftArmLight.intensity = this.lightChannels.arm.enabled ? this.lightChannels.arm.base * m : 0;
    this.rightArmLight.intensity = this.lightChannels.arm.enabled ? this.lightChannels.arm.base * m : 0;
  }

  public setLight(key: string, enabled: boolean, value: number): void {
    if (key in this.lightChannels) {
      (this.lightChannels as any)[key].enabled = enabled;
      (this.lightChannels as any)[key].base = value;
      this.updateAllLights();
    }
  }

  public setGlobalLight(mult: number): void {
    this.lightChannels.globalMult = mult;
    this.updateAllLights();
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

    const fetchUrl = url;
    this.loader.load(
      fetchUrl,
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
        this.vrmaPlayer.resetHipsRest();
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

        this.optimizeVRMMaterials(vrm);
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
        setTimeout(() => {
          // 1. 后台预热 EMAGE ONNX 全身协同动作模型 (Dedicated Worker)
          if (!this.emagePlayer.ready) void this.emagePlayer.ensureLoaded();
          // 2. 后台预热 WebLLM Qwen 语言大模型 (Dedicated Worker)
          preloadWebLLM();
        }, 2500);

        this.fitCamera();
        void this.chatDirector.warmThinkingClip(vrm, this.vrmaPlayer);

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

  private optimizeVRMMaterials(vrm: VRM): void {
    this.categorizedMaterials = { skin: [], hair: [], clothing: [], eyes: [] };
    vrm.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat: any) => {
          if (!mat || !mat.isMToonMaterial) return;

          const name = (mat.name || '').toLowerCase();
          const isFaceSkin = name.includes('face') || name.includes('skin') || name.includes('body') || name.includes('mouth') || name.includes('brow') || name.includes('head');
          const isEye = name.includes('eye') || name.includes('iris');
          const isHair = name.includes('hair');
          const isSocks = name.includes('socks') || name.includes('stocking') || name.includes('tights');
          const isCloth = name.includes('cloth') || name.includes('shirt') || name.includes('top') || name.includes('skirt') || name.includes('coat') || name.includes('bottom') || name.includes('dress') || name.includes('onepiece') || name.includes('shoes');

          let category: 'skin' | 'hair' | 'eyes' | 'clothing' = 'clothing';
          if (isEye) {
            category = 'eyes';
          } else if (isFaceSkin) {
            category = 'skin';
          } else if (isHair) {
            category = 'hair';
          } else {
            category = 'clothing';
          }

          // 注入材质级独立饱和度 Shader
          if (!mat.userData.__saturationInjected) {
            mat.userData.__saturationInjected = true;
            mat.uniforms['uMatSaturation'] = { value: 1.0 };
            const targetCode = 'gl_FragColor = vec4( col, diffuseColor.a );\n  postCorrection();';
            if (mat.fragmentShader.includes(targetCode)) {
              mat.fragmentShader = `
uniform float uMatSaturation;
` + mat.fragmentShader.replace(
                targetCode,
                `float gray = dot(col, vec3(0.299, 0.587, 0.114));
  col = max(vec3(0.0), mix(vec3(gray), col, uMatSaturation));
  gl_FragColor = vec4( col, diffuseColor.a );
  postCorrection();`
              );
              mat.needsUpdate = true;
            }
          }

          if (!this.categorizedMaterials[category].includes(mat)) {
            this.categorizedMaterials[category].push(mat);
          }

          if (isFaceSkin) {
            mat.rimLightingMix = 0.0;
            mat.rimMultiply = new THREE.Color(0x000000);
            mat.rimFresnelPower = 100.0;
            mat.rimLift = 0.0;
            mat.shadeShift = 0.08;
            mat.shadeToony = 0.98;
            if (mat.shadeColor) mat.shadeColor.setHex(0xfff2ea);
          } else if (isSocks) {
            mat.rimLightingMix = 0.60;
            mat.rimMultiply = new THREE.Color(0xffffff);
            mat.rimFresnelPower = 3.0;
            mat.rimLift = 0.15;
            mat.shadeShift = -0.05;
            mat.shadeToony = 0.80;
          } else if (isCloth) {
            mat.rimLightingMix = 0.35;
            mat.rimMultiply = new THREE.Color(0xf0f4ff);
            mat.rimFresnelPower = 4.0;
            mat.rimLift = 0.10;
            mat.shadeShift = 0.0;
            mat.shadeToony = 0.85;
          }
          mat.needsUpdate = true;
        });
      }
    });
    this.applyMaterialSaturations();
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

  public async sendMessage(text: string): Promise<void> {
    if (!this.currentVRM) return;
    this.emagePlayer.stop();
    this.activePlayer = 'vrma';

    const setStatus = (
      key: string,
      vars?: Record<string, unknown>,
      isError = false,
      speechText?: string,
    ) => {
      if (!key || key === 'silent') {
        this.currentBubbleState.visible = false;
      } else {
        this.currentBubbleState.visible = true;
        this.currentBubbleState.statusKey = key;
        this.currentBubbleState.statusVars = vars;
        this.currentBubbleState.speechText = speechText || '';
        this.currentBubbleState.isError = isError;

        if (this.currentVRM) {
          const head = this.currentVRM.humanoid?.getNormalizedBoneNode('head');
          const p = new THREE.Vector3();
          if (head) {
            head.getWorldPosition(p);
            p.y += 0.24;
          } else {
            p.set(0, 1.7, 0);
          }
          p.project(this.camera);
          const x = Math.round((p.x * 0.5 + 0.5) * window.innerWidth);
          const y = Math.round((-(p.y * 0.5) + 0.5) * window.innerHeight);
          this.currentBubbleState.x = x;
          this.currentBubbleState.y = y;
          this.lastBubbleX = x;
          this.lastBubbleY = y;
        }
      }
      this.onBubbleChange?.({ ...this.currentBubbleState });
    };

    await this.chatDirector.say(text, this.currentVRM, this.vrmaPlayer, this.emagePlayer, setStatus);
  }

  private startAnimation(): void {
    const tempSoleA = new THREE.Vector3();
    const tempSoleB = new THREE.Vector3();

    const animate = () => {
      this.animFrameId = requestAnimationFrame(animate);
      const delta = Math.min(this.clock.getDelta(), 0.1);
      const time = this.clock.getElapsedTime();

      const vrm = this.currentVRM;
      if (vrm) {
        if (this.isAutoRotate) {
          vrm.scene.rotation.y += delta * 0.5;
        }

        const emageLive = this.emagePlayer.isPlaying();
        const vrmaLive = this.vrmaPlayer.isPlaying() || this.chatDirector.isThinking;

        if (emageLive) {
          this.activePlayer = 'emage';
          this.emagePlayer.update(delta);
        } else if (vrmaLive) {
          this.activePlayer = 'vrma';
          this.vrmaPlayer.update(delta);
        } else {
          if (this.activePlayer !== 'idle') {
            this.motionTransition.startTransition(vrm, 0.75);
            this.activePlayer = 'idle';
          }
          if (this.isIdleBreath) {
            this.naturalIdle.update(time, 1.0);
          } else {
            vrm.scene.position.y = this.vrmBaseSceneY;
          }
        }

        // 全局动作平滑过渡器统一接管（解决 idle -> think -> emage -> idle 任意两状态间的割裂跳跃）
        this.motionTransition.apply(vrm, delta);

        this.chatDirector.tick(vrm, this.vrmaPlayer);

        // 思考神态与基础待机神态平滑过渡
        if (this.chatDirector.isThinking) {
          this.thinkingWeight = Math.min(1.0, this.thinkingWeight + delta * 2.5);
        } else {
          this.thinkingWeight = Math.max(0.0, this.thinkingWeight - delta * 3.0);
        }
        const tw = this.thinkingWeight * this.thinkingWeight * (3 - 2 * this.thinkingWeight);

        if (vrm.expressionManager) {
          if (this.manualExpression && this.manualExpression !== 'neutral') {
            // 用户在开发者抽屉显式指定表情时，维持手动表情
          } else if (this.chatDirector.speaking) {
            // 朗读说话中：清空思考嘴型 ('ou') 与静态微笑，完全让位给实时语音 LipSync ('aa')
            vrm.expressionManager.setValue('ou', 0);
            vrm.expressionManager.setValue('relaxed', 0);
            vrm.expressionManager.setValue('happy', 0);
          } else {
            // 待机或思考态：
            // 1. 思考嘴型 'ou' 随 tw 严格平滑渐变（tw 归 0 时 ou 彻底归 0，绝不残留）
            vrm.expressionManager.setValue('ou', 0.65 * tw);
            vrm.expressionManager.setValue('relaxed', 0.15 * tw);
            // 2. 待机默认不张嘴：happy 设为 0，完美回归模型原始雕刻的温婉闭嘴微笑（图二效果）
            vrm.expressionManager.setValue('happy', 0);
          }
        }

        const headBone = vrm.humanoid?.getNormalizedBoneNode('head');
        if (headBone && tw > 0.01) {
          const thinkHeadSwayX = Math.sin(time * 1.6) * 0.025 * tw;
          const thinkHeadSwayY = Math.cos(time * 1.1) * 0.035 * tw;
          const thinkHeadSwayZ = Math.sin(time * 1.4) * 0.02 * tw;
          const swayQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(thinkHeadSwayX, thinkHeadSwayY, thinkHeadSwayZ));
          headBone.quaternion.multiply(swayQ);
        }

        // 自然眨眼
        if (this.isAutoBlink && vrm.expressionManager) {
          this.blinkTimer += delta;
          if (!this.isBlinking && this.blinkTimer >= this.blinkInterval) {
            this.isBlinking = true;
            this.blinkTimer = 0;
            this.blinkProgress = 0;
            this.blinkInterval = 2.0 + Math.random() * 3.0;
          }
          if (this.isBlinking) {
            this.blinkProgress += delta / this.blinkDuration;
            if (this.blinkProgress <= 0.5) {
              vrm.expressionManager.setValue('blink', this.blinkProgress / 0.5);
            } else if (this.blinkProgress <= 1.0) {
              vrm.expressionManager.setValue('blink', (1.0 - this.blinkProgress) / 0.5);
            } else {
              this.isBlinking = false;
              vrm.expressionManager.setValue('blink', 0);
            }
          }
        }

        // 自然视线伴随
        const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
        const neckNode = vrm.humanoid?.getNormalizedBoneNode('neck');

        const headPos = new THREE.Vector3();
        if (headNode) headNode.getWorldPosition(headPos);
        else headPos.copy(vrm.scene.position).add(new THREE.Vector3(0, 1.35, 0));

        this.gazeShiftTimer += delta;
        if (this.gazeShiftTimer >= this.gazeShiftInterval) {
          this.gazeShiftTimer = 0;
          const glanceChance = emageLive ? 0.40 : 0.25;
          this.isGlancingAway = !this.isGlancingAway && Math.random() < glanceChance;
          if (this.isGlancingAway) {
            const side = Math.random() < 0.5 ? -1 : 1;
            this.gazeOffsetTarget.set(side * (0.12 + Math.random() * 0.12), -0.08 - Math.random() * 0.08, 0);
            this.gazeShiftInterval = 0.8 + Math.random() * 0.6;
          } else {
            this.gazeOffsetTarget.set(0, 0, 0);
            this.gazeShiftInterval = 3.0 + Math.random() * 2.5;
          }
        }
        this.gazeCurrentOffset.lerp(this.gazeOffsetTarget, Math.min(1.0, delta * 4.0));

        const microSaccadeX = Math.sin(time * 6.7) * 0.012;
        const microSaccadeY = Math.cos(time * 5.3) * 0.008;
        const eyeLevelY = headPos.y - 0.03;
        const clampedGazeY = Math.min(this.camera.position.y, eyeLevelY + 0.35);

        this.gazeTarget.position.set(
          this.camera.position.x + this.gazeCurrentOffset.x + microSaccadeX,
          clampedGazeY + this.gazeCurrentOffset.y + microSaccadeY,
          this.camera.position.z + this.gazeCurrentOffset.z
        );

        if (this.isLookAtHead && headNode && neckNode) {
          const dx = this.camera.position.x - headPos.x;
          const dy = this.camera.position.y - headPos.y;
          const dz = this.camera.position.z - headPos.z;
          const distXZ = Math.sqrt(dx * dx + dz * dz);

          const targetYaw = Math.atan2(dx, dz) - vrm.scene.rotation.y;
          const normYaw = Math.atan2(Math.sin(targetYaw), Math.cos(targetYaw));
          const clampedYaw = Math.max(-0.80, Math.min(0.80, normYaw));

          const targetPitch = this.isLockHead ? 0 : -Math.atan2(dy, distXZ);
          // 放宽上下仰角范围 (-0.42 ~ +0.38 rad，约 -24° ~ +22°)，使头部随镜头俯仰自如，告别"头只转左右"与"翻白眼"
          const clampedPitch = this.isLockHead ? 0 : Math.max(-0.42, Math.min(0.38, targetPitch));

          const neckOffsetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(clampedPitch * 0.30, clampedYaw * 0.30, 0, 'YXZ'));
          const headOffsetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(clampedPitch * 0.70, clampedYaw * 0.70, 0, 'YXZ'));

          neckNode.quaternion.multiply(neckOffsetQ);
          headNode.quaternion.multiply(headOffsetQ);
        }

        if (this.isLookAtEyes && vrm) {
          if (vrm.lookAt) {
            vrm.lookAt.target = this.gazeTarget;
            vrm.lookAt.autoUpdate = true;
            vrm.lookAt.update(delta);
          }
        }

        vrm.update(delta);

        // 下半身踏步迟滞跟随镜头
        if (this.isLookAtHead && vrm) {
          const vrmPos = new THREE.Vector3();
          if (headNode) headNode.getWorldPosition(vrmPos);
          else vrmPos.copy(vrm.scene.position);

          const dx = this.camera.position.x - vrmPos.x;
          const dz = this.camera.position.z - vrmPos.z;
          const targetYaw = Math.atan2(dx, dz) - vrm.scene.rotation.y;
          const normYaw = Math.atan2(Math.sin(targetYaw), Math.cos(targetYaw));

          if (!this.isTurningBody && Math.abs(normYaw) > 0.95 && !emageLive) {
            this.isTurningBody = true;
          } else if (this.isTurningBody && (Math.abs(normYaw) < 0.35 || emageLive)) {
            this.isTurningBody = false;
          }

          const targetStepWeight = this.isTurningBody ? 1.0 : 0.0;
          this.stepWeight += (targetStepWeight - this.stepWeight) * Math.min(1.0, delta * 6.0);

          if (this.isTurningBody) {
            vrm.scene.rotation.y += normYaw * delta * 2.0;
            this.turnStepPhase += delta * 10.0;
          }

          if (this.stepWeight > 0.01) {
            const leftLeg = vrm.humanoid?.getNormalizedBoneNode('leftUpperLeg');
            const rightLeg = vrm.humanoid?.getNormalizedBoneNode('rightUpperLeg');
            const stepL = Math.sin(this.turnStepPhase) * 0.06 * this.stepWeight;
            const stepR = Math.sin(this.turnStepPhase + Math.PI) * 0.06 * this.stepWeight;

            if (leftLeg) {
              const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.max(0, stepL), 0, 0));
              leftLeg.quaternion.slerp(q, 0.2);
            }
            if (rightLeg) {
              const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.max(0, stepR), 0, 0));
              rightLeg.quaternion.slerp(q, 0.2);
            }
          }
        }

        // 影子跟随
        if (this.shadowPlane && vrm.humanoid) {
          const lf = vrm.humanoid.getNormalizedBoneNode('leftFoot');
          const rf = vrm.humanoid.getNormalizedBoneNode('rightFoot');
          if (lf && rf) {
            lf.getWorldPosition(tempSoleA);
            rf.getWorldPosition(tempSoleB);
            const minAnkleY = Math.min(tempSoleA.y, tempSoleB.y);
            this.shadowPlane.position.y = minAnkleY - this.vrmSoleOffset + 0.002;
          }
        }

        // 3D 头部气泡位置动态更新（高性能直接 DOM 变换 + 1.5px 死区过滤，彻底杜绝 60~120FPS React 全局重渲染与无谓 transform 抖动）
        if (this.currentBubbleState.visible) {
          const head = vrm.humanoid?.getNormalizedBoneNode('head');
          const p = new THREE.Vector3();
          if (head) {
            head.getWorldPosition(p);
            p.y += 0.24;
          } else {
            p.set(0, 1.7, 0);
          }
          p.project(this.camera);
          const x = Math.round((p.x * 0.5 + 0.5) * window.innerWidth);
          const y = Math.round((-(p.y * 0.5) + 0.5) * window.innerHeight);

          const dx = x - this.lastBubbleX;
          const dy = y - this.lastBubbleY;
          // 死区过滤：角色微弱呼吸（位移 < 1.5px）时完全不更新 transform；位移明显或镜头旋转时直接修改 DOM，0 次 React 重渲染！
          if (dx * dx + dy * dy >= 2.25) {
            this.lastBubbleX = x;
            this.lastBubbleY = y;
            this.currentBubbleState.x = x;
            this.currentBubbleState.y = y;
            const bubbleEl = document.getElementById('head-bubble');
            if (bubbleEl) {
              bubbleEl.style.transform = `translate3d(calc(${x}px - 50%), calc(${y}px - 100% - 16px), 0)`;
            }
          }
        }
      }

      this.controls?.update();
      this.renderer?.render(this.scene, this.camera);
    };

    animate();
  }

  public dispose(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    window.removeEventListener('resize', this.handleResize);
    this.controls?.dispose();
    this.renderer?.dispose();
  }
}

export const vrmEngine = new VRMEngine();
