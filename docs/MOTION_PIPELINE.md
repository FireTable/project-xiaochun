# Universal Motion Pipeline & Seamless Blending Specification

> **Core Files**:  
> - [`src/motion/pipeline/motionPipeline.ts`](../src/motion/pipeline/motionPipeline.ts) (`tick()` orchestration, exclusive writer, Quintic blend, commit)  
> - [`src/motion/pipeline/selectLiveMotionSource.ts`](../src/motion/pipeline/selectLiveMotionSource.ts) (clip > emage > vrma > idle; no director flags)  
> - [`src/motion/pipeline/poseBuffer.ts`](../src/motion/pipeline/poseBuffer.ts) (52-bone zero-GC pose buffer & masks)  
> - [`src/motion/sources/`](../src/motion/sources/) (idle, vrma, emage, clip)  
> - [`src/motion/constraints/`](../src/motion/constraints/) (footIK, bodyTurn, gaze)  
> - [`src/motion/pipeline/transition.ts`](../src/motion/pipeline/transition.ts) (leg-only BodyTurn handoff Slerp)

---

## 1. Architectural Vision & Universal Ingestion API

Project XiaoChun integrates diverse, heterogeneous motion sources:
- Standby breathing and biomechanical micro-motion (`NaturalIdleSystem`)
- Thinking loops and contemplative chin-resting (`VRMAMotionPlayer`)
- Neural network-driven conversational gestures (`EmagePlayer`)
- Procedural camera-tracking locomotion footsteps (`BodyTurnSystem`)
- Ad-hoc universal animation clips (dances, greetings, emotes via `UniversalMotion`)

To eliminate fragmented `AnimationMixer` logic, arbitrary `if-else` branching, and destructive bone state overwrites, the system establishes the **Universal Motion Pipeline**.

### 1.1 Single Standard External API (`playMotion`)

Regardless of whether the input is a **remote URL**, a **binary `ArrayBuffer`**, or a **pre-parsed `THREE.AnimationClip`**, external callers interact strictly through the unified engine method:

```typescript
import { vrmEngine } from '@/core/vrmEngine';

// Play motion (automatically retargeted to current VRM skeletal structure)
const handle = await vrmEngine.playMotion('/motions/wave_hand.vrma', {
  fadeDuration: 0.75,         // Quintic Smootherstep crossfade duration in seconds
  loop: false,                // Loop mode
  mask: 'upperBody',          // 'all' (full-body) | 'upperBody' (gestures only) | 'lowerBody'
  timeScale: 1.0,             // Playback playback speed multiplier
  onEnd: () => {
    console.log('Motion completed and smoothly returned to idle');
  },
});

// Playback control handle
handle.pause();
handle.resume();
handle.stop(0.5); // Graceful 0.5s fade-out stop
```

---

## 2. Layered Motion Blend Graph

The system structures motion composition across isolated, non-interfering layers:

```mermaid
graph TD
    subgraph Layer 0 [Layer 0: Standby Biomechanical Base]
        L0[NaturalIdle: Multi-harmonic breathing + Figure-8 pelvic sway + Finger curl]
    end

    subgraph Layer 1 [Layer 1: Main Action Crossfade]
        L1A[Idle]
        L1B[Think VRMA]
        L1C[EMAGE Speech]
        L1D[Universal Motion]
        L1_Blend[Quintic Smootherstep Slerp (∑W = 1.0)]
        L1A --> L1_Blend
        L1B --> L1_Blend
        L1C --> L1_Blend
        L1D --> L1_Blend
    end

    subgraph Layer 2 [Layer 2: Locomotion Masked Override]
        L2[BodyTurn: 4-Phase Stepping (lower body only)]
    end

    subgraph Compose [Compose then commit]
        C1[draft commit anatomical layers]
        C2[FootIK on draft VRM, mix fade in/out]
        C3[Gaze multiply on draft neck/head]
        C4[sample VRM → lower/upper]
        C5[composeLayeredSmooth → final commit]
    end

    L0 --> L1_Blend
    L1_Blend --> L2
    L2 --> C1
    C1 --> C2
    C2 --> C3
    C3 --> C4
    C4 --> C5
    C5 --> Screen[Three.js WebGLRenderer]
```

1. **Layer 0 (Base)**: Supplies foundational anatomical poise (relaxed finger curling, upright leg reference `restQ`);
2. **Layer 1 (Main Action)**: Exactly one of idle / vrma / emage / clip (`selectLiveMotionSource`); Quintic crossfade on `PoseBuffer`;
3. **Layer 2 (Locomotion)**: Overrides **legs only** (`LEGS_MASK`). Hip **rotation** stays with Layer-1 (so EMAGE torso does not shear at the waist); hip **position** may still lerp for step sway. Additionally, `BodyTurnPhysicsContext` feeds forward into Layer-1 (`NaturalIdleSystem`) to deliver organic thoracic counter-torque (`spineInertialYaw`), gait arm counter-swing, contrapposto pelvic compensation, and settle follow-through overshoot.
4. **Draft → FootIK → Gaze → `composeLayeredSmooth` → commit**: Anatomical layers commit to a `draftPose` so IK/LookAt can use world matrices. FootIK runs on that draft only while EMAGE is live **and** BodyTurn is not busy (`locomotionWeight ≤ 0.08`); mix fades in/out. Gaze `multiply` on neck/head. Results are sampled back into `lowerPose`/`upperPose` (`writeHipsInto` keeps the pelvis offset). `composeLayeredSmooth` then follows those targets with per-bone stiffness/ω (head-neck 22/12, fingers 32/16, arms and torso/legs 28/12 rad/s). Pitch is clamped on Layer-1 targets **before** Quintic (`clampTorsoPitch(restPose)`).
5. **Think → speak**: `beginEmageSpeech` does **not** `vrma.stop()` immediately. Think keeps playing until EMAGE writes the first pose, then the mixer stops so speech-end returns to idle rather than think. Crossfade is always `SOURCE_FADE_DURATION` (0.75s).

---

## 2.1 EMAGE as a Layer-1 streaming source

`EmagePlayer` feeds Layer 1 with co-speech poses. On tip `perf/edge-inference`:

- Inference runs in a Dedicated Worker with **wasm EP + INT8** (not WebGPU).
- Streaming uses per-window **`motion_chunk`** (T=64) with A/V hold until audible TTS.
- Hop / seam tunables live in `APP_CONFIG.emage.motion` (`advanceFrames` 60..64).

When `motion_chunk` streaming is active, the Director must **not** reset playhead via `applyMotionData` / `switchSegment` on each window. See [`EMAGE_MODEL.md`](EMAGE_MODEL.md) and [`CHAT_DIRECTOR.md`](CHAT_DIRECTOR.md).

**Source priority** (`selectLiveMotionSource`): `clip` > `emage` > `vrma` > `idle`. Exactly one writer per frame. ChatDirector starts thinking via `playThinkingClip` and speech via `beginEmageSpeech`; it does not set a motion flag the render loop reads. Gaze/BodyTurn use the live source’s `MotionTraits` (`thinkSway`, `allowLocomotion`). Full speak orchestration: [`CHAT_DIRECTOR.md`](CHAT_DIRECTOR.md#orchestration-flowchart-tip). Per-window Worker: [`EMAGE_MODEL.md`](EMAGE_MODEL.md#31-single-window-worker-path-pcm--step--decode--chunk--seam).

## 3. Quintic Smootherstep Transition Algorithm

Linear quaternion interpolation ($\text{Slerp}$) exhibits discontinuous second derivatives at boundary boundaries ($t=0, t=1$), resulting in visible mechanical jerks.

The pipeline utilizes Ken Perlin's **Quintic Smootherstep** formulation:
$$S(t) = 6t^5 - 15t^4 + 10t^3 \quad (t \in [0, 1])$$
- First derivative: $S'(0) = S'(1) = 0$ (Zero initial & terminal velocity);
- Second derivative: $S''(0) = S''(1) = 0$ (Zero initial & terminal acceleration, eliminating inertial shock).

### Snapshot & Slerp Interpolation Workflow
1. **Trigger Instant**: Captures the current normalized local quaternions of all 52 humanoid bones into `fromPose`;
2. **Interpolation Phase**: Over a unified $0.75\text{s}$ window (approximately $45$ frames at $60\text{fps}$), evaluates weight $w = S(t / T)$ and computes:
   $$\mathbf{Q}_{\text{bone}}(t) = \text{slerp}\big(\mathbf{Q}_{\text{from}}, \; \mathbf{Q}_{\text{target}}, \; w\big)$$
3. **Completion**: When $t \ge T$, seamlessly hands off bone control directly to the target player.

---

## 4. Critical Architecture Pitfalls & Rules

> [!CAUTION]
> ### Pitfall 1: Three.js `mixer.stopAllAction()` T-Pose Reset Trap
> **Symptom**: When transitioning from thinking to speech gestures, the avatar's hand abruptly drops to the hip, freezes for one frame, and then starts the speech gesture from scratch.  
> **Root Cause**: In Three.js, calling `mixer.stopAllAction()` invokes an internal `restoreOriginalState()`, resetting all animated properties back to their rest pose / T-Pose (0). If a transition snapshot is captured after this call, it captures the reset T-Pose rather than the actual anatomical posture!  
> **Rule**:
> Always snapshot all 52 humanoid bone quaternions and `hips.position` **immediately before** calling `mixer.stopAllAction()`, and write them back **immediately after**.

> [!WARNING]
> ### Pitfall 2: LookAt Decoupling via Inverse Quaternions
> **Symptom**: State transitions cause the head and neck to abruptly snap or jerk to the side before returning to center.  
> **Root Cause**: Gaze is applied on the draft VRM and then sampled into compose targets, so `finalPose` **includes** LookAt. Snapshotting that pose without stripping gaze, then multiplying LookAt again, double-applies.  
> **Rule**:
> `copyTransitionSnapshot(..., srcIncludesGaze=true)` when the source is `finalPose`. Invert LookAt so Quintic starts from anatomical pose. `EmagePlayer` still inverts LookAt on its initial VRM snapshot.

> [!IMPORTANT]
> ### Pitfall 3: Zero-Buffer Commit Trap
> **Symptom**: Starting an animation causes the character to instantly collapse into a rigid T-Pose and sink into the floor.  
> **Root Cause**: Pre-allocated `PoseBuffer` objects initialize quaternions to `(0,0,0,1)` and position to `(0,0,0)`. Directly calling `commitToVRM` without evaluating all layers overwrites the skeleton with zero transforms.  
> **Rule**:
> Only `commitToVRM` after this frame sampled a live source (`sampledThisFrame`). Never commit an identity PoseBuffer. Idle must not write the skeleton while EMAGE/VRMA/clip is the selected writer.

> [!CAUTION]
> ### Pitfall 4: FootIK must be a compose target, not a post-commit overwrite
> **Symptom**: Think → speak snaps the hips ~1px sideways; speech → idle snaps the calves straight.  
> **Root Cause**: Solving IK after `commitToVRM` never went through `composeLayeredSmooth`. `snapAnchors()` also re-planted rest stance on `emage.play()`.
> 
> **Solution & Rules**:
> 1. Draft-commit anatomical layers, solve FootIK, sample VRM into `lowerPose`/`upperPose`, then `composeLayeredSmooth`.
> 2. Fade `footIkMix` (damp 6). Lerp `hips.position` toward the IK target.
> 3. Speech start: `anchorToCurrentFeet()`, not `snapAnchors()`.
> 4. Per-bone compose ω every frame. Clamp pitch on Layer-1 targets before Quintic.

> [!CAUTION]
> ### Pitfall 5: AI Motion Torso Forward Pitch & Kyphosis Distortion
> **Symptom**: While the avatar stands tall and upright in Idle, entering Think (`thinking.vrma`) or EMAGE speech causes the avatar to slouch, bow, or hunch forward, destroying the upright aesthetic posture.  
> **Root Cause**:
> 1. **Thoracic Kyphosis in AI Motion**: SimpleText2Motion (SMPL-H) trained thinking motions produce forward pitch angles (+X) up to $+10.34^\circ$ on `upperChest`, $+5.69^\circ$ on `spine`, and $+5.77^\circ$ on `neck`, accumulating over $21.8^\circ$ of cumulative forward slouch across four joints.
> 2. **Knee Flexion Sinking Center of Mass**: If FootIK introduces knee flexion during stationary idle, pelvis height drops, causing compensatory torso forward leaning to balance center of mass.
> 3. **Vertical Gaze Dragging Head and Neck**: When the camera is at chest level, downward gaze pitch can forcibly pull the neck and head downward and forward if not properly attenuated.
> 
> **Solution & Rules**:
> 1. **Upright Knees in Stationary Idle**: During ground standing idle with symmetric weight bearing, `FootIK`'s `flexion` strictly zeroes ($0.0\text{ rad}$), preserving the standard 160.1cm height and upright leg silhouette.
> 2. **Pipeline Synthesizer Physiological Pitch Limits (`TORSO_PITCH_LIMITS`)**: Clamped relative to bind-pose rest; executes `clampTorsoPitch` on `basePose`/`actionPose` before Quintic: `hips` ($-0.015 \sim 0.03$), `spine`/`chest` ($-0.015 \sim 0.02$), `upperChest` ($-0.02 \sim 0.025$). BodyTurn only covers legs and does not overwrite `hips` rotation.
> 3. **Gaze Layered on Anatomical Pose**: In draft, compute `neck/head.quaternion.multiply(lookAtQ)`, then sample into compose. Source snapshots must invert LookAt. Head bubble anchor uses `getHeadTopWorldPosition` (raw skull vertex), not normalized `head` + 0.24m.

> [!CAUTION]
> ### Pitfall 6: FootIK vs. Idle Conflict & Locomotion Step Integrity
> **Symptom 1**: Avatar's knees visibly bent forward in idle, and rotating the camera or breathing caused vertical pelvis/head jittering.  
> **Symptom 2**: When orbiting the camera, the stepping foot would occasionally snap down mid-stride, hitching the pelvis and jerking the upper body, followed by redundant micro-steps.  
> 
> **Root Causes**:
> 1. **FootIK Over-Constraint in Idle**: The 2-bone analytical IK solver calculates knee flexion from femoral root (`hips`) to ground target anchor. In idle, `NaturalIdleSystem` drives subtle vertical breathing; FootIK interpreted this height variance as leg extension/compression, forcibly bending the knees forward and creating an algebraic feedback loop on `hips.position.y`.
> 2. **Stepping Truncation Mid-Stride**: The turning state machine previously forced `phase = PLANT` whenever remaining yaw dropped below threshold during `LIFT` or `SWING`. Truncating a mid-air foot instantaneously slammed it down, creating severe pelvic jolts.

> [!CAUTION]
> ### Pitfall 7: VRM 0.x / 1.0 Unified Pipeline Mapping
> **Symptom**: When loading a VRM 0.x model, arms fold backward, fingers invert, body turning walks backward, or knees bend into the body during EMAGE speech.  
> **Root Cause**:
> 1. **Bone Axis Discrepancy**: The VRM 0.0 standard defines characters facing $-Z$ in rest pose, with inverted bone local $X/Z$ axes compared to the modern VRM 1.0 standard ($+Z$ facing).
> 2. **Ad-Hoc Source Branching Danger**: Hardcoding `isVrm0` branch checks inside individual motion sources (`idle.ts`, `bodyTurn.ts`, `emage.ts`, `clip.ts`) fragments the codebase, making future motion authoring error-prone and brittle.
> 
> **Architecture Solution & Invariants**:
> 1. **100% VRM 1.0-Standard Authoring**: All upstream motion generators (`NaturalIdleSystem`, `BodyTurnSystem`, `EmagePlayer`, `UniversalMotion`, `GazeController`) author poses strictly in the **VRM 1.0 standard coordinate space**. Motion sources contain zero VRM version branching.
> 2. **Centralized Transparent Translation in `PoseBuffer`**:
>    - In `PoseBuffer.commitToVRM(vrm)`: If `vrm.meta.metaVersion === '0'`, automatically mirror local quaternions:
>      $$\mathbf{Q}_{\text{vrm0}} = (-q_x, \; q_y, \; -q_z, \; q_w)$$
>    - In `PoseBuffer.sampleFromVRM(vrm)`: Symmetrically reverse the translation:
>      $$q_{\text{vrm1}} = (-\mathbf{Q}_x, \; \mathbf{Q}_y, \; -\mathbf{Q}_z, \; \mathbf{Q}_w)$$
> 3. **Facing & Pole Vector Neutralization**:
>    - `VRMUtils.rotateVRM0(vrm)` sets `vrm.scene.rotation.y = Math.PI` to face forward in world space; Gaze and BodyTurn offset targeting yaw by `vrm.scene.rotation.y - baseYaw`.
>    - `FootIK` adapts the forward pole vector $\mathbf{V}_{\text{forward}}$ to $(0, 0, -1)$ in local hips space so knees bend forward in world space, and clamps ankle targets to $\ge \text{restAnkleY}$ to prevent floor penetration.

> [!CAUTION]
> ### Pitfall 8: Mocap Asset Ingestion, Pelvis Sinking Trap & SpringBone Explosive Flailing Trap
> **Symptom**: Playing a looped mocap VRMA (such as `listening.vrma`) causes the character's skirt (`SpringBone`) to flare open like a parachute and violently flap/shake continuously ("skirt violent flailing"), while loop repeats produce a visible jerk.  
> **Root Causes**:
> 1. **Hips Y Depression Colliding with Thigh Spheres**:
>    In VRM humanoid hierarchy, the skirt bones hang from `Hips`, while the collision spheres (`VRMSpringBoneColliderGroup`) attach to `UpperLeg`. Tampering with `Root_M` translation Y (e.g. subtracting `hipsYOffset = -0.094m` or `-0.054m` in an attempt to manually "ground" the character) sinks the waistband directly into the middle of the thigh colliders! Any movement of the legs applies explosive contact impulses, kicking the skirt outwards into an undamped limit-cycle oscillation.
> 2. **Loop Boundary Discontinuity (Seam Pop)**:
>    Raw mocap slices cut without boundary smoothing create instant velocity and angle jumps between the last frame and frame 0 (e.g. $13.3^\circ$ on `Upper_Leg_R`, $12.3^\circ$ on `Foot_R`, $1.9\text{cm}$ on `Root_M`). Every loop repeat imparts an instantaneous shockwave to all spring bones.
> 3. **Excessive Lateral Pelvic Sway in Standing Clips**:
>    Raw human mocap often includes full-body weight shifting (e.g. 26cm lateral $X$ swing). When played while feet are planted or constrained, the thighs tilt severely outward, continuously driving colliders into the skirt mesh.
> 
> **Architecture Standard & Rules**:
> 1. **Never Arbitrarily Offset Hips Y**:
>    Mocap animations authored with standard humanoid rigs already place the feet at ground level ($Y \approx 0.00\text{m}$ at the sole). Do not subtract arbitrary negative offsets from `Root_M.translation.y`.
> 2. **Quintic Seamless Loop Bake on Sliced Assets (`scripts/slice-vrma.mjs`)**:
>    Always apply Quintic Smootherstep ($6t^5 - 15t^4 + 10t^3$) over the tail $0.75\text{s}$ ($\approx 18$ frames) to Slerp/Lerp all bone channels into frame 0. Guarantees $0.00\text{mm}$ position jump, $< 0.04^\circ$ angular delta, and zero acceleration impulse at the seam.
> 3. **Center & Damp Lateral Sway for Standing Clips**:
>    Scale down large horizontal sway ($X$) on standing idle/listening clips to subtle organic micro-sway ($\le \pm 1.5\text{cm}$), keeping thighs in the center of the skirt volume.
> 4. **Idempotent Mocap Slicing**:
>    Keep pristine raw source files under `public/vrm/motion/raw/` to ensure offline toolchains never repeatedly re-slice or degrade already processed assets.

> [!CAUTION]
> ### Pitfall 9: Locomotion Layer Stepping Collision & Weight-Shift FSM on Upper/Full Body Actions
> **Symptom 1**: When `bodyTurn` triggers during an active mocap pose (e.g. `listening`), the lower body abruptly snaps from a wide mocap stance into stepping legs, and upon completing stepping, the pelvis suddenly jumps horizontally sideways (lateral pelvic jump).  
> **Symptom 2**: Playing a mocap action with high-heels or non-zero floor offsets causes the avatar's feet to float in the air ("floating feet").
> 
> **Root Causes**:
> 1. **Mocap Foot Kinematics vs Standby Sole Anchoring**:
>    Raw human mocap recorded in heels or non-standard studios encodes root and foot trajectories that do not match the avatar's procedural sole grounding. When applied full-body (`mask: 'all'`), the character lifts off the physical plane ($Y > 0$).
> 2. **Abrupt Stance Tearing on Stepping Entry**:
>    Entering `BodyTurnSystem` directly from an arbitrary asymmetrical mocap leg stance forcibly tears the legs into stepping angles within 1 frame.
> 3. **Idle Weight-Shift Residue Snapping**:
>    `NaturalIdleSystem` maintains a slow, realistic weight-shift state machine (`currentWeightShift` up to $\pm 2.46\text{cm}$). Stepping froze this value rather than dampening it. When stepping finished, `NaturalIdleSystem` immediately resumed pulling the pelvis in the opposite direction, creating a visible lateral jolt.
> 
> **Architecture Standards & Rules**:
> 1. **Upper-Body Isolation for In-Place Actions (`mask: 'upperBody'`)**:
>    For conversational or listening actions where the core expression is in the hands, arms, breathing, and head, configure `mask: 'upperBody'` in `MOTION_CATALOG`. This delegates the lower body 100% to `NaturalIdleSystem` and `BodyTurnSystem`:
>    - Both feet remain mathematically grounded at $Y = 0.0000\text{m}$.
>    - Turning triggers instantly with 0 delay at $24^\circ$ (`turnStartThreshold: 0.42`).
> 2. **Universal Lower-Body Locomotion FSM (Action <-> Idle <-> Stepping)**:
>    When full-body actions (`mask: 'all'`) are active, `MotionPipeline` operates a 5-phase physiological weight-shift sequence on `LEGS_MASK`:
>    `Action Stance -> (0.25s Quintic Shift) -> Neutral Idle Legs -> (Stepping) -> (0.18s Settle Hold) -> (0.50~0.85s Quintic Restore) -> Action Stance`.
>    - Angle threshold is elevated to $\sim 38^\circ$ (`actionTurnStartThreshold: 0.66`) so micro camera motions only drive Gaze without leg shuffling.
>    - Interrupted turns safely reverse back to `pre_turn` without popping.
> 3. **Locomotion Hip Dynamics & Weight-Shift Reset**:
>    - In `NaturalIdleSystem.update`, when `locomotionWeight > 0.05` or stepping is active, damp `currentWeightShift` and `currentTorsoTurnYaw` to $0$ with rate $12.0$.
>    - In `BodyTurnSystem`, elevate `SP.SETTLE` damping rate to $12.0$ and explicitly align `currentHipsPos` / `currentHipsQ` to `restHipsPos` / `restHipsQ` upon entering `SP.IDLE`.

> [!CAUTION]
> ### Pitfall 10: VRM Pointer Hijacking & Consecutive Motion Clip Snapping
> **Symptoms**:
> 1. After swapping outfits during speech and returning to idle, clicking the chat input bar causes the avatar's head to spin wildly 360° and the body to freeze in a corrupted pose.
> 2. Switching consecutively between two motion clips (such as showcase $\to$ listening) causes an instant 1-frame snap rather than a smooth Quintic crossfade.
> 
> **Root Causes**:
> 1. **Stale VRM Pointer in `ChatDirector`**: `ChatDirector` previously cached `currentVRM` during speech. When `swapOutfit` destroyed the old model and mounted the new one, `ChatDirector` retained the dangling reference to the disposed VRM. Upon focusing input (`turnState = 'listening'`), it passed the dead pointer to `MotionPipeline.onTurnStateChange()`, rebinding the entire motion pipeline back to the disposed model! GazeController continued targeting the live on-screen model while the pipeline wrote zeros to the dead model, creating extreme head twisting and bone freezing.
> 2. **Three.js `AnimationAction.stop()` Zero-Reset**: In `UniversalMotionController`, playing a new clip called `prevAction.stop()` directly. Three.js restores property bindings to rest pose (0) when an action stops, wiping bone transforms for 1 frame.
> 3. **Motion-to-Motion Crossfade Short-Circuit**: In `MotionPipeline.setMotionSource()`, checking `if (source === this.activeSource && mask === this.activeMask && !this.isCrossfading) return;` caused transitions between two clips (both `source === 'motion'`) to abort early without capturing transition snapshots or enabling crossfade.
> 
> **Architecture Standards & Rules**:
> 1. **SSOT VRM Reference**: `MotionPipeline.boundVRM` is the sole source of truth. `ChatDirector` synchronizes via `bindVRM(vrm)`. `onTurnStateChange(state)` takes no required VRM argument and always uses `this.boundVRM`.
> 2. **Universal 52-Bone Pose Protection (`preserveHumanoidPose`)**: Both `stop()` and `play()` in `UniversalMotionController` wrap action termination in a 52-bone snapshot/restore closure, preventing Three.js bone wiping.
> 3. **Consecutive Motion Clip Crossfading (`forceTransition = true`)**: `playMotion` invokes `setMotionSource('motion', fadeDur, lookAtOffsets, mask, true)`. With `forceTransition`, `transitionFromPose` is captured and a 0.75s Quintic Smootherstep crossfade is guaranteed between consecutive clips.
> 4. **Mid-Chat Showcase Suppression**: Outfit swap checks `wasSpeakingOrThinkingAtStart` and `isChatActive`. Swapping outfits during dialogue strictly suppresses `outfitShowcase`, preventing unwanted gestures from clashing with user chat focus.

---

## 3. MotionAssetManager & Type-Safe Motion Groups (`MOTION_GROUPS`)

To eliminate duplicate motion loading, network fetches, and imperative magic calls, motion asset management is unified under `MotionAssetManager` (`src/motion/pipeline/motionAssetManager.ts`):

### 3.1 Three-Tier Asset Cache Hierarchy
1. **L1 Memory ArrayBuffer Pool** (`Map<string, ArrayBuffer>`): Instantaneous (0ms) synchronous access for frequently used or warmed motion binaries.
2. **L2 IndexedDB Cache** (`vrm-assets-cache` store): Persistent on-device storage via `idbGetMotion` / `idbPutMotion`. Survives page reloads and browser sessions without redundant network transfers.
3. **L3 Bound AnimationClip Pool** (`Map<string, THREE.AnimationClip>`): Pre-retargeted, seamless-baked animation clips bound to the current VRM skeleton.
   - **Outfit Swap Invalidation Guarantee**: When model swaps, `invalidateBoundClips()` flushes L3 while preserving L1/L2 binary pools intact. Re-binding to the new skeleton takes only 5~10ms purely in CPU memory.

### 3.2 Motion Catalog Warmup (`warmup: true`)
Entries in `MOTION_CATALOG` (`src/motion/catalog.ts`) can declare `warmup: true` (e.g. `thinking`, `listening`, `showFullBody`, `joyfulJump`, `handHeart`, `pokeDimple`).
During model initialization / heavy preload (`vrmEngine.preloadHeavyResources`), `motionAssetManager.warmCatalogMotions(vrm)` fetches and pre-parses these clips in parallel.

### 3.3 Compile-Time Type-Safe Motion Groups (`MOTION_GROUPS`)
Interactive scenarios trigger dynamic weighted motion playback across carefully partitioned situational groups:
- **`outfitShowcase`**: Wardrobe change showcase (`showFullBody` 70%, `handHeart` 20%, `pokeDimple` 10%);
- **`idleFlavor`**: Spontaneous standby fidgets during prolonged idle (`relaxStretch` 50%, `checkTime` 30%, `sleepyNod` 20%);
- **`listening`**: Focused attention during user speech & input focus (`listening` 70%, `gazeObserve` 30%);
- **`thinking`**: Deep thinking during LLM reasoning & prefetch (`thinking` 70%, `pokeFingers` 30%);
- **`greeting`**: User arrival & hello welcome (`waving` 100%);
- **`praiseCute`**: Compliment & affection reactions (`handHeart` 100%);
- **`playfulSulking`**: Teasing & playful petulance (`poutHum` 100%);
- **`dancePerformance`**: Looped dance showcases (`rumbaDance` 40%, `bellyDanceWave` 35%, `bellyDance` 25%).

Groups are defined with `as const satisfies Record<string, readonly MotionGroupItem<MotionCatalogId>[]>`:
- **Compile-Time Safety**: If any action ID in `MOTION_GROUPS` is renamed or deleted from `MOTION_CATALOG`, TypeScript immediately throws a compile-time error (`tsc TS2322`).
- **Weighted Random Selection**: `selectMotionFromGroup(groupName)` executes weighted random sampling according to declared ratios.

### 3.4 Standby Fidget System (Idle Flavor Scheduler)
To eliminate unnatural "mannequin idling" while standing in procedural breathing (`NaturalIdleSystem`), `VRMEngine` runs an internal, non-intrusive `updateIdleFlavor(delta)` scheduler:
1. **Natural Cooling Window**: Triggers at randomized intervals ($14\text{s} \sim 24\text{s}$) when the avatar is in pure, uninterrupted idle.
2. **Strict Non-Intrusive Guards**:
   - Only ticks when `turnState === 'idle'`, `!speaking`, and no motion or crossfade is active;
   - Immediately pauses and resets if the user is dragging the camera (`interaction.getState().isDragging`);
   - Resets when input is focused, speech starts, or outfits are swapped.
3. **Graceful Takeover & Recovery**:
   - Spontaneously plays a weighted action from `MOTION_GROUPS.idleFlavor` via 0.85s Quintic Smootherstep crossfade;
   - Upon completion, the pipeline automatically fades back into `NaturalIdleSystem`;
   - If the user interrupts mid-fidget (e.g. typing or sending a message), `forceTransition = true` seamlessly blends into `listening` or `thinking` with zero hitching.

---

## 4. SSOT Turn State Machine (`TurnState`)

Fragmented flags (`isListening`, `listening`, `speaking`, `isThinking`) are unified into a Single Source of Truth:

$$\text{TurnState} \in \{\text{'idle'}, \; \text{'listening'}, \; \text{'thinking'}, \; \text{'speaking'}\}$$

1. **State-Driven Motion**:
   - Calling `vrmEngine.setTurnState(state)` or `chatDirector.setTurnState(state)` notifies `motionPipeline.onTurnStateChange(state)`.
   - `'listening'` smoothly blends mocap posture and facial focus.
   - `'thinking'` automatically starts the pre-warmed thinking clip with fallback to procedural sway.
   - `'speaking'` activates the EMAGE conversational gesture stream.
   - `'idle'` Quintic-crossfades smoothly back to `NaturalIdle`.
2. **UI & Busyness Contract**:
   - `isBusy = turnState === 'thinking' || turnState === 'speaking'`.
   - When typing in `'listening'`, `isBusy` remains `false`, preventing premature Send button locking.
   - DOM class `chat-playing` on `document.body` is strictly governed by `turnState !== 'idle'`.

---

## 5. VRMA Motion Optimization Toolchain (`scripts/slice-vrma.mjs`)

Mocap files direct from DCC tools often contain dense sampling (60 FPS), unmapped secondary bones (hair, bust), and redundant static keyframes. To maintain low memory footprint and fast network loading without compromising motion quality, `scripts/slice-vrma.mjs` provides an automated, lossless optimization pipeline:

### 5.1 Optimization Principles
1. **Adaptive FPS Capping (max 30 FPS)**:
   - Motions with native framerates $> 32\text{ FPS}$ (e.g. 60 FPS) are cleanly downsampled to 30 FPS.
   - Three.js `AnimationMixer` computes spherical linear interpolation (Slerp) on the fly, rendering at full 60/120 Hz display refresh rates with **zero visible difference** (max angular deviation $< 1.5^\circ$, hips position deviation $< 0.45\text{ mm}$).
   - Motions already authored at $\le 30\text{ FPS}$ (e.g. 24 FPS) keep their native frames 100% untouched.
2. **Orphan & Ignored Channel Stripping**:
   - Drops non-humanoid channels (hair, bust, eyes) that `@pixiv/three-vrm-animation` ignores, preventing conflicts with `VRMSpringBone` and reclaiming ~40% of buffer memory.
   - Strips non-standard `translation` tracks on bones other than `hips` (eliminates runtime Three.js console warnings).
3. **Exact Zero-Diff Static Track Collapse**:
   - Channels with zero or negligible motion ($\Delta_{\max} \le 10^{-4}$) over the whole clip are collapsed into 2 constant keyframes ($t=0$ and $t=\text{duration}$).
4. **Shared Time Accessor**:
   - Eliminates per-sampler duplicated time arrays, consolidating time tracks into a single shared glTF accessor.

### 5.2 CLI Usage
```bash
# 1. Batch optimize all VRMA files in public/vrm/motion/
node scripts/slice-vrma.mjs --optimize-all

# 2. Optimize a single VRMA file (in-place or to target)
node scripts/slice-vrma.mjs --optimize public/vrm/motion/show-full-body.vrma

# 3. Diagnostic inspection of a VRMA file:
node scripts/slice-vrma.mjs --scan public/vrm/motion/touch-hair.vrma

# 4. Standard in-place standing/dance slicing:
# (First-frame X/Z relative zeroing, Quintic seamless loop, pelvis lowered by 4.5cm)
node scripts/slice-vrma.mjs raw.vrma out.vrma 0.0 20.0 --seamless --zero-x=firstFrame --zero-z=firstFrame --hips-y-offset=-0.045

# 5. Treadmill in-place locomotion slicing:
# (Locks X and Z translation to 0.0 for walking/running loops)
node scripts/slice-vrma.mjs walk_raw.vrma walk_out.vrma 0.0 1.333 --seamless --zero-x=all --zero-z=all
```

### 5.3 Root Motion Z-Displacement Standard (`zeroZ: 'firstFrame'` vs `'all'`)

Raw mocap studio captures typically position the performer at an arbitrary origin ($Z_0 = -15\text{cm} \sim -47\text{cm}$).
1. **The Problem**:
   - Directly playing raw mocap causes the character to instantly leap backwards into the background away from the idle standing position ($Z=0$).
   - Forcibly zeroing Z translation across **all frames** ($Z(t) \equiv 0.0$) breaks anatomical counterbalance:
     * In deep bows (`bowSalute`), the hips naturally slide backwards by $18.6\text{cm}$ to counterbalance the forward-leaning torso; locking $Z \equiv 0$ causes the avatar to pitch unnaturally forward.
     * In dances and standing fidgets (`modelPose`, `swayIdle`, `cheerUp`), weight transfers from heel to toe generate natural $\Delta Z = \pm 2\sim 4\text{cm}$ depth sway; locking $Z \equiv 0$ renders the pelvis stiff and mechanical.
2. **First-Frame Z Relative Displacement (`zeroZ: 'firstFrame'`)**:
   - Mathematical transformation:
     $$Z'(t) = Z(t) - Z(0)$$
   - **Guaranteed Frame 0 Origin Alignment**: $Z'(0) \equiv 0.0\text{m}$, ensuring seamless crossfading from `NaturalIdle` with zero backward/forward jumping.
   - **100% Anatomical Counterbalance Preservation**: Retains all relative pelvic sway $\Delta Z(t) = Z(t) - Z(0)$ throughout the action.
   - **Treadmill Mode (`zeroZ: 'all'` / `true`)**: Exclusively reserved for locomotion cycles (`casualWalk`) where the actor actually walked through space and must be converted to an in-place loop.

### 5.4 Root Motion Lateral X-Displacement Standard (`zeroX: 'firstFrame'` vs `'all'`)

Performers in motion capture volumes rarely start exactly at center $X=0.0$.
1. **The Problem**:
   - Raw recordings often have lateral off-centering (e.g. `model-pose` $X_0 = +29.4\text{cm}$, `impatient-wait` $X_0 = +5.3\text{cm}$, `sway-idle` $X_0 = -6.6\text{cm}$).
   - Starting a motion directly without $X$-normalization causes the avatar to immediately snap horizontally or stand off-center, misaligning with ground shadows and camera framing.
   - Conversely, locking $X(t) \equiv 0.0$ destroys natural lateral hip swaying, weight shifting, and rhythmic body sways.
2. **First-Frame X Relative Displacement (`zeroX: 'firstFrame'`)**:
   - Mathematical transformation:
     $$X'(t) = X(t) - X(0)$$
   - **Guaranteed Frame 0 Origin Alignment**: $X'(0) \equiv 0.0\text{m}$, guaranteeing that the avatar enters the motion strictly at the camera center origin with zero lateral jump.
   - **100% Lateral Rhythm & Weight Shift Preservation**: Preserves the actor's natural left/right weight shifting and rhythmic dance movements.
   - **Treadmill In-Place Locomotion (`zeroX: 'all'` / `true`)**: Locks $X(t) \equiv 0.0$ for walk/run cycles to eliminate directional steering drifts.

### 5.5 Symmetrical Zero-Crossing Periodic Slicing (Sway & Idle Standard)

When slicing rhythmic swaying or cyclical standing fidgets (e.g. `swayIdle`):
1. **⚠️ The Apex-Slicing Trap (Pelvis Freeze & Foot Drift)**:
   - If a clip is sliced from an extreme lean apex (e.g. at the turning point where the hips are swung all the way to the left at $t=3.0\text{s}$), the first $1\sim 1.5$ seconds of relative displacement $X'(t) = X(t) - X(0)$ remains flat near $0.0\text{m}$ while the hips decelerate and change direction.
   - Meanwhile, the leg and foot rotations are posed for an extreme asymmetrical lean. During crossfade from `NaturalIdle`, the hips stay fixed at $(0,0,0)$ while the legs rotate, producing an unnatural visual artifact: **"hips don't move, feet drift sideways, and only after 1.5s does the motion start"**.
2. **Symmetrical Zero-Crossing Solution**:
   - Always find the true sinusoidal center zero-crossing ($X \approx \text{midpoint}$, equal 50/50 leg weight distribution);
   - Start the slice at the zero-crossing traveling in the cycle's primary direction, and end at the matching zero-crossing one full period later ($t_{\text{end}} = t_{\text{start}} + T$);
   - Result:
     * Frame 0 starts in an upright, centered stance ($X=0.00\text{m}$, balanced feet);
     * Hips begin swinging smoothly and immediately from Frame 1 ($t=0.5\text{s} \rightarrow X=+6\text{cm}$);
     * Complete symmetry: $+10\text{cm}$ right sway $\leftrightarrow$ $-10\text{cm}$ left sway;
     * Foot lateral drift is $< 7\text{mm}$, achieving zero foot slip and zero delay.

### 5.6 Vertical Ground Contact Protection (`hipsYOffset` + `compensateFloorContact`)

When mocap files authored on different rigs or with high-heeled footwear (e.g. `model-pose.vrma` baked with Hips Y ~4.5cm too high) are retargeted, the avatar floats in mid-air.
1. **Calibrated Slicing Offset (`hipsYOffset: -0.045m`)**:
   - Uniformly lowers the Hips Y trajectory so standing foot soles touch the floor plane ($Y=0.00\text{m}$).
2. **Automated Dynamic Contact Clamping (`compensateFloorContact`)**:
   - Evaluates world positions of `toesL`, `toesR`, `footL`, and `footR` across all keyframes against `restFloorY`.
   - Only for frames where ankle pitch or deep squats cause vertices to dip below floor level ($\text{penetration} > 0$), lifts Hips Y just enough to prevent floor penetration (`vals[i * 3 + 1] += penetration`).
   - Achieves consistent, grounded foot contact across the entire animation ($\text{diff} \in [0.0\text{cm}, 0.1\text{cm}]$) with zero hovering and zero floor penetration.

### 5.7 Tail-Hold Keyframe Extension (`--tail-hold=<seconds>`)

For non-looping one-shot expressions or gestures (such as `cheerUp` or `shhLean`) that play once and smoothly crossfade back to `NaturalIdle`:
- Extending the tail frame by $N$ seconds (e.g. `--tail-hold=0.5`) duplicates the final anatomical pose into static hold frames.
- This gives the pipeline's 0.75s Quintic Smootherstep crossfade a stable, stationary starting point, preventing premature recoil snapping before the transition completes.

### 5.8 Complete CLI Options Reference

| CLI Option | Type / Values | Default | Purpose & Recommended Usage |
| :--- | :--- | :--- | :--- |
| `input.vrma output.vrma start end` | Path & Floats | `0.0 Infinity` | Core slicing range in seconds. Drops setup/teardown T-poses. |
| `--seamless` | Flag | `false` | Bakes Quintic Smootherstep circular loop between end and start frames. Recommended for idle and dance loops. |
| `--seamless-duration=<sec>` | Float | `0.65` | Duration of the crossfade window for seamless loop baking. |
| `--zero-x[=firstFrame\|all]` | Enum / Bool | `false` | `firstFrame`: $X'(t) = X(t) - X(0)$ (center origin, preserves lateral rhythm).<br/>`all`: $X'(t) \equiv 0.0$ (treadmill in-place locomotion). |
| `--zero-z[=firstFrame\|all]` | Enum / Bool | `false` | `firstFrame`: $Z'(t) = Z(t) - Z(0)$ (center origin, preserves bow/squat counterbalance).<br/>`all`: $Z'(t) \equiv 0.0$ (treadmill in-place locomotion). |
| `--hips-y-offset=<meters>` | Float | `0.0` | Global vertical translation offset for pelvis (e.g. `-0.045` lowers character by 4.5cm to eliminate foot floating). |
| `--tail-hold=<seconds>` | Float | `0.0` | Extends final frame pose statically for $N$ seconds before motion completion. |
| `--optimize` | Flag | `false` | Optimizes target VRMA (strips secondary channels, collapses static tracks, caps at 30 FPS). |
| `--optimize-all [dir]` | Flag & Path | `public/vrm/motion` | Batch optimizes all `.vrma` files in the target directory. |
| `--scan <file>` | Flag & Path | `none` | Performs non-destructive diagnostic analysis on animation tracks and bone channels. |






