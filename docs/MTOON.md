# MToon NPR Material Extension Specification

This project extends `@pixiv/three-vrm-materials-mtoon` with Non-Photorealistic Rendering (NPR) enhancements, maintaining strict 100% backward compatibility with the official `VRMC_materials_mtoon` specification while providing richer anime skin and garment shading characteristics.

---

## 1. Material Loader Configuration

When initializing the VRM loader, pass `materialType: MToonMaterial` to ensure the extended MToon implementation is registered:

```ts
import { MToonMaterial, MToonMaterialLoaderPlugin } from '@pixiv/three-vrm-materials-mtoon';

const mtoonPlugin = new MToonMaterialLoaderPlugin(parser, {
  materialType: MToonMaterial,
});
```

The monorepo package is located at `packages/three-vrm-materials-mtoon`. In the Vite development environment, it is directly referenced and hot-reloaded via `resolve.alias` and `glsl-raw-loader`.

---

## 2. Extended Features & Shading Parameters

| Category | Parameter Fields | Description |
| :-- | :-- | :-- |
| **Soft Half-Lambert** | `softMix`, `blurBoost`, `shadowBorder`, `shadowBlur` | Interpolates between classic stepped toon shading and smooth Half-Lambert; supports fine-tuning of shadow boundary position and transition width. |
| **Multi-Tier Shadow Bands** | `shadow2ndStrength`, `shadow2ndBorder`, `shadow2ndBlur`, `shadow2ndColor`<br>`shadow3rdStrength`, `shadow3rdBorder`, `shadow3rdBlur`, `shadow3rdColor` | Secondary and tertiary shadow bands used to present layered depth and stylized anime ambient bounce hues (e.g. cool pink/lavender ambient reflection). |
| **Ambient & Shade Lift** | `ambientLift`, `shadeMainStrength`, `envStrength`, `giEqualizationFactor` | Ambient light blending in shaded areas to prevent muddy pitch blacks and maintain skin translucency. |
| **Skin Moisture Specular** | `skinSpecStrength`, `skinSpecPower`, `skinSpecFresnel`, `skinSpecColor` | Diffuse-softened highlights and grazing micro-sheen tailored for facial and body skin, eliminating harsh white specular spots. |
| **Anisotropic Hair Sheen** | `hairSpecStrength`, `hairSpecPower`, `hairSpecShift` | Tangent-aligned anisotropic highlight ring ("angel ring") on hair. |
| **Cloth Silk Specular** | `clothSpecStrength`, `clothSpecPower` | Micro-surface isotropic sheen for clothing fabrics. |
| **Universal Toon Specular** | `specularStrength`, `specularPower`, `specularBorder`, `specularBlur` | Directional stepped cartoon highlights. |
| **Ambient Reflection Fitting** | `reflectStrength`, `reflectFresnel`, `reflectMetallic`, `reflectSmoothness` | Lightweight view-dependent reflection model eliminating the need for an environment cubemap. |
| **Backlight Wrap** | `backlightStrength`, `backlightColor` | Backlight wrap and rim scattering effect. |
| **Rim Outline Lighting** | `rimBoost`, `rimBorder`, `rimBlur`, `rimDirStrength`, `rimIndirStrength`, `rimShadowMask`, `rimMainStrength`, `rimFresnelPower` | Directional and indirect rim lighting with depth shadow masking support. |
| **Dual MatCap** | `matcap2ndStrength`, `matcap2ndContrast`, `matcap2ndScale` | Secondary sampled highlight texture layer. |
| **Shadow Receive Isolation** | `receiveShadowRate` | Modulates the material's reception of primary directional shadows (`0.0` to `1.0`). Face is set to `0.0` to eliminate messy hair cast shadows; body and clothes are set to `1.0` to receive natural shadows. |
| **Grazing Fabric Sheen** | `fabricSheenStrength`, `fabricSheenPower`, `fabricSheenColor` | Grazing-angle micro-surface diffuse sheen providing soft velvet/silk rim highlights for cheongsams, silks, and satin outfits. |

---

## 3. Geometry & Shadow Mitigation Core Optimizations

1. **Screen Outline Distance Clamping**:  
   In the vertex shader, screen-space outline distance is clamped to `[0.45, 5.0]`. This eliminates over-thick outline blobs when zoomed far out, and prevents outlines from clipping through facial geometry at extreme close-up angles.
2. **Smooth Surface Shadow Acne Mitigation**:  
   Smooth curved meshes (e.g. limbs and chest) are prone to shadow acne banding when `receiveShadow = true` under hair shadow casting. We apply positive bias and normal bias on the primary directional light:
   ```ts
   this.dirLight.shadow.bias = 0.00002;
   this.dirLight.shadow.normalBias = 0.035; // Inward normal offset, completely eliminating shadow acne
   ```
   This maintains clean hair shadow projection onto the torso while keeping skin surfaces completely artifact-free.

---

## 4. Part-Specific Presets & Tuning

Configuration schema resides in `src/config.ts` under `APP_CONFIG.mtoon.parts`:

- `face`: High smoothness, cool pink-lavender secondary shadow, subtle moisture sheen, `receiveShadowRate: 0.0` (clean anime facial canvas, immune to external shadow noise).
- `body`: High smoothness, natural gradient shadows, cool translucent base color, `receiveShadowRate: 1.0` (receives realistic clavicle and hair shadows).
- `hair`: Tangent-aligned anisotropic angel-ring specular enabled, sharp contrast threshold.
- `cloth`: Moderate Half-Lambert soft mixing, grazing fabric sheen enabled (`fabricSheenStrength: 0.35`).

---

## 5. Build & Verification

```bash
# Build local MToon package
pnpm -F @firetable/three-vrm-materials-mtoon build

# Run local development server
pnpm dev
```
