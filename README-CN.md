<p align="center">
  <img src="public/logo.png" width="96" height="96" alt="Project XiaoChun Logo" style="border-radius: 16px;" />
</p>

<h1 align="center">Project XiaoChun</h1>

<p align="center">
  <b>100% 浏览器原生二次元 VTuber — 本地 LLM + EMAGE 动作 + Edge-TTS,零后端</b>
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README-CN.md">简体中文</a>
</p>

---

> [!IMPORTANT]
> **声明**:本项目是一个**浏览器原生 AI 数字人研究实验项目 (Browser-native AI VTuber Research Project)**。旨在验证 100% 客户端 AI 推理栈 (WebLLM / WebGPU / ONNX Runtime Web) 与 Cloudflare Pages 边缘 TTS 函数的可行性,**不建议直接用于商业化生产部署**。

---

## 📖 项目简介 (Overview)

**Project XiaoChun (小蠢)** 是一个完全运行在浏览器里的二次元虚拟形象伙伴。角色用 `@pixiv/three-vrm` 渲染,采用 MToon NPR 着色,坐在沉浸式线稿户外场景中;**所有 AI 推理都在你当前的浏览器标签页里跑** —— 没有 Python 后端,没有服务器 GPU。

你跟她说话。她思考(WebLLM Qwen3 0.6B on WebGPU)、她表情变化(EMAGE ONNX 在 Dedicated Web Worker 里)、她开口说话(Edge-TTS 走 Cloudflare Pages Function / Vite dev middleware)、她全身动作实时跟上。

UI 走 **TanStack Start SSR + i18next** 水合,**完整支持简体中文 / English / 日本語 三语切换**,并且按 iOS HIG 44 pt / Material 48 dp 触屏规范做了移动端优先适配。

---

## 🖼️ 项目预览 (Preview)

<p align="center">
  <img src="screenshots/preview-v1.png" width="100%" alt="小蠢在程序化线稿户外场景中" /><br/>
  <i>VRM 角色采用 MToon NPR 着色,沉浸在程序化生成的线稿户外场景中</i>
</p>

---

## ✨ 核心特性 (Key Features)

### 🎭 VRM 角色与场景 (VRM & Scene)
* **VRM 1.0 渲染**:基于 `@pixiv/three-vrm` 与 MToon NPR 着色,日系柔和打光,**6 组独立光照通道**(主日光 / 半球天光 / 面部射灯 / 背后轮廓 / 腿部柔光 / 双臂专属),可在调试面板实时调参。
* **线稿户外场景**:程序化生成的太阳、19 栋线稿建筑(5 种原型)、5 棵风格化树(松塔/扇形/层叠/柏树/竖椭圆)、线稿地面 —— **纯白底白线,零贴图**。
* **陪伴式凝视系统**:水平头部微动 + 微扫视 + 加性 look-at 追踪,带舒适俯仰角限制。
* **运行时上传 VRM**:右上角上传按钮,支持任意 VRM 1.0 角色替换。

### 🧠 100% 浏览器端 AI 推理栈 (Browser-Side AI)
* **大语言模型** — [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm) 跑 **Qwen3 0.6B (q4f16_1)** WebGPU 推理,思考阶段与流式补全都在当前标签页完成。
* **动作生成** — **EMAGE** 全身动作(ONNX Runtime Web)在 Dedicated Web Worker 中跑,句子级流式输出 + 时序高斯平滑 + 自然待机融合。
* **语音合成** — **Edge-TTS 晓伊 (XiaoyiNeural, zh-CN, +10 Hz 元气少女)**,基于 [`edge-tts-universal`](https://github.com/Sterznode/edge-tts-universal);传输前剥离 emoji,避免 TTS prosody 异常。
* **LLM + TTS + EMAGE 一体编排**:流式 chat director 把每句话切成动作 / 语音 / 表情事件,主线程 60 FPS 零卡顿。

### 🌐 国际化与 SSR 水合 (i18n & SSR)
* **TanStack Start** 全栈 SSR,基于 Cookie 的语言水合 —— **客户端首屏不闪语言**。
* **三语齐备**:简体中文 / English / 日本語。
* **每语言独立系统提示词**:LLM 自动用用户当前语言回答,不依赖用户输入语言。
* **shadcn 风格下拉菜单**(Radix UI 原语)右上角切换语言。

### 📱 移动端优先 UI (Mobile-First)
* **iOS HIG 44 pt / Material 48 dp** 触屏规范贯穿全局。
* **底部对话输入框 ≥ 40 px**,字号 16 px(防止 iOS Safari 聚焦自动缩放)。
* **Tailwind CSS + tailwindcss-animate** 微交互 + 液态玻璃视觉。
* **顶部操作条**:上传 / 语言切换 / 调试面板。
* **头顶跟随气泡**:`transform` 插值平滑跟随头部移动。

### 🛠️ 开发工具链 (Dev Tooling)
* **调试抽屉**:表情切换 / 6 路灯光滑杆 / FOV / 全局亮度。
* **Cloudflare Pages Functions**(`functions/api/tts.ts`):生产环境走边缘运行时 TTS。
* **Vite dev 中间件**(`vite.config.ts → localApiPlugin`):本地 TTS 走完全相同的端点,**零 Python**。
* **单一可信源**:`src/config.ts` 集中管理所有光照 / 相机 / 表情参数。

---

## 🛠️ 技术栈 (Tech Stack)

| 架构层 | 技术方案 | 说明 |
| :--- | :--- | :--- |
| **3D 引擎** | [three.js 0.185](https://threejs.org) + [@pixiv/three-vrm 3.5](https://github.com/pixiv/three-vrm) | MToon NPR 着色、OrbitControls、EffectComposer |
| **应用框架** | [React 19](https://react.dev) + [TanStack Start](https://tanstack.com/start) | 全栈 SSR + Cookie 水合 i18n |
| **路由** | [TanStack Router](https://tanstack.com/router) | 类型安全文件路由 |
| **大语言模型** | [WebLLM](https://github.com/mlc-ai/web-llm) | Qwen3 0.6B q4f16_1 WebGPU 流式推理 |
| **动作生成** | EMAGE + [ONNX Runtime Web](https://onnxruntime.ai) | Dedicated Web Worker 全身动作生成 |
| **语音合成** | [edge-tts-universal](https://github.com/Sterznode/edge-tts-universal) | 晓伊 zh-CN +10 Hz,emoji 剥离 |
| **边缘运行时** | [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/) | `/api/tts` 端点,零冷启动 |
| **样式** | [Tailwind CSS 4](https://tailwindcss.com) + `tailwindcss-animate` | 液态玻璃视觉,移动端优先 |
| **国际化** | [i18next](https://www.i18next.com) + [react-i18next](https://react.i18next.com) | 三语,SSR 水合 |
| **UI 原语** | [Radix UI](https://www.radix-ui.com) (DropdownMenu, Slot) | shadcn 风格组件 |
| **语言** | [TypeScript 6](https://www.typescriptlang.org) | 端到端严格类型 |
| **构建** | [Vite 8](https://vite.dev) + [Vinxi](https://vinxi.vercel.app) | Dev 中间件、边缘兼容构建 |

---

## 🚀 快速开始 (Quick Start)

环境要求:**Node.js 18+**,包管理器 **pnpm**(`preinstall` hook 强制)。

```bash
# 1. 安装依赖 (会自动设置 TTS 开发中间件)
pnpm install

# 2. 启动开发服务器 (TTS / VRM / WebLLM 全在浏览器)
pnpm dev          # → http://localhost:3000

# 3. 生产构建
pnpm build        # 输出到 .output/ (Cloudflare Pages 兼容)
pnpm preview      # 本地预览生产产物
```

> **首次启动提示**:WebLLM 首次启动会下载 Qwen3 0.6B q4f16_1 模型(约 400 MB),并缓存在浏览器的 `CacheStorage` 中。后续访问秒级冷启动。

---

## 📁 项目结构 (Project Structure)

```text
Project-XiaoChun/
├── public/                    # 静态资源
│   ├── xiaochun_v1.vrm        # 默认 VRM 角色模型 (18 MB)
│   ├── thinking.vrma          # 待机思考动作循环
│   ├── logo.png / favicon.*   # 品牌资产
├── functions/
│   └── api/
│       └── tts.ts             # Cloudflare Pages Function — /api/tts 边缘端点
├── src/
│   ├── routes/                # TanStack Start 文件路由
│   │   └── __root.tsx         # 根布局 (i18n SSR 水合入口)
│   ├── components/            # React UI 组件 (TopHeader, ChatBar, HeadBubble…)
│   │   └── ui/                # shadcn 风格原语 (button, dropdown-menu, input)
│   ├── core/
│   │   └── vrmEngine.ts       # 3D 场景组装、光照通道、渲染循环
│   ├── motion/                # VRMA / EMAGE 播放器 + Web Worker
│   ├── llm/                   # WebLLM 接入 + 每语言提示词
│   ├── director/
│   │   └── chatDirector.ts    # LLM → TTS → EMAGE 流式编排管线
│   ├── i18n/                  # zh-CN / en / ja 翻译文件 + SSR 助手
│   │   ├── zh-CN.ts / en.ts / ja.ts
│   │   ├── index.ts           # createI18n, changeLang, readClientLang
│   │   └── server.ts          # createServerOnlyFn 包装 getCookie
│   ├── styles/
│   │   └── main.css           # Tailwind v4 @theme tokens + 全局重置
│   └── config.ts              # 单一可信源(光照 / 相机 / 表情)
├── vite.config.ts             # Vite + TanStack Start + 本地 TTS 开发中间件
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

`functions/api/tts.ts` 通过 [`edge-tts-universal`](https://github.com/Sterznode/edge-tts-universal) 公开协议调用 Microsoft Edge-TTS。`TRUSTED_CLIENT_TOKEN` 是公开的共享 token(所有开源 Edge-TTS 实现都用同一个值),**不是个人密钥**。

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
