# 小蠢 AI 伴侣 (Project XiaoChun Cindy 插件)

让活泼治愈的小蠢常驻你的 Cindy！小蠢是停靠在 Cindy 侧边栏的 3D AI 伴侣。对话时支持实时自然人声伴读、细腻微表情与灵动肢体动作，更有百变服装无缝切换、跳舞比心与多视角运镜，开箱即用，让写代码与日常对话从此充满元气与温度。

> ⚠️ **注意：本插件仅支持 PC 桌面端（macOS / Windows / Linux 桌面版 Cindy）。移动端（iOS / Android）不支持本地小蠢 AI 伴侣联动。**

---

## 特性一览

1. **Cindy 原生侧边栏内嵌伴侣视窗**：
   - 零本地安装依赖，直接在 Cindy 侧边栏/主视窗中呈现全功能的 3D 虚拟形象与互动视窗；
   - 开箱即用，免安装、不占用桌面置顶层。
2. **生动自然的伴读交互**：
   - 支持文字与自然语音朗读同步播放；
   - 支持动作组联动（如打招呼 `greeting`、沉思 `thinking`、夸赞可爱 `praiseCute`、跳舞表演 `dancePerformance` 等）；
   - 支持面部微表情切换（开心、微笑、害羞、调皮、惊讶、放松等）；
   - 支持镜头运镜控制（特写、全景、平滑上摇抬升）。
3. **百变造型与舞台更迭**：
   - 0 帧瞬时切换服装（优雅晚礼服、国风旗袍、潮酷机能风、清凉比基尼、可爱女仆装、默认常服等）；
   - 自由切换舞台场景（阳光海滩、暗色舞台、明亮舞台、虚空舞台等）。

---

## 快速使用

安装插件后，在 Cindy 聊天框中：

### 1. 显式命令呼叫
```text
$小蠢 很高兴认识大家，给大家打个招呼吧！
```

### 2. 自然语言隐式伴读
```text
我今天写代码有点累了，让小蠢鼓励我一下。
```

### 3. 控制动作与镜头
```text
让小蠢跳个舞，镜头推成全身全景。
```

---

## 插件工具清单

* `xiaochun_speak`: 让小蠢说话伴读，附带动作与表情（在新手引导期间友好提示，支持 `force: true` 强制插话）。
* `xiaochun_motion`: 播放指定动作或动作分组。
* `xiaochun_camera`: 调整机位景别与运镜（特写、全景、平滑上摇抬升、重置视角）。
* `xiaochun_scene`: 切换小蠢伴侣视窗的舞台场景（如阳光海滩、暗色/明亮舞台、虚空舞台等）。
* `xiaochun_outfit`: 0 帧瞬时切换小蠢服装造型（优雅晚礼服、国风旗袍、潮酷机能风、清凉比基尼、可爱女仆装、默认常服等）。
* `xiaochun_stop`: 立即停止说话与动作，恢复站姿待机。
* `xiaochun_status`: 检测小蠢当前连接状态、新手引导进度及当前场景与服装。

---

## 相关资源

* Project XiaoChun 开源主仓：[https://github.com/FireTable/project-xiaochun](https://github.com/FireTable/project-xiaochun)
* 官方主页：[https://xiaochun.firetable.tech](https://xiaochun.firetable.tech)
