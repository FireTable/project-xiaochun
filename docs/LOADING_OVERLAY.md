# Loading Overlay

The full-screen splash shown while XiaoChun's VRM model, WebGPU pipeline, EMAGE motion model and on-device LLM warm up. It is styled as an "idol debut poster": a large key visual of 小蠢 on a deep-plum night sky, an italic serif title, and a compact progress console.

- Component: `src/components/LoadingOverlay.tsx`
- Styles / keyframes: `src/styles/main.css` (classes prefixed `xc-` and `font-xc-*`)
- Copy: `loading.*` in `src/i18n/zh-CN.ts`, `en.ts`, `ja.ts`

## 1. Where it is used

| Surface | Mount point | Notes |
| :--- | :--- | :--- |
| Web (SSR) | `src/routes/index.tsx` | Rendered without props before the client app mounts and as the `Suspense` fallback, so the first paint is never blank. Uses `DEFAULT_LOADING_STATE` (`parsingModel`, 0%). |
| Web + Tauri (client) | `src/App.tsx` | Receives live `state` from `vrmEngine` and the `onBreakStart` / `onBreakComplete` callbacks. Skipped when `APP_CONFIG.dev.disableLoadingOverlayInDev` applies. |
| `/embed` | not used | The host SDK draws its own placeholder (`docs/EMBED.md`). |

The overlay is a visual cover only; the render loop keeps running underneath.

## 2. Logic contract (unchanged by the visual redesign)

- **Monotonic progress**: the displayed value only increases (`maxProgressRef`); it resets only when a new load starts at `active && progress === 0`.
- **Stages** (by displayed progress): `< 25` stage 1, `< 60` stage 2, `< 85` stage 3, `< 100` stage 4, `100` ready.
- **Milestone chips**: passed at thresholds `10 / 35 / 65 / 95`.
- **LLM progress**: subscribed via `onLlmLoadProgress`, throttled to ~10 Hz and rounded to integers.
- **Minimum display time**: at least 1.5 s after mount, so cached instant loads still show the splash.
- **Exit**: when `!active && progress >= 100`, the overlay starts its exit (opacity → 0 over 900 ms, `scale(1) → scale(1.08)` over 1100 ms, ease-out). Two animation frames later, once the transition is running on the compositor, `onBreakStart` fires so the camera push and first-frame scene work don't land in the same frame. `onBreakComplete` fires 1.1 s after the exit starts. A new `active` load resets the overlay.
- **Mouse parallax**: rAF-throttled, written only as CSS variables `--mx` / `--my` on the root (no React re-render).

## 3. Layout

- **Portrait / < 768 px**: stacked. Hero on top (`min(60%, 100% - 330px)` of the height, cropped around the waist with a bottom mask fade), then title, subtitle, progress, chips (2 × 2), model line and tip. The text block overlaps the faded hero slightly (`-mt-[12%]`). Fits without scrolling at 360 × 780, 375 × 667 and 390 × 844.
- **≥ 768 px (`md:`)**: side by side. Text on the left, hero on the right (`46%`, `50%` from `lg:`) anchored to the bottom. Chips are 2 × 2 up to `lg:`, then one row of 4. Works down to a ~800 × 600 Tauri window.
- **Safe areas**: the main stage pads with `env(safe-area-inset-*)`; on portrait the hero image starts at `safe-area-inset-top + 40px`, so the head sits inside the halo.
- The title uses `clamp(46px, 6.4vw, 104px)` on desktop and `whitespace-nowrap`, so it always ends before the figure.

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

- `public/materials/xiaochun_keyvisual.webp` (991 × 1600) and `xiaochun_keyvisual-1000.webp` (619 × 1000), alpha WebP, served via `srcSet` / `sizes` (`(min-width: 768px) 45vw, 92vw`), `fetchPriority="high"`, `decoding="async"`.
- **Bottom fade**: a static `mask-image` on the `<img>` only (`.xc-hero-img`: opaque to 52 %, transparent at 64 %; on `md:` 80 % → 99 %). The warp canvas bakes the identical linear ramp into its fragment shader (uniform `fd` = start, end, buffer height; stops chosen by `matchMedia('(min-width: 768px)')`, redrawn on change). Keep both in sync. **The wrapper (`heroBoxRef`) and the canvas must never get a mask, filter or background**: confirmed in real Chrome that a mask on the wrapper paints the whole hero box as a white rect during load (reproduced twice, gone once the mask is off the wrapper).

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

No other images or fonts are loaded by the overlay; everything else is CSS gradients and inline SVG.

### 7.1 Hero warp (Live2D-lite)

`src/components/loading/keyvisualWarp.ts` animates the hero in raw WebGL1, without three.js. It draws a 48 × 80 grid in one draw call. The vertex shader adds a slight head tilt and breathing stretch; the fragment shader applies small inverse-UV offsets gated by a UV-space region mask. The eyes are static.

**DOM**: `.xc-breathe` (CSS scale/translate, shared by img and canvas) → `heroBoxRef` (`relative h-full`, no mask/filter/background) → `<img class="xc-hero-img">` plus the canvas (`position:absolute; inset:0; 100% × 100%`, transparent, `aria-hidden`). React renders no `style` on the img; its `visibility` is written only by the warp code, so a re-render never re-shows it.

**Load / swap sequence (cold start)**

1. SSR paints the `<img>` (srcset, `fetchPriority="high"`). It is the first paint and the permanent fallback.
2. After the img has loaded, `LoadingOverlay` (layout effect) waits 120 ms, then dynamically imports the module (~3.5 KB gz) and calls `startKeyvisualWarp(img, box, '/materials/warp-mask.webp')`.
3. The module awaits `img.decode()` (only if not yet complete) and the cached mask, compiles, and creates the context (`alpha:true, premultipliedAlpha:true, antialias:false`, clear `0,0,0,0`).
4. Texture: the same `<img>` (whatever `currentSrc` the browser picked, no second download) is pre-downscaled on a 2D canvas to the exact drawing-buffer size with `imageSmoothingQuality='high'` and uploaded premultiplied. This makes the ka = 0 frame match the browser-scaled img (plain bilinear minification of the 991 w source is visibly sharper, and WebGL1 cannot mipmap the NPOT texture). It is re-uploaded on every buffer resize.
5. Buffer size = untransformed layout size (`getComputedStyle` width/height, not `getBoundingClientRect`, which would bake the `.xc-breathe` scale phase in) × `min(devicePixelRatio, 3)`.
6. The host is pixel-snapped: `startKeyvisualWarp` sets `host.style.translate` to minus the host's sub-pixel offset inside its parent (e.g. the centred desktop hero sits at x = 740.43). Chrome rasterizes the img at that sub-pixel phase but places the canvas on whole pixels, which made every edge differ at the swap.
7. The canvas is appended `visibility:hidden` and draws a frame. rAF 1: redraw and show the canvas over the still-visible img (both identical at ka = 0). rAF 2: hide the img (`visibility:hidden`, no transition) and start the ka ramp. So there is exactly one overlap frame and never a frame with neither visible.
8. `ka` ramps 0 → 1 over 1200 ms (smoothstep) and scales every deformation, the despill and the VS tilt/breath, so motion eases in from the static pose.

**Remounts**: the overlay can remount during boot (router pending component → App, StrictMode, HMR). Time uses a module-level origin, and `lastAliveAt` records the last live frame. Within `WARM_MS` (3000 ms) of a live warp (`isWarpWarm()`), the layout effect hides the new img immediately, the cached module and mask make the start run in the same task as the commit, and the warp shows its ka = 1 frame and hides the img before the browser paints. The warp re-shows the img on any failure, and a 600 ms watchdog re-shows it if the takeover did not happen.

**Lifecycle**: no warp under `prefers-reduced-motion` or without WebGL; the static image remains. It pauses (keeping its last frame) when offscreen (IntersectionObserver), when the document is hidden, and during the exit zoom (`isBreaking`). `dispose()` (exit, unmount, `webglcontextlost`) cancels rAFs, disconnects observers, removes the canvas, calls `WEBGL_lose_context` and restores the img.

**Motion regions** (mask `public/materials/warp-mask.webp`, 248 × 400, UV-space; coordinates in 991 × 1600 key-visual px):

- R = hair, two strands (`hairL`, `hairR`: root x/y, width, length), faded out within ~30 px of skin and other parts.
- G = arms: x < 400 is the raised left arm, rotating about the wrist pivot `armL` (210, 520) with a small lift; the right forearm (pivot `elbow` 785, 1125) shares one blended field with the skirt so hand and skirt never tear.
- B = skirt below `skirtTop` (1150): sway plus a mirror-symmetric hem flare with decorrelated phases. The flare runs at `t × 1.95` rad/s (1.5× the 1.3 base); the forearm and the rest of the skirt sway stay at `t × 1.3`.
- A = `255 − gate × 127` for torso and mouth: `bust`/`jiggle` (lagged breath follow, no rebound), `abdomen` draw-in, `mouth` lip press. Never use alpha 0 (browsers drop RGB of fully transparent texels).
- VS: head tilt about `neck` (476, 496) above the neck line, and a breathing vertical stretch.

**Tuning constants** (`C.amp` at the top of the module): `breath 0.0035`, `tilt 0.012`, `hair 5.5`, `bust 9`, `skirt 5`, `flare 12`, `arm 0.021`, `lipPress 0.3`, `lipPeriod 7.5`, `lipIn 0.03`, `jig 9`, `jelStretch 0.005`, `jelNarrow 0.0025`, `jelLag 0.35`, `waist 0.03`, `armLRot 0.013`, `armLLift 1.2`. Timing: `RAMP_MS 1200`, `WARM_MS 3000`, start delay 120 ms, watchdog 600 ms, DPR cap 3. Debug/mesh tools exist only in the prototype under `grok/webgl-warp` (`?debug=1`, `?mesh=1`, `?t=`).


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
