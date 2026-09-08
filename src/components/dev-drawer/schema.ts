import type { SectionId } from './types';

/**
 * 段 schema — 壳读这个数组渲染 SectionRenderer,新增段只需在这里加一行。
 * 各 section 组件自己持有 state 自己订阅 engine,壳只管折叠 / 上下文注入。
 */
export interface SectionConfig {
  id: SectionId;
  defaultCollapsed: boolean;
}

export const SECTIONS: SectionConfig[] = [
  { id: 'expressions', defaultCollapsed: false },
  { id: 'camera', defaultCollapsed: false },
  { id: 'saturation', defaultCollapsed: false },
  { id: 'bodyMorph', defaultCollapsed: false },
  { id: 'wardrobe', defaultCollapsed: false },
  { id: 'lighting', defaultCollapsed: false },
  { id: 'emagePerf', defaultCollapsed: false },
];

export const SECTION_IDS = SECTIONS.map(s => s.id);