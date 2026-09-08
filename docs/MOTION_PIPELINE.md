# Universal Motion Pipeline & Seamless Blending Specification

> **Core Files**:  
> - [`src/motion/pipeline/motionPipeline.ts`](../src/motion/pipeline/motionPipeline.ts) (Pipeline orchestration & layered blend graph)  
> - [`src/motion/pipeline/universalMotion.ts`](../src/motion/pipeline/universalMotion.ts) (Universal motion ingestion controller)  
> - [`src/motion/pipeline/poseBuffer.ts`](../src/motion/pipeline/poseBuffer.ts) (53-bone zero-GC pose buffer & masks)  
> - [`src/motion/motionTransition.ts`](../src/motion/motionTransition.ts) (Quintic Smootherstep global transition manager)

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
        L2[BodyTurn: 4-Phase Stepping State Machine (Mask: LOWER_BODY)]
    end

    subgraph PostConstraints [Post Constraints & Physical Grounding]
        PC1[FootIK: Physical ground anchors + Contrapposto + Shoe-off sink]
        PC2[GazeController: LookAt tracking + Saccades + Blink]
        PC3[VRMBodyMorph: 28-parameter scale & anchor offsets]
    end

    L0 --> L1_Blend
    L1_Blend --> L2
    L2 --> PC1
    PC1 --> PC2
    PC2 --> PC3
    PC3 --> Screen[Three.js WebGLRenderer]
```

1. **Layer 0 (Base)**: Supplies foundational anatomical poise (relaxed finger curling, upright leg reference `restQ`);
2. **Layer 1 (Main Action)**: Coordinates mutually exclusive primary states, crossfaded via `MotionTransitionManager`;
3. **Layer 2 (Locomotion)**: Overrides only the lower body (`LOWER_BODY_MASK`), allowing procedural footsteps to rotate the character toward the camera without interrupting upper-body speech gestures or breathing;
4. **Post Constraints**: Applies physical ground anchoring (`FootIK`), optical gaze alignment (`LookAt`), and anatomical scale adjustments (`VRMBodyMorph`).

---

## 2.1 EMAGE as a Layer-1 streaming source

`EmagePlayer` feeds Layer 1 with co-speech poses. On tip `perf/edge-inference`:

- Inference runs in a Dedicated Worker with **wasm EP + INT8** (not WebGPU).
- Streaming uses per-window **`motion_chunk`** (T=64) with A/V hold until audible TTS.
- Hop / seam tunables live in `APP_CONFIG.emage.motion` (`advanceFrames` 60..64).

When `motion_chunk` streaming is active, the Director must **not** reset playhead via `applyMotionData` / `switchSegment` on each window. See [`EMAGE_MODEL.md`](EMAGE_MODEL.md) and [`CHAT_DIRECTOR.md`](CHAT_DIRECTOR.md).

**Source priority** (render loop): `universal` > `emage` > `vrma` > `idle`. `motionTransition` fires only on source change — not per chunk. Full speak orchestration diagram: [`CHAT_DIRECTOR.md`](CHAT_DIRECTOR.md#orchestration-flowchart-tip). Per-window Worker diagram: [`EMAGE_MODEL.md`](EMAGE_MODEL.md#31-single-window-worker-path-pcm--step--decode--chunk--seam).

## 3. Quintic Smootherstep Transition Algorithm

Linear quaternion interpolation ($\text{Slerp}$) exhibits discontinuous second derivatives at boundary boundaries ($t=0, t=1$), resulting in visible mechanical jerks.

The pipeline utilizes Ken Perlin's **Quintic Smootherstep** formulation:
$$S(t) = 6t^5 - 15t^4 + 10t^3 \quad (t \in [0, 1])$$
- First derivative: $S'(0) = S'(1) = 0$ (Zero initial & terminal velocity);
- Second derivative: $S''(0) = S''(1) = 0$ (Zero initial & terminal acceleration, eliminating inertial shock).

### Snapshot & Slerp Interpolation Workflow
1. **Trigger Instant**: Captures the current normalized local quaternions of all 52 humanoid bones into `fromPose`;
2. **Interpolation Phase**: Over physiological time windows ($0.70\text{s} \sim 0.88\text{s}$, approximately $42 \sim 53$ frames), evaluates weight $w = S(t / T)$ and computes:
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
> **Root Cause**: `GazeController` applies camera tracking multiplicatively at the end of each frame (`node.quaternion.multiply(lookAtQ)`). If the transition manager snapshots bones without compensation, the snapshot contains the gaze offset; during interpolation it gets multiplied again!  
> **Rule**:
> `motionTransition.startTransition(vrm, dur, lookAtOffsets)` must receive the active LookAt offsets and multiply snapshots by the inverse quaternion:
> $$\mathbf{Q}_{\text{snapshot}} = \mathbf{Q}_{\text{node}} \cdot \mathbf{Q}_{\text{lookAt}}^{-1}$$

> [!IMPORTANT]
> ### Pitfall 3: Zero-Buffer Commit Trap
> **Symptom**: Starting an animation causes the character to instantly collapse into a rigid T-Pose and sink into the floor.  
> **Root Cause**: Pre-allocated `PoseBuffer` objects initialize quaternions to `(0,0,0,1)` and position to `(0,0,0)`. Directly calling `commitToVRM` without evaluating all layers overwrites the skeleton with zero transforms.  
> **Rule**:
> The render loop must strictly adhere to the **non-destructive read-only sampling principle** (`motionPipeline.finalPose.sampleFromVRM(vrm)`). Never blindly commit unverified buffer states to the skeleton.
