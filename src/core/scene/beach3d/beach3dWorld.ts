import * as THREE from 'three';
import { APP_CONFIG } from '@/config';
import { SceneMotionGovernor } from '../sceneMotion';
import {
  CHAIR,
  CLOUD_SPRITES,
  FAR_ISLANDS,
  MID_ISLANDS,
  NEAR_ISLANDS,
  PALMS,
  PALM_TRUNK,
  buildCloudLayout,
  buildRockLayout,
  buildShellLayout,
  palmTop,
  parasolCanopy,
  type IslandPeak,
} from './beach3dLayout';
import {
  CHAIR_BACK,
  ISLAND_RADIUS,
  buildBeachProps,
  buildIslandStrip,
  buildPalmCrown,
  buildPalmTrunk,
  buildRock,
  buildShellSet,
  triangleCount,
} from './beach3dGeometry';
import {
  CLOUD_FRAG, CLOUD_VERT,
  GROUND_FRAG, GROUND_VERT,
  ISLAND_FRAG, ISLAND_VERT,
  PALM_FRAG, PALM_VERT,
  PROP_FRAG, PROP_VERT,
  ROCK_FRAG, ROCK_VERT,
  SHELL_FRAG, SHELL_VERT,
  SKY_FRAG, SKY_VERT,
} from './beach3dShaders';

/**
 * Beach3DWorld — "海滩" 场景 (id: beach3d), 纯 Three.js 搭建的真实 3D 海滩。
 *
 * 风格: 二次元 MMD 舞台 —— 3D 卡通着色道具 + 高调日光, 与 MToon 角色同一套光向。
 *
 * 组成 (共 9 次绘制, 约 5 万三角面, 见 getStats()):
 *   天空穹顶  全屏着色器层 (按视线方向取色 = 无限远的天空穹顶: 渐变 + 高空卷云 + 地平线积云带 + 亮带 + 太阳柔光; 俯仰到极限也不穿帮)
 *   积云      实例化面片 ×N (远景层, 1 次绘制): 手绘二次元积云贴图 (图集 4 张), 手工构图的主角云 + 其余方位散云
 *   远岛      条带 (远景层, 1 次绘制): 逐像素解析的三层岛屿剪影 + 空气透视 + 贴海面薄雾
 *   沙地 + 海 一张 y=0 的大平面 (1 次绘制): 沙纹 / 湿沙 / 道具落影 / 冲刷浪 / 多道浪峰 / 深浅渐变 / 闪光全在片元里
 *   棕榈      树干 + 叶冠两个 InstancedMesh (2 次绘制), 每棵树高度 / 倾斜 / 叶冠朝向都不同 (左 6 右 4, 不对称构图);
 *             叶冠 = 贴手绘羽叶贴图的弯曲下垂叶带
 *   礁石      InstancedMesh (1 次绘制), 水中礁石周围一圈白浪 (地面着色器里画)
 *   贝壳      扇贝 / 海螺 / 海星 InstancedMesh (1 次绘制), 沿整条海岸分布, 越近湿沙线越密, 近景几个大的
 *   沙滩椅    躺椅 + 遮阳伞合并几何 (1 次绘制), 角色右后方, 面朝大海
 *   落影      角色: 复用引擎原有的实时阴影 (CharacterShadowSystem); 道具: 地面着色器按太阳方向解析投影
 *
 * 贴图: 只有云图集与棕榈羽叶两张 (APP_CONFIG.beach3dScene.assets, public/scene/beach3d/), 场景激活时才加载; 加载完成前云 / 叶冠不画。
 * "远景层" (云 / 远岛) 每帧跟随相机平移 (不跟随旋转): 等价于无限远, 不受相机远裁剪面 (100m) 限制。
 * 地平线弧度 (layout.horizonCurveR) 见 beach3dShaders.ts 文件头; 天空 / 远岛 / 云按同一个 uDip 对齐 (computeHorizonDip)。
 * 太阳方向 = 引擎主方向光方向 (每帧读取)。动态走 SceneMotionGovernor: reduced-motion 或低帧率自动静止。
 */

/** 远景层半径 (m): 云在此球面上。须小于相机远裁剪面 100m。 */
const SKY_LAYER_RADIUS = 72;

/** 地面着色器里"水中礁石白浪"最多几块。 */
const ROCK_MAX = 12;
/** 地面着色器里最多几棵棕榈投影。 */
const PALM_MAX = 12;
/** 远岛着色器里最多几座岛。 */
const ISL_MAX = 12;

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
const STATIC_TIME = 14.9;

export interface Beach3DStats {
  /** 场景自身的绘制调用数 (不含角色 / 落影平面 / 后期)。 */
  drawCalls: number;
  /** 场景自身的三角面数 (实例化按实例数累计)。 */
  triangles: number;
  instances: { palms: number; rocks: number; clouds: number; shells: number };
}

function lin(hex: number): THREE.Color {
  return new THREE.Color(hex);
}

function clampN(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
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
  private islands: THREE.Mesh | null = null;
  private ground: THREE.Mesh | null = null;
  private trunks: THREE.InstancedMesh | null = null;
  private crowns: THREE.InstancedMesh | null = null;
  private rocks: THREE.InstancedMesh | null = null;
  private shells: THREE.InstancedMesh | null = null;
  private props: THREE.Mesh | null = null;
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];

  /** 所有材质共享的 uniform (同一对象引用, 改一次全部生效)。 */
  private readonly shared = {
    uTime: { value: 0 },
    uComp: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.36, 0.72, 0.6).normalize() },
    uSway: { value: 0 },
    uCurveR: { value: 700 },
    uCurveD0: { value: 6 },
    uDipSin: { value: 0 },
    uDipTan: { value: 0 },
    uPxScale: { value: 1 },
  };
  private readonly skyUniforms: Record<string, THREE.IUniform> = {};
  private readonly tmpV = new THREE.Vector3();
  /** 相机是否在地面以上 (上一帧)。 */
  private groundAbove = true;
  /** 棕榈羽叶贴图是否已加载。 */
  private frondReady = false;
  private readonly tmpV2 = new THREE.Vector3();

  constructor() {
    this.group.name = 'Beach3DWorld';
    // 场景以角色出生点为原点布置 (布局 / 岸线都是"相对角色"的坐标); 天空 / 云 / 远岛自己设 matrixWorld, 不受影响
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
      this.motion.reset();
    }
  }

  /** 场景自身的绘制调用 / 三角面统计 (只算当前可见的部分)。 */
  public getStats(): Beach3DStats {
    let drawCalls = 0;
    let triangles = 0;
    this.group.traverse((o) => {
      if (!o.visible) return;
      if (o instanceof THREE.InstancedMesh) {
        if (o.count > 0) { drawCalls++; triangles += triangleCount(o.geometry) * o.count; }
      } else if (o instanceof THREE.Mesh) {
        drawCalls++;
        triangles += triangleCount(o.geometry);
      }
    });
    return {
      drawCalls,
      triangles,
      instances: { palms: this.trunks?.count ?? 0, rocks: this.rocks?.count ?? 0, clouds: this.clouds?.count ?? 0, shells: this.shells?.count ?? 0 },
    };
  }

  /** 加载一张手绘贴图 (sRGB, 不翻转, 带 mipmap); 加载完成后回调 (例如让对应网格显示出来)。 */
  private loadTexture(url: string, onLoad: () => void): THREE.Texture {
    const tex = new THREE.TextureLoader().load(url, () => {
      if (!this.disposed) onLoad();
    });
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    this.textures.push(tex);
    return tex;
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

    // ── 天空穹顶 (全屏层, 最先画, 不读写深度) ──
    Object.assign(this.skyUniforms, {
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uZenith: { value: lin(cfg.sky.zenith) },
      uMid: { value: lin(cfg.sky.mid) },
      uHorizon: { value: lin(cfg.sky.horizon) },
      uSeaHorizon: { value: lin(cfg.sea.horizon) },
      uSeaDeep: { value: lin(cfg.sea.deep) },
      uCloudLight: { value: lin(cfg.clouds.light) },
      uCloudShade: { value: lin(cfg.clouds.shade) },
      uSunDir: this.shared.uSunDir,
      uSunGlow: { value: cfg.sky.sunGlow },
      uCirrus: { value: cfg.sky.cirrus },
      uHorizonBand: { value: cfg.sky.horizonBand },
      uBank: { value: clampN(cfg.clouds.bank, 0, 1) },
      uBankHeight: { value: Math.sin(THREE.MathUtils.degToRad(clampN(cfg.clouds.bankHeightDeg, 0.3, 5))) },
      uTime: this.shared.uTime,
      uDipSin: this.shared.uDipSin,
      uComp: this.shared.uComp,
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

    // 远景层 (云 / 远岛) 共用的混合: 留在不透明队列 (按 renderOrder 紧跟天空), alpha 通道保持天空写的不透明值
    const farBlend = {
      depthTest: false,
      depthWrite: false,
      transparent: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    } as const;

    // ── 积云 (远景层, 手绘云贴图) ──
    const cloudLayout = buildCloudLayout(clampN(cfg.clouds.density, 0, 2));
    if (cloudLayout.length > 0 && cfg.clouds.opacity > 0) {
      const n = cloudLayout.length;
      const data = new Float32Array(n * 4);
      const kinds = new Float32Array(n);
      const size = clampN(cfg.clouds.size, 0.5, 1.8);
      cloudLayout.forEach((c, i) => {
        // 角宽 → 球面上的米数
        data.set([THREE.MathUtils.degToRad(c.az), THREE.MathUtils.degToRad(c.el), THREE.MathUtils.degToRad(c.w) * SKY_LAYER_RADIUS * size, c.seed], i * 4);
        kinds[i] = c.kind;
      });
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.setAttribute('aCloud', new THREE.InstancedBufferAttribute(data, 4));
      geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
      const map = this.loadTexture(cfg.assets.clouds, () => { if (this.clouds) this.clouds.visible = true; });
      const mat = this.register(new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uTime: this.shared.uTime,
          uDrift: { value: THREE.MathUtils.degToRad(cfg.clouds.driftDegPerSec) },
          uRadius: { value: SKY_LAYER_RADIUS },
          uDipTan: this.shared.uDipTan,
          uMap: { value: map },
          uRect: { value: CLOUD_SPRITES.map((sp) => new THREE.Vector4(...sp.rect)) },
          uAspect: { value: CLOUD_SPRITES.map((sp) => sp.aspect) },
          uTint: { value: lin(cfg.clouds.tint) },
          uTintJitter: { value: clampN(cfg.clouds.tintJitter, 0, 0.15) },
          uHorizon: { value: lin(cfg.sky.horizon) },
          uOpacity: { value: clampN(cfg.clouds.opacity, 0, 1) },
          uComp: this.shared.uComp,
        },
        ...farBlend,
      }));
      this.clouds = new THREE.InstancedMesh(geo, mat, n);
      this.clouds.name = 'Beach3DClouds';
      this.clouds.frustumCulled = false;
      this.clouds.renderOrder = -990;
      this.clouds.visible = false; // 贴图加载完成后显示
      this.clouds.onBeforeRender = (_r, _s, camera) => this.followCamera(this.clouds!, camera);
      this.group.add(this.clouds);
    }

    // ── 远岛 (远景层, 画在云之后: 低处的远云被岛挡住) ──
    if (cfg.mountains.enabled) {
      const peaks: Array<[IslandPeak, number]> = [
        ...FAR_ISLANDS.map((p) => [p, 0] as [IslandPeak, number]),
        ...MID_ISLANDS.map((p) => [p, 1] as [IslandPeak, number]),
        ...NEAR_ISLANDS.map((p) => [p, 2] as [IslandPeak, number]),
      ].slice(0, ISL_MAX);
      const isl = Array.from({ length: ISL_MAX * 2 }, () => new THREE.Vector4(0, 0, 1, 0));
      peaks.forEach(([p, layer], i) => {
        isl[i * 2].set(p.az, p.h, p.w, p.shape);
        isl[i * 2 + 1].set(p.skew, layer, 1, 0);
      });
      const hs = clampN(cfg.mountains.heightScale, 0.3, 2);
      const maxDeg = Math.max(...peaks.map(([p]) => p.h)) * hs + 0.6;
      this.islands = new THREE.Mesh(
        buildIslandStrip(maxDeg),
        this.register(new THREE.ShaderMaterial({
          vertexShader: ISLAND_VERT,
          fragmentShader: ISLAND_FRAG,
          uniforms: {
            uIsl: { value: isl },
            uFar: { value: lin(cfg.mountains.far) },
            uMid: { value: lin(cfg.mountains.mid) },
            uNear: { value: lin(cfg.mountains.near) },
            uHorizon: { value: lin(cfg.sky.horizon) },
            uSunDir: this.shared.uSunDir,
            uHeight: { value: hs },
            uDetail: { value: clampN(cfg.mountains.detail, 0, 2) },
            uHazeK: { value: clampN(cfg.mountains.haze, 0, 1.5) },
            uRadius: { value: ISLAND_RADIUS },
            uDipTan: this.shared.uDipTan,
            uComp: this.shared.uComp,
          },
          defines: { ISL_MAX },
          side: THREE.DoubleSide,
          ...farBlend,
        })),
      );
      this.islands.name = 'Beach3DIslands';
      this.islands.frustumCulled = false;
      this.islands.renderOrder = -980;
      this.islands.onBeforeRender = (_r, _s, camera) => this.followCamera(this.islands!, camera);
      this.group.add(this.islands);
    }

    // ── 礁石布局 (地面着色器要知道水中礁石的位置来画白浪, 所以先算) ──
    const rockLayout = cfg.rocks.enabled ? buildRockLayout(cfg.layout) : [];
    const rockUniform = Array.from({ length: ROCK_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
    rockLayout.filter((r) => r.inWater).slice(0, ROCK_MAX).forEach((r, i) => rockUniform[i].set(r.x, r.z, r.r * 0.95, 1));

    // ── 道具落影数据 (棕榈 / 伞 / 椅子, 局部坐标) ──
    const propsOn = cfg.props.enabled;
    const palmA = Array.from({ length: PALM_MAX }, () => new THREE.Vector4());
    const palmB = Array.from({ length: PALM_MAX }, () => new THREE.Vector4(0, 0, 0, -1));
    PALMS.slice(0, PALM_MAX).forEach((p, i) => {
      const t = palmTop(p);
      palmA[i].set(p.x, p.z, t.x, t.z);
      palmB[i].set(t.y, 2.0 * p.scale, PALM_TRUNK.r0 * p.scale, (i * 0.618) % 1);
    });
    const cnp = parasolCanopy();
    const canopyU = propsOn ? new THREE.Vector4(cnp.x, cnp.z, cnp.y, cnp.r) : new THREE.Vector4(0, 0, 0, 0);
    const chairU = propsOn ? new THREE.Vector4(CHAIR.x, CHAIR.z, CHAIR.yaw, 1) : new THREE.Vector4(0, 0, 0, 0);

    // ── 沙地 + 海 (y=0 大平面, 写深度; 角色踩在上面, 落影平面画在它上面) ──
    const groundGeo = new THREE.PlaneGeometry(150, 135, 40, 48);
    groundGeo.rotateX(-Math.PI / 2);
    groundGeo.translate(0, 0, -30);
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
          uBands: { value: clampN(Math.round(cfg.sea.waveBands), 0, 4) },
          uDepthNoise: { value: clampN(cfg.sea.depthVariation, 0, 1) },
          uSkyRefl: { value: lin(cfg.sky.mid) },
          uFoamWidth: { value: cfg.sea.foamWidth },
          uFoamVar: { value: clampN(cfg.sea.foamVariation, 0, 1) },
          uFoamBreak: { value: clampN(cfg.sea.foamBreakup, 0, 1) },
          uRipple: { value: cfg.sea.ripple },
          uRippleDensity: { value: cfg.sea.rippleDensity },
          uGlint: { value: cfg.sea.glint },
          uGlintDensity: { value: cfg.sea.glintDensity },
          uGlintSpeed: { value: cfg.sea.glintSpeed },
          uGlintSize: { value: clampN(cfg.sea.glintSize, 0.5, 2) },
          uPxScale: this.shared.uPxScale,
          uSandSpacing: { value: Math.max(0.1, cfg.sand.rippleSpacing) },
          uSandRipple: { value: cfg.sand.ripple },
          uSandGrain: { value: cfg.sand.grain },
          uSunDir: this.shared.uSunDir,
          uRocks: { value: rockUniform },
          uPalmA: { value: palmA },
          uPalmB: { value: palmB },
          uCanopy: { value: canopyU },
          uChair: { value: chairU },
          uChairBack: { value: new THREE.Vector4(CHAIR_BACK.pivotY, CHAIR_BACK.pivotZ, CHAIR_BACK.angle, CHAIR_BACK.length) },
          uChairSeat: { value: new THREE.Vector4(CHAIR_BACK.seatTop, CHAIR_BACK.legX, CHAIR_BACK.legZ[0], CHAIR_BACK.legZ[1]) },
          uShadowK: { value: clampN(cfg.props.groundShadow, 0, 1) },
          uComp: this.shared.uComp,
          ...haze,
        },
        defines: { ROCK_MAX, PALM_MAX },
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
      })),
    );
    this.ground.name = 'Beach3DGround';
    this.ground.receiveShadow = false;
    this.group.add(this.ground);

    // ── 棕榈 (树干 + 叶冠) ──
    const palmMat = this.register(new THREE.ShaderMaterial({
      vertexShader: PALM_VERT,
      fragmentShader: PALM_FRAG,
      uniforms: {
        uTime: this.shared.uTime,
        uSway: this.shared.uSway,
        uLean: { value: PALM_TRUNK.lean },
        uLeafLight: { value: lin(cfg.vegetation.leafLight) },
        uLeafShade: { value: lin(cfg.vegetation.leafShade) },
        uFrond: { value: this.loadTexture(cfg.assets.frond, () => { this.frondReady = true; if (this.crowns) this.crowns.visible = this.groundAbove; }) },
        uFrondSize: { value: new THREE.Vector2(1024, 320) },
        uTrunkLight: { value: lin(cfg.vegetation.trunkLight) },
        uTrunkShade: { value: lin(cfg.vegetation.trunkShade) },
        uSunDir: this.shared.uSunDir,
        uHaze: { value: sandHaze },
        uComp: this.shared.uComp,
        ...haze,
      },
      side: THREE.DoubleSide,
    }));
    const trunkGeo = buildPalmTrunk();
    const crownGeo = buildPalmCrown(clampN(cfg.vegetation.fronds, 8, 16), clampN(cfg.vegetation.frondWidth, 0.7, 1.4));
    const iPalm = new Float32Array(PALMS.length * 2);
    PALMS.forEach((p, i) => iPalm.set([p.height, p.lean], i * 2));
    trunkGeo.setAttribute('iPalm', new THREE.InstancedBufferAttribute(iPalm, 2));
    crownGeo.setAttribute('iPalm', new THREE.InstancedBufferAttribute(iPalm.slice(), 2));
    this.trunks = new THREE.InstancedMesh(trunkGeo, palmMat, PALMS.length);
    this.crowns = new THREE.InstancedMesh(crownGeo, palmMat, PALMS.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(0, 0, 1);
    PALMS.forEach((p, i) => {
      q.setFromAxisAngle(Y, p.yaw);
      sc.setScalar(p.scale);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, sc);
      this.trunks!.setMatrixAt(i, m);
      // 叶冠: 挂在树干顶端, 顺着倾斜方向歪一点 (局部绕 Z 轴), 再自转; 每棵树大小略有差别
      const t = palmTop(p);
      q.setFromAxisAngle(Y, p.yaw).multiply(q2.setFromAxisAngle(Z, -0.16 * p.lean)).multiply(new THREE.Quaternion().setFromAxisAngle(Y, p.spin));
      sc.setScalar(p.scale * (0.94 + 0.12 * ((i * 0.618) % 1)));
      m.compose(new THREE.Vector3(t.x, t.y, t.z), q, sc);
      this.crowns!.setMatrixAt(i, m);
    });
    this.trunks.name = 'Beach3DPalmTrunks';
    this.crowns.name = 'Beach3DPalmCrowns';
    this.trunks.computeBoundingSphere();
    this.crowns.computeBoundingSphere();
    this.crowns.visible = false; // 羽叶贴图加载完成后显示
    this.group.add(this.trunks, this.crowns);

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
          ...haze,
        },
      })), rockLayout.length);
      rockLayout.forEach((r, i) => {
        q.setFromAxisAngle(Y, r.rot);
        sc.set(r.r, r.r * r.squash, r.r * (0.8 + 0.2 * Math.sin(i)));
        m.compose(new THREE.Vector3(r.x, r.inWater ? -0.08 * r.r : -0.03, r.z), q, sc);
        this.rocks!.setMatrixAt(i, m);
      });
      this.rocks.name = 'Beach3DRocks';
      this.rocks.computeBoundingSphere();
      this.group.add(this.rocks);
    }

    // ── 贝壳 / 海螺 / 海星 (三种形状一个几何, 1 次绘制) ──
    const shellLayout = cfg.shells.enabled ? buildShellLayout(cfg.shells.count, cfg.layout, cfg.sea.swashAmp) : [];
    if (shellLayout.length > 0) {
      const geo = buildShellSet();
      const kinds = new Float32Array(shellLayout.length);
      const cols = new Float32Array(shellLayout.length * 3);
      const pal = cfg.shells.colors.map((h) => lin(h));
      shellLayout.forEach((sh, i) => {
        kinds[i] = sh.kind;
        const c = pal[sh.color % pal.length];
        cols.set([c.r, c.g, c.b], i * 3);
      });
      geo.setAttribute('iKind', new THREE.InstancedBufferAttribute(kinds, 1));
      geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(cols, 3));
      this.shells = new THREE.InstancedMesh(geo, this.register(new THREE.ShaderMaterial({
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        uniforms: {
          uSunDir: this.shared.uSunDir,
          uHaze: { value: sandHaze },
          uComp: this.shared.uComp,
          ...haze,
        },
        side: THREE.DoubleSide,
      })), shellLayout.length);
      shellLayout.forEach((sh, i) => {
        q.setFromAxisAngle(Y, sh.rot);
        sc.setScalar(sh.size * cfg.shells.size);
        m.compose(new THREE.Vector3(sh.x, 0.002, sh.z), q, sc);
        this.shells!.setMatrixAt(i, m);
      });
      this.shells.name = 'Beach3DShells';
      this.shells.computeBoundingSphere();
      this.group.add(this.shells);
    }

    // ── 沙滩椅 + 遮阳伞 (1 次绘制) ──
    if (propsOn) {
      const spawn = this.group.position;
      this.props = new THREE.Mesh(buildBeachProps(), this.register(new THREE.ShaderMaterial({
        vertexShader: PROP_VERT,
        fragmentShader: PROP_FRAG,
        uniforms: {
          uFrame: { value: lin(cfg.props.frame) },
          uCushion: { value: lin(cfg.props.cushion) },
          uStripe: { value: lin(cfg.props.stripe) },
          uCanopyA: { value: lin(cfg.props.canopyA) },
          uCanopyB: { value: lin(cfg.props.canopyB) },
          uPillow: { value: lin(cfg.props.pillow) },
          uSunDir: this.shared.uSunDir,
          uHaze: { value: sandHaze },
          uCanopyW: { value: new THREE.Vector4(cnp.x + spawn.x, cnp.y, cnp.z + spawn.z, cnp.r) },
          uComp: this.shared.uComp,
          ...haze,
        },
        side: THREE.DoubleSide,
      })));
      this.props.position.set(CHAIR.x, 0, CHAIR.z);
      this.props.rotation.y = CHAIR.yaw;
      this.props.name = 'Beach3DProps';
      this.group.add(this.props);
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
    this.shared.uPxScale.value = renderer.getPixelRatio();

    if (this.sun) {
      this.sun.getWorldPosition(this.tmpV);
      this.sun.target.getWorldPosition(this.tmpV2);
      const d = this.tmpV.sub(this.tmpV2);
      if (d.lengthSq() > 1e-8) (this.shared.uSunDir.value as THREE.Vector3).copy(d.normalize());
    }

    camera.getWorldPosition(this.tmpV);
    const camDist = Math.hypot(this.tmpV.x - this.group.position.x, this.tmpV.z - this.group.position.z);
    const d0 = camDist + 3;
    this.shared.uCurveD0.value = d0;
    const camH = this.tmpV.y - this.group.position.y;
    // 海平线只由相机离地高度决定 (世界空间固定, 不随俯仰滑动); 相机由引擎的 groundClamp 保持在地面以上
    const dip = computeHorizonDip(camH, d0, this.shared.uCurveR.value);
    this.shared.uDipSin.value = Math.sin(dip);
    this.shared.uDipTan.value = Math.tan(dip);

    // 兜底: 相机正常不会到地面以下 (APP_CONFIG.camera.groundClamp); 若关掉夹取后相机穿地, 地面背面被剔除, 地上的道具会浮在天上 → 只留天空 / 云 / 远岛和角色
    const above = camH > 0.02;
    this.groundAbove = above;
    if (this.shells) this.shells.visible = above;
    if (this.rocks) this.rocks.visible = above;
    if (this.props) this.props.visible = above;
    if (this.trunks) this.trunks.visible = above;
    if (this.crowns && this.frondReady) this.crowns.visible = above;

    (this.skyUniforms.uInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (this.skyUniforms.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);

    const exp = renderer.toneMapping === THREE.LinearToneMapping ? renderer.toneMappingExposure : 1;
    this.shared.uComp.value = 1 / Math.max(0.2, exp || 1);
  }

  public dispose(scene?: THREE.Scene): void {
    this.disposed = true;
    this.motion.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
    if (scene) scene.remove(this.group);
    this.group.clear();
    this.sky = this.clouds = this.islands = this.ground = this.trunks = this.crowns = this.rocks = this.shells = this.props = null;
  }
}
