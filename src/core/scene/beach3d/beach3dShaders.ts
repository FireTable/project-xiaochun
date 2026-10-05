/**
 * beach3dShaders.ts — 海滩 3D 场景的全部着色器 (GLSL, 用于 THREE.ShaderMaterial)。
 *
 * 风格: 2D 二次元赛璐璐 —— 平涂 + 柔和渐变 + 两阶明暗, 没有写实质感 / 环境贴图 / 噪声颗粒。
 * 共同约定:
 *   - 颜色 uniform 都是线性空间 (THREE.Color 已按 ColorManagement 转好), 输出前乘 uComp (= 1 / 曝光), 抵消线性色调映射的曝光,
 *     画面上的颜色 = 配置里的 sRGB 色值。
 *   - 输出 alpha = uMark: 走后期 (渲染到 composer 目标) 时为 0.99, Bloom 高通据此跳过背景像素 (与 beach 场景同一约定, 见 postFxPipeline.ts);
 *     直出屏幕时为 1。
 *   - 空气透视: 远处向海平线色淡出 (uHazeStart → uHazeEnd), 让远景与天空 / 海平线无缝。
 */

const COMMON = /* glsl */ `
uniform float uComp;
uniform float uMark;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

const OUT = /* glsl */ `
  gl_FragColor = vec4(col * uComp, uMark);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// ───────────────────────── 天空 (全屏层) ─────────────────────────
// 不依赖几何: 每个像素按视线方向算颜色, 任何俯仰 / 宽高比都铺满整屏, 不会穿帮或露黑边。
// 海平线以上 = 三段渐变 + 太阳方向柔光; 海平线以下 = 远海色 (海面几何之外 / 相机在地面以下时看到的都是它)。
export const SKY_VERT = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
varying vec3 vDir;
void main() {
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  v /= v.w;
  vDir = (uCamWorld * vec4(v.xyz, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uSeaHorizon;
uniform vec3 uSeaDeep;
uniform vec3 uSunDir;
uniform float uSunGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col;
  if (h >= 0.0) {
    col = mix(uHorizon, uMid, smoothstep(0.0, 0.24, h));
    col = mix(col, uZenith, smoothstep(0.2, 0.95, h));
    float s = max(dot(d, uSunDir), 0.0);
    col = mix(col, vec3(1.0, 0.985, 0.94), clamp(uSunGlow * (0.55 * pow(s, 4.0) + 1.2 * pow(s, 40.0)), 0.0, 1.0));
    // 海平线上一条极细的亮带 (赛璐璐背景常见的"天边白")
    col = mix(col, vec3(1.0), 0.45 * (1.0 - smoothstep(0.0, 0.014, h)));
  } else {
    col = mix(uSeaHorizon, uSeaDeep, smoothstep(0.0, -0.3, h));
  }
  ${OUT}
}
`;

// ───────────────────────── 云 (实例化面片, 远景层) ─────────────────────────
// 每朵云一个朝向相机的面片, 分布在以相机为圆心、半径 uRadius 的球面上 (远景层跟随相机平移 = 无限远, 不受远裁剪面影响)。
// 形状 = 5 个圆的并集 + 平底 (积云), 两阶明暗: 亮部纯白, 底部薰衣草蓝阴影。
export const CLOUD_VERT = /* glsl */ `
attribute vec4 aCloud; // x 方位角 (rad), y 仰角 (rad), z 宽度 (m), w 随机种子
uniform float uTime;
uniform float uDrift;   // rad/s
uniform float uRadius;
varying vec2 vUv;
varying float vSeed;
varying float vEl;
void main() {
  float az = aCloud.x + uTime * uDrift;
  float el = aCloud.y;
  vec3 c = uRadius * vec3(cos(el) * sin(az), sin(el), -cos(el) * cos(az));
  vec3 fwd = normalize(-c);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec2 sz = vec2(aCloud.z, aCloud.z * 0.46);
  vec3 wp = c + right * position.x * sz.x + up * position.y * sz.y;
  vUv = position.xy + 0.5;
  vSeed = aCloud.w;
  vEl = el;
  gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(wp, 1.0));
}
`;

export const CLOUD_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uLight;
uniform vec3 uShade;
uniform vec3 uHorizon;
uniform float uOpacity;
varying vec2 vUv;
varying float vSeed;
varying float vEl;
void main() {
  vec2 p = (vUv - 0.5) * vec2(2.17, 1.0);
  float d = 1e3;
  float top = -1.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float h1 = hash12(vec2(fi, vSeed * 91.7));
    float h2 = hash12(vec2(fi + 7.0, vSeed * 53.1));
    float cx = -0.72 + fi * 0.36 + (h1 - 0.5) * 0.12;
    float bump = 1.0 - abs(fi - 2.0) / 2.0;          // 中间高两边低
    float r = 0.17 + 0.17 * bump + 0.07 * h2;
    float cy = -0.2 + r * 0.55 + 0.04 * h1;
    float di = length(p - vec2(cx, cy)) - r;
    d = min(d, di);
  }
  d = max(d, -(p.y + 0.21));                          // 平底
  float aa = fwidth(d) * 1.2 + 1e-4;
  float a = 1.0 - smoothstep(-aa, aa, d);
  if (a < 0.01) discard;
  // 两阶明暗: 底部 (含一点波浪) 是阴影色; 阴影线柔和过渡
  float sh = smoothstep(-0.13, -0.03, p.y + 0.035 * sin(p.x * 11.0 + vSeed * 20.0));
  vec3 col = mix(uShade, uLight, sh);
  // 低仰角的云向天边色淡出
  col = mix(col, uHorizon, 0.45 * (1.0 - smoothstep(0.03, 0.3, vEl)));
  gl_FragColor = vec4(col * uComp, a * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ───────────────────────── 远山剪影 (远景层) ─────────────────────────
export const MOUNTAIN_VERT = /* glsl */ `
attribute float aH;
attribute float aLayer;
attribute float aLit;
varying float vH;
varying float vLayer;
varying float vLit;
void main() {
  vH = aH;
  vLayer = aLayer;
  vLit = aLit;
  gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(position, 1.0));
}
`;

export const MOUNTAIN_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uFar;
uniform vec3 uNear;
uniform vec3 uHorizon;
varying float vH;
varying float vLayer;
varying float vLit;
void main() {
  vec3 base = vLayer < 0.5 ? uFar : uNear;
  // 朝太阳一侧的山坡亮一阶 (柔和过渡), 背光坡暗一点
  vec3 col = mix(base * 0.93, mix(base, vec3(1.0), 0.12), smoothstep(0.35, 0.65, vLit));
  // 底部向天边色淡出 (远层更淡)
  float haze = (1.0 - smoothstep(0.0, 0.85, vH)) * (vLayer < 0.5 ? 0.7 : 0.5) + (vLayer < 0.5 ? 0.18 : 0.06);
  col = mix(col, uHorizon, clamp(haze, 0.0, 1.0));
  ${OUT}
}
`;

// ───────────────────────── 沙地 + 海 (同一张地面) ─────────────────────────
// 一张大平面 (y=0), 片元按岸线函数分成沙 / 海: 岸线 = shoreBase(x) (与 beach3dLayout.shoreLineZ 同一公式), 浪花来回冲刷 (swash)。
// 沙: 奶油色 + 大块亮部分色 + 断续的卡通沙纹 + 湿沙带。海: 浅水薄荷 → 松石 → 远海, 卡通短横波纹, 星形阳光闪光, 岸边浪花线与涌来的浪线。
export const GROUND_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const GROUND_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform float uTime;
uniform vec3 uSandBase;
uniform vec3 uSandShade;
uniform vec3 uSandLight;
uniform vec3 uSandWet;
uniform vec3 uShallow;
uniform vec3 uSeaMid;
uniform vec3 uSeaDeep;
uniform vec3 uSeaHorizon;
uniform vec3 uFoam;
uniform vec3 uSandHaze;
uniform float uShoreZ;
uniform float uShoreCurve;
uniform float uShoreWiggle;
uniform float uSwashAmp;
uniform float uSwashSpeed;
uniform float uFoamWidth;
uniform float uRipple;
uniform float uRippleDensity;
uniform float uGlint;
uniform float uGlintDensity;
uniform float uGlintSpeed;
uniform float uSandSpacing;
uniform float uSandRipple;
uniform float uHazeStart;
uniform float uHazeEnd;
uniform vec3 uSunDir;
varying vec3 vW;

float shoreBase(float x) {
  return uShoreZ - uShoreCurve * x * x + uShoreWiggle * sin(x * 0.21 + 1.3) + 0.35 * uShoreWiggle * sin(x * 0.57);
}

vec3 sandColor(vec2 q, float dist, float sb) {
  vec3 col = uSandBase;
  // 大块亮部色块 (插画式分色, 硬一点的边)
  float n1 = vnoise(q * 0.28 + 3.7);
  col = mix(col, uSandLight, smoothstep(0.56, 0.6, n1) * 0.75);
  // 卡通沙纹: 沿 x 起伏的断续弧线
  float r = (q.y + 0.32 * sin(q.x * 0.85 + q.y * 0.21) + 0.55 * vnoise(q * 0.45)) / uSandSpacing;
  float fr = fract(r);
  float dl = min(fr, 1.0 - fr);
  float fw = fwidth(r);
  float line = 1.0 - smoothstep(0.055, 0.055 + fw * 1.5 + 0.015, dl);
  float brk = smoothstep(0.38, 0.62, vnoise(vec2(q.x * 1.1 / uSandSpacing, floor(r) * 3.17)));
  float fade = (1.0 - smoothstep(9.0, 24.0, dist)) * (1.0 - smoothstep(0.18, 0.45, fw));
  col = mix(col, uSandShade, line * brk * fade * uSandRipple);
  // 零星小贝壳 / 碎石点 (只在近处)
  vec2 cell = floor(q * 4.0);
  float hc = hash12(cell);
  if (hc > 0.975 && dist < 9.0) {
    vec2 f = fract(q * 4.0) - 0.5 - (vec2(hash12(cell + 3.1), hash12(cell + 8.3)) - 0.5) * 0.5;
    float dot1 = 1.0 - smoothstep(0.06, 0.09, length(f));
    vec3 tint = hc > 0.99 ? vec3(1.0, 0.78, 0.82) : uSandShade;
    col = mix(col, tint, dot1 * 0.8 * (1.0 - smoothstep(5.0, 9.0, dist)));
  }
  // 湿沙带: 浪花冲到过的区域
  float wet = 1.0 - smoothstep(sb + uSwashAmp * 0.85, sb + uSwashAmp + 0.55, q.y);
  col = mix(col, uSandWet, wet * 0.8);
  return mix(col, uSandHaze, smoothstep(uHazeStart, uHazeEnd, dist) * 0.9);
}

vec3 seaColor(vec2 q, float dist, float d, float aa) {
  vec3 col = mix(uShallow, uSeaMid, smoothstep(0.2, 3.8, d));
  col = mix(col, uSeaDeep, smoothstep(6.0, 28.0, d));
  // 卡通波纹: 世界空间格子里的短横亮纹 (透视自然压扁), 缓慢横移、淡入淡出
  vec2 g = vec2(q.x / 2.3, q.y / 0.85);
  float row = floor(g.y);
  float hr = hash12(vec2(row, 4.7));
  g.x += uTime * 0.05 * (hr - 0.5) + hr * 7.0;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h1 = hash12(id);
  float h2 = hash12(id + 19.7);
  float on = step(h1, uRippleDensity) * (0.55 + 0.45 * sin(uTime * 0.7 + h2 * 40.0));
  float cx = 0.25 + 0.5 * h2;
  float len = 0.18 + 0.2 * h1;
  float ux = (f.x - cx) / len;
  float th = 0.075 * max(0.0, 1.0 - ux * ux);
  float fy = fwidth(g.y);
  float stroke = (1.0 - smoothstep(th, th + fy * 1.2 + 0.01, abs(f.y - 0.5 - 0.06 * sin(ux * 3.0)))) * step(abs(ux), 1.0);
  float rfade = smoothstep(0.9, 1.8, d) * (1.0 - smoothstep(28.0, 50.0, dist)) * (1.0 - smoothstep(0.25, 0.6, fy));
  col = mix(col, mix(col, uFoam, 0.75), stroke * on * rfade * uRipple);
  // 阳光闪光: 星形小亮点, 朝太阳一侧更多更亮
  vec2 gg = vec2(q.x / 1.25, q.y / 0.5);
  vec2 gid = floor(gg);
  vec2 gf = fract(gg) - 0.5;
  float k1 = hash12(gid + 41.0);
  float k2 = hash12(gid + 77.0);
  float side = clamp(0.55 + 0.45 * q.x * sign(uSunDir.x + 1e-4) / 22.0, 0.15, 1.0);
  float gate = step(1.0 - uGlintDensity * side, k1);
  float tw = 0.5 + 0.5 * sin(uTime * uGlintSpeed * (1.2 + 1.6 * k2) + k1 * 50.0);
  tw = tw * tw * tw;
  vec2 o = gf - (vec2(k2, k1) - 0.5) * 0.4;
  float star = max(1.0 - (abs(o.x) * 9.0 + abs(o.y) * 2.2), 0.0) + max(1.0 - (abs(o.x) * 2.6 + abs(o.y) * 7.5), 0.0);
  star = smoothstep(0.25, 0.75, star);
  float gfade = smoothstep(1.2, 2.5, d) * (1.0 - smoothstep(30.0, 55.0, dist));
  col = mix(col, vec3(1.0, 0.995, 0.95), clamp(star * tw * gate * gfade * uGlint, 0.0, 1.0));
  // 岸边浪花线 (随岸线来回) + 内侧细浪花
  float fn = vnoise(vec2(q.x * 1.4, uTime * 0.35));
  float fwid = uFoamWidth * (0.65 + 0.7 * fn);
  float foam = 1.0 - smoothstep(fwid - aa, fwid + aa, d);
  float lace = 1.0 - smoothstep(0.035, 0.035 + aa, abs(d - fwid - 0.22 - 0.1 * sin(q.x * 2.1 + uTime * 0.8)));
  // 从外海涌来的浪线 (一条白线向岸边推进, 到岸时并入浪花)
  float ph = fract(uTime * 0.06 + 0.15);
  float lw = (1.0 - ph) * 6.5 + 0.3;
  float wl = abs(d - lw - 0.3 * sin(q.x * 0.7 + 1.7));
  float wave = (1.0 - smoothstep(0.045, 0.045 + aa * 1.5, wl)) * smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.9, 1.0, ph));
  wave *= smoothstep(0.3, 0.7, vnoise(vec2(q.x * 0.35, floor(uTime * 0.06 + 0.15))));
  col = mix(col, uFoam, clamp(max(foam, max(lace * 0.75, wave * 0.8)), 0.0, 1.0));
  return mix(col, uSeaHorizon, smoothstep(uHazeStart, uHazeEnd, dist));
}

void main() {
  vec2 q = vW.xz;
  float dist = length(vW - cameraPosition);
  float sb = shoreBase(q.x);
  float sw = 0.5 + 0.5 * sin(uTime * uSwashSpeed + q.x * 0.11);
  sw = sw * sw * (3.0 - 2.0 * sw);
  float edge = sb + uSwashAmp * sw;   // 当前水边: z < edge 是水
  float aa = max(fwidth(q.y), 1e-3);
  float s = q.y - edge;
  vec3 col;
  if (s > aa * 1.5) {
    col = sandColor(q, dist, sb);
  } else if (s < -aa * 1.5) {
    col = seaColor(q, dist, -s, aa);
  } else {
    col = mix(seaColor(q, dist, max(-s, 0.0), aa), sandColor(q, dist, sb), smoothstep(-aa * 1.5, aa * 1.5, s));
  }
  ${OUT}
}
`;

// ───────────────────────── 棕榈 (树干 + 叶冠, 实例化) ─────────────────────────
export const PALM_VERT = /* glsl */ `
attribute float aPart;
attribute vec2 aLeaf;
uniform float uTime;
uniform float uSway;
varying vec3 vN;
varying vec3 vW;
varying vec2 vLeaf;
varying float vPart;
void main() {
  vec3 p = position;
  #ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
  #else
  mat4 im = mat4(1.0);
  #endif
  float ph = im[3][0] * 0.37 + im[3][2] * 0.53;
  if (aPart > 0.5 && aPart < 1.5) {
    float s = aLeaf.x;
    float w = s * s * uSway;
    p.y += sin(uTime * 1.4 + ph + s * 1.5) * w;
    p.x += sin(uTime * 0.9 + ph * 1.3) * w * 0.6;
    p.z += cos(uTime * 1.1 + ph) * w * 0.4;
  }
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
  vLeaf = aLeaf;
  vPart = aPart;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PALM_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uLeafLight;
uniform vec3 uLeafShade;
uniform vec3 uTrunkLight;
uniform vec3 uTrunkShade;
uniform vec3 uSunDir;
uniform vec3 uHaze;
uniform float uHazeStart;
uniform float uHazeEnd;
varying vec3 vN;
varying vec3 vW;
varying vec2 vLeaf;
varying float vPart;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float ndl = dot(n, uSunDir);
  vec3 col;
  if (vPart < 0.5) {
    float lit = smoothstep(-0.15, 0.2, ndl);
    vec3 base = mix(uTrunkShade, uTrunkLight, lit);
    // 环纹 (树干一节一节的横纹)
    float ring = smoothstep(0.6, 0.95, abs(fract(vLeaf.x * 15.0) - 0.5) * 2.0);
    col = mix(base, uTrunkShade * 0.86, ring * 0.6);
  } else if (vPart < 1.5) {
    float s = vLeaf.x;
    float au = abs(vLeaf.y);
    // 羽状小叶: 斜向缺口把叶面切成一排小叶, 外缘按小叶周期内凹成锯齿
    float k = fract(s * 16.0 - au * 1.3);
    if (s > 0.1 && au > 0.16 && k < 0.2) discard;
    if (au > 1.0 - 0.38 * k) discard;
    // 叶片两面都按法线算两阶明暗 (背面略暗)
    float lit = smoothstep(-0.05, 0.3, ndl) * (gl_FrontFacing ? 1.0 : 0.75);
    vec3 base = mix(uLeafShade, uLeafLight, lit);
    base = mix(base, mix(uLeafLight, vec3(0.95, 1.0, 0.6), 0.25), smoothstep(0.55, 1.0, s) * 0.35 * lit);
    base = mix(base, uLeafShade * 0.85, (1.0 - smoothstep(0.04, 0.09, au)) * 0.45);
    col = base;
  } else {
    float lit = smoothstep(-0.1, 0.35, ndl);
    col = mix(vec3(0.33, 0.42, 0.12), vec3(0.62, 0.68, 0.26), lit);
  }
  float dist = length(vW - cameraPosition);
  col = mix(col, uHaze, smoothstep(uHazeStart, uHazeEnd, dist) * 0.85);
  ${OUT}
}
`;

// ───────────────────────── 草丛 (实例化交叉面片) ─────────────────────────
export const GRASS_VERT = /* glsl */ `
attribute vec2 aSeed; // x 随机种子, y 是否开花
uniform float uTime;
uniform float uSway;
varying vec2 vUv;
varying float vSeed;
varying float vFlower;
varying vec3 vW;
void main() {
  vec3 p = position;
  #ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
  #else
  mat4 im = mat4(1.0);
  #endif
  float ph = im[3][0] * 0.71 + im[3][2] * 0.43;
  p.x += sin(uTime * 1.7 + ph) * uSway * 0.7 * uv.y * uv.y;
  p.z += cos(uTime * 1.3 + ph) * uSway * 0.4 * uv.y * uv.y;
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  vW = wp.xyz;
  vUv = uv;
  vSeed = aSeed.x;
  vFlower = aSeed.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const GRASS_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uGrassLight;
uniform vec3 uGrassShade;
uniform vec3 uFlower;
uniform vec3 uHaze;
uniform float uHazeStart;
uniform float uHazeEnd;
varying vec2 vUv;
varying float vSeed;
varying float vFlower;
varying vec3 vW;
void main() {
  float tip = -1.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float h1 = hash12(vec2(fi, vSeed * 37.1));
    float h2 = hash12(vec2(fi + 13.0, vSeed * 11.3));
    float bx = 0.1 + 0.8 * (fi + h1 * 0.8) / 9.0;
    float bh = 0.45 + 0.55 * h2;
    float lean = (h1 - 0.5) * 0.55 + (bx - 0.5) * 0.35;
    float v = vUv.y / bh;
    if (v > 1.0) continue;
    float cx = bx + lean * v * v;
    float w = 0.06 * (1.0 - v);
    if (abs(vUv.x - cx) < w) tip = max(tip, v * bh);
  }
  vec3 col;
  float fl = 0.0;
  if (vFlower > 0.5) {
    for (int j = 0; j < 2; j++) {
      float fj = float(j);
      vec2 c = vec2(0.3 + 0.38 * fj + 0.1 * (hash12(vec2(fj, vSeed)) - 0.5), 0.5 + 0.14 * hash12(vec2(fj + 3.0, vSeed)));
      float r = length((vUv - c) * vec2(1.0, 1.15));
      fl = max(fl, 1.0 - smoothstep(0.055, 0.07, r));
      fl = max(fl, 2.0 * (1.0 - smoothstep(0.018, 0.028, r)));
    }
  }
  if (tip < 0.0 && fl <= 0.0) discard;
  col = mix(uGrassShade, uGrassLight, smoothstep(0.05, 0.75, tip));
  col *= 0.94 + 0.12 * hash12(vec2(vSeed, 2.0));
  if (fl > 0.0) col = fl > 1.0 ? vec3(1.0, 0.95, 0.7) : uFlower;
  float dist = length(vW - cameraPosition);
  col = mix(col, uHaze, smoothstep(uHazeStart, uHazeEnd, dist) * 0.85);
  ${OUT}
}
`;

// ───────────────────────── 花瓣 (世界空间 GPU 粒子) ─────────────────────────
export const PETAL_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uSpeed;
uniform float uSize;
uniform float uPxPerUnit; // 绘制缓冲高度 / 2 (像素)
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uPal[4];
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
void main() {
  float spd = (0.12 + 0.1 * aSeed.z) * uSpeed;
  float y = uBoxSize.y - mod(aSeed.x * uBoxSize.y + uTime * spd, uBoxSize.y);
  vec3 p = uBoxMin + vec3(aSeed.y * uBoxSize.x, y, aSeed.w * uBoxSize.z);
  p.x += sin(uTime * (0.5 + 0.6 * aSeed.z) + aSeed.w * 6.2831) * 0.35 + uTime * 0.03;
  p.x = uBoxMin.x + mod(p.x - uBoxMin.x, uBoxSize.x);
  p.z += cos(uTime * 0.4 + aSeed.x * 6.2831) * 0.2;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = (0.05 + 0.03 * aSeed.z) * uSize * projectionMatrix[1][1] * uPxPerUnit / max(0.1, -mv.z);
  gl_PointSize = clamp(px, 1.0, 64.0);
  int ci = int(floor(fract(aSeed.w * 4.7) * 4.0));
  vec3 c = uPal[0];
  if (ci == 1) c = uPal[1]; else if (ci == 2) c = uPal[2]; else if (ci == 3) c = uPal[3];
  vColor = c;
  float yn = y / uBoxSize.y;
  vAlpha = uOpacity * smoothstep(0.0, 0.08, yn) * (1.0 - smoothstep(0.9, 1.0, yn));
  vRot = aSeed.w * 6.2831 + uTime * (0.4 + 0.5 * aSeed.z) * (aSeed.y > 0.5 ? 1.0 : -1.0);
}
`;

export const PETAL_FRAG = /* glsl */ `
precision highp float;
uniform float uComp;
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  vec2 q = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
  float u = q.x / 0.46;
  float w = q.y / (0.27 * (1.0 + 0.55 * q.x));
  float a = 1.0 - smoothstep(0.62, 1.0, u * u + w * w);
  vec3 col = mix(vColor, vec3(1.0), 0.4 * smoothstep(0.2, -0.45, q.x));
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * uComp, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
