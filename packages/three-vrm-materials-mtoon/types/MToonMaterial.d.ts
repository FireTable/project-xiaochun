import * as THREE from 'three';
import { MToonMaterialDebugMode } from './MToonMaterialDebugMode';
import { MToonMaterialOutlineWidthMode } from './MToonMaterialOutlineWidthMode';
import type { MToonMaterialParameters } from './MToonMaterialParameters';
/**
 * MToon is a material specification that has various features.
 * The spec and implementation are originally founded for Unity engine and this is a port of the material.
 *
 * See: https://github.com/Santarh/MToon
 */
export declare class MToonMaterial extends THREE.ShaderMaterial {
    uniforms: {
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
    };
    get color(): THREE.Color;
    set color(value: THREE.Color);
    get map(): THREE.Texture | null;
    set map(value: THREE.Texture | null);
    get normalMap(): THREE.Texture | null;
    set normalMap(value: THREE.Texture | null);
    get normalScale(): THREE.Vector2;
    set normalScale(value: THREE.Vector2);
    get emissive(): THREE.Color;
    set emissive(value: THREE.Color);
    get emissiveIntensity(): number;
    set emissiveIntensity(value: number);
    get emissiveMap(): THREE.Texture | null;
    set emissiveMap(value: THREE.Texture | null);
    get shadeColorFactor(): THREE.Color;
    set shadeColorFactor(value: THREE.Color);
    get shadeMultiplyTexture(): THREE.Texture | null;
    set shadeMultiplyTexture(value: THREE.Texture | null);
    get shadingShiftFactor(): number;
    set shadingShiftFactor(value: number);
    get shadingShiftTexture(): THREE.Texture | null;
    set shadingShiftTexture(value: THREE.Texture | null);
    get shadingShiftTextureScale(): number;
    set shadingShiftTextureScale(value: number);
    get shadingToonyFactor(): number;
    set shadingToonyFactor(value: number);
    get giEqualizationFactor(): number;
    set giEqualizationFactor(value: number);
    get matcapFactor(): THREE.Color;
    set matcapFactor(value: THREE.Color);
    get matcapTexture(): THREE.Texture | null;
    set matcapTexture(value: THREE.Texture | null);
    get parametricRimColorFactor(): THREE.Color;
    set parametricRimColorFactor(value: THREE.Color);
    get rimMultiplyTexture(): THREE.Texture | null;
    set rimMultiplyTexture(value: THREE.Texture | null);
    get rimLightingMixFactor(): number;
    set rimLightingMixFactor(value: number);
    get parametricRimFresnelPowerFactor(): number;
    set parametricRimFresnelPowerFactor(value: number);
    get parametricRimLiftFactor(): number;
    set parametricRimLiftFactor(value: number);
    /** 0..1 blend toward half-Lambert soft toon (lilToon-like). Default 0.95 */
    get softMix(): number;
    set softMix(value: number);
    /** Extra blur width added to (1 - shadingToony) on the soft path. Default 0.32 */
    get blurBoost(): number;
    set blurBoost(value: number);
    get shadow2ndStrength(): number;
    set shadow2ndStrength(value: number);
    get shadow2ndBorder(): number;
    set shadow2ndBorder(value: number);
    get shadow2ndBlur(): number;
    set shadow2ndBlur(value: number);
    get shadow2ndColor(): THREE.Color;
    set shadow2ndColor(value: THREE.Color);
    get shadow3rdStrength(): number;
    set shadow3rdStrength(value: number);
    get shadow3rdBorder(): number;
    set shadow3rdBorder(value: number);
    get shadow3rdBlur(): number;
    set shadow3rdBlur(value: number);
    get shadow3rdColor(): THREE.Color;
    set shadow3rdColor(value: THREE.Color);
    /** Multiplier on tooned rim. Default 1.4; eyes careful via VRMMaterialManager */
    get rimBoost(): number;
    set rimBoost(value: number);
    get rimBorder(): number;
    set rimBorder(value: number);
    get rimBlur(): number;
    set rimBlur(value: number);
    get rimDirStrength(): number;
    set rimDirStrength(value: number);
    get hairSpecStrength(): number;
    set hairSpecStrength(value: number);
    get hairSpecPower(): number;
    set hairSpecPower(value: number);
    get hairSpecShift(): number;
    set hairSpecShift(value: number);
    get clothSpecStrength(): number;
    set clothSpecStrength(value: number);
    get clothSpecPower(): number;
    set clothSpecPower(value: number);
    get matcap2ndStrength(): number;
    set matcap2ndStrength(value: number);
    get skinSpecStrength(): number;
    set skinSpecStrength(value: number);
    get skinSpecPower(): number;
    set skinSpecPower(value: number);
    get skinSpecFresnel(): number;
    set skinSpecFresnel(value: number);
    get skinSpecColor(): THREE.Color;
    set skinSpecColor(value: THREE.Color);
    get ambientLift(): number;
    set ambientLift(value: number);
    get shadeMainStrength(): number;
    set shadeMainStrength(value: number);
    get shadowBorder(): number;
    set shadowBorder(value: number);
    get shadowBlur(): number;
    set shadowBlur(value: number);
    get rimMainStrength(): number;
    set rimMainStrength(value: number);
    get rimShadowMask(): number;
    set rimShadowMask(value: number);
    /** lilCalcSpecular-like toon specular strength (0 = off) */
    get specularStrength(): number;
    set specularStrength(value: number);
    /** Specular Blinn power / inverse-roughness proxy */
    get specularPower(): number;
    set specularPower(value: number);
    /** Toon specular border in [0,1] */
    get specularBorder(): number;
    set specularBorder(value: number);
    /** Toon specular blur width */
    get specularBlur(): number;
    set specularBlur(value: number);
    /** View-dependent env reflection approx (no cubemap) */
    get reflectStrength(): number;
    set reflectStrength(value: number);
    /** Fresnel amount for env approx */
    get reflectFresnel(): number;
    set reflectFresnel(value: number);
    /** 0 dielectric .. 1 metal (tints reflection toward albedo) */
    get reflectMetallic(): number;
    set reflectMetallic(value: number);
    /** Sharper grazing reflection when high */
    get reflectSmoothness(): number;
    set reflectSmoothness(value: number);
    /** lil backlight wrap strength (0 = off) */
    get backlightStrength(): number;
    set backlightStrength(value: number);
    /** Backlight tint color */
    get backlightColor(): THREE.Color;
    set backlightColor(value: THREE.Color);
    /** >0 overrides parametric rim fresnel power */
    get rimFresnelPower(): number;
    set rimFresnelPower(value: number);
    /** Opposite-side rim (lil RimIndir) */
    get rimIndirStrength(): number;
    set rimIndirStrength(value: number);
    /** Contrast for synthesized 2nd MatCap */
    get matcap2ndContrast(): number;
    set matcap2ndContrast(value: number);
    /** UV scale for 2nd MatCap resample */
    get matcap2ndScale(): number;
    set matcap2ndScale(value: number);
    /** Extra emissive scale (stock emissive * (1+boost)) */
    get emissionBoost(): number;
    set emissionBoost(value: number);
    /** Camera-distance soft lift/fade approx */
    get distanceFade(): number;
    set distanceFade(value: number);
    /** Face preset: softer primary shadow border */
    get faceSoft(): number;
    set faceSoft(value: number);
    /** Amplify normalMap XY for skin depth */
    get normalSkinBoost(): number;
    set normalSkinBoost(value: number);
    /** lil _ShadowEnvStrength-like shade lift */
    get envStrength(): number;
    set envStrength(value: number);
    /** Gem-ish fresnel proxy (0 unless jewelry heuristic) */
    get gemFresnel(): number;
    set gemFresnel(value: number);
    /** Outline lighting mix bias (safe with outline-off) */
    get outlineMix(): number;
    set outlineMix(value: number);
    /** lilToon-like Fake SSS peach blood-tint halo strength (0..1) */
    get outlineWidthMultiplyTexture(): THREE.Texture | null;
    set outlineWidthMultiplyTexture(value: THREE.Texture | null);
    get outlineWidthFactor(): number;
    set outlineWidthFactor(value: number);
    get outlineColorFactor(): THREE.Color;
    set outlineColorFactor(value: THREE.Color);
    get outlineLightingMixFactor(): number;
    set outlineLightingMixFactor(value: number);
    get uvAnimationMaskTexture(): THREE.Texture | null;
    set uvAnimationMaskTexture(value: THREE.Texture | null);
    get uvAnimationScrollXOffset(): number;
    set uvAnimationScrollXOffset(value: number);
    get uvAnimationScrollYOffset(): number;
    set uvAnimationScrollYOffset(value: number);
    get uvAnimationRotationPhase(): number;
    set uvAnimationRotationPhase(value: number);
    uvAnimationScrollXSpeedFactor: number;
    uvAnimationScrollYSpeedFactor: number;
    uvAnimationRotationSpeedFactor: number;
    /**
     * Whether the material is affected by fog.
     * `true` by default.
     */
    fog: boolean;
    /**
     * Will be read in WebGLPrograms
     *
     * See: https://github.com/mrdoob/three.js/blob/4f5236ac3d6f41d904aa58401b40554e8fbdcb15/src/renderers/webgl/WebGLPrograms.js#L190-L191
     */
    normalMapType: 0;
    /**
     * When this is `true`, vertex colors will be ignored.
     * `true` by default.
     */
    private _ignoreVertexColor;
    /**
     * When this is `true`, vertex colors will be ignored.
     * `true` by default.
     */
    get ignoreVertexColor(): boolean;
    set ignoreVertexColor(value: boolean);
    private _v0CompatShade;
    /**
     * There is a line of the shader called "comment out if you want to PBR absolutely" in VRM0.0 MToon.
     * When this is true, the material enables the line to make it compatible with the legacy rendering of VRM.
     * Usually not recommended to turn this on.
     * `false` by default.
     */
    get v0CompatShade(): boolean;
    /**
     * There is a line of the shader called "comment out if you want to PBR absolutely" in VRM0.0 MToon.
     * When this is true, the material enables the line to make it compatible with the legacy rendering of VRM.
     * Usually not recommended to turn this on.
     * `false` by default.
     */
    set v0CompatShade(v: boolean);
    private _debugMode;
    /**
     * Debug mode for the material.
     * You can visualize several components for diagnosis using debug mode.
     *
     * See: {@link MToonMaterialDebugMode}
     */
    get debugMode(): MToonMaterialDebugMode;
    /**
     * Debug mode for the material.
     * You can visualize several components for diagnosis using debug mode.
     *
     * See: {@link MToonMaterialDebugMode}
     */
    set debugMode(m: MToonMaterialDebugMode);
    private _outlineWidthMode;
    get outlineWidthMode(): MToonMaterialOutlineWidthMode;
    set outlineWidthMode(m: MToonMaterialOutlineWidthMode);
    private _isOutline;
    get isOutline(): boolean;
    set isOutline(b: boolean);
    /**
     * Readonly boolean that indicates this is a {@link MToonMaterial}.
     */
    get isMToonMaterial(): true;
    constructor(parameters?: MToonMaterialParameters);
    /**
     * Update this material.
     *
     * @param delta deltaTime since last update
     */
    update(delta: number): void;
    copy(source: this): this;
    /**
     * Update UV animation state.
     * Intended to be called via {@link update}.
     * @param delta deltaTime
     */
    private _updateUVAnimation;
    /**
     * Upload uniforms that need to upload but doesn't automatically because of reasons.
     * Intended to be called via {@link constructor} and {@link update}.
     */
    private _uploadUniformsWorkaround;
    /**
     * Returns a map object of preprocessor token and macro of the shader program.
     */
    private _generateDefines;
    private _updateTextureMatrix;
}
