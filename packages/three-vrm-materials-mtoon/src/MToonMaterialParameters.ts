import type * as THREE from 'three';
import type { MToonMaterialDebugMode } from './MToonMaterialDebugMode';
import type { MToonMaterialOutlineWidthMode } from './MToonMaterialOutlineWidthMode';

export interface MToonMaterialParameters extends THREE.ShaderMaterialParameters {
  /**
   * Extended MToon tuning parameters.
   */
  softMix?: number;
  blurBoost?: number;
  shadow2ndStrength?: number;
  shadow2ndBorder?: number;
  shadow2ndBlur?: number;
  shadow2ndColor?: THREE.Color;
  shadow3rdStrength?: number;
  shadow3rdBorder?: number;
  shadow3rdBlur?: number;
  shadow3rdColor?: THREE.Color;
  rimBoost?: number;
  rimBorder?: number;
  rimBlur?: number;
  rimDirStrength?: number;
  hairSpecStrength?: number;
  hairSpecPower?: number;
  hairSpecShift?: number;
  clothSpecStrength?: number;
  clothSpecPower?: number;
  matcap2ndStrength?: number;
  skinSpecStrength?: number;
  skinSpecPower?: number;
  skinSpecFresnel?: number;
  skinSpecColor?: THREE.Color;
  ambientLift?: number;
  shadeMainStrength?: number;
  shadowBorder?: number;
  shadowBlur?: number;
  rimMainStrength?: number;
  rimShadowMask?: number;
  specularStrength?: number;
  specularPower?: number;
  specularBorder?: number;
  specularBlur?: number;
  reflectStrength?: number;
  reflectFresnel?: number;
  reflectMetallic?: number;
  reflectSmoothness?: number;
  backlightStrength?: number;
  backlightColor?: THREE.Color;
  rimFresnelPower?: number;
  rimIndirStrength?: number;
  matcap2ndContrast?: number;
  matcap2ndScale?: number;
  emissionBoost?: number;
  distanceFade?: number;
  faceSoft?: number;
  normalSkinBoost?: number;
  envStrength?: number;
  gemFresnel?: number;
  outlineMix?: number;
  receiveShadowRate?: number;
  fabricSheenStrength?: number;
  fabricSheenPower?: number;
  fabricSheenColor?: THREE.Color;
}
