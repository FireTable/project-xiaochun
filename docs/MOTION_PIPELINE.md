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
> ### Pitfall 5: AI Motion Torso Forward Pitch & Kyphosis Distortion (AI动作躯干前躬与探颈失真陷阱)
> **Symptom**: While the avatar stands tall and upright in Idle, entering Think (`thinking.vrma`) or EMAGE speech causes the avatar to slouch, bow, or hunch forward (弯腰、探颈、躯干前倾)，破坏立姿挺拔美感。  
> **Root Cause**:
> 1. **AI 动捕动作前倾偏置 (Thoracic Kyphosis in AI Motion)**: SimpleText2Motion (SMPL-H) 训练的思考动作在 `upperChest` 产生高达 $+10.34^\circ$、`spine` $+5.69^\circ$、`neck` $+5.77^\circ$ 的前屈俯仰角 (Pitch, $+X$)，四关节累计前倾超过 $21.8^\circ$。
> 2. **站立微屈膝导致重心下沉**: FootIK 在静止待机时若引入微屈角，会导致骨盆高度下降，躯干为了重心平衡产生代偿性前倾。
> 3. **垂直视线下拉侵蚀头颈**: 当镜头位于胸口水平时，下视俯仰角若未充分衰减，会将颈部与头部强行向下前方拉扯。
> 
> **Solution & Rules**:
> 1. **站立待机膝盖自然挺拔**: 平地站立待机与双腿对称承重时，`FootIK` 的 `flexion` 严格归零 ($0.0\text{ rad}$)，彻底保障 160.1cm 标准身高与挺拔腿线。
> 2. **管线终点合成器生理俯仰角限幅 (`TORSO_PITCH_LIMITS`)**: 相对 bind-pose rest 限幅，在 Quintic 之前对 `basePose`/`actionPose` 执行 `clampTorsoPitch`：`hips` ($-0.015 \sim 0.03$)、`spine`/`chest` ($-0.015 \sim 0.02$)、`upperChest` ($-0.02 \sim 0.025$)。BodyTurn 只覆盖腿，不替换 `hips` 旋转。
> 3. **Gaze 叠在解剖姿态上**: draft 上 `neck/head.quaternion.multiply(lookAtQ)`，再采样进 compose。切源快照必须反 LookAt。气泡锚点用 `getHeadTopWorldPosition`（raw 头顶），不要用标准化 `head` + 0.24m。

> [!CAUTION]
> ### Pitfall 6: FootIK vs. Idle Conflict & Locomotion Step Integrity (FootIK 待机冲突与踱步完整性保障)
> **Symptom 1**: Avatar's knees visibly bent forward in idle, and rotating the camera or breathing caused vertical pelvis/head jittering.  
> **Symptom 2**: When orbiting the camera, the stepping foot would occasionally snap down mid-stride, hitching the pelvis and jerking the upper body, followed by redundant micro-steps.  
> 
> **Root Causes**:
> 1. **FootIK Over-Constraint in Idle**: The 2-bone analytical IK solver calculates knee flexion from femoral root (`hips`) to ground target anchor. In idle, `NaturalIdleSystem` drives subtle vertical breathing; FootIK interpreted this height variance as leg extension/compression, forcibly bending the knees forward and creating an algebraic feedback loop on `hips.position.y`.
> 2. **Stepping Truncation Mid-Stride**: The turning state machine previously forced `phase = PLANT` whenever remaining yaw dropped below threshold during `LIFT` or `SWING`. Truncating a mid-air foot instantaneously slammed it down, creating severe pelvic jolts.
> [!CAUTION]
> ### Pitfall 7: VRM 0.x / 1.0 Unified Pipeline Mapping (VRM 0.x / 1.0 全局动作管线统一适配规范)
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



