/**
 * 虚空场景渐变夜空 (全屏四边形, 与 Beach3DSky 同一做法)。
 *   - 渐变在屏幕空间按 CSS radial-gradient 规则计算 (椭圆, 色标在 sRGB 空间线性插值, 与浏览器一致),
 *     最后再转线性并乘 uComp (= 1 / 曝光), 经 tonemapping / colorspace 输出后与 CSS 取色一致;
 *   - 星云按视线方向取 3D 值噪声, 旋转视角时有轻微视差; 强度极低, 远低于 Bloom 阈值;
 *   - 屏幕空间抖动 (sRGB 域, 单位 1/255) 消除深色渐变色带;
 *   - alpha 恒为 1: 输出不透明, Tauri 透明窗口下仍由 #root 的圆角裁切。
 */
export const VOID_SKY_VERT = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
varying vec2 vUv;
varying vec3 vDir;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  v /= v.w;
  vDir = (uCamWorld * vec4(v.xyz, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const VOID_SKY_FRAG = /* glsl */ `
uniform vec3 uInner;   // sRGB 0..1
uniform vec3 uMid;
uniform vec3 uOuter;
uniform float uMidStop;
uniform vec2 uCenter;
uniform vec2 uRadius;
uniform vec3 uPlum;    // sRGB 0..1
uniform vec3 uApricot;
uniform float uNebula;
uniform float uScale;
uniform float uTime;
uniform float uDither;
uniform float uComp;
uniform float uContrast; // 后期 OutputPass 的 contrast (0 = 不补偿)
uniform float uBright;
varying vec2 vUv;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int k = 0; k < 3; k++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return s / 0.875;
}
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void main() {
  // CSS 坐标: y 从上往下
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float t = clamp(length((uv - uCenter) / uRadius), 0.0, 1.0);
  vec3 col = t < uMidStop
    ? mix(uInner, uMid, t / uMidStop)
    : mix(uMid, uOuter, (t - uMidStop) / (1.0 - uMidStop));

  if (uNebula > 0.0) {
    vec3 d = normalize(vDir);
    float drift = uTime;
    vec3 q = d * uScale + vec3(drift, 0.0, -drift * 0.7);
    float n = fbm(q);
    float hue = vnoise(q * 0.6 + 3.7);
    float m = smoothstep(0.42, 0.85, n) * (1.0 - 0.5 * t); // 边缘更暗, 中心光晕处稍多
    col += mix(uPlum, uApricot, smoothstep(0.35, 0.75, hue)) * m * uNebula;
  }

  // sRGB 域屏幕空间抖动 (±0.5 * uDither / 255)
  col += (hash13(vec3(gl_FragCoord.xy, 17.0)) - 0.5) * (uDither / 255.0);

  vec3 lin = toLinear(clamp(col, 0.0, 1.0)) * uComp; // 先抵消曝光
  // 再反向补偿 OutputPass 调色 (它在曝光之前): out = (x - 0.5) * (1 + c) + 0.5 + b  =>  x = (out - 0.5 - b) / (1 + c) + 0.5
  lin = (lin - 0.5 - uBright) / (1.0 + uContrast) + 0.5;
  gl_FragColor = vec4(max(lin, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
