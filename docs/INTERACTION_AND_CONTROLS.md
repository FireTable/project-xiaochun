# User Interaction, Shortcuts & Platform Differences Guide

## 1. Overview
Project XiaoChun features a multi-tiered interaction architecture designed to bridge 100% responsive 3D avatar manipulation, transparent desktop ergonomics, and multi-platform accessibility across **Native Desktop (Tauri 2.x on macOS / Windows / Linux)**, **Web Desktop (Chrome / Safari / Edge)**, and **Mobile Touch (iOS / Android)**.

This document serves as the definitive reference for how all user interactions and hotkeys are triggered, alongside a breakdown of platform-specific differences.

---

## 2. Interaction & Shortcut Mapping Matrix

| Category | Action / Trigger | macOS (Tauri Desktop) | Windows / Linux (Tauri Desktop) | Web Browser (Desktop) | Mobile / Touch Devices |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Window Movement** | **Global Drag Anywhere** | <kbd>Option</kbd> + Left Click Drag | <kbd>Alt</kbd> + Left Click Drag | N/A (Constrained to tab) | N/A |
| | **Top Drag Region** | Left Click Drag on header gap | Left Click Drag on header gap | N/A | N/A |
| **Window Resize** | **Freeform Corner Resize** | Left Click Drag 4 corners / 4 edges | Left Click Drag 4 corners / 4 edges | Resize browser window | Pinch-to-zoom viewport |
| **Desk-Pet UI** | **Toggle UI (TopBar/Chat)** | Single Left Click on Avatar Body | Single Left Click on Avatar Body | Persistent (or scene switch) | Tap on Avatar Body |
| | **Dismiss Menus / Drawers** | <kbd>Esc</kbd> or click empty area | <kbd>Esc</kbd> or click empty area | <kbd>Esc</kbd> or click empty area | Tap outside backdrop |
| **3D Orbit & Pan** | **Orbit Camera (Yaw/Pitch)** | Left Click Drag on 3D stage | Left Click Drag on 3D stage | Left Click Drag | 1-Finger Drag |
| | **Pan Camera (X / Y Plane)** | Right Click Drag / Two-finger Pan | Right Click Drag | Right Click Drag | 2-Finger Drag / Slide |
| | **Zoom Camera In / Out** | Mouse Wheel / Two-finger Pinch | Mouse Wheel | Mouse Wheel | 2-Finger Pinch In/Out |
| **3D Holographic** | **Rotate Character Body** | Drag `TurnGuide3D` foot ring / bead | Drag `TurnGuide3D` foot ring / bead | Drag `TurnGuide3D` foot ring / bead | Touch & drag foot ring |
| | **Adjust Camera Height** | Drag `CameraYGuide3D` vertical rail | Drag `CameraYGuide3D` vertical rail | Drag `CameraYGuide3D` vertical rail | Touch & drag height rail |
| | **Aero Wind Interaction** | Move cursor swiftly past character | Move cursor swiftly past character | Move cursor swiftly past character | Rapid swipe gesture |
| **System & IPC** | **External Speech Protocol** | `open "xiaochun://speak?..."` | `start "" "xiaochun://speak?..."` | Custom scheme link / JS bridge | Custom URL handler |
| | **Built-in CLI Trigger** | `pnpm speak "Message"` | `pnpm speak "Message"` | `window.__triggerXiaoChunProtocol` | In-app input bar |
| **Developer Tools** | **Open Inspect / Console** | <kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>I</kbd> | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd> or <kbd>F12</kbd> | <kbd>F12</kbd> / DevTools | Shake or vConsole toggle |
| | **Unlock Hidden DevDrawer** | 10 rapid clicks on avatar badge | 10 rapid clicks on avatar badge | 10 rapid clicks on avatar badge | 10 rapid taps on avatar badge |

---

## 3. Platform Differences Deep Dive

### 3.1 Native Desktop Companion Mode (Tauri 2.x)
- **100% Desktop Compositing**: Operates borderless with transparent background compositing.
- **60Hz Real-Time Alpha Click-Through**:
  - Hovering over XiaoChun's body/clothes/shoes: Clicks interact with the character.
  - Hovering over transparent empty space: Clicks fall through to your desktop, IDE, or browser beneath without taking focus.
  - Left-drag protection ensures window motion is never interrupted mid-flight.
- **Top Header Controls**:
  - **Pin Always-on-Top**: Keeps XiaoChun visible above all full-screen windows and IDEs.
  - **Minimize & Quit**: Native OS power management directly from the UI header.
- **Window Geometry Memory**: Restores your exact window coordinate position and scale when relaunched.

### 3.2 Web Browser Mode (Chrome / Edge / Safari / Firefox)
- **Scene Switching**: Supports procedural `Linework-Light` (daylight wireframe skyline) and `Linework-Dark` (night cyberpunk grid) outdoor world rendering.
- **Microphone & Speech**: Direct Edge-TTS synthesis via streaming Cloudflare Workers edge proxy.
- **Full-Screen Responsive**: Seamless layout switching between desktop ultra-wide monitors and tablet screens.

### 3.3 Mobile & Touch Environments (iOS Safari / Android Web)
- **Mobile-First Layout**:
  - Touch targets strictly adhere to **iOS HIG (44 pt)** and **Material Design (48 dp)**.
  - The DevDrawer slides up to occupy **92vw**, avoiding edge clipping on curved phone screens.
  - Top header compacts into single-row icon clusters to conserve precious vertical viewport space.
- **Multi-Touch Gestures**:
  - 1-Finger drag rotates camera angle.
  - 2-Finger pinch adjusts camera focal distance.
  - 2-Finger pan translates the avatar laterally.

---

## 4. Troubleshooting & Ergonomic Tips

1. **How to Move the Desktop Window Quickly**:
   - Instead of aiming for the thin title bar, simply hold down <kbd>Option</kbd> (macOS) or <kbd>Alt</kbd> (Windows) and click-and-drag anywhere on XiaoChun to reposition her on your monitor.
2. **How to Resize the Desktop Window**:
   - Move your cursor to any of the 4 rounded corners of the window until the diagonal resize cursor (`nwse-resize` / `nesw-resize`) appears, then drag outward or inward.
3. **Preventing Accidental UI Popups**:
   - In transparent desk-pet mode, the control header and chat bar will only open when you intentionally click the character's body. Moving your mouse across her will not cause flashing menus.
