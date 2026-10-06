/**
 * beach3dShaders.ts — 海滩 3D 场景的全部着色器 (GLSL, 用于 THREE.ShaderMaterial)。
 *
 * 风格: 二次元 MMD 舞台 —— 3D 卡通着色 (柔和的两~三阶明暗) + 高调日光 + 轻微 Bloom, 没有写实质感 / 环境贴图 (沙地是细腻的细沙颗粒 + 柔和色斑)。
 * 共同约定:
 *   - 颜色 uniform 都是线性空间 (THREE.Color 已按 ColorManagement 转好), 输出前乘 uComp (= 1 / 曝光), 抵消线性色调映射的曝光,
 *     画面上的颜色 = 配置里的 sRGB 色值。
 *   - 输出 alpha = uMark: 走后期 (渲染到 composer 目标) 时为 0.99, Bloom 高通据此跳过背景像素 (约定见 postFxPipeline.ts);
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
    // 高空浅云 (卷云): 视线投到天穹平面上, 域扭曲 + 拉长的分形噪声 → 细碎、断续的白丝, 再乘一层低频斑块遮罩 (一簇一簇, 不铺满);
    // 缓慢漂移, 只在中高仰角
    vec2 sp = d.xz / (h + 0.12);
    sp = mat2(0.87, -0.5, 0.5, 0.87) * sp + vec2(uTime * 0.004, 0.0);
    vec2 wq = sp + 1.1 * vec2(vnoise(sp * 0.7), vnoise(sp * 0.7 + 5.2)) - 0.55;
    float st = vnoise(wq * vec2(0.8, 4.5)) * 0.5 + vnoise(wq * vec2(1.7, 9.0) + 3.1) * 0.3 + vnoise(wq * vec2(3.4, 17.0) + 8.7) * 0.2;
    float brk = smoothstep(0.35, 0.7, vnoise(wq * vec2(2.2, 3.0) + 11.0));      // 把丝带打断成一段一段
    float pmask = smoothstep(0.42, 0.72, vnoise(sp * 0.3 + 2.0));              // 低频斑块: 只在部分天区出现
    float ci = smoothstep(0.55, 0.78, st) * brk * pmask * smoothstep(0.06, 0.3, h) * (1.0 - smoothstep(0.75, 1.0, h));
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
// 画法 = 手绘赛璐璐积云: 16 个大小不等、上下错落的圆鼓包 (后排云体 / 顶部花椰菜鼓包 / 两肩由高到低 / 前排底部), 边缘带轻微不规则起伏。
//   轮廓 = 所有鼓包的并集 (底边按一条水平线微微截平), 解析的圆 → 约 1.5 像素抗锯齿, 清晰而不糊;
//   亮面 = 每个鼓包向光一侧偏移、缩小后的圆的并集 —— 高处的鼓包几乎全亮并连成一片, 低处的鼓包只有顶上一弯亮边,
//   所以亮暗分界是一段段跟着鼓包体积走的圆弧, 不是统一的阴影带; 内部没有一圈圈的描边。
//   亮面奶白, 暗面淡蓝紫 (越靠底越深一点), 暗面轮廓带一点透光。
// 越低 (越远) 的云越小、越扁、越淡, 底部融进地平线亮带。
export const CLOUD_VERT = /* glsl */ `
attribute vec4 aCloud; // x 方位角 (rad), y 仰角 (rad), z 宽度 (m), w 随机种子
uniform float uTime;
uniform float uDrift;   // rad/s
uniform float uRadius;
uniform float uDipTan;
varying vec2 vUv;
varying float vSeed;
varying float vEl;
varying float vH;
void main() {
  float az = aCloud.x + uTime * uDrift * (0.7 + 0.6 * aCloud.w);  // 每朵云漂移速度略有不同
  float el = aCloud.y;
  vec3 c = uRadius * vec3(cos(el) * sin(az), sin(el), -cos(el) * cos(az));
  c.y -= uDipTan * length(c.xz);
  vec3 fwd = normalize(-c);                                   // 云 → 相机
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));    // 正面朝相机 (右手系)
  vec3 up = cross(fwd, right);
  vec2 sz = vec2(aCloud.z, aCloud.z * 0.6);
  vec3 wp = c + right * position.x * sz.x + up * position.y * sz.y;
  vUv = position.xy + 0.5;
  vSeed = aCloud.w;
  vEl = el;
  vH = (wp.y + uDipTan * length(wp.xz)) / length(wp);         // 该像素高出可见海平线的角度 (sin)
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
varying float vH;
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.6667, 1.0);      // 面片宽高比 1 : 0.6 → p.x ∈ ±0.83, p.y ∈ ±0.5
  float far = 1.0 - smoothstep(0.06, 0.3, vEl);   // 越低越远
  float sd = vSeed * 97.0;
  float tall = mix(0.62 + 0.15 * hash12(vec2(sd, 3.0)), 0.95 + 0.4 * hash12(vec2(sd, 3.0)), 1.0 - far); // 近处可长成塔状积云
  float wid = 0.85 + 0.3 * hash12(vec2(sd, 4.0));
  float lean = (hash12(vec2(sd, 5.0)) - 0.5) * 0.24;
  const float YB = -0.4;
  float px = fwidth(p.y);                          // 一个像素在 p 空间的大小
  vec2 Ld = normalize(uSunScreen + vec2(0.0, 0.7));   // 光在面片里的方向 (偏上)
  float S = -1.0;   // 轮廓距离场 (>0 在云内): 所有鼓包的并集
  float Lm = -1.0;  // 亮面距离场: 每个鼓包向光一侧偏移、缩小后的圆的并集 → 亮暗分界是一段段跟着鼓包走的圆弧
  float Bk = -1.0;  // 后排鼓包 (云体) 的范围, 暗面里略深一点, 让前排鼓包的暗部能读出层次
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float h1 = hash12(vec2(fi, sd + 1.7));
    float h2 = hash12(vec2(fi + 17.0, sd + 4.1));
    vec2 c;
    float r;
    if (i < 3) {                                   // 后排云体
      r = 0.21 + 0.07 * h2;
      c = vec2((fi - 1.0) * 0.21 * wid + (h1 - 0.5) * 0.08 + lean * 0.5, YB + 0.19 * tall);
    } else if (i < 6) {                            // 顶部花椰菜鼓包
      r = 0.1 + 0.08 * h2;
      c = vec2(lean + (fi - 4.0) * 0.13 * wid + (h1 - 0.5) * 0.1, YB + (0.33 + 0.12 * h1) * tall);
    } else if (i < 11) {                           // 两肩鼓包: 由内到外越来越低越小
      float k = fi - 6.0;
      float side = mod(k, 2.0) < 0.5 ? -1.0 : 1.0;
      float out1 = (0.2 + 0.13 * floor(k * 0.5) + 0.06 * h1) * wid;
      if (i == 10) { side = 0.0; out1 = (h1 - 0.5) * 0.3; }
      float x = side * out1 + lean * 0.3;
      float prof = clamp(1.0 - pow(abs(x) / (0.68 * wid), 2.0), 0.0, 1.0);
      r = 0.09 + 0.06 * h2 + 0.05 * prof;
      c = vec2(x, YB + (0.06 + 0.26 * prof) * tall + 0.02 * h2);
    } else {                                       // 前排底部鼓包
      float k = fi - 11.0;
      float bump = 1.0 - abs(k - 2.0) / 2.0;
      r = 0.085 + 0.05 * h2 + 0.03 * bump;
      c = vec2((-0.4 + k * 0.2 + (h1 - 0.5) * 0.08) * wid, YB + r * 0.62);  // 收在云体下面, 不在两侧单独鼓出来
    }
    vec2 q = p - c;
    float lq = length(q);
    if (lq > r * 1.3) continue;
    // 鼓包边缘轻微不规则 (连续的方向噪声, 没有接缝)
    float rr = r * (1.0 + 0.08 * (vnoise(q / max(lq, 1e-4) * 1.7 + vec2(fi * 3.7, sd)) - 0.5));
    S = max(S, rr - lq);
    if (i < 3) Bk = max(Bk, rr * 0.92 - lq);
    // 亮面圆: 越高的鼓包亮面越大 (顶上几乎全亮); 贴底的鼓包 (顶边埋在云体里) 不给亮面, 免得暗部里浮出一个个亮圆点
    float gh = clamp((c.y - YB) / (0.45 * tall), 0.0, 1.0);
    if (i < 11 && gh > 0.3) {
      float kr = mix(0.62, 0.93, gh);
      Lm = max(Lm, rr * kr - length(q - Ld * r * (1.0 - kr + 0.12)));
    }
  }
  S = min(S, (p.y - YB) + 0.004 * sin(p.x * 23.0 + sd));      // 底边微微截平
  float a = smoothstep(-px * 0.7, px * 0.9, S);               // 轮廓: 约 1.5 像素抗锯齿, 清晰不糊
  if (a < 0.004) discard;
  float lit = smoothstep(-px * 1.2, px * 1.6, Lm);             // 亮暗分界: 比轮廓稍柔一点
  float bot = p.y - YB;
  vec3 sh = mix(uShade * vec3(0.95, 0.95, 1.0), uShade, smoothstep(0.0, 0.25, bot));   // 暗面: 越靠底越深一点
  sh = mix(sh, uShade * vec3(0.94, 0.94, 0.98), smoothstep(-px, px, Bk) * 0.5 * (1.0 - smoothstep(0.0, 0.3, Lm + 0.05)));
  sh = mix(sh, mix(uShade, uLight, 0.4), (1.0 - smoothstep(0.0, 0.025, S)) * 0.35);       // 暗面轮廓透光
  vec3 lc = mix(uLight * vec3(0.99, 0.985, 0.985), uLight, smoothstep(0.0, 0.05, Lm));   // 亮面: 靠近分界处略暗一点点 (柔和)
  vec3 col = mix(sh, lc, lit);
  // 远处: 更淡、更偏天边色; 底部融进地平线亮带
  vec3 band = mix(uHorizon, vec3(1.0, 0.99, 0.97), 0.5);
  col = mix(col, band, far * 0.32 + (1.0 - smoothstep(0.0, 0.08, vH)) * 0.4);
  a *= mix(1.0, 0.78, far) * smoothstep(-0.004, 0.03, vH);
  gl_FragColor = vec4(col * uComp, a * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ───────────────────────── 远景岛屿剪影 (远景层) ─────────────────────────
// 三层卡通岛屿: 近层饱和的绿、中层柔和的绿、远层几乎融进天边的青白雾 (近深远浅的空气透视);
// 每层: 向阳坡亮一阶 / 背阳坡偏冷; 树冠鼓包的向阳侧顶边一道浅黄绿高光; 底部一层贴海面的浅色薄雾。
export const MOUNTAIN_VERT = /* glsl */ `
attribute float aH;
attribute float aRel;
attribute float aLayer;
attribute float aLit;
attribute float aAz;
uniform float uDipTan;
varying float vH;
varying float vRel;
varying float vLayer;
varying float vLit;
varying float vAz;
varying float vY;
void main() {
  vH = aH;
  vRel = aRel;
  vLayer = aLayer;
  vLit = aLit;
  vAz = aAz;
  vY = position.y;
  vec3 p = position;
  p.y -= uDipTan * length(p.xz);  // 坐在下沉后的可见海平线上
  gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(p, 1.0));
}
`;

export const MOUNTAIN_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uFar;
uniform vec3 uMid;
uniform vec3 uNear;
uniform vec3 uHorizon;
varying float vH;
varying float vRel;
varying float vLayer;
varying float vLit;
varying float vAz;
varying float vY;
void main() {
  vec3 base = vLayer < 0.5 ? uFar : (vLayer < 1.5 ? uMid : uNear);
  vec3 lightC = mix(base, vec3(0.95, 1.0, 0.72), 0.22);          // 向阳: 偏暖的浅黄绿
  vec3 shadeC = base * vec3(0.8, 0.88, 0.98);                     // 背阳: 偏冷
  vec3 col = mix(shadeC, lightC, smoothstep(0.3, 0.7, vLit));
  if (vLayer > 0.5) {
    // 树冠鼓包: 每个鼓包向阳 (+方位) 一侧的顶边亮一点, 背阳一侧的鼓包下方略暗
    float bw = vLayer < 1.5 ? 2.2 : 1.3;
    float u = vAz / bw + 0.6 * sin(vAz * 0.23) + 0.3 * sin(vAz * 0.71);
    float f = fract(u);
    float topEdge = smoothstep(0.8, 0.97, vRel);
    col = mix(col, mix(lightC, vec3(1.0, 1.0, 0.85), 0.25), topEdge * smoothstep(0.45, 0.85, f) * 0.6);
    col *= 1.0 - 0.08 * topEdge * (1.0 - smoothstep(0.1, 0.4, f));
    col *= 0.94 + 0.06 * vnoise(vec2(vAz * 1.3, vY * 1.5 + vLayer * 7.0));
  }
  // 空气透视: 越远越淡 (整体), 再加贴海面的浅色薄雾 (底部最浓)
  vec3 mist = mix(uHorizon, vec3(1.0, 0.99, 0.97), 0.35);
  float layerHaze = vLayer < 0.5 ? 0.58 : (vLayer < 1.5 ? 0.3 : 0.1);
  float mistH = vLayer < 0.5 ? 3.5 : (vLayer < 1.5 ? 1.6 : 0.8);
  float fog = layerHaze + (1.0 - layerHaze) * (1.0 - smoothstep(0.0, mistH, vY)) * (vLayer < 0.5 ? 0.75 : 0.6);
  col = mix(col, mist, clamp(fog, 0.0, 1.0));
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

// 细沙的一层颗粒: 平滑值噪声, 按这一层自己的屏幕导数淡出 → 近处看得出细沙, 远处逐层平滑消失, 不闪
float grainOct(vec2 q, float f) {
  float fw = length(fwidth(q * f));
  return (vnoise(q * f) - 0.5) * (1.0 - smoothstep(0.3, 0.75, fw));
}

// 沙地: 远近明暗 + 柔和的低频色斑 (暖 / 冷两种, 大小两个尺度) + 三层高频细颗粒 + 零星深浅细砂粒 + 少量不规则沙纹 + 湿沙带 (更深、反光)
vec3 sandColor(vec2 q, float dist, float top) {
  vec3 col = mix(uSandBase * vec3(0.965, 0.95, 0.93), uSandBase, smoothstep(1.0, 7.0, dist));
  col = mix(col, uSandLight, smoothstep(8.0, 30.0, dist) * 0.45);
  float n = vnoise(q * 0.32 + 3.7) * 0.65 + vnoise(q * 1.1 - 1.3) * 0.35;
  col = mix(col, uSandShade, smoothstep(0.55, 0.85, n) * 0.26);
  col = mix(col, uSandLight, (1.0 - smoothstep(0.18, 0.42, n)) * 0.4);
  float n2 = vnoise(q * 0.09 + 17.0);
  col *= mix(vec3(1.0), vec3(1.015, 0.985, 0.955), smoothstep(0.5, 0.85, n2) * 0.8);   // 偏暖的大色斑
  col = mix(col, col * vec3(0.99, 1.0, 1.02), (1.0 - smoothstep(0.15, 0.45, n2)) * 0.6); // 偏冷偏浅的大色斑
  // 细颗粒: 三层高频噪声
  float g = grainOct(q, 140.0) * 0.55 + grainOct(q, 62.0) * 0.75 + grainOct(q, 24.0) * 0.5;
  col *= 1.0 + g * 0.085 * uSandGrain;
  // 零星深浅细砂粒 (很小的柔和圆点; 太小看不清时整体淡出)
  vec2 gc = floor(q * 45.0);
  float gh = hash12(gc + 0.71);
  vec2 gp = fract(q * 45.0) - 0.5 - (vec2(hash12(gc + 2.3), hash12(gc + 5.9)) - 0.5) * 0.6;
  float gfw = length(fwidth(q * 45.0));
  float gd = (1.0 - smoothstep(0.12, 0.12 + gfw * 1.5, length(gp))) * (1.0 - smoothstep(0.25, 0.6, gfw)) * uSandGrain;
  col = mix(col, col * vec3(0.84, 0.8, 0.8), step(0.93, gh) * gd * 0.5);
  col = mix(col, vec3(1.0, 0.99, 0.96), step(gh, 0.04) * gd * 0.3);
  // 不规则沙纹: 只在噪声圈出的几块区域, 迎光坡亮 / 背光坡暗的柔和起伏
  float patchM = smoothstep(0.6, 0.78, vnoise(q * 0.15 + 11.0));
  float r = (q.y + 0.55 * sin(q.x * 0.55 + q.y * 0.3) + 1.3 * vnoise(q * 0.45) + 0.35 * vnoise(q * 1.3)) / uSandSpacing;
  float rfade = (1.0 - smoothstep(0.25, 0.6, fwidth(r))) * (1.0 - smoothstep(10.0, 22.0, dist));
  float wv = sin(r * 6.2831);
  float rip = patchM * rfade * uSandRipple;
  col = mix(col, uSandLight, smoothstep(0.5, 0.95, wv) * rip * 0.5);
  col = mix(col, uSandShade, smoothstep(-0.2, -0.9, wv) * rip * 0.45);
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
varying float vIns;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(n, uSunDir);
  vec3 col;
  if (vPart < 0.5) {
    // 树干: 柔和的卡通明暗 (亮部暖浅棕灰, 暗部偏冷) + 圆柱体积 (轮廓处略暗) + 淡、窄、间距随机、时断时续的细环纹 + 很淡的纵向肌理
    float t = vLeaf.x;
    float lit = smoothstep(-0.3, 0.5, ndl);
    col = mix(uTrunkShade, uTrunkLight, lit);
    col = mix(col, mix(uTrunkLight, vec3(1.0, 0.97, 0.9), 0.35), smoothstep(0.6, 0.95, ndl) * 0.3);   // 受光面柔和高光
    col *= mix(0.9, 1.0, smoothstep(0.05, 0.55, abs(dot(n, V))));                                       // 圆柱轮廓
    // 环纹: 每棵树 (vIns) 不同; 位置被噪声扭曲 → 间距随机; 约一半的环缺席; 每道环沿圆周时有时无 (不是整圈的条纹)
    float rc = t * 24.0 + 3.0 * vnoise(vec2(t * 5.0, vIns)) + vIns;
    rc += 0.05 * sin(vLeaf.y * 6.2831 + floor(rc) * 1.7);
    float rid = floor(rc);
    float on = step(0.45, hash12(vec2(rid, 7.7)));
    float wv = 0.035 + 0.04 * hash12(vec2(rid, 1.3));
    float rfw = fwidth(rc);
    float ring = (1.0 - smoothstep(wv, wv + rfw * 1.2, abs(fract(rc) - 0.5))) * on * (1.0 - smoothstep(0.3, 0.7, rfw));
    ring *= smoothstep(0.2, 0.6, vnoise(vec2(vLeaf.y * 5.0, rid * 1.7)));
    col = mix(col, col * vec3(0.8, 0.77, 0.8), ring * (0.35 + 0.3 * hash12(vec2(rid, 4.4))));
    col *= 0.975 + 0.04 * vnoise(vec2(vLeaf.y * 16.0, t * 5.0 + vIns));                                // 纵向肌理 (很淡)
    col = mix(col, uTrunkShade * vec3(0.9, 0.86, 0.82), smoothstep(0.8, 1.0, t) * 0.5);                 // 叶冠下略深
    // 根部自然入沙: 接地一圈暖沙色 + 很窄的接触暗部
    col = mix(col, mix(col, vec3(0.95, 0.87, 0.74), 0.55), 1.0 - smoothstep(0.0, 0.06, t));
    col *= mix(0.86, 1.0, smoothstep(0.0, 0.012, t));
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
    // 椰子: 圆润的卡通两阶明暗 (黄绿 → 暖棕, 每个略有差别) + 一个小的卡通高光 + 背光侧淡淡的反光
    float k = vLeaf.x;
    vec3 cl = mix(vec3(0.62, 0.68, 0.24), vec3(0.72, 0.55, 0.3), smoothstep(0.3, 0.9, k));
    vec3 cs = cl * vec3(0.55, 0.6, 0.62);
    float lit = smoothstep(-0.05, 0.25, ndl);
    col = mix(cs, cl, lit);
    float spec = pow(max(dot(reflect(-uSunDir, n), V), 0.0), 24.0);
    col = mix(col, vec3(1.0, 0.98, 0.9), smoothstep(0.55, 0.75, spec) * 0.7);
    col = mix(col, cl * 0.9, pow(1.0 - max(dot(n, V), 0.0), 3.0) * (1.0 - lit) * 0.4);
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

// ───────────────────────── 贝壳 / 海螺 / 海星 (实例化, 1 次绘制) ─────────────────────────
// 三种形状合在一个几何里 (aKind), 每个实例 (iKind) 只显示自己那一种; 卡通两阶明暗 + 小高光, 粉彩色 (奶白 / 浅粉 / 浅珊瑚)。
export const SHELL_VERT = /* glsl */ `
${COMMON}
attribute float aKind;
attribute vec2 aUV;
attribute float iKind;
attribute vec3 iColor;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUV;
varying float vKind;
varying vec3 vColor;
void main() {
  if (abs(aKind - iKind) > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }  // 不是这个实例的形状: 塌掉
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
  vKind = aKind;
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
varying vec3 vN;
varying vec3 vW;
varying vec2 vUV;
varying float vKind;
varying vec3 vColor;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(n, uSunDir);
  vec3 base = vColor;
  if (vKind < 0.5) {
    // 扇贝: 放射状的肋 (深浅相间) + 铰合部略深
    float rib = 0.5 + 0.5 * cos(vUV.x * 6.2831 * 9.0);
    base *= mix(1.0, 0.9, rib * smoothstep(0.1, 0.4, vUV.y));
    base = mix(base * 0.88, base, smoothstep(0.0, 0.3, vUV.y));
  } else if (vKind < 1.5) {
    // 海螺: 沿螺旋的细条纹 + 螺口内侧偏粉
    float band = 0.5 + 0.5 * sin(vUV.y * 6.2831 * 3.5 + vUV.x * 6.2831);
    base *= mix(1.0, 0.88, smoothstep(0.6, 0.9, band));
    base = mix(base, vec3(1.0, 0.82, 0.8), (1.0 - smoothstep(0.0, 0.12, vUV.y)) * 0.6);
  } else {
    // 海星: 中心略深, 表面一粒粒浅色小点
    base = mix(base * 0.9, base, smoothstep(0.0, 0.5, vUV.y));
    vec2 c = vec2(vUV.x * 40.0, vUV.y * 6.0);
    float dots = 1.0 - smoothstep(0.18, 0.3, length(fract(c) - 0.5));
    base = mix(base, vec3(1.0, 0.97, 0.92), dots * 0.35 * step(0.15, vUV.y));
  }
  float lit = smoothstep(-0.1, 0.25, ndl);
  vec3 col = mix(base * vec3(0.78, 0.76, 0.86), base, lit);
  float spec = pow(max(dot(reflect(-uSunDir, n), V), 0.0), 20.0);
  col = mix(col, vec3(1.0), smoothstep(0.5, 0.75, spec) * 0.45);
  float dist = length(vW - cameraPosition);
  col = mix(col, uHaze, smoothstep(uHazeStart, uHazeEnd, dist) * 0.85);
  ${OUT}
}
`;
