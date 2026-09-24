# @pixiv/three-vrm-materials-mtoon

MToon (toon material) module for `@pixiv/three-vrm`, extended with NPR (non-photorealistic rendering) shading features while maintaining full backwards compatibility with VRMC_materials_mtoon.

## Extended Features

This version extends standard MToon with configurable parameters for stylized character rendering:

- **Multi-Band Shading**: Configurable 2nd and 3rd shadow bands (`shadow2nd*`, `shadow3rd*`) for richer shadow depth and nuanced anime shading gradients.
- **Half-Lambert Soft Shading**: Optional smooth half-Lambert falloff blending (`softMix`, `shadowBorder`, `shadowBlur`, `blurBoost`) with Hermite smootherstep interpolation.
- **Material-Specific Highlights**:
  - Hair anisotropic highlight / angel-ring sheen (`hairSpecStrength`, `hairSpecPower`, `hairSpecShift`)
  - Cloth / satin GGX specular highlight (`clothSpecStrength`, `clothSpecPower`)
  - Hydrated skin specular highlight with grazing sheen (`skinSpecStrength`, `skinSpecPower`, `skinSpecFresnel`, `skinSpecColor`)
  - Directional toon specular (`specularStrength`, `specularPower`, `specularBorder`, `specularBlur`)
- **Advanced Rim Lighting**: Directional rim with N·L bias (`rimDirStrength`), opposite-side indirect rim (`rimIndirStrength`), shadow masking (`rimShadowMask`), and tint blending (`rimMainStrength`).
- **Environment Reflection Proxy**: View-dependent environment sheen approximation (`reflectStrength`, `reflectFresnel`, `reflectMetallic`, `reflectSmoothness`) without requiring an extra cubemap.
- **Backlight Approximation**: Wrap-around lighting from the opposite hemisphere (`backlightStrength`, `backlightColor`).
- **Secondary MatCap Sheen**: Resampled luma-sheen MatCap pass (`matcap2ndStrength`, `matcap2ndContrast`, `matcap2ndScale`).
- **Shadow Reception Factor**: `receiveShadowRate` (0.0 ~ 1.0) allowing clean face shadow map rejection while keeping accurate body/clothing hair shadow reception.
- **Fabric Grazing Sheen**: `fabricSheenStrength`, `fabricSheenPower`, `fabricSheenColor` for soft grazing-angle velvet / cheongsam / silk cloth sheen.
- **Screen Outline Distance Clamp**: Screen-space outline expansion distance clamped to `[0.45, 5.0]` to prevent dark blob ballooning at far zoom and clipping at extreme closeups.

All extended parameters default to 0 / neutral values, preserving standard MToon visual behavior by default.

## Build

```bash
pnpm -F @firetable/three-vrm-materials-mtoon build
```

During development with Vite, `packages/three-vrm-materials-mtoon/src/index.ts` is read directly via alias.

## Upstream References

- [Upstream Repository](https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm-materials-mtoon)
- [Examples](https://pixiv.github.io/three-vrm/packages/three-vrm-materials-mtoon/examples)
- [API Reference](https://pixiv.github.io/three-vrm/docs/modules/three-vrm-materials-mtoon)
