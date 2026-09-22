# SenseVoice On-Device STT (ChatBar Dictation)

> **Core Files**:
> - [`src/stt/`](../src/stt/) — energy VAD, SenseVoice ORT Worker, transcript filter, ChatBar client
> - [`src/components/ChatBar.tsx`](../src/components/ChatBar.tsx) — mic UX, dual-layout composer, cursor insert
> - [`src/config.ts`](../src/config.ts) — `APP_CONFIG.stt` (CDN base, VAD knobs, ITN, cache keys)

---

## 1. Goal

ChatBar mic dictation runs **fully in the browser / Tauri WebView**:

1. Capture microphone PCM
2. **Energy VAD** auto-segments utterances (otoji `?simple` style — not Zipformer streaming)
3. **SenseVoice Small int8** recognizes each segment in a Dedicated Worker (ORT Web / wasm)
4. Insert cleaned text at the caret in the composer

No cloud ASR. No Zipformer in this milestone.

---

## 2. Model & CDN

| Item | Value |
| :--- | :--- |
| Pack | `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17` |
| Why this pack | Official ITN / punctuation (`use_itn`); multilingual zh/en/ja/ko/yue |
| Files | `model.int8.onnx` (~228MB) + `tokens.txt` |
| Default CDN | `https://cdn.firetable.tech/xiaochun/stt/sensevoice-zh-en-ja-ko-yue-int8-2024-07-17/` |
| Env override | `VITE_STT_BASE` / `VITE_STT_BASE_PROD` (see `.env.example`) |
| Cache | Cache API bucket `xiaochun-stt-v2024-07-17` |

**Mobile**: keep **int8 only**. fp32 (~895MB) is larger/slower and is not the product default.

**Note**: The newer `…-int8-2025-09-09` pack improves Cantonese but **does not support punctuation**; chat dictation prefers 2024-07-17 + ITN.

---

## 3. Pipeline (aligned with otoji `?simple`)

```text
mic (getUserMedia)
  → resample 16 kHz mono
  → energy VAD (preroll ~300ms, trailing silence ~600ms keep-in-segment, max ~20s)
  → SttWorker: download/cache model → ORT session → fbank/LFR/CMVN → CTC decode
  → strip <|…|> tags, drop pure fillers (嗯/啊/…)
  → insertAtCursor(textarea)  // keep listening; do not steal focus
```

### 3.1 “Keep more, drop less” VAD policy

- Auto-segment first; **do not** aggressively trim tail silence before decode
- **Preroll ~300ms** so utterance onsets are not shaved
- Skip only ultra-short segments (&lt; ~250ms)
- Filler filter after decode (does not block normal short phrases)

### 3.2 UX states

| State | Mic affordance |
| :--- | :--- |
| `loading` | Model download/init progress ring |
| `listening` | Mic icon + soft repeating ripple (no fill) |
| `recognizing` | **Keep mic icon**; denser/faster ripple (no spinner swap) |
| `idle` / toggle | Click mic to start/stop continuous dictation |

Composer stays a **single unmounted textarea**; single-line ↔ multi-line is layout-only.

---

## 4. Worker isolation

STT ONNX runs in `sttWorker` (same idea as `emageWorker` / `vrmWorker`):

- Main thread: mic + VAD + UI
- Worker: fetch/cache weights, ORT InferenceSession, decode
- Progress events for download % → init → ready

---

## 5. Browser & Tauri

- Needs microphone permission in both browser and Tauri WebView
- **Production must allow mic in Permissions-Policy**: `microphone=(self)` (never `microphone=()` — empty allowlist suppresses the browser prompt and fails `getUserMedia` immediately). Set in `public/_headers` and `src/server.ts` `ISOLATION_HEADERS`.
- macOS Tauri: `src-tauri/Info.plist` provides `NSMicrophoneUsageDescription` for the OS prompt
- Same CDN URLs; Tauri must allow the CDN host in CSP / capability if locked down
- Local override: point `VITE_STT_BASE` at a folder that serves the two files

---

## 6. Agent invariants

1. ❌ Do not add Zipformer / streaming ASR without an explicit product decision
2. ❌ Do not remount the ChatBar textarea when resizing rows (loses text/focus)
3. ⚠️ Model pack + ITN: prefer `2024-07-17` int8 for punctuated chat inserts
4. ⚠️ Config knobs live under `APP_CONFIG.stt` in `src/config.ts`
