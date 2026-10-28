# AI 工具使用说明 (AI_USAGE.md)

> 项目：小蠢 (XiaoChun) · 分支 `feature/interactive-scene-flow`（`main..HEAD` 154 个提交，2026-10-26 → 2026-10-29）。
> 原则：AI 负责写代码、调研、出方案和文档草稿；需求取舍、体验判断和最终验收由人完成。下面只写能在仓库、提交记录和文档里核对的内容。

---

## 1. 使用了哪些 AI 工具

- **工具清单**（Codex、Claude Code、Cursor、v0 等）：
  1. **Gemini 3.8 Flash**：主力编码模型。负责绝大部分业务代码、重构和单元测试的编写；遇到技术选型时也用它生成多方案对比。
  2. **Grok + Grok Bot**（Grok Bot 作为协调者，可调度多个助手）：调研与资料检索；整理 coding test 资料（题目对照、功能审计）；核对文档与项目进度（例如逐条对照题目 PDF 生成功能审计与批注版 PDF、检查 README / 开发日志与代码是否一致）；提出方案建议。
  3. **MiniMax**：各种 HTML 方案试验与辅助工作：生成对比用的音效样本、把搜集来的界面方案做成对比页、在主力模型 token 不够时充当 sub-agent 分担任务、从公开仓库搜集 `.vrma` 动作素材。（另外，项目代码里 MiniMax 只作为可选的 STT / TTS / LLM Provider 模板出现（`src/llm/customProvider/types.ts`），默认链路不使用。）

---

## 2. AI 主要参与了哪些工作

- **具体参与环节**：
  - 架构设计与方案推导：Grok / Grok Bot 调研并给出方案，Gemini 3.8 Flash 输出方案对比，由人拍板。可在文档中核对的决策包括：全双工打断与 `TurnState` 单一状态源（`docs/INTERACTIVE_FLOW_LOG.md`）、STT 云端优先 + 本地熔断兜底（`docs/STT.md` §7）、剧情导演协议与节拍生命周期（`docs/STORY_DIRECTOR.md`）、Act 0 剧本的多版设计与台词审阅（coding test 资料中的 `story0/DESIGN.md`、`SCRIPT_REVIEW.md`）。
  - 业务代码编写与重构：主要由 Gemini 3.8 Flash 完成，覆盖本分支的主要模块：剧情导演引擎与 Act 0《序章·初遇小蠢》（`src/story/`、`src/components/story/`），镜头导演与视角回归（`cameraDirector.ts`、`viewReturn.ts`），语音链路（Silero VAD、漏音门控、`sttDispatcher` 熔断），动作管线（倾听态、`preserveMotion`、手指微淡入），GPU 上下文释放与分片预热，zh / en / ja 国际化（822 key）及 `check:cjk` 检查脚本。
  - 自动化测试用例生成：测试由 AI 随功能一起编写。2026-10-29 实测 `pnpm vitest run`：63 个测试文件 / 549 项全部通过；`tsc --noEmit` 0 错误。剧本 linter（`src/story/__tests__/prologueStory.test.ts`）会校验剧情图可达性、三语齐全和 id 存在性。
  - 样式与交互原型排版：剧场 UI（电影遮幅、字幕条、选项卡、相机任务卡、移动端 / PC 双布局）、`ChatBubble` 打字机字幕，以及录屏辅助的黑板演播台 `docs/coding-test/chalkboard.html`。
  - 文档：`docs/*.md` 技术文档的编写与英文化，本交付 README / AI_USAGE 的初稿（Grok Bot 根据代码、提交和审计整理，人工审阅）。
  - 素材：TODO（请确认是否用 AI 生成过素材，例如 `public/scene/beach3d/clouds.webp`、`palm-frond.webp`；仓库文档 `docs/BEACH3D_SCENE.md` 只写了"手绘风格贴图"，没有写来源）。部分 `.vrma` 动作素材由 MiniMax 协助从公开仓库搜集，之后经 `scripts/slice-vrma.mjs` 切片 / 修整入库（TODO：逐个补齐来源仓库与许可证，未核实前不要再分发）。角色模型由 VRoid Studio 制作，BGM / 音效由代码程序化合成，默认语音为 Edge TTS。

---

## 3. 哪些关键结果经过了人工验证

- **核心验证项与准则**：
  1. **`.vrma` 动作逐个人工核对 + 指导 AI 写脚本精修（最耗时、也最重要）**：从公开仓库搜集来的动捕动作，逐个在角色身上实际播放检查：滑步、悬空 / 下沉、循环接缝跳变、横向晃出裙摆、起播偏心、废帧。根据发现的问题，指导 AI 编写和迭代精修工具 `scripts/slice-vrma.mjs`（本期在 `scripts/` 下唯一新增的 VRMA 处理脚本，`0135112` 起，后续在 `5ea26a4` / `c0576d5` / `00d4922` / `7a5c935` 中扩展），主要模式：
     - 按时间区间切片：剥离头尾废帧 / 标定帧，时间戳重新归零；
     - `--seamless`：末尾用五次平滑曲线缝回首帧，消除循环接缝；
     - `--zero-z` / `--zero-z-all`、`--zero-x` / `--zero-x-all`：首帧相对或全帧归零前后 / 横向位移，消除后退、突进和偏心；
     - `--hips-y-offset`：微调骨盆高度，消除悬空 / 下沉；
     - `--scan`：动捕质量诊断（检查跳变、漂移等问题）；
     - `--optimize` / `--optimize-all`：无损精简（帧率上限 30 FPS、去掉未映射骨骼与冗余静态关键帧）。
     原始动捕素材保留在 `public/vrm/motion/raw/`（27 个，便于重复精修），当前入库 35 个动作，并统一登记在 `MOTION_CATALOG`。
  2. **动作管线正确性**：人工核对"自定义动作 ↔ 思考态 ↔ EMAGE 说话手势 ↔ 待机"的切换。包括说话时保留指定动作、动作播完由 EMAGE 无缝接管（`7aab7f0`），动作切入时手指不跳变（0.34 s 微淡入，`f49b459`），剧情拍的 `leadInMotion` / `motion` 在说话时不被打断（`2d71fa2`）。同时确认普通聊天的思考 → 说话流程不受影响。
  3. **语音打断**：在桌面和手机上实测：角色说话时开口，语音立刻停止并切到倾听（`3b55161`）；扬声器回声不会让角色打断自己（漏音门控，`d8079e4`）；按钮状态与真实状态一致（`e05dd36`）；被打断那一轮的迟到回复和旧转写不会再冒出来（`ac5493a`）。
  4. **方案核查与对比**：对 AI 给出的多种方案逐一核查后再选型，包括：
     - 更好的 STT：本地 SenseVoice、2-pass（本地草稿 + 云端定稿）、纯云端 Whisper，最终默认纯云端 + 本地熔断兜底（`878714c`、`66c7c35`、`c12527b`）；
     - UI / UX 交互：剧场字幕与选项卡布局、打字与语音两种打断方式的区分、相机任务卡只认用户真实手势（`68695dd`）；
     - 用 HTML 对比页横向比较各种方案（音效、界面方案等）后再定稿。
  - 另外，每次合入前看自动化门禁的实际输出：`pnpm vitest run`（当前 63 个文件 / 549 项通过）、`tsc --noEmit`、`pnpm check:i18n`、`pnpm check:cjk`。部署后在线上 <https://xiaochun.firetable.tech/> 走完 Act 0 与聊天流程。

---

## 4. 一个 AI 生成结果存在问题、你发现并修正它的例子

> TODO：以下为主推候选（动作管线），请确认细节（尤其是"如何发现"）；备选见文末。

- **问题现象与描述**：角色"说话时的动作"被抢走。Act 0 每一拍都指定了表演动作（如第 2 拍被抓包后的 `angryJump` 跺脚、第 6 拍的 `joyfulJump`），但台词一开口，动作就被切成"思考姿态"，再被 EMAGE 说话手势顶掉，表演只剩一个开头。修好这一点之后又出现了反方向的问题：动作播完后 EMAGE 不接手，角色在后半句话里僵住，舞蹈这类循环动作在说完之后也停不下来。
- **AI 初始生成结果的缺陷或局限**：AI 写的说话链路默认"每次说话都先进思考态（`thinking.vrma`），再由 EMAGE 接管骨骼"，没有考虑"外部指定动作 + 同时说话"这种组合。第一次修复（`ad3c0c9`）又是 AI 给的"全局隐式规则"：只要有动作在播，就跳过思考态，`beginEmageSpeech()` 也直接 return。这样虽然不切动作了，但所有说话场景都受影响：EMAGE 再也接不上，结束时也不回待机。
- **人工分析与定位的根因**：根因是"说话时是否保留当前动作"是**调用方的意图**，不应该由管线根据"当前有没有动作在播"去猜。剧情拍（`leadInMotion` / `motion`）和协议调用方知道自己要什么，普通聊天则应保持原有的思考 → 说话流程。同时，管线的写入源优先级（clip > emage > vrma > idle）本来就支持"动作播完后自动切到 EMAGE"，前提是 EMAGE 在后台一直在生成，而不是被直接 return 掉。
- **人工发现并修正后的方案及效果**：
  1. `7aab7f0`：引入显式的 `preserveMotion` 选项，贯穿 `speakText` / `say` / `window.xiaochun` SDK / 协议。开启时不进思考态，自定义动作继续驱动骨骼，EMAGE 在后台照常生成，动作播完由 `selectLiveMotionSource` 无缝交给 EMAGE；说完后恢复 NaturalIdle。不开启时行为与原来一致。
  2. `f49b459`：动作切入时手形在第 0 帧"跳变"（手指跟着 0.75 s 全身淡入，要么跳要么拖），改成手指单独 0.34 s 五次平滑微淡入，参数收进 `APP_CONFIG.motionPipeline`，并加 `fingerFade.test.ts` 验证第 0 帧连续、0.34 s 收敛。
  3. `2d71fa2`：发现剧情引擎调用 `speakText` 时没传这个标志，所以 Act 0 仍然被打断。改为拍子带 `leadInMotion` / `motion` 时传 `preserveMotion: true`，并在 `storyEngineFlow` 回归测试里断言这个参数。
  - 效果：Act 0 的表演动作能完整播完并自然接上说话手势，普通聊天的思考 / 说话流程不受影响；当前全量测试 549 项通过。

---

<!-- 备选候选（供选择，确认后可替换上面的主例或删除）：
  A. Act 0 重写丢了核心流程：8458424 用新的 cameraTask（转 35° / 缩放 20% 自动判定 + 6 s 兜底台词）和 inputReply（固定回复）重写了序章交互，破坏了原有"教学卡 + 按钮推进"的核心流程；人工试玩后在 ed8719f 回到原来的 camera_drag 卡片 + 按钮机制（删除约 537 行），f78fb8d 恢复固定"暗号卡"与选大脑拍。
  B. 相机任务卡被导演运镜"自动打勾"：任务进度原来通过对比相机状态计算，导演运镜、fitCamera、回到默认视角都会让"缩放 / 环绕"被判为完成；68695dd 改为只统计真实用户手势（指针 turn 手势 + InteractionController.onUserZoom），并加 userZoom / cameraTaskProgress 测试。
  C. 审计发现依赖未声明：分支代码直接 import zod 与 @pixiv/three-vrm-springbone，但 package.json 没有声明，在干净环境安装后无法解析（Grok Bot 只读审计发现，2026-10-28 约 22:00）；c5f48aa 补齐依赖。
-->
