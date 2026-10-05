import * as THREE from 'three';
import { APP_CONFIG } from '@/config';
import { isMobile } from '@/lib/platform';
import { SceneMotionGovernor } from '../sceneMotion';
import { PALMS, buildGrassLayout, buildRockLayout } from './beach3dLayout';
import {
  buildGrassClump,
  buildMountains,
  buildPalmCrown,
  buildPalmTrunk,
  buildRock,
  trunkTop,
  triangleCount,
} from './beach3dGeometry';
import {
  CLOUD_FRAG, CLOUD_VERT,
  GRASS_FRAG, GRASS_VERT,
  GROUND_FRAG, GROUND_VERT,
  MOUNTAIN_FRAG, MOUNTAIN_VERT,
  PALM_FRAG, PALM_VERT,
  PETAL_FRAG, PETAL_VERT,
  ROCK_FRAG, ROCK_VERT,
  SKY_FRAG, SKY_VERT,
} from './beach3dShaders';

/**
 * Beach3DWorld — "海滩 3D" 场景 (id: beach3d), 纯 Three.js 搭建的真实 3D 海滩。
 *
 * 风格: 二次元 MMD 舞台 —— 3D 卡通着色道具 + 高调日光 + 轻微 Bloom (浪花 / 闪光参与), 与 MToon 角色同一套光向。
 *
 * 组成 (共 9 次绘制, 约 2.4 万三角面, 见 getStats()):
 *   天空      全屏着色器层 (按视线方向取色: 渐变 + 高空浅云 + 地平线亮带 + 太阳柔光; 俯仰到极限也不会穿帮 / 露黑边)
 *   云        实例化面片 ×N (远景层, 1 次绘制)
 *   远山      两层剪影条带 (远景层, 1 次绘制)
 *   沙地 + 海 一张 y=0 的大平面 (1 次绘制): 沙纹 / 湿沙 / 岸边浪花 / 卡通波纹 / 阳光闪光全在片元里
 *   棕榈      树干 (根部外扩的弧形, 卡通分节) + 叶冠 (立体羽状复叶: 叶轴 + 两排 V 形小叶) 两个 InstancedMesh (2 次绘制)
 *   草丛      弯弧草叶团 + 小花 InstancedMesh (1 次绘制, 球形法线 → 柔和的绒球明暗)
 *   礁石      圆润的平滑礁石 InstancedMesh (1 次绘制), 水中礁石周围一圈白浪 (地面着色器里画)
 *   花瓣      世界空间 GPU 粒子 (1 次绘制, 只在角色身后)
 *   落影      复用引擎原有的实时阴影 (CharacterShadowSystem 的 ShadowMaterial 平面), 本类不另画影子
 *
 * "远景层" (云 / 远山) 每帧跟随相机平移 (不跟随旋转): 等价于无限远, 不受相机远裁剪面 (100m) 限制。
 * 沙地 / 海 / 植被 / 礁石是普通世界物体, 角色真实地站在沙地上。
 * 地平线弧度 (layout.horizonCurveR): 离相机 (视距 + 3m) 以外的地面往下弯, 可见海平线落在眼高以下 uDip 角,
 * 天空 / 远山 / 云按同一个 uDip 对齐 (computeHorizonDip, 每帧按相机高度算), 远处无缝。
 *
 * 太阳方向 = 引擎主方向光方向 (每帧读取), 天空柔光、闪光分布、树木明暗都按它算, 与角色受光一致。
 * 动态 (浪花 / 波纹 / 闪光 / 云 / 树叶 / 花瓣) 走 SceneMotionGovernor: reduced-motion 或低帧率自动静止 (与 beach 场景同一套逻辑)。
 */

/** 远景层半径 (m): 云在此球面上。须小于相机远裁剪面 100m。 */
const SKY_LAYER_RADIUS = 72;

/** 地面着色器里"水中礁石白浪"最多几块。 */
const ROCK_MAX = 12;

/**
 * 可见海平线相对眼高的下沉角 (rad)。地面在水平距离 d > d0 处下沉 (d−d0)²/(2R);
 * 视线擦过地面的切点 d* = √(d0² + 2Rh), 下沉角 = atan((h + (d*−d0)²/(2R)) / d*)。h = 相机离地高度 (相机在地下时按 0.05 算)。
 */
export function computeHorizonDip(camY: number, d0: number, R: number): number {
  const h = Math.max(0.05, camY);
  const ds = Math.sqrt(d0 * d0 + 2 * R * h);
  const e = ds - d0;
  return Math.atan((h + (e * e) / (2 * R)) / ds);
}

/** 静止时停在的时刻 (浪花 / 闪光分布好看的一帧)。 */
const STATIC_TIME = 14.9; // 冲刷浪正往上推、近岸三道浪峰错开的一帧

export interface Beach3DStats {
  /** 场景自身的绘制调用数 (不含角色 / 落影平面 / 后期)。 */
  drawCalls: number;
  /** 场景自身的三角面数 (实例化按实例数累计)。 */
  triangles: number;
  /** 粒子点数 (花瓣)。 */
  points: number;
  instances: { palms: number; grass: number; clouds: number };
}

function lin(hex: number): THREE.Color {
  return new THREE.Color(hex); // 按 ColorManagement 转线性
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Beach3DWorld {
  public readonly group = new THREE.Group();

  private built = false;
  private active = false;
  private disposed = false;
  private sun: THREE.DirectionalLight | null = null;
  private readonly motion = new SceneMotionGovernor(() => APP_CONFIG.beach3dScene.dynamics);

  private sky: THREE.Mesh | null = null;
  private clouds: THREE.InstancedMesh | null = null;
  private mountains: THREE.Mesh | null = null;
  private ground: THREE.Mesh | null = null;
  private trunks: THREE.InstancedMesh | null = null;
  private crowns: THREE.InstancedMesh | null = null;
  private grass: THREE.InstancedMesh | null = null;
  private rocks: THREE.InstancedMesh | null = null;
  private petals: THREE.Points | null = null;
  private petalMax = 0;
  private readonly materials: THREE.Material[] = [];

  /** 所有材质共享的 uniform (同一对象引用, 改一次全部生效)。 */
  private readonly shared = {
    uTime: { value: 0 },
    uComp: { value: 1 },
    uMark: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.36, 0.72, 0.6).normalize() },
    uSway: { value: 0 },
    uCurveR: { value: 700 },
    uCurveD0: { value: 6 },
    uDipSin: { value: 0 },
    uDipTan: { value: 0 },
  };
  private readonly skyUniforms: Record<string, THREE.IUniform> = {};
  private readonly cloudUniforms: Record<string, THREE.IUniform> = {};
  private readonly petalUniforms: Record<string, THREE.IUniform> = {};
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly drawSize = new THREE.Vector2();

  constructor() {
    this.group.name = 'Beach3DWorld';
    // 场景以角色出生点为原点布置 (布局 / 岸线都是"相对角色"的坐标); 天空 / 云 / 远山 / 框景叶自己设 matrixWorld, 不受影响
    const spawn = APP_CONFIG.model.spawn;
    this.group.position.set(spawn.x, 0, spawn.z);
    this.group.visible = false;
  }

  /** 挂进场景; sun = 引擎主方向光 (太阳方向的唯一来源)。 */
  public attach(scene: THREE.Scene, sun: THREE.DirectionalLight): void {
    this.sun = sun;
    if (this.group.parent !== scene) scene.add(this.group);
  }

  public isActive(): boolean {
    return this.active;
  }

  /** 动态当前是否生效 (调试 / 测试用)。 */
  public isDynamicsActive(): boolean {
    return this.motion.isOn();
  }

  /** 本次会话是否已因低帧率静止 (截图脚本可直接写 false)。 */
  public get downgraded(): boolean { return this.motion.downgraded; }
  public set downgraded(v: boolean) { this.motion.downgraded = v; }

  public setActive(active: boolean): void {
    if (this.disposed) return;
    this.active = active;
    this.group.visible = active;
    if (active) {
      this.ensureBuilt();
      this.motion.reset(); // 重新进入时重新评估性能
    }
  }

  /** 场景自身的绘制调用 / 三角面统计 (只算当前可见的部分)。 */
  public getStats(): Beach3DStats {
    let drawCalls = 0;
    let triangles = 0;
    let points = 0;
    this.group.traverse((o) => {
      if (!o.visible) return;
      if (o instanceof THREE.Points) {
        const n = o.geometry.drawRange.count === Infinity ? o.geometry.getAttribute('position').count : o.geometry.drawRange.count;
        if (n > 0) { drawCalls++; points += n; }
      } else if (o instanceof THREE.InstancedMesh) {
        if (o.count > 0) { drawCalls++; triangles += triangleCount(o.geometry) * o.count; }
      } else if (o instanceof THREE.Mesh) {
        drawCalls++;
        triangles += triangleCount(o.geometry);
      }
    });
    return {
      drawCalls,
      triangles,
      points,
      instances: { palms: this.trunks?.count ?? 0, grass: this.grass?.count ?? 0, clouds: this.clouds?.count ?? 0 },
    };
  }

  private register<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    this.motion.watchReducedMotion();
    const cfg = APP_CONFIG.beach3dScene;
    const haze = {
      uHazeStart: { value: cfg.haze.start },
      uHazeEnd: { value: Math.min(cfg.haze.end, 95) },
      uCurveR: this.shared.uCurveR,
      uCurveD0: this.shared.uCurveD0,
    };
    this.shared.uCurveR.value = THREE.MathUtils.clamp(cfg.layout.horizonCurveR, 50, 1e6);
    const sandHaze = lin(cfg.sand.light).lerp(lin(cfg.sky.horizon), 0.55);

    // ── 天空 (全屏层, 最先画, 不读写深度) ──
    Object.assign(this.skyUniforms, {
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uZenith: { value: lin(cfg.sky.zenith) },
      uMid: { value: lin(cfg.sky.mid) },
      uHorizon: { value: lin(cfg.sky.horizon) },
      uSeaHorizon: { value: lin(cfg.sea.horizon) },
      uSeaDeep: { value: lin(cfg.sea.deep) },
      uSunDir: this.shared.uSunDir,
      uSunGlow: { value: cfg.sky.sunGlow },
      uCirrus: { value: cfg.sky.cirrus },
      uHorizonBand: { value: cfg.sky.horizonBand },
      uTime: this.shared.uTime,
      uDipSin: this.shared.uDipSin,
      uComp: this.shared.uComp,
      uMark: this.shared.uMark,
    });
    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.register(new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: this.skyUniforms,
        depthTest: false,
        depthWrite: false,
      })),
    );
    this.sky.name = 'Beach3DSky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.onBeforeRender = (renderer, _s, camera) => this.beforeRender(renderer, camera as THREE.PerspectiveCamera);
    this.group.add(this.sky);

    // ── 云 (远景层) ──
    const nClouds = Math.max(0, Math.min(40, Math.round(cfg.clouds.count)));
    if (nClouds > 0) {
      const rnd = mulberry32(0xc10d);
      const data = new Float32Array(nClouds * 4);
      for (let i = 0; i < nClouds; i++) {
        // 方位 360° 均布 (带抖动); 仰角偏低 (5° ~ 50°), 一半云集中在 25° 以下, 地平线上方更有层次
        const az = ((i + rnd() * 0.7) / nClouds) * Math.PI * 2;
        const el = THREE.MathUtils.degToRad(i % 2 === 0 ? 5 + rnd() * 20 : 14 + rnd() * 36);
        const w = (14 + rnd() * 14) * cfg.clouds.scale * (1 - 0.35 * (el / 1.0));
        data.set([az, el, w, rnd()], i * 4);
      }
      const geo = new THREE.PlaneGeometry(1, 1);
      Object.assign(this.cloudUniforms, {
        uTime: this.shared.uTime,
        uDrift: { value: THREE.MathUtils.degToRad(cfg.clouds.driftDegPerSec) },
        uRadius: { value: SKY_LAYER_RADIUS },
        uDipTan: this.shared.uDipTan,
        uSunScreen: { value: new THREE.Vector2(0.6, 0.8) },
        uLight: { value: lin(cfg.clouds.light) },
        uShade: { value: lin(cfg.clouds.shade) },
        uHorizon: { value: lin(cfg.sky.horizon) },
        uOpacity: { value: 1 },
        uComp: this.shared.uComp,
        uMark: this.shared.uMark,
      });
      const mat = this.register(new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: this.cloudUniforms,
        depthTest: false,
        depthWrite: false,
        transparent: false, // 留在不透明队列 (按 renderOrder 紧跟天空), 混合由 CustomBlending 负责; alpha 通道保持天空写的标记
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      }));
      this.clouds = new THREE.InstancedMesh(geo, mat, nClouds);
      geo.setAttribute('aCloud', new THREE.InstancedBufferAttribute(data, 4));
      this.clouds.name = 'Beach3DClouds';
      this.clouds.frustumCulled = false;
      this.clouds.renderOrder = -990;
      this.clouds.onBeforeRender = (_r, _s, camera) => this.followCamera(this.clouds!, camera);
      this.group.add(this.clouds);
    }

    // ── 远山 (远景层) ──
    if (cfg.mountains.enabled) {
      this.mountains = new THREE.Mesh(
        buildMountains(cfg.mountains.heightScale),
        this.register(new THREE.ShaderMaterial({
          vertexShader: MOUNTAIN_VERT,
          fragmentShader: MOUNTAIN_FRAG,
          uniforms: {
            uFar: { value: lin(cfg.mountains.far) },
            uNear: { value: lin(cfg.mountains.near) },
            uHorizon: { value: lin(cfg.sky.horizon) },
            uDipTan: this.shared.uDipTan,
            uComp: this.shared.uComp,
            uMark: this.shared.uMark,
          },
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        })),
      );
      this.mountains.name = 'Beach3DMountains';
      this.mountains.frustumCulled = false;
      this.mountains.renderOrder = -980;
      this.mountains.onBeforeRender = (_r, _s, camera) => this.followCamera(this.mountains!, camera);
      this.group.add(this.mountains);
    }

    // ── 礁石布局 (地面着色器要知道水中礁石的位置来画白浪, 所以先算) ──
    const rockLayout = cfg.rocks.enabled ? buildRockLayout(cfg.layout) : [];
    const rockUniform = Array.from({ length: ROCK_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
    rockLayout.filter((r) => r.inWater).slice(0, ROCK_MAX).forEach((r, i) => rockUniform[i].set(r.x, r.z, r.r * 0.95, 1));

    // ── 沙地 + 海 (y=0 大平面, 写深度; 角色踩在上面, 落影平面画在它上面) ──
    // 细分 40×48: 只为远处的"地平线弧度"顶点下弯 (角色附近是平的); 约 3.8k 三角
    const groundGeo = new THREE.PlaneGeometry(150, 135, 40, 48);
    groundGeo.rotateX(-Math.PI / 2);
    groundGeo.translate(0, 0, -30); // z ∈ [−97.5, 37.5]: 前方到远海, 身后也有足够沙地 (俯视 / 拉远)
    this.ground = new THREE.Mesh(
      groundGeo,
      this.register(new THREE.ShaderMaterial({
        vertexShader: GROUND_VERT,
        fragmentShader: GROUND_FRAG,
        uniforms: {
          uTime: this.shared.uTime,
          uSandBase: { value: lin(cfg.sand.base) },
          uSandShade: { value: lin(cfg.sand.shade) },
          uSandLight: { value: lin(cfg.sand.light) },
          uSandWet: { value: lin(cfg.sand.wet) },
          uShallow: { value: lin(cfg.sea.shallow) },
          uSeaMid: { value: lin(cfg.sea.mid) },
          uSeaDeep: { value: lin(cfg.sea.deep) },
          uSeaHorizon: { value: lin(cfg.sea.horizon) },
          uFoam: { value: lin(cfg.sea.foam) },
          uSandHaze: { value: sandHaze },
          uShoreZ: { value: cfg.layout.shoreZ },
          uShoreCurve: { value: cfg.layout.shoreCurve },
          uShoreWiggle: { value: cfg.layout.shoreWiggle },
          uSwashAmp: { value: cfg.sea.swashAmp },
          uSwashSpeed: { value: cfg.sea.swashSpeed },
          uWaves: { value: cfg.sea.waves },
          uSkyRefl: { value: lin(cfg.sky.mid) },
          uFoamWidth: { value: cfg.sea.foamWidth },
          uRipple: { value: cfg.sea.ripple },
          uRippleDensity: { value: cfg.sea.rippleDensity },
          uGlint: { value: cfg.sea.glint },
          uGlintDensity: { value: cfg.sea.glintDensity },
          uGlintSpeed: { value: cfg.sea.glintSpeed },
          uSandSpacing: { value: Math.max(0.1, cfg.sand.rippleSpacing) },
          uSandRipple: { value: cfg.sand.ripple },
          uSandGrain: { value: cfg.sand.grain },
          uSunDir: this.shared.uSunDir,
          uRocks: { value: rockUniform },
          uComp: this.shared.uComp,
          uMark: this.shared.uMark,
          ...haze,
        },
        defines: { ROCK_MAX: ROCK_MAX },
        // 往后推一点深度, 让原有的落影平面 (y=0.0005, polygonOffset 1) 稳定地画在沙地上面 (与线稿场景地面同一做法)
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
      })),
    );
    this.ground.name = 'Beach3DGround';
    this.ground.receiveShadow = false; // 落影由原有的 ShadowMaterial 平面负责
    this.group.add(this.ground);

    // ── 棕榈 (树干 + 叶冠) ──
    const palmUniforms = {
      uTime: this.shared.uTime,
      uSway: this.shared.uSway,
      uLeafLight: { value: lin(cfg.vegetation.leafLight) },
      uLeafShade: { value: lin(cfg.vegetation.leafShade) },
      uTrunkLight: { value: lin(cfg.vegetation.trunkLight) },
      uTrunkShade: { value: lin(cfg.vegetation.trunkShade) },
      uSunDir: this.shared.uSunDir,
      uHaze: { value: sandHaze },
      uComp: this.shared.uComp,
      uMark: this.shared.uMark,
      ...haze,
    };
    const palmMat = this.register(new THREE.ShaderMaterial({
      vertexShader: PALM_VERT,
      fragmentShader: PALM_FRAG,
      uniforms: palmUniforms,
      side: THREE.DoubleSide,
    }));
    this.trunks = new THREE.InstancedMesh(buildPalmTrunk(), palmMat, PALMS.length);
    this.crowns = new THREE.InstancedMesh(buildPalmCrown(), palmMat, PALMS.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const top = trunkTop();
    const crownRot = new THREE.Quaternion();
    PALMS.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      sc.setScalar(p.scale);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, sc);
      this.trunks!.setMatrixAt(i, m);
      // 叶冠挂在树干顶端, 额外随机自转让每棵树的叶片朝向不同
      const topW = top.clone().multiplyScalar(p.scale).applyQuaternion(q).add(new THREE.Vector3(p.x, 0, p.z));
      crownRot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw + i * 1.37);
      m.compose(topW, crownRot, sc);
      this.crowns!.setMatrixAt(i, m);
    });
    this.trunks.name = 'Beach3DPalmTrunks';
    this.crowns.name = 'Beach3DPalmCrowns';
    this.trunks.computeBoundingSphere();
    this.crowns.computeBoundingSphere();
    this.group.add(this.trunks, this.crowns);

    // ── 草丛 ──
    const layout = buildGrassLayout(cfg.layout);
    const nGrass = Math.round(layout.length * THREE.MathUtils.clamp(cfg.vegetation.grassDensity, 0, 1));
    if (nGrass > 0) {
      const geo = buildGrassClump();
      const seeds = new Float32Array(nGrass * 2);
      const gm = this.register(new THREE.ShaderMaterial({
        vertexShader: GRASS_VERT,
        fragmentShader: GRASS_FRAG,
        uniforms: {
          uTime: this.shared.uTime,
          uSway: this.shared.uSway,
          uGrassLight: { value: lin(cfg.vegetation.grassLight) },
          uSunDir: this.shared.uSunDir,
          uGrassShade: { value: lin(cfg.vegetation.grassShade) },
          uFlower: { value: lin(cfg.vegetation.flower) },
          uHaze: { value: sandHaze },
          uComp: this.shared.uComp,
          uMark: this.shared.uMark,
          ...haze,
        },
        side: THREE.DoubleSide,
      }));
      this.grass = new THREE.InstancedMesh(geo, gm, nGrass);
      for (let i = 0; i < nGrass; i++) {
        const g = layout[i];
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.rot);
        sc.set(g.scale, g.scale * 0.9, g.scale);
        m.compose(new THREE.Vector3(g.x, 0, g.z), q, sc);
        this.grass.setMatrixAt(i, m);
        seeds[i * 2] = (i * 0.618034) % 1;
        seeds[i * 2 + 1] = g.flower ? 1 : 0;
      }
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 2));
      this.grass.name = 'Beach3DGrass';
      this.grass.computeBoundingSphere();
      this.group.add(this.grass);
    }

    // ── 礁石 ──
    if (rockLayout.length > 0) {
      this.rocks = new THREE.InstancedMesh(buildRock(cfg.rocks.detail), this.register(new THREE.ShaderMaterial({
        vertexShader: ROCK_VERT,
        fragmentShader: ROCK_FRAG,
        uniforms: {
          uRockLight: { value: lin(cfg.rocks.light) },
          uRockShade: { value: lin(cfg.rocks.shade) },
          uSunDir: this.shared.uSunDir,
          uHaze: { value: sandHaze },
          uComp: this.shared.uComp,
          uMark: this.shared.uMark,
          ...haze,
        },
      })), rockLayout.length);
      rockLayout.forEach((r, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.rot);
        sc.set(r.r, r.r * r.squash, r.r * (0.8 + 0.2 * Math.sin(i)));
        m.compose(new THREE.Vector3(r.x, r.inWater ? -0.08 * r.r : -0.03, r.z), q, sc);
        this.rocks!.setMatrixAt(i, m);
      });
      this.rocks.name = 'Beach3DRocks';
      this.rocks.computeBoundingSphere();
      this.group.add(this.rocks);
    }

    // ── 花瓣 (透明队列: 画在角色之后、按深度被角色遮挡, 只分布在角色身后) ──
    this.petalMax = Math.max(0, Math.min(80, Math.max(cfg.petals.count, cfg.petals.countMobile)));
    if (this.petalMax > 0) {
      const rnd = mulberry32(0x9e7a1);
      const seeds = new Float32Array(this.petalMax * 4);
      for (let i = 0; i < this.petalMax; i++) {
        seeds.set([rnd(), (i + rnd()) / this.petalMax, rnd(), rnd()], i * 4);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.petalMax * 3), 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      const pal = [0xffc2d1, 0xd9c8fb, 0xc4f3df, 0xfff1c9].map((h) => {
        const c = lin(h);
        return new THREE.Vector3(c.r, c.g, c.b);
      });
      Object.assign(this.petalUniforms, {
        uTime: this.shared.uTime,
        uSpeed: { value: cfg.petals.speed },
        uSize: { value: cfg.petals.size },
        uPxPerUnit: { value: 500 },
        uBoxMin: { value: new THREE.Vector3(-3.6, 0.05, -5.0).add(this.group.position) }, // 角色身后 1~5m
        uBoxSize: { value: new THREE.Vector3(7.2, 3.4, 4.0) },
        uPal: { value: pal },
        uOpacity: { value: cfg.petals.opacity },
        uComp: this.shared.uComp,
      });
      this.petals = new THREE.Points(geo, this.register(new THREE.ShaderMaterial({
        vertexShader: PETAL_VERT,
        fragmentShader: PETAL_FRAG,
        uniforms: this.petalUniforms,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      })));
      this.petals.name = 'Beach3DPetals';
      this.petals.frustumCulled = false;
      this.group.add(this.petals);
    }
  }

  /** 远景层: 跟随相机平移 (不旋转) → 等价无限远, 底边永远在相机眼高 (= 真实海平线)。 */
  private followCamera(obj: THREE.Object3D, camera: THREE.Camera): void {
    camera.getWorldPosition(this.tmpV);
    obj.matrixWorld.makeTranslation(this.tmpV.x, this.tmpV.y, this.tmpV.z);
  }

  /** 每帧渲染前 (天空层最先画, 由它的 onBeforeRender 调用一次)。 */
  private beforeRender(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    const cfg = APP_CONFIG.beach3dScene;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dyn = this.motion.tick(now);
    this.shared.uTime.value = this.motion.time(STATIC_TIME);
    this.shared.uSway.value = dyn ? cfg.vegetation.sway : 0;

    // 太阳方向 = 主方向光方向 (从目标指向光源)
    if (this.sun) {
      this.sun.getWorldPosition(this.tmpV);
      this.sun.target.getWorldPosition(this.tmpV2);
      const d = this.tmpV.sub(this.tmpV2);
      if (d.lengthSq() > 1e-8) (this.shared.uSunDir.value as THREE.Vector3).copy(d.normalize());
    }

    // 地平线弧度: 弯曲从 (视距 + 3m) 开始, 角色附近保持平; 由相机高度算出可见海平线的下沉角, 天空 / 远山 / 云对齐到它
    camera.getWorldPosition(this.tmpV);
    const camDist = Math.hypot(this.tmpV.x - this.group.position.x, this.tmpV.z - this.group.position.z); // 相机到角色的水平距离
    const d0 = camDist + 3;
    this.shared.uCurveD0.value = d0;
    const dip = computeHorizonDip(this.tmpV.y, d0, this.shared.uCurveR.value);
    this.shared.uDipSin.value = Math.sin(dip);
    this.shared.uDipTan.value = Math.tan(dip);
    if (this.cloudUniforms.uSunScreen) {
      const sd = this.shared.uSunDir.value as THREE.Vector3;
      (this.cloudUniforms.uSunScreen.value as THREE.Vector2).set(sd.x, Math.max(0.2, sd.y)).normalize();
    }

    // 天空层: 视线方向重建
    (this.skyUniforms.uInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (this.skyUniforms.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);

    // 曝光补偿 + 后期 Bloom 标记 (与 beach 场景同一约定)
    const exp = renderer.toneMapping === THREE.LinearToneMapping ? renderer.toneMappingExposure : 1;
    this.shared.uComp.value = 1 / Math.max(0.2, exp || 1);
    this.shared.uMark.value = renderer.getRenderTarget() ? 0.99 : 1;

    if (this.petals) {
      const n = dyn ? Math.min(this.petalMax, Math.max(0, Math.round(isMobile() ? cfg.petals.countMobile : cfg.petals.count))) : 0;
      this.petals.visible = n > 0;
      this.petals.geometry.setDrawRange(0, n);
      renderer.getDrawingBufferSize(this.drawSize);
      this.petalUniforms.uPxPerUnit.value = this.drawSize.y * 0.5;
    }
  }

  public dispose(scene?: THREE.Scene): void {
    this.disposed = true;
    this.motion.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    if (scene) scene.remove(this.group);
    this.group.clear();
    this.sky = this.clouds = this.mountains = this.ground = this.trunks = this.crowns = this.grass = this.rocks = this.petals = null;
  }
}
