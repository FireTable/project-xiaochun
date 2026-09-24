/*!
 * @firetable/three-vrm-materials-mtoon v3.5.5
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
    });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL01Ub29uTWF0ZXJpYWxMb2FkZXJQbHVnaW4udHMiLCAiLi4vc3JjL0dMVEZNVG9vbk1hdGVyaWFsUGFyYW1zQXNzaWduSGVscGVyLnRzIiwgIi4uL3NyYy91dGlscy9zZXRUZXh0dXJlQ29sb3JTcGFjZS50cyIsICIuLi9zcmMvTVRvb25NYXRlcmlhbC50cyIsICIuLi9zcmMvc2hhZGVycy9tdG9vbi52ZXJ0IiwgIi4uL3NyYy9zaGFkZXJzL210b29uLmZyYWciLCAiLi4vc3JjL01Ub29uTWF0ZXJpYWxEZWJ1Z01vZGUudHMiLCAiLi4vc3JjL01Ub29uTWF0ZXJpYWxPdXRsaW5lV2lkdGhNb2RlLnRzIiwgIi4uL3NyYy91dGlscy9nZXRUZXh0dXJlQ29sb3JTcGFjZS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0ICogYXMgVEhSRUUgZnJvbSAndGhyZWUnO1xuaW1wb3J0ICogYXMgVjFNVG9vblNjaGVtYSBmcm9tICdAcGl4aXYvdHlwZXMtdnJtYy1tYXRlcmlhbHMtbXRvb24tMS4wJztcbmltcG9ydCB0eXBlIHsgR0xURiwgR0xURkxvYWRlciwgR0xURkxvYWRlclBsdWdpbiwgR0xURlBhcnNlciB9IGZyb20gJ3RocmVlL2V4YW1wbGVzL2pzbS9sb2FkZXJzL0dMVEZMb2FkZXIuanMnO1xuaW1wb3J0IHR5cGUgeyBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycyB9IGZyb20gJy4vTVRvb25NYXRlcmlhbFBhcmFtZXRlcnMnO1xuaW1wb3J0IHR5cGUgeyBNVG9vbk1hdGVyaWFsT3V0bGluZVdpZHRoTW9kZSB9IGZyb20gJy4vTVRvb25NYXRlcmlhbE91dGxpbmVXaWR0aE1vZGUnO1xuaW1wb3J0IHsgR0xURk1Ub29uTWF0ZXJpYWxQYXJhbXNBc3NpZ25IZWxwZXIgfSBmcm9tICcuL0dMVEZNVG9vbk1hdGVyaWFsUGFyYW1zQXNzaWduSGVscGVyJztcbmltcG9ydCB0eXBlIHsgTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbk9wdGlvbnMgfSBmcm9tICcuL01Ub29uTWF0ZXJpYWxMb2FkZXJQbHVnaW5PcHRpb25zJztcbmltcG9ydCB0eXBlIHsgTVRvb25NYXRlcmlhbERlYnVnTW9kZSB9IGZyb20gJy4vTVRvb25NYXRlcmlhbERlYnVnTW9kZSc7XG5pbXBvcnQgeyBHTFRGIGFzIEdMVEZTY2hlbWEgfSBmcm9tICdAZ2x0Zi10cmFuc2Zvcm0vY29yZSc7XG5pbXBvcnQgeyBNVG9vbk1hdGVyaWFsIH0gZnJvbSAnLi9NVG9vbk1hdGVyaWFsJztcbmltcG9ydCB0eXBlIHsgTVRvb25Ob2RlTWF0ZXJpYWwgfSBmcm9tICcuL25vZGVzL01Ub29uTm9kZU1hdGVyaWFsJztcblxuLyoqXG4gKiBQb3NzaWJsZSBzcGVjIHZlcnNpb25zIGl0IHJlY29nbml6ZXMuXG4gKi9cbmNvbnN0IFBPU1NJQkxFX1NQRUNfVkVSU0lPTlMgPSBuZXcgU2V0KFsnMS4wJywgJzEuMC1iZXRhJ10pO1xuXG4vKipcbiAqIEEgbG9hZGVyIHBsdWdpbiBvZiB7QGxpbmsgR0xURkxvYWRlcn0gZm9yIHRoZSBleHRlbnNpb24gYFZSTUNfbWF0ZXJpYWxzX210b29uYC5cbiAqXG4gKiBUaGlzIHBsdWdpbiBpcyBmb3IgdXNlcyB3aXRoIFdlYkdMUmVuZGVyZXIgYnkgZGVmYXVsdC5cbiAqIFRvIHVzZSBNVG9vbiBpbiBXZWJHUFVSZW5kZXJlciwgc2V0IHtAbGluayBtYXRlcmlhbFR5cGV9IHRvIHtAbGluayBNVG9vbk5vZGVNYXRlcmlhbH0uXG4gKlxuICogQGV4YW1wbGUgdG8gdXNlIHdpdGggV2ViR1BVUmVuZGVyZXJcbiAqIGBgYGpzXG4gKiBpbXBvcnQgeyBNVG9vbk1hdGVyaWFsTG9hZGVyUGx1Z2luIH0gZnJvbSAnQHBpeGl2L3RocmVlLXZybS1tYXRlcmlhbHMtbXRvb24nO1xuICogaW1wb3J0IHsgTVRvb25Ob2RlTWF0ZXJpYWwgfSBmcm9tICdAcGl4aXYvdGhyZWUtdnJtLW1hdGVyaWFscy1tdG9vbi9ub2Rlcyc7XG4gKlxuICogLy8gLi4uXG4gKlxuICogLy8gUmVnaXN0ZXIgYSBNVG9vbk1hdGVyaWFsTG9hZGVyUGx1Z2luIHdpdGggTVRvb25Ob2RlTWF0ZXJpYWxcbiAqIGxvYWRlci5yZWdpc3RlcigocGFyc2VyKSA9PiB7XG4gKlxuICogICAvLyBjcmVhdGUgYSBXZWJHUFUgY29tcGF0aWJsZSBNVG9vbk1hdGVyaWFsTG9hZGVyUGx1Z2luXG4gKiAgIHJldHVybiBuZXcgTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbihwYXJzZXIsIHtcbiAqXG4gKiAgICAgLy8gc2V0IHRoZSBtYXRlcmlhbCB0eXBlIHRvIE1Ub29uTm9kZU1hdGVyaWFsXG4gKiAgICAgbWF0ZXJpYWxUeXBlOiBNVG9vbk5vZGVNYXRlcmlhbCxcbiAqXG4gKiAgIH0pO1xuICpcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBNVG9vbk1hdGVyaWFsTG9hZGVyUGx1Z2luIGltcGxlbWVudHMgR0xURkxvYWRlclBsdWdpbiB7XG4gIHB1YmxpYyBzdGF0aWMgRVhURU5TSU9OX05BTUUgPSAnVlJNQ19tYXRlcmlhbHNfbXRvb24nO1xuXG4gIC8qKlxuICAgKiBUaGUgdHlwZSBvZiB0aGUgbWF0ZXJpYWwgdGhhdCB0aGlzIHBsdWdpbiB3aWxsIGdlbmVyYXRlLlxuICAgKlxuICAgKiBJZiB5b3UgYXJlIHVzaW5nIHRoaXMgcGx1Z2luIHdpdGggV2ViR1BVLCBzZXQgdGhpcyB0byB7QGxpbmsgTVRvb25Ob2RlTWF0ZXJpYWx9LlxuICAgKlxuICAgKiBAZGVmYXVsdCBNVG9vbk1hdGVyaWFsXG4gICAqL1xuICBwdWJsaWMgbWF0ZXJpYWxUeXBlOiB0eXBlb2YgVEhSRUUuTWF0ZXJpYWw7XG5cbiAgLyoqXG4gICAqIFRoaXMgdmFsdWUgd2lsbCBiZSBhZGRlZCB0byBgcmVuZGVyT3JkZXJgIG9mIGV2ZXJ5IG1lc2hlcyB3aG8gaGF2ZSBNYXRlcmlhbHNNVG9vbi5cbiAgICogVGhlIGZpbmFsIHJlbmRlck9yZGVyIHdpbGwgYmUgc3VtIG9mIHRoaXMgYHJlbmRlck9yZGVyT2Zmc2V0YCBhbmQgYHJlbmRlclF1ZXVlT2Zmc2V0TnVtYmVyYCBmb3IgZWFjaCBtYXRlcmlhbHMuXG4gICAqXG4gICAqIEBkZWZhdWx0IDBcbiAgICovXG4gIHB1YmxpYyByZW5kZXJPcmRlck9mZnNldDogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGVyZSBpcyBhIGxpbmUgb2YgdGhlIHNoYWRlciBjYWxsZWQgXCJjb21tZW50IG91dCBpZiB5b3Ugd2FudCB0byBQQlIgYWJzb2x1dGVseVwiIGluIFZSTTAuMCBNVG9vbi5cbiAgICogV2hlbiB0aGlzIGlzIHRydWUsIHRoZSBtYXRlcmlhbCBlbmFibGVzIHRoZSBsaW5lIHRvIG1ha2UgaXQgY29tcGF0aWJsZSB3aXRoIHRoZSBsZWdhY3kgcmVuZGVyaW5nIG9mIFZSTS5cbiAgICogVXN1YWxseSBub3QgcmVjb21tZW5kZWQgdG8gdHVybiB0aGlzIG9uLlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcHVibGljIHYwQ29tcGF0U2hhZGU6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIERlYnVnIG1vZGUgZm9yIHRoZSBtYXRlcmlhbC5cbiAgICogWW91IGNhbiB2aXN1YWxpemUgc2V2ZXJhbCBjb21wb25lbnRzIGZvciBkaWFnbm9zaXMgdXNpbmcgZGVidWcgbW9kZS5cbiAgICpcbiAgICogU2VlOiB7QGxpbmsgTVRvb25NYXRlcmlhbERlYnVnTW9kZX1cbiAgICpcbiAgICogQGRlZmF1bHQgJ25vbmUnXG4gICAqL1xuICBwdWJsaWMgZGVidWdNb2RlOiBNVG9vbk1hdGVyaWFsRGVidWdNb2RlO1xuXG4gIHB1YmxpYyByZWFkb25seSBwYXJzZXI6IEdMVEZQYXJzZXI7XG5cbiAgLyoqXG4gICAqIExvYWRlZCBtYXRlcmlhbHMgd2lsbCBiZSBzdG9yZWQgaW4gdGhpcyBzZXQuXG4gICAqIFdpbGwgYmUgdHJhbnNmZXJyZWQgaW50byBgZ2x0Zi51c2VyRGF0YS52cm1NVG9vbk1hdGVyaWFsc2AgaW4ge0BsaW5rIGFmdGVyUm9vdH0uXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IF9tVG9vbk1hdGVyaWFsU2V0OiBTZXQ8VEhSRUUuTWF0ZXJpYWw+O1xuXG4gIHB1YmxpYyBnZXQgbmFtZSgpOiBzdHJpbmcge1xuICAgIHJldHVybiBNVG9vbk1hdGVyaWFsTG9hZGVyUGx1Z2luLkVYVEVOU0lPTl9OQU1FO1xuICB9XG5cbiAgcHVibGljIGNvbnN0cnVjdG9yKHBhcnNlcjogR0xURlBhcnNlciwgb3B0aW9uczogTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbk9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMucGFyc2VyID0gcGFyc2VyO1xuXG4gICAgdGhpcy5tYXRlcmlhbFR5cGUgPSBvcHRpb25zLm1hdGVyaWFsVHlwZSA/PyBNVG9vbk1hdGVyaWFsO1xuICAgIHRoaXMucmVuZGVyT3JkZXJPZmZzZXQgPSBvcHRpb25zLnJlbmRlck9yZGVyT2Zmc2V0ID8/IDA7XG4gICAgdGhpcy52MENvbXBhdFNoYWRlID0gb3B0aW9ucy52MENvbXBhdFNoYWRlID8/IGZhbHNlO1xuICAgIHRoaXMuZGVidWdNb2RlID0gb3B0aW9ucy5kZWJ1Z01vZGUgPz8gJ25vbmUnO1xuXG4gICAgdGhpcy5fbVRvb25NYXRlcmlhbFNldCA9IG5ldyBTZXQoKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBiZWZvcmVSb290KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuX3JlbW92ZVVubGl0RXh0ZW5zaW9uSWZNVG9vbkV4aXN0cygpO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGFmdGVyUm9vdChnbHRmOiBHTFRGKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgZ2x0Zi51c2VyRGF0YS52cm1NVG9vbk1hdGVyaWFscyA9IEFycmF5LmZyb20odGhpcy5fbVRvb25NYXRlcmlhbFNldCk7XG4gIH1cblxuICBwdWJsaWMgZ2V0TWF0ZXJpYWxUeXBlKG1hdGVyaWFsSW5kZXg6IG51bWJlcik6IHR5cGVvZiBUSFJFRS5NYXRlcmlhbCB8IG51bGwge1xuICAgIGNvbnN0IHYxRXh0ZW5zaW9uID0gdGhpcy5fZ2V0TVRvb25FeHRlbnNpb24obWF0ZXJpYWxJbmRleCk7XG4gICAgaWYgKHYxRXh0ZW5zaW9uKSB7XG4gICAgICByZXR1cm4gdGhpcy5tYXRlcmlhbFR5cGU7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwdWJsaWMgZXh0ZW5kTWF0ZXJpYWxQYXJhbXMobWF0ZXJpYWxJbmRleDogbnVtYmVyLCBtYXRlcmlhbFBhcmFtczogTVRvb25NYXRlcmlhbFBhcmFtZXRlcnMpOiBQcm9taXNlPGFueT4gfCBudWxsIHtcbiAgICBjb25zdCBleHRlbnNpb24gPSB0aGlzLl9nZXRNVG9vbkV4dGVuc2lvbihtYXRlcmlhbEluZGV4KTtcbiAgICBpZiAoZXh0ZW5zaW9uKSB7XG4gICAgICByZXR1cm4gdGhpcy5fZXh0ZW5kTWF0ZXJpYWxQYXJhbXMoZXh0ZW5zaW9uLCBtYXRlcmlhbFBhcmFtcyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgbG9hZE1lc2gobWVzaEluZGV4OiBudW1iZXIpOiBQcm9taXNlPFRIUkVFLkdyb3VwIHwgVEhSRUUuTWVzaCB8IFRIUkVFLlNraW5uZWRNZXNoPiB7XG4gICAgY29uc3QgcGFyc2VyID0gdGhpcy5wYXJzZXI7XG4gICAgY29uc3QganNvbiA9IHBhcnNlci5qc29uIGFzIEdMVEZTY2hlbWEuSUdMVEY7XG5cbiAgICBjb25zdCBtZXNoRGVmID0ganNvbi5tZXNoZXM/LlttZXNoSW5kZXhdO1xuXG4gICAgaWYgKG1lc2hEZWYgPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbjogQXR0ZW1wdCB0byB1c2UgbWVzaGVzWyR7bWVzaEluZGV4fV0gb2YgZ2xURiBidXQgdGhlIG1lc2ggZG9lc24ndCBleGlzdGAsXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IHByaW1pdGl2ZXNEZWYgPSBtZXNoRGVmLnByaW1pdGl2ZXM7XG5cbiAgICBjb25zdCBtZXNoT3JHcm91cCA9IGF3YWl0IHBhcnNlci5sb2FkTWVzaChtZXNoSW5kZXgpO1xuXG4gICAgaWYgKHByaW1pdGl2ZXNEZWYubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBtZXNoID0gbWVzaE9yR3JvdXAgYXMgVEhSRUUuTWVzaDtcbiAgICAgIGNvbnN0IG1hdGVyaWFsSW5kZXggPSBwcmltaXRpdmVzRGVmWzBdLm1hdGVyaWFsO1xuXG4gICAgICBpZiAobWF0ZXJpYWxJbmRleCAhPSBudWxsKSB7XG4gICAgICAgIHRoaXMuX3NldHVwUHJpbWl0aXZlKG1lc2gsIG1hdGVyaWFsSW5kZXgpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBncm91cCA9IG1lc2hPckdyb3VwIGFzIFRIUkVFLkdyb3VwO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwcmltaXRpdmVzRGVmLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IG1lc2ggPSBncm91cC5jaGlsZHJlbltpXSBhcyBUSFJFRS5NZXNoO1xuICAgICAgICBjb25zdCBtYXRlcmlhbEluZGV4ID0gcHJpbWl0aXZlc0RlZltpXS5tYXRlcmlhbDtcblxuICAgICAgICBpZiAobWF0ZXJpYWxJbmRleCAhPSBudWxsKSB7XG4gICAgICAgICAgdGhpcy5fc2V0dXBQcmltaXRpdmUobWVzaCwgbWF0ZXJpYWxJbmRleCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbWVzaE9yR3JvdXA7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlIHVzZSBvZiBgS0hSX21hdGVyaWFsc191bmxpdGAgZnJvbSBpdHMgYG1hdGVyaWFsc2AgaWYgdGhlIG1hdGVyaWFsIGlzIHVzaW5nIE1Ub29uLlxuICAgKlxuICAgKiBTaW5jZSBHTFRGTG9hZGVyIGhhdmUgc28gbWFueSBoYXJkY29kZWQgcHJvY2VkdXJlIHJlbGF0ZWQgdG8gYEtIUl9tYXRlcmlhbHNfdW5saXRgXG4gICAqIHdlIGhhdmUgdG8gZGVsZXRlIHRoZSBleHRlbnNpb24gYmVmb3JlIHdlIHN0YXJ0IHRvIHBhcnNlIHRoZSBnbFRGLlxuICAgKi9cbiAgcHJpdmF0ZSBfcmVtb3ZlVW5saXRFeHRlbnNpb25JZk1Ub29uRXhpc3RzKCk6IHZvaWQge1xuICAgIGNvbnN0IHBhcnNlciA9IHRoaXMucGFyc2VyO1xuICAgIGNvbnN0IGpzb24gPSBwYXJzZXIuanNvbiBhcyBHTFRGU2NoZW1hLklHTFRGO1xuXG4gICAgY29uc3QgbWF0ZXJpYWxEZWZzID0ganNvbi5tYXRlcmlhbHM7XG4gICAgbWF0ZXJpYWxEZWZzPy5tYXAoKG1hdGVyaWFsRGVmLCBpTWF0ZXJpYWwpID0+IHtcbiAgICAgIGNvbnN0IGV4dGVuc2lvbiA9IHRoaXMuX2dldE1Ub29uRXh0ZW5zaW9uKGlNYXRlcmlhbCk7XG5cbiAgICAgIGlmIChleHRlbnNpb24gJiYgbWF0ZXJpYWxEZWYuZXh0ZW5zaW9ucz8uWydLSFJfbWF0ZXJpYWxzX3VubGl0J10pIHtcbiAgICAgICAgZGVsZXRlIG1hdGVyaWFsRGVmLmV4dGVuc2lvbnNbJ0tIUl9tYXRlcmlhbHNfdW5saXQnXTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBfZ2V0TVRvb25FeHRlbnNpb24obWF0ZXJpYWxJbmRleDogbnVtYmVyKTogVjFNVG9vblNjaGVtYS5WUk1DTWF0ZXJpYWxzTVRvb24gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHBhcnNlciA9IHRoaXMucGFyc2VyO1xuICAgIGNvbnN0IGpzb24gPSBwYXJzZXIuanNvbiBhcyBHTFRGU2NoZW1hLklHTFRGO1xuXG4gICAgY29uc3QgbWF0ZXJpYWxEZWYgPSBqc29uLm1hdGVyaWFscz8uW21hdGVyaWFsSW5kZXhdO1xuXG4gICAgaWYgKG1hdGVyaWFsRGVmID09IG51bGwpIHtcbiAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgYE1Ub29uTWF0ZXJpYWxMb2FkZXJQbHVnaW46IEF0dGVtcHQgdG8gdXNlIG1hdGVyaWFsc1ske21hdGVyaWFsSW5kZXh9XSBvZiBnbFRGIGJ1dCB0aGUgbWF0ZXJpYWwgZG9lc24ndCBleGlzdGAsXG4gICAgICApO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBleHRlbnNpb24gPSBtYXRlcmlhbERlZi5leHRlbnNpb25zPy5bTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbi5FWFRFTlNJT05fTkFNRV0gYXNcbiAgICAgIFYxTVRvb25TY2hlbWEuVlJNQ01hdGVyaWFsc01Ub29uIHwgdW5kZWZpbmVkO1xuICAgIGlmIChleHRlbnNpb24gPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBzcGVjVmVyc2lvbiA9IGV4dGVuc2lvbi5zcGVjVmVyc2lvbjtcbiAgICBpZiAoIVBPU1NJQkxFX1NQRUNfVkVSU0lPTlMuaGFzKHNwZWNWZXJzaW9uKSkge1xuICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICBgTVRvb25NYXRlcmlhbExvYWRlclBsdWdpbjogVW5rbm93biAke01Ub29uTWF0ZXJpYWxMb2FkZXJQbHVnaW4uRVhURU5TSU9OX05BTUV9IHNwZWNWZXJzaW9uIFwiJHtzcGVjVmVyc2lvbn1cImAsXG4gICAgICApO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4gZXh0ZW5zaW9uO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfZXh0ZW5kTWF0ZXJpYWxQYXJhbXMoXG4gICAgZXh0ZW5zaW9uOiBWMU1Ub29uU2NoZW1hLlZSTUNNYXRlcmlhbHNNVG9vbixcbiAgICBtYXRlcmlhbFBhcmFtczogTVRvb25NYXRlcmlhbFBhcmFtZXRlcnMsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIFJlbW92aW5nIG1hdGVyaWFsIHBhcmFtcyB0aGF0IGlzIG5vdCByZXF1aXJlZCB0byBzdXByZXNzIHdhcm5pbmdzLlxuICAgIGRlbGV0ZSAobWF0ZXJpYWxQYXJhbXMgYXMgVEhSRUUuTWVzaFN0YW5kYXJkTWF0ZXJpYWxQYXJhbWV0ZXJzKS5tZXRhbG5lc3M7XG4gICAgZGVsZXRlIChtYXRlcmlhbFBhcmFtcyBhcyBUSFJFRS5NZXNoU3RhbmRhcmRNYXRlcmlhbFBhcmFtZXRlcnMpLnJvdWdobmVzcztcblxuICAgIGNvbnN0IGFzc2lnbkhlbHBlciA9IG5ldyBHTFRGTVRvb25NYXRlcmlhbFBhcmFtc0Fzc2lnbkhlbHBlcih0aGlzLnBhcnNlciwgbWF0ZXJpYWxQYXJhbXMpO1xuXG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgndHJhbnNwYXJlbnRXaXRoWldyaXRlJywgZXh0ZW5zaW9uLnRyYW5zcGFyZW50V2l0aFpXcml0ZSk7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnbkNvbG9yKCdzaGFkZUNvbG9yRmFjdG9yJywgZXh0ZW5zaW9uLnNoYWRlQ29sb3JGYWN0b3IpO1xuICAgIGFzc2lnbkhlbHBlci5hc3NpZ25UZXh0dXJlKCdzaGFkZU11bHRpcGx5VGV4dHVyZScsIGV4dGVuc2lvbi5zaGFkZU11bHRpcGx5VGV4dHVyZSwgdHJ1ZSk7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgnc2hhZGluZ1NoaWZ0RmFjdG9yJywgZXh0ZW5zaW9uLnNoYWRpbmdTaGlmdEZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblRleHR1cmUoJ3NoYWRpbmdTaGlmdFRleHR1cmUnLCBleHRlbnNpb24uc2hhZGluZ1NoaWZ0VGV4dHVyZSwgdHJ1ZSk7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgnc2hhZGluZ1NoaWZ0VGV4dHVyZVNjYWxlJywgZXh0ZW5zaW9uLnNoYWRpbmdTaGlmdFRleHR1cmU/LnNjYWxlKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdzaGFkaW5nVG9vbnlGYWN0b3InLCBleHRlbnNpb24uc2hhZGluZ1Rvb255RmFjdG9yKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdnaUVxdWFsaXphdGlvbkZhY3RvcicsIGV4dGVuc2lvbi5naUVxdWFsaXphdGlvbkZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnbkNvbG9yKCdtYXRjYXBGYWN0b3InLCBleHRlbnNpb24ubWF0Y2FwRmFjdG9yKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduVGV4dHVyZSgnbWF0Y2FwVGV4dHVyZScsIGV4dGVuc2lvbi5tYXRjYXBUZXh0dXJlLCB0cnVlKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduQ29sb3IoJ3BhcmFtZXRyaWNSaW1Db2xvckZhY3RvcicsIGV4dGVuc2lvbi5wYXJhbWV0cmljUmltQ29sb3JGYWN0b3IpO1xuICAgIGFzc2lnbkhlbHBlci5hc3NpZ25UZXh0dXJlKCdyaW1NdWx0aXBseVRleHR1cmUnLCBleHRlbnNpb24ucmltTXVsdGlwbHlUZXh0dXJlLCB0cnVlKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdyaW1MaWdodGluZ01peEZhY3RvcicsIGV4dGVuc2lvbi5yaW1MaWdodGluZ01peEZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgncGFyYW1ldHJpY1JpbUZyZXNuZWxQb3dlckZhY3RvcicsIGV4dGVuc2lvbi5wYXJhbWV0cmljUmltRnJlc25lbFBvd2VyRmFjdG9yKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdwYXJhbWV0cmljUmltTGlmdEZhY3RvcicsIGV4dGVuc2lvbi5wYXJhbWV0cmljUmltTGlmdEZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgnb3V0bGluZVdpZHRoTW9kZScsIGV4dGVuc2lvbi5vdXRsaW5lV2lkdGhNb2RlIGFzIE1Ub29uTWF0ZXJpYWxPdXRsaW5lV2lkdGhNb2RlKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdvdXRsaW5lV2lkdGhGYWN0b3InLCBleHRlbnNpb24ub3V0bGluZVdpZHRoRmFjdG9yKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduVGV4dHVyZSgnb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlJywgZXh0ZW5zaW9uLm91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZSwgZmFsc2UpO1xuICAgIGFzc2lnbkhlbHBlci5hc3NpZ25Db2xvcignb3V0bGluZUNvbG9yRmFjdG9yJywgZXh0ZW5zaW9uLm91dGxpbmVDb2xvckZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgnb3V0bGluZUxpZ2h0aW5nTWl4RmFjdG9yJywgZXh0ZW5zaW9uLm91dGxpbmVMaWdodGluZ01peEZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblRleHR1cmUoJ3V2QW5pbWF0aW9uTWFza1RleHR1cmUnLCBleHRlbnNpb24udXZBbmltYXRpb25NYXNrVGV4dHVyZSwgZmFsc2UpO1xuICAgIGFzc2lnbkhlbHBlci5hc3NpZ25QcmltaXRpdmUoJ3V2QW5pbWF0aW9uU2Nyb2xsWFNwZWVkRmFjdG9yJywgZXh0ZW5zaW9uLnV2QW5pbWF0aW9uU2Nyb2xsWFNwZWVkRmFjdG9yKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCd1dkFuaW1hdGlvblNjcm9sbFlTcGVlZEZhY3RvcicsIGV4dGVuc2lvbi51dkFuaW1hdGlvblNjcm9sbFlTcGVlZEZhY3Rvcik7XG4gICAgYXNzaWduSGVscGVyLmFzc2lnblByaW1pdGl2ZSgndXZBbmltYXRpb25Sb3RhdGlvblNwZWVkRmFjdG9yJywgZXh0ZW5zaW9uLnV2QW5pbWF0aW9uUm90YXRpb25TcGVlZEZhY3Rvcik7XG5cbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCd2MENvbXBhdFNoYWRlJywgdGhpcy52MENvbXBhdFNoYWRlKTtcbiAgICBhc3NpZ25IZWxwZXIuYXNzaWduUHJpbWl0aXZlKCdkZWJ1Z01vZGUnLCB0aGlzLmRlYnVnTW9kZSk7XG5cbiAgICBhd2FpdCBhc3NpZ25IZWxwZXIucGVuZGluZztcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGlzIHdpbGwgZG8gdHdvIHByb2Nlc3NlcyB0aGF0IGlzIHJlcXVpcmVkIHRvIHJlbmRlciBNVG9vbiBwcm9wZXJseS5cbiAgICpcbiAgICogLSBTZXQgcmVuZGVyIG9yZGVyXG4gICAqIC0gR2VuZXJhdGUgb3V0bGluZVxuICAgKlxuICAgKiBAcGFyYW0gbWVzaCBBIHRhcmdldCBHTFRGIHByaW1pdGl2ZVxuICAgKiBAcGFyYW0gbWF0ZXJpYWxJbmRleCBUaGUgbWF0ZXJpYWwgaW5kZXggb2YgdGhlIHByaW1pdGl2ZVxuICAgKi9cbiAgcHJpdmF0ZSBfc2V0dXBQcmltaXRpdmUobWVzaDogVEhSRUUuTWVzaCwgbWF0ZXJpYWxJbmRleDogbnVtYmVyKTogdm9pZCB7XG4gICAgY29uc3QgZXh0ZW5zaW9uID0gdGhpcy5fZ2V0TVRvb25FeHRlbnNpb24obWF0ZXJpYWxJbmRleCk7XG4gICAgaWYgKGV4dGVuc2lvbikge1xuICAgICAgY29uc3QgcmVuZGVyT3JkZXIgPSB0aGlzLl9wYXJzZVJlbmRlck9yZGVyKGV4dGVuc2lvbik7XG4gICAgICBtZXNoLnJlbmRlck9yZGVyID0gcmVuZGVyT3JkZXIgKyB0aGlzLnJlbmRlck9yZGVyT2Zmc2V0O1xuXG4gICAgICB0aGlzLl9nZW5lcmF0ZU91dGxpbmUobWVzaCk7XG5cbiAgICAgIHRoaXMuX2FkZFRvTWF0ZXJpYWxTZXQobWVzaCk7XG5cbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgd2hldGhlciB0aGUgbWF0ZXJpYWwgc2hvdWxkIGdlbmVyYXRlIG91dGxpbmUgb3Igbm90LlxuICAgKiBAcGFyYW0gc3VyZmFjZU1hdGVyaWFsIFRoZSBtYXRlcmlhbCB0byBjaGVja1xuICAgKiBAcmV0dXJucyBUcnVlIGlmIHRoZSBtYXRlcmlhbCBzaG91bGQgZ2VuZXJhdGUgb3V0bGluZVxuICAgKi9cbiAgcHJpdmF0ZSBfc2hvdWxkR2VuZXJhdGVPdXRsaW5lKHN1cmZhY2VNYXRlcmlhbDogVEhSRUUuTWF0ZXJpYWwpOiBib29sZWFuIHtcbiAgICAvLyB3ZSBtaWdodCByZWNlaXZlIE1Ub29uTm9kZU1hdGVyaWFsIGFzIHdlbGwgYXMgTVRvb25NYXRlcmlhbFxuICAgIC8vIHNvIHdlJ3JlIGdvbm5hIGR1Y2sgdHlwZSB0byBjaGVjayBpZiBpdCdzIGNvbXBhdGlibGUgd2l0aCBNVG9vbiB0eXBlIG91dGxpbmVzXG4gICAgcmV0dXJuIChcbiAgICAgIHR5cGVvZiAoc3VyZmFjZU1hdGVyaWFsIGFzIGFueSkub3V0bGluZVdpZHRoTW9kZSA9PT0gJ3N0cmluZycgJiZcbiAgICAgIChzdXJmYWNlTWF0ZXJpYWwgYXMgYW55KS5vdXRsaW5lV2lkdGhNb2RlICE9PSAnbm9uZScgJiZcbiAgICAgIHR5cGVvZiAoc3VyZmFjZU1hdGVyaWFsIGFzIGFueSkub3V0bGluZVdpZHRoRmFjdG9yID09PSAnbnVtYmVyJyAmJlxuICAgICAgKHN1cmZhY2VNYXRlcmlhbCBhcyBhbnkpLm91dGxpbmVXaWR0aEZhY3RvciA+IDAuMFxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogR2VuZXJhdGUgb3V0bGluZSBmb3IgdGhlIGdpdmVuIG1lc2gsIGlmIGl0IG5lZWRzLlxuICAgKlxuICAgKiBAcGFyYW0gbWVzaCBUaGUgdGFyZ2V0IG1lc2hcbiAgICovXG4gIHByaXZhdGUgX2dlbmVyYXRlT3V0bGluZShtZXNoOiBUSFJFRS5NZXNoKTogdm9pZCB7XG4gICAgLy8gT0ssIGl0J3MgdGhlIGhhY2t5IHBhcnQuXG4gICAgLy8gV2UgYXJlIGdvaW5nIHRvIGR1cGxpY2F0ZSB0aGUgTVRvb25NYXRlcmlhbCBmb3Igb3V0bGluZSB1c2UuXG4gICAgLy8gVGhlbiB3ZSBhcmUgZ29pbmcgdG8gY3JlYXRlIHR3byBnZW9tZXRyeSBncm91cHMgYW5kIHJlZmVyIHNhbWUgYnVmZmVyIGJ1dCBkaWZmZXJlbnQgbWF0ZXJpYWwuXG4gICAgLy8gSXQncyBob3cgd2UgZHJhdyB0d28gbWF0ZXJpYWxzIGF0IG9uY2UgdXNpbmcgYSBzaW5nbGUgbWVzaC5cblxuICAgIC8vIG1ha2Ugc3VyZSB0aGUgbWF0ZXJpYWwgaXMgc2luZ2xlXG4gICAgY29uc3Qgc3VyZmFjZU1hdGVyaWFsID0gbWVzaC5tYXRlcmlhbDtcbiAgICBpZiAoIShzdXJmYWNlTWF0ZXJpYWwgaW5zdGFuY2VvZiBUSFJFRS5NYXRlcmlhbCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuX3Nob3VsZEdlbmVyYXRlT3V0bGluZShzdXJmYWNlTWF0ZXJpYWwpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gbWFrZSBpdHMgbWF0ZXJpYWwgYW4gYXJyYXlcbiAgICBtZXNoLm1hdGVyaWFsID0gW3N1cmZhY2VNYXRlcmlhbF07IC8vIG1lc2gubWF0ZXJpYWwgaXMgZ3VhcmFudGVlZCB0byBiZSBhIE1hdGVyaWFsIGluIEdMVEZMb2FkZXJcblxuICAgIC8vIGR1cGxpY2F0ZSB0aGUgbWF0ZXJpYWwgZm9yIG91dGxpbmUgdXNlXG4gICAgY29uc3Qgb3V0bGluZU1hdGVyaWFsID0gc3VyZmFjZU1hdGVyaWFsLmNsb25lKCk7XG4gICAgb3V0bGluZU1hdGVyaWFsLm5hbWUgKz0gJyAoT3V0bGluZSknO1xuICAgIChvdXRsaW5lTWF0ZXJpYWwgYXMgYW55KS5pc091dGxpbmUgPSB0cnVlO1xuICAgIG91dGxpbmVNYXRlcmlhbC5zaWRlID0gVEhSRUUuQmFja1NpZGU7XG4gICAgbWVzaC5tYXRlcmlhbC5wdXNoKG91dGxpbmVNYXRlcmlhbCk7XG5cbiAgICAvLyBtYWtlIHR3byBnZW9tZXRyeSBncm91cHMgb3V0IG9mIGEgc2FtZSBidWZmZXJcbiAgICBjb25zdCBnZW9tZXRyeSA9IG1lc2guZ2VvbWV0cnk7IC8vIG1lc2guZ2VvbWV0cnkgaXMgZ3VhcmFudGVlZCB0byBiZSBhIEJ1ZmZlckdlb21ldHJ5IGluIEdMVEZMb2FkZXJcbiAgICBjb25zdCBwcmltaXRpdmVWZXJ0aWNlcyA9IGdlb21ldHJ5LmluZGV4ID8gZ2VvbWV0cnkuaW5kZXguY291bnQgOiBnZW9tZXRyeS5hdHRyaWJ1dGVzLnBvc2l0aW9uLmNvdW50IC8gMztcbiAgICBnZW9tZXRyeS5hZGRHcm91cCgwLCBwcmltaXRpdmVWZXJ0aWNlcywgMCk7XG4gICAgZ2VvbWV0cnkuYWRkR3JvdXAoMCwgcHJpbWl0aXZlVmVydGljZXMsIDEpO1xuICB9XG5cbiAgcHJpdmF0ZSBfYWRkVG9NYXRlcmlhbFNldChtZXNoOiBUSFJFRS5NZXNoKTogdm9pZCB7XG4gICAgY29uc3QgbWF0ZXJpYWxPck1hdGVyaWFscyA9IG1lc2gubWF0ZXJpYWw7XG4gICAgY29uc3QgbWF0ZXJpYWxTZXQgPSBuZXcgU2V0PFRIUkVFLk1hdGVyaWFsPigpO1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkobWF0ZXJpYWxPck1hdGVyaWFscykpIHtcbiAgICAgIG1hdGVyaWFsT3JNYXRlcmlhbHMuZm9yRWFjaCgobWF0ZXJpYWwpID0+IG1hdGVyaWFsU2V0LmFkZChtYXRlcmlhbCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBtYXRlcmlhbFNldC5hZGQobWF0ZXJpYWxPck1hdGVyaWFscyk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBtYXRlcmlhbCBvZiBtYXRlcmlhbFNldCkge1xuICAgICAgdGhpcy5fbVRvb25NYXRlcmlhbFNldC5hZGQobWF0ZXJpYWwpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX3BhcnNlUmVuZGVyT3JkZXIoZXh0ZW5zaW9uOiBWMU1Ub29uU2NoZW1hLlZSTUNNYXRlcmlhbHNNVG9vbik6IG51bWJlciB7XG4gICAgLy8gdHJhbnNwYXJlbnRXaXRoWldyaXRlIHJhbmdlcyBmcm9tIDAgdG8gKzlcbiAgICAvLyBtZXJlIHRyYW5zcGFyZW50IHJhbmdlcyBmcm9tIC05IHRvIDBcbiAgICBjb25zdCBlbmFibGVkWldyaXRlID0gZXh0ZW5zaW9uLnRyYW5zcGFyZW50V2l0aFpXcml0ZTtcbiAgICByZXR1cm4gKGVuYWJsZWRaV3JpdGUgPyAwIDogMTkpICsgKGV4dGVuc2lvbi5yZW5kZXJRdWV1ZU9mZnNldE51bWJlciA/PyAwKTtcbiAgfVxufVxuIiwgImltcG9ydCAqIGFzIFRIUkVFIGZyb20gJ3RocmVlJztcbmltcG9ydCB7IEdMVEZQYXJzZXIgfSBmcm9tICd0aHJlZS9leGFtcGxlcy9qc20vbG9hZGVycy9HTFRGTG9hZGVyLmpzJztcbmltcG9ydCB7IE1Ub29uTWF0ZXJpYWxQYXJhbWV0ZXJzIH0gZnJvbSAnLi9NVG9vbk1hdGVyaWFsUGFyYW1ldGVycyc7XG5pbXBvcnQgeyBzZXRUZXh0dXJlQ29sb3JTcGFjZSB9IGZyb20gJy4vdXRpbHMvc2V0VGV4dHVyZUNvbG9yU3BhY2UnO1xuXG4vKipcbiAqIE1hdGVyaWFsUGFyYW1ldGVycyBoYXRlcyBgdW5kZWZpbmVkYC4gVGhpcyBoZWxwZXIgYXV0b21hdGljYWxseSByZWplY3RzIGFzc2lnbiBvZiB0aGVzZSBgdW5kZWZpbmVkYC5cbiAqIEl0IGFsc28gaGFuZGxlcyBhc3luY2hyb25vdXMgcHJvY2VzcyBvZiB0ZXh0dXJlcy5cbiAqIE1ha2Ugc3VyZSBhd2FpdCBmb3Ige0BsaW5rIEdMVEZNVG9vbk1hdGVyaWFsUGFyYW1zQXNzaWduSGVscGVyLnBlbmRpbmd9LlxuICovXG5leHBvcnQgY2xhc3MgR0xURk1Ub29uTWF0ZXJpYWxQYXJhbXNBc3NpZ25IZWxwZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IF9wYXJzZXI6IEdMVEZQYXJzZXI7XG4gIHByaXZhdGUgX21hdGVyaWFsUGFyYW1zOiBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycztcbiAgcHJpdmF0ZSBfcGVuZGluZ3M6IFByb21pc2U8YW55PltdO1xuXG4gIHB1YmxpYyBnZXQgcGVuZGluZygpOiBQcm9taXNlPHVua25vd24+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5hbGwodGhpcy5fcGVuZGluZ3MpO1xuICB9XG5cbiAgcHVibGljIGNvbnN0cnVjdG9yKHBhcnNlcjogR0xURlBhcnNlciwgbWF0ZXJpYWxQYXJhbXM6IE1Ub29uTWF0ZXJpYWxQYXJhbWV0ZXJzKSB7XG4gICAgdGhpcy5fcGFyc2VyID0gcGFyc2VyO1xuICAgIHRoaXMuX21hdGVyaWFsUGFyYW1zID0gbWF0ZXJpYWxQYXJhbXM7XG4gICAgdGhpcy5fcGVuZGluZ3MgPSBbXTtcbiAgfVxuXG4gIHB1YmxpYyBhc3NpZ25QcmltaXRpdmU8VCBleHRlbmRzIGtleW9mIE1Ub29uTWF0ZXJpYWxQYXJhbWV0ZXJzPihrZXk6IFQsIHZhbHVlOiBNVG9vbk1hdGVyaWFsUGFyYW1ldGVyc1tUXSk6IHZvaWQge1xuICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICB0aGlzLl9tYXRlcmlhbFBhcmFtc1trZXldID0gdmFsdWU7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGFzc2lnbkNvbG9yPFQgZXh0ZW5kcyBrZXlvZiBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycz4oXG4gICAga2V5OiBULFxuICAgIHZhbHVlOiBudW1iZXJbXSB8IHVuZGVmaW5lZCxcbiAgICBjb252ZXJ0U1JHQlRvTGluZWFyPzogYm9vbGVhbixcbiAgKTogdm9pZCB7XG4gICAgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgIGNvbnN0IGNvbG9yID0gbmV3IFRIUkVFLkNvbG9yKCkuZnJvbUFycmF5KHZhbHVlKTtcblxuICAgICAgaWYgKGNvbnZlcnRTUkdCVG9MaW5lYXIpIHtcbiAgICAgICAgY29sb3IuY29udmVydFNSR0JUb0xpbmVhcigpO1xuICAgICAgfVxuICAgICAgKHRoaXMuX21hdGVyaWFsUGFyYW1zIGFzIGFueSlba2V5XSA9IGNvbG9yO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBhc3NpZ25UZXh0dXJlPFQgZXh0ZW5kcyBrZXlvZiBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycz4oXG4gICAga2V5OiBULFxuICAgIHNjaGVtYVRleHR1cmU6IHsgaW5kZXg6IG51bWJlciB9IHwgdW5kZWZpbmVkLFxuICAgIGlzQ29sb3JUZXh0dXJlOiBib29sZWFuLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBwcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChzY2hlbWFUZXh0dXJlICE9IG51bGwpIHtcbiAgICAgICAgY29uc3QgdGV4dHVyZSA9IGF3YWl0IHRoaXMuX3BhcnNlci5hc3NpZ25UZXh0dXJlKHRoaXMuX21hdGVyaWFsUGFyYW1zLCBrZXksIHNjaGVtYVRleHR1cmUpO1xuXG4gICAgICAgIC8vIGVhcmx5IGFib3J0IGlmIHRleHR1cmUgZmFpbGVkIHRvIGxvYWRcbiAgICAgICAgaWYgKHRleHR1cmUgPT0gbnVsbCkge1xuICAgICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICAgICdHTFRGTVRvb25NYXRlcmlhbFBhcmFtc0Fzc2lnbkhlbHBlcjogRmFpbGVkIHRvIGxvYWQgdGV4dHVyZS4gVGhlIHJlbmRlcmluZyByZXN1bHQgbWF5IGJlIHdyb25nJyxcbiAgICAgICAgICApO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc0NvbG9yVGV4dHVyZSkge1xuICAgICAgICAgIHNldFRleHR1cmVDb2xvclNwYWNlKHRleHR1cmUsICdzcmdiJyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KSgpO1xuXG4gICAgdGhpcy5fcGVuZGluZ3MucHVzaChwcm9taXNlKTtcblxuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGFzc2lnblRleHR1cmVCeUluZGV4PFQgZXh0ZW5kcyBrZXlvZiBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycz4oXG4gICAga2V5OiBULFxuICAgIHRleHR1cmVJbmRleDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICAgIGlzQ29sb3JUZXh0dXJlOiBib29sZWFuLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gdGhpcy5hc3NpZ25UZXh0dXJlKGtleSwgdGV4dHVyZUluZGV4ICE9IG51bGwgPyB7IGluZGV4OiB0ZXh0dXJlSW5kZXggfSA6IHVuZGVmaW5lZCwgaXNDb2xvclRleHR1cmUpO1xuICB9XG59XG4iLCAiaW1wb3J0ICogYXMgVEhSRUUgZnJvbSAndGhyZWUnO1xuXG5jb25zdCBjb2xvclNwYWNlRW5jb2RpbmdNYXA6IFJlY29yZDwnJyB8ICdzcmdiJywgYW55PiA9IHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uYW1pbmctY29udmVudGlvblxuICAnJzogMzAwMCxcbiAgc3JnYjogMzAwMSxcbn07XG5cbi8qKlxuICogQSBjb21wYXQgZnVuY3Rpb24gdG8gc2V0IHRleHR1cmUgY29sb3Igc3BhY2UuXG4gKlxuICogQ09NUEFUOiBwcmUtcjE1MlxuICogU3RhcnRpbmcgZnJvbSBUaHJlZS5qcyByMTUyLCBgdGV4dHVyZS5lbmNvZGluZ2AgaXMgcmVuYW1lZCB0byBgdGV4dHVyZS5jb2xvclNwYWNlYC5cbiAqIFRoaXMgZnVuY3Rpb24gd2lsbCBoYW5kbGUgdGhlIGNvbWFwdC5cbiAqXG4gKiBAcGFyYW0gdGV4dHVyZSBUaGUgdGV4dHVyZSB5b3Ugd2FudCB0byBzZXQgdGhlIGNvbG9yIHNwYWNlIHRvXG4gKiBAcGFyYW0gY29sb3JTcGFjZSBUaGUgY29sb3Igc3BhY2UgeW91IHdhbnQgdG8gc2V0IHRvIHRoZSB0ZXh0dXJlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRUZXh0dXJlQ29sb3JTcGFjZSh0ZXh0dXJlOiBUSFJFRS5UZXh0dXJlLCBjb2xvclNwYWNlOiAnJyB8ICdzcmdiJyk6IHZvaWQge1xuICBpZiAocGFyc2VJbnQoVEhSRUUuUkVWSVNJT04sIDEwKSA+PSAxNTIpIHtcbiAgICB0ZXh0dXJlLmNvbG9yU3BhY2UgPSBjb2xvclNwYWNlO1xuICB9IGVsc2Uge1xuICAgICh0ZXh0dXJlIGFzIGFueSkuZW5jb2RpbmcgPSBjb2xvclNwYWNlRW5jb2RpbmdNYXBbY29sb3JTcGFjZV07XG4gIH1cbn1cbiIsICIvKiB0c2xpbnQ6ZGlzYWJsZTptZW1iZXItb3JkZXJpbmcgKi9cblxuaW1wb3J0ICogYXMgVEhSRUUgZnJvbSAndGhyZWUnO1xuaW1wb3J0IHZlcnRleFNoYWRlciBmcm9tICcuL3NoYWRlcnMvbXRvb24udmVydCc7XG5pbXBvcnQgZnJhZ21lbnRTaGFkZXIgZnJvbSAnLi9zaGFkZXJzL210b29uLmZyYWcnO1xuaW1wb3J0IHsgTVRvb25NYXRlcmlhbERlYnVnTW9kZSB9IGZyb20gJy4vTVRvb25NYXRlcmlhbERlYnVnTW9kZSc7XG5pbXBvcnQgeyBNVG9vbk1hdGVyaWFsT3V0bGluZVdpZHRoTW9kZSB9IGZyb20gJy4vTVRvb25NYXRlcmlhbE91dGxpbmVXaWR0aE1vZGUnO1xuaW1wb3J0IHR5cGUgeyBNVG9vbk1hdGVyaWFsUGFyYW1ldGVycyB9IGZyb20gJy4vTVRvb25NYXRlcmlhbFBhcmFtZXRlcnMnO1xuaW1wb3J0IHsgZ2V0VGV4dHVyZUNvbG9yU3BhY2UgfSBmcm9tICcuL3V0aWxzL2dldFRleHR1cmVDb2xvclNwYWNlJztcblxuLyoqXG4gKiBNVG9vbiBpcyBhIG1hdGVyaWFsIHNwZWNpZmljYXRpb24gdGhhdCBoYXMgdmFyaW91cyBmZWF0dXJlcy5cbiAqIFRoZSBzcGVjIGFuZCBpbXBsZW1lbnRhdGlvbiBhcmUgb3JpZ2luYWxseSBmb3VuZGVkIGZvciBVbml0eSBlbmdpbmUgYW5kIHRoaXMgaXMgYSBwb3J0IG9mIHRoZSBtYXRlcmlhbC5cbiAqXG4gKiBTZWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9TYW50YXJoL01Ub29uXG4gKi9cbmV4cG9ydCBjbGFzcyBNVG9vbk1hdGVyaWFsIGV4dGVuZHMgVEhSRUUuU2hhZGVyTWF0ZXJpYWwge1xuICBwdWJsaWMgdW5pZm9ybXM6IHtcbiAgICBsaXRGYWN0b3I6IFRIUkVFLklVbmlmb3JtPFRIUkVFLkNvbG9yPjtcbiAgICBhbHBoYVRlc3Q6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgb3BhY2l0eTogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBtYXA6IFRIUkVFLklVbmlmb3JtPFRIUkVFLlRleHR1cmUgfCBudWxsPjtcbiAgICBtYXBVdlRyYW5zZm9ybTogVEhSRUUuSVVuaWZvcm08VEhSRUUuTWF0cml4Mz47XG4gICAgbm9ybWFsTWFwOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5UZXh0dXJlIHwgbnVsbD47XG4gICAgbm9ybWFsTWFwVXZUcmFuc2Zvcm06IFRIUkVFLklVbmlmb3JtPFRIUkVFLk1hdHJpeDM+O1xuICAgIG5vcm1hbFNjYWxlOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5WZWN0b3IyPjtcbiAgICBlbWlzc2l2ZTogVEhSRUUuSVVuaWZvcm08VEhSRUUuQ29sb3I+O1xuICAgIGVtaXNzaXZlSW50ZW5zaXR5OiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGVtaXNzaXZlTWFwOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5UZXh0dXJlIHwgbnVsbD47XG4gICAgZW1pc3NpdmVNYXBVdlRyYW5zZm9ybTogVEhSRUUuSVVuaWZvcm08VEhSRUUuTWF0cml4Mz47XG4gICAgc2hhZGVDb2xvckZhY3RvcjogVEhSRUUuSVVuaWZvcm08VEhSRUUuQ29sb3I+O1xuICAgIHNoYWRlTXVsdGlwbHlUZXh0dXJlOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5UZXh0dXJlIHwgbnVsbD47XG4gICAgc2hhZGVNdWx0aXBseVRleHR1cmVVdlRyYW5zZm9ybTogVEhSRUUuSVVuaWZvcm08VEhSRUUuTWF0cml4Mz47XG4gICAgc2hhZGluZ1NoaWZ0RmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNoYWRpbmdTaGlmdFRleHR1cmU6IFRIUkVFLklVbmlmb3JtPFRIUkVFLlRleHR1cmUgfCBudWxsPjtcbiAgICBzaGFkaW5nU2hpZnRUZXh0dXJlVXZUcmFuc2Zvcm06IFRIUkVFLklVbmlmb3JtPFRIUkVFLk1hdHJpeDM+O1xuICAgIHNoYWRpbmdTaGlmdFRleHR1cmVTY2FsZTogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzaGFkaW5nVG9vbnlGYWN0b3I6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgZ2lFcXVhbGl6YXRpb25GYWN0b3I6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgbWF0Y2FwRmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5Db2xvcj47XG4gICAgbWF0Y2FwVGV4dHVyZTogVEhSRUUuSVVuaWZvcm08VEhSRUUuVGV4dHVyZSB8IG51bGw+O1xuICAgIG1hdGNhcFRleHR1cmVVdlRyYW5zZm9ybTogVEhSRUUuSVVuaWZvcm08VEhSRUUuTWF0cml4Mz47XG4gICAgcGFyYW1ldHJpY1JpbUNvbG9yRmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5Db2xvcj47XG4gICAgcmltTXVsdGlwbHlUZXh0dXJlOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5UZXh0dXJlIHwgbnVsbD47XG4gICAgcmltTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm06IFRIUkVFLklVbmlmb3JtPFRIUkVFLk1hdHJpeDM+O1xuICAgIHJpbUxpZ2h0aW5nTWl4RmFjdG9yOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHBhcmFtZXRyaWNSaW1GcmVzbmVsUG93ZXJGYWN0b3I6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgcGFyYW1ldHJpY1JpbUxpZnRGYWN0b3I6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5UZXh0dXJlIHwgbnVsbD47XG4gICAgb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm06IFRIUkVFLklVbmlmb3JtPFRIUkVFLk1hdHJpeDM+O1xuICAgIG91dGxpbmVXaWR0aEZhY3RvcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBvdXRsaW5lQ29sb3JGYWN0b3I6IFRIUkVFLklVbmlmb3JtPFRIUkVFLkNvbG9yPjtcbiAgICBvdXRsaW5lTGlnaHRpbmdNaXhGYWN0b3I6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgdXZBbmltYXRpb25NYXNrVGV4dHVyZTogVEhSRUUuSVVuaWZvcm08VEhSRUUuVGV4dHVyZSB8IG51bGw+O1xuICAgIHV2QW5pbWF0aW9uTWFza1RleHR1cmVVdlRyYW5zZm9ybTogVEhSRUUuSVVuaWZvcm08VEhSRUUuTWF0cml4Mz47XG4gICAgdXZBbmltYXRpb25TY3JvbGxYT2Zmc2V0OiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHV2QW5pbWF0aW9uU2Nyb2xsWU9mZnNldDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICB1dkFuaW1hdGlvblJvdGF0aW9uUGhhc2U6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgLy8gRXh0ZW5kZWQgdHVuaW5nIHBhcmFtZXRlcnNcbiAgICBzb2Z0TWl4OiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGJsdXJCb29zdDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzaGFkb3cybmRTdHJlbmd0aDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzaGFkb3cybmRCb3JkZXI6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2hhZG93Mm5kQmx1cjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzaGFkb3cybmRDb2xvcjogVEhSRUUuSVVuaWZvcm08VEhSRUUuQ29sb3I+O1xuICAgIHNoYWRvdzNyZFN0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNoYWRvdzNyZEJvcmRlcjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzaGFkb3czcmRCbHVyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNoYWRvdzNyZENvbG9yOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5Db2xvcj47XG4gICAgcmltQm9vc3Q6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgcmltQm9yZGVyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHJpbUJsdXI6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgcmltRGlyU3RyZW5ndGg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgaGFpclNwZWNTdHJlbmd0aDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBoYWlyU3BlY1Bvd2VyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGhhaXJTcGVjU2hpZnQ6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgY2xvdGhTcGVjU3RyZW5ndGg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgY2xvdGhTcGVjUG93ZXI6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgbWF0Y2FwMm5kU3RyZW5ndGg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2tpblNwZWNTdHJlbmd0aDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBza2luU3BlY1Bvd2VyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNraW5TcGVjRnJlc25lbDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBza2luU3BlY0NvbG9yOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5Db2xvcj47XG4gICAgYW1iaWVudExpZnQ6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2hhZGVNYWluU3RyZW5ndGg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc2hhZG93Qm9yZGVyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNoYWRvd0JsdXI6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgcmltTWFpblN0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHJpbVNoYWRvd01hc2s6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgc3BlY3VsYXJTdHJlbmd0aDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBzcGVjdWxhclBvd2VyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNwZWN1bGFyQm9yZGVyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHNwZWN1bGFyQmx1cjogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICByZWZsZWN0U3RyZW5ndGg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgcmVmbGVjdEZyZXNuZWw6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgcmVmbGVjdE1ldGFsbGljOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHJlZmxlY3RTbW9vdGhuZXNzOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGJhY2tsaWdodFN0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGJhY2tsaWdodENvbG9yOiBUSFJFRS5JVW5pZm9ybTxUSFJFRS5Db2xvcj47XG4gICAgcmltRnJlc25lbFBvd2VyOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIHJpbUluZGlyU3RyZW5ndGg6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgbWF0Y2FwMm5kQ29udHJhc3Q6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgbWF0Y2FwMm5kU2NhbGU6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgZW1pc3Npb25Cb29zdDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBkaXN0YW5jZUZhZGU6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgZmFjZVNvZnQ6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgbm9ybWFsU2tpbkJvb3N0OiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGVudlN0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGdlbUZyZXNuZWw6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgb3V0bGluZU1peDogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICByZWNlaXZlU2hhZG93UmF0ZTogVEhSRUUuSVVuaWZvcm08bnVtYmVyPjtcbiAgICBmYWJyaWNTaGVlblN0cmVuZ3RoOiBUSFJFRS5JVW5pZm9ybTxudW1iZXI+O1xuICAgIGZhYnJpY1NoZWVuUG93ZXI6IFRIUkVFLklVbmlmb3JtPG51bWJlcj47XG4gICAgZmFicmljU2hlZW5Db2xvcjogVEhSRUUuSVVuaWZvcm08VEhSRUUuQ29sb3I+O1xuICB9O1xuXG4gIHB1YmxpYyBnZXQgY29sb3IoKTogVEhSRUUuQ29sb3Ige1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmxpdEZhY3Rvci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGNvbG9yKHZhbHVlOiBUSFJFRS5Db2xvcikge1xuICAgIHRoaXMudW5pZm9ybXMubGl0RmFjdG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IG1hcCgpOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMubWFwLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgbWFwKHZhbHVlOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCkge1xuICAgIHRoaXMudW5pZm9ybXMubWFwLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IG5vcm1hbE1hcCgpOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMubm9ybWFsTWFwLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgbm9ybWFsTWFwKHZhbHVlOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCkge1xuICAgIHRoaXMudW5pZm9ybXMubm9ybWFsTWFwLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IG5vcm1hbFNjYWxlKCk6IFRIUkVFLlZlY3RvcjIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm5vcm1hbFNjYWxlLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgbm9ybWFsU2NhbGUodmFsdWU6IFRIUkVFLlZlY3RvcjIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm5vcm1hbFNjYWxlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGVtaXNzaXZlKCk6IFRIUkVFLkNvbG9yIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5lbWlzc2l2ZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGVtaXNzaXZlKHZhbHVlOiBUSFJFRS5Db2xvcikge1xuICAgIHRoaXMudW5pZm9ybXMuZW1pc3NpdmUudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgZW1pc3NpdmVJbnRlbnNpdHkoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5lbWlzc2l2ZUludGVuc2l0eS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGVtaXNzaXZlSW50ZW5zaXR5KHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmVtaXNzaXZlSW50ZW5zaXR5LnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGVtaXNzaXZlTWFwKCk6IFRIUkVFLlRleHR1cmUgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5lbWlzc2l2ZU1hcC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGVtaXNzaXZlTWFwKHZhbHVlOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCkge1xuICAgIHRoaXMudW5pZm9ybXMuZW1pc3NpdmVNYXAudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZGVDb2xvckZhY3RvcigpOiBUSFJFRS5Db2xvciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZGVDb2xvckZhY3Rvci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRlQ29sb3JGYWN0b3IodmFsdWU6IFRIUkVFLkNvbG9yKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkZUNvbG9yRmFjdG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRlTXVsdGlwbHlUZXh0dXJlKCk6IFRIUkVFLlRleHR1cmUgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zaGFkZU11bHRpcGx5VGV4dHVyZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRlTXVsdGlwbHlUZXh0dXJlKHZhbHVlOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCkge1xuICAgIHRoaXMudW5pZm9ybXMuc2hhZGVNdWx0aXBseVRleHR1cmUudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZGluZ1NoaWZ0RmFjdG9yKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZGluZ1NoaWZ0RmFjdG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZGluZ1NoaWZ0RmFjdG9yKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRpbmdTaGlmdEZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkaW5nU2hpZnRUZXh0dXJlKCk6IFRIUkVFLlRleHR1cmUgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zaGFkaW5nU2hpZnRUZXh0dXJlLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZGluZ1NoaWZ0VGV4dHVyZSh2YWx1ZTogVEhSRUUuVGV4dHVyZSB8IG51bGwpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRpbmdTaGlmdFRleHR1cmUudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZGluZ1NoaWZ0VGV4dHVyZVNjYWxlKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZGluZ1NoaWZ0VGV4dHVyZVNjYWxlLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZGluZ1NoaWZ0VGV4dHVyZVNjYWxlKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRpbmdTaGlmdFRleHR1cmVTY2FsZS52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkaW5nVG9vbnlGYWN0b3IoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zaGFkaW5nVG9vbnlGYWN0b3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkaW5nVG9vbnlGYWN0b3IodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2hhZGluZ1Rvb255RmFjdG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGdpRXF1YWxpemF0aW9uRmFjdG9yKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuZ2lFcXVhbGl6YXRpb25GYWN0b3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBnaUVxdWFsaXphdGlvbkZhY3Rvcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5naUVxdWFsaXphdGlvbkZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBtYXRjYXBGYWN0b3IoKTogVEhSRUUuQ29sb3Ige1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm1hdGNhcEZhY3Rvci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG1hdGNhcEZhY3Rvcih2YWx1ZTogVEhSRUUuQ29sb3IpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm1hdGNhcEZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBtYXRjYXBUZXh0dXJlKCk6IFRIUkVFLlRleHR1cmUgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5tYXRjYXBUZXh0dXJlLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgbWF0Y2FwVGV4dHVyZSh2YWx1ZTogVEhSRUUuVGV4dHVyZSB8IG51bGwpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm1hdGNhcFRleHR1cmUudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgcGFyYW1ldHJpY1JpbUNvbG9yRmFjdG9yKCk6IFRIUkVFLkNvbG9yIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5wYXJhbWV0cmljUmltQ29sb3JGYWN0b3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBwYXJhbWV0cmljUmltQ29sb3JGYWN0b3IodmFsdWU6IFRIUkVFLkNvbG9yKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5wYXJhbWV0cmljUmltQ29sb3JGYWN0b3IudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgcmltTXVsdGlwbHlUZXh0dXJlKCk6IFRIUkVFLlRleHR1cmUgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5yaW1NdWx0aXBseVRleHR1cmUudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCByaW1NdWx0aXBseVRleHR1cmUodmFsdWU6IFRIUkVFLlRleHR1cmUgfCBudWxsKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yaW1NdWx0aXBseVRleHR1cmUudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgcmltTGlnaHRpbmdNaXhGYWN0b3IoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5yaW1MaWdodGluZ01peEZhY3Rvci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHJpbUxpZ2h0aW5nTWl4RmFjdG9yKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJpbUxpZ2h0aW5nTWl4RmFjdG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHBhcmFtZXRyaWNSaW1GcmVzbmVsUG93ZXJGYWN0b3IoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5wYXJhbWV0cmljUmltRnJlc25lbFBvd2VyRmFjdG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcGFyYW1ldHJpY1JpbUZyZXNuZWxQb3dlckZhY3Rvcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5wYXJhbWV0cmljUmltRnJlc25lbFBvd2VyRmFjdG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHBhcmFtZXRyaWNSaW1MaWZ0RmFjdG9yKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucGFyYW1ldHJpY1JpbUxpZnRGYWN0b3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBwYXJhbWV0cmljUmltTGlmdEZhY3Rvcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5wYXJhbWV0cmljUmltTGlmdEZhY3Rvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIDAuLjEgYmxlbmQgdG93YXJkIGhhbGYtTGFtYmVydCBzb2Z0IHRvb24gKGxpbFRvb24tbGlrZSkuIERlZmF1bHQgMC45NSAqL1xuICBwdWJsaWMgZ2V0IHNvZnRNaXgoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zb2Z0TWl4LnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc29mdE1peCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zb2Z0TWl4LnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogRXh0cmEgYmx1ciB3aWR0aCBhZGRlZCB0byAoMSAtIHNoYWRpbmdUb29ueSkgb24gdGhlIHNvZnQgcGF0aC4gRGVmYXVsdCAwLjMyICovXG4gIHB1YmxpYyBnZXQgYmx1ckJvb3N0KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuYmx1ckJvb3N0LnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgYmx1ckJvb3N0KHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmJsdXJCb29zdC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkb3cybmRTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNoYWRvdzJuZFN0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZG93Mm5kU3RyZW5ndGgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2hhZG93Mm5kU3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZG93Mm5kQm9yZGVyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZG93Mm5kQm9yZGVyLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZG93Mm5kQm9yZGVyKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRvdzJuZEJvcmRlci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkb3cybmRCbHVyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZG93Mm5kQmx1ci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRvdzJuZEJsdXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2hhZG93Mm5kQmx1ci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkb3cybmRDb2xvcigpOiBUSFJFRS5Db2xvciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZG93Mm5kQ29sb3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkb3cybmRDb2xvcih2YWx1ZTogVEhSRUUuQ29sb3IpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRvdzJuZENvbG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRvdzNyZFN0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2hhZG93M3JkU3RyZW5ndGgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkb3czcmRTdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkb3czcmRTdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBzaGFkb3czcmRCb3JkZXIoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zaGFkb3czcmRCb3JkZXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkb3czcmRCb3JkZXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2hhZG93M3JkQm9yZGVyLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRvdzNyZEJsdXIoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zaGFkb3czcmRCbHVyLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgc2hhZG93M3JkQmx1cih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkb3czcmRCbHVyLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRvdzNyZENvbG9yKCk6IFRIUkVFLkNvbG9yIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zaGFkb3czcmRDb2xvci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRvdzNyZENvbG9yKHZhbHVlOiBUSFJFRS5Db2xvcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2hhZG93M3JkQ29sb3IudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBNdWx0aXBsaWVyIG9uIHRvb25lZCByaW0uIERlZmF1bHQgMS40OyBleWVzIGNhcmVmdWwgdmlhIFZSTU1hdGVyaWFsTWFuYWdlciAqL1xuICBwdWJsaWMgZ2V0IHJpbUJvb3N0KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmltQm9vc3QudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCByaW1Cb29zdCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yaW1Cb29zdC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCByaW1Cb3JkZXIoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5yaW1Cb3JkZXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCByaW1Cb3JkZXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMucmltQm9yZGVyLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHJpbUJsdXIoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5yaW1CbHVyLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmltQmx1cih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yaW1CbHVyLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHJpbURpclN0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmltRGlyU3RyZW5ndGgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCByaW1EaXJTdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5yaW1EaXJTdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBoYWlyU3BlY1N0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuaGFpclNwZWNTdHJlbmd0aC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGhhaXJTcGVjU3RyZW5ndGgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuaGFpclNwZWNTdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBoYWlyU3BlY1Bvd2VyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuaGFpclNwZWNQb3dlci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGhhaXJTcGVjUG93ZXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuaGFpclNwZWNQb3dlci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBoYWlyU3BlY1NoaWZ0KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuaGFpclNwZWNTaGlmdC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGhhaXJTcGVjU2hpZnQodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuaGFpclNwZWNTaGlmdC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBjbG90aFNwZWNTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmNsb3RoU3BlY1N0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgY2xvdGhTcGVjU3RyZW5ndGgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuY2xvdGhTcGVjU3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgY2xvdGhTcGVjUG93ZXIoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5jbG90aFNwZWNQb3dlci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGNsb3RoU3BlY1Bvd2VyKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmNsb3RoU3BlY1Bvd2VyLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IG1hdGNhcDJuZFN0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMubWF0Y2FwMm5kU3RyZW5ndGgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBtYXRjYXAybmRTdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5tYXRjYXAybmRTdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBza2luU3BlY1N0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2tpblNwZWNTdHJlbmd0aC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNraW5TcGVjU3RyZW5ndGgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2tpblNwZWNTdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBza2luU3BlY1Bvd2VyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc2tpblNwZWNQb3dlci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNraW5TcGVjUG93ZXIodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2tpblNwZWNQb3dlci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBza2luU3BlY0ZyZXNuZWwoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5za2luU3BlY0ZyZXNuZWwudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBza2luU3BlY0ZyZXNuZWwodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2tpblNwZWNGcmVzbmVsLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNraW5TcGVjQ29sb3IoKTogVEhSRUUuQ29sb3Ige1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNraW5TcGVjQ29sb3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBza2luU3BlY0NvbG9yKHZhbHVlOiBUSFJFRS5Db2xvcikge1xuICAgIHRoaXMudW5pZm9ybXMuc2tpblNwZWNDb2xvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBhbWJpZW50TGlmdCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmFtYmllbnRMaWZ0LnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgYW1iaWVudExpZnQodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuYW1iaWVudExpZnQudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZGVNYWluU3RyZW5ndGgoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5zaGFkZU1haW5TdHJlbmd0aC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRlTWFpblN0cmVuZ3RoKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRlTWFpblN0cmVuZ3RoLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHNoYWRvd0JvcmRlcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNoYWRvd0JvcmRlci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNoYWRvd0JvcmRlcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zaGFkb3dCb3JkZXIudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2hhZG93Qmx1cigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNoYWRvd0JsdXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzaGFkb3dCbHVyKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNoYWRvd0JsdXIudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgcmltTWFpblN0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmltTWFpblN0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmltTWFpblN0cmVuZ3RoKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJpbU1haW5TdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCByaW1TaGFkb3dNYXNrKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmltU2hhZG93TWFzay52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHJpbVNoYWRvd01hc2sodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMucmltU2hhZG93TWFzay52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIGxpbENhbGNTcGVjdWxhci1saWtlIHRvb24gc3BlY3VsYXIgc3RyZW5ndGggKDAgPSBvZmYpICovXG4gIHB1YmxpYyBnZXQgc3BlY3VsYXJTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNwZWN1bGFyU3RyZW5ndGgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzcGVjdWxhclN0cmVuZ3RoKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNwZWN1bGFyU3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBTcGVjdWxhciBCbGlubiBwb3dlciAvIGludmVyc2Utcm91Z2huZXNzIHByb3h5ICovXG4gIHB1YmxpYyBnZXQgc3BlY3VsYXJQb3dlcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNwZWN1bGFyUG93ZXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzcGVjdWxhclBvd2VyKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnNwZWN1bGFyUG93ZXIudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBUb29uIHNwZWN1bGFyIGJvcmRlciBpbiBbMCwxXSAqL1xuICBwdWJsaWMgZ2V0IHNwZWN1bGFyQm9yZGVyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuc3BlY3VsYXJCb3JkZXIudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBzcGVjdWxhckJvcmRlcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zcGVjdWxhckJvcmRlci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIFRvb24gc3BlY3VsYXIgYmx1ciB3aWR0aCAqL1xuICBwdWJsaWMgZ2V0IHNwZWN1bGFyQmx1cigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnNwZWN1bGFyQmx1ci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHNwZWN1bGFyQmx1cih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5zcGVjdWxhckJsdXIudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBWaWV3LWRlcGVuZGVudCBlbnYgcmVmbGVjdGlvbiBhcHByb3ggKG5vIGN1YmVtYXApICovXG4gIHB1YmxpYyBnZXQgcmVmbGVjdFN0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmVmbGVjdFN0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmVmbGVjdFN0cmVuZ3RoKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJlZmxlY3RTdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIEZyZXNuZWwgYW1vdW50IGZvciBlbnYgYXBwcm94ICovXG4gIHB1YmxpYyBnZXQgcmVmbGVjdEZyZXNuZWwoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5yZWZsZWN0RnJlc25lbC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHJlZmxlY3RGcmVzbmVsKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJlZmxlY3RGcmVzbmVsLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogMCBkaWVsZWN0cmljIC4uIDEgbWV0YWwgKHRpbnRzIHJlZmxlY3Rpb24gdG93YXJkIGFsYmVkbykgKi9cbiAgcHVibGljIGdldCByZWZsZWN0TWV0YWxsaWMoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5yZWZsZWN0TWV0YWxsaWMudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCByZWZsZWN0TWV0YWxsaWModmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMucmVmbGVjdE1ldGFsbGljLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogU2hhcnBlciBncmF6aW5nIHJlZmxlY3Rpb24gd2hlbiBoaWdoICovXG4gIHB1YmxpYyBnZXQgcmVmbGVjdFNtb290aG5lc3MoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5yZWZsZWN0U21vb3RobmVzcy52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHJlZmxlY3RTbW9vdGhuZXNzKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJlZmxlY3RTbW9vdGhuZXNzLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogbGlsIGJhY2tsaWdodCB3cmFwIHN0cmVuZ3RoICgwID0gb2ZmKSAqL1xuICBwdWJsaWMgZ2V0IGJhY2tsaWdodFN0cmVuZ3RoKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuYmFja2xpZ2h0U3RyZW5ndGgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBiYWNrbGlnaHRTdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5iYWNrbGlnaHRTdHJlbmd0aC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIEJhY2tsaWdodCB0aW50IGNvbG9yICovXG4gIHB1YmxpYyBnZXQgYmFja2xpZ2h0Q29sb3IoKTogVEhSRUUuQ29sb3Ige1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmJhY2tsaWdodENvbG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgYmFja2xpZ2h0Q29sb3IodmFsdWU6IFRIUkVFLkNvbG9yKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5iYWNrbGlnaHRDb2xvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqID4wIG92ZXJyaWRlcyBwYXJhbWV0cmljIHJpbSBmcmVzbmVsIHBvd2VyICovXG4gIHB1YmxpYyBnZXQgcmltRnJlc25lbFBvd2VyKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMucmltRnJlc25lbFBvd2VyLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmltRnJlc25lbFBvd2VyKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJpbUZyZXNuZWxQb3dlci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIE9wcG9zaXRlLXNpZGUgcmltIChsaWwgUmltSW5kaXIpICovXG4gIHB1YmxpYyBnZXQgcmltSW5kaXJTdHJlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnJpbUluZGlyU3RyZW5ndGgudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCByaW1JbmRpclN0cmVuZ3RoKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnJpbUluZGlyU3RyZW5ndGgudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBDb250cmFzdCBmb3Igc3ludGhlc2l6ZWQgMm5kIE1hdENhcCAqL1xuICBwdWJsaWMgZ2V0IG1hdGNhcDJuZENvbnRyYXN0KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMubWF0Y2FwMm5kQ29udHJhc3QudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBtYXRjYXAybmRDb250cmFzdCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5tYXRjYXAybmRDb250cmFzdC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIFVWIHNjYWxlIGZvciAybmQgTWF0Q2FwIHJlc2FtcGxlICovXG4gIHB1YmxpYyBnZXQgbWF0Y2FwMm5kU2NhbGUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5tYXRjYXAybmRTY2FsZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG1hdGNhcDJuZFNjYWxlKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm1hdGNhcDJuZFNjYWxlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogRXh0cmEgZW1pc3NpdmUgc2NhbGUgKHN0b2NrIGVtaXNzaXZlICogKDErYm9vc3QpKSAqL1xuICBwdWJsaWMgZ2V0IGVtaXNzaW9uQm9vc3QoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5lbWlzc2lvbkJvb3N0LnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgZW1pc3Npb25Cb29zdCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5lbWlzc2lvbkJvb3N0LnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogQ2FtZXJhLWRpc3RhbmNlIHNvZnQgbGlmdC9mYWRlIGFwcHJveCAqL1xuICBwdWJsaWMgZ2V0IGRpc3RhbmNlRmFkZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmRpc3RhbmNlRmFkZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGRpc3RhbmNlRmFkZSh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5kaXN0YW5jZUZhZGUudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBGYWNlIHByZXNldDogc29mdGVyIHByaW1hcnkgc2hhZG93IGJvcmRlciAqL1xuICBwdWJsaWMgZ2V0IGZhY2VTb2Z0KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuZmFjZVNvZnQudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBmYWNlU29mdCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5mYWNlU29mdC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIEFtcGxpZnkgbm9ybWFsTWFwIFhZIGZvciBza2luIGRlcHRoICovXG4gIHB1YmxpYyBnZXQgbm9ybWFsU2tpbkJvb3N0KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMubm9ybWFsU2tpbkJvb3N0LnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgbm9ybWFsU2tpbkJvb3N0KHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm5vcm1hbFNraW5Cb29zdC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIGxpbCBfU2hhZG93RW52U3RyZW5ndGgtbGlrZSBzaGFkZSBsaWZ0ICovXG4gIHB1YmxpYyBnZXQgZW52U3RyZW5ndGgoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5lbnZTdHJlbmd0aC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGVudlN0cmVuZ3RoKHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLmVudlN0cmVuZ3RoLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICAvKiogR2VtLWlzaCBmcmVzbmVsIHByb3h5ICgwIHVubGVzcyBqZXdlbHJ5IGhldXJpc3RpYykgKi9cbiAgcHVibGljIGdldCBnZW1GcmVzbmVsKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMuZ2VtRnJlc25lbC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IGdlbUZyZXNuZWwodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMuZ2VtRnJlc25lbC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIE91dGxpbmUgbGlnaHRpbmcgbWl4IGJpYXMgKHNhZmUgd2l0aCBvdXRsaW5lLW9mZikgKi9cbiAgcHVibGljIGdldCBvdXRsaW5lTWl4KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMub3V0bGluZU1peC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG91dGxpbmVNaXgodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMub3V0bGluZU1peC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIFJlY2VpdmUgc2hhZG93IG1hcCBmYWN0b3I6IDEuMCA9IGZ1bGwgc2hhZG93LCAwLjAgPSBpZ25vcmUgc2hhZG93IG1hcCAoY2xlYW4gYW5pbWUgZmFjZSkgKi9cbiAgcHVibGljIGdldCByZWNlaXZlU2hhZG93UmF0ZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnJlY2VpdmVTaGFkb3dSYXRlLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgcmVjZWl2ZVNoYWRvd1JhdGUodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMucmVjZWl2ZVNoYWRvd1JhdGUudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKiBWZWx2ZXQgLyBmYWJyaWMgZ3JhemluZyBzaGVlbiBzdHJlbmd0aCAobGlsVG9vbiBjbG90aCBmZWVsKSAqL1xuICBwdWJsaWMgZ2V0IGZhYnJpY1NoZWVuU3RyZW5ndGgoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5mYWJyaWNTaGVlblN0cmVuZ3RoLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgZmFicmljU2hlZW5TdHJlbmd0aCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5mYWJyaWNTaGVlblN0cmVuZ3RoLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGZhYnJpY1NoZWVuUG93ZXIoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5mYWJyaWNTaGVlblBvd2VyLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgZmFicmljU2hlZW5Qb3dlcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5mYWJyaWNTaGVlblBvd2VyLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGZhYnJpY1NoZWVuQ29sb3IoKTogVEhSRUUuQ29sb3Ige1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLmZhYnJpY1NoZWVuQ29sb3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBmYWJyaWNTaGVlbkNvbG9yKHZhbHVlOiBUSFJFRS5Db2xvcikge1xuICAgIHRoaXMudW5pZm9ybXMuZmFicmljU2hlZW5Db2xvci52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqIGxpbFRvb24tbGlrZSBGYWtlIFNTUyBwZWFjaCBibG9vZC10aW50IGhhbG8gc3RyZW5ndGggKDAuLjEpICovXG5cbiAgcHVibGljIGdldCBvdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmUoKTogVEhSRUUuVGV4dHVyZSB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZSh2YWx1ZTogVEhSRUUuVGV4dHVyZSB8IG51bGwpIHtcbiAgICB0aGlzLnVuaWZvcm1zLm91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZS52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCBvdXRsaW5lV2lkdGhGYWN0b3IoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy5vdXRsaW5lV2lkdGhGYWN0b3IudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCBvdXRsaW5lV2lkdGhGYWN0b3IodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMub3V0bGluZVdpZHRoRmFjdG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IG91dGxpbmVDb2xvckZhY3RvcigpOiBUSFJFRS5Db2xvciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMub3V0bGluZUNvbG9yRmFjdG9yLnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgb3V0bGluZUNvbG9yRmFjdG9yKHZhbHVlOiBUSFJFRS5Db2xvcikge1xuICAgIHRoaXMudW5pZm9ybXMub3V0bGluZUNvbG9yRmFjdG9yLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IG91dGxpbmVMaWdodGluZ01peEZhY3RvcigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLm91dGxpbmVMaWdodGluZ01peEZhY3Rvci52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IG91dGxpbmVMaWdodGluZ01peEZhY3Rvcih2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy5vdXRsaW5lTGlnaHRpbmdNaXhGYWN0b3IudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgdXZBbmltYXRpb25NYXNrVGV4dHVyZSgpOiBUSFJFRS5UZXh0dXJlIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMudXZBbmltYXRpb25NYXNrVGV4dHVyZS52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHV2QW5pbWF0aW9uTWFza1RleHR1cmUodmFsdWU6IFRIUkVFLlRleHR1cmUgfCBudWxsKSB7XG4gICAgdGhpcy51bmlmb3Jtcy51dkFuaW1hdGlvbk1hc2tUZXh0dXJlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHV2QW5pbWF0aW9uU2Nyb2xsWE9mZnNldCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVuaWZvcm1zLnV2QW5pbWF0aW9uU2Nyb2xsWE9mZnNldC52YWx1ZTtcbiAgfVxuICBwdWJsaWMgc2V0IHV2QW5pbWF0aW9uU2Nyb2xsWE9mZnNldCh2YWx1ZTogbnVtYmVyKSB7XG4gICAgdGhpcy51bmlmb3Jtcy51dkFuaW1hdGlvblNjcm9sbFhPZmZzZXQudmFsdWUgPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgdXZBbmltYXRpb25TY3JvbGxZT2Zmc2V0KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudW5pZm9ybXMudXZBbmltYXRpb25TY3JvbGxZT2Zmc2V0LnZhbHVlO1xuICB9XG4gIHB1YmxpYyBzZXQgdXZBbmltYXRpb25TY3JvbGxZT2Zmc2V0KHZhbHVlOiBudW1iZXIpIHtcbiAgICB0aGlzLnVuaWZvcm1zLnV2QW5pbWF0aW9uU2Nyb2xsWU9mZnNldC52YWx1ZSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGdldCB1dkFuaW1hdGlvblJvdGF0aW9uUGhhc2UoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy51bmlmb3Jtcy51dkFuaW1hdGlvblJvdGF0aW9uUGhhc2UudmFsdWU7XG4gIH1cbiAgcHVibGljIHNldCB1dkFuaW1hdGlvblJvdGF0aW9uUGhhc2UodmFsdWU6IG51bWJlcikge1xuICAgIHRoaXMudW5pZm9ybXMudXZBbmltYXRpb25Sb3RhdGlvblBoYXNlLnZhbHVlID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgdXZBbmltYXRpb25TY3JvbGxYU3BlZWRGYWN0b3IgPSAwLjA7XG4gIHB1YmxpYyB1dkFuaW1hdGlvblNjcm9sbFlTcGVlZEZhY3RvciA9IDAuMDtcbiAgcHVibGljIHV2QW5pbWF0aW9uUm90YXRpb25TcGVlZEZhY3RvciA9IDAuMDtcblxuICAvKipcbiAgICogV2hldGhlciB0aGUgbWF0ZXJpYWwgaXMgYWZmZWN0ZWQgYnkgZm9nLlxuICAgKiBgdHJ1ZWAgYnkgZGVmYXVsdC5cbiAgICovXG4gIHB1YmxpYyBmb2cgPSB0cnVlO1xuXG4gIC8qKlxuICAgKiBXaWxsIGJlIHJlYWQgaW4gV2ViR0xQcm9ncmFtc1xuICAgKlxuICAgKiBTZWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9tcmRvb2IvdGhyZWUuanMvYmxvYi80ZjUyMzZhYzNkNmY0MWQ5MDRhYTU4NDAxYjQwNTU0ZThmYmRjYjE1L3NyYy9yZW5kZXJlcnMvd2ViZ2wvV2ViR0xQcm9ncmFtcy5qcyNMMTkwLUwxOTFcbiAgICovXG4gIHB1YmxpYyBub3JtYWxNYXBUeXBlID0gVEhSRUUuVGFuZ2VudFNwYWNlTm9ybWFsTWFwO1xuXG4gIC8qKlxuICAgKiBXaGVuIHRoaXMgaXMgYHRydWVgLCB2ZXJ0ZXggY29sb3JzIHdpbGwgYmUgaWdub3JlZC5cbiAgICogYHRydWVgIGJ5IGRlZmF1bHQuXG4gICAqL1xuICBwcml2YXRlIF9pZ25vcmVWZXJ0ZXhDb2xvciA9IHRydWU7XG5cbiAgLyoqXG4gICAqIFdoZW4gdGhpcyBpcyBgdHJ1ZWAsIHZlcnRleCBjb2xvcnMgd2lsbCBiZSBpZ25vcmVkLlxuICAgKiBgdHJ1ZWAgYnkgZGVmYXVsdC5cbiAgICovXG4gIHB1YmxpYyBnZXQgaWdub3JlVmVydGV4Q29sb3IoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuX2lnbm9yZVZlcnRleENvbG9yO1xuICB9XG4gIHB1YmxpYyBzZXQgaWdub3JlVmVydGV4Q29sb3IodmFsdWU6IGJvb2xlYW4pIHtcbiAgICB0aGlzLl9pZ25vcmVWZXJ0ZXhDb2xvciA9IHZhbHVlO1xuXG4gICAgdGhpcy5uZWVkc1VwZGF0ZSA9IHRydWU7XG4gIH1cblxuICBwcml2YXRlIF92MENvbXBhdFNoYWRlID0gZmFsc2U7XG5cbiAgLyoqXG4gICAqIFRoZXJlIGlzIGEgbGluZSBvZiB0aGUgc2hhZGVyIGNhbGxlZCBcImNvbW1lbnQgb3V0IGlmIHlvdSB3YW50IHRvIFBCUiBhYnNvbHV0ZWx5XCIgaW4gVlJNMC4wIE1Ub29uLlxuICAgKiBXaGVuIHRoaXMgaXMgdHJ1ZSwgdGhlIG1hdGVyaWFsIGVuYWJsZXMgdGhlIGxpbmUgdG8gbWFrZSBpdCBjb21wYXRpYmxlIHdpdGggdGhlIGxlZ2FjeSByZW5kZXJpbmcgb2YgVlJNLlxuICAgKiBVc3VhbGx5IG5vdCByZWNvbW1lbmRlZCB0byB0dXJuIHRoaXMgb24uXG4gICAqIGBmYWxzZWAgYnkgZGVmYXVsdC5cbiAgICovXG4gIGdldCB2MENvbXBhdFNoYWRlKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLl92MENvbXBhdFNoYWRlO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZXJlIGlzIGEgbGluZSBvZiB0aGUgc2hhZGVyIGNhbGxlZCBcImNvbW1lbnQgb3V0IGlmIHlvdSB3YW50IHRvIFBCUiBhYnNvbHV0ZWx5XCIgaW4gVlJNMC4wIE1Ub29uLlxuICAgKiBXaGVuIHRoaXMgaXMgdHJ1ZSwgdGhlIG1hdGVyaWFsIGVuYWJsZXMgdGhlIGxpbmUgdG8gbWFrZSBpdCBjb21wYXRpYmxlIHdpdGggdGhlIGxlZ2FjeSByZW5kZXJpbmcgb2YgVlJNLlxuICAgKiBVc3VhbGx5IG5vdCByZWNvbW1lbmRlZCB0byB0dXJuIHRoaXMgb24uXG4gICAqIGBmYWxzZWAgYnkgZGVmYXVsdC5cbiAgICovXG4gIHNldCB2MENvbXBhdFNoYWRlKHY6IGJvb2xlYW4pIHtcbiAgICB0aGlzLl92MENvbXBhdFNoYWRlID0gdjtcblxuICAgIHRoaXMubmVlZHNVcGRhdGUgPSB0cnVlO1xuICB9XG5cbiAgcHJpdmF0ZSBfZGVidWdNb2RlOiBNVG9vbk1hdGVyaWFsRGVidWdNb2RlID0gTVRvb25NYXRlcmlhbERlYnVnTW9kZS5Ob25lO1xuXG4gIC8qKlxuICAgKiBEZWJ1ZyBtb2RlIGZvciB0aGUgbWF0ZXJpYWwuXG4gICAqIFlvdSBjYW4gdmlzdWFsaXplIHNldmVyYWwgY29tcG9uZW50cyBmb3IgZGlhZ25vc2lzIHVzaW5nIGRlYnVnIG1vZGUuXG4gICAqXG4gICAqIFNlZToge0BsaW5rIE1Ub29uTWF0ZXJpYWxEZWJ1Z01vZGV9XG4gICAqL1xuICBnZXQgZGVidWdNb2RlKCk6IE1Ub29uTWF0ZXJpYWxEZWJ1Z01vZGUge1xuICAgIHJldHVybiB0aGlzLl9kZWJ1Z01vZGU7XG4gIH1cblxuICAvKipcbiAgICogRGVidWcgbW9kZSBmb3IgdGhlIG1hdGVyaWFsLlxuICAgKiBZb3UgY2FuIHZpc3VhbGl6ZSBzZXZlcmFsIGNvbXBvbmVudHMgZm9yIGRpYWdub3NpcyB1c2luZyBkZWJ1ZyBtb2RlLlxuICAgKlxuICAgKiBTZWU6IHtAbGluayBNVG9vbk1hdGVyaWFsRGVidWdNb2RlfVxuICAgKi9cbiAgc2V0IGRlYnVnTW9kZShtOiBNVG9vbk1hdGVyaWFsRGVidWdNb2RlKSB7XG4gICAgdGhpcy5fZGVidWdNb2RlID0gbTtcblxuICAgIHRoaXMubmVlZHNVcGRhdGUgPSB0cnVlO1xuICB9XG5cbiAgcHJpdmF0ZSBfb3V0bGluZVdpZHRoTW9kZTogTVRvb25NYXRlcmlhbE91dGxpbmVXaWR0aE1vZGUgPSBNVG9vbk1hdGVyaWFsT3V0bGluZVdpZHRoTW9kZS5Ob25lO1xuXG4gIGdldCBvdXRsaW5lV2lkdGhNb2RlKCk6IE1Ub29uTWF0ZXJpYWxPdXRsaW5lV2lkdGhNb2RlIHtcbiAgICByZXR1cm4gdGhpcy5fb3V0bGluZVdpZHRoTW9kZTtcbiAgfVxuICBzZXQgb3V0bGluZVdpZHRoTW9kZShtOiBNVG9vbk1hdGVyaWFsT3V0bGluZVdpZHRoTW9kZSkge1xuICAgIHRoaXMuX291dGxpbmVXaWR0aE1vZGUgPSBtO1xuXG4gICAgdGhpcy5uZWVkc1VwZGF0ZSA9IHRydWU7XG4gIH1cblxuICBwcml2YXRlIF9pc091dGxpbmUgPSBmYWxzZTtcblxuICBnZXQgaXNPdXRsaW5lKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLl9pc091dGxpbmU7XG4gIH1cbiAgc2V0IGlzT3V0bGluZShiOiBib29sZWFuKSB7XG4gICAgdGhpcy5faXNPdXRsaW5lID0gYjtcblxuICAgIHRoaXMubmVlZHNVcGRhdGUgPSB0cnVlO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRvbmx5IGJvb2xlYW4gdGhhdCBpbmRpY2F0ZXMgdGhpcyBpcyBhIHtAbGluayBNVG9vbk1hdGVyaWFsfS5cbiAgICovXG4gIHB1YmxpYyBnZXQgaXNNVG9vbk1hdGVyaWFsKCk6IHRydWUge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgY29uc3RydWN0b3IocGFyYW1ldGVyczogTVRvb25NYXRlcmlhbFBhcmFtZXRlcnMgPSB7fSkge1xuICAgIHN1cGVyKHsgdmVydGV4U2hhZGVyLCBmcmFnbWVudFNoYWRlciB9KTtcblxuICAgIC8vIG92ZXJyaWRlIGRlcHRoV3JpdGUgd2l0aCB0cmFuc3BhcmVudFdpdGhaV3JpdGVcbiAgICBpZiAocGFyYW1ldGVycy50cmFuc3BhcmVudFdpdGhaV3JpdGUpIHtcbiAgICAgIHBhcmFtZXRlcnMuZGVwdGhXcml0ZSA9IHRydWU7XG4gICAgfVxuICAgIGRlbGV0ZSBwYXJhbWV0ZXJzLnRyYW5zcGFyZW50V2l0aFpXcml0ZTtcblxuICAgIC8vID09IGVuYWJsaW5nIGJ1bmNoIG9mIHN0dWZmID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIHBhcmFtZXRlcnMuZm9nID0gdHJ1ZTtcbiAgICBwYXJhbWV0ZXJzLmxpZ2h0cyA9IHRydWU7XG4gICAgcGFyYW1ldGVycy5jbGlwcGluZyA9IHRydWU7XG5cbiAgICAvLyA9PSB1bmlmb3JtcyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICB0aGlzLnVuaWZvcm1zID0gVEhSRUUuVW5pZm9ybXNVdGlscy5tZXJnZShbXG4gICAgICBUSFJFRS5Vbmlmb3Jtc0xpYi5jb21tb24sIC8vIG1hcFxuICAgICAgVEhSRUUuVW5pZm9ybXNMaWIubm9ybWFsbWFwLCAvLyBub3JtYWxNYXBcbiAgICAgIFRIUkVFLlVuaWZvcm1zTGliLmVtaXNzaXZlbWFwLCAvLyBlbWlzc2l2ZU1hcFxuICAgICAgVEhSRUUuVW5pZm9ybXNMaWIuZm9nLFxuICAgICAgVEhSRUUuVW5pZm9ybXNMaWIubGlnaHRzLFxuICAgICAge1xuICAgICAgICBsaXRGYWN0b3I6IHsgdmFsdWU6IG5ldyBUSFJFRS5Db2xvcigxLjAsIDEuMCwgMS4wKSB9LFxuICAgICAgICBtYXBVdlRyYW5zZm9ybTogeyB2YWx1ZTogbmV3IFRIUkVFLk1hdHJpeDMoKSB9LFxuICAgICAgICBjb2xvckFscGhhOiB7IHZhbHVlOiAxLjAgfSxcbiAgICAgICAgbm9ybWFsTWFwVXZUcmFuc2Zvcm06IHsgdmFsdWU6IG5ldyBUSFJFRS5NYXRyaXgzKCkgfSxcbiAgICAgICAgc2hhZGVDb2xvckZhY3RvcjogeyB2YWx1ZTogbmV3IFRIUkVFLkNvbG9yKDAuMCwgMC4wLCAwLjApIH0sXG4gICAgICAgIHNoYWRlTXVsdGlwbHlUZXh0dXJlOiB7IHZhbHVlOiBudWxsIH0sXG4gICAgICAgIHNoYWRlTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm06IHsgdmFsdWU6IG5ldyBUSFJFRS5NYXRyaXgzKCkgfSxcbiAgICAgICAgc2hhZGluZ1NoaWZ0RmFjdG9yOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgc2hhZGluZ1NoaWZ0VGV4dHVyZTogeyB2YWx1ZTogbnVsbCB9LFxuICAgICAgICBzaGFkaW5nU2hpZnRUZXh0dXJlVXZUcmFuc2Zvcm06IHsgdmFsdWU6IG5ldyBUSFJFRS5NYXRyaXgzKCkgfSxcbiAgICAgICAgc2hhZGluZ1NoaWZ0VGV4dHVyZVNjYWxlOiB7IHZhbHVlOiAxLjAgfSxcbiAgICAgICAgc2hhZGluZ1Rvb255RmFjdG9yOiB7IHZhbHVlOiAwLjkgfSxcbiAgICAgICAgZ2lFcXVhbGl6YXRpb25GYWN0b3I6IHsgdmFsdWU6IDAuOSB9LFxuICAgICAgICBtYXRjYXBGYWN0b3I6IHsgdmFsdWU6IG5ldyBUSFJFRS5Db2xvcigxLjAsIDEuMCwgMS4wKSB9LFxuICAgICAgICBtYXRjYXBUZXh0dXJlOiB7IHZhbHVlOiBudWxsIH0sXG4gICAgICAgIG1hdGNhcFRleHR1cmVVdlRyYW5zZm9ybTogeyB2YWx1ZTogbmV3IFRIUkVFLk1hdHJpeDMoKSB9LFxuICAgICAgICBwYXJhbWV0cmljUmltQ29sb3JGYWN0b3I6IHsgdmFsdWU6IG5ldyBUSFJFRS5Db2xvcigwLjAsIDAuMCwgMC4wKSB9LFxuICAgICAgICByaW1NdWx0aXBseVRleHR1cmU6IHsgdmFsdWU6IG51bGwgfSxcbiAgICAgICAgcmltTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm06IHsgdmFsdWU6IG5ldyBUSFJFRS5NYXRyaXgzKCkgfSxcbiAgICAgICAgcmltTGlnaHRpbmdNaXhGYWN0b3I6IHsgdmFsdWU6IDEuMCB9LFxuICAgICAgICBwYXJhbWV0cmljUmltRnJlc25lbFBvd2VyRmFjdG9yOiB7IHZhbHVlOiA1LjAgfSxcbiAgICAgICAgcGFyYW1ldHJpY1JpbUxpZnRGYWN0b3I6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBlbWlzc2l2ZTogeyB2YWx1ZTogbmV3IFRIUkVFLkNvbG9yKDAuMCwgMC4wLCAwLjApIH0sXG4gICAgICAgIGVtaXNzaXZlSW50ZW5zaXR5OiB7IHZhbHVlOiAxLjAgfSxcbiAgICAgICAgZW1pc3NpdmVNYXBVdlRyYW5zZm9ybTogeyB2YWx1ZTogbmV3IFRIUkVFLk1hdHJpeDMoKSB9LFxuICAgICAgICBvdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmU6IHsgdmFsdWU6IG51bGwgfSxcbiAgICAgICAgb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm06IHsgdmFsdWU6IG5ldyBUSFJFRS5NYXRyaXgzKCkgfSxcbiAgICAgICAgb3V0bGluZVdpZHRoRmFjdG9yOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgb3V0bGluZUNvbG9yRmFjdG9yOiB7IHZhbHVlOiBuZXcgVEhSRUUuQ29sb3IoMC4wLCAwLjAsIDAuMCkgfSxcbiAgICAgICAgb3V0bGluZUxpZ2h0aW5nTWl4RmFjdG9yOiB7IHZhbHVlOiAxLjAgfSxcbiAgICAgICAgdXZBbmltYXRpb25NYXNrVGV4dHVyZTogeyB2YWx1ZTogbnVsbCB9LFxuICAgICAgICB1dkFuaW1hdGlvbk1hc2tUZXh0dXJlVXZUcmFuc2Zvcm06IHsgdmFsdWU6IG5ldyBUSFJFRS5NYXRyaXgzKCkgfSxcbiAgICAgICAgdXZBbmltYXRpb25TY3JvbGxYT2Zmc2V0OiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgdXZBbmltYXRpb25TY3JvbGxZT2Zmc2V0OiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgdXZBbmltYXRpb25Sb3RhdGlvblBoYXNlOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgLy8gRXh0ZW5kZWQgTVRvb24gdHVuaW5nIHBhcmFtZXRlcnMgKGRlZmF1bHQgb2ZmID0gY2xhc3NpYyBNVG9vbiBiZWhhdmlvcilcbiAgICAgICAgc29mdE1peDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIGJsdXJCb29zdDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHNoYWRvdzJuZFN0cmVuZ3RoOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgc2hhZG93Mm5kQm9yZGVyOiB7IHZhbHVlOiAwLjMyIH0sXG4gICAgICAgIHNoYWRvdzJuZEJsdXI6IHsgdmFsdWU6IDAuMjIgfSxcbiAgICAgICAgc2hhZG93Mm5kQ29sb3I6IHsgdmFsdWU6IG5ldyBUSFJFRS5Db2xvcigwLjY4LCAwLjYyLCAwLjc4KSB9LFxuICAgICAgICBzaGFkb3czcmRTdHJlbmd0aDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHNoYWRvdzNyZEJvcmRlcjogeyB2YWx1ZTogMC4xNCB9LFxuICAgICAgICBzaGFkb3czcmRCbHVyOiB7IHZhbHVlOiAwLjIgfSxcbiAgICAgICAgc2hhZG93M3JkQ29sb3I6IHsgdmFsdWU6IG5ldyBUSFJFRS5Db2xvcigwLjUyLCAwLjQ4LCAwLjYwKSB9LFxuICAgICAgICByaW1Cb29zdDogeyB2YWx1ZTogMS4wIH0sXG4gICAgICAgIHJpbUJvcmRlcjogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHJpbUJsdXI6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICByaW1EaXJTdHJlbmd0aDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIGhhaXJTcGVjU3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBoYWlyU3BlY1Bvd2VyOiB7IHZhbHVlOiA1Ni4wIH0sXG4gICAgICAgIGhhaXJTcGVjU2hpZnQ6IHsgdmFsdWU6IC0wLjEgfSxcbiAgICAgICAgY2xvdGhTcGVjU3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBjbG90aFNwZWNQb3dlcjogeyB2YWx1ZTogNzIuMCB9LFxuICAgICAgICBtYXRjYXAybmRTdHJlbmd0aDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHNraW5TcGVjU3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBza2luU3BlY1Bvd2VyOiB7IHZhbHVlOiAyOC4wIH0sXG4gICAgICAgIHNraW5TcGVjRnJlc25lbDogeyB2YWx1ZTogMC40NSB9LFxuICAgICAgICBza2luU3BlY0NvbG9yOiB7IHZhbHVlOiBuZXcgVEhSRUUuQ29sb3IoMS4wLCAwLjk2LCAwLjk0KSB9LFxuICAgICAgICBhbWJpZW50TGlmdDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHNoYWRlTWFpblN0cmVuZ3RoOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgc2hhZG93Qm9yZGVyOiB7IHZhbHVlOiAtMS4wIH0sXG4gICAgICAgIHNoYWRvd0JsdXI6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICByaW1NYWluU3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICByaW1TaGFkb3dNYXNrOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgc3BlY3VsYXJTdHJlbmd0aDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIHNwZWN1bGFyUG93ZXI6IHsgdmFsdWU6IDQ4LjAgfSxcbiAgICAgICAgc3BlY3VsYXJCb3JkZXI6IHsgdmFsdWU6IDAuNSB9LFxuICAgICAgICBzcGVjdWxhckJsdXI6IHsgdmFsdWU6IDAuMSB9LFxuICAgICAgICByZWZsZWN0U3RyZW5ndGg6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICByZWZsZWN0RnJlc25lbDogeyB2YWx1ZTogMC41NSB9LFxuICAgICAgICByZWZsZWN0TWV0YWxsaWM6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICByZWZsZWN0U21vb3RobmVzczogeyB2YWx1ZTogMC41NSB9LFxuICAgICAgICBiYWNrbGlnaHRTdHJlbmd0aDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIGJhY2tsaWdodENvbG9yOiB7IHZhbHVlOiBuZXcgVEhSRUUuQ29sb3IoMS4wLCAwLjg1LCAwLjc1KSB9LFxuICAgICAgICByaW1GcmVzbmVsUG93ZXI6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICByaW1JbmRpclN0cmVuZ3RoOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgbWF0Y2FwMm5kQ29udHJhc3Q6IHsgdmFsdWU6IDEuMjUgfSxcbiAgICAgICAgbWF0Y2FwMm5kU2NhbGU6IHsgdmFsdWU6IDEuMCB9LFxuICAgICAgICBlbWlzc2lvbkJvb3N0OiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgZGlzdGFuY2VGYWRlOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgZmFjZVNvZnQ6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBub3JtYWxTa2luQm9vc3Q6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBlbnZTdHJlbmd0aDogeyB2YWx1ZTogMC4wIH0sXG4gICAgICAgIGdlbUZyZXNuZWw6IHsgdmFsdWU6IDAuMCB9LFxuICAgICAgICBvdXRsaW5lTWl4OiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgcmVjZWl2ZVNoYWRvd1JhdGU6IHsgdmFsdWU6IDEuMCB9LFxuICAgICAgICBmYWJyaWNTaGVlblN0cmVuZ3RoOiB7IHZhbHVlOiAwLjAgfSxcbiAgICAgICAgZmFicmljU2hlZW5Qb3dlcjogeyB2YWx1ZTogMy41IH0sXG4gICAgICAgIGZhYnJpY1NoZWVuQ29sb3I6IHsgdmFsdWU6IG5ldyBUSFJFRS5Db2xvcigweGZmZThkZikgfSxcbiAgICAgIH0sXG4gICAgICBwYXJhbWV0ZXJzLnVuaWZvcm1zID8/IHt9LFxuICAgIF0pIGFzIHR5cGVvZiBNVG9vbk1hdGVyaWFsLnByb3RvdHlwZS51bmlmb3JtcztcblxuICAgIC8vID09IGZpbmFsbHkgY29tcGlsZSB0aGUgc2hhZGVyIHByb2dyYW0gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIHRoaXMuc2V0VmFsdWVzKHBhcmFtZXRlcnMpO1xuXG4gICAgLy8gPT0gdXBsb2FkIHVuaWZvcm1zIHRoYXQgbmVlZCB0byB1cGxvYWQgPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgdGhpcy5fdXBsb2FkVW5pZm9ybXNXb3JrYXJvdW5kKCk7XG5cbiAgICAvLyA9PSB1cGRhdGUgc2hhZGVyIHN0dWZmID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICB0aGlzLmN1c3RvbVByb2dyYW1DYWNoZUtleSA9ICgpID0+XG4gICAgICBbXG4gICAgICAgIC4uLk9iamVjdC5lbnRyaWVzKHRoaXMuX2dlbmVyYXRlRGVmaW5lcygpKS5tYXAoKFt0b2tlbiwgbWFjcm9dKSA9PiBgJHt0b2tlbn06JHttYWNyb31gKSxcbiAgICAgICAgdGhpcy5tYXRjYXBUZXh0dXJlID8gYG1hdGNhcFRleHR1cmVDb2xvclNwYWNlOiR7Z2V0VGV4dHVyZUNvbG9yU3BhY2UodGhpcy5tYXRjYXBUZXh0dXJlKX1gIDogJycsXG4gICAgICAgIHRoaXMuc2hhZGVNdWx0aXBseVRleHR1cmVcbiAgICAgICAgICA/IGBzaGFkZU11bHRpcGx5VGV4dHVyZUNvbG9yU3BhY2U6JHtnZXRUZXh0dXJlQ29sb3JTcGFjZSh0aGlzLnNoYWRlTXVsdGlwbHlUZXh0dXJlKX1gXG4gICAgICAgICAgOiAnJyxcbiAgICAgICAgdGhpcy5yaW1NdWx0aXBseVRleHR1cmUgPyBgcmltTXVsdGlwbHlUZXh0dXJlQ29sb3JTcGFjZToke2dldFRleHR1cmVDb2xvclNwYWNlKHRoaXMucmltTXVsdGlwbHlUZXh0dXJlKX1gIDogJycsXG4gICAgICBdLmpvaW4oJywnKTtcblxuICAgIHRoaXMub25CZWZvcmVDb21waWxlID0gKHNoYWRlcikgPT4ge1xuICAgICAgY29uc3QgdGhyZWVSZXZpc2lvbiA9IHBhcnNlSW50KFRIUkVFLlJFVklTSU9OLCAxMCk7XG5cbiAgICAgIGNvbnN0IGRlZmluZXMgPVxuICAgICAgICBPYmplY3QuZW50cmllcyh7IC4uLnRoaXMuX2dlbmVyYXRlRGVmaW5lcygpLCAuLi50aGlzLmRlZmluZXMgfSlcbiAgICAgICAgICAuZmlsdGVyKChbdG9rZW4sIG1hY3JvXSkgPT4gISFtYWNybylcbiAgICAgICAgICAubWFwKChbdG9rZW4sIG1hY3JvXSkgPT4gYCNkZWZpbmUgJHt0b2tlbn0gJHttYWNyb31gKVxuICAgICAgICAgIC5qb2luKCdcXG4nKSArICdcXG4nO1xuXG4gICAgICAvLyAtLSBnZW5lcmF0ZSBzaGFkZXIgY29kZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgICBzaGFkZXIudmVydGV4U2hhZGVyID0gZGVmaW5lcyArIHNoYWRlci52ZXJ0ZXhTaGFkZXI7XG4gICAgICBzaGFkZXIuZnJhZ21lbnRTaGFkZXIgPSBkZWZpbmVzICsgc2hhZGVyLmZyYWdtZW50U2hhZGVyO1xuXG4gICAgICAvLyAtLSBjb21wYXQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgICAgIC8vIENPTVBBVDogcHJlLXIxNTRcbiAgICAgIC8vIFRocmVlLmpzIHIxNTQgcmVuYW1lcyB0aGUgc2hhZGVyIGNodW5rIDxjb2xvcnNwYWNlX2ZyYWdtZW50PiB0byA8ZW5jb2RpbmdzX2ZyYWdtZW50PlxuICAgICAgaWYgKHRocmVlUmV2aXNpb24gPCAxNTQpIHtcbiAgICAgICAgc2hhZGVyLmZyYWdtZW50U2hhZGVyID0gc2hhZGVyLmZyYWdtZW50U2hhZGVyLnJlcGxhY2UoXG4gICAgICAgICAgJyNpbmNsdWRlIDxjb2xvcnNwYWNlX2ZyYWdtZW50PicsXG4gICAgICAgICAgJyNpbmNsdWRlIDxlbmNvZGluZ3NfZnJhZ21lbnQ+JyxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSB0aGlzIG1hdGVyaWFsLlxuICAgKlxuICAgKiBAcGFyYW0gZGVsdGEgZGVsdGFUaW1lIHNpbmNlIGxhc3QgdXBkYXRlXG4gICAqL1xuICBwdWJsaWMgdXBkYXRlKGRlbHRhOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLl91cGxvYWRVbmlmb3Jtc1dvcmthcm91bmQoKTtcbiAgICB0aGlzLl91cGRhdGVVVkFuaW1hdGlvbihkZWx0YSk7XG4gIH1cblxuICBwdWJsaWMgY29weShzb3VyY2U6IHRoaXMpOiB0aGlzIHtcbiAgICBzdXBlci5jb3B5KHNvdXJjZSk7XG4gICAgLy8gdW5pZm9ybXMgYXJlIGFscmVhZHkgY29waWVkIGF0IHRoaXMgbW9tZW50XG5cbiAgICAvLyBCZWdpbm5pbmcgZnJvbSByMTMzLCB1bmlmb3JtIHRleHR1cmVzIHdpbGwgYmUgY2xvbmVkIGluc3RlYWQgb2YgcmVmZXJlbmNlXG4gICAgLy8gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vbXJkb29iL3RocmVlLmpzL2Jsb2IvYTg4MTNiZTA0YTg0OWJkMTU1ZjdjZjZmMWIyM2Q4ZWUyZTBmYjQ4Yi9leGFtcGxlcy9qc20vbG9hZGVycy9HTFRGTG9hZGVyLmpzI0wzMDQ3XG4gICAgLy8gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vbXJkb29iL3RocmVlLmpzL2Jsb2IvYTg4MTNiZTA0YTg0OWJkMTU1ZjdjZjZmMWIyM2Q4ZWUyZTBmYjQ4Yi9zcmMvcmVuZGVyZXJzL3NoYWRlcnMvVW5pZm9ybXNVdGlscy5qcyNMMjJcbiAgICAvLyBUaGlzIHdpbGwgbGVhdmUgdGhlaXIgYC52ZXJzaW9uYCB0byBiZSBgMGBcbiAgICAvLyBhbmQgdGhlc2UgdGV4dHVyZXMgd29uJ3QgYmUgdXBsb2FkZWQgdG8gR1BVXG4gICAgLy8gV2UgYXJlIGdvaW5nIHRvIHdvcmthcm91bmQgdGhpcyBpbiBoZXJlXG4gICAgLy8gSSd2ZSBvcGVuZWQgYW4gaXNzdWUgZm9yIHRoaXM6IGh0dHBzOi8vZ2l0aHViLmNvbS9tcmRvb2IvdGhyZWUuanMvaXNzdWVzLzIyNzE4XG4gICAgdGhpcy5tYXAgPSBzb3VyY2UubWFwO1xuICAgIHRoaXMubm9ybWFsTWFwID0gc291cmNlLm5vcm1hbE1hcDtcbiAgICB0aGlzLmVtaXNzaXZlTWFwID0gc291cmNlLmVtaXNzaXZlTWFwO1xuICAgIHRoaXMuc2hhZGVNdWx0aXBseVRleHR1cmUgPSBzb3VyY2Uuc2hhZGVNdWx0aXBseVRleHR1cmU7XG4gICAgdGhpcy5zaGFkaW5nU2hpZnRUZXh0dXJlID0gc291cmNlLnNoYWRpbmdTaGlmdFRleHR1cmU7XG4gICAgdGhpcy5tYXRjYXBUZXh0dXJlID0gc291cmNlLm1hdGNhcFRleHR1cmU7XG4gICAgdGhpcy5yaW1NdWx0aXBseVRleHR1cmUgPSBzb3VyY2UucmltTXVsdGlwbHlUZXh0dXJlO1xuICAgIHRoaXMub3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlID0gc291cmNlLm91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZTtcbiAgICB0aGlzLnV2QW5pbWF0aW9uTWFza1RleHR1cmUgPSBzb3VyY2UudXZBbmltYXRpb25NYXNrVGV4dHVyZTtcblxuICAgIC8vID09IGNvcHkgbWVtYmVycyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIHRoaXMubm9ybWFsTWFwVHlwZSA9IHNvdXJjZS5ub3JtYWxNYXBUeXBlO1xuXG4gICAgdGhpcy51dkFuaW1hdGlvblNjcm9sbFhTcGVlZEZhY3RvciA9IHNvdXJjZS51dkFuaW1hdGlvblNjcm9sbFhTcGVlZEZhY3RvcjtcbiAgICB0aGlzLnV2QW5pbWF0aW9uU2Nyb2xsWVNwZWVkRmFjdG9yID0gc291cmNlLnV2QW5pbWF0aW9uU2Nyb2xsWVNwZWVkRmFjdG9yO1xuICAgIHRoaXMudXZBbmltYXRpb25Sb3RhdGlvblNwZWVkRmFjdG9yID0gc291cmNlLnV2QW5pbWF0aW9uUm90YXRpb25TcGVlZEZhY3RvcjtcblxuICAgIHRoaXMuaWdub3JlVmVydGV4Q29sb3IgPSBzb3VyY2UuaWdub3JlVmVydGV4Q29sb3I7XG5cbiAgICB0aGlzLnYwQ29tcGF0U2hhZGUgPSBzb3VyY2UudjBDb21wYXRTaGFkZTtcbiAgICB0aGlzLmRlYnVnTW9kZSA9IHNvdXJjZS5kZWJ1Z01vZGU7XG4gICAgdGhpcy5vdXRsaW5lV2lkdGhNb2RlID0gc291cmNlLm91dGxpbmVXaWR0aE1vZGU7XG5cbiAgICB0aGlzLmlzT3V0bGluZSA9IHNvdXJjZS5pc091dGxpbmU7XG5cbiAgICAvLyA9PSB1cGRhdGUgc2hhZGVyIHN0dWZmID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICB0aGlzLm5lZWRzVXBkYXRlID0gdHJ1ZTtcblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBVViBhbmltYXRpb24gc3RhdGUuXG4gICAqIEludGVuZGVkIHRvIGJlIGNhbGxlZCB2aWEge0BsaW5rIHVwZGF0ZX0uXG4gICAqIEBwYXJhbSBkZWx0YSBkZWx0YVRpbWVcbiAgICovXG4gIHByaXZhdGUgX3VwZGF0ZVVWQW5pbWF0aW9uKGRlbHRhOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLnVuaWZvcm1zLnV2QW5pbWF0aW9uU2Nyb2xsWE9mZnNldC52YWx1ZSArPSBkZWx0YSAqIHRoaXMudXZBbmltYXRpb25TY3JvbGxYU3BlZWRGYWN0b3I7XG4gICAgdGhpcy51bmlmb3Jtcy51dkFuaW1hdGlvblNjcm9sbFlPZmZzZXQudmFsdWUgKz0gZGVsdGEgKiB0aGlzLnV2QW5pbWF0aW9uU2Nyb2xsWVNwZWVkRmFjdG9yO1xuICAgIHRoaXMudW5pZm9ybXMudXZBbmltYXRpb25Sb3RhdGlvblBoYXNlLnZhbHVlICs9IGRlbHRhICogdGhpcy51dkFuaW1hdGlvblJvdGF0aW9uU3BlZWRGYWN0b3I7XG4gICAgdGhpcy51bmlmb3Jtcy5hbHBoYVRlc3QudmFsdWUgPSB0aGlzLmFscGhhVGVzdDtcblxuICAgIHRoaXMudW5pZm9ybXNOZWVkVXBkYXRlID0gdHJ1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGxvYWQgdW5pZm9ybXMgdGhhdCBuZWVkIHRvIHVwbG9hZCBidXQgZG9lc24ndCBhdXRvbWF0aWNhbGx5IGJlY2F1c2Ugb2YgcmVhc29ucy5cbiAgICogSW50ZW5kZWQgdG8gYmUgY2FsbGVkIHZpYSB7QGxpbmsgY29uc3RydWN0b3J9IGFuZCB7QGxpbmsgdXBkYXRlfS5cbiAgICovXG4gIHByaXZhdGUgX3VwbG9hZFVuaWZvcm1zV29ya2Fyb3VuZCgpOiB2b2lkIHtcbiAgICAvLyB3b3JrYXJvdW5kOiBzaW5jZSBvcGFjaXR5IGlzIGRlZmluZWQgYXMgYSBwcm9wZXJ0eSBpbiBUSFJFRS5NYXRlcmlhbFxuICAgIC8vIGFuZCBjYW5ub3QgYmUgb3ZlcnJpZGRlbiBhcyBhbiBhY2Nlc3NvcixcbiAgICAvLyBXZSBhcmUgZ29pbmcgdG8gdXBkYXRlIG9wYWNpdHkgaGVyZVxuICAgIHRoaXMudW5pZm9ybXMub3BhY2l0eS52YWx1ZSA9IHRoaXMub3BhY2l0eTtcblxuICAgIC8vIHdvcmthcm91bmQ6IHRleHR1cmUgdHJhbnNmb3JtcyBhcmUgbm90IHVwZGF0ZWQgYXV0b21hdGljYWxseVxuICAgIHRoaXMuX3VwZGF0ZVRleHR1cmVNYXRyaXgodGhpcy51bmlmb3Jtcy5tYXAsIHRoaXMudW5pZm9ybXMubWFwVXZUcmFuc2Zvcm0pO1xuICAgIHRoaXMuX3VwZGF0ZVRleHR1cmVNYXRyaXgodGhpcy51bmlmb3Jtcy5ub3JtYWxNYXAsIHRoaXMudW5pZm9ybXMubm9ybWFsTWFwVXZUcmFuc2Zvcm0pO1xuICAgIHRoaXMuX3VwZGF0ZVRleHR1cmVNYXRyaXgodGhpcy51bmlmb3Jtcy5lbWlzc2l2ZU1hcCwgdGhpcy51bmlmb3Jtcy5lbWlzc2l2ZU1hcFV2VHJhbnNmb3JtKTtcbiAgICB0aGlzLl91cGRhdGVUZXh0dXJlTWF0cml4KHRoaXMudW5pZm9ybXMuc2hhZGVNdWx0aXBseVRleHR1cmUsIHRoaXMudW5pZm9ybXMuc2hhZGVNdWx0aXBseVRleHR1cmVVdlRyYW5zZm9ybSk7XG4gICAgdGhpcy5fdXBkYXRlVGV4dHVyZU1hdHJpeCh0aGlzLnVuaWZvcm1zLnNoYWRpbmdTaGlmdFRleHR1cmUsIHRoaXMudW5pZm9ybXMuc2hhZGluZ1NoaWZ0VGV4dHVyZVV2VHJhbnNmb3JtKTtcbiAgICB0aGlzLl91cGRhdGVUZXh0dXJlTWF0cml4KHRoaXMudW5pZm9ybXMubWF0Y2FwVGV4dHVyZSwgdGhpcy51bmlmb3Jtcy5tYXRjYXBUZXh0dXJlVXZUcmFuc2Zvcm0pO1xuICAgIHRoaXMuX3VwZGF0ZVRleHR1cmVNYXRyaXgodGhpcy51bmlmb3Jtcy5yaW1NdWx0aXBseVRleHR1cmUsIHRoaXMudW5pZm9ybXMucmltTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm0pO1xuICAgIHRoaXMuX3VwZGF0ZVRleHR1cmVNYXRyaXgoXG4gICAgICB0aGlzLnVuaWZvcm1zLm91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZSxcbiAgICAgIHRoaXMudW5pZm9ybXMub3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm0sXG4gICAgKTtcbiAgICB0aGlzLl91cGRhdGVUZXh0dXJlTWF0cml4KHRoaXMudW5pZm9ybXMudXZBbmltYXRpb25NYXNrVGV4dHVyZSwgdGhpcy51bmlmb3Jtcy51dkFuaW1hdGlvbk1hc2tUZXh0dXJlVXZUcmFuc2Zvcm0pO1xuXG4gICAgdGhpcy51bmlmb3Jtc05lZWRVcGRhdGUgPSB0cnVlO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBtYXAgb2JqZWN0IG9mIHByZXByb2Nlc3NvciB0b2tlbiBhbmQgbWFjcm8gb2YgdGhlIHNoYWRlciBwcm9ncmFtLlxuICAgKi9cbiAgcHJpdmF0ZSBfZ2VuZXJhdGVEZWZpbmVzKCk6IHsgW3Rva2VuOiBzdHJpbmddOiBib29sZWFuIHwgbnVtYmVyIHwgc3RyaW5nIH0ge1xuICAgIGNvbnN0IHRocmVlUmV2aXNpb24gPSBwYXJzZUludChUSFJFRS5SRVZJU0lPTiwgMTApO1xuXG4gICAgY29uc3QgdXNlVXZJblZlcnQgPSB0aGlzLm91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZSAhPT0gbnVsbDtcbiAgICBjb25zdCB1c2VVdkluRnJhZyA9XG4gICAgICB0aGlzLm1hcCAhPT0gbnVsbCB8fFxuICAgICAgdGhpcy5ub3JtYWxNYXAgIT09IG51bGwgfHxcbiAgICAgIHRoaXMuZW1pc3NpdmVNYXAgIT09IG51bGwgfHxcbiAgICAgIHRoaXMuc2hhZGVNdWx0aXBseVRleHR1cmUgIT09IG51bGwgfHxcbiAgICAgIHRoaXMuc2hhZGluZ1NoaWZ0VGV4dHVyZSAhPT0gbnVsbCB8fFxuICAgICAgdGhpcy5yaW1NdWx0aXBseVRleHR1cmUgIT09IG51bGwgfHxcbiAgICAgIHRoaXMudXZBbmltYXRpb25NYXNrVGV4dHVyZSAhPT0gbnVsbDtcblxuICAgIHJldHVybiB7XG4gICAgICAvLyBUZW1wb3JhcnkgY29tcGF0IGFnYWluc3Qgc2hhZGVyIGNoYW5nZSBAIFRocmVlLmpzIHIxMjZcbiAgICAgIC8vIFNlZTogIzIxMjA1LCAjMjEzMDcsICMyMTI5OVxuICAgICAgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OOiB0aHJlZVJldmlzaW9uLFxuXG4gICAgICBPVVRMSU5FOiB0aGlzLl9pc091dGxpbmUsXG4gICAgICBNVE9PTl9VU0VfVVY6IHVzZVV2SW5WZXJ0IHx8IHVzZVV2SW5GcmFnLCAvLyB3ZSBjYW4ndCB1c2UgYFVTRV9VVmAgLCBpdCB3aWxsIGJlIHJlZGVmaW5lZCBpbiBXZWJHTFByb2dyYW0uanNcbiAgICAgIE1UT09OX1VWU19WRVJURVhfT05MWTogdXNlVXZJblZlcnQgJiYgIXVzZVV2SW5GcmFnLFxuICAgICAgVjBfQ09NUEFUX1NIQURFOiB0aGlzLl92MENvbXBhdFNoYWRlLFxuICAgICAgVVNFX1NIQURFTVVMVElQTFlURVhUVVJFOiB0aGlzLnNoYWRlTXVsdGlwbHlUZXh0dXJlICE9PSBudWxsLFxuICAgICAgVVNFX1NIQURJTkdTSElGVFRFWFRVUkU6IHRoaXMuc2hhZGluZ1NoaWZ0VGV4dHVyZSAhPT0gbnVsbCxcbiAgICAgIFVTRV9NQVRDQVBURVhUVVJFOiB0aGlzLm1hdGNhcFRleHR1cmUgIT09IG51bGwsXG4gICAgICBVU0VfUklNTVVMVElQTFlURVhUVVJFOiB0aGlzLnJpbU11bHRpcGx5VGV4dHVyZSAhPT0gbnVsbCxcbiAgICAgIFVTRV9PVVRMSU5FV0lEVEhNVUxUSVBMWVRFWFRVUkU6IHRoaXMuX2lzT3V0bGluZSAmJiB0aGlzLm91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZSAhPT0gbnVsbCxcbiAgICAgIFVTRV9VVkFOSU1BVElPTk1BU0tURVhUVVJFOiB0aGlzLnV2QW5pbWF0aW9uTWFza1RleHR1cmUgIT09IG51bGwsXG4gICAgICBJR05PUkVfVkVSVEVYX0NPTE9SOiB0aGlzLl9pZ25vcmVWZXJ0ZXhDb2xvciA9PT0gdHJ1ZSxcbiAgICAgIERFQlVHX05PUk1BTDogdGhpcy5fZGVidWdNb2RlID09PSAnbm9ybWFsJyxcbiAgICAgIERFQlVHX0xJVFNIQURFUkFURTogdGhpcy5fZGVidWdNb2RlID09PSAnbGl0U2hhZGVSYXRlJyxcbiAgICAgIERFQlVHX1VWOiB0aGlzLl9kZWJ1Z01vZGUgPT09ICd1dicsXG4gICAgICBPVVRMSU5FX1dJRFRIX1NDUkVFTjpcbiAgICAgICAgdGhpcy5faXNPdXRsaW5lICYmIHRoaXMuX291dGxpbmVXaWR0aE1vZGUgPT09IE1Ub29uTWF0ZXJpYWxPdXRsaW5lV2lkdGhNb2RlLlNjcmVlbkNvb3JkaW5hdGVzLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIF91cGRhdGVUZXh0dXJlTWF0cml4KHNyYzogVEhSRUUuSVVuaWZvcm08VEhSRUUuVGV4dHVyZSB8IG51bGw+LCBkc3Q6IFRIUkVFLklVbmlmb3JtPFRIUkVFLk1hdHJpeDM+KTogdm9pZCB7XG4gICAgaWYgKHNyYy52YWx1ZSkge1xuICAgICAgaWYgKHNyYy52YWx1ZS5tYXRyaXhBdXRvVXBkYXRlKSB7XG4gICAgICAgIHNyYy52YWx1ZS51cGRhdGVNYXRyaXgoKTtcbiAgICAgIH1cblxuICAgICAgZHN0LnZhbHVlLmNvcHkoc3JjLnZhbHVlLm1hdHJpeCk7XG4gICAgfVxuICB9XG59XG4iLCAiLy8gI2RlZmluZSBQSE9OR1xuXG52YXJ5aW5nIHZlYzMgdlZpZXdQb3NpdGlvbjtcblxuI2lmbmRlZiBGTEFUX1NIQURFRFxuICB2YXJ5aW5nIHZlYzMgdk5vcm1hbDtcbiNlbmRpZlxuXG4jaW5jbHVkZSA8Y29tbW9uPlxuXG4vLyAjaW5jbHVkZSA8dXZfcGFyc192ZXJ0ZXg+XG4jaWZkZWYgTVRPT05fVVNFX1VWXG4gIHZhcnlpbmcgdmVjMiB2VXY7XG5cbiAgLy8gQ09NUEFUOiBwcmUtcjE1MSB1c2VzIGEgY29tbW9uIHV2VHJhbnNmb3JtXG4gICNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPCAxNTFcbiAgICB1bmlmb3JtIG1hdDMgdXZUcmFuc2Zvcm07XG4gICNlbmRpZlxuI2VuZGlmXG5cbi8vICNpbmNsdWRlIDx1djJfcGFyc192ZXJ0ZXg+XG4vLyBDT01BUFQ6IHByZS1yMTUxIHVzZXMgdXYyIGZvciBsaWdodE1hcCBhbmQgYW9NYXBcbiNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPCAxNTFcbiAgI2lmIGRlZmluZWQoIFVTRV9MSUdIVE1BUCApIHx8IGRlZmluZWQoIFVTRV9BT01BUCApXG4gICAgYXR0cmlidXRlIHZlYzIgdXYyO1xuICAgIHZhcnlpbmcgdmVjMiB2VXYyO1xuICAgIHVuaWZvcm0gbWF0MyB1djJUcmFuc2Zvcm07XG4gICNlbmRpZlxuI2VuZGlmXG5cbi8vICNpbmNsdWRlIDxkaXNwbGFjZW1lbnRtYXBfcGFyc192ZXJ0ZXg+XG4vLyAjaW5jbHVkZSA8ZW52bWFwX3BhcnNfdmVydGV4PlxuI2luY2x1ZGUgPGNvbG9yX3BhcnNfdmVydGV4PlxuI2luY2x1ZGUgPGZvZ19wYXJzX3ZlcnRleD5cbiNpbmNsdWRlIDxtb3JwaHRhcmdldF9wYXJzX3ZlcnRleD5cbiNpbmNsdWRlIDxza2lubmluZ19wYXJzX3ZlcnRleD5cbiNpbmNsdWRlIDxzaGFkb3dtYXBfcGFyc192ZXJ0ZXg+XG4jaW5jbHVkZSA8bG9nZGVwdGhidWZfcGFyc192ZXJ0ZXg+XG4jaW5jbHVkZSA8Y2xpcHBpbmdfcGxhbmVzX3BhcnNfdmVydGV4PlxuXG4jaWZkZWYgVVNFX09VVExJTkVXSURUSE1VTFRJUExZVEVYVFVSRVxuICB1bmlmb3JtIHNhbXBsZXIyRCBvdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmU7XG4gIHVuaWZvcm0gbWF0MyBvdXRsaW5lV2lkdGhNdWx0aXBseVRleHR1cmVVdlRyYW5zZm9ybTtcbiNlbmRpZlxuXG51bmlmb3JtIGZsb2F0IG91dGxpbmVXaWR0aEZhY3Rvcjtcblxudm9pZCBtYWluKCkge1xuXG4gIC8vICNpbmNsdWRlIDx1dl92ZXJ0ZXg+XG4gICNpZmRlZiBNVE9PTl9VU0VfVVZcbiAgICAvLyBDT01QQVQ6IHByZS1yMTUxIHVzZXMgYSBjb21tb24gdXZUcmFuc2Zvcm1cbiAgICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE1MVxuICAgICAgdlV2ID0gdXY7XG4gICAgI2Vsc2VcbiAgICAgIHZVdiA9ICggdXZUcmFuc2Zvcm0gKiB2ZWMzKCB1diwgMSApICkueHk7XG4gICAgI2VuZGlmXG4gICNlbmRpZlxuXG4gIC8vICNpbmNsdWRlIDx1djJfdmVydGV4PlxuICAvLyBDT01BUFQ6IHByZS1yMTUxIHVzZXMgdXYyIGZvciBsaWdodE1hcCBhbmQgYW9NYXBcbiAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA8IDE1MVxuICAgICNpZiBkZWZpbmVkKCBVU0VfTElHSFRNQVAgKSB8fCBkZWZpbmVkKCBVU0VfQU9NQVAgKVxuICAgICAgdlV2MiA9ICggdXYyVHJhbnNmb3JtICogdmVjMyggdXYyLCAxICkgKS54eTtcbiAgICAjZW5kaWZcbiAgI2VuZGlmXG5cbiAgI2luY2x1ZGUgPGNvbG9yX3ZlcnRleD5cblxuICAjaW5jbHVkZSA8YmVnaW5ub3JtYWxfdmVydGV4PlxuICAjaW5jbHVkZSA8bW9ycGhub3JtYWxfdmVydGV4PlxuICAjaW5jbHVkZSA8c2tpbmJhc2VfdmVydGV4PlxuICAjaW5jbHVkZSA8c2tpbm5vcm1hbF92ZXJ0ZXg+XG5cbiAgLy8gd2UgbmVlZCB0aGlzIHRvIGNvbXB1dGUgdGhlIG91dGxpbmUgcHJvcGVybHlcbiAgb2JqZWN0Tm9ybWFsID0gbm9ybWFsaXplKCBvYmplY3ROb3JtYWwgKTtcblxuICAjaW5jbHVkZSA8ZGVmYXVsdG5vcm1hbF92ZXJ0ZXg+XG5cbiAgI2lmbmRlZiBGTEFUX1NIQURFRCAvLyBOb3JtYWwgY29tcHV0ZWQgd2l0aCBkZXJpdmF0aXZlcyB3aGVuIEZMQVRfU0hBREVEXG4gICAgdk5vcm1hbCA9IG5vcm1hbGl6ZSggdHJhbnNmb3JtZWROb3JtYWwgKTtcbiAgI2VuZGlmXG5cbiAgI2luY2x1ZGUgPGJlZ2luX3ZlcnRleD5cblxuICAjaW5jbHVkZSA8bW9ycGh0YXJnZXRfdmVydGV4PlxuICAjaW5jbHVkZSA8c2tpbm5pbmdfdmVydGV4PlxuICAvLyAjaW5jbHVkZSA8ZGlzcGxhY2VtZW50bWFwX3ZlcnRleD5cbiAgI2luY2x1ZGUgPHByb2plY3RfdmVydGV4PlxuICAjaW5jbHVkZSA8bG9nZGVwdGhidWZfdmVydGV4PlxuICAjaW5jbHVkZSA8Y2xpcHBpbmdfcGxhbmVzX3ZlcnRleD5cblxuICB2Vmlld1Bvc2l0aW9uID0gLSBtdlBvc2l0aW9uLnh5ejtcblxuICAjaWZkZWYgT1VUTElORVxuICAgIGZsb2F0IHdvcmxkTm9ybWFsTGVuZ3RoID0gbGVuZ3RoKCB0cmFuc2Zvcm1lZE5vcm1hbCApO1xuICAgIHZlYzMgb3V0bGluZU9mZnNldCA9IG91dGxpbmVXaWR0aEZhY3RvciAqIHdvcmxkTm9ybWFsTGVuZ3RoICogb2JqZWN0Tm9ybWFsO1xuXG4gICAgI2lmZGVmIFVTRV9PVVRMSU5FV0lEVEhNVUxUSVBMWVRFWFRVUkVcbiAgICAgIHZlYzIgb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlVXYgPSAoIG91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtICogdmVjMyggdlV2LCAxICkgKS54eTtcbiAgICAgIGZsb2F0IG91dGxpbmVUZXggPSB0ZXh0dXJlMkQoIG91dGxpbmVXaWR0aE11bHRpcGx5VGV4dHVyZSwgb3V0bGluZVdpZHRoTXVsdGlwbHlUZXh0dXJlVXYgKS5nO1xuICAgICAgb3V0bGluZU9mZnNldCAqPSBvdXRsaW5lVGV4O1xuICAgICNlbmRpZlxuXG4gICAgI2lmZGVmIE9VVExJTkVfV0lEVEhfU0NSRUVOXG4gICAgICAvLyBcdThERERcdTc5QkJcdTgxRUFcdTkwMDJcdTVFOTRcdTk2NTBcdTUyMzZcdUZGMENcdTkwN0ZcdTUxNERcdThGRENcdTY2NkZcdTYzQ0ZcdThGQjlcdTUzRDhcdTdDOTdcdTlFRDFcdTU2RTJcdUZGMENcdThGRDFcdTY2NkZcdTdBN0ZcdTYzRDJcdTY1QURcdTVDNDJcbiAgICAgIGZsb2F0IG91dGxpbmVEaXN0ID0gY2xhbXAoIHZWaWV3UG9zaXRpb24ueiwgMC40NSwgNS4wICk7XG4gICAgICBvdXRsaW5lT2Zmc2V0ICo9IG91dGxpbmVEaXN0IC8gcHJvamVjdGlvbk1hdHJpeFsgMSBdLnk7XG4gICAgI2VuZGlmXG5cbiAgICBnbF9Qb3NpdGlvbiA9IHByb2plY3Rpb25NYXRyaXggKiBtb2RlbFZpZXdNYXRyaXggKiB2ZWM0KCBvdXRsaW5lT2Zmc2V0ICsgdHJhbnNmb3JtZWQsIDEuMCApO1xuXG4gICAgZ2xfUG9zaXRpb24ueiArPSAxRS02ICogZ2xfUG9zaXRpb24udzsgLy8gYW50aS1hcnRpZmFjdCBtYWdpY1xuICAjZW5kaWZcblxuICAjaW5jbHVkZSA8d29ybGRwb3NfdmVydGV4PlxuICAvLyAjaW5jbHVkZSA8ZW52bWFwX3ZlcnRleD5cbiAgI2luY2x1ZGUgPHNoYWRvd21hcF92ZXJ0ZXg+XG4gICNpbmNsdWRlIDxmb2dfdmVydGV4PlxuXG59IiwgIi8vICNkZWZpbmUgUEhPTkdcblxudW5pZm9ybSB2ZWMzIGxpdEZhY3RvcjtcblxudW5pZm9ybSBmbG9hdCBvcGFjaXR5O1xuXG51bmlmb3JtIHZlYzMgc2hhZGVDb2xvckZhY3RvcjtcbiNpZmRlZiBVU0VfU0hBREVNVUxUSVBMWVRFWFRVUkVcbiAgdW5pZm9ybSBzYW1wbGVyMkQgc2hhZGVNdWx0aXBseVRleHR1cmU7XG4gIHVuaWZvcm0gbWF0MyBzaGFkZU11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtO1xuI2VuZGlmXG5cbnVuaWZvcm0gZmxvYXQgc2hhZGluZ1NoaWZ0RmFjdG9yO1xudW5pZm9ybSBmbG9hdCBzaGFkaW5nVG9vbnlGYWN0b3I7XG5cbiNpZmRlZiBVU0VfU0hBRElOR1NISUZUVEVYVFVSRVxuICB1bmlmb3JtIHNhbXBsZXIyRCBzaGFkaW5nU2hpZnRUZXh0dXJlO1xuICB1bmlmb3JtIG1hdDMgc2hhZGluZ1NoaWZ0VGV4dHVyZVV2VHJhbnNmb3JtO1xuICB1bmlmb3JtIGZsb2F0IHNoYWRpbmdTaGlmdFRleHR1cmVTY2FsZTtcbiNlbmRpZlxuXG51bmlmb3JtIGZsb2F0IGdpRXF1YWxpemF0aW9uRmFjdG9yO1xuXG51bmlmb3JtIHZlYzMgcGFyYW1ldHJpY1JpbUNvbG9yRmFjdG9yO1xuI2lmZGVmIFVTRV9SSU1NVUxUSVBMWVRFWFRVUkVcbiAgdW5pZm9ybSBzYW1wbGVyMkQgcmltTXVsdGlwbHlUZXh0dXJlO1xuICB1bmlmb3JtIG1hdDMgcmltTXVsdGlwbHlUZXh0dXJlVXZUcmFuc2Zvcm07XG4jZW5kaWZcbnVuaWZvcm0gZmxvYXQgcmltTGlnaHRpbmdNaXhGYWN0b3I7XG51bmlmb3JtIGZsb2F0IHBhcmFtZXRyaWNSaW1GcmVzbmVsUG93ZXJGYWN0b3I7XG51bmlmb3JtIGZsb2F0IHBhcmFtZXRyaWNSaW1MaWZ0RmFjdG9yO1xuXG4vLyBFeHRlbmRlZCBNVG9vbiB0dW5pbmcgcGFyYW1ldGVyc1xudW5pZm9ybSBmbG9hdCBzb2Z0TWl4OyAgICAgICAgICAgLy8gMC4uMSBibGVuZCB0b3dhcmQgaGFsZi1MYW1iZXJ0IHNvZnQgcGF0aCAoZGVmYXVsdCB+MC45NSlcbnVuaWZvcm0gZmxvYXQgYmx1ckJvb3N0OyAgICAgICAgIC8vIGV4dHJhIHRvb24gYmx1ciB3aWR0aCBpbiBoYWxmLUxhbWJlcnQgc3BhY2UgKGRlZmF1bHQgfjAuMzIpXG51bmlmb3JtIGZsb2F0IHNoYWRvdzJuZFN0cmVuZ3RoOyAvLyAwLi4xIG9wdGlvbmFsIDJuZCBzaGFkb3cgYmFuZCAoZGVmYXVsdCB+MC42NSlcbnVuaWZvcm0gZmxvYXQgc2hhZG93Mm5kQm9yZGVyOyAgIC8vIGhhbGYtTGFtYmVydCBib3JkZXIgZm9yIDJuZCBiYW5kIChkZWZhdWx0IH4wLjMyKVxudW5pZm9ybSBmbG9hdCBzaGFkb3cybmRCbHVyOyAgICAgLy8gMm5kIGJhbmQgYmx1ciAoZGVmYXVsdCB+MC4xNilcbnVuaWZvcm0gdmVjMyBzaGFkb3cybmRDb2xvcjsgICAgIC8vIHB1cnBsZS1ncmF5IHRpbnQgXHUyMjQ4IE5QUiBfU2hhZG93Q29sb3IgdmliZVxudW5pZm9ybSBmbG9hdCBzaGFkb3czcmRTdHJlbmd0aDsgLy8gbGlnaHQgM3JkIGJhbmQgKGRlZmF1bHQgfjAuMjg7IDAgPSBvZmYpXG51bmlmb3JtIGZsb2F0IHNoYWRvdzNyZEJvcmRlcjsgICAvLyBoYWxmLUxhbWJlcnQgYm9yZGVyIGZvciAzcmQgYmFuZCAoZGVmYXVsdCB+MC4xNClcbnVuaWZvcm0gZmxvYXQgc2hhZG93M3JkQmx1cjsgICAgIC8vIDNyZCBiYW5kIGJsdXIgKGRlZmF1bHQgfjAuMTEpXG51bmlmb3JtIHZlYzMgc2hhZG93M3JkQ29sb3I7ICAgICAvLyBkZWVwZXIgY29vbCBwdXJwbGUtZ3JheVxudW5pZm9ybSBmbG9hdCByaW1Cb29zdDsgICAgICAgICAgLy8gbXVsdGlwbHkgcmltIGFmdGVyIHRvb24gc2NhbGUgKGRlZmF1bHQgfjEuNClcbnVuaWZvcm0gZmxvYXQgcmltQm9yZGVyOyAgICAgICAgIC8vIHNvZnQtbGlrZSByaW0gYm9yZGVyIGluIEZyZXNuZWwgWzAsMV0gKGRlZmF1bHQgfjAuNSlcbnVuaWZvcm0gZmxvYXQgcmltQmx1cjsgICAgICAgICAgIC8vIHNvZnQtbGlrZSByaW0gYmx1ciB3aWR0aCAoZGVmYXVsdCB+MC4xOClcbnVuaWZvcm0gZmxvYXQgcmltRGlyU3RyZW5ndGg7ICAgIC8vIGRpcmVjdGlvbmFsIHJpbSAoTlx1MDBCN0wgaW5mbHVlbmNlKTsgMCA9IGlzb3Ryb3BpYyAoZGVmYXVsdCB+MC4zNSlcbnVuaWZvcm0gZmxvYXQgaGFpclNwZWNTdHJlbmd0aDsgIC8vIGFuaXNvdHJvcGljIC8gYW5nZWwtcmluZyBoaWdobGlnaHQgKGRlZmF1bHQgfjAuMTQ7IGhhaXIgbWFuYWdlciBcdTIxOTEpXG51bmlmb3JtIGZsb2F0IGhhaXJTcGVjUG93ZXI7ICAgICAvLyBoaWdobGlnaHQgc2hhcnBuZXNzIChkZWZhdWx0IH41NilcbnVuaWZvcm0gZmxvYXQgaGFpclNwZWNTaGlmdDsgICAgIC8vIHByaW1hcnkgbG9iZSBzaGlmdCBhbG9uZyB0YW5nZW50IChkZWZhdWx0IH4tMC4xKVxudW5pZm9ybSBmbG9hdCBjbG90aFNwZWNTdHJlbmd0aDsgLy8gR0dYLWlzaCBpc290cm9waWMgY2xvdGgvc2F0aW4gKGRlZmF1bHQgMDsgbWFuYWdlciBzZXRzKVxudW5pZm9ybSBmbG9hdCBjbG90aFNwZWNQb3dlcjsgICAgLy8gY2xvdGggcm91Z2huZXNzIGludmVyc2UgcHJveHkgXHUyMTkyIHBvd2VyIChkZWZhdWx0IH43MilcbnVuaWZvcm0gZmxvYXQgbWF0Y2FwMm5kU3RyZW5ndGg7IC8vIGNoZWFwIDJuZCBNYXRDYXA6IHJlc2FtcGxlIHNoaWZ0ZWQgVVYgKGRlZmF1bHQgfjAuMjUgd2hlbiBtYXRjYXAgb24pXG51bmlmb3JtIGZsb2F0IHNraW5TcGVjU3RyZW5ndGg7ICAvLyBpc290cm9waWMgbW9pc3Qgc2tpbiBzcGVjdWxhciAoZGVmYXVsdCAwOyBmYWNlL2JvZHkgbWFuYWdlciBcdTIxOTEpXG51bmlmb3JtIGZsb2F0IHNraW5TcGVjUG93ZXI7ICAgICAvLyBicm9hZCBoaWdobGlnaHQgc2hhcnBuZXNzIChkZWZhdWx0IH4yODsgbG93ZXIgPSB3ZXR0ZXIvc29mdGVyKVxudW5pZm9ybSBmbG9hdCBza2luU3BlY0ZyZXNuZWw7ICAgLy8gbWlsZCBncmF6aW5nIHNoZWVuIDAuLjEgKGh5ZHJhdGVkLCBub3Qgb2lseSlcbnVuaWZvcm0gdmVjMyBza2luU3BlY0NvbG9yOyAgICAgIC8vIHdhcm0gc3BlY3VsYXIgdGludFxudW5pZm9ybSBmbG9hdCBhbWJpZW50TGlmdDsgICAgICAgLy8gYnJpZ2h0ZW4gaW5kaXJlY3QgLyBzb2Z0LWxpdCBhbWJpZW50IChzb2Z0LWlzaClcbnVuaWZvcm0gZmxvYXQgc2hhZGVNYWluU3RyZW5ndGg7IC8vIG1peCBzaGFkZSB0b3dhcmQgc2hhZGUqYWxiZWRvIChOUFIgX1NoYWRvd01haW5TdHJlbmd0aClcbnVuaWZvcm0gZmxvYXQgc2hhZG93Qm9yZGVyOyAgICAgIC8vIGV4cGxpY2l0IE5QUiBwcmltYXJ5IGJvcmRlciBpbiBITCBbMCwxXTsgPDAgXHUyMTkyIGRlcml2ZSBmcm9tIHNoaWZ0XG51bmlmb3JtIGZsb2F0IHNoYWRvd0JsdXI7ICAgICAgICAvLyBleHBsaWNpdCBOUFIgcHJpbWFyeSBibHVyOyA8PTAgXHUyMTkyIHRvb255K2Jvb3N0IG9ubHlcbnVuaWZvcm0gZmxvYXQgcmltTWFpblN0cmVuZ3RoOyAgIC8vIG1peCByaW0gY29sb3IgdG93YXJkIGFsYmVkbyAoTlBSIF9SaW1NYWluU3RyZW5ndGgpXG51bmlmb3JtIGZsb2F0IHJpbVNoYWRvd01hc2s7ICAgICAvLyBhdHRlbnVhdGUgcmltIGluIGRlZXAgc2hhZGUgMC4uMVxuXG4vLyAtLS0gRXh0ZW5kZWQgc2hhZGluZyBrbm9icyAobXVsdGktYmFuZCBzaGFkb3csIHNwZWN1bGFyLCByZWZsZWN0aW9uLCBiYWNrbGlnaHQpIC0tLVxudW5pZm9ybSBmbG9hdCBzcGVjdWxhclN0cmVuZ3RoOyAgIC8vIGxpbENhbGNTcGVjdWxhci1saWtlIHRvb24gc3BlY3VsYXIgKG1ldGFsbGljL3Ntb290aG5lc3MgcHJveHkpXG51bmlmb3JtIGZsb2F0IHNwZWN1bGFyUG93ZXI7ICAgICAgLy8gQmxpbm4gcG93ZXIgLyBpbnZlcnNlIHJvdWdobmVzcyBwcm94eVxudW5pZm9ybSBmbG9hdCBzcGVjdWxhckJvcmRlcjsgICAgIC8vIHRvb24gc3BlY3VsYXIgYm9yZGVyXG51bmlmb3JtIGZsb2F0IHNwZWN1bGFyQmx1cjsgICAgICAgLy8gdG9vbiBzcGVjdWxhciBibHVyXG51bmlmb3JtIGZsb2F0IHJlZmxlY3RTdHJlbmd0aDsgICAgLy8gdmlldy1kZXBlbmRlbnQgZW52IHJlZmxlY3Rpb24gYXBwcm94IChubyBjdWJlbWFwKVxudW5pZm9ybSBmbG9hdCByZWZsZWN0RnJlc25lbDsgICAgIC8vIGZyZXNuZWwgYW1vdW50IGZvciBlbnYgYXBwcm94XG51bmlmb3JtIGZsb2F0IHJlZmxlY3RNZXRhbGxpYzsgICAgLy8gMCBkaWVsZWN0cmljIC4uIDEgbWV0YWwgdGludCB0b3dhcmQgYWxiZWRvXG51bmlmb3JtIGZsb2F0IHJlZmxlY3RTbW9vdGhuZXNzOyAgLy8gc2hhcnBlciBncmF6aW5nIHJlZmxlY3Rpb24gd2hlbiBoaWdoXG51bmlmb3JtIGZsb2F0IGJhY2tsaWdodFN0cmVuZ3RoOyAgLy8gTlBSIGJhY2tsaWdodCBhcHByb3ggKHdyYXAgLyBvcHBvc2l0ZSBsaWdodClcbnVuaWZvcm0gdmVjMyAgYmFja2xpZ2h0Q29sb3I7ICAgICAvLyBiYWNrbGlnaHQgdGludFxudW5pZm9ybSBmbG9hdCByaW1GcmVzbmVsUG93ZXI7ICAgIC8vID4wIG92ZXJyaWRlcyBwYXJhbWV0cmljIHJpbSBmcmVzbmVsIHBvd2VyXG51bmlmb3JtIGZsb2F0IHJpbUluZGlyU3RyZW5ndGg7ICAgLy8gb3Bwb3NpdGUtc2lkZSByaW0gKE5QUiBSaW1JbmRpcilcbnVuaWZvcm0gZmxvYXQgbWF0Y2FwMm5kQ29udHJhc3Q7ICAvLyA+MSBzdHJlbmd0aGVucyBzeW50aGVzaXplZCAybmQgbWF0Y2FwXG51bmlmb3JtIGZsb2F0IG1hdGNhcDJuZFNjYWxlOyAgICAgLy8gVVYgc2NhbGUgZm9yIDJuZCBtYXRjYXAgcmVzYW1wbGVcbnVuaWZvcm0gZmxvYXQgZW1pc3Npb25Cb29zdDsgICAgICAvLyBzY2FsZSBzdG9jayBlbWlzc2l2ZSAoTlBSIGVtaXNzaW9uIGZlZWwpXG51bmlmb3JtIGZsb2F0IGRpc3RhbmNlRmFkZTsgICAgICAgLy8gc3VidGxlIGNhbWVyYS1kaXN0YW5jZSBzb2Z0IGxpZnQvZmFkZSAwLi4xXG51bmlmb3JtIGZsb2F0IGZhY2VTb2Z0OyAgICAgICAgICAgLy8gZmFjZSBwcmVzZXQ6IHNvZnRlciBwcmltYXJ5IGJvcmRlciB2aWEgc2hhZGluZ1NoaWZ0XG51bmlmb3JtIGZsb2F0IG5vcm1hbFNraW5Cb29zdDsgICAgLy8gYW1wbGlmeSBub3JtYWwgbWFwIGNvbnRyaWJ1dGlvbiBmb3Igc2tpbiBkZXB0aFxudW5pZm9ybSBmbG9hdCBlbnZTdHJlbmd0aDsgICAgICAgIC8vIE5QUiBfU2hhZG93RW52U3RyZW5ndGgtbGlrZSBpbmRpcmVjdCBpbiBzaGFkZVxudW5pZm9ybSBmbG9hdCBnZW1GcmVzbmVsOyAgICAgICAgIC8vIGdlbS1pc2ggZnJlc25lbCBwcm94eSAoc2FmZTsgb2ZmIGJ5IGRlZmF1bHQpXG51bmlmb3JtIGZsb2F0IG91dGxpbmVNaXg7ICAgICAgICAgLy8gY29vcGVyYXRlIHdpdGggb3V0bGluZSBwYXNzIGxpZ2h0aW5nIG1peCAoPD0gc3RvY2spXG51bmlmb3JtIGZsb2F0IHJlY2VpdmVTaGFkb3dSYXRlOyAgIC8vIDAuMCA9IGlnbm9yZSBzaGFkb3cgbWFwIChjbGVhbiBhbmltZSBmYWNlKSwgMS4wID0gZnVsbCBzaGFkb3dcbnVuaWZvcm0gZmxvYXQgZmFicmljU2hlZW5TdHJlbmd0aDsgLy8gY2xvdGggZ3JhemluZyBzaGVlbiBzdHJlbmd0aFxudW5pZm9ybSBmbG9hdCBmYWJyaWNTaGVlblBvd2VyOyAgICAvLyBjbG90aCBncmF6aW5nIHNoZWVuIGZhbGxvZmYgcG93ZXIgKGRlZmF1bHQgfjMuNSlcbnVuaWZvcm0gdmVjMyBmYWJyaWNTaGVlbkNvbG9yOyAgICAgLy8gY2xvdGggZ3JhemluZyBzaGVlbiB0aW50XG5cbiNpZmRlZiBVU0VfTUFUQ0FQVEVYVFVSRVxuICB1bmlmb3JtIHZlYzMgbWF0Y2FwRmFjdG9yO1xuICB1bmlmb3JtIHNhbXBsZXIyRCBtYXRjYXBUZXh0dXJlO1xuICB1bmlmb3JtIG1hdDMgbWF0Y2FwVGV4dHVyZVV2VHJhbnNmb3JtO1xuI2VuZGlmXG5cbnVuaWZvcm0gdmVjMyBlbWlzc2l2ZTtcbnVuaWZvcm0gZmxvYXQgZW1pc3NpdmVJbnRlbnNpdHk7XG5cbnVuaWZvcm0gdmVjMyBvdXRsaW5lQ29sb3JGYWN0b3I7XG51bmlmb3JtIGZsb2F0IG91dGxpbmVMaWdodGluZ01peEZhY3RvcjtcblxuI2lmZGVmIFVTRV9VVkFOSU1BVElPTk1BU0tURVhUVVJFXG4gIHVuaWZvcm0gc2FtcGxlcjJEIHV2QW5pbWF0aW9uTWFza1RleHR1cmU7XG4gIHVuaWZvcm0gbWF0MyB1dkFuaW1hdGlvbk1hc2tUZXh0dXJlVXZUcmFuc2Zvcm07XG4jZW5kaWZcblxudW5pZm9ybSBmbG9hdCB1dkFuaW1hdGlvblNjcm9sbFhPZmZzZXQ7XG51bmlmb3JtIGZsb2F0IHV2QW5pbWF0aW9uU2Nyb2xsWU9mZnNldDtcbnVuaWZvcm0gZmxvYXQgdXZBbmltYXRpb25Sb3RhdGlvblBoYXNlO1xuXG4jaW5jbHVkZSA8Y29tbW9uPlxuI2luY2x1ZGUgPHBhY2tpbmc+XG4jaW5jbHVkZSA8ZGl0aGVyaW5nX3BhcnNfZnJhZ21lbnQ+XG4jaW5jbHVkZSA8Y29sb3JfcGFyc19mcmFnbWVudD5cblxuLy8gI2luY2x1ZGUgPHV2X3BhcnNfZnJhZ21lbnQ+XG4jaWYgKCBkZWZpbmVkKCBNVE9PTl9VU0VfVVYgKSAmJiAhZGVmaW5lZCggTVRPT05fVVZTX1ZFUlRFWF9PTkxZICkgKVxuICB2YXJ5aW5nIHZlYzIgdlV2O1xuI2VuZGlmXG5cbi8vICNpbmNsdWRlIDx1djJfcGFyc19mcmFnbWVudD5cbi8vIENPTUFQVDogcHJlLXIxNTEgdXNlcyB1djIgZm9yIGxpZ2h0TWFwIGFuZCBhb01hcFxuI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA8IDE1MVxuICAjaWYgZGVmaW5lZCggVVNFX0xJR0hUTUFQICkgfHwgZGVmaW5lZCggVVNFX0FPTUFQIClcbiAgICB2YXJ5aW5nIHZlYzIgdlV2MjtcbiAgI2VuZGlmXG4jZW5kaWZcblxuI2luY2x1ZGUgPG1hcF9wYXJzX2ZyYWdtZW50PlxuXG4jaWZkZWYgVVNFX01BUFxuICB1bmlmb3JtIG1hdDMgbWFwVXZUcmFuc2Zvcm07XG4jZW5kaWZcblxuLy8gI2luY2x1ZGUgPGFscGhhbWFwX3BhcnNfZnJhZ21lbnQ+XG5cbiNpbmNsdWRlIDxhbHBoYXRlc3RfcGFyc19mcmFnbWVudD5cblxuI2luY2x1ZGUgPGFvbWFwX3BhcnNfZnJhZ21lbnQ+XG4vLyAjaW5jbHVkZSA8bGlnaHRtYXBfcGFyc19mcmFnbWVudD5cbiNpbmNsdWRlIDxlbWlzc2l2ZW1hcF9wYXJzX2ZyYWdtZW50PlxuXG4jaWZkZWYgVVNFX0VNSVNTSVZFTUFQXG4gIHVuaWZvcm0gbWF0MyBlbWlzc2l2ZU1hcFV2VHJhbnNmb3JtO1xuI2VuZGlmXG5cbi8vICNpbmNsdWRlIDxlbnZtYXBfY29tbW9uX3BhcnNfZnJhZ21lbnQ+XG4vLyAjaW5jbHVkZSA8ZW52bWFwX3BhcnNfZnJhZ21lbnQ+XG4vLyAjaW5jbHVkZSA8Y3ViZV91dl9yZWZsZWN0aW9uX2ZyYWdtZW50PlxuI2luY2x1ZGUgPGZvZ19wYXJzX2ZyYWdtZW50PlxuXG4vLyAjaW5jbHVkZSA8YnNkZnM+XG4vLyBDT01QQVQ6IHByZS1yMTUxIGRvZXNuJ3QgaGF2ZSBCUkRGX0xhbWJlcnQgaW4gPGNvbW1vbj5cbiNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPCAxNTFcbiAgdmVjMyBCUkRGX0xhbWJlcnQoIGNvbnN0IGluIHZlYzMgZGlmZnVzZUNvbG9yICkge1xuICAgIHJldHVybiBSRUNJUFJPQ0FMX1BJICogZGlmZnVzZUNvbG9yO1xuICB9XG4jZW5kaWZcblxuXG4jaW5jbHVkZSA8bGlnaHRzX3BhcnNfYmVnaW4+XG5cbiNpbmNsdWRlIDxub3JtYWxfcGFyc19mcmFnbWVudD5cblxuLy8gI2luY2x1ZGUgPGxpZ2h0c19waG9uZ19wYXJzX2ZyYWdtZW50PlxudmFyeWluZyB2ZWMzIHZWaWV3UG9zaXRpb247XG5cbnN0cnVjdCBNVG9vbk1hdGVyaWFsIHtcbiAgdmVjMyBkaWZmdXNlQ29sb3I7XG4gIHZlYzMgc2hhZGVDb2xvcjtcbiAgZmxvYXQgc2hhZGluZ1NoaWZ0O1xufTtcblxuZmxvYXQgbGluZWFyc3RlcCggZmxvYXQgYSwgZmxvYXQgYiwgZmxvYXQgdCApIHtcbiAgcmV0dXJuIGNsYW1wKCAoIHQgLSBhICkgLyAoIGIgLSBhICksIDAuMCwgMS4wICk7XG59XG5cbi8qKiBIZXJtaXRlIHNtb290aHN0ZXAgXHUyMDE0IGtpbGxzIHRvb24gaXNvLWNvbnRvdXIgcmlwcGxlcyBvbiBjdXJ2ZWQgc2tpbiAqL1xuZmxvYXQgc21vb3RoZXJzdGVwKCBmbG9hdCBhLCBmbG9hdCBiLCBmbG9hdCB0ICkge1xuICBmbG9hdCB4ID0gbGluZWFyc3RlcCggYSwgYiwgdCApO1xuICByZXR1cm4geCAqIHggKiB4ICogKCB4ICogKCB4ICogNi4wIC0gMTUuMCApICsgMTAuMCApO1xufVxuXG4vKipcbiAqIENvbnZlcnQgTmRvdEwgaW50byB0b29uIHNoYWRpbmcgZmFjdG9yIHVzaW5nIHNoYWRpbmdTaGlmdCBhbmQgc2hhZGluZ1Rvb255LlxuICogTVRvb246IG9wdGlvbmFsbHkgYmxlbmQgYSBleHRlbmRlZC1saWtlIGhhbGYtTGFtYmVydCArIGJvcmRlci9ibHVyIHBhdGggKHNvZnRNaXgpLlxuICovXG5mbG9hdCBnZXRTaGFkaW5nKFxuICBjb25zdCBpbiBmbG9hdCBkb3ROTCxcbiAgY29uc3QgaW4gZmxvYXQgc2hhZG93LFxuICBjb25zdCBpbiBmbG9hdCBzaGFkaW5nU2hpZnRcbikge1xuICAvLyBDbGFzc2ljIE1Ub29uIFYxIHBhdGggKE5cdTAwQjdMIGluIFstMSwxXSBcdTIxOTIgbGluZWFyc3RlcCB3aWR0aCBmcm9tIHNoYWRpbmdUb29ueSlcbiAgZmxvYXQgZmFjZVNvZnRCaWFzID0gY2xhbXAoIGZhY2VTb2Z0LCAwLjAsIDEuMCApICogMC4wODtcbiAgZmxvYXQgc2hhZGluZ0NsYXNzaWMgPSBkb3ROTCArIHNoYWRpbmdTaGlmdCArIGZhY2VTb2Z0QmlhcztcbiAgc2hhZGluZ0NsYXNzaWMgPSBsaW5lYXJzdGVwKCAtMS4wICsgc2hhZGluZ1Rvb255RmFjdG9yLCAxLjAgLSBzaGFkaW5nVG9vbnlGYWN0b3IsIHNoYWRpbmdDbGFzc2ljICk7XG4gIHNoYWRpbmdDbGFzc2ljICo9IHNoYWRvdztcblxuICAvLyBTb2Z0IHBhdGggXHUyMjQ4IGV4dGVuZGVkOiBoYWxmLUxhbWJlcnQgKyBib3JkZXIvYmx1ciAoc21vb3RoZXJzdGVwIHRvIGF2b2lkIHJpcHBsZSBiYW5kcylcbiAgZmxvYXQgaGwgPSBjbGFtcCggZG90TkwgKiAwLjUgKyAwLjUsIDAuMCwgMS4wICk7XG4gIGZsb2F0IHNvZnRNaXggPSBjbGFtcCggc29mdE1peCwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgYm9yZGVyID0gKCBzaGFkb3dCb3JkZXIgPj0gMC4wIClcbiAgICA/IGNsYW1wKCBzaGFkb3dCb3JkZXIsIDAuMCwgMS4wIClcbiAgICA6IGNsYW1wKCAwLjUgLSAoIHNoYWRpbmdTaGlmdCArIGZhY2VTb2Z0QmlhcyApICogMC41IC0gZmFjZVNvZnRCaWFzICogMC4xNSwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgYmx1ciA9ICggc2hhZG93Qmx1ciA+IDAuMCApXG4gICAgPyBtYXgoIDAuMDAxLCBzaGFkb3dCbHVyIClcbiAgICA6IG1heCggMC4wMDEsICggMS4wIC0gc2hhZGluZ1Rvb255RmFjdG9yICkgKyBibHVyQm9vc3QgKTtcbiAgLy8gSGlnaCBzb2Z0TWl4ICsgbmFycm93IGJsdXIgXHUyMTkyIGNvbmNlbnRyaWMgaXNvLU5cdTAwQjdMIHJpcHBsZXMgb24gY3VydmVkIHNraW47IGVuZm9yY2UgZmxvb3JcbiAgYmx1ciA9IG1heCggYmx1ciwgbWl4KCAwLjA4LCAwLjI2LCBzb2Z0TWl4ICkgKTtcbiAgZmxvYXQgYm9yZGVyTWluID0gY2xhbXAoIGJvcmRlciAtIDAuNSAqIGJsdXIsIDAuMCwgMS4wICk7XG4gIGZsb2F0IGJvcmRlck1heCA9IGNsYW1wKCBib3JkZXIgKyAwLjUgKiBibHVyLCAwLjAsIDEuMCApO1xuICBmbG9hdCBzaGFkaW5nU29mdCA9IHNtb290aGVyc3RlcCggYm9yZGVyTWluLCBib3JkZXJNYXgsIGhsICk7XG4gIHNoYWRpbmdTb2Z0ICo9IHNoYWRvdztcblxuICByZXR1cm4gbWl4KCBzaGFkaW5nQ2xhc3NpYywgc2hhZGluZ1NvZnQsIHNvZnRNaXggKTtcbn1cblxuLyoqXG4gKiBNaXggZGlmZnVzZUNvbG9yIGFuZCBzaGFkZUNvbG9yIHVzaW5nIHNoYWRpbmcgZmFjdG9yIGFuZCBsaWdodCBjb2xvci5cbiAqIE1Ub29uOiBvcHRpb25hbCAybmQgc2hhZG93IGJhbmQgKGRhcmtlciBsZXJwKSBhcHByb3hpbWF0aW5nIGV4dGVuZGVkIF9TaGFkb3cybmQqLlxuICovXG52ZWMzIGdldERpZmZ1c2UoXG4gIGNvbnN0IGluIE1Ub29uTWF0ZXJpYWwgbWF0ZXJpYWwsXG4gIGNvbnN0IGluIGZsb2F0IHNoYWRpbmcsXG4gIGluIHZlYzMgbGlnaHRDb2xvcixcbiAgY29uc3QgaW4gZmxvYXQgZG90TkwsXG4gIGNvbnN0IGluIGZsb2F0IHNoYWRvd1xuKSB7XG4gICNpZmRlZiBERUJVR19MSVRTSEFERVJBVEVcbiAgICByZXR1cm4gdmVjMyggQlJERl9MYW1iZXJ0KCBzaGFkaW5nICogbGlnaHRDb2xvciApICk7XG4gICNlbmRpZlxuXG4gIC8vIE5QUiBfU2hhZG93TWFpblN0cmVuZ3RoOiBwdXNoIHNoYWRlIHRvd2FyZCBzaGFkZSAqIGFsYmVkbyBmb3IgcmljaGVyIHNvZnQgc2hhZGVcbiAgdmVjMyBzaGFkZVRlcm0gPSBtaXgoXG4gICAgbWF0ZXJpYWwuc2hhZGVDb2xvcixcbiAgICBtYXRlcmlhbC5zaGFkZUNvbG9yICogbWF0ZXJpYWwuZGlmZnVzZUNvbG9yLFxuICAgIGNsYW1wKCBzaGFkZU1haW5TdHJlbmd0aCwgMC4wLCAxLjAgKVxuICApO1xuICB2ZWMzIHNoYWRlTGl0ID0gbWl4KCBzaGFkZVRlcm0sIG1hdGVyaWFsLmRpZmZ1c2VDb2xvciwgc2hhZGluZyApO1xuXG4gIGZsb2F0IGhsID0gY2xhbXAoIGRvdE5MICogMC41ICsgMC41LCAwLjAsIDEuMCApO1xuXG5cbiAgZmxvYXQgYmFuZDIgPSBjbGFtcCggc2hhZG93Mm5kU3RyZW5ndGgsIDAuMCwgMS4wICkgKiAwLjcyO1xuICBmbG9hdCBibHVyMiA9IG1heCggMC4yMiwgc2hhZG93Mm5kQmx1ciApO1xuICBmbG9hdCBiMm1pbiA9IGNsYW1wKCBzaGFkb3cybmRCb3JkZXIgLSAwLjUgKiBibHVyMiwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgYjJtYXggPSBjbGFtcCggc2hhZG93Mm5kQm9yZGVyICsgMC41ICogYmx1cjIsIDAuMCwgMS4wICk7XG4gIGZsb2F0IHMyID0gc21vb3RoZXJzdGVwKCBiMm1pbiwgYjJtYXgsIGhsICkgKiBzaGFkb3c7XG4gIHNoYWRlTGl0ID0gbWl4KCBzaGFkZUxpdCwgbWl4KCBzaGFkZUxpdCAqIHNoYWRvdzJuZENvbG9yLCBzaGFkZUxpdCwgczIgKSwgYmFuZDIgKTtcblxuICBmbG9hdCBiYW5kMyA9IGNsYW1wKCBzaGFkb3czcmRTdHJlbmd0aCwgMC4wLCAxLjAgKSAqIDAuNTU7XG4gIGZsb2F0IGJsdXIzID0gbWF4KCAwLjIsIHNoYWRvdzNyZEJsdXIgKTtcbiAgZmxvYXQgYjNtaW4gPSBjbGFtcCggc2hhZG93M3JkQm9yZGVyIC0gMC41ICogYmx1cjMsIDAuMCwgMS4wICk7XG4gIGZsb2F0IGIzbWF4ID0gY2xhbXAoIHNoYWRvdzNyZEJvcmRlciArIDAuNSAqIGJsdXIzLCAwLjAsIDEuMCApO1xuICBmbG9hdCBzMyA9IHNtb290aGVyc3RlcCggYjNtaW4sIGIzbWF4LCBobCApICogc2hhZG93O1xuICBzaGFkZUxpdCA9IG1peCggc2hhZGVMaXQsIG1peCggc2hhZGVMaXQgKiBzaGFkb3czcmRDb2xvciwgc2hhZGVMaXQsIHMzICksIGJhbmQzICk7XG5cbiAgdmVjMyBjb2wgPSBsaWdodENvbG9yICogQlJERl9MYW1iZXJ0KCBzaGFkZUxpdCApO1xuICAvLyBsaWw6IGluZGlyZWN0Q29sID0gbWluKGluZGlyZWN0Q29sLCBkaXJlY3RDb2wpIFx1MjAxNCBrZWVwIHNvZnQgc2hhZGUgZnJvbSBibG93aW5nIHBhc3QgbGl0XG4gIHZlYzMgZGlyZWN0Q29sID0gbGlnaHRDb2xvciAqIEJSREZfTGFtYmVydCggbWF0ZXJpYWwuZGlmZnVzZUNvbG9yICk7XG4gIGNvbCA9IG1peCggY29sLCBtaW4oIGNvbCwgZGlyZWN0Q29sICksIGNsYW1wKCBzb2Z0TWl4LCAwLjAsIDEuMCApICk7XG4gIC8vIE5QUiBfU2hhZG93RW52U3RyZW5ndGg6IGxpZnQgc2hhZGUgdG93YXJkIGxpdCplbnYgc28gaW5kaXJlY3QgZG9lc24ndCBnbyBkZWFkLW1hdHRlXG4gIC8vIFNvZnQgZW52IGxpZnQgXHUyMDE0IGtlZXAgZmFjdG9yIGxvdyB0byBhdm9pZCBzdGVwcGVkIG1pZHRvbmUgXCJiYW5kc1wiIG9uIGJvZHlcbiAgY29sID0gbWl4KCBjb2wsIG1peCggY29sLCBkaXJlY3RDb2wsIDAuMjIgKSwgY2xhbXAoIGVudlN0cmVuZ3RoLCAwLjAsIDEuMCApICogMC42NSAqICggMS4wIC0gc2hhZGluZyApICk7XG5cbiAgLy8gVGhlIFwiY29tbWVudCBvdXQgaWYgeW91IHdhbnQgdG8gUEJSIGFic29sdXRlbHlcIiBsaW5lXG4gICNpZmRlZiBWMF9DT01QQVRfU0hBREVcbiAgICBjb2wgPSBtaW4oIGNvbCwgbWF0ZXJpYWwuZGlmZnVzZUNvbG9yICk7XG4gICNlbmRpZlxuXG4gIHJldHVybiBjb2w7XG59XG5cbi8qKlxuICogTGlnaHR3ZWlnaHQgc3RyZXRjaGVkIGhpZ2hsaWdodCAoS2FqaXlhLUtheS1pc2gpIGZvciBoYWlyIC8gYW5nZWwtcmluZyBzaGVlbi5cbiAqIER1YWwgbG9iZSAocHJpbWFyeSArIHNvZnRlciByaW5nKS4gR2F0ZWQgYnkgaGFpclNwZWNTdHJlbmd0aDsgbWFuYWdlciBrZWVwcyBmYWNlL2V5ZXMgYXQgMC5cbiAqL1xudmVjMyBnZXRIYWlyU3BlYyhcbiAgY29uc3QgaW4gdmVjMyBub3JtYWwsXG4gIGNvbnN0IGluIHZlYzMgbGlnaHREaXIsXG4gIGNvbnN0IGluIHZlYzMgdmlld0RpcixcbiAgY29uc3QgaW4gdmVjMyBsaWdodENvbG9yLFxuICBjb25zdCBpbiBmbG9hdCBzaGFkaW5nXG4pIHtcbiAgZmxvYXQgc3RyZW5ndGggPSBoYWlyU3BlY1N0cmVuZ3RoO1xuICBpZiAoIHN0cmVuZ3RoIDw9IDAuMDAwMSApIHtcbiAgICByZXR1cm4gdmVjMyggMC4wICk7XG4gIH1cbiAgdmVjMyB0ID0gY3Jvc3MoIG5vcm1hbCwgdmVjMyggMC4wLCAxLjAsIDAuMCApICk7XG4gIGZsb2F0IHRMZW4gPSBsZW5ndGgoIHQgKTtcbiAgaWYgKCB0TGVuIDwgMWUtMyApIHtcbiAgICB0ID0gY3Jvc3MoIG5vcm1hbCwgdmVjMyggMS4wLCAwLjAsIDAuMCApICk7XG4gICAgdExlbiA9IGxlbmd0aCggdCApO1xuICB9XG4gIHQgLz0gbWF4KCB0TGVuLCAxZS01ICk7XG4gIHZlYzMgaCA9IG5vcm1hbGl6ZSggbGlnaHREaXIgKyB2aWV3RGlyICk7XG4gIGZsb2F0IHRoID0gZG90KCB0LCBoICk7XG4gIGZsb2F0IHBvd2VyID0gbWF4KCAxLjAsIGhhaXJTcGVjUG93ZXIgKTtcbiAgZmxvYXQgYW5pc28xID0gcG93KCBzcXJ0KCBtYXgoIDAuMCwgMS4wIC0gKCB0aCArIGhhaXJTcGVjU2hpZnQgKSAqICggdGggKyBoYWlyU3BlY1NoaWZ0ICkgKSApLCBwb3dlciApO1xuICAvLyBTdHJvbmdlciBzZWNvbmRhcnkgbG9iZSAoYW5nZWwtcmluZy1pc2gpIHNoaWZ0ZWQgdGhlIG90aGVyIHdheVxuICBmbG9hdCBzaGlmdDIgPSBoYWlyU3BlY1NoaWZ0ICsgMC4yO1xuICBmbG9hdCBhbmlzbzIgPSBwb3coIHNxcnQoIG1heCggMC4wLCAxLjAgLSAoIHRoICsgc2hpZnQyICkgKiAoIHRoICsgc2hpZnQyICkgKSApLCBwb3dlciAqIDAuNSApO1xuICBmbG9hdCBhbmlzbyA9IGFuaXNvMSArIDAuNTUgKiBhbmlzbzI7XG4gIC8vIFNvZnRlbiBieSB0b29uIHNoYWRpbmcgc28gZGVlcCBzaGFkZSBzdGF5cyBtYXR0ZVxuICByZXR1cm4gbGlnaHRDb2xvciAqICggYW5pc28gKiBzdHJlbmd0aCAqIG1peCggMC4zNSwgMS4wLCBzaGFkaW5nICkgKTtcbn1cblxuLyoqXG4gKiBMaWdodCBHR1gtaXNoIGlzb3Ryb3BpYyBsb2JlIGZvciBjbG90aCAvIHNhdGluIC8gYm93cyAoZXh0ZW5kZWQgc2hpbmllciByZWFkKS5cbiAqIFVzZXMgU2NobGljay1HR1ggRCBhcHByb3ggd2l0aCByb3VnaG5lc3MgZnJvbSBDbG90aFNwZWNQb3dlcjsgc3RyZW5ndGggMCBcdTIxOTIgbm9vcC5cbiAqL1xudmVjMyBnZXRDbG90aFNwZWMoXG4gIGNvbnN0IGluIHZlYzMgbm9ybWFsLFxuICBjb25zdCBpbiB2ZWMzIGxpZ2h0RGlyLFxuICBjb25zdCBpbiB2ZWMzIHZpZXdEaXIsXG4gIGNvbnN0IGluIHZlYzMgbGlnaHRDb2xvcixcbiAgY29uc3QgaW4gZmxvYXQgc2hhZGluZ1xuKSB7XG4gIGZsb2F0IHN0cmVuZ3RoID0gY2xvdGhTcGVjU3RyZW5ndGg7XG4gIGlmICggc3RyZW5ndGggPD0gMC4wMDAxICkge1xuICAgIHJldHVybiB2ZWMzKCAwLjAgKTtcbiAgfVxuICB2ZWMzIGggPSBub3JtYWxpemUoIGxpZ2h0RGlyICsgdmlld0RpciApO1xuICBmbG9hdCBuaCA9IGNsYW1wKCBkb3QoIG5vcm1hbCwgaCApLCAwLjAsIDEuMCApO1xuICAvLyBNYXAgcG93ZXIgKH4zMi4uMTI4KSBcdTIxOTIgcm91Z2huZXNzICh+MC4zNS4uMC4wOCk7IHRoZW4gR0dYIERcbiAgZmxvYXQgcG93ZXIgPSBtYXgoIDguMCwgY2xvdGhTcGVjUG93ZXIgKTtcbiAgZmxvYXQgcm91Z2ggPSBjbGFtcCggMS4wIC8gc3FydCggcG93ZXIgKSwgMC4wNiwgMC40NSApO1xuICBmbG9hdCBhID0gcm91Z2ggKiByb3VnaDtcbiAgZmxvYXQgYTIgPSBhICogYTtcbiAgZmxvYXQgbmgyID0gbmggKiBuaDtcbiAgZmxvYXQgZGVub20gPSBuaDIgKiAoIGEyIC0gMS4wICkgKyAxLjA7XG4gIGZsb2F0IEQgPSBhMiAvIG1heCggMy4xNDE1OTI2NSAqIGRlbm9tICogZGVub20sIDFlLTUgKTtcbiAgLy8gVGlueSBTY2hsaWNrIEZyZXNuZWwgYXQgZ3JhemluZyBmb3Igc2F0aW4gcmVhZFxuICBmbG9hdCB2aCA9IGNsYW1wKCBkb3QoIHZpZXdEaXIsIGggKSwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgRiA9IDAuMDQgKyAwLjk2ICogcG93KCAxLjAgLSB2aCwgNS4wICk7XG4gIGZsb2F0IHNwZWMgPSBEICogRjtcbiAgcmV0dXJuIGxpZ2h0Q29sb3IgKiAoIHNwZWMgKiBzdHJlbmd0aCAqIG1peCggMC4yLCAxLjAsIHNoYWRpbmcgKSApO1xufVxuXG4vKipcbiAqIElzb3Ryb3BpYyBtb2lzdC9oeWRyYXRlZCBza2luIHNwZWN1bGFyIChOUFIgc29mdCBTcGVjdWxhclRvb24taXNoKS5cbiAqIEJyb2FkLCBsb3cgc3RyZW5ndGgsIG1pbGQgZnJlc25lbCBzaGVlbiBcdTIwMTQgTk9UIGhhaXIgYW5pc290cm9weS5cbiAqL1xudmVjMyBnZXRTa2luU3BlYyhcbiAgY29uc3QgaW4gdmVjMyBub3JtYWwsXG4gIGNvbnN0IGluIHZlYzMgbGlnaHREaXIsXG4gIGNvbnN0IGluIHZlYzMgdmlld0RpcixcbiAgY29uc3QgaW4gdmVjMyBsaWdodENvbG9yLFxuICBjb25zdCBpbiBmbG9hdCBzaGFkaW5nXG4pIHtcbiAgZmxvYXQgc3RyZW5ndGggPSBza2luU3BlY1N0cmVuZ3RoO1xuICBpZiAoIHN0cmVuZ3RoIDw9IDAuMDAwMSApIHtcbiAgICByZXR1cm4gdmVjMyggMC4wICk7XG4gIH1cbiAgdmVjMyBoID0gbm9ybWFsaXplKCBsaWdodERpciArIHZpZXdEaXIgKTtcbiAgZmxvYXQgbmggPSBjbGFtcCggZG90KCBub3JtYWwsIGggKSwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgbnYgPSBjbGFtcCggZG90KCBub3JtYWwsIHZpZXdEaXIgKSwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgbmwgPSBjbGFtcCggZG90KCBub3JtYWwsIGxpZ2h0RGlyICksIDAuMCwgMS4wICk7XG4gIGZsb2F0IHBvd2VyID0gbWF4KCAxNi4wLCBza2luU3BlY1Bvd2VyICk7XG4gIC8vIENvbnRpbnVvdXMgc21vb3RoIEJsaW5uIGxvYmUgXHUyMDE0IGNsYW1wZWQgYW5kIHNvZnRseSBhdHRlbnVhdGVkIHRvIHByZXZlbnQgaGFyc2ggY2lyY3VsYXIgd2hpdGUgc3BvdFxuICBmbG9hdCBsb2JlID0gcG93KCBuaCwgcG93ZXIgKTtcbiAgbG9iZSA9IHNtb290aHN0ZXAoIDAuMDUsIDAuOTUsIGxvYmUgKSAqIDAuNztcbiAgZmxvYXQgRiA9IDAuMDQgKyAwLjk2ICogcG93KCAxLjAgLSBudiwgNC4wICk7XG4gIGZsb2F0IHNoZWVuID0gbWl4KCAwLjQsIEYsIGNsYW1wKCBza2luU3BlY0ZyZXNuZWwsIDAuMCwgMS4wICkgKTtcbiAgZmxvYXQgbGl0R2F0ZSA9IHNtb290aHN0ZXAoIDAuMSwgMC44LCBzaGFkaW5nICkgKiBjbGFtcCggbmwsIDAuMCwgMS4wICk7XG4gIHJldHVybiBsaWdodENvbG9yICogc2tpblNwZWNDb2xvciAqICggbG9iZSAqIHNoZWVuICogc3RyZW5ndGggKiBsaXRHYXRlICk7XG59XG5cbi8qKlxuICogR3JhemluZy1hbmdsZSB2ZWx2ZXQgLyBmYWJyaWMgc2hlZW4gYXBwcm94aW1hdGlvbiAobGlsVG9vbiBjbG90aCBmZWVsKS5cbiAqIEFkZHMgcmljaCBzb2Z0IGVkZ2UgZ2xvdyB0byBjaGVvbmdzYW0gLyBzYXRpbiBkcmVzc2VzIHdpdGhvdXQgZXh0cmEgdGV4dHVyZXMuXG4gKi9cbnZlYzMgZ2V0RmFicmljU2hlZW4oXG4gIGNvbnN0IGluIHZlYzMgbm9ybWFsLFxuICBjb25zdCBpbiB2ZWMzIHZpZXdEaXIsXG4gIGNvbnN0IGluIHZlYzMgbGlnaHRDb2xvclxuKSB7XG4gIGlmICggZmFicmljU2hlZW5TdHJlbmd0aCA8PSAwLjAwMDEgKSB7XG4gICAgcmV0dXJuIHZlYzMoIDAuMCApO1xuICB9XG4gIGZsb2F0IG52ID0gY2xhbXAoIDEuMCAtIGFicyggZG90KCBub3JtYWwsIHZpZXdEaXIgKSApLCAwLjAsIDEuMCApO1xuICBmbG9hdCBzaGVlbiA9IHBvdyggbnYsIG1heCggMC41LCBmYWJyaWNTaGVlblBvd2VyICkgKTtcbiAgcmV0dXJuIGxpZ2h0Q29sb3IgKiBmYWJyaWNTaGVlbkNvbG9yICogKCBzaGVlbiAqIGZhYnJpY1NoZWVuU3RyZW5ndGggKTtcbn1cblxuLyoqXG4gKiBsaWxDYWxjU3BlY3VsYXItbGlrZSB0b29uIHNwZWN1bGFyIGZyb20gTVRvb24gcHJveGllcyAoc21vb3RobmVzcy9tZXRhbGxpYyB2aWEgdW5pZm9ybXMpLlxuICogTm8gY3ViZW1hcCBcdTIwMTQgc3RpbGwgYWRkcyBkaXJlY3Rpb25hbCBoaWdobGlnaHQgZW5lcmd5IE5QUiB1c2VycyBleHBlY3QuXG4gKi9cbnZlYzMgZ2V0VG9vblNwZWN1bGFyKFxuICBjb25zdCBpbiB2ZWMzIG5vcm1hbCxcbiAgY29uc3QgaW4gdmVjMyBsaWdodERpcixcbiAgY29uc3QgaW4gdmVjMyB2aWV3RGlyLFxuICBjb25zdCBpbiB2ZWMzIGxpZ2h0Q29sb3IsXG4gIGNvbnN0IGluIHZlYzMgYWxiZWRvLFxuICBjb25zdCBpbiBmbG9hdCBzaGFkaW5nXG4pIHtcbiAgZmxvYXQgc3RyZW5ndGggPSBzcGVjdWxhclN0cmVuZ3RoO1xuICBpZiAoIHN0cmVuZ3RoIDw9IDAuMDAwMSApIHtcbiAgICByZXR1cm4gdmVjMyggMC4wICk7XG4gIH1cbiAgdmVjMyBoID0gbm9ybWFsaXplKCBsaWdodERpciArIHZpZXdEaXIgKTtcbiAgZmxvYXQgbmggPSBjbGFtcCggZG90KCBub3JtYWwsIGggKSwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgbmwgPSBjbGFtcCggZG90KCBub3JtYWwsIGxpZ2h0RGlyICksIDAuMCwgMS4wICk7XG4gIGZsb2F0IGxoID0gY2xhbXAoIGRvdCggbGlnaHREaXIsIGggKSwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgcG93ZXIgPSBtYXgoIDQuMCwgc3BlY3VsYXJQb3dlciApO1xuICBmbG9hdCBsb2JlID0gcG93KCBuaCwgcG93ZXIgKTtcbiAgZmxvYXQgYm9yZGVyID0gY2xhbXAoIHNwZWN1bGFyQm9yZGVyLCAwLjAsIDEuMCApO1xuICBmbG9hdCBibHVyID0gbWF4KCAwLjAwMSwgc3BlY3VsYXJCbHVyICk7XG4gIGxvYmUgPSBsaW5lYXJzdGVwKCBib3JkZXIgLSAwLjUgKiBibHVyLCBib3JkZXIgKyAwLjUgKiBibHVyLCBsb2JlICk7XG4gIC8vIFNjaGxpY2sgRjAgZnJvbSBtZXRhbGxpYyBwcm94eVxuICBmbG9hdCBtZXRhbGxpYyA9IGNsYW1wKCByZWZsZWN0TWV0YWxsaWMsIDAuMCwgMS4wICk7XG4gIHZlYzMgZjAgPSBtaXgoIHZlYzMoIDAuMDQgKSwgYWxiZWRvLCBtZXRhbGxpYyApO1xuICB2ZWMzIEYgPSBmMCArICggMS4wIC0gZjAgKSAqIHBvdyggMS4wIC0gbGgsIDUuMCApO1xuICBmbG9hdCBnYXRlID0gbWl4KCAwLjE1LCAxLjAsIHNoYWRpbmcgKSAqIG5sO1xuICByZXR1cm4gbGlnaHRDb2xvciAqIEYgKiAoIGxvYmUgKiBzdHJlbmd0aCAqIGdhdGUgKTtcbn1cblxuLyoqXG4gKiBWaWV3LWRlcGVuZGVudCBlbnYgcmVmbGVjdGlvbiBhcHByb3hpbWF0aW9uIHdpdGhvdXQgY3ViZW1hcC9QTVJFTS5cbiAqIFVzZXMgZnJlc25lbCArIHNtb290aG5lc3MgdG8gdGludCB0b3dhcmQgYWxiZWRvL2xpZ2h0IFx1MjAxNCBiZXR0ZXIgdGhhbiBmbGF0IG1hdHRlLlxuICovXG52ZWMzIGdldEVudlJlZmxlY3RBcHByb3goXG4gIGNvbnN0IGluIHZlYzMgbm9ybWFsLFxuICBjb25zdCBpbiB2ZWMzIHZpZXdEaXIsXG4gIGNvbnN0IGluIHZlYzMgbGlnaHRDb2xvcixcbiAgY29uc3QgaW4gdmVjMyBhbGJlZG8sXG4gIGNvbnN0IGluIGZsb2F0IHNoYWRpbmdcbikge1xuICBmbG9hdCBzdHJlbmd0aCA9IHJlZmxlY3RTdHJlbmd0aDtcbiAgaWYgKCBzdHJlbmd0aCA8PSAwLjAwMDEgKSB7XG4gICAgcmV0dXJuIHZlYzMoIDAuMCApO1xuICB9XG4gIGZsb2F0IG52ID0gY2xhbXAoIGRvdCggbm9ybWFsLCB2aWV3RGlyICksIDAuMCwgMS4wICk7XG4gIGZsb2F0IHNtb290aG4gPSBjbGFtcCggcmVmbGVjdFNtb290aG5lc3MsIDAuMCwgMS4wICk7XG4gIGZsb2F0IGZyZXNBbXQgPSBjbGFtcCggcmVmbGVjdEZyZXNuZWwsIDAuMCwgMS4wICk7XG4gIGZsb2F0IG1ldGFsbGljID0gY2xhbXAoIHJlZmxlY3RNZXRhbGxpYywgMC4wLCAxLjAgKTtcbiAgZmxvYXQgZnJlcyA9IHBvdyggMS4wIC0gbnYsIG1peCggMy4wLCA1LjAsIHNtb290aG4gKSApO1xuICBmcmVzID0gbWl4KCBmcmVzICogMC4zNSwgZnJlcywgZnJlc0FtdCApO1xuICAvLyBTb2Z0IGVudiBzdGFuZC1pbjogdXB3YXJkIGhlbWlzcGhlcmUgb25seSAobmV2ZXIgdHJlYXQgbGlnaHRDb2xvciBhcyBhIGRpcmVjdGlvbiBcdTIwMTRcbiAgLy8gdGhhdCBjYXVzZWQgYmxvdGNoeS9yaXBwbGVkIGxpZ2h0aW5nIHdoZW4gUkdCIHZhcmllZCkuXG4gIHZlYzMgciA9IHJlZmxlY3QoIC12aWV3RGlyLCBub3JtYWwgKTtcbiAgZmxvYXQgdXAgPSBjbGFtcCggci55ICogMC41ICsgMC41LCAwLjAsIDEuMCApO1xuICBmbG9hdCBlbnZMb2JlID0gcG93KCB1cCwgbWl4KCAxLjIsIDMuNSwgc21vb3RobiApICk7XG4gIHZlYzMgZW52Q29sID0gbWl4KCB2ZWMzKCAwLjc4LCAwLjgwLCAwLjg2ICksIGFsYmVkbywgbWV0YWxsaWMgKiAwLjUgKTtcbiAgZW52Q29sID0gbWl4KCBlbnZDb2wsIGxpZ2h0Q29sb3IsIDAuMiApO1xuICBmbG9hdCBnYXRlID0gbWl4KCAwLjQ1LCAxLjAsIHNoYWRpbmcgKTtcbiAgcmV0dXJuIGVudkNvbCAqICggZnJlcyAqIGVudkxvYmUgKiBzdHJlbmd0aCAqIGdhdGUgKiAwLjg1ICk7XG59XG5cbi8qKlxuICogTlBSIGJhY2tsaWdodDogd3JhcCBsaWdodGluZyBmcm9tIG9wcG9zaXRlIGhlbWlzcGhlcmUgKG5vIGV4dHJhIHRleCkuXG4gKi9cbnZlYzMgZ2V0QmFja2xpZ2h0KFxuICBjb25zdCBpbiB2ZWMzIG5vcm1hbCxcbiAgY29uc3QgaW4gdmVjMyBsaWdodERpcixcbiAgY29uc3QgaW4gdmVjMyB2aWV3RGlyLFxuICBjb25zdCBpbiB2ZWMzIGxpZ2h0Q29sb3IsXG4gIGNvbnN0IGluIHZlYzMgYWxiZWRvXG4pIHtcbiAgZmxvYXQgc3RyZW5ndGggPSBiYWNrbGlnaHRTdHJlbmd0aDtcbiAgaWYgKCBzdHJlbmd0aCA8PSAwLjAwMDEgKSB7XG4gICAgcmV0dXJuIHZlYzMoIDAuMCApO1xuICB9XG4gIC8vIE9wcG9zaXRlLWxpZ2h0IGhhbGYtTGFtYmVydCB3aXRoIG1pbGQgdmlldyB3cmFwXG4gIHZlYzMgTGJhY2sgPSBub3JtYWxpemUoIC1saWdodERpciArIHZpZXdEaXIgKiAwLjI1ICk7XG4gIGZsb2F0IGhsID0gY2xhbXAoIGRvdCggbm9ybWFsLCBMYmFjayApICogMC41ICsgMC41LCAwLjAsIDEuMCApO1xuICBmbG9hdCBib3JkZXIgPSAwLjU1O1xuICBmbG9hdCBibHVyID0gMC4zNTtcbiAgZmxvYXQgZmFjdG9yID0gbGluZWFyc3RlcCggYm9yZGVyIC0gMC41ICogYmx1ciwgYm9yZGVyICsgMC41ICogYmx1ciwgaGwgKTtcbiAgLy8gRGlyZWN0aXZpdHk6IHN0cm9uZ2VyIHdoZW4gTiBwb2ludHMgYXdheSBmcm9tIG1haW4gbGlnaHRcbiAgZmxvYXQgYXdheSA9IGNsYW1wKCAtZG90KCBub3JtYWwsIGxpZ2h0RGlyICkgKiAwLjUgKyAwLjUsIDAuMCwgMS4wICk7XG4gIGZhY3RvciAqPSBwb3coIGF3YXksIDEuNSApO1xuICB2ZWMzIGNvbCA9IG1peCggYmFja2xpZ2h0Q29sb3IsIGJhY2tsaWdodENvbG9yICogYWxiZWRvLCAwLjQ1ICk7XG4gIHJldHVybiBsaWdodENvbG9yICogY29sICogKCBmYWN0b3IgKiBzdHJlbmd0aCApO1xufVxuXG4vKipcbiAqIEdlbS1pc2ggZnJlc25lbCBzcGFya2xlIHByb3h5IFx1MjAxNCBvbmx5IHdoZW4gZXhwbGljaXRseSBlbmFibGVkOyBzYWZlIGZvciBjbG90aC9za2luIGF0IDAuXG4gKi9cbnZlYzMgZ2V0R2VtRnJlc25lbFByb3h5KFxuICBjb25zdCBpbiB2ZWMzIG5vcm1hbCxcbiAgY29uc3QgaW4gdmVjMyB2aWV3RGlyLFxuICBjb25zdCBpbiB2ZWMzIGxpZ2h0Q29sb3IsXG4gIGNvbnN0IGluIHZlYzMgYWxiZWRvXG4pIHtcbiAgZmxvYXQgc3RyZW5ndGggPSBnZW1GcmVzbmVsO1xuICBpZiAoIHN0cmVuZ3RoIDw9IDAuMDAwMSApIHtcbiAgICByZXR1cm4gdmVjMyggMC4wICk7XG4gIH1cbiAgZmxvYXQgbnYgPSBjbGFtcCggZG90KCBub3JtYWwsIHZpZXdEaXIgKSwgMC4wLCAxLjAgKTtcbiAgZmxvYXQgZnJlcyA9IHBvdyggMS4wIC0gbnYsIDQuMCApO1xuICAvLyBDaHJvbWF0aWMtaXNoIHNwbGl0IHZpYSBhbGJlZG8gY2hhbm5lbHMgKGxpZ2h0d2VpZ2h0LCBubyBleHRyYSB0ZXgpXG4gIHZlYzMgY2hyb21hID0gbm9ybWFsaXplKCBhbGJlZG8gKyB2ZWMzKCAwLjA1LCAwLjA4LCAwLjEyICkgKTtcbiAgcmV0dXJuIGxpZ2h0Q29sb3IgKiBjaHJvbWEgKiAoIGZyZXMgKiBzdHJlbmd0aCApO1xufVxuXG4vLyBDT01QQVQ6IHByZS1yMTU2IHVzZXMgYSBzdHJ1Y3QgR2VvbWV0cmljQ29udGV4dFxuI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTdcbiAgdm9pZCBSRV9EaXJlY3RfTVRvb24oIGNvbnN0IGluIEluY2lkZW50TGlnaHQgZGlyZWN0TGlnaHQsIGNvbnN0IGluIHZlYzMgZ2VvbWV0cnlQb3NpdGlvbiwgY29uc3QgaW4gdmVjMyBnZW9tZXRyeU5vcm1hbCwgY29uc3QgaW4gdmVjMyBnZW9tZXRyeVZpZXdEaXIsIGNvbnN0IGluIHZlYzMgZ2VvbWV0cnlDbGVhcmNvYXROb3JtYWwsIGNvbnN0IGluIE1Ub29uTWF0ZXJpYWwgbWF0ZXJpYWwsIGNvbnN0IGluIGZsb2F0IHNoYWRvdywgaW5vdXQgUmVmbGVjdGVkTGlnaHQgcmVmbGVjdGVkTGlnaHQgKSB7XG4gICAgZmxvYXQgZG90TkwgPSBjbGFtcCggZG90KCBnZW9tZXRyeU5vcm1hbCwgZGlyZWN0TGlnaHQuZGlyZWN0aW9uICksIC0xLjAsIDEuMCApO1xuICAgIHZlYzMgaXJyYWRpYW5jZSA9IGRpcmVjdExpZ2h0LmNvbG9yO1xuXG4gICAgLy8gZGlyZWN0U3BlY3VsYXIgd2lsbCBiZSB1c2VkIGZvciByaW0gbGlnaHRpbmcsIG5vdCBhbiBhY3R1YWwgc3BlY3VsYXJcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3RTcGVjdWxhciArPSBpcnJhZGlhbmNlO1xuXG4gICAgaXJyYWRpYW5jZSAqPSBkb3ROTDtcblxuICAgIC8vIFx1OTc2Mlx1OTBFOFx1OTYzNFx1NUY3MVx1OTY5NFx1NzlCQlx1RkYxQXJlY2VpdmVTaGFkb3dSYXRlID0gMCBcdTY1RjZcdTVGRkRcdTc1NjUgc2hhZG93bWFwIFx1NjI5NVx1NUMwNFx1OTYzNFx1NUY3MVx1RkYwQ1x1OTc2Mlx1OTBFOFx1NEZERFx1NjMwMVx1NzY3RFx1NTFDMFxuICAgIGZsb2F0IGVmZmVjdGl2ZVNoYWRvdyA9IG1peCggMS4wLCBzaGFkb3csIGNsYW1wKCByZWNlaXZlU2hhZG93UmF0ZSwgMC4wLCAxLjAgKSApO1xuXG4gICAgZmxvYXQgc2hhZGluZyA9IGdldFNoYWRpbmcoIGRvdE5MLCBlZmZlY3RpdmVTaGFkb3csIG1hdGVyaWFsLnNoYWRpbmdTaGlmdCApO1xuXG4gICAgLy8gdG9vbiBzaGFkZWQgZGlmZnVzZSAoKyBvcHRpb25hbCAybmQgYmFuZCBpbnNpZGUgZ2V0RGlmZnVzZSlcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldERpZmZ1c2UoIG1hdGVyaWFsLCBzaGFkaW5nLCBkaXJlY3RMaWdodC5jb2xvciwgZG90TkwsIGVmZmVjdGl2ZVNoYWRvdyApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0SGFpclNwZWMoIGdlb21ldHJ5Tm9ybWFsLCBkaXJlY3RMaWdodC5kaXJlY3Rpb24sIGdlb21ldHJ5Vmlld0RpciwgZGlyZWN0TGlnaHQuY29sb3IsIHNoYWRpbmcgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldENsb3RoU3BlYyggZ2VvbWV0cnlOb3JtYWwsIGRpcmVjdExpZ2h0LmRpcmVjdGlvbiwgZ2VvbWV0cnlWaWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciwgc2hhZGluZyApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0RmFicmljU2hlZW4oIGdlb21ldHJ5Tm9ybWFsLCBnZW9tZXRyeVZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yICk7XG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXRTa2luU3BlYyggZ2VvbWV0cnlOb3JtYWwsIGRpcmVjdExpZ2h0LmRpcmVjdGlvbiwgZ2VvbWV0cnlWaWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciwgc2hhZGluZyApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0VG9vblNwZWN1bGFyKCBnZW9tZXRyeU5vcm1hbCwgZGlyZWN0TGlnaHQuZGlyZWN0aW9uLCBnZW9tZXRyeVZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yLCBtYXRlcmlhbC5kaWZmdXNlQ29sb3IsIHNoYWRpbmcgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldEVudlJlZmxlY3RBcHByb3goIGdlb21ldHJ5Tm9ybWFsLCBnZW9tZXRyeVZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yLCBtYXRlcmlhbC5kaWZmdXNlQ29sb3IsIHNoYWRpbmcgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldEJhY2tsaWdodCggZ2VvbWV0cnlOb3JtYWwsIGRpcmVjdExpZ2h0LmRpcmVjdGlvbiwgZ2VvbWV0cnlWaWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciwgbWF0ZXJpYWwuZGlmZnVzZUNvbG9yICk7XG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXRHZW1GcmVzbmVsUHJveHkoIGdlb21ldHJ5Tm9ybWFsLCBnZW9tZXRyeVZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yLCBtYXRlcmlhbC5kaWZmdXNlQ29sb3IgKTtcbiAgfVxuXG4gIHZvaWQgUkVfSW5kaXJlY3REaWZmdXNlX01Ub29uKCBjb25zdCBpbiB2ZWMzIGlycmFkaWFuY2UsIGNvbnN0IGluIHZlYzMgZ2VvbWV0cnlQb3NpdGlvbiwgY29uc3QgaW4gdmVjMyBnZW9tZXRyeU5vcm1hbCwgY29uc3QgaW4gdmVjMyBnZW9tZXRyeVZpZXdEaXIsIGNvbnN0IGluIHZlYzMgZ2VvbWV0cnlDbGVhcmNvYXROb3JtYWwsIGNvbnN0IGluIE1Ub29uTWF0ZXJpYWwgbWF0ZXJpYWwsIGlub3V0IFJlZmxlY3RlZExpZ2h0IHJlZmxlY3RlZExpZ2h0ICkge1xuICAgIC8vIFZSTSBHSSBlcXVhbGl6YXRpb246IGZsYXR0ZW4gaXJyYWRpYW5jZSB0b3dhcmQgbHVtYSBhdmVyYWdlIChicmlnaHRlciBzb2Z0IE5QUiBhbWJpZW50KVxuICAgIGZsb2F0IGdpQXZnID0gKCBpcnJhZGlhbmNlLnIgKyBpcnJhZGlhbmNlLmcgKyBpcnJhZGlhbmNlLmIgKSAqICggMS4wIC8gMy4wICk7XG4gICAgdmVjMyBnaSA9IG1peCggaXJyYWRpYW5jZSwgdmVjMyggZ2lBdmcgKSwgY2xhbXAoIGdpRXF1YWxpemF0aW9uRmFjdG9yLCAwLjAsIDEuMCApICk7XG4gICAgZ2kgKj0gKCAxLjAgKyBtYXgoIDAuMCwgYW1iaWVudExpZnQgKSApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmluZGlyZWN0RGlmZnVzZSArPSBnaSAqIEJSREZfTGFtYmVydCggbWF0ZXJpYWwuZGlmZnVzZUNvbG9yICk7XG5cbiAgICAvLyBkaXJlY3RTcGVjdWxhciB3aWxsIGJlIHVzZWQgZm9yIHJpbSBsaWdodGluZywgbm90IGFuIGFjdHVhbCBzcGVjdWxhclxuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdFNwZWN1bGFyICs9IGlycmFkaWFuY2U7XG4gIH1cbiNlbHNlXG4gIHZvaWQgUkVfRGlyZWN0X01Ub29uKCBjb25zdCBpbiBJbmNpZGVudExpZ2h0IGRpcmVjdExpZ2h0LCBjb25zdCBpbiBHZW9tZXRyaWNDb250ZXh0IGdlb21ldHJ5LCBjb25zdCBpbiBNVG9vbk1hdGVyaWFsIG1hdGVyaWFsLCBjb25zdCBpbiBmbG9hdCBzaGFkb3csIGlub3V0IFJlZmxlY3RlZExpZ2h0IHJlZmxlY3RlZExpZ2h0ICkge1xuICAgIGZsb2F0IGRvdE5MID0gY2xhbXAoIGRvdCggZ2VvbWV0cnkubm9ybWFsLCBkaXJlY3RMaWdodC5kaXJlY3Rpb24gKSwgLTEuMCwgMS4wICk7XG4gICAgdmVjMyBpcnJhZGlhbmNlID0gZGlyZWN0TGlnaHQuY29sb3I7XG5cbiAgICAvLyBkaXJlY3RTcGVjdWxhciB3aWxsIGJlIHVzZWQgZm9yIHJpbSBsaWdodGluZywgbm90IGFuIGFjdHVhbCBzcGVjdWxhclxuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdFNwZWN1bGFyICs9IGlycmFkaWFuY2U7XG5cbiAgICBpcnJhZGlhbmNlICo9IGRvdE5MO1xuXG4gICAgLy8gXHU5NzYyXHU5MEU4XHU5NjM0XHU1RjcxXHU5Njk0XHU3OUJCXHVGRjFBcmVjZWl2ZVNoYWRvd1JhdGUgPSAwIFx1NjVGNlx1NUZGRFx1NzU2NSBzaGFkb3dtYXAgXHU2Mjk1XHU1QzA0XHU5NjM0XHU1RjcxXHVGRjBDXHU5NzYyXHU5MEU4XHU0RkREXHU2MzAxXHU3NjdEXHU1MUMwXG4gICAgZmxvYXQgZWZmZWN0aXZlU2hhZG93ID0gbWl4KCAxLjAsIHNoYWRvdywgY2xhbXAoIHJlY2VpdmVTaGFkb3dSYXRlLCAwLjAsIDEuMCApICk7XG5cbiAgICBmbG9hdCBzaGFkaW5nID0gZ2V0U2hhZGluZyggZG90TkwsIGVmZmVjdGl2ZVNoYWRvdywgbWF0ZXJpYWwuc2hhZGluZ1NoaWZ0ICk7XG5cbiAgICAvLyB0b29uIHNoYWRlZCBkaWZmdXNlICgrIG9wdGlvbmFsIDJuZCBiYW5kIGluc2lkZSBnZXREaWZmdXNlKVxuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0RGlmZnVzZSggbWF0ZXJpYWwsIHNoYWRpbmcsIGRpcmVjdExpZ2h0LmNvbG9yLCBkb3ROTCwgZWZmZWN0aXZlU2hhZG93ICk7XG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXRIYWlyU3BlYyggZ2VvbWV0cnkubm9ybWFsLCBkaXJlY3RMaWdodC5kaXJlY3Rpb24sIGdlb21ldHJ5LnZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yLCBzaGFkaW5nICk7XG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArPSBnZXRDbG90aFNwZWMoIGdlb21ldHJ5Lm5vcm1hbCwgZGlyZWN0TGlnaHQuZGlyZWN0aW9uLCBnZW9tZXRyeS52aWV3RGlyLCBkaXJlY3RMaWdodC5jb2xvciwgc2hhZGluZyApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0RmFicmljU2hlZW4oIGdlb21ldHJ5Lm5vcm1hbCwgZ2VvbWV0cnkudmlld0RpciwgZGlyZWN0TGlnaHQuY29sb3IgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldFNraW5TcGVjKCBnZW9tZXRyeS5ub3JtYWwsIGRpcmVjdExpZ2h0LmRpcmVjdGlvbiwgZ2VvbWV0cnkudmlld0RpciwgZGlyZWN0TGlnaHQuY29sb3IsIHNoYWRpbmcgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldFRvb25TcGVjdWxhciggZ2VvbWV0cnkubm9ybWFsLCBkaXJlY3RMaWdodC5kaXJlY3Rpb24sIGdlb21ldHJ5LnZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yLCBtYXRlcmlhbC5kaWZmdXNlQ29sb3IsIHNoYWRpbmcgKTtcbiAgICByZWZsZWN0ZWRMaWdodC5kaXJlY3REaWZmdXNlICs9IGdldEVudlJlZmxlY3RBcHByb3goIGdlb21ldHJ5Lm5vcm1hbCwgZ2VvbWV0cnkudmlld0RpciwgZGlyZWN0TGlnaHQuY29sb3IsIG1hdGVyaWFsLmRpZmZ1c2VDb2xvciwgc2hhZGluZyApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0QmFja2xpZ2h0KCBnZW9tZXRyeS5ub3JtYWwsIGRpcmVjdExpZ2h0LmRpcmVjdGlvbiwgZ2VvbWV0cnkudmlld0RpciwgZGlyZWN0TGlnaHQuY29sb3IsIG1hdGVyaWFsLmRpZmZ1c2VDb2xvciApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdERpZmZ1c2UgKz0gZ2V0R2VtRnJlc25lbFByb3h5KCBnZW9tZXRyeS5ub3JtYWwsIGdlb21ldHJ5LnZpZXdEaXIsIGRpcmVjdExpZ2h0LmNvbG9yLCBtYXRlcmlhbC5kaWZmdXNlQ29sb3IgKTtcbiAgfVxuXG4gIHZvaWQgUkVfSW5kaXJlY3REaWZmdXNlX01Ub29uKCBjb25zdCBpbiB2ZWMzIGlycmFkaWFuY2UsIGNvbnN0IGluIEdlb21ldHJpY0NvbnRleHQgZ2VvbWV0cnksIGNvbnN0IGluIE1Ub29uTWF0ZXJpYWwgbWF0ZXJpYWwsIGlub3V0IFJlZmxlY3RlZExpZ2h0IHJlZmxlY3RlZExpZ2h0ICkge1xuICAgIGZsb2F0IGdpQXZnID0gKCBpcnJhZGlhbmNlLnIgKyBpcnJhZGlhbmNlLmcgKyBpcnJhZGlhbmNlLmIgKSAqICggMS4wIC8gMy4wICk7XG4gICAgdmVjMyBnaSA9IG1peCggaXJyYWRpYW5jZSwgdmVjMyggZ2lBdmcgKSwgY2xhbXAoIGdpRXF1YWxpemF0aW9uRmFjdG9yLCAwLjAsIDEuMCApICk7XG4gICAgZ2kgKj0gKCAxLjAgKyBtYXgoIDAuMCwgYW1iaWVudExpZnQgKSApO1xuICAgIHJlZmxlY3RlZExpZ2h0LmluZGlyZWN0RGlmZnVzZSArPSBnaSAqIEJSREZfTGFtYmVydCggbWF0ZXJpYWwuZGlmZnVzZUNvbG9yICk7XG5cbiAgICAvLyBkaXJlY3RTcGVjdWxhciB3aWxsIGJlIHVzZWQgZm9yIHJpbSBsaWdodGluZywgbm90IGFuIGFjdHVhbCBzcGVjdWxhclxuICAgIHJlZmxlY3RlZExpZ2h0LmRpcmVjdFNwZWN1bGFyICs9IGlycmFkaWFuY2U7XG4gIH1cbiNlbmRpZlxuXG4jZGVmaW5lIFJFX0RpcmVjdCBSRV9EaXJlY3RfTVRvb25cbiNkZWZpbmUgUkVfSW5kaXJlY3REaWZmdXNlIFJFX0luZGlyZWN0RGlmZnVzZV9NVG9vblxuI2RlZmluZSBNYXRlcmlhbF9MaWdodFByb2JlTE9EKCBtYXRlcmlhbCApICgwKVxuXG4jaW5jbHVkZSA8c2hhZG93bWFwX3BhcnNfZnJhZ21lbnQ+XG4vLyAjaW5jbHVkZSA8YnVtcG1hcF9wYXJzX2ZyYWdtZW50PlxuXG4vLyAjaW5jbHVkZSA8bm9ybWFsbWFwX3BhcnNfZnJhZ21lbnQ+XG4jaWZkZWYgVVNFX05PUk1BTE1BUFxuXG4gIHVuaWZvcm0gc2FtcGxlcjJEIG5vcm1hbE1hcDtcbiAgdW5pZm9ybSBtYXQzIG5vcm1hbE1hcFV2VHJhbnNmb3JtO1xuICB1bmlmb3JtIHZlYzIgbm9ybWFsU2NhbGU7XG5cbiNlbmRpZlxuXG4vLyBDT01QQVQ6IHByZS1yMTUxXG4vLyBVU0VfTk9STUFMTUFQX09CSkVDVFNQQUNFIHVzZWQgdG8gYmUgT0JKRUNUU1BBQ0VfTk9STUFMTUFQIGluIHByZS1yMTUxXG4jaWYgZGVmaW5lZCggVVNFX05PUk1BTE1BUF9PQkpFQ1RTUEFDRSApIHx8IGRlZmluZWQoIE9CSkVDVFNQQUNFX05PUk1BTE1BUCApXG5cbiAgdW5pZm9ybSBtYXQzIG5vcm1hbE1hdHJpeDtcblxuI2VuZGlmXG5cbi8vIENPTVBBVDogcHJlLXIxNTFcbi8vIFVTRV9OT1JNQUxNQVBfVEFOR0VOVFNQQUNFIHVzZWQgdG8gYmUgVEFOR0VOVFNQQUNFX05PUk1BTE1BUCBpbiBwcmUtcjE1MVxuI2lmICEgZGVmaW5lZCAoIFVTRV9UQU5HRU5UICkgJiYgKCBkZWZpbmVkICggVVNFX05PUk1BTE1BUF9UQU5HRU5UU1BBQ0UgKSB8fCBkZWZpbmVkICggVEFOR0VOVFNQQUNFX05PUk1BTE1BUCApIClcblxuICAvLyBQZXItUGl4ZWwgVGFuZ2VudCBTcGFjZSBOb3JtYWwgTWFwcGluZ1xuICAvLyBodHRwOi8vaGFja3NvZmxpZmUuYmxvZ3Nwb3QuY2gvMjAwOS8xMS9wZXItcGl4ZWwtdGFuZ2VudC1zcGFjZS1ub3JtYWwtbWFwcGluZy5odG1sXG5cbiAgLy8gdGhyZWUtdnJtIHNwZWNpZmljIGNoYW5nZTogaXQgcmVxdWlyZXMgYHV2YCBhcyBhbiBpbnB1dCBpbiBvcmRlciB0byBzdXBwb3J0IHV2IHNjcm9sbHNcblxuICAvLyBUZW1wb3JhcnkgY29tcGF0IGFnYWluc3Qgc2hhZGVyIGNoYW5nZSBAIFRocmVlLmpzIHIxMjYsIHIxNTFcbiAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTFcblxuICAgIG1hdDMgZ2V0VGFuZ2VudEZyYW1lKCB2ZWMzIGV5ZV9wb3MsIHZlYzMgc3VyZl9ub3JtLCB2ZWMyIHV2ICkge1xuXG4gICAgICB2ZWMzIHEwID0gZEZkeCggZXllX3Bvcy54eXogKTtcbiAgICAgIHZlYzMgcTEgPSBkRmR5KCBleWVfcG9zLnh5eiApO1xuICAgICAgdmVjMiBzdDAgPSBkRmR4KCB1di5zdCApO1xuICAgICAgdmVjMiBzdDEgPSBkRmR5KCB1di5zdCApO1xuXG4gICAgICB2ZWMzIE4gPSBzdXJmX25vcm07XG5cbiAgICAgIHZlYzMgcTFwZXJwID0gY3Jvc3MoIHExLCBOICk7XG4gICAgICB2ZWMzIHEwcGVycCA9IGNyb3NzKCBOLCBxMCApO1xuXG4gICAgICB2ZWMzIFQgPSBxMXBlcnAgKiBzdDAueCArIHEwcGVycCAqIHN0MS54O1xuICAgICAgdmVjMyBCID0gcTFwZXJwICogc3QwLnkgKyBxMHBlcnAgKiBzdDEueTtcblxuICAgICAgZmxvYXQgZGV0ID0gbWF4KCBkb3QoIFQsIFQgKSwgZG90KCBCLCBCICkgKTtcbiAgICAgIGZsb2F0IHNjYWxlID0gKCBkZXQgPT0gMC4wICkgPyAwLjAgOiBpbnZlcnNlc3FydCggZGV0ICk7XG5cbiAgICAgIHJldHVybiBtYXQzKCBUICogc2NhbGUsIEIgKiBzY2FsZSwgTiApO1xuXG4gICAgfVxuXG4gICNlbHNlXG5cbiAgICB2ZWMzIHBlcnR1cmJOb3JtYWwyQXJiKCB2ZWMyIHV2LCB2ZWMzIGV5ZV9wb3MsIHZlYzMgc3VyZl9ub3JtLCB2ZWMzIG1hcE4sIGZsb2F0IGZhY2VEaXJlY3Rpb24gKSB7XG5cbiAgICAgIHZlYzMgcTAgPSB2ZWMzKCBkRmR4KCBleWVfcG9zLnggKSwgZEZkeCggZXllX3Bvcy55ICksIGRGZHgoIGV5ZV9wb3MueiApICk7XG4gICAgICB2ZWMzIHExID0gdmVjMyggZEZkeSggZXllX3Bvcy54ICksIGRGZHkoIGV5ZV9wb3MueSApLCBkRmR5KCBleWVfcG9zLnogKSApO1xuICAgICAgdmVjMiBzdDAgPSBkRmR4KCB1di5zdCApO1xuICAgICAgdmVjMiBzdDEgPSBkRmR5KCB1di5zdCApO1xuXG4gICAgICB2ZWMzIE4gPSBub3JtYWxpemUoIHN1cmZfbm9ybSApO1xuXG4gICAgICB2ZWMzIHExcGVycCA9IGNyb3NzKCBxMSwgTiApO1xuICAgICAgdmVjMyBxMHBlcnAgPSBjcm9zcyggTiwgcTAgKTtcblxuICAgICAgdmVjMyBUID0gcTFwZXJwICogc3QwLnggKyBxMHBlcnAgKiBzdDEueDtcbiAgICAgIHZlYzMgQiA9IHExcGVycCAqIHN0MC55ICsgcTBwZXJwICogc3QxLnk7XG5cbiAgICAgIC8vIHRocmVlLXZybSBzcGVjaWZpYyBjaGFuZ2U6IFdvcmthcm91bmQgZm9yIHRoZSBpc3N1ZSB0aGF0IGhhcHBlbnMgd2hlbiBkZWx0YSBvZiB1diA9IDAuMFxuICAgICAgLy8gVE9ETzogSXMgdGhpcyBzdGlsbCByZXF1aXJlZD8gT3Igc2hhbGwgSSBtYWtlIGEgUFIgYWJvdXQgaXQ/XG4gICAgICBpZiAoIGxlbmd0aCggVCApID09IDAuMCB8fCBsZW5ndGgoIEIgKSA9PSAwLjAgKSB7XG4gICAgICAgIHJldHVybiBzdXJmX25vcm07XG4gICAgICB9XG5cbiAgICAgIGZsb2F0IGRldCA9IG1heCggZG90KCBULCBUICksIGRvdCggQiwgQiApICk7XG4gICAgICBmbG9hdCBzY2FsZSA9ICggZGV0ID09IDAuMCApID8gMC4wIDogZmFjZURpcmVjdGlvbiAqIGludmVyc2VzcXJ0KCBkZXQgKTtcblxuICAgICAgcmV0dXJuIG5vcm1hbGl6ZSggVCAqICggbWFwTi54ICogc2NhbGUgKSArIEIgKiAoIG1hcE4ueSAqIHNjYWxlICkgKyBOICogbWFwTi56ICk7XG5cbiAgICB9XG5cbiAgI2VuZGlmXG5cbiNlbmRpZlxuXG4vLyAjaW5jbHVkZSA8c3BlY3VsYXJtYXBfcGFyc19mcmFnbWVudD5cbiNpbmNsdWRlIDxsb2dkZXB0aGJ1Zl9wYXJzX2ZyYWdtZW50PlxuI2luY2x1ZGUgPGNsaXBwaW5nX3BsYW5lc19wYXJzX2ZyYWdtZW50PlxuXG4vLyA9PSBwb3N0IGNvcnJlY3Rpb24gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxudm9pZCBwb3N0Q29ycmVjdGlvbigpIHtcbiAgI2luY2x1ZGUgPHRvbmVtYXBwaW5nX2ZyYWdtZW50PlxuICAjaW5jbHVkZSA8Y29sb3JzcGFjZV9mcmFnbWVudD5cbiAgI2luY2x1ZGUgPGZvZ19mcmFnbWVudD5cbiAgI2luY2x1ZGUgPHByZW11bHRpcGxpZWRfYWxwaGFfZnJhZ21lbnQ+XG4gICNpbmNsdWRlIDxkaXRoZXJpbmdfZnJhZ21lbnQ+XG59XG5cbi8vID09IG1haW4gcHJvY2VkdXJlID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG52b2lkIG1haW4oKSB7XG4gICNpbmNsdWRlIDxjbGlwcGluZ19wbGFuZXNfZnJhZ21lbnQ+XG5cbiAgdmVjMiB1diA9IHZlYzIoMC41LCAwLjUpO1xuXG4gICNpZiAoIGRlZmluZWQoIE1UT09OX1VTRV9VViApICYmICFkZWZpbmVkKCBNVE9PTl9VVlNfVkVSVEVYX09OTFkgKSApXG4gICAgdXYgPSB2VXY7XG5cbiAgICBmbG9hdCB1dkFuaW1NYXNrID0gMS4wO1xuICAgICNpZmRlZiBVU0VfVVZBTklNQVRJT05NQVNLVEVYVFVSRVxuICAgICAgdmVjMiB1dkFuaW1hdGlvbk1hc2tUZXh0dXJlVXYgPSAoIHV2QW5pbWF0aW9uTWFza1RleHR1cmVVdlRyYW5zZm9ybSAqIHZlYzMoIHV2LCAxICkgKS54eTtcbiAgICAgIHV2QW5pbU1hc2sgPSB0ZXh0dXJlMkQoIHV2QW5pbWF0aW9uTWFza1RleHR1cmUsIHV2QW5pbWF0aW9uTWFza1RleHR1cmVVdiApLmI7XG4gICAgI2VuZGlmXG5cbiAgICBmbG9hdCB1dlJvdENvcyA9IGNvcyggdXZBbmltYXRpb25Sb3RhdGlvblBoYXNlICogdXZBbmltTWFzayApO1xuICAgIGZsb2F0IHV2Um90U2luID0gc2luKCB1dkFuaW1hdGlvblJvdGF0aW9uUGhhc2UgKiB1dkFuaW1NYXNrICk7XG4gICAgdXYgPSBtYXQyKCB1dlJvdENvcywgLXV2Um90U2luLCB1dlJvdFNpbiwgdXZSb3RDb3MgKSAqICggdXYgLSAwLjUgKSArIDAuNTtcbiAgICB1diA9IHV2ICsgdmVjMiggdXZBbmltYXRpb25TY3JvbGxYT2Zmc2V0LCB1dkFuaW1hdGlvblNjcm9sbFlPZmZzZXQgKSAqIHV2QW5pbU1hc2s7XG4gICNlbmRpZlxuXG4gICNpZmRlZiBERUJVR19VVlxuICAgIGdsX0ZyYWdDb2xvciA9IHZlYzQoIDAuMCwgMC4wLCAwLjAsIDEuMCApO1xuICAgICNpZiAoIGRlZmluZWQoIE1UT09OX1VTRV9VViApICYmICFkZWZpbmVkKCBNVE9PTl9VVlNfVkVSVEVYX09OTFkgKSApXG4gICAgICBnbF9GcmFnQ29sb3IgPSB2ZWM0KCB1diwgMC4wLCAxLjAgKTtcbiAgICAjZW5kaWZcbiAgICByZXR1cm47XG4gICNlbmRpZlxuXG4gIHZlYzQgZGlmZnVzZUNvbG9yID0gdmVjNCggbGl0RmFjdG9yLCBvcGFjaXR5ICk7XG4gIFJlZmxlY3RlZExpZ2h0IHJlZmxlY3RlZExpZ2h0ID0gUmVmbGVjdGVkTGlnaHQoIHZlYzMoIDAuMCApLCB2ZWMzKCAwLjAgKSwgdmVjMyggMC4wICksIHZlYzMoIDAuMCApICk7XG4gIHZlYzMgdG90YWxFbWlzc2l2ZVJhZGlhbmNlID0gZW1pc3NpdmUgKiBlbWlzc2l2ZUludGVuc2l0eTtcblxuICAjaW5jbHVkZSA8bG9nZGVwdGhidWZfZnJhZ21lbnQ+XG5cbiAgLy8gI2luY2x1ZGUgPG1hcF9mcmFnbWVudD5cbiAgI2lmZGVmIFVTRV9NQVBcbiAgICB2ZWMyIG1hcFV2ID0gKCBtYXBVdlRyYW5zZm9ybSAqIHZlYzMoIHV2LCAxICkgKS54eTtcbiAgICB2ZWM0IHNhbXBsZWREaWZmdXNlQ29sb3IgPSB0ZXh0dXJlMkQoIG1hcCwgbWFwVXYgKTtcbiAgICAjaWZkZWYgREVDT0RFX1ZJREVPX1RFWFRVUkVcbiAgICAgIHNhbXBsZWREaWZmdXNlQ29sb3IgPSB2ZWM0KCBtaXgoIHBvdyggc2FtcGxlZERpZmZ1c2VDb2xvci5yZ2IgKiAwLjk0Nzg2NzI5ODYgKyB2ZWMzKCAwLjA1MjEzMjcwMTQgKSwgdmVjMyggMi40ICkgKSwgc2FtcGxlZERpZmZ1c2VDb2xvci5yZ2IgKiAwLjA3NzM5OTM4MDgsIHZlYzMoIGxlc3NUaGFuRXF1YWwoIHNhbXBsZWREaWZmdXNlQ29sb3IucmdiLCB2ZWMzKCAwLjA0MDQ1ICkgKSApICksIHNhbXBsZWREaWZmdXNlQ29sb3IudyApO1xuICAgICNlbmRpZlxuICAgIGRpZmZ1c2VDb2xvciAqPSBzYW1wbGVkRGlmZnVzZUNvbG9yO1xuICAjZW5kaWZcblxuICAvLyAjaW5jbHVkZSA8Y29sb3JfZnJhZ21lbnQ+XG4gICNpZiAoIGRlZmluZWQoIFVTRV9DT0xPUiApICYmICFkZWZpbmVkKCBJR05PUkVfVkVSVEVYX0NPTE9SICkgKVxuICAgIGRpZmZ1c2VDb2xvci5yZ2IgKj0gdkNvbG9yO1xuICAjZW5kaWZcblxuICAvLyAjaW5jbHVkZSA8YWxwaGFtYXBfZnJhZ21lbnQ+XG5cbiAgI2luY2x1ZGUgPGFscGhhdGVzdF9mcmFnbWVudD5cblxuICAvLyAjaW5jbHVkZSA8c3BlY3VsYXJtYXBfZnJhZ21lbnQ+XG5cbiAgLy8gI2luY2x1ZGUgPG5vcm1hbF9mcmFnbWVudF9iZWdpbj5cbiAgZmxvYXQgZmFjZURpcmVjdGlvbiA9IGdsX0Zyb250RmFjaW5nID8gMS4wIDogLTEuMDtcblxuICAjaWZkZWYgRkxBVF9TSEFERURcblxuICAgIHZlYzMgZmR4ID0gZEZkeCggdlZpZXdQb3NpdGlvbiApO1xuICAgIHZlYzMgZmR5ID0gZEZkeSggdlZpZXdQb3NpdGlvbiApO1xuICAgIHZlYzMgbm9ybWFsID0gbm9ybWFsaXplKCBjcm9zcyggZmR4LCBmZHkgKSApO1xuXG4gICNlbHNlXG5cbiAgICB2ZWMzIG5vcm1hbCA9IG5vcm1hbGl6ZSggdk5vcm1hbCApO1xuXG4gICAgI2lmZGVmIERPVUJMRV9TSURFRFxuXG4gICAgICBub3JtYWwgKj0gZmFjZURpcmVjdGlvbjtcblxuICAgICNlbmRpZlxuXG4gICNlbmRpZlxuXG4gICNpZmRlZiBVU0VfTk9STUFMTUFQXG5cbiAgICB2ZWMyIG5vcm1hbE1hcFV2ID0gKCBub3JtYWxNYXBVdlRyYW5zZm9ybSAqIHZlYzMoIHV2LCAxICkgKS54eTtcblxuICAjZW5kaWZcblxuICAjaWZkZWYgVVNFX05PUk1BTE1BUF9UQU5HRU5UU1BBQ0VcblxuICAgICNpZmRlZiBVU0VfVEFOR0VOVFxuXG4gICAgICBtYXQzIHRibiA9IG1hdDMoIG5vcm1hbGl6ZSggdlRhbmdlbnQgKSwgbm9ybWFsaXplKCB2Qml0YW5nZW50ICksIG5vcm1hbCApO1xuXG4gICAgI2Vsc2VcblxuICAgICAgbWF0MyB0Ym4gPSBnZXRUYW5nZW50RnJhbWUoIC0gdlZpZXdQb3NpdGlvbiwgbm9ybWFsLCBub3JtYWxNYXBVdiApO1xuXG4gICAgI2VuZGlmXG5cbiAgICAjaWYgZGVmaW5lZCggRE9VQkxFX1NJREVEICkgJiYgISBkZWZpbmVkKCBGTEFUX1NIQURFRCApXG5cbiAgICAgIHRiblswXSAqPSBmYWNlRGlyZWN0aW9uO1xuICAgICAgdGJuWzFdICo9IGZhY2VEaXJlY3Rpb247XG5cbiAgICAjZW5kaWZcblxuICAjZW5kaWZcblxuICAjaWZkZWYgVVNFX0NMRUFSQ09BVF9OT1JNQUxNQVBcblxuICAgICNpZmRlZiBVU0VfVEFOR0VOVFxuXG4gICAgICBtYXQzIHRibjIgPSBtYXQzKCBub3JtYWxpemUoIHZUYW5nZW50ICksIG5vcm1hbGl6ZSggdkJpdGFuZ2VudCApLCBub3JtYWwgKTtcblxuICAgICNlbHNlXG5cbiAgICAgIG1hdDMgdGJuMiA9IGdldFRhbmdlbnRGcmFtZSggLSB2Vmlld1Bvc2l0aW9uLCBub3JtYWwsIHZDbGVhcmNvYXROb3JtYWxNYXBVdiApO1xuXG4gICAgI2VuZGlmXG5cbiAgICAjaWYgZGVmaW5lZCggRE9VQkxFX1NJREVEICkgJiYgISBkZWZpbmVkKCBGTEFUX1NIQURFRCApXG5cbiAgICAgIHRibjJbMF0gKj0gZmFjZURpcmVjdGlvbjtcbiAgICAgIHRibjJbMV0gKj0gZmFjZURpcmVjdGlvbjtcblxuICAgICNlbmRpZlxuXG4gICNlbmRpZlxuXG4gIC8vIG5vbiBwZXJ0dXJiZWQgbm9ybWFsIGZvciBjbGVhcmNvYXQgYW1vbmcgb3RoZXJzXG5cbiAgdmVjMyBub25QZXJ0dXJiZWROb3JtYWwgPSBub3JtYWw7XG5cbiAgI2lmZGVmIE9VVExJTkVcbiAgICBub3JtYWwgKj0gLTEuMDtcbiAgI2VuZGlmXG5cbiAgLy8gI2luY2x1ZGUgPG5vcm1hbF9mcmFnbWVudF9tYXBzPlxuXG4gIC8vIENPTVBBVDogcHJlLXIxNTFcbiAgLy8gVVNFX05PUk1BTE1BUF9PQkpFQ1RTUEFDRSB1c2VkIHRvIGJlIE9CSkVDVFNQQUNFX05PUk1BTE1BUCBpbiBwcmUtcjE1MVxuICAjaWYgZGVmaW5lZCggVVNFX05PUk1BTE1BUF9PQkpFQ1RTUEFDRSApIHx8IGRlZmluZWQoIE9CSkVDVFNQQUNFX05PUk1BTE1BUCApXG5cbiAgICBub3JtYWwgPSB0ZXh0dXJlMkQoIG5vcm1hbE1hcCwgbm9ybWFsTWFwVXYgKS54eXogKiAyLjAgLSAxLjA7IC8vIG92ZXJyaWRlcyBib3RoIGZsYXRTaGFkaW5nIGFuZCBhdHRyaWJ1dGUgbm9ybWFsc1xuXG4gICAgI2lmZGVmIEZMSVBfU0lERURcblxuICAgICAgbm9ybWFsID0gLSBub3JtYWw7XG5cbiAgICAjZW5kaWZcblxuICAgICNpZmRlZiBET1VCTEVfU0lERURcblxuICAgICAgbm9ybWFsID0gbm9ybWFsICogZmFjZURpcmVjdGlvbjtcblxuICAgICNlbmRpZlxuXG4gICAgbm9ybWFsID0gbm9ybWFsaXplKCBub3JtYWxNYXRyaXggKiBub3JtYWwgKTtcblxuICAvLyBDT01QQVQ6IHByZS1yMTUxXG4gIC8vIFVTRV9OT1JNQUxNQVBfVEFOR0VOVFNQQUNFIHVzZWQgdG8gYmUgVEFOR0VOVFNQQUNFX05PUk1BTE1BUCBpbiBwcmUtcjE1MVxuICAjZWxpZiBkZWZpbmVkKCBVU0VfTk9STUFMTUFQX1RBTkdFTlRTUEFDRSApIHx8IGRlZmluZWQoIFRBTkdFTlRTUEFDRV9OT1JNQUxNQVAgKVxuXG4gICAgdmVjMyBtYXBOID0gdGV4dHVyZTJEKCBub3JtYWxNYXAsIG5vcm1hbE1hcFV2ICkueHl6ICogMi4wIC0gMS4wO1xuICAgIG1hcE4ueHkgKj0gbm9ybWFsU2NhbGU7XG4gICAgLy8gU2tpbiBkZXB0aDogYW1wbGlmeSB0YW5nZW50IG5vcm1hbCBYWSB3aGVuIGZhY2UvYm9keSBwcmVzZXQgc2V0cyBib29zdCAoTlBSIG5vcm1hbCBmZWVsKVxuICAgIG1hcE4ueHkgKj0gKCAxLjAgKyBjbGFtcCggbm9ybWFsU2tpbkJvb3N0LCAwLjAsIDEuMCApICogMC41NSApO1xuXG4gICAgLy8gQ09NUEFUOiBwcmUtcjE1MVxuICAgICNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPj0gMTUxIHx8IGRlZmluZWQoIFVTRV9UQU5HRU5UIClcblxuICAgICAgbm9ybWFsID0gbm9ybWFsaXplKCB0Ym4gKiBtYXBOICk7XG5cbiAgICAjZWxzZVxuXG4gICAgICBub3JtYWwgPSBwZXJ0dXJiTm9ybWFsMkFyYiggdXYsIC12Vmlld1Bvc2l0aW9uLCBub3JtYWwsIG1hcE4sIGZhY2VEaXJlY3Rpb24gKTtcblxuICAgICNlbmRpZlxuXG4gICNlbmRpZlxuXG4gIC8vICNpbmNsdWRlIDxlbWlzc2l2ZW1hcF9mcmFnbWVudD5cbiAgI2lmZGVmIFVTRV9FTUlTU0lWRU1BUFxuICAgIHZlYzIgZW1pc3NpdmVNYXBVdiA9ICggZW1pc3NpdmVNYXBVdlRyYW5zZm9ybSAqIHZlYzMoIHV2LCAxICkgKS54eTtcbiAgICB0b3RhbEVtaXNzaXZlUmFkaWFuY2UgKj0gdGV4dHVyZTJEKCBlbWlzc2l2ZU1hcCwgZW1pc3NpdmVNYXBVdiApLnJnYjtcbiAgI2VuZGlmXG5cbiAgI2lmZGVmIERFQlVHX05PUk1BTFxuICAgIGdsX0ZyYWdDb2xvciA9IHZlYzQoIDAuNSArIDAuNSAqIG5vcm1hbCwgMS4wICk7XG4gICAgcmV0dXJuO1xuICAjZW5kaWZcblxuICAvLyAtLSBNVG9vbjogbGlnaHRpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gYWNjdW11bGF0aW9uXG4gIC8vICNpbmNsdWRlIDxsaWdodHNfcGhvbmdfZnJhZ21lbnQ+XG4gIE1Ub29uTWF0ZXJpYWwgbWF0ZXJpYWw7XG5cbiAgbWF0ZXJpYWwuZGlmZnVzZUNvbG9yID0gZGlmZnVzZUNvbG9yLnJnYjtcblxuICBtYXRlcmlhbC5zaGFkZUNvbG9yID0gc2hhZGVDb2xvckZhY3RvcjtcbiAgI2lmZGVmIFVTRV9TSEFERU1VTFRJUExZVEVYVFVSRVxuICAgIHZlYzIgc2hhZGVNdWx0aXBseVRleHR1cmVVdiA9ICggc2hhZGVNdWx0aXBseVRleHR1cmVVdlRyYW5zZm9ybSAqIHZlYzMoIHV2LCAxICkgKS54eTtcbiAgICBtYXRlcmlhbC5zaGFkZUNvbG9yICo9IHRleHR1cmUyRCggc2hhZGVNdWx0aXBseVRleHR1cmUsIHNoYWRlTXVsdGlwbHlUZXh0dXJlVXYgKS5yZ2I7XG4gICNlbmRpZlxuXG4gICNpZiAoIGRlZmluZWQoIFVTRV9DT0xPUiApICYmICFkZWZpbmVkKCBJR05PUkVfVkVSVEVYX0NPTE9SICkgKVxuICAgIG1hdGVyaWFsLnNoYWRlQ29sb3IucmdiICo9IHZDb2xvcjtcbiAgI2VuZGlmXG5cbiAgbWF0ZXJpYWwuc2hhZGluZ1NoaWZ0ID0gc2hhZGluZ1NoaWZ0RmFjdG9yO1xuICAjaWZkZWYgVVNFX1NIQURJTkdTSElGVFRFWFRVUkVcbiAgICB2ZWMyIHNoYWRpbmdTaGlmdFRleHR1cmVVdiA9ICggc2hhZGluZ1NoaWZ0VGV4dHVyZVV2VHJhbnNmb3JtICogdmVjMyggdXYsIDEgKSApLnh5O1xuICAgIG1hdGVyaWFsLnNoYWRpbmdTaGlmdCArPSB0ZXh0dXJlMkQoIHNoYWRpbmdTaGlmdFRleHR1cmUsIHNoYWRpbmdTaGlmdFRleHR1cmVVdiApLnIgKiBzaGFkaW5nU2hpZnRUZXh0dXJlU2NhbGU7XG4gICNlbmRpZlxuXG4gIC8vICNpbmNsdWRlIDxsaWdodHNfZnJhZ21lbnRfYmVnaW4+XG5cbiAgLy8gTVRvb24gU3BlY2lmaWMgY2hhbmdlczpcbiAgLy8gU2luY2Ugd2Ugd2FudCB0byB0YWtlIHNoYWRvd3MgaW50byBhY2NvdW50IG9mIHNoYWRpbmcgaW5zdGVhZCBvZiBpcnJhZGlhbmNlLFxuICAvLyB3ZSBoYWQgdG8gbW9kaWZ5IHRoZSBjb2RlcyB0aGF0IG11bHRpcGxpZXMgdGhlIHJlc3VsdHMgb2Ygc2hhZG93bWFwIGludG8gY29sb3Igb2YgZGlyZWN0IGxpZ2h0cy5cblxuICAvLyBDT01QQVQ6IHByZS1yMTU2IHVzZXMgYSBzdHJ1Y3QgR2VvbWV0cmljQ29udGV4dFxuICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE1N1xuICAgIHZlYzMgZ2VvbWV0cnlQb3NpdGlvbiA9IC0gdlZpZXdQb3NpdGlvbjtcbiAgICB2ZWMzIGdlb21ldHJ5Tm9ybWFsID0gbm9ybWFsO1xuICAgIHZlYzMgZ2VvbWV0cnlWaWV3RGlyID0gKCBpc09ydGhvZ3JhcGhpYyApID8gdmVjMyggMCwgMCwgMSApIDogbm9ybWFsaXplKCB2Vmlld1Bvc2l0aW9uICk7XG5cbiAgICB2ZWMzIGdlb21ldHJ5Q2xlYXJjb2F0Tm9ybWFsO1xuXG4gICAgI2lmZGVmIFVTRV9DTEVBUkNPQVRcblxuICAgICAgZ2VvbWV0cnlDbGVhcmNvYXROb3JtYWwgPSBjbGVhcmNvYXROb3JtYWw7XG5cbiAgICAjZW5kaWZcbiAgI2Vsc2VcbiAgICBHZW9tZXRyaWNDb250ZXh0IGdlb21ldHJ5O1xuXG4gICAgZ2VvbWV0cnkucG9zaXRpb24gPSAtIHZWaWV3UG9zaXRpb247XG4gICAgZ2VvbWV0cnkubm9ybWFsID0gbm9ybWFsO1xuICAgIGdlb21ldHJ5LnZpZXdEaXIgPSAoIGlzT3J0aG9ncmFwaGljICkgPyB2ZWMzKCAwLCAwLCAxICkgOiBub3JtYWxpemUoIHZWaWV3UG9zaXRpb24gKTtcblxuICAgICNpZmRlZiBVU0VfQ0xFQVJDT0FUXG5cbiAgICAgIGdlb21ldHJ5LmNsZWFyY29hdE5vcm1hbCA9IGNsZWFyY29hdE5vcm1hbDtcblxuICAgICNlbmRpZlxuICAjZW5kaWZcblxuICBJbmNpZGVudExpZ2h0IGRpcmVjdExpZ2h0O1xuXG4gIC8vIHNpbmNlIHRoZXNlIHZhcmlhYmxlcyB3aWxsIGJlIHVzZWQgaW4gdW5yb2xsZWQgbG9vcCwgd2UgaGF2ZSB0byBkZWZpbmUgaW4gcHJpb3JcbiAgZmxvYXQgc2hhZG93O1xuXG4gICNpZiAoIE5VTV9QT0lOVF9MSUdIVFMgPiAwICkgJiYgZGVmaW5lZCggUkVfRGlyZWN0IClcblxuICAgIFBvaW50TGlnaHQgcG9pbnRMaWdodDtcbiAgICAjaWYgZGVmaW5lZCggVVNFX1NIQURPV01BUCApICYmIE5VTV9QT0lOVF9MSUdIVF9TSEFET1dTID4gMFxuICAgIFBvaW50TGlnaHRTaGFkb3cgcG9pbnRMaWdodFNoYWRvdztcbiAgICAjZW5kaWZcblxuICAgICNwcmFnbWEgdW5yb2xsX2xvb3Bfc3RhcnRcbiAgICBmb3IgKCBpbnQgaSA9IDA7IGkgPCBOVU1fUE9JTlRfTElHSFRTOyBpICsrICkge1xuXG4gICAgICBwb2ludExpZ2h0ID0gcG9pbnRMaWdodHNbIGkgXTtcblxuICAgICAgLy8gQ09NUEFUOiBwcmUtcjE1NiB1c2VzIGEgc3RydWN0IEdlb21ldHJpY0NvbnRleHRcbiAgICAgICNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPj0gMTU3XG4gICAgICAgIGdldFBvaW50TGlnaHRJbmZvKCBwb2ludExpZ2h0LCBnZW9tZXRyeVBvc2l0aW9uLCBkaXJlY3RMaWdodCApO1xuICAgICAgI2Vsc2VcbiAgICAgICAgZ2V0UG9pbnRMaWdodEluZm8oIHBvaW50TGlnaHQsIGdlb21ldHJ5LCBkaXJlY3RMaWdodCApO1xuICAgICAgI2VuZGlmXG5cbiAgICAgIHNoYWRvdyA9IDEuMDtcbiAgICAgICNpZiBkZWZpbmVkKCBVU0VfU0hBRE9XTUFQICkgJiYgKCBVTlJPTExFRF9MT09QX0lOREVYIDwgTlVNX1BPSU5UX0xJR0hUX1NIQURPV1MgKVxuICAgICAgcG9pbnRMaWdodFNoYWRvdyA9IHBvaW50TGlnaHRTaGFkb3dzWyBpIF07XG4gICAgICAvLyBDT01QQVQ6IHByZS1yMTY2XG4gICAgICAvLyByMTY2IGludHJvZHVjZWQgc2hhZG93SW50ZW5zaXR5XG4gICAgICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE2NlxuICAgICAgICBzaGFkb3cgPSBhbGwoIGJ2ZWMyKCBkaXJlY3RMaWdodC52aXNpYmxlLCByZWNlaXZlU2hhZG93ICkgKSA/IGdldFBvaW50U2hhZG93KCBwb2ludFNoYWRvd01hcFsgaSBdLCBwb2ludExpZ2h0U2hhZG93LnNoYWRvd01hcFNpemUsIHBvaW50TGlnaHRTaGFkb3cuc2hhZG93SW50ZW5zaXR5LCBwb2ludExpZ2h0U2hhZG93LnNoYWRvd0JpYXMsIHBvaW50TGlnaHRTaGFkb3cuc2hhZG93UmFkaXVzLCB2UG9pbnRTaGFkb3dDb29yZFsgaSBdLCBwb2ludExpZ2h0U2hhZG93LnNoYWRvd0NhbWVyYU5lYXIsIHBvaW50TGlnaHRTaGFkb3cuc2hhZG93Q2FtZXJhRmFyICkgOiAxLjA7XG4gICAgICAjZWxzZVxuICAgICAgICBzaGFkb3cgPSBhbGwoIGJ2ZWMyKCBkaXJlY3RMaWdodC52aXNpYmxlLCByZWNlaXZlU2hhZG93ICkgKSA/IGdldFBvaW50U2hhZG93KCBwb2ludFNoYWRvd01hcFsgaSBdLCBwb2ludExpZ2h0U2hhZG93LnNoYWRvd01hcFNpemUsIHBvaW50TGlnaHRTaGFkb3cuc2hhZG93QmlhcywgcG9pbnRMaWdodFNoYWRvdy5zaGFkb3dSYWRpdXMsIHZQb2ludFNoYWRvd0Nvb3JkWyBpIF0sIHBvaW50TGlnaHRTaGFkb3cuc2hhZG93Q2FtZXJhTmVhciwgcG9pbnRMaWdodFNoYWRvdy5zaGFkb3dDYW1lcmFGYXIgKSA6IDEuMDtcbiAgICAgICNlbmRpZlxuICAgICAgI2VuZGlmXG5cbiAgICAgIC8vIENPTVBBVDogcHJlLXIxNTYgdXNlcyBhIHN0cnVjdCBHZW9tZXRyaWNDb250ZXh0XG4gICAgICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE1N1xuICAgICAgICBSRV9EaXJlY3QoIGRpcmVjdExpZ2h0LCBnZW9tZXRyeVBvc2l0aW9uLCBnZW9tZXRyeU5vcm1hbCwgZ2VvbWV0cnlWaWV3RGlyLCBnZW9tZXRyeUNsZWFyY29hdE5vcm1hbCwgbWF0ZXJpYWwsIHNoYWRvdywgcmVmbGVjdGVkTGlnaHQgKTtcbiAgICAgICNlbHNlXG4gICAgICAgIFJFX0RpcmVjdCggZGlyZWN0TGlnaHQsIGdlb21ldHJ5LCBtYXRlcmlhbCwgc2hhZG93LCByZWZsZWN0ZWRMaWdodCApO1xuICAgICAgI2VuZGlmXG5cbiAgICB9XG4gICAgI3ByYWdtYSB1bnJvbGxfbG9vcF9lbmRcblxuICAjZW5kaWZcblxuICAjaWYgKCBOVU1fU1BPVF9MSUdIVFMgPiAwICkgJiYgZGVmaW5lZCggUkVfRGlyZWN0IClcblxuICAgIFNwb3RMaWdodCBzcG90TGlnaHQ7XG4gICAgLy8gQ09NUEFUOiBwcmUtcjE0NCB1c2VzIE5VTV9TUE9UX0xJR0hUX1NIQURPV1MsIHIxNDQrIHVzZXMgTlVNX1NQT1RfTElHSFRfQ09PUkRTXG4gICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNDRcbiAgICAgICNpZiBkZWZpbmVkKCBVU0VfU0hBRE9XTUFQICkgJiYgTlVNX1NQT1RfTElHSFRfQ09PUkRTID4gMFxuICAgICAgU3BvdExpZ2h0U2hhZG93IHNwb3RMaWdodFNoYWRvdztcbiAgICAgICNlbmRpZlxuICAgICNlbGlmIGRlZmluZWQoIFVTRV9TSEFET1dNQVAgKSAmJiBOVU1fU1BPVF9MSUdIVF9TSEFET1dTID4gMFxuICAgIFNwb3RMaWdodFNoYWRvdyBzcG90TGlnaHRTaGFkb3c7XG4gICAgI2VuZGlmXG5cbiAgICAjcHJhZ21hIHVucm9sbF9sb29wX3N0YXJ0XG4gICAgZm9yICggaW50IGkgPSAwOyBpIDwgTlVNX1NQT1RfTElHSFRTOyBpICsrICkge1xuXG4gICAgICBzcG90TGlnaHQgPSBzcG90TGlnaHRzWyBpIF07XG5cbiAgICAgIC8vIENPTVBBVDogcHJlLXIxNTYgdXNlcyBhIHN0cnVjdCBHZW9tZXRyaWNDb250ZXh0XG4gICAgICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE1N1xuICAgICAgICBnZXRTcG90TGlnaHRJbmZvKCBzcG90TGlnaHQsIGdlb21ldHJ5UG9zaXRpb24sIGRpcmVjdExpZ2h0ICk7XG4gICAgICAjZWxzZVxuICAgICAgICBnZXRTcG90TGlnaHRJbmZvKCBzcG90TGlnaHQsIGdlb21ldHJ5LCBkaXJlY3RMaWdodCApO1xuICAgICAgI2VuZGlmXG5cbiAgICAgIHNoYWRvdyA9IDEuMDtcbiAgICAgIC8vIENPTVBBVDogcHJlLXIxNDQgdXNlcyBOVU1fU1BPVF9MSUdIVF9TSEFET1dTIGFuZCB2U3BvdFNoYWRvd0Nvb3JkLCByMTQ0KyB1c2VzIE5VTV9TUE9UX0xJR0hUX0NPT1JEUyBhbmQgdlNwb3RMaWdodENvb3JkXG4gICAgICAvLyBDT01QQVQ6IHByZS1yMTY2IGRvZXMgbm90IGhhdmUgc2hhZG93SW50ZW5zaXR5LCByMTY2KyBoYXMgc2hhZG93SW50ZW5zaXR5XG4gICAgICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE2NlxuICAgICAgICAjaWYgZGVmaW5lZCggVVNFX1NIQURPV01BUCApICYmICggVU5ST0xMRURfTE9PUF9JTkRFWCA8IE5VTV9TUE9UX0xJR0hUX0NPT1JEUyApXG4gICAgICAgIHNwb3RMaWdodFNoYWRvdyA9IHNwb3RMaWdodFNoYWRvd3NbIGkgXTtcbiAgICAgICAgc2hhZG93ID0gYWxsKCBidmVjMiggZGlyZWN0TGlnaHQudmlzaWJsZSwgcmVjZWl2ZVNoYWRvdyApICkgPyBnZXRTaGFkb3coIHNwb3RTaGFkb3dNYXBbIGkgXSwgc3BvdExpZ2h0U2hhZG93LnNoYWRvd01hcFNpemUsIHNwb3RMaWdodFNoYWRvdy5zaGFkb3dJbnRlbnNpdHksIHNwb3RMaWdodFNoYWRvdy5zaGFkb3dCaWFzLCBzcG90TGlnaHRTaGFkb3cuc2hhZG93UmFkaXVzLCB2U3BvdExpZ2h0Q29vcmRbIGkgXSApIDogMS4wO1xuICAgICAgICAjZW5kaWZcbiAgICAgICNlbGlmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNDRcbiAgICAgICAgI2lmIGRlZmluZWQoIFVTRV9TSEFET1dNQVAgKSAmJiAoIFVOUk9MTEVEX0xPT1BfSU5ERVggPCBOVU1fU1BPVF9MSUdIVF9DT09SRFMgKVxuICAgICAgICBzcG90TGlnaHRTaGFkb3cgPSBzcG90TGlnaHRTaGFkb3dzWyBpIF07XG4gICAgICAgIHNoYWRvdyA9IGFsbCggYnZlYzIoIGRpcmVjdExpZ2h0LnZpc2libGUsIHJlY2VpdmVTaGFkb3cgKSApID8gZ2V0U2hhZG93KCBzcG90U2hhZG93TWFwWyBpIF0sIHNwb3RMaWdodFNoYWRvdy5zaGFkb3dNYXBTaXplLCBzcG90TGlnaHRTaGFkb3cuc2hhZG93Qmlhcywgc3BvdExpZ2h0U2hhZG93LnNoYWRvd1JhZGl1cywgdlNwb3RMaWdodENvb3JkWyBpIF0gKSA6IDEuMDtcbiAgICAgICAgI2VuZGlmXG4gICAgICAjZWxpZiBkZWZpbmVkKCBVU0VfU0hBRE9XTUFQICkgJiYgKCBVTlJPTExFRF9MT09QX0lOREVYIDwgTlVNX1NQT1RfTElHSFRfU0hBRE9XUyApXG4gICAgICBzcG90TGlnaHRTaGFkb3cgPSBzcG90TGlnaHRTaGFkb3dzWyBpIF07XG4gICAgICBzaGFkb3cgPSBhbGwoIGJ2ZWMyKCBkaXJlY3RMaWdodC52aXNpYmxlLCByZWNlaXZlU2hhZG93ICkgKSA/IGdldFNoYWRvdyggc3BvdFNoYWRvd01hcFsgaSBdLCBzcG90TGlnaHRTaGFkb3cuc2hhZG93TWFwU2l6ZSwgc3BvdExpZ2h0U2hhZG93LnNoYWRvd0JpYXMsIHNwb3RMaWdodFNoYWRvdy5zaGFkb3dSYWRpdXMsIHZTcG90U2hhZG93Q29vcmRbIGkgXSApIDogMS4wO1xuICAgICAgI2VuZGlmXG5cbiAgICAgIC8vIENPTVBBVDogcHJlLXIxNTYgdXNlcyBhIHN0cnVjdCBHZW9tZXRyaWNDb250ZXh0XG4gICAgICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE1N1xuICAgICAgICBSRV9EaXJlY3QoIGRpcmVjdExpZ2h0LCBnZW9tZXRyeVBvc2l0aW9uLCBnZW9tZXRyeU5vcm1hbCwgZ2VvbWV0cnlWaWV3RGlyLCBnZW9tZXRyeUNsZWFyY29hdE5vcm1hbCwgbWF0ZXJpYWwsIHNoYWRvdywgcmVmbGVjdGVkTGlnaHQgKTtcbiAgICAgICNlbHNlXG4gICAgICAgIFJFX0RpcmVjdCggZGlyZWN0TGlnaHQsIGdlb21ldHJ5LCBtYXRlcmlhbCwgc2hhZG93LCByZWZsZWN0ZWRMaWdodCApO1xuICAgICAgI2VuZGlmXG5cbiAgICB9XG4gICAgI3ByYWdtYSB1bnJvbGxfbG9vcF9lbmRcblxuICAjZW5kaWZcblxuICAjaWYgKCBOVU1fRElSX0xJR0hUUyA+IDAgKSAmJiBkZWZpbmVkKCBSRV9EaXJlY3QgKVxuXG4gICAgRGlyZWN0aW9uYWxMaWdodCBkaXJlY3Rpb25hbExpZ2h0O1xuICAgICNpZiBkZWZpbmVkKCBVU0VfU0hBRE9XTUFQICkgJiYgTlVNX0RJUl9MSUdIVF9TSEFET1dTID4gMFxuICAgIERpcmVjdGlvbmFsTGlnaHRTaGFkb3cgZGlyZWN0aW9uYWxMaWdodFNoYWRvdztcbiAgICAjZW5kaWZcblxuICAgICNwcmFnbWEgdW5yb2xsX2xvb3Bfc3RhcnRcbiAgICBmb3IgKCBpbnQgaSA9IDA7IGkgPCBOVU1fRElSX0xJR0hUUzsgaSArKyApIHtcblxuICAgICAgZGlyZWN0aW9uYWxMaWdodCA9IGRpcmVjdGlvbmFsTGlnaHRzWyBpIF07XG5cbiAgICAgIC8vIENPTVBBVDogcHJlLXIxNTYgdXNlcyBhIHN0cnVjdCBHZW9tZXRyaWNDb250ZXh0XG4gICAgICAjaWYgVEhSRUVfVlJNX1RIUkVFX1JFVklTSU9OID49IDE1N1xuICAgICAgICBnZXREaXJlY3Rpb25hbExpZ2h0SW5mbyggZGlyZWN0aW9uYWxMaWdodCwgZGlyZWN0TGlnaHQgKTtcbiAgICAgICNlbHNlXG4gICAgICAgIGdldERpcmVjdGlvbmFsTGlnaHRJbmZvKCBkaXJlY3Rpb25hbExpZ2h0LCBnZW9tZXRyeSwgZGlyZWN0TGlnaHQgKTtcbiAgICAgICNlbmRpZlxuXG4gICAgICBzaGFkb3cgPSAxLjA7XG4gICAgICAjaWYgZGVmaW5lZCggVVNFX1NIQURPV01BUCApICYmICggVU5ST0xMRURfTE9PUF9JTkRFWCA8IE5VTV9ESVJfTElHSFRfU0hBRE9XUyApXG4gICAgICBkaXJlY3Rpb25hbExpZ2h0U2hhZG93ID0gZGlyZWN0aW9uYWxMaWdodFNoYWRvd3NbIGkgXTtcbiAgICAgIC8vIENPTVBBVDogcHJlLXIxNjZcbiAgICAgIC8vIHIxNjYgaW50cm9kdWNlZCBzaGFkb3dJbnRlbnNpdHlcbiAgICAgICNpZiBUSFJFRV9WUk1fVEhSRUVfUkVWSVNJT04gPj0gMTY2XG4gICAgICAgIHNoYWRvdyA9IGFsbCggYnZlYzIoIGRpcmVjdExpZ2h0LnZpc2libGUsIHJlY2VpdmVTaGFkb3cgKSApID8gZ2V0U2hhZG93KCBkaXJlY3Rpb25hbFNoYWRvd01hcFsgaSBdLCBkaXJlY3Rpb25hbExpZ2h0U2hhZG93LnNoYWRvd01hcFNpemUsIGRpcmVjdGlvbmFsTGlnaHRTaGFkb3cuc2hhZG93SW50ZW5zaXR5LCBkaXJlY3Rpb25hbExpZ2h0U2hhZG93LnNoYWRvd0JpYXMsIGRpcmVjdGlvbmFsTGlnaHRTaGFkb3cuc2hhZG93UmFkaXVzLCB2RGlyZWN0aW9uYWxTaGFkb3dDb29yZFsgaSBdICkgOiAxLjA7XG4gICAgICAjZWxzZVxuICAgICAgICBzaGFkb3cgPSBhbGwoIGJ2ZWMyKCBkaXJlY3RMaWdodC52aXNpYmxlLCByZWNlaXZlU2hhZG93ICkgKSA/IGdldFNoYWRvdyggZGlyZWN0aW9uYWxTaGFkb3dNYXBbIGkgXSwgZGlyZWN0aW9uYWxMaWdodFNoYWRvdy5zaGFkb3dNYXBTaXplLCBkaXJlY3Rpb25hbExpZ2h0U2hhZG93LnNoYWRvd0JpYXMsIGRpcmVjdGlvbmFsTGlnaHRTaGFkb3cuc2hhZG93UmFkaXVzLCB2RGlyZWN0aW9uYWxTaGFkb3dDb29yZFsgaSBdICkgOiAxLjA7XG4gICAgICAjZW5kaWZcbiAgICAgICNlbmRpZlxuXG4gICAgICAvLyBDT01QQVQ6IHByZS1yMTU2IHVzZXMgYSBzdHJ1Y3QgR2VvbWV0cmljQ29udGV4dFxuICAgICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTdcbiAgICAgICAgUkVfRGlyZWN0KCBkaXJlY3RMaWdodCwgZ2VvbWV0cnlQb3NpdGlvbiwgZ2VvbWV0cnlOb3JtYWwsIGdlb21ldHJ5Vmlld0RpciwgZ2VvbWV0cnlDbGVhcmNvYXROb3JtYWwsIG1hdGVyaWFsLCBzaGFkb3csIHJlZmxlY3RlZExpZ2h0ICk7XG4gICAgICAjZWxzZVxuICAgICAgICBSRV9EaXJlY3QoIGRpcmVjdExpZ2h0LCBnZW9tZXRyeSwgbWF0ZXJpYWwsIHNoYWRvdywgcmVmbGVjdGVkTGlnaHQgKTtcbiAgICAgICNlbmRpZlxuXG4gICAgfVxuICAgICNwcmFnbWEgdW5yb2xsX2xvb3BfZW5kXG5cbiAgI2VuZGlmXG5cbiAgLy8gI2lmICggTlVNX1JFQ1RfQVJFQV9MSUdIVFMgPiAwICkgJiYgZGVmaW5lZCggUkVfRGlyZWN0X1JlY3RBcmVhIClcblxuICAvLyAgIFJlY3RBcmVhTGlnaHQgcmVjdEFyZWFMaWdodDtcblxuICAvLyAgICNwcmFnbWEgdW5yb2xsX2xvb3Bfc3RhcnRcbiAgLy8gICBmb3IgKCBpbnQgaSA9IDA7IGkgPCBOVU1fUkVDVF9BUkVBX0xJR0hUUzsgaSArKyApIHtcblxuICAvLyAgICAgcmVjdEFyZWFMaWdodCA9IHJlY3RBcmVhTGlnaHRzWyBpIF07XG4gIC8vICAgICBSRV9EaXJlY3RfUmVjdEFyZWEoIHJlY3RBcmVhTGlnaHQsIGdlb21ldHJ5LCBtYXRlcmlhbCwgcmVmbGVjdGVkTGlnaHQgKTtcblxuICAvLyAgIH1cbiAgLy8gICAjcHJhZ21hIHVucm9sbF9sb29wX2VuZFxuXG4gIC8vICNlbmRpZlxuXG4gICNpZiBkZWZpbmVkKCBSRV9JbmRpcmVjdERpZmZ1c2UgKVxuXG4gICAgdmVjMyBpYmxJcnJhZGlhbmNlID0gdmVjMyggMC4wICk7XG5cbiAgICB2ZWMzIGlycmFkaWFuY2UgPSBnZXRBbWJpZW50TGlnaHRJcnJhZGlhbmNlKCBhbWJpZW50TGlnaHRDb2xvciApO1xuXG4gICAgLy8gQ09NUEFUOiBwcmUtcjE1NiB1c2VzIGEgc3RydWN0IEdlb21ldHJpY0NvbnRleHRcbiAgICAvLyBDT01QQVQ6IHByZS1yMTU2IGRvZXNuJ3QgaGF2ZSBhIGRlZmluZSBVU0VfTElHSFRfUFJPQkVTXG4gICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTdcbiAgICAgICNpZiBkZWZpbmVkKCBVU0VfTElHSFRfUFJPQkVTIClcbiAgICAgICAgaXJyYWRpYW5jZSArPSBnZXRMaWdodFByb2JlSXJyYWRpYW5jZSggbGlnaHRQcm9iZSwgZ2VvbWV0cnlOb3JtYWwgKTtcbiAgICAgICNlbmRpZlxuICAgICNlbHNlXG4gICAgICBpcnJhZGlhbmNlICs9IGdldExpZ2h0UHJvYmVJcnJhZGlhbmNlKCBsaWdodFByb2JlLCBnZW9tZXRyeS5ub3JtYWwgKTtcbiAgICAjZW5kaWZcblxuICAgICNpZiAoIE5VTV9IRU1JX0xJR0hUUyA+IDAgKVxuXG4gICAgICAjcHJhZ21hIHVucm9sbF9sb29wX3N0YXJ0XG4gICAgICBmb3IgKCBpbnQgaSA9IDA7IGkgPCBOVU1fSEVNSV9MSUdIVFM7IGkgKysgKSB7XG5cbiAgICAgICAgLy8gQ09NUEFUOiBwcmUtcjE1NiB1c2VzIGEgc3RydWN0IEdlb21ldHJpY0NvbnRleHRcbiAgICAgICAgI2lmIFRIUkVFX1ZSTV9USFJFRV9SRVZJU0lPTiA+PSAxNTdcbiAgICAgICAgICBpcnJhZGlhbmNlICs9IGdldEhlbWlzcGhlcmVMaWdodElycmFkaWFuY2UoIGhlbWlzcGhlcmVMaWdodHNbIGkgXSwgZ2VvbWV0cnlOb3JtYWwgKTtcbiAgICAgICAgI2Vsc2VcbiAgICAgICAgICBpcnJhZGlhbmNlICs9IGdldEhlbWlzcGhlcmVMaWdodElycmFkaWFuY2UoIGhlbWlzcGhlcmVMaWdodHNbIGkgXSwgZ2VvbWV0cnkubm9ybWFsICk7XG4gICAgICAgICNlbmRpZlxuXG4gICAgICB9XG4gICAgICAjcHJhZ21hIHVucm9sbF9sb29wX2VuZFxuXG4gICAgI2VuZGlmXG5cbiAgI2VuZGlmXG5cbiAgLy8gI2lmIGRlZmluZWQoIFJFX0luZGlyZWN0U3BlY3VsYXIgKVxuXG4gIC8vICAgdmVjMyByYWRpYW5jZSA9IHZlYzMoIDAuMCApO1xuICAvLyAgIHZlYzMgY2xlYXJjb2F0UmFkaWFuY2UgPSB2ZWMzKCAwLjAgKTtcblxuICAvLyAjZW5kaWZcblxuICAjaW5jbHVkZSA8bGlnaHRzX2ZyYWdtZW50X21hcHM+XG4gICNpbmNsdWRlIDxsaWdodHNfZnJhZ21lbnRfZW5kPlxuXG4gIC8vIG1vZHVsYXRpb25cbiAgI2luY2x1ZGUgPGFvbWFwX2ZyYWdtZW50PlxuXG4gIHZlYzMgY29sID0gcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSArIHJlZmxlY3RlZExpZ2h0LmluZGlyZWN0RGlmZnVzZTtcblxuICAjaWZkZWYgREVCVUdfTElUU0hBREVSQVRFXG4gICAgZ2xfRnJhZ0NvbG9yID0gdmVjNCggY29sLCBkaWZmdXNlQ29sb3IuYSApO1xuICAgIHBvc3RDb3JyZWN0aW9uKCk7XG4gICAgcmV0dXJuO1xuICAjZW5kaWZcblxuICAvLyAtLSBNVG9vbjogcmltIGxpZ2h0aW5nIChNVG9vbjogc29mdC1saWtlIGJvcmRlci9ibHVyICsgb3B0aW9uYWwgZGlyIHJpbSkgLS1cbiAgdmVjMyB2aWV3RGlyID0gbm9ybWFsaXplKCB2Vmlld1Bvc2l0aW9uICk7XG5cbiAgI2lmbmRlZiBQSFlTSUNBTExZX0NPUlJFQ1RfTElHSFRTXG4gICAgcmVmbGVjdGVkTGlnaHQuZGlyZWN0U3BlY3VsYXIgLz0gUEk7XG4gICNlbmRpZlxuICB2ZWMzIHJpbU1peCA9IG1peCggdmVjMyggMS4wICksIHJlZmxlY3RlZExpZ2h0LmRpcmVjdFNwZWN1bGFyLCByaW1MaWdodGluZ01peEZhY3RvciApO1xuXG4gIC8vIENsYXNzaWMgcGFyYW1ldHJpYyBGcmVzbmVsIGJhc2UgKE1Ub29uKSArIE5QUiByaW0gYm9yZGVyL2JsdXIgLyBkaXIgLyBtYWluU3RyZW5ndGggLyBzaGFkb3dNYXNrXG4gIGZsb2F0IG52ID0gc2F0dXJhdGUoIDEuMCAtIGRvdCggdmlld0Rpciwgbm9ybWFsICkgKyBwYXJhbWV0cmljUmltTGlmdEZhY3RvciApO1xuICBmbG9hdCByaW1Qb3dlciA9ICggcmltRnJlc25lbFBvd2VyID4gMC4wMDEgKVxuICAgID8gcmltRnJlc25lbFBvd2VyXG4gICAgOiBwYXJhbWV0cmljUmltRnJlc25lbFBvd2VyRmFjdG9yO1xuICBmbG9hdCByaW1GcmVzbmVsID0gcG93KCBudiwgbWF4KCAwLjAwMSwgcmltUG93ZXIgKSApO1xuICBmbG9hdCByaW1Ub29uID0gcmltRnJlc25lbDtcbiAgaWYgKCByaW1Cb3JkZXIgPiAwLjAwMSApIHtcbiAgICBmbG9hdCByQmx1ciA9IG1heCggMC4wMDEsIHJpbUJsdXIgKTtcbiAgICBmbG9hdCByaW1CTWluID0gY2xhbXAoIHJpbUJvcmRlciAtIDAuNSAqIHJCbHVyLCAwLjAsIDEuMCApO1xuICAgIGZsb2F0IHJpbUJNYXggPSBjbGFtcCggcmltQm9yZGVyICsgMC41ICogckJsdXIsIDAuMCwgMS4wICk7XG4gICAgcmltVG9vbiA9IGxpbmVhcnN0ZXAoIHJpbUJNaW4sIHJpbUJNYXgsIHJpbUZyZXNuZWwgKTtcbiAgfVxuICAvLyBEaXJlY3Rpb25hbCByaW0gXHUyMjQ4IGxpbDogYmlhcyB3aXRoIGhhbGYtTGFtYmVydCBmcm9tIGxpZ2h0IGVuZXJneSBwcm94eVxuICBmbG9hdCByaW1MbiA9IHNhdHVyYXRlKCBsZW5ndGgoIHJlZmxlY3RlZExpZ2h0LmRpcmVjdFNwZWN1bGFyICkgKTtcbiAgZmxvYXQgcmltRGlyID0gbWl4KCAxLjAsIHJpbUxuLCBjbGFtcCggcmltRGlyU3RyZW5ndGgsIDAuMCwgMS4wICkgKTtcbiAgLy8gT3Bwb3NpdGUtc2lkZSAvIGluZGlyZWN0IHJpbSAoTlBSIFJpbUluZGlyKSBcdTIwMTQgdXNlcyBpbnZlcnNlIGxpZ2h0IGVuZXJneSBwcm94eVxuICBmbG9hdCByaW1JbmRpciA9IHJpbVRvb24gKiBzYXR1cmF0ZSggMS4wIC0gcmltTG4gKSAqIGNsYW1wKCByaW1JbmRpclN0cmVuZ3RoLCAwLjAsIDEuMCApO1xuICAvLyBBcHByb3hpbWF0ZSBzaGFkb3dtaXggZnJvbSBkaWZmdXNlIGVuZXJneSB2cyBsaXQgKG11dGUgcmltIGluIGRlZXAgc2hhZGUpXG4gIGZsb2F0IHNoYWRlTWl4ID0gc2F0dXJhdGUoIGxlbmd0aCggcmVmbGVjdGVkTGlnaHQuZGlyZWN0RGlmZnVzZSApIC8gbWF4KCBsZW5ndGgoIHJlZmxlY3RlZExpZ2h0LmRpcmVjdFNwZWN1bGFyICkgKiAwLjMxODMgKyAxZS0zLCAxZS0zICkgKTtcbiAgZmxvYXQgcmltU2hhZG93ID0gbWl4KCAxLjAsIHNoYWRlTWl4LCBjbGFtcCggcmltU2hhZG93TWFzaywgMC4wLCAxLjAgKSApO1xuICB2ZWMzIHJpbUNvbG9yID0gbWl4KCBwYXJhbWV0cmljUmltQ29sb3JGYWN0b3IsIHBhcmFtZXRyaWNSaW1Db2xvckZhY3RvciAqIGRpZmZ1c2VDb2xvci5yZ2IsIGNsYW1wKCByaW1NYWluU3RyZW5ndGgsIDAuMCwgMS4wICkgKTtcbiAgdmVjMyByaW0gPSByaW1Db2xvciAqICggcmltVG9vbiAqIHJpbURpciArIHJpbUluZGlyICkgKiByaW1TaGFkb3c7XG4gIHJpbSAqPSByaW1Cb29zdDtcblxuICAjaWZkZWYgVVNFX01BVENBUFRFWFRVUkVcbiAgICB7XG4gICAgICB2ZWMzIHggPSBub3JtYWxpemUoIHZlYzMoIHZpZXdEaXIueiwgMC4wLCAtdmlld0Rpci54ICkgKTtcbiAgICAgIHZlYzMgeSA9IGNyb3NzKCB2aWV3RGlyLCB4ICk7IC8vIGd1YXJhbnRlZWQgdG8gYmUgbm9ybWFsaXplZFxuICAgICAgdmVjMiBzcGhlcmVVdiA9IDAuNSArIDAuNSAqIHZlYzIoIGRvdCggeCwgbm9ybWFsICksIC1kb3QoIHksIG5vcm1hbCApICk7XG4gICAgICBzcGhlcmVVdiA9ICggbWF0Y2FwVGV4dHVyZVV2VHJhbnNmb3JtICogdmVjMyggc3BoZXJlVXYsIDEgKSApLnh5O1xuICAgICAgdmVjMyBtYXRjYXAgPSB0ZXh0dXJlMkQoIG1hdGNhcFRleHR1cmUsIHNwaGVyZVV2ICkucmdiO1xuICAgICAgcmltICs9IG1hdGNhcEZhY3RvciAqIG1hdGNhcDtcbiAgICAgIC8vIENoZWFwIDJuZCBNYXRDYXAgKHNpbmdsZS10ZXgpLiBIaWdoLWZyZXEgcmVzYW1wbGUgKyBjb250cmFzdCBjYXVzZWQgc2tpbiBcInJpcHBsZSB0ZXh0dXJlXCJcbiAgICAgIC8vIG9uIGN1cnZlZCBtaWR0b25lcyBcdTIwMTQga2VlcCBvbmx5IGxvdy1mcmVxdWVuY3kgbHVtYSBzaGVlbi5cbiAgICAgIGlmICggbWF0Y2FwMm5kU3RyZW5ndGggPiAwLjAwMDEgKSB7XG4gICAgICAgIGZsb2F0IG1jU2NhbGUgPSBtYXgoIDAuNSwgbWF0Y2FwMm5kU2NhbGUgKTtcbiAgICAgICAgdmVjMiBzcGhlcmVVdjIgPSAwLjUgKyAwLjUgKiB2ZWMyKCAtZG90KCB4LCBub3JtYWwgKSwgLWRvdCggeSwgbm9ybWFsICkgKiAwLjgyICsgMC4wNCApO1xuICAgICAgICBzcGhlcmVVdjIgPSAoIHNwaGVyZVV2MiAtIDAuNSApICogbWNTY2FsZSArIDAuNTtcbiAgICAgICAgc3BoZXJlVXYyID0gKCBtYXRjYXBUZXh0dXJlVXZUcmFuc2Zvcm0gKiB2ZWMzKCBzcGhlcmVVdjIsIDEgKSApLnh5O1xuICAgICAgICAvLyBCaWFzIHRvd2FyZCBjb2Fyc2VyIG1pcCB0byBraWxsIGZpbmUgbWF0Y2FwIGdyYWluIC8gbW9pclx1MDBFOSBvbiBza2luXG4gICAgICAgIHZlYzMgbWF0Y2FwMiA9IHRleHR1cmUyRCggbWF0Y2FwVGV4dHVyZSwgc3BoZXJlVXYyLCAyLjAgKS5yZ2I7XG4gICAgICAgIGZsb2F0IG1jTHVtYSA9IGRvdCggbWF0Y2FwMiwgdmVjMyggMC4yOTksIDAuNTg3LCAwLjExNCApICk7XG4gICAgICAgIG1hdGNhcDIgPSB2ZWMzKCBtY0x1bWEgKTsgLy8gbHVtYS1vbmx5IGxvYmUgXHUyMDE0IG5vIGRvdWJsZS1wcmludCBjaHJvbWEgdGV4dHVyZVxuICAgICAgICBmbG9hdCBtY0NvbnRyYXN0ID0gY2xhbXAoIG1hdGNhcDJuZENvbnRyYXN0LCAwLjUsIDEuMjUgKTtcbiAgICAgICAgbWF0Y2FwMiA9IGNsYW1wKCAoIG1hdGNhcDIgLSAwLjUgKSAqIG1jQ29udHJhc3QgKyAwLjUsIDAuMCwgMS4wICk7XG4gICAgICAgIHJpbSArPSBtYXRjYXBGYWN0b3IgKiBtYXRjYXAyICogbWF0Y2FwMm5kU3RyZW5ndGg7XG4gICAgICB9XG4gICAgfVxuICAjZW5kaWZcblxuICAjaWZkZWYgVVNFX1JJTU1VTFRJUExZVEVYVFVSRVxuICAgIHZlYzIgcmltTXVsdGlwbHlUZXh0dXJlVXYgPSAoIHJpbU11bHRpcGx5VGV4dHVyZVV2VHJhbnNmb3JtICogdmVjMyggdXYsIDEgKSApLnh5O1xuICAgIHJpbSAqPSB0ZXh0dXJlMkQoIHJpbU11bHRpcGx5VGV4dHVyZSwgcmltTXVsdGlwbHlUZXh0dXJlVXYgKS5yZ2I7XG4gICNlbmRpZlxuXG4gIGNvbCArPSByaW1NaXggKiByaW07XG5cbiAgLy8gLS0gTVRvb246IEVtaXNzaW9uICgrIHNvZnQtaXNoIGJvb3N0KSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICBjb2wgKz0gdG90YWxFbWlzc2l2ZVJhZGlhbmNlICogKCAxLjAgKyBtYXgoIDAuMCwgZW1pc3Npb25Cb29zdCApICk7XG5cbiAgLy8gRGlzdGFuY2UgZmFkZS9saWZ0IGFwcHJveCAobm8gTlBSIERpc3RhbmNlRmFkZSB0ZXgpOiBzb2Z0IG5lYXItY2FtZXJhIGxpZnRcbiAgaWYgKCBkaXN0YW5jZUZhZGUgPiAwLjAwMDEgKSB7XG4gICAgZmxvYXQgZGlzdCA9IGxlbmd0aCggdlZpZXdQb3NpdGlvbiApO1xuICAgIGZsb2F0IGZhZGUgPSBzbW9vdGhzdGVwKCAwLjM1LCAyLjgsIGRpc3QgKTtcbiAgICAvLyBOZWFyOiBzbGlnaHQgYnJpZ2h0bmVzczsgRmFyOiBnZW50bGUgbXV0ZSBcdTIwMTQgcmVhZGFibGUgd2l0aG91dCBhdXRob3JlZCBmYWRlIG1hcHNcbiAgICBjb2wgKj0gbWl4KCAxLjAgKyAwLjA2ICogZGlzdGFuY2VGYWRlLCAxLjAgLSAwLjA4ICogZGlzdGFuY2VGYWRlLCBmYWRlICk7XG4gIH1cblxuICAvLyAjaW5jbHVkZSA8ZW52bWFwX2ZyYWdtZW50PlxuXG4gIC8vIC0tIEFsbW9zdCBkb25lISAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAjaWYgZGVmaW5lZCggT1VUTElORSApXG4gICAgLy8gb3V0bGluZU1peDogMCA9IHN0b2NrIG91dGxpbmVMaWdodGluZ01peEZhY3RvcjsgMSA9IHByZWZlciBsaXQgYWxiZWRvIGJsZWVkXG4gICAgZmxvYXQgb3V0bGluZU1peCA9IG1peCggb3V0bGluZUxpZ2h0aW5nTWl4RmFjdG9yLCBjbGFtcCggb3V0bGluZUxpZ2h0aW5nTWl4RmFjdG9yICsgMC4xNSwgMC4wLCAxLjAgKSwgY2xhbXAoIG91dGxpbmVNaXgsIDAuMCwgMS4wICkgKTtcbiAgICBjb2wgPSBvdXRsaW5lQ29sb3JGYWN0b3IucmdiICogbWl4KCB2ZWMzKCAxLjAgKSwgY29sLCBvdXRsaW5lTWl4ICk7XG4gICNlbmRpZlxuXG4gICNpZmRlZiBPUEFRVUVcbiAgICBkaWZmdXNlQ29sb3IuYSA9IDEuMDtcbiAgI2VuZGlmXG5cbiAgZ2xfRnJhZ0NvbG9yID0gdmVjNCggY29sLCBkaWZmdXNlQ29sb3IuYSApO1xuICBwb3N0Q29ycmVjdGlvbigpO1xufVxuIiwgIi8qIGVzbGludC1kaXNhYmxlIEB0eXBlc2NyaXB0LWVzbGludC9uYW1pbmctY29udmVudGlvbiAqL1xuXG4vKipcbiAqIFNwZWNpZmllcnMgb2YgZGVidWcgbW9kZSBvZiB7QGxpbmsgTVRvb25NYXRlcmlhbH0uXG4gKlxuICogU2VlOiB7QGxpbmsgTVRvb25NYXRlcmlhbC5kZWJ1Z01vZGV9XG4gKi9cbmV4cG9ydCBjb25zdCBNVG9vbk1hdGVyaWFsRGVidWdNb2RlID0ge1xuICAvKipcbiAgICogUmVuZGVyIG5vcm1hbGx5LlxuICAgKi9cbiAgTm9uZTogJ25vbmUnLFxuXG4gIC8qKlxuICAgKiBWaXN1YWxpemUgbm9ybWFscyBvZiB0aGUgc3VyZmFjZS5cbiAgICovXG4gIE5vcm1hbDogJ25vcm1hbCcsXG5cbiAgLyoqXG4gICAqIFZpc3VhbGl6ZSBsaXQvc2hhZGUgb2YgdGhlIHN1cmZhY2UuXG4gICAqL1xuICBMaXRTaGFkZVJhdGU6ICdsaXRTaGFkZVJhdGUnLFxuXG4gIC8qKlxuICAgKiBWaXN1YWxpemUgVVYgb2YgdGhlIHN1cmZhY2UuXG4gICAqL1xuICBVVjogJ3V2Jyxcbn0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIE1Ub29uTWF0ZXJpYWxEZWJ1Z01vZGUgPSAodHlwZW9mIE1Ub29uTWF0ZXJpYWxEZWJ1Z01vZGUpW2tleW9mIHR5cGVvZiBNVG9vbk1hdGVyaWFsRGVidWdNb2RlXTtcbiIsICIvKiBlc2xpbnQtZGlzYWJsZSBAdHlwZXNjcmlwdC1lc2xpbnQvbmFtaW5nLWNvbnZlbnRpb24gKi9cblxuZXhwb3J0IGNvbnN0IE1Ub29uTWF0ZXJpYWxPdXRsaW5lV2lkdGhNb2RlID0ge1xuICBOb25lOiAnbm9uZScsXG4gIFdvcmxkQ29vcmRpbmF0ZXM6ICd3b3JsZENvb3JkaW5hdGVzJyxcbiAgU2NyZWVuQ29vcmRpbmF0ZXM6ICdzY3JlZW5Db29yZGluYXRlcycsXG59IGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBNVG9vbk1hdGVyaWFsT3V0bGluZVdpZHRoTW9kZSA9XG4gICh0eXBlb2YgTVRvb25NYXRlcmlhbE91dGxpbmVXaWR0aE1vZGUpW2tleW9mIHR5cGVvZiBNVG9vbk1hdGVyaWFsT3V0bGluZVdpZHRoTW9kZV07XG4iLCAiaW1wb3J0ICogYXMgVEhSRUUgZnJvbSAndGhyZWUnO1xuXG5jb25zdCBlbmNvZGluZ0NvbG9yU3BhY2VNYXA6IFJlY29yZDxhbnksICcnIHwgJ3NyZ2InPiA9IHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uYW1pbmctY29udmVudGlvblxuICAzMDAwOiAnJyxcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uYW1pbmctY29udmVudGlvblxuICAzMDAxOiAnc3JnYicsXG59O1xuXG4vKipcbiAqIEEgY29tcGF0IGZ1bmN0aW9uIHRvIGdldCB0ZXh0dXJlIGNvbG9yIHNwYWNlLlxuICpcbiAqIENPTVBBVDogcHJlLXIxNTJcbiAqIFN0YXJ0aW5nIGZyb20gVGhyZWUuanMgcjE1MiwgYHRleHR1cmUuZW5jb2RpbmdgIGlzIHJlbmFtZWQgdG8gYHRleHR1cmUuY29sb3JTcGFjZWAuXG4gKiBUaGlzIGZ1bmN0aW9uIHdpbGwgaGFuZGxlIHRoZSBjb21hcHQuXG4gKlxuICogQHBhcmFtIHRleHR1cmUgVGhlIHRleHR1cmUgeW91IHdhbnQgdG8gZ2V0IHRoZSBjb2xvciBzcGFjZSBmcm9tXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRUZXh0dXJlQ29sb3JTcGFjZSh0ZXh0dXJlOiBUSFJFRS5UZXh0dXJlKTogJycgfCAnc3JnYicge1xuICBpZiAocGFyc2VJbnQoVEhSRUUuUkVWSVNJT04sIDEwKSA+PSAxNTIpIHtcbiAgICByZXR1cm4gdGV4dHVyZS5jb2xvclNwYWNlIGFzICcnIHwgJ3NyZ2InO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBlbmNvZGluZ0NvbG9yU3BhY2VNYXBbKHRleHR1cmUgYXMgYW55KS5lbmNvZGluZ107XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxZQUFZQSxZQUFXOzs7QUNBdkIsWUFBWUMsWUFBVzs7O0FDQXZCLFlBQVksV0FBVztBQUV2QixJQUFNLHdCQUFrRDtBQUFBO0FBQUEsRUFFdEQsSUFBSTtBQUFBLEVBQ0osTUFBTTtBQUNSO0FBWU8sU0FBUyxxQkFBcUIsU0FBd0IsWUFBK0I7QUFDMUYsTUFBSSxTQUFlLGdCQUFVLEVBQUUsS0FBSyxLQUFLO0FBQ3ZDLFlBQVEsYUFBYTtBQUFBLEVBQ3ZCLE9BQU87QUFDTCxJQUFDLFFBQWdCLFdBQVcsc0JBQXNCLFVBQVU7QUFBQSxFQUM5RDtBQUNGOzs7QURkTyxJQUFNLHNDQUFOLE1BQTBDO0FBQUEsRUFLL0MsSUFBVyxVQUE0QjtBQUNyQyxXQUFPLFFBQVEsSUFBSSxLQUFLLFNBQVM7QUFBQSxFQUNuQztBQUFBLEVBRU8sWUFBWSxRQUFvQixnQkFBeUM7QUFDOUUsU0FBSyxVQUFVO0FBQ2YsU0FBSyxrQkFBa0I7QUFDdkIsU0FBSyxZQUFZLENBQUM7QUFBQSxFQUNwQjtBQUFBLEVBRU8sZ0JBQXlELEtBQVEsT0FBeUM7QUFDL0csUUFBSSxTQUFTLE1BQU07QUFDakIsV0FBSyxnQkFBZ0IsR0FBRyxJQUFJO0FBQUEsSUFDOUI7QUFBQSxFQUNGO0FBQUEsRUFFTyxZQUNMLEtBQ0EsT0FDQSxxQkFDTTtBQUNOLFFBQUksU0FBUyxNQUFNO0FBQ2pCLFlBQU0sUUFBUSxJQUFVLGFBQU0sRUFBRSxVQUFVLEtBQUs7QUFFL0MsVUFBSSxxQkFBcUI7QUFDdkIsY0FBTSxvQkFBb0I7QUFBQSxNQUM1QjtBQUNBLE1BQUMsS0FBSyxnQkFBd0IsR0FBRyxJQUFJO0FBQUEsSUFDdkM7QUFBQSxFQUNGO0FBQUEsRUFFYSxjQUNYLEtBQ0EsZUFDQSxnQkFDZTtBQUFBO0FBQ2YsWUFBTSxXQUFXLE1BQVk7QUFDM0IsWUFBSSxpQkFBaUIsTUFBTTtBQUN6QixnQkFBTSxVQUFVLE1BQU0sS0FBSyxRQUFRLGNBQWMsS0FBSyxpQkFBaUIsS0FBSyxhQUFhO0FBR3pGLGNBQUksV0FBVyxNQUFNO0FBQ25CLG9CQUFRO0FBQUEsY0FDTjtBQUFBLFlBQ0Y7QUFDQTtBQUFBLFVBQ0Y7QUFFQSxjQUFJLGdCQUFnQjtBQUNsQixpQ0FBcUIsU0FBUyxNQUFNO0FBQUEsVUFDdEM7QUFBQSxRQUNGO0FBQUEsTUFDRixJQUFHO0FBRUgsV0FBSyxVQUFVLEtBQUssT0FBTztBQUUzQixhQUFPO0FBQUEsSUFDVDtBQUFBO0FBQUEsRUFFYSxxQkFDWCxLQUNBLGNBQ0EsZ0JBQ2U7QUFBQTtBQUNmLGFBQU8sS0FBSyxjQUFjLEtBQUssZ0JBQWdCLE9BQU8sRUFBRSxPQUFPLGFBQWEsSUFBSSxRQUFXLGNBQWM7QUFBQSxJQUMzRztBQUFBO0FBQ0Y7OztBRS9FQSxZQUFZQyxZQUFXOzs7QUNGdkI7OztBQ0FBLElBQUFDLGlCQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFB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QVMsUUFBUSxTQUFTLE1BQU0sUUFBUSxTQUFTLFdBQVcsU0FBUyxRQUFRO0FBQ3ZHLGFBQVMsU0FBUyxHQUFHLG1CQUFtQixDQUFDO0FBQ3pDLGFBQVMsU0FBUyxHQUFHLG1CQUFtQixDQUFDO0FBQUEsRUFDM0M7QUFBQSxFQUVRLGtCQUFrQixNQUF3QjtBQUNoRCxVQUFNLHNCQUFzQixLQUFLO0FBQ2pDLFVBQU0sY0FBYyxvQkFBSSxJQUFvQjtBQUU1QyxRQUFJLE1BQU0sUUFBUSxtQkFBbUIsR0FBRztBQUN0QywwQkFBb0IsUUFBUSxDQUFDLGFBQWEsWUFBWSxJQUFJLFFBQVEsQ0FBQztBQUFBLElBQ3JFLE9BQU87QUFDTCxrQkFBWSxJQUFJLG1CQUFtQjtBQUFBLElBQ3JDO0FBRUEsZUFBVyxZQUFZLGFBQWE7QUFDbEMsV0FBSyxrQkFBa0IsSUFBSSxRQUFRO0FBQUEsSUFDckM7QUFBQSxFQUNGO0FBQUEsRUFFUSxrQkFBa0IsV0FBcUQ7QUFqV2pGO0FBb1dJLFVBQU0sZ0JBQWdCLFVBQVU7QUFDaEMsWUFBUSxnQkFBZ0IsSUFBSSxRQUFPLGVBQVUsNEJBQVYsWUFBcUM7QUFBQSxFQUMxRTtBQUNGO0FBM1RhLDJCQUNHLGlCQUFpQjtBQUQxQixJQUFNLDRCQUFOOyIsCiAgIm5hbWVzIjogWyJUSFJFRSIsICJUSFJFRSIsICJUSFJFRSIsICJtdG9vbl9kZWZhdWx0IiwgIlRIUkVFIiwgIm10b29uX2RlZmF1bHQiXQp9Cg==
