# Edge TTS Proxy (`/api/tts`) & Client Vocal Post-Processing

> **Core Files**:
> - [`src/server.ts`](../src/server.ts) — Cloudflare Worker `/api/tts`: single-flight Edge TTS WebSocket proxy, retry, edge cache, 502 with `reasons`
> - [`src/lib/edge-tts-core.ts`](../src/lib/edge-tts-core.ts) — endpoints, `TRUSTED_CLIENT_TOKEN`, `Sec-MS-GEC` (v1), SSML / frame parsing
> - [`src/director/vocalProcessor.ts`](../src/director/vocalProcessor.ts) — Web Audio & Tone.js 15.x DSP pipeline (`VocalAudioProcessor`), 3D distance attenuation, bit-exact bypass routing
> - [`vite/localApiPlugin.ts`](../vite/localApiPlugin.ts) — dev-only `/api/tts`: proxies to `TTS_PROXY_URL` (Node `fetch`, UA `node`) or connects Edge directly
>
> **Related**: client chunking, parallel prefetch and text fallback on TTS failure → [`CHAT_DIRECTOR.md`](CHAT_DIRECTOR.md).

---

## 1. Request / Response

`POST /api/tts` (or `GET ?text=&voice=&pitch=&rate=&volume=`), body `{ text, voice?, pitch?, rate?, volume? }`:
- `voice`: 目标发音人（默认 `zh-CN-XiaoyiNeural`）
- `pitch`: 音调偏移（默认 `+10Hz`）
- `rate`: 语速变化，支持百分比（默认 `+0%`，如 `+20%`, `-10%`）
- `volume`: 音量增益（默认 `+0%`，如 `+15%`）

| Result | Status | Body / Headers |
| :-- | :-- | :-- |
| Success | 200 | `audio/mpeg` stream (MP3, 24 kHz mono 48 kbps), `X-TTS-Cache: MISS \| HIT \| R2-HIT`, `X-TTS-Storage: r2 \| r2+pop \| pop \| none` |
| Empty text | 400 | `{"error":"text is required"}` |
| Upstream failure | 502 | `{"error": "<root cause> (after N attempts)", "reasons": [...]}` |

### 1.1 3-Tier Multi-Layer Caching Architecture

为了同时保障低延迟、高并发可用性与持久留存，`/api/tts` 采用三级渐进式缓存设计：
1. **L1 边缘 PoP 内存缓存 (`caches.default`)**:
   - 响应延迟: **< 15 ms**
   - 存储生命周期: 短期热点（受 Cloudflare PoP LRU 内存置换机制管理）
   - 响应标头: `X-TTS-Cache: HIT`
2. **L2 R2 对象存储持久化缓存 (`TTS_BUCKET` -> `xiaochun-tts`)**:
   - 响应延迟: **20 ~ 50 ms**
   - 存储生命周期: 永久沉淀，跨区域共享，0 Egress 流量费用
   - 命中时自动异步写回所在 PoP 的 L1 缓存，下一次直接进入 < 15ms 极速通道
   - 响应标头: `X-TTS-Cache: R2-HIT`
   - 存储路径: `v1/${voice}/${hashKey}.mp3`
   - 复合缓存哈希: `hashKey = SHA-256(voice|pitch|rate|volume|text)`，严格隔离不同语速、音高和音量参数，杜绝跨参数音频碰撞
3. **L3 Edge-TTS 上游实时合成**:
   - 响应延迟: **~1.0 s** 首包流式下发
   - 响应标头: `X-TTS-Cache: MISS`
   - 合成完成后在后台自动双写异步沉淀至 L1 与 L2

### 1.2 开源项目零配置与优雅降级保证
本项目开源部署对 R2 持久存储完全解耦（Duck-Typed）：
- **启用 R2 持久缓存（推荐）**：
  ```bash
  # 1. 创建 R2 bucket (仅需执行一次)
  pnpm run setup:tts-cache
  # 2. wrangler.jsonc 默认已包含 TTS_BUCKET 绑定，直接部署即可
  pnpm run deploy
  ```
- **无需 R2 持久缓存**：
  若个人用户无 R2 额度，仅需在 `wrangler.jsonc` 中删除或注释 `r2_buckets` 配置。Worker 运行时会自动检测 `env.TTS_BUCKET`，缺失时自动无缝退化为 `L1 PoP 内存缓存 + L3 实时合成`，没有任何运行时报错或部署阻碍。

### 1.3 独立 TTS 专属微服务 Worker (`xiaochun-tts`)

项目不仅支持在主站内内置 `/api/tts`，还支持将 TTS 提取为纯净的微服务单独部署：
- **入口代码**: [`src/tts-worker.ts`](../src/tts-worker.ts)（与主站共用 [`src/server/ttsHandler.ts`](../src/server/ttsHandler.ts)）
- **配置文件**: [`wrangler.tts.jsonc`](../wrangler.tts.jsonc)
- **极速部署**:
  ```bash
  # 单独部署 TTS 微服务（仅 34 KiB，0 前端依赖，秒级上线）
  pnpm run deploy:tts
  ```
- **线上地址**: `https://xiaochun-tts.firetable.workers.dev`
  - `GET /` 或 `/health`：返回微服务运行状态与 R2 缓存能力检测
  - `POST /api/tts` 或 `GET /api/tts?text=...`：标准 5 维参数流式语音合成
  - 可直接填入 `.env.local` 作为 `TTS_PROXY_URL`，供本地开发或 Tauri 桌面客户端直接使用。

## 2. Upstream Connection

| Item | Value |
| :-- | :-- |
| Primary endpoint | `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=<TRUSTED_CLIENT_TOKEN>` |
| Fallback endpoint | `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=<TRUSTED_CLIENT_TOKEN>` |
| Token | `Sec-MS-GEC` v2 = CS64 + SHA-256 (`<16 hex>-<64 hex>`), `Sec-MS-GEC-Version=2-143.0.3650.75` |
| Per round | **one** request (no parallel hedging) |
| Rounds | up to 3; 429 → wait 3 s; other errors → 200–400 ms backoff |
| Budget | ~7 s total (a retry is skipped if wait + 3.5 s would exceed it), so the client's 8 s `withTimeout` still receives the 502 |
| First-chunk timeout | 3.5 s per flight |
| Errors | `AggregateError` is unwrapped to the real cause (`Handshake failed: HTTP 403`, `Upstream rejected: …`, timeout); distinct per-round causes go into `reasons` |

## 3. Troubleshooting / 2026-10 Upstream 403 Incident

### 3.1 Symptoms
- Every production `POST /api/tts` returned **502** `{"error":"All promises were rejected"}` for ~half a day (2026-10-14).
- Worker logs: `outcome: ok`, wallTime ~1.7 s, cpu ~8 ms; `Hedged Round #1..#4 failed: All promises were rejected` (the old hedged code hid the real cause).
- The app showed TTS-failure text fallback (see `CHAT_DIRECTOR.md`).

### 3.2 Diagnosis
1. `curl` production → 502 + the opaque aggregate message.
2. `npx wrangler tail project-xiaochun --format json` while sending one request → four failed rounds, no exception.
3. `npx wrangler deployments list --name project-xiaochun` → no TTS code change around the onset (`edge-tts-core.ts` untouched since 2026-09); a deploy happened to coincide in time.
4. Direct WebSocket handshake from a dev Mac (curl with `Upgrade: websocket`):
   - legacy host + v1 token, version `1-143…` → **403**; version `2-143…` → **403**
   - new host `api.msedgeservices.com` + same v1 token → **101**
5. Ruled out clock skew: `curl -sI https://speech.platform.bing.com | grep -i date` matched local UTC to the second.
6. Ruled out IP ban: `…/readaloud/voices/list?trustedclienttoken=…` still **200**.
7. Upstream: [rany2/edge-tts#490](https://github.com/rany2/edge-tts/issues/490) — from 2026-10-10 Microsoft rolled out a **v2 `Sec-MS-GEC`** (`<16 hex>-<64 hex>`, `Sec-MS-GEC-Version=2-155…`) region by region; the legacy host rejects v1 tokens. Fixed in edge-tts **7.3.0**; the community workaround is the new host with the old v1 token.

### 3.3 Root Cause
Microsoft-side protocol change: the legacy synthesis host now requires a v2 token. Our constants were up to date with edge-tts 7.2.x; bumping only the version string does not help.

### 3.4 Fix
Switch to the new host + `Ocp-Apim-Subscription-Key` (legacy fallback on 403), replace hedged dual-flight with single-flight rounds, 429 backoff, 7 s budget, 3.5 s first-chunk timeout, keep AggregateError unwrapping with `reasons` (§2). `vite/localApiPlugin.ts` direct mode uses the new host too.

### 3.5 Local Verification
The full Worker entry imports TanStack SSR and does not bundle standalone with `wrangler dev`, so a harness copies `src/server.ts` with the SSR handler stubbed:

```bash
mkdir -p grok/ttsharness
sed "s#^import handler from '@tanstack/react-start/server-entry';#const handler = { fetch: async () => new Response('stub', {status: 404}) };#; s#'./lib/#'../../src/lib/#g" \
  src/server.ts > grok/ttsharness/entry.ts
echo '{"name":"tts-harness","main":"entry.ts","compatibility_date":"2026-01-01","compatibility_flags":["nodejs_compat"]}' > grok/ttsharness/wrangler.json
npx wrangler dev -c grok/ttsharness/wrangler.json --local --port 8799 --ip 127.0.0.1
curl -s -o /tmp/t.mp3 -D - -X POST http://127.0.0.1:8799/api/tts \
  -H 'Content-Type: application/json' -d '{"text":"你好，小蠢正在说话。"}'
afinfo /tmp/t.mp3   # macOS: duration
```

Result (workerd, 5 sequential distinct texts): all **200** `audio/mpeg`, 24.6–25.8 KB, ~4.1–4.3 s audio, TTFB 0.82–1.22 s, total 1.1–1.5 s, no 429, no legacy fallback; repeat request `X-TTS-Cache: HIT` in 4 ms.

> Note: `pnpm dev` (5185) does **not** run `src/server.ts`; with `TTS_PROXY_URL` set it forwards to the remote Worker, so it mirrors production behaviour.

### 3.6 Next Time
```bash
# 1. real cause from production (502 body carries reasons)
curl -sS -X POST https://xiaochun.firetable.tech/api/tts -H 'Content-Type: application/json' -d '{"text":"你好"}'
# 2. live logs
npx wrangler tail project-xiaochun --format json
# 3. raw handshake (expect 101); swap host / version to compare
TOK=6A5AA1D4EAFF4E9FB37E23D68491D6F4
GEC=$(node -e "let t=Date.now()/1000+11644473600;t-=t%300;t*=1e7;console.log(require('crypto').createHash('sha256').update(t.toFixed(0)+'$TOK').digest('hex').toUpperCase())")
curl -s -m 10 -o /dev/null -w '%{http_code}\n' --http1.1 \
  "https://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=$TOK&Sec-MS-GEC=$GEC&Sec-MS-GEC-Version=1-143.0.3650.75&ConnectionId=$(uuidgen|tr -d -)" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" -H 'Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0'
# (a 101 holds the socket open; curl exits on -m timeout — that is expected)
# 4. clock & IP sanity
curl -sI https://speech.platform.bing.com | grep -i '^date'; date -u
# 5. upstream: check rany2/edge-tts issues / latest constants.py & drm.py
```
A 403 says nothing about *why* (bad token, version, or host all look the same) — compare against the latest edge-tts release.

### 3.7 Long-Term Risk
- Microsoft may start requiring the v2 token on the new host as well. The fix would be porting edge-tts 7.3.0's v2 generator (PR #492). That algorithm is reconstructed from `msedge.dll` and embeds a Microsoft copyright string — **review the legal implications before adopting it**.
- `/api/tts` is unauthenticated with CORS `*`; third-party callers (e.g. Node clients on VPS IPs) consume upstream quota and raise 429 risk.

---

## 4. Client-Side Vocal Post-Processing Pipeline & 3D Spatial Acoustics

> **Core Files**:
> - [`src/director/vocalProcessor.ts`](../src/director/vocalProcessor.ts) — Web Audio & Tone.js 15.x DSP pipeline (`VocalAudioProcessor`), bit-exact bypass routing, 3D distance attenuation curve, safe parameter ramping
> - [`src/config.ts`](../src/config.ts) — Vocal presets (`bypass`, `sweet`, `oneesan`, `radio`, `whisper`), default configuration (`bypass` + `distanceAttenuation: true`), 3D camera acoustic bounds
> - [`src/director/chatDirector.ts`](../src/director/chatDirector.ts) — Signal routing insertion (`sourceNode -> vocalProcessor -> destination`) and viseme isolation
> - [`src/components/dev-drawer/sections/VocalSection.tsx`](../src/components/dev-drawer/sections/VocalSection.tsx) — Real-time acoustics control, live spatial distance badges (`near` / `standard` / `mid` / `far`), parameter sliders

While `/api/tts` synthesizes raw Microsoft Edge-TTS audio at the edge, Project XiaoChun features an advanced **in-browser DSP vocal post-processing pipeline** powered by Web Audio API and Tone.js 15.x. It delivers broadcast-quality vocal presence, anime warmth, and dynamic 3D camera distance acoustics directly on the client.

### 4.1 Architecture & Separation of Concerns

To guarantee that post-processing never degrades motion fidelity or introduces visual artifacts, the audio processing is strictly decoupled across functional domains:

1. **Viseme & Motion Isolation**:
   - The lip-sync analyzer (`AnalyserNode`) and EMAGE co-speech gesture engine receive the **raw, unadulterated audio stream** before any DSP coloration.
   - Reverb tails, dynamic compression, and EQ boosts never leak into viseme energy calculation or body gesture prediction.
2. **Bit-Exact Pure Bypass Branch**:
   - When the user selects the default `bypass` (原声直通) preset or disables vocal enhancement, audio travels exclusively through a dedicated `dryGain` bypass node (`inputNode -> dryGain -> outputNode`).
   - The signal completely skips the filter, EQ, compressor, and reverb nodes, ensuring zero phase shift, zero harmonic distortion, and 100% digital parity with raw Edge-TTS.
3. **Decoupled Control State**:
   - Switching acoustic presets modulates **only** DSP slider parameters (low cut, EQ gains, compressor threshold/ratio, reverb wet/size). It **never** mutates the user's top-level switches (`enabled`, `sceneLinkage`, `distanceAttenuation`).
4. **Zero-Glitch Live Automation**:
   - All acoustic parameters support smooth microsecond ramps (`rampTime = 0.03s`), allowing live adjustment from the DevDrawer during active playback without clicks, pops, or audio dropouts.
5. **Robust Headless Fallback**:
   - In SSR, Node.js unit test environments, or older browsers without Web Audio context support, the processor smoothly degrades to a native passthrough node without crashing.

### 4.2 Signal Routing & Processing Graph

```mermaid
flowchart TD
    subgraph Input["Audio Input Stream"]
        RawAudio["Decoded Edge-TTS Audio (MP3)"]
    end

    subgraph MotionPath["Isolated Analysis Branch"]
        Analyser["AnalyserNode (Lip-Sync & Visemes)"]
        Emage["EMAGE Gesture Model (Raw Audio)"]
    end

    subgraph VocalProcessor["VocalAudioProcessor (Tone.js Graph)"]
        InputNode["inputNode (Tone.Gain)"]
        
        subgraph DryBranch["Bit-Exact Bypass Path"]
            DryGain["dryGain (Tone.Gain)"]
        end
        
        subgraph WetBranch["Acoustic Enhancement DSP Chain"]
            LowCut["lowCut (Tone.Filter Highpass @ 70~100Hz)"]
            EQ["eq (Tone.EQ3: 350Hz Low / Mid / 3500Hz High)"]
            Comp["compressor (Tone.Compressor: Fast Attack / 150ms Release)"]
            Verb["reverb (Tone.Freeverb: Room Size & Dampening)"]
            WetGain["wetGain (Tone.Gain)"]
        end
        
        OutputNode["outputNode (Tone.Gain)"]
    end

    subgraph Destination["Hardware Output"]
        Speakers["audioContext.destination (Speakers / Headphones)"]
    end

    RawAudio --> Analyser
    RawAudio --> Emage
    RawAudio --> InputNode

    %% Bypass Routing
    InputNode -->|isRawBypass = true| DryGain
    DryGain --> OutputNode

    %% Wet Chain Routing
    InputNode -->|isRawBypass = false| LowCut
    LowCut --> EQ
    EQ --> Comp
    Comp --> Verb
    Verb --> WetGain
    WetGain --> OutputNode

    OutputNode --> Speakers
```

### 4.3 3D Camera Distance Attenuation & Spatial Zoning

Project XiaoChun links the 3D orbit camera distance to the vocal acoustics, simulating realistic auditory perspective.

#### 4.3.1 Distance-to-Acoustic Mapping Algorithm

The acoustic mapping distinguishes three primary distance domains:

$$\begin{aligned}
d_{\text{min}} &= 0.6\,\text{m} \quad (\text{Minimum camera approach}) \\
d_{\text{ref}} &= 2.2\,\text{m} \quad (\text{Reference conversation distance}) \\
d_{\text{drop}} &= 8.0\,\text{m} \quad (\text{Attenuation start threshold}) \\
d_{\text{max}} &= 15.0\,\text{m} \quad (\text{Maximum stage vista})
\end{aligned}$$

1. **Near-Field Proximity Boost ($0.6\,\text{m} \le d < 2.2\,\text{m}$)**:
   - As the camera pushes close to XiaoChun, the voice increases in volume and gains chest warmth, recreating an intimate, close-mic ear-whispering sensation.
   - **Interpolation factor**: $t = \frac{d_{\text{ref}} - d}{d_{\text{ref}} - d_{\text{min}}} \in [0, 1]$
   - **Chest Resonance (EQ Low 350Hz)**: Boosted up to $+3.0\text{ dB}$ ($\Delta \text{chest} = +3.0 \times t\,\text{dB}$).
   - **Volume Gain**: Boosted up to $+3.0\text{ dB}$ ($G_{\text{offset}} = 10^{(3.0 \times t) / 20}$).
2. **Standard & Mid-Field Flat Zone ($2.2\,\text{m} \le d \le 8.0\,\text{m}$)**:
   - Within typical observation and medium staging distances, **no volume attenuation occurs** ($G_{\text{offset}} = 1.0\times / 0\text{ dB}$).
   - Chest resonance offset remains flat ($0\text{ dB}$), preserving clear, clean, and uncolored vocal delivery.
3. **Far-Field Distance Attenuation ($8.0\,\text{m} < d \le 15.0\,\text{m}$)**:
   - Volume attenuation strictly begins **after 8.0 meters**, preventing XiaoChun's voice from dropping off when simply reframing full-body shots.
   - **Interpolation factor**: $s = \frac{d - d_{\text{drop}}}{d_{\text{max}} - d_{\text{drop}}} \in [0, 1]$
   - **Volume Attenuation**: Smoothly drops from $0\text{ dB}$ at $8.0\text{m}$ down to $-8.0\text{ dB}$ ($\approx 0.40\times$) at $15.0\text{m}$ ($G_{\text{offset}} = 10^{(-8.0 \times s) / 20}$).
   - **Chest Resonance**: Remains flat at $0\text{ dB}$, ensuring distant speech stays crisp without muddiness.

#### 4.3.2 Camera Spatial Zones

The DevDrawer and acoustic inspector display real-time spatial badges based on distance:

| Zone Badge | Distance Range | Acoustic Characteristics | Typical Framing |
| :--- | :--- | :--- | :--- |
| `near` | $< 1.6\text{m}$ | Proximity boost: $+3.0\text{ dB}$ volume & $+3.0\text{ dB}$ chest resonance (warm & intimate) | Close-up portrait, facial details |
| `standard` | $1.6\text{m} \sim 4.5\text{m}$ | Flat unity gain ($0\text{ dB}$), natural timbre (default distance $2.2\text{m} \sim 4.3\text{m}$) | Bust-up, standard conversation |
| `mid` | $4.5\text{m} \sim 8.0\text{m}$ | Flat unity gain ($0\text{ dB}$), full-body framing stability | Full-body dancing, walking |
| `far` | $\ge 8.0\text{m}$ | Smooth volume attenuation (down to $-8.0\text{ dB}$ / $0.40\times$ at $15\text{m}$) | Wide stage vista, architectural view |

### 4.4 Acoustic Presets Matrix

The application provides 5 curated acoustic presets configured in `src/config.ts`:

| Preset | Key | Low-Cut | Chest EQ (350Hz) | Mid EQ | Air EQ (3.5kHz) | Compressor | Reverb Wet / Room | Character |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **原声直通 (Default)** | `bypass` | *Bypassed* | *Bypassed* | *Bypassed* | *Bypassed* | *Off (0 dB / 1:1)* | *0%* | 100% digital bit-exact Edge-TTS dry signal; distance attenuation active |
| **甜美软萌** | `sweet` | 85 Hz | -0.5 dB | +0.5 dB | +3.0 dB | -16 dB (3.0:1) | 6% wet (0.20 room) | Transparent highs, crisp presence, sweet anime idol timbre |
| **温柔御姐** | `oneesan` | 75 Hz | +3.5 dB | +1.0 dB | +1.5 dB | -22 dB (4.5:1) | 10% wet (0.30 room) | Deep chest resonance, warm mid-body, mature and calming presence |
| **复古电台** | `radio` | 300 Hz | -6.0 dB | +4.5 dB | -4.0 dB | -28 dB (8.0:1) | 4% wet (0.15 room) | Bandpass lo-fi, focused mid-range, telephone/radio broadcast character |
| **贴耳耳语** | `whisper` | 100 Hz | +1.0 dB | -1.5 dB | +5.0 dB | -26 dB (5.0:1) | 15% wet (0.45 room) | Enhanced air harmonics, intimate compression, ASMR room space |

### 4.5 Critical Web Audio & Tone.js Engineering Standards

When developing or extending audio processing nodes in modern browsers, adhere strictly to these architectural invariants:

#### 1. The `exponentialRampToValueAtTime` Crash Trap (`safeRampParam`)
- **The Problem**: According to the W3C Web Audio API specification, calling `exponentialRampToValueAtTime` on an `AudioParam` throws an immediate, fatal `DOMException` if the target value is less than or equal to zero ($\le 0$).
- **The Pitfall in Tone.js**: Tone.js's native `Param.rampTo()` method inspects the parameter's unit. When `unit === "decibels"`, Tone.js naively issues an exponential ramp. Consequently, setting negative decibels (such as compressor threshold at $-18\text{ dB}$, or EQ cuts at $-0.5\text{ dB}$) or zero gain triggers a DOMException, muting the audio output permanently!
- **The Solution**: All parameter automations in `VocalAudioProcessor` must go through `safeRampParam()`:
  ```ts
  private safeRampParam(param: any, value: number, rampTime = 0.03): void {
    if (!param) return;
    try {
      if (typeof param.targetRampTo === 'function') {
        param.targetRampTo(value, rampTime); // Uses setTargetAtTime
      } else if (typeof param.linearRampTo === 'function') {
        param.linearRampTo(value, rampTime); // Safe linear interpolation
      } else if ('value' in param) {
        param.value = value;
      }
    } catch {
      if ('value' in param) param.value = value;
    }
  }
  ```

#### 2. Bit-Exact Bypass Routing Guarantee
- When `preset === 'bypass'`, the audio graph **must not** route audio through inactive filters or zero-wet effects. Even with wet gain at 0, passing through digital IIR filters (like highpass or peaking EQ) introduces phase smearing and latency.
- Instead, the processor switches routing entirely to `dryGain`:
  ```ts
  this.safeRampParam(this.dryGain?.gain, effDry, smoothTime);
  this.safeRampParam(this.wetGain?.gain, 0, smoothTime);
  ```
  This guarantees that in the default state, users hear pristine, bit-exact Edge-TTS audio with zero distortion.

