import type { PlayMotionOptions } from './sources/clip';

export interface MotionCatalogItem extends PlayMotionOptions {
  /** 动作唯一标识 */
  id: string;
  /** 动作可读名称 */
  name: string;
  /** 动作文件路径（或已预加载的 ArrayBuffer） */
  url: string;
  /** 动作描述说明 */
  description?: string;
}

export const MOTION_CATALOG = {
  /** 倾听待机姿态（标准 52 骨骼真人动捕，截取 3.3s~12.0s 核心抱腹循环，剔除头尾 T-Pose 标定帧） */
  listening: {
    id: 'listening',
    name: '倾听',
    url: '/vrm/motion/listening.vrma',
    loop: true,
    fadeDuration: 0.75,
    antiClip: false,
    timeRange: [3.3, 12.0],
    mask: 'all',
    description: '双手自然环抱身前，身体轻微起伏呼吸的纯净倾听姿态',
  },
  /** 思考动作（SimpleText2Motion AI 生成，22 骨骼带防穿模限幅） */
  thinking: {
    id: 'thinking',
    name: '思考',
    url: '/vrm/motion/thinking.vrma',
    loop: true,
    fadeDuration: 0.65,
    antiClip: true,
    mask: 'all',
    description: '单手托下巴作沉思状',
  },
} as const satisfies Record<string, MotionCatalogItem>;

export type MotionCatalogId = keyof typeof MOTION_CATALOG;

export function isMotionCatalogId(id: string): id is MotionCatalogId {
  return id in MOTION_CATALOG;
}
