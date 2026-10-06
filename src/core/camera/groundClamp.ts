/**
 * groundClamp — 相机不穿地 (纯函数, 不依赖 three.js 对象, 便于单测)。
 *
 * 相机只做俯仰环绕 (方位锁正前方), 位置 = 目标点 + 视距 × (0, cos 极角, sin 极角)。极限仰视 + 视距较远时,
 * 这个位置会落到地面 (y = 0) 以下: 地面被背面剔除, 线稿地板 / 海滩沙地看起来像透明的。
 *
 * 解法: 俯仰角保持不变 (近 180° 仰视照旧), 只是在"请求的机位低于 地面 + minHeight"时沿视线往目标点推近,
 * 让相机停在 minHeight 高度上; 推近导致人物变大, 用 FOV 放宽补偿一部分 (fovCompensation, 上限 maxFov)。
 * 推近距离不低于 minDollyDistance; 再不够 (目标点本身被相机 Y 偏移压到贴地) 时改为抬高环绕中心。
 *
 * 用户的"想要的视距" (desiredDistance) 与这里算出的"实际视距"分开保存: 滚轮缩放改的是前者,
 * 俯仰回到地面以上时视距自动恢复。引擎侧的每帧接线见 vrmEngine.ts (applyGroundClamp / restoreGroundClamp)。
 */

export interface GroundClampSettings {
  /** 相机离地最小高度 (m)。 */
  minHeight: number;
  /** 沿视线推近的最小视距 (m); 再近就改为抬高环绕中心。 */
  minDollyDistance: number;
  /** FOV 补偿强度 0 ~ 1 (0 = 不补偿, 1 = 人物大小基本不变)。 */
  fovCompensation: number;
  /** 基准 FOV (deg, 用户 / 宿主设定的值)。 */
  baseFov: number;
  /** FOV 补偿上限 (deg)。 */
  maxFov: number;
}

export interface GroundClampInput {
  /** 环绕目标点 Y (m)。 */
  targetY: number;
  /** 极角 (rad, 0 = 正上方俯视, π/2 = 平视, π = 正下方仰视)。 */
  polar: number;
  /** 用户想要的视距 (m)。 */
  distance: number;
  /** 地面 Y (m)。 */
  floorY: number;
}

export interface GroundClampResult {
  /** 是否发生了夹取 (相机被推近 / 抬高)。 */
  clamped: boolean;
  /** 实际视距 (m), ≤ distance。 */
  distance: number;
  /** 环绕中心额外抬高量 (m, ≥ 0); 相机看向 (目标点 + 抬高量)。 */
  pivotRaise: number;
  /** 实际 FOV (deg)。 */
  fov: number;
}

const DEG = Math.PI / 180;

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** 补偿后的 FOV: tan(fov/2) 按 (想要视距 / 实际视距)^k 放大, 上限 maxFov。 */
export function compensatedFov(baseFov: number, ratio: number, k: number, maxFov: number): number {
  const kk = Math.min(1, Math.max(0, finite(k, 0)));
  const r = Math.max(1, finite(ratio, 1));
  if (kk === 0 || r === 1) return baseFov;
  const cap = Math.max(baseFov, Math.min(179, maxFov));
  const t = Math.tan((baseFov * DEG) / 2) * Math.pow(r, kk);
  return Math.min(cap, (2 * Math.atan(t)) / DEG);
}

/**
 * FOV 补偿还"看得出变化"的最大视距比 (想要 / 实际)。超过这个比值 FOV 已顶到 maxFov,
 * 再拉远在画面上没有任何变化。fovCompensation = 0 时为 1 (夹取时缩放只改想要的视距)。
 */
export function visibleRatioCap(baseFov: number, k: number, maxFov: number): number {
  const kk = Math.min(1, Math.max(0, finite(k, 0)));
  if (kk === 0 || maxFov <= baseFov) return 1;
  const ratio = Math.tan((Math.min(179, maxFov) * DEG) / 2) / Math.tan((baseFov * DEG) / 2);
  return Math.pow(ratio, 1 / kk);
}

/** 求实际机位: 不夹取时原样返回 (distance, pivotRaise = 0, fov = baseFov)。 */
export function solveGroundClamp(input: GroundClampInput, s: GroundClampSettings): GroundClampResult {
  const d = Math.max(0, finite(input.distance, 0));
  const c = Math.cos(finite(input.polar, Math.PI / 2));
  const minY = input.floorY + Math.max(0, finite(s.minHeight, 0));
  const camY = input.targetY + d * c;
  if (camY >= minY) {
    return { clamped: false, distance: d, pivotRaise: 0, fov: s.baseFov };
  }
  const minDolly = Math.max(0, finite(s.minDollyDistance, 0));
  let dist = d;
  if (c < 0) {
    // 沿视线推近到刚好贴着 minY
    const allowed = (input.targetY - minY) / -c;
    dist = Math.min(d, Math.max(allowed, minDolly));
  }
  const lack = minY - (input.targetY + dist * c);
  const pivotRaise = lack > 1e-9 ? lack : 0; // 推近已够时只剩浮点误差
  const ratio = dist > 1e-6 ? d / dist : 1;
  return {
    clamped: true,
    distance: dist,
    pivotRaise,
    fov: compensatedFov(s.baseFov, ratio, s.fovCompensation, s.maxFov),
  };
}

/**
 * 夹取状态下滚轮拉近: 想要的视距可能远大于实际视距 (之前在夹取时拉远过), 直接按比例缩小它
 * 要滚很多下画面才有变化。这里把拉近的起点挪到"画面开始有变化"的位置 (实际视距 × visibleRatioCap),
 * 让拉近立刻生效。拉远 / 没有缩放时原样返回。
 */
export function adjustZoomInWhileClamped(
  prevDesired: number,
  nextDesired: number,
  effectiveDistance: number,
  ratioCap: number,
): number {
  // 相对容差: 放回 / 重算球坐标的浮点误差 (~1e-15) 不能被当成一次拉近
  if (!(nextDesired < prevDesired * (1 - 1e-6)) || prevDesired <= 0) return nextDesired;
  const visibleMax = effectiveDistance * Math.max(1, ratioCap);
  if (prevDesired <= visibleMax) return nextDesired;
  return Math.min(nextDesired, visibleMax * (nextDesired / prevDesired));
}
