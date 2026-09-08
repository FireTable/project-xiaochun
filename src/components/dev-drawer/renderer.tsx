import React from 'react';
import type { SectionId } from './types';
import { ExpressionsSection } from './sections/ExpressionsSection';
import { EmagePerfSection } from './sections/EmagePerfSection';
import { SaturationSection } from './sections/SaturationSection';
import { BoneMorphSection } from './sections/BoneMorphSection';
import { WardrobeSection } from './sections/WardrobeSection';
import { LightingSection } from './sections/LightingSection';
import { CameraSection } from './sections/CameraSection';

/**
 * SectionRenderer — 按 schema SECTIONS 数组渲染对应段组件。
 * ponytail: 新增 section 只需在 REGISTRY 加一条 + 在 schema SECTIONS 加一行,壳不动。
 */
const REGISTRY: Record<SectionId, React.FC> = {
  expressions: ExpressionsSection,
  emagePerf: EmagePerfSection,
  saturation: SaturationSection,
  bodyMorph: BoneMorphSection,
  wardrobe: WardrobeSection,
  lighting: LightingSection,
  camera: CameraSection,
};

export const SectionRenderer: React.FC<{ id: SectionId }> = ({ id }) => {
  const Component = REGISTRY[id];
  return <Component />;
};