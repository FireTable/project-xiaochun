/*!
 * @firetable/three-vrm-materials-mtoon v3.5.5
 * Extended @pixiv/three-vrm-materials-mtoon with NPR shading controls while preserving MToon API
 *
 * Copyright (c) 2019-2026 pixiv Inc.; FireTable XiaoChun fork
 * Distributed under MIT License
 * Upstream: https://github.com/pixiv/three-vrm/blob/release/LICENSE
 */
"use strict";var O=Object.create;var f=Object.defineProperty;var F=Object.getOwnPropertyDescriptor;var D=Object.getOwnPropertyNames,_=Object.getOwnPropertySymbols,N=Object.getPrototypeOf,w=Object.prototype.hasOwnProperty,B=Object.prototype.propertyIsEnumerable;var x=(a,t,e)=>t in a?f(a,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):a[t]=e,M=(a,t)=>{for(var e in t||(t={}))w.call(t,e)&&x(a,e,t[e]);if(_)for(var e of _(t))B.call(t,e)&&x(a,e,t[e]);return a};var k=(a,t)=>{for(var e in t)f(a,e,{get:t[e],enumerable:!0})},L=(a,t,e,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let r of D(t))!w.call(a,r)&&r!==e&&f(a,r,{get:()=>t[r],enumerable:!(i=F(t,r))||i.enumerable});return a};var p=(a,t,e)=>(e=a!=null?O(N(a)):{},L(t||!a||!a.__esModule?f(e,"default",{value:a,enumerable:!0}):e,a)),V=a=>L(f({},"__esModule",{value:!0}),a);var c=(a,t,e)=>new Promise((i,r)=>{var n=l=>{try{u(e.next(l))}catch(m){r(m)}},s=l=>{try{u(e.throw(l))}catch(m){r(m)}},u=l=>l.done?i(l.value):Promise.resolve(l.value).then(n,s);u((e=e.apply(a,t)).next())});var Y={};k(Y,{MToonMaterial:()=>d,MToonMaterialDebugMode:()=>T,MToonMaterialLoaderPlugin:()=>S,MToonMaterialOutlineWidthMode:()=>g});module.exports=V(Y);var b=p(require("three"),1);var U=p(require("three"),1);var C=p(require("three"),1),G={"":3e3,srgb:3001};function y(a,t){parseInt(C.REVISION,10)>=152?a.colorSpace=t:a.encoding=G[t]}var v=class{get pending(){return Promise.all(this._pendings)}constructor(t,e){this._parser=t,this._materialParams=e,this._pendings=[]}assignPrimitive(t,e){e!=null&&(this._materialParams[t]=e)}assignColor(t,e,i){if(e!=null){let r=new U.Color().fromArray(e);i&&r.convertSRGBToLinear(),this._materialParams[t]=r}}assignTexture(t,e,i){return c(this,null,function*(){let r=c(this,null,function*(){if(e!=null){let n=yield this._parser.assignTexture(this._materialParams,t,e);if(n==null){console.warn("GLTFMToonMaterialParamsAssignHelper: Failed to load texture. The rendering result may be wrong");return}i&&y(n,"srgb")}});return this._pendings.push(r),r})}assignTextureByIndex(t,e,i){return c(this,null,function*(){return this.assignTexture(t,e!=null?{index:e}:void 0,i)})}};var o=p(require("three"),1);var H=`// #define PHONG

varying vec3 vViewPosition;

#ifndef FLAT_SHADED
  varying vec3 vNormal;
#endif

#include <common>

// #include <uv_pars_vertex>
#ifdef MTOON_USE_UV
  varying vec2 vUv;

  // COMPAT: pre-r151 uses a common uvTransform
  #if THREE_VRM_THREE_REVISION < 151
    uniform mat3 uvTransform;
  #endif
#endif

// #include <uv2_pars_vertex>
// COMAPT: pre-r151 uses uv2 for lightMap and aoMap
#if THREE_VRM_THREE_REVISION < 151
  #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
    attribute vec2 uv2;
    varying vec2 vUv2;
    uniform mat3 uv2Transform;
  #endif
#endif

// #include <displacementmap_pars_vertex>
// #include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

#ifdef USE_OUTLINEWIDTHMULTIPLYTEXTURE
  uniform sampler2D outlineWidthMultiplyTexture;
  uniform mat3 outlineWidthMultiplyTextureUvTransform;
#endif

uniform float outlineWidthFactor;

void main() {

  // #include <uv_vertex>
  #ifdef MTOON_USE_UV
    // COMPAT: pre-r151 uses a common uvTransform
    #if THREE_VRM_THREE_REVISION >= 151
      vUv = uv;
    #else
      vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
    #endif
  #endif

  // #include <uv2_vertex>
  // COMAPT: pre-r151 uses uv2 for lightMap and aoMap
  #if THREE_VRM_THREE_REVISION < 151
    #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
      vUv2 = ( uv2Transform * vec3( uv2, 1 ) ).xy;
    #endif
  #endif

  #include <color_vertex>

  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>

  // we need this to compute the outline properly
  objectNormal = normalize( objectNormal );

  #include <defaultnormal_vertex>

  #ifndef FLAT_SHADED // Normal computed with derivatives when FLAT_SHADED
    vNormal = normalize( transformedNormal );
  #endif

  #include <begin_vertex>

  #include <morphtarget_vertex>
  #include <skinning_vertex>
  // #include <displacementmap_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  vViewPosition = - mvPosition.xyz;

  #ifdef OUTLINE
    float worldNormalLength = length( transformedNormal );
    vec3 outlineOffset = outlineWidthFactor * worldNormalLength * objectNormal;

    #ifdef USE_OUTLINEWIDTHMULTIPLYTEXTURE
      vec2 outlineWidthMultiplyTextureUv = ( outlineWidthMultiplyTextureUvTransform * vec3( vUv, 1 ) ).xy;
      float outlineTex = texture2D( outlineWidthMultiplyTexture, outlineWidthMultiplyTextureUv ).g;
      outlineOffset *= outlineTex;
    #endif

    #ifdef OUTLINE_WIDTH_SCREEN
      // \u8DDD\u79BB\u81EA\u9002\u5E94\u9650\u5236\uFF0C\u907F\u514D\u8FDC\u666F\u63CF\u8FB9\u53D8\u7C97\u9ED1\u56E2\uFF0C\u8FD1\u666F\u7A7F\u63D2\u65AD\u5C42
      float outlineDist = clamp( vViewPosition.z, 0.45, 5.0 );
      outlineOffset *= outlineDist / projectionMatrix[ 1 ].y;
    #endif

    gl_Position = projectionMatrix * modelViewMatrix * vec4( outlineOffset + transformed, 1.0 );

    gl_Position.z += 1E-6 * gl_Position.w; // anti-artifact magic
  #endif

  #include <worldpos_vertex>
  // #include <envmap_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>

}`;var P=`// #define PHONG

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
`;var T={None:"none",Normal:"normal",LitShadeRate:"litShadeRate",UV:"uv"};var g={None:"none",WorldCoordinates:"worldCoordinates",ScreenCoordinates:"screenCoordinates"};var I=p(require("three"),1),X={3e3:"",3001:"srgb"};function E(a){return parseInt(I.REVISION,10)>=152?a.colorSpace:X[a.encoding]}var d=class extends o.ShaderMaterial{constructor(e={}){var i;super({vertexShader:H,fragmentShader:P});this.uvAnimationScrollXSpeedFactor=0;this.uvAnimationScrollYSpeedFactor=0;this.uvAnimationRotationSpeedFactor=0;this.fog=!0;this.normalMapType=o.TangentSpaceNormalMap;this._ignoreVertexColor=!0;this._v0CompatShade=!1;this._debugMode=T.None;this._outlineWidthMode=g.None;this._isOutline=!1;e.transparentWithZWrite&&(e.depthWrite=!0),delete e.transparentWithZWrite,e.fog=!0,e.lights=!0,e.clipping=!0,this.uniforms=o.UniformsUtils.merge([o.UniformsLib.common,o.UniformsLib.normalmap,o.UniformsLib.emissivemap,o.UniformsLib.fog,o.UniformsLib.lights,{litFactor:{value:new o.Color(1,1,1)},mapUvTransform:{value:new o.Matrix3},colorAlpha:{value:1},normalMapUvTransform:{value:new o.Matrix3},shadeColorFactor:{value:new o.Color(0,0,0)},shadeMultiplyTexture:{value:null},shadeMultiplyTextureUvTransform:{value:new o.Matrix3},shadingShiftFactor:{value:0},shadingShiftTexture:{value:null},shadingShiftTextureUvTransform:{value:new o.Matrix3},shadingShiftTextureScale:{value:1},shadingToonyFactor:{value:.9},giEqualizationFactor:{value:.9},matcapFactor:{value:new o.Color(1,1,1)},matcapTexture:{value:null},matcapTextureUvTransform:{value:new o.Matrix3},parametricRimColorFactor:{value:new o.Color(0,0,0)},rimMultiplyTexture:{value:null},rimMultiplyTextureUvTransform:{value:new o.Matrix3},rimLightingMixFactor:{value:1},parametricRimFresnelPowerFactor:{value:5},parametricRimLiftFactor:{value:0},emissive:{value:new o.Color(0,0,0)},emissiveIntensity:{value:1},emissiveMapUvTransform:{value:new o.Matrix3},outlineWidthMultiplyTexture:{value:null},outlineWidthMultiplyTextureUvTransform:{value:new o.Matrix3},outlineWidthFactor:{value:0},outlineColorFactor:{value:new o.Color(0,0,0)},outlineLightingMixFactor:{value:1},uvAnimationMaskTexture:{value:null},uvAnimationMaskTextureUvTransform:{value:new o.Matrix3},uvAnimationScrollXOffset:{value:0},uvAnimationScrollYOffset:{value:0},uvAnimationRotationPhase:{value:0},softMix:{value:0},blurBoost:{value:0},shadow2ndStrength:{value:0},shadow2ndBorder:{value:.32},shadow2ndBlur:{value:.22},shadow2ndColor:{value:new o.Color(.68,.62,.78)},shadow3rdStrength:{value:0},shadow3rdBorder:{value:.14},shadow3rdBlur:{value:.2},shadow3rdColor:{value:new o.Color(.52,.48,.6)},rimBoost:{value:1},rimBorder:{value:0},rimBlur:{value:0},rimDirStrength:{value:0},hairSpecStrength:{value:0},hairSpecPower:{value:56},hairSpecShift:{value:-.1},clothSpecStrength:{value:0},clothSpecPower:{value:72},matcap2ndStrength:{value:0},skinSpecStrength:{value:0},skinSpecPower:{value:28},skinSpecFresnel:{value:.45},skinSpecColor:{value:new o.Color(1,.96,.94)},ambientLift:{value:0},shadeMainStrength:{value:0},shadowBorder:{value:-1},shadowBlur:{value:0},rimMainStrength:{value:0},rimShadowMask:{value:0},specularStrength:{value:0},specularPower:{value:48},specularBorder:{value:.5},specularBlur:{value:.1},reflectStrength:{value:0},reflectFresnel:{value:.55},reflectMetallic:{value:0},reflectSmoothness:{value:.55},backlightStrength:{value:0},backlightColor:{value:new o.Color(1,.85,.75)},rimFresnelPower:{value:0},rimIndirStrength:{value:0},matcap2ndContrast:{value:1.25},matcap2ndScale:{value:1},emissionBoost:{value:0},distanceFade:{value:0},faceSoft:{value:0},normalSkinBoost:{value:0},envStrength:{value:0},gemFresnel:{value:0},outlineMix:{value:0},receiveShadowRate:{value:1},fabricSheenStrength:{value:0},fabricSheenPower:{value:3.5},fabricSheenColor:{value:new o.Color(16771295)}},(i=e.uniforms)!=null?i:{}]),this.setValues(e),this._uploadUniformsWorkaround(),this.customProgramCacheKey=()=>[...Object.entries(this._generateDefines()).map(([r,n])=>`${r}:${n}`),this.matcapTexture?`matcapTextureColorSpace:${E(this.matcapTexture)}`:"",this.shadeMultiplyTexture?`shadeMultiplyTextureColorSpace:${E(this.shadeMultiplyTexture)}`:"",this.rimMultiplyTexture?`rimMultiplyTextureColorSpace:${E(this.rimMultiplyTexture)}`:""].join(","),this.onBeforeCompile=r=>{let n=parseInt(o.REVISION,10),s=Object.entries(M(M({},this._generateDefines()),this.defines)).filter(([u,l])=>!!l).map(([u,l])=>`#define ${u} ${l}`).join(`
`)+`
`;r.vertexShader=s+r.vertexShader,r.fragmentShader=s+r.fragmentShader,n<154&&(r.fragmentShader=r.fragmentShader.replace("#include <colorspace_fragment>","#include <encodings_fragment>"))}}get color(){return this.uniforms.litFactor.value}set color(e){this.uniforms.litFactor.value=e}get map(){return this.uniforms.map.value}set map(e){this.uniforms.map.value=e}get normalMap(){return this.uniforms.normalMap.value}set normalMap(e){this.uniforms.normalMap.value=e}get normalScale(){return this.uniforms.normalScale.value}set normalScale(e){this.uniforms.normalScale.value=e}get emissive(){return this.uniforms.emissive.value}set emissive(e){this.uniforms.emissive.value=e}get emissiveIntensity(){return this.uniforms.emissiveIntensity.value}set emissiveIntensity(e){this.uniforms.emissiveIntensity.value=e}get emissiveMap(){return this.uniforms.emissiveMap.value}set emissiveMap(e){this.uniforms.emissiveMap.value=e}get shadeColorFactor(){return this.uniforms.shadeColorFactor.value}set shadeColorFactor(e){this.uniforms.shadeColorFactor.value=e}get shadeMultiplyTexture(){return this.uniforms.shadeMultiplyTexture.value}set shadeMultiplyTexture(e){this.uniforms.shadeMultiplyTexture.value=e}get shadingShiftFactor(){return this.uniforms.shadingShiftFactor.value}set shadingShiftFactor(e){this.uniforms.shadingShiftFactor.value=e}get shadingShiftTexture(){return this.uniforms.shadingShiftTexture.value}set shadingShiftTexture(e){this.uniforms.shadingShiftTexture.value=e}get shadingShiftTextureScale(){return this.uniforms.shadingShiftTextureScale.value}set shadingShiftTextureScale(e){this.uniforms.shadingShiftTextureScale.value=e}get shadingToonyFactor(){return this.uniforms.shadingToonyFactor.value}set shadingToonyFactor(e){this.uniforms.shadingToonyFactor.value=e}get giEqualizationFactor(){return this.uniforms.giEqualizationFactor.value}set giEqualizationFactor(e){this.uniforms.giEqualizationFactor.value=e}get matcapFactor(){return this.uniforms.matcapFactor.value}set matcapFactor(e){this.uniforms.matcapFactor.value=e}get matcapTexture(){return this.uniforms.matcapTexture.value}set matcapTexture(e){this.uniforms.matcapTexture.value=e}get parametricRimColorFactor(){return this.uniforms.parametricRimColorFactor.value}set parametricRimColorFactor(e){this.uniforms.parametricRimColorFactor.value=e}get rimMultiplyTexture(){return this.uniforms.rimMultiplyTexture.value}set rimMultiplyTexture(e){this.uniforms.rimMultiplyTexture.value=e}get rimLightingMixFactor(){return this.uniforms.rimLightingMixFactor.value}set rimLightingMixFactor(e){this.uniforms.rimLightingMixFactor.value=e}get parametricRimFresnelPowerFactor(){return this.uniforms.parametricRimFresnelPowerFactor.value}set parametricRimFresnelPowerFactor(e){this.uniforms.parametricRimFresnelPowerFactor.value=e}get parametricRimLiftFactor(){return this.uniforms.parametricRimLiftFactor.value}set parametricRimLiftFactor(e){this.uniforms.parametricRimLiftFactor.value=e}get softMix(){return this.uniforms.softMix.value}set softMix(e){this.uniforms.softMix.value=e}get blurBoost(){return this.uniforms.blurBoost.value}set blurBoost(e){this.uniforms.blurBoost.value=e}get shadow2ndStrength(){return this.uniforms.shadow2ndStrength.value}set shadow2ndStrength(e){this.uniforms.shadow2ndStrength.value=e}get shadow2ndBorder(){return this.uniforms.shadow2ndBorder.value}set shadow2ndBorder(e){this.uniforms.shadow2ndBorder.value=e}get shadow2ndBlur(){return this.uniforms.shadow2ndBlur.value}set shadow2ndBlur(e){this.uniforms.shadow2ndBlur.value=e}get shadow2ndColor(){return this.uniforms.shadow2ndColor.value}set shadow2ndColor(e){this.uniforms.shadow2ndColor.value=e}get shadow3rdStrength(){return this.uniforms.shadow3rdStrength.value}set shadow3rdStrength(e){this.uniforms.shadow3rdStrength.value=e}get shadow3rdBorder(){return this.uniforms.shadow3rdBorder.value}set shadow3rdBorder(e){this.uniforms.shadow3rdBorder.value=e}get shadow3rdBlur(){return this.uniforms.shadow3rdBlur.value}set shadow3rdBlur(e){this.uniforms.shadow3rdBlur.value=e}get shadow3rdColor(){return this.uniforms.shadow3rdColor.value}set shadow3rdColor(e){this.uniforms.shadow3rdColor.value=e}get rimBoost(){return this.uniforms.rimBoost.value}set rimBoost(e){this.uniforms.rimBoost.value=e}get rimBorder(){return this.uniforms.rimBorder.value}set rimBorder(e){this.uniforms.rimBorder.value=e}get rimBlur(){return this.uniforms.rimBlur.value}set rimBlur(e){this.uniforms.rimBlur.value=e}get rimDirStrength(){return this.uniforms.rimDirStrength.value}set rimDirStrength(e){this.uniforms.rimDirStrength.value=e}get hairSpecStrength(){return this.uniforms.hairSpecStrength.value}set hairSpecStrength(e){this.uniforms.hairSpecStrength.value=e}get hairSpecPower(){return this.uniforms.hairSpecPower.value}set hairSpecPower(e){this.uniforms.hairSpecPower.value=e}get hairSpecShift(){return this.uniforms.hairSpecShift.value}set hairSpecShift(e){this.uniforms.hairSpecShift.value=e}get clothSpecStrength(){return this.uniforms.clothSpecStrength.value}set clothSpecStrength(e){this.uniforms.clothSpecStrength.value=e}get clothSpecPower(){return this.uniforms.clothSpecPower.value}set clothSpecPower(e){this.uniforms.clothSpecPower.value=e}get matcap2ndStrength(){return this.uniforms.matcap2ndStrength.value}set matcap2ndStrength(e){this.uniforms.matcap2ndStrength.value=e}get skinSpecStrength(){return this.uniforms.skinSpecStrength.value}set skinSpecStrength(e){this.uniforms.skinSpecStrength.value=e}get skinSpecPower(){return this.uniforms.skinSpecPower.value}set skinSpecPower(e){this.uniforms.skinSpecPower.value=e}get skinSpecFresnel(){return this.uniforms.skinSpecFresnel.value}set skinSpecFresnel(e){this.uniforms.skinSpecFresnel.value=e}get skinSpecColor(){return this.uniforms.skinSpecColor.value}set skinSpecColor(e){this.uniforms.skinSpecColor.value=e}get ambientLift(){return this.uniforms.ambientLift.value}set ambientLift(e){this.uniforms.ambientLift.value=e}get shadeMainStrength(){return this.uniforms.shadeMainStrength.value}set shadeMainStrength(e){this.uniforms.shadeMainStrength.value=e}get shadowBorder(){return this.uniforms.shadowBorder.value}set shadowBorder(e){this.uniforms.shadowBorder.value=e}get shadowBlur(){return this.uniforms.shadowBlur.value}set shadowBlur(e){this.uniforms.shadowBlur.value=e}get rimMainStrength(){return this.uniforms.rimMainStrength.value}set rimMainStrength(e){this.uniforms.rimMainStrength.value=e}get rimShadowMask(){return this.uniforms.rimShadowMask.value}set rimShadowMask(e){this.uniforms.rimShadowMask.value=e}get specularStrength(){return this.uniforms.specularStrength.value}set specularStrength(e){this.uniforms.specularStrength.value=e}get specularPower(){return this.uniforms.specularPower.value}set specularPower(e){this.uniforms.specularPower.value=e}get specularBorder(){return this.uniforms.specularBorder.value}set specularBorder(e){this.uniforms.specularBorder.value=e}get specularBlur(){return this.uniforms.specularBlur.value}set specularBlur(e){this.uniforms.specularBlur.value=e}get reflectStrength(){return this.uniforms.reflectStrength.value}set reflectStrength(e){this.uniforms.reflectStrength.value=e}get reflectFresnel(){return this.uniforms.reflectFresnel.value}set reflectFresnel(e){this.uniforms.reflectFresnel.value=e}get reflectMetallic(){return this.uniforms.reflectMetallic.value}set reflectMetallic(e){this.uniforms.reflectMetallic.value=e}get reflectSmoothness(){return this.uniforms.reflectSmoothness.value}set reflectSmoothness(e){this.uniforms.reflectSmoothness.value=e}get backlightStrength(){return this.uniforms.backlightStrength.value}set backlightStrength(e){this.uniforms.backlightStrength.value=e}get backlightColor(){return this.uniforms.backlightColor.value}set backlightColor(e){this.uniforms.backlightColor.value=e}get rimFresnelPower(){return this.uniforms.rimFresnelPower.value}set rimFresnelPower(e){this.uniforms.rimFresnelPower.value=e}get rimIndirStrength(){return this.uniforms.rimIndirStrength.value}set rimIndirStrength(e){this.uniforms.rimIndirStrength.value=e}get matcap2ndContrast(){return this.uniforms.matcap2ndContrast.value}set matcap2ndContrast(e){this.uniforms.matcap2ndContrast.value=e}get matcap2ndScale(){return this.uniforms.matcap2ndScale.value}set matcap2ndScale(e){this.uniforms.matcap2ndScale.value=e}get emissionBoost(){return this.uniforms.emissionBoost.value}set emissionBoost(e){this.uniforms.emissionBoost.value=e}get distanceFade(){return this.uniforms.distanceFade.value}set distanceFade(e){this.uniforms.distanceFade.value=e}get faceSoft(){return this.uniforms.faceSoft.value}set faceSoft(e){this.uniforms.faceSoft.value=e}get normalSkinBoost(){return this.uniforms.normalSkinBoost.value}set normalSkinBoost(e){this.uniforms.normalSkinBoost.value=e}get envStrength(){return this.uniforms.envStrength.value}set envStrength(e){this.uniforms.envStrength.value=e}get gemFresnel(){return this.uniforms.gemFresnel.value}set gemFresnel(e){this.uniforms.gemFresnel.value=e}get outlineMix(){return this.uniforms.outlineMix.value}set outlineMix(e){this.uniforms.outlineMix.value=e}get receiveShadowRate(){return this.uniforms.receiveShadowRate.value}set receiveShadowRate(e){this.uniforms.receiveShadowRate.value=e}get fabricSheenStrength(){return this.uniforms.fabricSheenStrength.value}set fabricSheenStrength(e){this.uniforms.fabricSheenStrength.value=e}get fabricSheenPower(){return this.uniforms.fabricSheenPower.value}set fabricSheenPower(e){this.uniforms.fabricSheenPower.value=e}get fabricSheenColor(){return this.uniforms.fabricSheenColor.value}set fabricSheenColor(e){this.uniforms.fabricSheenColor.value=e}get outlineWidthMultiplyTexture(){return this.uniforms.outlineWidthMultiplyTexture.value}set outlineWidthMultiplyTexture(e){this.uniforms.outlineWidthMultiplyTexture.value=e}get outlineWidthFactor(){return this.uniforms.outlineWidthFactor.value}set outlineWidthFactor(e){this.uniforms.outlineWidthFactor.value=e}get outlineColorFactor(){return this.uniforms.outlineColorFactor.value}set outlineColorFactor(e){this.uniforms.outlineColorFactor.value=e}get outlineLightingMixFactor(){return this.uniforms.outlineLightingMixFactor.value}set outlineLightingMixFactor(e){this.uniforms.outlineLightingMixFactor.value=e}get uvAnimationMaskTexture(){return this.uniforms.uvAnimationMaskTexture.value}set uvAnimationMaskTexture(e){this.uniforms.uvAnimationMaskTexture.value=e}get uvAnimationScrollXOffset(){return this.uniforms.uvAnimationScrollXOffset.value}set uvAnimationScrollXOffset(e){this.uniforms.uvAnimationScrollXOffset.value=e}get uvAnimationScrollYOffset(){return this.uniforms.uvAnimationScrollYOffset.value}set uvAnimationScrollYOffset(e){this.uniforms.uvAnimationScrollYOffset.value=e}get uvAnimationRotationPhase(){return this.uniforms.uvAnimationRotationPhase.value}set uvAnimationRotationPhase(e){this.uniforms.uvAnimationRotationPhase.value=e}get ignoreVertexColor(){return this._ignoreVertexColor}set ignoreVertexColor(e){this._ignoreVertexColor=e,this.needsUpdate=!0}get v0CompatShade(){return this._v0CompatShade}set v0CompatShade(e){this._v0CompatShade=e,this.needsUpdate=!0}get debugMode(){return this._debugMode}set debugMode(e){this._debugMode=e,this.needsUpdate=!0}get outlineWidthMode(){return this._outlineWidthMode}set outlineWidthMode(e){this._outlineWidthMode=e,this.needsUpdate=!0}get isOutline(){return this._isOutline}set isOutline(e){this._isOutline=e,this.needsUpdate=!0}get isMToonMaterial(){return!0}update(e){this._uploadUniformsWorkaround(),this._updateUVAnimation(e)}copy(e){return super.copy(e),this.map=e.map,this.normalMap=e.normalMap,this.emissiveMap=e.emissiveMap,this.shadeMultiplyTexture=e.shadeMultiplyTexture,this.shadingShiftTexture=e.shadingShiftTexture,this.matcapTexture=e.matcapTexture,this.rimMultiplyTexture=e.rimMultiplyTexture,this.outlineWidthMultiplyTexture=e.outlineWidthMultiplyTexture,this.uvAnimationMaskTexture=e.uvAnimationMaskTexture,this.normalMapType=e.normalMapType,this.uvAnimationScrollXSpeedFactor=e.uvAnimationScrollXSpeedFactor,this.uvAnimationScrollYSpeedFactor=e.uvAnimationScrollYSpeedFactor,this.uvAnimationRotationSpeedFactor=e.uvAnimationRotationSpeedFactor,this.ignoreVertexColor=e.ignoreVertexColor,this.v0CompatShade=e.v0CompatShade,this.debugMode=e.debugMode,this.outlineWidthMode=e.outlineWidthMode,this.isOutline=e.isOutline,this.needsUpdate=!0,this}_updateUVAnimation(e){this.uniforms.uvAnimationScrollXOffset.value+=e*this.uvAnimationScrollXSpeedFactor,this.uniforms.uvAnimationScrollYOffset.value+=e*this.uvAnimationScrollYSpeedFactor,this.uniforms.uvAnimationRotationPhase.value+=e*this.uvAnimationRotationSpeedFactor,this.uniforms.alphaTest.value=this.alphaTest,this.uniformsNeedUpdate=!0}_uploadUniformsWorkaround(){this.uniforms.opacity.value=this.opacity,this._updateTextureMatrix(this.uniforms.map,this.uniforms.mapUvTransform),this._updateTextureMatrix(this.uniforms.normalMap,this.uniforms.normalMapUvTransform),this._updateTextureMatrix(this.uniforms.emissiveMap,this.uniforms.emissiveMapUvTransform),this._updateTextureMatrix(this.uniforms.shadeMultiplyTexture,this.uniforms.shadeMultiplyTextureUvTransform),this._updateTextureMatrix(this.uniforms.shadingShiftTexture,this.uniforms.shadingShiftTextureUvTransform),this._updateTextureMatrix(this.uniforms.matcapTexture,this.uniforms.matcapTextureUvTransform),this._updateTextureMatrix(this.uniforms.rimMultiplyTexture,this.uniforms.rimMultiplyTextureUvTransform),this._updateTextureMatrix(this.uniforms.outlineWidthMultiplyTexture,this.uniforms.outlineWidthMultiplyTextureUvTransform),this._updateTextureMatrix(this.uniforms.uvAnimationMaskTexture,this.uniforms.uvAnimationMaskTextureUvTransform),this.uniformsNeedUpdate=!0}_generateDefines(){let e=parseInt(o.REVISION,10),i=this.outlineWidthMultiplyTexture!==null,r=this.map!==null||this.normalMap!==null||this.emissiveMap!==null||this.shadeMultiplyTexture!==null||this.shadingShiftTexture!==null||this.rimMultiplyTexture!==null||this.uvAnimationMaskTexture!==null;return{THREE_VRM_THREE_REVISION:e,OUTLINE:this._isOutline,MTOON_USE_UV:i||r,MTOON_UVS_VERTEX_ONLY:i&&!r,V0_COMPAT_SHADE:this._v0CompatShade,USE_SHADEMULTIPLYTEXTURE:this.shadeMultiplyTexture!==null,USE_SHADINGSHIFTTEXTURE:this.shadingShiftTexture!==null,USE_MATCAPTEXTURE:this.matcapTexture!==null,USE_RIMMULTIPLYTEXTURE:this.rimMultiplyTexture!==null,USE_OUTLINEWIDTHMULTIPLYTEXTURE:this._isOutline&&this.outlineWidthMultiplyTexture!==null,USE_UVANIMATIONMASKTEXTURE:this.uvAnimationMaskTexture!==null,IGNORE_VERTEX_COLOR:this._ignoreVertexColor===!0,DEBUG_NORMAL:this._debugMode==="normal",DEBUG_LITSHADERATE:this._debugMode==="litShadeRate",DEBUG_UV:this._debugMode==="uv",OUTLINE_WIDTH_SCREEN:this._isOutline&&this._outlineWidthMode===g.ScreenCoordinates}}_updateTextureMatrix(e,i){e.value&&(e.value.matrixAutoUpdate&&e.value.updateMatrix(),i.value.copy(e.value.matrix))}};var q=new Set(["1.0","1.0-beta"]),h=class h{get name(){return h.EXTENSION_NAME}constructor(t,e={}){var i,r,n,s;this.parser=t,this.materialType=(i=e.materialType)!=null?i:d,this.renderOrderOffset=(r=e.renderOrderOffset)!=null?r:0,this.v0CompatShade=(n=e.v0CompatShade)!=null?n:!1,this.debugMode=(s=e.debugMode)!=null?s:"none",this._mToonMaterialSet=new Set}beforeRoot(){return c(this,null,function*(){this._removeUnlitExtensionIfMToonExists()})}afterRoot(t){return c(this,null,function*(){t.userData.vrmMToonMaterials=Array.from(this._mToonMaterialSet)})}getMaterialType(t){return this._getMToonExtension(t)?this.materialType:null}extendMaterialParams(t,e){let i=this._getMToonExtension(t);return i?this._extendMaterialParams(i,e):null}loadMesh(t){return c(this,null,function*(){var u;let e=this.parser,r=(u=e.json.meshes)==null?void 0:u[t];if(r==null)throw new Error(`MToonMaterialLoaderPlugin: Attempt to use meshes[${t}] of glTF but the mesh doesn't exist`);let n=r.primitives,s=yield e.loadMesh(t);if(n.length===1){let l=s,m=n[0].material;m!=null&&this._setupPrimitive(l,m)}else{let l=s;for(let m=0;m<n.length;m++){let A=l.children[m],R=n[m].material;R!=null&&this._setupPrimitive(A,R)}}return s})}_removeUnlitExtensionIfMToonExists(){let i=this.parser.json.materials;i==null||i.map((r,n)=>{var u;this._getMToonExtension(n)&&((u=r.extensions)!=null&&u.KHR_materials_unlit)&&delete r.extensions.KHR_materials_unlit})}_getMToonExtension(t){var u,l;let r=(u=this.parser.json.materials)==null?void 0:u[t];if(r==null){console.warn(`MToonMaterialLoaderPlugin: Attempt to use materials[${t}] of glTF but the material doesn't exist`);return}let n=(l=r.extensions)==null?void 0:l[h.EXTENSION_NAME];if(n==null)return;let s=n.specVersion;if(!q.has(s)){console.warn(`MToonMaterialLoaderPlugin: Unknown ${h.EXTENSION_NAME} specVersion "${s}"`);return}return n}_extendMaterialParams(t,e){return c(this,null,function*(){var r;delete e.metalness,delete e.roughness;let i=new v(this.parser,e);i.assignPrimitive("transparentWithZWrite",t.transparentWithZWrite),i.assignColor("shadeColorFactor",t.shadeColorFactor),i.assignTexture("shadeMultiplyTexture",t.shadeMultiplyTexture,!0),i.assignPrimitive("shadingShiftFactor",t.shadingShiftFactor),i.assignTexture("shadingShiftTexture",t.shadingShiftTexture,!0),i.assignPrimitive("shadingShiftTextureScale",(r=t.shadingShiftTexture)==null?void 0:r.scale),i.assignPrimitive("shadingToonyFactor",t.shadingToonyFactor),i.assignPrimitive("giEqualizationFactor",t.giEqualizationFactor),i.assignColor("matcapFactor",t.matcapFactor),i.assignTexture("matcapTexture",t.matcapTexture,!0),i.assignColor("parametricRimColorFactor",t.parametricRimColorFactor),i.assignTexture("rimMultiplyTexture",t.rimMultiplyTexture,!0),i.assignPrimitive("rimLightingMixFactor",t.rimLightingMixFactor),i.assignPrimitive("parametricRimFresnelPowerFactor",t.parametricRimFresnelPowerFactor),i.assignPrimitive("parametricRimLiftFactor",t.parametricRimLiftFactor),i.assignPrimitive("outlineWidthMode",t.outlineWidthMode),i.assignPrimitive("outlineWidthFactor",t.outlineWidthFactor),i.assignTexture("outlineWidthMultiplyTexture",t.outlineWidthMultiplyTexture,!1),i.assignColor("outlineColorFactor",t.outlineColorFactor),i.assignPrimitive("outlineLightingMixFactor",t.outlineLightingMixFactor),i.assignTexture("uvAnimationMaskTexture",t.uvAnimationMaskTexture,!1),i.assignPrimitive("uvAnimationScrollXSpeedFactor",t.uvAnimationScrollXSpeedFactor),i.assignPrimitive("uvAnimationScrollYSpeedFactor",t.uvAnimationScrollYSpeedFactor),i.assignPrimitive("uvAnimationRotationSpeedFactor",t.uvAnimationRotationSpeedFactor),i.assignPrimitive("v0CompatShade",this.v0CompatShade),i.assignPrimitive("debugMode",this.debugMode),yield i.pending})}_setupPrimitive(t,e){let i=this._getMToonExtension(e);if(i){let r=this._parseRenderOrder(i);t.renderOrder=r+this.renderOrderOffset,this._generateOutline(t),this._addToMaterialSet(t);return}}_shouldGenerateOutline(t){return typeof t.outlineWidthMode=="string"&&t.outlineWidthMode!=="none"&&typeof t.outlineWidthFactor=="number"&&t.outlineWidthFactor>0}_generateOutline(t){let e=t.material;if(!(e instanceof b.Material)||!this._shouldGenerateOutline(e))return;t.material=[e];let i=e.clone();i.name+=" (Outline)",i.isOutline=!0,i.side=b.BackSide,t.material.push(i);let r=t.geometry,n=r.index?r.index.count:r.attributes.position.count/3;r.addGroup(0,n,0),r.addGroup(0,n,1)}_addToMaterialSet(t){let e=t.material,i=new Set;Array.isArray(e)?e.forEach(r=>i.add(r)):i.add(e);for(let r of i)this._mToonMaterialSet.add(r)}_parseRenderOrder(t){var i;return(t.transparentWithZWrite?0:19)+((i=t.renderQueueOffsetNumber)!=null?i:0)}};h.EXTENSION_NAME="VRMC_materials_mtoon";var S=h;
