# Project XiaoChun — Coding Agent Engineering & Architecture Reference (AGENTS.md)

> This document is the engineering standards and architecture pitfall guide prepared specifically for AI-assisted Coding Agents. **Read this carefully before making any code changes, refactors, or extensions to this project.**

---

## 1. Core Architecture & Tech Stack Overview

Project XiaoChun is a **100% browser-native 3D AI companion** with strong on-device privacy and real-time performance.

| Module | Core Technologies & Key Files | Key Responsibility |
| :--- | :--- | :--- |
| **3D Engine** | `three.js 0.185` + `@pixiv/three-vrm 3.5`<br/>(`src/core/vrmEngine.ts`) | MToon NPR shading, 6-channel independent lighting, procedural outline outdoor world, camera orbit controls |
| **Motion Generation** | EMAGE + ONNX Runtime Web<br/>(`src/motion/emagePlayer.ts`<br/>`src/motion/emageWorker.ts`) | Dedicated Web Worker whole-body motion generation, temporal Gaussian smoothing, dynamic FootIK stance switching |
| **Motion Transition** | `MotionTransitionManager`<br/>(`src/motion/motionTransition.ts`) | Quintic Smootherstep global 53-bone zero-impact seamless transitions |
| **Speaking Micro-motion** | `SpeakIdleSystem`<br/>(`src/motion/speakIdle.ts`) | Maintains natural floating speech gestures, Z-axis knuckle micro-flex, organic head-tilt during TTS generation gaps |
| **Natural Idle** | `NaturalIdleSystem`<br/>(`src/motion/naturalIdle.ts`) | Biomechanical finger curl, multi-harmonic breathing sway, figure-8 pelvis postural balance, gaze wander |
| **On-device LLM** | `@mlc-ai/web-llm`<br/>(`src/llm/webLLM.ts`) | WebGPU streaming inference, default Qwen3.5 2B (q4f16_1), fallback to 0.8B |
| **TTS** | `edge-tts-universal`<br/>(`src/server.ts` + `src/director/chatDirector.ts`) | XiaoYi voice (zh-CN-XiaoyiNeural +10 Hz), fully concurrent chunk pre-fetch |
| **On-device Memory** | IndexedDB (`xiaochun-memory`)<br/>(`src/memory/`) | Pure local 3-tier memory: last 6 turns, ZH/EN/JA entity profile extraction, n-gram long-term note retrieval |
| **Single Source of Truth** | `src/config.ts` | Centrally manages lighting, camera, saturation presets, and motion dynamics parameters (`APP_CONFIG.emage.motion`) |

---

## 2. Motion & Bone Dynamics Architecture (Critical Pitfall Zone)

The 3D motion pipeline involves complex layered logic. Follow these geometric and physics rules strictly:

### 2.1 Motion State Machine & Priority

In the main render loop (`vrmEngine.ts`), motion source priority is strictly:
1. **EMAGE Speaking Motion** (`activePlayer = 'emage'`): Driven by EMAGE whole-body co-speech motion; during inter-segment gaps, `SpeakIdleSystem` seamlessly takes over internally.
2. **VRMA Thinking Loop** (`activePlayer = 'vrma'`): Plays `thinking.vrma` while the user's query is being processed by the LLM.
3. **NaturalIdle Standby** (`activePlayer = 'idle'`): Driven by procedural physiological breathing and postural micro-sway.

### 2.2 State Transitions & `MotionTransitionManager`
- File: `src/motion/motionTransition.ts`
- Principle: At the instant a state switch triggers (e.g. `Idle -> Think`, `Think -> Speaking`, `Speaking -> Idle`), it captures all normalized bone quaternions in milliseconds, then uses Quintic Smootherstep ($6t^5 - 15t^4 + 10t^3$) to Slerp-interpolate over typically 0.55s ~ 0.75s.
- **⚠️ Critical Rule: Strictly exclude `neck` and `head`!**
  - **Why**: `vrmEngine.ts` applies incremental multiplicative gaze tracking to `neck` and `head` at the end of every render frame (`neckNode.quaternion.multiply(neckOffsetQ)`).
  - **Consequence**: If the transition manager snapshots head bones, the snapshot already contains the LookAt offset; during interpolation it gets multiplied again, causing severe head flip, jitter, or snap-back at the transition instant.
  - **Rule**: `VRM_ALL_HUMANOID_BONES` **must never include `neck` or `head`**. Let each module's base orientation and LookAt independently smooth-follow.

### 2.3 EMAGE Cross-Segment Streaming Continuity (`switchSegment`)
- File: `src/motion/emagePlayer.ts`
- **Autoregressive Seed Inheritance**: When the Worker generates segment $i$, it must pass `continueFromPrevious = true` to absorb the last 4 frames' latent representation from the previous segment, guaranteeing mathematical motion continuity.
- **Physical Angular Velocity & Damping Following**:
  - Arms / fingers max angular speed: $1.5\ \text{rad/s}$ (~$86°/\text{s}$).
  - Neck / head max angular speed: $1.3\ \text{rad/s}$ (~$74°/\text{s}$).
  - Torso / lumbar / pelvis max angular speed: $1.0\ \text{rad/s}$ (~$57°/\text{s}$).
  - Inertial damping stiffness: read from `APP_CONFIG.emage.motion.dampingStiffness` (default 4.2).
- **⚠️ Critical Rule**: Segment switching is handled internally inside the EMAGE player via `currentBoneQ` physical catch-up. **Never call `motionTransition.startTransition` externally during a segment switch** — it will produce duplicate snapshots and motion contention.

### 2.4 Speech-End Smooth Recovery & Idle Upright Posture Guarantee
- After all speech segments finish, call `emage.stop()` and fire `this.motionTransition.startTransition(vrm, 0.75)`.
- **⚠️ Critical Rule**: Never use `bone.quaternion.copy(rest)` in `emage.stop()` or `resetPose()` to snap lower-body bones straight! Always preserve the current real-time bone orientation and hand off to the global `motionTransition` to smoothly Slerp back into NaturalIdle — eliminates any 0.6s freeze/stutter.
- **`NaturalIdleSystem` must continuously maintain upright lower-body posture**:
  - `NaturalIdleSystem` must bind and hold initial rest quaternions (`restQ`) for all leg, foot, toe, and pelvis bones: `leftUpperLeg`, `rightUpperLeg`, `leftLowerLeg`, `rightLowerLeg`, `leftFoot`, `rightFoot`, `leftToes`, `rightToes`, `hips`.
  - In `update(time, idleWeight)`, every lower-body bone must execute `slerp(restQ, idleWeight)`, giving the transition manager a definite upright target and preventing any bent-knee or crooked-leg residue during standby.
  - In both idle and VRMA modes, call `levelFeet(vrm)` to keep soles absolutely level with the ground ($X=0, Z=0$), preventing toe-lift or foot roll.

---

## 3. Chat Director & Streaming Pipeline (`chatDirector.ts`)

- **Smart Sentence Chunking (`splitIntoSpeechChunks`)**: Splits uniformly at 30~60 characters and natural punctuation (`。！？!?\n` or comma clauses), preserving natural breath rhythm.
- **Concurrent TTS Pre-fetch**: All chunks are sent to Edge-TTS via `Promise.all` in parallel as soon as text arrives, collapsing subsequent network wait to 0ms.
- **Dual-condition Preload Playback**:
  $$\text{targetPreload} = \min\big(2, \min(N, \max(1, \lceil N/3 \rceil))\big)$$
  Short sentences start in 1~2 segments instantly; long texts buffer 2 segments (~8~12s audio) before playback begins, while remaining segments are generated in the background.
- **Inter-segment Idle Takeover**: If the next playback chunk hasn't finished inference, immediately enter `emage.enterSpeakIdle()`; when the new segment is ready, call `emage.exitSpeakIdle()` and begin playback.
- **Chat Bubble Text Display Rules (`HeadBubble.tsx`)**:
  - Only render the dialogue text when `state.statusKey === 'speaking'` (i.e., when speech and motion are actively playing).
  - During `thinking`, `tts`, `emage` preparation/buffering phases, only show the corresponding micro status icon/capsule — never spoil the dialogue text early.

---

## 4. Single Source of Truth (`src/config.ts`)

When modifying any system-level configuration or parameter, follow the **centralized single source of truth** principle:
- **Motion intensity & damping**: `APP_CONFIG.emage.motion` (gesture amplitude, finger curl, chest sway, lumbar motion, pelvis micro-shift, leg follow, head uprightness, damping stiffness, temporal smoothing radius).
- **Model files & CDN**: `APP_CONFIG.emage.base` (local: `/onnx`, production: Cloudflare R2).
- **Memory capacity**: `APP_CONFIG.memory` (`shortTermTurns`, `turnMaxChars`, `longTermKeep`, `longTermTopK`).
- **Lighting & color**: `APP_CONFIG.lights` and `APP_CONFIG.saturation`.

---

## 5. Common Dev Commands & Validation Workflow

```bash
# 1. Start local dev server (uses Miniflare to emulate Cloudflare Workers runtime)
pnpm dev

# 2. Strict TypeScript type check (must pass with 0 errors before any commit!)
npx tsc --noEmit

# 3. Production build
pnpm build
```

---

## 6. Commit & PR Conventions

- Keep commit messages concise and clear (recommended: semantic commit format, e.g. `feat: ...`, `fix: ...`, `refactor: ...`, `docs: ...`).
- If changes touch motion smoothness, angular velocity, transition durations, or core dynamics parameters, update `src/config.ts`, `README-CN.md`, `README.md`, and this file accordingly.
