# Project XiaoChun — Coding Agent Engineering & Architecture Reference (AGENTS.md)

> This document is the engineering standards and architecture pitfall guide prepared specifically for AI-assisted Coding Agents. **Read this carefully before making any code changes, refactors, or extensions to this project.**

---

## 1. Core Architecture & Tech Stack Overview

Project XiaoChun is a **100% browser-native 3D AI companion** with strong on-device privacy and real-time performance.

| Module | Core Technologies & Key Files | Key Responsibility & Dedicated Documentation |
| :--- | :--- | :--- |
| **3D Engine & Lifecycle** | `three.js 0.185` + `@pixiv/three-vrm 3.5`<br/>(`src/core/vrmEngine.ts`) | VRM 1.0 & VRM 0.x dual-standard orchestrator facade, modular subsystem/plugin architecture, zero-GC 60FPS render loop, detailed in [`docs/ARCHITECTURE_AND_RULES.md`](docs/ARCHITECTURE_AND_RULES.md) |
| **VRMEngine & vrmWorker** | `VRMEngine` + `vrmWorker` + `idb-vrm-cache`<br/>(`src/core/`, `src/lib/idb-vrm-cache.ts`) | Dual-core master facade & worker synthesis, Transferable IPC, 2-tier IDB, detailed in [`docs/VRM_ENGINE_AND_WORKER.md`](docs/VRM_ENGINE_AND_WORKER.md) |
| **Outfit Swap & Delta System** | `outfitSwap.ts` + `.vrmaddon`<br/>(`src/core/outfitSwap.ts`, `vrmWorker.ts`) | 0-frame T-pose elimination, deferred snapshot & pre-restore, delta packaging, detailed in [`docs/OUTFIT_SWAP.md`](docs/OUTFIT_SWAP.md) |
| **Post-Processing Pipeline** | `PostFxPipeline`<br/>(`src/core/postfx/postFxPipeline.ts`) | UnrealBloomPass, background luminance bypass, tone mapping, color grading, detailed in [`docs/POSTFX.md`](docs/POSTFX.md) |
| **VRM Build Toolchain** | `workflow.mjs` + `oxipng`<br/>(`scripts/build-vrm/`) | Delta extraction, PNG texture recompression, fixed zip mtime & byte idempotency, detailed in [`docs/VRM_BUILD_WORKFLOW.md`](docs/VRM_BUILD_WORKFLOW.md) |
| **Motion Pipeline** | `MotionPipeline` + plugin sources/constraints<br/>(`src/motion/pipeline/`, `src/motion/sources/`, `src/motion/constraints/`) | Exclusive live writer (`selectLiveMotionSource`), transparent VRM 0.x/1.0 coordinate mapping, Quintic 0.75s, FootIK+Gaze then `composeLayeredSmooth`, detailed in [`docs/MOTION_PIPELINE.md`](docs/MOTION_PIPELINE.md) |
| **FootIK & Ground Anchors** | `FootIKSolver`<br/>(`src/motion/constraints/footIK.ts`) | Two-bone analytical IK, weight shift (contrapposto), pole-vector orientation, auto-sink, detailed in [`docs/FOOT_IK.md`](docs/FOOT_IK.md) |
| **Locomotion & Gaze** | `BodyTurnSystem` + `GazeController`<br/>(`src/motion/constraints/bodyTurn.ts`, `gaze.ts`) | 4-phase stepping FSM, spring yaw tracking; traits `allowLocomotion` / `thinkSway`, detailed in [`docs/BODY_TURN_AND_GAZE.md`](docs/BODY_TURN_AND_GAZE.md) |
| **Biomechanical Morphing** | `VRMBodyMorph`<br/>(`src/core/morph/vrmBodyMorph.ts`) | 28-parameter orthogonal decoupled bone & vertex morphing engine (VRoid 1.0 guarded), detailed in [`docs/BONE_MORPH.md`](docs/BONE_MORPH.md) |
| **Chat Director & TTS** | `ChatDirector` + `speechSlicer` (`src/lib/utils.ts`) + native WebSocket client (`src/lib/edge-tts-core.ts`)<br/>(`src/director/chatDirector.ts`, `src/lib/utils.ts`, `src/server.ts`) | Smart 25~65 chars slicer, parallel TTS prefetch, stream sync, detailed in [`docs/CHAT_DIRECTOR.md`](docs/CHAT_DIRECTOR.md) |
| **On-device AI & Memory** | `webLLM` + `EMAGE Worker` + `IndexedDB`<br/>(`src/llm/`, `src/motion/`, `src/memory/`) | 100% local WebGPU inference, EMAGE Worker, 3-tier memory, detailed in [`docs/ON_DEVICE_AI.md`](docs/ON_DEVICE_AI.md) |
| **Hybrid desktop & in-app updater** | Tauri 2.x + `tauri-plugin-updater` + `tauri-plugin-process`<br/>(`src-tauri/`, `src/lib/appUpdater.ts`, `src/components/AppUpdateDialog.tsx`, `TauriTopHeader.tsx`) | Frameless pet, 60Hz alpha click-through, GitHub Releases `latest.json` whole-app updates, detailed in [`docs/HYBRID_DESKTOP_APP.md`](docs/HYBRID_DESKTOP_APP.md) |
| **Documentation Index** | Complete Architecture Index & Sitemap | Complete agent fast-path guide, detailed in [`docs/README.md`](docs/README.md) |

---

## 2. Motion & Bone Dynamics Architecture (Critical Pitfall Zone)

The 3D motion pipeline involves complex layered logic. Follow these geometric and physics rules strictly:

### 2.1 Unified Motion Blending Pipeline & Universal Motion API
- Files: `src/motion/pipeline/motionPipeline.ts`, `src/motion/pipeline/selectLiveMotionSource.ts`, `src/motion/pipeline/poseBuffer.ts`, `src/motion/sources/`, `src/motion/constraints/`, `src/core/vrmEngine.ts`
- **Architecture Principle**:
  1. **Single Bone Writer**: `MotionPipeline.tick()` is the only per-frame driver. `selectLiveMotionSource({ clip, emage, vrma })` picks exactly one Layer-1 writer (`clip > emage > vrma > idle`). Idle rest is **never** applied to the live skeleton while another source is active (idle+EMAGE arm mix / crossed hands).
  2. **No motion flags**: The engine loop and Gaze/BodyTurn must not consult `isThinking` / `emageLive` / `activePlayer`. Thinking VRMA and EMAGE are `pipeline.playThinkingClip` / `beginEmageSpeech`. Gaze think-sway and “no stepping while speaking” come from the live source’s `MotionTraits` (`thinkSway`, `allowLocomotion`).
  3. **Layered Blend Graph**:
     - **Layer 0 (Base)**: `NaturalIdle` procedural breathing and standby poise (only when idle is the selected writer, or as `basePose` for upper-body masks).
     - **Layer 1 (Main Action)**: Exclusive `idle` | `vrma` | `emage` | `clip`, Quintic Smootherstep crossfade on `PoseBuffer`, then `commitToVRM`.
     - **Compose**: Draft-commit anatomical layers → FootIK (EMAGE, faded mix) + Gaze `multiply` on the draft → sample VRM → `composeLayeredSmooth` (per-bone ω) → final `commitToVRM`. Quintic window is `SOURCE_FADE_DURATION` (0.75s).
  4. **Universal Motion Ingestion (Universal Motion API)**:
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
  5. **Automatic Frame Inbetweening & Lifecycle**:
     - When a new motion is introduced, the pipeline automatically captures the current instantaneous physical pose as the transition start point, canceling out lookAt delta offsets;
     - Applies Quintic Smootherstep ($6t^5 - 15t^4 + 10t^3$) to Slerp-interpolate over a unified 0.75s window, completely eliminating frame pops and mechanical snapping;
     - When a non-looping motion reaches its tail, the pipeline automatically initiates a fade-out crossfade to gracefully return to `NaturalIdle` and fires the `onEnd` callback with zero caller maintenance burden.
  6. **⚠️ Critical Architecture Pitfall: Zero-Buffer Commit Trap (T-Pose & Sinking Bug)**:
     - **The Problem**: Pre-allocated `PoseBuffer` instances initialize with default quaternions `(0, 0, 0, 1)` (T-pose) and pelvis positions at `(0, 0, 0)` (sunken into the floor origin). Directly calling `finalPose.commitToVRM(vrm)` at the end of the render loop when `basePose` has not undergone per-frame evaluation forcibly overwrites bones with all-zero rest transforms, causing the avatar to instantly snap into a sunken T-pose!
     - **The Solution**: Only commit after this frame sampled a live source into `basePose`/`actionPose` (`sampledThisFrame`). Never `commitToVRM` from an untouched identity buffer. Cross-state Quintic Slerp lives in `MotionPipeline` (`transitionFromPose` → action/idle). `MotionTransitionManager` remains for BodyTurn leg-only handoffs.
  7. **⚠️ Critical Architecture Invariant: VRM 0.x / 1.0 Unified Pipeline Coordinate Bridge**:
     - **Standard Authoring Guarantee**: Upstream motion generators (`NaturalIdleSystem`, `BodyTurnSystem`, `EmagePlayer`, `UniversalMotion`, `GazeController`) author poses **strictly in the VRM 1.0 standard coordinate space** ($+Z$ forward). Motion sources contain zero version branching.
     - **Transparent Pipeline Boundary Translation**: Coordinate space and bone local axis inversions ($[-q_x, q_y, -q_z, q_w]$ quaternion reflection and $180^\circ$ yaw) are encapsulated exclusively inside `PoseBuffer.commitToVRM()` and `sampleFromVRM()`. FootIK automatically adapts knee pole vectors ($\text{forwardSign} = \pm 1$) and ground clamping. Never introduce ad-hoc version branching inside motion generators.

### 2.2 State Transitions & `MotionTransitionManager`
- Files: `src/motion/pipeline/transition.ts`, `src/lib/constants.ts`
- **Bone Constant Architecture (`src/lib/constants.ts`)**:
  - `VRM_ALL_HUMANOID_BONES` (52 bones): Standardized VRM humanoid bones including 30 finger phalanges (no jaw/eyes). Used by `VRMAMotionPlayer.stop()` to snapshot/restore before Three.js mixer stops, preventing T-pose flashes.
  - `VRM_MOTION_CORE_BONES` (52 bones): Default `MotionTransitionManager` target list — torso, neck, head, limbs, both hands, and all 30 finger phalanges. Hands and fingers must be included so think/speak gestures Quintic-Slerp into idle instead of snapping to the idle fist. EMAGE / NaturalIdle still own fingers outside the cross-state window.
- Principle: At the instant a state switch triggers (e.g. `Idle -> Think`, `Think -> Speaking`, `Speaking -> Idle`), it captures all normalized bone quaternions in milliseconds, then uses Quintic Smootherstep ($6t^5 - 15t^4 + 10t^3$) to Slerp-interpolate over 0.75s (~45 frames).
- **⚠️ Critical Architecture Pitfall: LookAt Decoupling via Inverse Quaternions**:
  - **The Problem**: `vrmEngine.ts` applies multiplicative gaze tracking to `neck` and `head` at the end of every frame (`node.quaternion.multiply(offsetQ)`). If the transition manager blindly snapshots these bones, the snapshot contains the gaze offset; during interpolation it gets multiplied again, causing severe head flips or snap-back.
  - **The Solution**: `finalPose` includes Gaze after sample+compose. `copyTransitionSnapshot(..., srcIncludesGaze=true)` so Quintic starts anatomical. `EmagePlayer` still inverts LookAt on its initial VRM snapshot. Head-bubble HUD uses `getHeadTopWorldPosition` (raw crown), not normalized `head` + 0.24m.

### 2.3 Three.js `AnimationMixer.stopAllAction()` Restore Trap (The `Think -> Emage` Drop-to-Idle Pitfall)
- Files: `src/motion/sources/vrma.ts`, `src/director/chatDirector.ts`, `src/core/vrmEngine.ts`
- **Pitfall Symptom**: When switching from thinking posture to speech gestures (`think -> emage`), the character abruptly dropped their hand back to idle, froze for a split second, and then began the speech gesture from scratch ("seemed to be switched back to idle then to emage").
- **Root Cause**: In Three.js, calling `mixer.stopAllAction()` triggers an internal `restoreOriginalState()` on all active property bindings, **forcibly resetting all animated bones back to their rest pose / T-Pose (0)**. When `motionTransition.startTransition` sampled the VRM bones in the next render frame, it captured the already-reset idle pose rather than the actual thinking chin-resting pose!
- **Engineering Standard & Rule**:
  - In `VRMAMotionPlayer.stop()`, **never call `mixer.stopAllAction()` nakedly**.
  - Always snapshot all 52 humanoid bone quaternions (`VRM_ALL_HUMANOID_BONES`) and `hips.position` immediately **before** calling `mixer.stopAllAction()`, and write them back immediately **after** `mixer.stopAllAction()`.
  - This ensures bone transforms remain continuous in 3D space across action stops, allowing `MotionTransitionManager` to capture the true anatomical pose.

### 2.4 State Machine Race Conditions & Premature Assignment Pitfall
- **Pitfall Symptom**: Clicking "Send" caused the character to twitch/flicker back to idle for one frame before resuming `think`.
- **Root Cause**: Historically, `activePlayer = 'vrma'` was written before the clip actually played. The next frame saw `vrmaPlayer.isPlaying() === false` and demoted the writer to idle.
- **Engineering Standard & Rule**:
  - There is no engine-level `activePlayer` / `isThinking` motion flag. `MotionPipeline.tick()` calls `selectLiveMotionSource` from live `isPlaying()` only.
  - ChatDirector starts thinking with `pipeline.playThinkingClip` **after** `playLoop`, never by setting a flag the render loop consults.
  - `beginEmageSpeech` does not `vrma.stop()` immediately. Think keeps playing until EMAGE writes a pose; then stop the mixer so speech-end goes to idle.
  - Never invent a new motion flag in `sendMessage()` / `say()` for the engine loop to read.

### 2.5 EMAGE Cross-Segment Streaming Continuity (`switchSegment`)
- File: `src/motion/sources/emage.ts`
- **Autoregressive Seed Inheritance**: When the Worker generates segment $i$, it must pass `continueFromPrevious = true` to absorb the last 4 frames' latent representation from the previous segment, guaranteeing mathematical motion continuity.
- **Physical Angular Velocity & Damping Following**:
  - Arms / fingers max angular speed: $2.2\ \text{rad/s}$ (~$126°/\text{s}$).
  - Neck / head max angular speed: $2.0\ \text{rad/s}$ (~$115°/\text{s}$).
  - Torso / lumbar / pelvis max angular speed: $2.2\ \text{rad/s}$ (~$126°/\text{s}$).
  - Inertial damping stiffness: read from `APP_CONFIG.emage.motion.dampingStiffness` (default 6.5).
- **⚠️ Critical Rule**: Segment switching is handled internally inside the EMAGE player via `currentBoneQ` physical catch-up. **Never call `motionTransition.startTransition` externally during a segment switch** — it will produce duplicate snapshots and motion contention.

### 2.6 Speech-End Smooth Recovery & Idle Upright Posture Guarantee
- After all speech segments finish, call `emage.stop()` and `pipeline.resetChatMotion()` so the next tick selects idle and Quintic-crossfades on `PoseBuffer` (`commitToVRM`).
- **⚠️ Critical Rule**: Never use `bone.quaternion.copy(rest)` in `emage.stop()` or `resetPose()` to snap lower-body bones straight! Preserve the current pose in `currentBoneQ` / the last committed buffer and let the pipeline Slerp into NaturalIdle — eliminates any 0.6s freeze/stutter.
- **`NaturalIdleSystem` must continuously maintain upright lower-body posture**:
  - `NaturalIdleSystem` must bind and hold initial rest quaternions (`restQ`) for all leg, foot, toe, and pelvis bones: `leftUpperLeg`, `rightUpperLeg`, `leftLowerLeg`, `rightLowerLeg`, `leftFoot`, `rightFoot`, `leftToes`, `rightToes`, `hips`.
  - In `update(time, idleWeight)`, every lower-body bone must execute `slerp(restQ, idleWeight)`, giving the transition manager a definite upright target and preventing any bent-knee or crooked-leg residue during standby.
  - In all modes (idle, VRMA, and EMAGE speech), call `levelFeet(vrm)` continuously (except during active stepping) to keep soles flat ($X=0, Z=0$), preventing toe-lift or foot roll.
  - **Lower-Body Standing Stability (`FootIKSolver` & `EmagePlayer`)**:
    * EMAGE-only: `solve`/`levelFeet` while `writer === 'emage'` **and** `!(isStepping || locomotionWeight > 0.08)`. Idle/clip never run FootIK.
    * Plant from the **previous motion's feet** (`recapturePlantFromCurrent` on source switch and when FootIK fades back in), mixed with live EMAGE feet via `APP_CONFIG.emage.motion.footIkIdlePlant` (default `0.92`). Height stays on that plant Y.
    * Hips: EMAGE does not write root translation. FootIK adds a small damped XZ follow (≤3.5 cm) and `writeHipsInto(lowerPose)` so the final commit keeps it.
    * `EmagePlayer.stancePillar` defaults to `'balanced'` (`stanceRatio = 0.5`).
    * `APP_CONFIG.emage.motion.legIntensity` defaults to `0.40`: legs follow hip/audio; FootIK still stands the character.

### 2.7 BodyTurn Stepping & Head Gaze Decoupling
- Files: `src/motion/constraints/bodyTurn.ts`, `src/motion/pipeline/motionPipeline.ts`
- Overlay **`LEGS_MASK` only** (no hip rotation, no spine yaw). Gaze owns the head via draft LookAt then compose.
- Do not call `MotionTransitionManager` for stepping handoffs.
- While BodyTurn is busy, skip FootIK `solve`/`levelFeet` (fade mix out damp 14). After locomotion settles, recapture plants from the new stance, then fade FootIK back (damp 6).

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
  6. **VRM 0.x Skeletal Morph Guard**: `VRMBodyMorph` relies on standard VRoid Studio 1.0 bone hierarchy and vertex naming conventions. For VRM 0.x models or non-VRoid rigs, `VRMBodyMorph` is automatically guarded (`!isVrm0 && hasVRoidBones`) to prevent breaking non-standard skeletal topologies or twisting arbitrary custom armatures.

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
       * Gaze tracking & micro-saccades $\to$ `src/motion/constraints/gaze.ts` (`GazeController`)
       * Motion pipeline & transitions $\to$ `src/motion/pipeline/` (`MotionPipeline`, `selectLiveMotionSource`) + `src/motion/sources/` + `src/motion/constraints/`
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
     - **Pixel Ratio Clamping**: Enforce `getRenderPixelRatio()` → `min(devicePixelRatio, APP_CONFIG.renderer.maxPixelRatioMobile | maxPixelRatioDesktop)` (platform via `isMobile()`), preventing excessive fill-rate saturation and thermal throttling on ultra-high-resolution mobile screens. Tune mobile/desktop caps independently; do not reintroduce a single shared `maxPixelRatio`.
     - **Sim Frame Cap**: `APP_CONFIG.renderer.targetFpsMobile` / `targetFpsDesktop` phase-lock the heavy `animate` path (≤0 = uncapped). Idle animation still runs; this only thins update/render cadence.
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
- **Motion intensity & damping**: `APP_CONFIG.emage.motion` (gesture amplitude, finger curl, chest sway, lumbar motion, pelvis micro-shift, leg follow, `footIkIdlePlant`, head uprightness, damping stiffness, temporal smoothing radius).
- **Model files & Delta addons**: `APP_CONFIG.model` (base model URL + SHA, default outfit addon, and 5 official outfit addons list).
- **Body Morph boundaries**: `APP_CONFIG.bodyMorphDefaults` and `APP_CONFIG.bodyMorphLimits` (28 orthogonal parameters, `shoulderWidth` default 1.55, range 0.75~2.50).
- **Renderer (platform)**: `APP_CONFIG.renderer` — `maxPixelRatioMobile` / `maxPixelRatioDesktop` (DPR caps), `targetFpsMobile` / `targetFpsDesktop` (sim cadence; ≤0 uncapped).
- **Post-processing**: `APP_CONFIG.postfx` (UnrealBloom strength/radius/threshold, toneMapping exposure, color grading matrix, plus `bloomInputScaleMobile|Desktop` and `composerMSAASamplesMobile|Desktop`).
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

---

## 7. Release & Bundle Versioning Standards

### 7.1 Single Source of Truth for Versioning
- **Primary Source**: `src-tauri/tauri.conf.json` (`"version": "x.y.z"`) is the authoritative source of truth for the application version.
- **Synchronized Targets**:
  Whenever releasing a new version, the version number **must be strictly synchronized** across three files:
  1. `src-tauri/tauri.conf.json` $\to$ `"version": "x.y.z"`
  2. `package.json` $\to$ `"version": "x.y.z"`
  3. `src-tauri/Cargo.toml` $\to$ `version = "x.y.z"`

### 7.2 macOS Bundle Identity & Artifact Naming
- **Product Name**: `"productName": "Project XiaoChun"`
- **Bundle Identifier**: `"identifier": "tech.firetable.project-xiaochun"`
- **Generated Artifacts**:
  * macOS DMG: `Project XiaoChun_${VERSION}_${ARCH}.dmg` (e.g. `Project XiaoChun_0.1.2_aarch64.dmg`)
  * Target Platforms: Apple Silicon (`aarch64-apple-darwin`) & Intel (`x86_64-apple-darwin`).

### 7.3 CI/CD & Homebrew Distribution Pipeline
- **Workflow File**: `.github/workflows/release-tauri.yml`
- **Dynamic Version Resolution**:
  CI automatically parses the release version directly from `src-tauri/tauri.conf.json` (`jq -r .version`).
- **Release Tagging**:
  GitHub Releases and Git tags are formatted as `v${VERSION}` (e.g. `v0.1.2`).
- **In-app updater (official plugin)**:
  * `bundle.createUpdaterArtifacts: true` plus `plugins.updater.pubkey` / `endpoints` in `src-tauri/tauri.conf.json`.
  * Endpoint: `https://github.com/FireTable/project-xiaochun/releases/latest/download/latest.json`.
  * CI must have GitHub secret `TAURI_SIGNING_PRIVATE_KEY` (full contents of `.tauri/xiaochun.key`). Password secret is optional when the key has none. Workflow fails closed if the key is missing.
  * `tauri-action` `includeUpdaterJson: true` uploads `.sig` files and a merged `latest.json`. macOS in-app payload is `.app.tar.gz`, not the Homebrew `.dmg`.
  * Local `pnpm tauri:build` must `export TAURI_SIGNING_PRIVATE_KEY` or `TAURI_SIGNING_PRIVATE_KEY_PATH` — the bundler does not read `.env`. See `.env.example` and [`docs/HYBRID_DESKTOP_APP.md`](docs/HYBRID_DESKTOP_APP.md) §3.5–3.6.
  * All Tauri installs (dev / DMG / Homebrew) use the in-app checker. `brew upgrade --cask` remains available.
- **Homebrew Cask Auto-Update**:
  * The CI job `update-homebrew` automatically computes the SHA256 checksum of the published DMG.
  * Updates `Casks/project-xiaochun.rb` on the `main` branch with the new version, download URL, and SHA256 hash.
  * End users install and update via:
    ```bash
    brew tap FireTable/project-xiaochun https://github.com/FireTable/project-xiaochun
    brew install --cask project-xiaochun
    # or upgrade:
    brew upgrade --cask project-xiaochun
    ```

### 7.4 Pre-Release Verification Checklist
Before releasing or cutting a new version:
1. `npx tsc --noEmit` passes with 0 errors.
2. `cd src-tauri && cargo check` passes cleanly.
3. GitHub secret `TAURI_SIGNING_PRIVATE_KEY` is set (otherwise the release workflow fails).
4. Commit messages adhere to Conventional Commits: `chore(release): bump version to x.y.z`.

