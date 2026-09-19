# Procedural Locomotion Stepping & Gaze Tracking Systems

> **Core Files**:  
> - [`src/motion/constraints/bodyTurn.ts`](../src/motion/constraints/bodyTurn.ts) (Procedural physical locomotion stepping state machine)  
> - [`src/motion/constraints/gaze.ts`](../src/motion/constraints/gaze.ts) (Companion gaze, micro-saccades & blink controller)  
> - [`src/motion/pipeline/motionPipeline.ts`](../src/motion/pipeline/motionPipeline.ts) (`tick()`: BodyTurn in Layer-2; FootIK + Gaze on the draft before `composeLayeredSmooth`)

---

## 1. System Objectives

When orbiting the camera around an avatar, naively rotating `vrm.scene.rotation.y` produces an artificial, floating swivel effect.
Project XiaoChun couples two complementary systems to deliver organic presence:
1. **`BodyTurnSystem`**: Drives procedural footsteps through spring yaw + stepping + pelvic weight shift + settle. It does **not** rotate the spine.
2. **`GazeController`**: Delivers organic ocular micro-saccades, physiological blinking, contemplative eye wandering, and decoupled head tracking.

---

## 2. BodyTurnSystem: Procedural Stepping State Machine

### 2.1 Critical Damped Spring Yaw Tracking

When camera angle offset exceeds `TURN_START_THRESHOLD = 0.42 rad` ($\sim 24^\circ$), turning engages:
- **Spring Formulation**: Let target relative yaw be $\text{normYaw} \in [-\pi, \pi]$, stiffness $k = 7.0$;
- **Critical Damping**: $d = 2\sqrt{k} \approx 5.29$, guaranteeing smooth angular convergence with zero oscillations:
  $$F_{\text{yaw}} = k \cdot \text{normYaw} - d \cdot \omega_{\text{yaw}}$$
  $$\omega_{\text{yaw}} \leftarrow \text{clamp}\big(\omega_{\text{yaw}} + F_{\text{yaw}} \cdot \Delta t, \; -3.5, \; 3.5\big)$$
  $$\Delta \text{Yaw}_{\text{scene}} = \omega_{\text{yaw}} \cdot \Delta t$$
- **Stopping Deadband & Anti-Overstepping**: Once the offset drops below `TURN_STOP_THRESHOLD = 0.20 rad` ($\sim 11.5^\circ$), `isTurning` flags false. When the active step completes its `SETTLE` phase, if the remaining angle is within $11.5^\circ$, the character immediately settles into `IDLE` on two planted feet without taking an unnecessary, redundant extra step. Remaining minor angles are absorbed naturally by `GazeController`.

### 2.2 Four-Phase Stepping State Machine

During locomotion, alternating legs progress through four physiological phases. **A step once started is guaranteed to complete its full cycle (`LIFT -> SWING -> PLANT -> SETTLE`)**, eliminating mid-air abrupt truncations and pelvic jolting.

```
       [SP.LIFT] (0.18s)         [SP.SWING] (0.14s)
     Thigh lift + Knee flex       Knee extends + Ankle dorsiflex
              \                         /
               \                       /
                v                     v
              [SP.PLANT] (0.08s) -> [SP.SETTLE] (0.18s)
                 Foot touches down     Weight shifts, return to center
```

| Phase (`SP`) | Duration | Stepping Leg Action | Support Leg Action | Pelvic Sway (`Hip Sway`) |
| :--- | :--- | :--- | :--- | :--- |
| **`LIFT`** | 0.18s | Thigh lifts $-0.30\text{ rad}$, knee flexes $+0.70\text{ rad}$, ankle $-0.12\text{ rad}$ | Stays upright & grounded | Pelvis lateral sway subdued ($0.9\text{ cm}$) to decouple upper torso |
| **`SWING`** | 0.14s | Thigh stays raised, lower leg extends, ankle returns | Firm support | Upper torso remains steady and upright |
| **`PLANT`** | 0.08s | Leg slerps smoothly to ground | Prepares transition | Foot touches down naturally |
| **`SETTLE`** | 0.18s | Both legs settle to neutral; swaps stepping leg if turn continues | Symmetric settle | Centers over base of support; transitions to `IDLE` if $\le 11.5^\circ$ |

### 2.3 No spine yaw

BodyTurn owns `vrm.scene.rotation.y` and **legs only** (`LEGS_MASK`). Hip rotation stays with Layer-1. `spine` / `chest` / `upperChest` stay with Layer-1. Gaze multiplies LookAt on the draft VRM; compose follows that head.

---

## 3. GazeController: Companion Eye & Head Tracking

### 3.1 Anatomical Range Clamping

To prevent unnatural eye rolling or extreme neck twists, the controller clamps world angles:
- **Yaw Range**: $[-0.80\text{ rad}, \; +0.80\text{ rad}]$ ($\pm 45.8^\circ$);
- **Pitch Range**: $[-0.42\text{ rad}, \; +0.38\text{ rad}]$ (Elevation $\le 24^\circ$, Depression $\le 21.7^\circ$).

### 3.2 Micro-Saccades & Glancing Away

Natural human gaze continuously shifts with subtle subconscious dynamics:
1. **Micro-Saccades**: Every $2\sim 4\text{ seconds}$, gaze target shifts randomly within a $1.5\sim 3\text{ cm}$ radius around the lens;
2. **Glance-Away**: A $20\%$ probability triggers a brief $1.2\text{s}$ deflection downward/sideways before returning to camera contact;
3. **Auto-Blink**: Periodic $3.0 \pm 1.5\text{s}$ cycles trigger smooth $0.15\text{s}$ eyelid closures.

---

## 4. Critical Architecture Rules

> [!CAUTION]
> ### Rule 1: Bone Filtering in Stepping Handoffs (`handleBodyTurnHandoff`)
> Stepping overlays `LEGS_MASK` only. Do not slerp hip rotation or spine from BodyTurn. `MotionTransitionManager` is unused on this path.

> [!IMPORTANT]
> ### Rule 2: FootIK Yields Completely During Stepping & Isolated to EMAGE
> Inside the render loop:
> ```typescript
> const locomotionBusy = isStepping || locomotionWeight > 0.08;
> const wantFootIk = writer === 'emage' && enableFootIK && !locomotionBusy;
> // rising edge: recapturePlantFromCurrent() + anchorToCurrentFeet()
> // then fade footIkMix (in damp 6 / out damp 14) and solve only while wantFootIk
> ```
> - **Idle & Clip Bypass**: FootIK does not `solve` outside EMAGE.
> - **Locomotion Yield**: While BodyTurn owns the legs, skip `solve` and `levelFeet` so stride ankles are not flattened or yanked to the speech plant.
> - **Step-End Plant**: After `locomotionWeight` settles, recapture plants from the new stance, then fade FootIK back. Do not recapture on the `isStepping` falling edge while mix is still 1.
