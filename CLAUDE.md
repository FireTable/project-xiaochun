# CLAUDE.md — Claude Agent Project Guide

Welcome to **Project XiaoChun** (100% browser-native anime companion with WebGPU LLM + EMAGE full-body motion + Edge-TTS).

## 📖 Primary Architectural Specification

> **IMPORTANT**: Before making architectural, motion, or state machine modifications, you **MUST** read:
> 👉 **[`AGENTS.md`](./AGENTS.md)**

`AGENTS.md` contains crucial engineering standards, including:
1. **Motion Transition & Blending Rules (`src/motion/motionTransition.ts`)**: Why `neck` and `head` MUST be excluded from global bone snapshotting (avoiding double-LookAt flash/jerking).
2. **EMAGE Streaming Segments (`src/motion/emagePlayer.ts`)**: Continuous latent seed inheritance (`continueFromPrevious`) and physiological angular velocity clamping.
3. **End-of-Speech Cleanup**: Zero-snap return to `NaturalIdle` via Quintic Smootherstep.
4. **Streaming Speech Pipeline (`src/director/chatDirector.ts`)**: 30~60 character clause chunking, concurrent TTS prefetching, dual-condition pre-buffering.
5. **HeadBubble Display Logic (`src/components/HeadBubble.tsx`)**: Text revealed only when `speaking` ("来啦来啦～").
6. **Single Source of Truth (`src/config.ts`)**: Centralized motion, memory, lighting, and model configurations.

---

## 🛠️ Essential Development Commands

```bash
# Start local dev server (with Miniflare for 100% Cloudflare Workers dev/prod parity)
pnpm dev

# Strict TypeScript type check (MUST pass with 0 errors before committing)
npx tsc --noEmit

# Production build test
pnpm build
```

---

## 🧭 Key Project Files

- `src/config.ts` — Single source of truth for motion parameters, memory limits, lighting, camera.
- `src/motion/motionTransition.ts` — Quintic Smootherstep transition manager (53 bones, excludes head/neck).
- `src/motion/emagePlayer.ts` — EMAGE ONNX worker integration, physiological angular speed clamps.
- `src/motion/speakIdle.ts` — Adaptive conversational hover & breathing during inter-chunk wait.
- `src/motion/naturalIdle.ts` — Organic multi-harmonic breathing, relaxed finger curling, Lissajous sway.
- `src/director/chatDirector.ts` — Pipeline orchestrator (LLM -> TTS -> EMAGE -> transitions).
- `src/core/vrmEngine.ts` — Three.js + VRM 1.0 render loop, 6-channel lighting, LookAt tracking.
- `src/memory/` — 100% client-side IndexedDB 3-tier memory system.
