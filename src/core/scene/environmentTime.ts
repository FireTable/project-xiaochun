/**
 * environmentTime.ts — 通用场景环境时间系统接口与类型定义
 *
 * 作为所有具备时间/昼夜流转感知能力的场景（如 beach3d 阳光沙滩、未来的雨夜咖啡馆等）的通用契约：
 * 1. 引擎层与 UI 调试层仅依赖此抽象，不绑定任何具体场景名词；
 * 2. 支持 'auto'（跟随系统现实时间）与离散时段预设 ('day' | 'sunset' | 'night')；
 * 3. 支持精确到 0.0 ~ 24.0 小时的浮点时间数值。
 */

import type * as THREE from 'three';

export type EnvironmentTimeMode =
  | 'auto'
  | 'weeHours'
  | 'dawn'
  | 'noon'
  | 'dusk'
  | 'day'
  | 'sunset'
  | 'night';

export interface EnvironmentTimeOptions {
  /** 是否正在拖拽滑块中（用于通知场景节流高开销操作，如地面落影贴图重新烘焙） */
  isDragging?: boolean;
}

export interface EnvironmentTimeState {
  /** 当前选中的时间模式或固定时段 */
  mode: EnvironmentTimeMode;
  /** 当前生效的具体小时数 (0.00 ~ 24.00) */
  currentHour: number;
  /** 当前场景是否支持环境时间变化 */
  isSupported: boolean;
}

/**
 * 具有环境时间感知能力的 3D 场景世界必须实现的接口
 */
export interface IEnvironmentTimeAware {
  /** 设置环境时间（时段字符串或 0~24 浮点数值） */
  setEnvironmentTime(time: EnvironmentTimeMode | number, options?: EnvironmentTimeOptions): void;
  /** 获取当前场景的环境时间状态 */
  getEnvironmentTime(): { mode: EnvironmentTimeMode; currentHour: number };
}

/**
 * 场景环境光照描述 —— 由支持时间流转的场景提供。
 *
 * 角色 (MToon) 与角色脚下落影走的是引擎级主光 (StudioLighting.dirLight)，
 * 而场景里的道具 / 棕榈 / 沙堡落影走的是场景自己的太阳方向。
 * 两者若不同步，角色的影子就会和椅子、伞的影子方向对不上。
 * 场景实现本接口后，引擎把主光对齐到场景的太阳 / 月亮方向，两套影子就统一了。
 */
export interface EnvironmentLightState {
  /** 主光方向 (单位向量, 由表面指向光源) */
  direction: THREE.Vector3;
  /** 主光颜色 */
  color: THREE.Color;
  /** 主光强度倍率 (相对引擎默认强度; 1 = 保持引擎默认) */
  keyScale: number;
  /** 半球环境光天空色 */
  hemiSky: THREE.Color;
  /** 半球环境光地面色 */
  hemiGround: THREE.Color;
  /** 半球环境光强度倍率 */
  hemiScale: number;
  /** 前侧补光颜色 */
  fillColor: THREE.Color;
  /** 前侧补光强度倍率 */
  fillScale: number;
}

/**
 * 能够向引擎提供"当前时刻应该怎么打光"的场景
 */
export interface IEnvironmentLightProvider {
  getEnvironmentLight(): EnvironmentLightState;
}

/**
 * 将 0~24 小时浮点数格式化为友好的展示文案，如 17.5 -> "17:30"
 */
export function formatHourToString(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const h = Math.floor(normalized);
  const m = Math.floor((normalized - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
