/**
 * Project XiaoChun 全局配置类型定义 (Single Source of Truth)
 */

export interface LightChannelConfig {
  base: number;
  enabled: boolean;
}

export interface LightConfig {
  dir: LightChannelConfig;
  hemi: LightChannelConfig;
  fill: LightChannelConfig;
  globalMult: number;
}

export type LineworkTheme = 'light' | 'dark' | 'transparent';

export interface SceneComponentConfig {
  topHeader?: boolean;
  chatBar?: boolean;
  headBubble?: boolean;
  heightRuler?: boolean;
  dropZone?: boolean;
}

export interface SceneTauriConfig {
  resizable: boolean;
  cornerHandles?: boolean;
  alwaysOnTop?: boolean;
}

export interface SceneItemConfig {
  id: string;
  nameKey: string;
  icon?: string;
  lineworkTheme: LineworkTheme;
  isTransparent?: boolean;
  components: SceneComponentConfig;
  tauri: SceneTauriConfig;
}

export interface SceneRegistryConfig {
  defaultSceneId: string;
  items: Record<string, SceneItemConfig>;
}

export interface MaterialSaturationConfig {
  preset: 'vibrant' | 'sweet' | 'cinematic' | 'original' | 'custom';
  clothing: number;
  hair: number;
  eyes: number;
  skin: number;
}

export type VrmOutlineWidthMode = 'none' | 'worldCoordinates' | 'screenCoordinates';

export interface VrmOutlineConfig {
  enabled: boolean;
  widthMode: VrmOutlineWidthMode;
  widthFactor: number;
  color: string;
  lightingMix: number;
}

export interface VrmMaterialNprShadingConfig {
  shadeShift: number;
  shadeToony: number;
  shadeColor?: string;
  litColor?: string;
  rimLightingMix: number;
  rimColor: string;
  rimFresnelPower: number;
  rimLift: number;
}

export interface PolygonOffsetConfig {
  enabled: boolean;
  factor: number;
  units: number;
}

/** MToon 部件特化着色参数 */
export interface VrmMToonPartConfig {
  softMix: number;
  blurBoost: number;
  shadow2ndStrength: number;
  shadow2ndBorder?: number;
  shadow2ndBlur?: number;
  shadow3rdStrength: number;
  shadow3rdBorder?: number;
  shadow3rdBlur?: number;
  shadowBorder?: number;
  shadowBlur?: number;
  rimBoost: number;
  rimBorder: number;
  rimBlur: number;
  rimDirStrength: number;
  rimMainStrength?: number;
  rimShadowMask?: number;
  rimFresnelPower?: number;
  rimIndirStrength?: number;
  hairSpecStrength: number;
  hairSpecPower?: number;
  hairSpecShift?: number;
  clothSpecStrength: number;
  clothSpecPower?: number;
  clothSpecDarkLuma?: number;
  clothSpecDarkBoost?: number;
  skinSpecStrength?: number;
  skinSpecPower?: number;
  skinSpecFresnel?: number;
  skinSpecColor?: [number, number, number];
  specularStrength?: number;
  specularPower?: number;
  specularBorder?: number;
  specularBlur?: number;
  reflectStrength?: number;
  reflectFresnel?: number;
  reflectMetallic?: number;
  reflectSmoothness?: number;
  backlightStrength?: number;
  backlightColor?: [number, number, number];
  matcap2ndStrength: number;
  matcap2ndContrast?: number;
  matcap2ndScale?: number;
  emissionBoost?: number;
  distanceFade?: number;
  faceSoft?: number;
  normalSkinBoost?: number;
  envStrength?: number;
  ambientLift?: number;
  shadeMainStrength?: number;
  gemFresnel?: number;
  outlineMix?: number;
  receiveShadowRate?: number;
  fabricSheenStrength?: number;
  fabricSheenPower?: number;
  fabricSheenColor?: [number, number, number];
}

/** MToon 全部件分级预设配置 */
export interface VrmMToonPartsConfig {
  enabled: boolean;
  shadow2ndColor: [number, number, number];
  shadow3rdColor: [number, number, number];
  faceShadow2ndColor?: [number, number, number];
  face: VrmMToonPartConfig;
  body: VrmMToonPartConfig;
  hair: VrmMToonPartConfig;
  eyes: VrmMToonPartConfig;
  cloth: VrmMToonPartConfig;
  socks: VrmMToonPartConfig;
}

export interface VrmMToonConfig {
  skin: {
    face: VrmMaterialNprShadingConfig;
    body: VrmMaterialNprShadingConfig;
    polygonOffset: PolygonOffsetConfig;
  };
  socks: {
    npr: VrmMaterialNprShadingConfig;
    polygonOffset: PolygonOffsetConfig;
  };
  cloth: {
    npr: VrmMaterialNprShadingConfig;
    innerPolygonOffset: PolygonOffsetConfig;
    outerPolygonOffset: PolygonOffsetConfig;
  };
  parts: VrmMToonPartsConfig;
}

export interface EmageMotionConfig {
  gestureIntensity: number;
  fingerIntensity: number;
  torsoIntensity: number;
  spineIntensity: number;
  hipIntensity: number;
  legIntensity: number;
  footIkIdlePlant: number;
  headIntensity: number;
  dampingStiffness: number;
  temporalSmoothRadius: number;
  chunkSeamMaxFrames: number;
  streamingCatchUpRate: number;
  advanceFrames: number;
  fadeInDuration: number;
  switchSegmentCrossFade: number;
  poseMicroFadeJumpDiv: number;
  poseMicroFadeMinSec: number;
  poseMicroFadeMaxSec: number;
  poseMicroFadeJumpMin: number;
  seamJumpThreshold: number;
  seamJumpFramesScale: number;
  vqSampleTemperature: number;
  vqSampleTopK: number;
}

export interface BodyMorphConfig {
  overallScale: number;
  head: number;
  neck: number;
  neckDepth: number;
  neckLength: number;
  shoulderWidth: number;
  torsoLength: number;
  torsoThickness: number;
  waist: number;
  belly: number;
  hips: number;
  buttocks: number;
  buttocksThickness: number;
  buttocksPitch: number;
  buttocksSpread: number;
  bust: number;
  bustThickness: number;
  bustPitch: number;
  bustSpread: number;
  arms: number;
  armLength: number;
  hands: number;
  fingerWidth: number;
  thighs: number;
  thighLength: number;
  calves: number;
  calfLength: number;
  feet: number;
}

export type BodyMorphPartKey = keyof BodyMorphConfig;

export type ModelPartCategory = 'clothing' | 'accessory' | 'hair' | 'face' | 'body';

export interface ModelPartCategoryDefinition {
  id: ModelPartCategory;
  label: string;
  icon: string;
}

export interface ModelPartDefinition {
  id: string;
  category: ModelPartCategory;
  label: string;
  icon: string;
  defaultVisible?: boolean;
}

export interface WardrobeConfig {
  categories: ModelPartCategoryDefinition[];
  parts: ModelPartDefinition[];
  defaultVisibility: Record<string, boolean>;
}

export interface AddonDefinition {
  source: string;
  name: string;
  sha: string;
  default?: boolean;
  bodyMorph?: Partial<BodyMorphConfig>;
}
