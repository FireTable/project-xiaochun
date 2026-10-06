# `beach3d` Scene: Real-time 3D Anime MMD Stage Beach

`beach3d` (display name "海滩" / "Beach" / "ビーチ") is the 4th built-in scene and is opaque. It is a small 3D stage built entirely in Three.js. The character stands on real sand with a real shadow, and every prop is a low-poly mesh with soft toon shading.

The look is **二次元 MMD 舞台风格** (anime MMD stage): soft modern 3D anime, high-key diffused light, soft shadow transitions, a peach-pink / lavender / mint / cream pastel palette and clean stylized shapes. It is not photoreal and uses no HDRI.
- An asymmetric palm composition: two palms on the left, one tall framing palm leaning out of frame on the right, and smaller palms further along the shore. Crowns are upright starbursts of arching fronds with a hand-painted frond texture.
- A striped beach lounge chair with a small parasol on the right, facing the sea.
- A small, cute sandcastle on a hand-patted square platform in the left foreground, in front of the left palms.
- A clear turquoise sea, light near the shore and deeper further out, with irregular swash foam, several wave bands and twinkling glints.
- Fine, soft sand with a darker, glossy wet band at the water's edge, and calm, sparse sand ripples. Scallop shells are available but off by default.
- A blue-to-pale-blue sky with hand-painted anime cumulus sprites and high wisps; the horizon is a soft lavender-tinted pastel glow with a thin white mist on the waterline.
- Layered distant island silhouettes on the left, fading into atmospheric haze, and a small pastel lighthouse standing in the sea on the right.

There is no HDRI, no realistic material and no third-party asset. Exactly two small hand-painted textures are used (the cloud atlas and the palm frond, see [Assets](#assets)); all geometry is generated in code, and every other pattern is computed procedurally in shaders. Light direction and colour follow the engine's main light, so the scene blends with the MToon character.

## Where things live

| File | Role |
| :--- | :--- |
| `src/core/scene/beach3d/beach3dWorld.ts` | `Beach3DWorld`: builds and owns all meshes, does the per-frame updates, `getStats()`, `dispose()` |
| `src/core/scene/beach3d/beach3dShaders.ts` | GLSL for sky, clouds, islands, ground (sand + sea + baked prop shadows), palms, rocks, scallop shells, chair + parasol + lighthouse + sandcastle, and the shadow-mask bake |
| `src/core/scene/beach3d/beach3dGeometry.ts` | Procedural low-poly geometry: palm trunk (flaring into a domed crown) and crown (fronds, stalks, leaf-base sheaths and coconuts), island strip, rock, scallop shell, chair + parasol, lighthouse, sandcastle |
| `src/core/scene/beach3d/beach3dLayout.ts` | Pure data and functions (no three / DOM): shoreline, palm / rock / shell / cloud layout, chair, parasol and sandcastle placement, island peaks and silhouette profile |
| `src/core/scene/sceneMotion.ts` | `SceneMotionGovernor`: reduced-motion and low-FPS downgrade, plus the separate cloud-drift clock |
| `src/core/scene/__tests__/beach3dLayout.test.ts` | Layout invariants (props on sand, keep-out zones, asymmetric palms, crown shape and frond attachment, chair placement and joints, lighthouse placement, sandcastle placement / shape / connectivity, island heights, cloud layout, shell distribution and scallop shape, triangle budget) |
| `src/core/scene/beach3d/beach3dConfig.ts` | All tunables (`BEACH3D_SCENE_CONFIG`, exposed as `APP_CONFIG.beach3dScene` in `src/config.ts`). Ranges and meanings are documented inline and in `src/types/config.ts` (`Beach3DSceneConfig`) |
| `public/scene/beach3d/clouds.webp` | Cloud sprite atlas (see [Assets](#assets)) |
| `public/scene/beach3d/palm-frond.webp` | Palm frond texture (see [Assets](#assets)) |

Engine hooks:
- `vrmEngine.beach3d` is attached after lighting init.
- `syncSceneBackdrop` calls `setActive(theme === 'beach3d')`.
- `lineworkWorld` hides itself in this scene.
- The character shadow, lighting and bloom are the engine defaults shared by every scene; there is no scene-specific tint or shadow tweak.

When another scene is active, the group is hidden and costs 0 draw calls. Its geometry, materials and textures stay allocated until the engine is disposed, so switching back does not rebuild them.

## Coordinates

All layout coordinates are **relative to the character's spawn point** (`APP_CONFIG.model.spawn`, currently `z = -4`). The world group is positioned there, and the ground shader computes shoreline and patterns from local coordinates.

The camera only pitches around the character in the YZ plane and stays on the +Z side (+X is screen right). Left/right movement is the character's own `bodyTurn`. So the stage is dressed toward −Z: near sand, the shoreline at `layout.shoreZ` (curving back on both sides and wiggling slightly), the sea, then the islands on the horizon.

Props are kept out of a central zone (rocks `|x| < 2.2`, shells within 1.2 m of the character or on the sandcastle footprint, palm crowns away from the area above her, the parasol canopy right of `x ≈ 0.6`), so they never cover the character, her feet or the sea directly behind her.

## Assets

| File | Size | Content |
| :--- | :--- | :--- |
| `public/scene/beach3d/clouds.webp` | 1024×1024, ~60 KB | Four hand-painted anime clouds on a transparent background: a towering cumulus, a wide puffy cumulus, a long flat low cloud and a small cluster of puffs. Their cells (UV rect + aspect) are listed in `CLOUD_SPRITES` in `beach3dLayout.ts`. Each cell has a 14 px transparent margin. |
| `public/scene/beach3d/palm-frond.webp` | 1024×320, ~86 KB | One pinnate palm frond on a transparent background, stalk at the left (u = 0), tip at the right (u = 1), with the rachis straightened onto the centre line (v = 0.5). |

- Both were keyed from painted sheets on a flat background colour, with a soft alpha ramp and despill, so the edges stay feathered without a coloured fringe. Colour is bled into transparent pixels so mipmaps do not pick up a dark or coloured halo.
- URLs come from `APP_CONFIG.beach3dScene.assets`. They are same-origin static files and load the same way in the main app and in the `/embed` iframe.
- `public/_headers` gives `/scene/*` `Cache-Control: public, max-age=3600, must-revalidate` (the URLs carry no content hash, so they are not cached as immutable).
- The textures load only when the scene is first activated. Clouds and palm crowns stay hidden until their texture has loaded.
- Textures are sRGB, not flipped, mipmapped, with 4× anisotropy.

## Composition (8 draw calls, ~38k triangles)

| Part | Draws | Notes |
| :--- | :---: | :--- |
| Sky | 1 | Fullscreen shader that colours by view direction: zenith → mid → pale horizon gradient (`sky.horizonFadeDeg`), high wisps, a soft lavender-tinted glow band above the horizon (`sky.horizonGlow`, `horizonBand`, `horizonBandDeg`), a thin white mist on the waterline (`sky.waterMist*`), an optional drifting cloud bank (off by default) and a glow on the sun side. Horizon colours stay below the bloom threshold, so the horizon never clips to a flat white band. Azimuth is computed from the normalised horizontal view direction, so straight up and straight down have no seam or pole pinch. |
| Clouds | 1 | 27 instanced textured billboards on a far sphere. See [Clouds](#clouds). |
| Islands | 1 | One strip mesh around the horizon; three silhouette layers evaluated per pixel. See [Islands and haze](#islands-and-haze). |
| Sand + sea | 1 | One subdivided y=0 plane; see [Sand](#sand) and [Sea and waves](#sea-and-waves). Also draws foam rings around in-water rocks and the soft ground shadows of palms, sandcastle, chair and parasol (see [Ground shadows](#ground-shadows)). |
| Palm trunks | 1 | Instanced, 10 trees. See [Palms](#palms). |
| Palm crowns | 1 | Instanced, 14 textured frond ribbons per crown with tapered stalks, 13 leaf-base sheaths and 4 coconut slots (2–4 drawn per tree). |
| Rocks | 1 | Instanced smooth rocks with a 3-tone toon ramp, a soft top highlight, a cool rim and a darker wet band. Asymmetric clusters on both sides along the shore, some half in the water. |
| Shells | 0 (1 when enabled) | Off by default (`shells.enabled = false`). When enabled, 11 instanced scallop shells (544 triangles each). See [Shells](#shells). |
| Chair + parasol + lighthouse + sandcastle | 1 | One merged mesh: chair + parasol ~2.3k, lighthouse ~0.8k and sandcastle ~1.4k triangles. See [Lounge chair and parasol](#lounge-chair-and-parasol), [Lighthouse](#lighthouse) and [Sandcastle](#sandcastle). |

The character shadow is the engine's existing `CharacterShadowSystem` plane. The ground uses a polygon offset so the shadow sits stably on top of it.

## Palms

- **Layout**: each palm has its own position, scale, height multiplier, lean multiplier, lean direction and crown spin. Near the character there are two palms on the left (a near one leaning toward the sea and the frame centre, and a taller, straighter companion behind it) and one on the right whose trunk enters the frame while its crown is half outside it. Seven smaller palms continue along the shore on both sides. The near left palm uses height multiplier 0.85.
- **Trunk**: a smooth 10-sided tapered tube, 3.6 m tall before the per-tree height multiplier and scale (`PALM_TRUNK` in `beach3dLayout.ts`). The vertex shader bends a shared base curve per instance (height and lean), so every tree has a different arc. Over the top 12% of its height the trunk flares smoothly by `TRUNK_CROWN_FLARE` (0.2, in `beach3dGeometry.ts`) and closes in a rounded dome, so the crown is part of the trunk mesh (about 1.2–1.4× the trunk's top radius, no separate blob and no seam). Soft two-step shading, faint irregular rings that fade out below the crown, a warm sand tint at the base, and a smooth blend from trunk tan into the olive crown colour (`vegetation.bootColor`).
- **Crown**: 14 fronds on golden-angle azimuths, arranged by age like a real coconut palm. Each frond has a tier from young (top) to old (bottom). The petiole's starting elevation goes from `frondRiseDeg + frondTierSpreadDeg` for the youngest frond down to `frondRiseDeg − frondTierSpreadDeg` for the oldest, and the droop grows with age. Young fronds point up and out, middle fronds arch out and down, and only the oldest few droop. The result is a radiating fountain / starburst silhouette instead of a mop. Length, width, droop, azimuth, curl and twist vary per frond; young fronds are shorter and narrower.
- **Fronds**: each frond is a curved ribbon along its rachis (12 segments, 48 triangles) carrying the painted frond texture. The rachis stays straight for the first `frondStiffness` of its length (a stiff, rising petiole) and only then bends down, with the bend concentrated in the outer half (`frondDroop`), so every frond is an arch. The cross-section is an inverted V (`frondFoldDeg`, slightly deeper toward the tip): the rachis is the ridge and the leaflets slope down to both sides but stay spread like a feather rather than hanging. Width follows the texture's proportions (`vegetation.frondWidth` stretches it).
- **Attachment**: every frond starts within a few centimetres of the trunk top, inside the crown dome. Two staggered rings of small overlapping leaf-shaped sheaths (7 outer, 6 inner; narrow base, widest in the middle, pointed tip) lie on the flared crown. Their bases share the crown colour, so they grow out of the trunk without a seam; the upper halves get slightly darker edges and a greener tip. Along the first third of each rachis a thin, tapered three-sided stalk tube runs from inside the crown, shading from the crown olive into the frond green, so from below or the side each frond reads as a solid stalk growing out of the crown top.
- **Alpha**: transparent texels are discarded (alpha test, double-sided). Alpha is boosted with the mip level so distant fronds keep their coverage instead of thinning out.
- **Colour**: the texture's light/dark strokes are remapped to the configured leaf colours (`leafLight` / `leafShade`) with a little of the texture's own hue kept. Fronds are slightly darker at the root and brighter toward the tip, the hue varies per tree, shading is a soft two-step ramp with cool shade, and leaves facing away from the sun get a soft back-light glow. Whole fronds sway and the leaflet edges flutter.
- **Coconuts**: a tight one-sided cluster tucked among the leaf-base sheaths, partly hidden by them and the stalks. There are 4 slots per crown. Each tree draws `coconutMin`–`coconutMax` (2–4) of them and scales each one by ±`coconutSizeJitter` (15%); both are picked from a per-tree seed in the vertex shader, and unused slots collapse to zero size. Each nut is egg-shaped with a small seeded tilt. They are matte pastel olive (`coconutColor`) with a faint warm/cool variation and a very small highlight (`coconutShine`).

## Lounge chair and parasol

- A low-poly lounge chair at the character's right, facing the sea, built as one connected frame:
  - Two side rails with a foot bar and a head bar between them, on four legs that sink slightly into the sand.
  - A reclined backrest hinged on top of the seat rails (same x as the seat rails, with a small hinge pin on the outside). It is held up by two props in the same plane as the rails: each one's lower end is set into the seat rail directly above a head-end leg, and its upper end is set into the middle of the backrest rail. The props are thinner than the rails, so both end faces are hidden inside the rails. There are no armrests.
  - A rounded seat cushion lying on the rails from the foot end to the hinge, a back cushion lying on the backrest rails, both with pink / cream stripes, and a mint pillow on the back cushion.
- A small parasol at the head end: a slightly tilted pole that goes into the sand and up to the canopy apex, and an 8-panel canopy with alternating pink / cream panels. The fabric sags softly between the ribs, and the edge runs straight between rib tips with a very shallow inward curve, finished by a narrow hem. Underneath are 8 thin ribs, a runner on the pole and 8 stretchers; on top are a small cap and a finial.
- Shading matches the rest of the stage: two-step toon light from the engine's sun, cool shade, a soft rim. The canopy underside is a warm translucent tint, and the canopy casts a soft shadow onto the chair.
- Ground shadows of the seat, the backrest (in three height bands), the four legs, the pole and the octagonal canopy are analytic soft shapes in the ground shader, projected along the sun direction. They use the same dimensions as the geometry (`CHAIR_BACK`), and `props.groundShadow` controls their strength. The pole shadow starts from the pole's real foot in the sand, so it stays attached to the pole. They are part of the scene's own shading, not an engine shadow setting.
- A unit test checks that every chair part and every parasol part is connected to the legs or the pole, and that the legs and pole go into the sand, so no part floats.


## Lighthouse

- A small lighthouse stands in the sea to the right of the character, 12 m to the side and 30 m seaward of her (`lighthouse.x`, `lighthouse.z`, `lighthouse.scale`; at scale 1 it is about 5.2 m tall including its rock).
- From bottom to top: a rounded rock half under water with a foam ring around it, a cream plinth, a tapered tower in alternating cream / red bands with a door and two small windows facing the shore, a red gallery deck with a thin railing, a lantern room, and a red conical roof with a finial.
- It uses the same toon shading as the chair. The lantern glass and windows are partly self-lit in a warm tone (`lighthouse.glow`); there is no bloom.
- It is merged into the chair + parasol mesh (same draw call, ~0.8k triangles), bends with the horizon curvature like the other props, and is hidden together with them in the below-ground fallback (see [Known limitations](#known-limitations)). With `props.enabled = false` it is hidden too.

## Sandcastle

- A small hand-built sandcastle in the left foreground (`sandcastle.x = -1.0`, `sandcastle.z = 1.2`, `yawDeg = 22`), in front of the near left palm and well clear of the character, her shadow (which falls toward the sea) and the palm trunks and their shadows.
- At scale 1 the tallest tower is 0.45 m (0.52 m to the flag tip). From bottom to top:
  - A low, squared-off packed-sand platform (0.52 × 0.44 m, 7 cm high) with soft rounded edges and small hand-patted irregularities, slightly sunk into the beach, plus a small ramp up to the door. No round mound, no moat.
  - A central keep with an arched door and small windows, two back towers (one taller, with the flag) and a front-left tower, all cylinders with crenellated tops, and a small rounded cone turret at the front right.
  - A thin pole with a tiny coral-pink pennant (`sandcastle.flag`).
- Colour is `sandcastle.color` (a slightly darker, warmer packed-wet-sand tone than the beach) with the same two-step pastel toon shading as the other props. Windows and the door are darker recesses.
- It is merged into the chair + parasol + lighthouse mesh (same draw call, ~1.4k triangles), casts a baked soft ground shadow (see [Ground shadows](#ground-shadows)), and is hidden with the other props in the below-ground fallback or with `props.enabled = false` / `sandcastle.enabled = false`. Shells keep out of its footprint (`SANDCASTLE_RADIUS = 0.36 m × scale`).

## Ground shadows

- **Character**: the engine's `CharacterShadowSystem`, unchanged.
- **Consistency**: every ground shadow (baked palms and sandcastle, analytic chair and parasol, the real-time character shadow) is projected along the same sun direction, and only the character casts a real-time shadow, so no prop gets a second shadow.
- **Chair and parasol**: analytic soft shapes in the ground shader (see above).
- **Palms and sandcastle**: a baked shadow mask. Palm trunks (with their real bend, lean and height), the textured frond ribbons (alpha-tested, so each frond gives a long, narrow, tapering shadow with serrated leaflet edges) and the sandcastle are rendered once, projected along the sun direction onto y = 0, into a 2048 × 1024 single-channel (R8, ~2 MB) render target that covers the near beach (x −26 … 24 m, z −21 … 3 m around the character). The ground shader samples it with a small blur, using the same tone as the chair shadow and `props.groundShadow` for strength.
- The bake runs only when the scene is activated, when the frond texture finishes loading and when the sun direction changes; there is no per-frame shadow-map pass and no extra draw call in the normal frame. Palm sway is not reflected in the shadow.
- `vegetation.frondShadow` (0.85) sets frond shadows relative to the trunk shadow (lower = lighter, more dappled), and `vegetation.shadowSoftness` (1.0) scales the blur of palm and sandcastle shadows.

## Shells

- Off by default (`shells.enabled = false`); set it to `true` to show them. Only scallop shells: a slightly domed fan with 15 radial ribs, a scalloped (wavy) outer edge that follows the ribs and two small "ears" at the hinge. The shader adds fine dark rib grooves, a few faint concentric growth lines and a slightly deeper hinge.
- Sparse: `shells.count = 11` by default (8–14 recommended), at least 0.8 m apart. Two larger "hero" shells sit between the character and the camera; the rest are spread along the shore, mostly just above the swash's highest reach, with a few further up the beach.
- They avoid the character's feet, palm bases, the chair footprint, the sandcastle footprint and each other.
- Colours (`shells.colors`, earlier entries more likely): warm off-white `0xede0d1` and cream `0xeddcc6` for about two-thirds of them, a few pale pink `0xf1d2cb` and light coral `0xefc3ae`. None is pure white, and none is brighter than the sand base colour.
- Matte two-step shading: no specular highlight, no emissive term, and the lit side is at most the configured colour (×0.97), so shells never read brighter than the sand around them and never pick up bloom.

## Clouds

- **Sprites**: each cloud is a camera-facing quad on a far sphere, textured with one of the four painted clouds in the atlas. The painted shading (cream tops, lavender undersides, soft feathered edges) is used as is.
- **Variation**: per cloud, the seed picks a horizontal flip, a slight warm/cool tint (`clouds.tintJitter`) and a drift speed (±30%); widths differ per cloud, so a sprite that appears twice does not read as a copy. `clouds.tint` tints all clouds, `clouds.opacity` makes them thinner.
- **Layout**: 11 hand-placed hero clouds in front (a towering cumulus right of the character, a wide cumulus on the left, a small cluster above, flat low clouds on the horizon on both sides, and three high clouds that appear when tilting up), plus `round(16 × clouds.density)` filler clouds around the remaining azimuths. Clouds are drawn from low (far) to high (near), so higher clouds overlap lower ones.
- **Always above the horizon**: the base of every cloud sits 0.8°–40° above the visible horizon, and the fragment shader discards anything below it, so no cloud ever shows below the waterline or the ground from any camera position. Billboards never degenerate at the pitch limits.
- **Distance**: clouds right on the horizon fade slightly toward the horizon glow, and their bottoms dissolve into it.
- **Drift**: clouds drift continuously at `clouds.driftDegPerSec` (±30% per cloud) on their own clock, which keeps running when the low-FPS downgrade freezes the other animations. Only reduced motion stops it.
- **Horizon bank**: the sky shader can add a low, scalloped cloud bank on the horizon at some azimuths (`clouds.bank`, `clouds.bankHeightDeg`, coloured by `clouds.light` / `clouds.shade`). It is off by default (`bank = 0`); when enabled it drifts with the clouds.

## Islands and haze

- **Three layers**, drawn front to back with premultiplied compositing in one strip mesh. Each silhouette is evaluated per pixel from the pixel's azimuth and elevation, so outlines are smooth curves at any resolution:
  - **Far**: long pale lavender-blue ranges, almost dissolved into the sky.
  - **Mid**: blue-green islands, including an asymmetric volcano-shaped peak on the left.
  - **Near**: mint-green islands with a row of tree-crown bumps along the top, far to the left so the portrait view stays open.
- All islands are on the left half of the horizon. The right half is open sea with the lighthouse.
- **Shape**: each peak has height, width, a profile shape (dome ↔ pointed) and a skew. Detail noise breaks up the ridge line (`mountains.detail`).
- **Shading**: slopes facing the sun are slightly lighter and warmer, slopes facing away cooler, with a wide transition so there is no hard light/shade seam at a peak. Faint creases add form.
- **Haze**: each layer blends toward the waterline mist colour (`sky.waterMistColor`) by distance (`mountains.haze`), and a pale mist hugs the waterline.
- Directly behind the character only low far islands appear, so the sea stays open.

## Sand

- **Near/far tone**: slightly deeper and warmer near the camera, lighter toward the distance, then hazed into the horizon.
- **Colour patches**: soft low-frequency light/shade and warm/cool patches.
- **Grain**: three octaves of fine value noise, each faded out by its screen-space derivative so nothing shimmers.
- **Ripples**: soft, low-contrast light/shade undulations along warped wave lines, only inside a few noise-masked patches (`sand.rippleCoverage = 0.35` of the ground). Spacing is `sand.rippleSpacing = 0.7` m and strength `sand.ripple = 0.28`. They fade out toward the camera (full strength beyond `sand.rippleNearFade = 9` m, about 15% right under the camera), so the near field stays smooth and calm.
- **Wet band**: everything below the highest swash reach is darker, then dries over about 0.65 m. It reflects the sky at grazing angles and shows a soft sun highlight.

## Sea and waves

- **Depth colour**: shallow → mid → deep → horizon, computed from distance seaward of the shoreline. The boundaries are broken up by low-frequency noise, with a lighter sandbar band and a few darker patches (`sea.depthVariation`).
- **Clarity**: near the shore the sand shows through the water, with cartoon caustics in the shallows.
- **Swash**: the water edge runs up the beach quickly and draws back slowly. The reach and foam width change every cycle and along the shore (`sea.foamVariation`). The foam head has irregular holes (`sea.foamBreakup`) and two layers of trailing lace. A thin foam line is left at the highest reach, and the previous cycle's line fades out behind it.
- **Wave bands**: 3 crest bands by default (`sea.waveBands`, 0–4), each with its own speed, start distance and phase. Crest lines bend along the shore with noise, break into segments, and vary in width, so successive waves never look the same. Each crest has a lighter strip of water in front and a slightly deeper band behind, and merges into the swash near the shore.
- **Glints**: twinkling four-point stars drawn in screen space (a fixed pixel size at any distance, `sea.glintSize`), in two cell sizes for near and mid water, more on the sun side.

## Horizon curvature (horizon at the hips)

On a flat ground plane the sea horizon always sits at eye height, which puts it at the shoulders in a full-body shot. Anime stages put it lower, around the waist or hips. To do that, ground, palms, rocks, shells and props bend down beyond `d0 = (horizontal camera→character distance) + 3 m`:

```
drop(d) = max(0, d − d0)² / (2 · layout.horizonCurveR)
```

Near the character the ground stays perfectly flat, so feet, shadow and props are unchanged.

The visible horizon then dips below eye level by:

```
dip = atan((h + e²/2R) / d*),   d* = √(d0² + 2Rh),   e = d* − d0
```

Here `h` is the camera height. `computeHorizonDip()` evaluates this every frame. The sky gradient (`uDipSin`) and the island and cloud layers (`uDipTan`) are aligned to the same dip, so the seam stays clean. The dip depends only on the camera height, so the horizon is fixed in world space and moves on screen only as the camera pitches. The engine's ground clamp keeps the camera at least `camera.groundClamp.minHeight` (0.15 m) above the sand (see [`PLATFORM_DIFFERENCES.md`](PLATFORM_DIFFERENCES.md) §5), so at steep upward pitch the horizon sits at about the line of the character's feet.

With `horizonCurveR = 700` the horizon lands around the hips in full-body portrait shots. A larger R makes the ground flatter and moves the horizon back toward eye height.

## Render and post-processing conventions

- Colour uniforms are linear. Output is multiplied by `uComp` (= 1 / exposure), so a config hex is roughly the colour that appears on screen.
- All scene pixels are opaque (alpha 1). Post-processing treats the scene like any other: the UnrealBloom pass has no beach-specific handling (see `POSTFX.md`).
- Clouds and islands follow the camera's translation (not its rotation) and live inside the 100 m far plane, which makes them effectively infinitely far away.
- The sky draws first (`renderOrder −1000`), then clouds (−990), then islands (−980).

## Dynamics and fallbacks

These are animated: swash, wave bands, foam, caustics, glints, high wisps, cloud drift and palm sway. They run through `SceneMotionGovernor` with `dynamics.respectReducedMotion` and `dynamics.autoDowngrade`. If `prefers-reduced-motion` is set, or the average FPS drops below `minFps`, the scene freezes on a well-composed static frame (`STATIC_TIME`) for the rest of the session. A downgrade mid-session freezes the animations where they are instead of jumping back. Cloud drift (and the optional horizon bank) runs on a separate clock that keeps going under the FPS downgrade, so clouds never snap back or stop; only reduced motion freezes it.

## Config (`APP_CONFIG.beach3dScene`)

| Group | Fields |
| :--- | :--- |
| `layout` | `shoreZ`, `shoreCurve`, `shoreWiggle`, `horizonCurveR` |
| `sky` | `zenith`, `mid`, `horizon`, `horizonFadeDeg`, `horizonGlow`, `horizonBand`, `horizonBandDeg`, `horizonLine`, `waterMist`, `waterMistDeg`, `waterMistColor`, `sunGlow`, `cirrus` |
| `sea` | `shallow`, `mid`, `deep`, `horizon`, `foam`, `glint`, `glintDensity`, `glintSpeed`, `glintSize`, `foamWidth`, `swashAmp`, `swashSpeed`, `waves`, `waveBands`, `foamVariation`, `foamBreakup`, `depthVariation` |
| `sand` | `base`, `shade`, `light`, `wet`, `rippleSpacing`, `ripple`, `rippleCoverage`, `rippleNearFade`, `grain` |
| `haze` | `start`, `end` (aerial perspective toward the horizon colour; `end` must stay < 100 m) |
| `mountains` | `enabled`, `far`, `mid`, `near`, `heightScale`, `detail`, `haze` (island layers) |
| `assets` | `clouds`, `frond` (texture URLs, see [Assets](#assets)) |
| `clouds` | `density`, `size`, `opacity`, `tint`, `tintJitter`, `driftDegPerSec`, `light`, `shade`, `bank`, `bankHeightDeg` |
| `vegetation` | `leafLight`, `leafShade`, `trunkLight`, `trunkShade`, `sway`, `fronds`, `frondWidth`, `frondRiseDeg`, `frondTierSpreadDeg`, `frondDroop`, `frondStiffness`, `frondFoldDeg`, `frondShadow`, `shadowSoftness`, `bootColor`, `coconutColor`, `coconutShine`, `coconutMin`, `coconutMax`, `coconutSizeJitter` |
| `rocks` | `enabled`, `light`, `shade`, `detail` (0 / 1 / 2 → 80 / 320 / 1280 triangles per rock) |
| `shells` | `enabled`, `count`, `size`, `colors` |
| `props` | `enabled`, `frame`, `cushion`, `stripe`, `canopyA`, `canopyB`, `pillow`, `groundShadow` (lounge chair + parasol; `groundShadow` also sets palm and sandcastle shadow strength) |
| `lighthouse` | `enabled`, `x`, `z`, `scale`, `body`, `band`, `roof`, `glass`, `rock`, `glow` |
| `sandcastle` | `enabled`, `x`, `z`, `scale`, `yawDeg`, `color`, `flag` |
| `dynamics` | `enabled`, `respectReducedMotion`, `autoDowngrade { enabled, minFps, windowFrames }` |

## Measured cost

Measured on an Apple M1 Ultra with headless Chrome (ANGLE Metal), post-processing on, dynamics running, shells off and `sea.waveBands = 4` (the default is 3; wave bands are drawn in the ground shader and add no geometry):

| Metric | Value |
| :--- | :--- |
| Scene draws / triangles (`getStats()`) | 8 / 38,054 |
| Whole frame | 70 draw calls / 157.1k triangles, of which the character is 47 calls / 121.7k triangles; post-processing is 15 passes |
| GPU frame time | 3.6 ms at 1280×800, DPR 1; 10.5 ms at DPR 2 |
| Frame rate | 60 fps (vsync) up to 2560×1440 at DPR 1.5; about 50 fps at 2560×1440, DPR 2 |
| GPU texture memory | about 9 MiB |
| Scene switching | Leaving the scene hides it and keeps its resources until the engine is disposed; repeated switching showed no leak |

Low-end and mobile GPUs have not been measured.

To inspect at runtime, use `window.vrmEngine.beach3d.getStats()`.

## Known limitations

- The horizon curvature is a deliberate cheat. With very low or very high camera heights the dip changes. It stays seamless, but the horizon moves.
- The scene assumes the camera stays above the ground, which the engine's ground clamp guarantees. With `camera.groundClamp.enabled = false` the camera can go below the ground at steep upward pitch: the ground is then back-face culled, palms, shells, rocks, the chair and the sandcastle are hidden as a safety net, and the sky shows the far-sea colour below the horizon.
- At steep upward pitch the camera sits 0.15 m above the sand. From that height the sea is only a thin strip behind the beach, and nearby palms and the parasol loom large overhead.
- Clouds are flat painted billboards: they always face the camera, have no parallax and do not react to the sun direction.
- The painted textures are fixed in style and resolution: very large clouds on high-DPI screens are slightly soft, and a frond seen exactly edge-on reads as a thin line.
