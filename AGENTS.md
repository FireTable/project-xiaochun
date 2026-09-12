# Project XiaoChun — Coding Agent Engineering & Architecture Reference (AGENTS.md)

> This document is the engineering standards and architecture pitfall guide prepared specifically for AI-assisted Coding Agents. **Read this carefully before making any code changes, refactors, or extensions to this project.**

---

## 1. Core Architecture & Tech Stack Overview

Project XiaoChun is a **100% browser-native 3D AI companion** with strong on-device privacy and real-time performance.

| Module | Core Technologies & Key Files | Key Responsibility & Dedicated Documentation |
| :--- | :--- | :--- |
| **3D Engine & Lifecycle** | `three.js 0.185` + `@pixiv/three-vrm 3.5`<br/>(`src/core/vrmEngine.ts`) | Generic thin orchestrator facade, modular subsystem/plugin architecture, zero-GC 60FPS render loop, detailed in [`docs/ARCHITECTURE_AND_RULES.md`](docs/ARCHITECTURE_AND_RULES.md) |
| **VRMEngine & vrmWorker** | `VRMEngine` + `vrmWorker` + `idb-vrm-cache`<br/>(`src/core/`, `src/lib/idb-vrm-cache.ts`) | Dual-core master facade & worker synthesis, Transferable IPC, 2-tier IDB, detailed in [`docs/VRM_ENGINE_AND_WORKER.md`](docs/VRM_ENGINE_AND_WORKER.md) |
| **Outfit Swap & Delta System** | `outfitSwap.ts` + `.vrmaddon`<br/>(`src/core/outfitSwap.ts`, `vrmWorker.ts`) | 0-frame T-pose elimination, deferred snapshot & pre-restore, delta packaging, detailed in [`docs/OUTFIT_SWAP.md`](docs/OUTFIT_SWAP.md) |
| **Post-Processing Pipeline** | `PostFxPipeline`<br/>(`src/core/postfx/postFxPipeline.ts`) | UnrealBloomPass, background luminance bypass, tone mapping, color grading, detailed in [`docs/POSTFX.md`](docs/POSTFX.md) |
| **VRM Build Toolchain** | `workflow.mjs` + `oxipng`<br/>(`scripts/build-vrm/`) | Delta extraction, PNG texture recompression, fixed zip mtime & byte idempotency, detailed in [`docs/VRM_BUILD_WORKFLOW.md`](docs/VRM_BUILD_WORKFLOW.md) |
| **Motion Pipeline** | `UniversalMotionController` + `MotionPipeline`<br/>(`src/motion/pipeline/`) | Universal motion input, 5-layer blend graph, detailed in [`docs/MOTION_PIPELINE.md`](docs/MOTION_PIPELINE.md) |
| **FootIK & Ground Anchors** | `FootIKSolver`<br/>(`src/motion/footIK.ts`) | Two-bone analytical IK, weight shift (contrapposto), auto-sink, detailed in [`docs/FOOT_IK.md`](docs/FOOT_IK.md) |
| **Locomotion & Gaze** | `BodyTurnSystem` + `GazeController`<br/>(`src/motion/bodyTurn.ts`, `gazeController.ts`) | 4-phase stepping FSM, spring yaw tracking, bio saccades, detailed in [`docs/BODY_TURN_AND_GAZE.md`](docs/BODY_TURN_AND_GAZE.md) |
| **Biomechanical Morphing** | `VRMBodyMorph`<br/>(`src/core/morph/vrmBodyMorph.ts`) | 28-parameter orthogonal decoupled bone & vertex morphing engine, detailed in [`docs/BONE_MORPH.md`](docs/BONE_MORPH.md) |
| **Chat Director & TTS** | `ChatDirector` + native WebSocket client (`src/lib/edge-tts-core.ts`)<br/>(`src/director/chatDirector.ts`, `src/server.ts`) | Smart 30~60 chars slicer, parallel TTS prefetch, stream sync, detailed in [`docs/CHAT_DIRECTOR.md`](docs/CHAT_DIRECTOR.md) |
| **On-device AI & Memory** | `webLLM` + `EMAGE Worker` + `IndexedDB`<br/>(`src/llm/`, `src/motion/`, `src/memory/`) | 100% local WebGPU inference, EMAGE Worker, 3-tier memory, detailed in [`docs/ON_DEVICE_AI.md`](docs/ON_DEVICE_AI.md) |
| **Documentation Index** | Complete Architecture Index & Sitemap | Complete agent fast-path guide, detailed in [`docs/README.md`](docs/README.md) |

---

## 2. Motion & Bone Dynamics Architecture (Critical Pitfall Zone)

The 3D motion pipeline involves complex layered logic. Follow these geometric and physics rules strictly:

### 2.1 Unified Motion Blending Pipeline & Universal Motion API (万能动作融合管线与零障碍动作接入)
- Files: `src/motion/pipeline/poseBuffer.ts`, `src/motion/pipeline/universalMotion.ts`, `src/motion/pipeline/motionPipeline.ts`, `src/core/vrmEngine.ts`
- **Architecture Principle**:
  1. **Single Bone Writer (唯一骨骼写入者)**: All sub-modules (Idle, VRMA, EMAGE, Universal Clips, BodyTurn) calculate desired transforms into preallocated `PoseBuffer` objects; only `MotionPipeline.evaluate()` commits final quaternions and positions atomically to VRM humanoid bones in the final pass.
  2. **Layered Blend Graph**:
     - **Layer 0 (Base)**: `NaturalIdle` procedural breathing and standby poise.
     - **Layer 1 (Main Action)**: Managed via continuous Quintic Smootherstep crossfading ($\sum W = 1.0$) between `idle`, `vrma`, `emage`, and `motion`.
     - **Layer 2 (Locomotion)**: `BodyTurnSystem` masked override applied strictly to `LOWER_BODY_MASK` (legs + hips) via `blendMasked()`.
     - **Post Constraints**: `FootIK` physical ground anchoring followed by `LookAtHead` gaze alignment.
  3. **Universal Motion Ingestion (万能动作零门槛接入入口)**:
     - 任何地方想要播放任何动作（无论是 VRMA 文件 URL、ArrayBuffer 二进制流、还是 THREE.AnimationClip），**严禁到处写死 if-else 或私自创建 Mixer**，必须统一调用顶层 API：
       ```ts
       const handle = await vrmEngine.playMotion(clipOrUrl, {
         fadeDuration: 0.75, // 五次平滑步阶曲线过渡时长 (秒)
         loop: false,        // 是否循环播放
         mask: 'all' | 'upperBody', // 全身动作或仅上半身手势
         timeScale: 1.0,     // 播放倍速
         onEnd: () => { ... } // 播完并平滑淡出回归待机后的回调
       });
       // 或随时平滑淡出停播：
       vrmEngine.stopMotion(0.75);
       ```
  4. **Automatic Frame Inbetweening & Lifecycle**:
     - 当新动作塞入时，管线自动捕获当前物理瞬时姿态作为过渡起点，自动消除 LookAt 增量；
     - 使用五次平滑步阶（Quintic Smootherstep: $6t^5 - 15t^4 + 10t^3$）在自适应生理时间窗（0.70s~0.88s）内逐帧 Slerp 插补，彻底消除跳帧与机械撕扯；
     - 非循环动作到达尾声时，管线自动启动淡出过渡并从容回归 `NaturalIdle`，触发 `onEnd` 回调，外部调用者 0 维护负担。
  5. **⚠️ Critical Architecture Pitfall: Zero-Buffer Commit Trap (T-Pose & Sinking Bug)**:
     - **The Problem**: 预分配的 `PoseBuffer` 初始四元数均为默认的 `(0, 0, 0, 1)`（即 T-Pose），骨盆位置为 `(0, 0, 0)`（即深陷脚底原点）。如果直接在渲染循环末端执行 `finalPose.commitToVRM(vrm)`，而 `basePose` 尚未经过逐帧计算或采样，就会强行将全零姿态覆写至骨骼，导致模型瞬间变为 T-Pose 假人并下沉入地底！
     - **The Solution**: 渲染主循环末尾对管线姿态的更新必须遵循**非破坏性只读采样原则**（`motionPipeline.finalPose.sampleFromVRM(vrm)`），让各个动作子系统（NaturalIdle、UniversalMotion、EMAGE）安全驱动骨骼，由 `MotionTransitionManager` 负责跨状态五次平滑步阶 Slerp，绝不在未经安全校验前盲目覆写骨骼。

### 2.2 State Transitions & `MotionTransitionManager`
- File: `src/motion/motionTransition.ts`
- Principle: At the instant a state switch triggers (e.g. `Idle -> Think`, `Think -> Speaking`, `Speaking -> Idle`), it captures all normalized bone quaternions in milliseconds, then uses Quintic Smootherstep ($6t^5 - 15t^4 + 10t^3$) to Slerp-interpolate over physiological timeframes (0.70s ~ 0.88s, ~42~53 frames).
- **⚠️ Critical Architecture Pitfall: LookAt Decoupling via Inverse Quaternions**:
  - **The Problem**: `vrmEngine.ts` applies multiplicative gaze tracking to `neck` and `head` at the end of every frame (`node.quaternion.multiply(offsetQ)`). If the transition manager blindly snapshots these bones, the snapshot contains the gaze offset; during interpolation it gets multiplied again, causing severe head flips or snap-back.
  - **The Solution**: Instead of naively excluding neck/head, `MotionTransitionManager.startTransition(vrm, dur, lookAtOffsets)` receives the current LookAt offsets and multiplies the snapshot by the inverse offset: `snap.multiply(invLookAt)`. This preserves pure anatomical orientation and allows full 52-bone seamless interpolation without head spasms.

### 2.3 Three.js `AnimationMixer.stopAllAction()` Restore Trap (The `Think -> Emage` Drop-to-Idle Pitfall)
- Files: `src/motion/vrmaPlayer.ts`, `src/director/chatDirector.ts`, `src/core/vrmEngine.ts`
- **Pitfall Symptom**: When switching from thinking posture to speech gestures (`think -> emage`), the character abruptly dropped their hand back to idle, froze for a split second, and then began the speech gesture from scratch ("seemed to be switched back to idle then to emage").
- **Root Cause**: In Three.js, calling `mixer.stopAllAction()` triggers an internal `restoreOriginalState()` on all active property bindings, **forcibly resetting all animated bones back to their rest pose / T-Pose (0)**. When `motionTransition.startTransition` sampled the VRM bones in the next render frame, it captured the already-reset idle pose rather than the actual thinking chin-resting pose!
- **Engineering Standard & Rule**:
  - In `VRMAMotionPlayer.stop()`, **never call `mixer.stopAllAction()` nakedly**.
  - Always snapshot all 52 humanoid bone quaternions and `hips.position` immediately **before** calling `mixer.stopAllAction()`, and write them back immediately **after** `mixer.stopAllAction()`.
  - This ensures bone transforms remain continuous in 3D space across action stops, allowing `MotionTransitionManager` to capture the true anatomical pose.

### 2.4 State Machine Race Conditions & Premature Assignment Pitfall
- **Pitfall Symptom**: Clicking "Send" caused the character to twitch/flicker back to idle for one frame before resuming `think`.
- **Root Cause**: Prematurely writing `this.activePlayer = 'vrma'` before the animation clip actually starts playing. In the intermediate render frame, `vrmaPlayer.isPlaying()` was still `false`, causing the render loop's state machine to demote `activePlayer` back to `'idle'` and trigger an unintended reverse transition.
- **Engineering Standard & Rule**:
  - `activePlayer` must be driven **strictly and atomically by the render loop** (`vrmEngine.ts`) based on real-time module status (`isPlaying()` / `isThinking`).
  - Never prematurely mutate `activePlayer` outside the render loop in async event handlers or caller methods (`sendMessage()`, etc.).

### 2.5 EMAGE Cross-Segment Streaming Continuity (`switchSegment`)
- File: `src/motion/emagePlayer.ts`
- **Autoregressive Seed Inheritance**: When the Worker generates segment $i$, it must pass `continueFromPrevious = true` to absorb the last 4 frames' latent representation from the previous segment, guaranteeing mathematical motion continuity.
- **Physical Angular Velocity & Damping Following**:
  - Arms / fingers max angular speed: $1.5\ \text{rad/s}$ (~$86°/\text{s}$).
  - Neck / head max angular speed: $1.3\ \text{rad/s}$ (~$74°/\text{s}$).
  - Torso / lumbar / pelvis max angular speed: $1.0\ \text{rad/s}$ (~$57°/\text{s}$).
  - Inertial damping stiffness: read from `APP_CONFIG.emage.motion.dampingStiffness` (default 4.2).
- **⚠️ Critical Rule**: Segment switching is handled internally inside the EMAGE player via `currentBoneQ` physical catch-up. **Never call `motionTransition.startTransition` externally during a segment switch** — it will produce duplicate snapshots and motion contention.

### 2.6 Speech-End Smooth Recovery & Idle Upright Posture Guarantee
- After all speech segments finish, call `emage.stop()` and fire `this.motionTransition.startTransition(vrm, 0.88)`.
- **⚠️ Critical Rule**: Never use `bone.quaternion.copy(rest)` in `emage.stop()` or `resetPose()` to snap lower-body bones straight! Always preserve the current real-time bone orientation and hand off to the global `motionTransition` to smoothly Slerp back into NaturalIdle — eliminates any 0.6s freeze/stutter.
- **`NaturalIdleSystem` must continuously maintain upright lower-body posture**:
  - `NaturalIdleSystem` must bind and hold initial rest quaternions (`restQ`) for all leg, foot, toe, and pelvis bones: `leftUpperLeg`, `rightUpperLeg`, `leftLowerLeg`, `rightLowerLeg`, `leftFoot`, `rightFoot`, `leftToes`, `rightToes`, `hips`.
  - In `update(time, idleWeight)`, every lower-body bone must execute `slerp(restQ, idleWeight)`, giving the transition manager a definite upright target and preventing any bent-knee or crooked-leg residue during standby.
  - In both idle and VRMA modes, call `levelFeet(vrm)` to keep soles absolutely level with the ground ($X=0, Z=0$), preventing toe-lift or foot roll.

### 2.7 BodyTurn Stepping & Head Gaze Decoupling (`handleBodyTurnHandoff`)
- Files: `src/motion/bodyTurn.ts`, `src/core/vrmEngine.ts`, `src/motion/motionTransition.ts`
- **Pitfall Symptom**: When the camera rotates around the character, `BodyTurnSystem` steps to rotate the body toward the lens. At the moment stepping finishes, the head abruptly jerks/snaps to the side before snapping back to face the camera ("头在转的时候注视镜头，在要结束的时候头突然偏一下").
- **Root Causes**:
  1. `handleBodyTurnHandoff` originally called global `motionTransition.startTransition(vrm, 0.30)`. Because `VRM_ALL_HUMANOID_BONES` included `head` and `neck`, the transition manager captured a snapshot of the head/neck and forcibly interpolated them over 0.30s, fighting against the real-time `LookAt` system and pulling the head backward in time.
  2. `BodyTurnSystem` originally applied aggressive spine pre-rotation (`upperChestTarget = normYaw * 0.30`, total 0.60 across spine/chest). Because `neck` and `head` are child bones of `upperChest`, this caused the head's world yaw to overshoot by 160%; when stepping stopped, the spine snapped back to 0, whipping the head.
- **Engineering Standard & Rule**:
  - `MotionTransitionManager.startTransition` must support `boneFilter?: readonly string[]`.
  - In `handleBodyTurnHandoff`, strictly pass `BODY_TURN_BONES` (only `hips`, `upperLeg`, `lowerLeg`, `foot`, `toes`). **Never snapshot or transition `head`, `neck`, or arms during stepping handoffs!**
  - Keep `BodyTurnSystem` spine yaw subtle ($\le 0.08$ total) to let real-time `LookAtHead` cleanly govern gaze orientation without spine whip.

### 2.8 Biomechanical Bone Morphing & Orthogonal Decoupling Engine (体型骨骼正交解耦系统)
- Files: `src/core/morph/vrmBodyMorph.ts`, `src/config.ts`, `src/components/DevDrawer.tsx`, and detailed specification in [`docs/BONE_MORPH.md`](docs/BONE_MORPH.md)
- **Core Engineering Principle**:
  1. **Anatomical Boundary Locking (地锚锁死原则)**: Bone scaling must never be symmetrically center-out. Always compute forward/backward expansion amounts and apply opposite translation offsets to lock the opposite anatomical face (e.g. flat abdomen wall remains $0\text{ mm}$ drift when buttocks or torso thickness scales).
  2. **Downstream Inverse Compensation (级联逆补偿原则)**: When a parent bone undergoes compensatory translation or scaling, its immediate child joint (e.g. `UpperChest` under `Chest`, `Knee` under `UpperLeg`) must invert the transform ($1/S_z$ and $-\Delta P$) to preserve downstream world alignment (shoulders, neck, and feet stay 100% stable).
  3. **Bone vs. Soft-Tissue Separation (骨架与软组织分治原则)**:
     - Rigid/structural proportions (height, shoulder width, torso thickness, limb length) are driven via skeletal matrix transforms.
     - Soft-tissue adiposity (such as `belly` / belly size) is driven via **procedural vertex morphing with smooth cosine falloff** over the front abdominal wall. **Never mutate `Spine` scale or rotation for belly fullness**, as this distorts the lumbar curve and thickens the lower back!
  4. **Dynamic Crown Height Measurement**: Never hardcode character height constants. Compute height by dynamically projecting the highest mesh vertex crown down to physical ground ($Y=0$) across dynamic shoes, IK sink, and morph slider changes.
  5. **Shoulder Width Bounds**: `shoulderWidth` defaults to `1.55` (155%) with an extended biomechanical range of `0.75 ~ 2.50` (250%).

### 2.9 Full-Outfit Swap & Delta Web Worker Architecture (原子换装与后台合成陷阱)
- Files: `src/core/outfitSwap.ts`, `src/core/vrmWorker.ts`, `src/core/vrmEngine.ts`, `src/lib/idb-vrm-cache.ts`, detailed in [`docs/OUTFIT_SWAP.md`](docs/OUTFIT_SWAP.md) and [`docs/VRM_ENGINE_AND_WORKER.md`](docs/VRM_ENGINE_AND_WORKER.md).
- **⚠️ Critical Architecture Pitfall: 1-Frame T-Pose & Premature Stop Trap**:
  - **The Problem**: 传统换装在开始加载新模型时就提前停止正在播放的动作（导致角色发愣 150ms），且在将新模型挂载到场景后才调用姿态恢复函数，导致屏幕上闪现 1 帧 T-Pose 抽搐破绽。
  - **The Solution (Deferred Snapshot & Pre-restoration)**:
    1. **旧模型绝不提前刹车**：换装异步加载期间旧模型持续正常播放动作与呼吸；
    2. **延迟快照捕获**：仅在新 GLB 解析完成后的微秒级瞬间调用 `captureOutfitSwapState(oldVrm)` 捕获物理瞬时姿态、表情权重与 LookAt 坐标；
    3. **内存中直接预置姿态**：在调用 `scene.add(newVrm.scene)` 之前，先在内存中执行 `preRestoreOutfitSwapState(newVrm, snapshot)`，直接预设所有 52 根骨骼四元数；
    4. **原子场景替换**：在单个微任务内原子执行 `scene.remove(old) + scene.add(new)`，并在下一帧完成 SpringBone 与视线重绑（`postRestoreOutfitSwapState`），达成绝对意义上的 0 帧 T-pose 闪烁与 0 卡顿。
- **⚠️ Critical Worker Offloading Rule**:
  - `bspatch` 差分算法、`fflate` 解压与二进制重组**绝对严禁跑在主线程**，必须全量下放至 Dedicated Web Worker (`src/core/vrmWorker.ts`)，并通过 `Transferable ArrayBuffer` 零拷贝返回；
  - `packRawGLB` 必须严格遵守 glTF 2.0 规范保持 4 字节边界对齐（JSON 尾部 0x20 空格对齐，BIN 尾部 0x00 零填充）；
  - 必须维护 L1 base 与 L2 composed (`${baseSha}:${addonSha}`) 双层 IndexedDB 缓存，实现二次换装 10~30ms 秒开。

### 2.10 Cinematic PostFx Pipeline & Anime Bloom Isolation (后期管线与辉光泛白规避)
- Files: `src/core/postfx/postFxPipeline.ts`, detailed in [`docs/POSTFX.md`](docs/POSTFX.md).
- **⚠️ Critical Architecture Pitfall: White-Background Bloom Blowout (全屏泛白死光)**:
  - **The Problem**: 线稿世界背景地面与天空为极高亮白色（`#ffffff`），若直接对全屏应用 `UnrealBloomPass`，发光阈值会导致整个场景发白泛光、完全看不清角色轮廓。
  - **The Solution (Luminance Bypass)**: 在片元着色器中对纯白/超高亮背景实施物理剔除 (`bloomBypassBackground`)，使得只有角色本体的高光、发丝与衣物产生软雾漫反射。
- **Zero-Overhead Render Bypass**:
  - 当 `postfx.enabled === false` 时，渲染循环必须直接走 `renderer.render(scene, camera)`，彻底绕开 `EffectComposer` 的双重 FBO Blit 开销。

### 2.11 VRMEngine Modularization & General-Purpose Facade Rules (保持通用、插件化解耦与业务瘦身原则)
- Files: `src/core/vrmEngine.ts`, `src/core/scene/`, `src/core/lighting/`, `src/core/materials/`, `src/core/morph/`, `src/core/postfx/`, `src/motion/`
- **Core Positioning (核心定位与瘦中枢原则)**:
  `VRMEngine` 的定位是 **纯粹的 3D 渲染调度中枢与对外的统一 Facade 门面**，**严禁退化为堆砌具体业务的「上帝类」(God Class)**。
  1. **保持通用与领域无关 (Keep Generic & UI/Domain-Agnostic)**:
     - `vrmEngine.ts` 内部**严禁直接编写具体业务逻辑**（如特定 UI 状态管理、复杂的对话分支策略、网络请求组装、特定 DOM 操作或硬编码的业务判断）；
     - 面向外部上层（React 组件、UI Controls、DevDrawer）只暴露高层正交门面 API（如 `playMotion()`, `swapOutfit()`, `setLight()`, `setBodyMorph()`, `setLineworkTheme()`），内部实现一律委托给对应的领域子系统。
  2. **相关逻辑全面插件化 / 子模块化 (Mandatory Subsystem / Plugin Pattern)**:
     - 凡是具有明确职责边界的领域逻辑，**必须独立抽取为自包含的插件/子系统模块**，严禁在 `vrmEngine.ts` 中直接追加几十上百行具体算法：
       * 场景与背景线稿世界 $\to$ `src/core/scene/lineworkWorld.ts` (`LineworkWorld`)
       * 摄影棚三通道灯光系统 $\to$ `src/core/lighting/studioLighting.ts` (`StudioLighting`)
       * MToon 材质与色彩饱和度管理器 $\to$ `src/core/materials/vrmMaterialManager.ts` (`VRMMaterialManager`)
       * 28 参数正交骨骼形变系统 $\to$ `src/core/morph/vrmBodyMorph.ts` (`VRMBodyMorph`)
       * 电影级后期渲染管线 $\to$ `src/core/postfx/postFxPipeline.ts` (`PostFxPipeline`)
       * 视线追踪与仿生微跳视 $\to$ `src/core/scene/gazeController.ts` (`GazeController`)
       * 动作管线与过渡融合 $\to$ `src/motion/pipeline/` (`MotionPipeline`, `UniversalMotionController`, `MotionTransitionManager`)
       * 对话与语音动作导演 $\to$ `src/director/chatDirector.ts` (`ChatDirector`)
     - **标准化生命周期契约**：子系统必须定义清晰的生命周期方法（如 `init(scene)`, `update(delta, time, vrm)`, `resize(w, h, ratio)`, `dispose()`），`VRMEngine` 仅在自身生命周期的对应阶段进行轻量代理调度。
  3. **代码增量准入法则 (Code Ingestion Rule)**:
     - 在为 3D 角色或场景增加新特性时，**第一原则是创建或拓展相应的子系统/插件模块**，而不是直接在 `vrmEngine.ts` 中堆叠代码。`vrmEngine.ts` 仅负责实例化挂载与门面代理。

### 2.12 Performance & Frame-Budget Disciplines (全链路性能保障红线与 60FPS 帧预算)
- Target: 严格守护 16.6ms 帧预算，移动端与 PC 端全天候稳定 60 FPS，杜绝任何可察觉的掉帧、微卡顿与内存泄漏。
- **Core Engineering Disciplines (核心性能军规)**:
  1. **渲染主循环零动态分配 (Zero Allocation & Zero GC in Render Loop)**:
     - 在 `requestAnimationFrame` 驱动的渲染循环及每帧 `tick`/`update`/`evaluate` 中，**严禁频繁创建短期对象**：
       * ❌ 严禁在帧循环中调用 `new THREE.Vector3()`, `new THREE.Quaternion()`, `new THREE.Matrix4()`, `new THREE.Color()`
       * ❌ 严禁在帧循环内动态分配空数组 `[]`、临时对象字面量 `{ ... }`、匿名箭头函数闭包、或高阶迭代器 (`.map()`, `.filter()`, `.forEach()`)
     - **统一解决方案**：必须在模块外层或类内部预分配可复用的临时 Scratch 变量（如 `tempHeadTopPos`, `tempRulerEdgePos`, `tempSoleA` 等），在每帧计算中直接使用 `.copy()`, `.set()`, `.multiply()` 原地复用，彻底消灭 V8 引擎 GC（垃圾回收）停顿导致的肉眼可见撕裂与微卡顿。
  2. **高开销计算 100% 异步 Worker 下放 (Dedicated Web Worker Offloading)**:
     - 凡涉及繁重计算（glTF 二进制重打包、`bspatch` 差分算法、`fflate` 解压、EMAGE ONNX 神经网络推理、WebLLM 权重解算），**一律严禁在主线程执行**，必须全量派发给 Dedicated Web Worker (`vrmWorker.ts` / `emageWorker.ts` / `llmWorker.ts`)；
     - 主线程与 Worker 通信时，海量 ArrayBuffer 数据必须使用 **Transferable Objects 零拷贝转移所有权**（例如 `postMessage({ buffer }, [buffer])`），严禁使用结构化克隆（`structuredClone`）复制大内存，避免产生百兆内存峰值与主线程瞬时冻结。
  3. **计算短路与直通旁路 (Short-Circuiting & Zero-Overhead Bypass)**:
     - **后期处理直通**：当 `postfx.enabled === false` 时，渲染器跳过 `EffectComposer` 的双重 FBO 全屏后处理 Pass，直接以原生 `renderer.render(scene, camera)` 直通输出；
     - **视线计算短路**：当相机处于后方或视锥体极限外（`isOutOfView`）时，立即短路射线拾取与头部过度扭转运算；
     - **物理像素超采样限制**：严格遵循 `getRenderPixelRatio(APP_CONFIG.renderer.maxPixelRatio)`，封顶 DPR（如 3），严禁在超高分辨率移动设备上任由原生 3x/4x 填充满屏，避免 GPU 填充率过载发热降频。
  4. **二级持久化缓存 (Two-Tier IDB Caching)**:
     - 换装底模（L1）与组合成品（L2 `${baseSha}:${addonSha}`）采用 IndexedDB 双层高速缓存，二次换装与二次进站全部 10~30ms 内存/磁盘秒开，彻底规避重复的网络拉取与 CPU 算力浪费。

---

## 3. Chat Director & Streaming Pipeline (`chatDirector.ts`)

- **Smart Sentence Chunking (`splitIntoSpeechChunks`)**: Splits uniformly at 30~60 characters and natural punctuation (`。！？!?\n` or comma clauses), preserving natural breath rhythm.
- **Concurrent TTS Pre-fetch**: All chunks are sent to Edge-TTS via `Promise.all` in parallel as soon as text arrives, collapsing subsequent network wait to 0ms.
- **Dual-condition Preload Playback**:
  $$\text{targetPreload} = \min\big(2, \min(N, \max(1, \lceil N/3 \rceil))\big)$$
  Short sentences start in 1~2 segments instantly; long texts buffer 2 segments (~8~12s audio) before playback begins, while remaining segments are generated in the background.
- **Inter-segment Idle Takeover**: If the next playback chunk hasn't finished inference, immediately enter `emage.enterSpeakIdle()`; when the new segment is ready, call `emage.exitSpeakIdle()` and begin playback.
- **Chat Bubble Text Display Rules (`HeadBubble.tsx`)**:
  - Only render the dialogue text when `state.statusKey === 'speaking'` (i.e., when speech and motion are actively playing).
  - During `thinking`, `tts`, `emage` preparation/buffering phases, only show the corresponding micro status icon/capsule — never spoil the dialogue text early.

---

## 4. Single Source of Truth (`src/config.ts`)

When modifying any system-level configuration or parameter, follow the **centralized single source of truth** principle:
- **Motion intensity & damping**: `APP_CONFIG.emage.motion` (gesture amplitude, finger curl, chest sway, lumbar motion, pelvis micro-shift, leg follow, head uprightness, damping stiffness, temporal smoothing radius).
- **Model files & Delta addons**: `APP_CONFIG.model` (base model URL + SHA, default outfit addon, and 5 official outfit addons list).
- **Body Morph boundaries**: `APP_CONFIG.bodyMorphDefaults` and `APP_CONFIG.bodyMorphLimits` (28 orthogonal parameters, `shoulderWidth` default 1.55, range 0.75~2.50).
- **Post-processing**: `APP_CONFIG.postfx` (UnrealBloom strength/radius/threshold, toneMapping exposure, and color grading matrix).
- **Lighting & Saturation**: `APP_CONFIG.lights` (3-channel studio lighting: dir 1.00, hemi 0.95, fill 1.40) and `APP_CONFIG.saturation`.
- **Memory capacity**: `APP_CONFIG.memory` (`shortTermTurns`, `turnMaxChars`, `longTermKeep`, `longTermTopK`).

---

## 5. Common Dev Commands & Validation Workflow

```bash
# 1. Start local dev server (uses Miniflare to emulate Cloudflare Workers runtime)
pnpm dev

# 2. Strict TypeScript type check (must pass with 0 errors before any commit!)
npx tsc --noEmit

# 3. Production build
pnpm build
```

---

## 6. Commit & PR Conventions

- **Strict English-Only Commits (必须使用规范的全英文 Commit)**:
  - All commit messages **MUST be written in English**. Never use Chinese in commit messages.
  - Follow the **Conventional Commits** specification:
    * **Format**: `<type>(<scope>): <short summary in lowercase, imperative mood>`
    * **Allowed Types**: `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `chore`.
    * **Common Scopes**: `(scene)`, `(outfit)`, `(postfx)`, `(lighting)`, `(morph)`, `(motion)`, `(llm)`, `(worker)`, `(config)`, `(ui)`, etc.
    * **Imperative Mood**: Use imperative verbs ("add", "fix", "implement", "update", "refactor"), avoiding past tense ("added") or progressive ("adding").
  - **Multi-line / Squash Commit Structure**:
    * First line: high-level imperative summary (`<type>: <overall summary>`)
    * Blank line
    * Bullet points detailing individual sub-module changes in English.
  - **Examples**:
    * `feat(scene): auto-detect device dark mode for linework theme`
    * `fix(motion): eliminate 1-frame T-pose flicker during outfit swap`
    * `perf(vrmWorker): offload glTF repacking and bspatch diffing to dedicated worker`
    * `docs(agents): document VRMEngine modularization and zero-allocation performance rules`
- If changes touch motion smoothness, angular velocity, transition durations, or core dynamics parameters, update `src/config.ts`, `README-CN.md`, `README.md`, and this file accordingly.
