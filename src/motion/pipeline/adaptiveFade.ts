/**
 * 仿生自适应动作过渡时长算法 (Adaptive Motion Crossfade)
 *
 * 核心设计：
 * - 黄金基准中枢：0.75s (用户最认可的二次元自然优雅手感)
 * - 动态浮动区间：0.75s ± 0.25s -> [0.50s, 1.00s]
 *   - 微小神态 (微倾、微点头、双手微收，diff ≈ 0.05~0.15) -> ~0.50s ~ 0.55s (轻快跟手，坚守 0.5s 防抽搐底线)
 *   - 常规动作 (思考、说话手势，diff ≈ 0.40~0.50) -> ~0.70s ~ 0.75s (完全吻合当前黄金手感)
 *   - 大跨度动作 (大甩手、深蹲、大幅度舞蹈，diff ≈ 0.80~1.00) -> ~0.90s ~ 1.00s (从容优雅展开)
 * - 倍率调控：支持 crossfadeScale 全局比例缩放
 */

export const BASE_FADE_DURATION = 0.75;
export const FADE_AMPLITUDE = 0.25;
export const MIN_FADE_DURATION = BASE_FADE_DURATION - FADE_AMPLITUDE; // 0.50s (防抽搐安全下限)
export const MAX_FADE_DURATION = BASE_FADE_DURATION + FADE_AMPLITUDE; // 1.00s (大动作从容上限)

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

  // 严格在 [0.50s, 1.00s] 之间按位姿差异线性插值：
  // diff = 0.0 -> 0.50s
  // diff = 0.5 -> 0.75s (中枢)
  // diff = 1.0 -> 1.00s
  let rawDuration = MIN_FADE_DURATION + clampedDiff * (MAX_FADE_DURATION - MIN_FADE_DURATION);

  // 退回待机 (Action -> Idle) 保护：为骨盆和下半身回正保留平滑下限 (0.70s)
  if (isActionToIdle) {
    rawDuration = Math.max(rawDuration, 0.70);
  }

  // 挂载倍率
  const scale = Math.max(0.2, crossfadeScale);
  const scaledDuration = rawDuration * scale;

  // 边界保护：以基准倍率为下上限钳制
  const lowerClamp = MIN_FADE_DURATION * Math.min(1.0, scale);
  const upperClamp = MAX_FADE_DURATION * Math.max(1.0, scale);

  return Math.max(lowerClamp, Math.min(upperClamp, scaledDuration));
}
