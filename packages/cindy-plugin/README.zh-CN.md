# 小蠢 AI 伴侣 (Project XiaoChun Cindy 插件)

本插件是连接 **Cindy** 与本地 **小蠢 AI 伴侣（Project XiaoChun）** 的官方桥接插件。让 Cindy 对话中的文字回复能够实时转化为 PC 桌面上可爱的 3D 形象伴读、丰富动作演出与情感表达。

> ⚠️ **注意：本插件仅支持 PC 桌面端（macOS / Windows / Linux 桌面版 Cindy）。移动端（iOS / Android）不支持本地小蠢 AI 伴侣联动。**

---

## 特性一览

1. **双模自适应与渐进式伴侣架构**：
   - **桌面桌宠模式（Desktop Pet）**：已安装桌面端时默认直接复用唤醒，享受整个电脑屏幕顶层的透明浮动 3D 桌宠（支持鼠标穿透、全局常驻伴读）；
   - **Cindy 内嵌面板模式（Embed Panel）**：未安装桌面端时可选择该模式，零本地安装依赖，直接在 Cindy 侧边栏/Tab 中打开 3D 小蠢视窗，通过 JS SDK 跨源无缝驱动；
   - **冷启动与形态自由切换**：未安装时插件会友好询问用户选择；后续随时可通过 `xiaochun_bootstrap(action="switch_mode")` 在桌面挂件与内嵌面板间一键平滑切换。
2. **生动自然的伴读交互**：
   - 支持文字与自然语音朗读同步播放；
   - 支持动作组联动（如打招呼 `greeting`、沉思 `think`、夸赞可爱 `praiseCute`、跳舞表演 `dancePerformance` 等）；
   - 支持面部微表情切换（开心、微笑、害羞、调皮、惊讶、放松等）；
   - 支持镜头运镜控制（特写、全景、平滑上摇抬升）。
3. **长文本切片保护**：
   - 当朗读文本超过 400 字符时，自动启用沙箱临时文件管道，避免长 URL 与命令行截断。

---

## 快速使用

安装插件后，在 Cindy 聊天框中：

### 1. 显式命令呼叫
```text
$小蠢 很高兴认识大家，给大家打个招呼吧！
```

### 2. 自然语言隐式伴读
```text
我今天写代码有点累了，让桌面的小蠢鼓励我一下。
```

### 3. 控制动作与镜头
```text
让小蠢跳个舞，镜头推成全身全景。
```

---

## 插件工具清单

* `xiaochun_speak`: 让小蠢说话伴读，附带动作与表情（支持冷拉起与自动就绪；在新手引导期间友好提示，支持 `force: true` 强制插话）。
* `xiaochun_motion`: 播放指定动作或动作分组。
* `xiaochun_camera`: 调整机位景别与运镜（特写、全景、平滑上摇抬升、重置视角）。
* `xiaochun_scene`: 切换小蠢桌面端的 3D 舞台场景（如 3D阳光海滩、透明桌宠模式、暗色/明亮舞台、虚空舞台等）。
* `xiaochun_outfit`: 0 帧瞬时切换小蠢服装造型（优雅晚礼服、国风旗袍、潮酷机能风、清凉比基尼、可爱女仆装、默认常服等）。
* `xiaochun_update`: 检查并执行小蠢客户端版本更新（查询 GitHub Releases 最新版本，自动下载安装并重启）。
* `xiaochun_stop`: 立即停止说话与动作，恢复站姿待机。
* `xiaochun_status`: 检测小蠢在当前电脑上的安装与运行状态、新手引导进度及当前场景与服装。
* `xiaochun_bootstrap`: 执行客户端的自动就绪、安装引导或单独唤起。

---

## 相关资源

* Project XiaoChun 开源主仓：[https://github.com/FireTable/project-xiaochun](https://github.com/FireTable/project-xiaochun)
* 客户端体验与直接下载：[https://xiaochun.firetable.tech](https://xiaochun.firetable.tech)
