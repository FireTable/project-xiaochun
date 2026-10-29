import React from 'react';
import type { SectionId } from './types';
import { ExpressionsSection } from './sections/ExpressionsSection';
import { MotionSection } from './sections/MotionSection';
import { VocalSection } from './sections/VocalSection';
import { EmagePerfSection } from './sections/EmagePerfSection';
import { SaturationSection } from './sections/SaturationSection';
import { BoneMorphSection } from './sections/BoneMorphSection';
import { WardrobeSection } from './sections/WardrobeSection';
import { LightingSection } from './sections/LightingSection';
import { CameraSection } from './sections/CameraSection';
import { PostFxSection } from './sections/PostFxSection';
import { VoiceAnalysisSection } from './sections/VoiceAnalysisSection';

/**
 * SectionRenderer — 按 schema SECTIONS 数组渲染对应段组件。
 * ponytail: 新增 section 只需在 REGISTRY 加一条 + 在 schema SECTIONS 加一行,壳不动。
 */
const REGISTRY: Record<SectionId, React.FC> = {
  expressions: ExpressionsSection,
  motion: MotionSection,
  vocal: VocalSection,
  emagePerf: EmagePerfSection,
  saturation: SaturationSection,
  bodyMorph: BoneMorphSection,
  wardrobe: WardrobeSection,
  lighting: LightingSection,
  camera: CameraSection,
  postfx: PostFxSection,
  voiceAnalysis: VoiceAnalysisSection,
};

export const SectionRenderer: React.FC<{ id: SectionId }> = ({ id }) => {
  const Component = REGISTRY[id];
  if (!Component) {
    console.warn(`[SectionRenderer] Unknown or missing section component: ${id}`);
    return null;
  }
  return <Component />;
};