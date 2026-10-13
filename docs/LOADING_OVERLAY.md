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
- The bottom fade is a static `mask-image` (`.xc-hero-img`, with a different stop on `md:`).

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

No other images or fonts are loaded by the overlay; everything else is CSS gradients and inline SVG.

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
