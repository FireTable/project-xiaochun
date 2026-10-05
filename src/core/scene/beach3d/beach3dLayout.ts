/**
 * beach3dLayout.ts — 海滩 3D 场景的布局数据与岸线函数 (纯函数 / 纯数据, 无 three / DOM 依赖, 可直接单测)。
 *
 * 坐标约定 (与引擎一致): 角色站在原点, 脚底 y = 0; 相机只在 YZ 平面内绕角色俯仰 (水平方位锁定 0, 永远在 +Z 一侧),
 * 左右是角色自己转身 (bodyTurn), 所以场景只需要朝 −Z 方向布景: 近处沙滩 → 岸线 → 海 → 海平线上的远山。
 * 棕榈 / 草丛分布在画面两侧做框景, 中间留出角色的"禁区", 不会挡住角色。
 */

export interface ShoreParams {
  /** 正后方岸线 Z (m)。 */
  shoreZ: number;
  /** 两侧后弯系数。 */
  shoreCurve: number;
  /** 蜿蜒幅度 (m)。 */
  shoreWiggle: number;
}

/**
 * 岸线 (海水退到最远时的水边) 的 Z 坐标。沙地 = z > shoreLineZ(x), 海 = z < shoreLineZ(x)。
 * 与地面着色器里的 shoreBase() 完全同一公式 (改这里必须同步 beach3dShaders.ts)。
 */
export function shoreLineZ(x: number, p: ShoreParams): number {
  return p.shoreZ - p.shoreCurve * x * x + p.shoreWiggle * Math.sin(x * 0.21 + 1.3) + 0.35 * p.shoreWiggle * Math.sin(x * 0.57);
}

/** 棕榈: 世界位置 (x, z)、整体缩放、树干倾斜方向 (yaw, rad; 0 = 向 +X 倾斜)。 */
export interface PalmSpec {
  x: number;
  z: number;
  scale: number;
  yaw: number;
}

/** 草丛: 世界位置、缩放、朝向、是否开花。 */
export interface GrassSpec {
  x: number;
  z: number;
  scale: number;
  rot: number;
  flower: boolean;
}

/** 树干朝 (tx, tz) 方向倾斜的 yaw (树干局部 +X = 倾斜方向; Three 绕 Y 正转: x' = x·cos + z·sin, z' = −x·sin + z·cos)。 */
function yawToward(x: number, z: number, tx: number, tz: number): number {
  const dx = tx - x;
  const dz = tz - z;
  return Math.atan2(-dz, dx);
}

/**
 * 棕榈布局: 左右各 5 棵, 由近到远; 最前的一对向画面中心倾斜, 叶冠在竖屏上角入画、横屏两侧形成框景。
 * 全部种在沙地上 (单测校验 z > 岸线 + 0.8m), 且离角色 ≥ 2.4m。
 */
export const PALMS: readonly PalmSpec[] = [
  { x: -2.1, z: -3.0, scale: 0.86, yaw: yawToward(-2.1, -3.0, 0, 0.5) },
  { x: -3.7, z: -4.8, scale: 0.92, yaw: yawToward(-3.7, -4.8, 0, -3) },
  { x: -8.4, z: -6.0, scale: 1.12, yaw: yawToward(-8.4, -6.0, -3, -8) },
  { x: -12.8, z: -9.2, scale: 1.0, yaw: yawToward(-12.8, -9.2, -6, -14) },
  { x: -18.5, z: -13.5, scale: 1.18, yaw: yawToward(-18.5, -13.5, -10, -20) },
  { x: 2.3, z: -3.4, scale: 0.9, yaw: yawToward(2.3, -3.4, 0, 0.3) },
  { x: 4.0, z: -4.5, scale: 0.9, yaw: yawToward(4.0, -4.5, 1, -6) },
  { x: 9.2, z: -7.4, scale: 1.1, yaw: yawToward(9.2, -7.4, 4, -10) },
  { x: 14.0, z: -10.6, scale: 0.96, yaw: yawToward(14.0, -10.6, 8, -15) },
  { x: 20.5, z: -15.5, scale: 1.14, yaw: yawToward(20.5, -15.5, 12, -22) },
];

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

/** 角色禁区: 草丛不进 |x| < GRASS_KEEP_OUT_X 且 z > −2.2 的区域 (避免挡腿 / 挡脚下落影)。 */
export const GRASS_KEEP_OUT_X = 1.0;

/**
 * 草丛布局 (确定性随机): 近处 6 棵棕榈脚下各 1~2 簇 + 两侧前景 4 簇 + 两侧沙地边缘零散 6 簇, 共约 20 簇 (点缀, 不铺满)。
 * 全部在沙地上、不进角色禁区。
 */
export function buildGrassLayout(shore: ShoreParams): GrassSpec[] {
  const rnd = mulberry32(0xbeac3d);
  const out: GrassSpec[] = [];
  const push = (x: number, z: number, scale: number) => {
    if (Math.abs(x) < GRASS_KEEP_OUT_X && z > -2.2) return;
    if (z < shoreLineZ(x, shore) + 0.8) return;
    out.push({ x, z, scale, rot: rnd() * Math.PI * 2, flower: rnd() < 0.4 });
  };
  const near = [...PALMS].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, 6);
  for (const p of near) {
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.4 + rnd() * 0.5;
      push(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 0.5 + rnd() * 0.25);
    }
  }
  // 前景两侧 (横屏下角 / 拉远时的点缀)
  const front: Array<[number, number, number]> = [[-1.6, -2.0, 0.5], [-2.5, -0.5, 0.58], [1.7, -2.3, 0.5], [2.7, -0.2, 0.58]];
  for (const [x, z, s] of front) push(x + (rnd() - 0.5) * 0.2, z + (rnd() - 0.5) * 0.2, s);
  // 两侧沙地边缘零散
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    push(side * (3.5 + rnd() * 10), -1.5 - rnd() * 7, 0.45 + rnd() * 0.3);
  }
  return out;
}

/** 远山峰: 方位角 (°, 0 = 正后方 −Z, 正 = 向 +X)、高度 (m, 在半径处)、半宽 (°)。 */
export interface PeakSpec {
  az: number;
  h: number;
  w: number;
}

/** 远层 (淡薰衣草蓝的远山): 两侧较高, 角色正后方 (|az| < 8°) 只有很低的山脊, 留出开阔海面。 */
export const FAR_PEAKS: readonly PeakSpec[] = [
  { az: -52, h: 6.5, w: 16 },
  { az: -34, h: 8.6, w: 14 },
  { az: -18, h: 4.6, w: 12 },
  { az: -4, h: 1.6, w: 10 },
  { az: 16, h: 3.2, w: 10 },
  { az: 30, h: 7.4, w: 13 },
  { az: 47, h: 5.6, w: 15 },
];

/** 近层 (淡松石绿的小岛)。 */
export const NEAR_PEAKS: readonly PeakSpec[] = [
  { az: -44, h: 2.6, w: 9 },
  { az: -26, h: 1.5, w: 6 },
  { az: 20, h: 3.0, w: 8 },
  { az: 33, h: 1.8, w: 7 },
];

/** 山脊高度 (m): 各峰 "抛物线帽" 取最大, 再叠一点确定性的小起伏; 低于 0 截为 0 (没有山的方位 = 海平线)。 */
export function ridgeHeight(azDeg: number, peaks: readonly PeakSpec[], heightScale = 1): number {
  let h = 0;
  for (const p of peaks) {
    const t = Math.abs(azDeg - p.az) / p.w;
    if (t < 1) h = Math.max(h, p.h * (1 - Math.pow(t, 1.6)));
  }
  if (h > 0) h += 0.25 * Math.sin(azDeg * 0.9) * Math.min(1, h) + 0.12 * Math.sin(azDeg * 2.3);
  return Math.max(0, h * heightScale);
}

/** 礁石: 世界位置、尺寸 (m, 半径)、压扁比例、朝向、是否在水里 (在水里的周围画一圈白浪)。 */
export interface RockSpec {
  x: number;
  z: number;
  r: number;
  squash: number;
  rot: number;
  inWater: boolean;
}

/**
 * 礁石布局: 两侧岸边成簇散落 (每簇 2~3 块, 大小错落), 一部分半浸在浅水里; 角色正后方 |x| < 2.2 不放, 留出干净的海面。
 * z 相对岸线给出 (负 = 在水里), 所以改岸线参数礁石会跟着岸走。
 */
export function buildRockLayout(shore: ShoreParams): RockSpec[] {
  const rnd = mulberry32(0x70c4);
  const clusters: Array<[number, number, number]> = [
    // [x, 相对岸线的 z 偏移 (m), 簇大小]
    [-3.4, -0.9, 0.55], [-6.2, 0.6, 0.8], [-9.8, -1.2, 0.7], [-13.5, 0.9, 0.9],
    [3.6, -1.1, 0.5], [6.8, 0.4, 0.85], [10.6, -1.4, 0.75], [15.5, 0.7, 0.95],
  ];
  const out: RockSpec[] = [];
  for (const [cx, dz, size] of clusters) {
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const x = cx + (rnd() - 0.5) * 1.4 * size;
      if (Math.abs(x) < 2.2) continue;
      const z = shoreLineZ(x, shore) + dz + (rnd() - 0.5) * 0.9 * size;
      const r = size * (i === 0 ? 0.75 + rnd() * 0.25 : 0.3 + rnd() * 0.3);
      out.push({ x, z, r, squash: 0.55 + rnd() * 0.3, rot: rnd() * Math.PI * 2, inWater: z < shoreLineZ(x, shore) - 0.1 });
    }
  }
  return out;
}
