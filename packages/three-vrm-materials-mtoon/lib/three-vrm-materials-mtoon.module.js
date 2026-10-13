/*!
 * @firetable/three-vrm-materials-mtoon v3.5.6
 * Extended @pixiv/three-vrm-materials-mtoon with NPR shading controls while preserving MToon API
 *
 * Copyright (c) 2019-2026 pixiv Inc.; FireTable XiaoChun fork
 * Distributed under MIT License
 * Upstream: https://github.com/pixiv/three-vrm/blob/release/LICENSE
 */
var __defProp = Object.defineProperty;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/MToonMaterialLoaderPlugin.ts
import * as THREE5 from "three";

// src/GLTFMToonMaterialParamsAssignHelper.ts
import * as THREE2 from "three";

// src/utils/setTextureColorSpace.ts
import * as THREE from "three";
var colorSpaceEncodingMap = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  "": 3e3,
  srgb: 3001
};
function setTextureColorSpace(texture, colorSpace) {
  if (parseInt(THREE.REVISION, 10) >= 152) {
    texture.colorSpace = colorSpace;
  } else {
    texture.encoding = colorSpaceEncodingMap[colorSpace];
  }
}

// src/GLTFMToonMaterialParamsAssignHelper.ts
var GLTFMToonMaterialParamsAssignHelper = class {
  get pending() {
    return Promise.all(this._pendings);
  }
  constructor(parser, materialParams) {
    this._parser = parser;
    this._materialParams = materialParams;
    this._pendings = [];
  }
  assignPrimitive(key, value) {
    if (value != null) {
      this._materialParams[key] = value;
    }
  }
  assignColor(key, value, convertSRGBToLinear) {
    if (value != null) {
      const color = new THREE2.Color().fromArray(value);
      if (convertSRGBToLinear) {
        color.convertSRGBToLinear();
      }
      this._materialParams[key] = color;
    }
  }
  assignTexture(key, schemaTexture, isColorTexture) {
    return __async(this, null, function* () {
      const promise = (() => __async(this, null, function* () {
        if (schemaTexture != null) {
          const texture = yield this._parser.assignTexture(this._materialParams, key, schemaTexture);
          if (texture == null) {
            console.warn(
              "GLTFMToonMaterialParamsAssignHelper: Failed to load texture. The rendering result may be wrong"
            );
            return;
          }
          if (isColorTexture) {
            setTextureColorSpace(texture, "srgb");
          }
        }
      }))();
      this._pendings.push(promise);
      return promise;
    });
  }
  assignTextureByIndex(key, textureIndex, isColorTexture) {
    return __async(this, null, function* () {
      return this.assignTexture(key, textureIndex != null ? { index: textureIndex } : void 0, isColorTexture);
    });
  }
};

// src/MToonMaterial.ts
import * as THREE4 from "three";

// src/shaders/mtoon.vert
var mtoon_default = "// #define PHONG\n\nvarying vec3 vViewPosition;\n\n#ifndef FLAT_SHADED\n  varying vec3 vNormal;\n#endif\n\n#include <common>\n\n// #include <uv_pars_vertex>\n#ifdef MTOON_USE_UV\n  varying vec2 vUv;\n\n  // COMPAT: pre-r151 uses a common uvTransform\n  #if THREE_VRM_THREE_REVISION < 151\n    uniform mat3 uvTransform;\n  #endif\n#endif\n\n// #include <uv2_pars_vertex>\n// COMAPT: pre-r151 uses uv2 for lightMap and aoMap\n#if THREE_VRM_THREE_REVISION < 151\n  #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )\n    attribute vec2 uv2;\n    varying vec2 vUv2;\n    uniform mat3 uv2Transform;\n  #endif\n#endif\n\n// #include <displacementmap_pars_vertex>\n// #include <envmap_pars_vertex>\n#include <color_pars_vertex>\n#include <fog_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <shadowmap_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\n\n#ifdef USE_OUTLINEWIDTHMULTIPLYTEXTURE\n  uniform sampler2D outlineWidthMultiplyTexture;\n  uniform mat3 outlineWidthMultiplyTextureUvTransform;\n#endif\n\nuniform float outlineWidthFactor;\n\nvoid main() {\n\n  // #include <uv_vertex>\n  #ifdef MTOON_USE_UV\n    // COMPAT: pre-r151 uses a common uvTransform\n    #if THREE_VRM_THREE_REVISION >= 151\n      vUv = uv;\n    #else\n      vUv = ( uvTransform * vec3( uv, 1 ) ).xy;\n    #endif\n  #endif\n\n  // #include <uv2_vertex>\n  // COMAPT: pre-r151 uses uv2 for lightMap and aoMap\n  #if THREE_VRM_THREE_REVISION < 151\n    #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )\n      vUv2 = ( uv2Transform * vec3( uv2, 1 ) ).xy;\n    #endif\n  #endif\n\n  #include <color_vertex>\n\n  #include <beginnormal_vertex>\n  #include <morphnormal_vertex>\n  #include <skinbase_vertex>\n  #include <skinnormal_vertex>\n\n  // we need this to compute the outline properly\n  objectNormal = normalize( objectNormal );\n\n  #include <defaultnormal_vertex>\n\n  #ifndef FLAT_SHADED // Normal computed with derivatives when FLAT_SHADED\n    vNormal = normalize( transformedNormal );\n  #endif\n\n  #include <begin_vertex>\n\n  #include <morphtarget_vertex>\n  #include <skinning_vertex>\n  // #include <displacementmap_vertex>\n  #include <project_vertex>\n  #include <logdepthbuf_vertex>\n  #include <clipping_planes_vertex>\n\n  vViewPosition = - mvPosition.xyz;\n\n  #ifdef OUTLINE\n    float worldNormalLength = length( transformedNormal );\n    vec3 outlineOffset = outlineWidthFactor * worldNormalLength * objectNormal;\n\n    #ifdef USE_OUTLINEWIDTHMULTIPLYTEXTURE\n      vec2 outlineWidthMultiplyTextureUv = ( outlineWidthMultiplyTextureUvTransform * vec3( vUv, 1 ) ).xy;\n      float outlineTex = texture2D( outlineWidthMultiplyTexture, outlineWidthMultiplyTextureUv ).g;\n      outlineOffset *= outlineTex;\n    #endif\n\n    #ifdef OUTLINE_WIDTH_SCREEN\n      // \u8DDD\u79BB\u81EA\u9002\u5E94\u9650\u5236\uFF0C\u907F\u514D\u8FDC\u666F\u63CF\u8FB9\u53D8\u7C97\u9ED1\u56E2\uFF0C\u8FD1\u666F\u7A7F\u63D2\u65AD\u5C42\n      float outlineDist = clamp( vViewPosition.z, 0.45, 5.0 );\n      outlineOffset *= outlineDist / projectionMatrix[ 1 ].y;\n    #endif\n\n    gl_Position = projectionMatrix * modelViewMatrix * vec4( outlineOffset + transformed, 1.0 );\n\n    gl_Position.z += 1E-6 * gl_Position.w; // anti-artifact magic\n  #endif\n\n  #include <worldpos_vertex>\n  // #include <envmap_vertex>\n  #include <shadowmap_vertex>\n  #include <fog_vertex>\n\n}";

// src/shaders/mtoon.frag
var mtoon_default2 = `// #define PHONG

uniform vec3 litFactor;

uniform float opacity;

uniform vec3 shadeColorFactor;
#ifdef USE_SHADEMULTIPLYTEXTURE
  uniform sampler2D shadeMultiplyTexture;
  uniform mat3 shadeMultiplyTextureUvTransform;
#endif

uniform float shadingShiftFactor;
uniform float shadingToonyFactor;

#ifdef USE_SHADINGSHIFTTEXTURE
  uniform sampler2D shadingShiftTexture;
  uniform mat3 shadingShiftTextureUvTransform;
  uniform float shadingShiftTextureScale;
#endif

uniform float giEqualizationFactor;

uniform vec3 parametricRimColorFactor;
#ifdef USE_RIMMULTIPLYTEXTURE
  uniform sampler2D rimMultiplyTexture;
  uniform mat3 rimMultiplyTextureUvTransform;
#endif
uniform float rimLightingMixFactor;
uniform float parametricRimFresnelPowerFactor;
uniform float parametricRimLiftFactor;

// Extended MToon tuning parameters
uniform float softMix;           // 0..1 blend toward half-Lambert soft path (default ~0.95)
uniform float blurBoost;         // extra toon blur width in half-Lambert space (default ~0.32)
uniform float shadow2ndStrength; // 0..1 optional 2nd shadow band (default ~0.65)
uniform float shadow2ndBorder;   // half-Lambert border for 2nd band (default ~0.32)
uniform float shadow2ndBlur;     // 2nd band blur (default ~0.16)
uniform vec3 shadow2ndColor;     // purple-gray tint \u2248 NPR _ShadowColor vibe
uniform float shadow3rdStrength; // light 3rd band (default ~0.28; 0 = off)
uniform float shadow3rdBorder;   // half-Lambert border for 3rd band (default ~0.14)
uniform float shadow3rdBlur;     // 3rd band blur (default ~0.11)
uniform vec3 shadow3rdColor;     // deeper cool purple-gray
uniform float rimBoost;          // multiply rim after toon scale (default ~1.4)
uniform float rimBorder;         // soft-like rim border in Fresnel [0,1] (default ~0.5)
uniform float rimBlur;           // soft-like rim blur width (default ~0.18)
uniform float rimDirStrength;    // directional rim (N\xB7L influence); 0 = isotropic (default ~0.35)
uniform float hairSpecStrength;  // anisotropic / angel-ring highlight (default ~0.14; hair manager \u2191)
uniform float hairSpecPower;     // highlight sharpness (default ~56)
uniform float hairSpecShift;     // primary lobe shift along tangent (default ~-0.1)
uniform float clothSpecStrength; // GGX-ish isotropic cloth/satin (default 0; manager sets)
uniform float clothSpecPower;    // cloth roughness inverse proxy \u2192 power (default ~72)
uniform float matcap2ndStrength; // cheap 2nd MatCap: resample shifted UV (default ~0.25 when matcap on)
uniform float skinSpecStrength;  // isotropic moist skin specular (default 0; face/body manager \u2191)
uniform float skinSpecPower;     // broad highlight sharpness (default ~28; lower = wetter/softer)
uniform float skinSpecFresnel;   // mild grazing sheen 0..1 (hydrated, not oily)
uniform vec3 skinSpecColor;      // warm specular tint
uniform float ambientLift;       // brighten indirect / soft-lit ambient (soft-ish)
uniform float shadeMainStrength; // mix shade toward shade*albedo (NPR _ShadowMainStrength)
uniform float shadowBorder;      // explicit NPR primary border in HL [0,1]; <0 \u2192 derive from shift
uniform float shadowBlur;        // explicit NPR primary blur; <=0 \u2192 toony+boost only
uniform float rimMainStrength;   // mix rim color toward albedo (NPR _RimMainStrength)
uniform float rimShadowMask;     // attenuate rim in deep shade 0..1

// --- Extended shading knobs (multi-band shadow, specular, reflection, backlight) ---
uniform float specularStrength;   // lilCalcSpecular-like toon specular (metallic/smoothness proxy)
uniform float specularPower;      // Blinn power / inverse roughness proxy
uniform float specularBorder;     // toon specular border
uniform float specularBlur;       // toon specular blur
uniform float reflectStrength;    // view-dependent env reflection approx (no cubemap)
uniform float reflectFresnel;     // fresnel amount for env approx
uniform float reflectMetallic;    // 0 dielectric .. 1 metal tint toward albedo
uniform float reflectSmoothness;  // sharper grazing reflection when high
uniform float backlightStrength;  // NPR backlight approx (wrap / opposite light)
uniform vec3  backlightColor;     // backlight tint
uniform float rimFresnelPower;    // >0 overrides parametric rim fresnel power
uniform float rimIndirStrength;   // opposite-side rim (NPR RimIndir)
uniform float matcap2ndContrast;  // >1 strengthens synthesized 2nd matcap
uniform float matcap2ndScale;     // UV scale for 2nd matcap resample
uniform float emissionBoost;      // scale stock emissive (NPR emission feel)
uniform float distanceFade;       // subtle camera-distance soft lift/fade 0..1
uniform float faceSoft;           // face preset: softer primary border via shadingShift
uniform float normalSkinBoost;    // amplify normal map contribution for skin depth
uniform float envStrength;        // NPR _ShadowEnvStrength-like indirect in shade
uniform float gemFresnel;         // gem-ish fresnel proxy (safe; off by default)
uniform float outlineMix;         // cooperate with outline pass lighting mix (<= stock)
uniform float receiveShadowRate;   // 0.0 = ignore shadow map (clean anime face), 1.0 = full shadow
uniform float fabricSheenStrength; // cloth grazing sheen strength
uniform float fabricSheenPower;    // cloth grazing sheen falloff power (default ~3.5)
uniform vec3 fabricSheenColor;     // cloth grazing sheen tint

#ifdef USE_MATCAPTEXTURE
  uniform vec3 matcapFactor;
  uniform sampler2D matcapTexture;
  uniform mat3 matcapTextureUvTransform;
#endif

uniform vec3 emissive;
uniform float emissiveIntensity;

uniform vec3 outlineColorFactor;
uniform float outlineLightingMixFactor;

#ifdef USE_UVANIMATIONMASKTEXTURE
  uniform sampler2D uvAnimationMaskTexture;
  uniform mat3 uvAnimationMaskTextureUvTransform;
#endif

uniform float uvAnimationScrollXOffset;
uniform float uvAnimationScrollYOffset;
uniform float uvAnimationRotationPhase;

#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>

// #include <uv_pars_fragment>
#if ( defined( MTOON_USE_UV ) && !defined( MTOON_UVS_VERTEX_ONLY ) )
  varying vec2 vUv;
#endif

// #include <uv2_pars_fragment>
// COMAPT: pre-r151 uses uv2 for lightMap and aoMap
#if THREE_VRM_THREE_REVISION < 151
  #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
    varying vec2 vUv2;
  #endif
#endif

#include <map_pars_fragment>

#ifdef USE_MAP
  uniform mat3 mapUvTransform;
#endif

// #include <alphamap_pars_fragment>

#include <alphatest_pars_fragment>

#include <aomap_pars_fragment>
// #include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>

#ifdef USE_EMISSIVEMAP
  uniform mat3 emissiveMapUvTransform;
#endif

// #include <envmap_common_pars_fragment>
// #include <envmap_pars_fragment>
// #include <cube_uv_reflection_fragment>
#include <fog_pars_fragment>

// #include <bsdfs>
// COMPAT: pre-r151 doesn't have BRDF_Lambert in <common>
#if THREE_VRM_THREE_REVISION < 151
  vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
    return RECIPROCAL_PI * diffuseColor;
  }
#endif


#include <lights_pars_begin>

#include <normal_pars_fragment>

// #include <lights_phong_pars_fragment>
varying vec3 vViewPosition;

struct MToonMaterial {
  vec3 diffuseColor;
  vec3 shadeColor;
  float shadingShift;
};

float linearstep( float a, float b, float t ) {
  return clamp( ( t - a ) / ( b - a ), 0.0, 1.0 );
}

/** Hermite smoothstep \u2014 kills toon iso-contour ripples on curved skin */
float smootherstep( float a, float b, float t ) {
  float x = linearstep( a, b, t );
  return x * x * x * ( x * ( x * 6.0 - 15.0 ) + 10.0 );
}

/**
 * Convert NdotL into toon shading factor using shadingShift and shadingToony.
 * MToon: optionally blend a extended-like half-Lambert + border/blur path (softMix).
 */
float getShading(
  const in float dotNL,
  const in float shadow,
  const in float shadingShift
) {
  // Classic MToon V1 path (N\xB7L in [-1,1] \u2192 linearstep width from shadingToony)
  float faceSoftBias = clamp( faceSoft, 0.0, 1.0 ) * 0.08;
  float shadingClassic = dotNL + shadingShift + faceSoftBias;
  shadingClassic = linearstep( -1.0 + shadingToonyFactor, 1.0 - shadingToonyFactor, shadingClassic );
  shadingClassic *= shadow;

  // Soft path \u2248 extended: half-Lambert + border/blur (smootherstep to avoid ripple bands)
  float hl = clamp( dotNL * 0.5 + 0.5, 0.0, 1.0 );
  float softMix = clamp( softMix, 0.0, 1.0 );
  float border = ( shadowBorder >= 0.0 )
    ? clamp( shadowBorder, 0.0, 1.0 )
    : clamp( 0.5 - ( shadingShift + faceSoftBias ) * 0.5 - faceSoftBias * 0.15, 0.0, 1.0 );
  float blur = ( shadowBlur > 0.0 )
    ? max( 0.001, shadowBlur )
    : max( 0.001, ( 1.0 - shadingToonyFactor ) + blurBoost );
  // High softMix + narrow blur \u2192 concentric iso-N\xB7L ripples on curved skin; enforce floor
  blur = max( blur, mix( 0.08, 0.26, softMix ) );
  float borderMin = clamp( border - 0.5 * blur, 0.0, 1.0 );
  float borderMax = clamp( border + 0.5 * blur, 0.0, 1.0 );
  float shadingSoft = smootherstep( borderMin, borderMax, hl );
  shadingSoft *= shadow;

  return mix( shadingClassic, shadingSoft, softMix );
}

/**
 * Mix diffuseColor and shadeColor using shading factor and light color.
 * MToon: optional 2nd shadow band (darker lerp) approximating extended _Shadow2nd*.
 */
vec3 getDiffuse(
  const in MToonMaterial material,
  const in float shading,
  in vec3 lightColor,
  const in float dotNL,
  const in float shadow
) {
  #ifdef DEBUG_LITSHADERATE
    return vec3( BRDF_Lambert( shading * lightColor ) );
  #endif

  // NPR _ShadowMainStrength: push shade toward shade * albedo for richer soft shade
  vec3 shadeTerm = mix(
    material.shadeColor,
    material.shadeColor * material.diffuseColor,
    clamp( shadeMainStrength, 0.0, 1.0 )
  );
  vec3 shadeLit = mix( shadeTerm, material.diffuseColor, shading );

  float hl = clamp( dotNL * 0.5 + 0.5, 0.0, 1.0 );


  float band2 = clamp( shadow2ndStrength, 0.0, 1.0 ) * 0.72;
  float blur2 = max( 0.22, shadow2ndBlur );
  float b2min = clamp( shadow2ndBorder - 0.5 * blur2, 0.0, 1.0 );
  float b2max = clamp( shadow2ndBorder + 0.5 * blur2, 0.0, 1.0 );
  float s2 = smootherstep( b2min, b2max, hl ) * shadow;
  shadeLit = mix( shadeLit, mix( shadeLit * shadow2ndColor, shadeLit, s2 ), band2 );

  float band3 = clamp( shadow3rdStrength, 0.0, 1.0 ) * 0.55;
  float blur3 = max( 0.2, shadow3rdBlur );
  float b3min = clamp( shadow3rdBorder - 0.5 * blur3, 0.0, 1.0 );
  float b3max = clamp( shadow3rdBorder + 0.5 * blur3, 0.0, 1.0 );
  float s3 = smootherstep( b3min, b3max, hl ) * shadow;
  shadeLit = mix( shadeLit, mix( shadeLit * shadow3rdColor, shadeLit, s3 ), band3 );

  vec3 col = lightColor * BRDF_Lambert( shadeLit );
  // lil: indirectCol = min(indirectCol, directCol) \u2014 keep soft shade from blowing past lit
  vec3 directCol = lightColor * BRDF_Lambert( material.diffuseColor );
  col = mix( col, min( col, directCol ), clamp( softMix, 0.0, 1.0 ) );
  // NPR _ShadowEnvStrength: lift shade toward lit*env so indirect doesn't go dead-matte
  // Soft env lift \u2014 keep factor low to avoid stepped midtone "bands" on body
  col = mix( col, mix( col, directCol, 0.22 ), clamp( envStrength, 0.0, 1.0 ) * 0.65 * ( 1.0 - shading ) );

  // The "comment out if you want to PBR absolutely" line
  #ifdef V0_COMPAT_SHADE
    col = min( col, material.diffuseColor );
  #endif

  return col;
}

/**
 * Lightweight stretched highlight (Kajiya-Kay-ish) for hair / angel-ring sheen.
 * Dual lobe (primary + softer ring). Gated by hairSpecStrength; manager keeps face/eyes at 0.
 */
vec3 getHairSpec(
  const in vec3 normal,
  const in vec3 lightDir,
  const in vec3 viewDir,
  const in vec3 lightColor,
  const in float shading
) {
  float strength = hairSpecStrength;
  if ( strength <= 0.0001 ) {
    return vec3( 0.0 );
  }
  vec3 t = cross( normal, vec3( 0.0, 1.0, 0.0 ) );
  float tLen = length( t );
  if ( tLen < 1e-3 ) {
    t = cross( normal, vec3( 1.0, 0.0, 0.0 ) );
    tLen = length( t );
  }
  t /= max( tLen, 1e-5 );
  vec3 h = normalize( lightDir + viewDir );
  float th = dot( t, h );
  float power = max( 1.0, hairSpecPower );
  float aniso1 = pow( sqrt( max( 0.0, 1.0 - ( th + hairSpecShift ) * ( th + hairSpecShift ) ) ), power );
  // Stronger secondary lobe (angel-ring-ish) shifted the other way
  float shift2 = hairSpecShift + 0.2;
  float aniso2 = pow( sqrt( max( 0.0, 1.0 - ( th + shift2 ) * ( th + shift2 ) ) ), power * 0.5 );
  float aniso = aniso1 + 0.55 * aniso2;
  // Soften by toon shading so deep shade stays matte
  return lightColor * ( aniso * strength * mix( 0.35, 1.0, shading ) );
}

/**
 * Light GGX-ish isotropic lobe for cloth / satin / bows (extended shinier read).
 * Uses Schlick-GGX D approx with roughness from ClothSpecPower; strength 0 \u2192 noop.
 */
vec3 getClothSpec(
  const in vec3 normal,
  const in vec3 lightDir,
  const in vec3 viewDir,
  const in vec3 lightColor,
  const in float shading
) {
  float strength = clothSpecStrength;
  if ( strength <= 0.0001 ) {
    return vec3( 0.0 );
  }
  vec3 h = normalize( lightDir + viewDir );
  float nh = clamp( dot( normal, h ), 0.0, 1.0 );
  // Map power (~32..128) \u2192 roughness (~0.35..0.08); then GGX D
  float power = max( 8.0, clothSpecPower );
  float rough = clamp( 1.0 / sqrt( power ), 0.06, 0.45 );
  float a = rough * rough;
  float a2 = a * a;
  float nh2 = nh * nh;
  float denom = nh2 * ( a2 - 1.0 ) + 1.0;
  float D = a2 / max( 3.14159265 * denom * denom, 1e-5 );
  // Tiny Schlick Fresnel at grazing for satin read
  float vh = clamp( dot( viewDir, h ), 0.0, 1.0 );
  float F = 0.04 + 0.96 * pow( 1.0 - vh, 5.0 );
  float spec = D * F;
  return lightColor * ( spec * strength * mix( 0.2, 1.0, shading ) );
}

/**
 * Isotropic moist/hydrated skin specular (NPR soft SpecularToon-ish).
 * Broad, low strength, mild fresnel sheen \u2014 NOT hair anisotropy.
 */
vec3 getSkinSpec(
  const in vec3 normal,
  const in vec3 lightDir,
  const in vec3 viewDir,
  const in vec3 lightColor,
  const in float shading
) {
  float strength = skinSpecStrength;
  if ( strength <= 0.0001 ) {
    return vec3( 0.0 );
  }
  vec3 h = normalize( lightDir + viewDir );
  float nh = clamp( dot( normal, h ), 0.0, 1.0 );
  float nv = clamp( dot( normal, viewDir ), 0.0, 1.0 );
  float nl = clamp( dot( normal, lightDir ), 0.0, 1.0 );
  float power = max( 16.0, skinSpecPower );
  // Continuous smooth Blinn lobe \u2014 clamped and softly attenuated to prevent harsh circular white spot
  float lobe = pow( nh, power );
  lobe = smoothstep( 0.05, 0.95, lobe ) * 0.7;
  float F = 0.04 + 0.96 * pow( 1.0 - nv, 4.0 );
  float sheen = mix( 0.4, F, clamp( skinSpecFresnel, 0.0, 1.0 ) );
  float litGate = smoothstep( 0.1, 0.8, shading ) * clamp( nl, 0.0, 1.0 );
  return lightColor * skinSpecColor * ( lobe * sheen * strength * litGate );
}

/**
 * Grazing-angle velvet / fabric sheen approximation (lilToon cloth feel).
 * Adds rich soft edge glow to cheongsam / satin dresses without extra textures.
 */
vec3 getFabricSheen(
  const in vec3 normal,
  const in vec3 viewDir,
  const in vec3 lightColor
) {
  if ( fabricSheenStrength <= 0.0001 ) {
    return vec3( 0.0 );
  }
  float nv = clamp( 1.0 - abs( dot( normal, viewDir ) ), 0.0, 1.0 );
  float sheen = pow( nv, max( 0.5, fabricSheenPower ) );
  return lightColor * fabricSheenColor * ( sheen * fabricSheenStrength );
}

/**
 * lilCalcSpecular-like toon specular from MToon proxies (smoothness/metallic via uniforms).
 * No cubemap \u2014 still adds directional highlight energy NPR users expect.
 */
vec3 getToonSpecular(
  const in vec3 normal,
  const in vec3 lightDir,
  const in vec3 viewDir,
  const in vec3 lightColor,
  const in vec3 albedo,
  const in float shading
) {
  float strength = specularStrength;
  if ( strength <= 0.0001 ) {
    return vec3( 0.0 );
  }
  vec3 h = normalize( lightDir + viewDir );
  float nh = clamp( dot( normal, h ), 0.0, 1.0 );
  float nl = clamp( dot( normal, lightDir ), 0.0, 1.0 );
  float lh = clamp( dot( lightDir, h ), 0.0, 1.0 );
  float power = max( 4.0, specularPower );
  float lobe = pow( nh, power );
  float border = clamp( specularBorder, 0.0, 1.0 );
  float blur = max( 0.001, specularBlur );
  lobe = linearstep( border - 0.5 * blur, border + 0.5 * blur, lobe );
  // Schlick F0 from metallic proxy
  float metallic = clamp( reflectMetallic, 0.0, 1.0 );
  vec3 f0 = mix( vec3( 0.04 ), albedo, metallic );
  vec3 F = f0 + ( 1.0 - f0 ) * pow( 1.0 - lh, 5.0 );
  float gate = mix( 0.15, 1.0, shading ) * nl;
  return lightColor * F * ( lobe * strength * gate );
}

/**
 * View-dependent env reflection approximation without cubemap/PMREM.
 * Uses fresnel + smoothness to tint toward albedo/light \u2014 better than flat matte.
 */
vec3 getEnvReflectApprox(
  const in vec3 normal,
  const in vec3 viewDir,
  const in vec3 lightColor,
  const in vec3 albedo,
  const in float shading
) {
  float strength = reflectStrength;
  if ( strength <= 0.0001 ) {
    return vec3( 0.0 );
  }
  float nv = clamp( dot( normal, viewDir ), 0.0, 1.0 );
  float smoothn = clamp( reflectSmoothness, 0.0, 1.0 );
  float fresAmt = clamp( reflectFresnel, 0.0, 1.0 );
  float metallic = clamp( reflectMetallic, 0.0, 1.0 );
  float fres = pow( 1.0 - nv, mix( 3.0, 5.0, smoothn ) );
  fres = mix( fres * 0.35, fres, fresAmt );
  // Soft env stand-in: upward hemisphere only (never treat lightColor as a direction \u2014
  // that caused blotchy/rippled lighting when RGB varied).
  vec3 r = reflect( -viewDir, normal );
  float up = clamp( r.y * 0.5 + 0.5, 0.0, 1.0 );
  float envLobe = pow( up, mix( 1.2, 3.5, smoothn ) );
  vec3 envCol = mix( vec3( 0.78, 0.80, 0.86 ), albedo, metallic * 0.5 );
  envCol = mix( envCol, lightColor, 0.2 );
  float gate = mix( 0.45, 1.0, shading );
  return envCol * ( fres * envLobe * strength * gate * 0.85 );
}

/**
 * NPR backlight: wrap lighting from opposite hemisphere (no extra tex).
 */
vec3 getBacklight(
  const in vec3 normal,
  const in vec3 lightDir,
  const in vec3 viewDir,
  const in vec3 lightColor,
  const in vec3 albedo
) {
  float strength = backlightStrength;
  if ( strength <= 0.0001 ) {
    return vec3( 0.0 );
  }
  // Opposite-light half-Lambert with mild view wrap
  vec3 Lback = normalize( -lightDir + viewDir * 0.25 );
  float hl = clamp( dot( normal, Lback ) * 0.5 + 0.5, 0.0, 1.0 );
  float border = 0.55;
  float blur = 0.35;
  float factor = linearstep( border - 0.5 * blur, border + 0.5 * blur, hl );
  // Directivity: stronger when N points away from main light
  float away = clamp( -dot( normal, lightDir ) * 0.5 + 0.5, 0.0, 1.0 );
  factor *= pow( away, 1.5 );
  vec3 col = mix( backlightColor, backlightColor * albedo, 0.45 );
  return lightColor * col * ( factor * strength );
}

/**
 * Gem-ish fresnel sparkle proxy \u2014 only when explicitly enabled; safe for cloth/skin at 0.
 */
vec3 getGemFresnelProxy(
  const in vec3 normal,
  const in vec3 viewDir,
  const in vec3 lightColor,
  const in vec3 albedo
) {
  float strength = gemFresnel;
  if ( strength <= 0.0001 ) {
    return vec3( 0.0 );
  }
  float nv = clamp( dot( normal, viewDir ), 0.0, 1.0 );
  float fres = pow( 1.0 - nv, 4.0 );
  // Chromatic-ish split via albedo channels (lightweight, no extra tex)
  vec3 chroma = normalize( albedo + vec3( 0.05, 0.08, 0.12 ) );
  return lightColor * chroma * ( fres * strength );
}

// COMPAT: pre-r156 uses a struct GeometricContext
#if THREE_VRM_THREE_REVISION >= 157
  void RE_Direct_MToon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in MToonMaterial material, const in float shadow, inout ReflectedLight reflectedLight ) {
    float dotNL = clamp( dot( geometryNormal, directLight.direction ), -1.0, 1.0 );
    vec3 irradiance = directLight.color;

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;

    irradiance *= dotNL;

    // \u9762\u90E8\u9634\u5F71\u9694\u79BB\uFF1AreceiveShadowRate = 0 \u65F6\u5FFD\u7565 shadowmap \u6295\u5C04\u9634\u5F71\uFF0C\u9762\u90E8\u4FDD\u6301\u767D\u51C0
    float effectiveShadow = mix( 1.0, shadow, clamp( receiveShadowRate, 0.0, 1.0 ) );

    float shading = getShading( dotNL, effectiveShadow, material.shadingShift );

    // toon shaded diffuse (+ optional 2nd band inside getDiffuse)
    reflectedLight.directDiffuse += getDiffuse( material, shading, directLight.color, dotNL, effectiveShadow );
    reflectedLight.directDiffuse += getHairSpec( geometryNormal, directLight.direction, geometryViewDir, directLight.color, shading );
    reflectedLight.directDiffuse += getClothSpec( geometryNormal, directLight.direction, geometryViewDir, directLight.color, shading );
    reflectedLight.directDiffuse += getFabricSheen( geometryNormal, geometryViewDir, directLight.color );
    reflectedLight.directDiffuse += getSkinSpec( geometryNormal, directLight.direction, geometryViewDir, directLight.color, shading );
    reflectedLight.directDiffuse += getToonSpecular( geometryNormal, directLight.direction, geometryViewDir, directLight.color, material.diffuseColor, shading );
    reflectedLight.directDiffuse += getEnvReflectApprox( geometryNormal, geometryViewDir, directLight.color, material.diffuseColor, shading );
    reflectedLight.directDiffuse += getBacklight( geometryNormal, directLight.direction, geometryViewDir, directLight.color, material.diffuseColor );
    reflectedLight.directDiffuse += getGemFresnelProxy( geometryNormal, geometryViewDir, directLight.color, material.diffuseColor );
  }

  void RE_IndirectDiffuse_MToon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in MToonMaterial material, inout ReflectedLight reflectedLight ) {
    // VRM GI equalization: flatten irradiance toward luma average (brighter soft NPR ambient)
    float giAvg = ( irradiance.r + irradiance.g + irradiance.b ) * ( 1.0 / 3.0 );
    vec3 gi = mix( irradiance, vec3( giAvg ), clamp( giEqualizationFactor, 0.0, 1.0 ) );
    gi *= ( 1.0 + max( 0.0, ambientLift ) );
    reflectedLight.indirectDiffuse += gi * BRDF_Lambert( material.diffuseColor );

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;
  }
#else
  void RE_Direct_MToon( const in IncidentLight directLight, const in GeometricContext geometry, const in MToonMaterial material, const in float shadow, inout ReflectedLight reflectedLight ) {
    float dotNL = clamp( dot( geometry.normal, directLight.direction ), -1.0, 1.0 );
    vec3 irradiance = directLight.color;

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;

    irradiance *= dotNL;

    // \u9762\u90E8\u9634\u5F71\u9694\u79BB\uFF1AreceiveShadowRate = 0 \u65F6\u5FFD\u7565 shadowmap \u6295\u5C04\u9634\u5F71\uFF0C\u9762\u90E8\u4FDD\u6301\u767D\u51C0
    float effectiveShadow = mix( 1.0, shadow, clamp( receiveShadowRate, 0.0, 1.0 ) );

    float shading = getShading( dotNL, effectiveShadow, material.shadingShift );

    // toon shaded diffuse (+ optional 2nd band inside getDiffuse)
    reflectedLight.directDiffuse += getDiffuse( material, shading, directLight.color, dotNL, effectiveShadow );
    reflectedLight.directDiffuse += getHairSpec( geometry.normal, directLight.direction, geometry.viewDir, directLight.color, shading );
    reflectedLight.directDiffuse += getClothSpec( geometry.normal, directLight.direction, geometry.viewDir, directLight.color, shading );
    reflectedLight.directDiffuse += getFabricSheen( geometry.normal, geometry.viewDir, directLight.color );
    reflectedLight.directDiffuse += getSkinSpec( geometry.normal, directLight.direction, geometry.viewDir, directLight.color, shading );
    reflectedLight.directDiffuse += getToonSpecular( geometry.normal, directLight.direction, geometry.viewDir, directLight.color, material.diffuseColor, shading );
    reflectedLight.directDiffuse += getEnvReflectApprox( geometry.normal, geometry.viewDir, directLight.color, material.diffuseColor, shading );
    reflectedLight.directDiffuse += getBacklight( geometry.normal, directLight.direction, geometry.viewDir, directLight.color, material.diffuseColor );
    reflectedLight.directDiffuse += getGemFresnelProxy( geometry.normal, geometry.viewDir, directLight.color, material.diffuseColor );
  }

  void RE_IndirectDiffuse_MToon( const in vec3 irradiance, const in GeometricContext geometry, const in MToonMaterial material, inout ReflectedLight reflectedLight ) {
    float giAvg = ( irradiance.r + irradiance.g + irradiance.b ) * ( 1.0 / 3.0 );
    vec3 gi = mix( irradiance, vec3( giAvg ), clamp( giEqualizationFactor, 0.0, 1.0 ) );
    gi *= ( 1.0 + max( 0.0, ambientLift ) );
    reflectedLight.indirectDiffuse += gi * BRDF_Lambert( material.diffuseColor );

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;
  }
#endif

#define RE_Direct RE_Direct_MToon
#define RE_IndirectDiffuse RE_IndirectDiffuse_MToon
#define Material_LightProbeLOD( material ) (0)

#include <shadowmap_pars_fragment>
// #include <bumpmap_pars_fragment>

// #include <normalmap_pars_fragment>
#ifdef USE_NORMALMAP

  uniform sampler2D normalMap;
  uniform mat3 normalMapUvTransform;
  uniform vec2 normalScale;

#endif

// COMPAT: pre-r151
// USE_NORMALMAP_OBJECTSPACE used to be OBJECTSPACE_NORMALMAP in pre-r151
#if defined( USE_NORMALMAP_OBJECTSPACE ) || defined( OBJECTSPACE_NORMALMAP )

  uniform mat3 normalMatrix;

#endif

// COMPAT: pre-r151
// USE_NORMALMAP_TANGENTSPACE used to be TANGENTSPACE_NORMALMAP in pre-r151
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( TANGENTSPACE_NORMALMAP ) )

  // Per-Pixel Tangent Space Normal Mapping
  // http://hacksoflife.blogspot.ch/2009/11/per-pixel-tangent-space-normal-mapping.html

  // three-vrm specific change: it requires \`uv\` as an input in order to support uv scrolls

  // Temporary compat against shader change @ Three.js r126, r151
  #if THREE_VRM_THREE_REVISION >= 151

    mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {

      vec3 q0 = dFdx( eye_pos.xyz );
      vec3 q1 = dFdy( eye_pos.xyz );
      vec2 st0 = dFdx( uv.st );
      vec2 st1 = dFdy( uv.st );

      vec3 N = surf_norm;

      vec3 q1perp = cross( q1, N );
      vec3 q0perp = cross( N, q0 );

      vec3 T = q1perp * st0.x + q0perp * st1.x;
      vec3 B = q1perp * st0.y + q0perp * st1.y;

      float det = max( dot( T, T ), dot( B, B ) );
      float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );

      return mat3( T * scale, B * scale, N );

    }

  #else

    vec3 perturbNormal2Arb( vec2 uv, vec3 eye_pos, vec3 surf_norm, vec3 mapN, float faceDirection ) {

      vec3 q0 = vec3( dFdx( eye_pos.x ), dFdx( eye_pos.y ), dFdx( eye_pos.z ) );
      vec3 q1 = vec3( dFdy( eye_pos.x ), dFdy( eye_pos.y ), dFdy( eye_pos.z ) );
      vec2 st0 = dFdx( uv.st );
      vec2 st1 = dFdy( uv.st );

      vec3 N = normalize( surf_norm );

      vec3 q1perp = cross( q1, N );
      vec3 q0perp = cross( N, q0 );

      vec3 T = q1perp * st0.x + q0perp * st1.x;
      vec3 B = q1perp * st0.y + q0perp * st1.y;

      // three-vrm specific change: Workaround for the issue that happens when delta of uv = 0.0
      // TODO: Is this still required? Or shall I make a PR about it?
      if ( length( T ) == 0.0 || length( B ) == 0.0 ) {
        return surf_norm;
      }

      float det = max( dot( T, T ), dot( B, B ) );
      float scale = ( det == 0.0 ) ? 0.0 : faceDirection * inversesqrt( det );

      return normalize( T * ( mapN.x * scale ) + B * ( mapN.y * scale ) + N * mapN.z );

    }

  #endif

#endif

// #include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

// == post correction ==========================================================
void postCorrection() {
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <premultiplied_alpha_fragment>
  #include <dithering_fragment>
}

// == main procedure ===========================================================
void main() {
  #include <clipping_planes_fragment>

  vec2 uv = vec2(0.5, 0.5);

  #if ( defined( MTOON_USE_UV ) && !defined( MTOON_UVS_VERTEX_ONLY ) )
    uv = vUv;

    float uvAnimMask = 1.0;
    #ifdef USE_UVANIMATIONMASKTEXTURE
      vec2 uvAnimationMaskTextureUv = ( uvAnimationMaskTextureUvTransform * vec3( uv, 1 ) ).xy;
      uvAnimMask = texture2D( uvAnimationMaskTexture, uvAnimationMaskTextureUv ).b;
    #endif

    float uvRotCos = cos( uvAnimationRotationPhase * uvAnimMask );
    float uvRotSin = sin( uvAnimationRotationPhase * uvAnimMask );
    uv = mat2( uvRotCos, -uvRotSin, uvRotSin, uvRotCos ) * ( uv - 0.5 ) + 0.5;
    uv = uv + vec2( uvAnimationScrollXOffset, uvAnimationScrollYOffset ) * uvAnimMask;
  #endif

  #ifdef DEBUG_UV
    gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
    #if ( defined( MTOON_USE_UV ) && !defined( MTOON_UVS_VERTEX_ONLY ) )
      gl_FragColor = vec4( uv, 0.0, 1.0 );
    #endif
    return;
  #endif

  vec4 diffuseColor = vec4( litFactor, opacity );
  ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  vec3 totalEmissiveRadiance = emissive * emissiveIntensity;

  #include <logdepthbuf_fragment>

  // #include <map_fragment>
  #ifdef USE_MAP
    vec2 mapUv = ( mapUvTransform * vec3( uv, 1 ) ).xy;
    vec4 sampledDiffuseColor = texture2D( map, mapUv );
    #ifdef DECODE_VIDEO_TEXTURE
      sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
    #endif
    diffuseColor *= sampledDiffuseColor;
  #endif

  // #include <color_fragment>
  #if ( defined( USE_COLOR ) && !defined( IGNORE_VERTEX_COLOR ) )
    diffuseColor.rgb *= vColor;
  #endif

  // #include <alphamap_fragment>

  #include <alphatest_fragment>

  // #include <specularmap_fragment>

  // #include <normal_fragment_begin>
  float faceDirection = gl_FrontFacing ? 1.0 : -1.0;

  #ifdef FLAT_SHADED

    vec3 fdx = dFdx( vViewPosition );
    vec3 fdy = dFdy( vViewPosition );
    vec3 normal = normalize( cross( fdx, fdy ) );

  #else

    vec3 normal = normalize( vNormal );

    #ifdef DOUBLE_SIDED

      normal *= faceDirection;

    #endif

  #endif

  #ifdef USE_NORMALMAP

    vec2 normalMapUv = ( normalMapUvTransform * vec3( uv, 1 ) ).xy;

  #endif

  #ifdef USE_NORMALMAP_TANGENTSPACE

    #ifdef USE_TANGENT

      mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );

    #else

      mat3 tbn = getTangentFrame( - vViewPosition, normal, normalMapUv );

    #endif

    #if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )

      tbn[0] *= faceDirection;
      tbn[1] *= faceDirection;

    #endif

  #endif

  #ifdef USE_CLEARCOAT_NORMALMAP

    #ifdef USE_TANGENT

      mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );

    #else

      mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );

    #endif

    #if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )

      tbn2[0] *= faceDirection;
      tbn2[1] *= faceDirection;

    #endif

  #endif

  // non perturbed normal for clearcoat among others

  vec3 nonPerturbedNormal = normal;

  #ifdef OUTLINE
    normal *= -1.0;
  #endif

  // #include <normal_fragment_maps>

  // COMPAT: pre-r151
  // USE_NORMALMAP_OBJECTSPACE used to be OBJECTSPACE_NORMALMAP in pre-r151
  #if defined( USE_NORMALMAP_OBJECTSPACE ) || defined( OBJECTSPACE_NORMALMAP )

    normal = texture2D( normalMap, normalMapUv ).xyz * 2.0 - 1.0; // overrides both flatShading and attribute normals

    #ifdef FLIP_SIDED

      normal = - normal;

    #endif

    #ifdef DOUBLE_SIDED

      normal = normal * faceDirection;

    #endif

    normal = normalize( normalMatrix * normal );

  // COMPAT: pre-r151
  // USE_NORMALMAP_TANGENTSPACE used to be TANGENTSPACE_NORMALMAP in pre-r151
  #elif defined( USE_NORMALMAP_TANGENTSPACE ) || defined( TANGENTSPACE_NORMALMAP )

    vec3 mapN = texture2D( normalMap, normalMapUv ).xyz * 2.0 - 1.0;
    mapN.xy *= normalScale;
    // Skin depth: amplify tangent normal XY when face/body preset sets boost (NPR normal feel)
    mapN.xy *= ( 1.0 + clamp( normalSkinBoost, 0.0, 1.0 ) * 0.55 );

    // COMPAT: pre-r151
    #if THREE_VRM_THREE_REVISION >= 151 || defined( USE_TANGENT )

      normal = normalize( tbn * mapN );

    #else

      normal = perturbNormal2Arb( uv, -vViewPosition, normal, mapN, faceDirection );

    #endif

  #endif

  // #include <emissivemap_fragment>
  #ifdef USE_EMISSIVEMAP
    vec2 emissiveMapUv = ( emissiveMapUvTransform * vec3( uv, 1 ) ).xy;
    totalEmissiveRadiance *= texture2D( emissiveMap, emissiveMapUv ).rgb;
  #endif

  #ifdef DEBUG_NORMAL
    gl_FragColor = vec4( 0.5 + 0.5 * normal, 1.0 );
    return;
  #endif

  // -- MToon: lighting --------------------------------------------------------
  // accumulation
  // #include <lights_phong_fragment>
  MToonMaterial material;

  material.diffuseColor = diffuseColor.rgb;

  material.shadeColor = shadeColorFactor;
  #ifdef USE_SHADEMULTIPLYTEXTURE
    vec2 shadeMultiplyTextureUv = ( shadeMultiplyTextureUvTransform * vec3( uv, 1 ) ).xy;
    material.shadeColor *= texture2D( shadeMultiplyTexture, shadeMultiplyTextureUv ).rgb;
  #endif

  #if ( defined( USE_COLOR ) && !defined( IGNORE_VERTEX_COLOR ) )
    material.shadeColor.rgb *= vColor;
  #endif

  material.shadingShift = shadingShiftFactor;
  #ifdef USE_SHADINGSHIFTTEXTURE
    vec2 shadingShiftTextureUv = ( shadingShiftTextureUvTransform * vec3( uv, 1 ) ).xy;
    material.shadingShift += texture2D( shadingShiftTexture, shadingShiftTextureUv ).r * shadingShiftTextureScale;
  #endif

  // #include <lights_fragment_begin>

  // MToon Specific changes:
  // Since we want to take shadows into account of shading instead of irradiance,
  // we had to modify the codes that multiplies the results of shadowmap into color of direct lights.

  // COMPAT: pre-r156 uses a struct GeometricContext
  #if THREE_VRM_THREE_REVISION >= 157
    vec3 geometryPosition = - vViewPosition;
    vec3 geometryNormal = normal;
    vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );

    vec3 geometryClearcoatNormal;

    #ifdef USE_CLEARCOAT

      geometryClearcoatNormal = clearcoatNormal;

    #endif
  #else
    GeometricContext geometry;

    geometry.position = - vViewPosition;
    geometry.normal = normal;
    geometry.viewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );

    #ifdef USE_CLEARCOAT

      geometry.clearcoatNormal = clearcoatNormal;

    #endif
  #endif

  IncidentLight directLight;

  // since these variables will be used in unrolled loop, we have to define in prior
  float shadow;

  #if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )

    PointLight pointLight;
    #if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
    PointLightShadow pointLightShadow;
    #endif

    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {

      pointLight = pointLights[ i ];

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        getPointLightInfo( pointLight, geometryPosition, directLight );
      #else
        getPointLightInfo( pointLight, geometry, directLight );
      #endif

      shadow = 1.0;
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
      pointLightShadow = pointLightShadows[ i ];
      // COMPAT: pre-r166
      // r166 introduced shadowIntensity
      #if THREE_VRM_THREE_REVISION >= 166
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
      #else
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
      #endif
      #endif

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, shadow, reflectedLight );
      #else
        RE_Direct( directLight, geometry, material, shadow, reflectedLight );
      #endif

    }
    #pragma unroll_loop_end

  #endif

  #if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )

    SpotLight spotLight;
    // COMPAT: pre-r144 uses NUM_SPOT_LIGHT_SHADOWS, r144+ uses NUM_SPOT_LIGHT_COORDS
    #if THREE_VRM_THREE_REVISION >= 144
      #if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_COORDS > 0
      SpotLightShadow spotLightShadow;
      #endif
    #elif defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
    SpotLightShadow spotLightShadow;
    #endif

    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {

      spotLight = spotLights[ i ];

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        getSpotLightInfo( spotLight, geometryPosition, directLight );
      #else
        getSpotLightInfo( spotLight, geometry, directLight );
      #endif

      shadow = 1.0;
      // COMPAT: pre-r144 uses NUM_SPOT_LIGHT_SHADOWS and vSpotShadowCoord, r144+ uses NUM_SPOT_LIGHT_COORDS and vSpotLightCoord
      // COMPAT: pre-r166 does not have shadowIntensity, r166+ has shadowIntensity
      #if THREE_VRM_THREE_REVISION >= 166
        #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_COORDS )
        spotLightShadow = spotLightShadows[ i ];
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
        #endif
      #elif THREE_VRM_THREE_REVISION >= 144
        #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_COORDS )
        spotLightShadow = spotLightShadows[ i ];
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
        #endif
      #elif defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
      spotLightShadow = spotLightShadows[ i ];
      shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotShadowCoord[ i ] ) : 1.0;
      #endif

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, shadow, reflectedLight );
      #else
        RE_Direct( directLight, geometry, material, shadow, reflectedLight );
      #endif

    }
    #pragma unroll_loop_end

  #endif

  #if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )

    DirectionalLight directionalLight;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow directionalLightShadow;
    #endif

    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

      directionalLight = directionalLights[ i ];

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        getDirectionalLightInfo( directionalLight, directLight );
      #else
        getDirectionalLightInfo( directionalLight, geometry, directLight );
      #endif

      shadow = 1.0;
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
      directionalLightShadow = directionalLightShadows[ i ];
      // COMPAT: pre-r166
      // r166 introduced shadowIntensity
      #if THREE_VRM_THREE_REVISION >= 166
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
      #else
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
      #endif
      #endif

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, shadow, reflectedLight );
      #else
        RE_Direct( directLight, geometry, material, shadow, reflectedLight );
      #endif

    }
    #pragma unroll_loop_end

  #endif

  // #if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )

  //   RectAreaLight rectAreaLight;

  //   #pragma unroll_loop_start
  //   for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {

  //     rectAreaLight = rectAreaLights[ i ];
  //     RE_Direct_RectArea( rectAreaLight, geometry, material, reflectedLight );

  //   }
  //   #pragma unroll_loop_end

  // #endif

  #if defined( RE_IndirectDiffuse )

    vec3 iblIrradiance = vec3( 0.0 );

    vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );

    // COMPAT: pre-r156 uses a struct GeometricContext
    // COMPAT: pre-r156 doesn't have a define USE_LIGHT_PROBES
    #if THREE_VRM_THREE_REVISION >= 157
      #if defined( USE_LIGHT_PROBES )
        irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
      #endif
    #else
      irradiance += getLightProbeIrradiance( lightProbe, geometry.normal );
    #endif

    #if ( NUM_HEMI_LIGHTS > 0 )

      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {

        // COMPAT: pre-r156 uses a struct GeometricContext
        #if THREE_VRM_THREE_REVISION >= 157
          irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
        #else
          irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometry.normal );
        #endif

      }
      #pragma unroll_loop_end

    #endif

  #endif

  // #if defined( RE_IndirectSpecular )

  //   vec3 radiance = vec3( 0.0 );
  //   vec3 clearcoatRadiance = vec3( 0.0 );

  // #endif

  #include <lights_fragment_maps>
  #include <lights_fragment_end>

  // modulation
  #include <aomap_fragment>

  vec3 col = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;

  #ifdef DEBUG_LITSHADERATE
    gl_FragColor = vec4( col, diffuseColor.a );
    postCorrection();
    return;
  #endif

  // -- MToon: rim lighting (MToon: soft-like border/blur + optional dir rim) --
  vec3 viewDir = normalize( vViewPosition );

  #ifndef PHYSICALLY_CORRECT_LIGHTS
    reflectedLight.directSpecular /= PI;
  #endif
  vec3 rimMix = mix( vec3( 1.0 ), reflectedLight.directSpecular, rimLightingMixFactor );

  // Classic parametric Fresnel base (MToon) + NPR rim border/blur / dir / mainStrength / shadowMask
  float nv = saturate( 1.0 - dot( viewDir, normal ) + parametricRimLiftFactor );
  float rimPower = ( rimFresnelPower > 0.001 )
    ? rimFresnelPower
    : parametricRimFresnelPowerFactor;
  float rimFresnel = pow( nv, max( 0.001, rimPower ) );
  float rimToon = rimFresnel;
  if ( rimBorder > 0.001 ) {
    float rBlur = max( 0.001, rimBlur );
    float rimBMin = clamp( rimBorder - 0.5 * rBlur, 0.0, 1.0 );
    float rimBMax = clamp( rimBorder + 0.5 * rBlur, 0.0, 1.0 );
    rimToon = linearstep( rimBMin, rimBMax, rimFresnel );
  }
  // Directional rim \u2248 lil: bias with half-Lambert from light energy proxy
  float rimLn = saturate( length( reflectedLight.directSpecular ) );
  float rimDir = mix( 1.0, rimLn, clamp( rimDirStrength, 0.0, 1.0 ) );
  // Opposite-side / indirect rim (NPR RimIndir) \u2014 uses inverse light energy proxy
  float rimIndir = rimToon * saturate( 1.0 - rimLn ) * clamp( rimIndirStrength, 0.0, 1.0 );
  // Approximate shadowmix from diffuse energy vs lit (mute rim in deep shade)
  float shadeMix = saturate( length( reflectedLight.directDiffuse ) / max( length( reflectedLight.directSpecular ) * 0.3183 + 1e-3, 1e-3 ) );
  float rimShadow = mix( 1.0, shadeMix, clamp( rimShadowMask, 0.0, 1.0 ) );
  vec3 rimColor = mix( parametricRimColorFactor, parametricRimColorFactor * diffuseColor.rgb, clamp( rimMainStrength, 0.0, 1.0 ) );
  vec3 rim = rimColor * ( rimToon * rimDir + rimIndir ) * rimShadow;
  rim *= rimBoost;

  #ifdef USE_MATCAPTEXTURE
    {
      vec3 x = normalize( vec3( viewDir.z, 0.0, -viewDir.x ) );
      vec3 y = cross( viewDir, x ); // guaranteed to be normalized
      vec2 sphereUv = 0.5 + 0.5 * vec2( dot( x, normal ), -dot( y, normal ) );
      sphereUv = ( matcapTextureUvTransform * vec3( sphereUv, 1 ) ).xy;
      vec3 matcap = texture2D( matcapTexture, sphereUv ).rgb;
      rim += matcapFactor * matcap;
      // Cheap 2nd MatCap (single-tex). High-freq resample + contrast caused skin "ripple texture"
      // on curved midtones \u2014 keep only low-frequency luma sheen.
      if ( matcap2ndStrength > 0.0001 ) {
        float mcScale = max( 0.5, matcap2ndScale );
        vec2 sphereUv2 = 0.5 + 0.5 * vec2( -dot( x, normal ), -dot( y, normal ) * 0.82 + 0.04 );
        sphereUv2 = ( sphereUv2 - 0.5 ) * mcScale + 0.5;
        sphereUv2 = ( matcapTextureUvTransform * vec3( sphereUv2, 1 ) ).xy;
        // Bias toward coarser mip to kill fine matcap grain / moir\xE9 on skin
        vec3 matcap2 = texture2D( matcapTexture, sphereUv2, 2.0 ).rgb;
        float mcLuma = dot( matcap2, vec3( 0.299, 0.587, 0.114 ) );
        matcap2 = vec3( mcLuma ); // luma-only lobe \u2014 no double-print chroma texture
        float mcContrast = clamp( matcap2ndContrast, 0.5, 1.25 );
        matcap2 = clamp( ( matcap2 - 0.5 ) * mcContrast + 0.5, 0.0, 1.0 );
        rim += matcapFactor * matcap2 * matcap2ndStrength;
      }
    }
  #endif

  #ifdef USE_RIMMULTIPLYTEXTURE
    vec2 rimMultiplyTextureUv = ( rimMultiplyTextureUvTransform * vec3( uv, 1 ) ).xy;
    rim *= texture2D( rimMultiplyTexture, rimMultiplyTextureUv ).rgb;
  #endif

  col += rimMix * rim;

  // -- MToon: Emission (+ soft-ish boost) --------------------------------------
  col += totalEmissiveRadiance * ( 1.0 + max( 0.0, emissionBoost ) );

  // Distance fade/lift approx (no NPR DistanceFade tex): soft near-camera lift
  if ( distanceFade > 0.0001 ) {
    float dist = length( vViewPosition );
    float fade = smoothstep( 0.35, 2.8, dist );
    // Near: slight brightness; Far: gentle mute \u2014 readable without authored fade maps
    col *= mix( 1.0 + 0.06 * distanceFade, 1.0 - 0.08 * distanceFade, fade );
  }

  // #include <envmap_fragment>

  // -- Almost done! -----------------------------------------------------------
  #if defined( OUTLINE )
    // outlineMix: 0 = stock outlineLightingMixFactor; 1 = prefer lit albedo bleed
    float outlineMix = mix( outlineLightingMixFactor, clamp( outlineLightingMixFactor + 0.15, 0.0, 1.0 ), clamp( outlineMix, 0.0, 1.0 ) );
    col = outlineColorFactor.rgb * mix( vec3( 1.0 ), col, outlineMix );
  #endif

  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif

  gl_FragColor = vec4( col, diffuseColor.a );
  postCorrection();
}
`;

// src/MToonMaterialDebugMode.ts
var MToonMaterialDebugMode = {
  /**
   * Render normally.
   */
  None: "none",
  /**
   * Visualize normals of the surface.
   */
  Normal: "normal",
  /**
   * Visualize lit/shade of the surface.
   */
  LitShadeRate: "litShadeRate",
  /**
   * Visualize UV of the surface.
   */
  UV: "uv"
};

// src/MToonMaterialOutlineWidthMode.ts
var MToonMaterialOutlineWidthMode = {
  None: "none",
  WorldCoordinates: "worldCoordinates",
  ScreenCoordinates: "screenCoordinates"
};

// src/utils/getTextureColorSpace.ts
import * as THREE3 from "three";
var encodingColorSpaceMap = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  3e3: "",
  // eslint-disable-next-line @typescript-eslint/naming-convention
  3001: "srgb"
};
function getTextureColorSpace(texture) {
  if (parseInt(THREE3.REVISION, 10) >= 152) {
    return texture.colorSpace;
  } else {
    return encodingColorSpaceMap[texture.encoding];
  }
}

// src/MToonMaterial.ts
var MToonMaterial = class extends THREE4.ShaderMaterial {
  constructor(parameters = {}) {
    var _a;
    super({ vertexShader: mtoon_default, fragmentShader: mtoon_default2 });
    this.uvAnimationScrollXSpeedFactor = 0;
    this.uvAnimationScrollYSpeedFactor = 0;
    this.uvAnimationRotationSpeedFactor = 0;
    /**
     * Whether the material is affected by fog.
     * `true` by default.
     */
    this.fog = true;
    /**
     * Will be read in WebGLPrograms
     *
     * See: https://github.com/mrdoob/three.js/blob/4f5236ac3d6f41d904aa58401b40554e8fbdcb15/src/renderers/webgl/WebGLPrograms.js#L190-L191
     */
    this.normalMapType = THREE4.TangentSpaceNormalMap;
    /**
     * When this is `true`, vertex colors will be ignored.
     * `true` by default.
     */
    this._ignoreVertexColor = true;
    this._v0CompatShade = false;
    this._debugMode = MToonMaterialDebugMode.None;
    this._outlineWidthMode = MToonMaterialOutlineWidthMode.None;
    this._isOutline = false;
    if (parameters.transparentWithZWrite) {
      parameters.depthWrite = true;
    }
    delete parameters.transparentWithZWrite;
    parameters.fog = true;
    parameters.lights = true;
    parameters.clipping = true;
    this.uniforms = THREE4.UniformsUtils.merge([
      THREE4.UniformsLib.common,
      // map
      THREE4.UniformsLib.normalmap,
      // normalMap
      THREE4.UniformsLib.emissivemap,
      // emissiveMap
      THREE4.UniformsLib.fog,
      THREE4.UniformsLib.lights,
      {
        litFactor: { value: new THREE4.Color(1, 1, 1) },
        mapUvTransform: { value: new THREE4.Matrix3() },
        colorAlpha: { value: 1 },
        normalMapUvTransform: { value: new THREE4.Matrix3() },
        shadeColorFactor: { value: new THREE4.Color(0, 0, 0) },
        shadeMultiplyTexture: { value: null },
        shadeMultiplyTextureUvTransform: { value: new THREE4.Matrix3() },
        shadingShiftFactor: { value: 0 },
        shadingShiftTexture: { value: null },
        shadingShiftTextureUvTransform: { value: new THREE4.Matrix3() },
        shadingShiftTextureScale: { value: 1 },
        shadingToonyFactor: { value: 0.9 },
        giEqualizationFactor: { value: 0.9 },
        matcapFactor: { value: new THREE4.Color(1, 1, 1) },
        matcapTexture: { value: null },
        matcapTextureUvTransform: { value: new THREE4.Matrix3() },
        parametricRimColorFactor: { value: new THREE4.Color(0, 0, 0) },
        rimMultiplyTexture: { value: null },
        rimMultiplyTextureUvTransform: { value: new THREE4.Matrix3() },
        rimLightingMixFactor: { value: 1 },
        parametricRimFresnelPowerFactor: { value: 5 },
        parametricRimLiftFactor: { value: 0 },
        emissive: { value: new THREE4.Color(0, 0, 0) },
        emissiveIntensity: { value: 1 },
        emissiveMapUvTransform: { value: new THREE4.Matrix3() },
        outlineWidthMultiplyTexture: { value: null },
        outlineWidthMultiplyTextureUvTransform: { value: new THREE4.Matrix3() },
        outlineWidthFactor: { value: 0 },
        outlineColorFactor: { value: new THREE4.Color(0, 0, 0) },
        outlineLightingMixFactor: { value: 1 },
        uvAnimationMaskTexture: { value: null },
        uvAnimationMaskTextureUvTransform: { value: new THREE4.Matrix3() },
        uvAnimationScrollXOffset: { value: 0 },
        uvAnimationScrollYOffset: { value: 0 },
        uvAnimationRotationPhase: { value: 0 },
        // Extended MToon tuning parameters (default off = classic MToon behavior)
        softMix: { value: 0 },
        blurBoost: { value: 0 },
        shadow2ndStrength: { value: 0 },
        shadow2ndBorder: { value: 0.32 },
        shadow2ndBlur: { value: 0.22 },
        shadow2ndColor: { value: new THREE4.Color(0.68, 0.62, 0.78) },
        shadow3rdStrength: { value: 0 },
        shadow3rdBorder: { value: 0.14 },
        shadow3rdBlur: { value: 0.2 },
        shadow3rdColor: { value: new THREE4.Color(0.52, 0.48, 0.6) },
        rimBoost: { value: 1 },
        rimBorder: { value: 0 },
        rimBlur: { value: 0 },
        rimDirStrength: { value: 0 },
        hairSpecStrength: { value: 0 },
        hairSpecPower: { value: 56 },
        hairSpecShift: { value: -0.1 },
        clothSpecStrength: { value: 0 },
        clothSpecPower: { value: 72 },
        matcap2ndStrength: { value: 0 },
        skinSpecStrength: { value: 0 },
        skinSpecPower: { value: 28 },
        skinSpecFresnel: { value: 0.45 },
        skinSpecColor: { value: new THREE4.Color(1, 0.96, 0.94) },
        ambientLift: { value: 0 },
        shadeMainStrength: { value: 0 },
        shadowBorder: { value: -1 },
        shadowBlur: { value: 0 },
        rimMainStrength: { value: 0 },
        rimShadowMask: { value: 0 },
        specularStrength: { value: 0 },
        specularPower: { value: 48 },
        specularBorder: { value: 0.5 },
        specularBlur: { value: 0.1 },
        reflectStrength: { value: 0 },
        reflectFresnel: { value: 0.55 },
        reflectMetallic: { value: 0 },
        reflectSmoothness: { value: 0.55 },
        backlightStrength: { value: 0 },
        backlightColor: { value: new THREE4.Color(1, 0.85, 0.75) },
        rimFresnelPower: { value: 0 },
        rimIndirStrength: { value: 0 },
        matcap2ndContrast: { value: 1.25 },
        matcap2ndScale: { value: 1 },
        emissionBoost: { value: 0 },
        distanceFade: { value: 0 },
        faceSoft: { value: 0 },
        normalSkinBoost: { value: 0 },
        envStrength: { value: 0 },
        gemFresnel: { value: 0 },
        outlineMix: { value: 0 },
        receiveShadowRate: { value: 1 },
        fabricSheenStrength: { value: 0 },
        fabricSheenPower: { value: 3.5 },
        fabricSheenColor: { value: new THREE4.Color(16771295) }
      },
      (_a = parameters.uniforms) != null ? _a : {}
    ]);
    this.setValues(parameters);
    this._uploadUniformsWorkaround();
    this.customProgramCacheKey = () => [
      ...Object.entries(this._generateDefines()).map(([token, macro]) => `${token}:${macro}`),
      this.matcapTexture ? `matcapTextureColorSpace:${getTextureColorSpace(this.matcapTexture)}` : "",
      this.shadeMultiplyTexture ? `shadeMultiplyTextureColorSpace:${getTextureColorSpace(this.shadeMultiplyTexture)}` : "",
      this.rimMultiplyTexture ? `rimMultiplyTextureColorSpace:${getTextureColorSpace(this.rimMultiplyTexture)}` : ""
    ].join(",");
    this.onBeforeCompile = (shader) => {
      const threeRevision = parseInt(THREE4.REVISION, 10);
      const defines = Object.entries(__spreadValues(__spreadValues({}, this._generateDefines()), this.defines)).filter(([token, macro]) => !!macro).map(([token, macro]) => `#define ${token} ${macro}`).join("\n") + "\n";
      shader.vertexShader = defines + shader.vertexShader;
      shader.fragmentShader = defines + shader.fragmentShader;
      if (threeRevision < 154) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <colorspace_fragment>",
          "#include <encodings_fragment>"
        );
      }
    };
  }
  get color() {
    return this.uniforms.litFactor.value;
  }
  set color(value) {
    this.uniforms.litFactor.value = value;
  }
  get map() {
    return this.uniforms.map.value;
  }
  set map(value) {
    this.uniforms.map.value = value;
  }
  get normalMap() {
    return this.uniforms.normalMap.value;
  }
  set normalMap(value) {
    this.uniforms.normalMap.value = value;
  }
  get normalScale() {
    return this.uniforms.normalScale.value;
  }
  set normalScale(value) {
    this.uniforms.normalScale.value = value;
  }
  get emissive() {
    return this.uniforms.emissive.value;
  }
  set emissive(value) {
    this.uniforms.emissive.value = value;
  }
  get emissiveIntensity() {
    return this.uniforms.emissiveIntensity.value;
  }
  set emissiveIntensity(value) {
    this.uniforms.emissiveIntensity.value = value;
  }
  get emissiveMap() {
    return this.uniforms.emissiveMap.value;
  }
  set emissiveMap(value) {
    this.uniforms.emissiveMap.value = value;
  }
  get shadeColorFactor() {
    return this.uniforms.shadeColorFactor.value;
  }
  set shadeColorFactor(value) {
    this.uniforms.shadeColorFactor.value = value;
  }
  get shadeMultiplyTexture() {
    return this.uniforms.shadeMultiplyTexture.value;
  }
  set shadeMultiplyTexture(value) {
    this.uniforms.shadeMultiplyTexture.value = value;
  }
  get shadingShiftFactor() {
    return this.uniforms.shadingShiftFactor.value;
  }
  set shadingShiftFactor(value) {
    this.uniforms.shadingShiftFactor.value = value;
  }
  get shadingShiftTexture() {
    return this.uniforms.shadingShiftTexture.value;
  }
  set shadingShiftTexture(value) {
    this.uniforms.shadingShiftTexture.value = value;
  }
  get shadingShiftTextureScale() {
    return this.uniforms.shadingShiftTextureScale.value;
  }
  set shadingShiftTextureScale(value) {
    this.uniforms.shadingShiftTextureScale.value = value;
  }
  get shadingToonyFactor() {
    return this.uniforms.shadingToonyFactor.value;
  }
  set shadingToonyFactor(value) {
    this.uniforms.shadingToonyFactor.value = value;
  }
  get giEqualizationFactor() {
    return this.uniforms.giEqualizationFactor.value;
  }
  set giEqualizationFactor(value) {
    this.uniforms.giEqualizationFactor.value = value;
  }
  get matcapFactor() {
    return this.uniforms.matcapFactor.value;
  }
  set matcapFactor(value) {
    this.uniforms.matcapFactor.value = value;
  }
  get matcapTexture() {
    return this.uniforms.matcapTexture.value;
  }
  set matcapTexture(value) {
    this.uniforms.matcapTexture.value = value;
  }
  get parametricRimColorFactor() {
    return this.uniforms.parametricRimColorFactor.value;
  }
  set parametricRimColorFactor(value) {
    this.uniforms.parametricRimColorFactor.value = value;
  }
  get rimMultiplyTexture() {
    return this.uniforms.rimMultiplyTexture.value;
  }
  set rimMultiplyTexture(value) {
    this.uniforms.rimMultiplyTexture.value = value;
  }
  get rimLightingMixFactor() {
    return this.uniforms.rimLightingMixFactor.value;
  }
  set rimLightingMixFactor(value) {
    this.uniforms.rimLightingMixFactor.value = value;
  }
  get parametricRimFresnelPowerFactor() {
    return this.uniforms.parametricRimFresnelPowerFactor.value;
  }
  set parametricRimFresnelPowerFactor(value) {
    this.uniforms.parametricRimFresnelPowerFactor.value = value;
  }
  get parametricRimLiftFactor() {
    return this.uniforms.parametricRimLiftFactor.value;
  }
  set parametricRimLiftFactor(value) {
    this.uniforms.parametricRimLiftFactor.value = value;
  }
  /** 0..1 blend toward half-Lambert soft toon (lilToon-like). Default 0.95 */
  get softMix() {
    return this.uniforms.softMix.value;
  }
  set softMix(value) {
    this.uniforms.softMix.value = value;
  }
  /** Extra blur width added to (1 - shadingToony) on the soft path. Default 0.32 */
  get blurBoost() {
    return this.uniforms.blurBoost.value;
  }
  set blurBoost(value) {
    this.uniforms.blurBoost.value = value;
  }
  get shadow2ndStrength() {
    return this.uniforms.shadow2ndStrength.value;
  }
  set shadow2ndStrength(value) {
    this.uniforms.shadow2ndStrength.value = value;
  }
  get shadow2ndBorder() {
    return this.uniforms.shadow2ndBorder.value;
  }
  set shadow2ndBorder(value) {
    this.uniforms.shadow2ndBorder.value = value;
  }
  get shadow2ndBlur() {
    return this.uniforms.shadow2ndBlur.value;
  }
  set shadow2ndBlur(value) {
    this.uniforms.shadow2ndBlur.value = value;
  }
  get shadow2ndColor() {
    return this.uniforms.shadow2ndColor.value;
  }
  set shadow2ndColor(value) {
    this.uniforms.shadow2ndColor.value = value;
  }
  get shadow3rdStrength() {
    return this.uniforms.shadow3rdStrength.value;
  }
  set shadow3rdStrength(value) {
    this.uniforms.shadow3rdStrength.value = value;
  }
  get shadow3rdBorder() {
    return this.uniforms.shadow3rdBorder.value;
  }
  set shadow3rdBorder(value) {
    this.uniforms.shadow3rdBorder.value = value;
  }
  get shadow3rdBlur() {
    return this.uniforms.shadow3rdBlur.value;
  }
  set shadow3rdBlur(value) {
    this.uniforms.shadow3rdBlur.value = value;
  }
  get shadow3rdColor() {
    return this.uniforms.shadow3rdColor.value;
  }
  set shadow3rdColor(value) {
    this.uniforms.shadow3rdColor.value = value;
  }
  /** Multiplier on tooned rim. Default 1.4; eyes careful via VRMMaterialManager */
  get rimBoost() {
    return this.uniforms.rimBoost.value;
  }
  set rimBoost(value) {
    this.uniforms.rimBoost.value = value;
  }
  get rimBorder() {
    return this.uniforms.rimBorder.value;
  }
  set rimBorder(value) {
    this.uniforms.rimBorder.value = value;
  }
  get rimBlur() {
    return this.uniforms.rimBlur.value;
  }
  set rimBlur(value) {
    this.uniforms.rimBlur.value = value;
  }
  get rimDirStrength() {
    return this.uniforms.rimDirStrength.value;
  }
  set rimDirStrength(value) {
    this.uniforms.rimDirStrength.value = value;
  }
  get hairSpecStrength() {
    return this.uniforms.hairSpecStrength.value;
  }
  set hairSpecStrength(value) {
    this.uniforms.hairSpecStrength.value = value;
  }
  get hairSpecPower() {
    return this.uniforms.hairSpecPower.value;
  }
  set hairSpecPower(value) {
    this.uniforms.hairSpecPower.value = value;
  }
  get hairSpecShift() {
    return this.uniforms.hairSpecShift.value;
  }
  set hairSpecShift(value) {
    this.uniforms.hairSpecShift.value = value;
  }
  get clothSpecStrength() {
    return this.uniforms.clothSpecStrength.value;
  }
  set clothSpecStrength(value) {
    this.uniforms.clothSpecStrength.value = value;
  }
  get clothSpecPower() {
    return this.uniforms.clothSpecPower.value;
  }
  set clothSpecPower(value) {
    this.uniforms.clothSpecPower.value = value;
  }
  get matcap2ndStrength() {
    return this.uniforms.matcap2ndStrength.value;
  }
  set matcap2ndStrength(value) {
    this.uniforms.matcap2ndStrength.value = value;
  }
  get skinSpecStrength() {
    return this.uniforms.skinSpecStrength.value;
  }
  set skinSpecStrength(value) {
    this.uniforms.skinSpecStrength.value = value;
  }
  get skinSpecPower() {
    return this.uniforms.skinSpecPower.value;
  }
  set skinSpecPower(value) {
    this.uniforms.skinSpecPower.value = value;
  }
  get skinSpecFresnel() {
    return this.uniforms.skinSpecFresnel.value;
  }
  set skinSpecFresnel(value) {
    this.uniforms.skinSpecFresnel.value = value;
  }
  get skinSpecColor() {
    return this.uniforms.skinSpecColor.value;
  }
  set skinSpecColor(value) {
    this.uniforms.skinSpecColor.value = value;
  }
  get ambientLift() {
    return this.uniforms.ambientLift.value;
  }
  set ambientLift(value) {
    this.uniforms.ambientLift.value = value;
  }
  get shadeMainStrength() {
    return this.uniforms.shadeMainStrength.value;
  }
  set shadeMainStrength(value) {
    this.uniforms.shadeMainStrength.value = value;
  }
  get shadowBorder() {
    return this.uniforms.shadowBorder.value;
  }
  set shadowBorder(value) {
    this.uniforms.shadowBorder.value = value;
  }
  get shadowBlur() {
    return this.uniforms.shadowBlur.value;
  }
  set shadowBlur(value) {
    this.uniforms.shadowBlur.value = value;
  }
  get rimMainStrength() {
    return this.uniforms.rimMainStrength.value;
  }
  set rimMainStrength(value) {
    this.uniforms.rimMainStrength.value = value;
  }
  get rimShadowMask() {
    return this.uniforms.rimShadowMask.value;
  }
  set rimShadowMask(value) {
    this.uniforms.rimShadowMask.value = value;
  }
  /** lilCalcSpecular-like toon specular strength (0 = off) */
  get specularStrength() {
    return this.uniforms.specularStrength.value;
  }
  set specularStrength(value) {
    this.uniforms.specularStrength.value = value;
  }
  /** Specular Blinn power / inverse-roughness proxy */
  get specularPower() {
    return this.uniforms.specularPower.value;
  }
  set specularPower(value) {
    this.uniforms.specularPower.value = value;
  }
  /** Toon specular border in [0,1] */
  get specularBorder() {
    return this.uniforms.specularBorder.value;
  }
  set specularBorder(value) {
    this.uniforms.specularBorder.value = value;
  }
  /** Toon specular blur width */
  get specularBlur() {
    return this.uniforms.specularBlur.value;
  }
  set specularBlur(value) {
    this.uniforms.specularBlur.value = value;
  }
  /** View-dependent env reflection approx (no cubemap) */
  get reflectStrength() {
    return this.uniforms.reflectStrength.value;
  }
  set reflectStrength(value) {
    this.uniforms.reflectStrength.value = value;
  }
  /** Fresnel amount for env approx */
  get reflectFresnel() {
    return this.uniforms.reflectFresnel.value;
  }
  set reflectFresnel(value) {
    this.uniforms.reflectFresnel.value = value;
  }
  /** 0 dielectric .. 1 metal (tints reflection toward albedo) */
  get reflectMetallic() {
    return this.uniforms.reflectMetallic.value;
  }
  set reflectMetallic(value) {
    this.uniforms.reflectMetallic.value = value;
  }
  /** Sharper grazing reflection when high */
  get reflectSmoothness() {
    return this.uniforms.reflectSmoothness.value;
  }
  set reflectSmoothness(value) {
    this.uniforms.reflectSmoothness.value = value;
  }
  /** lil backlight wrap strength (0 = off) */
  get backlightStrength() {
    return this.uniforms.backlightStrength.value;
  }
  set backlightStrength(value) {
    this.uniforms.backlightStrength.value = value;
  }
  /** Backlight tint color */
  get backlightColor() {
    return this.uniforms.backlightColor.value;
  }
  set backlightColor(value) {
    this.uniforms.backlightColor.value = value;
  }
  /** >0 overrides parametric rim fresnel power */
  get rimFresnelPower() {
    return this.uniforms.rimFresnelPower.value;
  }
  set rimFresnelPower(value) {
    this.uniforms.rimFresnelPower.value = value;
  }
  /** Opposite-side rim (lil RimIndir) */
  get rimIndirStrength() {
    return this.uniforms.rimIndirStrength.value;
  }
  set rimIndirStrength(value) {
    this.uniforms.rimIndirStrength.value = value;
  }
  /** Contrast for synthesized 2nd MatCap */
  get matcap2ndContrast() {
    return this.uniforms.matcap2ndContrast.value;
  }
  set matcap2ndContrast(value) {
    this.uniforms.matcap2ndContrast.value = value;
  }
  /** UV scale for 2nd MatCap resample */
  get matcap2ndScale() {
    return this.uniforms.matcap2ndScale.value;
  }
  set matcap2ndScale(value) {
    this.uniforms.matcap2ndScale.value = value;
  }
  /** Extra emissive scale (stock emissive * (1+boost)) */
  get emissionBoost() {
    return this.uniforms.emissionBoost.value;
  }
  set emissionBoost(value) {
    this.uniforms.emissionBoost.value = value;
  }
  /** Camera-distance soft lift/fade approx */
  get distanceFade() {
    return this.uniforms.distanceFade.value;
  }
  set distanceFade(value) {
    this.uniforms.distanceFade.value = value;
  }
  /** Face preset: softer primary shadow border */
  get faceSoft() {
    return this.uniforms.faceSoft.value;
  }
  set faceSoft(value) {
    this.uniforms.faceSoft.value = value;
  }
  /** Amplify normalMap XY for skin depth */
  get normalSkinBoost() {
    return this.uniforms.normalSkinBoost.value;
  }
  set normalSkinBoost(value) {
    this.uniforms.normalSkinBoost.value = value;
  }
  /** lil _ShadowEnvStrength-like shade lift */
  get envStrength() {
    return this.uniforms.envStrength.value;
  }
  set envStrength(value) {
    this.uniforms.envStrength.value = value;
  }
  /** Gem-ish fresnel proxy (0 unless jewelry heuristic) */
  get gemFresnel() {
    return this.uniforms.gemFresnel.value;
  }
  set gemFresnel(value) {
    this.uniforms.gemFresnel.value = value;
  }
  /** Outline lighting mix bias (safe with outline-off) */
  get outlineMix() {
    return this.uniforms.outlineMix.value;
  }
  set outlineMix(value) {
    this.uniforms.outlineMix.value = value;
  }
  /** Receive shadow map factor: 1.0 = full shadow, 0.0 = ignore shadow map (clean anime face) */
  get receiveShadowRate() {
    return this.uniforms.receiveShadowRate.value;
  }
  set receiveShadowRate(value) {
    this.uniforms.receiveShadowRate.value = value;
  }
  /** Velvet / fabric grazing sheen strength (lilToon cloth feel) */
  get fabricSheenStrength() {
    return this.uniforms.fabricSheenStrength.value;
  }
  set fabricSheenStrength(value) {
    this.uniforms.fabricSheenStrength.value = value;
  }
  get fabricSheenPower() {
    return this.uniforms.fabricSheenPower.value;
  }
  set fabricSheenPower(value) {
    this.uniforms.fabricSheenPower.value = value;
  }
  get fabricSheenColor() {
    return this.uniforms.fabricSheenColor.value;
  }
  set fabricSheenColor(value) {
    this.uniforms.fabricSheenColor.value = value;
  }
  /** lilToon-like Fake SSS peach blood-tint halo strength (0..1) */
  get outlineWidthMultiplyTexture() {
    return this.uniforms.outlineWidthMultiplyTexture.value;
  }
  set outlineWidthMultiplyTexture(value) {
    this.uniforms.outlineWidthMultiplyTexture.value = value;
  }
  get outlineWidthFactor() {
    return this.uniforms.outlineWidthFactor.value;
  }
  set outlineWidthFactor(value) {
    this.uniforms.outlineWidthFactor.value = value;
  }
  get outlineColorFactor() {
    return this.uniforms.outlineColorFactor.value;
  }
  set outlineColorFactor(value) {
    this.uniforms.outlineColorFactor.value = value;
  }
  get outlineLightingMixFactor() {
    return this.uniforms.outlineLightingMixFactor.value;
  }
  set outlineLightingMixFactor(value) {
    this.uniforms.outlineLightingMixFactor.value = value;
  }
  get uvAnimationMaskTexture() {
    return this.uniforms.uvAnimationMaskTexture.value;
  }
  set uvAnimationMaskTexture(value) {
    this.uniforms.uvAnimationMaskTexture.value = value;
  }
  get uvAnimationScrollXOffset() {
    return this.uniforms.uvAnimationScrollXOffset.value;
  }
  set uvAnimationScrollXOffset(value) {
    this.uniforms.uvAnimationScrollXOffset.value = value;
  }
  get uvAnimationScrollYOffset() {
    return this.uniforms.uvAnimationScrollYOffset.value;
  }
  set uvAnimationScrollYOffset(value) {
    this.uniforms.uvAnimationScrollYOffset.value = value;
  }
  get uvAnimationRotationPhase() {
    return this.uniforms.uvAnimationRotationPhase.value;
  }
  set uvAnimationRotationPhase(value) {
    this.uniforms.uvAnimationRotationPhase.value = value;
  }
  /**
   * When this is `true`, vertex colors will be ignored.
   * `true` by default.
   */
  get ignoreVertexColor() {
    return this._ignoreVertexColor;
  }
  set ignoreVertexColor(value) {
    this._ignoreVertexColor = value;
    this.needsUpdate = true;
  }
  /**
   * There is a line of the shader called "comment out if you want to PBR absolutely" in VRM0.0 MToon.
   * When this is true, the material enables the line to make it compatible with the legacy rendering of VRM.
   * Usually not recommended to turn this on.
   * `false` by default.
   */
  get v0CompatShade() {
    return this._v0CompatShade;
  }
  /**
   * There is a line of the shader called "comment out if you want to PBR absolutely" in VRM0.0 MToon.
   * When this is true, the material enables the line to make it compatible with the legacy rendering of VRM.
   * Usually not recommended to turn this on.
   * `false` by default.
   */
  set v0CompatShade(v) {
    this._v0CompatShade = v;
    this.needsUpdate = true;
  }
  /**
   * Debug mode for the material.
   * You can visualize several components for diagnosis using debug mode.
   *
   * See: {@link MToonMaterialDebugMode}
   */
  get debugMode() {
    return this._debugMode;
  }
  /**
   * Debug mode for the material.
   * You can visualize several components for diagnosis using debug mode.
   *
   * See: {@link MToonMaterialDebugMode}
   */
  set debugMode(m) {
    this._debugMode = m;
    this.needsUpdate = true;
  }
  get outlineWidthMode() {
    return this._outlineWidthMode;
  }
  set outlineWidthMode(m) {
    this._outlineWidthMode = m;
    this.needsUpdate = true;
  }
  get isOutline() {
    return this._isOutline;
  }
  set isOutline(b) {
    this._isOutline = b;
    this.needsUpdate = true;
  }
  /**
   * Readonly boolean that indicates this is a {@link MToonMaterial}.
   */
  get isMToonMaterial() {
    return true;
  }
  /**
   * Update this material.
   *
   * @param delta deltaTime since last update
   */
  update(delta) {
    this._uploadUniformsWorkaround();
    this._updateUVAnimation(delta);
  }
  copy(source) {
    super.copy(source);
    this.map = source.map;
    this.normalMap = source.normalMap;
    this.emissiveMap = source.emissiveMap;
    this.shadeMultiplyTexture = source.shadeMultiplyTexture;
    this.shadingShiftTexture = source.shadingShiftTexture;
    this.matcapTexture = source.matcapTexture;
    this.rimMultiplyTexture = source.rimMultiplyTexture;
    this.outlineWidthMultiplyTexture = source.outlineWidthMultiplyTexture;
    this.uvAnimationMaskTexture = source.uvAnimationMaskTexture;
    this.normalMapType = source.normalMapType;
    this.uvAnimationScrollXSpeedFactor = source.uvAnimationScrollXSpeedFactor;
    this.uvAnimationScrollYSpeedFactor = source.uvAnimationScrollYSpeedFactor;
    this.uvAnimationRotationSpeedFactor = source.uvAnimationRotationSpeedFactor;
    this.ignoreVertexColor = source.ignoreVertexColor;
    this.v0CompatShade = source.v0CompatShade;
    this.debugMode = source.debugMode;
    this.outlineWidthMode = source.outlineWidthMode;
    this.isOutline = source.isOutline;
    this.needsUpdate = true;
    return this;
  }
  /**
   * Update UV animation state.
   * Intended to be called via {@link update}.
   * @param delta deltaTime
   */
  _updateUVAnimation(delta) {
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
  _uploadUniformsWorkaround() {
    this.uniforms.opacity.value = this.opacity;
    this._updateTextureMatrix(this.uniforms.map, this.uniforms.mapUvTransform);
    this._updateTextureMatrix(this.uniforms.normalMap, this.uniforms.normalMapUvTransform);
    this._updateTextureMatrix(this.uniforms.emissiveMap, this.uniforms.emissiveMapUvTransform);
    this._updateTextureMatrix(this.uniforms.shadeMultiplyTexture, this.uniforms.shadeMultiplyTextureUvTransform);
    this._updateTextureMatrix(this.uniforms.shadingShiftTexture, this.uniforms.shadingShiftTextureUvTransform);
    this._updateTextureMatrix(this.uniforms.matcapTexture, this.uniforms.matcapTextureUvTransform);
    this._updateTextureMatrix(this.uniforms.rimMultiplyTexture, this.uniforms.rimMultiplyTextureUvTransform);
    this._updateTextureMatrix(
      this.uniforms.outlineWidthMultiplyTexture,
      this.uniforms.outlineWidthMultiplyTextureUvTransform
    );
    this._updateTextureMatrix(this.uniforms.uvAnimationMaskTexture, this.uniforms.uvAnimationMaskTextureUvTransform);
    this.uniformsNeedUpdate = true;
  }
  /**
   * Returns a map object of preprocessor token and macro of the shader program.
   */
  _generateDefines() {
    const threeRevision = parseInt(THREE4.REVISION, 10);
    const useUvInVert = this.outlineWidthMultiplyTexture !== null;
    const useUvInFrag = this.map !== null || this.normalMap !== null || this.emissiveMap !== null || this.shadeMultiplyTexture !== null || this.shadingShiftTexture !== null || this.rimMultiplyTexture !== null || this.uvAnimationMaskTexture !== null;
    return {
      // Temporary compat against shader change @ Three.js r126
      // See: #21205, #21307, #21299
      THREE_VRM_THREE_REVISION: threeRevision,
      OUTLINE: this._isOutline,
      MTOON_USE_UV: useUvInVert || useUvInFrag,
      // we can't use `USE_UV` , it will be redefined in WebGLProgram.js
      MTOON_UVS_VERTEX_ONLY: useUvInVert && !useUvInFrag,
      V0_COMPAT_SHADE: this._v0CompatShade,
      USE_SHADEMULTIPLYTEXTURE: this.shadeMultiplyTexture !== null,
      USE_SHADINGSHIFTTEXTURE: this.shadingShiftTexture !== null,
      USE_MATCAPTEXTURE: this.matcapTexture !== null,
      USE_RIMMULTIPLYTEXTURE: this.rimMultiplyTexture !== null,
      USE_OUTLINEWIDTHMULTIPLYTEXTURE: this._isOutline && this.outlineWidthMultiplyTexture !== null,
      USE_UVANIMATIONMASKTEXTURE: this.uvAnimationMaskTexture !== null,
      IGNORE_VERTEX_COLOR: this._ignoreVertexColor === true,
      DEBUG_NORMAL: this._debugMode === "normal",
      DEBUG_LITSHADERATE: this._debugMode === "litShadeRate",
      DEBUG_UV: this._debugMode === "uv",
      OUTLINE_WIDTH_SCREEN: this._isOutline && this._outlineWidthMode === MToonMaterialOutlineWidthMode.ScreenCoordinates
    };
  }
  _updateTextureMatrix(src, dst) {
    if (src.value) {
      if (src.value.matrixAutoUpdate) {
        src.value.updateMatrix();
      }
      dst.value.copy(src.value.matrix);
    }
  }
};

// src/MToonMaterialLoaderPlugin.ts
var POSSIBLE_SPEC_VERSIONS = /* @__PURE__ */ new Set(["1.0", "1.0-beta"]);
var _MToonMaterialLoaderPlugin = class _MToonMaterialLoaderPlugin {
  get name() {
    return _MToonMaterialLoaderPlugin.EXTENSION_NAME;
  }
  constructor(parser, options = {}) {
    var _a, _b, _c, _d;
    this.parser = parser;
    this.materialType = (_a = options.materialType) != null ? _a : MToonMaterial;
    this.renderOrderOffset = (_b = options.renderOrderOffset) != null ? _b : 0;
    this.v0CompatShade = (_c = options.v0CompatShade) != null ? _c : false;
    this.debugMode = (_d = options.debugMode) != null ? _d : "none";
    this._mToonMaterialSet = /* @__PURE__ */ new Set();
  }
  beforeRoot() {
    return __async(this, null, function* () {
      this._removeUnlitExtensionIfMToonExists();
    });
  }
  afterRoot(gltf) {
    return __async(this, null, function* () {
      gltf.userData.vrmMToonMaterials = Array.from(this._mToonMaterialSet);
    });
  }
  getMaterialType(materialIndex) {
    const v1Extension = this._getMToonExtension(materialIndex);
    if (v1Extension) {
      return this.materialType;
    }
    return null;
  }
  extendMaterialParams(materialIndex, materialParams) {
    const extension = this._getMToonExtension(materialIndex);
    if (extension) {
      return this._extendMaterialParams(extension, materialParams);
    }
    return null;
  }
  loadMesh(meshIndex) {
    return __async(this, null, function* () {
      var _a;
      const parser = this.parser;
      const json = parser.json;
      const meshDef = (_a = json.meshes) == null ? void 0 : _a[meshIndex];
      if (meshDef == null) {
        throw new Error(
          `MToonMaterialLoaderPlugin: Attempt to use meshes[${meshIndex}] of glTF but the mesh doesn't exist`
        );
      }
      const primitivesDef = meshDef.primitives;
      const meshOrGroup = yield parser.loadMesh(meshIndex);
      if (primitivesDef.length === 1) {
        const mesh = meshOrGroup;
        const materialIndex = primitivesDef[0].material;
        if (materialIndex != null) {
          this._setupPrimitive(mesh, materialIndex);
        }
      } else {
        const group = meshOrGroup;
        for (let i = 0; i < primitivesDef.length; i++) {
          const mesh = group.children[i];
          const materialIndex = primitivesDef[i].material;
          if (materialIndex != null) {
            this._setupPrimitive(mesh, materialIndex);
          }
        }
      }
      return meshOrGroup;
    });
  }
  /**
   * Delete use of `KHR_materials_unlit` from its `materials` if the material is using MToon.
   *
   * Since GLTFLoader have so many hardcoded procedure related to `KHR_materials_unlit`
   * we have to delete the extension before we start to parse the glTF.
   */
  _removeUnlitExtensionIfMToonExists() {
    const parser = this.parser;
    const json = parser.json;
    const materialDefs = json.materials;
    materialDefs == null ? void 0 : materialDefs.map((materialDef, iMaterial) => {
      var _a;
      const extension = this._getMToonExtension(iMaterial);
      if (extension && ((_a = materialDef.extensions) == null ? void 0 : _a["KHR_materials_unlit"])) {
        delete materialDef.extensions["KHR_materials_unlit"];
      }
    });
  }
  _getMToonExtension(materialIndex) {
    var _a, _b;
    const parser = this.parser;
    const json = parser.json;
    const materialDef = (_a = json.materials) == null ? void 0 : _a[materialIndex];
    if (materialDef == null) {
      console.warn(
        `MToonMaterialLoaderPlugin: Attempt to use materials[${materialIndex}] of glTF but the material doesn't exist`
      );
      return void 0;
    }
    const extension = (_b = materialDef.extensions) == null ? void 0 : _b[_MToonMaterialLoaderPlugin.EXTENSION_NAME];
    if (extension == null) {
      return void 0;
    }
    const specVersion = extension.specVersion;
    if (!POSSIBLE_SPEC_VERSIONS.has(specVersion)) {
      console.warn(
        `MToonMaterialLoaderPlugin: Unknown ${_MToonMaterialLoaderPlugin.EXTENSION_NAME} specVersion "${specVersion}"`
      );
      return void 0;
    }
    return extension;
  }
  _extendMaterialParams(extension, materialParams) {
    return __async(this, null, function* () {
      var _a;
      delete materialParams.metalness;
      delete materialParams.roughness;
      const assignHelper = new GLTFMToonMaterialParamsAssignHelper(this.parser, materialParams);
      assignHelper.assignPrimitive("transparentWithZWrite", extension.transparentWithZWrite);
      assignHelper.assignColor("shadeColorFactor", extension.shadeColorFactor);
      assignHelper.assignTexture("shadeMultiplyTexture", extension.shadeMultiplyTexture, true);
      assignHelper.assignPrimitive("shadingShiftFactor", extension.shadingShiftFactor);
      assignHelper.assignTexture("shadingShiftTexture", extension.shadingShiftTexture, true);
      assignHelper.assignPrimitive("shadingShiftTextureScale", (_a = extension.shadingShiftTexture) == null ? void 0 : _a.scale);
      assignHelper.assignPrimitive("shadingToonyFactor", extension.shadingToonyFactor);
      assignHelper.assignPrimitive("giEqualizationFactor", extension.giEqualizationFactor);
      assignHelper.assignColor("matcapFactor", extension.matcapFactor);
      assignHelper.assignTexture("matcapTexture", extension.matcapTexture, true);
      assignHelper.assignColor("parametricRimColorFactor", extension.parametricRimColorFactor);
      assignHelper.assignTexture("rimMultiplyTexture", extension.rimMultiplyTexture, true);
      assignHelper.assignPrimitive("rimLightingMixFactor", extension.rimLightingMixFactor);
      assignHelper.assignPrimitive("parametricRimFresnelPowerFactor", extension.parametricRimFresnelPowerFactor);
      assignHelper.assignPrimitive("parametricRimLiftFactor", extension.parametricRimLiftFactor);
      assignHelper.assignPrimitive("outlineWidthMode", extension.outlineWidthMode);
      assignHelper.assignPrimitive("outlineWidthFactor", extension.outlineWidthFactor);
      assignHelper.assignTexture("outlineWidthMultiplyTexture", extension.outlineWidthMultiplyTexture, false);
      assignHelper.assignColor("outlineColorFactor", extension.outlineColorFactor);
      assignHelper.assignPrimitive("outlineLightingMixFactor", extension.outlineLightingMixFactor);
      assignHelper.assignTexture("uvAnimationMaskTexture", extension.uvAnimationMaskTexture, false);
      assignHelper.assignPrimitive("uvAnimationScrollXSpeedFactor", extension.uvAnimationScrollXSpeedFactor);
      assignHelper.assignPrimitive("uvAnimationScrollYSpeedFactor", extension.uvAnimationScrollYSpeedFactor);
      assignHelper.assignPrimitive("uvAnimationRotationSpeedFactor", extension.uvAnimationRotationSpeedFactor);
      assignHelper.assignPrimitive("v0CompatShade", this.v0CompatShade);
      assignHelper.assignPrimitive("debugMode", this.debugMode);
      yield assignHelper.pending;
      this._ensureMipmapForColorTextures(materialParams);
    });
  }
  /**
   * VRM/glTF 的 sampler 一旦声明 minFilter=LINEAR, GLTFLoader 就会据此关掉 mipmap
   * (`GLTFLoader#loadTexture`: generateMipmaps 由 sampler.minFilter 推导, 缺省才是
   * LinearMipmapLinearFilter)。VRoid Studio 之类导出器会统一写LINEAR, 于是整模型的
   * 贴图全部无 mip。
   *
   * 后果是贴图里孤立的高亮像素 (例如二次元脸部贴图预画的鼻梁菱形高光) 在缩小显示时
   * 退化成亚像素, 随采样点位置逐帧跳动 —— 表现为「离得远一闪一闪、靠近就稳」。
   *
   * 这里只给「颜色类」贴图补回三线性 mip:
   *   - baseColor / emissive / shadeMultiply / shadingShift / rimMultiply 承载可见的高对比
   *     细节, 缩远走样最刺眼;
   *   - normalMap 刻意不开: mipmap 会把朝向不同的法线取平均, 得到物理上不存在的中间
   *     向量, 远处光照过渡会塌陷; 而法线本身高频、缩远本就该糊掉, 走样并不明显;
   *   - matcapTexture 也不开: 它按视线法线采样的球面环境图, 不走 UV 缩小路径。
   *
   * 必须在 assignHelper.pending 之后调用 —— 此时 baseColor / emissive (GLTFLoader 标准
   * 路径) 与 MToon 扩展专属贴图才全部就位。
   */
  _ensureMipmapForColorTextures(materialParams) {
    const p = materialParams;
    const COLOR_TEXTURE_SLOTS = [
      "map",
      // baseColorTexture (GLTFLoader 标准路径)
      "emissiveMap",
      // emissiveTexture (GLTFLoader 标准路径)
      "shadeMultiplyTexture",
      "shadingShiftTexture",
      "rimMultiplyTexture"
    ];
    for (const slot of COLOR_TEXTURE_SLOTS) {
      const tex = p[slot];
      if (tex && tex.isTexture && tex.generateMipmaps === false) {
        tex.generateMipmaps = true;
        tex.minFilter = THREE5.LinearMipmapLinearFilter;
        tex.needsUpdate = true;
      }
    }
  }
  /**
   * This will do two processes that is required to render MToon properly.
   *
   * - Set render order
   * - Generate outline
   *
   * @param mesh A target GLTF primitive
   * @param materialIndex The material index of the primitive
   */
  _setupPrimitive(mesh, materialIndex) {
    const extension = this._getMToonExtension(materialIndex);
    if (extension) {
      const renderOrder = this._parseRenderOrder(extension);
      mesh.renderOrder = renderOrder + this.renderOrderOffset;
      this._generateOutline(mesh);
      this._addToMaterialSet(mesh);
      return;
    }
  }
  /**
   * Check whether the material should generate outline or not.
   * @param surfaceMaterial The material to check
   * @returns True if the material should generate outline
   */
  _shouldGenerateOutline(surfaceMaterial) {
    return typeof surfaceMaterial.outlineWidthMode === "string" && surfaceMaterial.outlineWidthMode !== "none" && typeof surfaceMaterial.outlineWidthFactor === "number" && surfaceMaterial.outlineWidthFactor > 0;
  }
  /**
   * Generate outline for the given mesh, if it needs.
   *
   * @param mesh The target mesh
   */
  _generateOutline(mesh) {
    const surfaceMaterial = mesh.material;
    if (!(surfaceMaterial instanceof THREE5.Material)) {
      return;
    }
    if (!this._shouldGenerateOutline(surfaceMaterial)) {
      return;
    }
    mesh.material = [surfaceMaterial];
    const outlineMaterial = surfaceMaterial.clone();
    outlineMaterial.name += " (Outline)";
    outlineMaterial.isOutline = true;
    outlineMaterial.side = THREE5.BackSide;
    mesh.material.push(outlineMaterial);
    const geometry = mesh.geometry;
    const primitiveVertices = geometry.index ? geometry.index.count : geometry.attributes.position.count / 3;
    geometry.addGroup(0, primitiveVertices, 0);
    geometry.addGroup(0, primitiveVertices, 1);
  }
  _addToMaterialSet(mesh) {
    const materialOrMaterials = mesh.material;
    const materialSet = /* @__PURE__ */ new Set();
    if (Array.isArray(materialOrMaterials)) {
      materialOrMaterials.forEach((material) => materialSet.add(material));
    } else {
      materialSet.add(materialOrMaterials);
    }
    for (const material of materialSet) {
      this._mToonMaterialSet.add(material);
    }
  }
  _parseRenderOrder(extension) {
    var _a;
    const enabledZWrite = extension.transparentWithZWrite;
    return (enabledZWrite ? 0 : 19) + ((_a = extension.renderQueueOffsetNumber) != null ? _a : 0);
  }
};
_MToonMaterialLoaderPlugin.EXTENSION_NAME = "VRMC_materials_mtoon";
var MToonMaterialLoaderPlugin = _MToonMaterialLoaderPlugin;
export {
  MToonMaterial,
  MToonMaterialDebugMode,
  MToonMaterialLoaderPlugin,
  MToonMaterialOutlineWidthMode
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL01Ub29uTWF0ZXJpYWxMb2FkZXJQbHVnaW4udHMiLCAiLi4vc3JjL0dMVEZNVG9vbk1hdGVyaWFsUGFyYW1zQXNzaWduSGVscGVyLnRzIiwgIi4uL3NyYy91dGlscy9zZXRUZXh0dXJlQ29sb3JTcGFjZS50cyIsICIuLi9zcmMvTVRvb25NYXRlcmlhbC50cyIsICIuLi9zcmMvc2hhZGVycy9tdG9vbi52ZXJ0IiwgIi4uL3NyYy9zaGFkZXJzL210b29uLmZyYWciLCAiLi4vc3JjL01Ub29uTWF0ZXJpYWxEZWJ1Z01vZGUudHMiLCAiLi4vc3JjL01Ub29uTWF0ZXJpYWxPdXRsaW5lV2lkdGhNb2RlLnRzIiwgIi4uL3NyYy91dGlscy9nZXRUZXh0dXJlQ29sb3JTcGFjZS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0ICogYXMgVEhSRUUgZnJvbSAndGhyZWUnO1xuaW1wb3J0ICogYXMgVjFNVG9vblNjaGVtYSBmcm9tICdAcGl4aXYvdHlwZXMtdnJtYy1tYXRlcmlhbHMtbXRvb24tMS4wJztcbmltcG9ydCB0eXBlIHsgR0xURiwgR0xURkxvYWRlciwgR0xURkxvYWRlclBsdWdpbiwgR0xURlBhcnNlciB9IGZyb20gJ3RocmVlL2V4YW1wbGVzL2pzbS9sb2FkZXJzL0dMVEZMb2FkZXIuanMnO1xuaW1wb3J0IHR5cGUgeyBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycyB9IGZyb20gJy4vTVRvb25NYXRlcmlhbFBhcmFtZXRlcnMnO1xuaW1wb3J0IHR5cGUgeyBNVG9vbk1hdGVyaWFsT3V0bGluZVdpZHRoTW9kZSB9IGZyb20gJy4vTVRvb25NYXRlcmlhbE91dGxpbmVXaWR0aE1vZGUnO1xuaW1wb3J0IHsgR0xURk1Ub29uTWF0ZXJpYWxQYXJhbXNBc3NpZ25IZWxwZXIgfSBmcm9tICcuL0dMVEZNVG9vbk1hdGVyaWFsUGFyYW1zQXNzaWduSGVscGVyJztcbmltcG9ydCB0eXBlIHsgTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbk9wdGlvbnMgfSBmcm9tICcuL01Ub29uTWF0ZXJpYWxMb2FkZXJQbHVnaW5PcHRpb25zJztcbmltcG9ydCB0eXBlIHsgTVRvb25NYXRlcmlhbERlYnVnTW9kZSB9IGZyb20gJy4vTVRvb25NYXRlcmlhbERlYnVnTW9kZSc7XG5pbXBvcnQgeyBHTFRGIGFzIEdMVEZTY2hlbWEgfSBmcm9tICdAZ2x0Zi10cmFuc2Zvcm0vY29yZSc7XG5pbXBvcnQgeyBNVG9vbk1hdGVyaWFsIH0gZnJvbSAnLi9NVG9vbk1hdGVyaWFsJztcbmltcG9ydCB0eXBlIHsgTVRvb25Ob2RlTWF0ZXJpYWwgfSBmcm9tICcuL25vZGVzL01Ub29uTm9kZU1hdGVyaWFsJztcblxuLyoqXG4gKiBQb3NzaWJsZSBzcGVjIHZlcnNpb25zIGl0IHJlY29nbml6ZXMuXG4gKi9cbmNvbnN0IFBPU1NJQkxFX1NQRUNfVkVSU0lPTlMgPSBuZXcgU2V0KFsnMS4wJywgJzEuMC1iZXRhJ10pO1xuXG4vKipcbiAqIEEgbG9hZGVyIHBsdWdpbiBvZiB7QGxpbmsgR0xURkxvYWRlcn0gZm9yIHRoZSBleHRlbnNpb24gYFZSTUNfbWF0ZXJpYWxzX210b29uYC5cbiAqXG4gKiBUaGlzIHBsdWdpbiBpcyBmb3IgdXNlcyB3aXRoIFdlYkdMUmVuZGVyZXIgYnkgZGVmYXVsdC5cbiAqIFRvIHVzZSBNVG9vbiBpbiBXZWJHUFVSZW5kZXJlciwgc2V0IHtAbGluayBtYXRlcmlhbFR5cGV9IHRvIHtAbGluayBNVG9vbk5vZGVNYXRlcmlhbH0uXG4gKlxuICogQGV4YW1wbGUgdG8gdXNlIHdpdGggV2ViR1BVUmVuZGVyZXJcbiAqIGBgYGpzXG4gKiBpbXBvcnQgeyBNVG9vbk1hdGVyaWFsTG9hZGVyUGx1Z2luIH0gZnJvbSAnQHBpeGl2L3RocmVlLXZybS1tYXRlcmlhbHMtbXRvb24nO1xuICogaW1wb3J0IHsgTVRvb25Ob2RlTWF0ZXJpYWwgfSBmcm9tICdAcGl4aXYvdGhyZWUtdnJtLW1hdGVyaWFscy1tdG9vbi9ub2Rlcyc7XG4gKlxuICogLy8gLi4uXG4gKlxuICogLy8gUmVnaXN0ZXIgYSBNVG9vbk1hdGVyaWFsTG9hZGVyUGx1Z2luIHdpdGggTVRvb25Ob2RlTWF0ZXJpYWxcbiAqIGxvYWRlci5yZWdpc3RlcigocGFyc2VyKSA9PiB7XG4gKlxuICogICAvLyBjcmVhdGUgYSBXZWJHUFUgY29tcGF0aWJsZSBNVG9vbk1hdGVyaWFsTG9hZGVyUGx1Z2luXG4gKiAgIHJldHVybiBuZXcgTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbihwYXJzZXIsIHtcbiAqXG4gKiAgICAgLy8gc2V0IHRoZSBtYXRlcmlhbCB0eXBlIHRvIE1Ub29uTm9kZU1hdGVyaWFsXG4gKiAgICAgbWF0ZXJpYWxUeXBlOiBNVG9vbk5vZGVNYXRlcmlhbCxcbiAqXG4gKiAgIH0pO1xuICpcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBNVG9vbk1hdGVyaWFsTG9hZGVyUGx1Z2luIGltcGxlbWVudHMgR0xURkxvYWRlclBsdWdpbiB7XG4gIHB1YmxpYyBzdGF0aWMgRVhURU5TSU9OX05BTUUgPSAnVlJNQ19tYXRlcmlhbHNfbXRvb24nO1xuXG4gIC8qKlxuICAgKiBUaGUgdHlwZSBvZiB0aGUgbWF0ZXJpYWwgdGhhdCB0aGlzIHBsdWdpbiB3aWxsIGdlbmVyYXRlLlxuICAgKlxuICAgKiBJZiB5b3UgYXJlIHVzaW5nIHRoaXMgcGx1Z2luIHdpdGggV2ViR1BVLCBzZXQgdGhpcyB0byB7QGxpbmsgTVRvb25Ob2RlTWF0ZXJpYWx9LlxuICAgKlxuICAgKiBAZGVmYXVsdCBNVG9vbk1hdGVyaWFsXG4gICAqL1xuICBwdWJsaWMgbWF0ZXJpYWxUeXBlOiB0eXBlb2YgVEhSRUUuTWF0ZXJpYWw7XG5cbiAgLyoqXG4gICAqIFRoaXMgdmFsdWUgd2lsbCBiZSBhZGRlZCB0byBgcmVuZGVyT3JkZXJgIG9mIGV2ZXJ5IG1lc2hlcyB3aG8gaGF2ZSBNYXRlcmlhbHNNVG9vbi5cbiAgICogVGhlIGZpbmFsIHJlbmRlck9yZGVyIHdpbGwgYmUgc3VtIG9mIHRoaXMgYHJlbmRlck9yZGVyT2Zmc2V0YCBhbmQgYHJlbmRlclF1ZXVlT2Zmc2V0TnVtYmVyYCBmb3IgZWFjaCBtYXRlcmlhbHMuXG4gICAqXG4gICAqIEBkZWZhdWx0IDBcbiAgICovXG4gIHB1YmxpYyByZW5kZXJPcmRlck9mZnNldDogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGVyZSBpcyBhIGxpbmUgb2YgdGhlIHNoYWRlciBjYWxsZWQgXCJjb21tZW50IG91dCBpZiB5b3Ugd2FudCB0byBQQlIgYWJzb2x1dGVseVwiIGluIFZSTTAuMCBNVG9vbi5cbiAgICogV2hlbiB0aGlzIGlzIHRydWUsIHRoZSBtYXRlcmlhbCBlbmFibGVzIHRoZSBsaW5lIHRvIG1ha2UgaXQgY29tcGF0aWJsZSB3aXRoIHRoZSBsZWdhY3kgcmVuZGVyaW5nIG9mIFZSTS5cbiAgICogVXN1YWxseSBub3QgcmVjb21tZW5kZWQgdG8gdHVybiB0aGlzIG9uLlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcHVibGljIHYwQ29tcGF0U2hhZGU6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIERlYnVnIG1vZGUgZm9yIHRoZSBtYXRlcmlhbC5cbiAgICogWW91IGNhbiB2aXN1YWxpemUgc2V2ZXJhbCBjb21wb25lbnRzIGZvciBkaWFnbm9zaXMgdXNpbmcgZGVidWcgbW9kZS5cbiAgICpcbiAgICogU2VlOiB7QGxpbmsgTVRvb25NYXRlcmlhbERlYnVnTW9kZX1cbiAgICpcbiAgICogQGRlZmF1bHQgJ25vbmUnXG4gICAqL1xuICBwdWJsaWMgZGVidWdNb2RlOiBNVG9vbk1hdGVyaWFsRGVidWdNb2RlO1xuXG4gIHB1YmxpYyByZWFkb25seSBwYXJzZXI6IEdMVEZQYXJzZXI7XG5cbiAgLyoqXG4gICAqIExvYWRlZCBtYXRlcmlhbHMgd2lsbCBiZSBzdG9yZWQgaW4gdGhpcyBzZXQuXG4gICAqIFdpbGwgYmUgdHJhbnNmZXJyZWQgaW50byBgZ2x0Zi51c2VyRGF0YS52cm1NVG9vbk1hdGVyaWFsc2AgaW4ge0BsaW5rIGFmdGVyUm9vdH0uXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IF9tVG9vbk1hdGVyaWFsU2V0OiBTZXQ8VEhSRUUuTWF0ZXJpYWw+O1xuXG4gIHB1YmxpYyBnZXQgbmFtZSgpOiBzdHJpbmcge1xuICAgIHJldHVybiBNVG9vbk1hdGVyaWFsTG9hZGVyUGx1Z2luLkVYVEVOU0lPTl9OQU1FO1xuICB9XG5cbiAgcHVibGljIGNvbnN0cnVjdG9yKHBhcnNlcjogR0xURlBhcnNlciwgb3B0aW9uczogTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbk9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMucGFyc2VyID0gcGFyc2VyO1xuXG4gICAgdGhpcy5tYXRlcmlhbFR5cGUgPSBvcHRpb25zLm1hdGVyaWFsVHlwZSA/PyBNVG9vbk1hdGVyaWFsO1xuICAgIHRoaXMucmVuZGVyT3JkZXJPZmZzZXQgPSBvcHRpb25zLnJlbmRlck9yZGVyT2Zmc2V0ID8/IDA7XG4gICAgdGhpcy52MENvbXBhdFNoYWRlID0gb3B0aW9ucy52MENvbXBhdFNoYWRlID8/IGZhbHNlO1xuICAgIHRoaXMuZGVidWdNb2RlID0gb3B0aW9ucy5kZWJ1Z01vZGUgPz8gJ25vbmUnO1xuXG4gICAgdGhpcy5fbVRvb25NYXRlcmlhbFNldCA9IG5ldyBTZXQoKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBiZWZvcmVSb290KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuX3JlbW92ZVVubGl0RXh0ZW5zaW9uSWZNVG9vbkV4aXN0cygpO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGFmdGVyUm9vdChnbHRmOiBHTFRGKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgZ2x0Zi51c2VyRGF0YS52cm1NVG9vbk1hdGVyaWFscyA9IEFycmF5LmZyb20odGhpcy5fbVRvb25NYXRlcmlhbFNldCk7XG4gIH1cblxuICBwdWJsaWMgZ2V0TWF0ZXJpYWxUeXBlKG1hdGVyaWFsSW5kZXg6IG51bWJlcik6IHR5cGVvZiBUSFJFRS5NYXRlcmlhbCB8IG51bGwge1xuICAgIGNvbnN0IHYxRXh0ZW5zaW9uID0gdGhpcy5fZ2V0TVRvb25FeHRlbnNpb24obWF0ZXJpYWxJbmRleCk7XG4gICAgaWYgKHYxRXh0ZW5zaW9uKSB7XG4gICAgICByZXR1cm4gdGhpcy5tYXRlcmlhbFR5cGU7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwdWJsaWMgZXh0ZW5kTWF0ZXJpYWxQYXJhbXMobWF0ZXJpYWxJbmRleDogbnVtYmVyLCBtYXRlcmlhbFBhcmFtczogTVRvb25NYXRlcmlhbFBhcmFtZXRlcnMpOiBQcm9taXNlPGFueT4gfCBudWxsIHtcbiAgICBjb25zdCBleHRlbnNpb24gPSB0aGlzLl9nZXRNVG9vbkV4dGVuc2lvbihtYXRlcmlhbEluZGV4KTtcbiAgICBpZiAoZXh0ZW5zaW9uKSB7XG4gICAgICByZXR1cm4gdGhpcy5fZXh0ZW5kTWF0ZXJpYWxQYXJhbXMoZXh0ZW5zaW9uLCBtYXRlcmlhbFBhcmFtcyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgbG9hZE1lc2gobWVzaEluZGV4OiBudW1iZXIpOiBQcm9taXNlPFRIUkVFLkdyb3VwIHwgVEhSRUUuTWVzaCB8IFRIUkVFLlNraW5uZWRNZXNoPiB7XG4gICAgY29uc3QgcGFyc2VyID0gdGhpcy5wYXJzZXI7XG4gICAgY29uc3QganNvbiA9IHBhcnNlci5qc29uIGFzIEdMVEZTY2hlbWEuSUdMVEY7XG5cbiAgICBjb25zdCBtZXNoRGVmID0ganNvbi5tZXNoZXM/LlttZXNoSW5kZXhdO1xuXG4gICAgaWYgKG1lc2hEZWYgPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbjogQXR0ZW1wdCB0byB1c2UgbWVzaGVzWyR7bWVzaEluZGV4fV0gb2YgZ2xURiBidXQgdGhlIG1lc2ggZG9lc24ndCBleGlzdGAsXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IHByaW1pdGl2ZXNEZWYgPSBtZXNoRGVmLnByaW1pdGl2ZXM7XG5cbiAgICBjb25zdCBtZXNoT3JHcm91cCA9IGF3YWl0IHBhcnNlci5sb2FkTWVzaChtZXNoSW5kZXgpO1xuXG4gICAgaWYgKHByaW1pdGl2ZXNEZWYubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBtZXNoID0gbWVzaE9yR3JvdXAgYXMgVEhSRUUuTWVzaDtcbiAgICAgIGNvbnN0IG1hdGVyaWFsSW5kZXggPSBwcmltaXRpdmVzRGVmWzBdLm1hdGVyaWFsO1xuXG4gICAgICBpZiAobWF0ZXJpYWxJbmRleCAhPSBudWxsKSB7XG4gICAgICAgIHRoaXMuX3NldHVwUHJpbWl0aXZlKG1lc2gsIG1hdGVyaWFsSW5kZXgpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBncm91cCA9IG1lc2hPckdyb3VwIGFzIFRIUkVFLkdyb3VwO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwcmltaXRpdmVzRGVmLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IG1lc2ggPSBncm91cC5jaGlsZHJlbltpXSBhcyBUSFJFRS5NZXNoO1xuICAgICAgICBjb25zdCBtYXRlcmlhbEluZGV4ID0gcHJpbWl0aXZlc0RlZltpXS5tYXRlcmlhbDtcblxuICAgICAgICBpZiAobWF0ZXJpYWxJbmRleCAhPSBudWxsKSB7XG4gICAgICAgICAgdGhpcy5fc2V0dXBQcmltaXRpdmUobWVzaCwgbWF0ZXJpYWxJbmRleCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbWVzaE9yR3JvdXA7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlIHVzZSBvZiBgS0hSX21hdGVyaWFsc191bmxpdGAgZnJvbSBpdHMgYG1hdGVyaWFsc2AgaWYgdGhlIG1hdGVyaWFsIGlzIHVzaW5nIE1Ub29uLlxuICAgKlxuICAgKiBTaW5jZSBHTFRGTG9hZGVyIGhhdmUgc28gbWFueSBoYXJkY29kZWQgcHJvY2VkdXJlIHJlbGF0ZWQgdG8gYEtIUl9tYXRlcmlhbHNfdW5saXRgXG4gICAqIHdlIGhhdmUgdG8gZGVsZXRlIHRoZSBleHRlbnNpb24gYmVmb3JlIHdlIHN0YXJ0IHRvIHBhcnNlIHRoZSBnbFRGLlxuICAgKi9cbiAgcHJpdmF0ZSBfcmVtb3ZlVW5saXRFeHRlbnNpb25JZk1Ub29uRXhpc3RzKCk6IHZvaWQge1xuICAgIGNvbnN0IHBhcnNlciA9IHRoaXMucGFyc2VyO1xuICAgIGNvbnN0IGpzb24gPSBwYXJzZXIuanNvbiBhcyBHTFRGU2NoZW1hLklHTFRGO1xuXG4gICAgY29uc3QgbWF0ZXJpYWxEZWZzID0ganNvbi5tYXRlcmlhbHM7XG4gICAgbWF0ZXJpYWxEZWZzPy5tYXAoKG1hdGVyaWFsRGVmLCBpTWF0ZXJpYWwpID0+IHtcbiAgICAgIGNvbnN0IGV4dGVuc2lvbiA9IHRoaXMuX2dldE1Ub29uRXh0ZW5zaW9uKGlNYXRlcmlhbCk7XG5cbiAgICAgIGlmIChleHRlbnNpb24gJiYgbWF0ZXJpYWxEZWYuZXh0ZW5zaW9ucz8uWydLSFJfbWF0ZXJpYWxzX3VubGl0J10pIHtcbiAgICAgICAgZGVsZXRlIG1hdGVyaWFsRGVmLmV4dGVuc2lvbnNbJ0tIUl9tYXRlcmlhbHNfdW5saXQnXTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBfZ2V0TVRvb25FeHRlbnNpb24obWF0ZXJpYWxJbmRleDogbnVtYmVyKTogVjFNVG9vblNjaGVtYS5WUk1DTWF0ZXJpYWxzTVRvb24gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHBhcnNlciA9IHRoaXMucGFyc2VyO1xuICAgIGNvbnN0IGpzb24gPSBwYXJzZXIuanNvbiBhcyBHTFRGU2NoZW1hLklHTFRGO1xuXG4gICAgY29uc3QgbWF0ZXJpYWxEZWYgPSBqc29uLm1hdGVyaWFscz8uW21hdGVyaWFsSW5kZXhdO1xuXG4gICAgaWYgKG1hdGVyaWFsRGVmID09IG51bGwpIHtcbiAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgYE1Ub29uTWF0ZXJpYWxMb2FkZXJQbHVnaW46IEF0dGVtcHQgdG8gdXNlIG1hdGVyaWFsc1ske21hdGVyaWFsSW5kZXh9XSBvZiBnbFRGIGJ1dCB0aGUgbWF0ZXJpYWwgZG9lc24ndCBleGlzdGAsXG4gICAgICApO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBleHRlbnNpb24gPSBtYXRlcmlhbERlZi5leHRlbnNpb25zPy5bTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbi5FWFRFTlNJT05fTkFNRV0gYXNcbiAgICAgIFYxTVRvb25TY2hlbWEuVlJNQ01hdGVyaWFsc01Ub29uIHwgdW5kZWZpbmVkO1xuICAgIGlmIChleHRlbnNpb24gPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBzcGVjVmVyc2lvbiA9IGV4dGVuc2lvbi5zcGVjVmVyc2lvbjtcbiAgICBpZiAoIVBPU1NJQkxFX1NQRUNfVkVSU0lPTlMuaGFzKHNwZWNWZXJzaW9uKSkge1xuICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICBgTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbjogVW5rbm93biAke01Ub29uTWF0ZXJpYWxMb2FkZXJQbHVnaW4uRVhURU5TSU9OX05BTUV9IHNwZWNWZXJzaW9uIFwiJHtzcGVjVmVyc2lvbn1cImAsXG4gICAgICApO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4gZXh0ZW5zaW9uO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfZXh0ZW5kTWF0ZXJpYWxQYXJhbXMoXG4gICAgZXh0ZW5zaW9uOiBWMU1Ub29uU2NoZW1hLlZSTUNNYXRlcmlhbHNNVG9vbixcbiAgICBtYXRlcmlhbFBhcmFtczogTVRvb25NYXRlcmlhbFBhcmFtZXRlcnMsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIFJlbW92aW5nIG1hdGVyaWFsIHBhcmFtcyB0aGF0IGlzIG5vdCByZXF1aXJlZCB0byBzdXByZXNzIHdhcm5pbmdzLlxuICAgIGRlbGV0ZSAobWF0ZXJpYWxQYXJhbXMgYXMgVEhSRUUuTWVzaFN0YW5kYXJkTWF0ZXJpYWxQYXJhbWV0ZXJzKS5tZXRhbG5lc3M7XG4gICAgZGVsZXRlIChtYXRlcmlhbFBhcmFtcyBhcyBUSFJFRS5NZXNoU3RhbmRhcmRNYXRlcmlhbFBhcmFtZXRlcnMpLnJvdWdobmVzcztcblxuICAgIGNvbnN0IGFzc2lnbkhlbHBlciA9IG5ldyBHTFRGTVRvb25NYXRlcmlhbFBhcmFtc0Fzc2lnbkhlbHBlcih0aGlzLnBhcnNlciwgbWF0ZXJpYWxQYXJhbXMpO1xuXG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgndHJhbnNwYXJlbnRXaXRoWldyaXRlJywgZXh0ZW5zaW9uLnRyYW5zcGFyZW50V2l0aFpXcml0ZSk7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnbkNvbG9yKCdzaGFkZUNvbG9yRmFjdG9yJywgZXh0ZW5zaW9uLnNoYWRlQ29sb3JGYWN0b3IpO1xuICAgIGFzc2lnbkhlbHBlci5hc3NpZ25UZXh0dXJlKCdzaGFkZU11bHRpcGx5VGV4dHVyZScsIGV4dGVuc2lvbi5zaGFkZU11bHRpcGx5VGV4dHVyZSwgdHJ1ZSk7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgnc2hhZGluZ1NoaWZ0RmFjdG9yJywgZXh0ZW5zaW9uLnNoYWRpbmdTaGlmdEZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblRleHR1cmUoJ3NoYWRpbmdTaGlmdFRleHR1cmUnLCBleHRlbnNpb24uc2hhZGluZ1NoaWZ0VGV4dHVyZSwgdHJ1ZSk7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgnc2hhZGluZ1NoaWZ0VGV4dHVyZVNjYWxlJywgZXh0ZW5zaW9uLnNoYWRpbmdTaGlmdFRleHR1cmU/LnNjYWxlKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdzaGFkaW5nVG9vbnlGYWN0b3InLCBleHRlbnNpb24uc2hhZGluZ1Rvb255RmFjdG9yKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdnaUVxdWFsaXphdGlvbkZhY3RvcicsIGV4dGVuc2lvbi5naUVxdWFsaXphdGlvbkZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnbkNvbG9yKCdtYXRjYXBGYWN0b3InLCBleHRlbnNpb24ubWF0Y2FwRmFjdG9yKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduVGV4dHVyZSgnbWF0Y2FwVGV4dHVyZScsIGV4dGVuc2lvbi5tYXRjYXBUZXh0dXJlLCB0cnVlKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduQ29sb3IoJ3BhcmFtZXRyaWNSaW1Db2xvckZhY3RvcicsIGV4dGVuc2lvbi5wYXJhbWV0cmljUmltQ29sb3JGYWN0b3IpO1xuICAgIGFzc2lnbkhlbHBlci5hc3NpZ25UZXh0dXJlKCdyaW1NdWx0aXBseVRleHR1cmUnLCBleHRlbnNpb24ucmltTXVsdGlwbHlUZXh0dXJlLCB0cnVlKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdyaW1MaWdodGluZ01peEZhY3RvcicsIGV4dGVuc2lvbi5yaW1MaWdodGluZ01peEZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgncGFyYW1ldHJpY1JpbUZyZXNuZWxQb3dlckZhY3RvcicsIGV4dGVuc2lvbi5wYXJhbWV0cmljUmltRnJlc25lbFBvd2VyRmFjdG9yKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdwYXJhbWV0cmljUmltTGlmdEZhY3RvcicsIGV4dGVuc2lvbi5wYXJhbWV0cmljUmltTGlmdEZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgnb3V0bGluZVdpZHRoTW9kZScsIGV4dGVuc2lvbi5vdXRsaW5lV2lkdGhNb2RlIGFzIE1Ub29uTWF0ZXJpYWxPdXRsaW5lV2lkdGhNb2RlKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdvdXRsaW5lV2lkdGhGYWN0b3InLCBleHRlbnNpb24ub3V0bGluZVdpZHRoRmFjdG9yKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduVGV4dHVyZSgnb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlJywgZXh0ZW5zaW9uLm91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZSwgZmFsc2UpO1xuICAgIGFzc2lnbkhlbHBlci5hc3NpZ25Db2xvcignb3V0bGluZUNvbG9yRmFjdG9yJywgZXh0ZW5zaW9uLm91dGxpbmVDb2xvckZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgnb3V0bGluZUxpZ2h0aW5nTWl4RmFjdG9yJywgZXh0ZW5zaW9uLm91dGxpbmVMaWdodGluZ01peEZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblRleHR1cmUoJ3V2QW5pbWF0aW9uTWFza1RleHR1cmUnLCBleHRlbnNpb24udXZBbmltYXRpb25NYXNrVGV4dHVyZSwgZmFsc2UpO1xuICAgIGFzc2lnbkhlbHBlci5hc3NpZ25QcmltaXRpdmUoJ3V2QW5pbWF0aW9uU2Nyb2xsWFNwZWVkRmFjdG9yJywgZXh0ZW5zaW9uLnV2QW5pbWF0aW9uU2Nyb2xsWFNwZWVkRmFjdG9yKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCd1dkFuaW1hdGlvblNjcm9sbFlTcGVlZEZhY3RvcicsIGV4dGVuc2lvbi51dkFuaW1hdGlvblNjcm9sbFlTcGVlZEZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgndXZBbmltYXRpb25Sb3RhdGlvblNwZWVkRmFjdG9yJywgZXh0ZW5zaW9uLnV2QW5pbWF0aW9uUm90YXRpb25TcGVlZEZhY3Rvcik7XG5cbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCd2MENvbXBhdFNoYWRlJywgdGhpcy52MENvbXBhdFNoYWRlKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdkZWJ1Z01vZGUnLCB0aGlzLmRlYnVnTW9kZSk7XG5cbiAgICBhd2FpdCBhc3NpZ25IZWxwZXIucGVuZGluZztcblxuICAgIHRoaXMuX2Vuc3VyZU1pcG1hcEZvckNvbG9yVGV4dHVyZXMobWF0ZXJpYWxQYXJhbXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIFZSTS9nbFRGIFx1NzY4NCBzYW1wbGVyIFx1NEUwMFx1NjVFNlx1NThGMFx1NjYwRSBtaW5GaWx0ZXI9TElORUFSLCBHTFRGTG9hZGVyIFx1NUMzMVx1NEYxQVx1NjM2RVx1NkI2NFx1NTE3M1x1NjM4OSBtaXBtYXBcbiAgICogKGBHTFRGTG9hZGVyI2xvYWRUZXh0dXJlYDogZ2VuZXJhdGVNaXBtYXBzIFx1NzUzMSBzYW1wbGVyLm1pbkZpbHRlciBcdTYzQThcdTVCRkMsIFx1N0YzQVx1NzcwMVx1NjI0RFx1NjYyRlxuICAgKiBMaW5lYXJNaXBtYXBMaW5lYXJGaWx0ZXIpXHUzMDAyVlJvaWQgU3R1ZGlvIFx1NEU0Qlx1N0M3Qlx1NUJGQ1x1NTFGQVx1NTY2OFx1NEYxQVx1N0VERlx1NEUwMFx1NTE5OUxJTkVBUiwgXHU0RThFXHU2NjJGXHU2NTc0XHU2QTIxXHU1NzhCXHU3Njg0XG4gICAqIFx1OEQzNFx1NTZGRVx1NTE2OFx1OTBFOFx1NjVFMCBtaXBcdTMwMDJcbiAgICpcbiAgICogXHU1NDBFXHU2NzlDXHU2NjJGXHU4RDM0XHU1NkZFXHU5MUNDXHU1QjY0XHU3QUNCXHU3Njg0XHU5QUQ4XHU0RUFFXHU1MENGXHU3RDIwIChcdTRGOEJcdTU5ODJcdTRFOENcdTZCMjFcdTUxNDNcdTgxMzhcdTkwRThcdThEMzRcdTU2RkVcdTk4ODRcdTc1M0JcdTc2ODRcdTlGM0JcdTY4ODFcdTgzRjFcdTVGNjJcdTlBRDhcdTUxNDkpIFx1NTcyOFx1N0YyOVx1NUMwRlx1NjYzRVx1NzkzQVx1NjVGNlxuICAgKiBcdTkwMDBcdTUzMTZcdTYyMTBcdTRFOUFcdTUwQ0ZcdTdEMjAsIFx1OTY4Rlx1OTFDN1x1NjgzN1x1NzBCOVx1NEY0RFx1N0Y2RVx1OTAxMFx1NUUyN1x1OERGM1x1NTJBOCBcdTIwMTRcdTIwMTQgXHU4ODY4XHU3M0IwXHU0RTNBXHUzMDBDXHU3OUJCXHU1Rjk3XHU4RkRDXHU0RTAwXHU5NUVBXHU0RTAwXHU5NUVBXHUzMDAxXHU5NzYwXHU4RkQxXHU1QzMxXHU3QTMzXHUzMDBEXHUzMDAyXG4gICAqXG4gICAqIFx1OEZEOVx1OTFDQ1x1NTNFQVx1N0VEOVx1MzAwQ1x1OTg5Q1x1ODI3Mlx1N0M3Qlx1MzAwRFx1OEQzNFx1NTZGRVx1ODg2NVx1NTZERVx1NEUwOVx1N0VCRlx1NjAyNyBtaXA6XG4gICAqICAgLSBiYXNlQ29sb3IgLyBlbWlzc2l2ZSAvIHNoYWRlTXVsdGlwbHkgLyBzaGFkaW5nU2hpZnQgLyByaW1NdWx0aXBseSBcdTYyN0ZcdThGN0RcdTUzRUZcdTg5QzFcdTc2ODRcdTlBRDhcdTVCRjlcdTZCRDRcbiAgICogICAgIFx1N0VDNlx1ODI4MiwgXHU3RjI5XHU4RkRDXHU4RDcwXHU2ODM3XHU2NzAwXHU1MjNBXHU3NzNDO1xuICAgKiAgIC0gbm9ybWFsTWFwIFx1NTIzQlx1NjEwRlx1NEUwRFx1NUYwMDogbWlwbWFwIFx1NEYxQVx1NjI4QVx1NjcxRFx1NTQxMVx1NEUwRFx1NTQwQ1x1NzY4NFx1NkNENVx1N0VCRlx1NTNENlx1NUU3M1x1NTc0NywgXHU1Rjk3XHU1MjMwXHU3MjY5XHU3NDA2XHU0RTBBXHU0RTBEXHU1QjU4XHU1NzI4XHU3Njg0XHU0RTJEXHU5NUY0XG4gICAqICAgICBcdTU0MTFcdTkxQ0YsIFx1OEZEQ1x1NTkwNFx1NTE0OVx1NzE2N1x1OEZDN1x1NkUyMVx1NEYxQVx1NTg0Q1x1OTY3NzsgXHU4MDBDXHU2Q0Q1XHU3RUJGXHU2NzJDXHU4RUFCXHU5QUQ4XHU5ODkxXHUzMDAxXHU3RjI5XHU4RkRDXHU2NzJDXHU1QzMxXHU4QkU1XHU3Q0NBXHU2Mzg5LCBcdThENzBcdTY4MzdcdTVFNzZcdTRFMERcdTY2MEVcdTY2M0U7XG4gICAqICAgLSBtYXRjYXBUZXh0dXJlIFx1NEU1Rlx1NEUwRFx1NUYwMDogXHU1QjgzXHU2MzA5XHU4OUM2XHU3RUJGXHU2Q0Q1XHU3RUJGXHU5MUM3XHU2ODM3XHU3Njg0XHU3NDAzXHU5NzYyXHU3M0FGXHU1ODgzXHU1NkZFLCBcdTRFMERcdThENzAgVVYgXHU3RjI5XHU1QzBGXHU4REVGXHU1Rjg0XHUzMDAyXG4gICAqXG4gICAqIFx1NUZDNVx1OTg3Qlx1NTcyOCBhc3NpZ25IZWxwZXIucGVuZGluZyBcdTRFNEJcdTU0MEVcdThDMDNcdTc1MjggXHUyMDE0XHUyMDE0IFx1NkI2NFx1NjVGNiBiYXNlQ29sb3IgLyBlbWlzc2l2ZSAoR0xURkxvYWRlciBcdTY4MDdcdTUxQzZcbiAgICogXHU4REVGXHU1Rjg0KSBcdTRFMEUgTVRvb24gXHU2MjY5XHU1QzU1XHU0RTEzXHU1QzVFXHU4RDM0XHU1NkZFXHU2MjREXHU1MTY4XHU5MEU4XHU1QzMxXHU0RjREXHUzMDAyXG4gICAqL1xuICBwcml2YXRlIF9lbnN1cmVNaXBtYXBGb3JDb2xvclRleHR1cmVzKG1hdGVyaWFsUGFyYW1zOiBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycyk6IHZvaWQge1xuICAgIGNvbnN0IHAgPSBtYXRlcmlhbFBhcmFtcyBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIFRIUkVFLlRleHR1cmUgfCB1bmRlZmluZWQ+O1xuICAgIGNvbnN0IENPTE9SX1RFWFRVUkVfU0xPVFMgPSBbXG4gICAgICAnbWFwJywgLy8gYmFzZUNvbG9yVGV4dHVyZSAoR0xURkxvYWRlciBcdTY4MDdcdTUxQzZcdThERUZcdTVGODQpXG4gICAgICAnZW1pc3NpdmVNYXAnLCAvLyBlbWlzc2l2ZVRleHR1cmUgKEdMVEZMb2FkZXIgXHU2ODA3XHU1MUM2XHU4REVGXHU1Rjg0KVxuICAgICAgJ3NoYWRlTXVsdGlwbHlUZXh0dXJlJyxcbiAgICAgICdzaGFkaW5nU2hpZnRUZXh0dXJlJyxcbiAgICAgICdyaW1NdWx0aXBseVRleHR1cmUnLFxuICAgIF07XG5cbiAgICBmb3IgKGNvbnN0IHNsb3Qgb2YgQ09MT1JfVEVYVFVSRV9TTE9UUykge1xuICAgICAgY29uc3QgdGV4ID0gcFtzbG90XTtcbiAgICAgIGlmICh0ZXggJiYgdGV4LmlzVGV4dHVyZSAmJiB0ZXguZ2VuZXJhdGVNaXBtYXBzID09PSBmYWxzZSkge1xuICAgICAgICB0ZXguZ2VuZXJhdGVNaXBtYXBzID0gdHJ1ZTtcbiAgICAgICAgdGV4Lm1pbkZpbHRlciA9IFRIUkVFLkxpbmVhck1pcG1hcExpbmVhckZpbHRlcjtcbiAgICAgICAgdGV4Lm5lZWRzVXBkYXRlID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGhpcyB3aWxsIGRvIHR3byBwcm9jZXNzZXMgdGhhdCBpcyByZXF1aXJlZCB0byByZW5kZXIgTVRvb24gcHJvcGVybHkuXG4gICAqXG4gICAqIC0gU2V0IHJlbmRlciBvcmRlclxuICAgKiAtIEdlbmVyYXRlIG91dGxpbmVcbiAgICpcbiAgICogQHBhcmFtIG1lc2ggQSB0YXJnZXQgR0xURiBwcmltaXRpdmVcbiAgICogQHBhcmFtIG1hdGVyaWFsSW5kZXggVGhlIG1hdGVyaWFsIGluZGV4IG9mIHRoZSBwcmltaXRpdmVcbiAgICovXG4gIHByaXZhdGUgX3NldHVwUHJpbWl0aXZlKG1lc2g6IFRIUkVFLk1lc2gsIG1hdGVyaWFsSW5kZXg6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IGV4dGVuc2lvbiA9IHRoaXMuX2dldE1Ub29uRXh0ZW5zaW9uKG1hdGVyaWFsSW5kZXgpO1xuICAgIGlmIChleHRlbnNpb24pIHtcbiAgICAgIGNvbnN0IHJlbmRlck9yZGVyID0gdGhpcy5fcGFyc2VSZW5kZXJPcmRlcihleHRlbnNpb24pO1xuICAgICAgbWVzaC5yZW5kZXJPcmRlciA9IHJlbmRlck9yZGVyICsgdGhpcy5yZW5kZXJPcmRlck9mZnNldDtcblxuICAgICAgdGhpcy5fZ2VuZXJhdGVPdXRsaW5lKG1lc2gpO1xuXG4gICAgICB0aGlzLl9hZGRUb01hdGVyaWFsU2V0KG1lc2gpO1xuXG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIHdoZXRoZXIgdGhlIG1hdGVyaWFsIHNob3VsZCBnZW5lcmF0ZSBvdXRsaW5lIG9yIG5vdC5cbiAgICogQHBhcmFtIHN1cmZhY2VNYXRlcmlhbCBUaGUgbWF0ZXJpYWwgdG8gY2hlY2tcbiAgICogQHJldHVybnMgVHJ1ZSBpZiB0aGUgbWF0ZXJpYWwgc2hvdWxkIGdlbmVyYXRlIG91dGxpbmVcbiAgICovXG4gIHByaXZhdGUgX3Nob3VsZEdlbmVyYXRlT3V0bGluZShzdXJmYWNlTWF0ZXJpYWw6IFRIUkVFLk1hdGVyaWFsKTogYm9vbGVhbiB7XG4gICAgLy8gd2UgbWlnaHQgcmVjZWl2ZSBNVG9vbk5vZGVNYXRlcmlhbCBhcyB3ZWxsIGFzIE1Ub29uTWF0ZXJpYWxcbiAgICAvLyBzbyB3ZSdyZSBnb25uYSBkdWNrIHR5cGUgdG8gY2hlY2sgaWYgaXQncyBjb21wYXRpYmxlIHdpdGggTVRvb24gdHlwZSBvdXRsaW5lc1xuICAgIHJldHVybiAoXG4gICAgICB0eXBlb2YgKHN1cmZhY2VNYXRlcmlhbCBhcyBhbnkpLm91dGxpbmVXaWR0aE1vZGUgPT09ICdzdHJpbmcnICYmXG4gICAgICAoc3VyZmFjZU1hdGVyaWFsIGFzIGFueSkub3V0bGluZVdpZHRoTW9kZSAhPT0gJ25vbmUnICYmXG4gICAgICB0eXBlb2YgKHN1cmZhY2VNYXRlcmlhbCBhcyBhbnkpLm91dGxpbmVXaWR0aEZhY3RvciA9PT0gJ251bWJlcicgJiZcbiAgICAgIChzdXJmYWNlTWF0ZXJpYWwgYXMgYW55KS5vdXRsaW5lV2lkdGhGYWN0b3IgPiAwLjBcbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIEdlbmVyYXRlIG91dGxpbmUgZm9yIHRoZSBnaXZlbiBtZXNoLCBpZiBpdCBuZWVkcy5cbiAgICpcbiAgICogQHBhcmFtIG1lc2ggVGhlIHRhcmdldCBtZXNoXG4gICAqL1xuICBwcml2YXRlIF9nZW5lcmF0ZU91dGxpbmUobWVzaDogVEhSRUUuTWVzaCk6IHZvaWQge1xuICAgIC8vIE9LLCBpdCdzIHRoZSBoYWNreSBwYXJ0LlxuICAgIC8vIFdlIGFyZSBnb2luZyB0byBkdXBsaWNhdGUgdGhlIE1Ub29uTWF0ZXJpYWwgZm9yIG91dGxpbmUgdXNlLlxuICAgIC8vIFRoZW4gd2UgYXJlIGdvaW5nIHRvIGNyZWF0ZSB0d28gZ2VvbWV0cnkgZ3JvdXBzIGFuZCByZWZlciBzYW1lIGJ1ZmZlciBidXQgZGlmZmVyZW50IG1hdGVyaWFsLlxuICAgIC8vIEl0J3MgaG93IHdlIGRyYXcgdHdvIG1hdGVyaWFscyBhdCBvbmNlIHVzaW5nIGEgc2luZ2xlIG1lc2guXG5cbiAgICAvLyBtYWtlIHN1cmUgdGhlIG1hdGVyaWFsIGlzIHNpbmdsZVxuICAgIGNvbnN0IHN1cmZhY2VNYXRlcmlhbCA9IG1lc2gubWF0ZXJpYWw7XG4gICAgaWYgKCEoc3VyZmFjZU1hdGVyaWFsIGluc3RhbmNlb2YgVEhSRUUuTWF0ZXJpYWwpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLl9zaG91bGRHZW5lcmF0ZU91dGxpbmUoc3VyZmFjZU1hdGVyaWFsKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIG1ha2UgaXRzIG1hdGVyaWFsIGFuIGFycmF5XG4gICAgbWVzaC5tYXRlcmlhbCA9IFtzdXJmYWNlTWF0ZXJpYWxdOyAvLyBtZXNoLm1hdGVyaWFsIGlzIGd1YXJhbnRlZWQgdG8gYmUgYSBNYXRlcmlhbCBpbiBHTFRGTG9hZGVyXG5cbiAgICAvLyBkdXBsaWNhdGUgdGhlIG1hdGVyaWFsIGZvciBvdXRsaW5lIHVzZVxuICAgIGNvbnN0IG91dGxpbmVNYXRlcmlhbCA9IHN1cmZhY2VNYXRlcmlhbC5jbG9uZSgpO1xuICAgIG91dGxpbmVNYXRlcmlhbC5uYW1lICs9ICcgKE91dGxpbmUpJztcbiAgICAob3V0bGluZU1hdGVyaWFsIGFzIGFueSkuaXNPdXRsaW5lID0gdHJ1ZTtcbiAgICBvdXRsaW5lTWF0ZXJpYWwuc2lkZSA9IFRIUkVFLkJhY2tTaWRlO1xuICAgIG1lc2gubWF0ZXJpYWwucHVzaChvdXRsaW5lTWF0ZXJpYWwpO1xuXG4gICAgLy8gbWFrZSB0d28gZ2VvbWV0cnkgZ3JvdXBzIG91dCBvZiBhIHNhbWUgYnVmZmVyXG4gICAgY29uc3QgZ2VvbWV0cnkgPSBtZXNoLmdlb21ldHJ5OyAvLyBtZXNoLmdlb21ldHJ5IGlzIGd1YXJhbnRlZWQgdG8gYmUgYSBCdWZmZXJHZW9tZXRyeSBpbiBHTFRGTG9hZGVyXG4gICAgY29uc3QgcHJpbWl0aXZlVmVydGljZXMgPSBnZW9tZXRyeS5pbmRleCA/IGdlb21ldHJ5LmluZGV4LmNvdW50IDogZ2VvbWV0cnkuYXR0cmlidXRlcy5wb3NpdGlvbi5jb3VudCAvIDM7XG4gICAgZ2VvbWV0cnkuYWRkR3JvdXAoMCwgcHJpbWl0aXZlVmVydGljZXMsIDApO1xuICAgIGdlb21ldHJ5LmFkZEdyb3VwKDAsIHByaW1pdGl2ZVZlcnRpY2VzLCAxKTtcbiAgfVxuXG4gIHByaXZhdGUgX2FkZFRvTWF0ZXJpYWxTZXQobWVzaDogVEhSRUUuTWVzaCk6IHZvaWQge1xuICAgIGNvbnN0IG1hdGVyaWFsT3JNYXRlcmlhbHMgPSBtZXNoLm1hdGVyaWFsO1xuICAgIGNvbnN0IG1hdGVyaWFsU2V0ID0gbmV3IFNldDxUSFJFRS5NYXRlcmlhbD4oKTtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KG1hdGVyaWFsT3JNYXRlcmlhbHMpKSB7XG4gICAgICBtYXRlcmlhbE9yTWF0ZXJpYWxzLmZvckVhY2goKG1hdGVyaWFsKSA9PiBtYXRlcmlhbFNldC5hZGQobWF0ZXJpYWwpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbWF0ZXJpYWxTZXQuYWRkKG1hdGVyaWFsT3JNYXRlcmlhbHMpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgbWF0ZXJpYWwgb2YgbWF0ZXJpYWxTZXQpIHtcbiAgICAgIHRoaXMuX21Ub29uTWF0ZXJpYWxTZXQuYWRkKG1hdGVyaWFsKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9wYXJzZVJlbmRlck9yZGVyKGV4dGVuc2lvbjogVjFNVG9vblNjaGVtYS5WUk1DTWF0ZXJpYWxzTVRvb24pOiBudW1iZXIge1xuICAgIC8vIHRyYW5zcGFyZW50V2l0aFpXcml0ZSByYW5nZXMgZnJvbSAwIHRvICs5XG4gICAgLy8gbWVyZSB0cmFuc3BhcmVudCByYW5nZXMgZnJvbSAtOSB0byAwXG4gICAgY29uc3QgZW5hYmxlZFpXcml0ZSA9IGV4dGVuc2lvbi50cmFuc3BhcmVudFdpdGhaV3JpdGU7XG4gICAgcmV0dXJuIChlbmFibGVkWldyaXRlID8gMCA6IDE5KSArIChleHRlbnNpb24ucmVuZGVyUXVldWVPZmZzZXROdW1iZXIgPz8gMCk7XG4gIH1cbn1cbiIsICJpbXBvcnQgKiBhcyBUSFJFRSBmcm9tICd0aHJlZSc7XG5pbXBvcnQgeyBHTFRGUGFyc2VyIH0gZnJvbSAndGhyZWUvZXhhbXBsZXMvanNtL2xvYWRlcnMvR0xURkxvYWRlci5qcyc7XG5pbXBvcnQgeyBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycyB9IGZyb20gJy4vTVRvb25NYXRlcmlhbFBhcmFtZXRlcnMnO1xuaW1wb3J0IHsgc2V0VGV4dHVyZUNvbG9yU3BhY2UgfSBmcm9tICcuL3V0aWxzL3NldFRleHR1cmVDb2xvclNwYWNlJztcblxuLyoqXG4gKiBNYXRlcmlhbFBhcmFtZXRlcnMgaGF0ZXMgYHVuZGVmaW5lZGAuIFRoaXMgaGVscGVyIGF1dG9tYXRpY2FsbHkgcmVqZWN0cyBhc3NpZ24gb2YgdGhlc2UgYHVuZGVmaW5lZGAuXG4gKiBJdCBhbHNvIGhhbmRsZXMgYXN5bmNocm9ub3VzIHByb2Nlc3Mgb2YgdGV4dHVyZXMuXG4gKiBNYWtlIHN1cmUgYXdhaXQgZm9yIHtAbGluayBHTFRGTVRvb25NYXRlcmlhbFBhcmFtc0Fzc2lnbkhlbHBlci5wZW5kaW5nfS5cbiAqL1xuZXhwb3J0IGNsYXNzIEdMVEZNVG9vbk1hdGVyaWFsUGFyYW1zQXNzaWduSGVscGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBfcGFyc2VyOiBHTFRGUGFyc2VyO1xuICBwcml2YXRlIF9tYXRlcmlhbFBhcmFtczogTVRvb25NYXRlcmlhbFBhcmFtZXRlcnM7XG4gIHByaXZhdGUgX3BlbmRpbmdzOiBQcm9taXNlPGFueT5bXTtcblxuICBwdWJsaWMgZ2V0IHBlbmRpbmcoKTogUHJvbWlzZTx1bmtub3duPiB7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKHRoaXMuX3BlbmRpbmdzKTtcbiAgfVxuXG4gIHB1YmxpYyBjb25zdHJ1Y3RvcihwYXJzZXI6IEdMVEZQYXJzZXIsIG1hdGVyaWFsUGFyYW1zOiBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycykge1xuICAgIHRoaXMuX3BhcnNlciA9IHBhcnNlcjtcbiAgICB0aGlzLl9tYXRlcmlhbFBhcmFtcyA9IG1hdGVyaWFsUGFyYW1zO1xuICAgIHRoaXMuX3BlbmRpbmdzID0gW107XG4gIH1cblxuICBwdWJsaWMgYXNzaWduUHJpbWl0aXZlPFQgZXh0ZW5kcyBrZXlvZiBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycz4oa2V5OiBULCB2YWx1ZTogTVRvb25NYXRlcmlhbFBhcmFtZXRlcnNbVF0pOiB2b2lkIHtcbiAgICBpZiAodmFsdWUgIT0gbnVsbCkge1xuICAgICAgdGhpcy5fbWF0ZXJpYWxQYXJhbXNba2V5XSA9IHZhbHVlO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3NpZ25Db2xvcjxUIGV4dGVuZHMga2V5b2YgTVRvb25NYXRlcmlhbFBhcmFtZXRlcnM+KFxuICAgIGtleTogVCxcbiAgICB2YWx1ZTogbnVtYmVyW10gfCB1bmRlZmluZWQsXG4gICAgY29udmVydFNSR0JUb0xpbmVhcj86IGJvb2xlYW4sXG4gICk6IHZvaWQge1xuICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICBjb25zdCBjb2xvciA9IG5ldyBUSFJFRS5Db2xvcigpLmZyb21BcnJheSh2YWx1ZSk7XG5cbiAgICAgIGlmIChjb252ZXJ0U1JHQlRvTGluZWFyKSB7XG4gICAgICAgIGNvbG9yLmNvbnZlcnRTUkdCVG9MaW5lYXIoKTtcbiAgICAgIH1cbiAgICAgICh0aGlzLl9tYXRlcmlhbFBhcmFtcyBhcyBhbnkpW2tleV0gPSBjb2xvcjtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgYXNzaWduVGV4dHVyZTxUIGV4dGVuZHMga2V5b2YgTVRvb25NYXRlcmlhbFBhcmFtZXRlcnM+KFxuICAgIGtleTogVCxcbiAgICBzY2hlbWFUZXh0dXJlOiB7IGluZGV4OiBudW1iZXIgfSB8IHVuZGVmaW5lZCxcbiAgICBpc0NvbG9yVGV4dHVyZTogYm9vbGVhbixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoc2NoZW1hVGV4dHVyZSAhPSBudWxsKSB7XG4gICAgICAgIGNvbnN0IHRleHR1cmUgPSBhd2FpdCB0aGlzLl9wYXJzZXIuYXNzaWduVGV4dHVyZSh0aGlzLl9tYXRlcmlhbFBhcmFtcywga2V5LCBzY2hlbWFUZXh0dXJlKTtcblxuICAgICAgICAvLyBlYXJseSBhYm9ydCBpZiB0ZXh0dXJlIGZhaWxlZCB0byBsb2FkXG4gICAgICAgIGlmICh0ZXh0dXJlID09IG51bGwpIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICAnR0xURk1Ub29uTWF0ZXJpYWxQYXJhbXNBc3NpZ25IZWxwZXI6IEZhaWxlZCB0byBsb2FkIHRleHR1cmUuIFRoZSByZW5kZXJpbmcgcmVzdWx0IG1heSBiZSB3cm9uZycsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNDb2xvclRleHR1cmUpIHtcbiAgICAgICAgICBzZXRUZXh0dXJlQ29sb3JTcGFjZSh0ZXh0dXJlLCAnc3JnYicpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSkoKTtcblxuICAgIHRoaXMuX3BlbmRpbmdzLnB1c2gocHJvbWlzZSk7XG5cbiAgICByZXR1cm4gcHJvbWlzZTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBhc3NpZ25UZXh0dXJlQnlJbmRleDxUIGV4dGVuZHMga2V5b2YgTVRvb25NYXRlcmlhbFBhcmFtZXRlcnM+KFxuICAgIGtleTogVCxcbiAgICB0ZXh0dXJlSW5kZXg6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgICBpc0NvbG9yVGV4dHVyZTogYm9vbGVhbixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHRoaXMuYXNzaWduVGV4dHVyZShrZXksIHRleHR1cmVJbmRleCAhPSBudWxsID8geyBpbmRleDogdGV4dHVyZUluZGV4IH0gOiB1bmRlZmluZWQsIGlzQ29sb3JUZXh0dXJlKTtcbiAgfVxufVxuIiwgImltcG9ydCAqIGFzIFRIUkVFIGZyb20gJ3RocmVlJztcblxuY29uc3QgY29sb3JTcGFjZUVuY29kaW5nTWFwOiBSZWNvcmQ8JycgfCAnc3JnYicsIGFueT4gPSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbmFtaW5nLWNvbnZlbnRpb25cbiAgJyc6IDMwMDAsXG4gIHNyZ2I6IDMwMDEsXG59O1xuXG4vKipcbiAqIEEgY29tcGF0IGZ1bmN0aW9uIHRvIHNldCB0ZXh0dXJlIGNvbG9yIHNwYWNlLlxuICpcbiAqIENPTVBBVDogcHJlLXIxNTJcbiAqIFN0YXJ0aW5nIGZyb20gVGhyZWUuanMgcjE1MiwgYHRleHR1cmUuZW5jb2RpbmdgIGlzIHJlbmFtZWQgdG8gYHRleHR1cmUuY29sb3JTcGFjZWAuXG4gKiBUaGlzIGZ1bmN0aW9uIHdpbGwgaGFuZGxlIHRoZSBjb21hcHQuXG4gKlxuICogQHBhcmFtIHRleHR1cmUgVGhlIHRleHR1cmUgeW91IHdhbnQgdG8gc2V0IHRoZSBjb2xvciBzcGFjZSB0b1xuICogQHBhcmFtIGNvbG9yU3BhY2UgVGhlIGNvbG9yIHNwYWNlIHlvdSB3YW50IHRvIHNldCB0byB0aGUgdGV4dHVyZVxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0VGV4dHVyZUNvbG9yU3BhY2UodGV4dHVyZTogVEhSRUUuVGV4dHVyZSwgY29sb3JTcGFjZTogJycgfCAnc3JnYicpOiB2b2lkIHtcbiAgaWYgKHBhcnNlSW50KFRIUkVFLlJFVklTSU9OLCAxMCkgPj0gMTUyKSB7XG4gICAgdGV4dHVyZS5jb2xvclNwYWNlID0gY29sb3JTcGFjZTtcbiAgfSBlbHNlIHtcbiAgICAodGV4dHVyZSBhcyBhbnkpLmVuY29kaW5nID0gY29sb3JTcGFjZUVuY29kaW5nTWFwW2NvbG9yU3BhY2VdO1xuICB9XG59XG4iLCAiLyogdHNsaW50OmRpc2FibGU6bWVtYmVyLW9yZGVyaW5nICovXG5cbmltcG9ydCAqIGFzIFRIUkVFIGZyb20gJ3RocmVlJztcbmltcG9ydCB2ZXJ0ZXhTaGFkZXIgZnJvbSAnLi9zaGFkZXJzL210b29uLnZlcnQnO1xuaW1wb3J0IGZyYWdtZW50U2hhZGVyIGZyb20gJy4vc2hhZGVycy9tdG9vbi5mcmFnJztcbmltcG9ydCB7IE1Ub29uTWF0ZXJpYWxEZWJ1Z01vZGUgfSBmcm9tICcuL01Ub29uTWF0ZXJpYWxEZWJ1Z01vZGUnO1xuaW1wb3J0IHsgTVRvb25NYXRlcmlhbE91dGxpbmVXaWR0aE1vZGUgfSBmcm9tICcuL01Ub29uTWF0ZXJpYWxPdXRsaW5lV2lkdGhNb2RlJztcbmltcG9ydCB0eXBlIHsgTVRvb25NYXRlcmlhbFBhcmFtZXRlcnMgfSBmcm9tICcuL01Ub29uTWF0ZXJpYWxQYXJhbWV0ZXJzJztcbmltcG9ydCB7IGdldFRleHR1cmVDb2xvclNwYWNlIH0gZnJvbSAnLi91dGlscy9nZXRUZXh0dXJlQ29sb3JTcGFjZSc7XG5cbi8qKlxuICogTVRvb24gaXMgYSBtYXRlcmlhbCBzcGVjaWZpY2F0aW9uIHRoYXQgaGFzIHZhcmlvdXMgZmVhdHVyZXMuXG4gKiBUaGUgc3BlYyBhbmQgaW1wbGVtZW50YXRpb24gYXJlIG9yaWdpbmFsbHkgZm91bmRlZCBmb3IgVW5pdHkgZW5naW5lIGFuZCB0aGlzIGlzIGEgcG9ydCBvZiB0aGUgbWF0ZXJpYWwuXG4gKlxuICogU2VlOiBodHRwczovL2dpdGh1Yi5jb20vU2FudGFyaC9NVG9vblxuICovXG5leHBvcnQgY2xhc3MgTVRvb25NYXRlcmlhbCBleHRlbmRzIFRIUkVFLlNoYWRlck1hdGVyaWFsIHtcbiAgcHVibGljIHVuaWZvcm1zOiB7XG4gICAgbGl0RmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5Db2xvcj47XG4gICAgYWxwaGFUZXN0OiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIG9wYWNpdHk6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgbWFwOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5UZXh0dXJlIHwgbnVsbD47XG4gICAgbWFwVXZUcmFuc2Zvcm06IFRIUkVFLklVbmlmb3JtPFRIUkVFLk1hdHJpeDM+O1xuICAgIG5vcm1hbE1hcDogVEhSRUUuSVVuaWZvcm08VEhSRUUuVGV4dHVyZSB8IG51bGw+O1xuICAgIG5vcm1hbE1hcFV2VHJhbnNmb3JtOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5NYXRyaXgzPjtcbiAgICBub3JtYWxTY2FsZTogVEhSRUUuSVVuaWZvcm08VEhSRUUuVmVjdG9yMj47XG4gICAgZW1pc3NpdmU6IFRIUkVFLklVbmlmb3JtPFRIUkVFLkNvbG9yPjtcbiAgICBlbWlzc2l2ZUludGVuc2l0eTogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBlbWlzc2l2ZU1hcDogVEhSRUUuSVVuaWZvcm08VEhSRUUuVGV4dHVyZSB8IG51bGw+O1xuICAgIGVtaXNzaXZlTWFwVXZUcmFuc2Zvcm06IFRIUkVFLklVbmlmb3JtPFRIUkVFLk1hdHJpeDM+O1xuICAgIHNoYWRlQ29sb3JGYWN0b3I6IFRIUkVFLklVbmlmb3JtPFRIUkVFLkNvbG9yPjtcbiAgICBzaGFkZU11bHRpcGx5VGV4dHVyZTogVEhSRUUuSVVuaWZvcm08VEhSRUUuVGV4dHVyZSB8IG51bGw+O1xuICAgIHNoYWRlTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm06IFRIUkVFLklVbmlmb3JtPFRIUkVFLk1hdHJpeDM+O1xuICAgIHNoYWRpbmdTaGlmdEZhY3RvcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzaGFkaW5nU2hpZnRUZXh0dXJlOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5UZXh0dXJlIHwgbnVsbD47XG4gICAgc2hhZGluZ1NoaWZ0VGV4dHVyZVV2VHJhbnNmb3JtOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5NYXRyaXgzPjtcbiAgICBzaGFkaW5nU2hpZnRUZXh0dXJlU2NhbGU6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2hhZGluZ1Rvb255RmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGdpRXF1YWxpemF0aW9uRmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIG1hdGNhcEZhY3RvcjogVEhSRUUuSVVuaWZvcm08VEhSRUUuQ29sb3I+O1xuICAgIG1hdGNhcFRleHR1cmU6IFRIUkVFLklVbmlmb3JtPFRIUkVFLlRleHR1cmUgfCBudWxsPjtcbiAgICBtYXRjYXBUZXh0dXJlVXZUcmFuc2Zvcm06IFRIUkVFLklVbmlmb3JtPFRIUkVFLk1hdHJpeDM+O1xuICAgIHBhcmFtZXRyaWNSaW1Db2xvckZhY3RvcjogVEhSRUUuSVVuaWZvcm08VEhSRUUuQ29sb3I+O1xuICAgIHJpbU11bHRpcGx5VGV4dHVyZTogVEhSRUUuSVVuaWZvcm08VEhSRUUuVGV4dHVyZSB8IG51bGw+O1xuICAgIHJpbU11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5NYXRyaXgzPjtcbiAgICByaW1MaWdodGluZ01peEZhY3RvcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBwYXJhbWV0cmljUmltRnJlc25lbFBvd2VyRmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHBhcmFtZXRyaWNSaW1MaWZ0RmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIG91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZTogVEhSRUUuSVVuaWZvcm08VEhSRUUuVGV4dHVyZSB8IG51bGw+O1xuICAgIG91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5NYXRyaXgzPjtcbiAgICBvdXRsaW5lV2lkdGhGYWN0b3I6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgb3V0bGluZUNvbG9yRmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5Db2xvcj47XG4gICAgb3V0bGluZUxpZ2h0aW5nTWl4RmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHV2QW5pbWF0aW9uTWFza1RleHR1cmU6IFRIUkVFLklVbmlmb3JtPFRIUkVFLlRleHR1cmUgfCBudWxsPjtcbiAgICB1dkFuaW1hdGlvbk1hc2tUZXh0dXJlVXZUcmFuc2Zvcm06IFRIUkVFLklVbmlmb3JtPFRIUkVFLk1hdHJpeDM+O1xuICAgIHV2QW5pbWF0aW9uU2Nyb2xsWE9mZnNldDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICB1dkFuaW1hdGlvblNjcm9sbFlPZmZzZXQ6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgdXZBbmltYXRpb25Sb3RhdGlvblBoYXNlOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIC8vIEV4dGVuZGVkIHR1bmluZyBwYXJhbWV0ZXJzXG4gICAgc29mdE1peDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBibHVyQm9vc3Q6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2hhZG93Mm5kU3RyZW5ndGg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2hhZG93Mm5kQm9yZGVyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNoYWRvdzJuZEJsdXI6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2hhZG93Mm5kQ29sb3I6IFRIUkVFLklVbmlmb3JtPFRIUkVFLkNvbG9yPjtcbiAgICBzaGFkb3czcmRTdHJlbmd0aDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzaGFkb3czcmRCb3JkZXI6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2hhZG93M3JkQmx1cjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzaGFkb3czcmRDb2xvcjogVEhSRUUuSVVuaWZvcm08VEhSRUUuQ29sb3I+O1xuICAgIHJpbUJvb3N0OiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHJpbUJvcmRlcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICByaW1CbHVyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHJpbURpclN0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGhhaXJTcGVjU3RyZW5ndGg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgaGFpclNwZWNQb3dlcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBoYWlyU3BlY1NoaWZ0OiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGNsb3RoU3BlY1N0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGNsb3RoU3BlY1Bvd2VyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIG1hdGNhcDJuZFN0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNraW5TcGVjU3RyZW5ndGg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2tpblNwZWNQb3dlcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBza2luU3BlY0ZyZXNuZWw6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2tpblNwZWNDb2xvcjogVEhSRUUuSVVuaWZvcm08VEhSRUUuQ29sb3I+O1xuICAgIGFtYmllbnRMaWZ0OiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNoYWRlTWFpblN0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNoYWRvd0JvcmRlcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzaGFkb3dCbHVyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHJpbU1haW5TdHJlbmd0aDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICByaW1TaGFkb3dNYXNrOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNwZWN1bGFyU3RyZW5ndGg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc3BlY3VsYXJQb3dlcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzcGVjdWxhckJvcmRlcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzcGVjdWxhckJsdXI6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgcmVmbGVjdFN0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHJlZmxlY3RGcmVzbmVsOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHJlZmxlY3RNZXRhbGxpYzogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICByZWZsZWN0U21vb3RobmVzczogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBiYWNrbGlnaHRTdHJlbmd0aDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBiYWNrbGlnaHRDb2xvcjogVEhSRUUuSVVuaWZvcm08VEhSRUUuQ29sb3I+O1xuICAgIHJpbUZyZXNuZWxQb3dlcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICByaW1JbmRpclN0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIG1hdGNhcDJuZENvbnRyYXN0OiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIG1hdGNhcDJuZFNjYWxlOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGVtaXNzaW9uQm9vc3Q6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgZGlzdGFuY2VGYWRlOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGZhY2VTb2Z0OiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIG5vcm1hbFNraW5Cb29zdDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBlbnZTdHJlbmd0aDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBnZW1GcmVzbmVsOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIG91dGxpbmVNaXg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgcmVjZWl2ZVNoYWRvd1JhdGU6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgZmFicmljU2hlZW5TdHJlbmd0aDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBmYWJyaWNTaGVlblBvd2VyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGZhYnJpY1NoZWVuQ29sb3I6IFRIUkVFLklVbmlmb3JtPFRIUkVFLkNvbG9yPjtcbiAgfTtcblxuICBwdWJsaWMgZ2V0IGNvbG9yKCk6IFRIUkVFLkNvbG9yIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5saXRGYWN0b3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBjb2xvcih2YWx1ZTogVEhSRUUuQ29sb3IpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmxpdEZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBtYXAoKTogVEhSRUUuVGV4dHVyZSB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm1hcC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG1hcCh2YWx1ZTogVEhSRUUuVGV4dHVyZSB8IG51bGwpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm1hcC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBub3JtYWxNYXAoKTogVEhSRUUuVGV4dHVyZSB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm5vcm1hbE1hcC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG5vcm1hbE1hcCh2YWx1ZTogVEhSRUUuVGV4dHVyZSB8IG51bGwpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm5vcm1hbE1hcC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBub3JtYWxTY2FsZSgpOiBUSFJFRS5WZWN0b3IyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5ub3JtYWxTY2FsZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG5vcm1hbFNjYWxlKHZhbHVlOiBUSFJFRS5WZWN0b3IyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5ub3JtYWxTY2FsZS52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBlbWlzc2l2ZSgpOiBUSFJFRS5Db2xvciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuZW1pc3NpdmUudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBlbWlzc2l2ZSh2YWx1ZTogVEhSRUUuQ29sb3IpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmVtaXNzaXZlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGVtaXNzaXZlSW50ZW5zaXR5KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuZW1pc3NpdmVJbnRlbnNpdHkudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBlbWlzc2l2ZUludGVuc2l0eSh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5lbWlzc2l2ZUludGVuc2l0eS52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBlbWlzc2l2ZU1hcCgpOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuZW1pc3NpdmVNYXAudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBlbWlzc2l2ZU1hcCh2YWx1ZTogVEhSRUUuVGV4dHVyZSB8IG51bGwpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmVtaXNzaXZlTWFwLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRlQ29sb3JGYWN0b3IoKTogVEhSRUUuQ29sb3Ige1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNoYWRlQ29sb3JGYWN0b3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkZUNvbG9yRmFjdG9yKHZhbHVlOiBUSFJFRS5Db2xvcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2hhZGVDb2xvckZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkZU11bHRpcGx5VGV4dHVyZSgpOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZGVNdWx0aXBseVRleHR1cmUudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkZU11bHRpcGx5VGV4dHVyZSh2YWx1ZTogVEhSRUUuVGV4dHVyZSB8IG51bGwpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRlTXVsdGlwbHlUZXh0dXJlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRpbmdTaGlmdEZhY3RvcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNoYWRpbmdTaGlmdEZhY3Rvci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRpbmdTaGlmdEZhY3Rvcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkaW5nU2hpZnRGYWN0b3IudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZGluZ1NoaWZ0VGV4dHVyZSgpOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZGluZ1NoaWZ0VGV4dHVyZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRpbmdTaGlmdFRleHR1cmUodmFsdWU6IFRIUkVFLlRleHR1cmUgfCBudWxsKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkaW5nU2hpZnRUZXh0dXJlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRpbmdTaGlmdFRleHR1cmVTY2FsZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNoYWRpbmdTaGlmdFRleHR1cmVTY2FsZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRpbmdTaGlmdFRleHR1cmVTY2FsZSh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkaW5nU2hpZnRUZXh0dXJlU2NhbGUudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZGluZ1Rvb255RmFjdG9yKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZGluZ1Rvb255RmFjdG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZGluZ1Rvb255RmFjdG9yKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRpbmdUb29ueUZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBnaUVxdWFsaXphdGlvbkZhY3RvcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmdpRXF1YWxpemF0aW9uRmFjdG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgZ2lFcXVhbGl6YXRpb25GYWN0b3IodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuZ2lFcXVhbGl6YXRpb25GYWN0b3IudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgbWF0Y2FwRmFjdG9yKCk6IFRIUkVFLkNvbG9yIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5tYXRjYXBGYWN0b3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBtYXRjYXBGYWN0b3IodmFsdWU6IFRIUkVFLkNvbG9yKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5tYXRjYXBGYWN0b3IudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgbWF0Y2FwVGV4dHVyZSgpOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMubWF0Y2FwVGV4dHVyZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG1hdGNhcFRleHR1cmUodmFsdWU6IFRIUkVFLlRleHR1cmUgfCBudWxsKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5tYXRjYXBUZXh0dXJlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHBhcmFtZXRyaWNSaW1Db2xvckZhY3RvcigpOiBUSFJFRS5Db2xvciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucGFyYW1ldHJpY1JpbUNvbG9yRmFjdG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcGFyYW1ldHJpY1JpbUNvbG9yRmFjdG9yKHZhbHVlOiBUSFJFRS5Db2xvcikge1xuICAgIHRoaXMudW5pZm9ybXMucGFyYW1ldHJpY1JpbUNvbG9yRmFjdG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHJpbU11bHRpcGx5VGV4dHVyZSgpOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmltTXVsdGlwbHlUZXh0dXJlLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmltTXVsdGlwbHlUZXh0dXJlKHZhbHVlOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCkge1xuICAgIHRoaXMudW5pZm9ybXMucmltTXVsdGlwbHlUZXh0dXJlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHJpbUxpZ2h0aW5nTWl4RmFjdG9yKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmltTGlnaHRpbmdNaXhGYWN0b3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCByaW1MaWdodGluZ01peEZhY3Rvcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yaW1MaWdodGluZ01peEZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBwYXJhbWV0cmljUmltRnJlc25lbFBvd2VyRmFjdG9yKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucGFyYW1ldHJpY1JpbUZyZXNuZWxQb3dlckZhY3Rvci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHBhcmFtZXRyaWNSaW1GcmVzbmVsUG93ZXJGYWN0b3IodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMucGFyYW1ldHJpY1JpbUZyZXNuZWxQb3dlckZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBwYXJhbWV0cmljUmltTGlmdEZhY3RvcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnBhcmFtZXRyaWNSaW1MaWZ0RmFjdG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcGFyYW1ldHJpY1JpbUxpZnRGYWN0b3IodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMucGFyYW1ldHJpY1JpbUxpZnRGYWN0b3IudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiAwLi4xIGJsZW5kIHRvd2FyZCBoYWxmLUxhbWJlcnQgc29mdCB0b29uIChsaWxUb29uLWxpa2UpLiBEZWZhdWx0IDAuOTUgKi9cbiAgcHVibGljIGdldCBzb2Z0TWl4KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc29mdE1peC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNvZnRNaXgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc29mdE1peC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIEV4dHJhIGJsdXIgd2lkdGggYWRkZWQgdG8gKDEgLSBzaGFkaW5nVG9vbnkpIG9uIHRoZSBzb2Z0IHBhdGguIERlZmF1bHQgMC4zMiAqL1xuICBwdWJsaWMgZ2V0IGJsdXJCb29zdCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmJsdXJCb29zdC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGJsdXJCb29zdCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5ibHVyQm9vc3QudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZG93Mm5kU3RyZW5ndGgoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zaGFkb3cybmRTdHJlbmd0aC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRvdzJuZFN0cmVuZ3RoKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRvdzJuZFN0cmVuZ3RoLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRvdzJuZEJvcmRlcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNoYWRvdzJuZEJvcmRlci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRvdzJuZEJvcmRlcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkb3cybmRCb3JkZXIudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZG93Mm5kQmx1cigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNoYWRvdzJuZEJsdXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkb3cybmRCbHVyKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRvdzJuZEJsdXIudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZG93Mm5kQ29sb3IoKTogVEhSRUUuQ29sb3Ige1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNoYWRvdzJuZENvbG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZG93Mm5kQ29sb3IodmFsdWU6IFRIUkVFLkNvbG9yKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkb3cybmRDb2xvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkb3czcmRTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNoYWRvdzNyZFN0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZG93M3JkU3RyZW5ndGgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2hhZG93M3JkU3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZG93M3JkQm9yZGVyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZG93M3JkQm9yZGVyLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZG93M3JkQm9yZGVyKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRvdzNyZEJvcmRlci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkb3czcmRCbHVyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZG93M3JkQmx1ci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRvdzNyZEJsdXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2hhZG93M3JkQmx1ci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkb3czcmRDb2xvcigpOiBUSFJFRS5Db2xvciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZG93M3JkQ29sb3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkb3czcmRDb2xvcih2YWx1ZTogVEhSRUUuQ29sb3IpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRvdzNyZENvbG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogTXVsdGlwbGllciBvbiB0b29uZWQgcmltLiBEZWZhdWx0IDEuNDsgZXllcyBjYXJlZnVsIHZpYSBWUk1NYXRlcmlhbE1hbmFnZXIgKi9cbiAgcHVibGljIGdldCByaW1Cb29zdCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnJpbUJvb3N0LnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmltQm9vc3QodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMucmltQm9vc3QudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgcmltQm9yZGVyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmltQm9yZGVyLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmltQm9yZGVyKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJpbUJvcmRlci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCByaW1CbHVyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmltQmx1ci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHJpbUJsdXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMucmltQmx1ci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCByaW1EaXJTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnJpbURpclN0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmltRGlyU3RyZW5ndGgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMucmltRGlyU3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgaGFpclNwZWNTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmhhaXJTcGVjU3RyZW5ndGgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBoYWlyU3BlY1N0cmVuZ3RoKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmhhaXJTcGVjU3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgaGFpclNwZWNQb3dlcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmhhaXJTcGVjUG93ZXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBoYWlyU3BlY1Bvd2VyKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmhhaXJTcGVjUG93ZXIudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgaGFpclNwZWNTaGlmdCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmhhaXJTcGVjU2hpZnQudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBoYWlyU3BlY1NoaWZ0KHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmhhaXJTcGVjU2hpZnQudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgY2xvdGhTcGVjU3RyZW5ndGgoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5jbG90aFNwZWNTdHJlbmd0aC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGNsb3RoU3BlY1N0cmVuZ3RoKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmNsb3RoU3BlY1N0cmVuZ3RoLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGNsb3RoU3BlY1Bvd2VyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuY2xvdGhTcGVjUG93ZXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBjbG90aFNwZWNQb3dlcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5jbG90aFNwZWNQb3dlci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBtYXRjYXAybmRTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm1hdGNhcDJuZFN0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgbWF0Y2FwMm5kU3RyZW5ndGgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMubWF0Y2FwMm5kU3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2tpblNwZWNTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNraW5TcGVjU3RyZW5ndGgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBza2luU3BlY1N0cmVuZ3RoKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNraW5TcGVjU3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2tpblNwZWNQb3dlcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNraW5TcGVjUG93ZXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBza2luU3BlY1Bvd2VyKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNraW5TcGVjUG93ZXIudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2tpblNwZWNGcmVzbmVsKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2tpblNwZWNGcmVzbmVsLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2tpblNwZWNGcmVzbmVsKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNraW5TcGVjRnJlc25lbC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBza2luU3BlY0NvbG9yKCk6IFRIUkVFLkNvbG9yIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5za2luU3BlY0NvbG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2tpblNwZWNDb2xvcih2YWx1ZTogVEhSRUUuQ29sb3IpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNraW5TcGVjQ29sb3IudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgYW1iaWVudExpZnQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5hbWJpZW50TGlmdC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGFtYmllbnRMaWZ0KHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmFtYmllbnRMaWZ0LnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRlTWFpblN0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZGVNYWluU3RyZW5ndGgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkZU1haW5TdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkZU1haW5TdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkb3dCb3JkZXIoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zaGFkb3dCb3JkZXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkb3dCb3JkZXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2hhZG93Qm9yZGVyLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRvd0JsdXIoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zaGFkb3dCbHVyLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZG93Qmx1cih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkb3dCbHVyLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHJpbU1haW5TdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnJpbU1haW5TdHJlbmd0aC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHJpbU1haW5TdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yaW1NYWluU3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgcmltU2hhZG93TWFzaygpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnJpbVNoYWRvd01hc2sudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCByaW1TaGFkb3dNYXNrKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJpbVNoYWRvd01hc2sudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBsaWxDYWxjU3BlY3VsYXItbGlrZSB0b29uIHNwZWN1bGFyIHN0cmVuZ3RoICgwID0gb2ZmKSAqL1xuICBwdWJsaWMgZ2V0IHNwZWN1bGFyU3RyZW5ndGgoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zcGVjdWxhclN0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc3BlY3VsYXJTdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zcGVjdWxhclN0cmVuZ3RoLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogU3BlY3VsYXIgQmxpbm4gcG93ZXIgLyBpbnZlcnNlLXJvdWdobmVzcyBwcm94eSAqL1xuICBwdWJsaWMgZ2V0IHNwZWN1bGFyUG93ZXIoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zcGVjdWxhclBvd2VyLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc3BlY3VsYXJQb3dlcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zcGVjdWxhclBvd2VyLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogVG9vbiBzcGVjdWxhciBib3JkZXIgaW4gWzAsMV0gKi9cbiAgcHVibGljIGdldCBzcGVjdWxhckJvcmRlcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNwZWN1bGFyQm9yZGVyLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc3BlY3VsYXJCb3JkZXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc3BlY3VsYXJCb3JkZXIudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBUb29uIHNwZWN1bGFyIGJsdXIgd2lkdGggKi9cbiAgcHVibGljIGdldCBzcGVjdWxhckJsdXIoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zcGVjdWxhckJsdXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzcGVjdWxhckJsdXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc3BlY3VsYXJCbHVyLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogVmlldy1kZXBlbmRlbnQgZW52IHJlZmxlY3Rpb24gYXBwcm94IChubyBjdWJlbWFwKSAqL1xuICBwdWJsaWMgZ2V0IHJlZmxlY3RTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnJlZmxlY3RTdHJlbmd0aC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHJlZmxlY3RTdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yZWZsZWN0U3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBGcmVzbmVsIGFtb3VudCBmb3IgZW52IGFwcHJveCAqL1xuICBwdWJsaWMgZ2V0IHJlZmxlY3RGcmVzbmVsKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmVmbGVjdEZyZXNuZWwudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCByZWZsZWN0RnJlc25lbCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yZWZsZWN0RnJlc25lbC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIDAgZGllbGVjdHJpYyAuLiAxIG1ldGFsICh0aW50cyByZWZsZWN0aW9uIHRvd2FyZCBhbGJlZG8pICovXG4gIHB1YmxpYyBnZXQgcmVmbGVjdE1ldGFsbGljKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmVmbGVjdE1ldGFsbGljLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmVmbGVjdE1ldGFsbGljKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJlZmxlY3RNZXRhbGxpYy52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIFNoYXJwZXIgZ3JhemluZyByZWZsZWN0aW9uIHdoZW4gaGlnaCAqL1xuICBwdWJsaWMgZ2V0IHJlZmxlY3RTbW9vdGhuZXNzKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmVmbGVjdFNtb290aG5lc3MudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCByZWZsZWN0U21vb3RobmVzcyh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yZWZsZWN0U21vb3RobmVzcy52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIGxpbCBiYWNrbGlnaHQgd3JhcCBzdHJlbmd0aCAoMCA9IG9mZikgKi9cbiAgcHVibGljIGdldCBiYWNrbGlnaHRTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmJhY2tsaWdodFN0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgYmFja2xpZ2h0U3RyZW5ndGgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuYmFja2xpZ2h0U3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBCYWNrbGlnaHQgdGludCBjb2xvciAqL1xuICBwdWJsaWMgZ2V0IGJhY2tsaWdodENvbG9yKCk6IFRIUkVFLkNvbG9yIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5iYWNrbGlnaHRDb2xvci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGJhY2tsaWdodENvbG9yKHZhbHVlOiBUSFJFRS5Db2xvcikge1xuICAgIHRoaXMudW5pZm9ybXMuYmFja2xpZ2h0Q29sb3IudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiA+MCBvdmVycmlkZXMgcGFyYW1ldHJpYyByaW0gZnJlc25lbCBwb3dlciAqL1xuICBwdWJsaWMgZ2V0IHJpbUZyZXNuZWxQb3dlcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnJpbUZyZXNuZWxQb3dlci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHJpbUZyZXNuZWxQb3dlcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yaW1GcmVzbmVsUG93ZXIudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBPcHBvc2l0ZS1zaWRlIHJpbSAobGlsIFJpbUluZGlyKSAqL1xuICBwdWJsaWMgZ2V0IHJpbUluZGlyU3RyZW5ndGgoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5yaW1JbmRpclN0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmltSW5kaXJTdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yaW1JbmRpclN0cmVuZ3RoLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogQ29udHJhc3QgZm9yIHN5bnRoZXNpemVkIDJuZCBNYXRDYXAgKi9cbiAgcHVibGljIGdldCBtYXRjYXAybmRDb250cmFzdCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm1hdGNhcDJuZENvbnRyYXN0LnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgbWF0Y2FwMm5kQ29udHJhc3QodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMubWF0Y2FwMm5kQ29udHJhc3QudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBVViBzY2FsZSBmb3IgMm5kIE1hdENhcCByZXNhbXBsZSAqL1xuICBwdWJsaWMgZ2V0IG1hdGNhcDJuZFNjYWxlKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMubWF0Y2FwMm5kU2NhbGUudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBtYXRjYXAybmRTY2FsZSh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5tYXRjYXAybmRTY2FsZS52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIEV4dHJhIGVtaXNzaXZlIHNjYWxlIChzdG9jayBlbWlzc2l2ZSAqICgxK2Jvb3N0KSkgKi9cbiAgcHVibGljIGdldCBlbWlzc2lvbkJvb3N0KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuZW1pc3Npb25Cb29zdC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGVtaXNzaW9uQm9vc3QodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuZW1pc3Npb25Cb29zdC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIENhbWVyYS1kaXN0YW5jZSBzb2Z0IGxpZnQvZmFkZSBhcHByb3ggKi9cbiAgcHVibGljIGdldCBkaXN0YW5jZUZhZGUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5kaXN0YW5jZUZhZGUudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBkaXN0YW5jZUZhZGUodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuZGlzdGFuY2VGYWRlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogRmFjZSBwcmVzZXQ6IHNvZnRlciBwcmltYXJ5IHNoYWRvdyBib3JkZXIgKi9cbiAgcHVibGljIGdldCBmYWNlU29mdCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmZhY2VTb2Z0LnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgZmFjZVNvZnQodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuZmFjZVNvZnQudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBBbXBsaWZ5IG5vcm1hbE1hcCBYWSBmb3Igc2tpbiBkZXB0aCAqL1xuICBwdWJsaWMgZ2V0IG5vcm1hbFNraW5Cb29zdCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm5vcm1hbFNraW5Cb29zdC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG5vcm1hbFNraW5Cb29zdCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5ub3JtYWxTa2luQm9vc3QudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBsaWwgX1NoYWRvd0VudlN0cmVuZ3RoLWxpa2Ugc2hhZGUgbGlmdCAqL1xuICBwdWJsaWMgZ2V0IGVudlN0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuZW52U3RyZW5ndGgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBlbnZTdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5lbnZTdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIEdlbS1pc2ggZnJlc25lbCBwcm94eSAoMCB1bmxlc3MgamV3ZWxyeSBoZXVyaXN0aWMpICovXG4gIHB1YmxpYyBnZXQgZ2VtRnJlc25lbCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmdlbUZyZXNuZWwudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBnZW1GcmVzbmVsKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmdlbUZyZXNuZWwudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBPdXRsaW5lIGxpZ2h0aW5nIG1peCBiaWFzIChzYWZlIHdpdGggb3V0bGluZS1vZmYpICovXG4gIHB1YmxpYyBnZXQgb3V0bGluZU1peCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm91dGxpbmVNaXgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBvdXRsaW5lTWl4KHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm91dGxpbmVNaXgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBSZWNlaXZlIHNoYWRvdyBtYXAgZmFjdG9yOiAxLjAgPSBmdWxsIHNoYWRvdywgMC4wID0gaWdub3JlIHNoYWRvdyBtYXAgKGNsZWFuIGFuaW1lIGZhY2UpICovXG4gIHB1YmxpYyBnZXQgcmVjZWl2ZVNoYWRvd1JhdGUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5yZWNlaXZlU2hhZG93UmF0ZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHJlY2VpdmVTaGFkb3dSYXRlKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJlY2VpdmVTaGFkb3dSYXRlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogVmVsdmV0IC8gZmFicmljIGdyYXppbmcgc2hlZW4gc3RyZW5ndGggKGxpbFRvb24gY2xvdGggZmVlbCkgKi9cbiAgcHVibGljIGdldCBmYWJyaWNTaGVlblN0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuZmFicmljU2hlZW5TdHJlbmd0aC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGZhYnJpY1NoZWVuU3RyZW5ndGgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuZmFicmljU2hlZW5TdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBmYWJyaWNTaGVlblBvd2VyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuZmFicmljU2hlZW5Qb3dlci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGZhYnJpY1NoZWVuUG93ZXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuZmFicmljU2hlZW5Qb3dlci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBmYWJyaWNTaGVlbkNvbG9yKCk6IFRIUkVFLkNvbG9yIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5mYWJyaWNTaGVlbkNvbG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgZmFicmljU2hlZW5Db2xvcih2YWx1ZTogVEhSRUUuQ29sb3IpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmZhYnJpY1NoZWVuQ29sb3IudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBsaWxUb29uLWxpa2UgRmFrZSBTU1MgcGVhY2ggYmxvb2QtdGludCBoYWxvIHN0cmVuZ3RoICgwLi4xKSAqL1xuXG4gIHB1YmxpYyBnZXQgb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlKCk6IFRIUkVFLlRleHR1cmUgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5vdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmUudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBvdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmUodmFsdWU6IFRIUkVFLlRleHR1cmUgfCBudWxsKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5vdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmUudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgb3V0bGluZVdpZHRoRmFjdG9yKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMub3V0bGluZVdpZHRoRmFjdG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgb3V0bGluZVdpZHRoRmFjdG9yKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm91dGxpbmVXaWR0aEZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBvdXRsaW5lQ29sb3JGYWN0b3IoKTogVEhSRUUuQ29sb3Ige1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm91dGxpbmVDb2xvckZhY3Rvci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG91dGxpbmVDb2xvckZhY3Rvcih2YWx1ZTogVEhSRUUuQ29sb3IpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm91dGxpbmVDb2xvckZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBvdXRsaW5lTGlnaHRpbmdNaXhGYWN0b3IoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5vdXRsaW5lTGlnaHRpbmdNaXhGYWN0b3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBvdXRsaW5lTGlnaHRpbmdNaXhGYWN0b3IodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMub3V0bGluZUxpZ2h0aW5nTWl4RmFjdG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHV2QW5pbWF0aW9uTWFza1RleHR1cmUoKTogVEhSRUUuVGV4dHVyZSB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnV2QW5pbWF0aW9uTWFza1RleHR1cmUudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCB1dkFuaW1hdGlvbk1hc2tUZXh0dXJlKHZhbHVlOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCkge1xuICAgIHRoaXMudW5pZm9ybXMudXZBbmltYXRpb25NYXNrVGV4dHVyZS52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCB1dkFuaW1hdGlvblNjcm9sbFhPZmZzZXQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy51dkFuaW1hdGlvblNjcm9sbFhPZmZzZXQudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCB1dkFuaW1hdGlvblNjcm9sbFhPZmZzZXQodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMudXZBbmltYXRpb25TY3JvbGxYT2Zmc2V0LnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHV2QW5pbWF0aW9uU2Nyb2xsWU9mZnNldCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnV2QW5pbWF0aW9uU2Nyb2xsWU9mZnNldC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHV2QW5pbWF0aW9uU2Nyb2xsWU9mZnNldCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy51dkFuaW1hdGlvblNjcm9sbFlPZmZzZXQudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgdXZBbmltYXRpb25Sb3RhdGlvblBoYXNlKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMudXZBbmltYXRpb25Sb3RhdGlvblBoYXNlLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgdXZBbmltYXRpb25Sb3RhdGlvblBoYXNlKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnV2QW5pbWF0aW9uUm90YXRpb25QaGFzZS52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIHV2QW5pbWF0aW9uU2Nyb2xsWFNwZWVkRmFjdG9yID0gMC4wO1xuICBwdWJsaWMgdXZBbmltYXRpb25TY3JvbGxZU3BlZWRGYWN0b3IgPSAwLjA7XG4gIHB1YmxpYyB1dkFuaW1hdGlvblJvdGF0aW9uU3BlZWRGYWN0b3IgPSAwLjA7XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIG1hdGVyaWFsIGlzIGFmZmVjdGVkIGJ5IGZvZy5cbiAgICogYHRydWVgIGJ5IGRlZmF1bHQuXG4gICAqL1xuICBwdWJsaWMgZm9nID0gdHJ1ZTtcblxuICAvKipcbiAgICogV2lsbCBiZSByZWFkIGluIFdlYkdMUHJvZ3JhbXNcbiAgICpcbiAgICogU2VlOiBodHRwczovL2dpdGh1Yi5jb20vbXJkb29iL3RocmVlLmpzL2Jsb2IvNGY1MjM2YWMzZDZmNDFkOTA0YWE1ODQwMWI0MDU1NGU4ZmJkY2IxNS9zcmMvcmVuZGVyZXJzL3dlYmdsL1dlYkdMUHJvZ3JhbXMuanMjTDE5MC1MMTkxXG4gICAqL1xuICBwdWJsaWMgbm9ybWFsTWFwVHlwZSA9IFRIUkVFLlRhbmdlbnRTcGFjZU5vcm1hbE1hcDtcblxuICAvKipcbiAgICogV2hlbiB0aGlzIGlzIGB0cnVlYCwgdmVydGV4IGNvbG9ycyB3aWxsIGJlIGlnbm9yZWQuXG4gICAqIGB0cnVlYCBieSBkZWZhdWx0LlxuICAgKi9cbiAgcHJpdmF0ZSBfaWdub3JlVmVydGV4Q29sb3IgPSB0cnVlO1xuXG4gIC8qKlxuICAgKiBXaGVuIHRoaXMgaXMgYHRydWVgLCB2ZXJ0ZXggY29sb3JzIHdpbGwgYmUgaWdub3JlZC5cbiAgICogYHRydWVgIGJ5IGRlZmF1bHQuXG4gICAqL1xuICBwdWJsaWMgZ2V0IGlnbm9yZVZlcnRleENvbG9yKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLl9pZ25vcmVWZXJ0ZXhDb2xvcjtcbiAgfVxuICBwdWJsaWMgc2V0IGlnbm9yZVZlcnRleENvbG9yKHZhbHVlOiBib29sZWFuKSB7XG4gICAgdGhpcy5faWdub3JlVmVydGV4Q29sb3IgPSB2YWx1ZTtcblxuICAgIHRoaXMubmVlZHNVcGRhdGUgPSB0cnVlO1xuICB9XG5cbiAgcHJpdmF0ZSBfdjBDb21wYXRTaGFkZSA9IGZhbHNlO1xuXG4gIC8qKlxuICAgKiBUaGVyZSBpcyBhIGxpbmUgb2YgdGhlIHNoYWRlciBjYWxsZWQgXCJjb21tZW50IG91dCBpZiB5b3Ugd2FudCB0byBQQlIgYWJzb2x1dGVseVwiIGluIFZSTTAuMCBNVG9vbi5cbiAgICogV2hlbiB0aGlzIGlzIHRydWUsIHRoZSBtYXRlcmlhbCBlbmFibGVzIHRoZSBsaW5lIHRvIG1ha2UgaXQgY29tcGF0aWJsZSB3aXRoIHRoZSBsZWdhY3kgcmVuZGVyaW5nIG9mIFZSTS5cbiAgICogVXN1YWxseSBub3QgcmVjb21tZW5kZWQgdG8gdHVybiB0aGlzIG9uLlxuICAgKiBgZmFsc2VgIGJ5IGRlZmF1bHQuXG4gICAqL1xuICBnZXQgdjBDb21wYXRTaGFkZSgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5fdjBDb21wYXRTaGFkZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGVyZSBpcyBhIGxpbmUgb2YgdGhlIHNoYWRlciBjYWxsZWQgXCJjb21tZW50IG91dCBpZiB5b3Ugd2FudCB0byBQQlIgYWJzb2x1dGVseVwiIGluIFZSTTAuMCBNVG9vbi5cbiAgICogV2hlbiB0aGlzIGlzIHRydWUsIHRoZSBtYXRlcmlhbCBlbmFibGVzIHRoZSBsaW5lIHRvIG1ha2UgaXQgY29tcGF0aWJsZSB3aXRoIHRoZSBsZWdhY3kgcmVuZGVyaW5nIG9mIFZSTS5cbiAgICogVXN1YWxseSBub3QgcmVjb21tZW5kZWQgdG8gdHVybiB0aGlzIG9uLlxuICAgKiBgZmFsc2VgIGJ5IGRlZmF1bHQuXG4gICAqL1xuICBzZXQgdjBDb21wYXRTaGFkZSh2OiBib29sZWFuKSB7XG4gICAgdGhpcy5fdjBDb21wYXRTaGFkZSA9IHY7XG5cbiAgICB0aGlzLm5lZWRzVXBkYXRlID0gdHJ1ZTtcbiAgfVxuXG4gIHByaXZhdGUgX2RlYnVnTW9kZTogTVRvb25NYXRlcmlhbERlYnVnTW9kZSA9IE1Ub29uTWF0ZXJpYWxEZWJ1Z01vZGUuTm9uZTtcblxuICAvKipcbiAgICogRGVidWcgbW9kZSBmb3IgdGhlIG1hdGVyaWFsLlxuICAgKiBZb3UgY2FuIHZpc3VhbGl6ZSBzZXZlcmFsIGNvbXBvbmVudHMgZm9yIGRpYWdub3NpcyB1c2luZyBkZWJ1ZyBtb2RlLlxuICAgKlxuICAgKiBTZWU6IHtAbGluayBNVG9vbk1hdGVyaWFsRGVidWdNb2RlfVxuICAgKi9cbiAgZ2V0IGRlYnVnTW9kZSgpOiBNVG9vbk1hdGVyaWFsRGVidWdNb2RlIHtcbiAgICByZXR1cm4gdGhpcy5fZGVidWdNb2RlO1xuICB9XG5cbiAgLyoqXG4gICAqIERlYnVnIG1vZGUgZm9yIHRoZSBtYXRlcmlhbC5cbiAgICogWW91IGNhbiB2aXN1YWxpemUgc2V2ZXJhbCBjb21wb25lbnRzIGZvciBkaWFnbm9zaXMgdXNpbmcgZGVidWcgbW9kZS5cbiAgICpcbiAgICogU2VlOiB7QGxpbmsgTVRvb25NYXRlcmlhbERlYnVnTW9kZX1cbiAgICovXG4gIHNldCBkZWJ1Z01vZGUobTogTVRvb25NYXRlcmlhbERlYnVnTW9kZSkge1xuICAgIHRoaXMuX2RlYnVnTW9kZSA9IG07XG5cbiAgICB0aGlzLm5lZWRzVXBkYXRlID0gdHJ1ZTtcbiAgfVxuXG4gIHByaXZhdGUgX291dGxpbmVXaWR0aE1vZGU6IE1Ub29uTWF0ZXJpYWxPdXRsaW5lV2lkdGhNb2RlID0gTVRvb25NYXRlcmlhbE91dGxpbmVXaWR0aE1vZGUuTm9uZTtcblxuICBnZXQgb3V0bGluZVdpZHRoTW9kZSgpOiBNVG9vbk1hdGVyaWFsT3V0bGluZVdpZHRoTW9kZSB7XG4gICAgcmV0dXJuIHRoaXMuX291dGxpbmVXaWR0aE1vZGU7XG4gIH1cbiAgc2V0IG91dGxpbmVXaWR0aE1vZGUobTogTVRvb25NYXRlcmlhbE91dGxpbmVXaWR0aE1vZGUpIHtcbiAgICB0aGlzLl9vdXRsaW5lV2lkdGhNb2RlID0gbTtcblxuICAgIHRoaXMubmVlZHNVcGRhdGUgPSB0cnVlO1xuICB9XG5cbiAgcHJpdmF0ZSBfaXNPdXRsaW5lID0gZmFsc2U7XG5cbiAgZ2V0IGlzT3V0bGluZSgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5faXNPdXRsaW5lO1xuICB9XG4gIHNldCBpc091dGxpbmUoYjogYm9vbGVhbikge1xuICAgIHRoaXMuX2lzT3V0bGluZSA9IGI7XG5cbiAgICB0aGlzLm5lZWRzVXBkYXRlID0gdHJ1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkb25seSBib29sZWFuIHRoYXQgaW5kaWNhdGVzIHRoaXMgaXMgYSB7QGxpbmsgTVRvb25NYXRlcmlhbH0uXG4gICAqL1xuICBwdWJsaWMgZ2V0IGlzTVRvb25NYXRlcmlhbCgpOiB0cnVlIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGNvbnN0cnVjdG9yKHBhcmFtZXRlcnM6IE1Ub29uTWF0ZXJpYWxQYXJhbWV0ZXJzID0ge30pIHtcbiAgICBzdXBlcih7IHZlcnRleFNoYWRlciwgZnJhZ21lbnRTaGFkZXIgfSk7XG5cbiAgICAvLyBvdmVycmlkZSBkZXB0aFdyaXRlIHdpdGggdHJhbnNwYXJlbnRXaXRoWldyaXRlXG4gICAgaWYgKHBhcmFtZXRlcnMudHJhbnNwYXJlbnRXaXRoWldyaXRlKSB7XG4gICAgICBwYXJhbWV0ZXJzLmRlcHRoV3JpdGUgPSB0cnVlO1xuICAgIH1cbiAgICBkZWxldGUgcGFyYW1ldGVycy50cmFuc3BhcmVudFdpdGhaV3JpdGU7XG5cbiAgICAvLyA9PSBlbmFibGluZyBidW5jaCBvZiBzdHVmZiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBwYXJhbWV0ZXJzLmZvZyA9IHRydWU7XG4gICAgcGFyYW1ldGVycy5saWdodHMgPSB0cnVlO1xuICAgIHBhcmFtZXRlcnMuY2xpcHBpbmcgPSB0cnVlO1xuXG4gICAgLy8gPT0gdW5pZm9ybXMgPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgdGhpcy51bmlmb3JtcyA9IFRIUkVFLlVuaWZvcm1zVXRpbHMubWVyZ2UoW1xuICAgICAgVEhSRUUuVW5pZm9ybXNMaWIuY29tbW9uLCAvLyBtYXBcbiAgICAgIFRIUkVFLlVuaWZvcm1zTGliLm5vcm1hbG1hcCwgLy8gbm9ybWFsTWFwXG4gICAgICBUSFJFRS5Vbmlmb3Jtc0xpYi5lbWlzc2l2ZW1hcCwgLy8gZW1pc3NpdmVNYXBcbiAgICAgIFRIUkVFLlVuaWZvcm1zTGliLmZvZyxcbiAgICAgIFRIUkVFLlVuaWZvcm1zTGliLmxpZ2h0cyxcbiAgICAgIHtcbiAgICAgICAgbGl0RmFjdG9yOiB7IHZhbHVlOiBuZXcgVEhSRUUuQ29sb3IoMS4wLCAxLjAsIDEuMCkgfSxcbiAgICAgICAgbWFwVXZUcmFuc2Zvcm06IHsgdmFsdWU6IG5ldyBUSFJFRS5NYXRyaXgzKCkgfSxcbiAgICAgICAgY29sb3JBbHBoYTogeyB2YWx1ZTogMS4wIH0sXG4gICAgICAgIG5vcm1hbE1hcFV2VHJhbnNmb3JtOiB7IHZhbHVlOiBuZXcgVEhSRUUuTWF0cml4MygpIH0sXG4gICAgICAgIHNoYWRlQ29sb3JGYWN0b3I6IHsgdmFsdWU6IG5ldyBUSFJFRS5Db2xvcigwLjAsIDAuMCwgMC4wKSB9LFxuICAgICAgICBzaGFkZU11bHRpcGx5VGV4dHVyZTogeyB2YWx1ZTogbnVsbCB9LFxuICAgICAgICBzaGFkZU11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtOiB7IHZhbHVlOiBuZXcgVEhSRUUuTWF0cml4MygpIH0sXG4gICAgICAgIHNoYWRpbmdTaGlmdEZhY3RvcjogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHNoYWRpbmdTaGlmdFRleHR1cmU6IHsgdmFsdWU6IG51bGwgfSxcbiAgICAgICAgc2hhZGluZ1NoaWZ0VGV4dHVyZVV2VHJhbnNmb3JtOiB7IHZhbHVlOiBuZXcgVEhSRUUuTWF0cml4MygpIH0sXG4gICAgICAgIHNoYWRpbmdTaGlmdFRleHR1cmVTY2FsZTogeyB2YWx1ZTogMS4wIH0sXG4gICAgICAgIHNoYWRpbmdUb29ueUZhY3RvcjogeyB2YWx1ZTogMC45IH0sXG4gICAgICAgIGdpRXF1YWxpemF0aW9uRmFjdG9yOiB7IHZhbHVlOiAwLjkgfSxcbiAgICAgICAgbWF0Y2FwRmFjdG9yOiB7IHZhbHVlOiBuZXcgVEhSRUUuQ29sb3IoMS4wLCAxLjAsIDEuMCkgfSxcbiAgICAgICAgbWF0Y2FwVGV4dHVyZTogeyB2YWx1ZTogbnVsbCB9LFxuICAgICAgICBtYXRjYXBUZXh0dXJlVXZUcmFuc2Zvcm06IHsgdmFsdWU6IG5ldyBUSFJFRS5NYXRyaXgzKCkgfSxcbiAgICAgICAgcGFyYW1ldHJpY1JpbUNvbG9yRmFjdG9yOiB7IHZhbHVlOiBuZXcgVEhSRUUuQ29sb3IoMC4wLCAwLjAsIDAuMCkgfSxcbiAgICAgICAgcmltTXVsdGlwbHlUZXh0dXJlOiB7IHZhbHVlOiBudWxsIH0sXG4gICAgICAgIHJpbU11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtOiB7IHZhbHVlOiBuZXcgVEhSRUUuTWF0cml4MygpIH0sXG4gICAgICAgIHJpbUxpZ2h0aW5nTWl4RmFjdG9yOiB7IHZhbHVlOiAxLjAgfSxcbiAgICAgICAgcGFyYW1ldHJpY1JpbUZyZXNuZWxQb3dlckZhY3RvcjogeyB2YWx1ZTogNS4wIH0sXG4gICAgICAgIHBhcmFtZXRyaWNSaW1MaWZ0RmFjdG9yOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgZW1pc3NpdmU6IHsgdmFsdWU6IG5ldyBUSFJFRS5Db2xvcigwLjAsIDAuMCwgMC4wKSB9LFxuICAgICAgICBlbWlzc2l2ZUludGVuc2l0eTogeyB2YWx1ZTogMS4wIH0sXG4gICAgICAgIGVtaXNzaXZlTWFwVXZUcmFuc2Zvcm06IHsgdmFsdWU6IG5ldyBUSFJFRS5NYXRyaXgzKCkgfSxcbiAgICAgICAgb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlOiB7IHZhbHVlOiBudWxsIH0sXG4gICAgICAgIG91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtOiB7IHZhbHVlOiBuZXcgVEhSRUUuTWF0cml4MygpIH0sXG4gICAgICAgIG91dGxpbmVXaWR0aEZhY3RvcjogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIG91dGxpbmVDb2xvckZhY3RvcjogeyB2YWx1ZTogbmV3IFRIUkVFLkNvbG9yKDAuMCwgMC4wLCAwLjApIH0sXG4gICAgICAgIG91dGxpbmVMaWdodGluZ01peEZhY3RvcjogeyB2YWx1ZTogMS4wIH0sXG4gICAgICAgIHV2QW5pbWF0aW9uTWFza1RleHR1cmU6IHsgdmFsdWU6IG51bGwgfSxcbiAgICAgICAgdXZBbmltYXRpb25NYXNrVGV4dHVyZVV2VHJhbnNmb3JtOiB7IHZhbHVlOiBuZXcgVEhSRUUuTWF0cml4MygpIH0sXG4gICAgICAgIHV2QW5pbWF0aW9uU2Nyb2xsWE9mZnNldDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHV2QW5pbWF0aW9uU2Nyb2xsWU9mZnNldDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHV2QW5pbWF0aW9uUm90YXRpb25QaGFzZTogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIC8vIEV4dGVuZGVkIE1Ub29uIHR1bmluZyBwYXJhbWV0ZXJzIChkZWZhdWx0IG9mZiA9IGNsYXNzaWMgTVRvb24gYmVoYXZpb3IpXG4gICAgICAgIHNvZnRNaXg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBibHVyQm9vc3Q6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBzaGFkb3cybmRTdHJlbmd0aDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHNoYWRvdzJuZEJvcmRlcjogeyB2YWx1ZTogMC4zMiB9LFxuICAgICAgICBzaGFkb3cybmRCbHVyOiB7IHZhbHVlOiAwLjIyIH0sXG4gICAgICAgIHNoYWRvdzJuZENvbG9yOiB7IHZhbHVlOiBuZXcgVEhSRUUuQ29sb3IoMC42OCwgMC42MiwgMC43OCkgfSxcbiAgICAgICAgc2hhZG93M3JkU3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBzaGFkb3czcmRCb3JkZXI6IHsgdmFsdWU6IDAuMTQgfSxcbiAgICAgICAgc2hhZG93M3JkQmx1cjogeyB2YWx1ZTogMC4yIH0sXG4gICAgICAgIHNoYWRvdzNyZENvbG9yOiB7IHZhbHVlOiBuZXcgVEhSRUUuQ29sb3IoMC41MiwgMC40OCwgMC42MCkgfSxcbiAgICAgICAgcmltQm9vc3Q6IHsgdmFsdWU6IDEuMCB9LFxuICAgICAgICByaW1Cb3JkZXI6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICByaW1CbHVyOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgcmltRGlyU3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBoYWlyU3BlY1N0cmVuZ3RoOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgaGFpclNwZWNQb3dlcjogeyB2YWx1ZTogNTYuMCB9LFxuICAgICAgICBoYWlyU3BlY1NoaWZ0OiB7IHZhbHVlOiAtMC4xIH0sXG4gICAgICAgIGNsb3RoU3BlY1N0cmVuZ3RoOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgY2xvdGhTcGVjUG93ZXI6IHsgdmFsdWU6IDcyLjAgfSxcbiAgICAgICAgbWF0Y2FwMm5kU3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBza2luU3BlY1N0cmVuZ3RoOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgc2tpblNwZWNQb3dlcjogeyB2YWx1ZTogMjguMCB9LFxuICAgICAgICBza2luU3BlY0ZyZXNuZWw6IHsgdmFsdWU6IDAuNDUgfSxcbiAgICAgICAgc2tpblNwZWNDb2xvcjogeyB2YWx1ZTogbmV3IFRIUkVFLkNvbG9yKDEuMCwgMC45NiwgMC45NCkgfSxcbiAgICAgICAgYW1iaWVudExpZnQ6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBzaGFkZU1haW5TdHJlbmd0aDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHNoYWRvd0JvcmRlcjogeyB2YWx1ZTogLTEuMCB9LFxuICAgICAgICBzaGFkb3dCbHVyOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgcmltTWFpblN0cmVuZ3RoOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgcmltU2hhZG93TWFzazogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHNwZWN1bGFyU3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBzcGVjdWxhclBvd2VyOiB7IHZhbHVlOiA0OC4wIH0sXG4gICAgICAgIHNwZWN1bGFyQm9yZGVyOiB7IHZhbHVlOiAwLjUgfSxcbiAgICAgICAgc3BlY3VsYXJCbHVyOiB7IHZhbHVlOiAwLjEgfSxcbiAgICAgICAgcmVmbGVjdFN0cmVuZ3RoOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgcmVmbGVjdEZyZXNuZWw6IHsgdmFsdWU6IDAuNTUgfSxcbiAgICAgICAgcmVmbGVjdE1ldGFsbGljOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgcmVmbGVjdFNtb290aG5lc3M6IHsgdmFsdWU6IDAuNTUgfSxcbiAgICAgICAgYmFja2xpZ2h0U3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBiYWNrbGlnaHRDb2xvcjogeyB2YWx1ZTogbmV3IFRIUkVFLkNvbG9yKDEuMCwgMC44NSwgMC43NSkgfSxcbiAgICAgICAgcmltRnJlc25lbFBvd2VyOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgcmltSW5kaXJTdHJlbmd0aDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIG1hdGNhcDJuZENvbnRyYXN0OiB7IHZhbHVlOiAxLjI1IH0sXG4gICAgICAgIG1hdGNhcDJuZFNjYWxlOiB7IHZhbHVlOiAxLjAgfSxcbiAgICAgICAgZW1pc3Npb25Cb29zdDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIGRpc3RhbmNlRmFkZTogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIGZhY2VTb2Z0OiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgbm9ybWFsU2tpbkJvb3N0OiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgZW52U3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBnZW1GcmVzbmVsOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgb3V0bGluZU1peDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHJlY2VpdmVTaGFkb3dSYXRlOiB7IHZhbHVlOiAxLjAgfSxcbiAgICAgICAgZmFicmljU2hlZW5TdHJlbmd0aDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIGZhYnJpY1NoZWVuUG93ZXI6IHsgdmFsdWU6IDMuNSB9LFxuICAgICAgICBmYWJyaWNTaGVlbkNvbG9yOiB7IHZhbHVlOiBuZXcgVEhSRUUuQ29sb3IoMHhmZmU4ZGYpIH0sXG4gICAgICB9LFxuICAgICAgcGFyYW1ldGVycy51bmlmb3JtcyA/PyB7fSxcbiAgICBdKSBhcyB0eXBlb2YgTVRvb25NYXRlcmlhbC5wcm90b3R5cGUudW5pZm9ybXM7XG5cbiAgICAvLyA9PSBmaW5hbGx5IGNvbXBpbGUgdGhlIHNoYWRlciBwcm9ncmFtID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICB0aGlzLnNldFZhbHVlcyhwYXJhbWV0ZXJzKTtcblxuICAgIC8vID09IHVwbG9hZCB1bmlmb3JtcyB0aGF0IG5lZWQgdG8gdXBsb2FkID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIHRoaXMuX3VwbG9hZFVuaWZvcm1zV29ya2Fyb3VuZCgpO1xuXG4gICAgLy8gPT0gdXBkYXRlIHNoYWRlciBzdHVmZiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgdGhpcy5jdXN0b21Qcm9ncmFtQ2FjaGVLZXkgPSAoKSA9PlxuICAgICAgW1xuICAgICAgICAuLi5PYmplY3QuZW50cmllcyh0aGlzLl9nZW5lcmF0ZURlZmluZXMoKSkubWFwKChbdG9rZW4sIG1hY3JvXSkgPT4gYCR7dG9rZW59OiR7bWFjcm99YCksXG4gICAgICAgIHRoaXMubWF0Y2FwVGV4dHVyZSA/IGBtYXRjYXBUZXh0dXJlQ29sb3JTcGFjZToke2dldFRleHR1cmVDb2xvclNwYWNlKHRoaXMubWF0Y2FwVGV4dHVyZSl9YCA6ICcnLFxuICAgICAgICB0aGlzLnNoYWRlTXVsdGlwbHlUZXh0dXJlXG4gICAgICAgICAgPyBgc2hhZGVNdWx0aXBseVRleHR1cmVDb2xvclNwYWNlOiR7Z2V0VGV4dHVyZUNvbG9yU3BhY2UodGhpcy5zaGFkZU11bHRpcGx5VGV4dHVyZSl9YFxuICAgICAgICAgIDogJycsXG4gICAgICAgIHRoaXMucmltTXVsdGlwbHlUZXh0dXJlID8gYHJpbU11bHRpcGx5VGV4dHVyZUNvbG9yU3BhY2U6JHtnZXRUZXh0dXJlQ29sb3JTcGFjZSh0aGlzLnJpbU11bHRpcGx5VGV4dHVyZSl9YCA6ICcnLFxuICAgICAgXS5qb2luKCcsJyk7XG5cbiAgICB0aGlzLm9uQmVmb3JlQ29tcGlsZSA9IChzaGFkZXIpID0+IHtcbiAgICAgIGNvbnN0IHRocmVlUmV2aXNpb24gPSBwYXJzZUludChUSFJFRS5SRVZJU0lPTiwgMTApO1xuXG4gICAgICBjb25zdCBkZWZpbmVzID1cbiAgICAgICAgT2JqZWN0LmVudHJpZXMoeyAuLi50aGlzLl9nZW5lcmF0ZURlZmluZXMoKSwgLi4udGhpcy5kZWZpbmVzIH0pXG4gICAgICAgICAgLmZpbHRlcigoW3Rva2VuLCBtYWNyb10pID0+ICEhbWFjcm8pXG4gICAgICAgICAgLm1hcCgoW3Rva2VuLCBtYWNyb10pID0+IGAjZGVmaW5lICR7dG9rZW59ICR7bWFjcm99YClcbiAgICAgICAgICAuam9pbignXFxuJykgKyAnXFxuJztcblxuICAgICAgLy8gLS0gZ2VuZXJhdGUgc2hhZGVyIGNvZGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgICAgc2hhZGVyLnZlcnRleFNoYWRlciA9IGRlZmluZXMgKyBzaGFkZXIudmVydGV4U2hhZGVyO1xuICAgICAgc2hhZGVyLmZyYWdtZW50U2hhZGVyID0gZGVmaW5lcyArIHNoYWRlci5mcmFnbWVudFNoYWRlcjtcblxuICAgICAgLy8gLS0gY29tcGF0IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gICAgICAvLyBDT01QQVQ6IHByZS1yMTU0XG4gICAgICAvLyBUaHJlZS5qcyByMTU0IHJlbmFtZXMgdGhlIHNoYWRlciBjaHVuayA8Y29sb3JzcGFjZV9mcmFnbWVudD4gdG8gPGVuY29kaW5nc19mcmFnbWVudD5cbiAgICAgIGlmICh0aHJlZVJldmlzaW9uIDwgMTU0KSB7XG4gICAgICAgIHNoYWRlci5mcmFnbWVudFNoYWRlciA9IHNoYWRlci5mcmFnbWVudFNoYWRlci5yZXBsYWNlKFxuICAgICAgICAgICcjaW5jbHVkZSA8Y29sb3JzcGFjZV9mcmFnbWVudD4nLFxuICAgICAgICAgICcjaW5jbHVkZSA8ZW5jb2RpbmdzX2ZyYWdtZW50PicsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgdGhpcyBtYXRlcmlhbC5cbiAgICpcbiAgICogQHBhcmFtIGRlbHRhIGRlbHRhVGltZSBzaW5jZSBsYXN0IHVwZGF0ZVxuICAgKi9cbiAgcHVibGljIHVwZGF0ZShkZWx0YTogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5fdXBsb2FkVW5pZm9ybXNXb3JrYXJvdW5kKCk7XG4gICAgdGhpcy5fdXBkYXRlVVZBbmltYXRpb24oZGVsdGEpO1xuICB9XG5cbiAgcHVibGljIGNvcHkoc291cmNlOiB0aGlzKTogdGhpcyB7XG4gICAgc3VwZXIuY29weShzb3VyY2UpO1xuICAgIC8vIHVuaWZvcm1zIGFyZSBhbHJlYWR5IGNvcGllZCBhdCB0aGlzIG1vbWVudFxuXG4gICAgLy8gQmVnaW5uaW5nIGZyb20gcjEzMywgdW5pZm9ybSB0ZXh0dXJlcyB3aWxsIGJlIGNsb25lZCBpbnN0ZWFkIG9mIHJlZmVyZW5jZVxuICAgIC8vIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL21yZG9vYi90aHJlZS5qcy9ibG9iL2E4ODEzYmUwNGE4NDliZDE1NWY3Y2Y2ZjFiMjNkOGVlMmUwZmI0OGIvZXhhbXBsZXMvanNtL2xvYWRlcnMvR0xURkxvYWRlci5qcyNMMzA0N1xuICAgIC8vIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL21yZG9vYi90aHJlZS5qcy9ibG9iL2E4ODEzYmUwNGE4NDliZDE1NWY3Y2Y2ZjFiMjNkOGVlMmUwZmI0OGIvc3JjL3JlbmRlcmVycy9zaGFkZXJzL1VuaWZvcm1zVXRpbHMuanMjTDIyXG4gICAgLy8gVGhpcyB3aWxsIGxlYXZlIHRoZWlyIGAudmVyc2lvbmAgdG8gYmUgYDBgXG4gICAgLy8gYW5kIHRoZXNlIHRleHR1cmVzIHdvbid0IGJlIHVwbG9hZGVkIHRvIEdQVVxuICAgIC8vIFdlIGFyZSBnb2luZyB0byB3b3JrYXJvdW5kIHRoaXMgaW4gaGVyZVxuICAgIC8vIEkndmUgb3BlbmVkIGFuIGlzc3VlIGZvciB0aGlzOiBodHRwczovL2dpdGh1Yi5jb20vbXJkb29iL3RocmVlLmpzL2lzc3Vlcy8yMjcxOFxuICAgIHRoaXMubWFwID0gc291cmNlLm1hcDtcbiAgICB0aGlzLm5vcm1hbE1hcCA9IHNvdXJjZS5ub3JtYWxNYXA7XG4gICAgdGhpcy5lbWlzc2l2ZU1hcCA9IHNvdXJjZS5lbWlzc2l2ZU1hcDtcbiAgICB0aGlzLnNoYWRlTXVsdGlwbHlUZXh0dXJlID0gc291cmNlLnNoYWRlTXVsdGlwbHlUZXh0dXJlO1xuICAgIHRoaXMuc2hhZGluZ1NoaWZ0VGV4dHVyZSA9IHNvdXJjZS5zaGFkaW5nU2hpZnRUZXh0dXJlO1xuICAgIHRoaXMubWF0Y2FwVGV4dHVyZSA9IHNvdXJjZS5tYXRjYXBUZXh0dXJlO1xuICAgIHRoaXMucmltTXVsdGlwbHlUZXh0dXJlID0gc291cmNlLnJpbU11bHRpcGx5VGV4dHVyZTtcbiAgICB0aGlzLm91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZSA9IHNvdXJjZS5vdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmU7XG4gICAgdGhpcy51dkFuaW1hdGlvbk1hc2tUZXh0dXJlID0gc291cmNlLnV2QW5pbWF0aW9uTWFza1RleHR1cmU7XG5cbiAgICAvLyA9PSBjb3B5IG1lbWJlcnMgPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICB0aGlzLm5vcm1hbE1hcFR5cGUgPSBzb3VyY2Uubm9ybWFsTWFwVHlwZTtcblxuICAgIHRoaXMudXZBbmltYXRpb25TY3JvbGxYU3BlZWRGYWN0b3IgPSBzb3VyY2UudXZBbmltYXRpb25TY3JvbGxYU3BlZWRGYWN0b3I7XG4gICAgdGhpcy51dkFuaW1hdGlvblNjcm9sbFlTcGVlZEZhY3RvciA9IHNvdXJjZS51dkFuaW1hdGlvblNjcm9sbFlTcGVlZEZhY3RvcjtcbiAgICB0aGlzLnV2QW5pbWF0aW9uUm90YXRpb25TcGVlZEZhY3RvciA9IHNvdXJjZS51dkFuaW1hdGlvblJvdGF0aW9uU3BlZWRGYWN0b3I7XG5cbiAgICB0aGlzLmlnbm9yZVZlcnRleENvbG9yID0gc291cmNlLmlnbm9yZVZlcnRleENvbG9yO1xuXG4gICAgdGhpcy52MENvbXBhdFNoYWRlID0gc291cmNlLnYwQ29tcGF0U2hhZGU7XG4gICAgdGhpcy5kZWJ1Z01vZGUgPSBzb3VyY2UuZGVidWdNb2RlO1xuICAgIHRoaXMub3V0bGluZVdpZHRoTW9kZSA9IHNvdXJjZS5vdXRsaW5lV2lkdGhNb2RlO1xuXG4gICAgdGhpcy5pc091dGxpbmUgPSBzb3VyY2UuaXNPdXRsaW5lO1xuXG4gICAgLy8gPT0gdXBkYXRlIHNoYWRlciBzdHVmZiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgdGhpcy5uZWVkc1VwZGF0ZSA9IHRydWU7XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgVVYgYW5pbWF0aW9uIHN0YXRlLlxuICAgKiBJbnRlbmRlZCB0byBiZSBjYWxsZWQgdmlhIHtAbGluayB1cGRhdGV9LlxuICAgKiBAcGFyYW0gZGVsdGEgZGVsdGFUaW1lXG4gICAqL1xuICBwcml2YXRlIF91cGRhdGVVVkFuaW1hdGlvbihkZWx0YTogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy51bmlmb3Jtcy51dkFuaW1hdGlvblNjcm9sbFhPZmZzZXQudmFsdWUgKz0gZGVsdGEgKiB0aGlzLnV2QW5pbWF0aW9uU2Nyb2xsWFNwZWVkRmFjdG9yO1xuICAgIHRoaXMudW5pZm9ybXMudXZBbmltYXRpb25TY3JvbGxZT2Zmc2V0LnZhbHVlICs9IGRlbHRhICogdGhpcy51dkFuaW1hdGlvblNjcm9sbFlTcGVlZEZhY3RvcjtcbiAgICB0aGlzLnVuaWZvcm1zLnV2QW5pbWF0aW9uUm90YXRpb25QaGFzZS52YWx1ZSArPSBkZWx0YSAqIHRoaXMudXZBbmltYXRpb25Sb3RhdGlvblNwZWVkRmFjdG9yO1xuICAgIHRoaXMudW5pZm9ybXMuYWxwaGFUZXN0LnZhbHVlID0gdGhpcy5hbHBoYVRlc3Q7XG5cbiAgICB0aGlzLnVuaWZvcm1zTmVlZFVwZGF0ZSA9IHRydWU7XG4gIH1cblxuICAvKipcbiAgICogVXBsb2FkIHVuaWZvcm1zIHRoYXQgbmVlZCB0byB1cGxvYWQgYnV0IGRvZXNuJ3QgYXV0b21hdGljYWxseSBiZWNhdXNlIG9mIHJlYXNvbnMuXG4gICAqIEludGVuZGVkIHRvIGJlIGNhbGxlZCB2aWEge0BsaW5rIGNvbnN0cnVjdG9yfSBhbmQge0BsaW5rIHVwZGF0ZX0uXG4gICAqL1xuICBwcml2YXRlIF91cGxvYWRVbmlmb3Jtc1dvcmthcm91bmQoKTogdm9pZCB7XG4gICAgLy8gd29ya2Fyb3VuZDogc2luY2Ugb3BhY2l0eSBpcyBkZWZpbmVkIGFzIGEgcHJvcGVydHkgaW4gVEhSRUUuTWF0ZXJpYWxcbiAgICAvLyBhbmQgY2Fubm90IGJlIG92ZXJyaWRkZW4gYXMgYW4gYWNjZXNzb3IsXG4gICAgLy8gV2UgYXJlIGdvaW5nIHRvIHVwZGF0ZSBvcGFjaXR5IGhlcmVcbiAgICB0aGlzLnVuaWZvcm1zLm9wYWNpdHkudmFsdWUgPSB0aGlzLm9wYWNpdHk7XG5cbiAgICAvLyB3b3JrYXJvdW5kOiB0ZXh0dXJlIHRyYW5zZm9ybXMgYXJlIG5vdCB1cGRhdGVkIGF1dG9tYXRpY2FsbHlcbiAgICB0aGlzLl91cGRhdGVUZXh0dXJlTWF0cml4KHRoaXMudW5pZm9ybXMubWFwLCB0aGlzLnVuaWZvcm1zLm1hcFV2VHJhbnNmb3JtKTtcbiAgICB0aGlzLl91cGRhdGVUZXh0dXJlTWF0cml4KHRoaXMudW5pZm9ybXMubm9ybWFsTWFwLCB0aGlzLnVuaWZvcm1zLm5vcm1hbE1hcFV2VHJhbnNmb3JtKTtcbiAgICB0aGlzLl91cGRhdGVUZXh0dXJlTWF0cml4KHRoaXMudW5pZm9ybXMuZW1pc3NpdmVNYXAsIHRoaXMudW5pZm9ybXMuZW1pc3NpdmVNYXBVdlRyYW5zZm9ybSk7XG4gICAgdGhpcy5fdXBkYXRlVGV4dHVyZU1hdHJpeCh0aGlzLnVuaWZvcm1zLnNoYWRlTXVsdGlwbHlUZXh0dXJlLCB0aGlzLnVuaWZvcm1zLnNoYWRlTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm0pO1xuICAgIHRoaXMuX3VwZGF0ZVRleHR1cmVNYXRyaXgodGhpcy51bmlmb3Jtcy5zaGFkaW5nU2hpZnRUZXh0dXJlLCB0aGlzLnVuaWZvcm1zLnNoYWRpbmdTaGlmdFRleHR1cmVVdlRyYW5zZm9ybSk7XG4gICAgdGhpcy5fdXBkYXRlVGV4dHVyZU1hdHJpeCh0aGlzLnVuaWZvcm1zLm1hdGNhcFRleHR1cmUsIHRoaXMudW5pZm9ybXMubWF0Y2FwVGV4dHVyZVV2VHJhbnNmb3JtKTtcbiAgICB0aGlzLl91cGRhdGVUZXh0dXJlTWF0cml4KHRoaXMudW5pZm9ybXMucmltTXVsdGlwbHlUZXh0dXJlLCB0aGlzLnVuaWZvcm1zLnJpbU11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtKTtcbiAgICB0aGlzLl91cGRhdGVUZXh0dXJlTWF0cml4KFxuICAgICAgdGhpcy51bmlmb3Jtcy5vdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmUsXG4gICAgICB0aGlzLnVuaWZvcm1zLm91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtLFxuICAgICk7XG4gICAgdGhpcy5fdXBkYXRlVGV4dHVyZU1hdHJpeCh0aGlzLnVuaWZvcm1zLnV2QW5pbWF0aW9uTWFza1RleHR1cmUsIHRoaXMudW5pZm9ybXMudXZBbmltYXRpb25NYXNrVGV4dHVyZVV2VHJhbnNmb3JtKTtcblxuICAgIHRoaXMudW5pZm9ybXNOZWVkVXBkYXRlID0gdHJ1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgbWFwIG9iamVjdCBvZiBwcmVwcm9jZXNzb3IgdG9rZW4gYW5kIG1hY3JvIG9mIHRoZSBzaGFkZXIgcHJvZ3JhbS5cbiAgICovXG4gIHByaXZhdGUgX2dlbmVyYXRlRGVmaW5lcygpOiB7IFt0b2tlbjogc3RyaW5nXTogYm9vbGVhbiB8IG51bWJlciB8IHN0cmluZyB9IHtcbiAgICBjb25zdCB0aHJlZVJldmlzaW9uID0gcGFyc2VJbnQoVEhSRUUuUkVWSVNJT04sIDEwKTtcblxuICAgIGNvbnN0IHVzZVV2SW5WZXJ0ID0gdGhpcy5vdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmUgIT09IG51bGw7XG4gICAgY29uc3QgdXNlVXZJbkZyYWcgPVxuICAgICAgdGhpcy5tYXAgIT09IG51bGwgfHxcbiAgICAgIHRoaXMubm9ybWFsTWFwICE9PSBudWxsIHx8XG4gICAgICB0aGlzLmVtaXNzaXZlTWFwICE9PSBudWxsIHx8XG4gICAgICB0aGlzLnNoYWRlTXVsdGlwbHlUZXh0dXJlICE9PSBudWxsIHx8XG4gICAgICB0aGlzLnNoYWRpbmdTaGlmdFRleHR1cmUgIT09IG51bGwgfHxcbiAgICAgIHRoaXMucmltTXVsdGlwbHlUZXh0dXJlICE9PSBudWxsIHx8XG4gICAgICB0aGlzLnV2QW5pbWF0aW9uTWFza1RleHR1cmUgIT09IG51bGw7XG5cbiAgICByZXR1cm4ge1xuICAgICAgLy8gVGVtcG9yYXJ5IGNvbXBhdCBhZ2FpbnN0IHNoYWRlciBjaGFuZ2UgQCBUaHJlZS5qcyByMTI2XG4gICAgICAvLyBTZWU6ICMyMTIwNSwgIzIxMzA3LCAjMjEyOTlcbiAgICAgIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTjogdGhyZWVSZXZpc2lvbixcblxuICAgICAgT1VUTElORTogdGhpcy5faXNPdXRsaW5lLFxuICAgICAgTVRPT05fVVNFX1VWOiB1c2VVdkluVmVydCB8fCB1c2VVdkluRnJhZywgLy8gd2UgY2FuJ3QgdXNlIGBVU0VfVVZgICwgaXQgd2lsbCBiZSByZWRlZmluZWQgaW4gV2ViR0xQcm9ncmFtLmpzXG4gICAgICBNVE9PTl9VVlNfVkVSVEVYX09OTFk6IHVzZVV2SW5WZXJ0ICYmICF1c2VVdkluRnJhZyxcbiAgICAgIFYwX0NPTVBBVF9TSEFERTogdGhpcy5fdjBDb21wYXRTaGFkZSxcbiAgICAgIFVTRV9TSEFERU1VTFRJUExZVEVYVFVSRTogdGhpcy5zaGFkZU11bHRpcGx5VGV4dHVyZSAhPT0gbnVsbCxcbiAgICAgIFVTRV9TSEFESU5HU0hJRlRURVhUVVJFOiB0aGlzLnNoYWRpbmdTaGlmdFRleHR1cmUgIT09IG51bGwsXG4gICAgICBVU0VfTUFUQ0FQVEVYVFVSRTogdGhpcy5tYXRjYXBUZXh0dXJlICE9PSBudWxsLFxuICAgICAgVVNFX1JJTU1VTFRJUExZVEVYVFVSRTogdGhpcy5yaW1NdWx0aXBseVRleHR1cmUgIT09IG51bGwsXG4gICAgICBVU0VfT1VUTElORVdJRFRITVVMVElQTFlURVhUVVJFOiB0aGlzLl9pc091dGxpbmUgJiYgdGhpcy5vdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmUgIT09IG51bGwsXG4gICAgICBVU0VfVVZBTklNQVRJT05NQVNLVEVYVFVSRTogdGhpcy51dkFuaW1hdGlvbk1hc2tUZXh0dXJlICE9PSBudWxsLFxuICAgICAgSUdOT1JFX1ZFUlRFWF9DT0xPUjogdGhpcy5faWdub3JlVmVydGV4Q29sb3IgPT09IHRydWUsXG4gICAgICBERUJVR19OT1JNQUw6IHRoaXMuX2RlYnVnTW9kZSA9PT0gJ25vcm1hbCcsXG4gICAgICBERUJVR19MSVRTSEFERVJBVEU6IHRoaXMuX2RlYnVnTW9kZSA9PT0gJ2xpdFNoYWRlUmF0ZScsXG4gICAgICBERUJVR19VVjogdGhpcy5fZGVidWdNb2RlID09PSAndXYnLFxuICAgICAgT1VUTElORV9XSURUSF9TQ1JFRU46XG4gICAgICAgIHRoaXMuX2lzT3V0bGluZSAmJiB0aGlzLl9vdXRsaW5lV2lkdGhNb2RlID09PSBNVG9vbk1hdGVyaWFsT3V0bGluZVdpZHRoTW9kZS5TY3JlZW5Db29yZGluYXRlcyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlVGV4dHVyZU1hdHJpeChzcmM6IFRIUkVFLklVbmlmb3JtPFRIUkVFLlRleHR1cmUgfCBudWxsPiwgZHN0OiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5NYXRyaXgzPik6IHZvaWQge1xuICAgIGlmIChzcmMudmFsdWUpIHtcbiAgICAgIGlmIChzcmMudmFsdWUubWF0cml4QXV0b1VwZGF0ZSkge1xuICAgICAgICBzcmMudmFsdWUudXBkYXRlTWF0cml4KCk7XG4gICAgICB9XG5cbiAgICAgIGRzdC52YWx1ZS5jb3B5KHNyYy52YWx1ZS5tYXRyaXgpO1xuICAgIH1cbiAgfVxufVxuIiwgIi8vICNkZWZpbmUgUEhPTkdcblxudmFyeWluZyB2ZWMzIHZWaWV3UG9zaXRpb247XG5cbiNpZm5kZWYgRkxBVF9TSEFERURcbiAgdmFyeWluZyB2ZWMzIHZOb3JtYWw7XG4jZW5kaWZcblxuI2luY2x1ZGUgPGNvbW1vbj5cblxuLy8gI2luY2x1ZGUgPHV2X3BhcnNfdmVydGV4PlxuI2lmZGVmIE1UT09OX1VTRV9VVlxuICB2YXJ5aW5nIHZlYzIgdlV2O1xuXG4gIC8vIENPTVBBVDogcHJlLXIxNTEgdXNlcyBhIGNvbW1vbiB1dlRyYW5zZm9ybVxuICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OIDwgMTUxXG4gICAgdW5pZm9ybSBtYXQzIHV2VHJhbnNmb3JtO1xuICAjZW5kaWZcbiNlbmRpZlxuXG4vLyAjaW5jbHVkZSA8dXYyX3BhcnNfdmVydGV4PlxuLy8gQ09NQVBUOiBwcmUtcjE1MSB1c2VzIHV2MiBmb3IgbGlnaHRNYXAgYW5kIGFvTWFwXG4jaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OIDwgMTUxXG4gICNpZiBkZWZpbmVkKCBVU0VfTElHSFRNQVAgKSB8fCBkZWZpbmVkKCBVU0VfQU9NQVAgKVxuICAgIGF0dHJpYnV0ZSB2ZWMyIHV2MjtcbiAgICB2YXJ5aW5nIHZlYzIgdlV2MjtcbiAgICB1bmlmb3JtIG1hdDMgdXYyVHJhbnNmb3JtO1xuICAjZW5kaWZcbiNlbmRpZlxuXG4vLyAjaW5jbHVkZSA8ZGlzcGxhY2VtZW50bWFwX3BhcnNfdmVydGV4PlxuLy8gI2luY2x1ZGUgPGVudm1hcF9wYXJzX3ZlcnRleD5cbiNpbmNsdWRlIDxjb2xvcl9wYXJzX3ZlcnRleD5cbiNpbmNsdWRlIDxmb2dfcGFyc192ZXJ0ZXg+XG4jaW5jbHVkZSA8bW9ycGh0YXJnZXRfcGFyc192ZXJ0ZXg+XG4jaW5jbHVkZSA8c2tpbm5pbmdfcGFyc192ZXJ0ZXg+XG4jaW5jbHVkZSA8c2hhZG93bWFwX3BhcnNfdmVydGV4PlxuI2luY2x1ZGUgPGxvZ2RlcHRoYnVmX3BhcnNfdmVydGV4PlxuI2luY2x1ZGUgPGNsaXBwaW5nX3BsYW5lc19wYXJzX3ZlcnRleD5cblxuI2lmZGVmIFVTRV9PVVRMSU5FV0lEVEhNVUxUSVBMWVRFWFRVUkVcbiAgdW5pZm9ybSBzYW1wbGVyMkQgb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlO1xuICB1bmlmb3JtIG1hdDMgb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm07XG4jZW5kaWZcblxudW5pZm9ybSBmbG9hdCBvdXRsaW5lV2lkdGhGYWN0b3I7XG5cbnZvaWQgbWFpbigpIHtcblxuICAvLyAjaW5jbHVkZSA8dXZfdmVydGV4PlxuICAjaWZkZWYgTVRPT05fVVNFX1VWXG4gICAgLy8gQ09NUEFUOiBwcmUtcjE1MSB1c2VzIGEgY29tbW9uIHV2VHJhbnNmb3JtXG4gICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTFcbiAgICAgIHZVdiA9IHV2O1xuICAgICNlbHNlXG4gICAgICB2VXYgPSAoIHV2VHJhbnNmb3JtICogdmVjMyggdXYsIDEgKSApLnh5O1xuICAgICNlbmRpZlxuICAjZW5kaWZcblxuICAvLyAjaW5jbHVkZSA8dXYyX3ZlcnRleD5cbiAgLy8gQ09NQVBUOiBwcmUtcjE1MSB1c2VzIHV2MiBmb3IgbGlnaHRNYXAgYW5kIGFvTWFwXG4gICNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPCAxNTFcbiAgICAjaWYgZGVmaW5lZCggVVNFX0xJR0hUTUFQICkgfHwgZGVmaW5lZCggVVNFX0FPTUFQIClcbiAgICAgIHZVdjIgPSAoIHV2MlRyYW5zZm9ybSAqIHZlYzMoIHV2MiwgMSApICkueHk7XG4gICAgI2VuZGlmXG4gICNlbmRpZlxuXG4gICNpbmNsdWRlIDxjb2xvcl92ZXJ0ZXg+XG5cbiAgI2luY2x1ZGUgPGJlZ2lubm9ybWFsX3ZlcnRleD5cbiAgI2luY2x1ZGUgPG1vcnBobm9ybWFsX3ZlcnRleD5cbiAgI2luY2x1ZGUgPHNraW5iYXNlX3ZlcnRleD5cbiAgI2luY2x1ZGUgPHNraW5ub3JtYWxfdmVydGV4PlxuXG4gIC8vIHdlIG5lZWQgdGhpcyB0byBjb21wdXRlIHRoZSBvdXRsaW5lIHByb3Blcmx5XG4gIG9iamVjdE5vcm1hbCA9IG5vcm1hbGl6ZSggb2JqZWN0Tm9ybWFsICk7XG5cbiAgI2luY2x1ZGUgPGRlZmF1bHRub3JtYWxfdmVydGV4PlxuXG4gICNpZm5kZWYgRkxBVF9TSEFERUQgLy8gTm9ybWFsIGNvbXB1dGVkIHdpdGggZGVyaXZhdGl2ZXMgd2hlbiBGTEFUX1NIQURFRFxuICAgIHZOb3JtYWwgPSBub3JtYWxpemUoIHRyYW5zZm9ybWVkTm9ybWFsICk7XG4gICNlbmRpZlxuXG4gICNpbmNsdWRlIDxiZWdpbl92ZXJ0ZXg+XG5cbiAgI2luY2x1ZGUgPG1vcnBodGFyZ2V0X3ZlcnRleD5cbiAgI2luY2x1ZGUgPHNraW5uaW5nX3ZlcnRleD5cbiAgLy8gI2luY2x1ZGUgPGRpc3BsYWNlbWVudG1hcF92ZXJ0ZXg+XG4gICNpbmNsdWRlIDxwcm9qZWN0X3ZlcnRleD5cbiAgI2luY2x1ZGUgPGxvZ2RlcHRoYnVmX3ZlcnRleD5cbiAgI2luY2x1ZGUgPGNsaXBwaW5nX3BsYW5lc192ZXJ0ZXg+XG5cbiAgdlZpZXdQb3NpdGlvbiA9IC0gbXZQb3NpdGlvbi54eXo7XG5cbiAgI2lmZGVmIE9VVExJTkVcbiAgICBmbG9hdCB3b3JsZE5vcm1hbExlbmd0aCA9IGxlbmd0aCggdHJhbnNmb3JtZWROb3JtYWwgKTtcbiAgICB2ZWMzIG91dGxpbmVPZmZzZXQgPSBvdXRsaW5lV2lkdGhGYWN0b3IgKiB3b3JsZE5vcm1hbExlbmd0aCAqIG9iamVjdE5vcm1hbDtcblxuICAgICNpZmRlZiBVU0VfT1VUTElORVdJRFRITVVMVElQTFlURVhUVVJFXG4gICAgICB2ZWMyIG91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZVV2ID0gKCBvdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmVVdlRyYW5zZm9ybSAqIHZlYzMoIHZVdiwgMSApICkueHk7XG4gICAgICBmbG9hdCBvdXRsaW5lVGV4ID0gdGV4dHVyZTJEKCBvdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmUsIG91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZVV2ICkuZztcbiAgICAgIG91dGxpbmVPZmZzZXQgKj0gb3V0bGluZVRleDtcbiAgICAjZW5kaWZcblxuICAgICNpZmRlZiBPVVRMSU5FX1dJRFRIX1NDUkVFTlxuICAgICAgLy8gXHU4REREXHU3OUJCXHU4MUVBXHU5MDAyXHU1RTk0XHU5NjUwXHU1MjM2XHVGRjBDXHU5MDdGXHU1MTREXHU4RkRDXHU2NjZGXHU2M0NGXHU4RkI5XHU1M0Q4XHU3Qzk3XHU5RUQxXHU1NkUyXHVGRjBDXHU4RkQxXHU2NjZGXHU3QTdGXHU2M0QyXHU2NUFEXHU1QzQyXG4gICAgICBmbG9hdCBvdXRsaW5lRGlzdCA9IGNsYW1wKCB2Vmlld1Bvc2l0aW9uLnosIDAuNDUsIDUuMCApO1xuICAgICAgb3V0bGluZU9mZnNldCAqPSBvdXRsaW5lRGlzdCAvIHByb2plY3Rpb25NYXRyaXhbIDEgXS55O1xuICAgICNlbmRpZlxuXG4gICAgZ2xfUG9zaXRpb24gPSBwcm9qZWN0aW9uTWF0cml4ICogbW9kZWxWaWV3TWF0cml4ICogdmVjNCggb3V0bGluZU9mZnNldCArIHRyYW5zZm9ybWVkLCAxLjAgKTtcblxuICAgIGdsX1Bvc2l0aW9uLnogKz0gMUUtNiAqIGdsX1Bvc2l0aW9uLnc7IC8vIGFudGktYXJ0aWZhY3QgbWFnaWNcbiAgI2VuZGlmXG5cbiAgI2luY2x1ZGUgPHdvcmxkcG9zX3ZlcnRleD5cbiAgLy8gI2luY2x1ZGUgPGVudm1hcF92ZXJ0ZXg+XG4gICNpbmNsdWRlIDxzaGFkb3dtYXBfdmVydGV4PlxuICAjaW5jbHVkZSA8Zm9nX3ZlcnRleD5cblxufSIsICIvLyAjZGVmaW5lIFBIT05HXG5cbnVuaWZvcm0gdmVjMyBsaXRGYWN0b3I7XG5cbnVuaWZvcm0gZmxvYXQgb3BhY2l0eTtcblxudW5pZm9ybSB2ZWMzIHNoYWRlQ29sb3JGYWN0b3I7XG4jaWZkZWYgVVNFX1NIQURFTVVMVElQTFlURVhUVVJFXG4gIHVuaWZvcm0gc2FtcGxlcjJEIHNoYWRlTXVsdGlwbHlUZXh0dXJlO1xuICB1bmlmb3JtIG1hdDMgc2hhZGVNdWx0aXBseVRleHR1cmVVdlRyYW5zZm9ybTtcbiNlbmRpZlxuXG51bmlmb3JtIGZsb2F0IHNoYWRpbmdTaGlmdEZhY3RvcjtcbnVuaWZvcm0gZmxvYXQgc2hhZGluZ1Rvb255RmFjdG9yO1xuXG4jaWZkZWYgVVNFX1NIQURJTkdTSElGVFRFWFRVUkVcbiAgdW5pZm9ybSBzYW1wbGVyMkQgc2hhZGluZ1NoaWZ0VGV4dHVyZTtcbiAgdW5pZm9ybSBtYXQzIHNoYWRpbmdTaGlmdFRleHR1cmVVdlRyYW5zZm9ybTtcbiAgdW5pZm9ybSBmbG9hdCBzaGFkaW5nU2hpZnRUZXh0dXJlU2NhbGU7XG4jZW5kaWZcblxudW5pZm9ybSBmbG9hdCBnaUVxdWFsaXphdGlvbkZhY3RvcjtcblxudW5pZm9ybSB2ZWMzIHBhcmFtZXRyaWNSaW1Db2xvckZhY3RvcjtcbiNpZmRlZiBVU0VfUklNTVVMVElQTFlURVhUVVJFXG4gIHVuaWZvcm0gc2FtcGxlcjJEIHJpbU11bHRpcGx5VGV4dHVyZTtcbiAgdW5pZm9ybSBtYXQzIHJpbU11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtO1xuI2VuZGlmXG51bmlmb3JtIGZsb2F0IHJpbUxpZ2h0aW5nTWl4RmFjdG9yO1xudW5pZm9ybSBmbG9hdCBwYXJhbWV0cmljUmltRnJlc25lbFBvd2VyRmFjdG9yO1xudW5pZm9ybSBmbG9hdCBwYXJhbWV0cmljUmltTGlmdEZhY3RvcjtcblxuLy8gRXh0ZW5kZWQgTVRvb24gdHVuaW5nIHBhcmFtZXRlcnNcbnVuaWZvcm0gZmxvYXQgc29mdE1peDsgICAgICAgICAgIC8vIDAuLjEgYmxlbmQgdG93YXJkIGhhbGYtTGFtYmVydCBzb2Z0IHBhdGggKGRlZmF1bHQgfjAuOTUpXG51bmlmb3JtIGZsb2F0IGJsdXJCb29zdDsgICAgICAgICAvLyBleHRyYSB0b29uIGJsdXIgd2lkdGggaW4gaGFsZi1MYW1iZXJ0IHNwYWNlIChkZWZhdWx0IH4wLjMyKVxudW5pZm9ybSBmbG9hdCBzaGFkb3cybmRTdHJlbmd0aDsgLy8gMC4uMSBvcHRpb25hbCAybmQgc2hhZG93IGJhbmQgKGRlZmF1bHQgfjAuNjUpXG51bmlmb3JtIGZsb2F0IHNoYWRvdzJuZEJvcmRlcjsgICAvLyBoYWxmLUxhbWJlcnQgYm9yZGVyIGZvciAybmQgYmFuZCAoZGVmYXVsdCB+MC4zMilcbnVuaWZvcm0gZmxvYXQgc2hhZG93Mm5kQmx1cjsgICAgIC8vIDJuZCBiYW5kIGJsdXIgKGRlZmF1bHQgfjAuMTYpXG51bmlmb3JtIHZlYzMgc2hhZG93Mm5kQ29sb3I7ICAgICAvLyBwdXJwbGUtZ3JheSB0aW50IFx1MjI0OCBOUFIgX1NoYWRvd0NvbG9yIHZpYmVcbnVuaWZvcm0gZmxvYXQgc2hhZG93M3JkU3RyZW5ndGg7IC8vIGxpZ2h0IDNyZCBiYW5kIChkZWZhdWx0IH4wLjI4OyAwID0gb2ZmKVxudW5pZm9ybSBmbG9hdCBzaGFkb3czcmRCb3JkZXI7ICAgLy8gaGFsZi1MYW1iZXJ0IGJvcmRlciBmb3IgM3JkIGJhbmQgKGRlZmF1bHQgfjAuMTQpXG51bmlmb3JtIGZsb2F0IHNoYWRvdzNyZEJsdXI7ICAgICAvLyAzcmQgYmFuZCBibHVyIChkZWZhdWx0IH4wLjExKVxudW5pZm9ybSB2ZWMzIHNoYWRvdzNyZENvbG9yOyAgICAgLy8gZGVlcGVyIGNvb2wgcHVycGxlLWdyYXlcbnVuaWZvcm0gZmxvYXQgcmltQm9vc3Q7ICAgICAgICAgIC8vIG11bHRpcGx5IHJpbSBhZnRlciB0b29uIHNjYWxlIChkZWZhdWx0IH4xLjQpXG51bmlmb3JtIGZsb2F0IHJpbUJvcmRlcjsgICAgICAgICAvLyBzb2Z0LWxpa2UgcmltIGJvcmRlciBpbiBGcmVzbmVsIFswLDFdIChkZWZhdWx0IH4wLjUpXG51bmlmb3JtIGZsb2F0IHJpbUJsdXI7ICAgICAgICAgICAvLyBzb2Z0LWxpa2UgcmltIGJsdXIgd2lkdGggKGRlZmF1bHQgfjAuMTgpXG51bmlmb3JtIGZsb2F0IHJpbURpclN0cmVuZ3RoOyAgICAvLyBkaXJlY3Rpb25hbCByaW0gKE5cdTAwQjdMIGluZmx1ZW5jZSk7IDAgPSBpc290cm9waWMgKGRlZmF1bHQgfjAuMzUpXG51bmlmb3JtIGZsb2F0IGhhaXJTcGVjU3RyZW5ndGg7ICAvLyBhbmlzb3Ryb3BpYyAvIGFuZ2VsLXJpbmcgaGlnaGxpZ2h0IChkZWZhdWx0IH4wLjE0OyBoYWlyIG1hbmFnZXIgXHUyMTkxKVxudW5pZm9ybSBmbG9hdCBoYWlyU3BlY1Bvd2VyOyAgICAgLy8gaGlnaGxpZ2h0IHNoYXJwbmVzcyAoZGVmYXVsdCB+NTYpXG51bmlmb3JtIGZsb2F0IGhhaXJTcGVjU2hpZnQ7ICAgICAvLyBwcmltYXJ5IGxvYmUgc2hpZnQgYWxvbmcgdGFuZ2VudCAoZGVmYXVsdCB+LTAuMSlcbnVuaWZvcm0gZmxvYXQgY2xvdGhTcGVjU3RyZW5ndGg7IC8vIEdHWC1pc2ggaXNvdHJvcGljIGNsb3RoL3NhdGluIChkZWZhdWx0IDA7IG1hbmFnZXIgc2V0cylcbnVuaWZvcm0gZmxvYXQgY2xvdGhTcGVjUG93ZXI7ICAgIC8vIGNsb3RoIHJvdWdobmVzcyBpbnZlcnNlIHByb3h5IFx1MjE5MiBwb3dlciAoZGVmYXVsdCB+NzIpXG51bmlmb3JtIGZsb2F0IG1hdGNhcDJuZFN0cmVuZ3RoOyAvLyBjaGVhcCAybmQgTWF0Q2FwOiByZXNhbXBsZSBzaGlmdGVkIFVWIChkZWZhdWx0IH4wLjI1IHdoZW4gbWF0Y2FwIG9uKVxudW5pZm9ybSBmbG9hdCBza2luU3BlY1N0cmVuZ3RoOyAgLy8gaXNvdHJvcGljIG1vaXN0IHNraW4gc3BlY3VsYXIgKGRlZmF1bHQgMDsgZmFjZS9ib2R5IG1hbmFnZXIgXHUyMTkxKVxudW5pZm9ybSBmbG9hdCBza2luU3BlY1Bvd2VyOyAgICAgLy8gYnJvYWQgaGlnaGxpZ2h0IHNoYXJwbmVzcyAoZGVmYXVsdCB+Mjg7IGxvd2VyID0gd2V0dGVyL3NvZnRlcilcbnVuaWZvcm0gZmxvYXQgc2tpblNwZWNGcmVzbmVsOyAgIC8vIG1pbGQgZ3JhemluZyBzaGVlbiAwLi4xIChoeWRyYXRlZCwgbm90IG9pbHkpXG51bmlmb3JtIHZlYzMgc2tpblNwZWNDb2xvcjsgICAgICAvLyB3YXJtIHNwZWN1bGFyIHRpbnRcbnVuaWZvcm0gZmxvYXQgYW1iaWVudExpZnQ7ICAgICAgIC8vIGJyaWdodGVuIGluZGlyZWN0IC8gc29mdC1saXQgYW1iaWVudCAoc29mdC1pc2gpXG51bmlmb3JtIGZsb2F0IHNoYWRlTWFpblN0cmVuZ3RoOyAvLyBtaXggc2hhZGUgdG93YXJkIHNoYWRlKmFsYmVkbyAoTlBSIF9TaGFkb3dNYWluU3RyZW5ndGgpXG51bmlmb3JtIGZsb2F0IHNoYWRvd0JvcmRlcjsgICAgICAvLyBleHBsaWNpdCBOUFIgcHJpbWFyeSBib3JkZXIgaW4gSEwgWzAsMV07IDwwIFx1MjE5MiBkZXJpdmUgZnJvbSBzaGlmdFxudW5pZm9ybSBmbG9hdCBzaGFkb3dCbHVyOyAgICAgICAgLy8gZXhwbGljaXQgTlBSIHByaW1hcnkgYmx1cjsgPD0wIFx1MjE5MiB0b29ueStib29zdCBvbmx5XG51bmlmb3JtIGZsb2F0IHJpbU1haW5TdHJlbmd0aDsgICAvLyBtaXggcmltIGNvbG9yIHRvd2FyZCBhbGJlZG8gKE5QUiBfUmltTWFpblN0cmVuZ3RoKVxudW5pZm9ybSBmbG9hdCByaW1TaGFkb3dNYXNrOyAgICAgLy8gYXR0ZW51YXRlIHJpbSBpbiBkZWVwIHNoYWRlIDAuLjFcblxuLy8gLS0tIEV4dGVuZGVkIHNoYWRpbmcga25vYnMgKG11bHRpLWJhbmQgc2hhZG93LCBzcGVjdWxhciwgcmVmbGVjdGlvbiwgYmFja2xpZ2h0KSAtLS1cbnVuaWZvcm0gZmxvYXQgc3BlY3VsYXJTdHJlbmd0aDsgICAvLyBsaWxDYWxjU3BlY3VsYXItbGlrZSB0b29uIHNwZWN1bGFyIChtZXRhbGxpYy9zbW9vdGhuZXNzIHByb3h5KVxudW5pZm9ybSBmbG9hdCBzcGVjdWxhclBvd2VyOyAgICAgIC8vIEJsaW5uIHBvd2VyIC8gaW52ZXJzZSByb3VnaG5lc3MgcHJveHlcbnVuaWZvcm0gZmxvYXQgc3BlY3VsYXJCb3JkZXI7ICAgICAvLyB0b29uIHNwZWN1bGFyIGJvcmRlclxudW5pZm9ybSBmbG9hdCBzcGVjdWxhckJsdXI7ICAgICAgIC8vIHRvb24gc3BlY3VsYXIgYmx1clxudW5pZm9ybSBmbG9hdCByZWZsZWN0U3RyZW5ndGg7ICAgIC8vIHZpZXctZGVwZW5kZW50IGVudiByZWZsZWN0aW9uIGFwcHJveCAobm8gY3ViZW1hcClcbnVuaWZvcm0gZmxvYXQgcmVmbGVjdEZyZXNuZWw7ICAgICAvLyBmcmVzbmVsIGFtb3VudCBmb3IgZW52IGFwcHJveFxudW5pZm9ybSBmbG9hdCByZWZsZWN0TWV0YWxsaWM7ICAgIC8vIDAgZGllbGVjdHJpYyAuLiAxIG1ldGFsIHRpbnQgdG93YXJkIGFsYmVkb1xudW5pZm9ybSBmbG9hdCByZWZsZWN0U21vb3RobmVzczsgIC8vIHNoYXJwZXIgZ3JhemluZyByZWZsZWN0aW9uIHdoZW4gaGlnaFxudW5pZm9ybSBmbG9hdCBiYWNrbGlnaHRTdHJlbmd0aDsgIC8vIE5QUiBiYWNrbGlnaHQgYXBwcm94ICh3cmFwIC8gb3Bwb3NpdGUgbGlnaHQpXG51bmlmb3JtIHZlYzMgIGJhY2tsaWdodENvbG9yOyAgICAgLy8gYmFja2xpZ2h0IHRpbnRcbnVuaWZvcm0gZmxvYXQgcmltRnJlc25lbFBvd2VyOyAgICAvLyA+MCBvdmVycmlkZXMgcGFyYW1ldHJpYyByaW0gZnJlc25lbCBwb3dlclxudW5pZm9ybSBmbG9hdCByaW1JbmRpclN0cmVuZ3RoOyAgIC8vIG9wcG9zaXRlLXNpZGUgcmltIChOUFIgUmltSW5kaXIpXG51bmlmb3JtIGZsb2F0IG1hdGNhcDJuZENvbnRyYXN0OyAgLy8gPjEgc3RyZW5ndGhlbnMgc3ludGhlc2l6ZWQgMm5kIG1hdGNhcFxudW5pZm9ybSBmbG9hdCBtYXRjYXAybmRTY2FsZTsgICAgIC8vIFVWIHNjYWxlIGZvciAybmQgbWF0Y2FwIHJlc2FtcGxlXG51bmlmb3JtIGZsb2F0IGVtaXNzaW9uQm9vc3Q7ICAgICAgLy8gc2NhbGUgc3RvY2sgZW1pc3NpdmUgKE5QUiBlbWlzc2lvbiBmZWVsKVxudW5pZm9ybSBmbG9hdCBkaXN0YW5jZUZhZGU7ICAgICAgIC8vIHN1YnRsZSBjYW1lcmEtZGlzdGFuY2Ugc29mdCBsaWZ0L2ZhZGUgMC4uMVxudW5pZm9ybSBmbG9hdCBmYWNlU29mdDsgICAgICAgICAgIC8vIGZhY2UgcHJlc2V0OiBzb2Z0ZXIgcHJpbWFyeSBib3JkZXIgdmlhIHNoYWRpbmdTaGlmdFxudW5pZm9ybSBmbG9hdCBub3JtYWxTa2luQm9vc3Q7ICAgIC8vIGFtcGxpZnkgbm9ybWFsIG1hcCBjb250cmlidXRpb24gZm9yIHNraW4gZGVwdGhcbnVuaWZvcm0gZmxvYXQgZW52U3RyZW5ndGg7ICAgICAgICAvLyBOUFIgX1NoYWRvd0VudlN0cmVuZ3RoLWxpa2UgaW5kaXJlY3QgaW4gc2hhZGVcbnVuaWZvcm0gZmxvYXQgZ2VtRnJlc25lbDsgICAgICAgICAvLyBnZW0taXNoIGZyZXNuZWwgcHJveHkgKHNhZmU7IG9mZiBieSBkZWZhdWx0KVxudW5pZm9ybSBmbG9hdCBvdXRsaW5lTWl4OyAgICAgICAgIC8vIGNvb3BlcmF0ZSB3aXRoIG91dGxpbmUgcGFzcyBsaWdodGluZyBtaXggKDw9IHN0b2NrKVxudW5pZm9ybSBmbG9hdCByZWNlaXZlU2hhZG93UmF0ZTsgICAvLyAwLjAgPSBpZ25vcmUgc2hhZG93IG1hcCAoY2xlYW4gYW5pbWUgZmFjZSksIDEuMCA9IGZ1bGwgc2hhZG93XG51bmlmb3JtIGZsb2F0IGZhYnJpY1NoZWVuU3RyZW5ndGg7IC8vIGNsb3RoIGdyYXppbmcgc2hlZW4gc3RyZW5ndGhcbnVuaWZvcm0gZmxvYXQgZmFicmljU2hlZW5Qb3dlcjsgICAgLy8gY2xvdGggZ3JhemluZyBzaGVlbiBmYWxsb2ZmIHBvd2VyIChkZWZhdWx0IH4zLjUpXG51bmlmb3JtIHZlYzMgZmFicmljU2hlZW5Db2xvcjsgICAgIC8vIGNsb3RoIGdyYXppbmcgc2hlZW4gdGludFxuXG4jaWZkZWYgVVNFX01BVENBUFRFWFRVUkVcbiAgdW5pZm9ybSB2ZWMzIG1hdGNhcEZhY3RvcjtcbiAgdW5pZm9ybSBzYW1wbGVyMkQgbWF0Y2FwVGV4dHVyZTtcbiAgdW5pZm9ybSBtYXQzIG1hdGNhcFRleHR1cmVVdlRyYW5zZm9ybTtcbiNlbmRpZlxuXG51bmlmb3JtIHZlYzMgZW1pc3NpdmU7XG51bmlmb3JtIGZsb2F0IGVtaXNzaXZlSW50ZW5zaXR5O1xuXG51bmlmb3JtIHZlYzMgb3V0bGluZUNvbG9yRmFjdG9yO1xudW5pZm9ybSBmbG9hdCBvdXRsaW5lTGlnaHRpbmdNaXhGYWN0b3I7XG5cbiNpZmRlZiBVU0VfVVZBTklNQVRJT05NQVNLVEVYVFVSRVxuICB1bmlmb3JtIHNhbXBsZXIyRCB1dkFuaW1hdGlvbk1hc2tUZXh0dXJlO1xuICB1bmlmb3JtIG1hdDMgdXZBbmltYXRpb25NYXNrVGV4dHVyZVV2VHJhbnNmb3JtO1xuI2VuZGlmXG5cbnVuaWZvcm0gZmxvYXQgdXZBbmltYXRpb25TY3JvbGxYT2Zmc2V0O1xudW5pZm9ybSBmbG9hdCB1dkFuaW1hdGlvblNjcm9sbFlPZmZzZXQ7XG51bmlmb3JtIGZsb2F0IHV2QW5pbWF0aW9uUm90YXRpb25QaGFzZTtcblxuI2luY2x1ZGUgPGNvbW1vbj5cbiNpbmNsdWRlIDxwYWNraW5nPlxuI2luY2x1ZGUgPGRpdGhlcmluZ19wYXJzX2ZyYWdtZW50PlxuI2luY2x1ZGUgPGNvbG9yX3BhcnNfZnJhZ21lbnQ+XG5cbi8vICNpbmNsdWRlIDx1dl9wYXJzX2ZyYWdtZW50PlxuI2lmICggZGVmaW5lZCggTVRPT05fVVNFX1VWICkgJiYgIWRlZmluZWQoIE1UT09OX1VWU19WRVJURVhfT05MWSApIClcbiAgdmFyeWluZyB2ZWMyIHZVdjtcbiNlbmRpZlxuXG4vLyAjaW5jbHVkZSA8dXYyX3BhcnNfZnJhZ21lbnQ+XG4vLyBDT01BUFQ6IHByZS1yMTUxIHVzZXMgdXYyIGZvciBsaWdodE1hcCBhbmQgYW9NYXBcbiNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPCAxNTFcbiAgI2lmIGRlZmluZWQoIFVTRV9MSUdIVE1BUCApIHx8IGRlZmluZWQoIFVTRV9BT01BUCApXG4gICAgdmFyeWluZyB2ZWMyIHZVdjI7XG4gICNlbmRpZlxuI2VuZGlmXG5cbiNpbmNsdWRlIDxtYXBfcGFyc19mcmFnbWVudD5cblxuI2lmZGVmIFVTRV9NQVBcbiAgdW5pZm9ybSBtYXQzIG1hcFV2VHJhbnNmb3JtO1xuI2VuZGlmXG5cbi8vICNpbmNsdWRlIDxhbHBoYW1hcF9wYXJzX2ZyYWdtZW50PlxuXG4jaW5jbHVkZSA8YWxwaGF0ZXN0X3BhcnNfZnJhZ21lbnQ+XG5cbiNpbmNsdWRlIDxhb21hcF9wYXJzX2ZyYWdtZW50PlxuLy8gI2luY2x1ZGUgPGxpZ2h0bWFwX3BhcnNfZnJhZ21lbnQ+XG4jaW5jbHVkZSA8ZW1pc3NpdmVtYXBfcGFyc19mcmFnbWVudD5cblxuI2lmZGVmIFVTRV9FTUlTU0lWRU1BUFxuICB1bmlmb3JtIG1hdDMgZW1pc3NpdmVNYXBVdlRyYW5zZm9ybTtcbiNlbmRpZlxuXG4vLyAjaW5jbHVkZSA8ZW52bWFwX2NvbW1vbl9wYXJzX2ZyYWdtZW50PlxuLy8gI2luY2x1ZGUgPGVudm1hcF9wYXJzX2ZyYWdtZW50PlxuLy8gI2luY2x1ZGUgPGN1YmVfdXZfcmVmbGVjdGlvbl9mcmFnbWVudD5cbiNpbmNsdWRlIDxmb2dfcGFyc19mcmFnbWVudD5cblxuLy8gI2luY2x1ZGUgPGJzZGZzPlxuLy8gQ09NUEFUOiBwcmUtcjE1MSBkb2Vzbid0IGhhdmUgQlJERl9MYW1iZXJ0IGluIDxjb21tb24+XG4jaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OIDwgMTUxXG4gIHZlYzMgQlJERl9MYW1iZXJ0KCBjb25zdCBpbiB2ZWMzIGRpZmZ1c2VDb2xvciApIHtcbiAgICByZXR1cm4gUkVDSVBST0NBTF9QSSAqIGRpZmZ1c2VDb2xvcjtcbiAgfVxuI2VuZGlmXG5cblxuI2luY2x1ZGUgPGxpZ2h0c19wYXJzX2JlZ2luPlxuXG4jaW5jbHVkZSA8bm9ybWFsX3BhcnNfZnJhZ21lbnQ+XG5cbi8vICNpbmNsdWRlIDxsaWdodHNfcGhvbmdfcGFyc19mcmFnbWVudD5cbnZhcnlpbmcgdmVjMyB2Vmlld1Bvc2l0aW9uO1xuXG5zdHJ1Y3QgTVRvb25NYXRlcmlhbCB7XG4gIHZlYzMgZGlmZnVzZUNvbG9yO1xuICB2ZWMzIHNoYWRlQ29sb3I7XG4gIGZsb2F0IHNoYWRpbmdTaGlmdDtcbn07XG5cbmZsb2F0IGxpbmVhcnN0ZXAoIGZsb2F0IGEsIGZsb2F0IGIsIGZsb2F0IHQgKSB7XG4gIHJldHVybiBjbGFtcCggKCB0IC0gYSApIC8gKCBiIC0gYSApLCAwLjAsIDEuMCApO1xufVxuXG4vKiogSGVybWl0ZSBzbW9vdGhzdGVwIFx1MjAxNCBraWxscyB0b29uIGlzby1jb250b3VyIHJpcHBsZXMgb24gY3VydmVkIHNraW4gKi9cbmZsb2F0IHNtb290aGVyc3RlcCggZmxvYXQgYSwgZmxvYXQgYiwgZmxvYXQgdCApIHtcbiAgZmxvYXQgeCA9IGxpbmVhcnN0ZXAoIGEsIGIsIHQgKTtcbiAgcmV0dXJuIHggKiB4ICogeCAqICggeCAqICggeCAqIDYuMCAtIDE1LjAgKSArIDEwLjAgKTtcbn1cblxuLyoqXG4gKiBDb252ZXJ0IE5kb3RMIGludG8gdG9vbiBzaGFkaW5nIGZhY3RvciB1c2luZyBzaGFkaW5nU2hpZnQgYW5kIHNoYWRpbmdUb29ueS5cbiAqIE1Ub29uOiBvcHRpb25hbGx5IGJsZW5kIGEgZXh0ZW5kZWQtbGlrZSBoYWxmLUxhbWJlcnQgKyBib3JkZXIvYmx1ciBwYXRoIChzb2Z0TWl4KS5cbiAqL1xuZmxvYXQgZ2V0U2hhZGluZyhcbiAgY29uc3QgaW4gZmxvYXQgZG90TkwsXG4gIGNvbnN0IGluIGZsb2F0IHNoYWRvdyxcbiAgY29uc3QgaW4gZmxvYXQgc2hhZGluZ1NoaWZ0XG4pIHtcbiAgLy8gQ2xhc3NpYyBNVG9vbiBWMSBwYXRoIChOXHUwMEI3TCBpbiBbLTEsMV0gXHUyMTkyIGxpbmVhcnN0ZXAgd2lkdGggZnJvbSBzaGFkaW5nVG9vbnkpXG4gIGZsb2F0IGZhY2VTb2Z0QmlhcyA9IGNsYW1wKCBmYWNlU29mdCwgMC4wLCAxLjAgKSAqIDAuMDg7XG4gIGZsb2F0IHNoYWRpbmdDbGFzc2ljID0gZG90TkwgKyBzaGFkaW5nU2hpZnQgKyBmYWNlU29mdEJpYXM7XG4gIHNoYWRpbmdDbGFzc2ljID0gbGluZWFyc3RlcCggLTEuMCArIHNoYWRpbmdUb29ueUZhY3RvciwgMS4wIC0gc2hhZGluZ1Rvb255RmFjdG9yLCBzaGFkaW5nQ2xhc3NpYyApO1xuICBzaGFkaW5nQ2xhc3NpYyAqPSBzaGFkb3c7XG5cbiAgLy8gU29mdCBwYXRoIFx1MjI0OCBleHRlbmRlZDogaGFsZi1MYW1iZXJ0ICsgYm9yZGVyL2JsdXIgKHNtb290aGVyc3RlcCB0byBhdm9pZCByaXBwbGUgYmFuZHMpXG4gIGZsb2F0IGhsID0gY2xhbXAoIGRvdE5MICogMC41ICsgMC41LCAwLjAsIDEuMCApO1xuICBmbG9hdCBzb2Z0TWl4ID0gY2xhbXAoIHNvZnRNaXgsIDAuMCwgMS4wICk7XG4gIGZsb2F0IGJvcmRlciA9ICggc2hhZG93Qm9yZGVyID49IDAuMCApXG4gICAgPyBjbGFtcCggc2hhZG93Qm9yZGVyLCAwLjAsIDEuMCApXG4gICAgOiBjbGFtcCggMC41IC0gKCBzaGFkaW5nU2hpZnQgKyBmYWNlU29mdEJpYXMgKSAqIDAuNSAtIGZhY2VTb2Z0QmlhcyAqIDAuMTUsIDAuMCwgMS4wICk7XG4gIGZsb2F0IGJsdXIgPSAoIHNoYWRvd0JsdXIgPiAwLjAgKVxuICAgID8gbWF4KCAwLjAwMSwgc2hhZG93Qmx1ciApXG4gICAgOiBtYXgoIDAuMDAxLCAoIDEuMCAtIHNoYWRpbmdUb29ueUZhY3RvciApICsgYmx1ckJvb3N0ICk7XG4gIC8vIEhpZ2ggc29mdE1peCArIG5hcnJvdyBibHVyIFx1MjE5MiBjb25jZW50cmljIGlzby1OXHUwMEI3TCByaXBwbGVzIG9uIGN1cnZlZCBza2luOyBlbmZvcmNlIGZsb29yXG4gIGJsdXIgPSBtYXgoIGJsdXIsIG1peCggMC4wOCwgMC4yNiwgc29mdE1peCApICk7XG4gIGZsb2F0IGJvcmRlck1pbiA9IGNsYW1wKCBib3JkZXIgLSAwLjUgKiBibHVyLCAwLjAsIDEuMCApO1xuICBmbG9hdCBib3JkZXJNYXggPSBjbGFtcCggYm9yZGVyICsgMC41ICogYmx1ciwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgc2hhZGluZ1NvZnQgPSBzbW9vdGhlcnN0ZXAoIGJvcmRlck1pbiwgYm9yZGVyTWF4LCBobCApO1xuICBzaGFkaW5nU29mdCAqPSBzaGFkb3c7XG5cbiAgcmV0dXJuIG1peCggc2hhZGluZ0NsYXNzaWMsIHNoYWRpbmdTb2Z0LCBzb2Z0TWl4ICk7XG59XG5cbi8qKlxuICogTWl4IGRpZmZ1c2VDb2xvciBhbmQgc2hhZGVDb2xvciB1c2luZyBzaGFkaW5nIGZhY3RvciBhbmQgbGlnaHQgY29sb3IuXG4gKiBNVG9vbjogb3B0aW9uYWwgMm5kIHNoYWRvdyBiYW5kIChkYXJrZXIgbGVycCkgYXBwcm94aW1hdGluZyBleHRlbmRlZCBfU2hhZG93Mm5kKi5cbiAqL1xudmVjMyBnZXREaWZmdXNlKFxuICBjb25zdCBpbiBNVG9vbk1hdGVyaWFsIG1hdGVyaWFsLFxuICBjb25zdCBpbiBmbG9hdCBzaGFkaW5nLFxuICBpbiB2ZWMzIGxpZ2h0Q29sb3IsXG4gIGNvbnN0IGluIGZsb2F0IGRvdE5MLFxuICBjb25zdCBpbiBmbG9hdCBzaGFkb3dcbikge1xuICAjaWZkZWYgREVCVUdfTElUU0hBREVSQVRFXG4gICAgcmV0dXJuIHZlYzMoIEJSREZfTGFtYmVydCggc2hhZGluZyAqIGxpZ2h0Q29sb3IgKSApO1xuICAjZW5kaWZcblxuICAvLyBOUFIgX1NoYWRvd01haW5TdHJlbmd0aDogcHVzaCBzaGFkZSB0b3dhcmQgc2hhZGUgKiBhbGJlZG8gZm9yIHJpY2hlciBzb2Z0IHNoYWRlXG4gIHZlYzMgc2hhZGVUZXJtID0gbWl4KFxuICAgIG1hdGVyaWFsLnNoYWRlQ29sb3IsXG4gICAgbWF0ZXJpYWwuc2hhZGVDb2xvciAqIG1hdGVyaWFsLmRpZmZ1c2VDb2xvcixcbiAgICBjbGFtcCggc2hhZGVNYWluU3RyZW5ndGgsIDAuMCwgMS4wIClcbiAgKTtcbiAgdmVjMyBzaGFkZUxpdCA9IG1peCggc2hhZGVUZXJtLCBtYXRlcmlhbC5kaWZmdXNlQ29sb3IsIHNoYWRpbmcgKTtcblxuICBmbG9hdCBobCA9IGNsYW1wKCBkb3ROTCAqIDAuNSArIDAuNSwgMC4wLCAxLjAgKTtcblxuXG4gIGZsb2F0IGJhbmQyID0gY2xhbXAoIHNoYWRvdzJuZFN0cmVuZ3RoLCAwLjAsIDEuMCApICogMC43MjtcbiAgZmxvYXQgYmx1cjIgPSBtYXgoIDAuMjIsIHNoYWRvdzJuZEJsdXIgKTtcbiAgZmxvYXQgYjJtaW4gPSBjbGFtcCggc2hhZG93Mm5kQm9yZGVyIC0gMC41ICogYmx1cjIsIDAuMCwgMS4wICk7XG4gIGZsb2F0IGIybWF4ID0gY2xhbXAoIHNoYWRvdzJuZEJvcmRlciArIDAuNSAqIGJsdXIyLCAwLjAsIDEuMCApO1xuICBmbG9hdCBzMiA9IHNtb290aGVyc3RlcCggYjJtaW4sIGIybWF4LCBobCApICogc2hhZG93O1xuICBzaGFkZUxpdCA9IG1peCggc2hhZGVMaXQsIG1peCggc2hhZGVMaXQgKiBzaGFkb3cybmRDb2xvciwgc2hhZGVMaXQsIHMyICksIGJhbmQyICk7XG5cbiAgZmxvYXQgYmFuZDMgPSBjbGFtcCggc2hhZG93M3JkU3RyZW5ndGgsIDAuMCwgMS4wICkgKiAwLjU1O1xuICBmbG9hdCBibHVyMyA9IG1heCggMC4yLCBzaGFkb3czcmRCbHVyICk7XG4gIGZsb2F0IGIzbWluID0gY2xhbXAoIHNoYWRvdzNyZEJvcmRlciAtIDAuNSAqIGJsdXIzLCAwLjAsIDEuMCApO1xuICBmbG9hdCBiM21heCA9IGNsYW1wKCBzaGFkb3czcmRCb3JkZXIgKyAwLjUgKiBibHVyMywgMC4wLCAxLjAgKTtcbiAgZmxvYXQgczMgPSBzbW9vdGhlcnN0ZXAoIGIzbWluLCBiM21heCwgaGwgKSAqIHNoYWRvdztcbiAgc2hhZGVMaXQgPSBtaXgoIHNoYWRlTGl0LCBtaXgoIHNoYWRlTGl0ICogc2hhZG93M3JkQ29sb3IsIHNoYWRlTGl0LCBzMyApLCBiYW5kMyApO1xuXG4gIHZlYzMgY29sID0gbGlnaHRDb2xvciAqIEJSREZfTGFtYmVydCggc2hhZGVMaXQgKTtcbiAgLy8gbGlsOiBpbmRpcmVjdENvbCA9IG1pbihpbmRpcmVjdENvbCwgZGlyZWN0Q29sKSBcdTIwMTQga2VlcCBzb2Z0IHNoYWRlIGZyb20gYmxvd2luZyBwYXN0IGxpdFxuICB2ZWMzIGRpcmVjdENvbCA9IGxpZ2h0Q29sb3IgKiBCUkRGX0xhbWJlcnQoIG1hdGVyaWFsLmRpZmZ1c2VDb2xvciApO1xuICBjb2wgPSBtaXgoIGNvbCwgbWluKCBjb2wsIGRpcmVjdENvbCApLCBjbGFtcCggc29mdE1peCwgMC4wLCAxLjAgKSApO1xuICAvLyBOUFIgX1NoYWRvd0VudlN0cmVuZ3RoOiBsaWZ0IHNoYWRlIHRvd2FyZCBsaXQqZW52IHNvIGluZGlyZWN0IGRvZXNuJ3QgZ28gZGVhZC1tYXR0ZVxuICAvLyBTb2Z0IGVudiBsaWZ0IFx1MjAxNCBrZWVwIGZhY3RvciBsb3cgdG8gYXZvaWQgc3RlcHBlZCBtaWR0b25lIFwiYmFuZHNcIiBvbiBib2R5XG4gIGNvbCA9IG1peCggY29sLCBtaXgoIGNvbCwgZGlyZWN0Q29sLCAwLjIyICksIGNsYW1wKCBlbnZTdHJlbmd0aCwgMC4wLCAxLjAgKSAqIDAuNjUgKiAoIDEuMCAtIHNoYWRpbmcgKSApO1xuXG4gIC8vIFRoZSBcImNvbW1lbnQgb3V0IGlmIHlvdSB3YW50IHRvIFBCUiBhYnNvbHV0ZWx5XCIgbGluZVxuICAjaWZkZWYgVjBfQ09NUEFUX1NIQURFXG4gICAgY29sID0gbWluKCBjb2wsIG1hdGVyaWFsLmRpZmZ1c2VDb2xvciApO1xuICAjZW5kaWZcblxuICByZXR1cm4gY29sO1xufVxuXG4vKipcbiAqIExpZ2h0d2VpZ2h0IHN0cmV0Y2hlZCBoaWdobGlnaHQgKEthaml5YS1LYXktaXNoKSBmb3IgaGFpciAvIGFuZ2VsLXJpbmcgc2hlZW4uXG4gKiBEdWFsIGxvYmUgKHByaW1hcnkgKyBzb2Z0ZXIgcmluZykuIEdhdGVkIGJ5IGhhaXJTcGVjU3RyZW5ndGg7IG1hbmFnZXIga2VlcHMgZmFjZS9leWVzIGF0IDAuXG4gKi9cbnZlYzMgZ2V0SGFpclNwZWMoXG4gIGNvbnN0IGluIHZlYzMgbm9ybWFsLFxuICBjb25zdCBpbiB2ZWMzIGxpZ2h0RGlyLFxuICBjb25zdCBpbiB2ZWMzIHZpZXdEaXIsXG4gIGNvbnN0IGluIHZlYzMgbGlnaHRDb2xvcixcbiAgY29uc3QgaW4gZmxvYXQgc2hhZGluZ1xuKSB7XG4gIGZsb2F0IHN0cmVuZ3RoID0gaGFpclNwZWNTdHJlbmd0aDtcbiAgaWYgKCBzdHJlbmd0aCA8PSAwLjAwMDEgKSB7XG4gICAgcmV0dXJuIHZlYzMoIDAuMCApO1xuICB9XG4gIHZlYzMgdCA9IGNyb3NzKCBub3JtYWwsIHZlYzMoIDAuMCwgMS4wLCAwLjAgKSApO1xuICBmbG9hdCB0TGVuID0gbGVuZ3RoKCB0ICk7XG4gIGlmICggdExlbiA8IDFlLTMgKSB7XG4gICAgdCA9IGNyb3NzKCBub3JtYWwsIHZlYzMoIDEuMCwgMC4wLCAwLjAgKSApO1xuICAgIHRMZW4gPSBsZW5ndGgoIHQgKTtcbiAgfVxuICB0IC89IG1heCggdExlbiwgMWUtNSApO1xuICB2ZWMzIGggPSBub3JtYWxpemUoIGxpZ2h0RGlyICsgdmlld0RpciApO1xuICBmbG9hdCB0aCA9IGRvdCggdCwgaCApO1xuICBmbG9hdCBwb3dlciA9IG1heCggMS4wLCBoYWlyU3BlY1Bvd2VyICk7XG4gIGZsb2F0IGFuaXNvMSA9IHBvdyggc3FydCggbWF4KCAwLjAsIDEuMCAtICggdGggKyBoYWlyU3BlY1NoaWZ0ICkgKiAoIHRoICsgaGFpclNwZWNTaGlmdCApICkgKSwgcG93ZXIgKTtcbiAgLy8gU3Ryb25nZXIgc2Vjb25kYXJ5IGxvYmUgKGFuZ2VsLXJpbmctaXNoKSBzaGlmdGVkIHRoZSBvdGhlciB3YXlcbiAgZmxvYXQgc2hpZnQyID0gaGFpclNwZWNTaGlmdCArIDAuMjtcbiAgZmxvYXQgYW5pc28yID0gcG93KCBzcXJ0KCBtYXgoIDAuMCwgMS4wIC0gKCB0aCArIHNoaWZ0MiApICogKCB0aCArIHNoaWZ0MiApICkgKSwgcG93ZXIgKiAwLjUgKTtcbiAgZmxvYXQgYW5pc28gPSBhbmlzbzEgKyAwLjU1ICogYW5pc28yO1xuICAvLyBTb2Z0ZW4gYnkgdG9vbiBzaGFkaW5nIHNvIGRlZXAgc2hhZGUgc3RheXMgbWF0dGVcbiAgcmV0dXJuIGxpZ2h0Q29sb3IgKiAoIGFuaXNvICogc3RyZW5ndGggKiBtaXgoIDAuMzUsIDEuMCwgc2hhZGluZyApICk7XG59XG5cbi8qKlxuICogTGlnaHQgR0dYLWlzaCBpc290cm9waWMgbG9iZSBmb3IgY2xvdGggLyBzYXRpbiAvIGJvd3MgKGV4dGVuZGVkIHNoaW5pZXIgcmVhZCkuXG4gKiBVc2VzIFNjaGxpY2stR0dYIEQgYXBwcm94IHdpdGggcm91Z2huZXNzIGZyb20gQ2xvdGhTcGVjUG93ZXI7IHN0cmVuZ3RoIDAgXHUyMTkyIG5vb3AuXG4gKi9cbnZlYzMgZ2V0Q2xvdGhTcGVjKFxuICBjb25zdCBpbiB2ZWMzIG5vcm1hbCxcbiAgY29uc3QgaW4gdmVjMyBsaWdodERpcixcbiAgY29uc3QgaW4gdmVjMyB2aWV3RGlyLFxuICBjb25zdCBpbiB2ZWMzIGxpZ2h0Q29sb3IsXG4gIGNvbnN0IGluIGZsb2F0IHNoYWRpbmdcbikge1xuICBmbG9hdCBzdHJlbmd0aCA9IGNsb3RoU3BlY1N0cmVuZ3RoO1xuICBpZiAoIHN0cmVuZ3RoIDw9IDAuMDAwMSApIHtcbiAgICByZXR1cm4gdmVjMyggMC4wICk7XG4gIH1cbiAgdmVjMyBoID0gbm9ybWFsaXplKCBsaWdodERpciArIHZpZXdEaXIgKTtcbiAgZmxvYXQgbmggPSBjbGFtcCggZG90KCBub3JtYWwsIGggKSwgMC4wLCAxLjAgKTtcbiAgLy8gTWFwIHBvd2VyICh+MzIuLjEyOCkgXHUyMTkyIHJvdWdobmVzcyAofjAuMzUuLjAuMDgpOyB0aGVuIEdHWCBEXG4gIGZsb2F0IHBvd2VyID0gbWF4KCA4LjAsIGNsb3RoU3BlY1Bvd2VyICk7XG4gIGZsb2F0IHJvdWdoID0gY2xhbXAoIDEuMCAvIHNxcnQoIHBvd2VyICksIDAuMDYsIDAuNDUgKTtcbiAgZmxvYXQgYSA9IHJvdWdoICogcm91Z2g7XG4gIGZsb2F0IGEyID0gYSAqIGE7XG4gIGZsb2F0IG5oMiA9IG5oICogbmg7XG4gIGZsb2F0IGRlbm9tID0gbmgyICogKCBhMiAtIDEuMCApICsgMS4wO1xuICBmbG9hdCBEID0gYTIgLyBtYXgoIDMuMTQxNTkyNjUgKiBkZW5vbSAqIGRlbm9tLCAxZS01ICk7XG4gIC8vIFRpbnkgU2NobGljayBGcmVzbmVsIGF0IGdyYXppbmcgZm9yIHNhdGluIHJlYWRcbiAgZmxvYXQgdmggPSBjbGFtcCggZG90KCB2aWV3RGlyLCBoICksIDAuMCwgMS4wICk7XG4gIGZsb2F0IEYgPSAwLjA0ICsgMC45NiAqIHBvdyggMS4wIC0gdmgsIDUuMCApO1xuICBmbG9hdCBzcGVjID0gRCAqIEY7XG4gIHJldHVybiBsaWdodENvbG9yICogKCBzcGVjICogc3RyZW5ndGggKiBtaXgoIDAuMiwgMS4wLCBzaGFkaW5nICkgKTtcbn1cblxuLyoqXG4gKiBJc290cm9waWMgbW9pc3QvaHlkcmF0ZWQgc2tpbiBzcGVjdWxhciAoTlBSIHNvZnQgU3BlY3VsYXJUb29uLWlzaCkuXG4gKiBCcm9hZCwgbG93IHN0cmVuZ3RoLCBtaWxkIGZyZXNuZWwgc2hlZW4gXHUyMDE0IE5PVCBoYWlyIGFuaXNvdHJvcHkuXG4gKi9cbnZlYzMgZ2V0U2tpblNwZWMoXG4gIGNvbnN0IGluIHZlYzMgbm9ybWFsLFxuICBjb25zdCBpbiB2ZWMzIGxpZ2h0RGlyLFxuICBjb25zdCBpbiB2ZWMzIHZpZXdEaXIsXG4gIGNvbnN0IGluIHZlYzMgbGlnaHRDb2xvcixcbiAgY29uc3QgaW4gZmxvYXQgc2hhZGluZ1xuKSB7XG4gIGZsb2F0IHN0cmVuZ3RoID0gc2tpblNwZWNTdHJlbmd0aDtcbiAgaWYgKCBzdHJlbmd0aCA8PSAwLjAwMDEgKSB7XG4gICAgcmV0dXJuIHZlYzMoIDAuMCApO1xuICB9XG4gIHZlYzMgaCA9IG5vcm1hbGl6ZSggbGlnaHREaXIgKyB2aWV3RGlyICk7XG4gIGZsb2F0IG5oID0gY2xhbXAoIGRvdCggbm9ybWFsLCBoICksIDAuMCwgMS4wICk7XG4gIGZsb2F0IG52ID0gY2xhbXAoIGRvdCggbm9ybWFsLCB2aWV3RGlyICksIDAuMCwgMS4wICk7XG4gIGZsb2F0IG5sID0gY2xhbXAoIGRvdCggbm9ybWFsLCBsaWdodERpciApLCAwLjAsIDEuMCApO1xuICBmbG9hdCBwb3dlciA9IG1heCggMTYuMCwgc2tpblNwZWNQb3dlciApO1xuICAvLyBDb250aW51b3VzIHNtb290aCBCbGlubiBsb2JlIFx1MjAxNCBjbGFtcGVkIGFuZCBzb2Z0bHkgYXR0ZW51YXRlZCB0byBwcmV2ZW50IGhhcnNoIGNpcmN1bGFyIHdoaXRlIHNwb3RcbiAgZmxvYXQgbG9iZSA9IHBvdyggbmgsIHBvd2VyICk7XG4gIGxvYmUgPSBzbW9vdGhzdGVwKCAwLjA1LCAwLjk1LCBsb2JlICkgKiAwLjc7XG4gIGZsb2F0IEYgPSAwLjA0ICsgMC45NiAqIHBvdyggMS4wIC0gbnYsIDQuMCApO1xuICBmbG9hdCBzaGVlbiA9IG1peCggMC40LCBGLCBjbGFtcCggc2tpblNwZWNGcmVzbmVsLCAwLjAsIDEuMCApICk7XG4gIGZsb2F0IGxpdEdhdGUgPSBzbW9vdGhzdGVwKCAwLjEsIDAuOCwgc2hhZGluZyApICogY2xhbXAoIG5sLCAwLjAsIDEuMCApO1xuICByZXR1cm4gbGlnaHRDb2xvciAqIHNraW5TcGVjQ29sb3IgKiAoIGxvYmUgKiBzaGVlbiAqIHN0cmVuZ3RoICogbGl0R2F0ZSApO1xufVxuXG4vKipcbiAqIEdyYXppbmctYW5nbGUgdmVsdmV0IC8gZmFicmljIHNoZWVuIGFwcHJveGltYXRpb24gKGxpbFRvb24gY2xvdGggZmVlbCkuXG4gKiBBZGRzIHJpY2ggc29mdCBlZGdlIGdsb3cgdG8gY2hlb25nc2FtIC8gc2F0aW4gZHJlc3NlcyB3aXRob3V0IGV4dHJhIHRleHR1cmVzLlxuICovXG52ZWMzIGdldEZhYnJpY1NoZWVuKFxuICBjb25zdCBpbiB2ZWMzIG5vcm1hbCxcbiAgY29uc3QgaW4gdmVjMyB2aWV3RGlyLFxuICBjb25zdCBpbiB2ZWMzIGxpZ2h0Q29sb3Jcbikge1xuICBpZiAoIGZhYnJpY1NoZWVuU3RyZW5ndGggPD0gMC4wMDAxICkge1xuICAgIHJldHVybiB2ZWMzKCAwLjAgKTtcbiAgfVxuICBmbG9hdCBudiA9IGNsYW1wKCAxLjAgLSBhYnMoIGRvdCggbm9ybWFsLCB2aWV3RGlyICkgKSwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgc2hlZW4gPSBwb3coIG52LCBtYXgoIDAuNSwgZmFicmljU2hlZW5Qb3dlciApICk7XG4gIHJldHVybiBsaWdodENvbG9yICogZmFicmljU2hlZW5Db2xvciAqICggc2hlZW4gKiBmYWJyaWNTaGVlblN0cmVuZ3RoICk7XG59XG5cbi8qKlxuICogbGlsQ2FsY1NwZWN1bGFyLWxpa2UgdG9vbiBzcGVjdWxhciBmcm9tIE1Ub29uIHByb3hpZXMgKHNtb290aG5lc3MvbWV0YWxsaWMgdmlhIHVuaWZvcm1zKS5cbiAqIE5vIGN1YmVtYXAgXHUyMDE0IHN0aWxsIGFkZHMgZGlyZWN0aW9uYWwgaGlnaGxpZ2h0IGVuZXJneSBOUFIgdXNlcnMgZXhwZWN0LlxuICovXG52ZWMzIGdldFRvb25TcGVjdWxhcihcbiAgY29uc3QgaW4gdmVjMyBub3JtYWwsXG4gIGNvbnN0IGluIHZlYzMgbGlnaHREaXIsXG4gIGNvbnN0IGluIHZlYzMgdmlld0RpcixcbiAgY29uc3QgaW4gdmVjMyBsaWdodENvbG9yLFxuICBjb25zdCBpbiB2ZWMzIGFsYmVkbyxcbiAgY29uc3QgaW4gZmxvYXQgc2hhZGluZ1xuKSB7XG4gIGZsb2F0IHN0cmVuZ3RoID0gc3BlY3VsYXJTdHJlbmd0aDtcbiAgaWYgKCBzdHJlbmd0aCA8PSAwLjAwMDEgKSB7XG4gICAgcmV0dXJuIHZlYzMoIDAuMCApO1xuICB9XG4gIHZlYzMgaCA9IG5vcm1hbGl6ZSggbGlnaHREaXIgKyB2aWV3RGlyICk7XG4gIGZsb2F0IG5oID0gY2xhbXAoIGRvdCggbm9ybWFsLCBoICksIDAuMCwgMS4wICk7XG4gIGZsb2F0IG5sID0gY2xhbXAoIGRvdCggbm9ybWFsLCBsaWdodERpciApLCAwLjAsIDEuMCApO1xuICBmbG9hdCBsaCA9IGNsYW1wKCBkb3QoIGxpZ2h0RGlyLCBoICksIDAuMCwgMS4wICk7XG4gIGZsb2F0IHBvd2VyID0gbWF4KCA0LjAsIHNwZWN1bGFyUG93ZXIgKTtcbiAgZmxvYXQgbG9iZSA9IHBvdyggbmgsIHBvd2VyICk7XG4gIGZsb2F0IGJvcmRlciA9IGNsYW1wKCBzcGVjdWxhckJvcmRlciwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgYmx1ciA9IG1heCggMC4wMDEsIHNwZWN1bGFyQmx1ciApO1xuICBsb2JlID0gbGluZWFyc3RlcCggYm9yZGVyIC0gMC41ICogYmx1ciwgYm9yZGVyICsgMC41ICogYmx1ciwgbG9iZSApO1xuICAvLyBTY2hsaWNrIEYwIGZyb20gbWV0YWxsaWMgcHJveHlcbiAgZmxvYXQgbWV0YWxsaWMgPSBjbGFtcCggcmVmbGVjdE1ldGFsbGljLCAwLjAsIDEuMCApO1xuICB2ZWMzIGYwID0gbWl4KCB2ZWMzKCAwLjA0ICksIGFsYmVkbywgbWV0YWxsaWMgKTtcbiAgdmVjMyBGID0gZjAgKyAoIDEuMCAtIGYwICkgKiBwb3coIDEuMCAtIGxoLCA1LjAgKTtcbiAgZmxvYXQgZ2F0ZSA9IG1peCggMC4xNSwgMS4wLCBzaGFkaW5nICkgKiBubDtcbiAgcmV0dXJuIGxpZ2h0Q29sb3IgKiBGICogKCBsb2JlICogc3RyZW5ndGggKiBnYXRlICk7XG59XG5cbi8qKlxuICogVmlldy1kZXBlbmRlbnQgZW52IHJlZmxlY3Rpb24gYXBwcm94aW1hdGlvbiB3aXRob3V0IGN1YmVtYXAvUE1SRU0uXG4gKiBVc2VzIGZyZXNuZWwgKyBzbW9vdGhuZXNzIHRvIHRpbnQgdG93YXJkIGFsYmVkby9saWdodCBcdTIwMTQgYmV0dGVyIHRoYW4gZmxhdCBtYXR0ZS5cbiAqL1xudmVjMyBnZXRFbnZSZWZsZWN0QXBwcm94KFxuICBjb25zdCBpbiB2ZWMzIG5vcm1hbCxcbiAgY29uc3QgaW4gdmVjMyB2aWV3RGlyLFxuICBjb25zdCBpbiB2ZWMzIGxpZ2h0Q29sb3IsXG4gIGNvbnN0IGluIHZlYzMgYWxiZWRvLFxuICBjb25zdCBpbiBmbG9hdCBzaGFkaW5nXG4pIHtcbiAgZmxvYXQgc3RyZW5ndGggPSByZWZsZWN0U3RyZW5ndGg7XG4gIGlmICggc3RyZW5ndGggPD0gMC4wMDAxICkge1xuICAgIHJldHVybiB2ZWMzKCAwLjAgKTtcbiAgfVxuICBmbG9hdCBudiA9IGNsYW1wKCBkb3QoIG5vcm1hbCwgdmlld0RpciApLCAwLjAsIDEuMCApO1xuICBmbG9hdCBzbW9vdGhuID0gY2xhbXAoIHJlZmxlY3RTbW9vdGhuZXNzLCAwLjAsIDEuMCApO1xuICBmbG9hdCBmcmVzQW10ID0gY2xhbXAoIHJlZmxlY3RGcmVzbmVsLCAwLjAsIDEuMCApO1xuICBmbG9hdCBtZXRhbGxpYyA9IGNsYW1wKCByZWZsZWN0TWV0YWxsaWMsIDAuMCwgMS4wICk7XG4gIGZsb2F0IGZyZXMgPSBwb3coIDEuMCAtIG52LCBtaXgoIDMuMCwgNS4wLCBzbW9vdGhuICkgKTtcbiAgZnJlcyA9IG1peCggZnJlcyAqIDAuMzUsIGZyZXMsIGZyZXNBbXQgKTtcbiAgLy8gU29mdCBlbnYgc3RhbmQtaW46IHVwd2FyZCBoZW1pc3BoZXJlIG9ubHkgKG5ldmVyIHRyZWF0IGxpZ2h0Q29sb3IgYXMgYSBkaXJlY3Rpb24gXHUyMDE0XG4gIC8vIHRoYXQgY2F1c2VkIGJsb3RjaHkvcmlwcGxlZCBsaWdodGluZyB3aGVuIFJHQiB2YXJpZWQpLlxuICB2ZWMzIHIgPSByZWZsZWN0KCAtdmlld0Rpciwgbm9ybWFsICk7XG4gIGZsb2F0IHVwID0gY2xhbXAoIHIueSAqIDAuNSArIDAuNSwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgZW52TG9iZSA9IHBvdyggdXAsIG1peCggMS4yLCAzLjUsIHNtb290aG4gKSApO1xuICB2ZWMzIGVudkNvbCA9IG1peCggdmVjMyggMC43OCwgMC44MCwgMC44NiApLCBhbGJlZG8sIG1ldGFsbGljICogMC41ICk7XG4gIGVudkNvbCA9IG1peCggZW52Q29sLCBsaWdodENvbG9yLCAwLjIgKTtcbiAgZmxvYXQgZ2F0ZSA9IG1peCggMC40NSwgMS4wLCBzaGFkaW5nICk7XG4gIHJldHVybiBlbnZDb2wgKiAoIGZyZXMgKiBlbnZMb2JlICogc3RyZW5ndGggKiBnYXRlICogMC44NSApO1xufVxuXG4vKipcbiAqIE5QUiBiYWNrbGlnaHQ6IHdyYXAgbGlnaHRpbmcgZnJvbSBvcHBvc2l0ZSBoZW1pc3BoZXJlIChubyBleHRyYSB0ZXgpLlxuICovXG52ZWMzIGdldEJhY2tsaWdodChcbiAgY29uc3QgaW4gdmVjMyBub3JtYWwsXG4gIGNvbnN0IGluIHZlYzMgbGlnaHREaXIsXG4gIGNvbnN0IGluIHZlYzMgdmlld0RpcixcbiAgY29uc3QgaW4gdmVjMyBsaWdodENvbG9yLFxuICBjb25zdCBpbiB2ZWMzIGFsYmVkb1xuKSB7XG4gIGZsb2F0IHN0cmVuZ3RoID0gYmFja2xpZ2h0U3RyZW5ndGg7XG4gIGlmICggc3RyZW5ndGggPD0gMC4wMDAxICkge1xuICAgIHJldHVybiB2ZWMzKCAwLjAgKTtcbiAgfVxuICAvLyBPcHBvc2l0ZS1saWdodCBoYWxmLUxhbWJlcnQgd2l0aCBtaWxkIHZpZXcgd3JhcFxuICB2ZWMzIExiYWNrID0gbm9ybWFsaXplKCAtbGlnaHREaXIgKyB2aWV3RGlyICogMC4yNSApO1xuICBmbG9hdCBobCA9IGNsYW1wKCBkb3QoIG5vcm1hbCwgTGJhY2sgKSAqIDAuNSArIDAuNSwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgYm9yZGVyID0gMC41NTtcbiAgZmxvYXQgYmx1ciA9IDAuMzU7XG4gIGZsb2F0IGZhY3RvciA9IGxpbmVhcnN0ZXAoIGJvcmRlciAtIDAuNSAqIGJsdXIsIGJvcmRlciArIDAuNSAqIGJsdXIsIGhsICk7XG4gIC8vIERpcmVjdGl2aXR5OiBzdHJvbmdlciB3aGVuIE4gcG9pbnRzIGF3YXkgZnJvbSBtYWluIGxpZ2h0XG4gIGZsb2F0IGF3YXkgPSBjbGFtcCggLWRvdCggbm9ybWFsLCBsaWdodERpciApICogMC41ICsgMC41LCAwLjAsIDEuMCApO1xuICBmYWN0b3IgKj0gcG93KCBhd2F5LCAxLjUgKTtcbiAgdmVjMyBjb2wgPSBtaXgoIGJhY2tsaWdodENvbG9yLCBiYWNrbGlnaHRDb2xvciAqIGFsYmVkbywgMC40NSApO1xuICByZXR1cm4gbGlnaHRDb2xvciAqIGNvbCAqICggZmFjdG9yICogc3RyZW5ndGggKTtcbn1cblxuLyoqXG4gKiBHZW0taXNoIGZyZXNuZWwgc3BhcmtsZSBwcm94eSBcdTIwMTQgb25seSB3aGVuIGV4cGxpY2l0bHkgZW5hYmxlZDsgc2FmZSBmb3IgY2xvdGgvc2tpbiBhdCAwLlxuICovXG52ZWMzIGdldEdlbUZyZXNuZWxQcm94eShcbiAgY29uc3QgaW4gdmVjMyBub3JtYWwsXG4gIGNvbnN0IGluIHZlYzMgdmlld0RpcixcbiAgY29uc3QgaW4gdmVjMyBsaWdodENvbG9yLFxuICBjb25zdCBpbiB2ZWMzIGFsYmVkb1xuKSB7XG4gIGZsb2F0IHN0cmVuZ3RoID0gZ2VtRnJlc25lbDtcbiAgaWYgKCBzdHJlbmd0aCA8PSAwLjAwMDEgKSB7XG4gICAgcmV0dXJuIHZlYzMoIDAuMCApO1xuICB9XG4gIGZsb2F0IG52ID0gY2xhbXAoIGRvdCggbm9ybWFsLCB2aWV3RGlyICksIDAuMCwgMS4wICk7XG4gIGZsb2F0IGZyZXMgPSBwb3coIDEuMCAtIG52LCA0LjAgKTtcbiAgLy8gQ2hyb21hdGljLWlzaCBzcGxpdCB2aWEgYWxiZWRvIGNoYW5uZWxzIChsaWdodHdlaWdodCwgbm8gZXh0cmEgdGV4KVxuICB2ZWMzIGNocm9tYSA9IG5vcm1hbGl6ZSggYWxiZWRvICsgdmVjMyggMC4wNSwgMC4wOCwgMC4xMiApICk7XG4gIHJldHVybiBsaWdodENvbG9yICogY2hyb21hICogKCBmcmVzICogc3RyZW5ndGggKTtcbn1cblxuLy8gQ09NUEFUOiBwcmUtcjE1NiB1c2VzIGEgc3RydWN0IEdlb21ldHJpY0NvbnRleHRcbiNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPj0gMTU3XG4gIHZvaWQgUkVfRGlyZWN0X01Ub29uKCBjb25zdCBpbiBJbmNpZGVudExpZ2h0IGRpcmVjdExpZ2h0LCBjb25zdCBpbiB2ZWMzIGdlb21ldHJ5UG9zaXRpb24sIGNvbnN0IGluIHZlYzMgZ2VvbWV0cnlOb3JtYWwsIGNvbnN0IGluIHZlYzMgZ2VvbWV0cnlWaWV3RGlyLCBjb25zdCBpbiB2ZWMzIGdlb21ldHJ5Q2xlYXJjb2F0Tm9ybWFsLCBjb25zdCBpbiBNVG9vbk1hdGVyaWFsIG1hdGVyaWFsLCBjb25zdCBpbiBmbG9hdCBzaGFkb3csIGlub3V0IFJlZmxlY3RlZExpZ2h0IHJlZmxlY3RlZExpZ2h0ICkge1xuICAgIGZsb2F0IGRvdE5MID0gY2xhbXAoIGRvdCggZ2VvbWV0cnlOb3JtYWwsIGRpcmVjdExpZ2h0LmRpcmVjdGlvbiApLCAtMS4wLCAxLjAgKTtcbiAgICB2ZWMzIGlycmFkaWFuY2UgPSBkaXJlY3RMaWdodC5jb2xvcjtcblxuICAgIC8vIGRpcmVjdFNwZWN1bGFyIHdpbGwgYmUgdXNlZCBmb3IgcmltIGxpZ2h0aW5nLCBub3QgYW4gYWN0dWFsIHNwZWN1bGFyXG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0U3BlY3VsYXIgKz0gaXJyYWRpYW5jZTtcblxuICAgIGlycmFkaWFuY2UgKj0gZG90Tkw7XG5cbiAgICAvLyBcdTk3NjJcdTkwRThcdTk2MzRcdTVGNzFcdTk2OTRcdTc5QkJcdUZGMUFyZWNlaXZlU2hhZG93UmF0ZSA9IDAgXHU2NUY2XHU1RkZEXHU3NTY1IHNoYWRvd21hcCBcdTYyOTVcdTVDMDRcdTk2MzRcdTVGNzFcdUZGMENcdTk3NjJcdTkwRThcdTRGRERcdTYzMDFcdTc2N0RcdTUxQzBcbiAgICBmbG9hdCBlZmZlY3RpdmVTaGFkb3cgPSBtaXgoIDEuMCwgc2hhZG93LCBjbGFtcCggcmVjZWl2ZVNoYWRvd1JhdGUsIDAuMCwgMS4wICkgKTtcblxuICAgIGZsb2F0IHNoYWRpbmcgPSBnZXRTaGFkaW5nKCBkb3ROTCwgZWZmZWN0aXZlU2hhZG93LCBtYXRlcmlhbC5zaGFkaW5nU2hpZnQgKTtcblxuICAgIC8vIHRvb24gc2hhZGVkIGRpZmZ1c2UgKCsgb3B0aW9uYWwgMm5kIGJhbmQgaW5zaWRlIGdldERpZmZ1c2UpXG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXREaWZmdXNlKCBtYXRlcmlhbCwgc2hhZGluZywgZGlyZWN0TGlnaHQuY29sb3IsIGRvdE5MLCBlZmZlY3RpdmVTaGFkb3cgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldEhhaXJTcGVjKCBnZW9tZXRyeU5vcm1hbCwgZGlyZWN0TGlnaHQuZGlyZWN0aW9uLCBnZW9tZXRyeVZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yLCBzaGFkaW5nICk7XG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXRDbG90aFNwZWMoIGdlb21ldHJ5Tm9ybWFsLCBkaXJlY3RMaWdodC5kaXJlY3Rpb24sIGdlb21ldHJ5Vmlld0RpciwgZGlyZWN0TGlnaHQuY29sb3IsIHNoYWRpbmcgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldEZhYnJpY1NoZWVuKCBnZW9tZXRyeU5vcm1hbCwgZ2VvbWV0cnlWaWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0U2tpblNwZWMoIGdlb21ldHJ5Tm9ybWFsLCBkaXJlY3RMaWdodC5kaXJlY3Rpb24sIGdlb21ldHJ5Vmlld0RpciwgZGlyZWN0TGlnaHQuY29sb3IsIHNoYWRpbmcgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldFRvb25TcGVjdWxhciggZ2VvbWV0cnlOb3JtYWwsIGRpcmVjdExpZ2h0LmRpcmVjdGlvbiwgZ2VvbWV0cnlWaWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciwgbWF0ZXJpYWwuZGlmZnVzZUNvbG9yLCBzaGFkaW5nICk7XG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXRFbnZSZWZsZWN0QXBwcm94KCBnZW9tZXRyeU5vcm1hbCwgZ2VvbWV0cnlWaWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciwgbWF0ZXJpYWwuZGlmZnVzZUNvbG9yLCBzaGFkaW5nICk7XG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXRCYWNrbGlnaHQoIGdlb21ldHJ5Tm9ybWFsLCBkaXJlY3RMaWdodC5kaXJlY3Rpb24sIGdlb21ldHJ5Vmlld0RpciwgZGlyZWN0TGlnaHQuY29sb3IsIG1hdGVyaWFsLmRpZmZ1c2VDb2xvciApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0R2VtRnJlc25lbFByb3h5KCBnZW9tZXRyeU5vcm1hbCwgZ2VvbWV0cnlWaWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciwgbWF0ZXJpYWwuZGlmZnVzZUNvbG9yICk7XG4gIH1cblxuICB2b2lkIFJFX0luZGlyZWN0RGlmZnVzZV9NVG9vbiggY29uc3QgaW4gdmVjMyBpcnJhZGlhbmNlLCBjb25zdCBpbiB2ZWMzIGdlb21ldHJ5UG9zaXRpb24sIGNvbnN0IGluIHZlYzMgZ2VvbWV0cnlOb3JtYWwsIGNvbnN0IGluIHZlYzMgZ2VvbWV0cnlWaWV3RGlyLCBjb25zdCBpbiB2ZWMzIGdlb21ldHJ5Q2xlYXJjb2F0Tm9ybWFsLCBjb25zdCBpbiBNVG9vbk1hdGVyaWFsIG1hdGVyaWFsLCBpbm91dCBSZWZsZWN0ZWRMaWdodCByZWZsZWN0ZWRMaWdodCApIHtcbiAgICAvLyBWUk0gR0kgZXF1YWxpemF0aW9uOiBmbGF0dGVuIGlycmFkaWFuY2UgdG93YXJkIGx1bWEgYXZlcmFnZSAoYnJpZ2h0ZXIgc29mdCBOUFIgYW1iaWVudClcbiAgICBmbG9hdCBnaUF2ZyA9ICggaXJyYWRpYW5jZS5yICsgaXJyYWRpYW5jZS5nICsgaXJyYWRpYW5jZS5iICkgKiAoIDEuMCAvIDMuMCApO1xuICAgIHZlYzMgZ2kgPSBtaXgoIGlycmFkaWFuY2UsIHZlYzMoIGdpQXZnICksIGNsYW1wKCBnaUVxdWFsaXphdGlvbkZhY3RvciwgMC4wLCAxLjAgKSApO1xuICAgIGdpICo9ICggMS4wICsgbWF4KCAwLjAsIGFtYmllbnRMaWZ0ICkgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5pbmRpcmVjdERpZmZ1c2UgKz0gZ2kgKiBCUkRGX0xhbWJlcnQoIG1hdGVyaWFsLmRpZmZ1c2VDb2xvciApO1xuXG4gICAgLy8gZGlyZWN0U3BlY3VsYXIgd2lsbCBiZSB1c2VkIGZvciByaW0gbGlnaHRpbmcsIG5vdCBhbiBhY3R1YWwgc3BlY3VsYXJcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3RTcGVjdWxhciArPSBpcnJhZGlhbmNlO1xuICB9XG4jZWxzZVxuICB2b2lkIFJFX0RpcmVjdF9NVG9vbiggY29uc3QgaW4gSW5jaWRlbnRMaWdodCBkaXJlY3RMaWdodCwgY29uc3QgaW4gR2VvbWV0cmljQ29udGV4dCBnZW9tZXRyeSwgY29uc3QgaW4gTVRvb25NYXRlcmlhbCBtYXRlcmlhbCwgY29uc3QgaW4gZmxvYXQgc2hhZG93LCBpbm91dCBSZWZsZWN0ZWRMaWdodCByZWZsZWN0ZWRMaWdodCApIHtcbiAgICBmbG9hdCBkb3ROTCA9IGNsYW1wKCBkb3QoIGdlb21ldHJ5Lm5vcm1hbCwgZGlyZWN0TGlnaHQuZGlyZWN0aW9uICksIC0xLjAsIDEuMCApO1xuICAgIHZlYzMgaXJyYWRpYW5jZSA9IGRpcmVjdExpZ2h0LmNvbG9yO1xuXG4gICAgLy8gZGlyZWN0U3BlY3VsYXIgd2lsbCBiZSB1c2VkIGZvciByaW0gbGlnaHRpbmcsIG5vdCBhbiBhY3R1YWwgc3BlY3VsYXJcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3RTcGVjdWxhciArPSBpcnJhZGlhbmNlO1xuXG4gICAgaXJyYWRpYW5jZSAqPSBkb3ROTDtcblxuICAgIC8vIFx1OTc2Mlx1OTBFOFx1OTYzNFx1NUY3MVx1OTY5NFx1NzlCQlx1RkYxQXJlY2VpdmVTaGFkb3dSYXRlID0gMCBcdTY1RjZcdTVGRkRcdTc1NjUgc2hhZG93bWFwIFx1NjI5NVx1NUMwNFx1OTYzNFx1NUY3MVx1RkYwQ1x1OTc2Mlx1OTBFOFx1NEZERFx1NjMwMVx1NzY3RFx1NTFDMFxuICAgIGZsb2F0IGVmZmVjdGl2ZVNoYWRvdyA9IG1peCggMS4wLCBzaGFkb3csIGNsYW1wKCByZWNlaXZlU2hhZG93UmF0ZSwgMC4wLCAxLjAgKSApO1xuXG4gICAgZmxvYXQgc2hhZGluZyA9IGdldFNoYWRpbmcoIGRvdE5MLCBlZmZlY3RpdmVTaGFkb3csIG1hdGVyaWFsLnNoYWRpbmdTaGlmdCApO1xuXG4gICAgLy8gdG9vbiBzaGFkZWQgZGlmZnVzZSAoKyBvcHRpb25hbCAybmQgYmFuZCBpbnNpZGUgZ2V0RGlmZnVzZSlcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldERpZmZ1c2UoIG1hdGVyaWFsLCBzaGFkaW5nLCBkaXJlY3RMaWdodC5jb2xvciwgZG90TkwsIGVmZmVjdGl2ZVNoYWRvdyApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0SGFpclNwZWMoIGdlb21ldHJ5Lm5vcm1hbCwgZGlyZWN0TGlnaHQuZGlyZWN0aW9uLCBnZW9tZXRyeS52aWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciwgc2hhZGluZyApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0Q2xvdGhTcGVjKCBnZW9tZXRyeS5ub3JtYWwsIGRpcmVjdExpZ2h0LmRpcmVjdGlvbiwgZ2VvbWV0cnkudmlld0RpciwgZGlyZWN0TGlnaHQuY29sb3IsIHNoYWRpbmcgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldEZhYnJpY1NoZWVuKCBnZW9tZXRyeS5ub3JtYWwsIGdlb21ldHJ5LnZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yICk7XG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXRTa2luU3BlYyggZ2VvbWV0cnkubm9ybWFsLCBkaXJlY3RMaWdodC5kaXJlY3Rpb24sIGdlb21ldHJ5LnZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yLCBzaGFkaW5nICk7XG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXRUb29uU3BlY3VsYXIoIGdlb21ldHJ5Lm5vcm1hbCwgZGlyZWN0TGlnaHQuZGlyZWN0aW9uLCBnZW9tZXRyeS52aWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciwgbWF0ZXJpYWwuZGlmZnVzZUNvbG9yLCBzaGFkaW5nICk7XG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXRFbnZSZWZsZWN0QXBwcm94KCBnZW9tZXRyeS5ub3JtYWwsIGdlb21ldHJ5LnZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yLCBtYXRlcmlhbC5kaWZmdXNlQ29sb3IsIHNoYWRpbmcgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldEJhY2tsaWdodCggZ2VvbWV0cnkubm9ybWFsLCBkaXJlY3RMaWdodC5kaXJlY3Rpb24sIGdlb21ldHJ5LnZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yLCBtYXRlcmlhbC5kaWZmdXNlQ29sb3IgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldEdlbUZyZXNuZWxQcm94eSggZ2VvbWV0cnkubm9ybWFsLCBnZW9tZXRyeS52aWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciwgbWF0ZXJpYWwuZGlmZnVzZUNvbG9yICk7XG4gIH1cblxuICB2b2lkIFJFX0luZGlyZWN0RGlmZnVzZV9NVG9vbiggY29uc3QgaW4gdmVjMyBpcnJhZGlhbmNlLCBjb25zdCBpbiBHZW9tZXRyaWNDb250ZXh0IGdlb21ldHJ5LCBjb25zdCBpbiBNVG9vbk1hdGVyaWFsIG1hdGVyaWFsLCBpbm91dCBSZWZsZWN0ZWRMaWdodCByZWZsZWN0ZWRMaWdodCApIHtcbiAgICBmbG9hdCBnaUF2ZyA9ICggaXJyYWRpYW5jZS5yICsgaXJyYWRpYW5jZS5nICsgaXJyYWRpYW5jZS5iICkgKiAoIDEuMCAvIDMuMCApO1xuICAgIHZlYzMgZ2kgPSBtaXgoIGlycmFkaWFuY2UsIHZlYzMoIGdpQXZnICksIGNsYW1wKCBnaUVxdWFsaXphdGlvbkZhY3RvciwgMC4wLCAxLjAgKSApO1xuICAgIGdpICo9ICggMS4wICsgbWF4KCAwLjAsIGFtYmllbnRMaWZ0ICkgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5pbmRpcmVjdERpZmZ1c2UgKz0gZ2kgKiBCUkRGX0xhbWJlcnQoIG1hdGVyaWFsLmRpZmZ1c2VDb2xvciApO1xuXG4gICAgLy8gZGlyZWN0U3BlY3VsYXIgd2lsbCBiZSB1c2VkIGZvciByaW0gbGlnaHRpbmcsIG5vdCBhbiBhY3R1YWwgc3BlY3VsYXJcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3RTcGVjdWxhciArPSBpcnJhZGlhbmNlO1xuICB9XG4jZW5kaWZcblxuI2RlZmluZSBSRV9EaXJlY3QgUkVfRGlyZWN0X01Ub29uXG4jZGVmaW5lIFJFX0luZGlyZWN0RGlmZnVzZSBSRV9JbmRpcmVjdERpZmZ1c2VfTVRvb25cbiNkZWZpbmUgTWF0ZXJpYWxfTGlnaHRQcm9iZUxPRCggbWF0ZXJpYWwgKSAoMClcblxuI2luY2x1ZGUgPHNoYWRvd21hcF9wYXJzX2ZyYWdtZW50PlxuLy8gI2luY2x1ZGUgPGJ1bXBtYXBfcGFyc19mcmFnbWVudD5cblxuLy8gI2luY2x1ZGUgPG5vcm1hbG1hcF9wYXJzX2ZyYWdtZW50PlxuI2lmZGVmIFVTRV9OT1JNQUxNQVBcblxuICB1bmlmb3JtIHNhbXBsZXIyRCBub3JtYWxNYXA7XG4gIHVuaWZvcm0gbWF0MyBub3JtYWxNYXBVdlRyYW5zZm9ybTtcbiAgdW5pZm9ybSB2ZWMyIG5vcm1hbFNjYWxlO1xuXG4jZW5kaWZcblxuLy8gQ09NUEFUOiBwcmUtcjE1MVxuLy8gVVNFX05PUk1BTE1BUF9PQkpFQ1RTUEFDRSB1c2VkIHRvIGJlIE9CSkVDVFNQQUNFX05PUk1BTE1BUCBpbiBwcmUtcjE1MVxuI2lmIGRlZmluZWQoIFVTRV9OT1JNQUxNQVBfT0JKRUNUU1BBQ0UgKSB8fCBkZWZpbmVkKCBPQkpFQ1RTUEFDRV9OT1JNQUxNQVAgKVxuXG4gIHVuaWZvcm0gbWF0MyBub3JtYWxNYXRyaXg7XG5cbiNlbmRpZlxuXG4vLyBDT01QQVQ6IHByZS1yMTUxXG4vLyBVU0VfTk9STUFMTUFQX1RBTkdFTlRTUEFDRSB1c2VkIHRvIGJlIFRBTkdFTlRTUEFDRV9OT1JNQUxNQVAgaW4gcHJlLXIxNTFcbiNpZiAhIGRlZmluZWQgKCBVU0VfVEFOR0VOVCApICYmICggZGVmaW5lZCAoIFVTRV9OT1JNQUxNQVBfVEFOR0VOVFNQQUNFICkgfHwgZGVmaW5lZCAoIFRBTkdFTlRTUEFDRV9OT1JNQUxNQVAgKSApXG5cbiAgLy8gUGVyLVBpeGVsIFRhbmdlbnQgU3BhY2UgTm9ybWFsIE1hcHBpbmdcbiAgLy8gaHR0cDovL2hhY2tzb2ZsaWZlLmJsb2dzcG90LmNoLzIwMDkvMTEvcGVyLXBpeGVsLXRhbmdlbnQtc3BhY2Utbm9ybWFsLW1hcHBpbmcuaHRtbFxuXG4gIC8vIHRocmVlLXZybSBzcGVjaWZpYyBjaGFuZ2U6IGl0IHJlcXVpcmVzIGB1dmAgYXMgYW4gaW5wdXQgaW4gb3JkZXIgdG8gc3VwcG9ydCB1diBzY3JvbGxzXG5cbiAgLy8gVGVtcG9yYXJ5IGNvbXBhdCBhZ2FpbnN0IHNoYWRlciBjaGFuZ2UgQCBUaHJlZS5qcyByMTI2LCByMTUxXG4gICNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPj0gMTUxXG5cbiAgICBtYXQzIGdldFRhbmdlbnRGcmFtZSggdmVjMyBleWVfcG9zLCB2ZWMzIHN1cmZfbm9ybSwgdmVjMiB1diApIHtcblxuICAgICAgdmVjMyBxMCA9IGRGZHgoIGV5ZV9wb3MueHl6ICk7XG4gICAgICB2ZWMzIHExID0gZEZkeSggZXllX3Bvcy54eXogKTtcbiAgICAgIHZlYzIgc3QwID0gZEZkeCggdXYuc3QgKTtcbiAgICAgIHZlYzIgc3QxID0gZEZkeSggdXYuc3QgKTtcblxuICAgICAgdmVjMyBOID0gc3VyZl9ub3JtO1xuXG4gICAgICB2ZWMzIHExcGVycCA9IGNyb3NzKCBxMSwgTiApO1xuICAgICAgdmVjMyBxMHBlcnAgPSBjcm9zcyggTiwgcTAgKTtcblxuICAgICAgdmVjMyBUID0gcTFwZXJwICogc3QwLnggKyBxMHBlcnAgKiBzdDEueDtcbiAgICAgIHZlYzMgQiA9IHExcGVycCAqIHN0MC55ICsgcTBwZXJwICogc3QxLnk7XG5cbiAgICAgIGZsb2F0IGRldCA9IG1heCggZG90KCBULCBUICksIGRvdCggQiwgQiApICk7XG4gICAgICBmbG9hdCBzY2FsZSA9ICggZGV0ID09IDAuMCApID8gMC4wIDogaW52ZXJzZXNxcnQoIGRldCApO1xuXG4gICAgICByZXR1cm4gbWF0MyggVCAqIHNjYWxlLCBCICogc2NhbGUsIE4gKTtcblxuICAgIH1cblxuICAjZWxzZVxuXG4gICAgdmVjMyBwZXJ0dXJiTm9ybWFsMkFyYiggdmVjMiB1diwgdmVjMyBleWVfcG9zLCB2ZWMzIHN1cmZfbm9ybSwgdmVjMyBtYXBOLCBmbG9hdCBmYWNlRGlyZWN0aW9uICkge1xuXG4gICAgICB2ZWMzIHEwID0gdmVjMyggZEZkeCggZXllX3Bvcy54ICksIGRGZHgoIGV5ZV9wb3MueSApLCBkRmR4KCBleWVfcG9zLnogKSApO1xuICAgICAgdmVjMyBxMSA9IHZlYzMoIGRGZHkoIGV5ZV9wb3MueCApLCBkRmR5KCBleWVfcG9zLnkgKSwgZEZkeSggZXllX3Bvcy56ICkgKTtcbiAgICAgIHZlYzIgc3QwID0gZEZkeCggdXYuc3QgKTtcbiAgICAgIHZlYzIgc3QxID0gZEZkeSggdXYuc3QgKTtcblxuICAgICAgdmVjMyBOID0gbm9ybWFsaXplKCBzdXJmX25vcm0gKTtcblxuICAgICAgdmVjMyBxMXBlcnAgPSBjcm9zcyggcTEsIE4gKTtcbiAgICAgIHZlYzMgcTBwZXJwID0gY3Jvc3MoIE4sIHEwICk7XG5cbiAgICAgIHZlYzMgVCA9IHExcGVycCAqIHN0MC54ICsgcTBwZXJwICogc3QxLng7XG4gICAgICB2ZWMzIEIgPSBxMXBlcnAgKiBzdDAueSArIHEwcGVycCAqIHN0MS55O1xuXG4gICAgICAvLyB0aHJlZS12cm0gc3BlY2lmaWMgY2hhbmdlOiBXb3JrYXJvdW5kIGZvciB0aGUgaXNzdWUgdGhhdCBoYXBwZW5zIHdoZW4gZGVsdGEgb2YgdXYgPSAwLjBcbiAgICAgIC8vIFRPRE86IElzIHRoaXMgc3RpbGwgcmVxdWlyZWQ/IE9yIHNoYWxsIEkgbWFrZSBhIFBSIGFib3V0IGl0P1xuICAgICAgaWYgKCBsZW5ndGgoIFQgKSA9PSAwLjAgfHwgbGVuZ3RoKCBCICkgPT0gMC4wICkge1xuICAgICAgICByZXR1cm4gc3VyZl9ub3JtO1xuICAgICAgfVxuXG4gICAgICBmbG9hdCBkZXQgPSBtYXgoIGRvdCggVCwgVCApLCBkb3QoIEIsIEIgKSApO1xuICAgICAgZmxvYXQgc2NhbGUgPSAoIGRldCA9PSAwLjAgKSA/IDAuMCA6IGZhY2VEaXJlY3Rpb24gKiBpbnZlcnNlc3FydCggZGV0ICk7XG5cbiAgICAgIHJldHVybiBub3JtYWxpemUoIFQgKiAoIG1hcE4ueCAqIHNjYWxlICkgKyBCICogKCBtYXBOLnkgKiBzY2FsZSApICsgTiAqIG1hcE4ueiApO1xuXG4gICAgfVxuXG4gICNlbmRpZlxuXG4jZW5kaWZcblxuLy8gI2luY2x1ZGUgPHNwZWN1bGFybWFwX3BhcnNfZnJhZ21lbnQ+XG4jaW5jbHVkZSA8bG9nZGVwdGhidWZfcGFyc19mcmFnbWVudD5cbiNpbmNsdWRlIDxjbGlwcGluZ19wbGFuZXNfcGFyc19mcmFnbWVudD5cblxuLy8gPT0gcG9zdCBjb3JyZWN0aW9uID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbnZvaWQgcG9zdENvcnJlY3Rpb24oKSB7XG4gICNpbmNsdWRlIDx0b25lbWFwcGluZ19mcmFnbWVudD5cbiAgI2luY2x1ZGUgPGNvbG9yc3BhY2VfZnJhZ21lbnQ+XG4gICNpbmNsdWRlIDxmb2dfZnJhZ21lbnQ+XG4gICNpbmNsdWRlIDxwcmVtdWx0aXBsaWVkX2FscGhhX2ZyYWdtZW50PlxuICAjaW5jbHVkZSA8ZGl0aGVyaW5nX2ZyYWdtZW50PlxufVxuXG4vLyA9PSBtYWluIHByb2NlZHVyZSA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxudm9pZCBtYWluKCkge1xuICAjaW5jbHVkZSA8Y2xpcHBpbmdfcGxhbmVzX2ZyYWdtZW50PlxuXG4gIHZlYzIgdXYgPSB2ZWMyKDAuNSwgMC41KTtcblxuICAjaWYgKCBkZWZpbmVkKCBNVE9PTl9VU0VfVVYgKSAmJiAhZGVmaW5lZCggTVRPT05fVVZTX1ZFUlRFWF9PTkxZICkgKVxuICAgIHV2ID0gdlV2O1xuXG4gICAgZmxvYXQgdXZBbmltTWFzayA9IDEuMDtcbiAgICAjaWZkZWYgVVNFX1VWQU5JTUFUSU9OTUFTS1RFWFRVUkVcbiAgICAgIHZlYzIgdXZBbmltYXRpb25NYXNrVGV4dHVyZVV2ID0gKCB1dkFuaW1hdGlvbk1hc2tUZXh0dXJlVXZUcmFuc2Zvcm0gKiB2ZWMzKCB1diwgMSApICkueHk7XG4gICAgICB1dkFuaW1NYXNrID0gdGV4dHVyZTJEKCB1dkFuaW1hdGlvbk1hc2tUZXh0dXJlLCB1dkFuaW1hdGlvbk1hc2tUZXh0dXJlVXYgKS5iO1xuICAgICNlbmRpZlxuXG4gICAgZmxvYXQgdXZSb3RDb3MgPSBjb3MoIHV2QW5pbWF0aW9uUm90YXRpb25QaGFzZSAqIHV2QW5pbU1hc2sgKTtcbiAgICBmbG9hdCB1dlJvdFNpbiA9IHNpbiggdXZBbmltYXRpb25Sb3RhdGlvblBoYXNlICogdXZBbmltTWFzayApO1xuICAgIHV2ID0gbWF0MiggdXZSb3RDb3MsIC11dlJvdFNpbiwgdXZSb3RTaW4sIHV2Um90Q29zICkgKiAoIHV2IC0gMC41ICkgKyAwLjU7XG4gICAgdXYgPSB1diArIHZlYzIoIHV2QW5pbWF0aW9uU2Nyb2xsWE9mZnNldCwgdXZBbmltYXRpb25TY3JvbGxZT2Zmc2V0ICkgKiB1dkFuaW1NYXNrO1xuICAjZW5kaWZcblxuICAjaWZkZWYgREVCVUdfVVZcbiAgICBnbF9GcmFnQ29sb3IgPSB2ZWM0KCAwLjAsIDAuMCwgMC4wLCAxLjAgKTtcbiAgICAjaWYgKCBkZWZpbmVkKCBNVE9PTl9VU0VfVVYgKSAmJiAhZGVmaW5lZCggTVRPT05fVVZTX1ZFUlRFWF9PTkxZICkgKVxuICAgICAgZ2xfRnJhZ0NvbG9yID0gdmVjNCggdXYsIDAuMCwgMS4wICk7XG4gICAgI2VuZGlmXG4gICAgcmV0dXJuO1xuICAjZW5kaWZcblxuICB2ZWM0IGRpZmZ1c2VDb2xvciA9IHZlYzQoIGxpdEZhY3Rvciwgb3BhY2l0eSApO1xuICBSZWZsZWN0ZWRMaWdodCByZWZsZWN0ZWRMaWdodCA9IFJlZmxlY3RlZExpZ2h0KCB2ZWMzKCAwLjAgKSwgdmVjMyggMC4wICksIHZlYzMoIDAuMCApLCB2ZWMzKCAwLjAgKSApO1xuICB2ZWMzIHRvdGFsRW1pc3NpdmVSYWRpYW5jZSA9IGVtaXNzaXZlICogZW1pc3NpdmVJbnRlbnNpdHk7XG5cbiAgI2luY2x1ZGUgPGxvZ2RlcHRoYnVmX2ZyYWdtZW50PlxuXG4gIC8vICNpbmNsdWRlIDxtYXBfZnJhZ21lbnQ+XG4gICNpZmRlZiBVU0VfTUFQXG4gICAgdmVjMiBtYXBVdiA9ICggbWFwVXZUcmFuc2Zvcm0gKiB2ZWMzKCB1diwgMSApICkueHk7XG4gICAgdmVjNCBzYW1wbGVkRGlmZnVzZUNvbG9yID0gdGV4dHVyZTJEKCBtYXAsIG1hcFV2ICk7XG4gICAgI2lmZGVmIERFQ09ERV9WSURFT19URVhUVVJFXG4gICAgICBzYW1wbGVkRGlmZnVzZUNvbG9yID0gdmVjNCggbWl4KCBwb3coIHNhbXBsZWREaWZmdXNlQ29sb3IucmdiICogMC45NDc4NjcyOTg2ICsgdmVjMyggMC4wNTIxMzI3MDE0ICksIHZlYzMoIDIuNCApICksIHNhbXBsZWREaWZmdXNlQ29sb3IucmdiICogMC4wNzczOTkzODA4LCB2ZWMzKCBsZXNzVGhhbkVxdWFsKCBzYW1wbGVkRGlmZnVzZUNvbG9yLnJnYiwgdmVjMyggMC4wNDA0NSApICkgKSApLCBzYW1wbGVkRGlmZnVzZUNvbG9yLncgKTtcbiAgICAjZW5kaWZcbiAgICBkaWZmdXNlQ29sb3IgKj0gc2FtcGxlZERpZmZ1c2VDb2xvcjtcbiAgI2VuZGlmXG5cbiAgLy8gI2luY2x1ZGUgPGNvbG9yX2ZyYWdtZW50PlxuICAjaWYgKCBkZWZpbmVkKCBVU0VfQ09MT1IgKSAmJiAhZGVmaW5lZCggSUdOT1JFX1ZFUlRFWF9DT0xPUiApIClcbiAgICBkaWZmdXNlQ29sb3IucmdiICo9IHZDb2xvcjtcbiAgI2VuZGlmXG5cbiAgLy8gI2luY2x1ZGUgPGFscGhhbWFwX2ZyYWdtZW50PlxuXG4gICNpbmNsdWRlIDxhbHBoYXRlc3RfZnJhZ21lbnQ+XG5cbiAgLy8gI2luY2x1ZGUgPHNwZWN1bGFybWFwX2ZyYWdtZW50PlxuXG4gIC8vICNpbmNsdWRlIDxub3JtYWxfZnJhZ21lbnRfYmVnaW4+XG4gIGZsb2F0IGZhY2VEaXJlY3Rpb24gPSBnbF9Gcm9udEZhY2luZyA/IDEuMCA6IC0xLjA7XG5cbiAgI2lmZGVmIEZMQVRfU0hBREVEXG5cbiAgICB2ZWMzIGZkeCA9IGRGZHgoIHZWaWV3UG9zaXRpb24gKTtcbiAgICB2ZWMzIGZkeSA9IGRGZHkoIHZWaWV3UG9zaXRpb24gKTtcbiAgICB2ZWMzIG5vcm1hbCA9IG5vcm1hbGl6ZSggY3Jvc3MoIGZkeCwgZmR5ICkgKTtcblxuICAjZWxzZVxuXG4gICAgdmVjMyBub3JtYWwgPSBub3JtYWxpemUoIHZOb3JtYWwgKTtcblxuICAgICNpZmRlZiBET1VCTEVfU0lERURcblxuICAgICAgbm9ybWFsICo9IGZhY2VEaXJlY3Rpb247XG5cbiAgICAjZW5kaWZcblxuICAjZW5kaWZcblxuICAjaWZkZWYgVVNFX05PUk1BTE1BUFxuXG4gICAgdmVjMiBub3JtYWxNYXBVdiA9ICggbm9ybWFsTWFwVXZUcmFuc2Zvcm0gKiB2ZWMzKCB1diwgMSApICkueHk7XG5cbiAgI2VuZGlmXG5cbiAgI2lmZGVmIFVTRV9OT1JNQUxNQVBfVEFOR0VOVFNQQUNFXG5cbiAgICAjaWZkZWYgVVNFX1RBTkdFTlRcblxuICAgICAgbWF0MyB0Ym4gPSBtYXQzKCBub3JtYWxpemUoIHZUYW5nZW50ICksIG5vcm1hbGl6ZSggdkJpdGFuZ2VudCApLCBub3JtYWwgKTtcblxuICAgICNlbHNlXG5cbiAgICAgIG1hdDMgdGJuID0gZ2V0VGFuZ2VudEZyYW1lKCAtIHZWaWV3UG9zaXRpb24sIG5vcm1hbCwgbm9ybWFsTWFwVXYgKTtcblxuICAgICNlbmRpZlxuXG4gICAgI2lmIGRlZmluZWQoIERPVUJMRV9TSURFRCApICYmICEgZGVmaW5lZCggRkxBVF9TSEFERUQgKVxuXG4gICAgICB0Ym5bMF0gKj0gZmFjZURpcmVjdGlvbjtcbiAgICAgIHRiblsxXSAqPSBmYWNlRGlyZWN0aW9uO1xuXG4gICAgI2VuZGlmXG5cbiAgI2VuZGlmXG5cbiAgI2lmZGVmIFVTRV9DTEVBUkNPQVRfTk9STUFMTUFQXG5cbiAgICAjaWZkZWYgVVNFX1RBTkdFTlRcblxuICAgICAgbWF0MyB0Ym4yID0gbWF0Myggbm9ybWFsaXplKCB2VGFuZ2VudCApLCBub3JtYWxpemUoIHZCaXRhbmdlbnQgKSwgbm9ybWFsICk7XG5cbiAgICAjZWxzZVxuXG4gICAgICBtYXQzIHRibjIgPSBnZXRUYW5nZW50RnJhbWUoIC0gdlZpZXdQb3NpdGlvbiwgbm9ybWFsLCB2Q2xlYXJjb2F0Tm9ybWFsTWFwVXYgKTtcblxuICAgICNlbmRpZlxuXG4gICAgI2lmIGRlZmluZWQoIERPVUJMRV9TSURFRCApICYmICEgZGVmaW5lZCggRkxBVF9TSEFERUQgKVxuXG4gICAgICB0Ym4yWzBdICo9IGZhY2VEaXJlY3Rpb247XG4gICAgICB0Ym4yWzFdICo9IGZhY2VEaXJlY3Rpb247XG5cbiAgICAjZW5kaWZcblxuICAjZW5kaWZcblxuICAvLyBub24gcGVydHVyYmVkIG5vcm1hbCBmb3IgY2xlYXJjb2F0IGFtb25nIG90aGVyc1xuXG4gIHZlYzMgbm9uUGVydHVyYmVkTm9ybWFsID0gbm9ybWFsO1xuXG4gICNpZmRlZiBPVVRMSU5FXG4gICAgbm9ybWFsICo9IC0xLjA7XG4gICNlbmRpZlxuXG4gIC8vICNpbmNsdWRlIDxub3JtYWxfZnJhZ21lbnRfbWFwcz5cblxuICAvLyBDT01QQVQ6IHByZS1yMTUxXG4gIC8vIFVTRV9OT1JNQUxNQVBfT0JKRUNUU1BBQ0UgdXNlZCB0byBiZSBPQkpFQ1RTUEFDRV9OT1JNQUxNQVAgaW4gcHJlLXIxNTFcbiAgI2lmIGRlZmluZWQoIFVTRV9OT1JNQUxNQVBfT0JKRUNUU1BBQ0UgKSB8fCBkZWZpbmVkKCBPQkpFQ1RTUEFDRV9OT1JNQUxNQVAgKVxuXG4gICAgbm9ybWFsID0gdGV4dHVyZTJEKCBub3JtYWxNYXAsIG5vcm1hbE1hcFV2ICkueHl6ICogMi4wIC0gMS4wOyAvLyBvdmVycmlkZXMgYm90aCBmbGF0U2hhZGluZyBhbmQgYXR0cmlidXRlIG5vcm1hbHNcblxuICAgICNpZmRlZiBGTElQX1NJREVEXG5cbiAgICAgIG5vcm1hbCA9IC0gbm9ybWFsO1xuXG4gICAgI2VuZGlmXG5cbiAgICAjaWZkZWYgRE9VQkxFX1NJREVEXG5cbiAgICAgIG5vcm1hbCA9IG5vcm1hbCAqIGZhY2VEaXJlY3Rpb247XG5cbiAgICAjZW5kaWZcblxuICAgIG5vcm1hbCA9IG5vcm1hbGl6ZSggbm9ybWFsTWF0cml4ICogbm9ybWFsICk7XG5cbiAgLy8gQ09NUEFUOiBwcmUtcjE1MVxuICAvLyBVU0VfTk9STUFMTUFQX1RBTkdFTlRTUEFDRSB1c2VkIHRvIGJlIFRBTkdFTlRTUEFDRV9OT1JNQUxNQVAgaW4gcHJlLXIxNTFcbiAgI2VsaWYgZGVmaW5lZCggVVNFX05PUk1BTE1BUF9UQU5HRU5UU1BBQ0UgKSB8fCBkZWZpbmVkKCBUQU5HRU5UU1BBQ0VfTk9STUFMTUFQIClcblxuICAgIHZlYzMgbWFwTiA9IHRleHR1cmUyRCggbm9ybWFsTWFwLCBub3JtYWxNYXBVdiApLnh5eiAqIDIuMCAtIDEuMDtcbiAgICBtYXBOLnh5ICo9IG5vcm1hbFNjYWxlO1xuICAgIC8vIFNraW4gZGVwdGg6IGFtcGxpZnkgdGFuZ2VudCBub3JtYWwgWFkgd2hlbiBmYWNlL2JvZHkgcHJlc2V0IHNldHMgYm9vc3QgKE5QUiBub3JtYWwgZmVlbClcbiAgICBtYXBOLnh5ICo9ICggMS4wICsgY2xhbXAoIG5vcm1hbFNraW5Cb29zdCwgMC4wLCAxLjAgKSAqIDAuNTUgKTtcblxuICAgIC8vIENPTVBBVDogcHJlLXIxNTFcbiAgICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE1MSB8fCBkZWZpbmVkKCBVU0VfVEFOR0VOVCApXG5cbiAgICAgIG5vcm1hbCA9IG5vcm1hbGl6ZSggdGJuICogbWFwTiApO1xuXG4gICAgI2Vsc2VcblxuICAgICAgbm9ybWFsID0gcGVydHVyYk5vcm1hbDJBcmIoIHV2LCAtdlZpZXdQb3NpdGlvbiwgbm9ybWFsLCBtYXBOLCBmYWNlRGlyZWN0aW9uICk7XG5cbiAgICAjZW5kaWZcblxuICAjZW5kaWZcblxuICAvLyAjaW5jbHVkZSA8ZW1pc3NpdmVtYXBfZnJhZ21lbnQ+XG4gICNpZmRlZiBVU0VfRU1JU1NJVkVNQVBcbiAgICB2ZWMyIGVtaXNzaXZlTWFwVXYgPSAoIGVtaXNzaXZlTWFwVXZUcmFuc2Zvcm0gKiB2ZWMzKCB1diwgMSApICkueHk7XG4gICAgdG90YWxFbWlzc2l2ZVJhZGlhbmNlICo9IHRleHR1cmUyRCggZW1pc3NpdmVNYXAsIGVtaXNzaXZlTWFwVXYgKS5yZ2I7XG4gICNlbmRpZlxuXG4gICNpZmRlZiBERUJVR19OT1JNQUxcbiAgICBnbF9GcmFnQ29sb3IgPSB2ZWM0KCAwLjUgKyAwLjUgKiBub3JtYWwsIDEuMCApO1xuICAgIHJldHVybjtcbiAgI2VuZGlmXG5cbiAgLy8gLS0gTVRvb246IGxpZ2h0aW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gIC8vIGFjY3VtdWxhdGlvblxuICAvLyAjaW5jbHVkZSA8bGlnaHRzX3Bob25nX2ZyYWdtZW50PlxuICBNVG9vbk1hdGVyaWFsIG1hdGVyaWFsO1xuXG4gIG1hdGVyaWFsLmRpZmZ1c2VDb2xvciA9IGRpZmZ1c2VDb2xvci5yZ2I7XG5cbiAgbWF0ZXJpYWwuc2hhZGVDb2xvciA9IHNoYWRlQ29sb3JGYWN0b3I7XG4gICNpZmRlZiBVU0VfU0hBREVNVUxUSVBMWVRFWFRVUkVcbiAgICB2ZWMyIHNoYWRlTXVsdGlwbHlUZXh0dXJlVXYgPSAoIHNoYWRlTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm0gKiB2ZWMzKCB1diwgMSApICkueHk7XG4gICAgbWF0ZXJpYWwuc2hhZGVDb2xvciAqPSB0ZXh0dXJlMkQoIHNoYWRlTXVsdGlwbHlUZXh0dXJlLCBzaGFkZU11bHRpcGx5VGV4dHVyZVV2ICkucmdiO1xuICAjZW5kaWZcblxuICAjaWYgKCBkZWZpbmVkKCBVU0VfQ09MT1IgKSAmJiAhZGVmaW5lZCggSUdOT1JFX1ZFUlRFWF9DT0xPUiApIClcbiAgICBtYXRlcmlhbC5zaGFkZUNvbG9yLnJnYiAqPSB2Q29sb3I7XG4gICNlbmRpZlxuXG4gIG1hdGVyaWFsLnNoYWRpbmdTaGlmdCA9IHNoYWRpbmdTaGlmdEZhY3RvcjtcbiAgI2lmZGVmIFVTRV9TSEFESU5HU0hJRlRURVhUVVJFXG4gICAgdmVjMiBzaGFkaW5nU2hpZnRUZXh0dXJlVXYgPSAoIHNoYWRpbmdTaGlmdFRleHR1cmVVdlRyYW5zZm9ybSAqIHZlYzMoIHV2LCAxICkgKS54eTtcbiAgICBtYXRlcmlhbC5zaGFkaW5nU2hpZnQgKz0gdGV4dHVyZTJEKCBzaGFkaW5nU2hpZnRUZXh0dXJlLCBzaGFkaW5nU2hpZnRUZXh0dXJlVXYgKS5yICogc2hhZGluZ1NoaWZ0VGV4dHVyZVNjYWxlO1xuICAjZW5kaWZcblxuICAvLyAjaW5jbHVkZSA8bGlnaHRzX2ZyYWdtZW50X2JlZ2luPlxuXG4gIC8vIE1Ub29uIFNwZWNpZmljIGNoYW5nZXM6XG4gIC8vIFNpbmNlIHdlIHdhbnQgdG8gdGFrZSBzaGFkb3dzIGludG8gYWNjb3VudCBvZiBzaGFkaW5nIGluc3RlYWQgb2YgaXJyYWRpYW5jZSxcbiAgLy8gd2UgaGFkIHRvIG1vZGlmeSB0aGUgY29kZXMgdGhhdCBtdWx0aXBsaWVzIHRoZSByZXN1bHRzIG9mIHNoYWRvd21hcCBpbnRvIGNvbG9yIG9mIGRpcmVjdCBsaWdodHMuXG5cbiAgLy8gQ09NUEFUOiBwcmUtcjE1NiB1c2VzIGEgc3RydWN0IEdlb21ldHJpY0NvbnRleHRcbiAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTdcbiAgICB2ZWMzIGdlb21ldHJ5UG9zaXRpb24gPSAtIHZWaWV3UG9zaXRpb247XG4gICAgdmVjMyBnZW9tZXRyeU5vcm1hbCA9IG5vcm1hbDtcbiAgICB2ZWMzIGdlb21ldHJ5Vmlld0RpciA9ICggaXNPcnRob2dyYXBoaWMgKSA/IHZlYzMoIDAsIDAsIDEgKSA6IG5vcm1hbGl6ZSggdlZpZXdQb3NpdGlvbiApO1xuXG4gICAgdmVjMyBnZW9tZXRyeUNsZWFyY29hdE5vcm1hbDtcblxuICAgICNpZmRlZiBVU0VfQ0xFQVJDT0FUXG5cbiAgICAgIGdlb21ldHJ5Q2xlYXJjb2F0Tm9ybWFsID0gY2xlYXJjb2F0Tm9ybWFsO1xuXG4gICAgI2VuZGlmXG4gICNlbHNlXG4gICAgR2VvbWV0cmljQ29udGV4dCBnZW9tZXRyeTtcblxuICAgIGdlb21ldHJ5LnBvc2l0aW9uID0gLSB2Vmlld1Bvc2l0aW9uO1xuICAgIGdlb21ldHJ5Lm5vcm1hbCA9IG5vcm1hbDtcbiAgICBnZW9tZXRyeS52aWV3RGlyID0gKCBpc09ydGhvZ3JhcGhpYyApID8gdmVjMyggMCwgMCwgMSApIDogbm9ybWFsaXplKCB2Vmlld1Bvc2l0aW9uICk7XG5cbiAgICAjaWZkZWYgVVNFX0NMRUFSQ09BVFxuXG4gICAgICBnZW9tZXRyeS5jbGVhcmNvYXROb3JtYWwgPSBjbGVhcmNvYXROb3JtYWw7XG5cbiAgICAjZW5kaWZcbiAgI2VuZGlmXG5cbiAgSW5jaWRlbnRMaWdodCBkaXJlY3RMaWdodDtcblxuICAvLyBzaW5jZSB0aGVzZSB2YXJpYWJsZXMgd2lsbCBiZSB1c2VkIGluIHVucm9sbGVkIGxvb3AsIHdlIGhhdmUgdG8gZGVmaW5lIGluIHByaW9yXG4gIGZsb2F0IHNoYWRvdztcblxuICAjaWYgKCBOVU1fUE9JTlRfTElHSFRTID4gMCApICYmIGRlZmluZWQoIFJFX0RpcmVjdCApXG5cbiAgICBQb2ludExpZ2h0IHBvaW50TGlnaHQ7XG4gICAgI2lmIGRlZmluZWQoIFVTRV9TSEFET1dNQVAgKSAmJiBOVU1fUE9JTlRfTElHSFRfU0hBRE9XUyA+IDBcbiAgICBQb2ludExpZ2h0U2hhZG93IHBvaW50TGlnaHRTaGFkb3c7XG4gICAgI2VuZGlmXG5cbiAgICAjcHJhZ21hIHVucm9sbF9sb29wX3N0YXJ0XG4gICAgZm9yICggaW50IGkgPSAwOyBpIDwgTlVNX1BPSU5UX0xJR0hUUzsgaSArKyApIHtcblxuICAgICAgcG9pbnRMaWdodCA9IHBvaW50TGlnaHRzWyBpIF07XG5cbiAgICAgIC8vIENPTVBBVDogcHJlLXIxNTYgdXNlcyBhIHN0cnVjdCBHZW9tZXRyaWNDb250ZXh0XG4gICAgICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE1N1xuICAgICAgICBnZXRQb2ludExpZ2h0SW5mbyggcG9pbnRMaWdodCwgZ2VvbWV0cnlQb3NpdGlvbiwgZGlyZWN0TGlnaHQgKTtcbiAgICAgICNlbHNlXG4gICAgICAgIGdldFBvaW50TGlnaHRJbmZvKCBwb2ludExpZ2h0LCBnZW9tZXRyeSwgZGlyZWN0TGlnaHQgKTtcbiAgICAgICNlbmRpZlxuXG4gICAgICBzaGFkb3cgPSAxLjA7XG4gICAgICAjaWYgZGVmaW5lZCggVVNFX1NIQURPV01BUCApICYmICggVU5ST0xMRURfTE9PUF9JTkRFWCA8IE5VTV9QT0lOVF9MSUdIVF9TSEFET1dTIClcbiAgICAgIHBvaW50TGlnaHRTaGFkb3cgPSBwb2ludExpZ2h0U2hhZG93c1sgaSBdO1xuICAgICAgLy8gQ09NUEFUOiBwcmUtcjE2NlxuICAgICAgLy8gcjE2NiBpbnRyb2R1Y2VkIHNoYWRvd0ludGVuc2l0eVxuICAgICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNjZcbiAgICAgICAgc2hhZG93ID0gYWxsKCBidmVjMiggZGlyZWN0TGlnaHQudmlzaWJsZSwgcmVjZWl2ZVNoYWRvdyApICkgPyBnZXRQb2ludFNoYWRvdyggcG9pbnRTaGFkb3dNYXBbIGkgXSwgcG9pbnRMaWdodFNoYWRvdy5zaGFkb3dNYXBTaXplLCBwb2ludExpZ2h0U2hhZG93LnNoYWRvd0ludGVuc2l0eSwgcG9pbnRMaWdodFNoYWRvdy5zaGFkb3dCaWFzLCBwb2ludExpZ2h0U2hhZG93LnNoYWRvd1JhZGl1cywgdlBvaW50U2hhZG93Q29vcmRbIGkgXSwgcG9pbnRMaWdodFNoYWRvdy5zaGFkb3dDYW1lcmFOZWFyLCBwb2ludExpZ2h0U2hhZG93LnNoYWRvd0NhbWVyYUZhciApIDogMS4wO1xuICAgICAgI2Vsc2VcbiAgICAgICAgc2hhZG93ID0gYWxsKCBidmVjMiggZGlyZWN0TGlnaHQudmlzaWJsZSwgcmVjZWl2ZVNoYWRvdyApICkgPyBnZXRQb2ludFNoYWRvdyggcG9pbnRTaGFkb3dNYXBbIGkgXSwgcG9pbnRMaWdodFNoYWRvdy5zaGFkb3dNYXBTaXplLCBwb2ludExpZ2h0U2hhZG93LnNoYWRvd0JpYXMsIHBvaW50TGlnaHRTaGFkb3cuc2hhZG93UmFkaXVzLCB2UG9pbnRTaGFkb3dDb29yZFsgaSBdLCBwb2ludExpZ2h0U2hhZG93LnNoYWRvd0NhbWVyYU5lYXIsIHBvaW50TGlnaHRTaGFkb3cuc2hhZG93Q2FtZXJhRmFyICkgOiAxLjA7XG4gICAgICAjZW5kaWZcbiAgICAgICNlbmRpZlxuXG4gICAgICAvLyBDT01QQVQ6IHByZS1yMTU2IHVzZXMgYSBzdHJ1Y3QgR2VvbWV0cmljQ29udGV4dFxuICAgICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTdcbiAgICAgICAgUkVfRGlyZWN0KCBkaXJlY3RMaWdodCwgZ2VvbWV0cnlQb3NpdGlvbiwgZ2VvbWV0cnlOb3JtYWwsIGdlb21ldHJ5Vmlld0RpciwgZ2VvbWV0cnlDbGVhcmNvYXROb3JtYWwsIG1hdGVyaWFsLCBzaGFkb3csIHJlZmxlY3RlZExpZ2h0ICk7XG4gICAgICAjZWxzZVxuICAgICAgICBSRV9EaXJlY3QoIGRpcmVjdExpZ2h0LCBnZW9tZXRyeSwgbWF0ZXJpYWwsIHNoYWRvdywgcmVmbGVjdGVkTGlnaHQgKTtcbiAgICAgICNlbmRpZlxuXG4gICAgfVxuICAgICNwcmFnbWEgdW5yb2xsX2xvb3BfZW5kXG5cbiAgI2VuZGlmXG5cbiAgI2lmICggTlVNX1NQT1RfTElHSFRTID4gMCApICYmIGRlZmluZWQoIFJFX0RpcmVjdCApXG5cbiAgICBTcG90TGlnaHQgc3BvdExpZ2h0O1xuICAgIC8vIENPTVBBVDogcHJlLXIxNDQgdXNlcyBOVU1fU1BPVF9MSUdIVF9TSEFET1dTLCByMTQ0KyB1c2VzIE5VTV9TUE9UX0xJR0hUX0NPT1JEU1xuICAgICNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPj0gMTQ0XG4gICAgICAjaWYgZGVmaW5lZCggVVNFX1NIQURPV01BUCApICYmIE5VTV9TUE9UX0xJR0hUX0NPT1JEUyA+IDBcbiAgICAgIFNwb3RMaWdodFNoYWRvdyBzcG90TGlnaHRTaGFkb3c7XG4gICAgICAjZW5kaWZcbiAgICAjZWxpZiBkZWZpbmVkKCBVU0VfU0hBRE9XTUFQICkgJiYgTlVNX1NQT1RfTElHSFRfU0hBRE9XUyA+IDBcbiAgICBTcG90TGlnaHRTaGFkb3cgc3BvdExpZ2h0U2hhZG93O1xuICAgICNlbmRpZlxuXG4gICAgI3ByYWdtYSB1bnJvbGxfbG9vcF9zdGFydFxuICAgIGZvciAoIGludCBpID0gMDsgaSA8IE5VTV9TUE9UX0xJR0hUUzsgaSArKyApIHtcblxuICAgICAgc3BvdExpZ2h0ID0gc3BvdExpZ2h0c1sgaSBdO1xuXG4gICAgICAvLyBDT01QQVQ6IHByZS1yMTU2IHVzZXMgYSBzdHJ1Y3QgR2VvbWV0cmljQ29udGV4dFxuICAgICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTdcbiAgICAgICAgZ2V0U3BvdExpZ2h0SW5mbyggc3BvdExpZ2h0LCBnZW9tZXRyeVBvc2l0aW9uLCBkaXJlY3RMaWdodCApO1xuICAgICAgI2Vsc2VcbiAgICAgICAgZ2V0U3BvdExpZ2h0SW5mbyggc3BvdExpZ2h0LCBnZW9tZXRyeSwgZGlyZWN0TGlnaHQgKTtcbiAgICAgICNlbmRpZlxuXG4gICAgICBzaGFkb3cgPSAxLjA7XG4gICAgICAvLyBDT01QQVQ6IHByZS1yMTQ0IHVzZXMgTlVNX1NQT1RfTElHSFRfU0hBRE9XUyBhbmQgdlNwb3RTaGFkb3dDb29yZCwgcjE0NCsgdXNlcyBOVU1fU1BPVF9MSUdIVF9DT09SRFMgYW5kIHZTcG90TGlnaHRDb29yZFxuICAgICAgLy8gQ09NUEFUOiBwcmUtcjE2NiBkb2VzIG5vdCBoYXZlIHNoYWRvd0ludGVuc2l0eSwgcjE2NisgaGFzIHNoYWRvd0ludGVuc2l0eVxuICAgICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNjZcbiAgICAgICAgI2lmIGRlZmluZWQoIFVTRV9TSEFET1dNQVAgKSAmJiAoIFVOUk9MTEVEX0xPT1BfSU5ERVggPCBOVU1fU1BPVF9MSUdIVF9DT09SRFMgKVxuICAgICAgICBzcG90TGlnaHRTaGFkb3cgPSBzcG90TGlnaHRTaGFkb3dzWyBpIF07XG4gICAgICAgIHNoYWRvdyA9IGFsbCggYnZlYzIoIGRpcmVjdExpZ2h0LnZpc2libGUsIHJlY2VpdmVTaGFkb3cgKSApID8gZ2V0U2hhZG93KCBzcG90U2hhZG93TWFwWyBpIF0sIHNwb3RMaWdodFNoYWRvdy5zaGFkb3dNYXBTaXplLCBzcG90TGlnaHRTaGFkb3cuc2hhZG93SW50ZW5zaXR5LCBzcG90TGlnaHRTaGFkb3cuc2hhZG93Qmlhcywgc3BvdExpZ2h0U2hhZG93LnNoYWRvd1JhZGl1cywgdlNwb3RMaWdodENvb3JkWyBpIF0gKSA6IDEuMDtcbiAgICAgICAgI2VuZGlmXG4gICAgICAjZWxpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPj0gMTQ0XG4gICAgICAgICNpZiBkZWZpbmVkKCBVU0VfU0hBRE9XTUFQICkgJiYgKCBVTlJPTExFRF9MT09QX0lOREVYIDwgTlVNX1NQT1RfTElHSFRfQ09PUkRTIClcbiAgICAgICAgc3BvdExpZ2h0U2hhZG93ID0gc3BvdExpZ2h0U2hhZG93c1sgaSBdO1xuICAgICAgICBzaGFkb3cgPSBhbGwoIGJ2ZWMyKCBkaXJlY3RMaWdodC52aXNpYmxlLCByZWNlaXZlU2hhZG93ICkgKSA/IGdldFNoYWRvdyggc3BvdFNoYWRvd01hcFsgaSBdLCBzcG90TGlnaHRTaGFkb3cuc2hhZG93TWFwU2l6ZSwgc3BvdExpZ2h0U2hhZG93LnNoYWRvd0JpYXMsIHNwb3RMaWdodFNoYWRvdy5zaGFkb3dSYWRpdXMsIHZTcG90TGlnaHRDb29yZFsgaSBdICkgOiAxLjA7XG4gICAgICAgICNlbmRpZlxuICAgICAgI2VsaWYgZGVmaW5lZCggVVNFX1NIQURPV01BUCApICYmICggVU5ST0xMRURfTE9PUF9JTkRFWCA8IE5VTV9TUE9UX0xJR0hUX1NIQURPV1MgKVxuICAgICAgc3BvdExpZ2h0U2hhZG93ID0gc3BvdExpZ2h0U2hhZG93c1sgaSBdO1xuICAgICAgc2hhZG93ID0gYWxsKCBidmVjMiggZGlyZWN0TGlnaHQudmlzaWJsZSwgcmVjZWl2ZVNoYWRvdyApICkgPyBnZXRTaGFkb3coIHNwb3RTaGFkb3dNYXBbIGkgXSwgc3BvdExpZ2h0U2hhZG93LnNoYWRvd01hcFNpemUsIHNwb3RMaWdodFNoYWRvdy5zaGFkb3dCaWFzLCBzcG90TGlnaHRTaGFkb3cuc2hhZG93UmFkaXVzLCB2U3BvdFNoYWRvd0Nvb3JkWyBpIF0gKSA6IDEuMDtcbiAgICAgICNlbmRpZlxuXG4gICAgICAvLyBDT01QQVQ6IHByZS1yMTU2IHVzZXMgYSBzdHJ1Y3QgR2VvbWV0cmljQ29udGV4dFxuICAgICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTdcbiAgICAgICAgUkVfRGlyZWN0KCBkaXJlY3RMaWdodCwgZ2VvbWV0cnlQb3NpdGlvbiwgZ2VvbWV0cnlOb3JtYWwsIGdlb21ldHJ5Vmlld0RpciwgZ2VvbWV0cnlDbGVhcmNvYXROb3JtYWwsIG1hdGVyaWFsLCBzaGFkb3csIHJlZmxlY3RlZExpZ2h0ICk7XG4gICAgICAjZWxzZVxuICAgICAgICBSRV9EaXJlY3QoIGRpcmVjdExpZ2h0LCBnZW9tZXRyeSwgbWF0ZXJpYWwsIHNoYWRvdywgcmVmbGVjdGVkTGlnaHQgKTtcbiAgICAgICNlbmRpZlxuXG4gICAgfVxuICAgICNwcmFnbWEgdW5yb2xsX2xvb3BfZW5kXG5cbiAgI2VuZGlmXG5cbiAgI2lmICggTlVNX0RJUl9MSUdIVFMgPiAwICkgJiYgZGVmaW5lZCggUkVfRGlyZWN0IClcblxuICAgIERpcmVjdGlvbmFsTGlnaHQgZGlyZWN0aW9uYWxMaWdodDtcbiAgICAjaWYgZGVmaW5lZCggVVNFX1NIQURPV01BUCApICYmIE5VTV9ESVJfTElHSFRfU0hBRE9XUyA+IDBcbiAgICBEaXJlY3Rpb25hbExpZ2h0U2hhZG93IGRpcmVjdGlvbmFsTGlnaHRTaGFkb3c7XG4gICAgI2VuZGlmXG5cbiAgICAjcHJhZ21hIHVucm9sbF9sb29wX3N0YXJ0XG4gICAgZm9yICggaW50IGkgPSAwOyBpIDwgTlVNX0RJUl9MSUdIVFM7IGkgKysgKSB7XG5cbiAgICAgIGRpcmVjdGlvbmFsTGlnaHQgPSBkaXJlY3Rpb25hbExpZ2h0c1sgaSBdO1xuXG4gICAgICAvLyBDT01QQVQ6IHByZS1yMTU2IHVzZXMgYSBzdHJ1Y3QgR2VvbWV0cmljQ29udGV4dFxuICAgICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTdcbiAgICAgICAgZ2V0RGlyZWN0aW9uYWxMaWdodEluZm8oIGRpcmVjdGlvbmFsTGlnaHQsIGRpcmVjdExpZ2h0ICk7XG4gICAgICAjZWxzZVxuICAgICAgICBnZXREaXJlY3Rpb25hbExpZ2h0SW5mbyggZGlyZWN0aW9uYWxMaWdodCwgZ2VvbWV0cnksIGRpcmVjdExpZ2h0ICk7XG4gICAgICAjZW5kaWZcblxuICAgICAgc2hhZG93ID0gMS4wO1xuICAgICAgI2lmIGRlZmluZWQoIFVTRV9TSEFET1dNQVAgKSAmJiAoIFVOUk9MTEVEX0xPT1BfSU5ERVggPCBOVU1fRElSX0xJR0hUX1NIQURPV1MgKVxuICAgICAgZGlyZWN0aW9uYWxMaWdodFNoYWRvdyA9IGRpcmVjdGlvbmFsTGlnaHRTaGFkb3dzWyBpIF07XG4gICAgICAvLyBDT01QQVQ6IHByZS1yMTY2XG4gICAgICAvLyByMTY2IGludHJvZHVjZWQgc2hhZG93SW50ZW5zaXR5XG4gICAgICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE2NlxuICAgICAgICBzaGFkb3cgPSBhbGwoIGJ2ZWMyKCBkaXJlY3RMaWdodC52aXNpYmxlLCByZWNlaXZlU2hhZG93ICkgKSA/IGdldFNoYWRvdyggZGlyZWN0aW9uYWxTaGFkb3dNYXBbIGkgXSwgZGlyZWN0aW9uYWxMaWdodFNoYWRvdy5zaGFkb3dNYXBTaXplLCBkaXJlY3Rpb25hbExpZ2h0U2hhZG93LnNoYWRvd0ludGVuc2l0eSwgZGlyZWN0aW9uYWxMaWdodFNoYWRvdy5zaGFkb3dCaWFzLCBkaXJlY3Rpb25hbExpZ2h0U2hhZG93LnNoYWRvd1JhZGl1cywgdkRpcmVjdGlvbmFsU2hhZG93Q29vcmRbIGkgXSApIDogMS4wO1xuICAgICAgI2Vsc2VcbiAgICAgICAgc2hhZG93ID0gYWxsKCBidmVjMiggZGlyZWN0TGlnaHQudmlzaWJsZSwgcmVjZWl2ZVNoYWRvdyApICkgPyBnZXRTaGFkb3coIGRpcmVjdGlvbmFsU2hhZG93TWFwWyBpIF0sIGRpcmVjdGlvbmFsTGlnaHRTaGFkb3cuc2hhZG93TWFwU2l6ZSwgZGlyZWN0aW9uYWxMaWdodFNoYWRvdy5zaGFkb3dCaWFzLCBkaXJlY3Rpb25hbExpZ2h0U2hhZG93LnNoYWRvd1JhZGl1cywgdkRpcmVjdGlvbmFsU2hhZG93Q29vcmRbIGkgXSApIDogMS4wO1xuICAgICAgI2VuZGlmXG4gICAgICAjZW5kaWZcblxuICAgICAgLy8gQ09NUEFUOiBwcmUtcjE1NiB1c2VzIGEgc3RydWN0IEdlb21ldHJpY0NvbnRleHRcbiAgICAgICNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPj0gMTU3XG4gICAgICAgIFJFX0RpcmVjdCggZGlyZWN0TGlnaHQsIGdlb21ldHJ5UG9zaXRpb24sIGdlb21ldHJ5Tm9ybWFsLCBnZW9tZXRyeVZpZXdEaXIsIGdlb21ldHJ5Q2xlYXJjb2F0Tm9ybWFsLCBtYXRlcmlhbCwgc2hhZG93LCByZWZsZWN0ZWRMaWdodCApO1xuICAgICAgI2Vsc2VcbiAgICAgICAgUkVfRGlyZWN0KCBkaXJlY3RMaWdodCwgZ2VvbWV0cnksIG1hdGVyaWFsLCBzaGFkb3csIHJlZmxlY3RlZExpZ2h0ICk7XG4gICAgICAjZW5kaWZcblxuICAgIH1cbiAgICAjcHJhZ21hIHVucm9sbF9sb29wX2VuZFxuXG4gICNlbmRpZlxuXG4gIC8vICNpZiAoIE5VTV9SRUNUX0FSRUFfTElHSFRTID4gMCApICYmIGRlZmluZWQoIFJFX0RpcmVjdF9SZWN0QXJlYSApXG5cbiAgLy8gICBSZWN0QXJlYUxpZ2h0IHJlY3RBcmVhTGlnaHQ7XG5cbiAgLy8gICAjcHJhZ21hIHVucm9sbF9sb29wX3N0YXJ0XG4gIC8vICAgZm9yICggaW50IGkgPSAwOyBpIDwgTlVNX1JFQ1RfQVJFQV9MSUdIVFM7IGkgKysgKSB7XG5cbiAgLy8gICAgIHJlY3RBcmVhTGlnaHQgPSByZWN0QXJlYUxpZ2h0c1sgaSBdO1xuICAvLyAgICAgUkVfRGlyZWN0X1JlY3RBcmVhKCByZWN0QXJlYUxpZ2h0LCBnZW9tZXRyeSwgbWF0ZXJpYWwsIHJlZmxlY3RlZExpZ2h0ICk7XG5cbiAgLy8gICB9XG4gIC8vICAgI3ByYWdtYSB1bnJvbGxfbG9vcF9lbmRcblxuICAvLyAjZW5kaWZcblxuICAjaWYgZGVmaW5lZCggUkVfSW5kaXJlY3REaWZmdXNlIClcblxuICAgIHZlYzMgaWJsSXJyYWRpYW5jZSA9IHZlYzMoIDAuMCApO1xuXG4gICAgdmVjMyBpcnJhZGlhbmNlID0gZ2V0QW1iaWVudExpZ2h0SXJyYWRpYW5jZSggYW1iaWVudExpZ2h0Q29sb3IgKTtcblxuICAgIC8vIENPTVBBVDogcHJlLXIxNTYgdXNlcyBhIHN0cnVjdCBHZW9tZXRyaWNDb250ZXh0XG4gICAgLy8gQ09NUEFUOiBwcmUtcjE1NiBkb2Vzbid0IGhhdmUgYSBkZWZpbmUgVVNFX0xJR0hUX1BST0JFU1xuICAgICNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPj0gMTU3XG4gICAgICAjaWYgZGVmaW5lZCggVVNFX0xJR0hUX1BST0JFUyApXG4gICAgICAgIGlycmFkaWFuY2UgKz0gZ2V0TGlnaHRQcm9iZUlycmFkaWFuY2UoIGxpZ2h0UHJvYmUsIGdlb21ldHJ5Tm9ybWFsICk7XG4gICAgICAjZW5kaWZcbiAgICAjZWxzZVxuICAgICAgaXJyYWRpYW5jZSArPSBnZXRMaWdodFByb2JlSXJyYWRpYW5jZSggbGlnaHRQcm9iZSwgZ2VvbWV0cnkubm9ybWFsICk7XG4gICAgI2VuZGlmXG5cbiAgICAjaWYgKCBOVU1fSEVNSV9MSUdIVFMgPiAwIClcblxuICAgICAgI3ByYWdtYSB1bnJvbGxfbG9vcF9zdGFydFxuICAgICAgZm9yICggaW50IGkgPSAwOyBpIDwgTlVNX0hFTUlfTElHSFRTOyBpICsrICkge1xuXG4gICAgICAgIC8vIENPTVBBVDogcHJlLXIxNTYgdXNlcyBhIHN0cnVjdCBHZW9tZXRyaWNDb250ZXh0XG4gICAgICAgICNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPj0gMTU3XG4gICAgICAgICAgaXJyYWRpYW5jZSArPSBnZXRIZW1pc3BoZXJlTGlnaHRJcnJhZGlhbmNlKCBoZW1pc3BoZXJlTGlnaHRzWyBpIF0sIGdlb21ldHJ5Tm9ybWFsICk7XG4gICAgICAgICNlbHNlXG4gICAgICAgICAgaXJyYWRpYW5jZSArPSBnZXRIZW1pc3BoZXJlTGlnaHRJcnJhZGlhbmNlKCBoZW1pc3BoZXJlTGlnaHRzWyBpIF0sIGdlb21ldHJ5Lm5vcm1hbCApO1xuICAgICAgICAjZW5kaWZcblxuICAgICAgfVxuICAgICAgI3ByYWdtYSB1bnJvbGxfbG9vcF9lbmRcblxuICAgICNlbmRpZlxuXG4gICNlbmRpZlxuXG4gIC8vICNpZiBkZWZpbmVkKCBSRV9JbmRpcmVjdFNwZWN1bGFyIClcblxuICAvLyAgIHZlYzMgcmFkaWFuY2UgPSB2ZWMzKCAwLjAgKTtcbiAgLy8gICB2ZWMzIGNsZWFyY29hdFJhZGlhbmNlID0gdmVjMyggMC4wICk7XG5cbiAgLy8gI2VuZGlmXG5cbiAgI2luY2x1ZGUgPGxpZ2h0c19mcmFnbWVudF9tYXBzPlxuICAjaW5jbHVkZSA8bGlnaHRzX2ZyYWdtZW50X2VuZD5cblxuICAvLyBtb2R1bGF0aW9uXG4gICNpbmNsdWRlIDxhb21hcF9mcmFnbWVudD5cblxuICB2ZWMzIGNvbCA9IHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKyByZWZsZWN0ZWRMaWdodC5pbmRpcmVjdERpZmZ1c2U7XG5cbiAgI2lmZGVmIERFQlVHX0xJVFNIQURFUkFURVxuICAgIGdsX0ZyYWdDb2xvciA9IHZlYzQoIGNvbCwgZGlmZnVzZUNvbG9yLmEgKTtcbiAgICBwb3N0Q29ycmVjdGlvbigpO1xuICAgIHJldHVybjtcbiAgI2VuZGlmXG5cbiAgLy8gLS0gTVRvb246IHJpbSBsaWdodGluZyAoTVRvb246IHNvZnQtbGlrZSBib3JkZXIvYmx1ciArIG9wdGlvbmFsIGRpciByaW0pIC0tXG4gIHZlYzMgdmlld0RpciA9IG5vcm1hbGl6ZSggdlZpZXdQb3NpdGlvbiApO1xuXG4gICNpZm5kZWYgUEhZU0lDQUxMWV9DT1JSRUNUX0xJR0hUU1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdFNwZWN1bGFyIC89IFBJO1xuICAjZW5kaWZcbiAgdmVjMyByaW1NaXggPSBtaXgoIHZlYzMoIDEuMCApLCByZWZsZWN0ZWRMaWdodC5kaXJlY3RTcGVjdWxhciwgcmltTGlnaHRpbmdNaXhGYWN0b3IgKTtcblxuICAvLyBDbGFzc2ljIHBhcmFtZXRyaWMgRnJlc25lbCBiYXNlIChNVG9vbikgKyBOUFIgcmltIGJvcmRlci9ibHVyIC8gZGlyIC8gbWFpblN0cmVuZ3RoIC8gc2hhZG93TWFza1xuICBmbG9hdCBudiA9IHNhdHVyYXRlKCAxLjAgLSBkb3QoIHZpZXdEaXIsIG5vcm1hbCApICsgcGFyYW1ldHJpY1JpbUxpZnRGYWN0b3IgKTtcbiAgZmxvYXQgcmltUG93ZXIgPSAoIHJpbUZyZXNuZWxQb3dlciA+IDAuMDAxIClcbiAgICA/IHJpbUZyZXNuZWxQb3dlclxuICAgIDogcGFyYW1ldHJpY1JpbUZyZXNuZWxQb3dlckZhY3RvcjtcbiAgZmxvYXQgcmltRnJlc25lbCA9IHBvdyggbnYsIG1heCggMC4wMDEsIHJpbVBvd2VyICkgKTtcbiAgZmxvYXQgcmltVG9vbiA9IHJpbUZyZXNuZWw7XG4gIGlmICggcmltQm9yZGVyID4gMC4wMDEgKSB7XG4gICAgZmxvYXQgckJsdXIgPSBtYXgoIDAuMDAxLCByaW1CbHVyICk7XG4gICAgZmxvYXQgcmltQk1pbiA9IGNsYW1wKCByaW1Cb3JkZXIgLSAwLjUgKiByQmx1ciwgMC4wLCAxLjAgKTtcbiAgICBmbG9hdCByaW1CTWF4ID0gY2xhbXAoIHJpbUJvcmRlciArIDAuNSAqIHJCbHVyLCAwLjAsIDEuMCApO1xuICAgIHJpbVRvb24gPSBsaW5lYXJzdGVwKCByaW1CTWluLCByaW1CTWF4LCByaW1GcmVzbmVsICk7XG4gIH1cbiAgLy8gRGlyZWN0aW9uYWwgcmltIFx1MjI0OCBsaWw6IGJpYXMgd2l0aCBoYWxmLUxhbWJlcnQgZnJvbSBsaWdodCBlbmVyZ3kgcHJveHlcbiAgZmxvYXQgcmltTG4gPSBzYXR1cmF0ZSggbGVuZ3RoKCByZWZsZWN0ZWRMaWdodC5kaXJlY3RTcGVjdWxhciApICk7XG4gIGZsb2F0IHJpbURpciA9IG1peCggMS4wLCByaW1MbiwgY2xhbXAoIHJpbURpclN0cmVuZ3RoLCAwLjAsIDEuMCApICk7XG4gIC8vIE9wcG9zaXRlLXNpZGUgLyBpbmRpcmVjdCByaW0gKE5QUiBSaW1JbmRpcikgXHUyMDE0IHVzZXMgaW52ZXJzZSBsaWdodCBlbmVyZ3kgcHJveHlcbiAgZmxvYXQgcmltSW5kaXIgPSByaW1Ub29uICogc2F0dXJhdGUoIDEuMCAtIHJpbUxuICkgKiBjbGFtcCggcmltSW5kaXJTdHJlbmd0aCwgMC4wLCAxLjAgKTtcbiAgLy8gQXBwcm94aW1hdGUgc2hhZG93bWl4IGZyb20gZGlmZnVzZSBlbmVyZ3kgdnMgbGl0IChtdXRlIHJpbSBpbiBkZWVwIHNoYWRlKVxuICBmbG9hdCBzaGFkZU1peCA9IHNhdHVyYXRlKCBsZW5ndGgoIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKSAvIG1heCggbGVuZ3RoKCByZWZsZWN0ZWRMaWdodC5kaXJlY3RTcGVjdWxhciApICogMC4zMTgzICsgMWUtMywgMWUtMyApICk7XG4gIGZsb2F0IHJpbVNoYWRvdyA9IG1peCggMS4wLCBzaGFkZU1peCwgY2xhbXAoIHJpbVNoYWRvd01hc2ssIDAuMCwgMS4wICkgKTtcbiAgdmVjMyByaW1Db2xvciA9IG1peCggcGFyYW1ldHJpY1JpbUNvbG9yRmFjdG9yLCBwYXJhbWV0cmljUmltQ29sb3JGYWN0b3IgKiBkaWZmdXNlQ29sb3IucmdiLCBjbGFtcCggcmltTWFpblN0cmVuZ3RoLCAwLjAsIDEuMCApICk7XG4gIHZlYzMgcmltID0gcmltQ29sb3IgKiAoIHJpbVRvb24gKiByaW1EaXIgKyByaW1JbmRpciApICogcmltU2hhZG93O1xuICByaW0gKj0gcmltQm9vc3Q7XG5cbiAgI2lmZGVmIFVTRV9NQVRDQVBURVhUVVJFXG4gICAge1xuICAgICAgdmVjMyB4ID0gbm9ybWFsaXplKCB2ZWMzKCB2aWV3RGlyLnosIDAuMCwgLXZpZXdEaXIueCApICk7XG4gICAgICB2ZWMzIHkgPSBjcm9zcyggdmlld0RpciwgeCApOyAvLyBndWFyYW50ZWVkIHRvIGJlIG5vcm1hbGl6ZWRcbiAgICAgIHZlYzIgc3BoZXJlVXYgPSAwLjUgKyAwLjUgKiB2ZWMyKCBkb3QoIHgsIG5vcm1hbCApLCAtZG90KCB5LCBub3JtYWwgKSApO1xuICAgICAgc3BoZXJlVXYgPSAoIG1hdGNhcFRleHR1cmVVdlRyYW5zZm9ybSAqIHZlYzMoIHNwaGVyZVV2LCAxICkgKS54eTtcbiAgICAgIHZlYzMgbWF0Y2FwID0gdGV4dHVyZTJEKCBtYXRjYXBUZXh0dXJlLCBzcGhlcmVVdiApLnJnYjtcbiAgICAgIHJpbSArPSBtYXRjYXBGYWN0b3IgKiBtYXRjYXA7XG4gICAgICAvLyBDaGVhcCAybmQgTWF0Q2FwIChzaW5nbGUtdGV4KS4gSGlnaC1mcmVxIHJlc2FtcGxlICsgY29udHJhc3QgY2F1c2VkIHNraW4gXCJyaXBwbGUgdGV4dHVyZVwiXG4gICAgICAvLyBvbiBjdXJ2ZWQgbWlkdG9uZXMgXHUyMDE0IGtlZXAgb25seSBsb3ctZnJlcXVlbmN5IGx1bWEgc2hlZW4uXG4gICAgICBpZiAoIG1hdGNhcDJuZFN0cmVuZ3RoID4gMC4wMDAxICkge1xuICAgICAgICBmbG9hdCBtY1NjYWxlID0gbWF4KCAwLjUsIG1hdGNhcDJuZFNjYWxlICk7XG4gICAgICAgIHZlYzIgc3BoZXJlVXYyID0gMC41ICsgMC41ICogdmVjMiggLWRvdCggeCwgbm9ybWFsICksIC1kb3QoIHksIG5vcm1hbCApICogMC44MiArIDAuMDQgKTtcbiAgICAgICAgc3BoZXJlVXYyID0gKCBzcGhlcmVVdjIgLSAwLjUgKSAqIG1jU2NhbGUgKyAwLjU7XG4gICAgICAgIHNwaGVyZVV2MiA9ICggbWF0Y2FwVGV4dHVyZVV2VHJhbnNmb3JtICogdmVjMyggc3BoZXJlVXYyLCAxICkgKS54eTtcbiAgICAgICAgLy8gQmlhcyB0b3dhcmQgY29hcnNlciBtaXAgdG8ga2lsbCBmaW5lIG1hdGNhcCBncmFpbiAvIG1vaXJcdTAwRTkgb24gc2tpblxuICAgICAgICB2ZWMzIG1hdGNhcDIgPSB0ZXh0dXJlMkQoIG1hdGNhcFRleHR1cmUsIHNwaGVyZVV2MiwgMi4wICkucmdiO1xuICAgICAgICBmbG9hdCBtY0x1bWEgPSBkb3QoIG1hdGNhcDIsIHZlYzMoIDAuMjk5LCAwLjU4NywgMC4xMTQgKSApO1xuICAgICAgICBtYXRjYXAyID0gdmVjMyggbWNMdW1hICk7IC8vIGx1bWEtb25seSBsb2JlIFx1MjAxNCBubyBkb3VibGUtcHJpbnQgY2hyb21hIHRleHR1cmVcbiAgICAgICAgZmxvYXQgbWNDb250cmFzdCA9IGNsYW1wKCBtYXRjYXAybmRDb250cmFzdCwgMC41LCAxLjI1ICk7XG4gICAgICAgIG1hdGNhcDIgPSBjbGFtcCggKCBtYXRjYXAyIC0gMC41ICkgKiBtY0NvbnRyYXN0ICsgMC41LCAwLjAsIDEuMCApO1xuICAgICAgICByaW0gKz0gbWF0Y2FwRmFjdG9yICogbWF0Y2FwMiAqIG1hdGNhcDJuZFN0cmVuZ3RoO1xuICAgICAgfVxuICAgIH1cbiAgI2VuZGlmXG5cbiAgI2lmZGVmIFVTRV9SSU1NVUxUSVBMWVRFWFRVUkVcbiAgICB2ZWMyIHJpbU11bHRpcGx5VGV4dHVyZVV2ID0gKCByaW1NdWx0aXBseVRleHR1cmVVdlRyYW5zZm9ybSAqIHZlYzMoIHV2LCAxICkgKS54eTtcbiAgICByaW0gKj0gdGV4dHVyZTJEKCByaW1NdWx0aXBseVRleHR1cmUsIHJpbU11bHRpcGx5VGV4dHVyZVV2ICkucmdiO1xuICAjZW5kaWZcblxuICBjb2wgKz0gcmltTWl4ICogcmltO1xuXG4gIC8vIC0tIE1Ub29uOiBFbWlzc2lvbiAoKyBzb2Z0LWlzaCBib29zdCkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgY29sICs9IHRvdGFsRW1pc3NpdmVSYWRpYW5jZSAqICggMS4wICsgbWF4KCAwLjAsIGVtaXNzaW9uQm9vc3QgKSApO1xuXG4gIC8vIERpc3RhbmNlIGZhZGUvbGlmdCBhcHByb3ggKG5vIE5QUiBEaXN0YW5jZUZhZGUgdGV4KTogc29mdCBuZWFyLWNhbWVyYSBsaWZ0XG4gIGlmICggZGlzdGFuY2VGYWRlID4gMC4wMDAxICkge1xuICAgIGZsb2F0IGRpc3QgPSBsZW5ndGgoIHZWaWV3UG9zaXRpb24gKTtcbiAgICBmbG9hdCBmYWRlID0gc21vb3Roc3RlcCggMC4zNSwgMi44LCBkaXN0ICk7XG4gICAgLy8gTmVhcjogc2xpZ2h0IGJyaWdodG5lc3M7IEZhcjogZ2VudGxlIG11dGUgXHUyMDE0IHJlYWRhYmxlIHdpdGhvdXQgYXV0aG9yZWQgZmFkZSBtYXBzXG4gICAgY29sICo9IG1peCggMS4wICsgMC4wNiAqIGRpc3RhbmNlRmFkZSwgMS4wIC0gMC4wOCAqIGRpc3RhbmNlRmFkZSwgZmFkZSApO1xuICB9XG5cbiAgLy8gI2luY2x1ZGUgPGVudm1hcF9mcmFnbWVudD5cblxuICAvLyAtLSBBbG1vc3QgZG9uZSEgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgI2lmIGRlZmluZWQoIE9VVExJTkUgKVxuICAgIC8vIG91dGxpbmVNaXg6IDAgPSBzdG9jayBvdXRsaW5lTGlnaHRpbmdNaXhGYWN0b3I7IDEgPSBwcmVmZXIgbGl0IGFsYmVkbyBibGVlZFxuICAgIGZsb2F0IG91dGxpbmVNaXggPSBtaXgoIG91dGxpbmVMaWdodGluZ01peEZhY3RvciwgY2xhbXAoIG91dGxpbmVMaWdodGluZ01peEZhY3RvciArIDAuMTUsIDAuMCwgMS4wICksIGNsYW1wKCBvdXRsaW5lTWl4LCAwLjAsIDEuMCApICk7XG4gICAgY29sID0gb3V0bGluZUNvbG9yRmFjdG9yLnJnYiAqIG1peCggdmVjMyggMS4wICksIGNvbCwgb3V0bGluZU1peCApO1xuICAjZW5kaWZcblxuICAjaWZkZWYgT1BBUVVFXG4gICAgZGlmZnVzZUNvbG9yLmEgPSAxLjA7XG4gICNlbmRpZlxuXG4gIGdsX0ZyYWdDb2xvciA9IHZlYzQoIGNvbCwgZGlmZnVzZUNvbG9yLmEgKTtcbiAgcG9zdENvcnJlY3Rpb24oKTtcbn1cbiIsICIvKiBlc2xpbnQtZGlzYWJsZSBAdHlwZXNjcmlwdC1lc2xpbnQvbmFtaW5nLWNvbnZlbnRpb24gKi9cblxuLyoqXG4gKiBTcGVjaWZpZXJzIG9mIGRlYnVnIG1vZGUgb2Yge0BsaW5rIE1Ub29uTWF0ZXJpYWx9LlxuICpcbiAqIFNlZToge0BsaW5rIE1Ub29uTWF0ZXJpYWwuZGVidWdNb2RlfVxuICovXG5leHBvcnQgY29uc3QgTVRvb25NYXRlcmlhbERlYnVnTW9kZSA9IHtcbiAgLyoqXG4gICAqIFJlbmRlciBub3JtYWxseS5cbiAgICovXG4gIE5vbmU6ICdub25lJyxcblxuICAvKipcbiAgICogVmlzdWFsaXplIG5vcm1hbHMgb2YgdGhlIHN1cmZhY2UuXG4gICAqL1xuICBOb3JtYWw6ICdub3JtYWwnLFxuXG4gIC8qKlxuICAgKiBWaXN1YWxpemUgbGl0L3NoYWRlIG9mIHRoZSBzdXJmYWNlLlxuICAgKi9cbiAgTGl0U2hhZGVSYXRlOiAnbGl0U2hhZGVSYXRlJyxcblxuICAvKipcbiAgICogVmlzdWFsaXplIFVWIG9mIHRoZSBzdXJmYWNlLlxuICAgKi9cbiAgVVY6ICd1dicsXG59IGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBNVG9vbk1hdGVyaWFsRGVidWdNb2RlID0gKHR5cGVvZiBNVG9vbk1hdGVyaWFsRGVidWdNb2RlKVtrZXlvZiB0eXBlb2YgTVRvb25NYXRlcmlhbERlYnVnTW9kZV07XG4iLCAiLyogZXNsaW50LWRpc2FibGUgQHR5cGVzY3JpcHQtZXNsaW50L25hbWluZy1jb252ZW50aW9uICovXG5cbmV4cG9ydCBjb25zdCBNVG9vbk1hdGVyaWFsT3V0bGluZVdpZHRoTW9kZSA9IHtcbiAgTm9uZTogJ25vbmUnLFxuICBXb3JsZENvb3JkaW5hdGVzOiAnd29ybGRDb29yZGluYXRlcycsXG4gIFNjcmVlbkNvb3JkaW5hdGVzOiAnc2NyZWVuQ29vcmRpbmF0ZXMnLFxufSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgTVRvb25NYXRlcmlhbE91dGxpbmVXaWR0aE1vZGUgPVxuICAodHlwZW9mIE1Ub29uTWF0ZXJpYWxPdXRsaW5lV2lkdGhNb2RlKVtrZXlvZiB0eXBlb2YgTVRvb25NYXRlcmlhbE91dGxpbmVXaWR0aE1vZGVdO1xuIiwgImltcG9ydCAqIGFzIFRIUkVFIGZyb20gJ3RocmVlJztcblxuY29uc3QgZW5jb2RpbmdDb2xvclNwYWNlTWFwOiBSZWNvcmQ8YW55LCAnJyB8ICdzcmdiJz4gPSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbmFtaW5nLWNvbnZlbnRpb25cbiAgMzAwMDogJycsXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbmFtaW5nLWNvbnZlbnRpb25cbiAgMzAwMTogJ3NyZ2InLFxufTtcblxuLyoqXG4gKiBBIGNvbXBhdCBmdW5jdGlvbiB0byBnZXQgdGV4dHVyZSBjb2xvciBzcGFjZS5cbiAqXG4gKiBDT01QQVQ6IHByZS1yMTUyXG4gKiBTdGFydGluZyBmcm9tIFRocmVlLmpzIHIxNTIsIGB0ZXh0dXJlLmVuY29kaW5nYCBpcyByZW5hbWVkIHRvIGB0ZXh0dXJlLmNvbG9yU3BhY2VgLlxuICogVGhpcyBmdW5jdGlvbiB3aWxsIGhhbmRsZSB0aGUgY29tYXB0LlxuICpcbiAqIEBwYXJhbSB0ZXh0dXJlIFRoZSB0ZXh0dXJlIHlvdSB3YW50IHRvIGdldCB0aGUgY29sb3Igc3BhY2UgZnJvbVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0VGV4dHVyZUNvbG9yU3BhY2UodGV4dHVyZTogVEhSRUUuVGV4dHVyZSk6ICcnIHwgJ3NyZ2InIHtcbiAgaWYgKHBhcnNlSW50KFRIUkVFLlJFVklTSU9OLCAxMCkgPj0gMTUyKSB7XG4gICAgcmV0dXJuIHRleHR1cmUuY29sb3JTcGFjZSBhcyAnJyB8ICdzcmdiJztcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gZW5jb2RpbmdDb2xvclNwYWNlTWFwWyh0ZXh0dXJlIGFzIGFueSkuZW5jb2RpbmddO1xuICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsWUFBWUEsWUFBVzs7O0FDQXZCLFlBQVlDLFlBQVc7OztBQ0F2QixZQUFZLFdBQVc7QUFFdkIsSUFBTSx3QkFBa0Q7QUFBQTtBQUFBLEVBRXRELElBQUk7QUFBQSxFQUNKLE1BQU07QUFDUjtBQVlPLFNBQVMscUJBQXFCLFNBQXdCLFlBQStCO0FBQzFGLE1BQUksU0FBZSxnQkFBVSxFQUFFLEtBQUssS0FBSztBQUN2QyxZQUFRLGFBQWE7QUFBQSxFQUN2QixPQUFPO0FBQ0wsSUFBQyxRQUFnQixXQUFXLHNCQUFzQixVQUFVO0FBQUEsRUFDOUQ7QUFDRjs7O0FEZE8sSUFBTSxzQ0FBTixNQUEwQztBQUFBLEVBSy9DLElBQVcsVUFBNEI7QUFDckMsV0FBTyxRQUFRLElBQUksS0FBSyxTQUFTO0FBQUEsRUFDbkM7QUFBQSxFQUVPLFlBQVksUUFBb0IsZ0JBQXlDO0FBQzlFLFNBQUssVUFBVTtBQUNmLFNBQUssa0JBQWtCO0FBQ3ZCLFNBQUssWUFBWSxDQUFDO0FBQUEsRUFDcEI7QUFBQSxFQUVPLGdCQUF5RCxLQUFRLE9BQXlDO0FBQy9HLFFBQUksU0FBUyxNQUFNO0FBQ2pCLFdBQUssZ0JBQWdCLEdBQUcsSUFBSTtBQUFBLElBQzlCO0FBQUEsRUFDRjtBQUFBLEVBRU8sWUFDTCxLQUNBLE9BQ0EscUJBQ007QUFDTixRQUFJLFNBQVMsTUFBTTtBQUNqQixZQUFNLFFBQVEsSUFBVSxhQUFNLEVBQUUsVUFBVSxLQUFLO0FBRS9DLFVBQUkscUJBQXFCO0FBQ3ZCLGNBQU0sb0JBQW9CO0FBQUEsTUFDNUI7QUFDQSxNQUFDLEtBQUssZ0JBQXdCLEdBQUcsSUFBSTtBQUFBLElBQ3ZDO0FBQUEsRUFDRjtBQUFBLEVBRWEsY0FDWCxLQUNBLGVBQ0EsZ0JBQ2U7QUFBQTtBQUNmLFlBQU0sV0FBVyxNQUFZO0FBQzNCLFlBQUksaUJBQWlCLE1BQU07QUFDekIsZ0JBQU0sVUFBVSxNQUFNLEtBQUssUUFBUSxjQUFjLEtBQUssaUJBQWlCLEtBQUssYUFBYTtBQUd6RixjQUFJLFdBQVcsTUFBTTtBQUNuQixvQkFBUTtBQUFBLGNBQ047QUFBQSxZQUNGO0FBQ0E7QUFBQSxVQUNGO0FBRUEsY0FBSSxnQkFBZ0I7QUFDbEIsaUNBQXFCLFNBQVMsTUFBTTtBQUFBLFVBQ3RDO0FBQUEsUUFDRjtBQUFBLE1BQ0YsSUFBRztBQUVILFdBQUssVUFBVSxLQUFLLE9BQU87QUFFM0IsYUFBTztBQUFBLElBQ1Q7QUFBQTtBQUFBLEVBRWEscUJBQ1gsS0FDQSxjQUNBLGdCQUNlO0FBQUE7QUFDZixhQUFPLEtBQUssY0FBYyxLQUFLLGdCQUFnQixPQUFPLEVBQUUsT0FBTyxhQUFhLElBQUksUUFBVyxjQUFjO0FBQUEsSUFDM0c7QUFBQTtBQUNGOzs7QUUvRUEsWUFBWUMsWUFBVzs7O0FDRnZCOzs7QUNBQSxJQUFBQyxpQkFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTs7O0FDT08sSUFBTSx5QkFBeUI7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUlwQyxNQUFNO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFLTixRQUFRO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFLUixjQUFjO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFLZCxJQUFJ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QUssY0FBYyxjQUFjLEtBQUs7QUFFdEMsV0FBSyxpQkFBaUIsSUFBSTtBQUUxQixXQUFLLGtCQUFrQixJQUFJO0FBRTNCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFPUSx1QkFBdUIsaUJBQTBDO0FBR3ZFLFdBQ0UsT0FBUSxnQkFBd0IscUJBQXFCLFlBQ3BELGdCQUF3QixxQkFBcUIsVUFDOUMsT0FBUSxnQkFBd0IsdUJBQXVCLFlBQ3RELGdCQUF3QixxQkFBcUI7QUFBQSxFQUVsRDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU9RLGlCQUFpQixNQUF3QjtBQU8vQyxVQUFNLGtCQUFrQixLQUFLO0FBQzdCLFFBQUksRUFBRSwyQkFBaUMsa0JBQVc7QUFDaEQ7QUFBQSxJQUNGO0FBRUEsUUFBSSxDQUFDLEtBQUssdUJBQXVCLGVBQWUsR0FBRztBQUNqRDtBQUFBLElBQ0Y7QUFHQSxTQUFLLFdBQVcsQ0FBQyxlQUFlO0FBR2hDLFVBQU0sa0JBQWtCLGdCQUFnQixNQUFNO0FBQzlDLG9CQUFnQixRQUFRO0FBQ3hCLElBQUMsZ0JBQXdCLFlBQVk7QUFDckMsb0JBQWdCLE9BQWE7QUFDN0IsU0FBSyxTQUFTLEtBQUssZUFBZTtBQUdsQyxVQUFNLFdBQVcsS0FBSztBQUN0QixVQUFNLG9CQUFvQixTQUFTLFFBQVEsU0FBUyxNQUFNLFFBQVEsU0FBUyxXQUFXLFNBQVMsUUFBUTtBQUN2RyxhQUFTLFNBQVMsR0FBRyxtQkFBbUIsQ0FBQztBQUN6QyxhQUFTLFNBQVMsR0FBRyxtQkFBbUIsQ0FBQztBQUFBLEVBQzNDO0FBQUEsRUFFUSxrQkFBa0IsTUFBd0I7QUFDaEQsVUFBTSxzQkFBc0IsS0FBSztBQUNqQyxVQUFNLGNBQWMsb0JBQUksSUFBb0I7QUFFNUMsUUFBSSxNQUFNLFFBQVEsbUJBQW1CLEdBQUc7QUFDdEMsMEJBQW9CLFFBQVEsQ0FBQyxhQUFhLFlBQVksSUFBSSxRQUFRLENBQUM7QUFBQSxJQUNyRSxPQUFPO0FBQ0wsa0JBQVksSUFBSSxtQkFBbUI7QUFBQSxJQUNyQztBQUVBLGVBQVcsWUFBWSxhQUFhO0FBQ2xDLFdBQUssa0JBQWtCLElBQUksUUFBUTtBQUFBLElBQ3JDO0FBQUEsRUFDRjtBQUFBLEVBRVEsa0JBQWtCLFdBQXFEO0FBMVlqRjtBQTZZSSxVQUFNLGdCQUFnQixVQUFVO0FBQ2hDLFlBQVEsZ0JBQWdCLElBQUksUUFBTyxlQUFVLDRCQUFWLFlBQXFDO0FBQUEsRUFDMUU7QUFDRjtBQXBXYSwyQkFDRyxpQkFBaUI7QUFEMUIsSUFBTSw0QkFBTjsiLAogICJuYW1lcyI6IFsiVEhSRUUiLCAiVEhSRUUiLCAiVEhSRUUiLCAibXRvb25fZGVmYXVsdCIsICJUSFJFRSIsICJtdG9vbl9kZWZhdWx0Il0KfQo=
