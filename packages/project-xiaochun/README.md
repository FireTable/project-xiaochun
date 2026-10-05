<p align="center">
  <img src="https://raw.githubusercontent.com/FireTable/project-xiaochun/main/public/logo.png" width="96" height="96" alt="Project XiaoChun Icon" style="border-radius: 16px;" />
</p>

<h1 align="center">@firetable/project-xiaochun</h1>

<p align="center">
  <b>Embed XiaoChun (小蠢), a 100% browser-native 3D anime companion, into any web page — lazy, origin-checked, zero runtime dependencies</b>
</p>

<p align="center">
  English •
  <a href="README-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://xiaochun.firetable.tech"><b>🌐 Live Demo</b></a>
  •
  <a href="https://github.com/FireTable/project-xiaochun/blob/main/docs/EMBED.md"><b>📚 Full Embed Docs</b></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@firetable/project-xiaochun"><img src="https://img.shields.io/npm/v/@firetable/project-xiaochun?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://xiaochun.firetable.tech"><img src="https://img.shields.io/badge/Live_Demo-xiaochun.firetable.tech-10b981?logo=cloudflare&logoColor=white" alt="Live Demo" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-amber.svg" alt="License" /></a>
</p>

---

## 📖 Overview

This package puts **[Project XiaoChun](https://github.com/FireTable/project-xiaochun)** on your own site through a **lazy, origin-checked `<iframe>`**. The character, the on-device AI (WebLLM / SenseVoice STT / EMAGE motion) and all heavy assets live inside the iframe; your page only ships a few KB of glue code (the SDK never bundles three.js).

* 🧩 **`createXiaochun()`**: framework-free JS SDK.
* 🏷️ **`<xiaochun-avatar>`**: Web Component (Shadow DOM, attributes + events).
* ⚛️ **`@firetable/project-xiaochun/react`**: `<Xiaochun />` component and `useXiaochun` hook (SSR-safe, StrictMode-safe).
* 📜 **One-line `<script>` loader**: IIFE build for jsDelivr / unpkg, no build step.
* 🔊 **`speakAudio()`**: hand XiaoChun your own audio and she speaks it with body motion and lip-sync.
* 📦 ESM + CJS + `.d.ts`; protocol constants and types are exported from `@firetable/project-xiaochun/protocol`.

---

## 📥 Installation

```bash
npm i @firetable/project-xiaochun
# or
pnpm add @firetable/project-xiaochun
# or
yarn add @firetable/project-xiaochun
```

No build step? Use the CDN loader (pin the version in production):

```html
<script src="https://cdn.jsdelivr.net/npm/@firetable/project-xiaochun@0.1/dist/loader.global.js" defer></script>
<xiaochun-avatar position="bottom-right" size="280" lang="en"></xiaochun-avatar>
```

The same file is available from unpkg: `https://unpkg.com/@firetable/project-xiaochun@0.1/dist/loader.global.js`.

| Entry | Purpose |
| :--- | :--- |
| `@firetable/project-xiaochun` | `createXiaochun`, protocol constants/types, `toProtocolUrl` |
| `@firetable/project-xiaochun/element` | Registers `<xiaochun-avatar>` (side-effect import) |
| `@firetable/project-xiaochun/react` | `<Xiaochun />`, `useXiaochun` (needs `react >= 18`, optional peer dependency) |
| `@firetable/project-xiaochun/protocol` | Protocol constants and types only |
| `@firetable/project-xiaochun/loader` | The IIFE bundle (global `window.Xiaochun`) |

---

## 🚀 Quick Start

### JavaScript SDK

```ts
import { createXiaochun } from '@firetable/project-xiaochun';

const xc = createXiaochun({
  container: '#avatar',
  width: 320, height: 480,          // reserve space → zero layout shift
  placeholder: '/img/xiaochun.webp',
  transparent: true,
});

await xc.ready;                      // model loaded
await xc.say('Hello!');              // resolves when she finishes speaking
xc.on('stt', (p) => p.kind === 'text' && console.log(p.text));
xc.destroy();
```

### Web Component

```html
<script type="module">import '@firetable/project-xiaochun/element';</script>
<xiaochun-avatar id="xc" size="320x480" lazy="click"></xiaochun-avatar>
<script>
  xc.addEventListener('xc-ready', () => xc.say('Hello!'));
</script>
```

### One-line script (auto-mount a floating avatar)

```html
<script src=".../dist/loader.global.js" data-auto data-position="bottom-right" data-size="280" defer></script>
```

`data-*` attributes map to the `<xiaochun-avatar>` attributes of the same name.

---

## ⚛️ React

`react` is an **optional peer dependency** (`>=18`; React 18 and 19 are supported). The subpath is a separate bundle, so the main entry does not grow. The file carries `'use client'` (Next.js App Router friendly). On the server only a fixed-size empty `<div>` is rendered and the iframe is created in a client effect; under `<StrictMode>` the effect cleanup always calls `destroy()`, so nothing leaks.

```tsx
import { useRef } from 'react';
import { Xiaochun, useXiaochun, type XiaochunHandle } from '@firetable/project-xiaochun/react';

export function Mascot({ audio }: { audio?: ArrayBuffer }) {
  const ref = useRef<XiaochunHandle>(null);
  return (
    <>
      <Xiaochun
        ref={ref} width={320} height={480} transparent lazy placeholder="/xc.webp"
        onReady={() => ref.current?.say('Hello!')}
        onUtterance={(u) => console.log(u.phase, u.kind)}   // 'start' | 'end', 'text' | 'audio'
        onError={(e) => console.warn(e.code, e.message)}
      />
      <button onClick={() => audio && ref.current?.speakAudio(audio)}>Play audio</button>
    </>
  );
}

// Want your own layout? Use the hook:
const { containerRef, client, ready, state } = useXiaochun({ width: 280, height: 420 });
// <div ref={containerRef} style={{ width: 280, height: 420 }} />
```

* **Props**: every `createXiaochun` option except `container`, plus `onHandshake / onReady / onProgress / onState / onStt / onUtterance / onHitRegion / onMove / onResize / onError / onDestroy`, `className`, `style`, `paused`, and `mic`.
* **Rebuild vs. live update**: creation-time options (`src`, `lazy`, `transparent`, `position`, …) rebuild the instance when they change, so avoid passing fresh values on every render. `width`, `height`, `draggable`, `resizable` (effects call `setSize` / `setDraggable` / `setResizable`), `lang`, `outfit`, `scene` (and the deprecated `model`), `paused`, `mic` and the callbacks update in place without recreating the iframe (effects call `setOutfit` / `setScene` / `setConfig`). Also available: `onOutfitChanged`, `onSceneChanged`.
* **Ref methods**: `say`, `speakAudio`, `speakAudioStream`, `motion`, `expression`, `lookAt`, `setOutfit`, `setScene`, `getOutfits`, `getScenes`, `prefetch`, `setModel`, `setConfig`, `startListening`, `stopListening`, `mic`, `pause`, `resume`, `activate`, `destroy`, plus `ready` and `instance`. Methods that return a Promise reject until the component is mounted.

---

## 🔊 Host-Supplied Audio (`speakAudio`)

Skip the built-in TTS and let XiaoChun speak **your** audio. The iframe decodes it, EMAGE generates matching body motion (16 kHz mono windows), audio/video stay in sync with lip-sync, and `utterance end` fires when playback finishes. Heavy models stay lazy: the first `speakAudio` with motion loads EMAGE, and `motion: false` never does.

```ts
await xc.speakAudio(arrayBuffer, { text: 'Hi', motion: true, lipsync: true }); // ArrayBuffer is transferred (detached); pass { transfer: false } to keep it
await xc.speakAudio(blob);                                   // Blob (mp3 / wav / ogg …)
await xc.speakAudio('https://cdn.example.com/voice.mp3');    // URL: fetched by the host page by default ({ fetch: 'frame' } = fetched inside the iframe)
await xc.speakAudio(pcm, { format: 'pcm16', sampleRate: 24000 });   // headerless PCM needs sampleRate (8000–96000)

const s = xc.speakAudioStream({ sampleRate: 24000 });        // streaming: e.g. PCM chunks from a TTS server
s.write(int16Chunk); s.write(next); s.end(); await s.done;   // s.abort() stops immediately
// Cancel any time: pass { signal: abortController.signal }
```

* Rejects with `bad_request` (undecodable / empty audio, bad URL or sampleRate), `unsupported`, or `failed`.
* Browsers still require a user gesture on the host page before audio can play, and the iframe needs `allow="autoplay"` (the SDK sets it).
* A newer `say()` / `speakAudio()` call preempts the one in progress, and the preempted promise resolves.
* `<xiaochun-avatar>` and the React ref expose the same `speakAudio` / `speakAudioStream` methods.

---

## 👗 Outfits, Scenes & Prefetch

```ts
const xc = createXiaochun({ container: '#avatar', outfit: 'xiaochun_maid', scene: 'light', persist: 'host' });
await xc.ready;

const outfits = await xc.getOutfits();   // [{ id, name }]  (the bare base model is never listed)
const scenes  = await xc.getScenes();    // [{ id: 'light' | 'dark' | 'transparent', transparent }]

await xc.setOutfit('xiaochun_cheongsam');                    // resolves when the new outfit is live
await xc.setScene('transparent');                            // wrapper background + pass-through follow automatically
xc.on('outfit-changed', (p) => console.log(p.id, p.previous));
xc.on('scene-changed', (p) => console.log(p.id));
```

* **Ids are validated** (`/^[a-z][a-z0-9_]{0,63}$/` + an own-property whitelist). A malformed id rejects locally with `[bad_request]`; a well-formed unknown id (`constructor`, `base`, ...) rejects with `[unknown_id]`. Nothing is sent for the former, and the iframe re-validates the latter on its own.
* **Concurrency**: swaps are serial and **last-wins**. A swap that is loading is never aborted; a queued swap superseded by a newer call rejects with `[busy]` (safe to ignore). Same-target requests are merged; asking for the current outfit resolves immediately. **Speech is never interrupted**: if the avatar is talking, the new outfit loads in the background and appears when ready.
* **Scenes**: only the three built-in themes. Switching at runtime syncs the wrapper background, enables/disables the pointer pass-through listeners, forces `pointer-events: auto` for opaque scenes and resets the hit cache.
* **Capability negotiation**: protocol stays v1. Against an older `/embed` (no `capabilities.outfits` / `scenes` / `prefetch` in `xc.ready`), the new methods reject with `[unsupported]` and `getOutfits()` / `getScenes()` return `[]`.
* **Preferences**: the iframe remembers the user's last outfit/scene in **its own** localStorage (`xiaochun_wearing_outfit` / `xiaochun_scene_theme`, the same keys as the main site). Priority: explicit `outfit` / `scene` (URL or SDK options) > saved > default; unknown saved ids are ignored and cleared; if storage is blocked or partitioned it silently falls back to the defaults. Third-party storage is partitioned per top-level site, so each host site has its own copy.
* **`persist`** (optional) additionally keeps them in the host page's localStorage and passes them back as explicit values, so it overrides the iframe's own copy. Default `false`.
* **`prefetch`** (off by default) downloads outfit files into the iframe's IndexedDB only (no decode/compose), serially, after EMAGE is loaded, never the wedding outfit unless you name it. `await xc.prefetch(['xiaochun_cheongsam'])` works in any mode; the automatic variant needs `heavy: 'eager'`. Skipped when the user enabled Data Saver. A later `setOutfit` then skips the network (the ~0.9 s decode/compose remains).
* **Built-in buttons**: see the next section (`ui: ['outfit', 'scene', 'lang', 'github']`, `uiAutoHide`).
* **Custom models**: `setModel({ url })` is **off by default**; pass `allowCustomModel: true` to opt in.
* **Migrating**: option `model` → `outfit`; the legacy `setModel('base')` no longer works (use `getOutfits()` for the list).

### 🔘 Built-in buttons (`ui`, `uiAutoHide`)

`ui` is an **array of part names**; nothing is shown unless you list it.

```ts
createXiaochun({ container: '#avatar', ui: ['outfit', 'scene', 'lang', 'github'] });   // parts: chat · bubble · outfit · scene · lang · github
```
```html
<xiaochun-avatar ui="outfit,scene,lang,github" ui-autohide="false"></xiaochun-avatar>     <!-- URL form: /embed?ui=outfit,scene,lang,github&uiAutoHide=false -->
```
React: `<Xiaochun ui={['outfit', 'scene']} />`. At runtime: `xc.setConfig({ ui: ['outfit'] })`.

* **When it shows (`uiAutoHide`, same as the desktop app)**: default `'transparent'` — in the **transparent** scene the buttons and chat bar start hidden and a **single click on the character** shows them (click the character again, or empty space, to hide; they also hide after 10 s idle, and stay while you hover them or a menu is open); in light / dark scenes they are always visible. `true` extends click-to-show to every scene, `false` keeps them always visible. Dragging the iframe (`draggable`) never counts as a click (≤ 6 px movement). Limits: in the transparent scene a click on blank host-page space never reaches the iframe (pass-through), so hiding relies on the 10 s timeout or clicking the character; on touch the first tap only wakes hit detection. Needs an iframe with `capabilities.ui.autoHide`; older iframes ignore it and always show.
* **Language / GitHub buttons**: `lang` opens a menu (简体中文 / English / 日本語); the choice applies immediately, is saved in the **iframe's own** localStorage (`xiaochun_embed_lang`) and fires `lang-changed` (`{ lang, previous?, initial? }`; one `initial: true` after the handshake). Only the user's own pick is saved — an explicit `lang` option and `setConfig({ lang })` are not. `github` is an `<a target="_blank" rel="noopener noreferrer">` to the project repo.
* **Same components as the main site's TopHeader**: glass buttons (44×44 on touch, 36×36 on desktop), the dropdown menu, the `Shirt` / `MountainSnow` / `Check` / `Loader2` icons and the same i18n strings (follows `lang`). Placed top-right so the character stays uncovered. The list comes from `capabilities.outfits` (no bare model, no custom URLs) and shows just the outfit names (no file sizes in the menu; `capabilities.outfits[].sizeMB` is still provided for your own UI), a spinner on the loading row and a ✓ on the worn one.
* **Same path as `setOutfit` / `setScene`**: same whitelist, same serial last-wins queue, a light "busy" hint when you click fast, and the usual `outfit-changed` / `scene-changed` events. Calls you make through the SDK keep the buttons in sync. Clicking a button never triggers the body-turn / drag gestures.
* **Transparent scene**: the buttons take part in the pass-through hit test (clicks on them do not fall through to your page; blank space still does). On touch + transparent, the first tap only wakes hit detection (it lands on your page), the second tap reaches the button.
* **Persistence**: the iframe saves button / `setOutfit` / `setScene` changes in its own localStorage and restores them on reload (explicit `outfit` / `scene` still win). To keep your own copy (e.g. across sites), listen to the events and pass the values back as explicit options:
```ts
xc.on('outfit-changed', (p) => { if (!p.initial) localStorage.setItem('my-outfit', p.id); });
xc.on('scene-changed',  (p) => { if (!p.initial) localStorage.setItem('my-scene', p.id); });
// or simply persist: 'host'
```
* **Wheel zoom** (`controls`, default on) is described in the options table above, including the "swallows page scrolling over an opaque iframe" side effect; use `controls: false` to keep the old behaviour.

## 🎨 Styling (CSS Variables & `::part`)

The host can restyle the **shell** only. The character lives in a cross-origin iframe, so your CSS cannot reach inside it.

| Variable | Default | Effect |
| :--- | :--- | :--- |
| `--xc-radius` | opaque `20px` / transparent `0` | Corner radius (any CSS length, e.g. `24px`; `50%` makes a round frame). Larger is rounder; too large clips the head and feet |
| `--xc-shadow` | `none` | `box-shadow` shorthand. Keep `none` for transparent floating avatars |
| `--xc-z-index` | `2147483000` | Floating mode only. Lower it so your modals and nav sit above the avatar |
| `--xc-offset-x` / `--xc-offset-y` | `16px` | Floating mode only: distance from the side / bottom edge |
| `--xc-bg` | `transparent` | Background behind the iframe while it loads (ignored when `transparent`) |

```css
xiaochun-avatar {
  --xc-radius: 24px;
  --xc-shadow: 0 8px 24px rgba(0, 0, 0, .18);
  --xc-offset-y: 72px;                       /* lift above a bottom nav bar */
}
xiaochun-avatar::part(iframe) { outline: 1px solid #0002; }
```

Parts: `mount` · `wrapper` · `iframe` · `placeholder`.

**No blue selection tint**: when a host-page text selection crosses the iframe (drag-select, Cmd/Ctrl+A), Chrome paints the whole iframe blue. The SDK sets `user-select: none` (inline CSSOM styles, no `<style>` injected, so host CSP is unaffected) on the shell, placeholder and iframe; your own text stays selectable and pointer-events / transparent pass-through are untouched. Don't override `user-select` on `::part(iframe)` back to `auto`.

---

## 🔌 `xiaochun://` and `xc.*`

`xiaochun://` is an **OS-level deep link** handled by the XiaoChun desktop app (Tauri). `xc.*` is the **postMessage protocol** between your page and the `/embed` iframe. They are two transports for the same actions and share one handler inside the app. The `/embed` page never responds to `xiaochun://`.

| SDK / `xc.*` | Desktop deep link |
| :--- | :--- |
| `say(text)` | `xiaochun://speak?text=…` |
| `speakAudio(url)` | `xiaochun://speak?audioUrl=…[&text=…]` |
| `speakAudio(ArrayBuffer \| Blob)`, `speakAudioStream` | — (binary data cannot fit in a URL) |
| `say(text, { mode: 'chat' })`, `motion`, `expression`, … | — |

`toProtocolUrl()` and `parseProtocolUrl()` are pure string helpers for desktop scripts or `<a href>` links; `XC_PROTOCOL_MAPPING` is the machine-readable version of the table above:

```ts
import { toProtocolUrl } from '@firetable/project-xiaochun';

toProtocolUrl({ action: 'speak', text: 'Hello' });
// → 'xiaochun://speak?text=Hello'
toProtocolUrl({ action: 'speak', audioUrl: 'https://cdn.example.com/hi.mp3', text: 'Hello' });
// → 'xiaochun://speak?text=Hello&audioUrl=https%3A%2F%2Fcdn.example.com%2Fhi.mp3'
```

Details: [`docs/PROTOCOL.md` §6](https://github.com/FireTable/project-xiaochun/blob/main/docs/PROTOCOL.md) and [`docs/EMBED.md` §2.4–2.5](https://github.com/FireTable/project-xiaochun/blob/main/docs/EMBED.md).

---

## 🔐 Permissions, CSP & Cross-Origin Isolation

### The iframe must be allowed to use the mic and audio

The SDK sets `allow="microphone; autoplay"` for you. If you write the iframe by hand you **must** add it yourself:

```html
<iframe src="https://xiaochun.firetable.tech/embed?host=https%3A%2F%2Fyour-site.com"
        allow="microphone; autoplay" loading="lazy" width="320" height="480"></iframe>
```

* `microphone`: on-device speech-to-text (`xc.mic`). Requires HTTPS.
* `autoplay`: speech audio. The host page still needs a prior user gesture (bind the first `say()` to a click).
* `host=`: your page's origin. Without it the handshake **fails closed**.

### CSP / COOP / COEP

* **Your CSP**: allow `frame-src https://xiaochun.firetable.tech` (and `script-src https://cdn.jsdelivr.net` if you use the CDN loader).
* **`/embed` response headers** (set by the XiaoChun deployment): no `X-Frame-Options`; `Content-Security-Policy: frame-ancestors *` by default (self-hosters can restrict it); `Permissions-Policy: microphone=(self)`; `Cross-Origin-Resource-Policy: cross-origin`.
* **Your COOP/COEP**: an embedding page with `COEP: require-corp` works (the embed sends CORP). Cross-origin-isolating the iframe itself needs both the host page isolated *and* `allow="cross-origin-isolated"` (the opt-in `crossOriginIsolated` option below); otherwise on-device ONNX runs single-threaded (slower but functional).
* **Third-party storage partitioning**: models cached inside the iframe are keyed per top-level site, so each host site downloads its own copy. The embed therefore does **not** preload the on-device LLM / EMAGE models by default (`heavy: 'lazy'`).
* **Security**: messages travel over a `MessageChannel` after an origin-checked handshake; `'*'` is never used as a target origin; wildcard `origin` / `allowedOrigins` are rejected.


### Opt-in: cross-origin isolation (multi-threaded EMAGE)

By default `crossOriginIsolated` is `false` inside the iframe and onnxruntime-web runs **single-threaded** wasm. For multi-threading (`SharedArrayBuffer`) all three must hold:

1. **Your page is cross-origin isolated** — it is served with `Cross-Origin-Opener-Policy: same-origin` **and** `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`). `window.crossOriginIsolated` is `true` on your page.
2. **The embed document sets COEP too** — `/embed` already sends `COEP: credentialless` + `CORP: cross-origin`. Nothing to do. (COOP is ignored inside an iframe.)
3. **You delegate it to the iframe** — cross-origin iframes do not inherit it. Turn the option on (default off; default `allow` stays `'microphone; autoplay'`):

```js
createXiaochun({ container: '#stage', crossOriginIsolated: true });  // allow="microphone; autoplay; cross-origin-isolated"
```
```tsx
<Xiaochun crossOriginIsolated />                                    // React
```
```html
<xiaochun-avatar cross-origin-isolated></xiaochun-avatar>
<!-- hand-written iframe: allow="microphone; autoplay; cross-origin-isolated" -->
```

```nginx
add_header Cross-Origin-Opener-Policy  "same-origin" always;
add_header Cross-Origin-Embedder-Policy "credentialless" always;  # or require-corp
```

**Benefit**: EMAGE inference uses up to `min(hardwareConcurrency, 8 desktop / 4 mobile)` threads. Measured in Node on the same inference: **1 thread 274 ms → 4 threads 79 ms (~3.5×)**.

**Side effects (the isolation is on *your* page)**:

* Every cross-origin subresource on your page must satisfy COEP. With `credentialless`, no-cors cross-origin requests are sent *without* cookies/credentials (credentialed third-party images/scripts may break); with `require-corp` they need `CORP: cross-origin` or CORS or they are blocked.
* Other third-party **iframes** on your page (ads, maps, video, payments, comments…) must send COEP themselves or they are blocked. `COOP: same-origin` also severs `window.opener` (OAuth / payment popups that report back may stop working).
* Safari has no `credentialless`; use `require-corp` there. On browsers without isolation support the option is a harmless no-op (single-threaded fallback).
* Enabling the option on a non-isolated host does nothing. Verify on staging first.

**Verify**: the `xc.ready` handshake carries `capabilities.crossOriginIsolated` (should be `true`); or run `crossOriginIsolated` in the iframe's console context; the EMAGE worker reports `numThreads > 1`. Locally: `node examples/serve-isolated.mjs`, then open `http://localhost:8081/examples/embed-host.html?isolated=1`.

---

## ⚡ Lighthouse-Friendly Usage

```ts
createXiaochun({
  container: '#avatar',
  width: 320, height: 480,   // fixed box → no layout shift
  placeholder: '/xc.webp',   // an <img> is all that ships at first paint
  lazy: true,                // iframe is created when visible AND idle ('click' is the cheapest)
  lazyMargin: 200,           // px; larger = loads earlier but uses more data
  heavy: 'lazy',             // no WebLLM / EMAGE until the first interaction
  autoPause: true,           // pause rendering when scrolled out of view
});
```

---

## 📚 API

### `createXiaochun(options): XiaochunInstance`

| Option | Default | Description |
| :--- | :--- | :--- |
| `container` | — | Element or selector (required) |
| `src` | `https://xiaochun.firetable.tech/embed` | Embed page URL (override for self-hosting or local dev) |
| `origin` | derived from `src` | Expected iframe origin; every message is checked against it |
| `allowedOrigins` | `[]` | Extra trusted iframe origins. `'*'` is rejected |
| `lazy` | `true` | `true` / `'idle'`: visible and idle · `'click'`: on click or first API call · `false`: immediately |
| `lazyMargin` | `200` | rootMargin in px for the visibility trigger. Larger loads earlier and uses more data |
| `placeholder` | built-in SVG | Image URL, element, or `false` |
| `transparent` | `false` | Transparent background over your page (with pointer pass-through). Same as `scene: 'transparent'` |
| `scene` | — | Initial scene: `'light' \| 'dark' \| 'transparent'` (see `getScenes()`). Unknown id → ignored + `error { code: 'unknown_id' }` |
| `width`, `height` | `600`, `1080` | px or any CSS length. **Defaults are clamped to the viewport**: width = `min(600px, 100vw)` (and the shell has `max-width: 100%`, so it never overflows a narrow container), height = `min(1080px, 100svh)` (floating `position`s also subtract the `--xc-offset-x/y` margins so the box never sticks out of the screen). Explicit values are used as-is. Runtime: `setSize(w, h)` (`undefined` = back to the default) |
| `position` | `'inline'` | `'inline' \| 'bottom-right' \| 'bottom-left'` |
| `draggable` | `false` | Gesture drag: press and drag the character (not a built-in button) to move the iframe, clamped to the viewport. Works in inline and floating modes. See [Gestures](#gestures-drag-and-corner-resize) |
| `borderRadius` | opaque `20px` / transparent `0` | Shell corner radius (number = px, or any CSS length). The default for light / dark scenes equals the desktop app's window radius (20 px); transparent scenes are not clipped. Live via `setBorderRadius()`; the `--xc-radius` CSS variable wins; `0` = square corners |
| `resizable` | `false` | Drag a corner (same 40 px hot zone / cursors / arcs as the desktop app) to resize the iframe at runtime, **without rebuilding it**. `true` or `{ minWidth, minHeight, maxWidth, maxHeight }` (default min 120×180, max = viewport) |
| `lang` | auto | `'zh-CN' \| 'en' \| 'ja'`. Priority: this option > the language the user last picked in the built-in language button (saved in the iframe's own localStorage `xiaochun_embed_lang`) > browser language > `zh-CN`. `setConfig({ lang })` at runtime is not persisted. Changes fire `lang-changed` |
| `outfit` | default outfit | Initial outfit id (e.g. `xiaochun_maid`, see `getOutfits()`). Unknown id → default outfit + `error { code: 'unknown_id' }` |
| `model` | — | **Deprecated**, use `outfit` (a `console.warn` is printed). An https URL is no longer accepted here; see `allowCustomModel` |
| `allowCustomModel` | `false` | Opt in to `setModel({ url })` for arbitrary https `.vrm` / `.vrmaddon` / `.vrmbase`. Third-party files are parsed inside the iframe, so enable it only for URLs you trust |
| `camera` | — | Camera framing `{ fov, distance, height, intro }`: `fov` 15–60° (default 30; distance auto-compensates so the character keeps its size), `distance` 1–15 m (default ≈2.5; overrides the iframe's saved zoom/pitch on first fit), `height` ±1 m framing offset (not saved by the iframe), `intro: false` skips the dolly-in. Out-of-range values are clamped; there is no `pitch` (the camera only tilts up/down around the character, left/right is the character's body turn). Sent as `?cameraFov=` etc. at create time; at runtime use `setConfig({ camera })` (omitted key = unchanged, `null` = back to default; re-frames immediately and cancels a running dolly-in). Old `/embed` (no `capabilities.camera`) ignores it. Priority: explicit > the iframe's saved view > default. |
| `persistBox` | `false` | Remember the iframe's position & size after drag / resize in **your page's** localStorage and restore it on the next create: `true` (key `xiaochun:box`) or a namespace string (`xiaochun:box:<name>`). Needs `draggable` / `resizable`. Priority: explicit `width` / `height` > saved > default; restore is clamped to the current viewport. `clearPersistedBox({ reset? })` clears it. See [Gestures](#gestures-drag-and-corner-resize) |
| `persist` | `false` | Optionally also remember outfit + scene in **the host page's** localStorage (the iframe already keeps its own copy): `false` \| `'host'` (`xiaochun:prefs`) \| a custom key. Explicit `outfit` / `scene` options win over saved values; the saved copy wins over the iframe's own |
| `prefetch` | `false` | `true` (all outfits except the 13.9 MB wedding) or `string[]`. Auto-sent once after the first load, **only with `heavy: 'eager'`**; otherwise call `prefetch()` yourself |
| `ui` | `[]` | Built-in UI parts to show inside the iframe: an array of `'chat'` (chat bar) · `'bubble'` (speech bubble) · `'outfit'` (outfit button) · `'scene'` (scene button) · `'lang'` (language switcher) · `'github'` (GitHub link, opens in a new tab). Unset / empty = none. Unknown names are ignored with a `console.warn`. See "Built-in buttons" below |
| `uiAutoHide` | `'transparent'` | When the built-in UI is visible, **same as the desktop app**: `'transparent'` = only the transparent (desk-pet) scene hides it until you click the character; light / dark scenes always show it. `true` = click-to-show in every scene; `false` = always visible (the previous behaviour). Live via `setConfig({ uiAutoHide })` |
| `heavy` | `'lazy'` | `'lazy'`: load WebLLM / EMAGE on first use · `'eager'`: preload |
| `controls` | `true` | Wheel zoom inside the iframe, on by default like the main site. Transparent scene: zooms only while the pointer is on the character, everywhere else the wheel scrolls your page. Opaque scenes: the iframe fills its area, so the wheel zooms there and **swallows page scrolling over that area**. `false` locks it (`?controls=0`) |
| `autoPause` | `true` | Pause when out of the viewport |
| `passthrough` | = `transparent` | Toggle the iframe's pointer-events depending on whether the cursor is over the character |
| `sandbox` | scripts + same-origin + popups | iframe `sandbox`; `false` = none. Dropping `allow-same-origin` breaks IndexedDB and the mic |
| `handshakeTimeout` | `20000` | ms; on timeout an `error { code: 'timeout' }` is emitted |
| `crossOriginIsolated` | `false` | Append `cross-origin-isolated` to the iframe `allow` (default stays `microphone; autoplay`). Needs a host page that is itself isolated; see [Opt-in: cross-origin isolation](#opt-in-cross-origin-isolation-multi-threaded-emage) |
| `zIndex` | `2147483000` | Floating mode layer (the `--xc-z-index` variable takes precedence) |

**Instance**: `ready` · `say(text, { mode: 'speak' \| 'chat' })` · `speakAudio(source, opts)` · `speakAudioStream(opts)` · `motion(nameOrUrlOrOptions)` · `expression(name)` · `setOutfit(id)` · `setScene(id)` · `getOutfits()` · `getScenes()` · `prefetch(ids?)` · `outfit` / `scene` (getters) · `setModel(outfitOrUrl)` *(legacy)* · `setConfig(cfg)` · `setSize(w, h)` · `getBox()` · `setDraggable(on)` · `setResizable(on | limits)` · `startListening()` / `stopListening()` / `mic(on)` · `pause()` / `resume()` · `activate()` · `destroy()` · `on(event, cb)` · `lookAt()` *(reserved in the protocol; currently returns `unsupported`)*.

**Events**: `handshake` · `ready` · `progress` · `state` · `stt` · `utterance` (`phase: 'start' | 'end'`, `kind: 'text' | 'audio'`) · `hit-region` · `outfit-changed` · `scene-changed` · `lang-changed` (`{ lang, previous?, initial? }`) · `move` / `resize` (`{ phase: 'start' | 'move' | 'end', left, top, width, height }`) · `error` (now also `busy`, `unknown_id`; one `unsupported` if gestures are enabled on an old iframe) · `destroy`. `progress.phase` is `'model' | 'outfit' | 'prefetch'`.

### `<xiaochun-avatar>`

| Attribute | Default | Description |
| :--- | :--- | :--- |
| `src` | official `/embed` | Changing it rebuilds the iframe |
| `outfit` | — | Outfit id; changing it at runtime = `setOutfit` (**live update, no iframe rebuild**) |
| `scene` | — | `light` · `dark` · `transparent`; runtime change = `setScene` (live) |
| `model` | — | **Deprecated** alias of `outfit` (`outfit` wins) |
| `camera-fov` / `camera-distance` / `camera-height` / `camera-intro` | — | Same as `camera` (hot-updated via `setConfig({ camera })`, no rebuild; removing an attribute = default) |
| `persist` / `persist-box` / `prefetch` / `allow-custom-model` | — | Same as the options (`persist-box=""` = default key, any other string = namespace); changing them rebuilds |
| `lang` | auto | `zh-CN` · `en` · `ja`; unset = the user's saved pick > browser language > `zh-CN`; runtime change = `setConfig` (not persisted) |
| `mic` | `false` | Toggle dictation (takes effect once the model is loaded) |
| `transparent` | `true` | `"false"` turns it off |
| `draggable` | `false` | Gesture drag (inline and floating). Runtime change = `setDraggable` (live) |
| `resizable` | `false` | Corner drag resize; runtime change = `setResizable` (live) |
| `border-radius` | opaque `20px` / transparent `0` | Shell corner radius (number = px or CSS length); runtime change = `setBorderRadius` (live) |
| `min-size` / `max-size` | — | Resize limits, same format as `size` (e.g. `min-size="160x240"`) |
| `position` | `inline` | `inline` · `bottom-right` · `bottom-left` |
| `size` | `600x1080` (viewport-clamped) | `"280"` (height = width × 1.5), `"320x480"`, `"100%x480px"`; runtime change = `setSize` (**live, no iframe rebuild**) |
| `lazy` | idle + viewport | `"click"` for click only; `"false"` for immediate |
| `paused` | `false` | `pause()` / `resume()` |
| `ui` | — | Comma-separated parts, e.g. `ui="outfit,scene,lang,github"` (unset = none; unknown names ignored with a warn). Changing it rebuilds; use `setConfig({ ui })` at runtime |
| `ui-autohide` | `transparent` | `"transparent"` (default; click-to-show only in the transparent scene) · `"true"` (every scene) · `"false"` (always visible). Changing it rebuilds; use `setConfig({ uiAutoHide })` at runtime |
| `controls` | on | `controls="false"` locks wheel zoom inside the iframe |
| `placeholder` / `heavy` / `allowed-origins` | — | Same as `createXiaochun` |
| `cross-origin-isolated` | `false` | Same as `createXiaochun({ crossOriginIsolated })`; changing it rebuilds the iframe |

**Events** (`CustomEvent`, `composed`, `detail` = protocol payload): `xc-ready` · `xc-progress` · `xc-state` · `xc-stt` · `xc-utterance` · `xc-outfit-changed` · `xc-scene-changed` · `xc-lang-changed` · `xc-move` · `xc-resize` · `xc-error`.
**Methods**: `say` · `speakAudio` · `speakAudioStream` · `motion` · `expression` · `setOutfit` · `setScene` · `getOutfits` · `getScenes` · `prefetch` · `destroy`; `el.client` gives you the full SDK instance.

---

### Gestures (drag and corner resize)

The iframe can behave like the desktop app: **press and drag the character to move it, drag a corner to resize it**. Both are **off by default** and negotiated per instance, so an iframe whose host did not opt in does not recognise gestures, does not intercept pointer events, and draws no corner arcs.

```ts
const xc = createXiaochun({
  container: '#avatar', width: 320, height: 480,
  draggable: true,                       // move: drag the character
  resizable: { minWidth: 160, minHeight: 240, maxWidth: 640, maxHeight: 960 }, // or just `true` (min 120×180, max = viewport)
});
xc.on('move',   (b) => console.log(b.phase, b.left, b.top));
xc.on('resize', (b) => console.log(b.phase, b.width, b.height));
xc.setResizable(false);                  // runtime switches, no iframe rebuild
xc.setSize(240, 360);                    // programmatic resize (also live)
```

* Recognition reuses the app's shared gesture state machine (`src/core/gesture/`); the iframe only posts `xc.gesture-move` / `xc.gesture-resize` increments (`gesture`, `seq`, `phase: start | move | end`, `dx/dy`, cumulative `totalDx/totalDy`, `corner` for resize). **The host SDK executes them**: it checks the origin/port, rejects forged, replayed or out-of-order messages, and clamps to the min/max size and the viewport (inline mode moves with a CSS `translate`; floating mode moves `left/top`).
* Resizing is runtime state: `width` / `height` / `size` / `draggable` / `resizable` changes never rebuild the iframe (the model, animation and chat state survive).
* Transparent scene + pass-through: only the character and (when `resizable`) the four 40 px corner zones take over the pointer; everywhere else still falls through to your page. Built-in buttons are never a drag / resize start.
* The blue text-selection box during a drag is suppressed on both sides (`user-select: none`, `selectstart` / `dragstart` blocked, pointer capture while resizing).
* Against an older `/embed` without `capabilities.gestures`, enabling inline `draggable` or `resizable` emits one `error { code: 'unsupported', command: 'gestures' }`.
* **Remember position & size (`persistBox`, off by default)**: with `draggable` / `resizable` on, `persistBox: true` (or a namespace string → key `xiaochun:box:<name>`) saves the box to **your page's** localStorage when a drag / resize **ends** (all reads / writes are try/catch'd — private mode or a full quota just means "not remembered") and restores it the next time the instance is created. Priority: explicit `width` / `height` > saved > default (600×1080); position has no explicit option (`position` is only an anchor preset), so a saved position always wins. **To get a user-resized size back, don't pass `width` / `height`.** Restoring is clamped to the *current* viewport (size within `[min, viewport]`, min 120×180 or your `resizable` limits; floating boxes pulled fully on-screen; inline boxes clamped horizontally and kept below the document top). A saved box whose `position` mode differs from the current one, or corrupt data, is ignored and removed. Only restored when a gesture is enabled. `xc.clearPersistedBox()` removes the saved value; `xc.clearPersistedBox({ reset: true })` also puts the box back to its initial place / size. Element: `persist-box` (`""` / `"true"` / a namespace), React: `persistBox` prop + `ref.clearPersistedBox()`.
* Try it: `examples/embed-host.html?draggable=1&resizable=1&persistBox=1`.

## 🧪 Try It Locally

Open [`examples/embed-host.html`](./examples/embed-host.html); the header comment lists the steps. To point it at a local XiaoChun dev server, pass `src: 'https://localhost:5185/embed'`.

---

## 🏷️ Versioning & Release

The package version is **locked to the XiaoChun desktop app**: one `pnpm bump:patch|minor|major` and one `v*` git tag trigger both the desktop release and the npm publish, in parallel and independently.

npm releases are published from GitHub Actions with **npm Trusted Publishing (OIDC)**: no long-lived `NPM_TOKEN`, and provenance is generated automatically. Maintainer setup (first manual publish, binding the Trusted Publisher, staged publishing) is covered in [`docs/EMBED.md` §6](https://github.com/FireTable/project-xiaochun/blob/main/docs/EMBED.md).

---

## 📚 More Documentation

* [`docs/EMBED.md`](https://github.com/FireTable/project-xiaochun/blob/main/docs/EMBED.md): full embed design, protocol tables, response headers, risks, publishing
* [`docs/PROTOCOL.md`](https://github.com/FireTable/project-xiaochun/blob/main/docs/PROTOCOL.md): the `xiaochun://` URL scheme and its mapping to `xc.*`
* [`docs/README.md`](https://github.com/FireTable/project-xiaochun/blob/main/docs/README.md): documentation index
* [Project README](https://github.com/FireTable/project-xiaochun#readme): the main project

---

## 📄 License

[MIT](./LICENSE)
