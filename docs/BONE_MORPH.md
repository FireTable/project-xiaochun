# Biomechanical Bone Morphing & Orthogonal Decoupling Engine (BONE_MORPH.md)

> **Document Version**: 2.0  
> **Status**: Production Engineering Standard  
> **Target Audience**: AI Coding Agents, Graphics Engineers, Technical Artists  
> **Primary Source Code**: [`src/core/morph/vrmBodyMorph.ts`](../src/core/morph/vrmBodyMorph.ts), [`src/config.ts`](../src/config.ts), [`src/components/dev-drawer/`](../src/components/dev-drawer/)

---

## 1. Architectural Philosophy: The Three Axioms of Bone Morphing

In standard 3D skeletal animation systems (such as Three.js / `@pixiv/three-vrm`), bone hierarchies are strictly parent-child inherited:
$$\mathbf{M}_{\text{world}}^{\text{child}} = \mathbf{M}_{\text{world}}^{\text{parent}} \times \mathbf{M}_{\text{local}}^{\text{child}}$$

Directly scaling bones often leads to severe cascade bugs:
* **Center-Out Symmetrical Swelling**: Scaling a bone along the Z-axis expands both forward and backward equally, causing back thickness to push out an unintended "beer belly", or butt scaling to protrude the lower abdomen.
* **Non-Aligned Shear Distortions**: When parent and child bones possess resting angular inclinations (e.g., Spine at $+1.5^\circ$, Chest at $-15.7^\circ$, Neck at $+26.2^\circ$), non-uniform scaling multiplies with rotation matrices to generate off-diagonal shear, flattening heads or curving posture forward.
* **Locomotion Breaking**: Broadening the hips can inadvertently splay the feet into an unnatural duck stance.

To resolve these challenges, the **VRMBodyMorph** engine establishes three non-negotiable axioms:

```
1. Anatomical Anchor Locking    ➔   2. One-Way Directional Growth    ➔   3. Child Inverse Compensation
(Define the unmovable surface)       (Convert 2-way expansion to 1-way)       (Cut off cascade to downstream bones)
```

1. **Anatomical Boundary Locking (地锚锁死原则)**: Identify the fixed anatomical boundary (e.g., flat abdomen wall, ground-planted feet, upright skull). Compute the forward expansion amount $\Delta Z = Z_{\text{front}} \times (S_z - 1.0)$ and apply an immediate reverse translation $-\Delta Z$ to the bone, keeping the anchor boundary completely static ($0.000000\text{ mm}$ drift).
2. **Downstream Inverse Compensation (级联逆补偿原则)**: Whenever a parent bone undergoes compensatory translation or scaling, its immediate child joints (e.g., `UpperChest` under `Chest`, or `Knee` under `UpperLeg`) invert the transformation ($1 / S_z$ and $-\Delta Z$) to preserve downstream world-space alignment.
3. **Bone vs. Soft-Tissue Separation (骨架与软组织分治原则)**: Rigid and semi-rigid structural proportions (shoulders, height, torso thickness, limb lengths) are handled via skeletal transforms. Localized soft-tissue adiposity (such as belly fullness / roundness) is governed through **procedural vertex morphing**, completely isolating it from spinal curves and waist thickness.

---

## 2. Complete Morph Adjustment Parameters Matrix

The system currently exposes **28 fine-grained morph parameters**, categorized into 6 functional biomechanical layers. All parameters default to neutral (`1.00` scale or `0.00` offset):

| Key | Category | Default | Range (Limits) | Step | Biomechanical Target | Boundary Locking & Decoupling Strategy |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`overallScale`** | Global | `1.00` | `0.70 ~ 1.30` | `0.01` | Uniform character scale | Placed at `vrm.scene.scale` level; preserves bone relative proportions. |
| **`head`** | Head / Neck | `1.00` | `0.85 ~ 1.20` | `0.01` | Cranial ratio / chibi scale | Independent world matrix composition; 11 hair root bones & eyes inherit cleanly. |
| **`neck`** | Head / Neck | `1.00` | `0.70 ~ 1.40` | `0.02` | Lateral neck width (X-axis) | Inverse scaled on Head; skull width is 100% orthogonal to neck thickness. |
| **`neckDepth`** | Head / Neck | `1.00` | `0.70 ~ 1.40` | `0.02` | Neck sagittal thickness (Z-axis) | Inverse scaled on Head; eliminates cranial flattening or neck elongation. |
| **`neckLength`** | Head / Neck | `1.00` | `0.80 ~ 1.30` | `0.01` | Cervical spine vertical span | Vertical translation along cervical vector; head pitch unchanged. |
| **`shoulderWidth`**| Torso / Shoulders | `1.00` | `0.75 ~ 1.35` | `0.01` | Clavicle span (Shoulder width) | Symmetrical X-axis translation on `leftShoulder` & `rightShoulder`. |
| **`torsoLength`** | Torso / Shoulders | `1.00` | `0.75 ~ 1.35` | `0.01` | Lumbar spine length (Height) | Pure orthogonal vertical translation ($60\%$ Chest, $40\%$ UpperChest); body Z-tilt is $0^\circ$. |
| **`torsoThickness`**| Torso / Shoulders | `1.00` | `0.70 ~ 1.40` | `0.01` | Torso sagittal depth (Back & Waist) | Drives Chest & Spine concurrently; front chest & abdomen locked flat, growth directed to back. |
| **`waist`** | Torso / Shoulders | `1.00` | `0.70 ~ 1.40` | `0.02` | Hourglass waist width (X-axis) | Pure lateral scaling of Spine (lumbar curve); Chest, UpperChest, shoulders, and sagittal depth are 100% decoupled. |
| **`belly`** | Torso / Shoulders | `1.00` | `0.70 ~ 1.80` | `0.01` | Abdomen protrusion / flatness | **Procedural vertex morph**: 687 front abdominal vertices deformed via smooth cosine falloff; spine curve & waist thickness are 100% untouched. |
| **`hips`** | Hips / Pelvis | `1.00` | `0.70 ~ 1.50` | `0.02` | Pelvic lateral width (Hourglass) | Transverse X-axis expansion; abdomen and lower back remain flat. |
| **`buttocks`** | Hips / Pelvis | `1.00` | `0.70 ~ 1.20` | `0.01` | Gluteus volume & projection | Pelvis pushed back by $-(S_z - 1.0) \times 0.045$ to lock the lower stomach boundary completely flat. |
| **`buttocksThickness`**| Hips / Pelvis | `1.00` | `0.70 ~ 1.20` | `0.01` | Gluteal Z-axis projection | Pure posterior expansion; zero vertical torso distortion. |
| **`buttocksPitch`** | Hips / Pelvis | `0.00` | `-0.20 ~ +0.20` | `0.01` | Pelvic tilt (Upright / Droop) | $100\%$ counter-rotated on upper leg bones; legs remain plumb vertical in world space. |
| **`buttocksSpread`**| Hips / Pelvis | `0.00` | `-0.05 ~ +0.08` | `0.002`| Outer gluteal & saddlebag curve | **Knee-Foot Ground Anchor Alignment**: Outer femur spread is negated at the knee; feet remain planted together. |
| **`bust`** | Bust (Chest) | `1.00` | `0.60 ~ 2.20` | `0.02` | Overall bust volume | Scaled on `J_Sec_[LR]_Bust1`; decoupled from torso thickness. |
| **`bustThickness`** | Bust (Chest) | `1.00` | `0.60 ~ 1.80` | `0.02` | Forward bust projection (Z-axis) | Sagittal bust extension without widening the ribcage. |
| **`bustPitch`** | Bust (Chest) | `0.00` | `-0.30 ~ +0.30` | `0.01` | Bust elevation / ptosis | Dual rotation ($1.5\times$) + base vertical translation; natural perky vs. downward drape. |
| **`bustSpread`** | Bust (Chest) | `0.00` | `-0.04 ~ +0.06` | `0.002`| Cleavage convergence / outward spread | Symmetrical lateral displacement of bust roots. |
| **`arms`** | Arms / Hands | `1.00` | `0.70 ~ 1.40` | `0.02` | Upper & lower arm thickness | Scaled on arm cross-sections; hand size is decoupled. |
| **`armLength`** | Arms / Hands | `1.00` | `0.80 ~ 1.20` | `0.01` | Arm reach | Longitudinal scaling along local X-axis. |
| **`hands`** | Arms / Hands | `1.00` | `0.70 ~ 1.30` | `0.01` | Palm and hand size | Normalized against arm length and thickness. |
| **`fingerWidth`** | Arms / Hands | `1.00` | `0.60 ~ 1.50` | `0.02` | Finger joint cross-section | Applied strictly to Y/Z cross-section of 30 finger phalanges; finger lengths remain constant. |
| **`thighs`** | Legs / Feet | `1.00` | `0.70 ~ 1.60` | `0.02` | Upper leg thickness | Normalized against pelvic scale; calf thickness decoupled. |
| **`thighLength`** | Legs / Feet | `1.00` | `0.80 ~ 1.30` | `0.01` | Femur length | Longitudinal displacement; calf root compensates dynamically. |
| **`calves`** | Legs / Feet | `1.00` | `0.70 ~ 1.50` | `0.02` | Lower leg thickness | Normalized against thigh scale; foot size decoupled. |
| **`calfLength`** | Legs / Feet | `1.00` | `0.80 ~ 1.30` | `0.01` | Tibia / lower leg length | Dynamic height contributor to FootIK ground plane. |
| **`feet`** | Legs / Feet | `1.00` | `0.70 ~ 1.30` | `0.01` | Shoe & foot size | Three-axis proportional scaling without altering ankle height. |

---

## 3. Mathematical Foundations & Implementation Details

### 3.1 Torso Thickness (`torsoThickness`) & Hips-Relative Orthogonal Decoupling
In skeletal morphing, modifying the sagittal depth ($Z$-axis) of the spine chain (`Spine` and `Chest`) requires isolating the thoracic depth without disrupting the master structural height of the avatar.
To guarantee that neither limb-length modifications (`thighLength`) nor holistic scaling (`overallScale`) causes torso stretching or proportion tearing:

1. **Relative Chain Invariance**: `UpperChest`, `Shoulders`, and `Neck` are maintained strictly within the native relative `Hips` hierarchy, eliminating hardcoded world-space coordinate traps.
2. **Anatomical Physiological Scaling**:
$$\text{spineThickFactor} = 1.0 + (\text{torsoThickness} - 1.0) \times 0.70$$
$$\text{chestThickFactor} = 1.0 + (\text{torsoThickness} - 1.0) \times 0.50$$
$$\text{targetSpineZ} = \text{spineThickFactor}$$
$$\text{targetChestZ} = \text{chestThickFactor}$$
$$\text{targetChestX} = 1.0 \implies S_{\text{Chest}, x}^{\text{world}} = S_{\text{Spine}, x}^{\text{world}} \times \frac{1.0}{\text{targetSpineX}} \equiv 1.000000$$
$$\text{torsoZComp} = -(\text{torsoThickness} - 1.0) \times 0.015\text{ m}$$

3. **UpperChest Z-Offset Counteraction**:
$$\mathbf{P}_{\text{UpperChest}, z} = \frac{\mathbf{P}_{\text{base}, z} + \text{deltaUpperChest}_z - \text{torsoZComp}}{\text{targetChestZ}}$$

**Result**:
* **Limb Independence**: Changing `thighLength` alters leg height while torso length maintains $0.000000\text{ mm}$ elongation error.
* **Scale Integrity**: Adjusting `overallScale` scales the avatar smoothly and uniformly without mesh shearing or clipping.
* **Organic Spinal Curvature**: Smooth, elegant lumbar lordosis and thoracic curve with zero unnatural lumps or creases.

### 3.2 Procedural Abdominal Morphing (`belly`)
Instead of distorting the spinal chain, `belly` operates via a **cosine smooth falloff vertex deformation** over the front abdominal wall ($Y \in [0.94, 1.13]$, $Z > 0.03$, $|X| < 0.11$):
$$r_x = \frac{|p_x|}{0.11}, \quad r_y = \frac{|p_y - 1.03|}{0.09}$$
$$W = \cos\left(r_x \cdot \frac{\pi}{2}\right) \times \cos\left(r_y \cdot \frac{\pi}{2}\right) \times \min\left(1.0, \frac{p_z - 0.03}{0.04}\right)$$
$$\Delta z_i = (\text{belly} - 1.0) \times W_i \times 0.032\text{ m}$$

* At $180\%$, the lower abdomen expands forward smoothly by up to $+2.56\text{ cm}$.
* At $70\%$, the stomach contracts into a flat, toned aesthetic.
* **Spine bones are 100% unmutated**: Lumbar thickness, curvature, and lordosis remain perfectly preserved. Clothing and underwear meshes share the geometry buffer, guaranteeing **zero texture clipping or poke-through**.

### 3.3 Buttocks Size, Pure Leg Decoupling & Knee-Foot Ground Anchor Alignment
1. **100% Orthogonal Leg Decoupling**: Because `leftUpperLeg` and `rightUpperLeg` descend from `Hips`, changes in pelvic depth $h_z$ normally distort leg sagittal thickness. `VRMBodyMorph` cancels this out exactly:
$$S_{\text{thigh}, z}^{\text{local}} = \frac{S_{\text{thigh}, z}^{\text{target}}}{h_z}, \quad S_{\text{calf}, z}^{\text{local}} = \frac{S_{\text{calf}, z}^{\text{target}}}{S_{\text{thigh}, z}^{\text{target}}}$$
**Result**: Thigh and calf sagittal thickness remain 100% invariant ($0.0000\text{ error}$) across all buttocks values; legs never flatten like paper sheets or swell unintentionally.
2. **Pelvic Protrusion & Mild Anterior Lock**: $h_z$ applies a mild physiological curve ($1.0 + (\text{buttocks} - 1.0) \times 0.55 + \dots$) and translates back by $-(\text{hz} - 1.0) \times 0.020\text{ m}$, keeping anterior abdomen lines clean without pelvic collapse.
3. **Knee Alignment**: When spreading buttocks width (`buttocksSpread`), the upper legs displace laterally by $+ \Delta X$. The knee joint applies an equal and opposite shift $-\Delta X / S_{\text{thigh}, x}$:
$$\mathbf{P}_{\text{knee}, x} = \mathbf{P}_{\text{base}, x} - \frac{\text{legSpreadX}}{S_{\text{thigh}, x}}$$
**Result**: Thigh roots and saddlebags broaden voluptuously, while calves and feet remain strictly vertical and planted flat on the floor.

### 3.4 Pelvic Hourglass Shaping (`hips`) & Smooth Knee Step Transition (`thighs`)
1. **Hourglass Pelvic Curve**: Rather than aggressively scaling the pelvic bones by $1.5\times$, `hips` applies a physiological curve:
$$h_x = 1.0 + (\text{hips} - 1.0) \times 0.45$$
Eliminates knife-sharp groin creasing while providing an hourglass silhouette.
2. **Knee Joint Continuity**: Calves scale inversely relative to $\sqrt{\text{thighs}}$ rather than $\text{thighs}$, removing step-like discontinuous creases across the knee.

### 3.5 Safe Cleavage Spread Rotation (`bustSpread`)
To prevent internal bra mesh clipping and sternum tearing under large spread values:
$$\Delta X = \text{bustSpread} \times 0.25\text{ m}, \quad \text{Yaw} = \pm \text{bustSpread} \times 0.60\text{ rad}$$
Bust lobes flare outward gracefully without tearing the cleavage seams.

### 3.6 Shear-Free Head Matrix Composition
Because the VRM Neck has an intrinsic $+26.2^\circ$ pitch, applying non-uniform scale to Neck introduces severe shear onto Head children (distorting eyes and hair).
`VRMBodyMorph` solves this by:
1. Setting `rawHead.matrixWorldAutoUpdate = false`.
2. Sampling neck world position and quaternion.
3. Explicitly composing the Head world transform:
$$\mathbf{M}_{\text{world}}^{\text{Head}} = \text{compose}\left(\mathbf{P}_{\text{neck}}^{\text{world}} + \mathbf{R}_{\text{neck}}^{\text{world}}(\mathbf{O}_{\text{head}}), \; \mathbf{R}_{\text{neck}}^{\text{world}} \times \mathbf{R}_{\text{head}}^{\text{local}}, \; \mathbf{S}_{\text{head}} \times \text{overallScale}\right)$$
Eye globes and 11 hair bones inherit a pure, unskewed orthogonal frame.

---

## 4. Developer API & Usage Guide

### 4.1 Programmatic Scaling
```typescript
import { vrmEngine } from '@/core/vrmEngine';

// Update a single parameter dynamically
vrmEngine.setBodyPartScale('torsoThickness', 1.25);
vrmEngine.setBodyPartScale('belly', 1.40);

// Get current live character height in centimeters (measured from mesh vertex crown)
const heightCm = vrmEngine.getCurrentHeightCm(); // e.g. 163.8
```

### 4.2 Resetting & Serialization
```typescript
// Reset all 28 parameters to default config and clear cached overrides
vrmEngine.resetBodyMorph();

// Fetch full config object
const config = vrmEngine.getBodyMorphConfig();
```

---

## 5. Summary Axiom for Future Feature Additions

When introducing any new morph slider:
> **"Never apply uncompensated asymmetrical bone scaling. Always establish an anterior or grounding anchor, cancel out forward drift, and invert translations at downstream child joints."**
