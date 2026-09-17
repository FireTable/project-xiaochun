# Hybrid Desktop Companion Architecture (Tauri 2.x)

## 1. Overview
Project XiaoChun extends beyond traditional in-browser execution into a high-performance **cross-platform desktop hybrid application** built on **Tauri 2.x**. In desktop mode, XiaoChun operates as an interactive, transparent, frameless desktop pet (桌宠) that floats directly on top of the user's operating system workspace, seamlessly blending into the desktop environment.

---

## 2. Desktop Companion vs. Browser Web App: Feature Matrix

| Feature Dimension | Web Browser Tab | Native Desktop App (Tauri 2.x) |
| :--- | :--- | :--- |
| **Window Frame & Decor** | Constrained inside browser chrome, address bar, tabs | Frameless, borderless, custom rounded aesthetic |
| **Background & Compositing** | Opaque canvas or constrained inside viewport | **100% True Transparent Desktop Compositing** directly over OS desktop |
| **Mouse Event Pass-through** | All clicks trapped inside browser window | **60Hz Real-Time Canvas Alpha Bitmask** true click-through |
| **Window Dragging & Resize** | Browser controls window position | Custom freeform edge/corner handles + Alt/Option drag anywhere |
| **Window State Persistence** | Lost or reset on browser reload | **Auto-persisted position and size** across app restarts |
| **External Inter-Process Protocol** | Only web URLs (cannot be cold-started by OS) | **Custom URL Scheme (`xiaochun://`)** with cold-start & hot-wake |
| **Resource Overhead** | Heavy browser engine overhead + extensions | Extremely lightweight OS-native webview (~30MB binary footprint) |
| **Window Level** | Normal browser window | Configurable **Always-on-Top** pin state |

---

## 3. Core Desktop Capabilities

### 3.1 60Hz Alpha Bitmask Click-Through Engine
In transparent desk-pet mode, user clicks should interact with XiaoChun when hovering over her body, clothing, or UI buttons, but pass through seamlessly to the underlying desktop (text editors, icons, browsers) when hovering over empty space (e.g. between her legs or beside her torso).

- **Implementation Architecture (`src-tauri/src/lib.rs`)**:
  - A dedicated background thread running at **60Hz (16ms interval)**.
  - The webview dynamically uploads an 8-bit alpha bitmask of the rendered character canvas.
  - Using **1-nanosecond bitwise shift indexing**:
    $$\text{pixel\_idx} = y \times \text{width} + x, \quad \text{hit} = (\text{mask}[\text{byte\_idx}] \ \& \ (1 \ll \text{bit\_idx})) \neq 0$$
  - When the cursor rests on transparent pixels, `window.set_ignore_cursor_events(true)` is activated without lag or deadlocks.
  - Left-click drag protection ensures window dragging is never broken mid-stroke.

### 3.2 Window State Persistence
- Powered by `tauri-plugin-window-state`.
- Scoped strictly to `StateFlags::POSITION | StateFlags::SIZE` to prevent conflicting with transparent window decorations or always-on-top flags.
- Replaying window coordinates on launch ensures the avatar reappears exactly where the user last placed her.

### 3.3 Interactive Window Frame & Corner Handles
- [TauriWindowFrame.tsx](file:///Users/FireTable/OpenClaw/Code/Project-XiaoChun/src/components/TauriWindowFrame.tsx):
  - 4 invisible interactive corner resize grips (`n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`) invoking native `startResizeDragging()`.
  - Top drag bar with `data-tauri-drag-region` for smooth repositioning.
  - Global `Option / Alt + Mouse Drag` hotkey allowing effortless dragging from any point on the character.
  - Compact power controls: Pin always-on-top, minimize, and close directly integrated in the top header.

### 3.4 Pet UI Ergonomics & Unmount Lifecycle
- **No Hover Flashing**: Hover-show popups are disabled in desk-pet mode. The control header and chat bar are toggled intentionally by clicking the avatar's body.
- **Deferred Unmount Lifecycle**:
  - Controlled by [useDeferredUnmount.ts](file:///Users/FireTable/OpenClaw/Code/Project-XiaoChun/src/hooks/useDeferredUnmount.ts).
  - When dismissed, UI elements run a 300ms fade-out transition before being completely unmounted from the DOM tree.
  - This eliminates lingering ghost hover regions or Radix UI Tooltip popups under `opacity: 0`.

---

## 4. Platform Support & Build Commands

- **Supported Platforms**:
  - macOS (Apple Silicon `aarch64` & Intel `x86_64`)
  - Windows 10 / 11 (`x86_64`)
  - Linux (`x86_64` WebKit2GTK)

- **Development Commands**:
  ```bash
  # Start Tauri in development mode with live HMR
  pnpm tauri:dev

  # Build standalone release binaries and installer bundles
  pnpm tauri:build
  ```
