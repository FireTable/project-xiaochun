# `beach3d` Scene: Real-time 3D Anime MMD Stage Beach

`beach3d` (display name "海滩" / "Beach" / "ビーチ") is the 4th built-in scene and is opaque. It is a small 3D stage built entirely in Three.js. The character stands on real sand with a real shadow, and every prop is a low-poly mesh with soft toon shading.

The look is **二次元 MMD 舞台风格** (anime MMD stage): soft modern 3D anime, high-key diffused light, soft shadow transitions, a peach-pink / lavender / mint / cream pastel palette and clean stylized shapes. It is not photoreal and uses no HDRI.
- An asymmetric palm composition: a cluster of three palms on the left, one tall framing palm leaning out of frame on the right, and smaller palms further along the shore. Crowns are arched, drooping fronds.
- A striped beach lounge chair with a small parasol on the right, facing the sea.
- A clear turquoise sea, light near the shore and deeper further out, with irregular swash foam, several wave bands and twinkling glints.
- Fine, soft sand with a darker, glossy wet band at the water's edge, and shells scattered mostly along the wet line.
- A blue-to-pale-cyan sky with volumetric-looking anime cumulus, a low cloud bank on the horizon and high wisps.
- Layered distant island silhouettes fading into atmospheric haze.

There are no textures, no HDRI, no realistic materials and no third-party assets. All geometry is generated in code, and every pattern is computed procedurally in shaders. Light direction and colour follow the engine's main light, so the scene blends with the MToon character.

## Where things live

| File | Role |
| :--- | :--- |
| `src/core/scene/beach3d/beach3dWorld.ts` | `Beach3DWorld`: builds and owns all meshes, does the per-frame updates, `getStats()`, `dispose()` |
| `src/core/scene/beach3d/beach3dShaders.ts` | GLSL for sky, clouds, islands, ground (sand + sea), palms, rocks, shells, chair + parasol |
| `src/core/scene/beach3d/beach3dGeometry.ts` | Procedural low-poly geometry: palm trunk and crown (with coconuts), island strip, rock, shell set, chair + parasol |
| `src/core/scene/beach3d/beach3dLayout.ts` | Pure data and functions (no three / DOM): shoreline, palm / rock / shell / cloud layout, chair and parasol placement, island peaks and silhouette profile |
| `src/core/scene/sceneMotion.ts` | `SceneMotionGovernor`: reduced-motion and low-FPS downgrade |
| `src/core/scene/__tests__/beach3dLayout.test.ts` | Layout invariants (props on sand, keep-out zones, asymmetric palms, chair placement, island heights, cloud layout, shell distribution, triangle budget) |
| `src/config.ts` → `APP_CONFIG.beach3dScene` | All tunables. Ranges and meanings are documented inline and in `src/types/config.ts` (`Beach3DSceneConfig`) |

Engine hooks:
- `vrmEngine.beach3d` is attached after lighting init.
- `syncSceneBackdrop` calls `setActive(theme === 'beach3d')`.
- `lineworkWorld` hides itself in this scene.
- The character shadow, lighting and bloom are the engine defaults shared by every scene; there is no scene-specific tint or shadow tweak.

When another scene is active, the group is invisible and costs 0 draw calls.

## Coordinates

All layout coordinates are **relative to the character's spawn point** (`APP_CONFIG.model.spawn`, currently `z = -4`). The world group is positioned there, and the ground shader computes shoreline and patterns from local coordinates.

The camera only pitches around the character in the YZ plane and stays on the +Z side (+X is screen right). Left/right movement is the character's own `bodyTurn`. So the stage is dressed toward −Z: near sand, the shoreline at `layout.shoreZ` (curving back on both sides and wiggling slightly), the sea, then the islands on the horizon.

Props are kept out of a central zone (rocks `|x| < 2.2`, shells within 1.2 m of the character, palm crowns away from the area above her, the parasol canopy right of `x ≈ 0.6`), so they never cover the character, her feet or the sea directly behind her.

## Composition (9 draw calls, ~50k triangles)

| Part | Draws | Notes |
| :--- | :---: | :--- |
| Sky | 1 | Fullscreen shader that colours by view direction: zenith → mid → pale horizon gradient, high wisps, a bright band and a low cloud bank on the horizon, and a glow on the sun side. Azimuth is computed from the normalised horizontal view direction, so straight up and straight down have no seam or pole pinch. |
| Clouds | 1 | 24 instanced billboards on a far sphere. See [Clouds](#clouds). |
| Islands | 1 | One strip mesh around the horizon; three silhouette layers evaluated per pixel. See [Islands and haze](#islands-and-haze). |
| Sand + sea | 1 | One subdivided y=0 plane; see [Sand](#sand) and [Sea and waves](#sea-and-waves). Also draws foam rings around in-water rocks and the soft ground shadows of palms, chair and parasol. |
| Palm trunks | 1 | Instanced, 11 trees. See [Palms](#palms). |
| Palm crowns | 1 | Instanced, 13 fronds per crown plus 4 coconuts. |
| Rocks | 1 | Instanced smooth rocks with a 3-tone toon ramp, a soft top highlight, a cool rim and a darker wet band. Asymmetric clusters on both sides along the shore, some half in the water. |
| Shells | 1 | 32 instanced scallops, conches and starfish in one shared geometry (each instance collapses the other two shapes). |
| Chair + parasol | 1 | One merged mesh. See [Lounge chair and parasol](#lounge-chair-and-parasol). |

The character shadow is the engine's existing `CharacterShadowSystem` plane. The ground uses a polygon offset so the shadow sits stably on top of it.

## Palms

- **Layout**: each palm has its own position, scale, height multiplier, lean multiplier, lean direction and crown spin. Near the character there are three palms on the left (a near one leaning toward the sea and the frame centre, a taller straighter one behind it, and a small young palm near the water) and one on the right whose trunk enters the frame while its crown is half outside it. Seven smaller palms continue along the shore on both sides.
- **Trunk**: a smooth 10-sided tapered tube. The vertex shader bends a shared base curve per instance (height and lean), so every tree has a different arc. Soft two-step shading, faint irregular rings, a warm sand tint at the base.
- **Crown**: 13 fronds on golden-angle azimuths. About a third are young upper fronds that rise before arching over; the rest leave nearly horizontal and droop strongly, with a slight curl. Each frond is a rachis ribbon with 16 pairs of long leaflets swept toward the tip; leaflets hang lower and further out toward the frond tip, which gives the drooping anime silhouette. Colour runs from dark at the root to bright at the tip, the hue varies per tree, and leaves facing away from the sun get a soft back-light glow. Whole fronds sway and leaflets flutter.
- **Coconuts**: 4 egg-shaped spheres under each crown with two-step shading and a small highlight.

## Lounge chair and parasol

- A low-poly lounge chair at the character's right, facing the sea: a cream frame (legs, rails, foot bar), a rounded seat cushion and a reclined backrest with pink / cream stripes, and a mint pillow.
- A small parasol at the head end: a slightly tilted pole, an 8-panel canopy with alternating pink / cream panels, a gentle sag between ribs, a scalloped edge and a finial.
- Shading matches the rest of the stage: two-step toon light from the engine's sun, cool shade, a soft rim. The canopy underside is a warm translucent tint, and the canopy casts a soft shadow onto the chair.
- Ground shadows of chair, backrest, pole and canopy are analytic soft shapes in the ground shader, projected along the sun direction (`props.groundShadow` controls their strength). They are part of the scene's own shading, not an engine shadow setting.

## Shells

- 4 larger "hero" shells (about 15–17 cm) sit between the character and the camera so they read at portrait distance.
- The rest are spread with a triangular distribution along the shore: about 55% within 1.2 m above the swash's highest reach, 30% in the next 3 m and 15% further up the beach.
- They avoid the character's feet, palm bases, the chair footprint and each other.
- Cream, pale pink and pale coral with two-step toon shading and a small highlight.

## Clouds

- **Shape**: each billboard is shaded like a soft sphere cluster. 18 lobes (body, crown, shoulders, base) are evaluated as sphere impostors; the front-most lobe's normal drives a 3-tone light ramp (cream lit side → soft mid → lavender shade), with slight darkening in the crevices between lobes, a flat lavender base, and a thin bright rim. Edge softness is adjustable (`clouds.edgeSoftness`).
- **Kinds**: tall cumulus (aspect ≈ 0.8–0.95), medium puffs (≈ 0.55) and flat low strips (≈ 0.3).
- **Layout**: 9 hand-placed hero clouds (two clouds in the default portrait view, low strips near the horizon, and three high clouds that appear when pitching up), plus filler clouds around the remaining azimuths. Elevations stay below 60°, so billboards never degenerate at the pitch limits.
- **Distance**: clouds right on the horizon fade slightly toward the horizon band; their bottoms dissolve into the bright band. Each cloud drifts at a slightly different speed.
- **Horizon bank**: the sky shader adds a low, scalloped cloud bank on the horizon at some azimuths (`clouds.bank`, `clouds.bankHeightDeg`).

## Islands and haze

- **Three layers**, drawn front to back with premultiplied compositing in one strip mesh. Each silhouette is evaluated per pixel from the pixel's azimuth and elevation, so outlines are smooth curves at any resolution:
  - **Far**: long pale lavender-blue ranges, almost dissolved into the sky.
  - **Mid**: blue-green islands, including an asymmetric volcano-shaped peak on the left and a low, very hazy island on the right.
  - **Near**: mint-green islands with a row of tree-crown bumps along the top; placed at the sides so the portrait view stays open.
- **Shape**: each peak has height, width, a profile shape (dome ↔ pointed) and a skew. Detail noise breaks up the ridge line (`mountains.detail`).
- **Shading**: slopes facing the sun are slightly lighter and warmer, slopes facing away cooler, with a wide transition so there is no hard light/shade seam at a peak. Faint creases add form.
- **Haze**: each layer blends toward the horizon colour by distance (`mountains.haze`), and a pale mist hugs the waterline.
- Directly behind the character only low far islands appear, so the sea stays open.

## Sand

- **Near/far tone**: slightly deeper and warmer near the camera, lighter toward the distance, then hazed into the horizon.
- **Colour patches**: soft low-frequency light/shade and warm/cool patches.
- **Grain**: three octaves of fine value noise, each faded out by its screen-space derivative so nothing shimmers.
- **Ripples**: soft light/shade undulations along warped wave lines inside a few noise-masked patches.
- **Wet band**: everything below the highest swash reach is darker, then dries over about 0.65 m. It reflects the sky at grazing angles and shows a soft sun highlight.

## Sea and waves

- **Depth colour**: shallow → mid → deep → horizon, computed from distance seaward of the shoreline. The boundaries are broken up by low-frequency noise, with a lighter sandbar band and a few darker patches (`sea.depthVariation`). The shallow colours are unchanged from earlier versions.
- **Clarity**: near the shore the sand shows through the water, with cartoon caustics in the shallows.
- **Swash**: the water edge runs up the beach quickly and draws back slowly. The reach and foam width change every cycle and along the shore (`sea.foamVariation`). The foam head has irregular holes (`sea.foamBreakup`) and two layers of trailing lace. A thin foam line is left at the highest reach, and the previous cycle's line fades out behind it.
- **Wave bands**: up to 4 crest bands (`sea.waveBands`), each with its own speed, start distance and phase. Crest lines bend along the shore with noise, break into segments, and vary in width, so successive waves never look the same. Each crest has a lighter strip of water in front and a slightly deeper band behind, and merges into the swash near the shore.
- **Ripples**: short warped ripple strokes, denser near the shore.
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

Here `h` is the camera height. `computeHorizonDip()` evaluates this every frame. The sky gradient (`uDipSin`) and the island and cloud layers (`uDipTan`) are aligned to the same dip, so the seam stays clean.

With `horizonCurveR = 700` the horizon lands around the hips in full-body portrait shots. A larger R makes the ground flatter and moves the horizon back toward eye height.

## Render and post-processing conventions

- Colour uniforms are linear. Output is multiplied by `uComp` (= 1 / exposure), so a config hex is roughly the colour that appears on screen.
- All scene pixels are opaque (alpha 1). Post-processing treats the scene like any other: the UnrealBloom pass has no beach-specific handling (see `POSTFX.md`).
- Clouds and islands follow the camera's translation (not its rotation) and live inside the 100 m far plane, which makes them effectively infinitely far away.
- The sky draws first (`renderOrder −1000`), then clouds (−990), then islands (−980).

## Dynamics and fallbacks

These are animated: swash, wave bands, foam, caustics, ripples, glints, high wisps, cloud drift and palm sway. They run through `SceneMotionGovernor` with `dynamics.respectReducedMotion` and `dynamics.autoDowngrade`. If `prefers-reduced-motion` is set, or the average FPS drops below `minFps`, the scene freezes on a well-composed static frame (`STATIC_TIME`) for the rest of the session.

## Config (`APP_CONFIG.beach3dScene`)

| Group | Fields |
| :--- | :--- |
| `layout` | `shoreZ`, `shoreCurve`, `shoreWiggle`, `horizonCurveR` |
| `sky` | `zenith`, `mid`, `horizon`, `sunGlow`, `cirrus`, `horizonBand` |
| `sea` | `shallow`, `mid`, `deep`, `horizon`, `foam`, `ripple`, `rippleDensity`, `glint`, `glintDensity`, `glintSpeed`, `glintSize`, `foamWidth`, `swashAmp`, `swashSpeed`, `waves`, `waveBands`, `foamVariation`, `foamBreakup`, `depthVariation` |
| `sand` | `base`, `shade`, `light`, `wet`, `rippleSpacing`, `ripple`, `grain` |
| `haze` | `start`, `end` (aerial perspective toward the horizon colour; `end` must stay < 100 m) |
| `mountains` | `enabled`, `far`, `mid`, `near`, `heightScale`, `detail`, `haze` (island layers) |
| `clouds` | `count`, `driftDegPerSec`, `scale`, `light`, `shade`, `edgeSoftness`, `bank`, `bankHeightDeg` |
| `vegetation` | `leafLight`, `leafShade`, `trunkLight`, `trunkShade`, `sway`, `fronds`, `leaflets` |
| `rocks` | `enabled`, `light`, `shade`, `detail` (0 / 1 / 2 → 80 / 320 / 1280 triangles per rock) |
| `shells` | `enabled`, `count`, `size`, `colors` |
| `props` | `enabled`, `frame`, `cushion`, `stripe`, `canopyA`, `canopyB`, `pillow`, `groundShadow` (lounge chair + parasol) |
| `dynamics` | `enabled`, `respectReducedMotion`, `autoDowngrade { enabled, minFps, windowFrames }` |

## Measured cost

Measured on an Apple M1 Ultra (Chrome, ANGLE Metal) with headless Puppeteer at 1280×800, DPR 1, post-processing on, and dynamics running:

| Scene | Scene draws / triangles (`getStats`) | Whole frame calls / triangles (incl. shadow map + post passes) | FPS (p50 / p95 frame time) |
| :--- | :--- | :--- | :--- |
| `beach3d` | 9 / 50,462 | 71 / 172,189 | 59.8 (16.67 / 16.67 ms) |
| `light` (baseline) | — | 73 / 122,469 | 60.0 (16.66 / 16.67 ms) |

Both are capped by vsync on this machine. Low-end and mobile GPUs have not been measured.

To inspect at runtime, use `window.vrmEngine.beach3d.getStats()`.

## Known limitations

- The horizon curvature is a deliberate cheat. With very low or very high camera heights the dip changes. It stays seamless, but the horizon moves.
- When the camera is below the ground (extreme upward pitch at close distance), the ground is back-face culled. Shells, rocks and the chair are hidden in that case; only the sky, clouds, islands and palms show.
- Clouds are billboards: they always face the camera and have no parallax between lobes.
