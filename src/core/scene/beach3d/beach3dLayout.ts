/**
 * beach3dLayout.ts — 海滩 3D 场景的布局数据与岸线函数 (纯函数 / 纯数据, 无 three / DOM 依赖, 可直接单测)。
 *
 * 坐标约定 (与引擎一致): 角色站在原点, 脚底 y = 0; 相机只在 YZ 平面内绕角色俯仰 (水平方位锁定 0, 永远在 +Z 一侧),
 * 左右是角色自己转身 (bodyTurn), 所以场景只需要朝 −Z 方向布景: 近处沙滩 → 岸线 → 海 → 海平线上的远岛。
 * 构图刻意不对称 (二次元背景的"不规则三角"构图): 左侧一簇高矮错落的棕榈, 右侧一棵框景棕榈 + 沙滩椅 / 遮阳伞;
 * 中间留出角色的"禁区", 不会挡住角色。
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

// ───────────────────────── 棕榈 ─────────────────────────

/** 树干基准参数: 高 H (m), 顶部相对底部的水平偏移 LEAN (m, 沿局部 +X), 根部 / 顶部半径 (m)。每棵树再乘自己的 height / lean。 */
export const PALM_TRUNK = { height: 3.6, lean: 1.5, r0: 0.18, r1: 0.095 } as const;

/** 树干中心线的倾斜剖面 (t ∈ [0,1] → 0..1): 根部近乎竖直 (smoothstep 两端斜率 0 → S 形), 上半段 t² 让整体更倾。 */
export function trunkLeanProfile(t: number): number {
  const s = t * t * (3 - 2 * t);
  return 0.65 * s + 0.35 * t * t;
}

/**
 * 棕榈: 世界位置 (x, z)、整体缩放、树干倾斜方向 (yaw, rad; 0 = 向 +X 倾斜)、
 * 树干高度倍率 height (只拉长树干, 不变粗)、倾斜倍率 lean (0 = 笔直, 1 = 基准 1.5m 偏移)、叶冠自转 spin (rad)。
 */
export interface PalmSpec {
  x: number;
  z: number;
  scale: number;
  yaw: number;
  height: number;
  lean: number;
  spin: number;
}

/** 树干朝 (tx, tz) 方向倾斜的 yaw (树干局部 +X = 倾斜方向; Three 绕 Y 正转: x' = x·cos + z·sin, z' = −x·sin + z·cos)。 */
function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tz - z), tx - x);
}

function palm(x: number, z: number, scale: number, height: number, lean: number, tx: number, tz: number, spin: number): PalmSpec {
  return { x, z, scale, yaw: yawToward(x, z, tx, tz), height, lean, spin };
}

/**
 * 棕榈布局 (共 10 棵, 左 6 右 4, 刻意不对称):
 *   竖屏全身镜头里: 左侧 2 棵 (近处一棵向海面 / 画面中心斜出, 后面一棵伴生的更高更直),
 *   右侧只有一棵向外侧斜出的框景棕榈 (树干入画, 叶冠一半在画外); 右侧近处留给沙滩椅 + 遮阳伞。
 *   横屏 / 广角时两侧再各露出几棵间距、高矮、倾斜都不同的远树。
 * 全部种在沙地上 (单测校验 z > 岸线 + 0.8m), 且离角色 ≥ 2.4m, 叶冠不悬在角色正上方。
 */
export const PALMS: readonly PalmSpec[] = [
  // 左侧簇 (竖屏可见)
  palm(-2.9, -1.6, 1.05, 1.0, 1.15, 0.5, -4.5, 0.3),
  palm(-3.3, -4.3, 0.95, 1.25, 0.45, -6.0, -7.0, 2.1),
  // 右侧框景 (竖屏可见)
  palm(3.6, -4.0, 1.12, 1.15, 0.8, 6.0, -6.0, 1.2),
  // 横屏 / 广角才看得到的远树
  palm(-7.2, -2.4, 1.0, 0.95, 0.9, -3.0, -6.0, 5.3),
  palm(-10.8, -6.2, 0.9, 1.15, 0.7, -14.0, -10.0, 0.9),
  palm(-12.2, -4.6, 1.1, 1.0, 1.2, -8.0, -9.0, 3.3),
  palm(-18.0, -11.0, 1.15, 1.1, 0.8, -12.0, -16.0, 2.6),
  palm(8.8, -5.0, 1.0, 1.1, 1.0, 5.0, -9.0, 4.0),
  palm(14.5, -9.5, 0.85, 0.9, 1.3, 10.0, -13.0, 0.4),
  palm(21.0, -15.5, 1.1, 1.05, 0.9, 16.0, -20.0, 1.8),
];

/** 树干顶端 (叶冠挂点) 的世界坐标 (局部坐标系, 角色在原点)。 */
export function palmTop(p: PalmSpec): { x: number; y: number; z: number } {
  const off = PALM_TRUNK.lean * p.lean * p.scale;
  return { x: p.x + off * Math.cos(p.yaw), y: PALM_TRUNK.height * p.height * p.scale, z: p.z - off * Math.sin(p.yaw) };
}

// ───────────────────────── 沙滩椅 + 遮阳伞 ─────────────────────────

/**
 * 沙滩躺椅: 中心 (x, z), 朝向 yaw (rad; 0 = 脚朝 −Z 正对大海, 正值 = 脚略朝画面中心偏)。椅子局部: 头端 (靠背) 在 +Z, 脚端在 −Z。
 * 放在角色右后方: 竖屏全身镜头里在角色右侧完整入画, 不挡角色 (离角色 ≥ 1.8m, 且整体在角色身后)。
 */
export const CHAIR = { x: 1.95, z: -2.9, yaw: 0.3, length: 1.9, width: 0.66 } as const;

/** 遮阳伞: 插在椅子头端外侧 (椅子局部坐标 lx, lz), 伞顶高 height (沿伞杆), 伞骨长 radius, 向椅子一侧倾斜 tilt (rad)。 */
export const PARASOL = { lx: 0.5, lz: 0.72, height: 1.78, radius: 0.76, tilt: 0.14 } as const;

/** 椅子局部坐标 → 世界 (局部坐标系)。 */
export function chairToWorld(lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(CHAIR.yaw), s = Math.sin(CHAIR.yaw);
  return { x: CHAIR.x + lx * c + lz * s, z: CHAIR.z - lx * s + lz * c };
}

/** 遮阳伞伞面中心的世界坐标与高度 (伞杆向椅子一侧倾斜后)。 */
export function parasolCanopy(): { x: number; y: number; z: number; r: number } {
  const top = chairToWorld(PARASOL.lx - Math.sin(PARASOL.tilt) * PARASOL.height, PARASOL.lz);
  return { x: top.x, y: Math.cos(PARASOL.tilt) * PARASOL.height, z: top.z, r: PARASOL.radius };
}

/** 点是否在沙滩椅 + 遮阳伞的占地范围内 (贝壳 / 礁石避开用), margin 外扩 (m)。 */
export function insideChairFootprint(x: number, z: number, margin = 0): boolean {
  const c = Math.cos(CHAIR.yaw), s = Math.sin(CHAIR.yaw);
  const dx = x - CHAIR.x, dz = z - CHAIR.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  if (Math.abs(lx) < CHAIR.width / 2 + margin && Math.abs(lz) < CHAIR.length / 2 + margin) return true;
  const pole = chairToWorld(PARASOL.lx, PARASOL.lz);
  return Math.hypot(x - pole.x, z - pole.z) < 0.15 + margin;
}

// ───────────────────────── 沙堡 ─────────────────────────

/**
 * 沙堡的占地半径 (m, scale = 1): 方形底台 0.52 × 0.44m 的半对角线 (≈ 0.34m), 连同门前的小坡道一共约 0.36m。
 * 贝壳 / 海星避开这个圆 (再外扩一点 margin)。
 */
export const SANDCASTLE_RADIUS = 0.36;

/** 沙堡摆放 (局部坐标, 角色在原点): 世界位置 (x, z)、大小倍率、朝向 (rad, 0 = 城门朝 +Z 即镜头方向)。 */
export interface SandcastlePlacement {
  x: number;
  z: number;
  scale: number;
  yaw: number;
}

/** 把配置 (APP_CONFIG.beach3dScene.sandcastle) 夹到合法范围: x −3 ~ 3, z 0.6 ~ 3.5, scale 0.6 ~ 1.6, yawDeg −180 ~ 180。 */
export function sandcastlePlacement(c: { x: number; z: number; scale: number; yawDeg: number }): SandcastlePlacement {
  const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  return { x: cl(c.x, -3, 3), z: cl(c.z, 0.6, 3.5), scale: cl(c.scale, 0.6, 1.6), yaw: (cl(c.yawDeg, -180, 180) * Math.PI) / 180 };
}

/** 点是否在沙堡的占地圆内, margin 外扩 (m)。castle = null 时永远 false。 */
export function insideSandcastleFootprint(x: number, z: number, castle: SandcastlePlacement | null, margin = 0): boolean {
  if (!castle) return false;
  return Math.hypot(x - castle.x, z - castle.z) < SANDCASTLE_RADIUS * castle.scale + margin;
}

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

// ───────────────────────── 远岛 (天空层里逐像素画的剪影) ─────────────────────────

/**
 * 远岛山峰 (角度单位, 逐像素在着色器里求值): 方位角 az (°, 0 = 正后方 −Z, 正 = 向 +X)、
 * 峰高 h (° 仰角, 在可见海平线之上)、半宽 w (°)、形状 shape (0 = 圆润穹顶, 1 = 尖峰火山形)、偏斜 skew (−0.6 ~ 0.6, 正 = 右坡更缓更长)。
 */
export interface IslandPeak {
  az: number;
  h: number;
  w: number;
  shape: number;
  skew: number;
}

/**
 * 远岛只在左侧 (方位 < 0): 右侧海平线留给海上的小灯塔 (APP_CONFIG.beach3dScene.lighthouse), 不再有山。
 * 远层 (最淡, 几乎融进天边的薰衣草青雾): 左侧连绵的低山脊, 角色正后方 (|az| < 5°) 只有极低的影子, 留出开阔海面。
 */
export const FAR_ISLANDS: readonly IslandPeak[] = [
  { az: -40, h: 2.4, w: 15, shape: 0.2, skew: 0.3 },
  { az: -19, h: 3.0, w: 9, shape: 0.45, skew: -0.35 },
  { az: -8.5, h: 1.2, w: 6, shape: 0.2, skew: 0.4 },
];

/** 中层 (灰蓝绿, 叠一层雾): 左侧一座不对称的火山形岛 + 一座低岛。 */
export const MID_ISLANDS: readonly IslandPeak[] = [
  { az: -14.5, h: 2.0, w: 6.5, shape: 0.55, skew: 0.45 },
  { az: -24, h: 0.9, w: 5, shape: 0.2, skew: -0.3 },
];

/** 近层 (薄荷青绿, 顶上一排树冠鼓包): 只在左侧较远的方位 (竖屏正面看不到, 横屏 / 广角才入画)。 */
export const NEAR_ISLANDS: readonly IslandPeak[] = [
  { az: -31, h: 0.75, w: 4.5, shape: 0.2, skew: -0.2 },
];

/** 一座岛在方位 azDeg 处的平滑剖面高度 (°) —— 与 ISLAND_FRAG 里 islandProfile() 同一公式 (单测 / 预算用)。 */
export function islandProfile(azDeg: number, p: IslandPeak): number {
  const d = azDeg - p.az;
  const w = p.w * (d > 0 ? 1 + p.skew : 1 - p.skew);
  const t = Math.abs(d) / w;
  if (t >= 1) return 0;
  const dome = Math.pow(1 - t * t, 0.7);
  const peak = Math.pow(1 - t, 1.7);
  return p.h * (dome + (peak - dome) * p.shape);
}

/** 一层岛屿的平滑剖面 (多座取最大)。 */
export function islandRidge(azDeg: number, peaks: readonly IslandPeak[]): number {
  let h = 0;
  for (const p of peaks) h = Math.max(h, islandProfile(azDeg, p));
  return h;
}

// ───────────────────────── 云 ─────────────────────────

/** 云的种类 = 云图集里的哪一张手绘云: 0 高耸积云, 1 宽积云, 2 扁长低云, 3 小云簇。 */
export type CloudKind = 0 | 1 | 2 | 3;

/**
 * 云图集 (APP_CONFIG.beach3dScene.assets.clouds, 1024×1024) 里每张云的格子: [u0, v0, du, dv] (v 从图片顶边往下, 贴图不翻转),
 * aspect = 格子高 / 宽 (像素)。格子四周各留 14px 透明边。由手绘 2×2 云图抠图 (按蓝底颜色距离 + 软过渡 + 去蓝边) 后打包生成。
 */
export const CLOUD_SPRITES: readonly { rect: readonly [number, number, number, number]; aspect: number }[] = [
  { rect: [0.0, 0.0, 0.57031, 0.40918], aspect: 0.71747 },
  { rect: [0.0, 0.41113, 0.5918, 0.26172], aspect: 0.44224 },
  { rect: [0.0, 0.6748, 0.6543, 0.17578], aspect: 0.26866 },
  { rect: [0.57227, 0.0, 0.2666, 0.18262], aspect: 0.68498 },
];

/** 云: 方位 az (°)、底边仰角 el (°, 可见海平线之上)、宽度 w (°, 贴图格子的宽)、种类 (哪张手绘云)、随机种子 (0..1: 左右翻转 / 冷暖 / 漂移速度)。 */
export interface CloudSpec {
  az: number;
  el: number;
  w: number;
  kind: CloudKind;
  seed: number;
}

/**
 * 手工构图的"主角云" (正前方 ±30°): 竖屏全身镜头里角色右侧一朵高耸积云、左侧一朵宽积云、头顶上方一小簇,
 * 两侧贴着海平线的扁长低云; 仰头时再看到三朵高云。同一张贴图出现两次时用翻转 / 大小 / 冷暖错开。
 */
export const HERO_CLOUDS: readonly CloudSpec[] = [
  { az: 8.5, el: 2.4, w: 11, kind: 0, seed: 0.137 },
  { az: -9, el: 4.6, w: 11, kind: 1, seed: 0.618 },
  { az: 0.5, el: 12.5, w: 4.5, kind: 3, seed: 0.271 },
  { az: -17, el: 1.0, w: 13, kind: 2, seed: 0.833 },
  { az: 19, el: 0.8, w: 11, kind: 2, seed: 0.459 },
  { az: 30, el: 4.5, w: 15, kind: 1, seed: 0.905 },
  { az: -28, el: 2.0, w: 14, kind: 0, seed: 0.362 },
  { az: 3, el: 20, w: 13, kind: 1, seed: 0.744 },
  { az: -16, el: 27, w: 5.5, kind: 3, seed: 0.551 },
  { az: 15, el: 33, w: 14, kind: 2, seed: 0.566 },
  { az: -4, el: 40, w: 9, kind: 3, seed: 0.212 },
];

/** density = 1 时主角区之外的散云数量。 */
export const CLOUD_FILLERS = 16;

/**
 * 全部云: 主角云 + 其余方位的散云 (round(16 × density) 朵), 按底边仰角从低到高 (= 从远到近) 排序, 高处 (近) 的云叠在低处 (远) 的云前面。
 * 仰角 0.8° ~ 40°: 底边永远在可见海平线之上, 面片在仰视极限时也不退化。确定性随机。
 */
export function buildCloudLayout(density: number): CloudSpec[] {
  const out: CloudSpec[] = HERO_CLOUDS.map((c) => ({ ...c }));
  const n = Math.max(0, Math.round(CLOUD_FILLERS * Math.min(2, Math.max(0, density))));
  const rnd = mulberry32(0xc10d);
  for (let i = 0; i < n; i++) {
    // 主角区 (|az| < 32°) 之外的 296° 均布 + 抖动
    const az = 32 + ((i + 0.2 + rnd() * 0.6) / Math.max(1, n)) * 296;
    const r = rnd();
    const kind: CloudKind = r < 0.25 ? 0 : r < 0.55 ? 1 : r < 0.8 ? 2 : 3;
    const el = kind === 0 ? 1.5 + rnd() * 7 : kind === 1 ? 2 + rnd() * 18 : kind === 2 ? 0.8 + rnd() * 30 : 6 + rnd() * 30;
    const w = (kind === 0 ? 12 : kind === 1 ? 11 : kind === 2 ? 12 : 5.5) * (0.8 + rnd() * 0.4);
    out.push({ az: az > 180 ? az - 360 : az, el, w, kind, seed: rnd() });
  }
  return out.sort((a, b) => a.el - b.el);
}

// ───────────────────────── 礁石 ─────────────────────────

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
    // [x, 相对岸线的 z 偏移 (m), 簇大小] —— 左右不对称: 左侧近处一簇大的, 右侧礁石更少更远
    [-3.6, -0.9, 0.62], [-6.4, 0.6, 0.8], [-9.8, -1.2, 0.7], [-13.5, 0.9, 0.9],
    [4.6, -1.3, 0.45], [7.4, 0.3, 0.8], [11.8, -1.4, 0.75], [16.5, 0.7, 0.95],
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

// ───────────────────────── 贝壳 ─────────────────────────

/** 扇贝: 世界位置、大小 (m, 约等于壳宽)、朝向、颜色序号 (APP_CONFIG.beach3dScene.shells.colors 的下标: 前两个白 / 奶白更常见, 后面的粉彩少一些)。 */
export interface ShellSpec {
  x: number;
  z: number;
  size: number;
  rot: number;
  color: number;
}

/** 贝壳离角色 (原点) 至少多远 (m), 避开脚下。 */
export const SHELL_KEEP_OUT = 1.2;

/** 近景大扇贝的数量 (相机附近只放两个更大、一眼认得出的; 其余稀疏地散在湿沙线附近)。 */
export const SHELL_HERO_COUNT = 2;

/**
 * 扇贝布局 (确定性随机, 稀疏自然):
 *   - 先放 SHELL_HERO_COUNT 个近景大扇贝: 角色两侧偏前 (相机这一侧), 竖屏全身镜头里在脚边一左一右, 大小约 1.6 倍;
 *   - 其余沿整条海岸自然分布: 横向集中在画面中部 (|x| 越大越稀), 纵向越靠近湿沙线越密 (约 55% 在湿线上方 1.2m 内,
 *     30% 在其后 3m 内, 其余零星散在干沙上), 一律在冲刷浪推不到的地方 (不被浪膜盖住)。
 *   避开角色脚下 (SHELL_KEEP_OUT)、棕榈根部、沙滩椅 / 伞杆、沙堡 (castle, 占地圆再外扩 0.15m), 彼此至少相隔 0.8m (稀疏, 不扎堆)。
 */
export function buildShellLayout(count: number, shore: ShoreParams, swashAmp: number, castle: SandcastlePlacement | null = null): ShellSpec[] {
  const rnd = mulberry32(0x5e11);
  const out: ShellSpec[] = [];
  const n = Math.max(0, Math.min(30, Math.round(count)));
  const wetTop = swashAmp * 1.35 + 0.15; // 冲刷浪最远推到岸线以上约 1.35 × 幅度
  const ok = (x: number, z: number, gap: number) =>
    Math.hypot(x, z) >= SHELL_KEEP_OUT &&
    z > shoreLineZ(x, shore) + wetTop &&
    !PALMS.some((p) => Math.hypot(p.x - x, p.z - z) < 0.6) &&
    !insideChairFootprint(x, z, 0.2) &&
    !insideSandcastleFootprint(x, z, castle, 0.15) &&
    !out.some((o) => Math.hypot(o.x - x, o.z - z) < gap);
  // 颜色: 白 / 奶白占大多数 (约 2/3), 浅粉 / 浅珊瑚零星几个
  const colorOf = (r: number) => (r < 0.36 ? 0 : r < 0.68 ? 1 : r < 0.85 ? 2 : 3);
  // 近景大扇贝: 固定的落点附近抖动 (左右各一个, 前后错开)
  const heroSpots: Array<[number, number]> = [[0.95, 2.3], [-1.35, 1.1]];
  for (const [hx, hz] of heroSpots.slice(0, Math.min(SHELL_HERO_COUNT, n))) {
    const x = hx + (rnd() - 0.5) * 0.3;
    const z = hz + (rnd() - 0.5) * 0.3;
    if (!ok(x, z, 0.5)) continue;
    out.push({ x, z, size: 0.15 * (0.9 + rnd() * 0.2), rot: rnd() * Math.PI * 2, color: colorOf(rnd()) });
  }
  for (let tries = 0; out.length < n && tries < n * 40; tries++) {
    // 横向: 两个均匀数之和 → 三角分布, 中部密两侧稀; 范围 ±16m
    const x = (rnd() + rnd() - 1) * 16;
    const band = rnd();
    const dz = band < 0.55 ? rnd() * 1.2 : band < 0.85 ? 1.2 + rnd() * 3 : 4.2 + rnd() * 4;
    const z = shoreLineZ(x, shore) + wetTop + 0.05 + dz;
    if (z > 6) continue;
    if (!ok(x, z, 0.8)) continue;
    const size = 0.085 * (0.75 + rnd() * 0.5); // 比真实略大一点 (卡通夸张), 远处才认得出
    out.push({ x, z, size, rot: rnd() * Math.PI * 2, color: colorOf(rnd()) });
  }
  return out;
}
