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
> ### Pitfall 8: Mocap Asset Ingestion, Pelvis Sinking Trap & SpringBone Explosive Flailing Trap (动捕切片、骨盆高度篡改与裙摆物理狂甩陷阱)
> **Symptom**: Playing a looped mocap VRMA (such as `listening.vrma`) causes the character's skirt (`SpringBone`) to flare open like a parachute and violently flap/shake continuously ("裙子狂甩"), while loop repeats produce a visible jerk.  
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
> ### Pitfall 9: Locomotion Layer Stepping Collision & Weight-Shift FSM on Upper/Full Body Actions (步态层与动捕下半身冲突、骨盆跳跃与生理移心状态机)
> **Symptom 1**: When `bodyTurn` triggers during an active mocap pose (e.g. `listening`), the lower body abruptly snaps from a wide mocap stance into stepping legs, and upon completing stepping, the pelvis suddenly jumps horizontally sideways (`小幅小平移与骨盆横移跳变`).  
> **Symptom 2**: Playing a mocap action with high-heels or non-zero floor offsets causes the avatar's feet to float in the air ("小飞侠悬空").
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




