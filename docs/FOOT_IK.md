# FootIK — Biomechanical Foot Ground Anchoring & Analytical IK System

> **File Reference**: [`src/motion/footIK.ts`](../src/motion/footIK.ts)  
> **Key Dependents**: [`src/core/vrmEngine.ts`](../src/core/vrmEngine.ts), [`src/motion/emagePlayer.ts`](../src/motion/emagePlayer.ts), [`src/motion/bodyTurn.ts`](../src/motion/bodyTurn.ts)

---

## 1. System Vision & Problem Statement

In 3D avatar animation driven by neural networks (e.g. EMAGE) or motion clips, the lower body frequently suffers from three major physical artifacts:
1. **Torso Floating / Suspension**: Avatars appear suspended in the air without genuine downward gravitational contact;
2. **Foot Skating**: Interpolation errors and clip blending cause the soles to drift across the floor plane, breaking the illusion of physical friction;
3. **Stiff Dual-Stance**: Real humans converse in a classical **contrapposto** poise—resting the majority of their weight on a primary pillar leg while the relaxed leg flexes slightly; standard algorithms keep both legs locked upright;
4. **Shoe-Off Air Gaps**: VRoid boots typically possess an outsole thickness of $4\sim 5\text{ cm}$. Hiding the shoes in the wardrobe leaves the character's bare feet floating in mid-air.

`FootIKSolver` solves these challenges via an **analytical two-bone inverse kinematics engine** paired with **biomimetic weight-shift kinematics**, maintaining 60 FPS performance with zero garbage collection (GC) pressure.

---

## 2. Mathematical Models & Implementation Details

### 2.1 Analytical Two-Bone Inverse Kinematics

For the leg chain comprising `upperLeg`, `lowerLeg`, and `foot`, the solver uses an exact closed-form solution based on the **Law of Cosines**, bypassing iterative numerical solvers (such as FABRIK or CCD) to eliminate multi-frame oscillation and convergence latency:

Let:
- Upper leg length be $l_1$, lower leg length be $l_2$;
- Femoral root (hip joint) world position be $\mathbf{P}_A$;
- Target ankle world ground anchor be $\mathbf{P}_T$;
- Displacement vector $\mathbf{V}_{AT} = \mathbf{P}_T - \mathbf{P}_A$, with Euclidean distance $d = \|\mathbf{V}_{AT}\|$.

```
       P_A (UpperLeg Root)
        /\
   l1  /  \ 
      /    \
     / θ_hip\
    /________\
   P_B (Knee) \ l2
               \
                \
                 P_T (Foot World Anchor)
```

To avoid hyper-extension deadlock:
$$d_{\text{clamped}} = \text{clamp}\big(d, \; |l_1 - l_2| + 0.02, \; (l_1 + l_2) \times 0.992\big)$$

Applying the Law of Cosines to calculate hip flexion $\theta_{\text{hip}}$:
$$\cos(\theta_{\text{hip}}) = \text{clamp}\left(\frac{l_1^2 + d_{\text{clamped}}^2 - l_2^2}{2 \cdot l_1 \cdot d_{\text{clamped}}}, \; -1, \; 1\right)$$
$$\theta_{\text{hip}} = \arccos\big(\cos(\theta_{\text{hip}})\big)$$

#### Forward Pole Vector & Knee Bend Plane
To ensure the knee always bends strictly forward along the anatomical sagittal plane without lateral flipping, the solver computes an orthogonal reference frame from the pelvis world rotation:
$$\mathbf{V}_{\text{forward}} = \mathbf{R}_{\text{hips}}^{\text{world}} \cdot \begin{bmatrix} 0 \\ 0 \\ 1 \end{bmatrix}$$
$$\mathbf{V}_{\text{normal}} = \text{normalize}(\mathbf{V}_{AT} \times \mathbf{V}_{\text{forward}})$$
$$\mathbf{V}_{\text{bend}} = \text{normalize}(\mathbf{V}_{\text{normal}} \times \mathbf{V}_{AT})$$

The adjusted upper leg orientation combines the direct displacement and bend vectors:
$$\mathbf{V}_{\text{upper}}^{\text{new}} = \mathbf{V}_{AT} \cdot \cos(\theta_{\text{eff}}) + \mathbf{V}_{\text{bend}} \cdot \sin(\theta_{\text{eff}})$$

---

### 2.2 Physical World Ground Anchoring

To eliminate foot skating:
1. **Anchor Capture**: During `bind(vrm)`, the solver captures the initial rest position of each foot relative to the avatar root: $\mathbf{P}_{\text{local}}^{\text{rest}}$;
2. **Per-Frame World Projection**: In each frame, anchor targets update according to the scene matrix:
   $$\mathbf{P}_{\text{anchor}}^{\text{world}} = \text{applyMatrix4}\big(\mathbf{P}_{\text{local}}^{\text{rest}}, \; \mathbf{M}_{\text{scene}}^{\text{world}}\big)$$
3. **Exponential Smoothing**:
   $$\text{target} \leftarrow \text{target} + (\mathbf{P}_{\text{anchor}} - \text{target}) \times (1 - e^{-15 \Delta t})$$
   The primary weight-bearing foot remains firmly planted at $\mathbf{P}_{\text{anchor}}$, locking horizontal drift to $0\text{ mm}$.

---

### 2.3 Biomimetic Weight Shift & Contrapposto

A human pelvis naturally translates laterally over the weight-bearing foot ($3.8\sim 4.2\text{ cm}$) to form an aligned vertical support column:

1. **Continuous Stance Ratio $sr \in [0, 1]$**:
   - $sr = 0.0$: 100% Left leg support;
   - $sr = 1.0$: 100% Right leg support;
   - Transition speed $\text{transferSpeed} = 3.5$ (yielding smooth, unhurried 1.2s~1.5s weight transitions).
2. **Lateral Pelvis Translation**:
   $$\Delta X_{\text{pelvis}} = (sr - 0.5) \cdot 2.0 \cdot \min(0.042\text{ m}, \; \text{halfSpan} \times 0.40)$$
3. **Pelvic Roll & Spinal Counter-Compensation**:
   The weight-bearing hip elevates by $\sim 2.4^\circ$ ($0.042\text{ rad}$), producing an aesthetic S-curve silhouette. The lumbar spine compensates in the reverse direction by $82\%$, maintaining an upright chest and head:
   $$\Delta \mathbf{Q}_{\text{hips}}^{\text{roll}} = \text{fromAxisAngle}\left(\hat{z}, \; -\text{stanceDir} \times 0.042\right)$$
   $$\Delta \mathbf{Q}_{\text{spine}}^{\text{roll}} = \text{fromAxisAngle}\left(\hat{z}, \; +\text{stanceDir} \times 0.042 \times 0.82\right)$$
4. **Physiological Knee Flexion Bias**:
   - **Support Leg**: Retains a tiny $0.015\text{ rad}$ ($\approx 0.9^\circ$) buffer to avoid mechanical joint locking;
   - **Relaxed Leg**: Enters a natural $0.16\text{ rad}$ ($\approx 9.2^\circ$) flexion, recreating organic standby poise.

---

### 2.4 Foot Geometry Detection & Auto-Sink Compensation

To handle footwear toggles in the wardrobe:
1. **Vertex-Level Geometry Sampling (`detectFootGeometry`)**:
   Samples mesh vertices with `shoes`/`boot` materials versus `body`/`skin` materials, identifying the exact outsole drop:
   $$\Delta h_{\text{sink}} = \min(Y_{\text{body}}) - \min(Y_{\text{shoes}}) \approx 0.039\text{ m} \sim 0.046\text{ m}$$
2. **Adaptive Scene Sink**:
   When shoes are toggled off, `barefootFactor` damps smoothly to $1.0$, lowering the root scene:
   $$Y_{\text{scene}} = Y_{\text{base}} - \text{autoBarefootSink} \times \text{barefootFactor}$$
   The bare feet make flush, solid contact with the floor.
3. **Ground Leveling (`levelFeet`)**:
   Aligns foot world pitch and roll flat with the floor plane (and cancels high-heel pitch for barefoot models), keeping soles flush and toes level.

---

## 3. Critical Architecture Rules & Coordination

> [!CAUTION]
> **Rule 1: Yielding During Locomotion Stepping (`isStepping`)**  
> When [`BodyTurnSystem`](../src/motion/bodyTurn.ts) executes procedural stepping, `levelFeet(vrm, isStepping)` must exit immediately if `isStepping === true`! Forcing ankle leveling during steps destroys ankle dorsiflexion and breaks stepping visuals.

> [!IMPORTANT]
> **Rule 2: FootIK vs. VRMBodyMorph Separation of Concerns**  
> - `FootIK` governs physical floor contact, weight-shift kinematics, and sole leveling;
> - `VRMBodyMorph` governs skeletal scale and limb-length height offsets (`getLegHeightDelta`);
> - **Neither system may use `quaternion.copy(baseRot)` to wipe leg transforms**. Upper and lower leg orientations belong strictly to the motion and stepping pipelines.

---

## 4. Developer API Quick Reference

```typescript
import { vrmEngine } from '@/core/vrmEngine';

// 1. Shift primary weight-bearing leg (smooth 1.2s transition)
vrmEngine.footIK.stanceLeg = 'right'; // or 'left'
vrmEngine.footIK.stanceRatio = 0.8;   // Continuous stance control

// 2. Enable/Bypass FootIK (useful for debugging raw EMAGE motions)
vrmEngine.emagePlayer.enableFootIK = true;

// 3. Query dynamic shoe-off sink compensation
const sinkOffset = vrmEngine.footIK.getSinkOffset(); // 0 when shod, ~0.046m barefoot
```
