/**
 * beach3dLayout.ts — 海滩 3D 场景的布局数据与岸线函数 (纯函数 / 纯数据, 无 three / DOM 依赖, 可直接单测)。
 *
 * 坐标约定 (与引擎一致): 角色站在原点, 脚底 y = 0; 相机只在 YZ 平面内绕角色俯仰 (水平方位锁定 0, 永远在 +Z 一侧),
 * 左右是角色自己转身 (bodyTurn), 所以场景只需要朝 −Z 方向布景: 近处沙滩 → 岸线 → 海 → 海平线上的远山。
 * 棕榈 / 礁石分布在画面两侧, 中间留出角色的"禁区", 不会挡住角色。
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

/** 远山峰: 方位角 (°, 0 = 正后方 −Z, 正 = 向 +X)、高度 (m, 在半径处)、半宽 (°)。 */
export interface PeakSpec {
  az: number;
  h: number;
  w: number;
}

/** 远层岛屿 (最淡, 几乎融进天边的青白雾里): 两侧较高, 角色正后方 (|az| < 8°) 只有很低的岛影, 留出开阔海面。 */
export const FAR_PEAKS: readonly PeakSpec[] = [
  { az: -50, h: 6.0, w: 17 },
  { az: -30, h: 7.6, w: 13 },
  { az: -14, h: 3.4, w: 10 },
  { az: -2, h: 1.4, w: 7 },
  { az: 18, h: 3.6, w: 11 },
  { az: 34, h: 6.8, w: 14 },
  { az: 52, h: 5.0, w: 15 },
];

/** 中层岛屿 (柔和的绿, 带一层浅雾)。 */
export const MID_PEAKS: readonly PeakSpec[] = [
  { az: -42, h: 4.2, w: 11 },
  { az: -24, h: 2.6, w: 8 },
  { az: 24, h: 4.6, w: 10 },
  { az: 44, h: 2.8, w: 9 },
];

/** 近层小岛 (最饱和的绿, 树冠鼓包最明显)。 */
export const NEAR_PEAKS: readonly PeakSpec[] = [
  { az: -34, h: 2.2, w: 6.5 },
  { az: -55, h: 1.4, w: 5 },
  { az: 31, h: 2.5, w: 7 },
  { az: 13, h: 1.0, w: 4 },
];

/**
 * 岛屿剪影高度 (m): 每座岛是一个圆润的穹顶 (h · (1 − t²)^0.7), 多座取最大; bump > 0 时顶上再叠一排大小不一的圆鼓包
 * (卡通岛上的树冠轮廓, bumpW = 鼓包平均宽度 °); 低于 0 截为 0 (没有岛的方位 = 海平线)。
 */
export function ridgeHeight(azDeg: number, peaks: readonly PeakSpec[], heightScale = 1, bump = 0, bumpW = 1.6): number {
  let h = 0;
  for (const p of peaks) {
    const t = Math.abs(azDeg - p.az) / p.w;
    if (t < 1) h = Math.max(h, p.h * Math.pow(1 - t * t, 0.7));
  }
  if (h <= 0) return 0;
  h += 0.15 * Math.sin(azDeg * 0.9) * Math.min(1, h);
  if (bump > 0) {
    const u = azDeg / bumpW + 0.6 * Math.sin(azDeg * 0.23) + 0.3 * Math.sin(azDeg * 0.71);
    const f = u - Math.floor(u);
    const amp = bump * (0.6 + 0.4 * Math.sin(Math.floor(u) * 12.9898) ** 2);
    h += amp * (Math.sqrt(Math.sin(Math.PI * f)) - 0.75) * Math.min(1, h / 0.8);
  }
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

/** 贝壳类小物件: 0 扇贝, 1 海螺, 2 海星。 */
export type ShellKind = 0 | 1 | 2;

/** 沙滩小物件: 世界位置、种类、大小 (m, 约等于半径)、朝向、颜色序号 (0 奶白 / 1 浅粉 / 2 浅珊瑚)。 */
export interface ShellSpec {
  x: number;
  z: number;
  kind: ShellKind;
  size: number;
  rot: number;
  color: number;
}

/** 贝壳离角色 (原点) 至少多远 (m), 避开脚下。 */
export const SHELL_KEEP_OUT = 1.2;

/**
 * 贝壳布局: 稀疏、自然随机; 约 3/4 落在湿沙带上沿 (冲刷浪推不到的地方, 不会被浪膜盖住), 其余零星散在干沙上。
 * 避开角色脚下 (SHELL_KEEP_OUT) 和棕榈根部。确定性随机 (每次一样)。
 */
export function buildShellLayout(count: number, shore: ShoreParams, swashAmp: number): ShellSpec[] {
  const rnd = mulberry32(0x5e11);
  const out: ShellSpec[] = [];
  const n = Math.max(0, Math.min(60, Math.round(count)));
  const wetTop = swashAmp * 1.35 + 0.15; // 冲刷浪最远推到岸线以上约 1.35 × 幅度
  for (let tries = 0; out.length < n && tries < n * 20; tries++) {
    const x = (rnd() - 0.5) * 30;
    const onWet = rnd() < 0.75;
    const z = shoreLineZ(x, shore) + wetTop + (onWet ? rnd() * 1.1 : 1.1 + rnd() * 4.5);
    if (Math.hypot(x, z) < SHELL_KEEP_OUT) continue;
    if (PALMS.some((p) => Math.hypot(p.x - x, p.z - z) < 0.6)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 0.5)) continue;
    const r = rnd();
    const kind: ShellKind = r < 0.45 ? 0 : r < 0.75 ? 1 : 2;
    const size = (kind === 2 ? 0.1 : 0.08) * (0.7 + rnd() * 0.6); // 比真实略大一点 (卡通夸张), 远处才认得出
    out.push({ x, z, kind, size, rot: rnd() * Math.PI * 2, color: Math.floor(rnd() * 3) });
  }
  return out;
}
