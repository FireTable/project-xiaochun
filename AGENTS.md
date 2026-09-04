# Project XiaoChun — Coding Agent 研发与架构规范手册 (AGENTS.md)

> 本文件是专为 AI 辅助编程代理（Coding Agents）准备的工程标准与架构避坑指南。在对本项目进行任何代码修改、重构或扩展前，请**务必仔细阅读本规范**。

---

## 1. 核心架构与技术栈概览

Project XiaoChun 是一个 **100% 浏览器端原生运行的 3D AI 伴侣**，具有极高的端侧隐私安全性与实时性。

| 模块 | 核心技术与关键文件 | 关键职责 |
| :--- | :--- | :--- |
| **3D 引擎** | `three.js 0.185` + `@pixiv/three-vrm 3.5`<br/>(`src/core/vrmEngine.ts`) | MToon NPR 着色、6 路独立可调灯光通道、纯程序化线稿户外世界、相机轨道控制 |
| **动作生成** | EMAGE + ONNX Runtime Web<br/>(`src/motion/emagePlayer.ts`<br/>`src/motion/emageWorker.ts`) | Dedicated Web Worker 全身动作生成、时序高斯平滑、动态 FootIK 换脚支柱 |
| **动作过渡** | `MotionTransitionManager`<br/>(`src/motion/motionTransition.ts`) | 五次平滑步阶 (Quintic Smootherstep) 全局 53 根骨骼零冲击无缝过渡 |
| **言谈微动** | `SpeakIdleSystem`<br/>(`src/motion/speakIdle.ts`) | 分段语音生成等待期间，保持交谈手势悬浮、Z轴指节微舒缩、意识流侧头 |
| **自然待机** | `NaturalIdleSystem`<br/>(`src/motion/naturalIdle.ts`) | 生理十指微卷、多谐波深浅呼吸起伏、骨盆 8 字形微重力摇摆、视线漂移 |
| **端侧大模型** | `@mlc-ai/web-llm`<br/>(`src/llm/webLLM.ts`) | WebGPU 流式推理，默认 Qwen3.5 2B (q4f16_1)，失败降级 0.8B |
| **语音合成** | `edge-tts-universal`<br/>(`src/server.ts` + `src/director/chatDirector.ts`) | 晓伊 (zh-CN-XiaoyiNeural +10 Hz)，纯网络 I/O 全切片并发预取 |
| **端侧记忆** | IndexedDB (`xiaochun-memory`)<br/>(`src/memory/`) | 纯本地三层记忆：近 6 轮对话、中/英/日实体画像提取、n-gram 长期笔记检索 |
| **单一可信源** | `src/config.ts` | 集中管理光照、相机、饱和度预设、动作动力学参数 (`APP_CONFIG.emage.motion`) |

---

## 2. 动作与骨骼动力学架构规范 (核心避坑区)

本项目的 3D 动作衔接包含复杂的层叠逻辑，请严格遵守以下几何与物理动力学规则：

### 2.1 动作状态机与优先级
在主渲染循环（`vrmEngine.ts`）中，动作源优先级严格如下：
1. **EMAGE 说话动作** (`activePlayer = 'emage'`): 角色说话时由 EMAGE 全身协同动作驱动；若段间等待，内部由 `SpeakIdleSystem` 无缝接管。
2. **VRMA 思考循环** (`activePlayer = 'vrma'`): 用户刚提问、LLM 思考期间播放 `thinking.vrma`。
3. **NaturalIdle 自然待机** (`activePlayer = 'idle'`): 待机状态下由程序化生理呼吸与重心微移驱动。

### 2.2 状态切换与 `MotionTransitionManager`
- 文件：`src/motion/motionTransition.ts`
- 原理：在状态切换（如 `Idle -> Think`、`Think -> Speaking`、`Speaking -> Idle`）触发瞬间，毫秒级无损捕获所有标准化骨骼的当前实时四元数，随后利用五次平滑步阶（Quintic Smootherstep $6t^5 - 15t^4 + 10t^3$）进行 Slerp 插值过渡（通常 0.55s ~ 0.75s）。
- **⚠️ 核心避坑规则：严格排除 `neck` 和 `head`！**
  - **为什么**：`vrmEngine.ts` 在渲染循环末端对 `neck` 和 `head` 执行了实时的程序化增量乘法凝视追踪（`neckNode.quaternion.multiply(neckOffsetQ)`）。
  - **后果**：如果在 `motionTransition` 中快照了头部骨骼，快照内部已包含 LookAt 偏移量；过渡时会被再次乘法叠加，导致切换瞬间头部严重翻折、抽搐或闪现归位！
  - **准则**：`VRM_ALL_HUMANOID_BONES` 清单中**绝对不能包含 `neck` 和 `head`**。颈部和头部交由各自模块的基础朝向与 LookAt 独立平滑跟随。

### 2.3 EMAGE 跨片段流式衔接 (`switchSegment`)
- 文件：`src/motion/emagePlayer.ts`
- **自回归种子继承**：Worker 生成第 $i$ 段动作时必须传入 `continueFromPrevious = true`，自动吸纳上一段末尾 4 帧潜在表示，保证动作数学连续性。
- **物理角速度与阻尼跟随**：
  - 手臂/手指最大角速度：$1.5\ \text{rad/s}$（约 $86^\circ/\text{s}$）。
  - 颈部/头部最大角速度：$1.3\ \text{rad/s}$（约 $74^\circ/\text{s}$）。
  - 躯干/腰椎/骨盆最大角速度：$1.0\ \text{rad/s}$（约 $57^\circ/\text{s}$）。
  - 惯性阻尼刚度：统一从 `APP_CONFIG.emage.motion.dampingStiffness` 引用（默认 4.2）。
- **⚠️ 核心避坑规则**：切段是在 EMAGE 播放器内部通过 `currentBoneQ` 物理追赶完成的，**切段瞬间严禁在外部重复调用 `motionTransition.startTransition`**，否则会产生重复快照与动作争抢。

### 2.4 说话结束平滑回收
- 在所有语音片段播放完毕后，直接调用 `emage.stop()` 并触发 `this.transition?.startTransition(this.currentVRM, 0.75)`。
- **⚠️ 核心避坑规则**：严禁在 `emage.stop()` 或 `resetPose()` 中使用 `bone.quaternion.copy(rest)` 强行拉直下半身骨骼！必须完整保留骨骼当前的实时生理角度，交由全局 `motionTransition` 平滑 Slerp 回 NaturalIdle，杜绝任何 0.6 秒定格停顿与抽动。

---

## 3. 对话导演与流式调度管线 (`chatDirector.ts`)

- **智能分句切片 (`splitIntoSpeechChunks`)**：统一按 30~60 字与自然标点（`。！？!?\n` 或逗号从句）切分，保留自然换气节奏。
- **并发 TTS 预拉取**：所有切片在收到文本的第一时间通过 `Promise.all` 并行向 Edge-TTS 拉取音频，将后续网络等待压缩到 0ms。
- **双条件预缓冲起播**：
  $$\text{targetPreload} = \min\big(2, \min(N, \max(1, \lceil N/3 \rceil))\big)$$
  短句 1~2 段秒开，长文缓冲满 2 段（约 8~12s 音频）即起播，后续段落后台源源不断产生。
- **言谈间歇待机接管**：若待播切片尚未推理完成，立即切入 `emage.enterSpeakIdle()`；新段就绪时执行 `emage.exitSpeakIdle()` 并切入播放。
- **气泡文本展开规则 (`HeadBubble.tsx`)**：
  - 仅在 `state.statusKey === 'speaking'`（即“来啦来啦～”正式开播与动作上演）时才展开渲染台词文本；
  - 在 `thinking`、`tts`、`emage` 等预备与缓冲阶段，仅展示对应的微型状态图标与文字胶囊，避免提前剧透台词。

---

## 4. 单一可信源规范 (`src/config.ts`)

修改任何系统级配置或参数时，请遵守**集中化单一可信源**原则：
- **动作强度与阻尼**：`APP_CONFIG.emage.motion`（包含手势幅度、手指卷曲、胸腔起伏、腰椎动势、骨盆微移、双腿随动、头部挺拔、阻尼刚度、时序平滑半径）。
- **模型文件与 CDN**：`APP_CONFIG.emage.base`（本地走 `/onnx`，生产走 Cloudflare R2）。
- **记忆容量**：`APP_CONFIG.memory`（短期轮次 `shortTermTurns`、单轮截断 `turnMaxChars`、长期上限 `longTermKeep`、召回 Top-K `longTermTopK`）。
- **灯光与色彩**：`APP_CONFIG.lights` 与 `APP_CONFIG.saturation`。

---

## 5. 常用研发指令与校验工作流

```bash
# 1. 启动本地开发服务 (使用 Miniflare 模拟 Cloudflare Workers 运行时)
pnpm dev

# 2. 严格 TypeScript 类型检查 (在提交任何改动前必须保证 0 错误！)
npx tsc --noEmit

# 3. 生产打包构建
pnpm build
```

---

## 6. 提交与 PR 规约

- 提交信息请简明清晰（推荐使用语义化 Commit 规范，如 `feat: ...`, `fix: ...`, `refactor: ...`, `docs: ...`）。
- 若改动涉及动作平滑度、角速度、过渡时长或核心动力学参数，请同步在 `src/config.ts`、`README-CN.md`、`README.md` 与本文件中更新记录。
