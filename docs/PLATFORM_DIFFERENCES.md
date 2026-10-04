# 三个入口的差异：Tauri 桌宠 / Web 主站 / `/embed` iframe

> 本文是**成品对照表**，回答“同一个小蠢，在 Tauri 桌面端、Web 主站、`/embed` iframe 里到底哪里不一样、为什么不一样、代码在哪”。
> 每一行都标了 **代码位置** 和 **共享 / 独有**；没能从代码里确认的写成 **待核实**，不要当结论引用。
> 逐项细节请跳转到各自专题文档（`INTERACTION_AND_CONTROLS.md`、`HYBRID_DESKTOP_APP.md`、`EMBED.md`、`INTERACTION_AND_3D_GUIDES.md`）。

## 0. 先读这一段：embed 本质上是 Tauri 交互层的 iframe 特化版

三个入口跑的是**同一个引擎**：`src/core/vrmEngine.ts`（渲染循环、模型加载、换装、相机、动作 / 表情 / 口型 / 视线、聊天流水线）和它周边的 `src/core/*`（手势状态机、3D 引导轨、场景、PostFX、材质……）。

- **Tauri 桌宠** 与 **Web 主站** 是**同一个 React 应用**（`src/App.tsx`，路由 `src/routes/index.tsx`），只靠 `isTauri()`（`src/lib/platform.ts`）在少数地方分支：无框透明窗口、原生拖窗 / 缩放、60Hz 像素级点击穿透、自动更新、`xiaochun://` 协议、关闭按钮。
- **`/embed`** 是**另一个更薄的入口**（`src/routes/embed.tsx` → `src/embed/EmbedApp.tsx`），复用同一份 `vrmEngine`、`SceneCanvas`、`HeadBubble`、`ChatBar`、`usePetUiVisibility`、`src/core/gesture/*`、`src/core/interaction/*` 的手势 / 引导样式，**把 Tauri 里“由原生壳完成的事”改成“通过 postMessage 交给宿主页完成”**：
  - 拖动窗口：Tauri 调 `startDragging()`；embed 发 `xc.gesture-move`，由宿主 SDK 移动 iframe。
  - 缩放窗口：Tauri 调 `startResizeDragging()`；embed 发 `xc.gesture-resize`，由宿主 SDK 缩放 iframe。
  - 点击穿透：Tauri 把像素 alpha 交给 Rust `set_ignore_cursor_events`；embed 发 `xc.hit-region`，由宿主 SDK 切 iframe 的 `pointer-events`。
  - 更新 / 关闭 / 深链：embed 里**没有**（iframe 不是应用）。
  - 加载遮罩：embed 不画，进度走 `xc.load.progress`，由宿主画占位图。

所以：**手势 / 引导 / 点击出现的“识别逻辑”共享**，**“落地动作”按平台实现**；embed 比 Tauri 多出的东西（宿主协议、`uiAutoHide`、`camera`、`persistBox`、选区修复）都是 iframe 这个形态逼出来的，不是另起炉灶。

图例：**共享** = 同一份代码；**独有(T)** = 只有 Tauri；**独有(W)** = 只有 Web 主站；**独有(E)** = 只有 embed。

---

## 1. 定位与运行环境

| 维度 | Tauri 桌宠 | Web 主站 | `/embed` iframe | 代码位置 / 标注 |
| :-- | :-- | :-- | :-- | :-- |
| 形态 | 原生壳（Tauri 2.x）里加载同一份前端；也有移动端壳（`platform.ts` 注释提到 iOS / Android；**移动壳的实际发布状态待核实**） | 浏览器里的完整站点，Cloudflare Workers SSR | 被第三方页面 `<iframe>` 内嵌的精简入口，SSR 只出空壳 | `src-tauri/`、`src/routes/index.tsx`、`src/routes/embed.tsx`、`src/server.ts` |
| 入口组件 | `App` | `App` | `EmbedApp` | `src/App.tsx`、`src/embed/EmbedApp.tsx`；Tauri 与主站**共享**，embed **独有(E)** |
| 环境探测 | `isTauri()`（`__TAURI_INTERNALS__`） | 都不是 | `isEmbed()`（pathname 以 `/embed` 开头），与 Tauri 互斥 | `src/lib/platform.ts` |
| 主站落地页特性（SEO、sitemap、`llms.txt`） | 无意义 | 有 | `noindex, nofollow` | `src/routes/__root.tsx`、`public/robots.txt`、`public/sitemap.xml`、`public/llms*.txt`、`src/routes/embed.tsx`（**独有(W)** / **独有(E)**） |
| 对外控制接口 | `xiaochun://` 协议（deep-link / single-instance） | 无（调试桥除外） | `xc.*` postMessage 协议；**主动不响应** `xiaochun://` | `src/core/protocol/index.ts`（`isEmbed()` 直接 return）、`docs/PROTOCOL.md`、`docs/EMBED.md` |
| 调试面板（DevDrawer / vConsole） | 生产包默认不露；10 次菜单连击解锁 | 同 Tauri；开发环境（Vite DEV / 本机回环）直接可见 | **没有 DevDrawer**（相机 / 色彩等调参不开放；embed 只开放 `camera` 四项，见 §5） | `src/App.tsx`（`isDev()`、`hasDevEasterEgg`）、`src/lib/utils.ts#isDev`、`src/components/ChatBar.tsx`（连击）；embed 不挂 `DevDrawer` |

## 2. 窗口 / 容器、背景、圆角

| 维度 | Tauri 桌宠 | Web 主站 | `/embed` iframe | 代码位置 / 标注 |
| :-- | :-- | :-- | :-- | :-- |
| 容器 | 无边框、透明、置顶、`shadow:false` 的原生窗口 | 整个浏览器视口（`#app` 100dvh） | 宿主给的 iframe 盒子（SDK 外壳 `div` + iframe） | `src-tauri/tauri.conf.json`（`decorations:false`、`transparent:true`、`alwaysOnTop:true`）、`src/App.tsx`、`packages/project-xiaochun/src/client.ts` |
| 默认尺寸 | 窗口 560×820，最小 320×468；窗口位置 / 大小由 window-state 插件记忆（只存 POSITION \| SIZE） | 视口 | SDK 默认 **600×1080**（`min(600px,100vw)` × `min(1080px,100svh)`，受视口钳制）；resizable 默认最小 120×180、最大=视口 | `tauri.conf.json`、`src-tauri/src/lib.rs`（`tauri_plugin_window_state`）、`client.ts`（`XC_DEFAULT_WIDTH/HEIGHT`）。**不一致**：embed 默认比 Tauri 窗口大且最小尺寸更小 |
| 位置 / 尺寸持久化 | Tauri window-state（原生，自动） | 无（视口） | 默认不记；宿主开 `persistBox` 才写**宿主页** localStorage（`xiaochun:box[:<ns>]`） | `client.ts`（`persistBox`）、`docs/EMBED.md` §2.8。**独有(E)** |
| 圆角 | `html.is-tauri` 下 `#root` / `#app` / 遮罩 `border-radius: var(--xc-window-radius)`（20px） | 无圆角 | 非透明场景外壳默认 20px（与 Tauri 同值，有单测核对），透明场景 0；可用 `borderRadius` / `--xc-radius` 覆盖 | `src/styles/main.css`（`--xc-window-radius`）、`packages/project-xiaochun/src/protocol.ts#XC_WINDOW_CORNER_RADIUS`、`src/embed/__tests__/windowRadius.test.mjs`。**共享数值** |
| 背景 / 场景 | `light` / `dark` / `transparent` / `beach` 四种 | `light` / `dark` / `beach`；透明场景被限制（菜单过滤、恢复时回落） | 四种都可；URL `scene`/`transparent`/`theme` 优先于 iframe 自己存的偏好；显式指定后不再跟随系统亮暗 | `src/config.ts#scenes`、`src/core/scene/sceneManager.ts`（`isTransparentSceneAllowed = isTauri() \|\| isEmbed()`）、`src/components/TopHeader.tsx`（`filter(!isTransparent \|\| isTauri())`）、`src/lib/utils.ts#resolveInitialSceneTheme`、`beach` 见 `docs/BEACH_SCENE.md`（不透明场景，三个入口共用同一份代码） |
| 透明场景下的点击穿透 | 前端按约 60Hz 取像素，经 Tauri 命令交给 Rust 侧：canvas 像素 alpha + DOM 守护区 → `set_ignore_cursor_events`；引导轨显示时 `setInteracting(true)` | 不适用 | `vrmEngine.hitTest` 读指针处 1 像素 alpha（`HitGate` 节流 / 迟滞）→ `xc.hit-region` → 宿主 SDK 切 `pointer-events`；内置按钮 / 菜单 / 开了 resizable 时的四角热区也算命中 | Tauri：`src/core/scene/passthroughManager.ts`、`src-tauri/src/lib.rs`；embed：`src/embed/bridge.ts`（`HitGate`）、`src/core/gesture/hitGate.ts`。**识别节奏各自实现**，命中规则相同方向（角色 / UI = 接管，空白 = 穿透） |
| 透明场景点“空白” | 点到桌面（原生穿透），不影响桌宠 | 不适用 | 点到宿主页，**到不了 iframe**，所以那里无法“点空白收起”界面，只能靠 10 秒超时或再点角色 | `docs/EMBED.md` §7。**与 Tauri 不一致（形态限制）** |
| 选中蓝框 | 无此问题（原生窗口） | 页面内选区正常 | 宿主页 Cmd+A / 拖选 / 双击三击会把整个 iframe 盖蓝：SDK 给外壳、占位图、iframe 设 `user-select:none`（CSSOM 内联，不注入 `<style>`，不动 `pointer-events`） | `packages/project-xiaochun/src/client.ts#noSelect`、`src/styles/main.css`（`canvas{user-select:none}`）。**独有(E)** |

## 3. 指针与手势

识别逻辑集中在 `src/core/gesture/`（`gestureMachine.ts`、`resizeGesture.ts`、`corners.ts`、`hitGate.ts`）和 `src/core/interaction/interactionController.ts`，三个入口**共享**；差别只在“超过阈值后怎么落地”。

| 维度 | Tauri 桌宠 | Web 主站 | `/embed` iframe | 代码位置 / 标注 |
| :-- | :-- | :-- | :-- | :-- |
| 左键短拖（超过 10px，在长按武装前） | `moveStrategy='native'` → 原生 `startDragging()` 拖窗 | `'none'`：只取消长按，滑动还给页面 | 宿主开了 `draggable` 才 `'delta'`：发 `xc.gesture-move`，宿主移动 iframe；没开 = `'none'`，不拦截任何指针事件 | `interactionController.ts`（`moveStrategy`）、`src/core/gesture/adapters/tauriWindow.ts`、`src/embed/gestures.ts`。**共享状态机 / 独有落地** |
| 长按进入 3D 调整（`bodyTurn` + 相机俯仰 + 相机高度轨） | 480ms（`INTERACTION_TOUCH_ARM_MS`），期间位移 >10px 取消 | 同 | 同（松手也会 toggle 内置界面，与 Tauri 同一怪癖） | `src/lib/constants.ts`（`INTERACTION_TOUCH_ARM_MS=480`、`INTERACTION_TOUCH_ARM_SLOP_PX=10`、`INTERACTION_GUIDE_AUTO_HIDE_MS=2800`）。**共享** |
| 平台主修饰键（Mac ⌘ / 其它 Ctrl）按住拖 | 立即进入 3D 调整 | 同 | 同 | `platform.ts#hasInteractionModifier`。**共享** |
| **相机运动方式** | 相机**只有上下俯仰绕角色转**（`OrbitControls.enableRotate=false`，竖向拖动走 `_rotateUp`）；**左右拖动是角色自己的 `bodyTurn`（转身），不是相机绕角色**；相机方位角固定正前方 | 同 | 同 | `src/core/vrmEngine.ts`（`enableRotate = false`、`computeCameraPositionFromPitch` 方位角锁 0）、`interactionController.ts`（`'turn'`：`targetYawOffset += dx·characterTurnSensitivityX`，`_rotateUp(dy·pitchSensitivityY)`）。**共享**；因此 embed 的 `camera` 选项也**没有 pitch / 方位角** |
| 滚轮 / 捏合缩放 | 开；透明场景只有指针落在角色像素上才缩放，空白处滚轮落到桌面 | 开 | 默认开（与主站一致）；`controls=0` 锁定；透明场景同样“只在角色上缩放”，不透明场景整个 iframe 区域滚轮=缩放（会吞掉该区域的页面滚动） | `vrmEngine.ts`（`lockWheelZoom`、`mouseButtons.MIDDLE=DOLLY`）、`src/embed/EmbedApp.tsx`、`docs/EMBED.md` 参数表。距离上下限 1–15m 共享 |
| 缩放窗口 / 容器 | 四角圆弧把手（SVG，40px 热区）→ 原生 `startResizeDragging()`；仅桌面端（`isDesktop()`）；配置里非透明场景 `tauri.resizable:true / cornerHandles:false`，透明场景 `resizable:false / cornerHandles:true`（即透明场景靠角落把手缩放；**非透明场景下窗口边缘缩放的具体实现待核实**） | 无 | 宿主开 `resizable` 才有：同一个 40px 热区 / 光标 / 弧线外观（`EmbedCorners`）→ `xc.gesture-resize`，宿主缩放 iframe，夹在最小 / 视口内 | `src/components/TauriWindowFrame.tsx`、`src/embed/EmbedCorners.tsx`、`src/core/gesture/corners.ts#CORNER_HIT_SIZE`、`src/embed/gestures.ts`、`src/config.ts#scenes.items.*.tauri`。**共享热区 / 外观，独有落地** |
| 点击角色出现 / 收起界面 | 仅**透明场景**：单击角色 toggle，单击空白收起，10s 无操作收起；亮 / 暗场景常显 | 同上（透明场景在主站被限制，实际常显） | 由 `uiAutoHide` 决定：默认 `'transparent'`（= Tauri 行为）；`true` 所有场景；`false` 常显。单击判定同一个 `ClickDetector`（位移 ≤ 6px，拖动 / 多指 / 取消不算） | `src/hooks/usePetUiVisibility.ts`、`src/core/ui/clickDetector.ts`、`src/App.tsx`（`usePetUiVisibility(isTransparent)`）、`src/embed/EmbedApp.tsx`。**共享 hook**；亮 / 暗场景 `uiAutoHide:true` 是 **embed 扩展**。ClickDetector 用“全程最大位移”判定，比 Tauri 原写法略严（见 §10） |
| 拖入 `.vrm` 文件换模型 | 有 | 有 | 无（iframe 不接管宿主页的拖放） | `src/App.tsx`（`dragover`/`drop`）。**独有(T/W)** |

## 4. 界面（UI）

| 维度 | Tauri 桌宠 | Web 主站 | `/embed` iframe | 代码位置 / 标注 |
| :-- | :-- | :-- | :-- | :-- |
| 顶栏 | `TopHeader`：场景、换装、语言、GitHub、（dev）面板开关；Tauri 另有 `⋯`（检查更新 / dev 重载 / 关闭） | 同，没有 `⋯` | **没有 TopHeader**。由宿主用 `ui=[…]` 选择内置部件：`outfit`、`scene`、`lang`、`github`（外加 `chat`、`bubble`）；默认全空 | `src/components/TopHeader.tsx`、`src/components/TauriTopHeader.tsx`（独有(T)）、`src/embed/EmbedPicker.tsx`、`src/components/HeaderButtons.tsx`（`LangButton` / `GithubButton` **共享**） |
| 场景菜单里的“透明” | Tauri 才有 | 被过滤 | 有（菜单 = `APP_CONFIG.scenes.items`，与 `capabilities.scenes` 同源） | `TopHeader.tsx`、`EmbedPicker.tsx` |
| 聊天栏 / 设置对话框 | `ChatBar`（模型 / 提供方 / 高级设置 / 同步 / 设备状态 / STT / 10 次连击解锁 dev） | 同 | `ui` 含 `chat` 时挂**同一个 `ChatBar`**（因此菜单项同样存在；**embed 里这些设置弹窗的实际可用性与存储隔离待核实**）；主站挂载即后台预加载 WebLLM 库，embed 打开模型菜单时才加载 | `src/components/ChatBar.tsx`（`isEmbed()` 分支，~L191）。**共享组件** |
| 头顶气泡 | 有（`components.headBubble`） | 有 | `ui` 含 `bubble` 才挂 | `src/components/HeadBubble.tsx`、`EmbedApp.tsx` |
| 加载遮罩 / 身高尺 / 更新弹窗 / 拖放提示 | 有 | 有（无更新弹窗） | **都没有**（进度走 `xc.load.progress`，宿主画占位图） | `src/App.tsx`（`LoadingOverlay`、`#height-ruler-*`、`AppUpdateDialog`、`drop-zone`）、`src/components/AppUpdateDialog.tsx`（`isTauri()`） |
| 界面语言 | URL / cookie `lang` → 浏览器 | 同 | 优先级：URL `lang` / SDK `lang` > iframe 自己 localStorage `xiaochun_embed_lang`（语言按钮选的）> `navigator.languages` > `zh-CN`；**不读写主站语言 cookie**；变化发 `xc.lang-changed` | `src/i18n/index.ts`、`src/embed/registry.ts#resolveEmbedLang`、`src/lib/constants.ts#EMBED_LANG_KEY` |
| 外链（GitHub 等） | `plugin-opener` 调系统浏览器（WebView 的 `target=_blank` 无效） | `window.open` 新标签页 | 新标签页（`<a target=_blank>` / `openExternal`） | `src/lib/openExternal.ts`、`HeaderButtons.tsx` |

## 5. 相机

| 维度 | Tauri 桌宠 | Web 主站 | `/embed` iframe | 代码位置 / 标注 |
| :-- | :-- | :-- | :-- | :-- |
| 运动方式 | 只有**上下俯仰绕角色转**；**左右是角色 `bodyTurn`，不是相机绕角色**（见 §3） | 同 | 同 | `vrmEngine.ts`、`interactionController.ts`。**共享** |
| 默认取景 | `fov 30`、取景范围 `defaultShotExtent 1.34` → 视距 ≈ 2.50m；默认俯仰 ≈ 88.7° | 同 | 同 | `src/config.ts#camera`；统一函数 `getDefaultCameraDistance(fov)` + `resolveShot()`，初始机位 / `fitCamera` / 推镜头终点共用。**共享** |
| 推镜头（加载完成后） | 有，约 1.1s | 有 | 默认有；宿主 `camera.intro:false` 直接到终点 | `vrmEngine.ts#cinematicIntro` |
| 调参入口 | DevDrawer“镜头设置”（fov、距离上下限等），dev 才可见 | 同 | 宿主 `camera:{ fov, distance, height, intro }`：fov 15–60°、distance 1–15m、height ±1m；URL `cameraFov` 等；运行时 `xc.setConfig{camera}`（缺省键不变，`null` 恢复默认）；`capabilities.camera` 上报范围；**不开放 pitch** | `src/components/dev-drawer/sections/CameraSection.tsx`（独有 T/W）；`src/embed/params.ts`、`bridge.ts`、`packages/project-xiaochun/src/protocol.ts`（`XC_CAMERA_RANGES`，与 `APP_CONFIG.camera` 一致，单测 `src/embed/camera.test.ts`）、`docs/EMBED.md` §2.9。**独有(E)** |
| 持久化 | `xiaochun_camera_pitch`（俯仰 + 视距）、`xiaochun_camera_y_offset` 存各自 localStorage | 同 | iframe 自己的 localStorage（跨站时是**分区存储**）；优先级 宿主显式 > iframe 保存值 > 默认；宿主设了 `distance` 期间不写保存值；显式 `height` 不写 y-offset | `src/lib/constants.ts`、`vrmEngine.ts#saveCurrentCameraPitch`、`resolveShot` |

## 6. 持久化与存储

| 内容 | Tauri | Web 主站 | `/embed` | 代码位置 / 标注 |
| :-- | :-- | :-- | :-- | :-- |
| 穿着服装 `xiaochun_wearing_outfit` | webview localStorage | 站点 localStorage | iframe 源的 localStorage（跨站嵌入为**分区存储**）；URL `outfit` 优先；宿主 `persist` 选项可另存到**宿主页** `xiaochun:prefs` | `constants.ts#WEARING_OUTFIT_KEY`、`registry.ts`、`client.ts`（`persist`） |
| 场景 `xiaochun_scene_theme` | 同 | 同 | 同上；URL `scene`/`transparent`/`theme` 优先；`xc.setConfig` / `setScene` 的内部切换**不写** iframe 偏好（只记用户在内置按钮里选的） | `constants.ts#SCENE_THEME_KEY`、`sceneManager.ts`、`bridge.ts` |
| 语言 | cookie `lang`（主站） | cookie `lang` | `xiaochun_embed_lang`（不碰 cookie） | `src/i18n/index.ts`、`constants.ts#EMBED_LANG_KEY` |
| 相机 / 转身 | `xiaochun_camera_pitch`、`xiaochun_camera_y_offset`、`xiaochun_body_yaw` | 同 | 同（iframe 自己的存储） | `constants.ts` |
| 窗口 / 盒子位置大小 | window-state 插件 | — | 宿主页 `xiaochun:box[:<ns>]`（`persistBox`） | 见 §2 |
| 模型缓存 | IndexedDB 两级缓存（`xiaochun-vrm-cache`） | 同 | 同（iframe 源的 IDB；宿主可 `prefetch` 预取） | `src/lib/idb-vrm-cache.ts`、`docs/OUTFIT_SWAP.md`、`src/embed/prefetch.ts` |

> 注意：第三方站点嵌入 iframe 时，现代浏览器会对 iframe 的 localStorage / IDB 做**分区**（key = iframe 源 + 顶层站点），所以“同一个用户在 A 站选的语言 / 服装”不会出现在 B 站，也不会和直接访问主站共享。

## 7. 加载与缓存、重资源

| 维度 | Tauri | Web 主站 | `/embed` | 代码位置 / 标注 |
| :-- | :-- | :-- | :-- | :-- |
| 首屏 | 启动 `LoadingOverlay` + 推镜头 | SSR 先出 `LoadingOverlay`，再动态加载 `App` | SSR / mount 前什么都不画；宿主 SDK 画占位图（可 `lazy: 'idle'｜'click'`），进度走 `xc.load.progress` | `src/routes/index.tsx`、`src/routes/embed.tsx`、`client.ts` |
| WebLLM / EMAGE 预热 | 按 `heavyPreload` 策略 | 同 | `heavy=lazy`（默认，首次互动才加载）或 `eager`；宿主可 `xc.prefetch` 只下载不解压 | `src/lib/heavyPreload.ts`、`bridge.ts`（`heavy`） |
| HTTP 缓存头 | `/vrm/*` 1 小时 + must-revalidate，`/assets/*` immutable | 同 | 同 | `public/_headers`、`src/lib/securityHeaders.ts`（两处需一致） |
| API 基址 | `/api/*` 透明重定向到 `APP_CONFIG.api.baseUrl`（生产 Worker） | 同源 `/api/*` | iframe 源同源 `/api/*`（Edge-TTS 代理等） | `src/lib/api.ts` |

## 8. LLM / TTS / STT / EMAGE 能力

| 能力 | Tauri | Web 主站 | `/embed` | 代码位置 / 标注 |
| :-- | :-- | :-- | :-- | :-- |
| 对话（WebLLM / 提供方） | `vrmEngine.sendMessage` | 同 | `xc.say{mode:'chat'}` → 同一个 `sendMessage` | `vrmEngine.ts`、`bridge.ts`。**共享** |
| 只说话（不经 LLM） | 协议 `speak` | 同 | `xc.say{mode:'speak'}`（TTS + EMAGE） | `bridge.ts`、`docs/PROTOCOL.md` |
| 宿主给音频 | 协议 `audioUrl` | — | `xc.audio` / `xc.audio.chunk`（跳过 TTS，音频 → EMAGE → 动作 + 口型），格式 encoded / pcm16 / float32 | `src/director/hostAudio.ts`（路径以仓库为准）、`docs/EMBED.md` §2.4。**独有(E) + 协议** |
| STT（SenseVoice） | 有 | 有 | `xc.mic` 开关；宿主 iframe 需 `allow="microphone"` 委派 | `src/stt/`、`bridge.ts`、`securityHeaders.ts`（`Permissions-Policy`） |
| 多线程 wasm（跨源隔离） | 壳内 | COOP/COEP 保持隔离 | 默认**不**隔离；宿主可选 `crossOriginIsolated` 并给 iframe 委派 | `securityHeaders.ts`、`docs/EMBED.md` §3.1 |

## 9. 安全与跨源

| 维度 | Tauri | Web 主站 | `/embed` | 代码位置 / 标注 |
| :-- | :-- | :-- | :-- | :-- |
| 被嵌入 | 不适用 | `X-Frame-Options: DENY` | 去掉 XFO，改发 `Content-Security-Policy: frame-ancestors <白名单，默认 *>`（`EMBED_FRAME_ANCESTORS` 可收紧） | `src/lib/securityHeaders.ts`、`public/_headers`、`wrangler.jsonc` |
| 握手 | 不适用 | 不适用 | `xc.ready` → `xc.init` + `MessagePort`，严格 origin 校验（`host` 参数 / `allow` / `ancestorOrigins`），之后只走端口；**缺 host fail closed** | `src/embed/bridge.ts`、`src/embed/params.ts`、`docs/EMBED.md` §2.3 |
| Tauri CSP | `csp: null`（`tauri.conf.json`） | 见响应头 | 见上 | `src-tauri/tauri.conf.json` |
| 自定义模型 | 拖入 `.vrm` | 同 | 默认只能用内置服装；`allowCustomModel` 打开才允许 https 模型 URL | `bridge.ts`（`allowCustomModel`） |

## 10. 宿主 SDK、构建、发布、测试

| 维度 | Tauri | Web 主站 | `/embed` + npm 包 | 代码位置 / 标注 |
| :-- | :-- | :-- | :-- | :-- |
| 构建 | `pnpm tauri:build`（`frontendDist: ../dist/client`） | `pnpm build` → `wrangler deploy` | 同一次 `pnpm build` 产出 `/embed` 页；npm 包 `@firetable/project-xiaochun` 在 `packages/project-xiaochun`（`build:packages` 先于 vite build） | `package.json`、`vite.config.ts`、`wrangler.jsonc` |
| 版本 / 发布 | 一个 `v*` tag 触发 `release-tauri.yml` 与 `publish-npm.yml`，版本由 `pnpm bump:*` 同步四处 | 同一版本部署 Worker | npm 包版本与桌面端锁定 | `.github/workflows/`、`scripts/bump-version.mjs`、`docs/EMBED.md` §6 |
| 协议常量 | — | — | 单一来源 `packages/project-xiaochun/src/protocol.ts`，主仓库经 alias 源码直引（vite 与 vitest 各配一份 alias） | `vite.config.ts`、`vitest.config.ts`、`tsconfig.json` |
| 测试 | `pnpm test`（vitest：手势 / 引导 / 点击 / 相机范围等纯逻辑） | 同 | `pnpm test:embed`（node:test）、`packages/project-xiaochun` 的 `pnpm test`（构建产物）、`test/browser/outfit-harness.mjs`（桩 iframe）、`test/browser/embed-e2e.mjs`（真实 Chrome + 真实 `/embed` + 真实鼠标 / 截图） | `package.json`、`packages/project-xiaochun/package.json` |

---

## 11. 与 Tauri 不一致的点（已知）

1. **透明场景点宿主页空白到不了 iframe**：Tauri 里点空白会“收起界面”，embed 里只能靠 10 秒超时或再点角色（形态限制，见 `EMBED.md` §7）。
2. **窗口移动**：Tauri 是原生 `startDragging()`；embed 是 delta 增量，由宿主 SDK 移动并夹在视口内。
3. **长按松手也会 toggle 内置界面**：embed 与 Tauri 同一个怪癖（沿用同一 `usePetUiVisibility`），不是 embed 独有的 bug。
4. **`ClickDetector` 用“全程最大位移”判定单击**：比 Tauri 原写法（按下 / 抬起两点距离）略严，抖动较大的单击在 embed 里不算点击。
5. **亮 / 暗场景的 `uiAutoHide:true`** 是 embed 扩展；Tauri 没有这个模式。
6. **默认尺寸**：SDK 600×1080 vs Tauri 窗口 560×820（最小 320×468）；embed 的 resizable 默认最小 120×180。
7. **无 DevDrawer / 加载遮罩 / 更新弹窗 / 拖放换模型 / 关闭按钮 / `xiaochun://`**：这些依赖原生壳或整页，embed 刻意不做。
8. **存储是分区的**：embed 的语言 / 服装 / 相机偏好不与主站、其它宿主站共享。

## 12. 维护规则（改一处要同步哪里）

- **手势 / 点击 / 引导的识别逻辑**（`src/core/gesture/*`、`interactionController.ts`、`usePetUiVisibility`、`clickDetector`）：三个入口共享，改完必须同时看 Tauri 适配器（`adapters/tauriWindow.ts`、`TauriWindowFrame`）和 embed 适配器（`src/embed/gestures.ts`）；跑 `pnpm test` 与 embed e2e 的手势用例；更新本文 §3 和 `INTERACTION_AND_CONTROLS.md` / `INTERACTION_AND_3D_GUIDES.md`。
- **相机**（`vrmEngine.ts` 的 `getDefaultCameraDistance` / `resolveShot` / `fitCamera` / `cinematicIntro`、`APP_CONFIG.camera`）：同步 `XC_CAMERA_RANGES`（`protocol.ts`）和 `src/embed/camera.test.ts`；更新本文 §5 与 `EMBED.md` §2.9。相机只做上下俯仰这一约定不要被改成方位角旋转，否则要同时改 `bodyTurn` 文档。
- **窗口圆角**：只改 `main.css#--xc-window-radius` 与 `protocol.ts#XC_WINDOW_CORNER_RADIUS` 两处同值（单测 `windowRadius.test.mjs` 守着）。
- **新增 / 修改 embed 选项或 `xc.*` 命令**：改 `protocol.ts`（单一来源）→ `src/embed/params.ts` / `bridge.ts`（URL 参数、`applyConfig`、`capabilities`）→ SDK `client.ts` / `avatar-element.ts` / `react.ts` → `docs/EMBED.md`（参数表、命令表、选项说明）→ 两份 `packages/project-xiaochun/README*.md` → `examples/embed-host.html` → 单测 + harness + e2e；本文对应行同步。
- **安全头**：`securityHeaders.ts` 与 `public/_headers` 必须一致，并同步 `EMBED.md` §3 和本文 §9。
- **持久化键**：新增 / 改名 localStorage 键写进 `src/lib/constants.ts`，并更新本文 §6。
- **场景 / 透明规则**（`sceneManager.ts`、`APP_CONFIG.scenes`）：同步 `TopHeader`、`EmbedPicker`、`passthroughManager`（Tauri）和 `bridge.ts` 的命中逻辑（embed），更新本文 §2。
- **Tauri 窗口配置**（`tauri.conf.json`、`src-tauri/src/lib.rs`）：尺寸 / 最小尺寸变化时更新本文 §2 的默认尺寸对比和 SDK 默认值的取舍。
- 本文只记**差异与位置**，不重复各专题文档的细节；写“待核实”的行在确认后改成结论并标注代码位置。
