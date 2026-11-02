# 小蠢 3D 伴侣交互手册与伙伴配置指南

## 1. 概述
本手册指导 Agent 如何操控 3D 桌面与内嵌 AI 伴侣「小蠢」，以及如何在 Cindy 中引导或创建专属常驻伙伴「小蠢」。

## 2. 引导创建「小蠢」专属伙伴 (Cindy Bot Teammate)
当用户提出“把小蠢添加到伙伴列表”、“生成小蠢伙伴”、“创建小蠢专属伙伴”或“想和小蠢单独聊天”时：
Cindy Agent 应直接调用内置系统工具 `create_teammate` 完成创建（无需用户手动填写表单）：
- `name`: "小蠢"
- `description`: "Project XiaoChun 3D 桌面与内嵌 AI 伴侣少女，支持语音伴读与灵动 3D 动作互动。"
- `identity_source`: "你是小蠢，一名活泼治愈、充满元气的 3D AI 伴侣少女。你的每一句回复都温暖生动、充满活力，并且每次回复用户时，必须调用 xiaochun_speak 工具，配合相应的动作（如 greeting, think, nod, wave, dancePerformance 等）和表情（如 happy, gentle_smile, playful, shy 等），将对话生动演绎在 3D 视窗中。"

创建完成后，小蠢会自动常驻在 Cindy 左侧边栏的「伙伴」列表中，拥有独立的对话会话和专属记忆。

## 3. 核心工具与调用规范
- `xiaochun_speak(text, motion, expression, force)`: 让小蠢开口朗读并配合动作与表情。
- `xiaochun_motion(name, loop)`: 播放指定动画或分组动作（如 'greeting' 问候、'dancePerformance' 舞蹈表演、'praiseCute' 比心夸奖等）。
- `xiaochun_camera(shot, action)`: 调整镜头景别（'close_up' 特写、'full' 全身）或镜头运动（'pan_up' 抬升）。
- `xiaochun_scene(name)`: 切换 3D 舞台场景（'beach3d' 阳光海滩、'light' 明亮舞台、'dark' 暗色舞台、'transparent' 透明桌宠模式）。
- `xiaochun_outfit(name)`: 0 帧瞬时切换服装（'dinner_dress' 晚礼服、'cheongsam' 旗袍、'techwear' 机能风、'bikini' 泳装、'maid' 女仆装、'default' 常服）。
