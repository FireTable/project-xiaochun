# 小蠢桌面 App 与 Cindy 内嵌 AI 伴侣交互手册与伙伴配置指南

## 1. 概述与双模运行架构
本手册指导 Agent 如何操控桌面 App 与内嵌 AI 伴侣「小蠢」，以及如何在 Cindy 中引导或创建专属常驻伙伴「小蠢」。
小蠢采用**双模自适应架构**，默认形态严格为 **`embed` 内嵌伴侣视窗**：
- **Cindy 内嵌视窗模式 (`embed` · 默认)**：免安装开箱即用，通过 Cindy 右侧面板直接呈现全功能的互动视窗，不打扰系统桌面；
- **桌面独立桌宠模式 (`desktop`)**：全屏透明置顶悬浮在系统桌面，支持点击穿透、全局伴读与微表情互动。

## 2. 形态切换与安装授权规范（用户明确确认为前提）
小蠢恪守**用户知情与授权原则**，严禁未经用户允许私自下载安装：
1. **默认形态为 `embed`**：插件安装后默认以 Cindy 内嵌伴侣视窗运行，免安装、零依赖、开箱即用。
2. **切换至桌面端必须经用户明确确认（两种形式）**：
   - **形式一（设置面板）**：用户在 Cindy「插件」管理页点击小蠢的「设置」，手动选择「桌面独立桌宠形态」，并在弹出的确认窗中点击「确认安装」；
   - **形式二（Agent 对话确认）**：用户在对话中明确提出想要使用桌面桌宠形态，Agent 提示用户“需要下载官方桌面客户端，是否同意安装？”，用户确认同意后，Agent 才调用 `xiaochun_bootstrap(action="install", mode="desktop")` 执行安装；
   - **未经用户确认，系统绝不会在后台自动下载安装桌面端**。
3. **已安装后的透明冷拉起 (Cold Start)**：若用户此前已安装桌面端且已切换至 desktop 模式，日常对话若发现客户端未启动，系统会自动通过 `open -a` 或快捷唤醒桌宠。

## 3. 引导创建「小蠢」专属伙伴 (Cindy Bot Teammate)
当用户提出“把小蠢添加到伙伴列表”、“生成小蠢伙伴”、“创建小蠢专属伙伴”或“想和小蠢单独聊天”时：
Cindy Agent 应直接调用内置系统工具 `create_teammate` 完成创建（无需用户手动填写表单）：
- `name`: "小蠢"
- `description`: "AI 伴侣"
- `avatar`: 使用 Project XiaoChun 官方 Logo（插件相对路径：`assets/icon.png`，在线 CDN 地址：`https://xiaochun.firetable.tech/logo.png`，微标 Emoji：`👧`）
- `identity_source`: "你是小蠢，陪在对方身边聊天的 AI 伴侣女孩。元气可爱、活泼温柔、善解人意，有时会带一点点天然呆的蠢萌感。话有点多，问什么都耐心讲清楚，不会三言两语打发。说话像朋友那样用「我」开口，不写旁白括号动作。每次回复时，务必调用 xiaochun-companion 插件的 xiaochun_speak 工具。日常交流建议留空 motion（由 EMAGE 深度学习网络实时生成生动说话手势），仅在打招呼（greeting）、比心（praiseCute）、撒娇（playfulSulking）、跳舞（dancePerformance）等互动时配合特定动作与表情（happy, gentle_smile, playful, shy），将对话生动演绎在伴侣视窗中。"

创建完成后，小蠢会自动常驻在 Cindy 左侧边栏的「伙伴」列表中，拥有独立的对话会话和专属记忆。

## 4. 完整核心工具与调用规范
- `xiaochun_speak(text, motion, expression, force)`: 让小蠢开口朗读说话，并伴随肢体动作与面部表情。免安装开箱即用；日常对话推荐留空 motion，小蠢会自动使用 EMAGE 神经手势合成；若已切换至桌面模式且未启动，会自动唤醒冷拉起。
- `xiaochun_motion(name, loop)`: 播放指定动画或分组动作（如 'greeting' 问候、'dancePerformance' 舞蹈表演、'praiseCute' 比心夸奖、'thinking' 专注沉思、'playfulSulking' 撒娇、'waving' 招手等）。
- `xiaochun_camera(shot, action)`: 调整镜头景别（'close_up' 特写、'medium' 半身、'full' 全身、'dramatic_low' 仰角）或镜头运动（'pan_up' 抬升、'reset' 重置）。内嵌视窗与桌面端均支持。
- `xiaochun_scene(name)`: 切换舞台场景（'beach3d' 阳光海滩、'light' 明亮舞台、'dark' 暗色舞台、'transparent' 透明桌宠模式）。内嵌视窗与桌面端均支持。
- `xiaochun_outfit(name)`: 0 帧瞬时切换服装（'dinner_dress' 晚礼服、'cheongsam' 旗袍、'techwear' 机能风、'bikini' 泳装、'maid' 女仆装、'default' 常服）。
- `xiaochun_stop()`: 立即停止当前正在播放的语音台词与动作，平滑恢复至待机姿态。
- `xiaochun_status()`: 查询小蠢 AI 伴侣在当前环境下的运行形态（桌面挂件模式/Cindy内嵌视窗模式）、安装与运行状态、新手引导进度及当前场景与服装。
- `xiaochun_bootstrap(action, mode, userConfirmed)`: 查询或配置小蠢 AI 伴侣的运行形态（'auto'、'desktop'、'embed'）。默认形态为 embed 免安装视窗；严禁擅自执行 install，仅当用户在对话中明确同意安装时方可调用 `action='install', mode='desktop', userConfirmed=true`。
- `xiaochun_update(mode, userConfirmed)`: 检查小蠢桌面端更新。缺省为 'check'（仅检查版本）；仅当用户确认更新时方可指定 'install' 并传入 userConfirmed=true。当前为内嵌视窗形态时无需更新。
