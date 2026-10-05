/**
 * beach3dShaders.ts — 海滩 3D 场景的全部着色器 (GLSL, 用于 THREE.ShaderMaterial)。
 *
 * 风格: 二次元 MMD 舞台 —— 3D 卡通着色 (柔和的两~三阶明暗) + 高调日光 + 轻微 Bloom, 没有写实质感 / 环境贴图 (沙地只有很淡的卡通颗粒)。
 * 共同约定:
 *   - 颜色 uniform 都是线性空间 (THREE.Color 已按 ColorManagement 转好), 输出前乘 uComp (= 1 / 曝光), 抵消线性色调映射的曝光,
 *     画面上的颜色 = 配置里的 sRGB 色值。
 *   - 输出 alpha = uMark: 走后期 (渲染到 composer 目标) 时为 0.99, Bloom 高通据此跳过背景像素 (与 beach 场景同一约定, 见 postFxPipeline.ts);
 *     直出屏幕时为 1。
 *   - 空气透视: 远处向海平线色淡出 (uHazeStart → uHazeEnd), 让远景与天空 / 海平线无缝。
 *   - 地平线弧度: 离相机 uCurveD0 米以外的地面按 e²/(2R) 往下弯 (夸张的"地球曲率"), 真实的可见海平线因此落在眼高以下
 *     (默认机位约低 2.5°, 全身镜头里海平线在胯部附近, 与参考图一致); 天空 / 远山 / 云按同一个下沉角 uDip 对齐, 远处无缝。
 *     角色附近 (uCurveD0 以内) 完全平, 脚下沙地 / 落影不受影响。
 *   - 高光 (浪花 / 闪光) 输出 alpha=1 参与轻微 Bloom, 其余背景像素打 0.99 标记不进 Bloom (避免整片沙滩发白)。
 */

const COMMON = /* glsl */ `
uniform float uComp;
uniform float uMark;
uniform float uCurveR;
uniform float uCurveD0;
float curveDrop(vec3 wp) {
  float e = max(0.0, length(wp.xz - cameraPosition.xz) - uCurveD0);
  return e * e / (2.0 * uCurveR);
}
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
uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uSeaHorizon;
uniform vec3 uSeaDeep;
uniform vec3 uSunDir;
uniform float uSunGlow;
uniform float uCirrus;      // 高空浅云强度
uniform float uHorizonBand; // 地平线亮带强度
uniform float uDipSin;  // 可见海平线的下沉角 sin (见文件头"地平线弧度")
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y + uDipSin;
  vec3 col;
  if (h >= 0.0) {
    col = mix(uHorizon, uMid, smoothstep(0.0, 0.28, h));
    col = mix(col, uZenith, smoothstep(0.22, 0.95, h));
    // 高空浅云 (卷云): 视线投到天穹平面上取拉长的噪声 → 斜向的柔和白丝带, 缓慢漂移; 只在中高仰角
    vec2 sp = d.xz / (h + 0.12);
    sp = mat2(0.87, -0.5, 0.5, 0.87) * sp;
    float cn = vnoise(sp * vec2(0.5, 2.4) + vec2(uTime * 0.004, 0.0)) * 0.6 + vnoise(sp * vec2(1.3, 5.0) + vec2(7.0, uTime * 0.003)) * 0.4;
    float ci = smoothstep(0.58, 0.82, cn) * smoothstep(0.08, 0.3, h) * (1.0 - smoothstep(0.7, 1.0, h));
    col = mix(col, mix(uMid, vec3(1.0), 0.85), ci * uCirrus);
    // 地平线附近的亮带 (天边泛白, 比海平线那条细线宽得多, 柔和过渡)
    col = mix(col, mix(uHorizon, vec3(1.0, 0.99, 0.96), 0.65), (1.0 - smoothstep(0.0, 0.1, h)) * uHorizonBand);
    float s = max(dot(d, uSunDir), 0.0);
    col = mix(col, vec3(1.0, 0.985, 0.94), clamp(uSunGlow * (0.55 * pow(s, 4.0) + 1.2 * pow(s, 40.0)), 0.0, 1.0));
    // 海平线上一条极细的亮线 (赛璐璐背景常见的"天边白")
    col = mix(col, vec3(1.0), 0.45 * (1.0 - smoothstep(0.0, 0.012, h)));
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
uniform float uDipTan;
varying vec2 vUv;
varying float vSeed;
varying float vEl;
void main() {
  float az = aCloud.x + uTime * uDrift;
  float el = aCloud.y;
  vec3 c = uRadius * vec3(cos(el) * sin(az), sin(el), -cos(el) * cos(az));
  c.y -= uDipTan * length(c.xz);
  vec3 fwd = normalize(-c);                                   // 云 → 相机
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));    // 正面朝相机 (右手系)
  vec3 up = cross(fwd, right);
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
uniform vec2 uSunScreen;  // 太阳在云面片平面内的大致方向 (x: 右为正, y: 上为正)
varying vec2 vUv;
varying float vSeed;
varying float vEl;
void main() {
  vec2 p = (vUv - 0.5) * vec2(2.17, 1.0);
  // 积云 = 7 个球 (中间高两边低, 上排 2 个小球叠出蓬松顶) 的并集 + 平底; 每个像素取所在球的伪法线做卡通体积明暗
  float d = 1e3;
  vec3 nrm = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float h1 = hash12(vec2(fi, vSeed * 91.7));
    float h2 = hash12(vec2(fi + 7.0, vSeed * 53.1));
    vec2 c;
    float r;
    if (i < 5) {
      float bump = 1.0 - abs(fi - 2.0) / 2.0;
      r = 0.16 + 0.16 * bump + 0.06 * h2;
      c = vec2(-0.72 + fi * 0.36 + (h1 - 0.5) * 0.12, -0.21 + r * 0.6 + 0.03 * h1);
    } else {
      r = 0.15 + 0.06 * h2;
      c = vec2((fi - 5.5) * 0.42 + (h1 - 0.5) * 0.15, 0.1 + 0.06 * h1);
    }
    vec2 q = p - c;
    float di = length(q) - r;
    if (di < d) {
      d = di;
      vec2 qn = q / r;
      nrm = vec3(qn, sqrt(max(0.0, 1.0 - dot(qn, qn))));
    }
  }
  d = max(d, -(p.y + 0.21));                          // 平底
  float aa = fwidth(d) * 1.2 + 1e-4;
  float a = 1.0 - smoothstep(-aa, aa, d);
  if (a < 0.01) discard;
  // 卡通体积: 伪法线 · 光 → 三阶 (亮 / 中 / 底部阴影), 交界柔和
  vec3 L = normalize(vec3(uSunScreen, 0.75));
  float ndl = dot(normalize(nrm + vec3(0.0, 0.25, 0.0)), L);
  float tone = smoothstep(-0.05, 0.2, ndl) * 0.55 + smoothstep(0.45, 0.6, ndl) * 0.45;
  tone *= smoothstep(-0.2, -0.06, p.y);               // 平底一圈总是阴影色
  vec3 col = mix(uShade, uLight, tone);
  col = mix(col, uLight, 0.25 * (1.0 - smoothstep(0.0, 0.04, -d)) * step(0.0, p.y));  // 顶部轮廓一圈亮边
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
uniform float uDipTan;
varying float vH;
varying float vLayer;
varying float vLit;
void main() {
  vH = aH;
  vLayer = aLayer;
  vLit = aLit;
  vec3 p = position;
  p.y -= uDipTan * length(p.xz);  // 坐在下沉后的可见海平线上
  gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(p, 1.0));
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
// 沙: 远近明暗 + 柔和色斑 + 细颗粒 + 少量不规则沙纹 + 湿沙带 (深、反光)。海: 清透浅水 (看得见沙 + 焦散) → 松石 → 远海, 卡通波纹, 闪光,
// 近岸三道推进的浪峰, 以及推上沙滩再退回的冲刷浪 (白浪头 + 泡沫纹 + 退潮留下的细泡沫线)。
export const GROUND_VERT = /* glsl */ `
uniform float uCurveR;
uniform float uCurveD0;
varying vec3 vW;
varying vec2 vL;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vL = position.xz; // 相对角色的坐标 (岸线 / 礁石 / 纹理都按它算)
  float e = max(0.0, length(wp.xz - cameraPosition.xz) - uCurveD0);
  wp.y -= e * e / (2.0 * uCurveR);
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
uniform vec3 uSkyRefl;
uniform float uShoreZ;
uniform float uShoreCurve;
uniform float uShoreWiggle;
uniform float uSwashAmp;
uniform float uSwashSpeed;
uniform float uFoamWidth;
uniform float uWaves;
uniform float uRipple;
uniform float uRippleDensity;
uniform float uGlint;
uniform float uGlintDensity;
uniform float uGlintSpeed;
uniform float uSandSpacing;
uniform float uSandRipple;
uniform float uSandGrain;
uniform float uHazeStart;
uniform float uHazeEnd;
uniform vec3 uSunDir;
uniform vec4 uRocks[ROCK_MAX]; // 水中礁石: xz 中心, z 半径, w 有效 (1/0) —— 画一圈白浪
varying vec3 vW;
varying vec2 vL;
float gHi = 0.0; // 本像素的高光量 (浪花 / 闪光), 用于 Bloom 标记

float shoreBase(float x) {
  return uShoreZ - uShoreCurve * x * x + uShoreWiggle * sin(x * 0.21 + 1.3) + 0.35 * uShoreWiggle * sin(x * 0.57);
}

// 卡通冲刷浪的进退曲线 (p = 周期相位 0..1): 前 38% 快速推上沙滩 (ease-out), 之后慢慢退回 (smoothstep)
float swashCurve(float p) {
  if (p < 0.38) { float u = p / 0.38; return 1.0 - (1.0 - u) * (1.0 - u); }
  float u = (p - 0.38) / 0.62;
  return 1.0 - u * u * (3.0 - 2.0 * u);
}

// 沙地: 远近明暗 + 柔和大色斑 + 细颗粒 + 少量不规则沙纹 (明暗起伏, 不是线) + 湿沙带 (更深、反光)
vec3 sandColor(vec2 q, float dist, float top) {
  vec3 col = mix(uSandBase * vec3(0.965, 0.95, 0.93), uSandBase, smoothstep(1.0, 7.0, dist));
  col = mix(col, uSandLight, smoothstep(8.0, 30.0, dist) * 0.45);
  float n = vnoise(q * 0.32 + 3.7) * 0.65 + vnoise(q * 1.1 - 1.3) * 0.35;
  col = mix(col, uSandShade, smoothstep(0.55, 0.82, n) * 0.32);
  col = mix(col, uSandLight, (1.0 - smoothstep(0.2, 0.42, n)) * 0.45);
  // 细颗粒: 两层平滑噪声 (不是像素方块), 按屏幕导数淡出, 远处不闪
  float gfade = (1.0 - smoothstep(0.3, 0.9, length(fwidth(q * 38.0)))) * uSandGrain;
  float g1 = vnoise(q * 38.0);
  float g2 = vnoise(q * 13.0 + 4.1);
  col *= 1.0 + ((g1 - 0.5) * 0.07 + (g2 - 0.5) * 0.06) * gfade;
  // 零星的浅色小圆粒 (柔和圆点, 很淡)
  vec2 gc = floor(q * 16.0);
  float gh = hash12(gc + 0.71);
  vec2 gp = fract(q * 16.0) - 0.5 - (vec2(hash12(gc + 2.3), hash12(gc + 5.9)) - 0.5) * 0.6;
  float gd = 1.0 - smoothstep(0.08, 0.16, length(gp));
  col = mix(col, mix(col, vec3(1.0, 0.98, 0.93), 0.45), step(0.9, gh) * gd * gfade);
  // 不规则沙纹: 只在噪声圈出的几块区域, 迎光坡亮 / 背光坡暗的柔和起伏
  float patchM = smoothstep(0.6, 0.78, vnoise(q * 0.15 + 11.0));
  float r = (q.y + 0.55 * sin(q.x * 0.55 + q.y * 0.3) + 1.3 * vnoise(q * 0.45) + 0.35 * vnoise(q * 1.3)) / uSandSpacing;
  float rfade = (1.0 - smoothstep(0.25, 0.6, fwidth(r))) * (1.0 - smoothstep(10.0, 22.0, dist));
  float wv = sin(r * 6.2831);
  float rip = patchM * rfade * uSandRipple;
  col = mix(col, uSandLight, smoothstep(0.5, 0.95, wv) * rip * 0.5);
  col = mix(col, uSandShade, smoothstep(-0.2, -0.9, wv) * rip * 0.45);
  // 零星小贝壳 (只在近处)
  vec2 cell = floor(q * 3.0);
  float hc = hash12(cell + 0.37);
  if (hc > 0.982 && dist < 8.0) {
    vec2 f = fract(q * 3.0) - 0.5 - (vec2(hash12(cell + 3.1), hash12(cell + 8.3)) - 0.5) * 0.5;
    float dot1 = 1.0 - smoothstep(0.045, 0.07, length(f * vec2(1.0, 1.4)));
    vec3 tint = hc > 0.993 ? vec3(1.0, 0.8, 0.84) : vec3(1.0, 0.97, 0.92);
    col = mix(col, tint, dot1 * 0.85 * (1.0 - smoothstep(4.0, 8.0, dist)));
  }
  // 湿沙: 浪推到过的区域 (top 以下) 更深, 往上逐渐变干; 湿面反射天空 (掠射更亮) + 太阳的柔和高光
  float wet = 1.0 - smoothstep(top - 0.05, top + 0.65, q.y);
  col = mix(col, uSandWet, wet * 0.85);
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
  col = mix(col, uSkyRefl, wet * (0.1 + 0.3 * fres));
  vec3 R = reflect(-uSunDir, vec3(0.0, 1.0, 0.0));
  col = mix(col, vec3(1.0, 0.99, 0.94), smoothstep(0.85, 0.98, dot(R, V)) * wet * 0.3);
  return col;
}

// 海: ds = 静态水深坐标 (岸线 sb 往海里为正; 沙坡上的浪膜为负), d = 到当前 (冲刷中的) 水边的距离
vec3 seaColor(vec2 q, float dist, float ds, float d, float aa, float rising, vec3 sandUnder) {
  float dd = max(ds, 0.0);
  vec3 col = mix(uShallow, uSeaMid, smoothstep(0.3, 4.5, dd));
  col = mix(col, uSeaDeep, smoothstep(6.0, 28.0, dd));
  // 清透: 越浅越能看到水下的沙
  col = mix(mix(sandUnder, uShallow, 0.5), col, smoothstep(-0.3, 1.6, ds));
  // 浅水卡通焦散: 噪声等值线 → 细亮网纹
  float cn = vnoise(q * 2.0 + vec2(uTime * 0.22, -uTime * 0.16)) * 0.65 + vnoise(q * 4.3 - uTime * 0.18) * 0.35;
  float cw = fwidth(cn);
  float caus = (1.0 - smoothstep(0.0, cw * 1.2 + 0.022, abs(cn - 0.62))) * (1.0 - smoothstep(0.25, 0.6, cw * 10.0));
  col = mix(col, vec3(1.0), caus * 0.32 * (1.0 - smoothstep(0.8, 3.2, ds)));
  // 卡通波纹: 世界空间格子里的短横亮纹, 近岸更密更清楚
  vec2 g = vec2(q.x / 2.1, q.y / 0.8);
  float row = floor(g.y);
  float hr = hash12(vec2(row, 4.7));
  g.x += uTime * 0.05 * (hr - 0.5) + hr * 7.0;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h1 = hash12(id);
  float h2 = hash12(id + 19.7);
  float dens = uRippleDensity * (1.0 + 0.5 * (1.0 - smoothstep(1.5, 6.0, ds)));
  float on = step(h1, dens) * (0.55 + 0.45 * sin(uTime * 0.7 + h2 * 40.0));
  float cx = 0.25 + 0.5 * h2;
  float len = 0.18 + 0.2 * h1;
  float ux = (f.x - cx) / len;
  float th = 0.075 * max(0.0, 1.0 - ux * ux);
  float fy = fwidth(g.y);
  float stroke = (1.0 - smoothstep(th, th + fy * 1.2 + 0.01, abs(f.y - 0.5 - 0.06 * sin(ux * 3.0)))) * step(abs(ux), 1.0);
  float rfade = smoothstep(0.6, 1.4, ds) * (1.0 - smoothstep(28.0, 50.0, dist)) * (1.0 - smoothstep(0.25, 0.6, fy));
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
  float gfade = smoothstep(1.5, 3.0, ds) * (1.0 - smoothstep(30.0, 55.0, dist));
  float gl = clamp(star * tw * gate * gfade * uGlint, 0.0, 1.0);
  col = mix(col, vec3(1.0, 0.995, 0.95), gl);
  gHi = max(gHi, gl);
  // 近岸浪峰: 3 道浪从外海推向岸边; 浪峰白线 (断续、越近岸越粗) + 浪前一条浅亮水 + 浪后深一档, 到岸并入冲刷浪
  float fm = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float cyc = uTime * 0.075 + fi / 3.0;
    float ph = fract(cyc);
    float c = (1.0 - ph) * 7.5 + 0.35 + 0.25 * sin(q.x * 0.45 + fi * 2.0);
    float x = ds - c;
    float fade = smoothstep(0.0, 0.18, ph) * (1.0 - smoothstep(0.88, 1.0, ph)) * uWaves;
    float brk = smoothstep(0.28, 0.55, vnoise(vec2(q.x * 0.45 + fi * 13.0, floor(cyc) * 7.0)));
    float wdt = 0.05 + 0.13 * ph * ph;
    float crest = 1.0 - smoothstep(wdt, wdt + aa * 1.5, abs(x + 0.05 * sin(q.x * 2.7 + uTime * 0.9)));
    float back = smoothstep(0.0, 0.1, x) * (1.0 - smoothstep(0.25, 1.1, x));
    float front = smoothstep(0.0, -0.08, x) * (1.0 - smoothstep(-0.08, -0.6, x));
    col = mix(col, col * vec3(0.86, 0.93, 0.97), back * fade * 0.6);
    col = mix(col, mix(col, vec3(1.0), 0.3), front * fade * brk * 0.7);
    fm = max(fm, crest * fade * brk);
  }
  // 冲刷浪头: 推上来时又厚又白 (扇贝形边已算进 d), 里面有几个透出水色的泡沫洞; 后面拖着细碎的泡沫纹
  float fw = uFoamWidth * (0.65 + 0.5 * rising);
  float head = 1.0 - smoothstep(fw - aa, fw + aa, d);
  float holes = smoothstep(0.62, 0.7, vnoise(q * vec2(3.5, 6.0) + vec2(uTime * 0.2, 0.0))) * smoothstep(fw * 0.35, fw * 0.6, d);
  head *= 1.0 - holes * 0.55;
  float lace = 1.0 - smoothstep(0.0, 0.035 + aa, abs(vnoise(q * vec2(2.2, 3.6) + vec2(0.0, uTime * 0.25)) - 0.5));
  lace *= (1.0 - smoothstep(fw, fw * 3.2, d)) * smoothstep(fw * 0.8, fw * 1.1, d) * 0.8;
  // 礁石周围的一圈白浪
  float ring = 0.0;
  for (int i = 0; i < ROCK_MAX; i++) {
    vec4 r = uRocks[i];
    if (r.w < 0.5) continue;
    float rd = length((q - r.xy) * vec2(1.0, 1.15)) - r.z;
    float rw = 0.12 + 0.06 * sin(uTime * 1.6 + float(i) * 2.3 + atan(q.y - r.y, q.x - r.x) * 3.0);
    ring = max(ring, 1.0 - smoothstep(rw - aa, rw + aa, abs(rd - 0.02)));
  }
  fm = clamp(max(max(fm, head), max(ring * 0.9, lace)), 0.0, 1.0);
  col = mix(col, uFoam, fm);
  gHi = max(gHi, fm * 0.6);
  return col;
}

void main() {
  vec2 q = vL;
  float dist = length(vW - cameraPosition);
  float sb = shoreBase(q.x);
  // 冲刷浪: 周期 2π/uSwashSpeed 秒, 沿岸略有相位差 (浪头不是一条直线)
  float p = fract(uTime * uSwashSpeed * 0.159155 + 0.03 * sin(q.x * 0.13) + 0.02 * sin(q.x * 0.41));
  float sw = swashCurve(p);
  float rising = 1.0 - smoothstep(0.3, 0.5, p);
  float scal = 0.09 * abs(sin(q.x * 2.3 + 2.0 * vnoise(vec2(q.x * 0.6, 1.7)))); // 扇贝形浪边
  float lo = sb - 0.3;                     // 浪退到最低处
  float reach = uSwashAmp * 1.35;          // 推上沙滩的最大距离
  float top = lo + reach + 0.09;           // 湿沙上沿
  float edge = lo + reach * sw + scal * (0.3 + 0.7 * sw);
  float aa = max(fwidth(q.y), 1e-3);
  float s = q.y - edge;   // > 0 = 沙地
  float ds = sb - q.y;
  vec3 sand = sandColor(q, dist, top);
  // 退潮时在最高处留下一条渐淡的细泡沫线
  float resid = (1.0 - smoothstep(0.4, 0.95, p)) * smoothstep(0.38, 0.45, p);
  float rl = 1.0 - smoothstep(0.018, 0.018 + aa * 1.5, abs(q.y - (lo + reach + scal) - 0.03 * sin(q.x * 5.0)));
  rl *= smoothstep(0.35, 0.55, vnoise(vec2(q.x * 1.3, 5.0)));
  vec3 col;
  if (s > aa * 1.5) {
    col = mix(sand, uFoam, rl * resid * 0.75 * step(0.0, q.y - edge - 0.05));
  } else {
    vec3 sea = seaColor(q, dist, ds, max(-s, 0.0), aa, rising, sand);
    col = mix(sea, sand, smoothstep(-aa * 1.5, aa * 1.5, s));
  }
  vec3 haze = ds > 0.0 ? uSeaHorizon : uSandHaze;
  col = mix(col, haze, smoothstep(uHazeStart, uHazeEnd, dist) * (ds > 0.0 ? 0.85 : 0.9));
  gl_FragColor = vec4(col * uComp, uMark < 0.999 ? mix(uMark, 1.0, step(0.35, gHi)) : 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ───────────────────────── 棕榈 (树干 + 叶冠, 实例化) ─────────────────────────
export const PALM_VERT = /* glsl */ `
${COMMON}
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
  if ((aPart > 0.5 && aPart < 1.5) || aPart > 2.5) {
    // 整片叶随风上下 / 左右摆 (越靠叶尖越大) + 小叶自己轻微抖动
    float s = aLeaf.x;
    float w = s * s * uSway;
    p.y += sin(uTime * 1.4 + ph + s * 1.5) * w;
    p.x += sin(uTime * 0.9 + ph * 1.3) * w * 0.6;
    p.z += cos(uTime * 1.1 + ph) * w * 0.4;
    p.y += sin(uTime * 2.6 + ph * 2.0 + s * 9.0) * uSway * 0.18 * aLeaf.y;
  }
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  wp.y -= curveDrop(wp.xyz);
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
    // 树干: 卡通分节 —— 每节是下窄上宽的鼓包 (节的上半部法线朝上 → 更亮), 节缝处一道柔和的暗槽; 节缝略倾斜、不等距
    float t = vLeaf.x;
    float sg = t * 15.0;
    sg += 0.1 * sin(vLeaf.y * 6.2831 + floor(sg) * 2.3) + 0.12 * sin(t * 23.0);
    float u = fract(sg);
    float fw = fwidth(sg);
    vec3 n2 = normalize(n + vec3(0.0, (u - 0.35) * 0.9, 0.0));
    float lit = smoothstep(-0.35, 0.5, dot(n2, uSunDir));
    col = mix(uTrunkShade, uTrunkLight, lit);
    float seam = 1.0 - smoothstep(0.0, 0.12 + fw * 1.5, u);
    col = mix(col, uTrunkShade * 0.86, seam * 0.45 * (1.0 - smoothstep(0.6, 1.2, fw)));
    col = mix(col, uTrunkLight * 1.06, smoothstep(0.55, 0.92, u) * 0.3 * lit);
    col = mix(col, uTrunkShade * 0.88, smoothstep(0.88, 1.0, t) * 0.55);                          // 叶冠下的阴影
    col = mix(col, mix(col, vec3(0.94, 0.86, 0.72), 0.45), 1.0 - smoothstep(0.0, 0.05, t));     // 根部沾沙
  } else if (vPart < 1.5 || vPart > 2.5) {
    // 叶片: 卡通渐变 —— 叶根深、叶尖亮 (沿整片叶 s 与沿小叶 t 两个方向), 冷色暗部, 两阶柔和明暗
    float s = vLeaf.x;
    float lt = vLeaf.y;
    vec3 base = mix(uLeafShade, uLeafLight, smoothstep(0.05, 0.95, s * 0.55 + lt * 0.55));
    base = mix(base, mix(uLeafLight, vec3(0.93, 1.0, 0.56), 0.35), smoothstep(0.7, 1.0, lt) * 0.45);
    if (vPart > 2.5) base = mix(uLeafShade, vec3(0.66, 0.7, 0.32), 0.45 + 0.3 * s); // 叶轴偏黄绿
    float lit = smoothstep(-0.12, 0.3, ndl);
    col = mix(base * vec3(0.66, 0.77, 0.85), base, lit) * (gl_FrontFacing ? 1.0 : 0.9);
  } else {
    float lit = smoothstep(-0.1, 0.35, ndl);
    col = mix(vec3(0.33, 0.42, 0.12), vec3(0.64, 0.7, 0.28), lit);
  }
  float dist = length(vW - cameraPosition);
  col = mix(col, uHaze, smoothstep(uHazeStart, uHazeEnd, dist) * 0.85);
  ${OUT}
}
`;

// ───────────────────────── 草丛 (实例化交叉面片) ─────────────────────────
export const GRASS_VERT = /* glsl */ `
${COMMON}
attribute vec2 aSeed;   // 实例: x 随机种子, y 是否开花
attribute float aGPart; // 0 草叶, 1 花瓣, 2 花心
attribute float aBlade; // 每根草叶的随机数
uniform float uTime;
uniform float uSway;
varying vec2 vUv;
varying float vGPart;
varying float vBlade;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 p = position;
  #ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
  #else
  mat4 im = mat4(1.0);
  #endif
  if (aGPart > 0.5 && aSeed.y < 0.5) p = vec3(0.0); // 不开花的实例: 花退化成一个点
  float ph = im[3][0] * 0.71 + im[3][2] * 0.43 + aBlade * 2.0;
  float hh = p.y * p.y;
  p.x += sin(uTime * 1.7 + ph) * uSway * 0.6 * hh;
  p.z += cos(uTime * 1.3 + ph) * uSway * 0.4 * hh;
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  wp.y -= curveDrop(wp.xyz);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
  vUv = uv;
  vGPart = aGPart;
  vBlade = aBlade + aSeed.x * 0.3;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const GRASS_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uGrassLight;
uniform vec3 uGrassShade;
uniform vec3 uFlower;
uniform vec3 uSunDir;
uniform vec3 uHaze;
uniform float uHazeStart;
uniform float uHazeEnd;
varying vec2 vUv;
varying float vGPart;
varying float vBlade;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  float lit = smoothstep(-0.4, 0.55, dot(n, uSunDir));
  vec3 col;
  if (vGPart < 0.5) {
    // 圆头草叶: 叶尖 15% 裁成半椭圆 (不是尖刺)
    float tv = (vUv.y - 0.82) / 0.18;
    if (tv > 0.0 && abs(vUv.x) > sqrt(max(0.0, 1.0 - tv * tv))) discard;
    // 草叶: 根深尖亮的渐变 + 每根色相微差 + 球形法线的柔和明暗 + 根部接触阴影
    float h = vUv.y;
    vec3 base = mix(uGrassShade, uGrassLight, smoothstep(0.0, 0.85, h));
    base *= 0.93 + 0.14 * fract(vBlade);
    base = mix(base, mix(uGrassLight, vec3(0.95, 1.0, 0.62), 0.3), smoothstep(0.75, 1.0, h) * 0.5);
    col = mix(base * vec3(0.76, 0.85, 0.88), base, lit);
    col *= mix(0.8, 1.0, smoothstep(0.0, 0.3, h));
    col = mix(col, col * 0.9, smoothstep(0.7, 1.0, abs(vUv.x)) * 0.5); // 叶缘略暗, 叶片有中脊感
  } else if (vGPart < 1.5) {
    col = mix(uFlower, vec3(1.0), smoothstep(0.55, 1.0, vUv.x) * 0.4);
    col = mix(col * 0.86, col, lit);
  } else {
    col = vec3(1.0, 0.86, 0.45);
  }
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
  gl_PointSize = clamp(px, 1.0, 22.0 * uSize * uPxPerUnit / 540.0);
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

// ───────────────────────── 礁石 (实例化低模, 卡通三阶明暗) ─────────────────────────
export const ROCK_VERT = /* glsl */ `
${COMMON}
varying vec3 vN;
varying vec3 vW;
varying float vY;
void main() {
  #ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
  #else
  mat4 im = mat4(1.0);
  #endif
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  vY = wp.y;
  wp.y -= curveDrop(wp.xyz);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ROCK_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uRockLight;
uniform vec3 uRockShade;
uniform vec3 uSunDir;
uniform vec3 uHaze;
uniform float uHazeStart;
uniform float uHazeEnd;
varying vec3 vN;
varying vec3 vW;
varying float vY;
void main() {
  vec3 n = normalize(vN);
  float ndl = dot(n, uSunDir);
  // 三阶卡通 ramp (暗 / 中 / 亮), 交界柔和
  float t = smoothstep(-0.25, 0.1, ndl) * 0.55 + smoothstep(0.35, 0.6, ndl) * 0.45;
  vec3 col = mix(uRockShade, uRockLight, t);
  // 圆顶受光高光 (柔和一块)
  col = mix(col, mix(uRockLight, vec3(1.0), 0.45), smoothstep(0.6, 0.92, n.y) * smoothstep(0.15, 0.6, ndl) * 0.5);
  // 背光侧边缘一圈淡淡的天光 (卡通 rim)
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col = mix(col, vec3(0.86, 0.93, 1.0), rim * 0.3 * (1.0 - t));
  // 很淡的斑驳, 不是一块纯色
  col *= 0.95 + 0.09 * vnoise(vW.xz * 2.5 + vW.y * 3.0);
  // 贴地 / 入水处更深 (湿)
  col = mix(col * vec3(0.74, 0.82, 0.88), col, smoothstep(0.03, 0.2, vY));
  float dist = length(vW - cameraPosition);
  col = mix(col, uHaze, smoothstep(uHazeStart, uHazeEnd, dist) * 0.85);
  ${OUT}
}
`;
