# Project XiaoChun — Coding Agent Engineering & Architecture Reference (AGENTS.md)

> This document is the engineering standards and architecture pitfall guide prepared specifically for AI-assisted Coding Agents. **Read this carefully before making any code changes, refactors, or extensions to this project.**

---

## 1. Core Architecture & Tech Stack Overview

Project XiaoChun is a **100% browser-native 3D AI companion** with strong on-device privacy and real-time performance.

| Module | Core Technologies & Key Files | Key Responsibility & Dedicated Documentation |
| :--- | :--- | :--- |
| **3D Engine & Lifecycle** | `three.js 0.185` + `@pixiv/three-vrm 3.5`<br/>(`src/core/vrmEngine.ts`) | Generic thin orchestrator facade, modular subsystem/plugin architecture, zero-GC 60FPS render loop, detailed in [`docs/ARCHITECTURE_AND_RULES.md`](docs/ARCHITECTURE_AND_RULES.md) |
| **VRMEngine & vrmWorker** | `VRMEngine` + `vrmWorker` + `idb-vrm-cache`<br/>(`src/core/`, `src/lib/idb-vrm-cache.ts`) | Dual-core master facade & worker synthesis, Transferable IPC, 2-tier IDB, detailed in [`docs/VRM_ENGINE_AND_WORKER.md`](docs/VRM_ENGINE_AND_WORKER.md) |
| **Outfit Swap & Delta System** | `outfitSwap.ts` + `.vrmaddon`<br/>(`src/core/outfitSwap.ts`, `vrmWorker.ts`) | 0-frame T-pose elimination, deferred snapshot & pre-restore, delta packaging, detailed in [`docs/OUTFIT_SWAP.md`](docs/OUTFIT_SWAP.md) |
| **Post-Processing Pipeline** | `PostFxPipeline`<br/>(`src/core/postfx/postFxPipeline.ts`) | UnrealBloomPass, background luminance bypass, tone mapping, color grading, detailed in [`docs/POSTFX.md`](docs/POSTFX.md) |
| **VRM Build Toolchain** | `workflow.mjs` + `oxipng`<br/>(`scripts/build-vrm/`) | Delta extraction, PNG texture recompression, fixed zip mtime & byte idempotency, detailed in [`docs/VRM_BUILD_WORKFLOW.md`](docs/VRM_BUILD_WORKFLOW.md) |
| **Motion Pipeline** | `UniversalMotionController` + `MotionPipeline`<br/>(`src/motion/pipeline/`) | Universal motion input, 5-layer blend graph, detailed in [`docs/MOTION_PIPELINE.md`](docs/MOTION_PIPELINE.md) |
| **FootIK & Ground Anchors** | `FootIKSolver`<br/>(`src/motion/footIK.ts`) | Two-bone analytical IK, weight shift (contrapposto), auto-sink, detailed in [`docs/FOOT_IK.md`](docs/FOOT_IK.md) |
| **Locomotion & Gaze** | `BodyTurnSystem` + `GazeController`<br/>(`src/motion/bodyTurn.ts`, `gazeController.ts`) | 4-phase stepping FSM, spring yaw tracking, bio saccades, detailed in [`docs/BODY_TURN_AND_GAZE.md`](docs/BODY_TURN_AND_GAZE.md) |
| **Biomechanical Morphing** | `VRMBodyMorph`<br/>(`src/core/morph/vrmBodyMorph.ts`) | 28-parameter orthogonal decoupled bone & vertex morphing engine, detailed in [`docs/BONE_MORPH.md`](docs/BONE_MORPH.md) |
| **Chat Director & TTS** | `ChatDirector` + `speechSlicer` (`src/lib/utils.ts`) + native WebSocket client (`src/lib/edge-tts-core.ts`)<br/>(`src/director/chatDirector.ts`, `src/lib/utils.ts`, `src/server.ts`) | Smart 25~65 chars slicer, parallel TTS prefetch, stream sync, detailed in [`docs/CHAT_DIRECTOR.md`](docs/CHAT_DIRECTOR.md) |
| **On-device AI & Memory** | `webLLM` + `EMAGE Worker` + `IndexedDB`<br/>(`src/llm/`, `src/motion/`, `src/memory/`) | 100% local WebGPU inference, EMAGE Worker, 3-tier memory, detailed in [`docs/ON_DEVICE_AI.md`](docs/ON_DEVICE_AI.md) |
| **Documentation Index** | Complete Architecture Index & Sitemap | Complete agent fast-path guide, detailed in [`docs/README.md`](docs/README.md) |

---

## 2. Motion & Bone Dynamics Architecture (Critical Pitfall Zone)

The 3D motion pipeline involves complex layered logic. Follow these geometric and physics rules strictly:

### 2.1 Unified Motion Blending Pipeline & Universal Motion API
- Files: `src/motion/pipeline/poseBuffer.ts`, `src/motion/pipeline/universalMotion.ts`, `src/motion/pipeline/motionPipeline.ts`, `src/core/vrmEngine.ts`
- **Architecture Principle**:
  1. **Single Bone Writer**: All sub-modules (Idle, VRMA, EMAGE, Universal Clips, BodyTurn) calculate desired transforms into preallocated `PoseBuffer` objects; only `MotionPipeline.evaluate()` commits final quaternions and positions atomically to VRM humanoid bones in the final pass.
  2. **Layered Blend Graph**:
     - **Layer 0 (Base)**: `NaturalIdle` procedural breathing and standby poise.
     - **Layer 1 (Main Action)**: Managed via continuous Quintic Smootherstep crossfading ($\sum W = 1.0$) between `idle`, `vrma`, `emage`, and `motion`.
     - **Layer 2 (Locomotion)**: `BodyTurnSystem` masked override applied strictly to `LOWER_BODY_MASK` (legs + hips) via `blendMasked()`.
     - **Post Constraints**: `FootIK` physical ground anchoring followed by `LookAtHead` gaze alignment.
  3. **Universal Motion Ingestion (Universal Motion API)**:
     - To play any animation anywhere (whether a VRMA file URL, ArrayBuffer binary stream, or THREE.AnimationClip), **never hardcode custom if-else branches or instantiate private Mixers**. Always call the unified top-level API:
       ```ts
       const handle = await vrmEngine.playMotion(clipOrUrl, {
         fadeDuration: 0.75, // Quintic Smootherstep crossfade duration (seconds)
         loop: false,        // Loop playback flag
         mask: 'all' | 'upperBody', // Full-body motion or upper-body gesture only
         timeScale: 1.0,     // Playback speed multiplier
         onEnd: () => { ... } // Callback triggered after smooth fade-out and return to idle
       });
       // Or gracefully fade out and stop anytime:
       vrmEngine.stopMotion(0.75);
       ```
  4. **Automatic Frame Inbetweening & Lifecycle**:
     - When a new motion is introduced, the pipeline automatically captures the current instantaneous physical pose as the transition start point, canceling out lookAt delta offsets;
     - Applies Quintic Smootherstep ($6t^5 - 15t^4 + 10t^3$) to Slerp-interpolate frame-by-frame across physiological time windows (0.70s ~ 0.88s), completely eliminating frame pops and mechanical snapping;
     - When a non-looping motion reaches its tail, the pipeline automatically initiates a fade-out crossfade to gracefully return to `NaturalIdle` and fires the `onEnd` callback with zero caller maintenance burden.
  5. **⚠️ Critical Architecture Pitfall: Zero-Buffer Commit Trap (T-Pose & Sinking Bug)**:
     - **The Problem**: Pre-allocated `PoseBuffer` instances initialize with default quaternions `(0, 0, 0, 1)` (T-pose) and pelvis positions at `(0, 0, 0)` (sunken into the floor origin). Directly calling `finalPose.commitToVRM(vrm)` at the end of the render loop when `basePose` has not undergone per-frame evaluation forcibly overwrites bones with all-zero rest transforms, causing the avatar to instantly snap into a sunken T-pose!
     - **The Solution**: Render loop updates must adhere to the **non-destructive read-only sampling principle** (`motionPipeline.finalPose.sampleFromVRM(vrm)`). Let the active motion subsystems (NaturalIdle, UniversalMotion, EMAGE) drive bones safely, while `MotionTransitionManager` manages cross-state Quintic Smootherstep Slerping without blind overwrites.

### 2.2 State Transitions & `MotionTransitionManager`
- Files: `src/motion/motionTransition.ts`, `src/lib/constants.ts`
- **Bone Constant Architecture (`src/lib/constants.ts`)**:
  - `VRM_ALL_HUMANOID_BONES` (52 bones): Standardized VRM humanoid bones including 30 finger phalanges (no jaw/eyes). Used by `VRMAMotionPlayer.stop()` to snapshot/restore before Three.js mixer stops, preventing T-pose flashes.
  - `VRM_MOTION_CORE_BONES` (52 bones): Default `MotionTransitionManager` target list — torso, neck, head, limbs, both hands, and all 30 finger phalanges. Hands and fingers must be included so think/speak gestures Quintic-Slerp into idle instead of snapping to the idle fist. EMAGE / NaturalIdle still own fingers outside the cross-state window.
- Principle: At the instant a state switch triggers (e.g. `Idle -> Think`, `Think -> Speaking`, `Speaking -> Idle`), it captures all normalized bone quaternions in milliseconds, then uses Quintic Smootherstep ($6t^5 - 15t^4 + 10t^3$) to Slerp-interpolate over physiological timeframes (0.70s ~ 0.88s, ~42~53 frames).
- **⚠️ Critical Architecture Pitfall: LookAt Decoupling via Inverse Quaternions**:
  - **The Problem**: `vrmEngine.ts` applies multiplicative gaze tracking to `neck` and `head` at the end of every frame (`node.quaternion.multiply(offsetQ)`). If the transition manager blindly snapshots these bones, the snapshot contains the gaze offset; during interpolation it gets multiplied again, causing severe head flips or snap-back.
  - **The Solution**: Instead of naively excluding neck/head, `MotionTransitionManager.startTransition(vrm, dur, lookAtOffsets)` receives the current LookAt offsets and multiplies the snapshot by the inverse offset: `snap.multiply(invLookAt)`. Similarly, `emagePlayer` inverts LookAt offsets on initial snapshot and re-applies LookAt cleanly. This preserves pure anatomical orientation and allows seamless interpolation without head spasms.

### 2.3 Three.js `AnimationMixer.stopAllAction()` Restore Trap (The `Think -> Emage` Drop-to-Idle Pitfall)
- Files: `src/motion/vrmaPlayer.ts`, `src/director/chatDirector.ts`, `src/core/vrmEngine.ts`
- **Pitfall Symptom**: When switching from thinking posture to speech gestures (`think -> emage`), the character abruptly dropped their hand back to idle, froze for a split second, and then began the speech gesture from scratch ("seemed to be switched back to idle then to emage").
- **Root Cause**: In Three.js, calling `mixer.stopAllAction()` triggers an internal `restoreOriginalState()` on all active property bindings, **forcibly resetting all animated bones back to their rest pose / T-Pose (0)**. When `motionTransition.startTransition` sampled the VRM bones in the next render frame, it captured the already-reset idle pose rather than the actual thinking chin-resting pose!
- **Engineering Standard & Rule**:
  - In `VRMAMotionPlayer.stop()`, **never call `mixer.stopAllAction()` nakedly**.
  - Always snapshot all 52 humanoid bone quaternions (`VRM_ALL_HUMANOID_BONES`) and `hips.position` immediately **before** calling `mixer.stopAllAction()`, and write them back immediately **after** `mixer.stopAllAction()`.
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
  - In all modes (idle, VRMA, and EMAGE speech), call `levelFeet(vrm)` continuously (except during active stepping) to keep soles flat ($X=0, Z=0$), preventing toe-lift or foot roll.
  - **Lower-Body Standing Stability (`FootIKSolver` & `EmagePlayer`)**:
    * `FootIKSolver.enableWeightShift` defaults to `true`: enables $\pm 4.2\text{cm}$ lateral pelvis shifting, pelvic rolling, and $9.2°$ unilateral knee flexion for natural contrapposto. When the foot IK target drifts more than $0.06\text{m}$ (camera orbit / turn), snap to the world anchor immediately to prevent crossed legs.
    * `EmagePlayer.stancePillar` defaults to `'balanced'` (`stanceRatio = 0.5`): carries equal weight symmetrically, preventing alternating leg swaps and foot skating during speech.
    * `APP_CONFIG.emage.motion.legIntensity` defaults to `0.70`: legs follow hip/audio motion; FootIK still plants the feet.

### 2.7 BodyTurn Stepping & Head Gaze Decoupling (`handleBodyTurnHandoff`)
- Files: `src/motion/bodyTurn.ts`, `src/core/vrmEngine.ts`, `src/motion/motionTransition.ts`
- **Pitfall Symptom**: When the camera rotates around the character, `BodyTurnSystem` steps to rotate the body toward the lens. At the moment stepping finishes, the head abruptly jerks/snaps to the side before snapping back to face the camera (head jerks during stepping completion).
- **Root Causes**:
  1. `handleBodyTurnHandoff` originally called global `motionTransition.startTransition(vrm, 0.30)`. Because `VRM_ALL_HUMANOID_BONES` included `head` and `neck`, the transition manager captured a snapshot of the head/neck and forcibly interpolated them over 0.30s, fighting against the real-time `LookAt` system and pulling the head backward in time.
  2. `BodyTurnSystem` originally applied aggressive spine pre-rotation (`upperChestTarget = normYaw * 0.30`, total 0.60 across spine/chest). Because `neck` and `head` are child bones of `upperChest`, this caused the head's world yaw to overshoot by 160%; when stepping stopped, the spine snapped back to 0, whipping the head.
- **Engineering Standard & Rule**:
  - `MotionTransitionManager.startTransition` must support `boneFilter?: readonly string[]`.
  - In `handleBodyTurnHandoff`, strictly pass `BODY_TURN_BONES` (only `hips`, `upperLeg`, `lowerLeg`, `foot`, `toes`). **Never snapshot or transition `head`, `neck`, or arms during stepping handoffs!**
  - Keep `BodyTurnSystem` spine yaw subtle ($\le 0.08$ total) to let real-time `LookAtHead` cleanly govern gaze orientation without spine whip.

### 2.8 Biomechanical Bone Morphing & Orthogonal Decoupling Engine
- Files: `src/core/morph/vrmBodyMorph.ts`, `src/config.ts`, `src/components/DevDrawer.tsx`, and detailed specification in [`docs/BONE_MORPH.md`](docs/BONE_MORPH.md)
- **Core Engineering Principle**:
  1. **Anatomical Boundary Locking**: Bone scaling must never be symmetrically center-out. Always compute forward/backward expansion amounts and apply opposite translation offsets to lock the opposite anatomical face (e.g. flat abdomen wall remains $0\text{ mm}$ drift when buttocks or torso thickness scales).
  2. **Downstream Inverse Compensation**: When a parent bone undergoes compensatory translation or scaling, its immediate child joint (e.g. `UpperChest` under `Chest`, `Knee` under `UpperLeg`) must invert the transform ($1/S_z$ and $-\Delta P$) to preserve downstream world alignment (shoulders, neck, and feet stay 100% stable).
  3. **Bone vs. Soft-Tissue Separation**:
     - Rigid/structural proportions (height, shoulder width, torso thickness, limb length) are driven via skeletal matrix transforms.
     - Soft-tissue adiposity (such as `belly` / belly size) is driven via **procedural vertex morphing with smooth cosine falloff** over the front abdominal wall. **Never mutate `Spine` scale or rotation for belly fullness**, as this distorts the lumbar curve and thickens the lower back!
  4. **Dynamic Crown Height Measurement**: Never hardcode character height constants. Compute height by dynamically projecting the highest mesh vertex crown down to physical ground ($Y=0$) across dynamic shoes, IK sink, and morph slider changes.
  5. **Shoulder Width Bounds**: `shoulderWidth` defaults to `1.55` (155%) with an extended biomechanical range of `0.75 ~ 2.50` (250%).

### 2.9 Full-Outfit Swap & Delta Web Worker Architecture (Atomic Swap & Background Synthesis)
- Files: `src/core/outfitSwap.ts`, `src/core/vrmWorker.ts`, `src/core/vrmEngine.ts`, `src/lib/idb-vrm-cache.ts`, detailed in [`docs/OUTFIT_SWAP.md`](docs/OUTFIT_SWAP.md) and [`docs/VRM_ENGINE_AND_WORKER.md`](docs/VRM_ENGINE_AND_WORKER.md).
- **⚠️ Critical Architecture Pitfall: 1-Frame T-Pose & Premature Stop Trap**:
  - **The Problem**: Traditional outfit swapping abruptly stops active animations when loading begins (freezing the character for 150ms) and mounts the new model to the scene before restoring poses, causing a visible 1-frame T-pose flicker.
  - **The Solution (Deferred Snapshot & Pre-restoration)**:
    1. **Never Stop Old Models Prematurely**: The old model continues animating and breathing at full 60 FPS while the new model is synthesized asynchronously;
    2. **Deferred Snapshot Capture**: Only at the microsecond when GLTF parsing finishes does `captureOutfitSwapState(oldVrm)` snapshot current physical bone rotations, morph weights, and lookAt coordinates;
    3. **In-Memory Pre-Restoration**: Before calling `scene.add(newVrm.scene)`, `preRestoreOutfitSwapState(newVrm, snapshot)` pre-populates all 52 bone quaternions directly in memory;
    4. **Atomic Scene Swap**: Replaces avatars in a single microtask (`scene.remove(old) + scene.add(new)`) and rebinds SpringBones on the next tick (`postRestoreOutfitSwapState`), achieving 0-frame pop-in and zero freeze.
- **⚠️ Critical Worker Offloading Rule**:
  - `bspatch` differential synthesis, `fflate` decompression, and binary assembly **MUST NEVER run on the main thread**. All heavy binary operations must be offloaded to the Dedicated Web Worker (`src/core/vrmWorker.ts`) and returned via `Transferable ArrayBuffer` zero-copy transfer;
  - `packRawGLB` must strictly enforce glTF 2.0 4-byte boundary alignment (trailing spaces `0x20` for JSON, null bytes `0x00` for BIN);
  - Maintain L1 base and L2 composed (`${baseSha}:${addonSha}`) two-tier IndexedDB caches to achieve 10~30ms repeat swaps.

### 2.10 Cinematic PostFx Pipeline & Anime Bloom Isolation
- Files: `src/core/postfx/postFxPipeline.ts`, detailed in [`docs/POSTFX.md`](docs/POSTFX.md).
- **⚠️ Critical Architecture Pitfall: White-Background Bloom Blowout**:
  - **The Problem**: Minimalist linework scenes feature high-luminance white backgrounds (`#ffffff`). Applying generic `UnrealBloomPass` treats the entire background as a glow emitter, obliterating character silhouettes in white haze.
  - **The Solution (Luminance Bypass)**: The fragment shader selectively rejects high-luminance background pixels (`bloomBypassBackground`), restricting bloom exclusively to character hair, clothes specular, and accessories.
- **Zero-Overhead Render Bypass**:
  - When `postfx.enabled === false`, the render loop must directly invoke `renderer.render(scene, camera)`, bypassing `EffectComposer` multi-pass FBO blit overhead.

### 2.11 VRMEngine Modularization & General-Purpose Facade Rules
- Files: `src/core/vrmEngine.ts`, `src/core/scene/`, `src/core/lighting/`, `src/core/materials/`, `src/core/morph/`, `src/core/postfx/`, `src/motion/`
- **Core Positioning & Thin Orchestrator Principle**:
  `VRMEngine` is strictly a **pure 3D rendering lifecycle coordinator and unified facade**, **NEVER a monolithic "God Class"**.
  1. **Keep Generic & UI/Domain-Agnostic**:
     - `vrmEngine.ts` must never contain UI state management, conversation logic, network request orchestration, direct DOM mutations, or hardcoded application branches;
     - Exposes only orthogonal high-level facade APIs (e.g. `playMotion()`, `swapOutfit()`, `setLight()`, `setBodyMorph()`, `setLineworkTheme()`), delegating internal implementations entirely to domain subsystems.
  2. **Mandatory Subsystem / Plugin Decoupling**:
     - Any feature with distinct domain boundaries must be encapsulated into self-contained subsystem classes rather than bloating `vrmEngine.ts`:
       * Scene & linework world $\to$ `src/core/scene/lineworkWorld.ts` (`LineworkWorld`)
       * 3-channel studio lighting $\to$ `src/core/lighting/studioLighting.ts` (`StudioLighting`)
       * MToon material & saturation $\to$ `src/core/materials/vrmMaterialManager.ts` (`VRMMaterialManager`)
       * 28-parameter bone morphing $\to$ `src/core/morph/vrmBodyMorph.ts` (`VRMBodyMorph`)
       * Cinematic postfx pipeline $\to$ `src/core/postfx/postFxPipeline.ts` (`PostFxPipeline`)
       * Gaze tracking & micro-saccades $\to$ `src/core/scene/gazeController.ts` (`GazeController`)
       * Motion pipeline & transitions $\to$ `src/motion/pipeline/` (`MotionPipeline`, `UniversalMotionController`, `MotionTransitionManager`)
       * Dialogue director & audio sync $\to$ `src/director/chatDirector.ts` (`ChatDirector`)
     - **Standard Lifecycle Contracts**: Subsystems must implement standardized lifecycle hooks (`init(scene)`, `update(delta, time, vrm)`, `resize(w, h, ratio)`, `dispose()`), invoked lightly by `VRMEngine` during corresponding frame phases.
  3. **Code Ingestion Rule**:
     - When adding new 3D features, the first rule is to create or extend dedicated subsystem modules. `vrmEngine.ts` only handles instantiation and facade delegation.

### 2.12 Performance & Frame-Budget Disciplines (Zero GC & 60 FPS Guarantees)
- Target: Strictly protect the 16.6ms frame budget, maintaining stable 60 FPS on both mobile and desktop with zero visible frame drops, micro-stutters, or memory leaks.
- **Core Engineering Disciplines**:
  1. **Zero Dynamic Allocation in Render Loop (Zero GC in Tick / Update)**:
     - Inside `requestAnimationFrame` loops and per-frame `tick`/`update`/`evaluate` routines, **NEVER instantiate short-lived objects**:
       * ❌ Never call `new THREE.Vector3()`, `new THREE.Quaternion()`, `new THREE.Matrix4()`, `new THREE.Color()` in the frame loop
       * ❌ Never allocate temporary arrays `[]`, object literals `{ ... }`, inline arrow closures, or high-order iterators (`.map()`, `.filter()`, `.forEach()`) per frame
     - **Standard Solution**: Pre-allocate reusable module-level or class-level scratch variables (e.g. `tempHeadTopPos`, `tempRulerEdgePos`, `tempSoleA`), mutating them in-place via `.copy()`, `.set()`, `.multiply()` to completely eradicate V8 garbage collection pauses.
  2. **100% Async Worker Offloading for Heavy Computation**:
     - All heavy computational tasks (glTF binary repacking, `bspatch` differential patching, `fflate` decompression, EMAGE ONNX inference, WebLLM weight calculations) **must execute off the main thread** in Dedicated Web Workers (`vrmWorker.ts`, `emageWorker.ts`, `llmWorker.ts`);
     - Inter-thread data transfers for large ArrayBuffers must use **Transferable Objects** (`postMessage({ buffer }, [buffer])`), strictly avoiding `structuredClone` memory spikes and main-thread freezes.
  3. **Short-Circuiting & Zero-Overhead Render Bypass**:
     - **PostFx Bypass**: When `postfx.enabled === false`, immediately bypass `EffectComposer` to render directly via `renderer.render(scene, camera)`, saving multi-pass blit overhead;
     - **Gaze Short-Circuit**: When the camera is outside the field of view or behind the avatar (`isOutOfView`), bypass raycasting and excessive neck twisting;
     - **Pixel Ratio Clamping**: Enforce `getRenderPixelRatio(APP_CONFIG.renderer.maxPixelRatio)` to cap DPR (e.g. 3), preventing excessive fill-rate saturation and thermal throttling on ultra-high-resolution mobile screens.
  4. **Two-Tier IndexedDB Caching**:
     - Caches base models (L1) and composed GLB binaries (L2 `${baseSha}:${addonSha}`) in IndexedDB, enabling 10~30ms instantaneous repeat swaps and eliminating duplicate network requests and CPU cycles.

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
- **Model files & Delta addons**: `APP_CONFIG.model` (base model URL + SHA, default outfit addon, and 5 official outfit addons list).
- **Body Morph boundaries**: `APP_CONFIG.bodyMorphDefaults` and `APP_CONFIG.bodyMorphLimits` (28 orthogonal parameters, `shoulderWidth` default 1.55, range 0.75~2.50).
- **Post-processing**: `APP_CONFIG.postfx` (UnrealBloom strength/radius/threshold, toneMapping exposure, and color grading matrix).
- **Lighting & Saturation**: `APP_CONFIG.lights` (3-channel studio lighting: dir 1.00, hemi 0.95, fill 1.40) and `APP_CONFIG.saturation`.
- **Memory capacity**: `APP_CONFIG.memory` (`shortTermTurns`, `turnMaxChars`, `longTermKeep`, `longTermTopK`).

---

## 5. Common Dev Commands & Validation Workflow

> ⚠️ **Verification Rule (日常验证规范)**:
> - **DO NOT run `pnpm build` after every routine change or edit**. Running full Vite builds on each small change is slow and produces unnecessary build artifacts.
> - **Always use `npx tsc --noEmit` (or `pnpm exec tsc --noEmit`) for daily verification!** Strict TypeScript typechecking is fast (~1s) and guarantees strict type correctness without build overhead.
> - Reserve `pnpm build` strictly for final pre-release validation or when explicitly instructed by the user.

```bash
# 1. Start local dev server (uses Miniflare to emulate Cloudflare Workers runtime)
pnpm dev

# 2. Daily TypeScript type check (FAST & MANDATORY: must pass with 0 errors!)
npx tsc --noEmit

# 3. Production build (ONLY for final pre-release checks or explicit testing, DO NOT run on every edit)
pnpm build
```

---

## 6. Commit & PR Conventions

- **Strict English-Only Commits**:
  - All commit messages **MUST be written in English**. Never use Chinese in commit messages.
  - Follow the **Conventional Commits** specification:
    * **Format**: `<type>(<scope>): <short summary in lowercase, imperative mood>`
    * **Allowed Types**: `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `chore`.
    * **Common Scopes**: `(scene)`, `(outfit)`, `(postfx)`, `(lighting)`, `(morph)`, `(motion)`, `(llm)`, `(worker)`, `(config)`, `(ui)`, etc.
    * **Imperative Mood**: Use imperative verbs ("add", "fix", "implement", "update", "refactor"), avoiding past tense ("added") or progressive ("adding").
  - **Multi-line / Squash Commit Structure**:
    * First line: high-level imperative summary (`<type>: <overall summary>`)
    * Blank line
    * Bullet points detailing individual sub-module changes in English.
  - **Examples**:
    * `feat(scene): auto-detect device dark mode for linework theme`
    * `fix(motion): eliminate 1-frame T-pose flicker during outfit swap`
    * `perf(vrmWorker): offload glTF repacking and bspatch diffing to dedicated worker`
    * `docs(agents): document VRMEngine modularization and zero-allocation performance rules`
- If changes touch motion smoothness, angular velocity, transition durations, or core dynamics parameters, update `src/config.ts`, `README-CN.md`, `README.md`, and this file accordingly.
