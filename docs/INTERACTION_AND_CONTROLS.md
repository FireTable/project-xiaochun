# User Interaction, Shortcuts & Platform Differences Guide

## 1. Overview
Project XiaoChun features a multi-tiered interaction architecture designed to bridge 100% responsive 3D avatar manipulation, transparent desktop ergonomics, and multi-platform accessibility across **Native Desktop (Tauri 2.x on macOS / Windows / Linux)**, **Web Desktop (Chrome / Safari / Edge)**, and **Mobile Touch (iOS / Android)**.

This document serves as the definitive reference for how all user interactions and hotkeys are triggered, alongside a breakdown of platform-specific differences.

**Primary 3D adjust gesture (all platforms):** long-press → adjust mode (holographic guides visible) → drag for body turn / camera pitch, or drag the left **Camera Y** rail. Timing knobs live in `src/lib/constants.ts` (`INTERACTION_TOUCH_ARM_MS`, `INTERACTION_TOUCH_ARM_SLOP_PX`, `INTERACTION_GUIDE_AUTO_HIDE_MS`).

---

## 2. Interaction & Shortcut Mapping Matrix

| Category | Action / Trigger | macOS (Tauri Desktop) | Windows / Linux (Tauri Desktop) | Web Browser (Desktop) | Mobile / Touch Devices |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Window Movement** | **Bare Left Drag (desk-pet)** | Left-drag *before* long-press arms (or short flick) | Same | N/A | N/A |
| | **Top Drag Region** | Left Click Drag on header gap | Left Click Drag on header gap | N/A | N/A |
| **Window Resize** | **Freeform Corner Resize** | Left Click Drag 4 corners / 4 edges | Left Click Drag 4 corners / 4 edges | Resize browser window | Pinch-to-zoom viewport |
| **Desk-Pet UI** | **Toggle UI (TopBar/Chat)** | Single Left Click on Avatar Body | Single Left Click on Avatar Body | Persistent (or scene switch) | Tap on Avatar Body |
| | **Dismiss Menus / Drawers** | <kbd>Esc</kbd> or click empty area | <kbd>Esc</kbd> or click empty area | <kbd>Esc</kbd> or click empty area | Tap outside backdrop |
| **3D Turn & Pitch** | **Body turn + camera pitch** | Long-press then drag · or <kbd>Cmd</kbd> + Drag | Long-press then drag · or <kbd>Ctrl</kbd> + Drag | Long-press then drag · or <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + Drag | Long-press then drag |
| | **Camera Y height guide** | Long-press (guides on) then drag left rail · or <kbd>Cmd</kbd> + drag rail | Long-press then drag rail · or <kbd>Ctrl</kbd> + drag rail | Long-press then drag rail · or modifier + drag rail | Long-press then drag left Y rail |
| | **Zoom Camera In / Out** | Mouse Wheel / Two-finger Pinch | Mouse Wheel | Mouse Wheel | 2-Finger Pinch In/Out |
| | **Aero Wind Interaction** | Move cursor swiftly past character | Move cursor swiftly past character | Move cursor swiftly past character | Rapid swipe gesture |
| **System & IPC** | **External Speech Protocol** | `open "xiaochun://speak?..."` | `start "" "xiaochun://speak?..."` | Custom scheme link / JS bridge | Custom URL handler |
| | **Built-in CLI Trigger** | `pnpm speak "Message"` | `pnpm speak "Message"` | `window.__triggerXiaoChunProtocol` | In-app input bar |
| **App updates (Tauri)** | **Header ⋯ menu** | Check for updates / Reload (dev) / Close app | Same | N/A (web has no updater) | N/A |
| **Developer Tools** | **Open Inspect / Console** | <kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>I</kbd> | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd> or <kbd>F12</kbd> | <kbd>F12</kbd> / DevTools | Shake or vConsole toggle |
| | **Unlock Hidden DevDrawer** | 10 rapid clicks on avatar badge | 10 rapid clicks on avatar badge | 10 rapid clicks on avatar badge | 10 rapid taps on avatar badge |

---

## 3. Platform Differences Deep Dive

### 3.1 Native Desktop Companion Mode (Tauri 2.x)
- **100% Desktop Compositing**: Operates borderless with transparent background compositing.
- **60Hz Real-Time Alpha Click-Through** (`passthroughManager` → Rust alpha bitmask):
  - Hovering over XiaoChun's body/clothes/shoes: Clicks interact with the character.
  - Hovering over transparent empty space: Clicks fall through to your desktop, IDE, or browser beneath without taking focus.
  - **While adjust guides are visible** (long-press armed / <kbd>Cmd</kbd>·<kbd>Ctrl</kbd> held / actively dragging): `setInteracting(true)` forces the window to accept input so thin holographic guides (e.g. Camera Y icon) are not misclassified as transparent and click-through.
  - Left-drag protection ensures window motion is never interrupted mid-flight.
- **Top Header Controls** (Tauri overflow, `TauriTopHeader`):
  - One **⋯** button (tooltip “More”). Hover tooltip must wrap the dropdown *trigger*, not the menu root.
  - **Check for updates**: quiet `check()` on launch; prompt only when a newer GitHub Release exists. Manual check from this menu also reports “already current”.
  - **Reload**: `tauri:dev` only.
  - **Close app**: quits the native window.
  - Always-on-top is a window flag in `tauri.conf.json`, not a header toggle.
- **Window Geometry Memory**: Restores your exact window coordinate position and scale when relaunched.

### 3.2 Web Browser Mode (Chrome / Edge / Safari / Firefox)
- **Scene Switching**: Supports procedural `Linework-Light` (daylight wireframe skyline) and `Linework-Dark` (night cyberpunk grid) outdoor world rendering.
- **Microphone & Speech**: Direct Edge-TTS synthesis via streaming Cloudflare Workers edge proxy.
- **Full-Screen Responsive**: Seamless layout switching between desktop ultra-wide monitors and tablet screens.
- **Same long-press adjust mode** as native / mobile (no window-drag conflict).

### 3.3 Mobile & Touch Environments (iOS Safari / Android Web)
- **Mobile-First Layout**:
  - Touch targets strictly adhere to **iOS HIG (44 pt)** and **Material Design (48 dp)**.
  - The DevDrawer slides up to occupy **92vw**, avoiding edge clipping on curved phone screens.
  - Top header compacts into single-row icon clusters to conserve precious vertical viewport space.
- **`viewport-fit=cover`**: ChatBar follows the soft keyboard via `--kb` (fixed small lift while keyboard open; cleared on blur).

### 3.4 Gesture policy (all platforms)
- **Long-press** (`INTERACTION_TOUCH_ARM_MS`) enters adjust mode (Turn / Pitch / Camera Y guides visible).
  - Then drag for `bodyTurn` (X) + camera pitch (Y), or tap/drag the left **Camera Y** rail.
  - Idle `INTERACTION_GUIDE_AUTO_HIDE_MS` auto-hides guides; any further adjust interaction resets the timer.
  - Move more than `INTERACTION_TOUCH_ARM_SLOP_PX` *before* arming cancels the long-press (browser swipe/back stays usable; on Tauri this becomes window drag).
- **Desktop shortcut**: <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> still enters 3D immediately (no long-press).
- **Tauri desk-pet**: short drag before arm = move window; long-press = adjust mode.
- Timing constants: `src/lib/constants.ts` (do not hardcode durations in callers).
- 2-Finger pinch adjusts camera distance when available.

---

## 4. Troubleshooting & Ergonomic Tips

1. **How to Move the Desktop Window (Tauri)**:
   - Short left-drag *before* the long-press arms, anywhere on an opaque hit (character). Holding still ~`INTERACTION_TOUCH_ARM_MS` enters adjust mode instead. <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> still jumps straight into 3D.
2. **Camera Y rail hard to grab on transparent theme**:
   - Enter adjust mode first (long-press or modifier) so guides stay up and passthrough capture is on, then drag the left camera icon / photon / rail.
3. **How to Resize the Desktop Window**:
   - Move your cursor to any of the 4 rounded corners of the window until the diagonal resize cursor (`nwse-resize` / `nesw-resize`) appears, then drag outward or inward.
4. **Preventing Accidental UI Popups**:
   - In transparent desk-pet mode, the control header and chat bar will only open when you intentionally click the character's body. Moving your mouse across her will not cause flashing menus.
