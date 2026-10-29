# Procedural Biomechanical Motion & Skeletal Rig Guide

> **Core Files**:
> - [`src/motion/sources/idle.ts`](../src/motion/sources/idle.ts) (`NaturalIdleSystem` standby breathing base)
> - [`src/motion/sources/listening.ts`](../src/motion/sources/listening.ts) (`ListeningMotionSystem` independent listening motion source)
> - [`src/motion/pipeline/poseBuffer.ts`](../src/motion/pipeline/poseBuffer.ts) (52 standard humanoid bone indices and pose buffers)
> - [`src/motion/pipeline/motionPipeline.ts`](../src/motion/pipeline/motionPipeline.ts) (Single-writer pipeline scheduler and layered blending)
> - [`src/motion/biomechanics.ts`](../src/motion/biomechanics.ts) (Sagittal pitch biomechanical limit clamping)

---

## 1. Why Procedural Rig Code Often Moves "Backwards"

When implementing procedural bone animations with Three.js and VRM, developers and AI agents frequently encounter disorienting pitfalls: **arms extending horizontally into a T-pose instead of hanging down, elbows bending backwards into the torso, or fingers dislocating backward instead of curling into a fist**.

These counter-intuitive behaviors stem from fundamental misconceptions about standard 3D humanoid skeletal coordinate systems:

### Trap 1: The T-Pose Zero-Baseline Trap
- In the normalized VRM bone coordinate system, the Euler rotation zero `(0, 0, 0)` **is not a natural resting posture with arms at the sides; it is a horizontal T-pose**!
- If you set an arm bone's rotation to `0` or a near-zero value, the character will not lower its arm, but will **hold it horizontally out like airplane wings**.
- **The true physical Euler angles for resting arms hanging naturally at the sides are**:
  - Left Upper Arm (`leftUpperArm`): `Z ≈ -1.33 rad` (~ -76°)
  - Right Upper Arm (`rightUpperArm`): `Z ≈ +1.33 rad` (~ +76°)

### Trap 2: Left/Right Skeletal Asymmetry & Reflection Signs
- In the VRM humanoid standard:
  - The left arm bone extends along `+X`, while the right arm bone extends along `-X`.
  - Consequently, **lowering the upper arm along the Z-axis requires a negative angle on the left, and a positive angle on the right**.
  - Pitching forward along the X-axis involves opposing directions in local bone coordinate spaces.
  - Copying parameters written for the left arm directly to the right arm without inverting signs will inevitably cause the right arm to **fly over the head or twist backwards behind the spine**.

### Trap 3: Hinge Joint Orientations (Elbows and Fingers)
- The elbow is a single-degree-of-freedom hinge joint. When the upper arm rests at the side:
  - Flexing the right forearm forward and upward towards the chest or chin requires **large positive `+Y` rotation (e.g., `Y ≈ +2.05 rad`)**.
  - Specifying `-Y` drives the elbow backward through the ribcage into the spine.
  - Finger flexion into a fist: Left hand curls with `-Z`, while right hand curls with `+Z`. Inverting the sign hyper-extends the knuckles backwards.

---

## 2. Standard VRM Local Bone Rotation Quick Reference

In Project XiaoChun, rotations follow Three.js's default `'XYZ'` Euler order unless noted otherwise. The following values are physically and biomechanically calibrated:

### 2.1 Pelvis & Torso (Hips, Spine, Chest)

| Bone | Axis | Positive (`+`) | Negative (`-`) | Biomechanical Limits & Recommended Ranges |
| :--- | :--- | :--- | :--- | :--- |
| `hips` | X (Pitch)<br>Y (Yaw)<br>Z (Roll) | Pelvis tilt back<br>Pelvis turn left<br>Pelvis roll right (left hip up) | Pelvis tilt forward<br>Pelvis turn right<br>Pelvis roll left (right hip up) | Weight-shift sway: `Roll: -0.026 ~ 0.026`<br>Micro-rotation: `Yaw: -0.03 ~ 0.03` |
| `spine` / `chest` / `upperChest` | X (Pitch)<br>Y (Yaw)<br>Z (Roll) | **Flexion forward (bow)**<br>Torso turn left<br>Torso lateral flex right | **Extension backward (lean back)**<br>Torso turn right<br>Torso lateral flex left | Sagittal clamp (`biomechanics.ts`): forward `< 0.025`, backward `> -0.02`<br>Idle breathing: `X: 0.01 ~ 0.05` |

### 2.2 Neck & Head

| Bone | Axis | Positive (`+`) | Negative (`-`) | Typical Posture Reference |
| :--- | :--- | :--- | :--- | :--- |
| `neck` | X (Pitch)<br>Y (Yaw)<br>Z (Roll) | Forward neck flexion<br>Yaw turn left<br>Roll tilt right | Backward neck retraction<br>Yaw turn right<br>Roll tilt left | Attentive listening lean: `X: 0.03 ~ 0.05` |
| `head` | X (Pitch)<br>Y (Yaw)<br>Z (Roll) | Pitch down (look down)<br>Yaw gaze left<br>**Roll tilt right** | Pitch up (look up)<br>Yaw gaze right<br>**Roll tilt left** | Playful head tilt: `Z: 0.06 ~ 0.09` (~4°~6°)<br>Nodding impulse: `X: 0.04 ~ 0.08` |

### 2.3 Arm Kinematic Chains (Most Common Inversion Pitfall)

#### Left Arm (Bone Extends Along +X)
- **Natural Hanging Rest Pose (at side)**:
  - `leftUpperArm`: `Euler(X: 0.04, Y: 0.02, Z: -1.33)` (**Z is negative**)
  - `leftLowerArm`: `Euler(X: 0.0, Y: 0.0, Z: 0.08)` (Elbow relaxed micro-flexion)
  - `leftHand`: `Euler(X: 0.04, Y: 0.0, Z: 0.0)` (Wrist natural suspension)

#### Right Arm (Bone Extends Along -X)
- **Natural Hanging Rest Pose (at side)**:
  - `rightUpperArm`: `Euler(X: 0.04, Y: -0.02, Z: 1.33)` (**Z is positive**)
  - `rightLowerArm`: `Euler(X: 0.0, Y: 0.0, Z: -0.08)` (Elbow relaxed micro-flexion)
  - `rightHand`: `Euler(X: 0.04, Y: 0.0, Z: 0.0)` (Wrist natural suspension)
- **Chin-Rest Pose (Folded Arm)**:
  - `rightUpperArm`: `Euler(X: -1.15, Y: 0.55, Z: 1.30)` (Upper arm pitched forward against chest)
  - `rightLowerArm`: `Euler(X: 0.0, Y: 2.05, Z: 0.25)` (**Elbow deeply flexed upward, hand directly under chin**)
  - `rightHand`: `Euler(X: 0.15, Y: -0.10, Z: 0.05)` (Wrist slightly cupping mandible base)

### 2.4 Finger Joint Flexion

Fingers consist of three phalanges: `Proximal`, `Intermediate`, and `Distal`, with thumbs including `Metacarpal`.

- **Curl / Flexion Rules (Fist / Chin Touch)**:
  - **Left Hand (All 5 Fingers)**: Rotating around Z in the **negative direction (`-Z`)** curls fingers inward into the palm.
  - **Right Hand (All 5 Fingers)**: Rotating around Z in the **positive direction (`+Z`)** curls fingers inward into the palm.
  - Curl amplitude guideline: Subtle curl `Z: 0.15 ~ 0.25`, half grip `Z: 0.35 ~ 0.55`, full fist `Z: 0.70 ~ 0.95`.

---

## 3. Golden Rules for Procedural Motion Authoring

### Rule 1: Motion Sources Must Be Independent Files (Protect the Single-Writer Architecture)
In Project XiaoChun, the motion pipeline is divided into two distinct layers:
- **`sources/` (Motion Sources, Produce Data Only)**: e.g. `idle.ts`, `listening.ts`, `vrma.ts`, `emage.ts`. They only write bone transforms into `PoseBuffer` and **must never mutate VRM Object3D nodes directly**.
- **`constraints/` (Post-processing Constraints)**: e.g. `gaze.ts` (eye & head tracking), `footIK.ts` (foot planting), `bodyTurn.ts` (physical stepping). Constraints must never generate full-body motion.

### Rule 2: Always Start from the Rest Hanging Baseline, Never from `(0, 0, 0)`
When authoring arm poses, the baseline must always be the hanging rest orientation (`Left Z: -1.33`, `Right Z: +1.33`).
- Never set upper arm roll to `0` or near-zero.
- Never mirror left arm values directly to the right arm without inverting signs.

### Rule 3: Inertial Damping & Respiratory Resonance (The Zero-Statue Rule)
- Mechanical stiffness comes from instantaneous angle changes and stone-like immobility.
- Always apply Quintic Smootherstep or critically damped springs:
  ```typescript
  this.weight = THREE.MathUtils.damp(this.weight, target, rate, delta);
  ```
- For self-contact poses (such as chin resting or hands on hips), respiratory oscillations (`Math.sin(time * 1.25)`) must be coupled to the `chest` driving source so the head, neck, and arms **rise and fall at the same frequency**, preventing the hand from clipping into the chin or floating in air.

### Rule 4: Run Forward Kinematics (FK) Sanity Checks Before Committing
Instead of launching the 3D frontend to eyeball poses, verify the palm world coordinates via a 1-line Node script in the terminal (e.g. checking chin target height `y ≈ +0.07`, depth in front of chest `z ≈ +0.18`):

```bash
node -e '
const THREE = require("three");
const u = new THREE.Vector3(-0.23, 0, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.15, 0.55, 1.30)));
const l = u.clone().add(new THREE.Vector3(-0.21, 0, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.15, 0.55, 1.30)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 2.05, 0.25)))));
console.log("Right elbow position:", u.toArray().map(v=>v.toFixed(2)));
console.log("Right palm target position:", l.toArray().map(v=>v.toFixed(2)));
'
```
- If `y < -0.30`: The hand is hanging down at the side.
- If `y > 0.05, z > 0.10`: The hand is raised correctly to the chin position in front of the chest.
- If `x < -0.20`: The arm is abducting out to the right; check rotation signs.
