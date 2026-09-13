# CLAUDE.md — Claude Agent Project Guide

Welcome to **Project XiaoChun** (100% browser-native anime companion with WebGPU LLM + EMAGE full-body motion + Edge-TTS).

## 📖 Primary Architectural Specification

> **IMPORTANT**: Before making architectural, motion, or state machine modifications, you **MUST** read:
> 👉 **[`AGENTS.md`](./AGENTS.md)**

`AGENTS.md` contains crucial engineering standards, including:
1. **Motion Pipeline (`src/motion/pipeline/motionPipeline.ts`)**: Exclusive live writer (`selectLiveMotionSource`); Quintic on `PoseBuffer`; LookAt stripped only from VRM-bone snapshots, not anatomical `finalPose`.
2. **EMAGE Streaming Segments (`src/motion/sources/emage.ts`)**: Continuous latent seed inheritance (`continueFromPrevious`) and physiological angular velocity clamping; pose goes to the pipeline via `copyToPoseBuffer`, not a second bone write.
3. **End-of-Speech Cleanup**: Zero-snap return to `NaturalIdle` via Quintic Smootherstep.
4. **Streaming Speech Pipeline (`src/director/chatDirector.ts`)**: 30~60 character clause chunking, concurrent TTS prefetching, dual-condition pre-buffering.
5. **HeadBubble Display Logic (`src/components/HeadBubble.tsx`)**: Text revealed only when `speaking` ("来啦来啦～").
6. **Single Source of Truth (`src/config.ts`)**: Centralized motion, memory, lighting, and model configurations.

---

## 🛠️ Essential Development Commands

> ⚠️ **Verification Rule**: Do NOT run `pnpm build` after every routine change. Use `npx tsc --noEmit` (fast, ~1s) for daily validation. Reserve `pnpm build` only for final pre-release checks.

```bash
# Start local dev server (with Miniflare for 100% Cloudflare Workers dev/prod parity)
pnpm dev

# Strict TypeScript type check (DAILY VERIFICATION: must pass with 0 errors!)
npx tsc --noEmit

# Production build test (ONLY for final checks, DO NOT run on every edit)
pnpm build
```

---

## 🧭 Key Project Files

- `src/config.ts` — Single source of truth for motion parameters, memory limits, lighting, camera.
- `src/motion/pipeline/motionPipeline.ts` — Exclusive live writer + Quintic blend + commit; `selectLiveMotionSource`.
- `src/motion/pipeline/transition.ts` — Quintic Smootherstep (BodyTurn leg handoff).
- `src/motion/sources/emage.ts` — EMAGE ONNX worker integration, physiological angular speed clamps.
- `src/motion/sources/speakIdle.ts` — Adaptive conversational hover & breathing during inter-chunk wait.
- `src/motion/sources/idle.ts` — Organic multi-harmonic breathing, relaxed finger curling, Lissajous sway.
- `src/director/chatDirector.ts` — Pipeline orchestrator (LLM -> TTS -> EMAGE -> transitions).
- `src/core/vrmEngine.ts` — Three.js + VRM 1.0 render loop, 6-channel lighting, LookAt tracking.
- `src/memory/` — 100% client-side IndexedDB 3-tier memory system.

---

## 📝 Commit Conventions

- **Strict English-Only Conventional Commits**: All commit messages must be written in English. Never use Chinese in commit messages.
- Format: `<type>(<scope>): <imperative summary in lowercase>` (e.g. `feat(scene): auto-detect device dark mode`).

