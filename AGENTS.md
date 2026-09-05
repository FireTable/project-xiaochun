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
| **On-device LLM** | `@mlc-ai/web-llm`<br/>(`src/llm/webLLMProvider.ts` + `src/llm/chatWorkflow.ts`) | WebGPU streaming inference, default Qwen3.5 2B (q4f16_1), fallback to 0.8B; `chatWorkflow` dispatches to webLLM or custom HTTP provider |
| **TTS** | `edge-tts-universal`<br/>(`src/server.ts` + `src/director/chatDirector.ts`) | XiaoYi voice (zh-CN-XiaoyiNeural +10 Hz), fully concurrent chunk pre-fetch |
| **On-device Memory** | IndexedDB (`xiaochun-memory`)<br/>(`src/memory/`) | Pure local 3-tier memory: last 6 turns, ZH/EN/JA entity profile extraction, n-gram long-term note retrieval |
| **Single Source of Truth** | `src/config.ts` | Centrally manages lighting, camera, saturation presets, and motion dynamics parameters (`APP_CONFIG.emage.motion`) |

---

## 2. Motion & Bone Dynamics Architecture (Critical Pitfall Zone)

The 3D motion pipeline involves complex layered logic. Follow these geometric and physics rules strictly:

### 2.1 Unified Motion Blending Pipeline & Universal Motion API (万能动作融合管线与零障碍动作接入)
- Files: `src/motion/pipeline/poseBuffer.ts`, `src/motion/pipeline/universalMotion.ts`, `src/motion/pipeline/motionPipeline.ts`, `src/core/vrmEngine.ts`
- **Architecture Principle**:
  1. **Single Bone Writer (唯一骨骼写入者)**: All sub-modules (Idle, VRMA, EMAGE, Universal Clips, BodyTurn) calculate desired transforms into preallocated `PoseBuffer` objects; only `MotionPipeline.evaluate()` commits final quaternions and positions atomically to VRM humanoid bones in the final pass.
  2. **Layered Blend Graph**:
     - **Layer 0 (Base)**: `NaturalIdle` procedural breathing and standby poise.
     - **Layer 1 (Main Action)**: Managed via continuous Quintic Smootherstep crossfading ($\sum W = 1.0$) between `idle`, `vrma`, `emage`, and `motion`.
     - **Layer 2 (Locomotion)**: `BodyTurnSystem` masked override applied strictly to `LOWER_BODY_MASK` (legs + hips) via `blendMasked()`.
     - **Post Constraints**: `FootIK` physical ground anchoring followed by `LookAtHead` gaze alignment.
  3. **Universal Motion Ingestion (万能动作零门槛接入入口)**:
     - 任何地方想要播放任何动作（无论是 VRMA 文件 URL、ArrayBuffer 二进制流、还是 THREE.AnimationClip），**严禁到处写死 if-else 或私自创建 Mixer**，必须统一调用顶层 API：
       ```ts
       const handle = await vrmEngine.playMotion(clipOrUrl, {
         fadeDuration: 0.75, // 五次平滑步阶曲线过渡时长 (秒)
         loop: false,        // 是否循环播放
         mask: 'all' | 'upperBody', // 全身动作或仅上半身手势
         timeScale: 1.0,     // 播放倍速
         onEnd: () => { ... } // 播完并平滑淡出回归待机后的回调
       });
       // 或随时平滑淡出停播：
       vrmEngine.stopMotion(0.75);
       ```
  4. **Automatic Frame Inbetweening & Lifecycle**:
     - 当新动作塞入时，管线自动捕获当前物理瞬时姿态作为过渡起点，自动消除 LookAt 增量；
     - 使用五次平滑步阶（Quintic Smootherstep: $6t^5 - 15t^4 + 10t^3$）在自适应生理时间窗（0.70s~0.88s）内逐帧 Slerp 插补，彻底消除跳帧与机械撕扯；
     - 非循环动作到达尾声时，管线自动启动淡出过渡并从容回归 `NaturalIdle`，触发 `onEnd` 回调，外部调用者 0 维护负担。
  5. **⚠️ Critical Architecture Pitfall: Zero-Buffer Commit Trap (T-Pose & Sinking Bug)**:
     - **The Problem**: 预分配的 `PoseBuffer` 初始四元数均为默认的 `(0, 0, 0, 1)`（即 T-Pose），骨盆位置为 `(0, 0, 0)`（即深陷脚底原点）。如果直接在渲染循环末端执行 `finalPose.commitToVRM(vrm)`，而 `basePose` 尚未经过逐帧计算或采样，就会强行将全零姿态覆写至骨骼，导致模型瞬间变为 T-Pose 假人并下沉入地底！
     - **The Solution**: 渲染主循环末尾对管线姿态的更新必须遵循**非破坏性只读采样原则**（`motionPipeline.finalPose.sampleFromVRM(vrm)`），让各个动作子系统（NaturalIdle、UniversalMotion、EMAGE）安全驱动骨骼，由 `MotionTransitionManager` 负责跨状态五次平滑步阶 Slerp，绝不在未经安全校验前盲目覆写骨骼。

### 2.2 State Transitions & `MotionTransitionManager`
- File: `src/motion/motionTransition.ts`
- Principle: At the instant a state switch triggers (e.g. `Idle -> Think`, `Think -> Speaking`, `Speaking -> Idle`), it captures all normalized bone quaternions in milliseconds, then uses Quintic Smootherstep ($6t^5 - 15t^4 + 10t^3$) to Slerp-interpolate over physiological timeframes (0.70s ~ 0.88s, ~42~53 frames).
- **⚠️ Critical Architecture Pitfall: LookAt Decoupling via Inverse Quaternions**:
  - **The Problem**: `vrmEngine.ts` applies multiplicative gaze tracking to `neck` and `head` at the end of every frame (`node.quaternion.multiply(offsetQ)`). If the transition manager blindly snapshots these bones, the snapshot contains the gaze offset; during interpolation it gets multiplied again, causing severe head flips or snap-back.
  - **The Solution**: Instead of naively excluding neck/head, `MotionTransitionManager.startTransition(vrm, dur, lookAtOffsets)` receives the current LookAt offsets and multiplies the snapshot by the inverse offset: `snap.multiply(invLookAt)`. This preserves pure anatomical orientation and allows full 52-bone seamless interpolation without head spasms.

### 2.3 Three.js `AnimationMixer.stopAllAction()` Restore Trap (The `Think -> Emage` Drop-to-Idle Pitfall)
- Files: `src/motion/vrmaPlayer.ts`, `src/director/chatDirector.ts`, `src/core/vrmEngine.ts`
- **Pitfall Symptom**: When switching from thinking posture to speech gestures (`think -> emage`), the character abruptly dropped their hand back to idle, froze for a split second, and then began the speech gesture from scratch ("seemed to be switched back to idle then to emage").
- **Root Cause**: In Three.js, calling `mixer.stopAllAction()` triggers an internal `restoreOriginalState()` on all active property bindings, **forcibly resetting all animated bones back to their rest pose / T-Pose (0)**. When `motionTransition.startTransition` sampled the VRM bones in the next render frame, it captured the already-reset idle pose rather than the actual thinking chin-resting pose!
- **Engineering Standard & Rule**:
  - In `VRMAMotionPlayer.stop()`, **never call `mixer.stopAllAction()` nakedly**.
  - Always snapshot all 52 humanoid bone quaternions and `hips.position` immediately **before** calling `mixer.stopAllAction()`, and write them back immediately **after** `mixer.stopAllAction()`.
  - This ensures bone transforms remain continuous in 3D space across action stops, allowing `MotionTransitionManager` to capture the true anatomical pose.

### 2.4 State Machine Race Conditions & Premature Assignment Pitfall
- **Pitfall Symptom**: Clicking "Send" caused the character to twitch/flicker back to idle for one frame before resuming `think`.
- **Root Cause**: Prematurely writing `this.activePlayer = 'vrma'` before the animation clip actually starts playing. In the intermediate render frame, `vrmaPlayer.isPlaying()` was still `false`, causing the render loop's state machine to demote `activePlayer` back to `'idle'` and trigger an unintended reverse transition.
- **Engineering Standard & Rule**:
  - `activePlayer` must be driven **strictly and atomically by the render loop** (`vrmEngine.ts`) based on real-time module status (`isPlaying()` / `isThinking`).
  - Never prematurely mutate `activePlayer` outside the render loop in async event handlers or caller methods (`sendMessage()`, etc.).

### 2.5 EMAGE Cross-Segment Streaming Continuity (`switchSegment`)
- File: `src/motion/emagePlayer.ts`
- **Autoregressive Seed Inheritance**: When the Worker generates segment $i$, it must pass `continueFromPrevious = true` to absorb the last 4 frames' latent representation from the previous segment, guaranteeing mathematical motion continuity.
- **Physical Angular Velocity & Damping Following**:
  - Arms / fingers max angular speed: $1.5\ \text{rad/s}$ (~$86°/\text{s}$).
  - Neck / head max angular speed: $1.3\ \text{rad/s}$ (~$74°/\text{s}$).
  - Torso / lumbar / pelvis max angular speed: $1.0\ \text{rad/s}$ (~$57°/\text{s}$).
  - Inertial damping stiffness: read from `APP_CONFIG.emage.motion.dampingStiffness` (default 4.2).
- **⚠️ Critical Rule**: Segment switching is handled internally inside the EMAGE player via `currentBoneQ` physical catch-up. **Never call `motionTransition.startTransition` externally during a segment switch** — it will produce duplicate snapshots and motion contention.

### 2.6 Speech-End Smooth Recovery & Idle Upright Posture Guarantee
- After all speech segments finish, call `emage.stop()` and fire `this.motionTransition.startTransition(vrm, 0.88)`.
- **⚠️ Critical Rule**: Never use `bone.quaternion.copy(rest)` in `emage.stop()` or `resetPose()` to snap lower-body bones straight! Always preserve the current real-time bone orientation and hand off to the global `motionTransition` to smoothly Slerp back into NaturalIdle — eliminates any 0.6s freeze/stutter.
- **`NaturalIdleSystem` must continuously maintain upright lower-body posture**:
  - `NaturalIdleSystem` must bind and hold initial rest quaternions (`restQ`) for all leg, foot, toe, and pelvis bones: `leftUpperLeg`, `rightUpperLeg`, `leftLowerLeg`, `rightLowerLeg`, `leftFoot`, `rightFoot`, `leftToes`, `rightToes`, `hips`.
  - In `update(time, idleWeight)`, every lower-body bone must execute `slerp(restQ, idleWeight)`, giving the transition manager a definite upright target and preventing any bent-knee or crooked-leg residue during standby.
  - In both idle and VRMA modes, call `levelFeet(vrm)` to keep soles absolutely level with the ground ($X=0, Z=0$), preventing toe-lift or foot roll.

### 2.7 BodyTurn Stepping & Head Gaze Decoupling (`handleBodyTurnHandoff`)
- Files: `src/motion/bodyTurn.ts`, `src/core/vrmEngine.ts`, `src/motion/motionTransition.ts`
- **Pitfall Symptom**: When the camera rotates around the character, `BodyTurnSystem` steps to rotate the body toward the lens. At the moment stepping finishes, the head abruptly jerks/snaps to the side before snapping back to face the camera ("头在转的时候注视镜头，在要结束的时候头突然偏一下").
- **Root Causes**:
  1. `handleBodyTurnHandoff` originally called global `motionTransition.startTransition(vrm, 0.30)`. Because `VRM_ALL_HUMANOID_BONES` included `head` and `neck`, the transition manager captured a snapshot of the head/neck and forcibly interpolated them over 0.30s, fighting against the real-time `LookAt` system and pulling the head backward in time.
  2. `BodyTurnSystem` originally applied aggressive spine pre-rotation (`upperChestTarget = normYaw * 0.30`, total 0.60 across spine/chest). Because `neck` and `head` are child bones of `upperChest`, this caused the head's world yaw to overshoot by 160%; when stepping stopped, the spine snapped back to 0, whipping the head.
- **Engineering Standard & Rule**:
  - `MotionTransitionManager.startTransition` must support `boneFilter?: readonly string[]`.
  - In `handleBodyTurnHandoff`, strictly pass `BODY_TURN_BONES` (only `hips`, `upperLeg`, `lowerLeg`, `foot`, `toes`). **Never snapshot or transition `head`, `neck`, or arms during stepping handoffs!**
  - Keep `BodyTurnSystem` spine yaw subtle ($\le 0.08$ total) to let real-time `LookAtHead` cleanly govern gaze orientation without spine whip.

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
