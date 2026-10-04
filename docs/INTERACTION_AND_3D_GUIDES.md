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
- **Photon knobs**: `INTERACTION_GUIDE_PHOTON` (`thickness` / `flowUFrac` / `cameraLength`) — shared paint ratios; each guide keeps its own track/flow mesh (no shared photon plane).
- **Pinch / Scroll Zoom**: Smooth exponential zooming bounded by configured safe camera distances.

- **Shared gesture core (`src/core/gesture/`)**: the left-button decision logic (short drag = move, long-press `INTERACTION_TOUCH_ARM_MS` = arm adjust mode, modifier = instant 3D) is a pure-TS state machine (`GestureMachine`, no DOM / Tauri dependency) extracted verbatim from `InteractionController`. `InteractionController` is now a thin DOM adapter on top of it. The same machine drives **three consumers**: the Tauri desktop window (`move` strategy `native`: hand the drag to Tauri `startDragging`), the `/embed` iframe (`delta` strategy: post `xc.gesture-move` increments that the host SDK applies, see [`EMBED.md`](EMBED.md) §2.8) and the corner resize (`ResizeGesture` + `CORNER_HIT_SIZE` / `cornerAt`, shared by `TauriWindowFrame` and `EmbedCorners`). `HitGate` decides click-through for transparent scenes (character / buttons / menus / corner zones capture; blank passes through). Equivalence against the old controller is locked by `src/core/gesture/__tests__/equivalence.test.ts`.

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

### 2.5 Shared white-UI style (`src/core/interaction/guideStyle.ts`)
The window corner arcs (`src/components/CornerHandle.tsx`, used by Tauri and `/embed`) and the three 3D guides read **one** set of constants, with no per-component hard-coding and no scene / platform switch:
- `GUIDE_COLOR = '#ffffff'` + `GUIDE_OPACITY = 0.75` (semi-transparent white; split in two because `THREE.Color` drops rgba alpha). `guideRgba()` / `GUIDE_COLOR_CSS` give the CSS form.
- `GUIDE_SHADOW`: a soft dark shadow under the white body (3D `alpha 0.20`, `blur 10`, `spread 4`; corner arc `arcAlpha 0.20`, `arcBlur 1.8`). White-on-white (light scenes, or transparent scenes over a white host page) would otherwise be invisible; on dark backgrounds the shadow is nearly invisible, so nothing looks dirty. Every field has its legal range and the effect of raising / lowering it in the file's comments.
- The 3D guides are additively blended (cannot draw dark), so `guideShadow.ts` bakes each guide texture into a dilated + blurred black texture attached as a non-pickable child mesh / sprite (`NormalBlending`, drawn before the guide). The area covered by the white body is knocked out of the shadow, so the semi-transparent body does not show a dirty edge. Corner arcs do the same with an SVG blur + mask and sit 4 px inside the window edge (concentric with the 20 px window radius), so the blur is not clipped by `overflow-hidden`.
- Tauri desktop arcs / guides therefore also gained the soft shadow (intended).

---

## 3. Physical Aerodynamics: Localized Mouse Wind Force (`src/core/wind/windForce.ts`)

- Detects the velocity vector of the user's cursor moving across the character canvas.
- Converts 2D cursor delta into a directional 3D wind impulse in world space:
  $$\vec{F}_{\text{wind}} = \alpha \cdot \Delta \vec{p}_{\text{cursor}} \cdot e^{-\lambda t}$$
- Dynamically drives the VRM SpringBone simulation, causing ribbons, skirt fabrics, and hair strands to flutter organically as the cursor brushes past.
- **Skirt tuning (current values)**: `APP_CONFIG.wind.skirtMultiplier = 0.7` (wind gain on the skirt, legal `>= 0`, suggested 0.5 to 1.5; raise = a cursor sweep whips the skirt harder, lower = gentler; was 1.45) and `APP_CONFIG.springBone.skirt.dragForce = 0.40` (damping, legal 0 to 1; raise = steadier, sway settles faster, lower = floatier; was 0.18). `stiffness 0.35` / `gravityPower 0.10` are unchanged. Together they stop the skirt from over-swinging when the window is dragged or the cursor sweeps.

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
