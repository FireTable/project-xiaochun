# Loading Overlay

The full-screen splash shown while XiaoChun's VRM model, WebGPU pipeline, EMAGE motion model and on-device LLM warm up. It is styled as an "idol debut poster": a large key visual of 小蠢 on a deep-plum night sky, an italic serif title, and a compact progress console.

- Component: `src/components/LoadingOverlay.tsx`
- Styles / keyframes: `src/styles/main.css` (classes prefixed `xc-` and `font-xc-*`)
- Copy: `loading.*` in `src/i18n/zh-CN.ts`, `en.ts`, `ja.ts`

## 1. Where it is used

| Surface | Mount point | Notes |
| :--- | :--- | :--- |
| Web + Tauri | `src/routes/index.tsx` | **One instance for the whole boot** (SSR → hydration → lazy `App`). It is always the first child of the route, so React keeps the same elements (hero `<img>` + warp canvas) instead of remounting the overlay in a `Suspense` fallback and again inside `App`. Rendered without props; the state comes from `loadingStore`. Skipped when `APP_CONFIG.dev.disableLoadingOverlayInDev` applies. |
| `App` (`src/App.tsx`) | does not render the overlay | Drives it through `loadingStore`: `init()` with the initial state, `set()` for every `vrmEngine` progress report, and `setBreakStartHandler(() => vrmEngine.resumeRendering())`. `App` state keeps only `active`. |
| `/embed` | not used | The host SDK draws its own placeholder (`docs/EMBED.md`). |

The overlay is a visual cover only; the render loop keeps running underneath.

### 1.1 `loadingStore` (`src/components/loading/loadingStore.ts`)

`vrmEngine` reports progress many times per second. Routing that through `App` state re-rendered the whole `App` and the overlay on every report (70–150 ms tasks in dev that froze the hero). The store sits outside React:

- `set()` normalises progress to a **whole percent** (clamped 0–100) and coalesces updates to **at most one per 100 ms**. A change of `active` or `subtitleKey` flushes immediately. Unchanged states notify nobody.
- Only the overlay subscribes (`useSyncExternalStore(subscribe, get, getServer)`; the server snapshot is `DEFAULT_LOADING_STATE` = `parsingModel`, 0 %). A `state` prop, if passed, still overrides the store.
- `breakStart()` calls the handler `App` registered (the single-mount overlay has no `App` props). An `onBreakStart` prop takes precedence.
- The hero (`HeroKeyvisual`) is a `React.memo` component with primitive props (`paused`, `exited`), so progress re-renders never touch the img / canvas and never restart the warp effect.

## 2. Logic contract (unchanged by the visual redesign)

- **Monotonic progress**: the displayed value only increases (`maxProgressRef`); it resets only when a new load starts at `active && progress === 0`.
- **Stages** (by displayed progress): `< 25` stage 1, `< 60` stage 2, `< 85` stage 3, `< 100` stage 4, `100` ready.
- **Milestone chips**: passed at thresholds `10 / 35 / 65 / 95`.
- **Engine progress**: read from `loadingStore` (whole %, ≤ 10 Hz, §1.1).
- **LLM progress**: subscribed via `onLlmLoadProgress`, throttled to ~10 Hz (100 ms) and rounded to integers.
- **Minimum display time**: at least 1.5 s after mount, so cached instant loads still show the splash.
- **Exit**: when `!active && progress >= 100`, the overlay starts its exit (opacity → 0 over 900 ms, `scale(1) → scale(1.08)` over 1100 ms, ease-out). Two animation frames later, once the transition is running on the compositor, `onBreakStart` (or `loadingStore.breakStart()`) fires so the camera push and first-frame scene work don't land in the same frame. `onBreakComplete` fires 1.1 s after the exit starts. A new `active` load resets the overlay.
- **Mouse parallax**: rAF-throttled, written only as CSS variables `--mx` / `--my` on the root (no React re-render).

## 3. Layout

- **Portrait / < 768 px**: stacked. Hero on top (`min(60%, 100% - 330px)` of the height, cropped around the waist with a bottom mask fade), then title, subtitle, progress, chips (2 × 2), model line and tip. The text block overlaps the faded hero slightly (`-mt-[12%]`). Fits without scrolling at 360 × 780, 375 × 667 and 390 × 844.
- **≥ 768 px (`md:`)**: side by side. Text on the left, hero on the right (`46%`, `50%` from `lg:`) anchored to the bottom. Chips are 2 × 2 up to `lg:`, then `repeat(auto-fit, minmax(5.25rem, 1fr))`, i.e. one row of 4 when the panel is wide enough and wrapping otherwise. Works down to a ~800 × 600 Tauri window.
- **Text panel avoids the figure** (`.xc-copy-panel` in `main.css`, `md:` and up): the hero is 96 % of the stage height with aspect 619 / 1000, centred in its column (46 % of `min(100vw, 72rem)`, 50 % from `lg:`), so its half-width is ≈ `29.71dvh`. When that exceeds half the column, the figure crosses into the text column, and the panel's `padding-right` grows to `max(1rem, 29.71dvh − column / 2 + 1.25rem)`. Children get `max-width: 100%`, so title, progress and chips shrink with the panel instead of running under the character.
- **Safe areas**: the main stage pads with `env(safe-area-inset-*)`; on portrait the hero image starts at `safe-area-inset-top + 40px`, so the head sits inside the halo.
- The title uses `clamp(46px, 6.4vw, 104px)` on desktop and `whitespace-nowrap`, and stays inside the width-constrained text panel, so it ends before the figure.

## 4. Visual system

**Palette**

| Role | Value |
| :--- | :--- |
| Base gradient | `#120a1a → #0b0710 → #08050b` |
| Glows | plum `rgba(124,74,160,.34)`, apricot `rgba(240,170,150,.14)`, gold `rgba(217,181,108,.13)` |
| Gold accents | `#d9b56c`, `#dcc28a`, `#e8c97f`, `#ecd08a`, `#f3dca0` |
| Lavender / peach | `#c9b3ee`, `#b892e8`, `#f2b8a2` |
| Text | `#efe4ee` (subtitle), white at 35–70% alpha |

**Layer order (back to front)**

1. Static base gradient + glows (inline `background`, never animated).
2. `xc-stars`: fine star field from tiled `radial-gradient`s, masked to fade out towards the bottom.
3. `xc-stars--twinkle`: a sparser star tile whose opacity pulses.
4. `xc-nebula--lav`, `xc-nebula--rose`, `xc-mist`: large soft radial gradients that drift with `transform`.
5. `xc-sweep`: one skewed light band translating across the screen.
6. Four-point sparkles (inline SVG): background layer, placed only at the edges / top so they never sit over text.
7. Main stage (`z-10`): warm moon halo and gold hairline ring behind the hero, the hero image, and the text column (`z-20`).

**Hero key visual**

- `public/materials/xiaochun_keyvisual.webp` (991 × 1600) and `xiaochun_keyvisual-1000.webp` (619 × 1000), alpha WebP, served via `srcSet` / `sizes` (`(min-width: 768px) 45vw, 92vw`), `fetchPriority="high"`, SSR'd with `decoding="async"` (the warp switches it to `sync` before the swap, §7.1).
- **Bottom fade**: the `<img>` uses a static CSS `mask-image` (`.xc-hero-img`: opaque to 52 %, transparent at 64 %; on `md:` 80 % → 99 %). The warp canvas draws the identical linear ramp in its fragment shader instead (uniform `fd` = start, end, buffer height; stops switched by `matchMedia('(min-width: 768px)')`, sent to the worker as a `fade` message, and re-applied on resize). Output stays premultiplied (`vec4(rgb·a, a)`, `premultipliedAlpha: true`, clear `0,0,0,0`). Keep both stop sets in sync. **Never use CSS `mask-image` (or a filter/background) on the canvas or on its wrapper (`heroBoxRef`)**: in real Chrome either one paints the whole hero box as a white rect during load (confirmed for both).

**Typography (system fonts only)**

- Title `XiaoChun`: `.font-xc-italic`: `Didot, 'Bodoni 72', 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', 'Songti SC', Georgia, serif`, italic, weight 400, letter-spacing `0.01em`. `.xc-title` paints a champagne-gold gradient through `background-clip: text` with a slow specular sweep and a soft dark drop shadow.
- Kicker `PROJECT` and small caps: `.font-xc-sc` (`'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`), widely letter-spaced, with gold hairlines.
- Chinese subtitle: `.font-xc-cjk` (`'Songti SC', 'STSong', 'Noto Serif SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif`).
- **No web fonts.** The overlay is the first thing painted. A downloaded font would cause a visible font swap (FOUT) and compete with model downloads, so it relies on fonts already on the system.

## 5. Motion & performance rules

- **Never animate layout properties** (width, height, top, left, margin, padding, font-size…). Animations use `transform` / `opacity` only; the title sheen animates `background-position` on a small text box (a repaint, used sparingly).
- Progress fill uses `transform: scaleX(progress / 100)`. The leading star uses a separate `translateX(progress%)` wrapper, so it is not distorted.
- No animated `filter`, `backdrop-filter` or `box-shadow`. Blur-like softness comes from radial gradients, not blur filters.
- The exit transition animates only `opacity` and `transform`, set inline on the root, which keeps `will-change: transform, opacity` so it is already composited. Don't use Tailwind v4 `scale-*` utilities here: they set the separate `scale` property, which `transition-[opacity,transform]` does not cover, so the zoom jumped instantly.
- During exit the root gets `xc-paused` (`animation-play-state: paused` for all descendants), so background and title animations stop repainting; after exit it also becomes `invisible`.
- `prefers-reduced-motion: reduce` disables sweep, twinkle, nebula, mist, breathing, title sheen and tip transitions; the exit becomes an opacity-only fade.

## 6. Copy & i18n

- **Voice**: lines are written in 小蠢's voice (e.g. 「小蠢正在睁开眼睛…」, 「正在为小蠢上妆…」), not as engine jargon.
- **Status line**: one sentence only: the engine `subtitleKey` (`loading.${subtitleKey}`: `parsingModel`, `loadingModel`, `swappingOutfit`, `madMotionSync`) if present, otherwise the stage sentence (`madStage1Init`, `madShaderCompiling`, `madMeshDecoding`, `madMotionSync`, `madPipelineReady`). Steps are shown by the chips, not repeated in the status line.
- **Chips**: `milestoneEngine / Shader / Mesh / Motion` (唤醒 / 上妆 / 换装 / 热身), with the step number as small italic decoration.
- **Chat-engine line**: neutral unless a local model is really loading. In order: `llmLoadingLocal` (`{{percent}}`, only when 0 < LLM progress < 100); `llmCustom` when the active model (`readActiveModel()`) is a custom/remote provider; `llmReadyLocal` (WebLLM, 100%) or `llmReady` (100%, kind unknown); otherwise `llmPreparing`.
- **Tips**: `tip1`–`tip4` rotate every 5 s with an opacity/translate fade in a fixed-height line (`h-[2.8em]`), so rotation never reflows the layout.
- **No hardcoded counts**: `tip3` interpolates `{{count}}` from `Object.keys(APP_CONFIG.model.addons).length` (the same list exposed to `/embed` as outfits).
- **Hydration-safe**: the SSR and first client render are deterministic. `llmPct` starts at 0 and the active model starts as `null`; both are read in effects after mount. The tip index starts at 0 and rotation starts after mount, and the footer year (`new Date().getFullYear()`) has `suppressHydrationWarning` on its own node.
- Keep `zh-CN`, `en`, `ja` in parity (`npx tsx scripts/check-i18n.ts`).

## 7. Assets

| File | Size | Use |
| :--- | :--- | :--- |
| `public/materials/xiaochun_keyvisual.webp` | 991 × 1600, ~141 KB | Hero (desktop / high-DPR) |
| `public/materials/xiaochun_keyvisual-1000.webp` | 619 × 1000, ~74 KB | Hero (small screens) |
| `public/materials/warp-mask.webp` | 248 × 400 lossless, ~14 KB | Region mask for the hero warp (§7.1) |

The warp code itself is a lazy chunk (`keyvisualWarp.ts` + shared `warpGL.ts`) plus a module worker (`keyvisualWarp.worker.ts`); `pixelSnap.ts` and `loadingStore.ts` are tiny and load with the overlay.

No other images or fonts are loaded by the overlay; everything else is CSS gradients and inline SVG.

### 7.1 Hero warp (Live2D-lite)

The hero is animated in raw WebGL1, without three.js. A 60 × 80 grid (extended 12 % past the image on both sides, see *Canvas bleed*) is drawn in one draw call. The vertex shader adds a slight head tilt and breathing stretch; the fragment shader applies small inverse-UV offsets gated by a UV-space region mask. The eyes are static and there is no blink.

**Files**

| File | Role |
| :--- | :--- |
| `src/components/loading/warpGL.ts` | DOM-free shared core: shaders, mesh, textures, uniforms, `draw(t, k)`. Used by both paths, so they draw identical frames. Region coordinates live in `C`. |
| `src/components/loading/keyvisualWarp.worker.ts` | Module worker that owns the transferred `OffscreenCanvas` and runs its own rAF loop. Messages in: `init`, `resize`, `fade`, `shown`, `run`; out: `ready`, `error` (and `gap` in dev: presented-frame gaps > 34 ms, collected in `window.__warpWorkerGaps`). |
| `src/components/loading/keyvisualWarp.ts` | `startKeyvisualWarp(img, canvas, maskSrc)`: picks the path, swaps img → canvas, observers, pause / dispose. Lazy chunk. |
| `src/components/loading/pixelSnap.ts` | `snapToPixel`, `canvasSizeFor`, `placeCanvas`, `WARP_PAD`. Static, so the overlay can apply them before first paint. |

**Worker first, main thread only as fallback.** When `Worker`, `OffscreenCanvas`, `canvas.transferControlToOffscreen` and `createImageBitmap` all exist, the canvas is transferred to the worker and every frame is drawn there, so main-thread long tasks during boot (VRM parse, shader links, React commits) no longer stall the hero. The main thread only flips opacities and forwards size / fade / run state. The main-thread WebGL path runs **only** when those APIs are missing (older Safari / Tauri WKWebView); it is a capability fallback, not a flag. `transferControlToOffscreen` is one-shot, so a restart on the same canvas (StrictMode, effect re-run) re-attaches to the live worker session; a disposed session keeps the worker for 250 ms for exactly that, then terminates it and restores the img.

**DOM** (all rendered by React in `HeroKeyvisual` from the first paint): `.xc-breathe` (CSS scale/translate, shared by img and canvas) → `heroBoxRef` (`relative h-full`, **no mask/filter/background**) → `<img class="xc-hero-img">` (CSS mask) plus a sibling `<canvas>` (`absolute inset-y-0 left-0`, `opacity-0`, `pointer-events-none`, `aria-hidden`, no class-based mask). The canvas is never inserted or removed by the warp; only its and the img's inline `opacity` are written, by the warp code alone.

**Load / swap sequence (cold start)**

1. SSR paints the `<img>` (srcset, `fetchPriority="high"`). It is the first paint and the permanent fallback.
2. Layout effect, before first paint: `snapToPixel(box)` and `canvasSizeFor` / `placeCanvas`, so nothing about the layout changes at the swap (repeated on img `load`). Pixel snap: the centred hero sits at a fractional x (e.g. 740.43 px); Chrome rasterizes the img at that sub-pixel phase but places a canvas on whole pixels, so the wrapper is moved by minus its sub-pixel offset via the CSS `translate` property.
3. Once the img has loaded, the warp starts after a **double rAF** (keeps GL setup out of the overlay's first frame; no fixed timer). If the chunk is already loaded (remount) it starts at once.
4. The module awaits `img.decode()` if needed, then sets `img.decoding = 'sync'` and awaits `decode()` again. The SSR `async` decoding let Chrome commit frames *without* the image while it re-decoded it for a new raster (pixel snap, canvas layering): a ~100 ms character-less gap. Then it loads the cached mask.
5. Texture: the same `<img>` (whatever `currentSrc` the browser picked, no second download) is pre-downscaled to the exact image area of the buffer with the browser's high-quality resampler (worker: `createImageBitmap(img, { resizeQuality: 'high', premultiplyAlpha: 'premultiply' })`; main thread: 2D canvas with `imageSmoothingQuality = 'high'`) and uploaded premultiplied. This makes the k = 0 frame match the browser-scaled img (WebGL1 cannot mipmap the NPOT texture). It is re-uploaded on every buffer resize.
6. Buffer size = untransformed layout size (`getComputedStyle` width/height, not `getBoundingClientRect`, which would bake the `.xc-breathe` scale phase in) × `min(devicePixelRatio, 3)`, plus the bleed.
7. Context: `alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power'`, clear `0,0,0,0`, blend `ONE, ONE_MINUS_SRC_ALPHA`.
8. The canvas draws while still at opacity 0 (already composited over the img), so each frame is presented invisibly. **Two rAFs after the first draw** (worker: `ready` message) the frame is on screen, and **one** main-thread task sets canvas `opacity: 1` and img `opacity: 0`. Opacity (not visibility) keeps the img's raster; there are no transitions. Until the flip the deformation stays at k = 0, so the flipped frame matches the img and there is no frame with neither or both visible.
9. After the flip the deformation ramps 0 → 1 over `rampMs` (smoothstep), scaling every deformation, the despill and the VS tilt/breath, so motion eases in from the static pose.

**Canvas bleed** (`WARP_PAD = 0.1`): the skirt flare pushes the hem outward and the hem's lower corners sit within ~35 px of the image edge, so a canvas exactly the image's size clipped the flared hem with a vertical straight edge. `canvasSizeFor` adds `round(width × 0.1)` whole device pixels on each side (returns `[w, h, pad]`), `placeCanvas` shifts the canvas left by `pad / dpr` CSS px and widens it, and the shader maps the image into `[pad, w − pad]` (uniform `xf`). The image therefore lands on the same device pixels as the `<img>`, so the swap does not jump. Outside the image the sample is masked to 0. `WARP_PAD` must cover the maximum outward flare; the mesh extent (`MX = 0.12`) must stay ≥ `WARP_PAD`.

**Bottom fade in the shader**: the canvas gets the same linear ramp as the img's CSS mask via uniform `fd` (premultiplied output scaled on all four channels). CSS `mask-image`, a filter or a background on the canvas or on `heroBoxRef` make real Chrome paint the whole hero box as a white rect during load (confirmed); never add them.

**Remounts**: time uses a module-level origin, and `lastAliveAt` records the last live frame. Within `warmMs` of a live warp (`isWarpWarm()`), a new start begins at full deformation (k = 1) so a remount looks continuous instead of snapping to t = 0 and easing in again. The img is not pre-hidden on a warm remount (that would leave a blank frame); the warp hides it after its canvas has presented. A dispose followed by a restart on the same canvas cancels the pending restore (250 ms), so nothing flips back.

**Lifecycle**: no warp under `prefers-reduced-motion` or without WebGL; the static image remains. On any setup or worker error the img is re-shown. It pauses (keeping its last frame) when offscreen (IntersectionObserver), when the document is hidden, and during the exit zoom (`isBreaking`); in the worker path these become `run` messages. `dispose()` (exit, unmount, `webglcontextlost` on the main-thread path) cancels rAFs, disconnects observers and restores the img; the React-owned canvas is never removed.

**Master breath**: every motion, the skirt included, follows one breath cycle, so the figure moves as one body. Period `2π / breathW` (default `breathW 2` → ≈ 3.14 s). The curve `br()` (GLSL, generated from `breathW` so it cannot drift from `breath()` in TS) is asymmetric like real breathing: inhale 40 % of the cycle (`0.5 − 0.5·cos(π·x/0.4)`), exhale 60 % (`0.5 + 0.5·cos(π·(x−0.4)/0.6)`), C1-smooth with zero velocity at both turning points. Lags behind the chest:

| Motion | Driver | Lag behind chest |
|---|---|---|
| Chest rise (`bust`): offset `bust × (1.25·br − 0.25)`, i.e. from `−bust/4` (exhaled) to `+bust` (inhaled), plus a 1.8 % swell toward the bust centre | breath | 0 |
| Abdomen draw-in (`waist`) and 1.6 px lift | breath | 0 (chest up = waist in) |
| Body breathing stretch (VS, `breath`) | breath | 0 |
| Bust lagged follow (`jig`, no rebound) | breath | `jelLag` 0.26 s |
| Head tilt (VS, `tilt`) | breath | 0.15 s |
| Viewer-left raised forearm (rotation + lift) | breath | 0.15 s |
| Viewer-right forearm | breath | 0.20 s |
| Hair, left / right strand | breath | 0.35 s / 0.50 s |
| Skirt: inhale draws the hem in, exhale flares it out and lifts it slightly | breath | 0.35 s, up to +0.1 s toward the sides |
| Lip press (never opens) | own period `lipPeriod` | — |

**Motion regions** (mask `public/materials/warp-mask.webp`, 248 × 400, UV-space; coordinates in 991 × 1600 key-visual px, in `C` of `warpGL.ts`):

- R = hair, two strands (`hairL`, `hairR`: root x/y, width, length), faded out within ~30 px of skin and other parts.
- G = arms: x < 400 is the raised viewer-left arm, rotating about the wrist pivot `armL` (210, 520) with a small lift; the viewer-right forearm (pivot `elbow` 785, 1125) shares one blended displacement field with the skirt, so hand and skirt never tear.
- **Rigid hands**: `hand` (250, 490; radii 78 × 82) is the raised hand in the hair: inside it hair sway is off, the head tilt uses one constant angle (rigid rotation, no shear), the breath stretch becomes a pure shift and the forearm rotation runs at full weight. `hand2` (888, 1480; radii 75 × 125) is the lowered hand beside the skirt: the forearm rotation is forced to full weight inside it, blended out over 1–2 radii, so the skirt flare no longer leaks in and bulges the hand.
- B = skirt: weight `smoothstep(skirtTop 1000, hem)^1.4 × mask.b`; the mask ramps in from y ≈ 1000 and is full from y ≈ 1110 across the whole width. Displacement is mirror-symmetric about x 470 and grows toward the sides (`skirt` sway term + `flare` term, `flare × 0.25` lift).
- A = `255 − gate × 127` for torso and mouth: `bust` / `jiggle` (430, 770; 190 × 95), `abdomen` (centre 425, 915; 205 × 78), `mouth` lip press. Never use alpha 0 (browsers drop RGB of fully transparent texels).
- **Abdomen draw-in**: the x weight is side-tapered: above the waist centre the vertical falloff stretches toward the flanks (centre front `|dx| < 0.3` unchanged) and fades out at y 780–850, so the bodice side outline moves in as one curve up to the armpit. On the viewer-right flank the mask gate would hold the outline and its light fringe while the bodice moved, so there it is replaced by a fade toward the arm's inner outline (`x ≈ 650 + (y − 793) × 0.19`, faded out below y 930–990): only the background gap compresses and the arm stays put.
- VS: head tilt about `neck` (476, 496) above the neck line, and a breathing vertical stretch.

**Configuration** (`APP_CONFIG.loading.warp` in `src/config.ts`, type `LoadingWarpConfig` in `src/types/config.ts`; passed to both paths, to the worker in the `init` message):

| Key | Default | Meaning (recommended range) |
| :--- | :--- | :--- |
| `breathW` | 2 | Master breath angular frequency, rad/s; period = 2π / breathW (1–3) |
| `rampMs` | 500 | Deformation ease-in after the canvas is first shown, ms (300–3000) |
| `warmMs` | 3000 | Hot-takeover window: a remount within this time of a live warp starts at full deformation, ms (1000–10000) |
| `amp.bust` | 18 | Chest rise, px (0–25) |
| `amp.waist` | 0.11 | Abdomen draw-in ratio (0–0.15) |
| `amp.breath` | 0.0082 | Whole-body breathing vertical stretch (0–0.01) |
| `amp.tilt` | 0.03 | Head tilt, rad (0–0.03) |
| `amp.hair` | 11 | Hair sway, px (0–15) |
| `amp.skirt` | 15 | Skirt sway, px (0–12) |
| `amp.flare` | 40 | Skirt hem flare, px (0–35) |
| `amp.arm` | 0.020 | Viewer-right forearm rotation, rad (0–0.05) |
| `amp.armLRot` | 0.02 | Viewer-left forearm rotation about the wrist, rad (0–0.03) |
| `amp.armLLift` | 1.8 | Viewer-left forearm lift, px (0–3) |
| `amp.lipPress` | 0.7 | Lip-press strength (0–1) |
| `amp.lipPeriod` | 2.4 | Lip-press period, s (1–12) |

Ranges are the recommended ones from the `LoadingWarpConfig` comments and are not enforced (the tuned `skirt` / `flare` defaults sit above them). `warpConfig.test.ts` checks that every key is a finite number, that the uniforms and the shader breath constant come from the config, and that the worker `init` payload carries it. Fixed internals stay in `C.amp` of `warpGL.ts`: `lipIn 0.03`, `jig 9`, `jelStretch 0.005`, `jelNarrow 0.0025`, `jelLag 0.26`. Other fixed timings: double-rAF start, flip two rAFs after the first draw, 250 ms restore / worker keep-alive after dispose, DPR cap 3. Debug/mesh tools exist only in the prototype under `grok/webgl-warp` (`?debug=1`, `?mesh=1`, `?t=`).


### Regenerating the key visual

1. Generate the art on a **flat chroma-green background** (same character reference; 3/4 body). White backgrounds leave halos in the hair.
2. Upscale ×4 with Real-ESRGAN: `realesrgan-ncnn-vulkan -n realesr-animevideov3 -s 4`.
3. Chroma key: alpha from green dominance (`G − max(R, B)`), soft ramp, keep the main connected component. Then un-premultiply against the measured background colour and despill green on the edges.
4. Trim, resize to 1600 px and 1000 px tall, and export alpha WebP (quality ~82, alpha quality ~85).
5. Check edges at 200% on both dark and light checkerboards before replacing the files. Keep the `srcSet` widths in sync with the real image widths.

## 8. Preview & test

- Keep the overlay visible in dev by setting `APP_CONFIG.dev.disableLoadingOverlayInDev = false` (default).
- For screenshots, use headless Chrome/Puppeteer and leave `.vrm` / `.onnx` / `.wasm` requests unanswered, so loading never completes. Check 390 × 844, 360 × 780, 375 × 667, 800 × 600, 1280 × 800 and 1440 × 900 for:
  - no scroll (`scrollWidth/scrollHeight` equal to the viewport);
  - the title's right edge left of the hero;
  - stars clear of text.
- Watch the console for React hydration warnings on first load.
- Run `npx tsc --noEmit` and the i18n parity check after changes.
