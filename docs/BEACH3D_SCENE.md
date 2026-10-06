# `beach3d` Scene: Real-time 3D Anime Beach Stage

`beach3d` (display name "海滩" / "Beach" / "ビーチ") is the 4th built-in scene and is opaque. It is a small 3D stage built entirely in Three.js. The character stands on real sand with a real shadow, and every prop is a low-poly mesh with toon shading.

The look aims for an **anime MMD stage** (like an MMD or miHoYo PV set):
- 3D toon-shaded props: palm trees with gently S-curved, tapering trunks, full layered fronds and round coconuts, smooth rounded shore rocks, and a few small shells on the sand.
- High-key daylight and a clear turquoise sea, light near the shore and deeper further out.
- Cartoon waves that run up the beach and draw back, plus wave crests rolling in near the shore.
- Fine, soft sand with a darker, glossy wet band at the water's edge.
- A sky that runs from saturated blue at the zenith to pale cyan-white at the horizon, with cel-style cumulus clouds, broken high wisps and a bright band near the horizon.
- Three layers of green island silhouettes on the horizon: deeper and more saturated up close, paler and mistier further away.

There are no textures, no HDRI, no realistic materials and no third-party assets. All geometry is generated in code, and every pattern (sand grain and ripples, foam, waves, caustics, sea strokes, glints, trunk rings, cloud lobes) is computed procedurally in shaders. Light direction and colour follow the engine's main light, so the scene blends with the MToon character.

## Where things live

| File | Role |
| :--- | :--- |
| `src/core/scene/beach3d/beach3dWorld.ts` | `Beach3DWorld`: builds and owns all meshes, does the per-frame updates, `getStats()`, `dispose()` |
| `src/core/scene/beach3d/beach3dShaders.ts` | GLSL for sky, clouds, islands, ground (sand + sea), palms, rocks, shells |
| `src/core/scene/beach3d/beach3dGeometry.ts` | Procedural low-poly geometry: palm trunk and crown (with coconuts), island silhouettes, rock, shell set |
| `src/core/scene/beach3d/beach3dLayout.ts` | Pure data and functions (no three / DOM): shoreline, palm / rock / shell layout, island peaks and silhouette profile |
| `src/core/scene/sceneMotion.ts` | `SceneMotionGovernor`: reduced-motion and low-FPS downgrade |
| `src/core/scene/__tests__/beach3dLayout.test.ts` | Layout invariants (props on sand, keep-out zones, shoreline, horizon dip, shells above the swash, triangle budget) |
| `src/config.ts` → `APP_CONFIG.beach3dScene` | All tunables. Ranges and meanings are documented in `src/types/config.ts` (`Beach3DSceneConfig`) |

Engine hooks:
- `vrmEngine.beach3d` is attached after lighting init.
- `syncSceneBackdrop` calls `setActive(theme === 'beach3d')`.
- `lineworkWorld` hides itself in this scene.
- The character shadow uses a full, non-soft shadow plane with no contact blob. Its colour and opacity are the engine defaults (black, `shadow.opacityLight`).
- Lighting colours are the engine defaults shared by every scene; there is no scene-specific tint.

When another scene is active, the group is invisible and costs 0 draw calls.

## Coordinates

All layout coordinates are **relative to the character's spawn point** (`APP_CONFIG.model.spawn`, currently `z = -4`). The world group is positioned there, and the ground shader computes shoreline and patterns from local coordinates.

The camera only pitches around the character in the YZ plane and stays on the +Z side. Left/right movement is the character's own `bodyTurn`. So the stage is dressed toward −Z:
- Near sand.
- The shoreline at `layout.shoreZ`, which curves back on both sides (`shoreCurve`) and wiggles slightly.
- Then the sea.
- Then the islands on the horizon.

Props are kept out of a central zone (rocks `|x| < 2.2`, shells within 1.2 m of the character) so they never cover the character, her feet, or the sea directly behind her.

## Composition (8 draw calls, ~37k triangles)

| Part | Draws | Notes |
| :--- | :---: | :--- |
| Sky | 1 | Fullscreen shader that colours by view direction: a saturated-blue zenith → mid → pale cyan-white horizon gradient, high wisps, a soft bright band near the horizon, and a glow on the sun side. The wisps are domain-warped, stretched fractal noise, broken into short pieces and gathered into a few patches by a low-frequency mask, so they read as scattered strands rather than continuous ribbons. They drift slowly. Pitching to ±89° never shows an edge or black. |
| Clouds | 1 | 22 instanced billboards on a far sphere, drawn far to near. See [Clouds](#clouds). |
| Islands | 1 | Three silhouette layers (far, mid, near) of rounded island domes. See [Islands and horizon](#islands-and-horizon). Directly behind the character the far layer is kept low so the sea stays open. |
| Sand + sea | 1 | One subdivided y=0 plane; see [Sand](#sand) and [Sea and waves](#sea-and-waves). Also draws foam rings around in-water rocks. |
| Palm trunks | 1 | Instanced. See [Palm trunks](#palm-trunks). |
| Palm crowns | 1 | Instanced. 10 pinnate fronds per crown (3 short, upright young fronds and 7 long drooping ones). Each frond is an arching rachis with two rows of separate pointed leaflets that splay downward in a V and droop slightly, so the crown has real volume and layering. The colour runs dark at the root to bright at the tip, both along the frond and along each leaflet, with cool-tinted shade and normals biased upward for soft two-step shading. Whole fronds sway and leaflets flutter. Under each crown hangs a cluster of 4 coconuts: smooth-normal, slightly egg-shaped spheres (180 triangles each) with two-step toon shading from yellow-green to warm brown, a small cartoon highlight and a faint rim on the shadow side. |
| Rocks | 1 | Instanced smooth rocks: a subdivided icosahedron with merged vertices (smooth normals), low-frequency sine bumps and a flattened base. 3-tone toon ramp, a soft highlight on top, a faint sky-blue rim on the shadow side, faint mottling, and a darker wet band where they meet sand or water. They sit in clusters on both sides along the shore, and some are half in the water. |
| Shells | 1 | 18 instanced beach trinkets: scallops (ribbed fan domes), conches (spiral cones lying on their side) and starfish (puffy five-armed stars with pale dots). All three shapes share one geometry; each instance shows only its own shape (the vertex shader collapses the other two), so they cost a single draw. Cream, pale pink and pale coral, two-step toon shading with a small highlight. About three quarters sit just above the swash's highest reach on the damp sand, the rest are scattered on dry sand. They avoid the character's feet and palm bases. Deterministic layout; sizes vary from about 6 to 13 cm (slightly larger than life so they read at a distance). |

The character shadow is the engine's existing `CharacterShadowSystem` plane. The ground uses a polygon offset so the shadow sits stably on top of it.

## Clouds

Each cloud is drawn like a hand-painted cel cumulus. The billboard shader builds it from 16 round lobes of different sizes, staggered in height:
- 3 large back lobes form the body.
- 3 smaller lobes on top give the irregular "cauliflower" crown.
- 5 shoulder lobes step down and shrink toward the sides.
- 5 small front lobes sit along the base.

Every lobe edge has a slight continuous wobble, so no lobe is a perfect circle.

- **Outline**: the union of all lobes, with the base gently flattened along a horizontal line. The edges are analytic circles with about 1.5 px of anti-aliasing: crisp but not hard, with no blur.
- **Light and shade**: the lit area is the union of each lobe's disc, shrunk and shifted toward the light. High lobes are almost fully lit and merge into one bright mass, with no internal outlines. Lower lobes get smaller lit discs, and lobes whose tops are buried inside the cloud get none, so the shadowed underside is not dotted with stray highlights. The light/shade boundary is therefore a chain of arcs that follows each lobe's volume, not a uniform band.
- **Colour**: cream-white lit side and pale blue-violet shade, slightly deeper toward the base. There is a thin hint of translucency at the shaded rim, and the lit side darkens very slightly just before the terminator so the edge reads soft.
- **Distance**: about half the clouds are small and low (2.5°–8.5° elevation), flatter, fainter and tinted toward the horizon band. Mid clouds sit at 8°–18°. A few large ones at 16°–32° can grow into towering cumulus. Bottoms near the horizon fade into the bright band. Every cloud drifts at a slightly different speed (±30%).
- Elevations stay at or below 32°, so the billboards never degenerate at the pitch limits.

## Islands and horizon

- **Three layers** of rounded island domes (`h · (1 − t²)^0.7`), drawn far to near in one mesh:
  - **Near**: small, the most saturated green.
  - **Mid**: a softer green.
  - **Far**: pale, almost dissolved into the horizon.
- **Tree-line bumps**: near and mid islands carry a row of irregular round bumps along the top, like a cartoon tree line. Each bump has a lighter yellow-green top edge on the sun side and a slight shade on the other.
- **Shading**: slopes facing the sun are a step lighter and warmer; slopes facing away are cooler.
- **Aerial perspective**: each layer gets an overall haze that increases with distance, plus a low pale mist hugging the sea that is densest at the waterline.
- **Horizon**: a soft bright band sits above the horizon, with a very thin white line right at the sea's edge.

## Palm trunks

- **Shape**: an elegant, slightly S-shaped arc. It rises almost vertically from the sand, leans out through the middle and straightens a little under the crown. The trunk is a smooth 10-sided tube with 24 rings, denser near the base. It tapers smoothly from base to top with a gentle flare where it enters the sand. The geometry has no segments; the surface detail is all in the shader.
- **Shading**: soft two-step toon shading, with a warm light brown-grey lit side and a cool grey-mauve shade. A gentle highlight on the lit side and slight darkening at the silhouette give a rounded, cylindrical feel.
- **Rings**: faint, narrow horizontal rings. Their spacing is randomised by noise, about half are missing, widths and strengths vary, and each ring fades in and out around the circumference, so there are no stripes or blocks. Every tree gets a different ring pattern. A very faint vertical grain sits underneath.
- **Colour toward the ends**: slightly darker just below the crown. At the base, a warm sand tint and a narrow contact shade blend it into the beach.

## Sand

- **Near/far tone**: slightly deeper and warmer near the camera, lighter toward the distance, then hazed into the horizon.
- **Colour patches**: soft low-frequency patches at two scales: light and shade patches, plus large warm and cool tints.
- **Grain**: three octaves of fine value noise (very high frequency). Each octave fades out by its own screen-space derivative, so up close the sand looks finely granular, further away it smooths out layer by layer, and nothing shimmers. Sparse tiny darker and paler grains fade out the same way.
- **Ripples**: only inside a few noise-masked patches. They are soft light/shade undulations along strongly warped wave lines (lit slope brighter, shaded slope darker), not drawn lines. They fade with distance.
- **Wet band**: everything below the highest swash reach is darker. Above it the sand dries over about 0.65 m. The wet band reflects the sky (stronger at grazing angles) and shows a soft sun highlight.

## Sea and waves

- **Depth colour** is computed from a static coordinate (distance seaward of the shoreline), so the shallow band does not move with the swash. It goes from shallow to mid to deep, then into the horizon colour.
- **Clarity**: near the shore the sand shows through the water, and cartoon caustics (thin bright noise iso-lines) move across the shallows.
- **Ripples and glints**: short ripple strokes (denser near the shore) and twinkling star glints (more on the sun side).
- **Crests**: three wave crests roll in from about 7.5 m out. Each is a broken white line that thickens near the shore, with a lighter strip of water in front and a slightly deeper band behind. They fade out where they merge into the swash.
- **Swash**: the water edge runs up the beach quickly (ease-out over the first 38% of the cycle) and draws back slowly. The edge is scalloped and slightly out of phase along the shore.
  - The foam head is thicker while advancing and thinner while retreating, with a few holes where the water shows through, and trailing lace behind it.
  - A thin foam line is left at the highest reach and fades as the water retreats.

## Horizon curvature (horizon at the hips)

On a flat ground plane the sea horizon always sits at eye height, which puts it at the shoulders in a full-body shot. Anime stages put it lower, around the waist or hips. To do that, ground, palms, rocks and shells bend down beyond `d0 = (horizontal camera→character distance) + 3 m`:

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
- The sky draws first (`renderOrder −1000`), then clouds, then islands.

## Dynamics and fallbacks

These are animated: swash, crests, foam, caustics, ripples, glints, high wisps, cloud drift, and palm sway. They run through `SceneMotionGovernor` with `dynamics.respectReducedMotion` and `dynamics.autoDowngrade`. If `prefers-reduced-motion` is set, or the average FPS drops below `minFps`, the scene freezes on a well-composed static frame (`STATIC_TIME`) for the rest of the session.

## Config (`APP_CONFIG.beach3dScene`)

| Group | Fields |
| :--- | :--- |
| `layout` | `shoreZ`, `shoreCurve`, `shoreWiggle`, `horizonCurveR` |
| `sky` | `zenith`, `mid`, `horizon`, `sunGlow`, `cirrus`, `horizonBand` |
| `sea` | `shallow`, `mid`, `deep`, `horizon`, `foam`, `ripple`, `rippleDensity`, `glint`, `glintDensity`, `glintSpeed`, `foamWidth`, `swashAmp`, `swashSpeed`, `waves` |
| `sand` | `base`, `shade`, `light`, `wet`, `rippleSpacing`, `ripple`, `grain` |
| `haze` | `start`, `end` (aerial perspective toward the horizon colour; `end` must stay < 100 m) |
| `mountains` | `enabled`, `far`, `mid`, `near`, `heightScale` (island layers) |
| `clouds` | `count`, `driftDegPerSec`, `scale`, `light`, `shade` |
| `vegetation` | `leafLight`, `leafShade`, `trunkLight`, `trunkShade`, `sway` |
| `rocks` | `enabled`, `light`, `shade`, `detail` (0 / 1 / 2 → 80 / 320 / 1280 triangles per rock) |
| `shells` | `enabled`, `count`, `size`, `colors` |
| `dynamics` | `enabled`, `respectReducedMotion`, `autoDowngrade { enabled, minFps, windowFrames }` |

## Measured cost

Measured on an Apple M1 Ultra (Chrome, ANGLE Metal) with headless Puppeteer at 1280×800, DPR 1, post-processing on, and dynamics running:

| Scene | Scene draws / triangles (`getStats`) | Whole frame calls / triangles (incl. shadow map + post passes) | FPS (p50 / p95 frame time) |
| :--- | :--- | :--- | :--- |
| `beach3d` | 8 / 36,686 | 70 / 158,413 | 59.8 (16.67 / 16.67 ms) |
| `light` (baseline) | — | 73 / 122,469 | 60.0 (16.66 / 16.67 ms) |

Both are capped by vsync on this machine. Low-end and mobile GPUs have not been measured.

To inspect at runtime, use `window.vrmEngine.beach3d.getStats()`.

## Known limitations

- The horizon curvature is a deliberate cheat. With very low or very high camera heights the dip changes. It stays seamless, but the horizon moves.
- When the camera is below the ground (extreme upward pitch), the ground is back-face culled and only the sky and the palms show. This is the same behaviour as the other opaque scenes.
