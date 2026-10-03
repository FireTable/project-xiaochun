# iframe 内嵌方案 (`/embed` + npm 包 `@firetable/project-xiaochun`)

> 让第三方网页用 `<iframe>` 内嵌小蠢：宿主只需一行 `<script>` 或 `npm i @firetable/project-xiaochun`，由 SDK 负责懒加载、握手、origin 校验、透明穿透与销毁。
> 主站行为不变；`/embed` 是一个**精简入口**（无 TopHeader / DevDrawer / 更新弹窗 / LoadingOverlay），并**默认不预热 WebLLM 与 EMAGE**。

**Core Files**
- [`src/routes/embed.tsx`](../src/routes/embed.tsx) · [`src/embed/EmbedApp.tsx`](../src/embed/EmbedApp.tsx) · [`src/embed/bridge.ts`](../src/embed/bridge.ts) · [`src/embed/params.ts`](../src/embed/params.ts)
- [`src/lib/securityHeaders.ts`](../src/lib/securityHeaders.ts)（响应头策略）· [`src/lib/heavyPreload.ts`](../src/lib/heavyPreload.ts)（重资源懒加载开关）
- [`public/_headers`](../public/_headers) · [`wrangler.jsonc`](../wrangler.jsonc)（`EMBED_FRAME_ANCESTORS`）
- [`packages/project-xiaochun/`](../packages/project-xiaochun/)：SDK、`<xiaochun-avatar>`、协议常量（`src/protocol.ts`，`/embed` 与 SDK **共用同一份**）
- [`.github/workflows/publish-npm.yml`](../.github/workflows/publish-npm.yml) · `scripts/bump-version.mjs`（同时 bump npm 包版本）

---

## 1. 架构

```mermaid
sequenceDiagram
    autonumber
    participant Host as 宿主页 (SDK)
    participant Frame as iframe /embed (bridge.ts)
    Note over Host: lazy: 先放固定尺寸占位图 (无 CLS)<br/>进入视口 + 浏览器空闲 / 点击 / 调用 API 才创建 iframe
    Host->>Frame: 创建 iframe  /embed?host=<宿主 origin>&transparent=1…
    Frame-->>Host: xc.ready  (window.postMessage, targetOrigin = 宿主 origin, 带 capabilities/version)
    Note over Host: 校验 event.source === iframe.contentWindow 且 event.origin ∈ allowedOrigins
    Host->>Frame: xc.init  (window.postMessage, targetOrigin = iframe origin, 转移 MessagePort)
    Note over Frame: 校验 event.source === window.parent 且 event.origin ∈ 宿主白名单; 只接受一次 init
    Frame-->>Host: (之后全部走 MessageChannel 端口) xc.state / xc.load.progress / xc.loaded
    Host->>Frame: xc.say / xc.motion / xc.expression / …
    Frame-->>Host: xc.utterance / xc.stt / xc.hit-region / xc.error
```

- **一个 iframe = 一个完整引擎实例**（独立 WebGL 上下文、独立 Worker、独立 IndexedDB 分区），见 §7 风险。
- 握手后**所有**消息走 `MessageChannel`；端口本身即凭证，不再依赖 `window.postMessage(…, '*')`。
- 页面不可见时暂停渲染：① iframe 内 `visibilitychange`（引擎原有 `bindVisibilityPause`）；② SDK 用 `IntersectionObserver` 在宿主视口外自动发 `xc.pause`，回来发 `xc.resume`；③ 宿主显式 `pause()` 优先级最高（`vrmEngine.hostPaused`，前台恢复也不会唤醒）。

### `/embed` URL 参数（SDK 会自动生成；手写 iframe 时自行拼）

| 参数 | 默认 | 说明 |
| :-- | :-- | :-- |
| `host` | —（**必填**） | 宿主页 origin。缺失且无法从 `ancestorOrigins`/`referrer` 推断时，握手 **fail closed**（不发 `xc.ready`、不接受 `xc.init`） |
| `allow` | — | 额外允许握手的宿主 origin，逗号分隔；**不支持 `*`** |
| `transparent` | `0` | `1` = 背景透明（叠在宿主页上）。仅 `/embed` 与 Tauri 允许透明场景，普通网页仍受限 |
| `ui` / `bubble` | `0` / 跟随 `ui` | 是否显示内置 ChatBar / 头顶气泡 |
| `lang` | 跟随 cookie | `zh-CN` · `en` · `ja` |
| `heavy` | `lazy` | `lazy` = 不预热 WebLLM / EMAGE；`eager` = 与主站一致，VRM 加载完立即预热 |
| `outfit` | default addon | 初始服装 key（`APP_CONFIG.model.addons`） |
| `theme` | 跟随系统 | 非透明时的线稿主题 `light` / `dark` |
| `controls` | `0` | `1` = 放开滚轮缩放（默认锁定，避免 iframe 吞宿主页滚动） |

---

## 2. postMessage 协议（v1）

消息名统一 `xc.` 前缀，信封：`{ type, v: 1, id?, payload }`。类型与常量见 [`protocol.ts`](../packages/project-xiaochun/src/protocol.ts)。
宿主命令可带 `id`，对应的 `xc.error` / `xc.utterance` 会回带同一 `id`（SDK 的 `say()` 靠它在 `end` 时 resolve）。

### 2.1 宿主 → iframe

| 消息 | payload | 状态 | 映射到 |
| :-- | :-- | :-- | :-- |
| `xc.init` | `{ hostOrigin }` + 转移 `MessagePort` | ✅ | 握手（仅一次） |
| `xc.say` | `{ text, mode?: 'speak'｜'chat' }` | ✅ | `speak` → protocol action `speak`（与 `xiaochun://speak?text=` 同一 handler）→ `vrmEngine.speakText`（TTS + EMAGE，**不经 LLM**）；`chat` → `vrmEngine.sendMessage`（经 WebLLM / 自定义 provider，会触发大模型加载）。文本上限 `MAX_SAY_CHARS=2000` |
| `xc.audio` | `{ source: ArrayBuffer｜Blob｜url, mimeType?, format?, sampleRate?, channels?, text?, motion?, lipsync? }` | ✅ | 宿主给**整段音频**，**不经 TTS**：iframe 内解码 → 单声道 → 16 kHz → EMAGE 窗口推理（动作）+ 同一段音频播放 + RMS 口型。详见 §2.4。信封 `id` 关联 `xc.utterance` / `xc.error` |
| `xc.audio.chunk` | `{ data: ArrayBuffer, format:'pcm16'｜'float32', sampleRate, channels?, text?, motion?, lipsync? }`（信封 `id` = 流 id） | ✅ | 流式 PCM 分块；同一 `id` 的第一块开启一次说话，之后追加。选项只在第一块生效 |
| `xc.audio.end` | `{ abort?: boolean }`（信封 `id` = 流 id / 整段 `xc.audio` 的 id） | ✅ | 收尾（播完已收到的音频）；`abort:true` 立即停播。整段 `xc.audio` 也可用同一 `id` 打断（SDK 的 `AbortSignal`） |
| `xc.motion` | `{ url｜name, loop?, fadeDuration?, timeScale?, mask? }` 或 `{ stop: true }` | ✅ | `vrmEngine.playMotion` / `stopMotion`。仅 https 或同源 `.vrma`；内置名目前只有 `thinking` |
| `xc.expression` | `{ name }`（`neutral/happy/angry/sad/relaxed/surprised`） | ✅ | `vrmEngine.setExpression` |
| `xc.pointer` | `{ x, y }`（iframe 内 client 坐标） | ✅ | `vrmEngine.isHitModel` → 回 `xc.hit-region`（**只做命中检测，不驱动视线**） |
| `xc.setModel` | `{ outfit }` 或 `{ url, name? }` | ✅ | `vrmEngine.swapOutfit`（保留动作/视线）。`outfit` 取 `base` 或 `APP_CONFIG.model.addons` 的 key；`url` 仅 https/同源 `.vrm/.vrmaddon/.vrmbase`（需 CORS） |
| `xc.setConfig` | `{ lang?, transparent?, ui?, heavy? }` | ✅ | i18n / `sceneManager.setScene(…, false)`（不写 iframe localStorage）/ ChatBar 显隐 / `heavyPreload` 开关（`eager` 立即预热） |
| `xc.mic` | `{ enabled }` | ✅ | `SttClient.start/stop`（SenseVoice，首次开启才下载模型），结果走 `xc.stt` |
| `xc.pause` / `xc.resume` | — | ✅ | `suspendRendering` / `resumeRendering` |
| `xc.destroy` | — | ✅ | `releaseHeavyResources` + `vrmEngine.dispose` + 关闭端口；SDK 随后移除 iframe |
| `xc.lookAt` | `{ x, y }` | ⏳ **unsupported** | 回 `xc.error{code:'unsupported'}`。**TODO**：视线目前由相机 + 随机扫视驱动（`GazeController`），没有外部注视点入口，需先在 gaze 层新增 `overrideTarget` |

### 2.2 iframe → 宿主

| 消息 | payload | 说明 |
| :-- | :-- | :-- |
| `xc.ready` | `{ version, protocol, capabilities:{ commands[], unsupported[], stt, transparent, audio?:{ formats[], streaming, maxSeconds }, crossOriginIsolated?:boolean } }`（`crossOriginIsolated` 为 iframe 内 `self.crossOriginIsolated`，仅诊断：宿主开了隔离且 `allow` 委派后应为 `true`） | 握手第一步（window.postMessage，严格 targetOrigin）。1s 间隔最多重发 10 次直到收到 `xc.init` |
| `xc.load.progress` | `{ phase:'model', progress:0-100 }` | 模型下载 / 合成进度 |
| `xc.loaded` | `{ model }` | 初始模型或 `setModel` 完成（SDK 的 `ready` Promise 在此 resolve） |
| `xc.state` | `{ phase, paused, heavy }` | `phase`: `loading｜idle｜thinking｜speaking｜listening｜paused` |
| `xc.stt` | `{ kind:'state'｜'progress'｜'text', … }` | 听写状态 / 模型下载百分比（整数变化才发） / 识别文本 |
| `xc.utterance` | `{ phase:'start'｜'end', text, kind?:'text'｜'audio' }` | `say` / `audio` 开始 / 结束（被新的说话打断也会发 `end`）。`kind:'audio'` = 宿主音频（没有走 TTS） |
| `xc.hit-region` | `{ hit, x, y }` | 指针是否落在角色身上，仅变化时发；SDK 据此切换 iframe `pointer-events` |
| `xc.error` | `{ code, message, command? }` | `code`: `unsupported｜bad_request｜not_ready｜origin_denied｜failed`（SDK 另有本地 `timeout`） |

### 2.3 Origin 校验清单

| 位置 | 规则 |
| :-- | :-- |
| 宿主 SDK 收 `xc.ready` | `event.source === iframe.contentWindow` **且** `event.origin ∈ {origin} ∪ allowedOrigins`；否则丢弃并 emit `error{origin_denied}` |
| 宿主 SDK 发 `xc.init` | `targetOrigin` = 已校验的 `event.origin`（永不 `'*'`） |
| iframe 收 `xc.init` | `event.source === window.parent` **且** `event.origin ∈ 宿主白名单`；只接受**第一次** init（防重放换端口） |
| iframe 发 `xc.ready` | `targetOrigin` = 宿主 origin（宿主若已跳转到别的 origin，浏览器直接丢弃） |
| 之后 | 全部走 MessagePort |
| URL 类参数 | `motion` / `setModel` 的 URL 只允许 https 或同源 + 扩展名白名单 |
| `normalizeOrigin()` | 拒绝 `*` / `null` / 非 http(s)，并去掉路径 |

### 2.4 宿主音频（`xc.audio` / `xc.audio.chunk`）：现状、链路与限制

**结论**：EMAGE 的输入本来就是「16 kHz 单声道 PCM」，与来源无关；现有 `文字 → /api/tts → MP3 流式解码 → 16 kHz PCM` 里 TTS 只是 PCM 的一种来源。所以宿主音频只需「解码 → 单声道 → 降采样」，不必改模型，也不需要平行链路。

```
xc.audio(ArrayBuffer/Blob/URL)                         xc.audio.chunk (PCM16/Float32 …)
        │ decodeAudioData (OfflineAudioContext 48 kHz)           │ 下混 → Float32
        └──────────────┬────────────────────────────────────────┘
                       ▼  HostAudioInput { sampleRate, chunks }            (src/director/hostAudio.ts)
              PcmSlicer: 首片 2 s、其后 4 s                               (HOST_AUDIO.firstSliceSec / sliceSec)
              │  每片:  StreamResampler16k(盒式滤波) ─► EmagePlayer.pushAudioChunk ─► worker 窗口推理 (T=64, 滑窗) ─► checkpoint ─► motion
              │         原采样率 AudioBuffer (排队播放)
              ▼
        ChatDirector.speakAudio  ── 复用 speakText 的 A/V 同步 (P0a: 首块动作缓冲 → AudioBufferSourceNode.start → releaseMotionForAudio)
                                 ── 口型 = AnalyserNode RMS × 4 → 'aa' 表情 (chatDirector.tick, 与 TTS 完全相同)
                                 ── 播完 → xc.utterance{phase:'end', kind:'audio'}
```

| 项 | 现状 |
| :-- | :-- |
| EMAGE 对输入的要求 | 16 kHz / 单声道 / Float32；窗口 `T=64` 帧（≈2.13 s，30 fps）。可以直接喂**任意**音频（含人声以外的声音，只是动作会按"说话"风格生成） |
| 口型 | **只有音量**（RMS → `aa`），没有 viseme / 音素对齐；`lipsync:false` 可关。原因：现有口型本来就只依赖 `AnalyserNode`，不依赖 TTS 内部事件，所以外部音频可以零改动复用；更精细的 viseme 需要新模型/对齐，未做 |
| A/V 同步 | 复用 P0a：首块动作只缓冲，等音频真正 `start` 后才释放；动作 playhead 跟随 `AudioContext` 时钟 |
| 延迟（TTFA） | = 解码 + 首片（2 s 音频）推理 + 1 次 decode。**本机实测（无头 Chromium + swiftshader，Mac 桌面 CPU，INT8 wasm）：热状态从 `utterance start` 到音频 `start` ≈ 0.7 s；EMAGE 冷启动（模型已在本地 HTTP 缓存）≈ 4 s**；真实网络下首次下载 INT8 模型（约 167 MB）会远大于此，所以首次 `xc.audio` 之前建议宿主先 `xc.setConfig{heavy:'eager'}` 预热。手机量级参考 `EMAGE_MODEL.md`（单窗 0.7–1.0 s）→ TTFA 约 1–1.5 s（未实测） |
| 流式 | ✅ 已支持（`xc.audio.chunk`）：音频被重新切成首片 2 s / 后续 4 s，每片独立 checkpoint + 排队播放，**不要求宿主分块大小**。限制：片间由 `onended` 衔接，可能有毫秒级空隙（TTS 多段路径同样如此）；若推理慢于实时，会在片间保持末姿等待 |
| 输入限制 | 单次/单流 ≤ `HOST_AUDIO.maxSec`=120 s；编码音频 ≤ `HOST_AUDIO.maxBytes`=32 MB；采样率 8000–96000；PCM 小端、可交错（`channels` 1/2，内部下混）；URL 仅 https/同源且需 CORS（SDK 默认由**宿主页** fetch 后转移，不需要 iframe 能访问该 URL；`fetch:'frame'` 才让 iframe 自己取） |
| 零拷贝 | SDK 默认把 `ArrayBuffer` 放进 transfer 列表（发出后传入的 buffer 被 detach；要保留请 `transfer:false` 或传 `.slice(0)`）；TypedArray 视图先拷贝其范围再转移；Blob 走结构化克隆 |
| heavy 懒加载 | 首次带 motion 的音频才加载 EMAGE；`motion:false` 完全不加载（只播放 + 口型）。实测 `motion:false` 首次调用 0 个 `.onnx` 请求 |
| 打断 | 新的 `say` / `audio` 抢占旧的（旧的会收到 `end`）；`AbortSignal` / `xc.audio.end{abort}` 立即停播 |
| 浏览器策略 | 与 `say` 相同：宿主页需先有用户手势，且 iframe 要有 `allow="autoplay"`（SDK 已带）。无激活时 `xc.audio` 会在 10 s 后回 `xc.error{code:'failed'}`（而不是一直挂起） |
| 已知未做 | viseme 级口型；停顿检测（长静音不裁剪，TTS 路径会裁尾静音）；片间无缝拼接；`lipsync` 强度调节 |

### 2.5 与 `xiaochun://` 的关系（同一语义，两个传输层）

`xiaochun://` 是 **OS 级 deep link**，只在 Tauri 桌面壳里由系统分发；iframe / 浏览器里的 `/embed` **不会、也不能响应** `xiaochun://`（`initProtocolListener` 在 `/embed` 直接返回，且不挂 `__triggerXiaoChunProtocol` 调试桥）。iframe 走 `xc.*` postMessage。两者在主应用内**共用同一套 action 对象与同一个 handler**（`src/core/protocol/{types,handler,audio}.ts`）：

| `xc.*`（iframe / 浏览器） | protocol action | `xiaochun://`（Tauri 桌面） |
| :-- | :-- | :-- |
| `xc.say{text}`（`mode:'speak'`） | `speak { text }` | `xiaochun://speak?text=…` |
| `xc.say{mode:'chat'}` | — （走 LLM，无 deep link 对应物） | — |
| `xc.audio{source: URL}` | `speak { audioUrl[, text] }` → 内部转 `audio` | `xiaochun://speak?audioUrl=…[&text=…]`（`audioUrl` 以前是"预留"，现在真正生效，走 `speakAudio`） |
| `xc.audio{source: ArrayBuffer｜Blob}` / `xc.audio.chunk` / `xc.audio.end` | `audio { source｜stream, … }` | —（二进制无法放进 URL） |
| — | `speak { file }`（本机文件） | `xiaochun://speak?file=…`（仅桌面壳可读文件） |

- 差异：deep link 无握手/无 origin（信任边界是本机 OS）；`xc.*` 有 origin 校验 + MessageChannel，且 `text` 上限 `MAX_SAY_CHARS`（deep link 的 `file=` 可达百万字）；`xc.say.chat`、`motion/expression/setModel/…` 没有 deep link 形态。
- 对照工具：SDK 导出 `toProtocolUrl({action:'speak', text, audioUrl})` / `parseProtocolUrl(url)`（纯字符串函数，给桌面脚本 / `<a href>` / 文档用），以及常量 `XC_PROTOCOL_MAPPING`（上表的机器可读版）。
- 单一来源：音频选项类型来自 `packages/project-xiaochun/src/protocol.ts`，`src/core/protocol/types.ts` 引用它；错误码（`ProtocolError.code`）与 `xc.error.code` 取值一致，bridge 原样映射。

---

## 3. 响应头与部署要求

| 路径 | `X-Frame-Options` | `Content-Security-Policy` | `Permissions-Policy` | COOP / COEP / CORP |
| :-- | :-- | :-- | :-- | :-- |
| 主站 `/*` | `DENY` | — | `camera=(), microphone=(self), geolocation=(), interest-cohort=()` | `same-origin` / `credentialless` / — |
| `/embed`、`/embed/*` | **移除** | `frame-ancestors <白名单>`（默认 `*`） | 同上（`microphone=(self)`，宿主还要委派） | `same-origin`（iframe 内被忽略）/ `credentialless` / `cross-origin` |

配置落点（**两处必须一致**）：

1. **Worker / SSR / dev / preview**：[`src/lib/securityHeaders.ts`](../src/lib/securityHeaders.ts) 由 [`src/server.ts`](../src/server.ts) 对所有 SSR 响应调用。白名单读 Worker 变量 `EMBED_FRAME_ANCESTORS`（`wrangler.jsonc` / `wrangler.dev.jsonc` 的 `vars`）。非法 token 会被丢弃，全部非法时回落 `'none'`（宁可拒绝也不悄悄放开）。`pnpm dev` 的 Vite dev server 经 `@cloudflare/vite-plugin` 走同一个 Worker，所以 dev 与生产头一致。
2. **静态直出**：`/embed` 被 TanStack prerender 成 `dist/client/embed/index.html`，由 Workers Assets 直接返回（**不经过 Worker**），头来自 [`public/_headers`](../public/_headers)：用 `! X-Frame-Options` 摘掉 `/*` 的 DENY，再写 `Content-Security-Policy: frame-ancestors *`。**要收紧白名单必须同时改 `_headers` 与 `EMBED_FRAME_ANCESTORS`。**

```jsonc
// wrangler.jsonc → vars
// /embed 的 CSP frame-ancestors 白名单, 空格分隔。
//   "*"                                  任何站点都能内嵌 (默认, 方便第三方接入; 风险: 被恶意站点套壳点击劫持)
//   "https://a.com https://*.b.com"      仅这些站点能内嵌 (推荐生产收紧)
//   写错/全部非法                          回落 'none' = 谁都不能内嵌 (fail closed)
"EMBED_FRAME_ANCESTORS": "*"
```

> `/embed` → `/embed/` 会有一次 307（Workers Assets 的目录规范化，query 保留）。想省一跳可把 `src` 写成 `https://xiaochun.firetable.tech/embed/`。

**宿主侧必须做的：**

```html
<!-- SDK 已自动设置 allow="microphone; autoplay"。手写 iframe 时必须自己加 -->
<iframe src="https://xiaochun.firetable.tech/embed?host=https%3A%2F%2Fexample.com"
        allow="microphone; autoplay" loading="lazy"
        width="320" height="480"></iframe>
```
- 宿主自己的 CSP 要放行：`frame-src https://xiaochun.firetable.tech`；用 CDN loader 时 `script-src` 加 `cdn.jsdelivr.net`（或 unpkg）。
- 宿主若自己开了 `COEP: require-corp`：`/embed` 已发 `CORP: cross-origin` 可被嵌入；`COEP: credentialless` 同理。

### 3.1 可选：跨源隔离，让 EMAGE 用多线程 wasm

默认 iframe 内 `crossOriginIsolated === false`，onnxruntime-web 退回**单线程** wasm。想要多线程（`SharedArrayBuffer`），三层都要满足：

1. **宿主页自己跨源隔离**：宿主页（顶层文档）的响应头同时带
   `Cross-Origin-Opener-Policy: same-origin` 和
   `Cross-Origin-Embedder-Policy: credentialless`（或 `require-corp`）。
   `window.crossOriginIsolated` 在宿主页里应为 `true`。
2. **iframe 文档自己也带 COEP**：`/embed` 已发 `COEP: credentialless` + `CORP: cross-origin`（`securityHeaders.ts` 与 `public/_headers` 一致），无需改动。COOP 在 iframe 内被忽略，不影响。
3. **宿主给 iframe 委派 `allow="cross-origin-isolated"`**（跨源 iframe 默认不继承）：SDK 里打开开关即可，默认关闭，默认 `allow` 仍是 `'microphone; autoplay'`：

```js
createXiaochun({ container: '#stage', crossOriginIsolated: true });   // allow = 'microphone; autoplay; cross-origin-isolated'
```
```tsx
<Xiaochun crossOriginIsolated />                                     // React
```
```html
<xiaochun-avatar cross-origin-isolated></xiaochun-avatar>             <!-- 自定义标签 -->
<iframe src="https://xiaochun.firetable.tech/embed?host=…" allow="microphone; autoplay; cross-origin-isolated"></iframe> <!-- 手写 -->
```

宿主响应头示例（nginx）：

```nginx
add_header Cross-Origin-Opener-Policy  "same-origin" always;
add_header Cross-Origin-Embedder-Policy "credentialless" always;   # 或 require-corp
```

**收益**：EMAGE 推理线程数 `min(hardwareConcurrency, 桌面 8 / 手机 4)`。Node 实测同一段推理：1 线程 274 ms → 4 线程 79 ms（约 3.5×）。

**副作用（开隔离的是宿主页，不是小蠢）**：

- 宿主页上所有跨源子资源都要满足 COEP：`credentialless` 下 no-cors 跨源资源会被剥掉 cookie/凭据再请求（需要凭据的第三方图片/脚本可能 401/拿到匿名版本）；`require-corp` 下则必须有 `CORP: cross-origin` 或 CORS，否则被拦。
- 宿主页里的**其他第三方 iframe**（广告、地图、视频、支付、评论等）自己必须也带 COEP（`credentialless`/`require-corp`），否则被拦；`COOP: same-origin` 还会切断 `window.opener`（OAuth 弹窗、第三方登录/支付弹窗回传可能失效）。
- Safari 不支持 `credentialless`，需用 `require-corp`；不支持隔离的浏览器上，开关无效，自动退回单线程。
- 宿主未隔离时开这个开关无害（浏览器忽略），只是没有收益。**先在预发环境验证再上线**。

**验证**：`xc.ready` 的 `capabilities.crossOriginIsolated` 为 `true`（`client.on('handshake', …)` 可读），或在 iframe 上下文执行 `crossOriginIsolated`；DevDrawer 的 EMAGE 性能面板 / worker `wasm_env` 里 `numThreads > 1`。本地可跑 `node packages/project-xiaochun/examples/serve-isolated.mjs`，打开 `http://localhost:8081/examples/embed-host.html?isolated=1`。

---

## 4. 宿主接入示例

### 4.1 一行 loader（零构建）
```html
<script src="https://cdn.jsdelivr.net/npm/@firetable/project-xiaochun/dist/loader.global.js" defer></script>
<xiaochun-avatar position="bottom-right" size="280" lang="zh-CN" draggable></xiaochun-avatar>
<script>
  const el = document.querySelector('xiaochun-avatar');
  el.addEventListener('xc-ready', () => el.say('欢迎光临！'));
  el.addEventListener('xc-error', (e) => console.warn(e.detail));
</script>
```
更省事：`<script src=".../loader.global.js" data-auto data-position="bottom-right" data-size="280" defer></script>` 会自动插入一个悬浮头像（`data-*` 即同名属性）。
> 生产请**锁版本**：`.../npm/@firetable/project-xiaochun@0.1/dist/loader.global.js`。

### 4.2 ESM / 框架里
```ts
import { createXiaochun } from '@firetable/project-xiaochun';

const xc = createXiaochun({
  container: '#avatar',
  transparent: true,
  width: 320, height: 480,          // 必填级别: 固定尺寸 = 零 CLS
  placeholder: '/img/xiaochun.webp',
  lazy: true,
});
await xc.ready;                      // 模型加载完成
await xc.say('你好呀');              // 念完才 resolve
xc.on('stt', (p) => p.kind === 'text' && console.log('听写:', p.text));
// 卸载时
xc.destroy();
```

### 4.3 `createXiaochun` 选项（可调参数说明）
```ts
createXiaochun({
  container: '#avatar',          // 必填: 元素或选择器
  src: 'https://xiaochun.firetable.tech/embed', // iframe 地址; 本地调试改成 https://localhost:5185/embed
  origin: undefined,             // iframe origin, 默认从 src 推导; 所有消息校验都以它为准
  allowedOrigins: [],            // 额外可信 iframe origin (如 CDN 重定向); 不接受 '*'
  lazy: true,                    // true=进入视口且空闲才创建; 'click'=只在点击/调 API 时创建 (最省); false=立即创建 (最快出现, 最伤首屏)
  lazyMargin: 200,               // px, 提前多远开始加载: 调大=滚到前就加载好但更耗流量; 调小=更省但可能滚到了还没好
  placeholder: '/xc.webp',       // 占位图/元素; false=不要占位 (会露出空白框)
  transparent: false,            // true=背景透明叠在页面上; 同时默认开启 passthrough
  width: 320, height: 480,       // 数字=px 或 CSS 长度; 一定要给, 用来预留空间避免布局抖动
  position: 'inline',            // 'inline' | 'bottom-right' | 'bottom-left' (悬浮)
  draggable: false,              // 悬浮模式下左上角出现拖动手柄
  lang: 'zh-CN',                 // 'zh-CN' | 'en' | 'ja'
  model: undefined,              // 初始服装 key (如 'xiaochun_maid')
  ui: false,                     // true=显示 iframe 内置 ChatBar (会多一部分 UI 代码, 对话走 WebLLM)
  heavy: 'lazy',                 // 'lazy'=首次互动才加载 WebLLM/EMAGE (默认, 省流量显存); 'eager'=进来就预热 (首次说话更快, 首屏更重)
  controls: false,               // true=放开 iframe 内滚轮缩放 (会吞页面滚动)
  autoPause: true,               // 滚出视口自动暂停渲染, 省电; 关掉则一直渲染
  passthrough: undefined,        // 透明时按"是否点在角色上"切换 pointer-events; 默认=transparent
  sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox', // false=不加; 去掉 allow-same-origin 会让 IndexedDB/麦克风失效
  handshakeTimeout: 20000,       // ms, 范围建议 5000~60000; 调大适合慢网络, 调小更早报 timeout
  crossOriginIsolated: false,    // true=iframe allow 追加 cross-origin-isolated (需宿主页已 COOP/COEP 隔离, 见 §3.1); 默认 allow 仍是 'microphone; autoplay'
  zIndex: 2147483000,            // 悬浮模式层级
});
```
返回：`{ say, speakAudio, speakAudioStream, motion, expression, lookAt, setModel, setConfig, startListening, stopListening, mic, pause, resume, destroy, on, ready, activate, element, iframe }`。
事件：`handshake`（协议握手）· `ready`（模型加载完）· `progress` · `state` · `stt` · `utterance` · `hit-region` · `error` · `destroy`。

### 4.4 `<xiaochun-avatar>`

| 属性 | 默认 | 说明 |
| :-- | :-- | :-- |
| `src` | 官方 `/embed` | 改它会重建 iframe |
| `model` | — | 服装 key，或 https `.vrm/.vrmaddon/.vrmbase` URL；运行时修改 = `setModel` |
| `lang` | — | `zh-CN｜en｜ja`；运行时修改 = `setConfig` |
| `mic` | `false` | 开关听写（模型加载完后生效） |
| `transparent` | `true` | `"false"` 关闭 |
| `draggable` | `false` | 仅悬浮模式 |
| `position` | `inline` | `inline｜bottom-right｜bottom-left` |
| `size` | `320x480` | `"280"`（高 = 宽×1.5）、`"320x480"`、`"100%x480px"` |
| `lazy` | 空闲+视口 | `"click"` 仅点击；`"false"` 立即 |
| `paused` | `false` | `pause()` / `resume()` |
| `placeholder` / `heavy` / `ui` / `controls` / `allowed-origins` | — | 同 `createXiaochun` |
| `cross-origin-isolated` | `false` | 同 `createXiaochun({ crossOriginIsolated })`；改它会重建 iframe。见 §3.1 |

事件（`CustomEvent`，`composed`，`detail` = 协议 payload）：`xc-ready`（模型加载完）· `xc-progress` · `xc-state` · `xc-stt` · `xc-utterance` · `xc-error`。方法：`say` · `speakAudio` · `speakAudioStream` · `motion` · `expression` · `destroy`；`el.client` 可拿到完整 SDK 实例。

手动验证页：[`packages/project-xiaochun/examples/embed-host.html`](../packages/project-xiaochun/examples/embed-host.html)（头部注释写了启动步骤）。

### 4.5 宿主直接给音频：`speakAudio` / `speakAudioStream`

```ts
// 整段: ArrayBuffer / TypedArray / Blob / URL; 念完 (xc.utterance end) 才 resolve
const buf = await (await fetch('/voice/reply.mp3')).arrayBuffer();
await xc.speakAudio(buf, { text: '你好呀', motion: true, lipsync: true }); // buf 被 transfer (detach); 要保留: { transfer: false }
await xc.speakAudio('https://cdn.example.com/voice.mp3');                  // 默认由宿主页 fetch 后转移给 iframe
await xc.speakAudio(pcm16Buffer, { format: 'pcm16', sampleRate: 24000 });  // 无头原始 PCM
await xc.speakAudio(blob, { motion: false });                              // 只播放 + 口型, 完全不加载 EMAGE

// 流式 (例如 TTS 服务边合成边返回 PCM): 分块大小任意, 内部重新切片
const s = xc.speakAudioStream({ sampleRate: 24000, text: '流式' });        // format 由第一次 write 的 TypedArray 推断
for await (const chunk of ttsStream) s.write(new Int16Array(chunk));
s.end(); await s.done;                                                     // s.abort() 立即停播
// 任意时刻打断: const ac = new AbortController(); xc.speakAudio(buf, { signal: ac.signal }); ac.abort();
```
选项里的 `text`（气泡文字）/ `motion`（默认 true）/ `lipsync`（默认 true）与链路细节见 §2.4。**heavy 资源仍然懒加载**：第一次带 motion 的 `speakAudio` 才加载 EMAGE。

### 4.6 React（`@firetable/project-xiaochun/react`）

`react` 是**可选 peerDependency**（`>=18`，React 18 / 19 均可），子路径单独打包，**不增加主入口体积**；文件带 `'use client'`，可直接在 Next.js App Router 的客户端组件里用；服务端只渲染一个固定尺寸的空 `<div>`（无 CLS、无 hydration 差异），iframe 只在客户端 effect 里创建；StrictMode 双挂载时 cleanup 一定 `destroy()`，不泄漏。

```tsx
import { useRef } from 'react';
import { Xiaochun, useXiaochun, type XiaochunHandle } from '@firetable/project-xiaochun/react';

export function Mascot() {
  const ref = useRef<XiaochunHandle>(null);
  return (
    <>
      <Xiaochun
        ref={ref} width={320} height={480} transparent lazy placeholder="/xc.webp"
        paused={false}                       // 受控: true=xc.pause / false=xc.resume (热更新, 不重建 iframe)
        onReady={() => ref.current?.say('你好')}
        onUtterance={(u) => console.log(u.phase, u.kind)}
        onError={(e) => console.warn(e.code, e.message)}
      />
      <button onClick={() => ref.current?.speakAudio(someArrayBuffer, { text: '语音' })}>播放音频</button>
    </>
  );
}

// 想自己控制布局: 用 hook
function Custom() {
  const { containerRef, client, ready, state } = useXiaochun({ transparent: true, width: 280, height: 420 });
  return <div ref={containerRef} style={{ width: 280, height: 420 }} />;
}
```
- props = `createXiaochun` 的全部选项（不含 `container`）+ `onHandshake / onReady / onProgress / onState / onStt / onUtterance / onHitRegion / onError / onDestroy` + `className / style` + `paused / mic`。
- 重建 vs 热更新：`src / origin / allowedOrigins / lazy / lazyMargin / placeholder / transparent / width / height / position / draggable / ui / heavy / controls / autoPause / passthrough / sandbox / handshakeTimeout / crossOriginIsolated / zIndex` 变化会销毁并重建实例（这些是创建期选项，别在渲染里每次给新值）；`lang / model / paused / mic` 与回调变化**不**重建（`lang`→`setConfig`，`model`→`setModel`）。
- ref 句柄：`say / speakAudio / speakAudioStream / motion / expression / lookAt / setModel / setConfig / startListening / stopListening / mic / pause / resume / activate / destroy / ready / instance`；未挂载时返回 Promise 的方法会 reject。

### 4.7 样式（CSS 自定义属性 / `::part`）

`<xiaochun-avatar>`（以及直接用 SDK 时的容器或任意祖先元素）可以用 CSS 自定义属性调整**外壳**（自定义属性会穿透 Shadow DOM）：

| 变量 | 默认 | 作用与范围 |
| :-- | :-- | :-- |
| `--xc-radius` | `0` | 圆角（CSS 长度，0 ~ 宽度的一半；`50%` = 圆形头像框）。调大更圆，过大会裁掉角色头/脚。同时作用于 iframe / 占位图 / 外壳 |
| `--xc-shadow` | `none` | `box-shadow` 简写。**透明悬浮头像保持 `none`**（否则出现方块阴影）；卡片式嵌入可用 `0 8px 24px rgba(0,0,0,.18)` |
| `--xc-z-index` | `2147483000` | 仅悬浮（`position≠inline`）。调小让宿主弹窗/导航盖在头像上面 |
| `--xc-offset-x` | `16px` | 仅悬浮：距屏幕左/右边的边距。调大离边缘更远（移动端建议 ≥12px 避开系统手势区） |
| `--xc-offset-y` | `16px` | 仅悬浮：距屏幕底边的边距。调大抬高（避开底部导航栏 / Cookie 横幅） |
| `--xc-bg` | `transparent` | 非透明模式下的底色（iframe 加载前 / 圆角外）；`transparent` 模式忽略 |

```css
xiaochun-avatar {
  --xc-radius: 24px;
  --xc-shadow: 0 8px 24px rgba(0, 0, 0, .18);
  --xc-offset-x: 24px; --xc-offset-y: 72px;      /* 悬浮时避开底部导航 */
}
xiaochun-avatar::part(mount)       { /* 内部容器 */ }
xiaochun-avatar::part(wrapper)     { /* 固定尺寸外壳 (SDK 创建) */ }
xiaochun-avatar::part(iframe)      { outline: 1px solid #0002; }
xiaochun-avatar::part(placeholder) { filter: grayscale(.3); }
```
**iframe 内部不可被宿主 CSS 影响**：角色渲染、气泡、内置 UI 都在跨域文档里，宿主只能改外壳（圆角 / 阴影 / 位置 / 层级 / 背景 / 尺寸）。要改气泡/配色等需要通过 `xc.setConfig`（协议）或 `/embed` URL 参数，而不是 CSS。

---

## 5. Lighthouse / 首屏友好用法

1. **占位图 + 懒创建 iframe**（默认）：宿主首屏只有一张 `<img>`（可用 `webp`、加 `fetchpriority="low"`），iframe、three.js、模型都在"进入视口 + 空闲"之后才开始。
2. **预留固定宽高**：`width/height` 必填级别；wrapper 用固定尺寸 + `contain: layout style`，占位 → iframe 替换**不产生 CLS**。`position: bottom-right` 悬浮是 `fixed`，天然不占文档流。
3. **默认不加载重模型**：`heavy=lazy` 时不下载 WebLLM（GB 级）与 EMAGE（数十 MB ONNX），首次 `say`（EMAGE）/ `say({mode:'chat'})`（WebLLM）才加载。实测首次交互前只有 VRM + `bspatch.wasm`。
4. **不可见就暂停**：滚出视口 `xc.pause`、标签页隐藏引擎自挂起；长页面里不会持续烧 GPU。
5. **想更省**：`lazy:'click'`（用户点了才加载）；移动端建议默认 `lazy:'click'`。
6. **别阻塞 `load` 事件**：SDK 本身 ~14 KB（min，零依赖），用 `defer` 加载 loader；iframe 在 `requestIdleCallback`（超时 3s）之后创建。
7. 不要在 `<head>` 里对 `/embed` 做 `preload`/`prefetch`，除非你确定每个访客都会看到头像。

---

## 6. 发布流程（npm 包 `@firetable/project-xiaochun`）

**版本策略：与桌面 app 锁步（同一条版本线、同一个 `v*` tag）。** `scripts/bump-version.mjs` 一次 bump 会同时更新 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和 `packages/project-xiaochun/package.json`，只打一个 `vX.Y.Z` tag——不需要打两次 tag，也没有单独的 `bump:embed`。代价：桌面端小版本也会带出一个内容相同的 npm 版本（发布是幂等的，且 npm 版本号只增不减，没有实际危害）。

```bash
# 1. 在 main 上 (工作区干净): bump 四个版本文件 + commit + 打 tag vX.Y.Z
pnpm bump:patch --commit                # 或 bump:minor / bump:major / pnpm bump:set 0.2.0 --commit
# 2. 推送一次 (同一个 v* tag 并行触发 release-tauri.yml 与 publish-npm.yml)
git push origin main --follow-tags
```
- [`publish-npm.yml`](../.github/workflows/publish-npm.yml)：响应 `v*` tag 与手动触发（默认 dry-run）。步骤：校验 `tag 去掉 v 前缀 == packages/project-xiaochun/package.json 版本` → 校验 tag 在 `origin/main` 上 → `tsc` → build → 冒烟测试 → 若该版本已在 npm 上则**跳过**（不报错）→ `npm publish --access public`（预发布版本 `1.2.3-beta.1` 自动用 `--tag next`）。权限仅 `contents: read` + `id-token: write`。
- **认证 = npm Trusted Publishing（OIDC）**：workflow 里**没有任何 token / `NPM_TOKEN`**。要求：GitHub-hosted runner、Node ≥ 22.14（workflow 用 24）、npm CLI ≥ 11.5.1（workflow 里 `npm i -g npm@latest` 并校验）、pnpm 走 corepack。OIDC 下 npm **自动生成 provenance**（公开仓库 + 公开包才有），所以不再显式写 `--provenance`。
- 与 [`release-tauri.yml`](../.github/workflows/release-tauri.yml) **并行、互不依赖**：两者没有 `needs` / `workflow_run` 关系，npm 发布失败不会影响桌面 release（反之亦然）；失败后在 Actions 里单独 Re-run `Publish npm` 即可，无需重打 tag。
- 注意：`release-tauri.yml` 还有 `push: main` 触发（现有行为，未改动）；`publish-npm.yml` 只认 tag，推 main 本身不会发 npm。
- 若 npm 发布失败而你已经推了 tag：先修复（如 Trusted Publisher 没绑好），再 Re-run；不要删 tag 重打，否则会重复触发桌面 release。

**一次性手工准备（Trusted Publisher 配置）：**
1. **包必须先在 npm 上存在**：首次由维护者本地手动发一次 —— `cd packages/project-xiaochun && pnpm build && npm publish --access public`（或先发一个 `0.x` 占位版）。账号需对 `@firetable` org 有发布权限（`npm view @firetable/project-xiaochun` 目前 404 = 名字可用，首次发布即占用）。
2. **在 npmjs.com 绑定 Trusted Publisher**：包页 → Settings → *Trusted publishing* → GitHub Actions，填：`owner = FireTable`（以仓库实际 owner 为准）、`repository = project-xiaochun`（以实际仓库名为准）、`workflow filename = publish-npm.yml`（**只填文件名**，不要路径）、environment 留空。
   或用 CLI：`npm trust github @firetable/project-xiaochun --repo FireTable/project-xiaochun --file publish-npm.yml --allow-publish --yes`（需 npm ≥ 11.15）。
   ⚠️ **绑定的是 workflow 文件名**：绑定之后不要随便重命名 `publish-npm.yml`，也不要迁移/重命名仓库，否则发布会被 npm 拒绝，需要重新绑定。
3. **跑通一次后收紧**：`workflow_dispatch` dry-run 通过、真实发布成功一次后 → 撤销旧的 npm token（如果有），并在包 Settings 里选择 *Require two-factor authentication and disallow tokens*（之后只有 OIDC / 带 2FA 的维护者能发）。
4. 仓库需 public（provenance 要求）；部署 `/embed`（`pnpm run deploy`），并确认 `EMBED_FRAME_ANCESTORS`/`_headers` 的白名单符合预期。
5. 首次可先在 Actions 里手动触发一次（保持 dry-run 勾选）确认流水线（dry-run 不会真发布）。

**可选：staged publish（`npm stage publish`，需维护者 2FA 批准）**：CI 只把包"暂存"，由有 2FA 的维护者在 npm 上点批准后才对外可见。好处：即使 workflow / OIDC 被滥用也无法直接上线恶意版本；代价：每次发布多一步人工批准，且 `v*` tag → 上线不再全自动（与 release-tauri 的节奏不同步）。**默认用直接 `npm publish`**（本 workflow 现状）；想启用时把最后一步换成 `npm stage publish --access public --tag …` 即可（需要 npm 版本支持该子命令）。

本地自测：`pnpm --filter @firetable/project-xiaochun build && pnpm --filter @firetable/project-xiaochun test`；`npm pack --dry-run --workspace packages/project-xiaochun` 看包内容。

---

## 7. 风险与已知限制

| 风险 | 说明 / 缓解 |
| :-- | :-- |
| **存储分区 → 重复下载** | 第三方 iframe 的 IndexedDB / Cache Storage 按"顶层站点 + iframe origin"分区（Chrome 第三方存储分区、Safari ITP）。同一用户在 A 站、B 站各下载一份 VRM（~10–15 MB）与（若启用）WebLLM 权重（GB 级）。缓解：默认 `heavy=lazy`；需要大模型对话的场景引导用户去主站。 |
| **COOP/COEP 与多线程 wasm** | iframe 内 `crossOriginIsolated` 需要宿主页也隔离（COOP `same-origin` + COEP `credentialless`/`require-corp`）并给 `allow="cross-origin-isolated"`；默认不满足 → ORT 退回单线程，EMAGE 更慢（Node 实测 1 线程 274 ms → 4 线程 79 ms）。SDK 提供可选开关 `crossOriginIsolated`（默认关），详见 §3.1 含副作用。`/embed` 自身发 COEP `credentialless`（兼容 CDN 上的 onnx）+ CORP `cross-origin`，COOP 在 iframe 内被忽略。 |
| **麦克风** | 需 HTTPS、宿主 `allow="microphone"`、`/embed` 的 `Permissions-Policy` 放行（已 `microphone=(self)`）。权限按 iframe origin 记忆，宿主换域名要重新授权。iOS Safari 对 iframe 内 getUserMedia 限制更多，建议提供"在新标签打开主站"的兜底。 |
| **自动播放** | TTS 用 `AudioContext`。宿主页需发生过用户激活，且 iframe 要有 `allow="autoplay"`（SDK 已加）；否则首个 `say()` 会一直 pending 到用户点击。建议把第一次 `say` 绑在按钮点击里。 |
| **多实例 / WebGL 上下文上限** | 每个实例 1 个 WebGL 上下文 + 1 套模型内存。桌面 Chrome 约 16 个、移动端更少，超过会丢上下文。建议一页只放 1 个，用完 `destroy()`。 |
| **移动端** | 内存与 GPU 紧张；建议 `lazy:'click'`、较小 `width/height`、不用 `heavy:'eager'`。WebGPU（WebLLM）在 iOS 上受限。 |
| **点击劫持** | 默认 `frame-ancestors *`。生产建议收紧白名单；`origin`/`allowedOrigins` 只保护"宿主 ↔ iframe 之间的消息"，不能阻止别人把 `/embed` 套进自己的页面。 |
| **`alert()`** | 引擎在 VRM 加载失败时会 `alert()`（既有行为），在 iframe 里体验较差；后续可改为发 `xc.error`。 |
| **`xc.lookAt` 未实现** | 见 §2.1 TODO。 |
| **主站 SSR 也发 `X-Frame-Options: DENY`** | 以前只有 `_headers`（静态资源）带；现在 Worker 对 SSR 响应也发，与 dev/preview 对齐。若有人依赖 iframe 主站 SSR 页，会被拒绝（符合"主站保持 DENY"的意图）。 |
