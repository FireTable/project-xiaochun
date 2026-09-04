<p align="center">
  <img src="public/logo.png" width="96" height="96" alt="Project XiaoChun Logo" style="border-radius: 16px;" />
</p>

<h1 align="center">Project XiaoChun</h1>

<p align="center">
  <b>100% 浏览器原生二次元陪伴角色 — 本地 LLM + EMAGE 动作 + Edge-TTS,零后端</b>
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README-CN.md">简体中文</a>
</p>

---

> [!IMPORTANT]
> **声明**:本项目是一个**浏览器原生 AI 陪伴角色研究实验**。旨在验证 100% 客户端 AI 推理栈 (WebLLM / WebGPU / ONNX Runtime Web) 与 Cloudflare Workers 边缘 TTS 的可行性,**不建议直接用于商业化生产部署**。

---

## 📖 项目简介 (Overview)

**Project XiaoChun (小蠢)** 是一个完全运行在浏览器里的二次元陪伴角色。角色用 `@pixiv/three-vrm` 渲染,采用 MToon NPR 着色,坐在沉浸式线稿户外场景中;**所有 AI 推理都在你当前的浏览器标签页里跑** —— 没有 Python 后端,没有服务器 GPU。

进场是 2D MAD 预载再到 3D。你跟她说话。她思考(WebLLM Qwen3.5 2B q4f16_1,失败降到 0.8B;思考模式可关)、她开口说话(Edge-TTS 走 Cloudflare Workers WebSocket)、她全身动作实时跟上(EMAGE ONNX 在 Dedicated Web Worker 里)。模型没就绪时输入会排队,不会丢字。对话条菜单可从 WebLLM 预置表换模型。

UI 走 **TanStack Start SSR + i18next** 水合,**完整支持简体中文 / English / 日本語 三语切换**,并且按 iOS HIG 44 pt / Material 48 dp 触屏规范做了移动端优先适配。

---

## 🖼️ 项目预览 (Preview)

<p align="center">
  <img src="screenshots/preview-mad.jpg" width="100%" alt="小蠢 MAD 动态预载画面" /><br/>
  <i>进场预载：2D MAD 卡面，加载完成后破次元进入 3D</i>
</p>

<p align="center">
  <img src="screenshots/preview-3d.jpg" width="100%" alt="小蠢在线稿户外场景中对话" /><br/>
  <i>3D 舞台：MToon NPR 角色、线稿场景、头顶气泡与底部对话条</i>
</p>

---

## ✨ 核心特性 (Key Features)

### 🎭 VRM 角色与场景 (VRM & Scene)
* **VRM 1.0 渲染**:基于 `@pixiv/three-vrm` 与 MToon NPR 着色,日系柔和打光,**6 组独立光照通道**(主日光 / 半球天光 / 面部射灯 / 背后轮廓 / 腿部柔光 / 双臂专属),可在调试面板实时调参。
* **线稿户外场景**:程序化生成的太阳、19 栋线稿建筑(5 种原型)、5 棵风格化树(松塔/扇形/层叠/柏树/竖椭圆)、线稿地面 —— **纯白底白线,零贴图**。
* **陪伴式凝视系统**:水平头部微动 + 微扫视 + 加性 look-at 追踪,俯仰随镜头走。
* **动作衔接**:待机 / 思考 VRMA / EMAGE 之间从当前骨骼姿态 slerp 进去,循环动作不自动淡出,避免闪 T-Pose。
* **材质饱和度**:衣服 / 头发 / 眼睛 / 皮肤分通道可调,预设写在 `src/config.ts`。
* **运行时上传 VRM**:右上角上传按钮,支持任意 VRM 1.0 角色替换。

### 🧠 100% 浏览器端 AI 推理栈 (Browser-Side AI)
* **大语言模型** — [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm) 默认 **Qwen3.5 2B (q4f16_1)**,失败降到 0.8B。对话条菜单从 `prebuiltAppConfig` 按 provider 换模型,思考模式是开关;回复跟用户这条消息的语言走。
* **动作生成** — **EMAGE** 全身动作(ONNX Runtime Web)在 Dedicated Web Worker 中跑,时序高斯平滑 + 自然待机融合。
* **语音合成** — **Edge-TTS 晓伊 (XiaoyiNeural, zh-CN, +10 Hz)**,基于 [`edge-tts-universal`](https://github.com/Sterznode/edge-tts-universal);传输前剥离 emoji。
* **LLM + TTS + EMAGE 一体编排**:chat director 串起说话链路,主线程 60 FPS。

### 🌐 国际化与 SSR 水合 (i18n & SSR)
* **TanStack Start** 全栈 SSR,基于 Cookie 的语言水合 —— **客户端首屏不闪语言**。
* **三语齐备**:简体中文 / English / 日本語。
* **系统提示词**:小蠢是陪伴角色,用用户这条消息的语言回答,不跟 UI 语言走。
* **shadcn 风格下拉菜单**(Radix UI 原语)右上角切换语言。

### 📱 移动端优先 UI (Mobile-First)
* **iOS HIG 44 pt / Material 48 dp** 触屏规范贯穿全局。
* **底部对话输入框 ≥ 40 px**,字号 16 px(防止 iOS Safari 聚焦自动缩放)。
* **Tailwind CSS + tailwindcss-animate** 微交互 + 液态玻璃视觉。
* **顶部操作条**:上传 VRM / 语言切换 / GitHub;调试面板只在 localhost 出现。
* **对话条**:输入可排队、菜单换模型/思考模式、发送。
* **头顶跟随气泡**:直接改 DOM `transform`,带死区,不跟 60 FPS 一起刷 React。
* **移动端**:预载贴纸保留,ChatBar 避开底部安全区。

### 🛠️ 开发工具链 (Dev Tooling)
* **调试抽屉**(仅本地):表情切换 / 6 路灯光 / FOV / 全局亮度 / 材质饱和度预设。
* **Cloudflare Workers**(`src/server.ts`):生产环境统一承载 TanStack Start SSR 与原生 WebSocket Edge-TTS 流式代理。
* **Vite dev 中间件**(`vite.config.ts → localApiPlugin`):本地开发使用 Miniflare 虚拟运行时，与线上环境 100% 同构。
* **单一可信源**:`src/config.ts` 集中管理光照 / 相机 / 表情 / 饱和度 / LLM / R2 模型参数。

---

## 🛠️ 技术栈 (Tech Stack)

| 架构层 | 技术方案 | 说明 |
| :--- | :--- | :--- |
| **3D 引擎** | [three.js 0.185](https://threejs.org) + [@pixiv/three-vrm 3.5](https://github.com/pixiv/three-vrm) | MToon NPR 着色、OrbitControls |
| **应用框架** | [React 19](https://react.dev) + [TanStack Start](https://tanstack.com/start) | 全栈 SSR + Cookie 水合 i18n |
| **路由** | [TanStack Router](https://tanstack.com/router) | 类型安全文件路由 |
| **大语言模型** | [WebLLM](https://github.com/mlc-ai/web-llm) | Qwen3.5 2B q4f16_1 WebGPU 流式推理(失败降到 0.8B) |
| **动作生成** | EMAGE + [ONNX Runtime Web](https://onnxruntime.ai) | Dedicated Web Worker 全身动作生成 |
| **语音合成** | [edge-tts-universal](https://github.com/Sterznode/edge-tts-universal) | 晓伊 zh-CN +10 Hz,emoji 剥离 |
| **边缘运行时** | [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [@cloudflare/vite-plugin](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/) | SSR 渲染 + WebSocket TTS + 静态资产直连 |
| **对象存储** | [Cloudflare R2](https://developers.cloudflare.com/r2/) | 托管 504 MB ONNX 全身模型，免出站流量费 |
| **样式** | [Tailwind CSS 4](https://tailwindcss.com) + `tailwindcss-animate` | 液态玻璃视觉,移动端优先 |
| **国际化** | [i18next](https://www.i18next.com) + [react-i18next](https://react.i18next.com) | 三语,SSR 水合 |
| **UI 原语** | [Radix UI](https://www.radix-ui.com) (DropdownMenu, Slot) | shadcn 风格组件 |
| **语言** | [TypeScript 6](https://www.typescriptlang.org) | 端到端严格类型 |
| **构建** | [Vite 8](https://vite.dev) + `@cloudflare/vite-plugin` | 自动剔除超大静态资产，生产极致瘦身 |

---

## 🚀 快速开始与部署指南 (Quick Start & Deployment)

环境要求:**Node.js 18+**,包管理器 **pnpm**(`preinstall` hook 强制)。

### 本地开发 (Local Development)

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发服务器 (SSR + Miniflare 本地边缘运行时)
pnpm dev          # → http://localhost:5185

# 3. 生产打包并预览
pnpm build        # 构建输出 dist/client 与 dist/server (Worker)
pnpm preview      # 预览生产 Worker 行为
```

---

### ☁️ Cloudflare Workers 部署 (Cloudflare Deployment)

本项目全面采用 **Cloudflare 现代 Workers + Static Assets 架构**（而非旧版 Pages），兼顾全栈 SSR 极速注水与原生 WebSocket 流式 TTS。

#### 方式 A：本地终端一键发布（推荐 · 秒级上线）
```bash
# 一键完成生产构建并直接推送至 Cloudflare 边缘网络
pnpm deploy
# 等价于: pnpm build && wrangler deploy
```
*首次发布若未登录，将自动调起浏览器完成 OAuth 授权。发布成功后，在 Cloudflare 控制台将自定义域名（如 `xiaochun.firetable.tech`）绑定至该 Worker 即可。*

#### 方式 B：GitHub 自动 CI 部署（Workers Builds）
如需通过 `git push` 自动触发云端构建发布：
1. 登录 Cloudflare 控制台 -> 进入 **Workers & Pages** -> **Create Application** -> 切换到 **Workers** 标签；
2. 选择 **Connect to Git** 关联此 GitHub 仓库；
3. **构建设置（⚠️ 关键注意事项）**：
   * **根目录 (Root directory)**：**必须留空（Blank）！切勿填写 `/`**，填 `/` 会导致容器将路径误认为 Linux 系统根目录而挂起；
   * **构建命令 (Build command)**：`pnpm build`
   * **部署命令 (Deploy command)**：`npx wrangler deploy`
4. 关联成功后，后续任意 Git 提交推送到 `main` 分支均会自动构建上线。

---

## 📁 项目结构 (Project Structure)

```text
Project-XiaoChun/
├── public/                    # 静态资产目录 (通过 Cloudflare Workers Assets 托管)
│   ├── xiaochun_v1.vrm        # 默认 VRM 角色模型 (18 MB)
│   ├── thinking.vrma          # 待机思考动作循环
│   ├── _headers               # 静态资源强缓存与安全响应头
│   ├── robots.txt / sitemap.* # SEO 搜索引擎爬虫协议
│   ├── llms.txt / llms-full.* # AI 代理文档协议
│   └── logo.png / favicon.*   # 品牌与图标资产
├── wrangler.jsonc             # Cloudflare Workers 声明式配置文件
├── src/
│   ├── routes/                # TanStack Start 文件路由
│   │   ├── __root.tsx         # 根布局 (i18n SSR 水合与元信息)
│   │   └── index.tsx          # 首页主路由
│   ├── components/            # React UI 组件 (TopHeader, ChatBar, HeadBubble, DevDrawer…)
│   │   └── ui/                # Radix UI 原语封装 (button, dropdown-menu, tooltip)
│   ├── core/
│   │   └── vrmEngine.ts       # 3D 场景、线稿、6路灯光、材质饱和度、渲染循环
│   ├── motion/                # EMAGE Worker + VRMA 播放 / 骨骼渐入 / MotionTransition
│   ├── llm/                   # WebLLM WebGPU 流式推理 + Worker + 多语言系统提示词
│   ├── director/
│   │   └── chatDirector.ts    # LLM → TTS → EMAGE 流式状态编排管线
│   ├── i18n/                  # zh-CN / en / ja 翻译资源 + 服务端 Cookie 提取
│   ├── styles/
│   │   └── main.css           # Tailwind v4 @theme tokens + 液态玻璃样式
│   ├── App.tsx                # 应用主体与事件总线
│   ├── client.tsx             # 客户端 Hydration 注水入口
│   ├── server.ts              # Cloudflare Worker 统一入口 (SSR 流式渲染 + /api/tts WebSocket 直连)
│   ├── router.tsx             # TanStack Router 实例工厂
│   ├── routeTree.gen.ts       # 自动生成的类型安全路由树
│   └── config.ts              # 单一可信源 (R2 / 相机 / 灯光 / 饱和度 / LLM / 表情)
├── vite.config.ts             # Vite 8 + TanStack Start + @cloudflare/vite-plugin
└── tsconfig.json
```

---

## 🌐 国际化与 SSR 水合 (i18n & SSR Hydration)

语言通过 `lang` cookie 持久化,SSR 阶段由 `@tanstack/react-start/server` 的 `getCookie()` 解析 —— 用 `createServerOnlyFn` 包裹以保证不进客户端 bundle。客户端则从 `document.cookie` 读同一个 cookie,确保 SSR 渲染的 HTML 与客户端首次水合 **零 mismatch**。

切换语言时:
1. 更新 `lang` cookie。
2. 调用 `i18n.changeLanguage()`。
3. 所有 `t(...)` 消费者无刷新重渲染。

---

## 📄 许可证 (License)

本项目基于 **MIT 许可证** 开源。

> **第三方素材** (默认场景使用):
> * `public/xiaochun_v1.vrm` — VRM 角色模型,使用 **[VRoid Studio](https://vroid.com/en/studio)** (Pixiv Inc.) 生成。遵循 **VRoid Studio 许可证**:允许个人使用、修改及非商业再分发(需注明出处)。若需商业使用,请参阅 [VRoid Studio 许可证条款](https://vroid.com/en/license) 或联系 Pixiv Inc. 另行协商。
> * `public/thinking.vrma` — VRM 动作。**许可证不明**,分发前请自行确认。

`src/server.ts` 的 `/api/tts` 通过 [`edge-tts-universal`](https://github.com/Sterznode/edge-tts-universal) 公开协议调用 Microsoft Edge-TTS。`TRUSTED_CLIENT_TOKEN` 是公开的共享 token(所有开源 Edge-TTS 实现都用同一个值),**不是个人密钥**。

---

## 🙏 致谢 (Acknowledgements)

* [pixiv / three-vrm](https://github.com/pixiv/three-vrm) — VRM 运行时
* [Pixiv / VRoid Studio](https://vroid.com/en/studio) — 默认角色制作工具
* [MLC AI / WebLLM](https://github.com/mlc-ai/web-llm) — 浏览器内 LLM
* [Sterznode / edge-tts-universal](https://github.com/Sterznode/edge-tts-universal) — Edge-TTS 桥接
* [TanStack Start](https://tanstack.com/start) — 全栈 React 框架
* [Tailwind CSS](https://tailwindcss.com) — 原子化样式
* [Qiuner / Qiuner.github.io](https://github.com/Qiuner/Qiuner.github.io)(`src/worlds/linework/`)— 线稿户外场景视觉灵感来源
* [Animation Inc.](https://www.animation.inc) — 亲身体验过他们的 Ani-2 端侧实时全身动作产品后,萌生了"在浏览器里也能跑通"的想法;本项目自研的 EMAGE 管线,就是这次动手的尝试
* [PantoMatrix / EMAGE](https://github.com/PantoMatrix/PantoMatrix)([Yi 等人,CVPR 2024](https://pantomatrix.github.io/EMAGE/))— 驱动本项目对话时手势生成的 ONNX 全身协同动作模型
* [VolgaGerm / emage-onnx-export](https://github.com/VolgaGerm/emage-onnx-export)— PyTorch → ONNX 的导出脚本,以及我们浏览器里直接跑的那批预转换 `.onnx` 权重
