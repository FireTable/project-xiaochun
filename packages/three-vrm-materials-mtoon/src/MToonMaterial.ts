/* tslint:disable:member-ordering */

import * as THREE from 'three';
import vertexShader from './shaders/mtoon.vert';
import fragmentShader from './shaders/mtoon.frag';
import { MToonMaterialDebugMode } from './MToonMaterialDebugMode';
import { MToonMaterialOutlineWidthMode } from './MToonMaterialOutlineWidthMode';
import type { MToonMaterialParameters } from './MToonMaterialParameters';
import { getTextureColorSpace } from './utils/getTextureColorSpace';

/**
 * MToon is a material specification that has various features.
 * The spec and implementation are originally founded for Unity engine and this is a port of the material.
 *
 * See: https://github.com/Santarh/MToon
 */
export class MToonMaterial extends THREE.ShaderMaterial {
  public uniforms: {
    litFactor: THREE.IUniform<THREE.Color>;
    alphaTest: THREE.IUniform<number>;
    opacity: THREE.IUniform<number>;
    map: THREE.IUniform<THREE.Texture | null>;
    mapUvTransform: THREE.IUniform<THREE.Matrix3>;
    normalMap: THREE.IUniform<THREE.Texture | null>;
    normalMapUvTransform: THREE.IUniform<THREE.Matrix3>;
    normalScale: THREE.IUniform<THREE.Vector2>;
    emissive: THREE.IUniform<THREE.Color>;
    emissiveIntensity: THREE.IUniform<number>;
    emissiveMap: THREE.IUniform<THREE.Texture | null>;
    emissiveMapUvTransform: THREE.IUniform<THREE.Matrix3>;
    shadeColorFactor: THREE.IUniform<THREE.Color>;
    shadeMultiplyTexture: THREE.IUniform<THREE.Texture | null>;
    shadeMultiplyTextureUvTransform: THREE.IUniform<THREE.Matrix3>;
    shadingShiftFactor: THREE.IUniform<number>;
    shadingShiftTexture: THREE.IUniform<THREE.Texture | null>;
    shadingShiftTextureUvTransform: THREE.IUniform<THREE.Matrix3>;
    shadingShiftTextureScale: THREE.IUniform<number>;
    shadingToonyFactor: THREE.IUniform<number>;
    giEqualizationFactor: THREE.IUniform<number>;
    matcapFactor: THREE.IUniform<THREE.Color>;
    matcapTexture: THREE.IUniform<THREE.Texture | null>;
    matcapTextureUvTransform: THREE.IUniform<THREE.Matrix3>;
    parametricRimColorFactor: THREE.IUniform<THREE.Color>;
    rimMultiplyTexture: THREE.IUniform<THREE.Texture | null>;
    rimMultiplyTextureUvTransform: THREE.IUniform<THREE.Matrix3>;
    rimLightingMixFactor: THREE.IUniform<number>;
    parametricRimFresnelPowerFactor: THREE.IUniform<number>;
    parametricRimLiftFactor: THREE.IUniform<number>;
    outlineWidthMultiplyTexture: THREE.IUniform<THREE.Texture | null>;
    outlineWidthMultiplyTextureUvTransform: THREE.IUniform<THREE.Matrix3>;
    outlineWidthFactor: THREE.IUniform<number>;
    outlineColorFactor: THREE.IUniform<THREE.Color>;
    outlineLightingMixFactor: THREE.IUniform<number>;
    uvAnimationMaskTexture: THREE.IUniform<THREE.Texture | null>;
    uvAnimationMaskTextureUvTransform: THREE.IUniform<THREE.Matrix3>;
    uvAnimationScrollXOffset: THREE.IUniform<number>;
    uvAnimationScrollYOffset: THREE.IUniform<number>;
    uvAnimationRotationPhase: THREE.IUniform<number>;
    // Extended tuning parameters
    softMix: THREE.IUniform<number>;
    blurBoost: THREE.IUniform<number>;
    shadow2ndStrength: THREE.IUniform<number>;
    shadow2ndBorder: THREE.IUniform<number>;
    shadow2ndBlur: THREE.IUniform<number>;
    shadow2ndColor: THREE.IUniform<THREE.Color>;
    shadow3rdStrength: THREE.IUniform<number>;
    shadow3rdBorder: THREE.IUniform<number>;
    shadow3rdBlur: THREE.IUniform<number>;
    shadow3rdColor: THREE.IUniform<THREE.Color>;
    rimBoost: THREE.IUniform<number>;
    rimBorder: THREE.IUniform<number>;
    rimBlur: THREE.IUniform<number>;
    rimDirStrength: THREE.IUniform<number>;
    hairSpecStrength: THREE.IUniform<number>;
    hairSpecPower: THREE.IUniform<number>;
    hairSpecShift: THREE.IUniform<number>;
    clothSpecStrength: THREE.IUniform<number>;
    clothSpecPower: THREE.IUniform<number>;
    matcap2ndStrength: THREE.IUniform<number>;
    skinSpecStrength: THREE.IUniform<number>;
    skinSpecPower: THREE.IUniform<number>;
    skinSpecFresnel: THREE.IUniform<number>;
    skinSpecColor: THREE.IUniform<THREE.Color>;
    ambientLift: THREE.IUniform<number>;
    shadeMainStrength: THREE.IUniform<number>;
    shadowBorder: THREE.IUniform<number>;
    shadowBlur: THREE.IUniform<number>;
    rimMainStrength: THREE.IUniform<number>;
    rimShadowMask: THREE.IUniform<number>;
    specularStrength: THREE.IUniform<number>;
    specularPower: THREE.IUniform<number>;
    specularBorder: THREE.IUniform<number>;
    specularBlur: THREE.IUniform<number>;
    reflectStrength: THREE.IUniform<number>;
    reflectFresnel: THREE.IUniform<number>;
    reflectMetallic: THREE.IUniform<number>;
    reflectSmoothness: THREE.IUniform<number>;
    backlightStrength: THREE.IUniform<number>;
    backlightColor: THREE.IUniform<THREE.Color>;
    rimFresnelPower: THREE.IUniform<number>;
    rimIndirStrength: THREE.IUniform<number>;
    matcap2ndContrast: THREE.IUniform<number>;
    matcap2ndScale: THREE.IUniform<number>;
    emissionBoost: THREE.IUniform<number>;
    distanceFade: THREE.IUniform<number>;
    faceSoft: THREE.IUniform<number>;
    normalSkinBoost: THREE.IUniform<number>;
    envStrength: THREE.IUniform<number>;
    gemFresnel: THREE.IUniform<number>;
    outlineMix: THREE.IUniform<number>;
    receiveShadowRate: THREE.IUniform<number>;
    fabricSheenStrength: THREE.IUniform<number>;
    fabricSheenPower: THREE.IUniform<number>;
    fabricSheenColor: THREE.IUniform<THREE.Color>;
  };

  public get color(): THREE.Color {
    return this.uniforms.litFactor.value;
  }
  public set color(value: THREE.Color) {
    this.uniforms.litFactor.value = value;
  }

  public get map(): THREE.Texture | null {
    return this.uniforms.map.value;
  }
  public set map(value: THREE.Texture | null) {
    this.uniforms.map.value = value;
  }

  public get normalMap(): THREE.Texture | null {
    return this.uniforms.normalMap.value;
  }
  public set normalMap(value: THREE.Texture | null) {
    this.uniforms.normalMap.value = value;
  }

  public get normalScale(): THREE.Vector2 {
    return this.uniforms.normalScale.value;
  }
  public set normalScale(value: THREE.Vector2) {
    this.uniforms.normalScale.value = value;
  }

  public get emissive(): THREE.Color {
    return this.uniforms.emissive.value;
  }
  public set emissive(value: THREE.Color) {
    this.uniforms.emissive.value = value;
  }

  public get emissiveIntensity(): number {
    return this.uniforms.emissiveIntensity.value;
  }
  public set emissiveIntensity(value: number) {
    this.uniforms.emissiveIntensity.value = value;
  }

  public get emissiveMap(): THREE.Texture | null {
    return this.uniforms.emissiveMap.value;
  }
  public set emissiveMap(value: THREE.Texture | null) {
    this.uniforms.emissiveMap.value = value;
  }

  public get shadeColorFactor(): THREE.Color {
    return this.uniforms.shadeColorFactor.value;
  }
  public set shadeColorFactor(value: THREE.Color) {
    this.uniforms.shadeColorFactor.value = value;
  }

  public get shadeMultiplyTexture(): THREE.Texture | null {
    return this.uniforms.shadeMultiplyTexture.value;
  }
  public set shadeMultiplyTexture(value: THREE.Texture | null) {
    this.uniforms.shadeMultiplyTexture.value = value;
  }

  public get shadingShiftFactor(): number {
    return this.uniforms.shadingShiftFactor.value;
  }
  public set shadingShiftFactor(value: number) {
    this.uniforms.shadingShiftFactor.value = value;
  }

  public get shadingShiftTexture(): THREE.Texture | null {
    return this.uniforms.shadingShiftTexture.value;
  }
  public set shadingShiftTexture(value: THREE.Texture | null) {
    this.uniforms.shadingShiftTexture.value = value;
  }

  public get shadingShiftTextureScale(): number {
    return this.uniforms.shadingShiftTextureScale.value;
  }
  public set shadingShiftTextureScale(value: number) {
    this.uniforms.shadingShiftTextureScale.value = value;
  }

  public get shadingToonyFactor(): number {
    return this.uniforms.shadingToonyFactor.value;
  }
  public set shadingToonyFactor(value: number) {
    this.uniforms.shadingToonyFactor.value = value;
  }

  public get giEqualizationFactor(): number {
    return this.uniforms.giEqualizationFactor.value;
  }
  public set giEqualizationFactor(value: number) {
    this.uniforms.giEqualizationFactor.value = value;
  }

  public get matcapFactor(): THREE.Color {
    return this.uniforms.matcapFactor.value;
  }
  public set matcapFactor(value: THREE.Color) {
    this.uniforms.matcapFactor.value = value;
  }

  public get matcapTexture(): THREE.Texture | null {
    return this.uniforms.matcapTexture.value;
  }
  public set matcapTexture(value: THREE.Texture | null) {
    this.uniforms.matcapTexture.value = value;
  }

  public get parametricRimColorFactor(): THREE.Color {
    return this.uniforms.parametricRimColorFactor.value;
  }
  public set parametricRimColorFactor(value: THREE.Color) {
    this.uniforms.parametricRimColorFactor.value = value;
  }

  public get rimMultiplyTexture(): THREE.Texture | null {
    return this.uniforms.rimMultiplyTexture.value;
  }
  public set rimMultiplyTexture(value: THREE.Texture | null) {
    this.uniforms.rimMultiplyTexture.value = value;
  }

  public get rimLightingMixFactor(): number {
    return this.uniforms.rimLightingMixFactor.value;
  }
  public set rimLightingMixFactor(value: number) {
    this.uniforms.rimLightingMixFactor.value = value;
  }

  public get parametricRimFresnelPowerFactor(): number {
    return this.uniforms.parametricRimFresnelPowerFactor.value;
  }
  public set parametricRimFresnelPowerFactor(value: number) {
    this.uniforms.parametricRimFresnelPowerFactor.value = value;
  }

  public get parametricRimLiftFactor(): number {
    return this.uniforms.parametricRimLiftFactor.value;
  }
  public set parametricRimLiftFactor(value: number) {
    this.uniforms.parametricRimLiftFactor.value = value;
  }

  /** 0..1 blend toward half-Lambert soft toon (lilToon-like). Default 0.95 */
  public get softMix(): number {
    return this.uniforms.softMix.value;
  }
  public set softMix(value: number) {
    this.uniforms.softMix.value = value;
  }

  /** Extra blur width added to (1 - shadingToony) on the soft path. Default 0.32 */
  public get blurBoost(): number {
    return this.uniforms.blurBoost.value;
  }
  public set blurBoost(value: number) {
    this.uniforms.blurBoost.value = value;
  }

  public get shadow2ndStrength(): number {
    return this.uniforms.shadow2ndStrength.value;
  }
  public set shadow2ndStrength(value: number) {
    this.uniforms.shadow2ndStrength.value = value;
  }

  public get shadow2ndBorder(): number {
    return this.uniforms.shadow2ndBorder.value;
  }
  public set shadow2ndBorder(value: number) {
    this.uniforms.shadow2ndBorder.value = value;
  }

  public get shadow2ndBlur(): number {
    return this.uniforms.shadow2ndBlur.value;
  }
  public set shadow2ndBlur(value: number) {
    this.uniforms.shadow2ndBlur.value = value;
  }

  public get shadow2ndColor(): THREE.Color {
    return this.uniforms.shadow2ndColor.value;
  }
  public set shadow2ndColor(value: THREE.Color) {
    this.uniforms.shadow2ndColor.value = value;
  }

  public get shadow3rdStrength(): number {
    return this.uniforms.shadow3rdStrength.value;
  }
  public set shadow3rdStrength(value: number) {
    this.uniforms.shadow3rdStrength.value = value;
  }

  public get shadow3rdBorder(): number {
    return this.uniforms.shadow3rdBorder.value;
  }
  public set shadow3rdBorder(value: number) {
    this.uniforms.shadow3rdBorder.value = value;
  }

  public get shadow3rdBlur(): number {
    return this.uniforms.shadow3rdBlur.value;
  }
  public set shadow3rdBlur(value: number) {
    this.uniforms.shadow3rdBlur.value = value;
  }

  public get shadow3rdColor(): THREE.Color {
    return this.uniforms.shadow3rdColor.value;
  }
  public set shadow3rdColor(value: THREE.Color) {
    this.uniforms.shadow3rdColor.value = value;
  }

  /** Multiplier on tooned rim. Default 1.4; eyes careful via VRMMaterialManager */
  public get rimBoost(): number {
    return this.uniforms.rimBoost.value;
  }
  public set rimBoost(value: number) {
    this.uniforms.rimBoost.value = value;
  }

  public get rimBorder(): number {
    return this.uniforms.rimBorder.value;
  }
  public set rimBorder(value: number) {
    this.uniforms.rimBorder.value = value;
  }

  public get rimBlur(): number {
    return this.uniforms.rimBlur.value;
  }
  public set rimBlur(value: number) {
    this.uniforms.rimBlur.value = value;
  }

  public get rimDirStrength(): number {
    return this.uniforms.rimDirStrength.value;
  }
  public set rimDirStrength(value: number) {
    this.uniforms.rimDirStrength.value = value;
  }

  public get hairSpecStrength(): number {
    return this.uniforms.hairSpecStrength.value;
  }
  public set hairSpecStrength(value: number) {
    this.uniforms.hairSpecStrength.value = value;
  }

  public get hairSpecPower(): number {
    return this.uniforms.hairSpecPower.value;
  }
  public set hairSpecPower(value: number) {
    this.uniforms.hairSpecPower.value = value;
  }

  public get hairSpecShift(): number {
    return this.uniforms.hairSpecShift.value;
  }
  public set hairSpecShift(value: number) {
    this.uniforms.hairSpecShift.value = value;
  }

  public get clothSpecStrength(): number {
    return this.uniforms.clothSpecStrength.value;
  }
  public set clothSpecStrength(value: number) {
    this.uniforms.clothSpecStrength.value = value;
  }

  public get clothSpecPower(): number {
    return this.uniforms.clothSpecPower.value;
  }
  public set clothSpecPower(value: number) {
    this.uniforms.clothSpecPower.value = value;
  }

  public get matcap2ndStrength(): number {
    return this.uniforms.matcap2ndStrength.value;
  }
  public set matcap2ndStrength(value: number) {
    this.uniforms.matcap2ndStrength.value = value;
  }

  public get skinSpecStrength(): number {
    return this.uniforms.skinSpecStrength.value;
  }
  public set skinSpecStrength(value: number) {
    this.uniforms.skinSpecStrength.value = value;
  }

  public get skinSpecPower(): number {
    return this.uniforms.skinSpecPower.value;
  }
  public set skinSpecPower(value: number) {
    this.uniforms.skinSpecPower.value = value;
  }

  public get skinSpecFresnel(): number {
    return this.uniforms.skinSpecFresnel.value;
  }
  public set skinSpecFresnel(value: number) {
    this.uniforms.skinSpecFresnel.value = value;
  }

  public get skinSpecColor(): THREE.Color {
    return this.uniforms.skinSpecColor.value;
  }
  public set skinSpecColor(value: THREE.Color) {
    this.uniforms.skinSpecColor.value = value;
  }

  public get ambientLift(): number {
    return this.uniforms.ambientLift.value;
  }
  public set ambientLift(value: number) {
    this.uniforms.ambientLift.value = value;
  }

  public get shadeMainStrength(): number {
    return this.uniforms.shadeMainStrength.value;
  }
  public set shadeMainStrength(value: number) {
    this.uniforms.shadeMainStrength.value = value;
  }

  public get shadowBorder(): number {
    return this.uniforms.shadowBorder.value;
  }
  public set shadowBorder(value: number) {
    this.uniforms.shadowBorder.value = value;
  }

  public get shadowBlur(): number {
    return this.uniforms.shadowBlur.value;
  }
  public set shadowBlur(value: number) {
    this.uniforms.shadowBlur.value = value;
  }

  public get rimMainStrength(): number {
    return this.uniforms.rimMainStrength.value;
  }
  public set rimMainStrength(value: number) {
    this.uniforms.rimMainStrength.value = value;
  }

  public get rimShadowMask(): number {
    return this.uniforms.rimShadowMask.value;
  }
  public set rimShadowMask(value: number) {
    this.uniforms.rimShadowMask.value = value;
  }

  /** lilCalcSpecular-like toon specular strength (0 = off) */
  public get specularStrength(): number {
    return this.uniforms.specularStrength.value;
  }
  public set specularStrength(value: number) {
    this.uniforms.specularStrength.value = value;
  }

  /** Specular Blinn power / inverse-roughness proxy */
  public get specularPower(): number {
    return this.uniforms.specularPower.value;
  }
  public set specularPower(value: number) {
    this.uniforms.specularPower.value = value;
  }

  /** Toon specular border in [0,1] */
  public get specularBorder(): number {
    return this.uniforms.specularBorder.value;
  }
  public set specularBorder(value: number) {
    this.uniforms.specularBorder.value = value;
  }

  /** Toon specular blur width */
  public get specularBlur(): number {
    return this.uniforms.specularBlur.value;
  }
  public set specularBlur(value: number) {
    this.uniforms.specularBlur.value = value;
  }

  /** View-dependent env reflection approx (no cubemap) */
  public get reflectStrength(): number {
    return this.uniforms.reflectStrength.value;
  }
  public set reflectStrength(value: number) {
    this.uniforms.reflectStrength.value = value;
  }

  /** Fresnel amount for env approx */
  public get reflectFresnel(): number {
    return this.uniforms.reflectFresnel.value;
  }
  public set reflectFresnel(value: number) {
    this.uniforms.reflectFresnel.value = value;
  }

  /** 0 dielectric .. 1 metal (tints reflection toward albedo) */
  public get reflectMetallic(): number {
    return this.uniforms.reflectMetallic.value;
  }
  public set reflectMetallic(value: number) {
    this.uniforms.reflectMetallic.value = value;
  }

  /** Sharper grazing reflection when high */
  public get reflectSmoothness(): number {
    return this.uniforms.reflectSmoothness.value;
  }
  public set reflectSmoothness(value: number) {
    this.uniforms.reflectSmoothness.value = value;
  }

  /** lil backlight wrap strength (0 = off) */
  public get backlightStrength(): number {
    return this.uniforms.backlightStrength.value;
  }
  public set backlightStrength(value: number) {
    this.uniforms.backlightStrength.value = value;
  }

  /** Backlight tint color */
  public get backlightColor(): THREE.Color {
    return this.uniforms.backlightColor.value;
  }
  public set backlightColor(value: THREE.Color) {
    this.uniforms.backlightColor.value = value;
  }

  /** >0 overrides parametric rim fresnel power */
  public get rimFresnelPower(): number {
    return this.uniforms.rimFresnelPower.value;
  }
  public set rimFresnelPower(value: number) {
    this.uniforms.rimFresnelPower.value = value;
  }

  /** Opposite-side rim (lil RimIndir) */
  public get rimIndirStrength(): number {
    return this.uniforms.rimIndirStrength.value;
  }
  public set rimIndirStrength(value: number) {
    this.uniforms.rimIndirStrength.value = value;
  }

  /** Contrast for synthesized 2nd MatCap */
  public get matcap2ndContrast(): number {
    return this.uniforms.matcap2ndContrast.value;
  }
  public set matcap2ndContrast(value: number) {
    this.uniforms.matcap2ndContrast.value = value;
  }

  /** UV scale for 2nd MatCap resample */
  public get matcap2ndScale(): number {
    return this.uniforms.matcap2ndScale.value;
  }
  public set matcap2ndScale(value: number) {
    this.uniforms.matcap2ndScale.value = value;
  }

  /** Extra emissive scale (stock emissive * (1+boost)) */
  public get emissionBoost(): number {
    return this.uniforms.emissionBoost.value;
  }
  public set emissionBoost(value: number) {
    this.uniforms.emissionBoost.value = value;
  }

  /** Camera-distance soft lift/fade approx */
  public get distanceFade(): number {
    return this.uniforms.distanceFade.value;
  }
  public set distanceFade(value: number) {
    this.uniforms.distanceFade.value = value;
  }

  /** Face preset: softer primary shadow border */
  public get faceSoft(): number {
    return this.uniforms.faceSoft.value;
  }
  public set faceSoft(value: number) {
    this.uniforms.faceSoft.value = value;
  }

  /** Amplify normalMap XY for skin depth */
  public get normalSkinBoost(): number {
    return this.uniforms.normalSkinBoost.value;
  }
  public set normalSkinBoost(value: number) {
    this.uniforms.normalSkinBoost.value = value;
  }

  /** lil _ShadowEnvStrength-like shade lift */
  public get envStrength(): number {
    return this.uniforms.envStrength.value;
  }
  public set envStrength(value: number) {
    this.uniforms.envStrength.value = value;
  }

  /** Gem-ish fresnel proxy (0 unless jewelry heuristic) */
  public get gemFresnel(): number {
    return this.uniforms.gemFresnel.value;
  }
  public set gemFresnel(value: number) {
    this.uniforms.gemFresnel.value = value;
  }

  /** Outline lighting mix bias (safe with outline-off) */
  public get outlineMix(): number {
    return this.uniforms.outlineMix.value;
  }
  public set outlineMix(value: number) {
    this.uniforms.outlineMix.value = value;
  }

  /** Receive shadow map factor: 1.0 = full shadow, 0.0 = ignore shadow map (clean anime face) */
  public get receiveShadowRate(): number {
    return this.uniforms.receiveShadowRate.value;
  }
  public set receiveShadowRate(value: number) {
    this.uniforms.receiveShadowRate.value = value;
  }

  /** Velvet / fabric grazing sheen strength (lilToon cloth feel) */
  public get fabricSheenStrength(): number {
    return this.uniforms.fabricSheenStrength.value;
  }
  public set fabricSheenStrength(value: number) {
    this.uniforms.fabricSheenStrength.value = value;
  }

  public get fabricSheenPower(): number {
    return this.uniforms.fabricSheenPower.value;
  }
  public set fabricSheenPower(value: number) {
    this.uniforms.fabricSheenPower.value = value;
  }

  public get fabricSheenColor(): THREE.Color {
    return this.uniforms.fabricSheenColor.value;
  }
  public set fabricSheenColor(value: THREE.Color) {
    this.uniforms.fabricSheenColor.value = value;
  }

  /** lilToon-like Fake SSS peach blood-tint halo strength (0..1) */

  public get outlineWidthMultiplyTexture(): THREE.Texture | null {
    return this.uniforms.outlineWidthMultiplyTexture.value;
  }
  public set outlineWidthMultiplyTexture(value: THREE.Texture | null) {
    this.uniforms.outlineWidthMultiplyTexture.value = value;
  }

  public get outlineWidthFactor(): number {
    return this.uniforms.outlineWidthFactor.value;
  }
  public set outlineWidthFactor(value: number) {
    this.uniforms.outlineWidthFactor.value = value;
  }

  public get outlineColorFactor(): THREE.Color {
    return this.uniforms.outlineColorFactor.value;
  }
  public set outlineColorFactor(value: THREE.Color) {
    this.uniforms.outlineColorFactor.value = value;
  }

  public get outlineLightingMixFactor(): number {
    return this.uniforms.outlineLightingMixFactor.value;
  }
  public set outlineLightingMixFactor(value: number) {
    this.uniforms.outlineLightingMixFactor.value = value;
  }

  public get uvAnimationMaskTexture(): THREE.Texture | null {
    return this.uniforms.uvAnimationMaskTexture.value;
  }
  public set uvAnimationMaskTexture(value: THREE.Texture | null) {
    this.uniforms.uvAnimationMaskTexture.value = value;
  }

  public get uvAnimationScrollXOffset(): number {
    return this.uniforms.uvAnimationScrollXOffset.value;
  }
  public set uvAnimationScrollXOffset(value: number) {
    this.uniforms.uvAnimationScrollXOffset.value = value;
  }

  public get uvAnimationScrollYOffset(): number {
    return this.uniforms.uvAnimationScrollYOffset.value;
  }
  public set uvAnimationScrollYOffset(value: number) {
    this.uniforms.uvAnimationScrollYOffset.value = value;
  }

  public get uvAnimationRotationPhase(): number {
    return this.uniforms.uvAnimationRotationPhase.value;
  }
  public set uvAnimationRotationPhase(value: number) {
    this.uniforms.uvAnimationRotationPhase.value = value;
  }

  public uvAnimationScrollXSpeedFactor = 0.0;
  public uvAnimationScrollYSpeedFactor = 0.0;
  public uvAnimationRotationSpeedFactor = 0.0;

  /**
   * Whether the material is affected by fog.
   * `true` by default.
   */
  public fog = true;

  /**
   * Will be read in WebGLPrograms
   *
   * See: https://github.com/mrdoob/three.js/blob/4f5236ac3d6f41d904aa58401b40554e8fbdcb15/src/renderers/webgl/WebGLPrograms.js#L190-L191
   */
  public normalMapType = THREE.TangentSpaceNormalMap;

  /**
   * When this is `true`, vertex colors will be ignored.
   * `true` by default.
   */
  private _ignoreVertexColor = true;

  /**
   * When this is `true`, vertex colors will be ignored.
   * `true` by default.
   */
  public get ignoreVertexColor(): boolean {
    return this._ignoreVertexColor;
  }
  public set ignoreVertexColor(value: boolean) {
    this._ignoreVertexColor = value;

    this.needsUpdate = true;
  }

  private _v0CompatShade = false;

  /**
   * There is a line of the shader called "comment out if you want to PBR absolutely" in VRM0.0 MToon.
   * When this is true, the material enables the line to make it compatible with the legacy rendering of VRM.
   * Usually not recommended to turn this on.
   * `false` by default.
   */
  get v0CompatShade(): boolean {
    return this._v0CompatShade;
  }

  /**
   * There is a line of the shader called "comment out if you want to PBR absolutely" in VRM0.0 MToon.
   * When this is true, the material enables the line to make it compatible with the legacy rendering of VRM.
   * Usually not recommended to turn this on.
   * `false` by default.
   */
  set v0CompatShade(v: boolean) {
    this._v0CompatShade = v;

    this.needsUpdate = true;
  }

  private _debugMode: MToonMaterialDebugMode = MToonMaterialDebugMode.None;

  /**
   * Debug mode for the material.
   * You can visualize several components for diagnosis using debug mode.
   *
   * See: {@link MToonMaterialDebugMode}
   */
  get debugMode(): MToonMaterialDebugMode {
    return this._debugMode;
  }

  /**
   * Debug mode for the material.
   * You can visualize several components for diagnosis using debug mode.
   *
   * See: {@link MToonMaterialDebugMode}
   */
  set debugMode(m: MToonMaterialDebugMode) {
    this._debugMode = m;

    this.needsUpdate = true;
  }

  private _outlineWidthMode: MToonMaterialOutlineWidthMode = MToonMaterialOutlineWidthMode.None;

  get outlineWidthMode(): MToonMaterialOutlineWidthMode {
    return this._outlineWidthMode;
  }
  set outlineWidthMode(m: MToonMaterialOutlineWidthMode) {
    this._outlineWidthMode = m;

    this.needsUpdate = true;
  }

  private _isOutline = false;

  get isOutline(): boolean {
    return this._isOutline;
  }
  set isOutline(b: boolean) {
    this._isOutline = b;

    this.needsUpdate = true;
  }

  /**
   * Readonly boolean that indicates this is a {@link MToonMaterial}.
   */
  public get isMToonMaterial(): true {
    return true;
  }

  constructor(parameters: MToonMaterialParameters = {}) {
    super({ vertexShader, fragmentShader });

    // override depthWrite with transparentWithZWrite
    if (parameters.transparentWithZWrite) {
      parameters.depthWrite = true;
    }
    delete parameters.transparentWithZWrite;

    // == enabling bunch of stuff ==================================================================
    parameters.fog = true;
    parameters.lights = true;
    parameters.clipping = true;

    // == uniforms =================================================================================
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.common, // map
      THREE.UniformsLib.normalmap, // normalMap
      THREE.UniformsLib.emissivemap, // emissiveMap
      THREE.UniformsLib.fog,
      THREE.UniformsLib.lights,
      {
        litFactor: { value: new THREE.Color(1.0, 1.0, 1.0) },
        mapUvTransform: { value: new THREE.Matrix3() },
        colorAlpha: { value: 1.0 },
        normalMapUvTransform: { value: new THREE.Matrix3() },
        shadeColorFactor: { value: new THREE.Color(0.0, 0.0, 0.0) },
        shadeMultiplyTexture: { value: null },
        shadeMultiplyTextureUvTransform: { value: new THREE.Matrix3() },
        shadingShiftFactor: { value: 0.0 },
        shadingShiftTexture: { value: null },
        shadingShiftTextureUvTransform: { value: new THREE.Matrix3() },
        shadingShiftTextureScale: { value: 1.0 },
        shadingToonyFactor: { value: 0.9 },
        giEqualizationFactor: { value: 0.9 },
        matcapFactor: { value: new THREE.Color(1.0, 1.0, 1.0) },
        matcapTexture: { value: null },
        matcapTextureUvTransform: { value: new THREE.Matrix3() },
        parametricRimColorFactor: { value: new THREE.Color(0.0, 0.0, 0.0) },
        rimMultiplyTexture: { value: null },
        rimMultiplyTextureUvTransform: { value: new THREE.Matrix3() },
        rimLightingMixFactor: { value: 1.0 },
        parametricRimFresnelPowerFactor: { value: 5.0 },
        parametricRimLiftFactor: { value: 0.0 },
        emissive: { value: new THREE.Color(0.0, 0.0, 0.0) },
        emissiveIntensity: { value: 1.0 },
        emissiveMapUvTransform: { value: new THREE.Matrix3() },
        outlineWidthMultiplyTexture: { value: null },
        outlineWidthMultiplyTextureUvTransform: { value: new THREE.Matrix3() },
        outlineWidthFactor: { value: 0.0 },
        outlineColorFactor: { value: new THREE.Color(0.0, 0.0, 0.0) },
        outlineLightingMixFactor: { value: 1.0 },
        uvAnimationMaskTexture: { value: null },
        uvAnimationMaskTextureUvTransform: { value: new THREE.Matrix3() },
        uvAnimationScrollXOffset: { value: 0.0 },
        uvAnimationScrollYOffset: { value: 0.0 },
        uvAnimationRotationPhase: { value: 0.0 },
        // Extended MToon tuning parameters (default off = classic MToon behavior)
        softMix: { value: 0.0 },
        blurBoost: { value: 0.0 },
        shadow2ndStrength: { value: 0.0 },
        shadow2ndBorder: { value: 0.32 },
        shadow2ndBlur: { value: 0.22 },
        shadow2ndColor: { value: new THREE.Color(0.68, 0.62, 0.78) },
        shadow3rdStrength: { value: 0.0 },
        shadow3rdBorder: { value: 0.14 },
        shadow3rdBlur: { value: 0.2 },
        shadow3rdColor: { value: new THREE.Color(0.52, 0.48, 0.60) },
        rimBoost: { value: 1.0 },
        rimBorder: { value: 0.0 },
        rimBlur: { value: 0.0 },
        rimDirStrength: { value: 0.0 },
        hairSpecStrength: { value: 0.0 },
        hairSpecPower: { value: 56.0 },
        hairSpecShift: { value: -0.1 },
        clothSpecStrength: { value: 0.0 },
        clothSpecPower: { value: 72.0 },
        matcap2ndStrength: { value: 0.0 },
        skinSpecStrength: { value: 0.0 },
        skinSpecPower: { value: 28.0 },
        skinSpecFresnel: { value: 0.45 },
        skinSpecColor: { value: new THREE.Color(1.0, 0.96, 0.94) },
        ambientLift: { value: 0.0 },
        shadeMainStrength: { value: 0.0 },
        shadowBorder: { value: -1.0 },
        shadowBlur: { value: 0.0 },
        rimMainStrength: { value: 0.0 },
        rimShadowMask: { value: 0.0 },
        specularStrength: { value: 0.0 },
        specularPower: { value: 48.0 },
        specularBorder: { value: 0.5 },
        specularBlur: { value: 0.1 },
        reflectStrength: { value: 0.0 },
        reflectFresnel: { value: 0.55 },
        reflectMetallic: { value: 0.0 },
        reflectSmoothness: { value: 0.55 },
        backlightStrength: { value: 0.0 },
        backlightColor: { value: new THREE.Color(1.0, 0.85, 0.75) },
        rimFresnelPower: { value: 0.0 },
        rimIndirStrength: { value: 0.0 },
        matcap2ndContrast: { value: 1.25 },
        matcap2ndScale: { value: 1.0 },
        emissionBoost: { value: 0.0 },
        distanceFade: { value: 0.0 },
        faceSoft: { value: 0.0 },
        normalSkinBoost: { value: 0.0 },
        envStrength: { value: 0.0 },
        gemFresnel: { value: 0.0 },
        outlineMix: { value: 0.0 },
        receiveShadowRate: { value: 1.0 },
        fabricSheenStrength: { value: 0.0 },
        fabricSheenPower: { value: 3.5 },
        fabricSheenColor: { value: new THREE.Color(0xffe8df) },
      },
      parameters.uniforms ?? {},
    ]) as typeof MToonMaterial.prototype.uniforms;

    // == finally compile the shader program =======================================================
    this.setValues(parameters);

    // == upload uniforms that need to upload ======================================================
    this._uploadUniformsWorkaround();

    // == update shader stuff ======================================================================
    this.customProgramCacheKey = () =>
      [
        ...Object.entries(this._generateDefines()).map(([token, macro]) => `${token}:${macro}`),
        this.matcapTexture ? `matcapTextureColorSpace:${getTextureColorSpace(this.matcapTexture)}` : '',
        this.shadeMultiplyTexture
          ? `shadeMultiplyTextureColorSpace:${getTextureColorSpace(this.shadeMultiplyTexture)}`
          : '',
        this.rimMultiplyTexture ? `rimMultiplyTextureColorSpace:${getTextureColorSpace(this.rimMultiplyTexture)}` : '',
      ].join(',');

    this.onBeforeCompile = (shader) => {
      const threeRevision = parseInt(THREE.REVISION, 10);

      const defines =
        Object.entries({ ...this._generateDefines(), ...this.defines })
          .filter(([token, macro]) => !!macro)
          .map(([token, macro]) => `#define ${token} ${macro}`)
          .join('\n') + '\n';

      // -- generate shader code -------------------------------------------------------------------
      shader.vertexShader = defines + shader.vertexShader;
      shader.fragmentShader = defines + shader.fragmentShader;

      // -- compat ---------------------------------------------------------------------------------

      // COMPAT: pre-r154
      // Three.js r154 renames the shader chunk <colorspace_fragment> to <encodings_fragment>
      if (threeRevision < 154) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <colorspace_fragment>',
          '#include <encodings_fragment>',
        );
      }
    };
  }

  /**
   * Update this material.
   *
   * @param delta deltaTime since last update
   */
  public update(delta: number): void {
    this._uploadUniformsWorkaround();
    this._updateUVAnimation(delta);
  }

  public copy(source: this): this {
    super.copy(source);
    // uniforms are already copied at this moment

    // Beginning from r133, uniform textures will be cloned instead of reference
    // See: https://github.com/mrdoob/three.js/blob/a8813be04a849bd155f7cf6f1b23d8ee2e0fb48b/examples/jsm/loaders/GLTFLoader.js#L3047
    // See: https://github.com/mrdoob/three.js/blob/a8813be04a849bd155f7cf6f1b23d8ee2e0fb48b/src/renderers/shaders/UniformsUtils.js#L22
    // This will leave their `.version` to be `0`
    // and these textures won't be uploaded to GPU
    // We are going to workaround this in here
    // I've opened an issue for this: https://github.com/mrdoob/three.js/issues/22718
    this.map = source.map;
    this.normalMap = source.normalMap;
    this.emissiveMap = source.emissiveMap;
    this.shadeMultiplyTexture = source.shadeMultiplyTexture;
    this.shadingShiftTexture = source.shadingShiftTexture;
    this.matcapTexture = source.matcapTexture;
    this.rimMultiplyTexture = source.rimMultiplyTexture;
    this.outlineWidthMultiplyTexture = source.outlineWidthMultiplyTexture;
    this.uvAnimationMaskTexture = source.uvAnimationMaskTexture;

    // == copy members =============================================================================
    this.normalMapType = source.normalMapType;

    this.uvAnimationScrollXSpeedFactor = source.uvAnimationScrollXSpeedFactor;
    this.uvAnimationScrollYSpeedFactor = source.uvAnimationScrollYSpeedFactor;
    this.uvAnimationRotationSpeedFactor = source.uvAnimationRotationSpeedFactor;

    this.ignoreVertexColor = source.ignoreVertexColor;

    this.v0CompatShade = source.v0CompatShade;
    this.debugMode = source.debugMode;
    this.outlineWidthMode = source.outlineWidthMode;

    this.isOutline = source.isOutline;

    // == update shader stuff ======================================================================
    this.needsUpdate = true;

    return this;
  }

  /**
   * Update UV animation state.
   * Intended to be called via {@link update}.
   * @param delta deltaTime
   */
  private _updateUVAnimation(delta: number): void {
    this.uniforms.uvAnimationScrollXOffset.value += delta * this.uvAnimationScrollXSpeedFactor;
    this.uniforms.uvAnimationScrollYOffset.value += delta * this.uvAnimationScrollYSpeedFactor;
    this.uniforms.uvAnimationRotationPhase.value += delta * this.uvAnimationRotationSpeedFactor;
    this.uniforms.alphaTest.value = this.alphaTest;

    this.uniformsNeedUpdate = true;
  }

  /**
   * Upload uniforms that need to upload but doesn't automatically because of reasons.
   * Intended to be called via {@link constructor} and {@link update}.
   */
  private _uploadUniformsWorkaround(): void {
    // workaround: since opacity is defined as a property in THREE.Material
    // and cannot be overridden as an accessor,
    // We are going to update opacity here
    this.uniforms.opacity.value = this.opacity;

    // workaround: texture transforms are not updated automatically
    this._updateTextureMatrix(this.uniforms.map, this.uniforms.mapUvTransform);
    this._updateTextureMatrix(this.uniforms.normalMap, this.uniforms.normalMapUvTransform);
    this._updateTextureMatrix(this.uniforms.emissiveMap, this.uniforms.emissiveMapUvTransform);
    this._updateTextureMatrix(this.uniforms.shadeMultiplyTexture, this.uniforms.shadeMultiplyTextureUvTransform);
    this._updateTextureMatrix(this.uniforms.shadingShiftTexture, this.uniforms.shadingShiftTextureUvTransform);
    this._updateTextureMatrix(this.uniforms.matcapTexture, this.uniforms.matcapTextureUvTransform);
    this._updateTextureMatrix(this.uniforms.rimMultiplyTexture, this.uniforms.rimMultiplyTextureUvTransform);
    this._updateTextureMatrix(
      this.uniforms.outlineWidthMultiplyTexture,
      this.uniforms.outlineWidthMultiplyTextureUvTransform,
    );
    this._updateTextureMatrix(this.uniforms.uvAnimationMaskTexture, this.uniforms.uvAnimationMaskTextureUvTransform);

    this.uniformsNeedUpdate = true;
  }

  /**
   * Returns a map object of preprocessor token and macro of the shader program.
   */
  private _generateDefines(): { [token: string]: boolean | number | string } {
    const threeRevision = parseInt(THREE.REVISION, 10);

    const useUvInVert = this.outlineWidthMultiplyTexture !== null;
    const useUvInFrag =
      this.map !== null ||
      this.normalMap !== null ||
      this.emissiveMap !== null ||
      this.shadeMultiplyTexture !== null ||
      this.shadingShiftTexture !== null ||
      this.rimMultiplyTexture !== null ||
      this.uvAnimationMaskTexture !== null;

    return {
      // Temporary compat against shader change @ Three.js r126
      // See: #21205, #21307, #21299
      THREE_VRM_THREE_REVISION: threeRevision,

      OUTLINE: this._isOutline,
      MTOON_USE_UV: useUvInVert || useUvInFrag, // we can't use `USE_UV` , it will be redefined in WebGLProgram.js
      MTOON_UVS_VERTEX_ONLY: useUvInVert && !useUvInFrag,
      V0_COMPAT_SHADE: this._v0CompatShade,
      USE_SHADEMULTIPLYTEXTURE: this.shadeMultiplyTexture !== null,
      USE_SHADINGSHIFTTEXTURE: this.shadingShiftTexture !== null,
      USE_MATCAPTEXTURE: this.matcapTexture !== null,
      USE_RIMMULTIPLYTEXTURE: this.rimMultiplyTexture !== null,
      USE_OUTLINEWIDTHMULTIPLYTEXTURE: this._isOutline && this.outlineWidthMultiplyTexture !== null,
      USE_UVANIMATIONMASKTEXTURE: this.uvAnimationMaskTexture !== null,
      IGNORE_VERTEX_COLOR: this._ignoreVertexColor === true,
      DEBUG_NORMAL: this._debugMode === 'normal',
      DEBUG_LITSHADERATE: this._debugMode === 'litShadeRate',
      DEBUG_UV: this._debugMode === 'uv',
      OUTLINE_WIDTH_SCREEN:
        this._isOutline && this._outlineWidthMode === MToonMaterialOutlineWidthMode.ScreenCoordinates,
    };
  }

  private _updateTextureMatrix(src: THREE.IUniform<THREE.Texture | null>, dst: THREE.IUniform<THREE.Matrix3>): void {
    if (src.value) {
      if (src.value.matrixAutoUpdate) {
        src.value.updateMatrix();
      }

      dst.value.copy(src.value.matrix);
    }
  }
}
