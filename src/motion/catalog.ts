import type { PlayMotionOptions } from './sources/clip';

export interface MotionCatalogItem extends PlayMotionOptions {
  /** 动作唯一标识 */
  id: string;
  /** 动作多语言名称 i18n Key */
  nameKey: string;
  /** 动作文件路径（或已预加载的 ArrayBuffer） */
  url: string;
  /** 动作多语言描述说明 i18n Key */
  descriptionKey?: string;
  /** 可选：静态回退名称或展示名（兼容非 i18n 场景） */
  name?: string;
  /** 可选：静态回退描述说明（兼容非 i18n 场景） */
  description?: string;
}

export const MOTION_CATALOG = {
  /** 倾听待机姿态（dm_124 标准 52 骨骼真人动捕，身躯微倾微带微笑，已物理烘焙纯净 5.75s 核心专注倾听循环） */
  listening: {
    id: 'listening',
    nameKey: 'motion.listening.name',
    descriptionKey: 'motion.listening.description',
    url: '/vrm/motion/listening.vrma?v=10',
    loop: true,
    fadeDuration: 0.95,
    antiClip: false,
    enableFootIK: true,
    // 可选：timeRange: [0.0, 5.75], 随时可在代码中按秒截取动捕时间区间
    mask: 'all',
  },
  /** 思考动作（SimpleText2Motion AI 生成，22 骨骼带防穿模限幅） */
  thinking: {
    id: 'thinking',
    nameKey: 'motion.thinking.name',
    descriptionKey: 'motion.thinking.description',
    url: '/vrm/motion/thinking.vrma',
    loop: true,
    fadeDuration: 0.65,
    antiClip: false,
    mask: 'all',
  },
} as const satisfies Record<string, MotionCatalogItem>;

export type MotionCatalogId = keyof typeof MOTION_CATALOG;

export function isMotionCatalogId(id: string): id is MotionCatalogId {
  return id in MOTION_CATALOG;
}

/**
 * 获取动作的本地化显示名称
 */
export function getMotionName(item: MotionCatalogItem, t?: (key: string) => string): string {
  if (t) return t(item.nameKey);
  return item.name ?? item.id;
}

/**
 * 获取动作的本地化描述说明
 */
export function getMotionDescription(item: MotionCatalogItem, t?: (key: string) => string): string {
  if (t && item.descriptionKey) return t(item.descriptionKey);
  return item.description ?? '';
}
