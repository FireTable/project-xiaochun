/**
 * 剧情里的“昼夜推到现在”：起点 = 浏览器本地时间往回拨 STORY_TIME_START_OFFSET_HOURS 小时 (跨零点回绕)，
 * 沿时间正方向走满这几个小时，正好落在“现在”，然后切回引擎已有的 'auto' (跟随真实时间) 档位。
 */

/** 起点比“现在”早多少小时 (也是补间要走过的小时数)。12 = 白天从夜里升起、夜里从白天落下，一定能看到明显的光影变化。 */
export const STORY_TIME_START_OFFSET_HOURS = 12;

/** 把任意小时折回 [0, 24) */
export function wrapHour(h: number): number {
  return ((h % 24) + 24) % 24;
}

/** 浏览器本地时间的小数小时 (14:30 → 14.5) */
export function browserHourNow(now: Date = new Date()): number {
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

/** 补间起点：现在往回拨 offset 小时 */
export function offsetStartHour(now: Date = new Date(), offsetHours: number = STORY_TIME_START_OFFSET_HOURS): number {
  return wrapHour(browserHourNow(now) - offsetHours);
}

/** 沿时间正方向从 start 走 progress∈[0,1] 的 offset 小时后的小时 (已折回 [0,24)) */
export function forwardHour(start: number, progress: number, offsetHours: number = STORY_TIME_START_OFFSET_HOURS): number {
  return wrapHour(start + offsetHours * progress);
}
