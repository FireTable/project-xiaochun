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
| `ui` | 空（全部不显示） | 要显示的内置界面部件，逗号分隔：`chat`（聊天栏）· `bubble`（头顶气泡）· `outfit`（换装按钮）· `scene`（换场景按钮）· `lang`（语言切换）· `github`（GitHub 仓库链接），例 `?ui=chat,outfit,scene,lang,github`。名字**白名单**校验，未知项忽略并 `console.warn`，大小写/空格/重复容忍。见 §2.7 |
| `uiAutoHide` | `transparent` | 内置界面（顶部按钮 + 聊天栏）的显示策略，**与 Tauri 桌宠一致**：`transparent`（默认）= 只在**透明场景**初始隐藏、单击角色才出现，亮 / 暗场景常显；`1`/`true` = 所有场景都"点击才出现"；`0`/`false` = 一直显示（旧行为）。非法值忽略。见 §2.7 |
| `cameraFov` / `cameraDistance` / `cameraHeight` / `cameraIntro` | 不覆盖 | 相机：视野角 15–60° · 视距 1–15m · 取景高度偏移 ±1m · 是否播推镜头（`0`/`1`）。越界夹到范围、非法值忽略并 `console.warn`。见 §2.9 |
| `lang` | iframe 记住的 → 浏览器语言 → `zh-CN` | `zh-CN` · `en` · `ja`。优先级：URL `lang`（SDK `lang` 选项）> iframe 自己 localStorage 里用户上次在语言按钮选的（`xiaochun_embed_lang`）> `navigator.languages`（`zh*`→`zh-CN`、`ja*`→`ja`、`en*`→`en`）> `zh-CN`。**不读写主站的语言 cookie**（第三方 iframe 里 cookie 不可靠） |
| `heavy` | `lazy` | `lazy` = 不预热 WebLLM / EMAGE；`eager` = 与主站一致，VRM 加载完立即预热 |
| `outfit` | default addon | 初始服装 id。**严格校验**：必须匹配 `^[a-z][a-z0-9_]{0,63}$` 且是内置服装（`Object.hasOwn`，`constructor` / `__proto__` 不算）；不合法回退默认服装，并在握手后发 `xc.error{unknown_id, command:'outfit'}` |
| `scene` | 跟随 `transparent` / `theme` | 初始场景 `light` / `dark` / `transparent`，同样严格校验；优先级 `scene` > `transparent=1` > `theme` > 系统亮暗。显式指定后，系统亮暗变化**不会**再把场景切走 |
| `theme` | 跟随系统 | 非透明时的线稿主题 `light` / `dark` |
| `controls` | `1`（开） | 滚轮缩放，与主站一致。`0` = 强制关闭；`1` 与缺省等价。**透明场景**只在指针落在角色上才缩放，其余位置滚轮穿透给宿主页；**不透明场景** iframe 铺满，该区域内滚轮 = 缩放，**会吞掉该区域的页面滚动**（要让宿主页能滚过去就用 `controls=0`，或把 iframe 放在不需要滚动的区域）。缩放范围沿用主站的距离上下限 |

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
| `xc.setOutfit` | `{ id }` | ✅（capability `outfits`） | 换内置服装。`id` 必须匹配 `^[a-z][a-z0-9_]{0,63}$` 且在 `capabilities.outfits` 里（`Object.hasOwn`，原型键一律 `unknown_id`）；裸模 `base` 不对外开放。**串行 + last-wins**，见 §2.6。完成回 `xc.outfit-changed`（信封 `id` 同请求） |
| `xc.setScene` | `{ id }` | ✅（capability `scenes`） | 换场景（`light` / `dark` / `transparent`，只有这 3 个内置主题）。立即生效，回 `xc.scene-changed` |
| `xc.prefetch` | `{ ids?: string[] }` | ✅（capability `prefetch`） | 把服装资源**只下载进 IndexedDB**（不解压不合成），之后 `xc.setOutfit` 不再走网络。省略 `ids` = 全部内置服装但**不含婚纱**（13.9MB，显式点名才下）。全局串行、排在 EMAGE 加载之后、不与进行中的换装抢带宽；用户开了省流量（`saveData`）则整体跳过。回 `xc.prefetched` |
| `xc.setModel` | `{ outfit }` 或 `{ url, name? }` | ✅（保留兼容） | 旧命令。`outfit` 与 `xc.setOutfit` 走**同一个白名单和同一个串行队列**（并且仍发旧的 `xc.loaded`），但**不再接受 `base`**（`unknown_id`）；`url`（https / 同源 `.vrm/.vrmaddon/.vrmbase`，需 CORS）**默认关闭**，回 `unsupported`，需在 `xc.init` / `xc.setConfig` 的 config 里带 `allowCustomModel:true`（SDK 选项同名）才放行 |
| `xc.setConfig` | `{ lang?, transparent?, ui?: Array<'chat'｜'bubble'｜'outfit'｜'scene'｜'lang'｜'github'>, uiAutoHide?: boolean｜'transparent', camera?: { fov?, distance?, height?, intro? }, heavy?, allowCustomModel?, gestures?: { move?, resize? } }` | ✅ | i18n / `sceneManager.setScene(…, false)`（`setConfig` 的内部切换不写 iframe 的场景偏好）/ 内置界面部件显隐（`ui` 数组，未知部件名 → `bad_request`）/ 内置界面显示策略（`uiAutoHide`，非法值 → `bad_request`，立即生效不重建）/ 语言（`lang`，立即生效；**不写** iframe 的语言偏好，只记用户自己点的；变化会发 `xc.lang-changed`）/ 相机（`camera`，缺省键不变、`null` 恢复默认、非法值 / 未知键 → `bad_request`；立即重新取景并取消进行中的推镜头，见 §2.9）/ `heavyPreload` 开关（`eager` 立即预热） |
| `xc.mic` | `{ enabled }` | ✅ | `SttClient.start/stop`（SenseVoice，首次开启才下载模型），结果走 `xc.stt` |
| `xc.pause` / `xc.resume` | — | ✅ | `suspendRendering` / `resumeRendering` |
| `xc.destroy` | — | ✅ | `releaseHeavyResources` + `vrmEngine.dispose` + 关闭端口；SDK 随后移除 iframe |
| `xc.lookAt` | `{ x, y }` | ⏳ **unsupported** | 回 `xc.error{code:'unsupported'}`。**TODO**：视线目前由相机 + 随机扫视驱动（`GazeController`），没有外部注视点入口，需先在 gaze 层新增 `overrideTarget` |

### 2.2 iframe → 宿主

| 消息 | payload | 说明 |
| :-- | :-- | :-- |
| `xc.ready` | `{ version, protocol, capabilities:{ commands[], unsupported[], stt, transparent, audio?:{ formats[], streaming, maxSeconds }, crossOriginIsolated?:boolean, outfits?:{id,name}[], scenes?:{id,transparent}[], prefetch?:boolean, gestures?:{ move:boolean, resize:boolean, cornerSize:number }, camera?:{ fov:[number,number], distance:[number,number], height:[number,number], intro:boolean } } }`（`gestures` = 支持手势，见 §2.8；`camera` = 支持相机选项及各项范围，见 §2.9；`crossOriginIsolated` 为 iframe 内 `self.crossOriginIsolated`，仅诊断：宿主开了隔离且 `allow` 委派后应为 `true`） | 握手第一步（window.postMessage，严格 targetOrigin）。1s 间隔最多重发 10 次直到收到 `xc.init` |
| `xc.load.progress` | `{ phase:'model'｜'outfit'｜'prefetch', progress:0-100, id? }` | `model` = 首次加载；`outfit` = 运行中换装（`id` = 目标服装）；`prefetch` = 预取（`id` = 当前在下的服装）。整数百分比变化才发 |
| `xc.loaded` | `{ model }` | 初始模型或 `setModel` 完成（SDK 的 `ready` Promise 在此 resolve） |
| `xc.outfit-changed` | `{ id｜null, name, previous?, initial?, noop? }` | 服装已生效。握手后补发一条 `initial:true`（当前服装）；目标已是当前服装回 `noop:true`；自定义 URL 模型 `id:null`。回应 `xc.setOutfit` 时带同一信封 `id` |
| `xc.scene-changed` | `{ id, transparent, previous?, initial?, noop? }` | 场景已生效。握手后补发 `initial:true`；回应 `xc.setScene` 时带同一信封 `id` |
| `xc.lang-changed` | `{ lang, previous?, initial? }` | 界面语言已生效。握手后补发一条 `initial:true`（当前语言，来源见 `lang` 优先级）；用户点语言按钮 / 宿主 `setConfig{ lang }` 引起的变化也发（带 `previous`） |
| `xc.prefetched` | `{ downloaded[], cached[], failed[], skipped?:'save-data' }` | 回应 `xc.prefetch`（信封 `id`）。`failed` 非空可稍后重试 |
| `xc.state` | `{ phase, paused, heavy }` | `phase`: `loading｜idle｜thinking｜speaking｜listening｜paused` |
| `xc.stt` | `{ kind:'state'｜'progress'｜'text', … }` | 听写状态 / 模型下载百分比（整数变化才发） / 识别文本 |
| `xc.utterance` | `{ phase:'start'｜'end', text, kind?:'text'｜'audio' }` | `say` / `audio` 开始 / 结束（被新的说话打断也会发 `end`）。`kind:'audio'` = 宿主音频（没有走 TTS） |
| `xc.hit-region` | `{ hit, x, y }` | 指针是否落在角色身上，仅变化时发；SDK 据此切换 iframe `pointer-events` |
| `xc.gesture-move` | `{ gesture, seq, phase:'start'｜'move'｜'end', dx, dy, totalDx, totalDy, reason? }` | **仅宿主开了 `gestures.move`**：iframe 内左键拖角色产生的"移动 iframe"手势增量，由宿主 SDK 执行。详见 §2.8 |
| `xc.gesture-resize` | 同上 + `corner:'NW'｜'NE'｜'SW'｜'SE'` | **仅宿主开了 `gestures.resize`**：拖四角产生的缩放增量（`corner` = 被拖的角，对角固定）。详见 §2.8 |
| `xc.error` | `{ code, message, command? }` | `code`: `unsupported｜bad_request｜not_ready｜origin_denied｜failed｜busy｜unknown_id`（SDK 另有本地 `timeout`）。`busy` = 换装请求被更新的请求顶掉（可忽略）；`unknown_id` = 服装 / 场景 id 格式合法但不在白名单（或 `?outfit=` / `?scene=` 启动参数非法，此时 `command` 为 `outfit` / `scene`） |

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
| 延迟（TTFA） | = 解码 + 首片（2 s 音频）推理 + 1 次 decode。**本机实测（无头 Chromium + swiftshader，Mac 桌面 CPU，INT8 wasm）：热状态从 `utterance start` 到音频 `start` ≈ 0.7 s；EMAGE 冷启动（模型已在本地 HTTP 缓存）≈ 4 s**；真实网络下首次下载 INT8 模型（slim 版共约 72 MB：`emage_step_int8.onnx` 66.55 MB + 其余 4 个小模型共 71.59 MB，brotli 后约 58 MB）会远大于此，所以首次 `xc.audio` 之前建议宿主先 `xc.setConfig{heavy:'eager'}` 预热。手机量级参考 `EMAGE_MODEL.md`（单窗 0.7–1.0 s）→ TTFA 约 1–1.5 s（未实测） |
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

### 2.6 换装 / 换场景 / 预取（阶段 3，协议仍是 v1）

**版本协商**：协议版本不变（`v: 1`）。新能力一律通过 `xc.ready.capabilities` 声明：`outfits`（可换的服装列表，**不含裸模**）、`scenes`（场景列表）、`prefetch`（布尔），以及 `commands` 里的 `xc.setOutfit` / `xc.setScene` / `xc.prefetch`。SDK 在握手后检查：旧版 `/embed`（没有这些字段）上调用新方法，会本地 reject `[unsupported]` 并发 `error` 事件，**不会**把命令发出去；握手前排队的调用同样处理。新 SDK + 旧 iframe、旧 SDK + 新 iframe 都能工作。

**id 规则**：`^[a-z][a-z0-9_]{0,63}$` 且 `Object.hasOwn(白名单, id)`。格式不对 → `bad_request`（SDK 在本地就拒绝，不发消息）；格式对但不在白名单（含 `constructor` 这类原型键、`base`）→ `unknown_id`。iframe 一侧**独立**再校验一遍，不依赖 SDK。

**换装并发规则（决策：串行 + last-wins，说话不被打断）**

| 情况 | 行为 |
| :-- | :-- |
| 空闲时换装 | 立即开始，完成后发 `xc.outfit-changed` |
| 换装进行中又来新请求 | 排队等待；**正在加载的那个不会被中止**（引擎的加载不能安全中止） |
| 排队期间又来更新的请求 | 旧的排队请求被顶掉，回 `xc.error{busy}`（SDK 里 `setOutfit()` reject `[busy]`，可忽略）；最后一个请求一定会执行 → **last-wins** |
| 排队的是同一个目标 | 合并成一次加载，所有等待者一起 resolve |
| 目标已是当前服装 | `noop`，不加载、不发 `outfit-changed` 事件（SDK 直接 resolve） |
| 一次加载失败 | 只影响它自己，队列继续；当前服装保持不变 |
| 换装时正在说话 | **不打断说话**（`xc.audio` / TTS 照常播完，`utterance end` 照常发）；换装在后台加载，完成后才换上。实测（本机 Chrome，4s 音频，说到 1s 时换装）：换装约 0.8s 完成，`utterance end` 在 4.4s 按时发出，无 `error` |

选 `busy` 而不是"排队全部执行"：用户连点 5 个服装时，中间 3 个已经没有意义，全加载只会浪费 3 次 10MB 级的解压合成。

**场景（只有 `light` / `dark` / `transparent` 三个内置主题；不新增真实场景资产）**

- 用户点按钮或宿主 `xc.setScene` 切场景用 `sceneManager.setScene(id, true)`，写 iframe 自己的 localStorage（`xiaochun_scene_theme`）；`setConfig{transparent}` 的内部切换用 `setScene(id, false)`，不写。
- 宿主侧 SDK 在 `scene-changed` 后同步：外壳背景（透明时去掉）、`pointermove` 穿透监听的开/关、**非透明场景强制 iframe `pointer-events:auto`**、重置命中缓存（`lastHit` / 节流位置 / rect 缓存，避免切回透明后沿用旧结果）。iframe 内同步重置桥的 `lastHit`。
- `transparent` 创建选项等价于 `scene:'transparent'`；`<xiaochun-avatar transparent>` 仍是创建期选项（改它会重建），要运行时切请改 `scene` 属性 / 调 `setScene()`。

**偏好保存（决策：iframe 用自己的 localStorage 保存并读取；宿主 `persist` 仍可选）**：

- **键沿用主站**：服装 `xiaochun_wearing_outfit`（服装 id）、场景 `xiaochun_scene_theme`（场景 id），定义在 `src/lib/constants.ts`，与主页 `/` 同一套读取逻辑。存的是 **iframe 自己 origin** 的 localStorage，不是宿主页的。
- **读取（`/embed` 启动时）优先级**：URL / SDK 显式指定的 `outfit` / `scene`（含 `transparent=1`、`theme=`）> iframe 存的 > 默认。显式值**不会**被写进存储，只有后续变化才写，所以去掉显式参数后又会回到用户上次选的。显式值即使非法（`unknown_id`）也不回退到存的，保证宿主指定的外观是确定的。
- **写入**：用户在 iframe 内置按钮换装 / 换场景，以及宿主 `xc.setOutfit` / `xc.setScene`（含 `xc.setModel{outfit}`）。重选当前这一项也写（例如系统本来是深色，用户明确选 `dark`）。`setConfig{transparent}` 的内部切换、初始加载不写。
- **坏数据**：存的 id 不在白名单（手改 / 旧版本留下 / 服装已下线，含 `constructor` 这类原型链名字）→ 忽略并清掉这条，回默认。
- **存储不可用**：所有 localStorage 读写都包在 try/catch 里；被浏览器分区 / 拦截 / 沙箱禁用 / 隐私模式配额满时静默回退到默认，不报错、不影响加载与换装（只是不记忆）。
- **分区的影响**：第三方 iframe 的 localStorage 按"顶层站点 + iframe origin"分区（见风险表），所以同一用户在 A 站、B 站各有一份偏好，互不相通；Safari 等可能过一段时间清掉。要跨站一致或更强的保证，用下面的 `persist`。
- **宿主 `persist`（可选，保留）**：SDK 选项 `persist`：`false`（默认，不存）｜`'host'`（宿主 `localStorage['xiaochun:prefs']`）｜自定义 key 字符串。只保存 `setOutfit` / `setScene` 引起的变化；读取优先级 显式 `outfit` / `scene` 选项 > 已保存偏好 > 默认。它读出来后是以**显式值**传给 iframe 的，所以**会盖过** iframe 自己存的；存储里的坏数据忽略，保存的 id 在新版 `/embed` 里已不存在（启动时收到 `unknown_id`）SDK 会清掉这条过期偏好。
- **`<xiaochun-avatar>` 默认 `transparent`**：它等价于显式 `scene:'transparent'`，因此会盖过 iframe 存的场景（服装不受影响）；想让用户选的场景生效，给 `<xiaochun-avatar>` 设置非透明的 `scene`，或直接用 iframe（`createXiaochun` 不带 `transparent`/`scene`）。

**自定义模型 URL（决策：默认关闭）**：`xc.setModel({ url })` 要求 `allowCustomModel:true`（SDK 创建选项，经 `xc.init` config 传给 iframe；`setConfig` 也可改）。关闭时 SDK 本地 reject `[unsupported]`，iframe 也独立拒绝（`unsupported`）。内置服装（`setOutfit`）不受影响。

**预取（决策：默认关闭，不预取婚纱）**

- SDK：`prefetch(ids?)` 随时可调；创建选项 `prefetch: true | string[]` 只在 **`heavy:'eager'`** 时于首次 `xc.loaded` 后自动发一次（"非 lazy 模式"）。`heavy:'lazy'`（默认）下该选项不生效。
- iframe：只把服装的原始字节写进 IndexedDB（键 = url + sha，与引擎自己的缓存是同一个键，所以之后换装直接命中、不再下载；**解压 / 合成仍在换装时做**，实测约 0.9s，见下），**全局并发 1**；`heavy:'eager'` 时先等 EMAGE 加载完，再等没有进行中的换装；省流量模式整体跳过（`skipped:'save-data'`）。
- 默认列表 = 全部内置服装去掉 `xiaochun_wedding`（13.9MB）；显式 `prefetch(['xiaochun_wedding'])` 照做。

**服装文件**：继续同源 `/vrm/addons/*.vrmaddon`，本批不迁 CDN。

### 2.7 内置换装 / 换场景按钮（`ui`）

`ui` 是**部件名数组**，决定 iframe 里显示哪些内置界面；不写或空数组 = 全都不显示（宿主自己画 UI 的默认用法不变）。

| 部件名 | 内容 |
| :-- | :-- |
| `chat` | 聊天栏（ChatBar；对话走 WebLLM，会多加载一部分 UI 代码） |
| `bubble` | 头顶气泡 |
| `outfit` | 换装按钮（衬衫图标 + 下拉菜单） |
| `scene` | 换场景按钮（山景图标 + 下拉菜单） |
| `lang` | 语言切换按钮（地球图标 + 下拉菜单：简体中文 / English / 日本語，当前项 ✓）。用户选择后界面**立即**切换，写进 **iframe 自己的 localStorage**（`xiaochun_embed_lang`），并发 `xc.lang-changed`；宿主可监听后存自己的偏好、下次用 `lang` 选项传回 |
| `github` | GitHub 按钮（链接到项目仓库）。`<a target="_blank" rel="noopener noreferrer">`，**在新标签页打开**，不会把 iframe 导航走 |

```ts
createXiaochun({ container: '#avatar', ui: ['outfit', 'scene', 'lang', 'github'] });   // SDK
```
```html
<xiaochun-avatar ui="outfit,scene"></xiaochun-avatar>                 <!-- 自定义元素 -->
<iframe src="https://…/embed?host=…&ui=chat,outfit,scene"></iframe>   <!-- 手写 iframe: 逗号分隔 -->
```
```tsx
<Xiaochun ui={['outfit', 'scene']} />                                  {/* React: 同一个数组; 内容变化才重建 iframe */}
```
旧写法 `ui: true` / `?ui=1` 仍等价于 `chat,bubble`（已弃用，会 `console.warn`）。运行时改用 `client.setConfig({ ui: ['outfit'] })`。名字在 SDK 和 iframe 两侧各自按白名单校验（未知项被忽略并 `console.warn`；`setConfig` 里出现未知项直接 `bad_request`）。

**显示策略（`uiAutoHide`，与 Tauri 桌宠一致）**

内置界面（顶部按钮条 + 聊天栏）的出现 / 消失与 Tauri 共用同一套代码：`src/hooks/usePetUiVisibility.ts`（状态机）+ `src/core/ui/clickDetector.ts`（单击判定）。

| `uiAutoHide` | 行为 |
| :-- | :-- |
| `'transparent'`（**默认**） | **透明场景**（桌宠模式）：初始隐藏；**单击角色**出现，再单击角色或点空白收起；亮 / 暗场景：一直显示。这就是 Tauri 的行为（Tauri 里也只有透明场景才"点击才出现"） |
| `true` | 所有场景都"点击才出现"（embed 扩展选项，Tauri 无；适合想让画面更干净的亮 / 暗场景） |
| `false` | 一直显示（旧行为；想要稳定可见的按钮就用它） |

- **单击判定**：左键（触屏为主指针）按下→抬起，位移 ≤ 6px（`CLICK_MAX_MOVE_PX`）算单击；位移取 client 与 screen 两者较大值——`draggable` 时 iframe 自己会被宿主移动，client 坐标几乎不变，必须看 screen。**拖动 iframe 不会触发出现**；非左键、`pointercancel` 忽略。
- **命中谁**：落在按钮 / 聊天栏 / 菜单 / 对话框上（`[data-xc-ui]`、`button`、`input`、`[role=menu]` 等）的点击忽略；其它点击用 `vrmEngine.isHitModel`（射线）判断：**点在角色身上 = 切换（出现 ↔ 收起）**，点在空白处 = 收起。
- **自动收起**：出现后 10 秒无操作自动收起（`PET_UI_DURATION_MS`）；指针悬停在按钮条 / 聊天栏上、任意菜单或对话框打开期间、聊天栏有焦点 / 有文本 / 在发送，都会暂停计时并保持显示。
- 隐藏 = `opacity:0` + `visibility:hidden`（DOM 保留，不挡点击也不参与穿透命中）；出现时四角缩放弧线会随之闪一下（`corner-flash`），与 Tauri 一致。
- **触屏 + 透明场景**：第一次轻触用来唤醒穿透命中检测（落在宿主页上），第二次轻点角色才出现 / 收起。
- **与 Tauri 不能完全一致的地方**：① 透明场景下，点宿主页的空白处到不了 iframe（穿透），所以"点空白收起"只能靠 10 秒超时或再点角色；② Tauri 的拖动是系统原生 `startDragging`，embed 是 SDK 按增量移动 iframe（判定阈值相同）；③ 长按 480ms 进入 3D 调整后松手，若几乎没动也会触发一次切换（Tauri 同样的既有行为）。
- 向后兼容：不想要新行为就传 `uiAutoHide: false`；`capabilities.ui.autoHide === true` 才表示 iframe 支持（旧 iframe 忽略该选项，界面常显）。

**按钮是主站 TopHeader 同一套组件**：玻璃质感按钮（`Button variant="glass"`，移动端 44×44、桌面 36×36）、`DropdownMenu`、lucide 图标（`MountainSnow` / `Shirt` / `Check` / `Loader2`）和同一批 i18n 文案（`header.switchScene.tooltip` / `header.switchOutfit.tooltip` / 场景名 `scene.nameKey`，随 `lang` 切换）；语言 / GitHub 按钮同样来自主站 TopHeader 的共享组件（`components/HeaderButtons.tsx`）。按钮放在 iframe 右上角，不遮住角色主体；菜单展开时才会盖住一部分画面。和 TopHeader 的差异：没有上传 / 裸模 / 语言 / GitHub 等项；服装列表来自 `capabilities.outfits`（**不含裸模、没有自定义 URL**）；加载中按钮**不会**被禁用（连点按下面的 busy 规则处理）。

**行为（与 `xc.setOutfit` / `xc.setScene` 完全同一条路径）**

- 点选服装/场景走与 SDK 调用相同的白名单、**同一个串行队列 + last-wins**，成功后照常发 `xc.outfit-changed` / `xc.scene-changed`（宿主据此保存偏好，见下）；点当前已穿着的那一项什么都不发生。
- 服装菜单每行只有名字，加载中那一行转圈（菜单里不显示文件体积；`capabilities.outfits[].sizeMB` 仍随握手提供，只是给宿主自己的 UI 参考用），当前穿着的一行打 ✓。连点时按钮上方出现一条轻提示（"正在换装，已记下你的最新选择"，约 2s 自动消失），最后一次点选一定生效。
- **宿主用 SDK 调 `setOutfit` / `setScene`（或 `outfit` / `scene` 属性）时，按钮的 ✓ 和加载状态同步**。
- 按钮上的 pointer 事件不会冒到画布，所以点按钮**不会触发转身/拖动手势**。
- **透明场景**：按钮参与穿透命中检测——指针在按钮上或菜单展开期间 iframe 接收事件（点击不会漏到宿主页），空白处仍穿透。触屏 + 透明场景下，第一次轻触用来唤醒命中检测（落在宿主页上），第二次才落到按钮上。不透明场景行为不变（整块 iframe 接收事件）。
- **语言**：`lang` 优先级见 §1 参数表。用户在语言按钮里选的只写 iframe 自己的 localStorage（`xiaochun_embed_lang`，坏数据忽略并清除）；宿主 `setConfig{ lang }` 和显式 `lang` 选项**不写**存储。想让宿主页其它部分跟着变，监听 `lang-changed` 事件（`initial:true` 是握手后的当前语言）。第三方上下文里该存储按"顶层站点 + iframe origin"分区，被拦截时静默回退（只是不记忆）。
- **偏好默认由 iframe 自己的 localStorage 记住**（见 §2.6 偏好保存）：用户通过内置按钮选的服装 / 场景，刷新后自动恢复，无需宿主处理。宿主想自己存（例如跨站一致），仍可监听事件，并把值作为显式 `outfit` / `scene` 传回（显式值优先于 iframe 存的）：
```ts
const xc = createXiaochun({ container: '#avatar', ui: ['outfit', 'scene'],
  outfit: localStorage.getItem('my-outfit') ?? undefined, scene: localStorage.getItem('my-scene') ?? undefined });
xc.on('outfit-changed', (p) => { if (!p.initial) localStorage.setItem('my-outfit', p.id); });
xc.on('scene-changed',  (p) => { if (!p.initial) localStorage.setItem('my-scene', p.id); });
// 或者直接用 persist: 'host' (SDK 替你做同样的事; 可选)
```

---

### 2.8 手势：拖动 iframe / 角落缩放 iframe（`xc.gesture-move` / `xc.gesture-resize`）

**目的**：让 `/embed` 的 iframe 有和 Tauri 桌宠窗口一样的体验：左键按住角色拖 = 移动，拖四个角 = 缩放。识别逻辑**不另写一套**，直接复用 `src/core/gesture/`：

| 能力 | 复用的代码 | 说明 |
| :-- | :-- | :-- |
| 移动 | `GestureMachine` 的 `delta` 策略（Tauri 用 `native` 策略，同一台状态机） | 10px 位移阈值、480ms 长按武装、多点触控取消、"按在按钮上不算拖动起点" 全部沿用；经 `InteractionController.setMoveSink` 把 `move-start / -delta / -end` 转成 `xc.gesture-move` |
| 缩放 | `ResizeGesture('delta')` + `core/gesture/corners.ts` | 角落热区 `CORNER_HIT_SIZE = 40px`、`cornerAt()` 命中判断、`CORNER_CURSOR`（`NW/SE = nwse-resize`，`NE/SW = nesw-resize`）与 Tauri 的 `TauriWindowFrame` 是同一份；弧线外观是同一个 `components/CornerHandle` |

**协商（默认全关）**：宿主选项 `draggable` / `resizable` 为 `true` 时，SDK 在 `xc.init` 的 `config.gestures = { move, resize }` 里告诉 iframe（运行时用 `xc.setConfig{ gestures }`）。`xc.ready.capabilities.gestures = { move, resize, cornerSize }` 声明 iframe 支持（`cornerSize = 40`）。**宿主不开 = iframe 不加任何手势监听、不拦截任何指针事件、不渲染角落弧线**；旧版 `/embed`（没有 `capabilities.gestures`）上开 `draggable` / `resizable` 会 emit 一次 `error{ code:'unsupported', command:'gestures' }`。

**消息格式**（iframe → 宿主，走 MessagePort；信封 `{ type, v:1, payload }`）：

| 字段 | 含义 |
| :-- | :-- |
| `gesture` | 手势序号，从 1 起，每个新手势 +1（宿主要求严格递增，防重放 / 乱序） |
| `seq` | 手势内序号：`start` 为 0，之后严格递增 |
| `phase` | `start` → 若干 `move` → `end`（一次手势一定以 `end` 收尾） |
| `dx`, `dy` | 本次相对上一条的增量（屏幕坐标，CSS px，供日志 / 动画用） |
| `totalDx`, `totalDy` | **自 `start` 起的累计位移**。宿主按它定位（丢包 / 合并不会累计误差） |
| `reason` | 仅 `end`：`up` 松手 · `cancel` 被取消（多点触控、宿主关闭手势、销毁） · `blur` 窗口失焦 |
| `corner` | 仅 `xc.gesture-resize`：被拖的角；**对角固定** |

**宿主 SDK 执行与校验**（`gesture-box.ts`，纯函数、有单测）：
- 只接受来自该 iframe MessagePort 的消息（port 在握手里经 origin 校验后建立）；`gesture` / `seq` 必须递增，`move` / `end` 必须属于当前打开的手势，同一时刻只处理一个手势；数值必须是有限数且 `|v| ≤ 20000`，`corner` / `phase` / `reason` 必须合法，否则丢弃。选项关着时一律忽略。
- **移动**：`inline` 模式用 CSS `translate`（不改布局流）；浮动模式改 `left/top`（`right/bottom` 置 auto）。位置夹在视口内（整块不拖出视口）。
- **缩放**：写 `width/height` px；默认最小 `120×180`、最大 = 视口；`resizable` 也可以是 `{ minWidth, minHeight, maxWidth, maxHeight }` 自定义。拖 `NW` 时右下固定，拖 `SE` 时左上固定，依此类推；不会越过视口。
- 手势期间宿主给 iframe 外壳加 `user-select:none` 并清掉选区（见下）。窗口 resize 时盒子会被重新夹回视口内。
- **缩放是运行时状态，不重建 iframe**：`width` / `height` / `size` / `draggable` / `resizable` 变化都不会销毁实例（模型、动画、对话状态保留）；iframe 内 `innerWidth/innerHeight` 随盒子变化，渲染器自适应。
- **记住位置 / 大小（`persistBox`，默认关）**：开了 `draggable` / `resizable` 后，`persistBox: true`（key `xiaochun:box`）或命名空间字符串（key `xiaochun:box:<名字>`）会在每次拖动 / 缩放**结束**时把盒子写进**宿主页** localStorage（读写都 try/catch，隐私模式 / 配额满只是不记忆），下次创建时恢复。存的是 `{ v:1, mode, x, y, width, height }`：悬浮模式 `x/y` = 视口 `left/top`，内联模式 `x/y` = 相对流内原点的 translate 位移（与滚动无关）。
  - **优先级**：显式 `width` / `height` 选项 > 已保存 > 默认（600×1080）。位置没有对应的显式选项（`position` 只是预设锚点），所以已保存的位置始终生效。**想恢复用户缩放后的大小，就不要传 `width` / `height`**（尺寸由已保存值或默认值决定）。
  - **钳制到当前视口**：大小夹在 `[最小, 视口]`（最小 = `resizable` 的 `minWidth/minHeight`，默认 120×180）；悬浮模式整块拉回视口内；内联模式横向夹进视口、纵向只保证不越过文档顶部（内联盒子可以在滚动页面的下方，不能按视口夹）。之后窗口再变小，既有的 `resize` 监听继续把它夹回视口（内联同样只夹横向 / 尺寸）。
  - 只在对应手势打开时恢复（没开 `draggable` / `resizable` 的实例不会被旧值改位置）；保存时的 `position` 模式与当前不同、或数据损坏 / 越界 / 版本不符，一律忽略并清掉旧值。
  - 清除：`clearPersistedBox()`（只删存储，不动当前盒子）；`clearPersistedBox({ reset: true })` 同时把盒子还原到初始位置 / 大小（悬浮回锚点，内联清位移）。`<xiaochun-avatar>` 有同名方法，React 在 `ref` 上。
- 事件：`move` / `resize`（`{ phase, left, top, width, height }`，`<xiaochun-avatar>` 为 `xc-move` / `xc-resize`，React 为 `onMove` / `onResize`）；方法 `setSize(w, h)` / `getBox()` / `setDraggable(on)` / `setResizable(on｜limits)`。

**选中蓝框修复**：iframe 内 `html.xc-gestures` 时 `user-select:none`、`-webkit-touch-callout:none`、画布 `-webkit-user-drag:none`；canvas 的 `pointerdown` 里 `preventDefault`（不影响 OrbitControls / GestureMachine）；`selectstart` / `dragstart` 一律阻止；缩放按下角落时用 **pointer capture**，拖出 iframe 边界也能继续收到 move。宿主侧手势期间同样 `user-select:none` 并清选区，所以拖动时宿主页不会被刷出蓝色选中框。

**透明场景 + 穿透**：只有指针在**角色 / 内置按钮 / 菜单**上，或（开了 `resizable` 时）在**四角 40px 热区**里，`xc.hit-region` 才为 `hit`，SDK 才把 iframe 切成 `pointer-events:auto` 并接管手势；其余位置仍穿透到宿主页。bridge 里的 `HitGate` 把角落热区算作命中（`cornerAt` 与缩放判断同一个函数）；只开 `draggable` 时角落**不是**热区，保持穿透。

**圆角（与 Tauri 一致）**：Tauri 桌宠窗口无边框，`#root` / `#app` / 加载遮罩统一 `border-radius: 20px; overflow: hidden`（`main.css` 的 `--xc-window-radius`）。`/embed` 复用同一个值 `XC_WINDOW_CORNER_RADIUS = 20`（`protocol.ts`，有单测 `windowRadius.test.mjs` 保证两处不漂移）：非透明场景（light / dark）SDK 默认给外壳 / iframe / 占位图 20px 圆角，角被裁掉透出宿主；透明场景没有底色，默认 0（不裁角色）。半径是固定 px，缩放时不随尺寸变形；`borderRadius`（选项 / `setBorderRadius` / `border-radius` 属性 / React prop）或 `--xc-radius` 可覆盖，`0` = 方角。角落弧线（`CornerHandle`）的几何按 20px 圆角画（内缩 4px、半径 16，与 20px 圆角同心），所以默认设置下弧线贴合圆角；自定义半径时弧线形状不变。阴影 / 边框：Tauri 窗口 `shadow:false`、无边框，iframe 也默认没有（`--xc-shadow` 可选）。手写 `<iframe>`（不经过 SDK）不会自动圆角，请给 iframe 元素自己加 `border-radius`。

**白色提示的柔和阴影（Tauri / embed 同一套）**：四角弧线（`CornerHandle`）和 3D 调整提示（Cmd/Ctrl 立即 3D、长按后的 turn / pitch / cameraY 引导，`core/interaction/*Guide3D` + `guideShadow.ts`）主体保持白色，统一在下面垫一层柔和深色阴影：低透明度（3D 提示层 alpha 0.20、弧线描边 alpha 0.20 再经模糊，浅色背景上仍微可见）、大模糊半径、没有硬黑边；颜色与全部阴影参数集中在 `src/core/interaction/guideStyle.ts`（`GUIDE_COLOR` + `GUIDE_OPACITY`=0.75（主体半透明白，three.js 的 Color 不认 rgba，所以颜色与不透明度分开）/ `GUIDE_SHADOW`，阴影层把主体覆盖区抠掉，半透明主体不会透出阴影脏边，带合法范围与调大调小说明，无任何 import，Tauri / embed / SDK 相关代码都能直接复用），弧线与 3D 提示都从它读取、不再各自硬编码，不区分场景、不区分 Tauri 与 embed。原因：iframe 常见浅色不透明背景（或透明场景叠在白色宿主页上），纯白提示会“隐形”；深色背景上黑色光晕几乎不可见，不显脏。弧线内收 4px 且 svg `overflow-visible`，阴影不会被外层 `overflow-hidden` 裁掉；引导本体是加亮混合（画不出暗色），所以阴影是独立的一层，由引导贴图烘焙而来并作为子对象跟随变换，不参与拾取。注意：Tauri 桌宠的弧线和引导因此也多了这层柔和阴影（有意为之）。显示时机：指针在某个 40px 热区内 / 正在拖角 / **刚被宿主打开 `resizable`、鼠标进入 iframe、触屏按下时**短暂亮 2.5 秒（对应 Tauri 唤出 UI 时的 `corner-flash`）。

**行为约定**：按在内置按钮 / 菜单（`[data-xc-ui]`）上不会成为拖动起点或缩放起点；左键以外的按键不触发；滚轮缩放（`controls`）不变；触屏按下会让四个角短暂亮一下（没有 hover），2.5 秒后淡出。

### 2.9 相机（`camera`：fov / distance / height / intro）

宿主可以调 iframe 里的相机取景。**只有这四项**；相机的左右方向不开放（左右转动是角色 `bodyTurn`，相机本身只绕角色上下俯仰，所以也**不开放 pitch**）。

| 项 | 范围 | 默认 | 含义 |
| :-- | :-- | :-- | :-- |
| `fov` | 15 – 60（度） | 30 | 视野角。越小越像长焦、越大越广角。**只改 fov 时视距按 `取景范围 / (2·tan(fov/2))` 自动补偿**，角色在画面里的大小基本不变（想更大 / 更小用 `distance`） |
| `distance` | 1 – 15（米） | ≈ 2.50（随 fov） | 相机到角色的视距，越小角色越大。显式设置后：首次取景时**忽略 iframe 里保存的视距 / 俯仰**（俯仰回默认）；之后用户滚轮缩放仍可调，换装 / 换场景的重新取景**不会**把它拽回宿主给的值 |
| `height` | −1 – 1（米） | 0 | 取景高度偏移：正值 = 相机连同目标一起上抬（角色在画面里下移），负值相反。复用主站 "Y 偏移" 机制，但**显式值不写入** iframe 的保存值 |
| `intro` | `true` / `false` | `true` | 加载完成后的推镜头动画（约 1.1 秒）。`false` = 直接放到终点，不播 |

越界值被**夹到范围边界**（SDK / iframe 各 `console.warn` 一次）；非数字 / 未知键（含 `pitch`）整体忽略（创建期）或回 `xc.error{bad_request}`（`xc.setConfig`）。

**怎么传**

- 创建期：SDK `camera: { fov, distance, height, intro }`（写进 URL `?cameraFov=` `?cameraDistance=` `?cameraHeight=` `?cameraIntro=0|1`，模型加载前生效，首次取景 / 推镜头直接按它来）；`<xiaochun-avatar camera-fov camera-distance camera-height camera-intro>`；React `camera={{…}}`。手写 iframe 直接拼上述 URL 参数即可。
- 运行时：`xc.setConfig({ camera: { fov: 40 } })` / `client.setConfig({ camera })`。**缺省键 = 不变，`null` = 清除该项回到默认**（`distance: null` 后回到 iframe 保存值 / 默认）；元素改 `camera-*` 属性、React 改 `camera` prop 都是热更新（不重建 iframe；少写的项按 `null` 处理）。运行时改相机会**立刻重新取景并取消进行中的推镜头**（把控制权还给用户）。
- 探测：`xc.ready.capabilities.camera = { fov: [15,60], distance: [1,15], height: [-1,1], intro: true }`；旧版 `/embed` 没有这个字段（会忽略 camera 选项）。

**优先级**：宿主显式值（URL / SDK / setConfig） > iframe 自己 localStorage 里保存的（用户拖拽 / 滚轮后的俯仰 / 视距，`xiaochun_camera_pitch`；`height` 对应 `xiaochun_camera_y_offset`） > 默认。宿主设了 `distance` 期间，用户在 iframe 里的缩放 / 俯仰**不会被写进保存值**（宿主在定镜头，去掉该选项后不会残留宿主的取景）。

范围常量来自主仓库 `APP_CONFIG.camera`（`minFov/maxFov`、`defaultMin/MaxDistance`、`hostMaxYOffset`），SDK 里的 `XC_CAMERA_RANGES` 与之一致（单测 `src/embed/camera.test.ts` 校验）。引擎里"默认取景距离"只有一个函数（`getDefaultCameraDistance(fov)`），初始机位 / `fitCamera` / 推镜头终点共用，不再各算各的。

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

### 3.2 `/vrm/*` 缓存头（`public/_headers`）

`/vrm/*`（`.vrmbase` / `.vrmaddon` / `.vrma`）发 `Cache-Control: public, max-age=3600, must-revalidate`。**为什么不是 `immutable` 长缓存**：

- 这些文件的 **URL 不带内容哈希**（`xiaochun_maid.vrmaddon` 重建后路径不变）。HTTP 长缓存会让浏览器在部署新版后继续吐旧字节；而应用的 IndexedDB 缓存键是 `url + sha`（`config.ts` 里的 sha），旧字节会被**写进新 sha 的键**里，之后一直命中到下一次改 sha ——缓存中毒。
- 真正的"长缓存"是 IndexedDB（命中时根本不走网络）；HTTP 层只负责吸收同一会话内的重复下载（预取 + 换装、多个 iframe、IDB 不可用的隐私模式）。
- 1 小时 = 部署错位窗口；过期后带 ETag 做条件请求，没变就 304，不重新下载。
- 要更长的缓存，前提是 URL 带哈希（`?v=<sha>` 或把 sha 放进文件名），建议和"迁 CDN"一起做。

实现细节：`/*` 已经给了 `max-age=0, must-revalidate`，同名头被多条规则命中会被**拼成逗号串**，所以 `/vrm/*` 规则先用 `! Cache-Control` 摘掉再设（用 `wrangler dev` 验证过：响应只有一条 `Cache-Control`，带 `If-None-Match` 得 304）。同时删掉了对不存在的 `xiaochun_v1.vrmaddon` 的陈旧规则。

> 已知遗留（本批未改）：`/assets/*`（带哈希的构建产物）同样被 `/*` 的 `max-age=0` 拼成 `public, max-age=31536000, immutable, public, max-age=0, must-revalidate`，immutable 长缓存实际被抵消。修法同上（在 `/assets/*` 里加 `! Cache-Control`），建议单独提交。

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
  width: 320, height: 480,          // 不写 = 默认 600x1080 (宽 ≤ 视口宽 / 容器宽, 高 ≤ 视口高, 窄屏自动钳制); 固定尺寸 = 零 CLS
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
  width: 600, height: 1080,      // 数字=px 或 CSS 长度; 不写 = 默认 600x1080 (受视口限制: 宽 min(600px, 视口宽) 且不超过容器宽, 高 min(1080px, 视口高); 悬浮 position 再扣掉 --xc-offset-x/y 边距); 显式值原样使用。运行时 setSize(w, h), 传 undefined = 恢复默认
  position: 'inline',            // 'inline' | 'bottom-right' | 'bottom-left' (悬浮)
  draggable: false,              // true=在 iframe 里按住角色左键拖动 = 移动 iframe (手势, 见 §2.8); 内联 / 悬浮都走手势
  borderRadius: undefined,       // 外壳圆角 (数字 px / CSS 长度): 默认 非透明场景 20px (与 Tauri 桌宠窗口圆角同值) / 透明 0; 运行时 setBorderRadius(); --xc-radius CSS 变量优先
  resizable: false,              // true=拖四个角缩放 iframe (运行时状态, 不重建); 也可传 { minWidth, minHeight, maxWidth, maxHeight } 自定义限幅 (默认最小 120x180, 最大 = 视口)
  lang: undefined,               // 'zh-CN' | 'en' | 'ja'; 省略 = iframe 记住的(用户在语言按钮里选的) > 浏览器语言 > 'zh-CN'; 显式传入优先于记住的 (运行时 setConfig({ lang }) 不持久化); 变化时发 lang-changed
  outfit: undefined,             // 初始服装 id (如 'xiaochun_maid', 见 getOutfits()); 非法/未知 → 回退默认并 emit error{unknown_id}
  scene: undefined,              // 初始场景 'light' | 'dark' | 'transparent'; 省略 = 跟随 transparent / 系统亮暗
  camera: undefined,             // 可选: 相机 { fov: 15-60 (默认 30), distance: 1-15 米 (默认 ≈2.5, 随 fov), height: ±1 米 (默认 0), intro: 推镜头 (默认 true) }; 越界夹范围; 创建期写进 URL, 运行时用 setConfig({ camera }) (null = 恢复默认), 见 §2.9
  persistBox: false,             // 可选: 记住用户拖动/缩放后的位置+大小到**宿主页** localStorage: false | true ('xiaochun:box') | '<命名空间>' ('xiaochun:box:<名字>'); 需 draggable/resizable; 显式 width/height > 已保存 > 默认; 恢复时钳进当前视口; clearPersistedBox({ reset? }) 清除 (见 §2.8)
  persist: false,                // 可选: 偏好(服装+场景)另存在**宿主**localStorage: false | 'host' | '<自定义 key>'; 不开时 iframe 仍用自己的 localStorage 记住
  prefetch: false,               // true=预取全部服装(婚纱除外) | string[]=指定 id; 只在 heavy:'eager' 时自动触发, 否则手动 xc.prefetch()
  allowCustomModel: false,       // true=允许 setModel({url}) 加载任意 https 模型 (第三方文件会在 iframe 里被解析, 只对可信 URL 打开)
  // model: '...'                // @deprecated, 改用 outfit; 传了会 console.warn
  ui: [],                        // 要显示的内置界面部件: 'chat' | 'bubble' | 'outfit' | 'scene' | 'lang' | 'github' 的数组; 不写/空 = 都不显示 (见 §2.7)
  uiAutoHide: undefined,         // 内置界面显示策略 (创建期选项, 运行时 setConfig): 默认 'transparent' = 与 Tauri 一致, 只有透明场景"点击角色才出现", 亮/暗常显; true=所有场景点击才出现; false=一直显示 (见 §2.7)
  heavy: 'lazy',                 // 'lazy'=首次互动才加载 WebLLM/EMAGE (默认, 省流量显存); 'eager'=进来就预热 (首次说话更快, 首屏更重)
  controls: true,                // 滚轮缩放, 默认开 (与主站一致): 透明场景只在指针落在角色上才缩放; 不透明场景铺满的区域内滚轮 = 缩放 (吞该区域的页面滚动)。false = 锁定
  autoPause: true,               // 滚出视口自动暂停渲染, 省电; 关掉则一直渲染
  passthrough: undefined,        // 透明时按"是否点在角色上"切换 pointer-events; 默认=transparent
  sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox', // false=不加; 去掉 allow-same-origin 会让 IndexedDB/麦克风失效
  handshakeTimeout: 20000,       // ms, 范围建议 5000~60000; 调大适合慢网络, 调小更早报 timeout
  crossOriginIsolated: false,    // true=iframe allow 追加 cross-origin-isolated (需宿主页已 COOP/COEP 隔离, 见 §3.1); 默认 allow 仍是 'microphone; autoplay'
  zIndex: 2147483000,            // 悬浮模式层级
});
```
返回：`{ say, speakAudio, speakAudioStream, motion, expression, lookAt, setOutfit, setScene, getOutfits, getScenes, prefetch, outfit, scene, setModel, setConfig, setSize, getBox, setDraggable, setResizable, setBorderRadius, startListening, stopListening, mic, pause, resume, destroy, on, ready, activate, element, iframe }`（`outfit` / `scene` 是只读 getter）。
事件：`handshake`（协议握手）· `ready`（模型加载完）· `progress`（`payload.phase`: `model｜outfit｜prefetch`）· `state` · `stt` · `utterance` · `hit-region` · `outfit-changed` · `scene-changed` · `lang-changed`（`{ lang, previous?, initial? }`）· `move` · `resize`（手势移动 / 缩放，`{ phase, left, top, width, height }`）· `error`（新增 `busy` / `unknown_id`；旧 iframe 上开手势会收到一次 `unsupported`）· `destroy`。

```ts
const outfits = await xc.getOutfits();        // [{ id, name }]  不含裸模; 旧版 /embed 返回 []
const scenes  = await xc.getScenes();         // [{ id, transparent }]
await xc.setOutfit('xiaochun_maid').catch((e) => { if (!/\[busy\]/.test(e.message)) throw e; }); // busy = 被更新的请求顶掉, 可忽略
await xc.setScene('dark');                    // SDK 同步外壳背景 / 穿透监听 / pointer-events
await xc.prefetch(['xiaochun_cheongsam']);    // -> { downloaded, cached, failed }
```
错误以 `[code] message` 形式 reject：`[bad_request]`（id 格式不对，本地拒绝）· `[unknown_id]` · `[busy]` · `[unsupported]`（旧版 /embed 或未开 `allowCustomModel`）。

### 4.4 `<xiaochun-avatar>`

| 属性 | 默认 | 说明 |
| :-- | :-- | :-- |
| `src` | 官方 `/embed` | 改它会重建 iframe |
| `outfit` | — | 内置服装 id；运行时修改 = `setOutfit`（**热更新，不重建 iframe**） |
| `scene` | — | `light｜dark｜transparent`；运行时修改 = `setScene`（热更新） |
| `model` | — | **deprecated**，`outfit` 的旧别名（`outfit` 优先）；旧用法 https URL 仍走 `setModel`，受 `allow-custom-model` 约束 |
| `camera-fov` / `camera-distance` / `camera-height` / `camera-intro` | — | 相机选项（见 §2.9）；改它们是热更新（`setConfig({ camera })`，不重建），去掉属性 = 恢复默认 |
| `persist-box` | — | 记住拖动 / 缩放后的位置和大小：`persist-box=""` / `"true"` = 默认 key，其它字符串 = 命名空间。见 §2.8；改它会重建 |
| `persist` | — | `host` 或自定义 localStorage key；偏好另存在宿主页（可选，显式值盖过 iframe 自己存的；改它会重建） |
| `prefetch` | — | 空 / `true` = 全部（婚纱除外），或逗号分隔 id；仅 `heavy="eager"` 时自动触发（改它会重建） |
| `allow-custom-model` | `false` | 允许 `setModel({url})`（改它会重建） |
| `lang` | 自动 | `zh-CN｜en｜ja`；省略 = iframe 记住的 > 浏览器语言 > `zh-CN`；运行时修改 = `setConfig`（不持久化） |
| `mic` | `false` | 开关听写（模型加载完后生效） |
| `transparent` | `true` | `"false"` 关闭 |
| `draggable` | `false` | 手势拖动（拖角色 = 移动，内联 / 悬浮都行）。运行时修改 = `setDraggable`（热更新，不重建） |
| `resizable` | `false` | 拖四角缩放；运行时修改 = `setResizable`（热更新） |
| `border-radius` | 非透明 `20px` / 透明 `0` | 外壳圆角（数字 = px 或 CSS 长度）；运行时修改 = `setBorderRadius`（热更新） |
| `min-size` / `max-size` | — | 缩放限幅，格式同 `size`（如 `min-size="160x240"`），只在 `resizable` 时生效 |
| `position` | `inline` | `inline｜bottom-right｜bottom-left` |
| `size` | `600x1080`（受视口限制，窄屏自动钳制） | `"280"`（高 = 宽×1.5）、`"320x480"`、`"100%x480px"`；运行时修改 = `setSize`（**热更新，不重建 iframe**） |
| `lazy` | 空闲+视口 | `"click"` 仅点击；`"false"` 立即 |
| `paused` | `false` | `pause()` / `resume()` |
| `ui` | — | 内置界面部件，逗号分隔：`ui="outfit,scene,lang,github"`（不写 = 都不显示；未知项忽略并 warn）。改它会重建 iframe；运行时想改请用 `client.setConfig({ ui: [...] })` |
| `ui-autohide` | `transparent` | 内置界面显示策略：`"transparent"`（默认，透明场景点击角色才出现）· `"true"`（所有场景）· `"false"`（常显）。改它会重建 iframe；运行时用 `client.setConfig({ uiAutoHide })` |
| `controls` | 开 | `controls="false"` 锁定 iframe 内滚轮缩放（默认开，见 §1 参数表） |
| `placeholder` / `heavy` / `allowed-origins` | — | 同 `createXiaochun` |
| `cross-origin-isolated` | `false` | 同 `createXiaochun({ crossOriginIsolated })`；改它会重建 iframe。见 §3.1 |

事件（`CustomEvent`，`composed`，`detail` = 协议 payload）：`xc-ready`（模型加载完）· `xc-progress` · `xc-state` · `xc-stt` · `xc-utterance` · `xc-outfit-changed` · `xc-scene-changed` · `xc-lang-changed` · `xc-move` · `xc-resize` · `xc-error`。方法：`say` · `speakAudio` · `speakAudioStream` · `motion` · `expression` · `setOutfit` · `setScene` · `getOutfits` · `getScenes` · `prefetch` · `destroy`；`el.client` 可拿到完整 SDK 实例。

手动验证页：[`packages/project-xiaochun/examples/embed-host.html`](../packages/project-xiaochun/examples/embed-host.html)（头部注释写了启动步骤）。页面里有换装 / 换场景 / 预取 / `persist` 演示和事件日志。

自动化验证（均在 `packages/project-xiaochun`，需要 `puppeteer-core` + 本机 Chrome，用环境变量 `PUPPETEER_MODULE` / `CHROME_PATH` 指定）：

| 命令 | 内容 |
| :-- | :-- |
| 仓库根 `pnpm test:embed` | iframe 侧纯逻辑：白名单 / 原型键 / 串行队列 / 预取调度（node:test，无需浏览器） |
| `pnpm test` | SDK：手势盒子（移动 / 缩放 / 限幅 / 序号门）、id 校验 / capability 协商 / persist / busy / allowCustomModel / 属性热更新（node:test） |
| `pnpm test:outfit` | 浏览器 + stub iframe：SDK 外壳背景 / 穿透监听 / pointer-events 同步、元素与 React 热更新不重建 iframe |
| 仓库根 `pnpm test`（vitest） | 含 `core/gesture` 单测（`corners.test.ts`：角落热区 / 光标） |
| `pnpm test:e2e` | **真实 `/embed`**（先 `pnpm build && npx vite preview --port 5291`，`EMBED_URL=https://localhost:5291/embed`）：换装、换场景、透明↔不透明穿透、非法 id、连点、说话中换装、`?outfit=` / `?scene=`、预取（IDB + 网络请求计数）、**手势**（puppeteer 真鼠标：拖动 / 角落缩放 / 限幅 / 默认关闭无效 / 透明穿透热区 / 不重建 iframe；向外拖出 iframe 的用例在关掉站点隔离的 Chrome 里跑，因为 CDP 合成事件不做跨进程鼠标捕获） |

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
- props = `createXiaochun` 的全部选项（不含 `container`）+ `onHandshake / onReady / onProgress / onState / onStt / onUtterance / onHitRegion / onOutfitChanged / onSceneChanged / onError / onDestroy` + `className / style` + `paused / mic`。
- 重建 vs 热更新：`src / origin / allowedOrigins / lazy / lazyMargin / placeholder / transparent / position / ui / heavy / controls / autoPause / passthrough / sandbox / handshakeTimeout / crossOriginIsolated / zIndex` 变化会销毁并重建实例（这些是创建期选项，别在渲染里每次给新值）；`lang / outfit / scene / paused / mic / width / height / draggable / resizable`（以及已弃用的 `model`）与回调变化**不**重建（`lang`→`setConfig`，`outfit`→`setOutfit`，`scene`→`setScene`，`width/height`→`setSize`，`draggable`→`setDraggable`，`resizable`→`setResizable`，均由 effect 调 setter；`busy` / `unknown_id` 走 `onError`）。`persist / prefetch / allowCustomModel` 是创建期选项，变化会重建。（新增回调 `onMove / onResize`；手势缩放期间用户改了尺寸，之后 `width/height` prop 变化会再覆盖它。）
- ref 句柄：`say / speakAudio / speakAudioStream / motion / expression / lookAt / setOutfit / setScene / getOutfits / getScenes / prefetch / setModel / setConfig / startListening / stopListening / mic / pause / resume / activate / destroy / ready / instance`；未挂载时返回 Promise 的方法会 reject。

### 4.7 样式（CSS 自定义属性 / `::part`）

`<xiaochun-avatar>`（以及直接用 SDK 时的容器或任意祖先元素）可以用 CSS 自定义属性调整**外壳**（自定义属性会穿透 Shadow DOM）：

| 变量 | 默认 | 作用与范围 |
| :-- | :-- | :-- |
| `--xc-radius` | 非透明 `20px` / 透明 `0` | 圆角（CSS 长度，0 ~ 宽度的一半；`50%` = 圆形头像框）。优先级高于 `borderRadius` 选项。调大更圆，过大会裁掉角色头/脚。同时作用于 iframe / 占位图 / 外壳 |
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
**不会被宿主页的文字选区染蓝**：Chrome 在宿主页选区跨过 iframe（拖选划过 / Cmd·Ctrl+A / 全选）时，会给整块 iframe 盖一层蓝色高亮。SDK 因此给外壳、占位图、iframe 都设了 `user-select: none` / `-webkit-user-select: none`（用 CSSOM 内联样式，**不注入 `<style>`**，不受宿主 CSP `style-src` 影响；`pointer-events` 与透明穿透不变），宿主自己的文字照常可选。`/embed` 内部的 `html/body/canvas` 同样 `user-select:none` + `-webkit-tap-highlight-color: transparent`。真实 Chrome 实测（拖选划过 / Cmd·Ctrl+A / 双击 / 三击 / 从 iframe 内部开始拖选，light 与 transparent 场景）：撤掉保护时 iframe 被染蓝约 93% 像素，有保护时为 0（e2e「宿主页文字选区不染蓝 iframe」）。**别在宿主 CSS 里把 `iframe` / `::part(iframe)` 的 `user-select` 改回 `auto`**，否则会复现。

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
| **iframe 偏好存储被分区 / 拦截** | iframe 用自己的 localStorage 记住服装 / 场景（`xiaochun_wearing_outfit` / `xiaochun_scene_theme`）。第三方上下文里它按"顶层站点 + iframe origin"分区：每个宿主站各一份、互不相通；被拦截 / 隐私模式时读写抛错，已 try/catch 静默回退到默认（只是不记忆，不影响功能）。坏 id 忽略并清掉。副作用：宿主没传 `scene` 时，用户上次选的**透明**场景会在下次打开时生效（SDK 通过初始 `scene-changed` 同步外壳背景 / 穿透）；要固定外观就显式传 `outfit` / `scene`（显式优先）。 |
| **滚轮缩放默认开启（`controls` 默认值变化）** | 此前 `/embed` 默认锁定滚轮缩放（只有 `controls=1` 放开）；现在**所有场景默认放开**，与主站一致，`controls=0` 才锁定，`controls=1` 与缺省等价（SDK `controls` 选项默认 `true`，`false` → `?controls=0`）。副作用：**不透明场景 iframe 铺满时，该区域内的滚轮 = 缩放，会吞掉该区域的页面滚动**（本批只实测了鼠标滚轮；触屏手势未针对此项测试）；透明场景只有指针落在角色上才缩放，空白处仍滚动宿主页。要保持旧行为请传 `controls: false` / `?controls=0`。另外引擎会把用户缩放后的相机距离存进 iframe 自己的 localStorage（主站既有行为，下次打开沿用）；跨站分区存储下只影响该宿主站。 |
| **内置按钮（`ui`）的取舍** | 默认（`uiAutoHide:'transparent'`）下透明场景的按钮 / 聊天栏要"单击角色才出现"，且透明场景下点宿主页空白到不了 iframe（穿透），收起靠 10 秒超时或再点角色；要稳定可见就 `uiAutoHide:false`。按钮占用 iframe 右上角一小块；`ui` 含 `outfit`/`scene` 时多加载一个约 3KB 的懒加载块。透明场景 + 触屏需要"先轻触唤醒、再点按钮"。按钮列表来自 `capabilities`。 |
| **手势：浏览器缩放 / 屏幕坐标** | 手势增量取 `screenX/Y`（iframe 自己被移动时 client 坐标会漂）。页面缩放 ≠ 100% 时屏幕坐标与 CSS px 有比例差，拖动手感会略偏（SDK 已限幅，不会越界）；跨进程 iframe 在快速移动时 `screenX` 会滞后一帧，停手后误差消失。 |
| **手势：触屏** | 触屏拖动 / 角落缩放走同一套状态机（480ms 长按武装、多点取消），但只有真机才能验证与双指缩放 / 页面滚动的相互作用；自动化只覆盖鼠标。 |
| **手势：内联模式的布局** | `inline` 下缩放会改变盒子在文档流里的大小（后面的内容会跟着挪）；移动用 `translate`，不改布局流。位置 / 尺寸默认不持久化，刷新恢复初始值；要记住用 `persistBox`（见 §2.8）。 |
| **`alert()`** | 引擎在 VRM 加载失败时会 `alert()`（既有行为），在 iframe 里体验较差；后续可改为发 `xc.error`。 |
| **`xc.lookAt` 未实现** | 见 §2.1 TODO。 |
| **`base`（裸模）不再可选** | 旧版 `/embed` 的 `xc.setModel({ outfit:'base' })` 能换成裸模；现在 `base` 返回 `unknown_id`（裸模不对外开放）。宿主页的服装下拉里如果有 `base` 选项请去掉，改用 `getOutfits()` 生成列表。未知服装的错误码也从 `bad_request` 变为 `unknown_id`。 |
| **换装是后台加载** | 一次换装约 0.9s（本机实测，含解压合成）；婚纱 13.9MB，慢网络下明显更久。连点会得到 `busy`（见 §2.6）。预取只省下载，不省解压合成。 |
| **启用预取的流量** | 默认关。全量预取（8 套，不含婚纱）约 30MB（婚纱单独 13.9MB），且按"顶层站点 + iframe origin"分区，每个宿主站各存一份；`prefetch` 只建议在 Wi-Fi / `heavy:'eager'` 场景打开，已跳过省流量模式。 |
| **主站 SSR 也发 `X-Frame-Options: DENY`** | 以前只有 `_headers`（静态资源）带；现在 Worker 对 SSR 响应也发，与 dev/preview 对齐。若有人依赖 iframe 主站 SSR 页，会被拒绝（符合"主站保持 DENY"的意图）。 |
