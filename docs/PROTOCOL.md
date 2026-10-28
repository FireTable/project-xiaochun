# External Application Invocation Protocol Specification (`xiaochun://`)

## 1. Protocol Architecture Overview

Project XiaoChun provides an operating-system-level Inter-Process Communication (IPC) protocol via custom URL Scheme (`xiaochun://`). This enables external applications, automated scripts, CLI tools, web browsers, and AI agents to awaken XiaoChun, focus her desktop window, command her to vocalize speech, trigger 3D skeletal motions & motion groups, express facial emotions, and execute cinematic camera directing (transitions, framing presets, and orbital trajectories).

```
[External Application / CLI / Agent / Web Browser]
                      │
                      ▼ Calls system open ("xiaochun://speak?text=...", "xiaochun://camera?shot=close_up")
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
        ┌─────────────┼───────────────┬──────────────────────┬──────────────────────┐
        ▼             ▼               ▼                      ▼                      ▼
[speakText]     [playMotion]    [setExpression]      [transitionCamera]           [stop]
Edge-TTS +     Quintic Slerp    Emotion Damp Speed    Cinematic Shots & Presets   Cut Audio &
EMAGE Stream   Limb Masking     Speech Ducking        Quintic Orbit / Push / Pull Reset to Idle
LipSync Viseme 8 Motion Groups  Micro-Expressions     Pedestal-Up Reveal
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
  | `text` | string | Yes* | The dialogue line to speak. Must be URL-encoded (*unless `audioUrl` or `file` is provided). |
  | `audioUrl` | string (URL) | Optional | Pre-synthesized audio URL (`https:`), bypassing TTS and driving motion via EMAGE. |
  | `file` | string (path) | Optional | Local file path to read text from (for ultra-long documents). |

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

### 2.3 Single Motion Playback (`motion`)
Command XiaoChun to execute a specific 3D animation with Quintic Smootherstep crossfading and anatomical limb coordination.

- **URL Pattern**:
  ```
  xiaochun://motion?name=<motion_name>[&loop=true][&fadeDuration=0.75][&timeScale=1.0][&mask=upperBody]
  ```

- **Parameters**:
  | Parameter | Type | Required | Default | Description |
  | :--- | :--- | :--- | :--- | :--- |
  | `name` | string | Yes* | - | Identifier from the Motion Catalog (e.g., `waving`, `joyfulJump`, `handHeart`). |
  | `url` | string | Yes* | - | Direct relative or `https://` URL to a `.vrma` motion asset. |
  | `loop` | boolean | Optional | `false` | When `true`, loops playback continuously until superseded or stopped. |
  | `fadeDuration`| number | Optional | `0.75` | Quintic transition window duration in seconds (`0.26 ~ 3.0s`). |
  | `timeScale` | number | Optional | `1.0` | Playback speed multiplier (`0.25 ~ 3.0`). |
  | `mask` | `'all'` \| `'upperBody'` | Optional | `'all'` | `'upperBody'` limits motion to torso and arms while legs remain in standing pose. |
  | `stop` | boolean | Optional | `false` | When `true`, smoothly fades out the active motion back to standing idle. |

- **Examples**:
  - `xiaochun://motion?name=waving`
  - `xiaochun://motion?name=joyfulJump&loop=false`
  - `xiaochun://motion?name=bellyDance&loop=true`
  - `xiaochun://motion?stop=true&fadeDuration=0.5`

---

### 2.4 Motion Group Playback (`motion-group`)
Randomly draws and plays an animation from a curated semantic motion group.

- **URL Pattern**:
  ```
  xiaochun://motion-group?name=<group_name>[&loop=false][&fadeDuration=0.75]
  # Or query parameter on motion:
  xiaochun://motion?group=<group_name>[&loop=false]
  # (Backward-compatible alias: xiaochun://group?name=...)
  ```

- **Standard Motion Groups**:
  | Group Name | Semantic Purpose | Included Animations |
  | :--- | :--- | :--- |
  | `greeting` | Welcoming, meeting, waving | `waving`, `singleHandWave`, `bowSalute` |
  | `idleFlavor` | Spontaneous standby fidgets | `touchHair`, `casualWalk`, `checkTime`, `airplaneGlide`, `swayIdle`, `impatientWait`, `modelPose` |
  | `listening` | Attentive ear, nodding | `listening`, `attentiveLean`, `cozyLean`, `sleepyNod` |
  | `thinking` | Contemplative posture, chin-rest | `thinking`, `fistThinking` |
  | `praiseCute` | Delighted praise, playful cute | `fistCute`, `catPaws`, `puppyPaws`, `pokeDimple`, `joyfulJump`, `handHeart`, `cheerUp` |
  | `playfulSulking` | Tsundere pout, coquettish sulk | `poutHum`, `angryJump`, `shyBehindBack`, `shhLean` |
  | `dancePerformance` | Expressive dance choreographies | `bellyDance`, `bellyDanceWave`, `rumbaDance` |
  | `outfitShowcase` | 360-degree full-body showcase | `showFullBody`, `modelPose` |

- **Examples**:
  - `xiaochun://motion-group?name=greeting`
  - `xiaochun://motion?group=praiseCute`
  - `xiaochun://motion-group?name=dancePerformance&loop=true`

---

### 2.5 Facial Expression Trigger (`expression`)
Command XiaoChun to express a specific emotion on her face.

- **URL Pattern**:
  ```
  xiaochun://expression?name=<expression_name>[&intensity=0.85]
  ```

- **Parameters**:
  | Parameter | Type | Required | Default | Description |
  | :--- | :--- | :--- | :--- | :--- |
  | `name` | string | Yes | - | Emotion identifier (`neutral`, `happy`, `gentle_smile`, `smile`, `shy`, `playful`, `surprised`, `hesitant`, `sad`, `angry`, `relaxed`). |
  | `intensity` | number | Optional | `0.80` | Blendshape weight between `0.0` (zero) and `1.0` (maximum). |

- **Examples**:
  - `xiaochun://expression?name=happy`
  - `xiaochun://expression?name=gentle_smile&intensity=0.9`
  - `xiaochun://expression?name=playful`
  - `xiaochun://expression?name=neutral` (resets to default poise)

---

### 2.6 Cinematic Camera Director (`camera`)
Command XiaoChun's camera to execute cinematic transitions, framing presets, and orbital trajectories with Quintic Smootherstep motion damping.

- **URL Pattern**:
  ```
  xiaochun://camera?[shot=<shot>][&movement=<movement>][&durationSec=1.2][&orbitAngleDeg=45][&targetFov=28][&reset=true][&panUp=true]
  ```

- **Parameters**:
  | Parameter | Type | Required | Default | Description |
  | :--- | :--- | :--- | :--- | :--- |
  | `shot` | string | Optional | `medium` | Camera framing preset: `extreme_close_up` (eyes/micro-expression, fov 22), `close_up` (chin/collarbone monologue, fov 26), `medium` (chest conversation, fov 30), `full` (full-body showcase, fov 35), `dramatic_low` (low-angle hero shot, fov 28). |
  | `movement` | string | Optional | `none` | Trajectory: `none`, `push_in`, `pull_out`, `hero_spiral_orbit`, `hero_backlight_reveal`, `dutch_tilt`, `arc_sweep`, `orbit_subtle`, `pedestal_up`. |
  | `durationSec` | number | Optional | `1.2` | Transition duration in seconds (`0.2 ~ 12.0s`). |
  | `targetFov` | number | Optional | - | Target camera Field of View in degrees (`15 ~ 65`). |
  | `orbitAngleDeg` | number | Optional | - | Horizontal orbital azimuth rotation in degrees (e.g. `+45`, `-90`, `180`, `360`). |
  | `easing` | string | Optional | `quintic_smooth` | Interpolation curve: `quintic_smooth`, `ease_out_dramatic`, `linear`. |
  | `windMultiplier` | number | Optional | `1.0` | Wind force scale multiplier to accompany camera movement. |
  | `panUp` | boolean | Optional | `false` | When `true`, executes a cinematic pedestal-up reveal from hem/ankles up to chest height (`2.2s`). |
  | `reset` | boolean | Optional | `false` | When `true`, resets the camera back to default angle and hands control back to free OrbitControls. |

- **Examples**:
  - `xiaochun://camera?shot=close_up`
  - `xiaochun://camera?shot=full&orbitAngleDeg=45`
  - `xiaochun://camera?shot=extreme_close_up&movement=push_in&durationSec=1.5`
  - `xiaochun://camera?panUp=true`
  - `xiaochun://camera?reset=true`

---

### 2.7 Instant Stop (`stop`)
Immediately cuts any active TTS / audio playback and gracefully crossfades active animations back to upright natural standby.

- **URL Pattern**:
  ```
  xiaochun://stop
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
  # Speech
  open "xiaochun://speak?text=主人，构建成功！"

  # Motion
  open "xiaochun://motion?name=waving"

  # Expression
  open "xiaochun://expression?name=gentle_smile"

  # Camera
  open "xiaochun://camera?shot=close_up&movement=push_in"

  # Stop
  open "xiaochun://stop"
  ```
- **Windows (Command Prompt / PowerShell)**:
  ```cmd
  start "" "xiaochun://speak?text=主人，构建成功！"
  start "" "xiaochun://motion?name=handHeart"
  start "" "xiaochun://camera?shot=full"
  start "" "xiaochun://stop"
  ```
- **Linux**:
  ```bash
  xdg-open "xiaochun://speak?text=主人，构建成功！"
  xdg-open "xiaochun://motion-group?name=praiseCute"
  xdg-open "xiaochun://camera?panUp=true"
  ```

### 4.2 Project XiaoChun Built-in CLI Runner
For local development or shell scripts inside the repository, use the dedicated convenience runner (which handles argument encoding and cross-platform binary resolution automatically):
```bash
# 1. Direct speech
pnpm speak "Master, continuous integration pipeline has succeeded!"

# 2. Trigger motion
pnpm motion waving
pnpm motion joyfulJump --loop
pnpm motion --stop

# 3. Trigger motion group
pnpm motion-group greeting
pnpm motion-group praiseCute
# (or legacy alias: pnpm group greeting)

# 4. Trigger expression
pnpm expr happy
pnpm expr gentle_smile 0.9

# 5. Trigger camera transition
pnpm camera close_up
pnpm camera full --orbit 45
pnpm camera extreme_close_up --movement push_in
pnpm camera --pan-up
pnpm camera --reset

# 6. Immediate stop
pnpm stop

# 7. Raw protocol URL
pnpm protocol "xiaochun://camera?shot=close_up&orbitAngleDeg=30"
```

### 4.3 Python Integration
```python
import urllib.parse
import webbrowser

def xiaochun_call(action: str, **kwargs):
    query = urllib.parse.urlencode({k: v for k, v in kwargs.items() if v is not None})
    url = f"xiaochun://{action}?{query}" if query else f"xiaochun://{action}"
    webbrowser.open(url)

# Speak
xiaochun_call("speak", text="Python agent connected successfully!")

# Play Motion
xiaochun_call("motion", name="waving", loop="false")

# Play Motion Group
xiaochun_call("motion-group", name="praiseCute")

# Set Expression
xiaochun_call("expression", name="gentle_smile", intensity="0.85")

# Camera transition
xiaochun_call("camera", shot="close_up", movement="push_in", durationSec=1.5)

# Stop
xiaochun_call("stop")
```

### 4.4 In-Browser / Web Links
Any HTML webpage can link to the protocol to wake up the user's desktop companion:
```html
<a href="xiaochun://speak?text=Clicked%20from%20webpage!">Wake Up XiaoChun</a>
<a href="xiaochun://motion?name=waving">Wave Hand</a>
<a href="xiaochun://motion-group?name=praiseCute">Cute Motion Group</a>
<a href="xiaochun://expression?name=happy">Smile</a>
<a href="xiaochun://camera?shot=close_up">Close-Up View</a>
```

### 4.5 Developer Console Bridge (`window.xiaochun`)
In the webview or browser Developer Tools console, control XiaoChun directly via the first-class `window.xiaochun` interface or the low-level `window.__triggerXiaoChunProtocol` bridge:
```javascript
// Direct High-Level API (window.xiaochun)
window.xiaochun.speak("主人，该休息一下啦！");
window.xiaochun.motion("waving", { loop: false });
window.xiaochun.motionGroup("praiseCute"); // (alias: window.xiaochun.group("praiseCute"))
window.xiaochun.expression("gentle_smile", 0.9);
window.xiaochun.camera("close_up", { movement: "push_in", durationSec: 1.5 });
window.xiaochun.camera.reset();
window.xiaochun.camera.panUp(2.2);
window.xiaochun.stop();

// Raw Protocol URL String
window.xiaochun.protocol("xiaochun://camera?shot=extreme_close_up&movement=push_in");

// Low-Level Protocol Bridge
window.__triggerXiaoChunProtocol('motion', { name: 'handHeart' });
```

---

## 5. Cold Start vs Warm Start (Desktop)

On **warm start** (app already running), the deep-link plugin delivers URLs via `on_open_url`, which the native host dispatches to the same `pending_messages` + `protocol:action` path as CLI argv.

On **cold start** (app fully quit), especially on **macOS**, the launch URL is often **not** present in process argv. The host recovers it via:

1. `RunEvent::Opened` (primary on macOS/iOS)
2. `DeepLinkExt::get_current()` during setup, plus short delayed polls if Opened races setup
3. Existing `on_open_url` / argv / pending queue paths

Raw URLs are deduped within 5s so Opened + get_current + `on_open_url` do not double-speak. The frontend still drains `get_pending_protocol_actions` and dedupes by message `id`.

Prefer **URL-encoded** parameters for portability; unencoded Chinese in `open "xiaochun://speak?text=..."` is usually OK on macOS but encoding is safer across shells and platforms.

---

## 6. Transport mapping: `xiaochun://` vs. `xc.*` (iframe / npm SDK)

The embed bridge (`src/embed/bridge.ts`) and the deep-link entry (`initProtocolListener`) share **one handler** (`src/core/protocol/handler.ts`, types in `types.ts`, audio helpers in `audio.ts`). Only the transport differs.

| `xc.*` (iframe postMessage / SDK) | Protocol Action | `xiaochun://` (Desktop Deep Link) |
| :--- | :--- | :--- |
| `xc.say { text }` | `speak { text }` | `xiaochun://speak?text=…` |
| `xc.say { mode: 'chat' }` | — (LLM chat; no deep link form) | — |
| `xc.audio { source: <URL> }` | `speak { audioUrl[, text] }` → `audio` | `xiaochun://speak?audioUrl=…[&text=…]` |
| `xc.audio { source: ArrayBuffer \| Blob }`, `xc.audio.chunk`, `xc.audio.end` | `audio { source \| stream }` | — (binary data cannot fit in a URL) |
| — | `speak { file }` | `xiaochun://speak?file=…` (desktop shell only) |
| `xc.motion { name, loop, mask, fadeDuration }` | `motion { name, loop, mask, fadeDuration }` | `xiaochun://motion?name=…[&loop=true][&mask=upperBody]` |
| `xc.motion { group }` | `motion-group { name }` | `xiaochun://motion-group?name=…` (or `xiaochun://motion?group=…`) |
| `xc.motion { stop: true }` | `motion { stop: true }` | `xiaochun://motion?stop=true` |
| `xc.expression { name, intensity }` | `expression { name, intensity }` | `xiaochun://expression?name=…[&intensity=0.8]` |
| `xc.camera { shot, movement, durationSec, ... }` | `camera { shot, movement, ... }` | `xiaochun://camera?shot=…[&movement=…][&durationSec=1.2]` |
| `xc.stop` | `stop` | `xiaochun://stop` |
| `xc.transport { playbackRate, volume }` | — (audio rate / gain) | — |
| `xc.clock { time, playing }` | — (hostClock alignment) | — |

Helpers in `@firetable/project-xiaochun`:
- `toProtocolUrl(action)`: Builds standard URL from action object (`speak`, `motion`, `motion-group`, `expression`, `camera`, `stop`).
- `parseProtocolUrl(url)`: Parses deep link URL back into structured action object.
- `XC_PROTOCOL_MAPPING`: Single source of truth mapping array.
