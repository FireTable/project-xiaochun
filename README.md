<p align="center">
  <img src="public/logo.png" width="96" height="96" alt="Project XiaoChun Icon" style="border-radius: 16px;" />
</p>

<h1 align="center">Project XiaoChun</h1>

<p align="center">
  <b>A 100% browser-native anime companion — local LLM + EMAGE motion + Edge-TTS, zero backend</b>
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README-CN.md">简体中文</a>
</p>

---

> [!IMPORTANT]
> **Notice**: This repository is a **browser-native AI companion research prototype**. It explores 100% client-side AI stacks (WebLLM / WebGPU / ONNX Runtime Web) and Cloudflare Workers edge TTS. **It is not recommended for direct commercial production deployment.**

---

## 📖 Overview

**Project XiaoChun (小蠢)** is a fully browser-native anime companion. The character renders through `@pixiv/three-vrm` with MToon NPR shading inside an immersive linework outdoor scene; all AI inference runs in your browser tab — no Python backend, no server GPUs.

Entry is a 2D MAD preload into 3D. You talk to her. She thinks (WebLLM Qwen3.5 2B q4f16_1 on WebGPU, falls back to 0.8B; thinking optional), speaks (Edge-TTS over a Cloudflare Workers WebSocket), and moves with her (EMAGE ONNX in a Dedicated Web Worker). If the model is not ready yet, typed messages queue instead of getting dropped. The chat-bar menu can switch models from WebLLM's prebuilt list.

The UI is fully **SSR-hydrated multi-language** (zh-CN / en / ja) via TanStack Start + i18next, and is mobile-first responsive (iOS HIG 44 pt / Material 48 dp touch targets).

---

## 🖼️ Preview

<p align="center">
  <img src="screenshots/preview-mad.jpg" width="100%" alt="XiaoChun MAD dynamic preloader" /><br/>
  <i>Entry: 2D MAD card, then a dimension-break into the 3D stage</i>
</p>

<p align="center">
  <img src="screenshots/preview-3d.jpg" width="100%" alt="XiaoChun chatting in the linework outdoor scene" /><br/>
  <i>3D stage: MToon NPR character, linework city, head bubble, and chat bar</i>
</p>

---

## ✨ Key Features

### 🎭 VRM Character & Scene
* **VRM 1.0 rendering** via `@pixiv/three-vrm` with MToon NPR shading, soft Japanese-anime lighting, and **6 independent light channels** (dir / hemi / front / fill / leg / arm) with live tuning.
* **Linework outdoor scene**: procedural sun, 19 wireframe buildings (5 archetypes), 5 stylized trees (conifer / fan / layered / cypress / vertical-oval), and a wireframe ground — 100% white-on-white, no textures.
* **Companion gaze system**: level head + micro-saccades + additive look-at tracking; pitch follows the camera.
* **Motion blending**: idle / thinking VRMA / EMAGE slerp from the live pose; looping clips do not auto-fade, so bind pose never flashes.
* **Material saturation**: clothing / hair / eyes / skin are independently tunable; presets live in `src/config.ts`.
* **Upload your own VRM** at runtime via the top-bar upload button.

### 🧠 100% Browser-Side AI Stack
* **LLM** — [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm) default **Qwen3.5 2B (q4f16_1)** on WebGPU, fallback 0.8B. The chat-bar menu switches models from `prebuiltAppConfig` (grouped by provider) and has a thinking switch; replies follow the language of the current user message.
* **Motion** — **EMAGE** full-body motion (ONNX Runtime Web) in a Dedicated Web Worker, with temporal Gaussian smoothing and natural idle blends.
* **TTS** — **Edge-TTS 晓伊 (XiaoyiNeural, zh-CN, +10 Hz)** via [`edge-tts-universal`](https://github.com/Sterznode/edge-tts-universal); emoji stripped before speech.
* **LLM + TTS + EMAGE orchestrated** by the chat director on the main thread at 60 FPS.

### ⚡ Streaming Speech & Adaptive Gesture Pipeline
* **Smart Speech Chunking**: Eliminates long-text generation wait bottlenecks by segmenting speech into natural 30~60 character clauses split at semantic punctuation (`.!?\n` or natural comma pauses).
* **Zero-Latency Concurrent TTS Prefetching**: Downloads audio for all chunks concurrently via non-blocking network I/O, flattening TTS latency to 0ms.
* **Dual-Condition Pre-buffering**: Balances chunk ratio ($\lceil N / 3 \rceil$) with an upper-bound cap (max 2 chunks, ~8~12s of audio). 1~2 segments start almost instantly; long paragraphs begin playback as soon as 2 chunks are ready while subsequent motions stream in the background.
* **Continuous Latent Autoregressive Seed Carryover**: The Dedicated Web Worker retains the 4-frame latent seed (`continueFromPrevious`) across chunks, making multi-chunk generation mathematically identical to a single long-run autoregressive inference.
* **Physiological Angular Velocity Limiting Transition**: Replaces arbitrary timer-based blend timers with human biomechanical angular velocity limits (arms 2.2 rad/s, neck/head 1.6 rad/s, torso 1.2 rad/s) and critical spring damping for time-free, snap-free transitions.
* **Adaptive Conversational Idle (`SpeakIdleSystem`)**: Characters adaptively respond to the current gesture during inter-segment pauses — high gestures hover with breathing buoyancy and gentle micro-settling (>1.5s); fingers flex along the anatomical Z-axis; awareness gaze drifts and micro-nods eliminate frozen mannequins.
* **Live Pipeline Console Table Tracker**: Real-time `console.table` monitors chunk TTS, EMAGE inference, playback progression, and transition modes.
* **Head Bubble Progress Indicator**: A pulsing progress pill (`🟢 1 / 5`) in the bubble status bar cleanly displays segment progress without intruding on dialogue text.

### 💾 Client-Side Multi-Tier Memory System
* **100% Local Privacy (IndexedDB)**: Powered by browser-native IndexedDB (`xiaochun-memory` database). Dialogue turns, personal preferences, and recalled facts stay entirely on the client device — zero telemetry or chat logs sent to any server.
* **3-Tier Memory Architecture**:
  * **Short-Term Turns**: Automatically buffers the most recent conversational rounds (default 6 turns, clipped to 180 chars per turn via `APP_CONFIG.memory.shortTermTurns`), maintaining dialogue coherence.
  * **Entity Profile Extraction**: Multilingual (zh / en / ja) regex smart extraction captures user names/nicknames (e.g., "my name is...", "call me...", "我叫...", "叫我...", "私は..."), likes, dislikes, and entity facts with deduplication.
  * **Long-Term Notes & n-gram Retrieval**: Archives conversational summaries (up to 80 notes); retrieves the most contextually relevant Top-K (default 4) past memories using an n-gram similarity scoring algorithm (`gramScore`).
* **Non-blocking Async Persistence & Dynamic Injection**:
  * **Async Commit**: Executes `rememberTurn()` in the background upon turn completion, never stuttering UI animations or audio playback.
  * **Contextual Prompt Injection**: `recallForChat()` swiftly retrieves entities and relevant notes, injecting localized memory headers (`appendMemoryToSystem`) directly into the LLM system prompt so XiaoChun naturally remembers your identity and prior topics while prioritizing current chatter.

### 🌐 i18n & SSR
* **TanStack Start** full-stack SSR with cookie-based language hydration — no client-side language flash.
* **3 languages shipped**: 简体中文 / English / 日本語.
* **System prompt** — XiaoChun is a companion; she replies in the language of this user message, not the UI language.
* **shadcn-style dropdown** in the top-right for language switching (Radix UI primitive).

### 📱 Mobile-First UI
* **iOS HIG 44 pt / Material 48 dp** touch targets throughout.
* **Bottom chat input ≥ 40 px** with 16 px text (prevents iOS Safari auto-zoom on focus).
* **Tw + tailwindcss-animate** micro-interactions; liquid-glass aesthetic.
* **Top-right action bar** — upload VRM, language, GitHub; the debug drawer only appears on localhost.
* **Chat bar** — queue-while-loading, model/thinking menu, send.
* **Floating speech bubble** writes `transform` on the DOM with a deadzone, so React does not re-render at 60 FPS.
* **Mobile** — preload stickers stay; the chat bar clears the home-indicator inset.

### 🛠️ Dev Tooling
* **Debug drawer** (localhost only) — expressions, 6 light channels, FOV, global light, material saturation presets.
* **Cloudflare Workers** (`src/server.ts`) — handles full-stack TanStack Start SSR alongside native WebSocket streaming for Edge-TTS.
* **Vite dev middleware** (`vite.config.ts → localApiPlugin`) — local development powered by Miniflare runtime for 100% dev/prod parity.
* **Single source of truth**: `src/config.ts` consolidates lighting / camera / expressions / saturation / LLM / R2 model config.

---

## 🛠️ Tech Stack

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **3D Engine** | [three.js 0.185](https://threejs.org) + [@pixiv/three-vrm 3.5](https://github.com/pixiv/three-vrm) | MToon NPR shading, OrbitControls |
| **App Framework** | [React 19](https://react.dev) + [TanStack Start](https://tanstack.com/start) | Full-stack SSR with cookie-based i18n hydration |
| **Router** | [TanStack Router](https://tanstack.com/router) | Type-safe file-based routing |
| **LLM** | [WebLLM](https://github.com/mlc-ai/web-llm) | Qwen3.5 2B q4f16_1 on WebGPU (fallback 0.8B), streaming |
| **Memory** | IndexedDB + Custom 3-Tier Pipeline | 100% client-side multi-tier persistence, entity extraction & n-gram note retrieval |
| **Motion** | EMAGE + [ONNX Runtime Web](https://onnxruntime.ai) | Full-body generation in Dedicated Web Worker |
| **TTS** | [edge-tts-universal](https://github.com/Sterznode/edge-tts-universal) | XiaoyiNeural zh-CN +10 Hz, emoji-stripped text |
| **Edge Runtime** | [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [@cloudflare/vite-plugin](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/) | SSR streaming + WebSocket Edge-TTS + Static Assets |
| **Object Storage** | [Cloudflare R2](https://developers.cloudflare.com/r2/) | 504 MB ONNX body models hosted with zero egress fees |
| **Styling** | [Tailwind CSS 4](https://tailwindcss.com) + `tailwindcss-animate` | `liquid-glass` aesthetic, mobile-first |
| **i18n** | [i18next](https://www.i18next.com) + [react-i18next](https://react.i18next.com) | 3 languages, SSR-hydrated |
| **UI Primitives** | [Radix UI](https://www.radix-ui.com) (Dropdown Menu, Slot) | shadcn-style components |
| **Language** | [TypeScript 6](https://www.typescriptlang.org) | Strict typing end-to-end |
| **Build** | [Vite 8](https://vite.dev) + `@cloudflare/vite-plugin` | Automated artifact slimming for lean edge bundles |

---

## 🚀 Quick Start & Deployment

Requirements: **Node.js 18+**, package manager: **pnpm** (enforced via `preinstall` hook).

### Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Start dev server (SSR + Miniflare local edge runtime)
pnpm dev          # → http://localhost:5185

# 3. Production build & preview
pnpm build        # outputs dist/client & dist/server (Worker)
pnpm preview      # preview production Worker behavior locally
```

---

### ☁️ Cloudflare Workers Deployment

This project uses **Cloudflare's modern Workers + Static Assets architecture** (replacing legacy Pages) for lightning-fast SSR hydration and duplex WebSocket TTS streaming.

#### Option A: One-command CLI Deploy (Recommended)
```bash
# Builds production bundle and deploys directly to Cloudflare edge
pnpm deploy
# Equivalent to: pnpm build && wrangler deploy
```
*If not logged in, Wrangler will automatically open your browser for OAuth authentication. Once deployed, attach your custom domain (e.g. `xiaochun.firetable.tech`) under Worker -> Domains & Routes.*

#### Option B: GitHub CI Deployment (Workers Builds)
To deploy automatically on every `git push`:
1. Log in to Cloudflare Dashboard -> navigate to **Workers & Pages** -> **Create Application** -> **Workers** tab;
2. Select **Connect to Git** and connect this repository;
3. **Build settings (⚠️ Critical)**:
   * **Root directory**: **Leave completely blank (do NOT enter `/`)** — entering `/` points the runner to the Linux root filesystem and causes builds to hang;
   * **Build command**: `pnpm build`
   * **Deploy command**: `npx wrangler deploy`
4. Pushing new commits to `main` will now trigger automatic build and deployment.

---

## 📁 Project Structure

```text
Project-XiaoChun/
├── public/                    # Static assets (hosted via Cloudflare Workers Assets)
│   ├── xiaochun_v1.vrm        # Default VRM character model (18 MB)
│   ├── thinking.vrma          # Idle thinking animation loop
│   ├── _headers               # Cache-Control and security headers
│   ├── robots.txt / sitemap.* # Search engine crawler contracts
│   ├── llms.txt / llms-full.* # AI agent documentation specs
│   └── logo.png / favicon.*   # Brand and icon assets
├── wrangler.jsonc             # Cloudflare Workers declarative configuration
├── src/
│   ├── routes/                # TanStack Start file-based routes
│   │   ├── __root.tsx         # Root layout (i18n SSR hydration & meta tags)
│   │   └── index.tsx          # Main index route
│   ├── components/            # React UI components (TopHeader, ChatBar, HeadBubble, DevDrawer…)
│   │   └── ui/                # Radix UI primitives (button, dropdown-menu, tooltip)
│   ├── core/
│   │   └── vrmEngine.ts       # 3D scene, linework, 6-ch lights, material saturation, render loop
│   ├── motion/                # EMAGE worker + VRMA playback / bone fade-in / MotionTransition / FootIK / SpeakIdle
│   ├── memory/                # Client-side multi-tier memory (IndexedDB / entity extraction / n-gram note retrieval / prompt injection)
│   ├── llm/                   # WebLLM WebGPU streaming + Worker + multi-language prompts
│   ├── director/
│   │   └── chatDirector.ts    # LLM → TTS → EMAGE streaming coordinator pipeline
│   ├── i18n/                  # zh-CN / en / ja translation dictionaries + server cookie helper
│   ├── styles/
│   │   └── main.css           # Tailwind v4 @theme tokens + liquid-glass styles
│   ├── App.tsx                # Main application component & event bindings
│   ├── client.tsx             # Client hydration entry
│   ├── server.ts              # Cloudflare Worker entry (SSR router + /api/tts WebSocket proxy)
│   ├── router.tsx             # TanStack Router factory
│   ├── routeTree.gen.ts       # Auto-generated type-safe route tree
│   └── config.ts              # Single source of truth (R2 / camera / lights / saturation / LLM / expressions)
├── vite.config.ts             # Vite 8 + TanStack Start + @cloudflare/vite-plugin
└── tsconfig.json
```

---

## 🌐 i18n & SSR Hydration

Language is stored in a `lang` cookie and resolved during SSR via `@tanstack/react-start/server`'s `getCookie()` — wrapped in `createServerOnlyFn` to keep it out of the client bundle. On the client, the same `lang` cookie is read via `document.cookie`, ensuring the SSR-rendered HTML matches the first client paint with **zero hydration mismatch**.

Switching language:
1. Updates the `lang` cookie.
2. Calls `i18n.changeLanguage()`.
3. Re-renders all `t(...)` consumers without reloading.

---

## 📄 License

This project is licensed under the **MIT License**.

> **Third-party assets** used by the default scene:
> * `public/xiaochun_v1.vrm` — VRM character model generated with **[VRoid Studio](https://vroid.com/en/studio)** (Pixiv Inc.). Subject to the **VRoid Studio License** — free for personal use, modification, and non-commercial redistribution with attribution. For commercial use, please review the [VRoid Studio License terms](https://vroid.com/en/license) or contact Pixiv Inc. for a separate agreement.
> * `public/thinking.vrma` — VRM animation. **License unknown** — verify before redistribution.

`/api/tts` in `src/server.ts` uses Microsoft's Edge-TTS service via the public [`edge-tts-universal`](https://github.com/Sterznode/edge-tts-universal) protocol. The `TRUSTED_CLIENT_TOKEN` constant is a publicly known shared token (the same value used by every open-source Edge-TTS implementation) and is **not** a personal secret.

---

## 🙏 Acknowledgements

* [pixiv / three-vrm](https://github.com/pixiv/three-vrm) — VRM runtime
* [Pixiv / VRoid Studio](https://vroid.com/en/studio) — default character authoring
* [MLC AI / WebLLM](https://github.com/mlc-ai/web-llm) — in-browser LLM
* [Sterznode / edge-tts-universal](https://github.com/Sterznode/edge-tts-universal) — Edge-TTS bridge
* [TanStack Start](https://tanstack.com/start) — full-stack React framework
* [Tailwind CSS](https://tailwindcss.com) — utility-first styling
* [Qiuner / Qiuner.github.io](https://github.com/Qiuner/Qiuner.github.io) (`src/worlds/linework/`) — linework outdoor scene visual inspiration
* [Animation Inc.](https://www.animation.inc) — First tried their Ani-2 product and got hooked on the idea of real-time on-device full-body motion synthesis; this project's EMAGE pipeline is our homegrown attempt at the same dream, running entirely in the browser
* [PantoMatrix / EMAGE](https://github.com/PantoMatrix/PantoMatrix) ([Yi et al., CVPR 2024](https://pantomatrix.github.io/EMAGE/)) — the ONNX full-body co-speech motion model that powers our chat-time gesture generation
* [VolgaGerm / emage-onnx-export](https://github.com/VolgaGerm/emage-onnx-export) — the PyTorch → ONNX export script and the pre-converted `.onnx` weights we run in-browser
