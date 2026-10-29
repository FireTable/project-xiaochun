# AI 工具使用说明 (AI_USAGE.md)

> 分支 `feature/interactive-scene-flow`（相对 `main` 156 个提交，截至 `2a33aa6`，2026-10-26 → 2026-10-29）。AI 负责写代码、调研、出方案和文档草稿；需求取舍、体验判断和最终验收由人完成。

---

## 1. 使用了哪些 AI 工具

- **工具清单**（Codex、Claude Code、Cursor、v0 等）：
  1. **Gemini 3.8 Flash**：
     - 主力编码模型。
     - 负责绝大部分业务代码、重构和单元测试。
     - 遇到技术选型时也用来生成多方案对比。
  2. **Grok + Grok Bot**：
     - 调研与检索
     - 整理 coding test 资料
     - 核对文档与项目进度（对照题目 PDF 做功能审计与批注）
     - 提出方案建议
     - 对 `main...HEAD` 做了多轮交叉安全 / 性能审计：
       - 两路审查、投票评分，第一轮 6–6.5 / 10，修复无风险项后复审 7.5–8 / 10
       - 按共识修复无风险项（`1f85ad8`、`889fd73`、`fb46c46` Origin 白名单），有风险项交人拍板
     - 补充和整理 coding test 文档（结构化，并对照代码核实）
  3. **MiniMax**：
     - 各种 HTML 方案试验：
       - 生成对比用音效
       - 把搜集的界面方案做成对比页
       - 主力模型 token 不够时充当 sub-agent
       - 从公开仓库搜集 `.vrma` 动作素材
     - （代码里 MiniMax 只是可选的 STT / TTS / LLM Provider 模板，默认链路不使用。）

---

## 2. AI 主要参与了哪些工作

- **具体参与环节**：
  - 架构设计与方案推导：
    - Grok / Grok Bot 调研并给出方案，Gemini 输出多方案对比，由人拍板
    - 涉及：全双工打断、`TurnState`、STT 熔断兜底、剧情导演协议、Act 0 多版设计
  - 业务代码编写与重构：
    - 主要由 Gemini 完成
    - 涉及：剧情导演与 Act 0、镜头导演、语音链路、动作管线（倾听态、`preserveMotion`、手指微淡入）、GPU 资源治理、三语国际化
  - 自动化测试用例生成：
    - 测试随功能一起编写。
    - 当前 `pnpm vitest run`：63 个文件 / 549 项全过。
    - 剧本 linter 校验剧情图可达性与三语齐全。
  - 样式与交互原型排版：
    - 剧场 UI、字幕打字机、黑板演播台 `chalkboard.html`
    - 交付 README / AI_USAGE 初稿由 Grok Bot 整理，人工审阅
  - 素材：
    - `.vrma` 动作：大部分转换自 Adobe 开放动作库（Mixamo），少量由 MiniMax 协助从公开仓库搜集，均经 `scripts/slice-vrma.mjs` 精修入库
    - 角色由 VRoid Studio 制作
    - BGM / 音效程序化合成
    - 默认语音为 Edge TTS

---

## 3. 哪些关键结果经过了人工验证

- **核心验证项与准则**：
  1. **`.vrma` 动作逐个人工核对 + 指导 AI 写脚本精修（最耗时、也最重要）**：
     - 转换自 Adobe 开放动作库（Mixamo）或从公开仓库搜集的动捕，逐个在角色身上检查滑步、悬空 / 下沉、循环接缝、横向晃出裙摆、起播偏心、废帧。
     - 据此指导 AI 编写并迭代 `scripts/slice-vrma.mjs`（本期新增的 VRMA 精修脚本，`0135112` 起，后经 `5ea26a4` / `c0576d5` / `00d4922` / `7a5c935` 扩展）：
       - 按时间切片
       - `--seamless` 缝合循环
       - `--zero-x/z`（首帧相对或全帧）归零位移
       - `--hips-y-offset` 调骨盆高度
       - `--scan` 诊断
       - `--optimize` 无损精简
     - 原始素材在 `public/vrm/motion/raw/`（27 个），当前入库 35 个，登记在 `MOTION_CATALOG`。
  2. **动作管线正确性**：
     - 核对"自定义动作 ↔ 思考 ↔ EMAGE ↔ 待机"的切换：
       - 说话时保留指定动作并由 EMAGE 接力（`7aab7f0`）
       - 手指切入不跳变（`f49b459`）
       - 剧情拍动作说话时不被打断（`2d71fa2`）
     - 普通聊天的思考 → 说话流程不受影响。
     - 对动作系统做了大量重构，并逐项人工验证：
       - 动作目录与解析：
         - 统一的 `MOTION_CATALOG`（`src/motion/catalog.ts`，35 个动作；`91ee0b2` 建立，`b672b46` 加入别名解析 `motionResolver.ts` 和开发抽屉动作预览，`57c74a4` 全面整理）
         - `resolveMotionUrl()` 把语义 ID、kebab-case 别名和历史命名统一解析为带版本号的 `.vrma` 路径
       - 动作组：
         - `MOTION_GROUPS`（8 组：`outfitShowcase` / `idleFlavor` / `listening` / `thinking` / `greeting` / `praiseCute` / `playfulSulking` / `dancePerformance`），按权重由 `selectMotionFromGroup()` 随机抽取（`a1c1a2e` 引入情境动作组、待机微动作调度和冷启动迎客）
         - 组内动作 id 与 `MOTION_CATALOG` 在类型上强关联（`satisfies`），动作被删除或改名会直接报类型错误
         - 换装展示走 `outfitShowcase` 组（`5633681`）
       - 使用方法：
         - 引擎接口：`vrmEngine.playMotion(id | url, options)`、`playMotionGroup(group, options)`、`stopMotion(fade)`
         - 选项：`fadeDuration`、`loop`、`timeScale`、`mask`、`timeRange`、`enableFootIK`、`disableGaze`、`onEnd` 等（`PlayMotionOptions`）
         - 同一套能力也通过 `xiaochun://` 协议和 SDK 的 `motion` / `motion-group` 暴露（`c5f48aa`；`a812d1a` 把 `group` 改名为 `motion-group` 并保持向后兼容）
       - 缓存分层（`MotionAssetManager`，`src/motion/pipeline/motionAssetManager.ts`）：
         - L1：内存 ArrayBuffer 池
         - L2：IndexedDB 持久缓存
         - 网络：L1 / L2 都未命中才下载，同一 URL 的并发请求会合并
         - L3：与当前 VRM 绑定的已解析 `AnimationClip` 池，换装只清这一层，二进制缓存保留
         - 目录里 18 个标记 `warmup: true` 的动作会在启动时预热
         - `1f85ad8`：只缓存 glTF 魔数合法的文件，预热解析加代次保护（generation guard）
       - 管线稳定性：
         - `8de22d7`：播放竞态令牌（race token）、PropertyMixer 缓存失效、下半身 locomotion 遮罩
         - `d10147f`：没被动画驱动的骨骼不再互相污染（从 basePose 填充）
         - `793cde6`：消除腿部外八，`MotionPipeline.bind()` 幂等
         - `59b6774`：换装后的过期 VRM 指针、骨骼复位和过渡跳变
     - 动作引起的视觉问题也逐个人工检查：
       - 胸部穿模：
         - `3a339da`：手臂碰撞体接入胸部弹簧骨
         - `d7d91b4`：蒙皮后把手臂顶点推出胸前椭球（上限 2 cm）
         - `228b638`、`9abf189`：缩放后的胸部不穿出衣服，衣服按胸骨形状贴合
         - `494a9a4`：改为依赖 GPU 骨骼蒙皮完成胸部衣服贴合；单元测试 `src/core/spring/bustClothFit.test.ts`
       - 腰部伸展 / 躯干弯曲时的衣服变形：
         - `1f217df`：脊柱、胸、上胸去掉非均匀缩放带来的 7.54° 剪切；`harmonizeTorsoCurvature`（`src/motion/vrmaRetarget.ts`）把超过 17° 的极端反向弯曲分摊到腰椎和胸椎；单元测试 `torsoDecoupling.test.ts`
         - `cac1bd9`：大腿矩阵与髋部非均匀缩放解耦，避免脚下沉
       - 动捕素材本身：`antiClip` 默认关闭，标准动捕保持原生，避免 A-Pose / 翅膀悬空畸变（`91ee0b2`）；滑步、悬空、循环接缝、裙摆横向晃出等用 `scripts/slice-vrma.mjs` 精修（见第 1 项）
  3. **语音打断**：
     - 角色说话时开口，语音立刻停止并切到倾听（`3b55161`）
     - 扬声器回声不会让角色打断自己（`d8079e4`）
     - 按钮状态与真实状态一致（`e05dd36`）
     - 被打断那一轮的迟到回复和旧转写不会再冒出来（`ac5493a`）
  4. **场景 24 小时变化**（`beach3d` 海滩，需要大量验证）：
     - 位置与引入：`src/core/scene/beach3d/beach3dTime.ts`；`8824215` 引入太阳轨迹与时间流转，`514b8a6` 加入 `SceneTimeCard` 24 小时天体面板
     - 24 小时内实际变化：
       - 光源方向：
         - 白天太阳走一条弧线，正午最高，17:45 贴近海平线、影子很长
         - 夜间月亮沿同一条弧接替，日出日落两侧的交接点重合，地上的影子不会横扫
       - 色彩：
         - 白天（12:00）、落日（17:45）、夜晚（22:00）三套基准调色板，按平滑步阶连续混合
         - 07:00–16:30 纯白天，16:30–17:45 渐入落日，17:45–19:30 渐入夜晚，19:30–05:00 纯夜晚
         - 05:00–06:00 拂晓借用落日暖色，06:00–07:00 回到白天
       - 随时间变化的对象：天空、海水、沙滩、远山群岛、云、植被、礁石、躺椅 / 遮阳伞、沙堡、灯塔（夜里亮起，塔身沉入夜色）、阴影染色
       - 角色打光：主光、半球光、补光与场景太阳同向，角色影子与道具影子保持一致（`5baeb85`）
     - 时间模式：`auto`（跟随真实时间）、`weeHours` / `dawn` / `noon` / `dusk` / `day` / `sunset` / `night` 预设，或 0–24 的小时数值（`environmentTime.ts`、`resolveEffectiveHour`）
     - 验证：
       - 人工逐时段检查画面，并修复夜间海平线虚线（`f2165cc`、`3cebc18`）
       - 单元测试 `src/core/scene/__tests__/beach3dTime.test.ts`：方向向量归一化、正午与原配置零差异、17:45 / 22:00 权重、24 小时光照方向连续无突变等
       - 剧情里从浏览器本地时间减 12 小时扫到此刻，再切回跟随真实时间（`9b07ac4`，`src/story/timeOfDay.ts`）
  5. **方案核查与对比**：
     - 对 AI 给出的多种方案逐一核查后再选型：
       - STT（本地 / 2-pass / 纯云端，最终默认纯云端 + 本地熔断，`878714c`、`66c7c35`、`c12527b`）
       - UI / UX（字幕与选项卡布局、打字与语音打断区分、相机任务卡只认用户手势 `68695dd`）
     - 用 HTML 对比页横向比较音效、界面等方案后再定稿。
  - 另外，合入前查看自动化门禁的实际输出，并在线上 <https://xiaochun.firetable.tech/> 走完 Act 0 与聊天流程。

---

## 4. 一个 AI 生成结果存在问题、你发现并修正它的例子

- **问题现象与描述**：
  - Act 0 每一拍都指定了表演动作（如被抓包后的 `angryJump`），但台词一开口，动作就被切成思考姿态，再被 EMAGE 说话手势顶掉，表演只剩一个开头。
  - 修好这一点之后又出现反方向的问题：动作播完后 EMAGE 不接手，角色在后半句话里僵住，舞蹈类循环动作说完也停不下来。
- **AI 初始生成结果的缺陷或局限**：
  - 说话链路默认"每次说话都先进思考态，再由 EMAGE 接管骨骼"，没有考虑"外部指定动作 + 同时说话"。
  - 第一次修复（`ad3c0c9`）又是全局隐式规则：只要有动作在播就跳过思考态、`beginEmageSpeech()` 直接 return——不切动作了，但 EMAGE 再也接不上，结束时也不回待机。
- **人工分析与定位的根因**：
  - "说话时是否保留当前动作"是调用方的意图，不该由管线根据"当前有没有动作"去猜。
  - 剧情拍和协议调用方知道自己要什么；普通聊天应保持思考 → 说话。
  - 管线写入源优先级本来就支持"动作播完后自动切到 EMAGE"，前提是 EMAGE 在后台一直在生成。
- **人工发现并修正后的方案及效果**：
  1. `7aab7f0`：引入显式 `preserveMotion`，贯穿 `speakText` / `say` / SDK / 协议。开启时不进思考态，自定义动作继续驱动骨骼，EMAGE 后台照常生成，动作播完无缝交给 EMAGE；说完后恢复待机。不开启时行为与原来一致。
  2. `f49b459`：动作切入时手形第 0 帧跳变，改成手指单独 0.34 s 微淡入，并加回归测试。
  3. `2d71fa2`：剧情引擎调用 `speakText` 时没传标志，Act 0 仍被打断；改为拍子带 `leadInMotion` / `motion` 时传 `preserveMotion: true`。
  - 效果：Act 0 表演动作能完整播完并自然接上说话手势，普通聊天不受影响；当前全量测试 549 项通过。
