# Hybrid Desktop Companion Architecture (Tauri 2.x)

## 1. Overview
Project XiaoChun extends beyond traditional in-browser execution into a high-performance **cross-platform desktop hybrid application** built on **Tauri 2.x**. In desktop mode, XiaoChun operates as an interactive, transparent, frameless desktop pet (桌宠) that floats directly on top of the user's operating system workspace, seamlessly blending into the desktop environment.

---

## 2. Desktop Companion vs. Browser Web App: Feature Matrix

| Feature Dimension | Web Browser Tab | Native Desktop App (Tauri 2.x) |
| :--- | :--- | :--- |
| **Window Frame & Decor** | Constrained inside browser chrome, address bar, tabs | Frameless, borderless, custom rounded aesthetic |
| **Background & Compositing** | Opaque canvas or constrained inside viewport | **100% True Transparent Desktop Compositing** directly over OS desktop |
| **Mouse Event Pass-through** | All clicks trapped inside browser window | Canvas alpha bitmask on empty 3D pixels; HTML UI never click-through |
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

- **Implementation Architecture** ([passthroughManager.ts](../src/core/scene/passthroughManager.ts) + `src-tauri/src/lib.rs`):
  - A dedicated background thread running at **60Hz (16ms interval)**.
  - **Canvas only** uploads a 1-bit alpha mask of the WebGL framebuffer (character silhouette). HTML is **not** stamped into that bitmap.
  - **DOM never uses the mask.** Pointer over HTML (`elementFromPoint` not on `canvas`), or an open menu/dialog (`set_dom_blocks_passthrough`), captures the whole window. Open overlays cannot rely on `elementFromPoint` while click-through is already on (the webview gets no mouse events).
  - Header / chat bar still send CSS rects so the cursor can slide from empty canvas onto chrome while click-through is active.
  - While 3D adjust guides are active, the webview calls `set_is_interacting(true)` so thin guide pixels are not click-through.
  - Using **1-nanosecond bitwise shift indexing**:
    $$\text{pixel\_idx} = y \times \text{width} + x, \quad \text{hit} = (\text{mask}[\text{byte\_idx}] \ \& \ (1 \ll \text{bit\_idx})) \neq 0$$
  - When the cursor rests on transparent *canvas* pixels (and not DOM), `window.set_ignore_cursor_events(true)` is activated without lag or deadlocks.
  - Left-click drag protection ensures window dragging is never broken mid-stroke.
  - **PostFX stays on** in transparent mode when `postfx.enabled` is true: composer main RT MSAA is desktop **4x**. Bloom high-pass skips empty pixels; additive bloom writes RGB only so the 60Hz bitmask still matches the silhouette. Turning PostFX off falls back to the default framebuffer `antialias`. Details: [`POSTFX.md`](POSTFX.md).

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
  - **Check for updates** — every Tauri install (dev, DMG, Homebrew). Manual path opens the dialog *first* (loading copy), then fetches `latest.json`. Auto-check on launch stays quiet.
  - **Reload** — `isDev()` only.
  - **Close app** — always.
- `DropdownMenu` is exclusive at the primitive: opening one closes every other (header and ChatBar share this).
- GitHub / release-notes links use `tauri-plugin-opener` (`src/lib/openExternal.ts`). WebView `target=_blank` is a no-op on Tauri.

### 3.4 Pet UI Ergonomics
- **No Hover Flashing**: Hover-show popups are disabled in desk-pet mode. The control header and chat bar are toggled by clicking the avatar's body.
- **Opacity only, keep DOM**: TopHeader / ChatBar fade with `opacity` (no `translate-y`). They stay mounted so Radix menus and passthrough rects remain valid.
- **Hold the 10s auto-hide** while the pointer is over header/chat bar, or any `[role=dialog][data-state=open]` is open (`holdPetUi` / `releasePetUi` in `usePetUiVisibility.ts`).
- Dialog overlays on Tauri use `border-radius: 20px` (`.dialog-overlay`) so the dim layer does not square off the window.

### 3.5 In-app updater (official plugin)
Whole-app replace via [`tauri-plugin-updater`](https://v2.tauri.app/plugin/updater/) + `@tauri-apps/plugin-updater`. After install, macOS/Linux call `@tauri-apps/plugin-process` `relaunch()`; Windows the installer exits the process.

- **Not a delta of `onnx/` / `vrm/`**. Each update downloads the signed updater artifact (macOS `.app.tar.gz`, Windows NSIS/MSI, Linux AppImage), not the Homebrew `.dmg`.
- **Web is a no-op.** `src/lib/appUpdater.ts` returns immediately unless `isTauri()`.
- **Who is eligible**: every Tauri desktop session, including `tauri:dev` and Homebrew cask installs. `brew upgrade --cask project-xiaochun` remains a second channel; the two can overwrite each other.
- **Check flow** (`src/lib/appUpdater.ts`, `src/components/AppUpdateDialog.tsx`):
  1. **Launch (quiet):** `check()` against `https://github.com/FireTable/project-xiaochun/releases/latest/download/latest.json`. No dialog if current or the request fails. If newer, wait until the loading overlay is gone, then prompt. Never auto-download.
  2. **Manual (⋯ → Check for updates):** open the dialog immediately (title keeps the download icon; body shows “please wait”), then fetch. Result is available / up-to-date / error.
  3. Generic CI `releaseBody` (“See the release assets below…”) is not shown. **View release notes** opens `…/releases/tag/vX.Y.Z` via `openExternal`.
  4. Confirm → `downloadAndInstall` (progress bar, dialog cannot be dismissed) → relaunch.
- **Endpoint & pubkey**: `src-tauri/tauri.conf.json` → `plugins.updater` (`createUpdaterArtifacts: true`). Signing cannot be disabled.
- **Capabilities**: `updater:default` in `src-tauri/capabilities/desktop.json`; `process:default` and scoped `opener:allow-open-url` (`https://github.com/*`) in `default.json`.

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
