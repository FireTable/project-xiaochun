import * as THREE from 'three';
import { APP_CONFIG } from '@/config';
import { isMobile } from '@/lib/platform';
import { BEACH_STRIP, computeStripCenter } from './beachStrip';
import { SceneMotionGovernor } from './sceneMotion';

export { BEACH_STRIP, computeStripCenter, coverViewport } from './beachStrip';

/**
 * BeachBackdrop — "海滩"场景 (id: beach) 的背景层。
 *
 * 一张烘焙好的竖长条 (public/scene/beach/beach-strip.webp, 1280×1810: 天空 / 主景 / 沙地, 接缝已做渐变; 见 scripts/build-beach-strip.mjs),
 * 用一个全屏着色器层画在场景最底层 (renderOrder 极小, 不读写深度, 画在角色身后)。
 *
 * ── 相机模型 (项目特色, 不能为背景妥协) ──
 *   只有"俯仰"绕角色转 (OrbitControls polar ∈ [0.01, π−0.01], 近满 180°); 左右不绕相机, 是角色 bodyTurn。
 *   因此背景只依赖相机视线的俯仰角, 与水平朝向无关: 左右永远不动, 角色怎么转背景都不变。
 *
 * ── 垂直映射 ──
 *   p = 视线俯仰 / (π/2 − 0.01) ∈ [−1, 1]   (+1 = 仰视极限看天, −1 = 俯视极限看地)
 *   屏幕中心对应长条的第 c(p) 行:  c(p) = c0 − a·p + e·p²
 *     · c0  = 平视 (p=0) 时的中心行, 由"海平线落在角色髋部" 反推 (见 computeStripCenter);
 *     · a, e 使 c(+1) = vh/2 (视口顶边恰好贴到长条顶)、c(−1) = H − vh/2 (视口底边恰好贴到长条底) → 任意俯仰都不会露边;
 *     · e·p² 项让 c(p) 在 p=0 处一阶连续, 上下两侧滚动速度不同 (c0 不在长条正中) 也不会在平视处"顿一下"。
 *   屏幕像素 → 长条像素: x = 640 + ndcX·vw/2,  y = c − ndcY·vh/2。
 *   (vw, vh) 是"cover"视口: 长条宽 1280、单张图高 720 内放得下的、与屏幕同宽高比的最大矩形 → 永不拉伸, 超出的部分居中裁掉。
 *   这是风格化的"远景视差": 背景滚动速度 (约 7 条带像素/度) 小于真实无穷远背景 (约 23), 换来 180° 俯仰都有内容可看。
 *
 * ── 滚轮缩放 ──
 *   相机前后距离变化时背景同步缩放 (推近放大 / 拉远缩小): 视口窗口按 1/zoom 缩放, zoom = (默认视距/当前视距)^strength (夹到 [minScale, maxScale]),
 *   缩放中心是平视时的海平线 (c0 公式里 horizonY 与屏幕 horizonNdcY 的对应点不随 zoom 移动), 所以海平线不会因缩放上下跳。参数见 APP_CONFIG.beachScene.zoom。
 *
 * ── 局部动态 (全在着色器 / GPU 粒子里, 零 CPU 每帧开销) ──
 *   海面波光 + 水面微扰 (仅 mask.R 海面区域) / 云横向漂移 (仅 mask.G 纯天空区域, 镜像边界) / 飘落花瓣与上升光点 (Points, 画在角色身后)。
 *   参数全在 APP_CONFIG.beachScene.dynamics; prefers-reduced-motion 或低帧率自动关闭 (降级逻辑见 sceneMotion.ts, 与 beach3d 共用)。
 *
 * 渲染顺序: 本层与粒子都走"不透明队列" (transparent=false, 粒子用 CustomBlending 自带 alpha 混合), renderOrder 为负, 先于一切;
 * 若粒子用 transparent=true 会被排进透明队列, 画到角色前面。
 */

const VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uStrip;
uniform sampler2D uMask;
uniform float uReady;
uniform vec2  uSize;        // 长条尺寸 (px)
uniform vec2  uView;        // 视口 (vw, vh) 单位: 长条像素
uniform float uCenter;      // 屏幕中心对应的长条行
uniform float uTime;
uniform float uDyn;         // 0/1 动态总开关
uniform float uGlint;
uniform float uGlintDensity;
uniform float uGlintSpeed;
uniform float uWobble;
uniform float uCloudOff;    // 云水平偏移 (长条像素)
uniform float uHorizon;
uniform float uShore;
uniform float uComp;        // 曝光补偿 (1/toneMappingExposure), 让背景过完色调映射后与素材原色一致
uniform float uMark;        // 输出 alpha: 走后期 (composer) 时为 0.99 = "背景"标记, Bloom 高通据此跳过; 直出时为 1
varying vec2 vNdc;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 p = vec2(uSize.x * 0.5 + vNdc.x * 0.5 * uView.x, uCenter - vNdc.y * 0.5 * uView.y);
  p = clamp(p, vec2(0.5), uSize - 0.5);

  if (uReady < 0.5) {
    // 贴图未就绪的兜底: 与素材同色系的纯渐变, 避免首帧黑屏 / 闪白
    float t = p.y / uSize.y;
    vec3 sky = mix(vec3(0.06, 0.38, 0.90), vec3(0.62, 0.86, 0.98), smoothstep(0.0, 0.52, t));
    vec3 sea = vec3(0.20, 0.62, 0.90);
    vec3 sand = vec3(0.95, 0.80, 0.62);
    vec3 c = mix(sky, sea, smoothstep(0.52, 0.54, t));
    c = mix(c, sand, smoothstep(0.60, 0.62, t));
    gl_FragColor = vec4(c * uComp, uMark);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }

  vec2 maskUv = p / uSize;
  vec4 m = texture2D(uMask, maskUv);
  float sea = m.r;
  float skyZone = m.g;
  float v = clamp((p.y - uHorizon) / (uShore - uHorizon), 0.0, 1.0);

  vec2 q = p;
  if (uDyn > 0.5) {
    // 水面微扰: 横向细浪 + 极小的纵向起伏 (近处幅度大, 海平线处为 0)
    float amp = sea * uWobble * (0.25 + 1.4 * v);
    q.x += amp * (sin(p.y * 0.55 + uTime * 0.9) + 0.5 * sin(p.y * 1.3 - uTime * 1.25 + p.x * 0.012));
    q.y += sea * uWobble * 0.45 * v * sin(p.x * 0.018 + uTime * 0.7);
    // 云: 纯天空区域整体横移
    q.x += skyZone * uCloudOff;
  }
  // 镜像边界: 横移 / 微扰后越过左右边也只会采到镜像的边缘, 不会露边
  float W = uSize.x;
  float tx = mod(q.x, 2.0 * W);
  q.x = tx > W ? 2.0 * W - tx : tx;
  q.y = clamp(q.y, 0.5, uSize.y - 0.5);

  vec3 col = texture2D(uStrip, q / uSize).rgb;

  // 海面波光: 透视压缩的格子里随机点亮"横向小亮斑" (赛璐璐风的闪烁高光, 奶白偏暖)
  if (sea > 0.01 && uGlint > 0.001) {
    float s = v + 0.20;
    vec2 g = vec2(p.x / (90.0 * s), 9.0 * log(s / 0.2) / log(6.0));
    vec2 id = floor(g);
    vec2 f = fract(g);
    float h1 = hash12(id);
    float h2 = hash12(id + 17.31);
    float gate = step(1.0 - uGlintDensity, h1);
    float tw = 0.5 + 0.5 * sin(uTime * uDyn * uGlintSpeed * (1.1 + 1.5 * h2) + h1 * 40.0);
    tw = tw * tw * tw * tw;
    vec2 d = (f - vec2(0.2 + 0.6 * h2, 0.5)) / vec2(0.26, 0.09 + 0.07 * h1);
    float shape = 1.0 - smoothstep(0.45, 1.0, dot(d, d));
    float gl = gate * tw * shape * sea * smoothstep(0.02, 0.18, v);
    col = mix(col, vec3(1.0, 0.99, 0.93), clamp(gl * uGlint, 0.0, 1.0));
  }

  gl_FragColor = vec4(col * uComp, uMark);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const P_VERT = /* glsl */ `
attribute vec4 aSeed;   // x 起始相位, y 横向位置, z 速度/大小因子, w 杂项随机
uniform float uTime;
uniform float uSpeed;
uniform float uPx;      // 设备像素比
uniform float uSize;
uniform float uMoteRatio;
uniform float uOpacity;
uniform float uPitch;   // 归一化俯仰 (−1..1), 让粒子随俯仰极轻微地上下错位
uniform vec3  uPal[4];
varying vec3  vColor;
varying float vAlpha;
varying float vKind;
varying float vRot;
varying float vTw;
void main() {
  float kind = step(fract(aSeed.w * 13.37), uMoteRatio); // 1 = 光点, 0 = 花瓣
  float spd = (0.010 + 0.012 * aSeed.z) * uSpeed;
  float life = fract(aSeed.x + uTime * spd);
  float sway = sin(uTime * (0.5 + 0.7 * aSeed.z) + aSeed.w * 6.2831);
  float x = aSeed.y * 2.2 - 1.1 + sway * 0.05 + life * mix(0.30, 0.08, kind);
  float y = kind > 0.5 ? (-1.12 + life * 2.3) : (1.12 - life * 2.3);
  y += uPitch * 0.10;
  gl_Position = vec4(x, y, 1.0, 1.0);
  float px = kind > 0.5 ? (10.0 + 10.0 * aSeed.z) : (9.0 + 6.0 * aSeed.z);
  gl_PointSize = px * uSize * uPx;
  int ci = int(floor(fract(aSeed.w * 4.7) * 4.0));
  vec3 c = uPal[0];
  if (ci == 1) c = uPal[1]; else if (ci == 2) c = uPal[2]; else if (ci == 3) c = uPal[3];
  vColor = kind > 0.5 ? mix(c, vec3(1.0, 0.97, 0.86), 0.65) : c;
  float fade = smoothstep(0.0, 0.07, life) * (1.0 - smoothstep(0.90, 1.0, life));
  vAlpha = fade * uOpacity * (kind > 0.5 ? 0.85 : 0.9);
  vKind = kind;
  vRot = aSeed.w * 6.2831 + uTime * (0.35 + 0.5 * aSeed.z) * (aSeed.y > 0.5 ? 1.0 : -1.0);
  vTw = 0.6 + 0.4 * sin(uTime * (1.3 + 1.7 * aSeed.z) + aSeed.x * 40.0);
}
`;

const P_FRAG = /* glsl */ `
precision highp float;
varying vec3  vColor;
varying float vAlpha;
varying float vKind;
varying float vRot;
varying float vTw;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a;
  vec3 col = vColor;
  if (vKind > 0.5) {
    float r = length(p) * 2.0;
    a = pow(max(0.0, 1.0 - r), 2.0) * vTw;
  } else {
    float cs = cos(vRot), sn = sin(vRot);
    vec2 q = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
    float u = q.x / 0.46;
    float w = q.y / (0.27 * (1.0 + 0.55 * q.x));
    float d = u * u + w * w;
    a = 1.0 - smoothstep(0.62, 1.0, d);
    col = mix(col, vec3(1.0), 0.40 * smoothstep(0.2, -0.45, q.x)); // 瓣根偏白, 一点点赛璐璐的高光
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface BeachSubject {
  /** 相机注视点 (OrbitControls.target)。 */
  target: THREE.Vector3;
  /** 角色髋部骨骼的世界 y; 没有模型时为 null (用默认对位)。 */
  hipY: number | null;
  /** 当前 fov 下的默认取景视距 (m): 滚轮缩放时背景缩放倍率以它为 1 (见 APP_CONFIG.beachScene.zoom)。 */
  refDistance: number;
}

/** 没有模型 / 没有髋部时的海平线屏幕位置 (NDC y): 默认取景下髋部约在屏幕中心下方 45% 半高。 */
const DEFAULT_HORIZON_NDC_Y = -0.45;

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

export class BeachBackdrop {
  public readonly group = new THREE.Group();

  private quad: THREE.Mesh | null = null;
  private points: THREE.Points | null = null;
  private stripTex: THREE.Texture | null = null;
  private maskTex: THREE.Texture | null = null;
  private loadStarted = false;
  private disposed = false;
  private active = false;
  private subject: (() => BeachSubject | null) | null = null;
  private onAssetsReady: (() => void) | null = null;

  // 动态状态 (reduced-motion / 低帧率降级, 与 beach3d 共用同一套逻辑)
  private readonly motion = new SceneMotionGovernor(() => APP_CONFIG.beachScene.dynamics);
  private smoothHipY: number | null = null;

  /** 本次会话是否已因低帧率关闭动态 (截图脚本会直接写 false)。 */
  public get downgraded(): boolean { return this.motion.downgraded; }
  public set downgraded(v: boolean) { this.motion.downgraded = v; }

  private readonly dir = new THREE.Vector3();
  private readonly shared = {
    uTime: { value: 0 },
    uDyn: { value: 1 },
  };
  private readonly quadUniforms: Record<string, THREE.IUniform> = {};
  private readonly pointUniforms: Record<string, THREE.IUniform> = {};
  private particleMax = 0;

  constructor() {
    this.group.name = 'BeachBackdrop';
    this.group.visible = false;
  }

  public attach(scene: THREE.Scene): void {
    if (this.group.parent !== scene) scene.add(this.group);
  }

  /** 引擎提供"相机注视点 + 髋部高度", 用于把海平线对到髋部。 */
  public setSubjectProvider(fn: () => BeachSubject | null): void {
    this.subject = fn;
  }

  /** 贴图加载完成回调 (引擎用它补渲染一帧; 动画循环在跑时可不设)。 */
  public setOnAssetsReady(fn: (() => void) | null): void {
    this.onAssetsReady = fn;
  }

  public isActive(): boolean {
    return this.active;
  }

  /** 动态当前是否生效 (调试 / 测试用)。 */
  public isDynamicsActive(): boolean {
    return this.dynamicsOn();
  }

  public setActive(active: boolean): void {
    if (this.disposed) return;
    this.active = active;
    this.group.visible = active;
    if (active) {
      this.ensureBuilt();
      this.motion.reset(); // 重新进入海滩时重新评估性能
    }
  }

  private dynamicsOn(): boolean {
    return this.motion.isOn();
  }

  private ensureBuilt(): void {
    if (this.quad) return;
    const cfg = APP_CONFIG.beachScene;

    // prefers-reduced-motion
    this.motion.watchReducedMotion();

    // ── 背景全屏层 ──
    Object.assign(this.quadUniforms, {
      uStrip: { value: null },
      uMask: { value: null },
      uReady: { value: 0 },
      uSize: { value: new THREE.Vector2(BEACH_STRIP.width, BEACH_STRIP.height) },
      uView: { value: new THREE.Vector2(BEACH_STRIP.width, BEACH_STRIP.tileHeight) },
      uCenter: { value: BEACH_STRIP.horizonY },
      uTime: this.shared.uTime,
      uDyn: this.shared.uDyn,
      uGlint: { value: cfg.dynamics.sea.glint },
      uGlintDensity: { value: cfg.dynamics.sea.glintDensity },
      uGlintSpeed: { value: cfg.dynamics.sea.glintSpeed },
      uWobble: { value: cfg.dynamics.sea.wobble },
      uCloudOff: { value: 0 },
      uHorizon: { value: BEACH_STRIP.horizonY },
      uShore: { value: BEACH_STRIP.shoreY },
      uComp: { value: 1 },
      uMark: { value: 1 },
    });
    const quadMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.quadUniforms,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
    this.quad.frustumCulled = false;
    this.quad.renderOrder = -1000;
    this.quad.name = 'BeachBackdropQuad';
    this.quad.onBeforeRender = (renderer, _scene, camera) => this.beforeRender(renderer, camera as THREE.PerspectiveCamera);
    this.group.add(this.quad);

    // ── 粒子 ──
    this.particleMax = Math.max(0, Math.min(64, Math.max(cfg.dynamics.particles.count, cfg.dynamics.particles.countMobile)));
    if (this.particleMax > 0) {
      const rnd = mulberry32(0x5eac4);
      const seeds = new Float32Array(this.particleMax * 4);
      for (let i = 0; i < this.particleMax; i++) {
        seeds[i * 4] = rnd();
        seeds[i * 4 + 1] = (i + rnd()) / this.particleMax; // 横向均匀分层, 避免扎堆
        seeds[i * 4 + 2] = rnd();
        seeds[i * 4 + 3] = rnd();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.particleMax * 3), 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      const pal = [0xffc2d1, 0xd4c4fb, 0xbdf2dd, 0xfff1c9].map((h) => {
        const c = new THREE.Color(h); // THREE.Color 按 ColorManagement 转线性, 与着色器输出一致
        return new THREE.Vector3(c.r, c.g, c.b);
      });
      Object.assign(this.pointUniforms, {
        uTime: this.shared.uTime,
        uSpeed: { value: cfg.dynamics.particles.speed },
        uPx: { value: 1 },
        uSize: { value: cfg.dynamics.particles.size },
        uMoteRatio: { value: cfg.dynamics.particles.moteRatio },
        uOpacity: { value: cfg.dynamics.particles.opacity },
        uPitch: { value: 0 },
        uPal: { value: pal },
      });
      const pm = new THREE.ShaderMaterial({
        vertexShader: P_VERT,
        fragmentShader: P_FRAG,
        uniforms: this.pointUniforms,
        depthTest: false,
        depthWrite: false,
        transparent: false, // 关键: 留在不透明队列 (按 renderOrder 先于角色), 混合由下面的 CustomBlending 负责
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      });
      this.points = new THREE.Points(geo, pm);
      this.points.frustumCulled = false;
      this.points.renderOrder = -999;
      this.points.name = 'BeachBackdropPetals';
      this.group.add(this.points);
    }

    this.loadTextures();
  }

  private loadTextures(): void {
    if (this.loadStarted) return;
    this.loadStarted = true;
    const cfg = APP_CONFIG.beachScene;
    const loader = new THREE.TextureLoader();
    const prep = (t: THREE.Texture, srgb: boolean) => {
      t.flipY = false; // 第 0 行 = 长条最上面一行, uv.y = 行号 / 高
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 4;
      return t;
    };
    Promise.all([
      loader.loadAsync(cfg.assets.strip),
      loader.loadAsync(cfg.assets.mask),
    ]).then(([strip, mask]) => {
      if (this.disposed) { strip.dispose(); mask.dispose(); return; }
      this.stripTex = prep(strip, true);
      this.maskTex = prep(mask, false);
      this.quadUniforms.uStrip.value = this.stripTex;
      this.quadUniforms.uMask.value = this.maskTex;
      this.quadUniforms.uReady.value = 1;
      this.onAssetsReady?.();
    }).catch((err) => {
      console.warn('[BeachBackdrop] failed to load beach assets, falling back to flat gradient:', err);
    });
  }

  /** 每次渲染前由 Three 调用 (无论走 composer 还是直出, 也无论是动画循环还是 renderSingleFrame 补帧)。 */
  private beforeRender(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    const cfg = APP_CONFIG.beachScene;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // 低性能自动降级 (按帧间隔平均, 只在动态开启时统计) — 见 sceneMotion.ts
    const dyn = this.motion.tick(now);
    const dt = this.motion.dt();
    const clockT = this.motion.time(7.3);
    this.shared.uDyn.value = dyn ? 1 : 0;
    this.shared.uTime.value = clockT; // 静态时停在一个波光分布好看的固定时刻

    // ── 视线俯仰 → 长条中心行 ──
    camera.getWorldDirection(this.dir);
    const lookPitch = Math.asin(Math.min(1, Math.max(-1, this.dir.y)));
    const maxPitch = Math.PI / 2 - APP_CONFIG.camera.minPolarAngle;
    const p = lookPitch / maxPitch;

    // 海平线对到髋部: 平视时髋部在屏幕上的 NDC y = −(target.y − hipY') / (dist·tan(fov/2))
    let horizonNdcY = DEFAULT_HORIZON_NDC_Y;
    let zoom = 1;
    const subj = this.subject?.() ?? null;
    if (subj && cfg.zoom.enabled && subj.refDistance > 0) {
      // 滚轮缩放 = 相机前后距离变化: 推近 → 背景一起放大, 拉远 → 一起缩小 (缩放中心是海平线, 见 computeStripCenter)
      const d = Math.max(0.3, camera.position.distanceTo(subj.target));
      zoom = THREE.MathUtils.clamp(Math.pow(subj.refDistance / d, THREE.MathUtils.clamp(cfg.zoom.strength, 0, 1)), cfg.zoom.minScale, cfg.zoom.maxScale);
    }
    if (subj && subj.hipY !== null && Number.isFinite(subj.hipY)) {
      // 髋部高度做低通 (呼吸 / 重心起伏不要带动整张背景抖)
      this.smoothHipY = this.smoothHipY === null ? subj.hipY : this.smoothHipY + (subj.hipY - this.smoothHipY) * Math.min(1, dt * 3 + 0.0);
      const dist = Math.max(0.3, camera.position.distanceTo(subj.target));
      const half = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const anchorY = this.smoothHipY + cfg.scroll.horizonAboveHipsM;
      horizonNdcY = -(subj.target.y - anchorY) / (dist * half);
    }
    const { center, vw, vh } = computeStripCenter({ p, aspect: camera.aspect, horizonNdcY, parallax: cfg.scroll.parallax, zoom });
    (this.quadUniforms.uView.value as THREE.Vector2).set(vw, vh);
    this.quadUniforms.uCenter.value = center;

    // 曝光补偿: 线性色调映射会乘 exposure, 除回去让背景保持素材原色
    const exp = renderer.toneMapping === THREE.LinearToneMapping ? renderer.toneMappingExposure : 1;
    this.quadUniforms.uComp.value = 1 / Math.max(0.2, exp || 1);
    // 走 composer (渲染目标非空) 时给背景像素打 0.99 的 alpha 标记, 让 Bloom 高通跳过 (见 postFxPipeline)
    this.quadUniforms.uMark.value = renderer.getRenderTarget() ? 0.99 : 1;

    // 云漂移 (正弦来回, 镜像边界兜底)
    const cl = cfg.dynamics.cloud;
    this.quadUniforms.uCloudOff.value = dyn ? cl.driftPx * Math.sin((clockT / Math.max(5, cl.periodSec)) * Math.PI * 2) : 0;

    // 粒子
    if (this.points) {
      const n = dyn ? Math.min(this.particleMax, Math.max(0, Math.round(isMobile() ? cfg.dynamics.particles.countMobile : cfg.dynamics.particles.count))) : 0;
      this.points.visible = n > 0;
      this.points.geometry.setDrawRange(0, n);
      this.pointUniforms.uPx.value = renderer.getPixelRatio();
      this.pointUniforms.uPitch.value = p;
    }
  }

  public dispose(scene?: THREE.Scene): void {
    this.disposed = true;
    this.motion.dispose();
    this.quad?.geometry.dispose();
    (this.quad?.material as THREE.Material | undefined)?.dispose();
    this.points?.geometry.dispose();
    (this.points?.material as THREE.Material | undefined)?.dispose();
    this.stripTex?.dispose();
    this.maskTex?.dispose();
    if (scene) scene.remove(this.group);
    this.group.clear();
    this.quad = null;
    this.points = null;
    this.stripTex = null;
    this.maskTex = null;
  }
}
