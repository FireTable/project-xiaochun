# External Application Invocation Protocol Specification (`xiaochun://`)

## 1. Protocol Architecture Overview

Project XiaoChun provides an operating-system-level Inter-Process Communication (IPC) protocol via custom URL Scheme (`xiaochun://`). This enables external applications, automated scripts, CLI tools, web browsers, and AI agents to awaken XiaoChun, focus her desktop window, and command her to vocalize speech with synchronized real-time 3D motion, facial expressions, and head bubble bubbles.

```
[External Application / CLI / Agent / Web Browser]
                      │
                      ▼ Calls system open ("xiaochun://speak?text=...")
          [OS URL Scheme Dispatcher]
                      │
                      ▼
   [Tauri Native Host (Rust: Single-Instance + Deep-Link)]
     ├── Cold Start: Spawns process, restores window, caches arguments
     └── Hot Wake: Unminimizes & brings existing window to focus
                      │
                      ▼ Emits `protocol:action` event to WebView
             [src/core/protocol/]
     ├── types.ts: Validates action payload schema
     ├── index.ts: Event listener & dev bridge (`window.__triggerXiaoChunProtocol`)
     └── handler.ts: Waits for VRM model readiness if cold-started
                      │
                      ▼
         [vrmEngine.speakText(text)]
     ├── Edge-TTS Audio Generation
     ├── EMAGE Real-Time Gesture Streaming
     ├── Dynamic LipSync Viseme Interpolation
     └── 3D HeadBubble Status Rendering
```

---

## 2. Protocol URL Specification

### 2.1 Direct Text Speech (`speak`)
Command XiaoChun to speak directly from a text string.

- **URL Pattern**:
  ```
  xiaochun://speak?text=<url_encoded_text>[&audioUrl=<optional_audio_url>]
  ```
- **Alternative Path Formats**:
  - `xiaochun:///speak?text=Hello`
  - `xiaochun://action?action=speak&text=Hello`

- **Parameters**:
  | Parameter | Type | Required | Description |
  | :--- | :--- | :--- | :--- |
  | `text` | string | Yes | The dialogue line to speak. Must be URL-encoded. |
  | `file` | string (path) | Optional | Local file path to read text from (for ultra-long documents). |
  | `audioUrl` | string (URL) | Optional | Optional pre-synthesized audio URL (bypasses TTS generation). |

- **Examples**:
  - `xiaochun://speak?text=Hello%20Master%2C%20welcome%20home!`
  - `xiaochun://speak?text=%E4%B8%BB%E4%BA%BA%EF%BC%8C%E8%AF%A5%E4%BC%91%E6%81%AF%E4%B8%80%E4%B8%8B%E5%95%A6%EF%BC%81`

---

### 2.2 Long File Speech (`speak` with `file`)
For extensive scripts, novels, or reports exceeding OS command-line parameter constraints, pass the absolute path of a local `.txt` file:

- **URL Pattern**:
  ```
  xiaochun://speak?file=/path/to/script.txt
  ```

---

## 3. Character Limits & Payload Strategy

| Channel / Mode | Hard OS Limit | Practical Safe Chinese Characters | Recommended Use Case |
| :--- | :--- | :--- | :--- |
| **URL Query (`?text=...`)** | Windows Shell: ~32 KB<br>macOS URL Event: ~64 KB - 1 MB | **1,000 ~ 3,000 characters** | Daily notifications, conversational replies, status alerts. |
| **File Path (`?file=...`)** | Unlimited (only limited by filesystem & memory) | **Unlimited** (millions of words) | Long articles, automated reports, audiobooks. |

---

## 4. Invocation Examples by Environment

### 4.1 Shell & Command Line
- **macOS**:
  ```bash
  open "xiaochun://speak?text=主人，构建成功！"
  ```
- **Windows (Command Prompt / PowerShell)**:
  ```cmd
  start "" "xiaochun://speak?text=主人，构建成功！"
  ```
- **Linux**:
  ```bash
  xdg-open "xiaochun://speak?text=主人，构建成功！"
  ```

### 4.2 Project XiaoChun Built-in CLI Runner
For local development or shell scripts inside the repository, use the dedicated convenience runner (which handles argument encoding and cross-platform binary resolution automatically):
```bash
# Direct speech
pnpm speak "Master, continuous integration pipeline has succeeded!"

# Raw protocol URL
pnpm protocol "xiaochun://speak?text=Testing%20raw%20protocol"
```

### 4.3 Python Integration
```python
import urllib.parse
import webbrowser

def make_xiaochun_speak(text: str):
    encoded_text = urllib.parse.quote(text)
    url = f"xiaochun://speak?text={encoded_text}"
    webbrowser.open(url)

make_xiaochun_speak("Python agent connected successfully!")
```

### 4.4 In-Browser / Web Links
Any HTML webpage can link to the protocol to wake up the user's desktop companion:
```html
<a href="xiaochun://speak?text=Clicked%20from%20webpage!">Wake Up XiaoChun</a>
```

### 4.5 Developer Console Bridge
In the webview or browser Developer Tools console, simulate a protocol trigger directly:
```javascript
window.__triggerXiaoChunProtocol('speak', { text: 'Console test message' });
```

---

## 5. Cold Start vs Warm Start (Desktop)

On **warm start** (app already running), the deep-link plugin delivers URLs via `on_open_url`, which the native host dispatches to the same `pending_messages` + `protocol:action` path as CLI argv.

On **cold start** (app fully quit), especially on **macOS**, the launch URL is often **not** present in process argv. The host recovers it via:

1. `RunEvent::Opened` (primary on macOS/iOS)
2. `DeepLinkExt::get_current()` during setup, plus short delayed polls if Opened races setup
3. Existing `on_open_url` / argv / pending queue paths

Raw URLs are deduped within 5s so Opened + get_current + `on_open_url` do not double-speak. The frontend still drains `get_pending_protocol_actions` and dedupes by message `id`.

Prefer **URL-encoded** `text` (e.g. Chinese) for portability; unencoded Chinese in `open "xiaochun://speak?text=..."` is usually OK on macOS but encoding is safer across shells and platforms.

