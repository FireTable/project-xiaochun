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

* **Props**: every `createXiaochun` option except `container`, plus `onHandshake / onReady / onProgress / onState / onStt / onUtterance / onHitRegion / onError / onDestroy`, `className`, `style`, `paused`, and `mic`.
* **Rebuild vs. live update**: creation-time options (`src`, `lazy`, `transparent`, `width`, `height`, `position`, …) rebuild the instance when they change, so avoid passing fresh values on every render. `lang`, `model`, `paused`, `mic` and the callbacks update in place without recreating the iframe.
* **Ref methods**: `say`, `speakAudio`, `speakAudioStream`, `motion`, `expression`, `lookAt`, `setModel`, `setConfig`, `startListening`, `stopListening`, `mic`, `pause`, `resume`, `activate`, `destroy`, plus `ready` and `instance`. Methods that return a Promise reject until the component is mounted.

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

## 🎨 Styling (CSS Variables & `::part`)

The host can restyle the **shell** only. The character lives in a cross-origin iframe, so your CSS cannot reach inside it.

| Variable | Default | Effect |
| :--- | :--- | :--- |
| `--xc-radius` | `0` | Corner radius (any CSS length, e.g. `24px`; `50%` makes a round frame). Larger is rounder; too large clips the head and feet |
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
* **Your COOP/COEP**: an embedding page with `COEP: require-corp` works (the embed sends CORP). Cross-origin-isolating the iframe itself needs both the host page isolated *and* `allow="cross-origin-isolated"`; otherwise on-device ONNX runs single-threaded (slower but functional).
* **Third-party storage partitioning**: models cached inside the iframe are keyed per top-level site, so each host site downloads its own copy. The embed therefore does **not** preload the on-device LLM / EMAGE models by default (`heavy: 'lazy'`).
* **Security**: messages travel over a `MessageChannel` after an origin-checked handshake; `'*'` is never used as a target origin; wildcard `origin` / `allowedOrigins` are rejected.

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
| `transparent` | `false` | Transparent background over your page (with pointer pass-through) |
| `width`, `height` | `320`, `480` | px or any CSS length. Always set them |
| `position` | `'inline'` | `'inline' \| 'bottom-right' \| 'bottom-left'` |
| `draggable` | `false` | Drag handle in floating mode |
| `lang`, `model` | — | `'zh-CN' \| 'en' \| 'ja'`; outfit key (e.g. `xiaochun_maid`) or an https `.vrm` URL |
| `ui` | `false` | Show the embed's built-in chat bar |
| `heavy` | `'lazy'` | `'lazy'`: load WebLLM / EMAGE on first use · `'eager'`: preload |
| `controls` | `false` | Allow wheel-zoom inside the iframe (swallows page scrolling) |
| `autoPause` | `true` | Pause when out of the viewport |
| `passthrough` | = `transparent` | Toggle the iframe's pointer-events depending on whether the cursor is over the character |
| `sandbox` | scripts + same-origin + popups | iframe `sandbox`; `false` = none. Dropping `allow-same-origin` breaks IndexedDB and the mic |
| `handshakeTimeout` | `20000` | ms; on timeout an `error { code: 'timeout' }` is emitted |
| `zIndex` | `2147483000` | Floating mode layer (the `--xc-z-index` variable takes precedence) |

**Instance**: `ready` · `say(text, { mode: 'speak' \| 'chat' })` · `speakAudio(source, opts)` · `speakAudioStream(opts)` · `motion(nameOrUrlOrOptions)` · `expression(name)` · `setModel(outfitOrUrl)` · `setConfig(cfg)` · `startListening()` / `stopListening()` / `mic(on)` · `pause()` / `resume()` · `activate()` · `destroy()` · `on(event, cb)` · `lookAt()` *(reserved in the protocol; currently returns `unsupported`)*.

**Events**: `handshake` · `ready` · `progress` · `state` · `stt` · `utterance` (`phase: 'start' | 'end'`, `kind: 'text' | 'audio'`) · `hit-region` · `error` · `destroy`.

### `<xiaochun-avatar>`

| Attribute | Default | Description |
| :--- | :--- | :--- |
| `src` | official `/embed` | Changing it rebuilds the iframe |
| `model` | — | Outfit key or https `.vrm` / `.vrmaddon` / `.vrmbase` URL; changing it at runtime = `setModel` |
| `lang` | — | `zh-CN` · `en` · `ja`; runtime change = `setConfig` |
| `mic` | `false` | Toggle dictation (takes effect once the model is loaded) |
| `transparent` | `true` | `"false"` turns it off |
| `draggable` | `false` | Floating mode only |
| `position` | `inline` | `inline` · `bottom-right` · `bottom-left` |
| `size` | `320x480` | `"280"` (height = width × 1.5), `"320x480"`, `"100%x480px"` |
| `lazy` | idle + viewport | `"click"` for click only; `"false"` for immediate |
| `paused` | `false` | `pause()` / `resume()` |
| `placeholder` / `heavy` / `ui` / `controls` / `allowed-origins` | — | Same as `createXiaochun` |

**Events** (`CustomEvent`, `composed`, `detail` = protocol payload): `xc-ready` · `xc-progress` · `xc-state` · `xc-stt` · `xc-utterance` · `xc-error`.
**Methods**: `say` · `speakAudio` · `speakAudioStream` · `motion` · `expression` · `destroy`; `el.client` gives you the full SDK instance.

---

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
