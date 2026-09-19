/**
 * constants.ts — 全项目 localStorage key 集中地。
 *
 * ponytail: 之前 key 字面量散落在各模块（裸字符串 / 本地 const / export），
 * 改一个 key 名要在多文件 grep。新增 key 必须在这里登记，避免重复 / 漂移。
 *
 * 规则：
 * - key 字符串值永远稳定 — 改了字面量就要走数据迁移。
 * - 同 key 不在两个文件定义字面量。
 * - 加新 key 走这里,不要在调用方写裸字符串。
 */

/** LLM 思考模式开关 (sync 协议里也被读) */
export const THINKING_PREF_KEY = 'xiaochun.thinking';

/** 当前激活的 LLM,值格式 `${webllm|custom}:${modelId|providerId}` */
export const LLM_MODEL_KEY = 'xiaochun.llm.model';

/**
 * 设备 GPU tier 评估结果缓存。
 * ponytail: 用 localStorage 而不是 sessionStorage — 关 tab 后保留,
 * 二回访问秒加载,但硬件变化 / GPU 驱动更新后用户需要手动清缓存。
 */
export const GPU_TIER_KEY = 'xiaochun.gpu_tier';

/** 服装 / 肤色 / 瞳色等 MToon 材质饱和度设置 */
export const MAT_SATURATION_KEY = 'xiaochun.mat_saturation_settings';

/** 体型微调(Bone Morph) 配置 */
export const BODY_MORPH_KEY = 'xiaochun_dev_body_morph';

/** @deprecated 原相机全量坐标已废弃，已拆分为独立的 BODY_YAW_KEY 与 CAMERA_PITCH_KEY */
export const CAMERA_STATE_KEY = 'xiaochun_camera_state';

/** 角色水平身体旋转偏角 (bodyTurn yaw, 弧度 rad) */
export const BODY_YAW_KEY = 'xiaochun_body_yaw';

/** 摄像机垂直俯仰角与视距 (polar pitch 弧度及可选 distance) */
export const CAMERA_PITCH_KEY = 'xiaochun_camera_pitch';

/** 调试滑条: 相机 + target 同步平移 Y 偏移 (米, -1 ~ +1), 用于视点微调 */
export const CAMERA_Y_OFFSET_KEY = 'xiaochun_camera_y_offset';

/** DevDrawer 所有面板的展开 / 值合并存储 */
export const DEV_DRAWER_STORAGE_KEY = 'xiaochun_dev_drawer_all_settings';

/**
 * postfx 独立存储 key — 值同 DEV_DRAWER_STORAGE_KEY (postfx 字段存在里面),
 * 但语义独立,core 模块 import 这个而不是 DEV_DRAWER_STORAGE_KEY,避免
 * 跟 dev-drawer 类型耦合。旧 stored 数据完全兼容。
 */
export const POSTFX_STORAGE_KEY = DEV_DRAWER_STORAGE_KEY;

/** DevDrawer 折叠状态(Set of section id) */
export const DEV_DRAWER_COLLAPSED_KEY = 'xiaochun_dev_drawer_collapsed';

/** DevDrawer 浮窗开 / 关 — App.tsx 头部齿轮按钮状态 */
export const DEV_DRAWER_OPEN_KEY = 'xiaochun_dev_drawer_open';
/** 当前 wearing 的 outfit addon key (null = 裸模 base)。TopHeader 持久化。 */
export const WEARING_OUTFIT_KEY = 'xiaochun_wearing_outfit';

/** 场景线稿背景主题 ('light' | 'dark')。TopHeader 场景切换持久化。 */
export const SCENE_THEME_KEY = 'xiaochun_scene_theme';

// ──────────────────────────────────────────────────────────────────
// VRM 骨骼结构常量定义 (Humanoid Bone Definitions)
// ──────────────────────────────────────────────────────────────────

/**
 * VRM 人形骨骼清单（52 根：躯干、头颈、四肢、双手与左右手各 15 个指节；不含 jaw / 眼睛）
 */
export const VRM_ALL_HUMANOID_BONES = [
  // ─ 躯干与下肢 ─
  'hips', 'spine', 'chest', 'upperChest',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot', 'leftToes', 'rightToes',

  // ─ 双臂与头颈 ─
  'neck', 'head',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand',

  // ─ 左手 15 根手指 ─
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',

  // ─ 右手 15 根手指 ─
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;

export type VRMAllHumanoidBoneName = typeof VRM_ALL_HUMANOID_BONES[number];

/**
 * MotionTransitionManager 默认过渡骨骼（躯干 + 头颈 + 四肢 + 双手 + 30 指节）。
 *
 * 手与手指必须包含在内：思考托腮 / 说话手势切回 idle 时，若只过渡手臂不过渡指节，
 * NaturalIdle 会以 weight=1 立刻写入握拳，指尖会瞬切。过渡器在跨状态窗口内
 * 从快照 Slerp 到当前驱动姿态，结束后仍由 EMAGE / NaturalIdle 单独写手指。
 *
 * 头颈通过 startTransition(lookAtOffsets) 逆四元数剔除注视与思考晃动增量，
 * 保留纯净基底姿态，避免 LookAt 二次叠加。
 */
export const VRM_MOTION_CORE_BONES = [
  // ─ 躯干与下肢 ─
  'hips', 'spine', 'chest', 'upperChest',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot', 'leftToes', 'rightToes',

  // ─ 双臂、手与头颈 ─
  'neck', 'head',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand',

  // ─ 左手 15 根手指 ─
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',

  // ─ 右手 15 根手指 ─
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;

export type VRMMotionCoreBoneName = typeof VRM_MOTION_CORE_BONES[number];

export { hasInteractionModifier, getPrimaryModifierLabel, isMacOS } from './platform';

/**
 * 桌面桌宠端辅助交互修饰键（Mac 上精准判定 Command ⌘，Windows/Linux 上精准判定 Ctrl）
 */
export const INTERACTION_MODIFIERS = ['metaKey', 'ctrlKey'] as const;

// ──────────────────────────────────────────────────────────────────
// 交互导轨（转身 / 俯仰 / 相机 Y）时序
// ──────────────────────────────────────────────────────────────────

/** 全端长按进入调整模式的时长 (ms) */
export const INTERACTION_TOUCH_ARM_MS = 480;

/** 长按期间允许的最大位移 (px)，超出则取消武装，滑动还给浏览器 */
export const INTERACTION_TOUCH_ARM_SLOP_PX = 10;

/**
 * 调整导轨自动隐藏空闲时长 (ms)。
 * 长按武装后、或松手结束拖拽后开始计时；再次交互会重置。
 */
export const INTERACTION_GUIDE_AUTO_HIDE_MS = 2800;

/**
 * 三导轨光子 / 流光共用参数（保留各自圆柱/平面绘制，不共用 Mesh）。
 * - thickness：Turn/Pitch 轨带高度；CameraY 光子宽度（米）
 * - flowUFrac：彗尾占导轨纹理 U 的比例（三轨绘制同一占比）
 * - cameraLength：CameraY 光子平面沿轨长度（米）
 */
export const INTERACTION_GUIDE_PHOTON = {
  thickness: 0.056,
  flowUFrac: 0.55,
  cameraLength: 0.50,
} as const;

