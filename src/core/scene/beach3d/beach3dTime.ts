/**
 * beach3dTime.ts — 海滩 3D 场景的太阳轨迹数学与时段色彩调色板系统
 *
 * 核心设计：
 * 1. 纯数学与纯数据模块，无 DOM 依赖，可被单元测试与 Node.js 独立运行；
 * 2. 模拟唯美的扇形太阳与月亮运行轨迹 (Solar & Lunar Arc)：
 *    - 06:00 ~ 18:00 为日照：日出由左前方东侧升起，正午到达高空，傍晚西沉至正前方大海海平面；
 *    - 18:00 ~ 06:00 为夜间：太阳落入海平面以下，由清冷高空月光接管方向与海面月影；
 * 3. 三大基准时段色彩表（Day、Sunset、Night）：
 *    - 正午 12:00 配色与 BEACH3D_SCENE_CONFIG 完全一致（0 视觉漂移）；
 *    - 傍晚 17:45 呈现绝美紫红/霞光、海面金色反光道与极长斜影；
 *    - 夜间 22:00 呈现深邃午夜蓝天、月光冷沙与灯塔暖窗夜光；
 * 4. 全时段通过三次 Hermite 平滑步阶 (Smoothstep) 连续混合，过渡极其柔和自然。
 */

import * as THREE from 'three';
import { BEACH3D_SCENE_CONFIG } from './beach3dConfig';
import type { EnvironmentTimeMode } from '../environmentTime';

export interface BeachPaletteState {
  // ── 天空 ──
  skyZenith: THREE.Color;
  skyMid: THREE.Color;
  skyHorizon: THREE.Color;
  skyHorizonGlow: THREE.Color;
  skyWaterMistColor: THREE.Color;
  skySunGlow: number;
  skyCirrus: number;
  skyHorizonBand: number;
  // ── 海水 ──
  seaShallow: THREE.Color;
  seaMid: THREE.Color;
  seaDeep: THREE.Color;
  seaHorizon: THREE.Color;
  seaFoam: THREE.Color;
  seaGlint: number;
  // ── 沙滩 ──
  sandBase: THREE.Color;
  sandShade: THREE.Color;
  sandLight: THREE.Color;
  sandWet: THREE.Color;
  // ── 远山群岛 ──
  mountainsFar: THREE.Color;
  mountainsMid: THREE.Color;
  mountainsNear: THREE.Color;
  // ── 云彩与植被 ──
  cloudsTint: THREE.Color;
  cloudsOpacity: number;
  leafLight: THREE.Color;
  leafShade: THREE.Color;
  trunkLight: THREE.Color;
  trunkShade: THREE.Color;
  bootColor: THREE.Color;
  coconutColor: THREE.Color;
  // ── 礁石与道具 ──
  rockLight: THREE.Color;
  rockShade: THREE.Color;
  lighthouseGlow: number;
  sunTint: THREE.Color;

  // ── 场景统一光照 (所有材质共用; DAY 取值 = 原写死色, 画面零变化) ──
  /** 环境天光乘子: 乘在所有材质的暗部上 (白天 = 白, 黄昏偏暖, 夜里冷而暗) */
  ambientMul: THREE.Color;
  /** 直射高光乘子: 乘在所有材质的受光高光上 (白天 = 白, 黄昏 = 落日金, 夜里 = 冷月白) */
  highlight: THREE.Color;
  /** 直射光染色: 手绘贴图 (羽叶) 混入时跟着变 (白天 = 白) */
  lightTint: THREE.Color;
  /** 直射光强度 0~1: 贴图混入比例 / 高光显隐 / 场景影子深浅 */
  lightLevel: number;
  /**
   * 统一阴影染色 (道具的地面影子与角色的脚下落影共用这一份)。
   * 影子 = 底色朝这个颜色靠: 白天是沙地上的暖灰影, 黄昏偏紫, 夜里是冷蓝深影。
   * 不再一处用纯黑、一处用写死的冷灰。
   */
  shadowTint: THREE.Color;
  /** 远岛山脚薄雾 / 空气透视的目标色 (夜里必须沉进夜色, 否则远山发白) */
  islandMist: THREE.Color;
  /** 棕榈树干根部的沙色 —— 由 sandBase 推出 (不再是写死的白天浅沙色) */
  palmBase: THREE.Color;
  /** 沙堡的压实湿沙色 —— 同样由 sandBase 推出 (永远和沙滩是同一种沙) */
  castleSand: THREE.Color;

  // ── 道具 (躺椅 / 遮阳伞): 随时间重新上色, 否则夜里像霓虹灯 ──
  propFrame: THREE.Color;
  propCushion: THREE.Color;
  propStripe: THREE.Color;
  propCanopyA: THREE.Color;
  propCanopyB: THREE.Color;
  propPillow: THREE.Color;

  // ── 沙堡 ──
  castleFlag: THREE.Color;

  // ── 灯塔 ──
  lhBody: THREE.Color;
  lhBand: THREE.Color;
  lhRoof: THREE.Color;
  lhGlass: THREE.Color;
  lhRock: THREE.Color;

  // ── 角色主光 (引擎级; 与场景太阳同向, 角色影子才和椅子 / 棕榈的影子对得上) ──
  keyLightColor: THREE.Color;
  keyLightScale: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiScale: number;
  fillColor: THREE.Color;
  fillScale: number;
}

/**
 * 三大基准时段的"源"调色板 —— 与 BeachPaletteState 相同, 但不含 palmBase
 * (palmBase 由当前沙地色推出, 不是某个时段的固定值)。
 */
export type BeachPaletteSource = Omit<BeachPaletteState, 'palmBase' | 'castleSand'>;

export interface BeachTimeEvaluation {
  currentHour: number;
  sunDir: THREE.Vector3;
  palette: BeachPaletteState;
  weights: { day: number; sunset: number; night: number };
}

/** sRGB 十六进制转线性 THREE.Color */
function c(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

/**
 * 棕榈树干根部沙色相对沙地色的提亮倍率 (线性空间, 逐通道)。
 * 白天: 沙地 0xf4e1c2 × 该倍率 = (0.95, 0.87, 0.74) —— 正好是着色器里原先写死的那组浅沙色。
 */
const PALM_BASE_BOOST = { r: 1.0502, g: 1.1557, b: 1.3718 } as const;

/**
 * 沙堡的压实湿沙相对干沙的压暗倍率 (线性空间, 逐通道)。
 * 白天: 沙地 0xf4e1c2 × 该倍率 = 0xe8c8a0 —— 正好是配置里写死的沙堡色。
 */
const CASTLE_SAND_BOOST = { r: 0.8921, g: 0.7673, b: 0.6516 } as const;

/** 0 ~ 1 范围内的三次 Hermite 平滑步阶插值 */
function smoothstep(min: number, max: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

// ──────────────────────── 1. 三大基准时段调色板定义 ────────────────────────

const cfg = BEACH3D_SCENE_CONFIG;

/** 白天基准配色 (Day, 锚定 12:00，严格等于原始场景配置) */
export const PALETTE_DAY: BeachPaletteSource = {
  skyZenith: c(cfg.sky.zenith),
  skyMid: c(cfg.sky.mid),
  skyHorizon: c(cfg.sky.horizon),
  skyHorizonGlow: c(cfg.sky.horizonGlow),
  skyWaterMistColor: c(cfg.sky.waterMistColor),
  skySunGlow: cfg.sky.sunGlow,
  skyCirrus: cfg.sky.cirrus,
  skyHorizonBand: cfg.sky.horizonBand,

  seaShallow: c(cfg.sea.shallow),
  seaMid: c(cfg.sea.mid),
  seaDeep: c(cfg.sea.deep),
  seaHorizon: c(cfg.sea.horizon),
  seaFoam: c(cfg.sea.foam),
  seaGlint: cfg.sea.glint,

  sandBase: c(cfg.sand.base),
  sandShade: c(cfg.sand.shade),
  sandLight: c(cfg.sand.light),
  sandWet: c(cfg.sand.wet),

  mountainsFar: c(cfg.mountains.far),
  mountainsMid: c(cfg.mountains.mid),
  mountainsNear: c(cfg.mountains.near),

  cloudsTint: c(cfg.clouds.tint),
  cloudsOpacity: cfg.clouds.opacity,
  leafLight: c(cfg.vegetation.leafLight),
  leafShade: c(cfg.vegetation.leafShade),
  trunkLight: c(cfg.vegetation.trunkLight),
  trunkShade: c(cfg.vegetation.trunkShade),
  bootColor: c(cfg.vegetation.bootColor),
  coconutColor: c(cfg.vegetation.coconutColor),

  rockLight: c(cfg.rocks.light),
  rockShade: c(cfg.rocks.shade),
  lighthouseGlow: cfg.lighthouse.glow,
  sunTint: new THREE.Color(1.0, 0.985, 0.94),

  // 白天 = 原样: 所有乘子取 1 / 原色, 白天画面与改造前完全一致
  ambientMul: new THREE.Color(1, 1, 1),
  highlight: new THREE.Color(1, 1, 1),
  lightTint: new THREE.Color(1, 1, 1),
  lightLevel: 1.0,
  // 白天的影子染色 = 地面着色器原先写死的 (0.60, 0.60, 0.67): 正午画面的影子深浅与色调零变化
  shadowTint: new THREE.Color(0.60, 0.60, 0.67),
  islandMist: c(cfg.sky.waterMistColor),

  propFrame: c(cfg.props.frame),
  propCushion: c(cfg.props.cushion),
  propStripe: c(cfg.props.stripe),
  propCanopyA: c(cfg.props.canopyA),
  propCanopyB: c(cfg.props.canopyB),
  propPillow: c(cfg.props.pillow),

  castleFlag: c(cfg.sandcastle.flag),

  lhBody: c(cfg.lighthouse.body),
  lhBand: c(cfg.lighthouse.band),
  lhRoof: c(cfg.lighthouse.roof),
  lhGlass: c(cfg.lighthouse.glass),
  lhRock: c(cfg.lighthouse.rock),

  keyLightColor: c(0xfffdfa),
  keyLightScale: 1.0,
  hemiSky: c(0xfffaf8),
  hemiGround: c(0xe2d6e6),
  hemiScale: 1.0,
  fillColor: c(0xf2f0ff),
  fillScale: 1.0,
};

/** 落日黄昏基准配色 (Sunset, 锚定 17:45，绝美晚霞与金光海面) */
export const PALETTE_SUNSET: BeachPaletteSource = {
  skyZenith: c(0x272b5c),       // 天顶深紫红蓝
  skyMid: c(0xd4685e),          // 中段绚丽霞光橙红
  skyHorizon: c(0xf7af59),      // 天际线暖金黄
  skyHorizonGlow: c(0xffcb78),  // 地平线金色柔光
  skyWaterMistColor: c(0xfcd8b8), // 水雾染上暖金
  skySunGlow: 0.58,             // 阳光日晕加宽加强
  skyCirrus: 0.70,              // 卷云染上金色
  skyHorizonBand: 0.55,

  seaShallow: c(0xec9b67),      // 浅滩映衬落日金波
  seaMid: c(0xb6556b),          // 中层海浪玫瑰紫红
  seaDeep: c(0x313063),         // 远海深紫蓝
  seaHorizon: c(0xeb9c5e),      // 海平线倒影
  seaFoam: c(0xffedd8),         // 浪花染上暖金边
  seaGlint: 1.35,               // 耀眼的落日反光金道

  sandBase: c(0xdd9769),        // 沙滩转为暖琥珀色
  sandShade: c(0xa36052),       // 阴影呈红褐暖调
  sandLight: c(0xf5bb92),       // 高光处透着落日余晖
  sandWet: c(0x884342),         // 湿沙色泽浓郁反光

  mountainsFar: c(0x56305a),    // 远山纯净紫调剪影 (暮色紫)
  mountainsMid: c(0x703e62),
  mountainsNear: c(0x884c6c),

  cloudsTint: c(0xffa578),      // 白云化身火烧云！
  cloudsOpacity: 1.0,
  leafLight: c(0x8f993d),       // 棕榈叶逆光金绿
  leafShade: c(0x283d2e),
  trunkLight: c(0xdcb896),      // 温暖柔和的金砂原木色 (保留浅色原木质感, 绝非深紫巧克力!)
  trunkShade: c(0x947c7c),      // 柔和暖灰木阴影
  bootColor: c(0xb09c7a),
  coconutColor: c(0xa4ad6a),

  rockLight: c(0xcf9573),
  rockShade: c(0x5b4458),
  lighthouseGlow: 0.90,         // 灯塔开始醒目
  sunTint: new THREE.Color(1.0, 0.72, 0.42), // 暖橙红太阳

  ambientMul: new THREE.Color(0.86, 0.80, 0.88), // 暗部压暗一档并偏紫
  highlight: new THREE.Color(1.0, 0.74, 0.48),   // 高光染上落日金
  lightTint: new THREE.Color(1.0, 0.80, 0.58),   // 直射光染上落日暖橙 (手绘羽叶贴图也跟着暖)
  lightLevel: 0.85,
  shadowTint: new THREE.Color(0.55, 0.46, 0.58), // 暮色里的影子染上一点紫
  islandMist: c(0x603454),     // 远岛薄雾染上深紫红晚霞色, 远山纯净紫调剪影融进天际线

  propFrame: c(0xf0c8a4),
  propCushion: c(0xd98a7e),
  propStripe: c(0xf0cdb4),
  propCanopyA: c(0xd9868f),
  propCanopyB: c(0xf0c9ae),
  propPillow: c(0x8fc4b4),

  castleFlag: c(0xe0705f),

  lhBody: c(0xf6d3b4),
  lhBand: c(0xc22a2a),
  lhRoof: c(0xc22a2a),
  lhGlass: c(0xffe6a8),
  lhRock: c(0xb49a8e),

  // ── 角色主光 (动漫写真打光保护: 角色始终是主体, 色调微调但不染色破坏发色与肤色) ──
  keyLightColor: c(0xfff3e5),  // 柔和香槟暖白光 (保护粉发不被染成胡萝卜橙)
  keyLightScale: 1.0,
  hemiSky: c(0xffede2),
  hemiGround: c(0xdcc8d5),
  hemiScale: 0.95,
  fillColor: c(0xfff5ee),
  fillScale: 0.90,
};

/** 静谧深夜基准配色 (Night, 锚定 22:00，月夜深蓝与灯塔微光) */
export const PALETTE_NIGHT: BeachPaletteSource = {
  skyZenith: c(0x050813),       // 深邃黑蓝
  skyMid: c(0x0b1425),          // 墨夜冷蓝
  skyHorizon: c(0x162237),      // 海天交界深靛青
  skyHorizonGlow: c(0x182438),  // 柔和暗夜微光
  skyWaterMistColor: c(0x131d2e),
  skySunGlow: 0.05,             // 太阳光晕熄灭
  skyCirrus: 0.20,              // 极淡月夜轻云
  skyHorizonBand: 0.15,

  seaShallow: c(0x182f47),      // 浅滩暗青月光水色
  seaMid: c(0x0b1c2f),          // 墨青海浪
  seaDeep: c(0x050f1c),         // 接近纯黑的夜海深渊
  seaHorizon: c(0x102035),
  seaFoam: c(0x60778f),         // 柔和微蓝白浪花
  seaGlint: 0.25,               // 清冷月色波光

  sandBase: c(0x343d52),        // 冷调月光石青沙地
  sandShade: c(0x202634),       // 深邃暗部
  sandLight: c(0x47536d),       // 月光冷白高光
  sandWet: c(0x1b202c),         // 潮湿深邃反射

  mountainsFar: c(0x0e1828),    // 浓黑夜山剪影 (沉入深蓝夜空)
  mountainsMid: c(0x121e32),
  mountainsNear: c(0x18263e),

  cloudsTint: c(0x1a2438),      // 月色暗蓝积云
  cloudsOpacity: 0.85,
  leafLight: c(0x24382e),       // 暗幽绿树冠
  leafShade: c(0x121e18),
  trunkLight: c(0x3c424e),      // 夜晚沉稳深原木色 (比黑夜略亮, 保留树皮环纹与圆柱立体感, 绝不泛白如白桦)
  trunkShade: c(0x242832),      // 深邃夜色木影
  bootColor: c(0x2c323a),
  coconutColor: c(0x28302c),

  rockLight: c(0x353b4b),
  rockShade: c(0x1a1e28),
  lighthouseGlow: 1.0,          // 灯塔暖黄窗口在黑暗中彻底发光！
  sunTint: new THREE.Color(0.55, 0.68, 0.88), // 清冷月光色

  ambientMul: new THREE.Color(0.30, 0.40, 0.62), // 暗部只剩一点冷蓝月色
  highlight: new THREE.Color(0.28, 0.38, 0.55),   // 近白高光全部压成暗月白
  lightTint: new THREE.Color(0.60, 0.72, 0.95),   // 直射光转冷月色
  lightLevel: 0.25,
  shadowTint: new THREE.Color(0.34, 0.40, 0.55), // 月夜的影子是冷蓝深影, 不是纯黑
  islandMist: c(0x0e1726),     // 远岛薄雾沉进深蓝夜色, 远山纯净剪影融进天际线, 绝不发白

  propFrame: c(0x4a5160),
  propCushion: c(0x5c4450),
  propStripe: c(0x5a5060),
  propCanopyA: c(0x5e4552),
  propCanopyB: c(0x555a66),
  propPillow: c(0x3f5c58),

  castleFlag: c(0x7a4a52),

  lhBody: c(0x3d4453),
  lhBand: c(0x6e2733),
  lhRoof: c(0x6e2733),
  lhGlass: c(0xffe0a0),
  lhRock: c(0x2e3440),

  // ── 角色主光 (动漫写真月光: 背景是黑夜, 但角色必须清晰、透亮、白净, 绝不过度压暗) ──
  keyLightColor: c(0xf0f5ff),  // 动漫清冷月白写真光 (通透干净)
  keyLightScale: 0.90,         // 高亮度高通透, 角色面部与衣服清澈可见
  hemiSky: c(0xa0b4d8),        // 柔和冷月天光
  hemiGround: c(0x606c80),
  hemiScale: 0.85,
  fillColor: c(0xe2ecfa),      // 面部柔和补光
  fillScale: 0.80,
};

// ──────────────────────── 2. 太阳与月球运行轨迹数学 ────────────────────────

function getDaySun(h: number): THREE.Vector3 {
  const dayProgress = THREE.MathUtils.clamp((h - 5.5) / 13.0, 0, 1);
  const sinCurve = Math.sin(dayProgress * Math.PI);
  const elevation = Math.max(0.04, sinCurve * THREE.MathUtils.degToRad(45.8169));
  const cosElev = Math.cos(elevation);
  let x: number;
  let z: number;
  if (dayProgress <= 0.5) {
    const t = dayProgress / 0.5;
    // 日出从落日沉下的同一侧海面升起 (z 为负), 拂晓把月光交回日光时两个方向才接得上, 影子不横扫。
    // 正午 (t = 1) 的方向保持原值, 白天的主光与影子方向不变。
    x = THREE.MathUtils.lerp(0.22, 0.5145, t) * cosElev;
    z = THREE.MathUtils.lerp(-0.98, 0.8575, t) * cosElev;
  } else {
    const t = (dayProgress - 0.5) / 0.5;
    const smoothT = smoothstep(0.0, 1.0, t);
    // 后半段把仰角加快压低 (正午不受影响): 17:45 要低过阴影的高度角下限, 傍晚才有长影。
    x = THREE.MathUtils.lerp(0.5145, 0.22, smoothT) * cosElev;
    z = THREE.MathUtils.lerp(0.8575, -0.98, smoothT) * cosElev;
  }
  const y = Math.sin(elevation);
  // 午后把仰角加快压低 (正午及以前不受影响): 17:45 要低过阴影的高度角下限, 傍晚才有长影。
  const dropT = dayProgress <= 0.5 ? 0 : Math.min(1, Math.max(0, ((dayProgress - 0.5) / 0.5 - 0.35) / 0.45));
  return new THREE.Vector3(x, y * (1 - 0.75 * dropT), z).normalize();
}

function getNightMoon(h: number): THREE.Vector3 {
  // 以太阳落海的时刻 (约 17:10) 为夜的起点, 而不是固定的 17:30:
  // 月亮要从"太阳正在沉下的那个位置"接棒, 早一小时升起会把 17:45 的落日又抬回半空。
  const nightProgress = h >= 17.2 ? (h - 17.2) / 12.0 : (h + 6.8) / 12.0;
  // 月亮走和太阳同一条弧: 从落日沉下的那一侧海面升起, 再爬到高空。
  // 之前月亮在相反的一侧 (+Z), 和落日 (-Z) 交接时方向差接近 180°, 地上的影子会在交接的几分钟里横扫半个沙滩。
  const moonElevation = THREE.MathUtils.degToRad(16 + Math.sin(nightProgress * Math.PI) * 42);
  const cosElev = Math.cos(moonElevation);
  const x = 0.22 * cosElev;
  const y = Math.sin(moonElevation);
  const z = -0.98 * cosElev;
  return new THREE.Vector3(x, y, z).normalize();
}

/**
 * 根据 0.0 ~ 24.0 小时计算太阳（或夜间月球）的光线来向向量 (指向光源的单位向量)。
 * 保证向量经过归一化，且在任何时间点高度角连续、无跳跃、阴影平滑过渡。
 */
export function computeSunDirection(hour24: number): THREE.Vector3 {
  const h = ((hour24 % 24) + 24) % 24;

  // 按时间交接, 不按仰角: 仰角交接会在太阳刚贴海时就掺进月亮, 把落日又抬回半空。
  // 之前 17:30~19:30 把落日方向和月亮方向线性混合, 混出来的方向横着扫过头顶,
  // 地上所有影子在这两小时里从朝镜头转到朝侧面 —— 看着像被切开、像有好几盏灯。
  // 日落交接放在太阳已经落海之后 (18:10 起), 黄金时段 (17:45) 仍是纯落日, 不会被月亮抬回半空。
  // 月亮从落日沉下的同一侧升起, 交接时两个方向几乎重合。
  const DUSK_START = 18.17;
  const DUSK_END = 18.5;
  const DAWN_START = 6.5;
  const DAWN_END = 6.83;
  if (h >= DAWN_END && h <= DUSK_START) return getDaySun(h);
  if (h >= DUSK_END || h <= DAWN_START) return getNightMoon(h);
  const t = h < 12 ? smoothstep(DAWN_START, DAWN_END, h) : smoothstep(DUSK_END, DUSK_START, h);
  return new THREE.Vector3().lerpVectors(getNightMoon(h), getDaySun(h), t).normalize();
}

// ──────────────────────── 3. 时段权重与调色板插值 ────────────────────────

/**
 * 计算当前小时对 Day、Sunset、Night 三大基准色彩的插值权重 (三者之和恒等于 1.0)
 */
export function computeTimeWeights(hour24: number): { day: number; sunset: number; night: number } {
  const h = ((hour24 % 24) + 24) % 24;

  let day = 0;
  let sunset = 0;
  let night = 0;

  if (h >= 7.0 && h < 16.5) {
    // 纯白天
    day = 1.0;
  } else if (h >= 16.5 && h < 17.75) {
    // 白天 -> 落日黄金时段 (16:30 ~ 17:45)
    const t = smoothstep(16.5, 17.75, h);
    sunset = t;
    day = 1.0 - t;
  } else if (h >= 17.75 && h < 19.5) {
    // 落日 -> 暮色与初夜 (17:45 ~ 19:30)
    const t = smoothstep(17.75, 19.5, h);
    night = t;
    sunset = 1.0 - t;
  } else if (h >= 19.5 || h < 5.0) {
    // 纯深夜 (19:30 ~ 05:00)
    night = 1.0;
  } else if (h >= 5.0 && h < 6.0) {
    // 拂晓霞光 (05:00 ~ 06:00, 借用 Sunset 暖色)
    const t = smoothstep(5.0, 6.0, h);
    sunset = t;
    night = 1.0 - t;
  } else {
    // 06:00 ~ 07:00 晨光 -> 纯白昼
    const t = smoothstep(6.0, 7.0, h);
    day = t;
    sunset = 1.0 - t;
  }

  return { day, sunset, night };
}

/**
 * 插值两个数值
 */
function lerpVal(a: number, b: number, cVal: number, w: { day: number; sunset: number; night: number }): number {
  return a * w.day + b * w.sunset + cVal * w.night;
}

/**
 * 评估当前小时的最终色彩调色板对象（预分配复用，避免 GC）
 */
export function evaluateBeachPalette(
  hour24: number,
  outTarget?: BeachPaletteState,
): BeachPaletteState {
  const weights = computeTimeWeights(hour24);
  const out = outTarget ?? {
    skyZenith: new THREE.Color(),
    skyMid: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    skyHorizonGlow: new THREE.Color(),
    skyWaterMistColor: new THREE.Color(),
    skySunGlow: 0,
    skyCirrus: 0,
    skyHorizonBand: 0,
    seaShallow: new THREE.Color(),
    seaMid: new THREE.Color(),
    seaDeep: new THREE.Color(),
    seaHorizon: new THREE.Color(),
    seaFoam: new THREE.Color(),
    seaGlint: 0,
    sandBase: new THREE.Color(),
    sandShade: new THREE.Color(),
    sandLight: new THREE.Color(),
    sandWet: new THREE.Color(),
    mountainsFar: new THREE.Color(),
    mountainsMid: new THREE.Color(),
    mountainsNear: new THREE.Color(),
    cloudsTint: new THREE.Color(),
    cloudsOpacity: 1,
    leafLight: new THREE.Color(),
    leafShade: new THREE.Color(),
    trunkLight: new THREE.Color(),
    trunkShade: new THREE.Color(),
    bootColor: new THREE.Color(),
    coconutColor: new THREE.Color(),
    rockLight: new THREE.Color(),
    rockShade: new THREE.Color(),
    lighthouseGlow: 0.7,
    sunTint: new THREE.Color(),
    ambientMul: new THREE.Color(),
    highlight: new THREE.Color(),
    lightTint: new THREE.Color(),
    lightLevel: 1,
    shadowTint: new THREE.Color(),
    islandMist: new THREE.Color(),
    palmBase: new THREE.Color(),
    propFrame: new THREE.Color(),
    propCushion: new THREE.Color(),
    propStripe: new THREE.Color(),
    propCanopyA: new THREE.Color(),
    propCanopyB: new THREE.Color(),
    propPillow: new THREE.Color(),
    castleSand: new THREE.Color(),
    castleFlag: new THREE.Color(),
    lhBody: new THREE.Color(),
    lhBand: new THREE.Color(),
    lhRoof: new THREE.Color(),
    lhGlass: new THREE.Color(),
    lhRock: new THREE.Color(),
    keyLightColor: new THREE.Color(),
    keyLightScale: 1,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiScale: 1,
    fillColor: new THREE.Color(),
    fillScale: 1,
  };

  const blendColor = (dest: THREE.Color, d: THREE.Color, s: THREE.Color, n: THREE.Color): void => {
    dest.r = d.r * weights.day + s.r * weights.sunset + n.r * weights.night;
    dest.g = d.g * weights.day + s.g * weights.sunset + n.g * weights.night;
    dest.b = d.b * weights.day + s.b * weights.sunset + n.b * weights.night;
  };

  // 天空
  blendColor(out.skyZenith, PALETTE_DAY.skyZenith, PALETTE_SUNSET.skyZenith, PALETTE_NIGHT.skyZenith);
  blendColor(out.skyMid, PALETTE_DAY.skyMid, PALETTE_SUNSET.skyMid, PALETTE_NIGHT.skyMid);
  blendColor(out.skyHorizon, PALETTE_DAY.skyHorizon, PALETTE_SUNSET.skyHorizon, PALETTE_NIGHT.skyHorizon);
  blendColor(out.skyHorizonGlow, PALETTE_DAY.skyHorizonGlow, PALETTE_SUNSET.skyHorizonGlow, PALETTE_NIGHT.skyHorizonGlow);
  blendColor(out.skyWaterMistColor, PALETTE_DAY.skyWaterMistColor, PALETTE_SUNSET.skyWaterMistColor, PALETTE_NIGHT.skyWaterMistColor);
  out.skySunGlow = lerpVal(PALETTE_DAY.skySunGlow, PALETTE_SUNSET.skySunGlow, PALETTE_NIGHT.skySunGlow, weights);
  out.skyCirrus = lerpVal(PALETTE_DAY.skyCirrus, PALETTE_SUNSET.skyCirrus, PALETTE_NIGHT.skyCirrus, weights);
  out.skyHorizonBand = lerpVal(PALETTE_DAY.skyHorizonBand, PALETTE_SUNSET.skyHorizonBand, PALETTE_NIGHT.skyHorizonBand, weights);

  // 海水
  blendColor(out.seaShallow, PALETTE_DAY.seaShallow, PALETTE_SUNSET.seaShallow, PALETTE_NIGHT.seaShallow);
  blendColor(out.seaMid, PALETTE_DAY.seaMid, PALETTE_SUNSET.seaMid, PALETTE_NIGHT.seaMid);
  blendColor(out.seaDeep, PALETTE_DAY.seaDeep, PALETTE_SUNSET.seaDeep, PALETTE_NIGHT.seaDeep);
  blendColor(out.seaHorizon, PALETTE_DAY.seaHorizon, PALETTE_SUNSET.seaHorizon, PALETTE_NIGHT.seaHorizon);
  blendColor(out.seaFoam, PALETTE_DAY.seaFoam, PALETTE_SUNSET.seaFoam, PALETTE_NIGHT.seaFoam);
  out.seaGlint = lerpVal(PALETTE_DAY.seaGlint, PALETTE_SUNSET.seaGlint, PALETTE_NIGHT.seaGlint, weights);

  // 沙滩
  blendColor(out.sandBase, PALETTE_DAY.sandBase, PALETTE_SUNSET.sandBase, PALETTE_NIGHT.sandBase);
  blendColor(out.sandShade, PALETTE_DAY.sandShade, PALETTE_SUNSET.sandShade, PALETTE_NIGHT.sandShade);
  blendColor(out.sandLight, PALETTE_DAY.sandLight, PALETTE_SUNSET.sandLight, PALETTE_NIGHT.sandLight);
  blendColor(out.sandWet, PALETTE_DAY.sandWet, PALETTE_SUNSET.sandWet, PALETTE_NIGHT.sandWet);

  // 远山
  blendColor(out.mountainsFar, PALETTE_DAY.mountainsFar, PALETTE_SUNSET.mountainsFar, PALETTE_NIGHT.mountainsFar);
  blendColor(out.mountainsMid, PALETTE_DAY.mountainsMid, PALETTE_SUNSET.mountainsMid, PALETTE_NIGHT.mountainsMid);
  blendColor(out.mountainsNear, PALETTE_DAY.mountainsNear, PALETTE_SUNSET.mountainsNear, PALETTE_NIGHT.mountainsNear);

  // 云彩与植物
  blendColor(out.cloudsTint, PALETTE_DAY.cloudsTint, PALETTE_SUNSET.cloudsTint, PALETTE_NIGHT.cloudsTint);
  out.cloudsOpacity = lerpVal(PALETTE_DAY.cloudsOpacity, PALETTE_SUNSET.cloudsOpacity, PALETTE_NIGHT.cloudsOpacity, weights);
  blendColor(out.leafLight, PALETTE_DAY.leafLight, PALETTE_SUNSET.leafLight, PALETTE_NIGHT.leafLight);
  blendColor(out.leafShade, PALETTE_DAY.leafShade, PALETTE_SUNSET.leafShade, PALETTE_NIGHT.leafShade);
  blendColor(out.trunkLight, PALETTE_DAY.trunkLight, PALETTE_SUNSET.trunkLight, PALETTE_NIGHT.trunkLight);
  blendColor(out.trunkShade, PALETTE_DAY.trunkShade, PALETTE_SUNSET.trunkShade, PALETTE_NIGHT.trunkShade);
  blendColor(out.bootColor, PALETTE_DAY.bootColor, PALETTE_SUNSET.bootColor, PALETTE_NIGHT.bootColor);
  blendColor(out.coconutColor, PALETTE_DAY.coconutColor, PALETTE_SUNSET.coconutColor, PALETTE_NIGHT.coconutColor);

  // 礁石与道具
  blendColor(out.rockLight, PALETTE_DAY.rockLight, PALETTE_SUNSET.rockLight, PALETTE_NIGHT.rockLight);
  blendColor(out.rockShade, PALETTE_DAY.rockShade, PALETTE_SUNSET.rockShade, PALETTE_NIGHT.rockShade);
  out.lighthouseGlow = lerpVal(PALETTE_DAY.lighthouseGlow, PALETTE_SUNSET.lighthouseGlow, PALETTE_NIGHT.lighthouseGlow, weights);
  blendColor(out.sunTint, PALETTE_DAY.sunTint, PALETTE_SUNSET.sunTint, PALETTE_NIGHT.sunTint);

  // 场景统一光照
  blendColor(out.ambientMul, PALETTE_DAY.ambientMul, PALETTE_SUNSET.ambientMul, PALETTE_NIGHT.ambientMul);
  blendColor(out.highlight, PALETTE_DAY.highlight, PALETTE_SUNSET.highlight, PALETTE_NIGHT.highlight);
  blendColor(out.lightTint, PALETTE_DAY.lightTint, PALETTE_SUNSET.lightTint, PALETTE_NIGHT.lightTint);
  out.lightLevel = lerpVal(PALETTE_DAY.lightLevel, PALETTE_SUNSET.lightLevel, PALETTE_NIGHT.lightLevel, weights);
  blendColor(out.shadowTint, PALETTE_DAY.shadowTint, PALETTE_SUNSET.shadowTint, PALETTE_NIGHT.shadowTint);
  blendColor(out.islandMist, PALETTE_DAY.islandMist, PALETTE_SUNSET.islandMist, PALETTE_NIGHT.islandMist);

  // 棕榈树干根部的沙色: 由当前沙地色推出 (白天时正好等于着色器里原先写死的 0.95 / 0.87 / 0.74)。
  // 这样树干根部永远跟着沙滩走 —— 夜里不再是一圈白袜子, 黄昏也不再比沙滩还白。
  out.palmBase.setRGB(
    out.sandBase.r * PALM_BASE_BOOST.r,
    out.sandBase.g * PALM_BASE_BOOST.g,
    out.sandBase.b * PALM_BASE_BOOST.b,
  );

  // 道具
  blendColor(out.propFrame, PALETTE_DAY.propFrame, PALETTE_SUNSET.propFrame, PALETTE_NIGHT.propFrame);
  blendColor(out.propCushion, PALETTE_DAY.propCushion, PALETTE_SUNSET.propCushion, PALETTE_NIGHT.propCushion);
  blendColor(out.propStripe, PALETTE_DAY.propStripe, PALETTE_SUNSET.propStripe, PALETTE_NIGHT.propStripe);
  blendColor(out.propCanopyA, PALETTE_DAY.propCanopyA, PALETTE_SUNSET.propCanopyA, PALETTE_NIGHT.propCanopyA);
  blendColor(out.propCanopyB, PALETTE_DAY.propCanopyB, PALETTE_SUNSET.propCanopyB, PALETTE_NIGHT.propCanopyB);
  blendColor(out.propPillow, PALETTE_DAY.propPillow, PALETTE_SUNSET.propPillow, PALETTE_NIGHT.propPillow);

  // 沙堡: 湿沙色由当前沙地色压暗推出 (永远是同一种沙), 小旗单独配色
  out.castleSand.setRGB(
    out.sandBase.r * CASTLE_SAND_BOOST.r,
    out.sandBase.g * CASTLE_SAND_BOOST.g,
    out.sandBase.b * CASTLE_SAND_BOOST.b,
  );
  blendColor(out.castleFlag, PALETTE_DAY.castleFlag, PALETTE_SUNSET.castleFlag, PALETTE_NIGHT.castleFlag);

  // 灯塔
  blendColor(out.lhBody, PALETTE_DAY.lhBody, PALETTE_SUNSET.lhBody, PALETTE_NIGHT.lhBody);
  blendColor(out.lhBand, PALETTE_DAY.lhBand, PALETTE_SUNSET.lhBand, PALETTE_NIGHT.lhBand);
  blendColor(out.lhRoof, PALETTE_DAY.lhRoof, PALETTE_SUNSET.lhRoof, PALETTE_NIGHT.lhRoof);
  blendColor(out.lhGlass, PALETTE_DAY.lhGlass, PALETTE_SUNSET.lhGlass, PALETTE_NIGHT.lhGlass);
  blendColor(out.lhRock, PALETTE_DAY.lhRock, PALETTE_SUNSET.lhRock, PALETTE_NIGHT.lhRock);

  // 角色主光
  blendColor(out.keyLightColor, PALETTE_DAY.keyLightColor, PALETTE_SUNSET.keyLightColor, PALETTE_NIGHT.keyLightColor);
  out.keyLightScale = lerpVal(PALETTE_DAY.keyLightScale, PALETTE_SUNSET.keyLightScale, PALETTE_NIGHT.keyLightScale, weights);
  blendColor(out.hemiSky, PALETTE_DAY.hemiSky, PALETTE_SUNSET.hemiSky, PALETTE_NIGHT.hemiSky);
  blendColor(out.hemiGround, PALETTE_DAY.hemiGround, PALETTE_SUNSET.hemiGround, PALETTE_NIGHT.hemiGround);
  out.hemiScale = lerpVal(PALETTE_DAY.hemiScale, PALETTE_SUNSET.hemiScale, PALETTE_NIGHT.hemiScale, weights);
  blendColor(out.fillColor, PALETTE_DAY.fillColor, PALETTE_SUNSET.fillColor, PALETTE_NIGHT.fillColor);
  out.fillScale = lerpVal(PALETTE_DAY.fillScale, PALETTE_SUNSET.fillScale, PALETTE_NIGHT.fillScale, weights);

  return out;
}

/**
 * 将模式 ('auto' | 'day' | 'sunset' | 'night' | number) 转换为生效的小时数
 */
export function resolveEffectiveHour(mode: EnvironmentTimeMode | number): number {
  if (typeof mode === 'number') {
    return ((mode % 24) + 24) % 24;
  }
  switch (mode) {
    case 'day':
      return 12.0;
    case 'sunset':
      return 17.75; // 17:45 黄金夕阳时分
    case 'night':
      return 22.0;  // 22:00 深夜月色
    case 'auto':
    default: {
      const now = new Date();
      return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    }
  }
}
