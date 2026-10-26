# 交互式场景流迭代日志 (Interactive Scene Flow Development Log)

> **分支**: `feature/interactive-scene-flow`  
> **基线 Commit**: `524af1c` (v0.1.39)  
> **启动时间**: 2026-10-26 11:30 (GMT+8)  
> **目标定位**: 沉浸式场景全双工语音交互、可编排舞台指令与离线可复现运行闭环。

---

## 任务全景与执行路线 (Milestones)

- [x] **Task 1: 全双工打断与独立倾听状态机 (Full-duplex Interruption & Listening State)**
- [ ] **Task 2: 结构化舞台指令协议 (Stage Directive Protocol)**
- [ ] **Task 3: 可插拔情境沙盒 (Pluggable Scenario Sandbox)**
- [ ] **Task 4: 离线 Mock 回放系统与交付验收 (Mock Replay Mode & Deliverables)**

---

## Task 1 迭代详情记录

### 时间线与变更
- **11:30 - 分支初始化**
  - 从 `main` (`524af1c`) 检出功能开发分支 `feature/interactive-scene-flow`。
- **11:40 - 全双工语音打断链路打通**
  - `src/stt/sttClient.ts`: 实时 VAD 开口检测到说话时广播 `speech_start` 事件。
  - `src/core/vrmEngine.ts`: 增强 `stopSpeaking()`，即刻触发 `chatDirector.stop()` 并同步调用 `bubbleTracker.hide()` 隐藏头顶气泡与字幕。
  - `src/components/ChatBar.tsx`: 建立多模态倾听生命周期闭环：
    - 输入框聚焦 (`onFocus`) / 打字输入 (`onInput`) / 麦克风开始监听 / VAD 开口识别时立即打断角色发言并激活倾听；
    - 发送消息 (`handleSend`) 或失焦且无草稿时退出倾听。
- **12:10 - 倾听系统架构正统化重构**
  - 纠正错误挂载在 `gaze.ts`（约束层）的方案，杜绝破坏单一骨骼写入者规范。
  - 确立 `src/motion/sources/` 体系，新增独立一级动作源 `listening.ts` (`ListeningMotionSystem`)，与 `idle.ts`、`vrma.ts`、`emage.ts` 保持同级解耦。
  - `motionPipeline.ts`: 作为管线调度器持有 `this.listening`，在每帧 `tick` 中针对 `basePose` 平滑采样，说话与主动作激活时优雅让位。
- **12:35 - 倾听姿态审美升级（单手托腮玩味注视）**
  - **躯干**: 重心向托腮侧倾斜，胸腔轻微前倾迎合，随自然呼吸微起伏。
  - **右臂动力链**: 大臂（`rightUpperArm`）贴胸前收，小臂（`rightLowerArm`）深屈折叠向上，手腕背屈，大拇指承托下颌底缘，食指自然贴附脸颊，其余三指收拢下颌底。
  - **左臂**: 纠正 VRM 骨骼局部坐标系 Z 轴旋转符号，保持在身侧松弛微屈下垂。
  - **头颈与眼神**: 头颈随托手方向倾斜，`gaze.ts` 倾听权重驱动眼神锁定屏幕前用户（屏蔽走神侧目），嘴角叠加微弱玩味浅笑。
- **12:45 - 自动化验证**
  - 编写 `src/motion/listening.test.ts` 姿态与阻尼测试，全库 153/153 单元测试全部通过。
- **12:55 - 精细化区分「文字打字」与「语音开口」的打断体验**
  - **问题分析**: 原方案在输入框获取焦点 (`onFocus`) 或有输入内容 (`onInput`) 时均强行调用 `stopSpeaking()`，导致用户只是点开输入框想边听边构思回复时，角色说话就会被粗暴掐断。
  - **正统人机工学解法**:
    1. **文字输入流 (Text Composer)**:
       - 聚焦输入框或正在打字时，**不掐断角色说话**，允许小蠢从容把话讲完；
       - 当角色说话完毕（`isSpeaking` 变回 `false`）而用户仍在输入框中时，自动平滑滑入托腮倾听姿态；
       - 唯有在用户点击**发送** (`handleSend`) 时，才果断打断角色可能仍在播的旧语音并提交新对话。
    2. **语音对讲流 (Voice / STT)**:
       - 保持全双工拟人性：一旦 VAD 检测到用户真实开口发出声音 (`speech_start`)，立即打断角色发言，进入专注倾听。
- **13:05 - 修复角色说话期间发送按钮卡死禁用状态**
  - **根因**: `sendMessage()` 在整个语音朗读期间一直保持 pending 状态，导致 `isSending` 维持为 `true`，按钮被 `disabled={isSending}` 强行锁定并持续转菊花。
  - **解法**:
    1. 在 `ChatDirector` 与 `VRMEngine` 中加入 `onSpeakingChange` 响应式状态派发；
    2. **有输入内容时 (`hasText`)**: 发送按钮解除禁用，高亮为可点击的发送箭头，点击或回车立即打断当前旧语音并发出新消息；
    3. **无输入内容时 (`!hasText`)**:
       - 角色朗读说话中：按钮变更为优雅的「停止朗读」方块图标（`Square`），点击即刻静音打断；
       - 模型思考生成中：保留加载菊花（`Loader2`）；
       - 闲置待机态：恢复普通灰色不可点状态。
- **13:20 - 倾听态过渡时长与全局 MotionPipeline 严格统一 (0.75s Quintic Smootherstep)**
  - **问题分析**: 原版 `ListeningMotionSystem` 采用 `damp 4.5` 指数阻尼，导致切入倾听仅需 ~0.35s，抬手偏急偏促，破坏了管线全局 0.75s 的从容优雅感。
  - **解法**:
    1. 统一引入 `SOURCE_FADE_DURATION = 0.75s` 基准；
    2. 采用管线同款 Ken Perlin 五次平滑步阶曲线（Quintic Smootherstep：$S(p) = 6p^5 - 15p^4 + 10p^3$），首尾一阶与二阶导数严格为 0；
    3. 支持 `crossfadeScale` 倍率调控，与 Thinking / Speaking 动作过渡保持 100% 物理与美学一致性；
    4. 全库 153/153 单元测试全部通过。
- **13:25 - 落地基于 0.75s 起步底线 [0.75s, 1.00s] 黄金自适应动作过渡算法**
  - **设计目标**: 坚守 0.75s 作为绝对最小值起步底线（绝不向下抢快，保障长发、裙摆与二次元少女身姿的优雅从容感），位姿差异仅向上自适应扩展至 1.00s。
  - **实现架构**:
    1. **零 GC 位姿距离测算 (`PoseBuffer.distanceTo`)**: 52 根骨骼四元数夹角加权求和（躯干四肢 1.2x，指节 0.4x）+ 骨盆位移评估，执行耗时仅 ~3 微秒，无任何内存分配；
    2. **自适应映射公式 (`src/motion/pipeline/adaptiveFade.ts`)**:
       - 绝对起步底线：`MIN_FADE_DURATION = 0.75s`；
       - 动态向上浮动区间：`[0.75s, 1.00s]`；
       - 微小神态（倾听/微点头，diff ≈ 0.1~0.2）$\to$ 坚守 0.75s ~ 0.80s，绝无急躁抽搐；
       - 常规手势（思考/说话，diff ≈ 0.4~0.5）$\to$ ~0.85s 从容流转；
       - 大跨度动作（大甩手/舞蹈，diff ≈ 0.8~1.0）$\to$ 向上宽裕延展至 0.95s~1.00s；
       - 退回待机保护（Action $\to$ Idle）：设立严格 0.75s 平滑底线，防止骨盆回正顿挫；
    3. **倍率旋钮联动**: `MotionPipeline` 与 `ListeningMotionSystem` 挂载 `crossfadeScale`（默认 1.0），并在 `VRMEngine` 暴露 `setCrossfadeScale()`；
    4. **自动化核验**: 编写 `src/motion/pipeline/adaptiveFade.test.ts`，全库 159/159 单元测试全部通过。
