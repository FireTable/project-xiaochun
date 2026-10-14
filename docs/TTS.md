# Edge TTS Proxy (`/api/tts`)

> **Core Files**:
> - [`src/server.ts`](../src/server.ts) — Cloudflare Worker `/api/tts`: single-flight Edge TTS WebSocket proxy, retry, edge cache, 502 with `reasons`
> - [`src/lib/edge-tts-core.ts`](../src/lib/edge-tts-core.ts) — endpoints, `TRUSTED_CLIENT_TOKEN`, `Sec-MS-GEC` (v1), SSML / frame parsing
> - [`vite/localApiPlugin.ts`](../vite/localApiPlugin.ts) — dev-only `/api/tts`: proxies to `TTS_PROXY_URL` (Node `fetch`, UA `node`) or connects Edge directly
>
> **Related**: client chunking, parallel prefetch and text fallback on TTS failure → [`CHAT_DIRECTOR.md`](CHAT_DIRECTOR.md).

---

## 1. Request / Response

`POST /api/tts` (or `GET ?text=&voice=&pitch=`), body `{ text, voice?, pitch? }` (defaults `zh-CN-XiaoyiNeural`, `+10Hz`).

| Result | Status | Body / Headers |
| :-- | :-- | :-- |
| Success | 200 | `audio/mpeg` stream (MP3, 24 kHz mono 48 kbps), `X-TTS-Cache: MISS \| HIT` |
| Empty text | 400 | `{"error":"text is required"}` |
| Upstream failure | 502 | `{"error": "<root cause> (after N attempts)", "reasons": [...]}` |

Successful audio is cached in the Worker cache keyed by `SHA-256(voice|pitch|text)`.

## 2. Upstream Connection

| Item | Value |
| :-- | :-- |
| Primary endpoint | `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=<TRUSTED_CLIENT_TOKEN>` |
| Fallback (on handshake 403) | legacy `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=<…>` |
| Token | `Sec-MS-GEC` v1 = SHA-256(5-min-rounded Windows ticks + token), `Sec-MS-GEC-Version=1-143.0.3650.75` |
| Per round | **one** request (no parallel hedging — the new host returns 429 on bursts) |
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
