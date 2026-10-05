# `beach3d` Scene: Real-time 3D Anime Beach Stage

`beach3d` ("海滩 3D" / "Beach 3D" / "ビーチ 3D") is the 5th built-in scene and is opaque. Unlike `beach`, which scrolls a pre-rendered background strip, this scene is a small 3D stage built entirely in Three.js. The character stands on real sand with a real shadow, and every prop is a low-poly mesh with toon shading.

The look aims for an **anime MMD stage** (like an MMD or miHoYo PV set):
- 3D toon-shaded props: curved palm trees with segmented trunks and full, layered fronds, soft rounded grass tufts, and smooth rounded shore rocks.
- High-key daylight and a clear turquoise sea, light near the shore and deeper further out.
- Cartoon waves that run up the beach and draw back, plus wave crests rolling in near the shore.
- Fine cartoon sand with a darker, glossy wet band at the water's edge.
- A bright blue sky with fluffy volumetric clouds, thin high wisps and a bright band near the horizon.
- Island silhouettes on the horizon with light aerial-perspective haze.

There are no textures, no HDRI, no realistic materials and no third-party assets. All geometry is generated in code, and every pattern (sand grain and ripples, foam, waves, caustics, sea strokes, glints, trunk segments) is computed procedurally in shaders. Light direction and colour follow the engine's main light, so the scene blends with the MToon character.

## Where things live

| File | Role |
| :--- | :--- |
| `src/core/scene/beach3d/beach3dWorld.ts` | `Beach3DWorld`: builds and owns all meshes, does the per-frame updates, `getStats()`, `dispose()` |
| `src/core/scene/beach3d/beach3dShaders.ts` | GLSL for sky, clouds, mountains, ground (sand + sea), palms, grass, rocks, petals |
| `src/core/scene/beach3d/beach3dGeometry.ts` | Procedural low-poly geometry: palm trunk and crown, grass clump, mountain ridges, rock |
| `src/core/scene/beach3d/beach3dLayout.ts` | Pure data and functions (no three / DOM): shoreline, palm / grass / rock layout, island peaks |
| `src/core/scene/sceneMotion.ts` | `SceneMotionGovernor`, shared with `beach`: reduced-motion and low-FPS downgrade |
| `src/core/scene/__tests__/beach3dLayout.test.ts` | Layout invariants (props on sand, keep-out zone, shoreline, horizon dip, triangle budget) |
| `src/config.ts` → `APP_CONFIG.beach3dScene` | All tunables. Ranges and meanings are documented in `src/types/config.ts` (`Beach3DSceneConfig`) |

Engine hooks:
- `vrmEngine.beach3d` is attached after lighting init.
- `syncSceneBackdrop` calls `setActive(theme === 'beach3d')`.
- `lineworkWorld` hides itself in this scene.
- `characterShadow.applyTheme` uses `beach3dScene.light.shadowColor/shadowOpacity` with a full, non-soft shadow plane and no contact blob.
- `studioLighting.applyTheme` uses `beach3dScene.light` colours.

When another scene is active, the group is invisible and costs 0 draw calls.

## Coordinates

All layout coordinates are **relative to the character's spawn point** (`APP_CONFIG.model.spawn`, currently `z = -4`). The world group is positioned there, and the ground shader computes shoreline and patterns from local coordinates.

The camera only pitches around the character in the YZ plane and stays on the +Z side. Left/right movement is the character's own `bodyTurn`. So the stage is dressed toward −Z:
- Near sand.
- The shoreline at `layout.shoreZ`, which curves back on both sides (`shoreCurve`) and wiggles slightly.
- Then the sea.
- Then the islands on the horizon.

Props are kept out of a central zone (grass `|x| < 1`, rocks `|x| < 2.2`) so they never cover the character or the sea directly behind her.

## Composition (9 draw calls, ~24k triangles)

| Part | Draws | Notes |
| :--- | :---: | :--- |
| Sky | 1 | Fullscreen shader that colours by view direction: a zenith → mid → horizon gradient, thin high wisps (stretched noise projected on the sky dome, slowly drifting), a soft bright band near the horizon, and a glow on the sun side. Pitching to ±89° never shows an edge or black. |
| Clouds | 1 | Instanced billboards on a far sphere. Each cloud is 7 puffs with pseudo-normals and a 2–3 tone toon ramp lit from the sun's screen direction. They drift slowly. |
| Islands | 1 | Two ridge layers (far lavender, near teal) as silhouette strips, faded into the horizon colour. Directly behind the character the ridge is kept low so the sea stays open. |
| Sand + sea | 1 | One subdivided y=0 plane; see [Sand](#sand) and [Sea and waves](#sea-and-waves). Also draws foam rings around in-water rocks. |
| Palm trunks | 1 | Instanced. Curved, tapering, with a flared base. The shader draws soft cartoon segments: each segment bulges toward the top, so its upper half catches more light, with a soft groove at the seam. Seams are slightly tilted and unevenly spaced. The base is tinted with sand. |
| Palm crowns | 1 | Instanced. 10 pinnate fronds per crown (3 short, upright young fronds and 7 long drooping ones). Each frond is an arching rachis with two rows of separate pointed leaflets that splay downward in a V and droop slightly, so the crown has real volume and layering. The colour runs dark at the root to bright at the tip, both along the frond and along each leaflet, with cool-tinted shade and normals biased upward for soft two-step shading. Whole fronds sway and leaflets flutter. Three low-poly coconuts. |
| Grass | 1 | About 17 instanced tufts. Each tuft is 26 wide, round-tipped blades (an arching outer ring and a short upright inner ring) with spherical normals, so it shades like one soft mound. There is a dark-root-to-bright-tip gradient and slight per-blade hue variation. About 40% of tufts carry two small pink flowers. |
| Rocks | 1 | Instanced smooth rocks: a subdivided icosahedron with merged vertices (smooth normals), low-frequency sine bumps and a flattened base. 3-tone toon ramp, a soft highlight on top, a faint sky-blue rim on the shadow side, faint mottling, and a darker wet band where they meet sand or water. They sit in clusters on both sides along the shore, and some are half in the water. |
| Petals | 1 | GPU point particles in a box behind the character, with a size clamp so they never become huge near the camera. |

The character shadow is the engine's existing `CharacterShadowSystem` plane. The ground uses a polygon offset so the shadow sits stably on top of it.

## Sand

- **Near/far tone**: slightly deeper and warmer near the camera, lighter toward the distance, then hazed into the horizon.
- **Patches**: two layers of low-frequency noise give large soft light and shade patches.
- **Grain**: two layers of smooth value noise plus sparse soft pale dots. The grain fades out by screen-space derivative, so the distance doesn't shimmer.
- **Ripples**: only inside a few noise-masked patches. They are soft light/shade undulations along strongly warped wave lines (lit slope brighter, shaded slope darker), not drawn lines. They fade with distance.
- **Shells**: a few small shells close to the camera.
- **Wet band**: everything below the highest swash reach is darker. Above it the sand dries over about 0.65 m. The wet band reflects the sky (stronger at grazing angles) and shows a soft sun highlight.

## Sea and waves

- **Depth colour** is computed from a static coordinate (distance seaward of the shoreline), so the shallow band does not move with the swash. It goes from shallow to mid to deep, then into the horizon colour.
- **Clarity**: near the shore the sand shows through the water, and cartoon caustics (thin bright noise iso-lines) move across the shallows.
- **Ripples and glints**: short ripple strokes (denser near the shore) and twinkling star glints (more on the sun side).
- **Crests**: three wave crests roll in from about 7.5 m out. Each is a broken white line that thickens near the shore, with a lighter strip of water in front and a slightly deeper band behind. They fade out where they merge into the swash.
- **Swash**: the water edge runs up the beach quickly (ease-out over the first 38% of the cycle) and draws back slowly. The edge is scalloped and slightly out of phase along the shore.
  - The foam head is thicker while advancing and thinner while retreating, with a few holes where the water shows through, and trailing lace behind it.
  - A thin foam line is left at the highest reach and fades as the water retreats.
- Foam, crests, rock rings and glints are marked for a slight bloom (see below).

## Horizon curvature (horizon at the hips)

On a flat ground plane the sea horizon always sits at eye height, which puts it at the shoulders in a full-body shot. Anime stages put it lower, around the waist or hips. To do that, ground, palms, grass and rocks bend down beyond `d0 = (horizontal camera→character distance) + 3 m`:

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
- Background pixels write alpha `uMark` (0.99 when rendering into the composer target). The UnrealBloom high-pass skips them, the same convention as `beach` (see `POSTFX.md`). Foam (swash head, lace, wave crests, rock rings) and sea glints write alpha 1, so they get a slight bloom while sand and sky do not.
- Clouds and islands follow the camera's translation (not its rotation) and live inside the 100 m far plane, which makes them effectively infinitely far away.
- The sky draws first (`renderOrder −1000`), then clouds, then islands.

## Dynamics and fallbacks

These are animated: swash, crests, foam, caustics, ripples, glints, high wisps, cloud drift, palm and grass sway, and petals. They run through `SceneMotionGovernor` with `dynamics.respectReducedMotion` and `dynamics.autoDowngrade`. If `prefers-reduced-motion` is set, or the average FPS drops below `minFps`, the scene freezes on a well-composed static frame (`STATIC_TIME`) for the rest of the session.

On mobile, `petals.countMobile` applies.

## Config (`APP_CONFIG.beach3dScene`)

| Group | Fields |
| :--- | :--- |
| `layout` | `shoreZ`, `shoreCurve`, `shoreWiggle`, `horizonCurveR` |
| `sky` | `zenith`, `mid`, `horizon`, `sunGlow`, `cirrus`, `horizonBand` |
| `sea` | `shallow`, `mid`, `deep`, `horizon`, `foam`, `ripple`, `rippleDensity`, `glint`, `glintDensity`, `glintSpeed`, `foamWidth`, `swashAmp`, `swashSpeed`, `waves` |
| `sand` | `base`, `shade`, `light`, `wet`, `rippleSpacing`, `ripple`, `grain` |
| `haze` | `start`, `end` (aerial perspective toward the horizon colour; `end` must stay < 100 m) |
| `mountains` | `enabled`, `far`, `near`, `heightScale` |
| `clouds` | `count`, `driftDegPerSec`, `scale`, `light`, `shade` |
| `vegetation` | `leafLight`, `leafShade`, `trunkLight`, `trunkShade`, `grassLight`, `grassShade`, `flower`, `sway`, `grassDensity` |
| `rocks` | `enabled`, `light`, `shade`, `detail` (0 / 1 / 2 → 80 / 320 / 1280 triangles per rock) |
| `petals` | `count`, `countMobile`, `size`, `speed`, `opacity` |
| `dynamics` | `enabled`, `respectReducedMotion`, `autoDowngrade { enabled, minFps, windowFrames }` |
| `light` | `hemiSky`, `hemiGround`, `dirColor`, `shadowColor`, `shadowOpacity` |

## Measured cost

Measured on an Apple M1 Ultra (Chrome, ANGLE Metal) with headless Puppeteer at 1280×800, DPR 1, post-processing on, and dynamics running:

| Scene | Scene draws / triangles (`getStats`) | Whole frame calls / triangles (incl. shadow map + post passes) | FPS (p50 / p95 frame time) |
| :--- | :--- | :--- | :--- |
| `beach3d` | 9 / 24,312 (+28 points) | 71 / 146,039 | 60.0 (16.67 / 16.67 ms) |
| `light` (baseline) | — | 73 / 122,469 | 59.8 (16.66 / 16.67 ms) |
| `beach` (baseline) | — | 65 / 121,731 | 60.0 (16.66 / 16.67 ms) |

All three are capped by vsync on this machine. Low-end and mobile GPUs have not been measured.

To inspect at runtime, use `window.vrmEngine.beach3d.getStats()`.

## Known limitations

- The horizon curvature is a deliberate cheat. With very low or very high camera heights the dip changes. It stays seamless, but the horizon moves.
- When the camera is below the ground (extreme upward pitch), the ground is back-face culled and only the sky and the palms show. This is the same behaviour as the other opaque scenes.
