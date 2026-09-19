# 3D Holographic Guides, Dynamics & Biomechanical Pipeline

## 1. Overview
Project XiaoChun introduces a revolutionary set of **3D Holographic Interaction Guides** directly embedded within the WebGL scene, replacing traditional 2D flat sliders with physical, in-world controls. Additionally, the physics and motion layer has been enhanced with localized mouse wind aerodynamics and pure quaternion biomechanical constraints.

---

## 2. 3D Holographic Guide Subsystems

### 2.1 Decoupled Interaction Controller (`src/core/interaction/interactionController.ts`)
The `InteractionController` manages all user-initiated 3D transformations, completely isolating mouse/touch manipulation logic from rendering routines:
- **Long-press adjust mode (all platforms)**: After `INTERACTION_TOUCH_ARM_MS` with finger/mouse almost still, guides appear; then drag for body yaw + camera pitch, or drag **CameraYGuide3D**. Idle `INTERACTION_GUIDE_AUTO_HIDE_MS` hides guides. Constants: `src/lib/constants.ts`.
- **Modifier shortcut (desktop)**: <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> enters the same guide state immediately.
- **Tauri short drag**: Move before arming cancels long-press and starts window drag (desk-pet).
- **Passthrough capture**: While guides are active / dragging, `passthroughManager.setInteracting(true)` so thin guide pixels are not treated as click-through.
- **Pinch / Scroll Zoom**: Smooth exponential zooming bounded by configured safe camera distances.

### 2.2 TurnGuide3D: Horizontal Yaw Guide Ring (`src/core/interaction/turnGuide3D.ts`)
- Renders an elliptical glowing ring on the ground at the character's feet.
- Features a reactive glowing light beacon that tracks and visualizes the character's `bodyTurn` yaw orientation in real time.
- Clicking or dragging the ring rotates the avatar smoothly without camera disorientation.

### 2.3 PitchGuide3D: Vertical Elevation Arc (`src/core/interaction/pitchGuide3D.ts`)
- Displays an elevation arc alongside the camera orientation.
- Provides visual feedback for camera pitch clamping, ensuring the camera never flips upside down or clips into the ground plane.

### 2.4 CameraYGuide3D: Floating Height Rail (`src/core/interaction/cameraYGuide3D.ts`)
- **Replaces the 2D Height Slider**: A 3D holographic vertical guide rail floats alongside the character. Horizontal offset is `APP_CONFIG.interaction.cameraYGuide.xOffset` (meters, negative = left of character).
- Displays an interactive photon + minimal camera icon indicating the camera height target.
- Dragging the rail / icon writes `cameraYOffset` (−1…+1) via `onSetCameraYOffset`. Enter adjust mode (long-press or modifier) first so the guide is visible and Tauri passthrough stays captured.

---

## 3. Physical Aerodynamics: Localized Mouse Wind Force (`src/core/wind/windForce.ts`)

- Detects the velocity vector of the user's cursor moving across the character canvas.
- Converts 2D cursor delta into a directional 3D wind impulse in world space:
  $$\vec{F}_{\text{wind}} = \alpha \cdot \Delta \vec{p}_{\text{cursor}} \cdot e^{-\lambda t}$$
- Dynamically drives the VRM SpringBone simulation, causing ribbons, skirt fabrics, and hair strands to flutter organically as the cursor brushes past.

---

## 4. Biomechanical & Morph Fixes

### 4.1 Pure Quaternion Chain vs. Shear Distortion (`src/core/morph/vrmBodyMorph.ts`)
- **Previous Issue**: Scaling decompositions during head rotation caused non-uniform transform distortion, snapping at large rotation angles, and neck flattening.
- **Solution**: Replaced matrix transformations with **Affine Position Mapping + Pure Quaternion Chains**:
  $$Q_{\text{head\_final}} = Q_{\text{base}} \otimes \text{slerp}(I, Q_{\text{target}}, w)$$
  Guaranteeing rigid SO(3) rotations and completely eliminating shearing artifacts and sudden flips.

### 4.2 Streamlined Natural Idle Pipeline (`src/motion/sources/idle.ts`)
- **Forearm Reed Sway**: Forearms gently follow the breath oscillation with kinetic inertia and natural gravity lag.
- **Resting Wrist Hang**: Hands hang naturally with relaxed fingers that curl and uncurl subtly with chest and abdominal breathing cycles.
- **Elimination of Twitching**: High-frequency noise and theatrical wander animations were replaced with a tranquil, organic presence suitable for continuous desktop companionship.

---

## 5. Dedicated Character Shadow System (`src/core/scene/characterShadow.ts`)
- Independent shadow pass isolated from background geometry.
- Projects soft, contact-hardening ambient occlusion shadows directly onto the transparent desktop boundary, anchoring the 3D avatar onto the user's physical screen workspace.
