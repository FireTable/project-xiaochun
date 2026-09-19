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
| **App updates** | Reload the page / new deploy | Official **in-app updater** (`latest.json` on GitHub Releases) |

---

## 3. Core Desktop Capabilities

### 3.1 60Hz Alpha Bitmask Click-Through Engine
In transparent desk-pet mode, user clicks should interact with XiaoChun when hovering over her body, clothing, or UI buttons, but pass through seamlessly to the underlying desktop (text editors, icons, browsers) when hovering over empty space (e.g. between her legs or beside her torso).

- **Implementation Architecture (`src-tauri/src/lib.rs`)**:
  - A dedicated background thread running at **60Hz (16ms interval)**.
  - The webview dynamically uploads an 8-bit alpha bitmask of the rendered character canvas.
  - While 3D adjust guides are active, the webview calls `set_is_interacting(true)` so thin guide pixels are not click-through.
  - Using **1-nanosecond bitwise shift indexing**:
    $$\text{pixel\_idx} = y \times \text{width} + x, \quad \text{hit} = (\text{mask}[\text{byte\_idx}] \ \& \ (1 \ll \text{bit\_idx})) \neq 0$$
  - When the cursor rests on transparent pixels, `window.set_ignore_cursor_events(true)` is activated without lag or deadlocks.
  - Left-click drag protection ensures window dragging is never broken mid-stroke.

### 3.2 Window State Persistence
- Powered by `tauri-plugin-window-state`.
- Scoped strictly to `StateFlags::POSITION | StateFlags::SIZE` to prevent conflicting with transparent window decorations or always-on-top flags.
- Replaying window coordinates on launch ensures the avatar reappears exactly where the user last placed her.

### 3.3 Interactive Window Frame & Corner Handles
- [TauriWindowFrame.tsx](../src/components/TauriWindowFrame.tsx):
  - 4 invisible interactive corner resize grips (`n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`) invoking native `startResizeDragging()`.
  - Top drag bar with `data-tauri-drag-region` for smooth repositioning.
  - Global `Option / Alt + Mouse Drag` hotkey allowing effortless dragging from any point on the character.

### 3.3.1 Tauri header overflow menu
- [TauriTopHeader.tsx](../src/components/TauriTopHeader.tsx) is Tauri-only (web renders nothing).
- One **MoreHorizontal (⋯)** icon at the end of the top header, tooltip `header.more`. Tooltip wraps the dropdown *trigger*, not the menu root (otherwise hover never reaches the button).
- Menu items:
  - **Check for updates** — every Tauri install (dev, DMG, Homebrew).
  - **Reload** — `import.meta.env.DEV` only (`tauri:dev`).
  - **Close app** — always.

### 3.4 Pet UI Ergonomics & Unmount Lifecycle
- **No Hover Flashing**: Hover-show popups are disabled in desk-pet mode. The control header and chat bar are toggled intentionally by clicking the avatar's body.
- **Deferred Unmount Lifecycle**:
  - Controlled by [useDeferredUnmount.ts](../src/hooks/useDeferredUnmount.ts).
  - When dismissed, UI elements run a 300ms fade-out transition before being completely unmounted from the DOM tree.
  - This eliminates lingering ghost hover regions or Radix UI Tooltip popups under `opacity: 0`.

### 3.5 In-app updater (official plugin)
Whole-app replace via [`tauri-plugin-updater`](https://v2.tauri.app/plugin/updater/) + `@tauri-apps/plugin-updater`. After install, macOS/Linux call `@tauri-apps/plugin-process` `relaunch()`; Windows the installer exits the process.

- **Not a delta of `onnx/` / `vrm/`**. Each update downloads the signed updater artifact (macOS `.app.tar.gz`, Windows NSIS/MSI, Linux AppImage), not the Homebrew `.dmg`.
- **Web is a no-op.** `src/lib/appUpdater.ts` returns immediately unless `isTauri()`.
- **Who is eligible**: every Tauri desktop session, including `tauri:dev` and Homebrew cask installs. `brew upgrade --cask project-xiaochun` remains a second channel; the two can overwrite each other.
- **Check flow** (`src/lib/appUpdater.ts`, `src/components/AppUpdateDialog.tsx`):
  1. On launch, `check()` against `https://github.com/FireTable/project-xiaochun/releases/latest/download/latest.json`.
  2. Quiet if already current or the request fails.
  3. If a newer SemVer exists, wait until the loading overlay is gone, then prompt. Never auto-download.
  4. Header ⋯ → Check for updates runs the same `check()`; “already current” / errors only surface on this manual path.
  5. Confirm → `downloadAndInstall` (progress bar, dialog cannot be dismissed) → relaunch.
- **Endpoint & pubkey**: `src-tauri/tauri.conf.json` → `plugins.updater` (`createUpdaterArtifacts: true`). Signing cannot be disabled.
- **Capabilities**: `updater:default` in `src-tauri/capabilities/desktop.json`; `process:default` in `default.json`.

### 3.6 Updater signing & CD
Private key is **not** in git (`.tauri/` is gitignored). Public key is the `plugins.updater.pubkey` string in `tauri.conf.json`. Losing the private key means already-installed clients can never receive another in-app update (reinstall only).

| Where | Variable | Notes |
| :--- | :--- | :--- |
| Local `pnpm tauri:build` | `TAURI_SIGNING_PRIVATE_KEY` or `TAURI_SIGNING_PRIVATE_KEY_PATH` | Bundler **does not** read `.env`. Export in the shell. See `.env.example`. |
| GitHub Actions | Secrets of the same names | `.github/workflows/release-tauri.yml` fails the job if `TAURI_SIGNING_PRIVATE_KEY` is empty. |

CI (`tauri-apps/tauri-action`, `includeUpdaterJson: true`) uploads `.sig` files and merges `latest.json` across the matrix. First desktop build that contains this plugin is a **reinstall** for older clients that had no updater; later versions can self-update.

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
  # Requires TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$PWD/.tauri/xiaochun.key"
  pnpm tauri:build
  ```
