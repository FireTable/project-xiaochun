# `beach3d` Scene: Real-time 3D Anime Beach Stage

`beach3d` ("海滩 3D" / "Beach 3D" / "ビーチ 3D") is the 5th built-in scene and is opaque. Unlike `beach`, which scrolls a pre-rendered background strip, this scene is a small 3D stage built entirely in Three.js. The character stands on real sand with a real shadow, and every prop is a low-poly mesh with toon shading.

The look aims for an **anime MMD stage** (like an MMD or miHoYo PV set):
- 3D toon-shaded props: palm trees, shore rocks and grass clumps.
- High-key daylight and a clear turquoise sea, light near the shore and deeper further out, with a white foam edge.
- A bright blue sky with fluffy clouds that have cartoon volume.
- Island silhouettes on the horizon with light aerial-perspective haze.
- Palm fronds framing the top corners.

There are no textures, no HDRI and no realistic materials. Every pattern (sand ripples, foam, sea strokes, glints, leaf cut-outs) is computed procedurally in shaders. Light direction and colour follow the engine's main light, so the scene blends with the MToon character.

## Where things live

| File | Role |
| :--- | :--- |
| `src/core/scene/beach3d/beach3dWorld.ts` | `Beach3DWorld`: builds and owns all meshes, does the per-frame updates, `getStats()`, `dispose()` |
| `src/core/scene/beach3d/beach3dShaders.ts` | GLSL for sky, clouds, mountains, ground (sand + sea), palms (and the frame fronds), grass, rocks, petals |
| `src/core/scene/beach3d/beach3dGeometry.ts` | Procedural low-poly geometry: palm trunk and crown, frame fronds, grass clump, mountain ridges, rock |
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

## Composition (10 draw calls, ~11.7k triangles)

| Part | Draws | Notes |
| :--- | :---: | :--- |
| Sky | 1 | Fullscreen shader that colours by view direction (zenith → mid → horizon gradient plus a soft glow on the sun side). Pitching to ±89° never shows an edge or black. |
| Clouds | 1 | Instanced billboards on a far sphere. Each cloud is 7 puffs with pseudo-normals and a 2–3 tone toon ramp lit from the sun's screen direction. They drift slowly. |
| Islands | 1 | Two ridge layers (far lavender, near teal) as silhouette strips, faded into the horizon colour. Directly behind the character the ridge is kept low so the sea stays open. |
| Sand + sea | 1 | One subdivided y=0 plane. Sand: colour patches, thin broken ripple lines, a few shells, a wet band. Sea: gradient from shallow to deep, short anime ripple strokes, star glints, a swash line that moves up and down the beach, a foam edge, lace, an incoming wave line, and foam rings around in-water rocks. |
| Palms | 2 | Instanced trunk (ringed) and crown (11 V-ribbed fronds plus coconuts). Leaflets are cut out in the fragment shader. Two-tone shading by the sun direction. |
| Frame fronds | 1 | Camera-space foreground fronds that sit in the top-left / top-right corners at any aspect ratio or distance (size = `vegetation.frameFronds` × short side of the view). They slide out diagonally when the camera looks down more than about 20°. |
| Grass | 1 | Instanced crossed quads with procedurally cut blades and occasional pink flowers. |
| Rocks | 1 | Instanced flat-shaded, flat-bottomed deformed icosahedra with a 3-tone toon ramp, clustered on both sides along the shore. Some sit half in the water. |
| Petals | 1 | GPU point particles in a box behind the character, with a size clamp so they never become huge near the camera. |

The character shadow is the engine's existing `CharacterShadowSystem` plane. The ground uses a polygon offset so the shadow sits stably on top of it.

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
- Background pixels write alpha `uMark` (0.99 when rendering into the composer target). The UnrealBloom high-pass skips them, the same convention as `beach` (see `POSTFX.md`). Foam lines (shore foam, lace, wave lines, rock rings) and sea glints write alpha 1, so they get a slight bloom while sand and sky do not.
- Clouds and islands follow the camera's translation (not its rotation) and live inside the 100 m far plane, which makes them effectively infinitely far away.
- The sky draws first (`renderOrder −1000`), then clouds, then islands.

## Dynamics and fallbacks

These are animated: swash, foam, ripples, glints, wave lines, cloud drift, palm and grass sway, and petals. They run through `SceneMotionGovernor` with `dynamics.respectReducedMotion` and `dynamics.autoDowngrade`. If `prefers-reduced-motion` is set, or the average FPS drops below `minFps`, the scene freezes on a well-composed static frame (`STATIC_TIME`) for the rest of the session.

On mobile, `petals.countMobile` applies.

## Config (`APP_CONFIG.beach3dScene`)

| Group | Fields |
| :--- | :--- |
| `layout` | `shoreZ`, `shoreCurve`, `shoreWiggle`, `horizonCurveR` |
| `sky` | `zenith`, `mid`, `horizon`, `sunGlow` |
| `sea` | `shallow`, `mid`, `deep`, `horizon`, `foam`, `ripple`, `rippleDensity`, `glint`, `glintDensity`, `glintSpeed`, `foamWidth`, `swashAmp`, `swashSpeed` |
| `sand` | `base`, `shade`, `light`, `wet`, `rippleSpacing`, `ripple` |
| `haze` | `start`, `end` (aerial perspective toward the horizon colour; `end` must stay < 100 m) |
| `mountains` | `enabled`, `far`, `near`, `heightScale` |
| `clouds` | `count`, `driftDegPerSec`, `scale`, `light`, `shade` |
| `vegetation` | `leafLight`, `leafShade`, `trunkLight`, `trunkShade`, `grassLight`, `grassShade`, `flower`, `sway`, `grassDensity`, `frameFronds` (0 = off) |
| `rocks` | `enabled`, `light`, `shade`, `detail` (0 / 1 / 2) |
| `petals` | `count`, `countMobile`, `size`, `speed`, `opacity` |
| `dynamics` | `enabled`, `respectReducedMotion`, `autoDowngrade { enabled, minFps, windowFrames }` |
| `light` | `hemiSky`, `hemiGround`, `dirColor`, `shadowColor`, `shadowOpacity` |

## Measured cost

Measured on an Apple M1 Ultra (Chrome, ANGLE Metal) with headless Puppeteer at 1280×800, DPR 1, post-processing on, and dynamics running:

| Scene | Scene draws / triangles (`getStats`) | Whole frame calls / triangles (incl. shadow map + post passes) | FPS (p50 / p95 frame time) |
| :--- | :--- | :--- | :--- |
| `beach3d` | 10 / 11,660 (+28 points) | 72 / 133,387 | 59.7 (16.67 / 16.67 ms) |
| `light` (baseline) | — | 73 / 122,469 | 59.8 (16.66 / 16.67 ms) |
| `beach` (baseline) | — | 65 / 121,731 | 60.0 (16.66 / 16.67 ms) |

All three are capped by vsync on this machine. Low-end and mobile GPUs have not been measured.

To inspect at runtime, use `window.vrmEngine.beach3d.getStats()`.

## Known limitations

- The horizon curvature is a deliberate cheat. With very low or very high camera heights the dip changes. It stays seamless, but the horizon moves.
- Frame fronds are attached to the camera. They don't parallax against the world. That is intentional for framing, but it's still a stylisation.
- When the camera is below the ground (extreme upward pitch), the ground is back-face culled and only the sky, palms and fronds show. This is the same behaviour as the other opaque scenes.
