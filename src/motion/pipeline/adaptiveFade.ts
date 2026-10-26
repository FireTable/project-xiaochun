/**
 * 仿生自适应动作过渡时长算法 (Adaptive Motion Crossfade)
 *
 * 核心设计：
 * - 0.75s 严格作为最小值底线 (保障二次元长发/裙摆与肢体流动的优雅感，绝不抢快)
 * - 向上延展区间：[0.75s, 1.00s] (即 0.75s + 0.25s 自适应延展)
 *   - 微小神态 / 倾听微动 (diff ≈ 0.0~0.2) -> 稳定保持在 0.75s ~ 0.80s 黄金起步底线
 *   - 常规动作 / 说话手势 (diff ≈ 0.4~0.5) -> ~0.85s 从容流转
 *   - 大跨度动作 (大甩手、深蹲、大幅度舞蹈，diff ≈ 0.8~1.0) -> ~0.95s ~ 1.00s 宽裕平滑
 * - 倍率调控：支持 crossfadeScale 全局比例缩放
 */

export const BASE_FADE_DURATION = 0.75;
export const MIN_FADE_DURATION = 0.75; // 0.75s 严格作为最小值/基准下限，坚决不抢快
export const MAX_FADE_DURATION = 1.00; // 1.00s (即 0.75s + 0.25s) 作为大动作从容上限

export interface AdaptiveFadeOptions {
  /** 全局过渡倍率，默认 1.0 */
  crossfadeScale?: number;
  /** 是否为动作退回待机 (Action -> Idle) */
  isActionToIdle?: boolean;
  /** 调用方显式指定的强制时长 */
  userRequestedDuration?: number;
}

/**
 * 计算自适应过渡时长
 * @param diffScore 两姿态加权位姿距离 [0.0, 1.0]
 * @param options 调节选项
 * @returns 最终执行过渡时间（秒）
 */
export function computeAdaptiveFadeDuration(
  diffScore: number,
  options: AdaptiveFadeOptions = {},
): number {
  const { crossfadeScale = 1.0, isActionToIdle = false, userRequestedDuration } = options;

  // 若调用方显式指定了非默认的自定义时长，优先尊重调用者
  if (userRequestedDuration !== undefined && Math.abs(userRequestedDuration - BASE_FADE_DURATION) > 0.001) {
    return Math.max(0.2, userRequestedDuration);
  }

  const clampedDiff = Math.max(0.0, Math.min(1.0, diffScore));

  // 严格以 0.75s 为最小值底线，仅根据位姿差异向上自适应扩展至 [0.75s, 1.00s]：
  // diff = 0.0 -> 0.75s (坚决不低于 0.75s)
  // diff = 0.5 -> 0.875s
  // diff = 1.0 -> 1.00s
  let rawDuration = MIN_FADE_DURATION + clampedDiff * (MAX_FADE_DURATION - MIN_FADE_DURATION);

  // 退回待机 (Action -> Idle) 保护：保证骨盆和下半身回正不低于 0.75s
  if (isActionToIdle) {
    rawDuration = Math.max(rawDuration, MIN_FADE_DURATION);
  }

  // 挂载倍率
  const scale = Math.max(0.2, crossfadeScale);
  const scaledDuration = rawDuration * scale;

  // 边界保护：严格以 MIN_FADE_DURATION * scale 为底线
  const lowerClamp = MIN_FADE_DURATION * Math.min(1.0, scale);
  const upperClamp = MAX_FADE_DURATION * Math.max(1.0, scale);

  return Math.max(lowerClamp, Math.min(upperClamp, scaledDuration));
}
