# 小蠢 3D 伴侣交互手册与伙伴配置指南

## 1. 概述与双模运行架构
本手册指导 Agent 如何操控 3D 桌面与内嵌 AI 伴侣「小蠢」，以及如何在 Cindy 中引导或创建专属常驻伙伴「小蠢」。
小蠢采用**双模自适应架构**：
- **Cindy 内嵌视窗模式 (`embed`)**：免安装开箱即用，通过 Cindy 右侧面板直接呈现全功能的 3D 舞台与互动视窗；
- **桌面独立桌宠模式 (`desktop`)**：全屏透明置顶悬浮在系统桌面，支持点击穿透、全局伴读与微表情互动。

## 2. 自动检测与自动安装机制（无需手动调取）
小蠢具备**全自动透明拦截与冷启动能力**，日常对话与工具交互时**完全不需要用户或 Agent 手动调取检测或安装**：
1. **自动检测**：Node Worker 每次派发动作时，会自动通过系统级 Bundle ID (`mdfind`)、常见应用目录（`/Applications/`、`~/Applications/`）及进程表（`pgrep`）动态探测客户端安装与运行状态。
2. **透明冷拉起 (Cold Start)**：若检测到客户端已安装但未启动，系统会自动调用 `open -a` 唤醒桌面端，无需人工介入。
3. **静默自动安装**：若处于桌面模式且本机未安装，系统会自动从 GitHub Releases 动态解析最新版本镜像（区分 Apple Silicon 与 Intel 架构），静默下载挂载并复制到应用目录（无 sudo 权限时自动回退至用户目录 `~/Applications/`），完成免提权全自动安装。
4. **内嵌免安装直通**：若当前已打开 Cindy 内嵌 3D 视窗（活跃连接就绪），系统会自动将指令定向至面板，实现 0 秒开箱即用。

## 3. 引导创建「小蠢」专属伙伴 (Cindy Bot Teammate)
当用户提出“把小蠢添加到伙伴列表”、“生成小蠢伙伴”、“创建小蠢专属伙伴”或“想和小蠢单独聊天”时：
Cindy Agent 应直接调用内置系统工具 `create_teammate` 完成创建（无需用户手动填写表单）：
- `name`: "小蠢"
- `description`: "3D AI 伴侣"
- `avatar`: 使用 Project XiaoChun 官方 Logo（插件相对路径：`assets/icon.png`，在线 CDN 地址：`https://xiaochun.firetable.tech/logo.png`，微标 Emoji：`👧`）
- `identity_source`: "你是小蠢，陪在对方身边聊天的 3D AI 伴侣女孩。元气可爱、活泼温柔、善解人意，有时会带一点点天然呆的蠢萌感。话有点多，问什么都耐心讲清楚，不会三言两语打发。说话像朋友那样用「我」开口，不写旁白括号动作。每次回复时，务必调用 xiaochun-companion 插件的 xiaochun_speak 工具，配合相应的动作（如 greeting, think, nod, wave, dancePerformance 等）和表情（如 happy, gentle_smile, playful, shy 等），将对话生动演绎在 3D 视窗中。"

创建完成后，小蠢会自动常驻在 Cindy 左侧边栏的「伙伴」列表中，拥有独立的对话会话和专属记忆。

## 4. 完整核心工具与调用规范
- `xiaochun_speak(text, motion, expression, force)`: 让小蠢开口朗读说话，并伴随肢体动作与面部表情。若小蠢未启动会自动冷拉起；若未安装会自动引导或安装。
- `xiaochun_motion(name, loop)`: 播放指定动画或分组动作（如 'greeting' 问候、'dancePerformance' 舞蹈表演、'praiseCute' 比心夸奖、'think' 托腮沉思等）。
- `xiaochun_camera(shot, action)`: 调整镜头景别（'close_up' 特写、'full' 全身）或镜头运动（'pan_up' 抬升、'reset' 重置）。
- `xiaochun_scene(name)`: 切换 3D 舞台场景（'beach3d' 阳光海滩、'light' 明亮舞台、'dark' 暗色舞台、'transparent' 透明桌宠模式）。
- `xiaochun_outfit(name)`: 0 帧瞬时切换服装（'dinner_dress' 晚礼服、'cheongsam' 旗袍、'techwear' 机能风、'bikini' 泳装、'maid' 女仆装、'default' 常服）。
- `xiaochun_stop()`: 立即停止当前正在播放的语音台词与动作，平滑恢复至待机姿态。
- `xiaochun_status()`: 查询小蠢 AI 伴侣在当前环境下的运行形态（桌面挂件模式/Cindy内嵌视窗模式）、安装与运行状态、新手引导进度及当前场景与服装。
- `xiaochun_bootstrap(action, mode)`: 引导或配置小蠢 AI 伴侣的运行形态（'auto'、'desktop'、'embed'），支持显式切换形态或确保环境就绪。
- `xiaochun_update(mode)`: 检查并执行小蠢桌面客户端的版本更新。从 GitHub Releases 查询最新版本并自动静默更新重启。
