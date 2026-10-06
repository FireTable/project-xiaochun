/**
 * beach3dShaders.ts — 海滩 3D 场景的全部着色器 (GLSL, 用于 THREE.ShaderMaterial)。
 *
 * 风格: 二次元 MMD 舞台 —— 3D 卡通着色 (柔和的两~三阶明暗) + 高调日光, 没有写实质感 / 环境贴图。
 * 共同约定:
 *   - 颜色 uniform 都是线性空间 (THREE.Color 已按 ColorManagement 转好), 输出前乘 uComp (= 1 / 曝光), 抵消线性色调映射的曝光,
 *     画面上的颜色 = 配置里的 sRGB 色值。
 *   - 不透明输出 (alpha = 1); 后期 Bloom 对场景与角色一视同仁, 没有场景专属的标记或剔除。
 *   - 空气透视: 远处向海平线色淡出 (uHazeStart → uHazeEnd), 让远景与天空 / 海平线无缝。
 *   - 地平线弧度: 离相机 uCurveD0 米以外的地面按 e²/(2R) 往下弯 (夸张的"地球曲率"), 真实的可见海平线因此落在眼高以下;
 *     天空 / 远岛 / 云按同一个下沉角 uDip 对齐, 远处无缝。角色附近 (uCurveD0 以内) 完全平。
 *   - 太阳方向 uSunDir = 引擎主方向光方向; 所有道具 (棕榈 / 礁石 / 椅子 / 伞 / 沙堡) 与地面上的道具落影都按它算, 与角色受光一致。
 *   - 棕榈 / 沙堡的落影: 用真实几何沿太阳方向压扁到地面, 烘焙进一张俯视的落影遮罩 (SHADOW_BAKE_*, 只在建好 / 太阳方向变化 /
 *     羽叶贴图加载完成时画一次, 不是每帧的阴影贴图), 地面着色器按世界 xz 采样 + 小半径模糊; 椅子 / 伞是解析投影。
 */

const COMMON = /* glsl */ `
uniform float uComp;
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
  gl_FragColor = vec4(col * uComp, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// ───────────────────────── 天空穹顶 (全屏层) ─────────────────────────
// 不依赖几何: 每个像素按视线方向算颜色 (等价于一个无限远的天空穹顶), 任何俯仰 / 宽高比都铺满整屏, 不会穿帮或露黑边。
// 海平线以上 = 三段渐变 + 高空卷云 + 地平线积云带 + 地平线亮带 + 太阳柔光; 海平线以下 = 远海色。
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
uniform vec3 uCloudLight;
uniform vec3 uCloudShade;
uniform float uSunGlow;
uniform float uCirrus;      // 高空卷云强度
uniform float uHorizonBand; // 地平线亮带强度
uniform float uBank;        // 地平线积云带强度
uniform float uBankHeight;  // 积云带高度 (sin 仰角)
uniform float uDipSin;      // 可见海平线的下沉角 sin (见文件头"地平线弧度")
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y + uDipSin;
  vec3 col;
  if (h >= 0.0) {
    col = mix(uHorizon, uMid, smoothstep(0.0, 0.28, h));
    col = mix(col, uZenith, smoothstep(0.22, 0.95, h));
    // 高空卷云: 视线投到天穹平面上 (天顶附近也不变形), 域扭曲 + 拉长的分形噪声 → 细碎、断续的白丝, 乘低频斑块遮罩
    vec2 sp = d.xz / (h + 0.12);
    sp = mat2(0.87, -0.5, 0.5, 0.87) * sp + vec2(uTime * 0.004, 0.0);
    vec2 wq = sp + 1.1 * vec2(vnoise(sp * 0.7), vnoise(sp * 0.7 + 5.2)) - 0.55;
    float st = vnoise(wq * vec2(0.8, 4.5)) * 0.5 + vnoise(wq * vec2(1.7, 9.0) + 3.1) * 0.3 + vnoise(wq * vec2(3.4, 17.0) + 8.7) * 0.2;
    float brk = smoothstep(0.35, 0.7, vnoise(wq * vec2(2.2, 3.0) + 11.0));
    float pmask = smoothstep(0.42, 0.72, vnoise(sp * 0.3 + 2.0));
    float ci = smoothstep(0.55, 0.78, st) * brk * pmask * smoothstep(0.06, 0.3, h) * (1.0 - smoothstep(0.75, 1.0, h));
    col = mix(col, mix(uMid, vec3(1.0), 0.85), ci * uCirrus);
    // 地平线亮带
    col = mix(col, mix(uHorizon, vec3(1.0, 0.99, 0.96), 0.65), (1.0 - smoothstep(0.0, 0.1, h)) * uHorizonBand);
    float s = max(dot(d, uSunDir), 0.0);
    col = mix(col, vec3(1.0, 0.985, 0.94), clamp(uSunGlow * (0.55 * pow(s, 4.0) + 1.2 * pow(s, 40.0)), 0.0, 1.0));
    // 地平线积云带 (最远的一层云, 画在远岛和近处积云后面): 方位用单位圆坐标采样噪声 → 360° 无接缝;
    // 顶边 = 一串大小不一的圆鼓包 (花椰菜轮廓), 只在部分方位出现; 鼓包顶向阳面奶白, 鼓包之间与下半部淡紫, 底部融进地平线亮带
    if (uBank > 0.0 && h < uBankHeight * 1.6) {
      vec2 hz = normalize(d.xz + vec2(1e-5));
      float az = atan(d.x, -d.z);
      float present = smoothstep(0.32, 0.58, vnoise(hz * 2.6 + 1.7 + vec2(uTime * 0.0006, 0.0)));
      float big = vnoise(hz * 7.0 + 3.1) * 0.65 + vnoise(hz * 19.0 + 7.7) * 0.35;
      float u = az * 34.0 + 3.0 * vnoise(hz * 11.0);
      float fu = fract(u);
      float bsz = 0.55 + 0.45 * hash12(vec2(floor(u), 3.3));
      float bump = sqrt(max(0.0, sin(3.14159 * fu))) * bsz;
      float top = uBankHeight * present * (0.25 + 0.75 * big) * (0.72 + 0.28 * bump);
      float aa = fwidth(h) * 1.2 + 1e-5;
      float inside = smoothstep(-aa, aa, top - h) * step(0.0015, top);
      float rel = clamp(h / max(top, 1e-4), 0.0, 1.0);
      float lit = smoothstep(0.45, 0.95, rel) * (0.55 + 0.45 * bump);
      vec3 bc = mix(mix(uCloudShade, uHorizon, 0.45), uCloudLight, lit);
      bc = mix(bc, mix(uCloudShade, uCloudLight, 0.4), (1.0 - bump) * smoothstep(0.6, 1.0, rel) * 0.4); // 鼓包之间的凹处
      bc = mix(bc, mix(uHorizon, vec3(1.0, 0.99, 0.97), 0.5), (1.0 - smoothstep(0.0, 0.55, rel)) * 0.7); // 底部融进亮带
      col = mix(col, bc, inside * uBank);
    }
    // 海平线上一条极细的亮线
    col = mix(col, vec3(1.0), 0.45 * (1.0 - smoothstep(0.0, 0.012, h)));
  } else {
    col = mix(uSeaHorizon, uSeaDeep, smoothstep(0.0, -0.3, h));
  }
  ${OUT}
}
`;

// ───────────────────────── 积云 (实例化面片, 远景层) ─────────────────────────
// 每朵云一个朝向相机的面片, 底边坐在 (方位, 仰角) 处, 分布在以相机为圆心、半径 uRadius 的球面上 (远景层跟随相机平移 = 无限远)。
// 画法 = 手绘二次元积云贴图 (一张 2×2 图集: 高耸积云 / 宽积云 / 扁长低云 / 小云簇, 透明底, 边缘柔和);
//   每朵云按种子左右翻转 + 冷暖微调 + 大小不同, 同一张图重复出现也不易认出; 贴近海平线的云略淡、偏天边色。
// 云永远在可见海平线之上: 底边仰角 > 0, 片元再按视线相对海平线的高度 vH 裁掉 (任何机位 / 俯仰都不会出现在海面或地面以下)。
export const CLOUD_VERT = /* glsl */ `
attribute vec4 aCloud;  // x 方位角 (rad), y 底边仰角 (rad), z 宽度 (m), w 随机种子
attribute float aKind;  // 图集格子 0..3
uniform float uTime;
uniform float uDrift;   // rad/s
uniform float uRadius;
uniform float uDipTan;
uniform vec4 uRect[4];  // 图集格子 (u0, v0, du, dv), v 从图片顶边往下
uniform float uAspect[4];
uniform vec3 uTint;
uniform float uTintJitter;
varying vec2 vUv;
varying float vEl;
varying float vH;
varying vec3 vTint;
void main() {
  int k = int(aKind + 0.5);
  vec4 rect = uRect[0];
  float aspect = uAspect[0];
  if (k == 1) { rect = uRect[1]; aspect = uAspect[1]; }
  else if (k == 2) { rect = uRect[2]; aspect = uAspect[2]; }
  else if (k == 3) { rect = uRect[3]; aspect = uAspect[3]; }
  float az = aCloud.x + uTime * uDrift * (0.7 + 0.6 * aCloud.w);
  float el = aCloud.y;
  vec3 c = uRadius * vec3(cos(el) * sin(az), sin(el), -cos(el) * cos(az));
  c.y -= uDipTan * length(c.xz);
  vec3 fwd = normalize(-c);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  float w = aCloud.z;
  vec3 wp = c + right * position.x * w + up * (position.y + 0.5) * w * aspect;
  float fx = position.x + 0.5;
  if (fract(aCloud.w * 7.31) > 0.5) fx = 1.0 - fx;          // 左右翻转
  vUv = rect.xy + vec2(fx, 0.5 - position.y) * rect.zw;     // 贴图不翻转: 面片顶边 = 格子顶边
  vEl = el;
  float j = (fract(aCloud.w * 13.7) - 0.5) * 2.0 * uTintJitter; // 冷暖: 正 = 偏暖奶油, 负 = 偏冷薰衣草
  vTint = uTint * (vec3(1.0) + j * vec3(0.6, 0.15, -0.7));
  vH = (wp.y + uDipTan * length(wp.xz)) / length(wp);
  gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(wp, 1.0));
}
`;

export const CLOUD_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform sampler2D uMap;
uniform vec3 uHorizon;
uniform float uOpacity;
varying vec2 vUv;
varying float vEl;
varying float vH;
varying vec3 vTint;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * uOpacity * smoothstep(0.0, 0.012, vH);   // 海平线以下一律不画
  if (a < 0.003) discard;
  vec3 col = t.rgb * vTint;
  // 贴近海平线的云 (远) 略淡、偏地平线亮带色; 底部融进亮带
  float far = 1.0 - smoothstep(0.015, 0.08, vEl);
  vec3 band = mix(uHorizon, vec3(1.0, 0.99, 0.97), 0.5);
  col = mix(col, band, far * 0.2 + (1.0 - smoothstep(0.0, 0.03, vH)) * 0.25);
  a *= mix(1.0, 0.9, far);
  gl_FragColor = vec4(col * uComp, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ───────────────────────── 远岛剪影 (远景层, 逐像素解析) ─────────────────────────
// 条带几何只负责覆盖像素, 剪影在片元里按方位角 / 仰角解析: 每层 = 若干座岛的平滑剖面 (穹顶 ↔ 尖峰火山形, 左右坡不对称) 取最大,
// 再叠细节: 远层柔和起伏, 中层山脊岩感, 近层一排树冠鼓包。三层从远到近合成 (前景层盖住后景层, 边缘约 1 像素抗锯齿)。
// 着色: 向阳坡亮一阶 / 背阳坡偏冷 (按平滑剖面坡向), 几道淡淡的山谷褶皱, 近层树冠向阳顶边一道浅高光;
// 空气透视: 越远越融进天色 (薰衣草青白), 每层下半部再化进贴海面的薄雾 → 远岛像从雾里浮出来, 而不是贴在海平线上的绿色土包。
export const ISLAND_VERT = /* glsl */ `
attribute float aAz;
uniform float uDipTan;
varying float vAz;
varying float vY;
void main() {
  vAz = aAz;
  vY = position.y;
  vec3 p = position;
  p.y -= uDipTan * length(p.xz);
  gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(p, 1.0));
}
`;

export const ISLAND_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec4 uIsl[ISL_MAX * 2];  // 每座: (方位°, 峰高°, 半宽°, 形状), (偏斜, 层 0/1/2, 有效, 0)
uniform vec3 uFar;
uniform vec3 uMid;
uniform vec3 uNear;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform float uHeight;   // 高度倍率
uniform float uDetail;   // 轮廓细节
uniform float uHazeK;    // 空气透视强度
uniform float uRadius;
varying float vAz;
varying float vY;

float prof(float az, vec4 a, vec4 b) {
  float d = az - a.x;
  float w = a.z * (d > 0.0 ? 1.0 + b.x : 1.0 - b.x);
  float t = abs(d) / w;
  if (t >= 1.0) return 0.0;
  float dome = pow(1.0 - t * t, 0.7);
  float peak = pow(1.0 - t, 1.7);
  return a.y * mix(dome, peak, a.w);
}
float layerSmooth(float az, float L) {
  float h = 0.0;
  for (int i = 0; i < ISL_MAX; i++) {
    vec4 b = uIsl[i * 2 + 1];
    if (b.z < 0.5 || abs(b.y - L) > 0.1) continue;
    h = max(h, prof(az, uIsl[i * 2], b));
  }
  return h * uHeight;
}
float layerDetail(float az, float L, float h) {
  if (h <= 0.0) return 0.0;
  if (L < 0.5) return uDetail * 0.12 * (vnoise(vec2(az * 0.3, 1.0)) - 0.5) * min(1.0, h);
  if (L < 1.5) return uDetail * (0.16 * (vnoise(vec2(az * 0.8, 5.0)) - 0.5) + 0.06 * (vnoise(vec2(az * 2.6, 7.0)) - 0.5)) * min(1.0, h / 0.6);
  float u = az / 0.42 + 0.7 * sin(az * 0.23) + 0.4 * sin(az * 0.71);
  float f = fract(u);
  float amp = 0.6 + 0.4 * hash12(vec2(floor(u), 2.0));
  return uDetail * 0.09 * amp * (sqrt(sin(3.14159 * f)) - 0.7) * min(1.0, h / 0.25);
}
vec3 shadeLayer(float az, float el, float L, float hs, float hl, vec3 base) {
  float slope = (layerSmooth(az + 0.35, L) - layerSmooth(az - 0.35, L)) / 0.7;
  float sunSide = uSunDir.x >= 0.0 ? 1.0 : -1.0;
  float lit = smoothstep(-0.7, 0.7, -slope * sunSide);   // 很宽的过渡: 山顶两侧不会出现一条竖直的明暗分界线
  vec3 lightC = mix(base, vec3(1.0, 0.98, 0.93), 0.16);
  vec3 shadeC = base * vec3(0.88, 0.9, 0.98);
  vec3 col = mix(shadeC, lightC, lit);
  float rel = clamp(el / max(hl, 0.05), 0.0, 1.0);
  // 山谷褶皱 (竖向的淡暗纹, 越靠上越清楚)
  float cr = smoothstep(0.64, 0.72, vnoise(vec2(az * 1.5 + el * 0.6, L * 5.0 + 3.0)));
  col *= 1.0 - 0.07 * cr * smoothstep(0.25, 0.85, rel) * (L > 0.5 ? 1.0 : 0.5);
  // 近层树冠: 向阳侧顶边一道浅高光
  if (L > 1.5) {
    float u = az / 0.42 + 0.7 * sin(az * 0.23) + 0.4 * sin(az * 0.71);
    float f = fract(u);
    float edge = smoothstep(0.8, 0.97, rel);
    col = mix(col, mix(lightC, vec3(1.0, 1.0, 0.9), 0.3), edge * (sunSide > 0.0 ? smoothstep(0.45, 0.85, f) : 1.0 - smoothstep(0.15, 0.55, f)) * 0.5);
  }
  // 空气透视: 层越远越融进天色; 下半部再化进贴海面的薄雾
  vec3 mist = mix(uHorizon, vec3(1.0, 0.99, 0.97), 0.3);
  float layerHaze = (L < 0.5 ? 0.6 : (L < 1.5 ? 0.36 : 0.16)) * uHazeK;
  float lowMist = (1.0 - smoothstep(0.0, L < 0.5 ? 0.9 : 0.6, rel)) * (L < 0.5 ? 0.7 : 0.55);
  col = mix(col, mist, clamp(layerHaze + (1.0 - layerHaze) * lowMist, 0.0, 1.0));
  return col;
}
void main() {
  float az = vAz;
  float el = degrees(atan(vY, uRadius));
  float aa = fwidth(el) * 0.9 + 1e-4;
  vec3 cp = vec3(0.0);
  float ap = 0.0;
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float hs = layerSmooth(az, fl);
    if (hs <= 0.0) continue;
    float hl = max(0.0, hs + layerDetail(az, fl, hs));
    float cov = smoothstep(-aa, aa, hl - el);
    if (cov <= 0.0) continue;
    vec3 base = L == 0 ? uFar : (L == 1 ? uMid : uNear);
    vec3 c = shadeLayer(az, el, fl, hs, hl, base);
    cp = c * cov + cp * (1.0 - cov);
    ap = cov + ap * (1.0 - cov);
  }
  if (ap < 0.003) discard;
  vec3 col = cp / ap;
  gl_FragColor = vec4(col * uComp, ap);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ───────────────────────── 沙地 + 海 (同一张地面) ─────────────────────────
// 一张大平面 (y=0), 片元按岸线函数分成沙 / 海: 岸线 = shoreBase(x) (与 beach3dLayout.shoreLineZ 同一公式), 浪花来回冲刷 (swash)。
// 沙: 远近明暗 + 柔和色斑 + 细颗粒 + 少量不规则沙纹 + 湿沙带 + 道具落影 (棕榈 / 沙滩椅 / 遮阳伞, 按太阳方向投影)。
// 海: 清透浅水 → 薄荷 → 松石 → 远海 (分界被噪声打乱, 有浅滩亮带与深色斑块), 卡通波纹, 屏幕空间的十字闪光,
// 几道速度 / 相位 / 宽度 / 断续都不同的近岸浪峰, 以及推上沙滩再退回的冲刷浪 (宽窄不一、带孔洞与蕾丝纹的白浪头 + 退潮留下的细泡沫线)。
export const GROUND_VERT = /* glsl */ `
uniform float uCurveR;
uniform float uCurveD0;
varying vec3 vW;
varying vec2 vL;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vL = position.xz;
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
uniform float uFoamVar;
uniform float uFoamBreak;
uniform float uWaves;
uniform float uBands;
uniform float uDepthNoise;
uniform float uGlint;
uniform float uGlintDensity;
uniform float uGlintSpeed;
uniform float uGlintSize;
uniform float uPxScale;
uniform float uSandSpacing;
uniform float uSandRipple;
uniform float uSandGrain;
uniform float uHazeStart;
uniform float uHazeEnd;
uniform vec3 uSunDir;
uniform vec4 uRocks[ROCK_MAX];    // 水中礁石: xz 中心, z 半径, w 有效 —— 画一圈白浪
uniform sampler2D uShadowMask;    // 棕榈 / 沙堡的烘焙落影遮罩 (R = 遮挡度, 俯视, 覆盖 uMaskRect)
uniform vec4 uMaskRect;           // 遮罩覆盖的地面范围: (最小 x, 最小 z, 宽, 深)
uniform vec2 uMaskTexel;          // 一个遮罩像素在 uv 里的大小
uniform float uMaskSoft;          // 落影边缘柔化倍率
uniform float uRippleCov;         // 沙纹覆盖面积 0..1
uniform float uRippleNear;        // 沙纹近处淡出距离 (m, 0 = 不淡出)
uniform vec4 uCanopy;             // 伞面: (中心 x, 中心 z, 高度, 半径; 半径 0 = 无)
uniform vec4 uChair;              // 躺椅: (中心 x, 中心 z, yaw, 有效)
uniform vec4 uChairBack;          // 靠背: (铰点高, 铰点 z, 角度, 长度)
uniform vec4 uChairSeat;          // 坐垫顶高, 腿的 |x|, 脚端腿 z, 头端腿 z
uniform float uShadowK;           // 道具落影强度
varying vec3 vW;
varying vec2 vL;

float shoreBase(float x) {
  return uShoreZ - uShoreCurve * x * x + uShoreWiggle * sin(x * 0.21 + 1.3) + 0.35 * uShoreWiggle * sin(x * 0.57);
}

// 卡通冲刷浪的进退曲线 (p = 周期相位 0..1): 前 38% 快速推上沙滩 (ease-out), 之后慢慢退回
float swashCurve(float p) {
  if (p < 0.38) { float u = p / 0.38; return 1.0 - (1.0 - u) * (1.0 - u); }
  float u = (p - 0.38) / 0.62;
  return 1.0 - u * u * (3.0 - 2.0 * u);
}

float grainOct(vec2 q, float f) {
  float fw = length(fwidth(q * f));
  return (vnoise(q * f) - 0.5) * (1.0 - smoothstep(0.3, 0.75, fw));
}

// 棕榈 / 沙堡的烘焙落影 (0..1): 中心 + 两圈各 4 个点的小半径模糊 (柔和的落影边缘, 叶片小叶的锯齿仍保留一点)
float bakedShadow(vec2 q) {
  vec2 uv = (q - uMaskRect.xy) / uMaskRect.zw;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 0.0;
  vec2 r = uMaskTexel * 1.25 * uMaskSoft;
  float s = texture2D(uShadowMask, uv).r * 0.2;
  s += (texture2D(uShadowMask, uv + vec2(r.x, 0.0)).r + texture2D(uShadowMask, uv - vec2(r.x, 0.0)).r
      + texture2D(uShadowMask, uv + vec2(0.0, r.y)).r + texture2D(uShadowMask, uv - vec2(0.0, r.y)).r) * 0.12;
  vec2 r2 = r * 1.45;
  s += (texture2D(uShadowMask, uv + r2).r + texture2D(uShadowMask, uv - r2).r
      + texture2D(uShadowMask, uv + vec2(r2.x, -r2.y)).r + texture2D(uShadowMask, uv + vec2(-r2.x, r2.y)).r) * 0.08;
  return s;
}

// 道具落影 (0..1): 棕榈 / 沙堡取烘焙遮罩; 伞 / 椅子把地面点沿太阳方向抬到物体高度, 看是否落在物体的水平截面里
float propShadow(vec2 q) {
  if (uShadowK <= 0.0) return 0.0;
  vec2 so = uSunDir.xz / max(uSunDir.y, 0.15);  // 每升高 1m, 往太阳方向水平移动多少
  float sh = bakedShadow(q);
  // 遮阳伞面: 8 根伞骨撑开的八边形 (伞骨之间是直边), 投影高度取伞面平均高度 (伞顶往下 0.12m)
  if (uCanopy.w > 0.0) {
    vec2 cq = q + so * (uCanopy.z - 0.12) - uCanopy.xy;
    float ang = atan(cq.y, cq.x) + uChair.z;   // 伞骨方向随椅子朝向转
    float fa = mod(ang, 0.785398) - 0.392699;
    float rr = uCanopy.w * 0.92388 / cos(fa);
    sh = max(sh, 1.0 - smoothstep(rr - 0.08, rr + 0.03, length(cq)));
    // 伞杆
    vec2 pb = uCanopy.xy;
    vec2 pt = uCanopy.xy - so * uCanopy.z;
    vec2 ba = pt - pb;
    float t = clamp(dot(q - pb, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    sh = max(sh, (1.0 - smoothstep(0.015, 0.045, length(q - pb - ba * t))) * 0.8);
  }
  // 躺椅: 坐垫 (脚端 → 铰点的矩形, 高 = 坐垫顶) + 靠背 (沿靠背分三段, 每段取中点高度); 4 条腿是细条小影
  if (uChair.w > 0.0) {
    float c = cos(uChair.z), s = sin(uChair.z);
    float bc = cos(uChairBack.z), bs = sin(uChairBack.z);
    for (int k = 0; k < 4; k++) {
      float s0 = float(k - 1) / 3.0 * uChairBack.w, s1 = float(k) / 3.0 * uChairBack.w;
      float hgt = k == 0 ? uChairSeat.x : uChairBack.x + 0.5 * (s0 + s1) * bs;
      float z0 = k == 0 ? -0.93 : uChairBack.y + s0 * bc;
      float z1 = k == 0 ? uChairBack.y : uChairBack.y + s1 * bc;
      vec2 p = q + so * hgt - uChair.xy;
      vec2 l = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
      float dx = abs(l.x) - 0.31;
      float dz = max(z0 - l.y, l.y - z1);
      sh = max(sh, (1.0 - smoothstep(-0.03, 0.04, max(dx, dz))) * 0.85);
    }
    for (int k = 0; k < 4; k++) {
      float lx = (k < 2 ? -1.0 : 1.0) * uChairSeat.y;
      float lz = mod(float(k), 2.0) < 0.5 ? uChairSeat.z : uChairSeat.w;
      vec2 a = uChair.xy + vec2(lx * c + lz * s, -lx * s + lz * c);
      vec2 ba = -so * 0.27;
      float t = clamp(dot(q - a, ba) / dot(ba, ba), 0.0, 1.0);
      sh = max(sh, (1.0 - smoothstep(0.015, 0.04, length(q - a - ba * t))) * 0.7);
    }
  }
  return sh;
}

vec3 sandColor(vec2 q, float dist, float top, float hiMark) {
  vec3 col = mix(uSandBase * vec3(0.965, 0.95, 0.93), uSandBase, smoothstep(1.0, 7.0, dist));
  col = mix(col, uSandLight, smoothstep(8.0, 30.0, dist) * 0.45);
  float n = vnoise(q * 0.32 + 3.7) * 0.65 + vnoise(q * 1.1 - 1.3) * 0.35;
  col = mix(col, uSandShade, smoothstep(0.55, 0.85, n) * 0.26);
  col = mix(col, uSandLight, (1.0 - smoothstep(0.18, 0.42, n)) * 0.4);
  float n2 = vnoise(q * 0.09 + 17.0);
  col *= mix(vec3(1.0), vec3(1.015, 0.985, 0.955), smoothstep(0.5, 0.85, n2) * 0.8);
  col = mix(col, col * vec3(0.99, 1.0, 1.02), (1.0 - smoothstep(0.15, 0.45, n2)) * 0.6);
  float g = grainOct(q, 140.0) * 0.55 + grainOct(q, 62.0) * 0.75 + grainOct(q, 24.0) * 0.5;
  col *= 1.0 + g * 0.085 * uSandGrain;
  vec2 gc = floor(q * 45.0);
  float gh = hash12(gc + 0.71);
  vec2 gp = fract(q * 45.0) - 0.5 - (vec2(hash12(gc + 2.3), hash12(gc + 5.9)) - 0.5) * 0.6;
  float gfw = length(fwidth(q * 45.0));
  float gd = (1.0 - smoothstep(0.12, 0.12 + gfw * 1.5, length(gp))) * (1.0 - smoothstep(0.25, 0.6, gfw)) * uSandGrain;
  col = mix(col, col * vec3(0.84, 0.8, 0.8), step(0.93, gh) * gd * 0.5);
  col = mix(col, vec3(1.0, 0.99, 0.96), step(gh, 0.04) * gd * 0.3);
  // 不规则沙纹: 只在噪声圈出的几块区域 (面积由 uRippleCov 控制); 纹线方向 / 间距都被噪声扭曲; 离相机近处淡成隐约的纹路
  float plo = mix(0.86, 0.36, uRippleCov);
  float patchM = smoothstep(plo, plo + 0.2, vnoise(q * 0.15 + 11.0));
  float r = (q.y + 0.55 * sin(q.x * 0.55 + q.y * 0.3) + 1.6 * vnoise(q * 0.45) + 0.45 * vnoise(q * 1.3 + 4.0)) / (uSandSpacing * (0.8 + 0.4 * vnoise(q * 0.2 + 2.0)));
  float rfade = (1.0 - smoothstep(0.25, 0.6, fwidth(r))) * (1.0 - smoothstep(10.0, 22.0, dist));
  float wv = sin(r * 6.2831);
  float nearK = uRippleNear > 0.0 ? 0.15 + 0.85 * smoothstep(uRippleNear * 0.35, uRippleNear, dist) : 1.0;
  float rip = patchM * rfade * nearK * uSandRipple;
  col = mix(col, uSandLight, smoothstep(0.5, 0.95, wv) * rip * 0.5);
  col = mix(col, uSandShade, smoothstep(-0.2, -0.9, wv) * rip * 0.45);
  // 湿沙: 浪推到过的区域 (top 以下) 更深, 往上逐渐变干; 这一轮浪刚冲到的地方 (hiMark 以下) 再深一点、更亮 (水膜反光)
  float wet = (1.0 - smoothstep(top - 0.05, top + 0.65, q.y)) * 0.75 + 0.25 * (1.0 - smoothstep(hiMark - 0.02, hiMark + 0.3, q.y));
  col = mix(col, uSandWet, wet * 0.85);
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
  col = mix(col, uSkyRefl, wet * (0.1 + 0.3 * fres));
  vec3 R = reflect(-uSunDir, vec3(0.0, 1.0, 0.0));
  col = mix(col, vec3(1.0, 0.99, 0.94), smoothstep(0.85, 0.98, dot(R, V)) * wet * 0.3);
  return col;
}

// 屏幕空间十字闪光: 世界格子里随机放点, 再用屏幕导数把偏移换算成像素 → 任何视角下都是端正的、固定像素大小的小十字星,
// 不会被透视拉成竖线; 格子在屏幕上太小 (远处) 时整体淡出, 不会变成噪点
float glintLayer(vec2 q, vec2 cell, float seed, float sizePx, float dens, mat2 inv) {
  vec2 gg = q / cell;
  vec2 gid = floor(gg);
  float k1 = hash12(gid + seed);
  float k2 = hash12(gid + seed + 37.0);
  if (k1 < 1.0 - dens) return 0.0;
  vec2 cen = (gid + 0.5 + (vec2(k2, fract(k1 * 7.3)) - 0.5) * 0.4) * cell;
  vec2 o = inv * (q - cen);              // 像素偏移
  float sz = sizePx * (0.6 + 0.8 * fract(k2 * 3.1)) * uPxScale;
  float tw = 0.5 + 0.5 * sin(uTime * uGlintSpeed * (1.1 + 1.7 * k2) + k1 * 50.0);
  tw = smoothstep(0.3, 0.95, tw);         // 约 40% 的时间是亮的, 其余时间熄灭 (一闪一闪)
  float w = 0.9 * uPxScale;
  float hArm = max(0.0, 1.0 - abs(o.x) / (sz * 1.6) - abs(o.y) / w);
  float vArm = max(0.0, 1.0 - abs(o.y) / (sz * 0.9) - abs(o.x) / w);
  float core = 1.0 - smoothstep(0.0, 2.2 * uPxScale, length(o));
  float star = max(core, pow(max(hArm, vArm), 0.6) * 1.3);
  return clamp(star, 0.0, 1.0) * tw;
}

vec3 seaColor(vec2 q, float dist, float ds, float d, float aa, float rising, float fwv, vec3 sandUnder) {
  // 深浅渐变: 分界被低频噪声打乱 (不是一圈圈平行的色带), 外面一道浅滩亮带, 中段零星深色斑块 (水下礁石 / 海草)
  float dn = (vnoise(q * 0.11 + 2.0) - 0.5) * 2.0 * uDepthNoise;
  float dd = max(ds + dn * 1.6 * smoothstep(0.6, 3.0, ds), 0.0);
  vec3 col = mix(uShallow, uSeaMid, smoothstep(0.3, 4.8, dd));
  float bar = (1.0 - smoothstep(0.0, 1.4, abs(dd - 6.0 - 2.0 * (vnoise(vec2(q.x * 0.08, 3.0)) - 0.5)))) * uDepthNoise;
  col = mix(col, mix(col, uShallow, 0.55), bar * 0.3);
  col = mix(col, uSeaDeep, smoothstep(7.5, 30.0, dd));
  float pt = smoothstep(0.64, 0.76, vnoise(q * 0.21 + 13.0)) * smoothstep(1.8, 3.8, dd) * (1.0 - smoothstep(9.0, 16.0, dd));
  col = mix(col, col * vec3(0.8, 0.9, 0.95), pt * 0.4 * uDepthNoise);
  // 清透: 越浅越能看到水下的沙
  col = mix(mix(sandUnder, uShallow, 0.5), col, smoothstep(-0.3, 1.6, ds));
  // 浅水卡通焦散
  float cn = vnoise(q * 2.0 + vec2(uTime * 0.22, -uTime * 0.16)) * 0.65 + vnoise(q * 4.3 - uTime * 0.18) * 0.35;
  float cw = fwidth(cn);
  float caus = (1.0 - smoothstep(0.0, cw * 1.2 + 0.022, abs(cn - 0.62))) * (1.0 - smoothstep(0.25, 0.6, cw * 10.0));
  col = mix(col, vec3(1.0), caus * 0.32 * (1.0 - smoothstep(0.8, 3.2, ds)));
  // 阳光闪光 (两层: 近处大格子大星, 中景小格子小星), 朝太阳一侧与掠射角更多
  vec2 dqx = dFdx(q), dqy = dFdy(q);
  float det = dqx.x * dqy.y - dqx.y * dqy.x;
  if (abs(det) > 1e-12 && uGlint > 0.0) {
    mat2 inv = mat2(dqy.y, -dqx.y, -dqy.x, dqx.x) / det;
    float side = clamp(0.6 + 0.4 * q.x * sign(uSunDir.x + 1e-4) / 20.0, 0.2, 1.0);
    float pxY = max(fwidth(q.y), 1e-5);
    float g1 = glintLayer(q, vec2(0.8, 0.4), 41.0, 8.0 * uGlintSize, uGlintDensity * side, inv) * smoothstep(6.0 * uPxScale, 11.0 * uPxScale, 0.4 / pxY);
    float g2 = glintLayer(q, vec2(2.0, 0.9), 83.0, 6.0 * uGlintSize, uGlintDensity * side, inv) * smoothstep(5.0 * uPxScale, 9.0 * uPxScale, 0.9 / pxY) * (1.0 - smoothstep(25.0 * uPxScale, 50.0 * uPxScale, 0.9 / pxY));
    float gfade = smoothstep(1.4, 3.0, ds) * (1.0 - smoothstep(32.0, 55.0, dist));
    col = mix(col, vec3(1.0, 0.995, 0.95), clamp(max(g1, g2) * gfade * uGlint, 0.0, 1.0));
  }
  // 近岸浪峰: 至多 4 道, 各自的速度 / 起点 / 相位不同; 浪峰线沿岸弯曲 (噪声), 粗细与断续沿岸变化, 每一轮都不一样;
  // 浪峰白线 + 浪前一条浅亮水 + 浪后深一档, 到岸并入冲刷浪
  float fm = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    if (fi >= uBands) break;
    float spd = i == 0 ? 0.071 : (i == 1 ? 0.052 : (i == 2 ? 0.088 : 0.061));
    float st = i == 0 ? 7.5 : (i == 1 ? 10.5 : (i == 2 ? 5.2 : 13.0));
    float cyc = uTime * spd + fi * 0.37 + 0.11;
    float ph = fract(cyc);
    float k = floor(cyc);
    float bend = 1.3 * (vnoise(vec2(q.x * 0.15 + k * 3.1 + fi * 7.0, fi + 0.5)) - 0.5) + 0.25 * sin(q.x * 0.31 + fi * 1.7 + k);
    float c = pow(1.0 - ph, 1.25) * st + 0.35 + bend * (0.35 + 0.65 * (1.0 - ph));
    float x = ds - c;
    float fade = smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.86, 1.0, ph)) * uWaves * (0.75 + 0.25 * hash12(vec2(k, fi)));
    float brkN = vnoise(vec2(q.x * 0.62 + fi * 13.0 + k * 5.3, k * 7.0 + fi)) * 0.7 + vnoise(vec2(q.x * 1.9 + fi * 3.0, k)) * 0.3;
    float brk = smoothstep(0.5 - 0.16 * ph, 0.64 - 0.14 * ph, brkN);   // 一段一段的碎浪; 外海更断续, 近岸更连贯
    float wn = vnoise(vec2(q.x * 0.6 + k * 1.7, fi * 3.0 + 9.0));
    float wdt = (0.03 + 0.12 * ph * ph) * (0.45 + 1.1 * wn);
    float jag = 0.07 * (vnoise(vec2(q.x * 3.0, fi + k * 2.0)) - 0.5);
    float crest = 1.0 - smoothstep(wdt, wdt + aa * 1.5, abs(x + jag + 0.04 * sin(q.x * 2.7 + uTime * 0.9 + fi)));
    crest *= 0.7 + 0.3 * smoothstep(0.3, 0.6, vnoise(q * vec2(5.0, 8.0) + fi));
    float back = smoothstep(0.0, 0.1, x) * (1.0 - smoothstep(0.25, 1.0 + 0.5 * wn, x));
    float front = smoothstep(0.0, -0.08, x) * (1.0 - smoothstep(-0.08, -0.6, x));
    col = mix(col, col * vec3(0.86, 0.93, 0.97), back * fade * 0.55);
    col = mix(col, mix(col, vec3(1.0), 0.3), front * fade * brk * 0.65);
    fm = max(fm, crest * fade * brk);
  }
  // 冲刷浪头: 宽度沿岸起伏 (fwv), 推上来时厚, 退回时变薄; 孔洞越往后越多 (退潮时更碎), 后面拖着两层蕾丝泡沫纹
  float fw = uFoamWidth * fwv * (0.6 + 0.55 * rising);
  float head = 1.0 - smoothstep(fw - aa, fw + aa, d);
  float hn = vnoise(q * vec2(3.2, 5.5) + vec2(uTime * 0.15, 0.0)) * 0.65 + vnoise(q * vec2(7.0, 11.0) - uTime * 0.1) * 0.35;
  float holeT = mix(0.8, 0.5, smoothstep(0.15, 1.0, d / max(fw, 1e-3))) - 0.12 * (1.0 - rising);
  float holes = smoothstep(holeT, holeT + 0.05, hn) * uFoamBreak;
  head *= 1.0 - holes * 0.85;
  float ln1 = vnoise(q * vec2(2.0, 3.4) + vec2(0.0, uTime * 0.22));
  float ln2 = vnoise(q * vec2(4.6, 7.2) - vec2(uTime * 0.1, 0.0) + 5.0);
  float lace = (1.0 - smoothstep(0.0, 0.03 + aa, abs(ln1 - 0.5))) * 0.8 + (1.0 - smoothstep(0.0, 0.022 + aa, abs(ln2 - 0.5))) * 0.45 * uFoamBreak;
  lace *= (1.0 - smoothstep(fw, fw * (2.2 + 1.6 * fwv), d)) * smoothstep(fw * 0.8, fw * 1.1, d) * (0.55 + 0.45 * rising);
  // 礁石周围的一圈白浪
  float ring = 0.0;
  for (int i = 0; i < ROCK_MAX; i++) {
    vec4 r = uRocks[i];
    if (r.w < 0.5) continue;
    float rd = length((q - r.xy) * vec2(1.0, 1.15)) - r.z;
    float rw = (0.12 + 0.06 * sin(uTime * 1.6 + float(i) * 2.3 + atan(q.y - r.y, q.x - r.x) * 3.0)) * max(1.0, r.z / 0.8);  // 大礁石 (灯塔底座) 白浪圈更宽
    ring = max(ring, 1.0 - smoothstep(rw - aa, rw + aa, abs(rd - 0.02)));
  }
  fm = clamp(max(max(fm, head), max(ring * 0.9, lace)), 0.0, 1.0);
  col = mix(col, uFoam, fm);
  return col;
}

void main() {
  vec2 q = vL;
  float dist = length(vW - cameraPosition);
  float sb = shoreBase(q.x);
  // 冲刷浪: 周期 2π/uSwashSpeed 秒; 相位沿岸不规则错开 (浪头不是一条直线), 每一轮推上来的远近也沿岸不同、每轮不同
  float ph0 = uTime * uSwashSpeed * 0.159155 + uFoamVar * 0.22 * vnoise(vec2(q.x * 0.06, 2.3)) + 0.025 * sin(q.x * 0.41);
  float cyc = floor(ph0);
  float p = ph0 - cyc;
  float reachVar = mix(1.0, 0.64 + 0.36 * vnoise(vec2(q.x * 0.09 + cyc * 3.7, cyc * 1.3)), uFoamVar);
  float sw = swashCurve(p);
  float rising = 1.0 - smoothstep(0.3, 0.5, p);
  float scal = 0.08 * abs(sin(q.x * 2.3 + 2.0 * vnoise(vec2(q.x * 0.6, 1.7 + cyc)))) + 0.05 * vnoise(vec2(q.x * 1.7, cyc * 2.1));
  float lo = sb - 0.3;
  float reach = uSwashAmp * 1.35;
  float top = lo + reach + 0.09;                    // 湿沙上沿 (最远一轮能到的地方)
  float hiMark = lo + reach * reachVar + scal;      // 这一轮推到的最高处
  float edge = lo + reach * reachVar * sw + scal * (0.3 + 0.7 * sw);
  float fwv = mix(1.0, 0.45 + 1.0 * vnoise(vec2(q.x * 0.32 + cyc * 5.1, 7.0)), uFoamVar);  // 白浪宽度沿岸起伏
  float aa = max(fwidth(q.y), 1e-3);
  float s = q.y - edge;
  float ds = sb - q.y;
  vec3 sand = sandColor(q, dist, top, hiMark);
  // 退潮时在这一轮最高处留下一条渐淡的细泡沫线; 上一轮的泡沫线更淡、断得更多
  float resid = (1.0 - smoothstep(0.4, 0.95, p)) * smoothstep(0.38, 0.45, p);
  float rl = 1.0 - smoothstep(0.016, 0.016 + aa * 1.5, abs(q.y - hiMark - 0.03 * sin(q.x * 5.0)));
  rl *= smoothstep(0.35, 0.55, vnoise(vec2(q.x * 1.3, 5.0 + cyc)));
  float prevMark = lo + reach * mix(1.0, 0.64 + 0.36 * vnoise(vec2(q.x * 0.09 + (cyc - 1.0) * 3.7, (cyc - 1.0) * 1.3)), uFoamVar) + scal;
  float rl2 = (1.0 - smoothstep(0.012, 0.012 + aa * 1.5, abs(q.y - prevMark - 0.04 * sin(q.x * 4.1 + 1.0))));
  rl2 *= smoothstep(0.5, 0.65, vnoise(vec2(q.x * 1.7, 9.0 + cyc))) * (1.0 - smoothstep(0.0, 0.6, p)) * 0.5;
  vec3 col;
  if (s > aa * 1.5) {
    col = mix(sand, uFoam, max(rl * resid * 0.75, rl2 * 0.6) * step(0.0, q.y - edge - 0.05));
    // 浪头前方的沙上一道很淡的湿影 (推上来时)
    col *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.14, s)) * rising;
  } else {
    vec3 sea = seaColor(q, dist, ds, max(-s, 0.0), aa, rising, fwv, sand);
    col = mix(sea, sand, smoothstep(-aa * 1.5, aa * 1.5, s));
  }
  // 道具落影 (沙上全强度; 浅水 / 浪膜上弱一些, 海里没有)
  float psh = propShadow(q) * uShadowK * (s > 0.0 ? 1.0 : 0.45 * (1.0 - smoothstep(0.0, 1.5, ds)));
  col = mix(col, col * vec3(0.6, 0.6, 0.67), psh);
  vec3 haze = ds > 0.0 ? uSeaHorizon : uSandHaze;
  col = mix(col, haze, smoothstep(uHazeStart, uHazeEnd, dist) * (ds > 0.0 ? 0.85 : 0.9));
  gl_FragColor = vec4(col * uComp, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ───────────────────────── 棕榈 (树干 + 叶冠, 实例化) ─────────────────────────
// 每棵树的树干高度 / 倾斜倍率在顶点着色器里按 iPalm 变形 (几何只有一份), 所以 11 棵树高矮、斜度都不同, 仍是 2 次绘制。
export const PALM_VERT = /* glsl */ `
${COMMON}
attribute float aPart;
attribute vec2 aLeaf;
attribute vec2 iPalm;   // (树干高度倍率, 倾斜倍率)
uniform float uTime;
uniform float uSway;
uniform float uLean;    // 基准倾斜 (m)
varying vec3 vN;
varying vec3 vW;
varying vec2 vLeaf;
varying float vPart;
varying float vIns;
void main() {
  vec3 p = position;
  #ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
  #else
  mat4 im = mat4(1.0);
  #endif
  float ph = im[3][0] * 0.37 + im[3][2] * 0.53;
  vIns = fract(ph * 0.618) * 37.0;
  if (aPart < 0.5) {
    float t = aLeaf.x;
    float sm = t * t * (3.0 - 2.0 * t);
    p.x += (iPalm.y - 1.0) * uLean * (0.65 * sm + 0.35 * t * t);
    p.y *= iPalm.x;
  } else if (aPart < 1.5) {
    // 整片叶随风上下 / 左右摆 (越靠叶尖越大) + 叶缘 (小叶) 轻微抖动
    float s = aLeaf.x;
    float w = s * s * uSway;
    p.y += sin(uTime * 1.4 + ph + s * 1.5) * w;
    p.x += sin(uTime * 0.9 + ph * 1.3) * w * 0.6;
    p.z += cos(uTime * 1.1 + ph) * w * 0.4;
    p.y += sin(uTime * 2.6 + ph * 2.0 + s * 9.0) * uSway * 0.18 * abs(aLeaf.y - 0.5) * 2.0;
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
uniform sampler2D uFrond;   // 手绘羽叶贴图 (透明底)
uniform vec2 uFrondSize;    // 贴图像素尺寸 (mip 层级补偿用)
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
varying float vIns;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(n, uSunDir);
  vec3 col;
  if (vPart < 0.5) {
    float t = vLeaf.x;
    float lit = smoothstep(-0.3, 0.5, ndl);
    col = mix(uTrunkShade, uTrunkLight, lit);
    col = mix(col, mix(uTrunkLight, vec3(1.0, 0.97, 0.9), 0.35), smoothstep(0.6, 0.95, ndl) * 0.3);
    col *= mix(0.9, 1.0, smoothstep(0.05, 0.55, abs(dot(n, V))));
    float rc = t * 24.0 + 3.0 * vnoise(vec2(t * 5.0, vIns)) + vIns;
    rc += 0.05 * sin(vLeaf.y * 6.2831 + floor(rc) * 1.7);
    float rid = floor(rc);
    float on = step(0.45, hash12(vec2(rid, 7.7)));
    float wv = 0.035 + 0.04 * hash12(vec2(rid, 1.3));
    float rfw = fwidth(rc);
    float ring = (1.0 - smoothstep(wv, wv + rfw * 1.2, abs(fract(rc) - 0.5))) * on * (1.0 - smoothstep(0.3, 0.7, rfw));
    ring *= smoothstep(0.2, 0.6, vnoise(vec2(vLeaf.y * 5.0, rid * 1.7)));
    col = mix(col, col * vec3(0.8, 0.77, 0.8), ring * (0.35 + 0.3 * hash12(vec2(rid, 4.4))));
    col *= 0.975 + 0.04 * vnoise(vec2(vLeaf.y * 16.0, t * 5.0 + vIns));
    col = mix(col, uTrunkShade * vec3(0.9, 0.86, 0.82), smoothstep(0.8, 1.0, t) * 0.5);
    col = mix(col, mix(col, vec3(0.95, 0.87, 0.74), 0.55), 1.0 - smoothstep(0.0, 0.06, t));
    col *= mix(0.86, 1.0, smoothstep(0.0, 0.012, t));
  } else if (vPart < 1.5) {
    // 叶片: 手绘羽叶贴图 (透明处丢弃; 远处 mip 平均后 alpha 变小, 按 mip 层级放大 alpha 保住叶片覆盖率)。
    // 贴图的明暗笔触映射到配置的叶色 (亮 / 暗), 保留一点贴图自身的色相; 叶根略深、叶尖略亮; 每棵树色相略有差别; 冷色暗部, 两阶柔和明暗
    vec4 tx = texture2D(uFrond, vLeaf);
    vec2 dx = dFdx(vLeaf * uFrondSize), dy = dFdy(vLeaf * uFrondSize);
    float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-6));
    float al = tx.a * (1.0 + max(lod, 0.0) * 0.3);
    if (al < 0.5) discard;
    float s = vLeaf.x;
    float l = dot(tx.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 base = mix(uLeafShade, uLeafLight, smoothstep(0.12, 0.62, l));
    base = mix(base, tx.rgb, 0.3);
    base *= mix(0.86, 1.06, smoothstep(0.0, 0.75, s));
    base *= mix(vec3(1.0), vec3(1.04, 1.0, 0.92), fract(vIns * 0.37) * 0.6);
    float lit = smoothstep(-0.12, 0.3, ndl);
    col = mix(base * vec3(0.66, 0.77, 0.85), base, lit) * (gl_FrontFacing ? 1.0 : 0.88);
    // 逆光叶片透光一点
    col = mix(col, base * vec3(1.05, 1.1, 0.8), (1.0 - lit) * smoothstep(0.5, 1.0, dot(-V, uSunDir)) * 0.3);
  } else if (vPart < 2.5) {
    float k = vLeaf.x;
    vec3 cl = mix(vec3(0.62, 0.68, 0.24), vec3(0.72, 0.55, 0.3), smoothstep(0.3, 0.9, k));
    vec3 cs = cl * vec3(0.55, 0.6, 0.62);
    float lit = smoothstep(-0.05, 0.25, ndl);
    col = mix(cs, cl, lit);
    float spec = pow(max(dot(reflect(-uSunDir, n), V), 0.0), 24.0);
    col = mix(col, vec3(1.0, 0.98, 0.9), smoothstep(0.55, 0.75, spec) * 0.7);
    col = mix(col, cl * 0.9, pow(1.0 - max(dot(n, V), 0.0), 3.0) * (1.0 - lit) * 0.4);
  } else {
    // 冠顶叶鞘包 (与树干同色系, 略暖, 下深上浅) / 叶柄 (黄绿): 不贴图, 两阶柔和明暗
    vec3 bc = vLeaf.y > 0.5 ? mix(uLeafShade, vec3(0.74, 0.78, 0.4), 0.55) : mix(uTrunkShade, uTrunkLight, 0.4 + 0.3 * vLeaf.x) * vec3(0.98, 0.94, 0.85);
    float lit = smoothstep(-0.2, 0.4, ndl);
    col = mix(bc * vec3(0.7, 0.74, 0.86), bc, lit);
  }
  float dist = length(vW - cameraPosition);
  col = mix(col, uHaze, smoothstep(uHazeStart, uHazeEnd, dist) * 0.85);
  ${OUT}
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
  float t = smoothstep(-0.25, 0.1, ndl) * 0.55 + smoothstep(0.35, 0.6, ndl) * 0.45;
  vec3 col = mix(uRockShade, uRockLight, t);
  col = mix(col, mix(uRockLight, vec3(1.0), 0.45), smoothstep(0.6, 0.92, n.y) * smoothstep(0.15, 0.6, ndl) * 0.5);
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col = mix(col, vec3(0.86, 0.93, 1.0), rim * 0.3 * (1.0 - t));
  col *= 0.95 + 0.09 * vnoise(vW.xz * 2.5 + vW.y * 3.0);
  col = mix(col * vec3(0.74, 0.82, 0.88), col, smoothstep(0.03, 0.2, vY));
  float dist = length(vW - cameraPosition);
  col = mix(col, uHaze, smoothstep(uHazeStart, uHazeEnd, dist) * 0.85);
  ${OUT}
}
`;

// ───────────────────────── 扇贝 (实例化, 1 次绘制) ─────────────────────────
// 几何上已有放射肋条与波浪壳缘; 这里再按 aUV 画肋沟的细暗线、几圈淡淡的同心生长纹、铰合部 / 耳朵略深。两阶柔和明暗, 哑光:
// 没有高光 / 自发光, 受光面不比配置色更亮 (配置色本身比沙子略暗), 不会触发 Bloom, 安静地躺在沙上。
export const SHELL_VERT = /* glsl */ `
${COMMON}
attribute vec2 aUV;
attribute vec3 iColor;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUV;
varying vec3 vColor;
void main() {
  #ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
  #else
  mat4 im = mat4(1.0);
  #endif
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  wp.y -= curveDrop(wp.xyz);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
  vUV = aUV;
  vColor = iColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SHELL_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uSunDir;
uniform vec3 uHaze;
uniform float uHazeStart;
uniform float uHazeEnd;
uniform float uRibs;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUV;
varying vec3 vColor;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float ndl = dot(n, uSunDir);
  vec3 base = vColor;
  bool ear = vUV.x < 0.0 || vUV.x > 1.0;
  if (!ear) {
    float rc = cos(vUV.x * uRibs * 6.2831);
    float rfw = fwidth(vUV.x * uRibs);
    base *= mix(1.0, 0.86, smoothstep(-0.6, -0.95, rc) * smoothstep(0.08, 0.3, vUV.y) * (1.0 - smoothstep(0.3, 0.6, rfw)));
    float gl = abs(fract(vUV.y * 5.0 + 0.3) - 0.5);
    base *= 1.0 - 0.06 * (1.0 - smoothstep(0.02, 0.07, gl)) * smoothstep(0.2, 0.4, vUV.y);
  }
  base = mix(base * vec3(0.9, 0.86, 0.86), base, smoothstep(0.0, 0.22, vUV.y));
  float lit = smoothstep(-0.1, 0.25, ndl);
  vec3 col = mix(base * vec3(0.8, 0.78, 0.88), base * 0.97, lit);
  float dist = length(vW - cameraPosition);
  col = mix(col, uHaze, smoothstep(uHazeStart, uHazeEnd, dist) * 0.85);
  ${OUT}
}
`;

// ───────────────────────── 沙滩椅 + 遮阳伞 + 灯塔 + 沙堡 (1 次绘制) ─────────────────────────
// 柔和的二次元道具着色: 两~三阶卡通明暗 (暗部偏薰衣草, 与礁石 / 贝壳 / 角色暗部同一色调), 一点天光 rim;
// 坐垫沿椅长方向的粉彩条纹, 伞面相间的两色布片 (边缘干净, 不加饰边); 海上灯塔 (奶白 / 珊瑚粉塔身, 灯室暖光自发光); 伞面背面 (从下往上看) 是透光的暖色;
// 伞面在椅子 / 伞杆上的落影按太阳方向解析计算 (与地面落影同一套投影)。
export const PROP_VERT = /* glsl */ `
${COMMON}
attribute float aMat;
attribute vec2 aUV;
varying vec3 vN;
varying vec3 vW;
varying vec3 vLocal;
varying vec2 vUV;
varying float vMat;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y -= curveDrop(wp.xyz);
  vW = wp.xyz;
  vLocal = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vUV = aUV;
  vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PROP_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uFrame;
uniform vec3 uCushion;
uniform vec3 uStripe;
uniform vec3 uCanopyA;
uniform vec3 uCanopyB;
uniform vec3 uPillow;
uniform vec3 uLhBody;    // 灯塔: 塔身 / 色带 / 灯室框与顶 / 玻璃 / 礁石
uniform vec3 uLhBand;
uniform vec3 uLhRoof;
uniform vec3 uLhGlass;
uniform vec3 uLhRock;
uniform float uLhGlow;   // 灯室玻璃自发光 (0 = 正常受光, 1 = 完全不受明暗影响)
uniform vec3 uCastleSand; // 沙堡: 湿沙色 / 小旗色
uniform vec3 uCastleFlag;
uniform vec3 uSunDir;
uniform vec3 uHaze;
uniform vec4 uCanopyW;   // 伞面中心 (世界坐标 xyz) + 半径
uniform float uHazeStart;
uniform float uHazeEnd;
varying vec3 vN;
varying vec3 vW;
varying vec3 vLocal;
varying vec2 vUV;
varying float vMat;
void main() {
  vec3 n = normalize(vN);
  bool back = !gl_FrontFacing;
  if (back) n = -n;
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(n, uSunDir);
  vec3 base;
  if (vMat < 0.5) base = uFrame;
  else if (vMat < 1.5) {
    float st = step(0.5, fract((vLocal.x + 0.29) / 0.58 * 2.5));   // 沿椅长的条纹
    base = mix(uCushion, uStripe, st);
  } else if (vMat < 2.5) base = uFrame * vec3(0.97, 0.95, 0.93);
  else if (vMat < 3.5) {
    float panel = mod(floor(vUV.x), 2.0);
    base = mix(uCanopyA, uCanopyB, panel);
  } else if (vMat < 4.5) base = uPillow;
  else if (vMat < 5.5) {
    float k = vUV.x;
    base = k < 0.5 ? uLhBody : (k < 1.5 ? uLhBand : (k < 2.5 ? uLhRoof : (k < 3.5 ? uLhGlass : uLhRock)));
  } else {
    // 沙堡: 压实的湿沙 (细颗粒 + 朝上的面略干略亮) / 门窗洞 (深一档的阴影色) / 小旗 / 旗杆
    float k = vUV.x;
    if (k < 0.5) {
      base = uCastleSand * (0.965 + 0.06 * vnoise(vW.xz * 70.0 + vW.y * 55.0) + 0.03 * vnoise(vW.xz * 18.0 - vW.y * 20.0));
      base = mix(base, base * vec3(1.06, 1.05, 1.03), smoothstep(0.7, 0.95, n.y) * 0.7);
      base *= mix(0.86, 1.0, smoothstep(0.0, 0.11, vW.y));   // 贴地处 (底台边缘 / 塔脚) 略暗, 沙堡稳稳坐在沙上
    } else if (k < 1.5) base = uCastleSand * vec3(0.66, 0.6, 0.68);
    else if (k < 2.5) base = uCastleFlag;
    else base = vec3(0.97, 0.93, 0.87);
  }
  float t = smoothstep(-0.2, 0.15, ndl) * 0.62 + smoothstep(0.35, 0.7, ndl) * 0.38;
  vec3 col = mix(base * vec3(0.76, 0.74, 0.87), base, t);
  if (vMat > 2.5 && vMat < 3.5 && back) {
    // 伞面背面: 阳光透过布面, 暖而柔
    col = mix(base * vec3(0.8, 0.76, 0.84), base * vec3(1.02, 0.95, 0.9), 0.45);
  }
  // 伞面落在椅子 / 伞杆上的影子
  if (vMat < 2.5 || vMat > 3.5) {
    if (uCanopyW.w > 0.0 && vW.y < uCanopyW.y) {
      vec2 so = uSunDir.xz / max(uSunDir.y, 0.15);
      vec2 pq = vW.xz + so * (uCanopyW.y - vW.y) - uCanopyW.xz;
      float inSh = 1.0 - smoothstep(uCanopyW.w - 0.1, uCanopyW.w + 0.02, length(pq));
      col = mix(col, base * vec3(0.72, 0.7, 0.84), inSh * 0.75);
    }
  }
  // 天光 rim (背光侧轮廓)
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col = mix(col, vec3(0.9, 0.94, 1.0), rim * 0.22 * (1.0 - t));
  // 沙堡门窗洞: 洞里是阴影, 几乎不随朝向变化
  if (vMat > 5.5 && vUV.x > 0.5 && vUV.x < 1.5) col = base * mix(0.92, 1.0, t);
  // 灯塔灯室: 暖光自发光 (不随明暗变暗)
  if (vMat > 4.5 && vUV.x > 2.5 && vUV.x < 3.5) col = mix(col, uLhGlass * 1.08, uLhGlow);
  float dist = length(vW - cameraPosition);
  col = mix(col, uHaze, smoothstep(uHazeStart, uHazeEnd, dist) * 0.85);
  ${OUT}
}
`;

// ───────────────────────── 落影遮罩烘焙 (棕榈 / 沙堡 → 地面) ─────────────────────────
// 把真实几何沿太阳方向压扁到 y = 0 (g = xz − so·y), 再把 g 映射到遮罩覆盖的地面范围 uMaskRect, 画进一张俯视的单通道遮罩:
// 树干 = 1, 叶片 = 羽叶贴图的 alpha (按遮罩分辨率自动取 mip → 小叶的锯齿 / 缝隙按分辨率保留) × uFrondShadow, 椰子 / 叶柄 = uFrondShadow。
// 取最大值混合 (MaxEquation), 不需要深度。树干的高度 / 倾斜变形与 PALM_VERT 完全一致, 叶冠不摆动 (落影是静态的)。
// SOLID 宏: 普通网格 (沙堡), 整体按 1 写入。
export const SHADOW_BAKE_VERT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec4 uMaskRect;
#ifndef SOLID
attribute float aPart;
attribute vec2 aLeaf;
attribute vec2 iPalm;
uniform float uLean;
varying vec2 vLeaf;
varying float vPart;
#endif
void main() {
  vec3 p = position;
  #ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
  #else
  mat4 im = mat4(1.0);
  #endif
  #ifndef SOLID
  if (aPart < 0.5) {
    float t = aLeaf.x;
    float sm = t * t * (3.0 - 2.0 * t);
    p.x += (iPalm.y - 1.0) * uLean * (0.65 * sm + 0.35 * t * t);
    p.y *= iPalm.x;
  }
  vLeaf = aLeaf;
  vPart = aPart;
  #endif
  vec4 lp = modelMatrix * im * vec4(p, 1.0);
  vec2 so = uSunDir.xz / max(uSunDir.y, 0.15);
  vec2 g = lp.xz - so * max(lp.y, 0.0);
  gl_Position = vec4((g - uMaskRect.xy) / uMaskRect.zw * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SHADOW_BAKE_FRAG = /* glsl */ `
precision highp float;
#ifndef SOLID
uniform sampler2D uFrond;
uniform float uFrondShadow;
varying vec2 vLeaf;
varying float vPart;
#endif
void main() {
  float c = 1.0;
  #ifndef SOLID
  if (vPart > 0.5 && vPart < 1.5) {
    c = smoothstep(0.28, 0.62, texture2D(uFrond, vLeaf).a) * uFrondShadow;
    if (c <= 0.002) discard;
  } else if (vPart > 1.5) c = uFrondShadow;
  #endif
  gl_FragColor = vec4(c, c, c, 1.0);
}
`;
