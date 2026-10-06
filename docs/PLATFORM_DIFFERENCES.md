# Differences Across Three Entry Points: Tauri Desktop Companion / Web Main Site / `/embed` iframe

> This document is a **comprehensive comparison matrix** answering: "What exactly differs across the Tauri desktop pet, the main web site, and the `/embed` iframe for XiaoChun, why does it differ, and where is the code located?"  
> Every row annotates the **code location** and whether the feature is **Shared / Exclusive**; items not yet fully verified from code are flagged as **To Be Verified** and should not be cited as definitive.  
> For deeper technical details on specific subjects, refer to their dedicated documents ([`INTERACTION_AND_CONTROLS.md`](INTERACTION_AND_CONTROLS.md), [`HYBRID_DESKTOP_APP.md`](HYBRID_DESKTOP_APP.md), [`EMBED.md`](EMBED.md), [`INTERACTION_AND_3D_GUIDES.md`](INTERACTION_AND_3D_GUIDES.md)).

---

## 0. Read First: embed is Fundamentally an iframe Specialization of Tauri's Interaction Layer

All three entry points run on the **same engine**: `src/core/vrmEngine.ts` (render loop, model loading, wardrobe switching, camera, motion / expression / lipsync / gaze, chat pipeline) and surrounding `src/core/*` modules (gesture state machine, 3D holographic guide rails, scenes, PostFX, materials...).

- **Tauri Companion** and **Web Main Site** share the **exact same React application** (`src/App.tsx`, routed via `src/routes/index.tsx`), branching in only a few spots via `isTauri()` (`src/lib/platform.ts`): frameless transparent window, native window dragging / resizing, 60Hz pixel-level click-through, auto-updater, `xiaochun://` protocol, and close button.
- **`/embed`** is a **slimmer entry point** (`src/routes/embed.tsx` → `src/embed/EmbedApp.tsx`) reusing the exact same `vrmEngine`, `SceneCanvas`, `HeadBubble`, `ChatBar`, `usePetUiVisibility`, `src/core/gesture/*`, and `src/core/interaction/*` gesture/guide styles. It transforms what Tauri achieves natively into postMessage events dispatched to the host page:
  - Dragging the window: Tauri calls `startDragging()`; embed sends `xc.gesture-move`, and the host SDK translates the iframe.
  - Resizing the window: Tauri calls `startResizeDragging()`; embed sends `xc.gesture-resize`, and the host SDK resizes the iframe.
  - Click-through: Tauri passes canvas alpha to Rust `set_ignore_cursor_events`; embed sends `xc.hit-region`, and the host SDK toggles iframe `pointer-events`.
  - Updater / Close / Deep-link: **None** in embed (an iframe is not an OS application).
  - Loading overlay: Embed does not render an overlay; progress streams via `xc.load.progress`, and the host displays a placeholder image.

Key takeaway: **Gesture/guide/click recognition logic is shared; concrete landing actions are implemented per platform**. Features unique to embed (host protocol, `uiAutoHide`, `camera`, `persistBox`, text selection prevention) are necessitated by the iframe environment rather than divergent architecture.

Legend: **Shared** = identical code; **Exclusive(T)** = Tauri only; **Exclusive(W)** = Web site only; **Exclusive(E)** = embed only.

---

## 1. Positioning & Runtime Environment

| Dimension | Tauri Companion | Web Main Site | `/embed` iframe | Code Location / Notes |
| :-- | :-- | :-- | :-- | :-- |
| Form Factor | Native shell (Tauri 2.x) loading the frontend; mobile shell also planned (`platform.ts` mentions iOS / Android; **actual release status of mobile shells To Be Verified**) | Full web application in standard browsers, Cloudflare Workers SSR | Lightweight entry embedded via `<iframe>` in third-party pages; SSR renders empty shell | `src-tauri/`, `src/routes/index.tsx`, `src/routes/embed.tsx`, `src/server.ts` |
| Entry Component | `App` | `App` | `EmbedApp` | `src/App.tsx`, `src/embed/EmbedApp.tsx`; Tauri and main site **Shared**, embed **Exclusive(E)** |
| Environment Detection | `isTauri()` (`__TAURI_INTERNALS__`) | Neither | `isEmbed()` (pathname starts with `/embed`), mutually exclusive with Tauri | `src/lib/platform.ts` |
| Landing Page Features (SEO, sitemap, `llms.txt`) | Not applicable | Yes | `noindex, nofollow` | `src/routes/__root.tsx`, `public/robots.txt`, `public/sitemap.xml`, `public/llms*.txt`, `src/routes/embed.tsx` (**Exclusive(W)** / **Exclusive(E)**) |
| External Control Interface | `xiaochun://` protocol (deep-link / single-instance) | None (except dev bridge) | `xc.*` postMessage protocol; **deliberately ignores** `xiaochun://` | `src/core/protocol/index.ts` (`isEmbed()` returns early), `docs/PROTOCOL.md`, `docs/EMBED.md` |
| Debug Panel (DevDrawer / vConsole) | Hidden by default in production; unlocked by 10-tap easter egg | Same as Tauri; directly visible in dev environments (Vite DEV / localhost) | **No DevDrawer** (camera/color tuning not exposed; embed exposes only 4 `camera` properties, see §5) | `src/App.tsx` (`isDev()`, `hasDevEasterEgg`), `src/lib/utils.ts#isDev`, `src/components/ChatBar.tsx` (easter egg); embed does not mount `DevDrawer` |

---

## 2. Window / Container, Background, Corner Radius

| Dimension | Tauri Companion | Web Main Site | `/embed` iframe | Code Location / Notes |
| :-- | :-- | :-- | :-- | :-- |
| Container | Borderless, transparent, always-on-top native window with `shadow: false` | Entire browser viewport (`#app` 100dvh) | Host-provided iframe container (SDK wrapper `div` + iframe) | `src-tauri/tauri.conf.json` (`decorations: false`, `transparent: true`, `alwaysOnTop: true`), `src/App.tsx`, `packages/project-xiaochun/src/client.ts` |
| Default Dimensions | Window 560×820, min 320×468; window position / size remembered by window-state plugin (only saves POSITION \| SIZE) | Viewport | SDK default **600×1080** (`min(600px, 100vw)` × `min(1080px, 100svh)`, clamped to viewport); resizable default min 120×180, max = viewport | `tauri.conf.json`, `src-tauri/src/lib.rs` (`tauri_plugin_window_state`), `client.ts` (`XC_DEFAULT_WIDTH/HEIGHT`). **Mismatch**: embed defaults larger than Tauri window with smaller minimum bounds |
| Position / Size Persistence | Tauri window-state (native, automatic) | None (viewport) | Not persisted by default; host enables `persistBox` to save to **host page** localStorage (`xiaochun:box[:<ns>]`) | `client.ts` (`persistBox`), `docs/EMBED.md` §2.8. **Exclusive(E)** |
| Corner Radius | Under `html.is-tauri`, `#root` / `#app` / overlay use `border-radius: var(--xc-window-radius)` (20px) | No rounded corners | Non-transparent scene wrapper defaults to 20px (same as Tauri, unit-tested), transparent scene 0; overridable via `borderRadius` / `--xc-radius` | `src/styles/main.css` (`--xc-window-radius`), `packages/project-xiaochun/src/protocol.ts#XC_WINDOW_CORNER_RADIUS`, `src/embed/__tests__/windowRadius.test.mjs`. **Shared Constant** |
| Background / Scene | 4 scenes: `light` / `dark` / `transparent` / `beach3d` (opaque 3D beach, see [`BEACH3D_SCENE.md`](BEACH3D_SCENE.md)) | `light` / `dark` / `beach3d`; transparent scene restricted (filtered from menu, falls back on restore) | All 4 supported; URL `scene`/`transparent`/`theme` override iframe stored preference; explicit specification stops tracking system light/dark | `src/config.ts#scenes`, `src/core/scene/sceneManager.ts` (`isTransparentSceneAllowed = isTauri() || isEmbed()`), `src/components/TopHeader.tsx` (`filter(!isTransparent || isTauri())`), `src/lib/utils.ts#resolveInitialSceneTheme` |
| Click-Through in Transparent Scene | Frontend samples canvas pixels at ~60Hz and dispatches to Rust via Tauri command: pixel alpha + DOM guard areas → `set_ignore_cursor_events`; sets `setInteracting(true)` when guide tracks appear | Not applicable | `vrmEngine.hitTest` reads 1-pixel alpha at pointer (`HitGate` throttle / hysteresis) → `xc.hit-region` → host SDK toggles `pointer-events`; built-in buttons / menu / corner resize handles also count as hits | Tauri: `src/core/scene/passthroughManager.ts`, `src-tauri/src/lib.rs`; embed: `src/embed/bridge.ts` (`HitGate`), `src/core/gesture/hitGate.ts`. **Recognition cadence implemented separately**, hit rules share same semantics (character / UI = capture, blank space = pass-through) |
| Clicking "Blank Space" in Transparent Scene | Clicks reach OS desktop (native click-through), companion window unaffected | Not applicable | Clicks hit host page and **never reach the iframe**; cannot "click blank to dismiss UI", relies on 10s auto-hide timeout or clicking character | `docs/EMBED.md` §7. **Inconsistent with Tauri (form factor constraint)** |
| Selection Blue Highlight | Not an issue (native window) | In-page selection works normally | Host page Cmd+A / drag-selection / multi-clicks can highlight entire iframe in blue: SDK applies `user-select: none` to wrapper, placeholder, and iframe (inline CSSOM, does not inject `<style>`, leaves `pointer-events` intact) | `packages/project-xiaochun/src/client.ts#noSelect`, `src/styles/main.css` (`canvas { user-select: none }`). **Exclusive(E)** |

---

## 3. Pointer & Gestures

Recognition logic is centralized in `src/core/gesture/` (`gestureMachine.ts`, `resizeGesture.ts`, `corners.ts`, `hitGate.ts`) and `src/core/interaction/interactionController.ts`, which are **Shared** across all three entry points; differences lie only in "how the action lands once thresholds are exceeded".

| Dimension | Tauri Companion | Web Main Site | `/embed` iframe | Code Location / Notes |
| :-- | :-- | :-- | :-- | :-- |
| Short Left-Drag (>10px displacement before long-press arms) | `moveStrategy='native'` → Native `startDragging()` moves window | `'none'`: Only cancels long-press arming, yields scroll to page | Enabled only if host sets `draggable`: uses `'delta'` strategy to emit `xc.gesture-move`, host SDK moves iframe; disabled = `'none'`, passes pointer events through | `interactionController.ts` (`moveStrategy`), `src/core/gesture/adapters/tauriWindow.ts`, `src/embed/gestures.ts`. **Shared state machine / Exclusive landing** |
| Long-Press to Enter 3D Adjust Mode (`bodyTurn` + camera pitch + camera height rail) | 480ms (`INTERACTION_TOUCH_ARM_MS`), displacement >10px during arming cancels | Same | Same (releasing touch also toggles pet UI, same behavior as Tauri) | `src/lib/constants.ts` (`INTERACTION_TOUCH_ARM_MS=480`, `INTERACTION_TOUCH_ARM_SLOP_PX=10`, `INTERACTION_GUIDE_AUTO_HIDE_MS=2800`). **Shared** |
| Drag with Platform Modifier (Mac ⌘ / Windows/Linux Ctrl) | Enters 3D adjust mode immediately | Same | Same | `platform.ts#hasInteractionModifier`. **Shared** |
| **Camera Motion Model** | Camera **only pitches vertically around character** (`OrbitControls.enableRotate = false`, vertical drag uses `_rotateUp`); **horizontal dragging rotates character's `bodyTurn`, not camera around character**; camera azimuth angle is locked forward | Same | Same | `src/core/vrmEngine.ts` (`enableRotate = false`, `computeCameraPositionFromPitch` locks azimuth to 0), `interactionController.ts` (`'turn'`: `targetYawOffset += dx * characterTurnSensitivityX`, `_rotateUp(dy * pitchSensitivityY)`). **Shared**; consequently embed's `camera` options **do not expose pitch or azimuth** |
| Scroll Wheel / Pinch Zoom | Enabled; in transparent scene, only zooms when pointer is over character pixels; blank space scrolls desktop | Enabled | Enabled by default (matches main site); `controls=0` locks zoom; transparent scene similarly "only zooms over character", non-transparent scene scrolls entire iframe area = zoom (captures page scroll in that bounding box) | `vrmEngine.ts` (`lockWheelZoom`, `mouseButtons.MIDDLE=DOLLY`), `src/embed/EmbedApp.tsx`, `docs/EMBED.md` parameter table. Distance limits 1–15m are shared |
| Resize Window / Container | Four corner arc handles (SVG, 40px hit area) → Native `startResizeDragging()`; desktop only (`isDesktop()`); config defines non-transparent scene `tauri.resizable: true / cornerHandles: false`, transparent scene `resizable: false / cornerHandles: true` (transparent scene relies on corner handles; **window border resize implementation in non-transparent scene To Be Verified**) | None | Available only when host enables `resizable`: identical 40px hit area / cursor / arc styling (`EmbedCorners`) → `xc.gesture-resize`, host scales iframe, clamped within min / viewport | `src/components/TauriWindowFrame.tsx`, `src/embed/EmbedCorners.tsx`, `src/core/gesture/corners.ts#CORNER_HIT_SIZE`, `src/embed/gestures.ts`, `src/config.ts#scenes.items.*.tauri`. **Shared hit area / styling, Exclusive landing** |
| Click Character to Toggle UI | Only in **transparent scene**: single-click character toggles UI, single-click blank space dismisses UI, 10s idle dismisses UI; light / dark scenes always display UI | Same as above (transparent scene restricted on main site, practically always displayed) | Determined by `uiAutoHide`: default `'transparent'` (= Tauri behavior); `true` hides across all scenes; `false` always displays. Single-click evaluated by shared `ClickDetector` (displacement ≤ 6px, drag / multi-touch / cancel excluded) | `src/hooks/usePetUiVisibility.ts`, `src/core/ui/clickDetector.ts`, `src/App.tsx` (`usePetUiVisibility(isTransparent)`), `src/embed/EmbedApp.tsx`. **Shared hook**; `uiAutoHide: true` in light/dark scenes is an **embed extension**. `ClickDetector` evaluates max journey displacement, slightly stricter than Tauri original (see §10) |
| Drag-and-Drop `.vrm` File to Swap Model | Supported | Supported | Not supported (iframe does not capture host page drag-and-drop) | `src/App.tsx` (`dragover`/`drop`). **Exclusive(T/W)** |

---

## 4. User Interface (UI)

| Dimension | Tauri Companion | Web Main Site | `/embed` iframe | Code Location / Notes |
| :-- | :-- | :-- | :-- | :-- |
| Top Header | `TopHeader`: scene, wardrobe, language, GitHub, (dev) panel toggle; Tauri also adds `⋯` (check updates / dev reload / quit) | Same, without `⋯` | **No TopHeader**. Host uses `ui=[...]` to select built-in widgets: `outfit`, `scene`, `lang`, `github` (plus `chat`, `bubble`); defaults to empty | `src/components/TopHeader.tsx`, `src/components/TauriTopHeader.tsx` (Exclusive(T)), `src/embed/EmbedPicker.tsx`, `src/components/HeaderButtons.tsx` (`LangButton` / `GithubButton` **Shared**) |
| "Transparent" in Scene Menu | Available only in Tauri | Filtered out | Available (menu = `APP_CONFIG.scenes.items`, same source as `capabilities.scenes`) | `TopHeader.tsx`, `EmbedPicker.tsx` |
| Chat Bar / Settings Dialog | `ChatBar` (model / provider / advanced settings / sync / device stats / STT / 10-tap dev unlock) | Same | When `ui` contains `chat`, mounts **identical `ChatBar`** (menu items exist; **practical usability and storage isolation of these setting modals in embed To Be Verified**); main site preloads WebLLM library in background on mount, embed only loads upon opening model menu | `src/components/ChatBar.tsx` (`isEmbed()` branch, ~L191). **Shared component** |
| Head Bubble | Enabled (`components.headBubble`) | Enabled | Mounted only when `ui` contains `bubble` | `src/components/HeadBubble.tsx`, `EmbedApp.tsx` |
| Loading Overlay / Height Ruler / Update Dialog / Drop Hint | Enabled | Enabled (without update dialog) | **None rendered** (progress reported via `xc.load.progress`, host renders placeholder) | `src/App.tsx` (`LoadingOverlay`, `#height-ruler-*`, `AppUpdateDialog`, `drop-zone`), `src/components/AppUpdateDialog.tsx` (`isTauri()`) |
| UI Language | URL / cookie `lang` → browser | Same | Priority: URL `lang` / SDK `lang` > iframe localStorage last selected in button (`xiaochun_embed_lang`) > `navigator.languages` > `zh-CN`; **does not read/write main site language cookie**; changes emit `xc.lang-changed` | `src/i18n/index.ts`, `src/embed/registry.ts#resolveEmbedLang`, `src/lib/constants.ts#EMBED_LANG_KEY` |
| External Links (GitHub, etc.) | `plugin-opener` invokes OS system browser (WebView `target=_blank` is inactive) | `window.open` new tab | New tab (`<a target=_blank>` / `openExternal`) | `src/lib/openExternal.ts`, `HeaderButtons.tsx` |

---

## 5. Camera

| Dimension | Tauri Companion | Web Main Site | `/embed` iframe | Code Location / Notes |
| :-- | :-- | :-- | :-- | :-- |
| Motion Model | Camera **only pitches vertically around character**; **horizontal dragging is character `bodyTurn`, not camera orbiting** (see §3) | Same | Same | `vrmEngine.ts`, `interactionController.ts`. **Shared** |
| Default Framing | `fov: 30`, framing bounds `defaultShotExtent: 1.34` → visual distance ≈ 2.50m; default pitch ≈ 88.7° | Same | Same | `src/config.ts#camera`; unified helper `getDefaultCameraDistance(fov)` + `resolveShot()`, shared across initial setup / `fitCamera` / cinematic intro endpoint. **Shared** |
| Ground Clamp (camera never goes below the floor) | Pitch keeps its full range (`minPolarAngle` 0.01 to `maxPolarAngle` π−0.01). When the requested position would be lower than `groundClamp.minHeight` (0.15 m) above the floor (y = 0), the camera slides along its view ray toward the target and stops at that height. Pitch is unchanged. The field of view widens to make up part of the dolly (`fovCompensation` 0.1, capped at `camera.maxFov` 60°). Below `minDollyDistance` (0.6 m, only reachable when the Camera Y offset pushes the target near the floor) the orbit pivot is raised instead. The floor and sand therefore never disappear, and the horizon stays fixed in world space at about the character's feet. The user's zoom (desired distance) is kept separately: wheel/pinch zoom-out while clamped grows the desired distance and shows as a wider field of view, then takes full effect when the camera pitches back above the floor; zoom-in takes effect immediately. The saved camera distance is the desired one. The transparent scene is not clamped | Same | Same | `src/core/camera/groundClamp.ts` (pure solver + tests), `vrmEngine.ts#installGroundClamp` (wraps `controls.update()`, so the main loop, wheel/pinch handlers, `fitCamera` and the cinematic intro are all covered; the clamped pose stays until the next update, so rendering, hit-testing and gaze use the same camera), `APP_CONFIG.camera.groundClamp`. **Shared** |
| Cinematic Push (Post-load) | Enabled, ~1.1s | Enabled | Enabled by default; host sets `camera.intro: false` to jump directly to target | `vrmEngine.ts#cinematicIntro` |
| Parameter Controls | DevDrawer "Camera Settings" (fov, distance bounds, etc.), visible in dev only | Same | Host configures `camera: { fov, distance, height, intro }`: fov 15–60°, distance 1–15m, height ±1m; URL `cameraFov` etc.; runtime `xc.setConfig{camera}` (omitted keys unchanged, `null` resets default); reported in `capabilities.camera`; **pitch is not exposed** | `src/components/dev-drawer/sections/CameraSection.tsx` (Exclusive T/W); `src/embed/params.ts`, `bridge.ts`, `packages/project-xiaochun/src/protocol.ts` (`XC_CAMERA_RANGES`, aligned with `APP_CONFIG.camera`, tested in `src/embed/camera.test.ts`), `docs/EMBED.md` §2.9. **Exclusive(E)** |
| Persistence | `xiaochun_camera_pitch` (pitch + distance), `xiaochun_camera_y_offset` stored in respective localStorage | Same | iframe's own localStorage (**partitioned storage** across origins); priority: host explicit > iframe saved value > default; while host specifies `distance`, saved value is not written; explicit `height` skips writing y-offset | `src/lib/constants.ts`, `vrmEngine.ts#saveCurrentCameraPitch`, `resolveShot` |

---

## 6. Persistence & Storage

| Target | Tauri | Web Main Site | `/embed` | Code Location / Notes |
| :-- | :-- | :-- | :-- | :-- |
| Active Outfit `xiaochun_wearing_outfit` | webview localStorage | site localStorage | iframe origin localStorage (**partitioned storage** when cross-site); URL `outfit` takes precedence; host `persist` option can save to **host page** `xiaochun:prefs` | `constants.ts#WEARING_OUTFIT_KEY`, `registry.ts`, `client.ts` (`persist`) |
| Scene `xiaochun_scene_theme` | Same | Same | Same as above; URL `scene`/`transparent`/`theme` takes precedence; internal transitions via `xc.setConfig` / `setScene` **do not write** iframe preference (only user clicks on built-in buttons write) | `constants.ts#SCENE_THEME_KEY`, `sceneManager.ts`, `bridge.ts` |
| Language | cookie `lang` (main site) | cookie `lang` | `xiaochun_embed_lang` (does not touch cookies) | `src/i18n/index.ts`, `constants.ts#EMBED_LANG_KEY` |
| Camera / Yaw | `xiaochun_camera_pitch`, `xiaochun_camera_y_offset`, `xiaochun_body_yaw` | Same | Same (iframe's own storage) | `constants.ts` |
| Window / Box Position & Size | window-state plugin | — | Host page `xiaochun:box[:<ns>]` (`persistBox`) | See §2 |
| Model Cache | IndexedDB 2-tier cache (`xiaochun-vrm-cache`) | Same | Same (iframe origin IDB; host can prefetch via `prefetch`) | `src/lib/idb-vrm-cache.ts`, `docs/OUTFIT_SWAP.md`, `src/embed/prefetch.ts` |

> Note: When third-party sites embed the iframe, modern browsers enforce **storage partitioning** on iframe localStorage / IDB (keyed by iframe origin + top-level site). A user's outfit/language selection on Site A will not bleed into Site B, nor will it sync with direct visits to the main site.

---

## 7. Loading, Caching & Heavy Resources

| Dimension | Tauri | Web Main Site | `/embed` | Code Location / Notes |
| :-- | :-- | :-- | :-- | :-- |
| First Screen | Launch `LoadingOverlay` + cinematic push | SSR renders `LoadingOverlay`, then dynamically loads `App` | Nothing rendered prior to SSR / mount; host SDK draws placeholder (configurable `lazy: 'idle' | 'click'`), progress streams via `xc.load.progress` | `src/routes/index.tsx`, `src/routes/embed.tsx`, `client.ts` |
| WebLLM / EMAGE Pre-warming | Follows `heavyPreload` policy | Same | `heavy=lazy` (default, loads on first interaction) or `eager`; host can invoke `xc.prefetch` to download without decompressing | `src/lib/heavyPreload.ts`, `bridge.ts` (`heavy`) |
| HTTP Cache Headers | `/vrm/*` 1 hour + must-revalidate, `/assets/*` immutable | Same | Same | `public/_headers`, `src/lib/securityHeaders.ts` (must stay in sync) |
| API Base URL | `/api/*` transparently redirected to `APP_CONFIG.api.baseUrl` (production Worker) | Same-origin `/api/*` | Same-origin `/api/*` on iframe origin (Edge-TTS proxy, etc.) | `src/lib/api.ts` |

---

## 8. LLM / TTS / STT / EMAGE Capabilities

| Capability | Tauri | Web Main Site | `/embed` | Code Location / Notes |
| :-- | :-- | :-- | :-- | :-- |
| Chat (WebLLM / Provider) | `vrmEngine.sendMessage` | Same | `xc.say{mode: 'chat'}` → Same `sendMessage` | `vrmEngine.ts`, `bridge.ts`. **Shared** |
| Speak-Only (Bypasses LLM) | Protocol `speak` | Same | `xc.say{mode: 'speak'}` (TTS + EMAGE) | `bridge.ts`, `docs/PROTOCOL.md` |
| Host-Supplied Audio | Protocol `audioUrl` | — | `xc.audio` / `xc.audio.chunk` (bypasses TTS, audio → EMAGE → motion + lipsync), encoded / pcm16 / float32, `playbackRate` 0.25–3 and `volume` 0–1 via `xc.transport` | `src/director/hostAudio.ts`, `docs/EMBED.md` §2.4. **Exclusive(E) + Protocol** |
| STT (SenseVoice) | Enabled | Enabled | `xc.mic` toggle; host iframe requires `allow="microphone"` delegation | `src/stt/`, `bridge.ts`, `securityHeaders.ts` (`Permissions-Policy`) |
| Multi-Threaded WASM (Cross-Origin Isolation) | Inside native shell | COOP/COEP maintains isolation | **Not** isolated by default; host can opt into `crossOriginIsolated` and delegate to iframe | `securityHeaders.ts`, `docs/EMBED.md` §3.1 |

---

## 9. Security & Cross-Origin

| Dimension | Tauri | Web Main Site | `/embed` | Code Location / Notes |
| :-- | :-- | :-- | :-- | :-- |
| Embedding Permission | Not applicable | `X-Frame-Options: DENY` | XFO removed, serves `Content-Security-Policy: frame-ancestors <whitelist, default *>` (`EMBED_FRAME_ANCESTORS` can restrict) | `src/lib/securityHeaders.ts`, `public/_headers`, `wrangler.jsonc` |
| Handshake | Not applicable | Not applicable | `xc.ready` → `xc.init` + `MessagePort`, strict origin validation (`host` param / `allow` / `ancestorOrigins`), subsequent traffic exclusively via port; **missing host fails closed** | `src/embed/bridge.ts`, `src/embed/params.ts`, `docs/EMBED.md` §2.3 |
| Tauri CSP | `csp: null` (`tauri.conf.json`) | See HTTP response headers | See above | `src-tauri/tauri.conf.json` |
| Custom Models | Drag-and-drop `.vrm` | Same | Restricted to built-in outfits by default; `allowCustomModel` flag required to permit https model URLs | `bridge.ts` (`allowCustomModel`) |

---

## 10. Host SDK, Build, Release, Testing

| Dimension | Tauri | Web Main Site | `/embed` + npm package | Code Location / Notes |
| :-- | :-- | :-- | :-- | :-- |
| Build | `pnpm tauri:build` (`frontendDist: ../dist/client`) | `pnpm build` → `wrangler deploy` | Same single `pnpm build` produces `/embed` page; npm package `@firetable/project-xiaochun` in `packages/project-xiaochun` (`build:packages` runs prior to vite build) | `package.json`, `vite.config.ts`, `wrangler.jsonc` |
| Versioning / Release | Single `v*` tag triggers `release-tauri.yml` and `publish-npm.yml`, versions synchronized across 4 locations via `pnpm bump:*` | Same version deployed to Worker | npm package version locked to desktop release | `.github/workflows/`, `scripts/bump-version.mjs`, `docs/EMBED.md` §6 |
| Protocol Constants | — | — | Single source of truth in `packages/project-xiaochun/src/protocol.ts`, imported directly via alias in main repo (vite and vitest maintain independent aliases) | `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` |
| Testing | `pnpm test` (vitest: gesture / guide / click / camera ranges pure logic) | Same | `pnpm test:embed` (node:test), `packages/project-xiaochun`'s `pnpm test` (build artifacts), `test/browser/outfit-harness.mjs` (stub iframe), `test/browser/embed-e2e.mjs` (real Chrome + real `/embed` + mouse emulation / screenshots) | `package.json`, `packages/project-xiaochun/package.json` |

---

## 11. Known Inconsistencies vs. Tauri

1. **Clicking blank host page in transparent scene cannot reach iframe**: In Tauri, clicking outside the character dismisses pet UI; in embed, clicks hit the host page and cannot bubble into the iframe. UI dismissal relies on the 10s idle timer or re-clicking the character (form factor constraint, see `EMBED.md` §7).
2. **Window movement**: Tauri uses native `startDragging()`; embed emits delta increments translated by the host SDK and clamped to the viewport.
3. **Long-press release also toggles pet UI**: An identical quirk shared by embed and Tauri (inheriting the same `usePetUiVisibility`), not an embed-exclusive bug.
4. **`ClickDetector` evaluates max journey displacement**: Slightly stricter than Tauri's original implementation (which measured distance between pointerdown and pointerup); jittery clicks in embed are discarded as drags.
5. **`uiAutoHide: true` in light/dark scenes**: An embed extension; Tauri does not support this mode.
6. **Default dimensions**: SDK defaults to 600×1080 vs Tauri window 560×820 (min 320×468); embed resizable minimum defaults to 120×180.
7. **No DevDrawer / loading overlay / update dialog / drag-drop model swap / close button / `xiaochun://`**: These require a native shell or full-page control and are intentionally omitted from embed.
8. **Partitioned storage**: Language, wardrobe, and camera preferences in embed are partitioned by the browser and not shared across host domains or the main site.

---

## 12. Maintenance Rules (Synchronization Checklist)

- **Gesture / Click / Guide Recognition Logic** (`src/core/gesture/*`, `interactionController.ts`, `usePetUiVisibility`, `clickDetector`): Shared by all 3 entry points. Any modifications require checking both the Tauri adapter (`adapters/tauriWindow.ts`, `TauriWindowFrame`) and embed adapter (`src/embed/gestures.ts`); run `pnpm test` and embed e2e gesture suites; update §3 of this document and [`INTERACTION_AND_CONTROLS.md`](INTERACTION_AND_CONTROLS.md) / [`INTERACTION_AND_3D_GUIDES.md`](INTERACTION_AND_3D_GUIDES.md).
- **Camera** (`vrmEngine.ts` `getDefaultCameraDistance` / `resolveShot` / `fitCamera` / `cinematicIntro`, `APP_CONFIG.camera`): Keep `XC_CAMERA_RANGES` (`protocol.ts`) and `src/embed/camera.test.ts` synchronized; update §5 of this document and [`EMBED.md`](EMBED.md) §2.9. The invariant that camera only pitches up/down must not be altered to azimuth orbit, otherwise `bodyTurn` documentation must be updated concurrently. Any new code that moves the camera should go through `controls.update()` (or call it afterwards) so the ground clamp applies; read the user's zoom with `getDesiredCameraDistance()`, not `controls.getDistance()`.
- **Window Corner Radius**: Modify only `main.css#--xc-window-radius` and `protocol.ts#XC_WINDOW_CORNER_RADIUS` to identical values (enforced by unit test `windowRadius.test.mjs`).
- **Adding / Modifying embed Options or `xc.*` Commands**: Update `protocol.ts` (single source of truth) → `src/embed/params.ts` / `bridge.ts` (URL params, `applyConfig`, `capabilities`) → SDK `client.ts` / `avatar-element.ts` / `react.ts` → `docs/EMBED.md` (params, commands, options) → both `packages/project-xiaochun/README*.md` → `examples/embed-host.html` → unit tests + harness + e2e; synchronize corresponding rows in this document.
- **Security Headers**: `securityHeaders.ts` and `public/_headers` must remain identical; synchronize `EMBED.md` §3 and §9 of this document.
- **Persistence Keys**: Document new or renamed localStorage keys in `src/lib/constants.ts` and update §6 of this document.
- **Scenes & Transparency Rules** (`sceneManager.ts`, `APP_CONFIG.scenes`): Synchronize `TopHeader`, `EmbedPicker`, `passthroughManager` (Tauri), and `bridge.ts` hit testing (embed); update §2 of this document.
- **Tauri Window Configuration** (`tauri.conf.json`, `src-tauri/src/lib.rs`): When default or minimum window dimensions change, update §2 of this document and re-evaluate SDK defaults.
- This document records only **differences and code locations** without repeating deep specifications found in topic documents; items marked "To Be Verified" should be updated to verified conclusions with code references once confirmed.
