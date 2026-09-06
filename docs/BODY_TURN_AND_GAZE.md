# Procedural Locomotion Stepping & Gaze Tracking Systems

> **Core Files**:  
> - [`src/motion/bodyTurn.ts`](../src/motion/bodyTurn.ts) (Procedural physical locomotion stepping state machine)  
> - [`src/motion/gazeController.ts`](../src/motion/gazeController.ts) (Companion gaze, micro-saccades & blink controller)  
> - [`src/core/vrmEngine.ts`](../src/core/vrmEngine.ts) (Render loop coordination for stepping & gaze)

---

## 1. System Objectives

When orbiting the camera around an avatar, naively rotating `vrm.scene.rotation.y` produces an artificial, floating swivel effect.
Project XiaoChun couples two complementary systems to deliver organic presence:
1. **`BodyTurnSystem`**: Drives procedural footsteps through an "intent-first $\to$ stepping $\to$ pelvic weight shift $\to$ settle" biomechanical progression;
2. **`GazeController`**: Delivers organic ocular micro-saccades, physiological blinking, contemplative eye wandering, and decoupled head tracking.

---

## 2. BodyTurnSystem: Procedural Stepping State Machine

### 2.1 Critical Damped Spring Yaw Tracking

When camera angle offset exceeds `TURN_START_THRESHOLD = 0.90 rad` ($\sim 51.5^\circ$), turning engages:
- **Spring Formulation**: Let target relative yaw be $\text{normYaw} \in [-\pi, \pi]$, stiffness $k = 8.0$;
- **Critical Damping**: $d = 2\sqrt{k} \approx 5.657$, guaranteeing smooth angular convergence with zero oscillations:
  $$F_{\text{yaw}} = k \cdot \text{normYaw} - d \cdot \omega_{\text{yaw}}$$
  $$\omega_{\text{yaw}} \leftarrow \text{clamp}\big(\omega_{\text{yaw}} + F_{\text{yaw}} \cdot \Delta t, \; -4.0, \; 4.0\big)$$
  $$\Delta \text{Yaw}_{\text{scene}} = \omega_{\text{yaw}} \cdot \Delta t$$

### 2.2 Four-Phase Stepping State Machine

During locomotion, alternating legs progress through four physiological phases:

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
| **`LIFT`** | 0.18s | Thigh lifts $-0.20\text{ rad}$, knee flexes $+0.36\text{ rad}$, ankle $-0.12\text{ rad}$ | Stays upright & grounded | Pelvis shifts $1.8\text{ cm}$ toward support leg |
| **`SWING`** | 0.14s | Thigh stays raised, lower leg extends, ankle returns | Firm support | Sustains lateral balance |
| **`PLANT`** | 0.08s | Leg slerps smoothly to ground | Prepares transition | Shifts weight onto newly planted foot |
| **`SETTLE`** | 0.18s | Both legs settle to neutral; swaps stepping leg if turn continues | Symmetric settle | Centers over base of support |

### 2.3 Spine Pre-rotation (Intent-First Dynamics)

Human turns initiate through subtle thoracic and lumbar rotation before the feet move.
The system pushes `normYaw` into a temporal delay buffer:
- `upperChest`: Delay $\sim 80\text{ms}$, subtle factor $0.04$;
- `chest`: Delay $\sim 160\text{ms}$, subtle factor $0.03$;
- `spine`: Factor $0.01$;
Total spine yaw is bounded under $\le 0.08\text{ rad}$, providing natural anticipation without pulling the head away from camera gaze.

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
> When stepping concludes (`isStepping` toggles from `true` to `false`), a $0.30\text{s}$ transition smooths the final settling.  
> **Always pass `BODY_TURN_BONES`** (restricted strictly to `hips`, `upperLeg`, `lowerLeg`, `foot`, `toes`).  
> **Never include `head` or `neck` in stepping handoffs**, otherwise the transition manager fights against the real-time `LookAt` system and causes severe head jerking.

> [!IMPORTANT]
> ### Rule 2: FootIK Leveling Exits During Stepping
> Inside the render loop:
> ```typescript
> const isStepping = this.enableBodyTurn && this.bodyTurn.isStepping();
> this.footIK.levelFeet(vrm, isStepping);
> ```
> While stepping is active, `levelFeet` must exit immediately to preserve dynamic ankle dorsiflexion.
