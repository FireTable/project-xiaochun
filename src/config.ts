/**
 * Project XiaoChun 全局配置中心与单一可信源 (Single Source of Truth)
 */

export interface LightChannelConfig {
  base: number;
  enabled: boolean;
}

export interface LightConfig {
  dir: LightChannelConfig;
  hemi: LightChannelConfig;
  front: LightChannelConfig;
  fill: LightChannelConfig;
  leg: LightChannelConfig;
  arm: LightChannelConfig;
  globalMult: number;
}

export interface MaterialSaturationConfig {
  preset: 'vibrant' | 'sweet' | 'cinematic' | 'original' | 'custom';
  clothing: number;
  hair: number;
  eyes: number;
  skin: number;
}

export interface EmageMotionConfig {
  gestureIntensity: number;      // 手臂幅度缩放 (0.1~1.0，默认 1.0 满额手势)
  fingerIntensity: number;       // 指关节活跃度 (0.1~1.0，默认 0.5，保持柔和半卷，消除乱指)
  torsoIntensity: number;        // 胸腔微动权重 (默认 0.75，保留自然呼吸与起伏)
  spineIntensity: number;        // 腰椎微动权重 (默认 0.3，自然微屈与说话起伏)
  hipIntensity: number;          // 骨盆/胯部微动权重 (默认 0.70，赋予活人重心微移与说话律动)
  legIntensity: number;          // 双腿跟随权重 (默认 0.70，配合骨盆重心自然微动，足部由 FootIK 稳妥贴地)
  headIntensity: number;         // 头部/颈部权重 (默认 0.80，防止脖子前伸乌龟颈，保持抬头挺胸)
  dampingStiffness: number;      // 惯性阻尼刚度 (默认 4.2，数值越小越柔顺轻盈，消除“动得太快”)
  temporalSmoothRadius: number;  // 时序高斯平滑半径 (默认 12 帧/约0.8s，消除“切换太频繁”)
}

export interface BodyMorphConfig {
  // 全身与整体
  overallScale: number;     // 全身大小 (默认 1.00，范围 0.70 ~ 1.30)

  // 头部与颈部
  head: number;             // 头部比例/头身比 (默认 1.00，范围 0.85 ~ 1.20)
  neck: number;             // 颈部左右宽度 (兼容旧配置，默认 1.00，范围 0.70 ~ 1.40)
  neckDepth: number;        // 颈部前后深度 (默认 1.00，范围 0.70 ~ 1.40)
  neckLength: number;       // 颈部长短 (默认 1.00，范围 0.80 ~ 1.30)

  // 躯干、肩宽与腰臀
  shoulderWidth: number;    // 肩宽 (默认 1.00，范围 0.75 ~ 1.35)
  torsoLength: number;      // 躯干长度 (默认 1.00，范围 0.75 ~ 1.35)
  torsoThickness: number;   // 躯干厚度 (默认 1.00，范围 0.70 ~ 1.40，统一控制胸背与腰腹前后厚度)
  waist: number;            // 纤细腰部 (默认 1.00，范围 0.70 ~ 1.40，控制腰部横向宽度)
  belly: number;            // 肚子大小 (默认 1.00，范围 0.70 ~ 1.80，纯粹控制小腹平坦或微凸，绝不影响后腰)
  hips: number;             // 胯部左右宽度 (默认 1.00，范围 0.70 ~ 1.50)
  buttocks: number;         // 臀部大小 (默认 1.00，范围 0.70 ~ 1.20，对齐胸部大小)
  buttocksThickness: number;// 臀部厚度 (默认 1.00，范围 0.70 ~ 1.20，对齐胸部厚度，纯Z轴后凸，绝不改变身长)
  buttocksPitch: number;    // 臀部纵向朝向 (俯仰角弧度，默认 0.00，范围 -0.20 ~ +0.20，对齐胸部纵向朝向)
  buttocksSpread: number;   // 臀部宽度 (假胯与臀外侧丰满度，默认 0.00，范围 -0.05 ~ +0.08)

  // 胸部精细形变 (VRoid 规范)
  bust: number;             // 胸部大小 (默认 1.00，范围 0.60 ~ 2.20)
  bustThickness: number;    // 胸部厚度 (默认 1.00，范围 0.60 ~ 1.80)
  bustPitch: number;        // 胸部纵向朝向 (俯仰角弧度，默认 0.00，范围 -0.30 ~ +0.30)
  bustSpread: number;       // 胸口敞开程度/外扩 (水平散开偏移，默认 0.00，范围 -0.04 ~ +0.06)

  // 上肢与手部
  arms: number;             // 手臂粗细 (默认 1.00，范围 0.70 ~ 1.40)
  armLength: number;        // 手臂长度 (默认 1.00，范围 0.80 ~ 1.20)
  hands: number;            // 手部大小 (默认 1.00，范围 0.70 ~ 1.30)
  fingerWidth: number;      // 手指粗细 (默认 1.00，范围 0.60 ~ 1.50)

  // 下肢与足部
  thighs: number;           // 大腿粗细 (默认 1.00，范围 0.70 ~ 1.60)
  thighLength: number;      // 大腿长度 (默认 1.00，范围 0.80 ~ 1.30)
  calves: number;           // 小腿粗细 (默认 0.86，范围 0.70 ~ 1.50)
  calfLength: number;       // 小腿长度 (默认 1.00，范围 0.80 ~ 1.30)
  feet: number;             // 脚掌/鞋子大小 (默认 1.00，范围 0.70 ~ 1.30)
}

export type BodyMorphPartKey = keyof BodyMorphConfig;

export type ModelPartCategory = 'clothing' | 'accessory' | 'hair' | 'face' | 'body';

export interface ModelPartCategoryDefinition {
  id: ModelPartCategory;
  label: string;
  icon: string;
}

export interface ModelPartDefinition {
  id: string;
  category: ModelPartCategory;
  label: string;
  icon: string;
  defaultVisible?: boolean;
}

export interface WardrobeConfig {
  categories: ModelPartCategoryDefinition[];
  parts: ModelPartDefinition[];
  defaultVisibility: Record<string, boolean>;
}

export const APP_CONFIG = {
  brand: {
    name: 'Project XiaoChun',
    logo: '/logo.png',
    favicon: '/favicon.png',
    github: 'https://github.com/FireTable/project-xiaochun',
  },
  model: {
    defaultVrm: '/xiaochun_v1.vrm',
    defaultName: '小蠢 (xiaochun_v1)',
  },
  // ponytail: EMAGE ONNX 模型文件基础 URL。
  // 生产环境 (PROD) 始终强制走 Cloudflare R2 (https://cdn.firetable.tech/xiaochun)；
  // 本地 dev: 在 .env.local 设 VITE_EMAGE_BASE=/onnx 即回到 public/onnx 软链。
  emage: {
    base: Boolean(import.meta.env?.PROD)
      ? ((import.meta.env?.VITE_EMAGE_BASE_PROD as string | undefined) ?? 'https://cdn.firetable.tech/xiaochun')
      : ((import.meta.env?.VITE_EMAGE_BASE as string | undefined) ?? '/onnx'),
    cacheName: 'emage-models-v1',
    // ─── 动作速度与频率优化权威配置 ───
    motion: {
      gestureIntensity: 1.0,      // 手臂幅度缩放 (0.1~1.0，默认 1.0 满额手势)
      fingerIntensity: 0.5,       // 指关节活跃度 (0.1~1.0，默认 0.5，保持柔和半卷，消除乱指)
      torsoIntensity: 0.75,       // 胸腔微动权重 (默认 0.75，保留自然呼吸与起伏)
      spineIntensity: 0.3,        // 腰椎微动权重 (默认 0.3，自然微屈与说话起伏)
      hipIntensity: 0.70,         // 骨盆/胯部微动权重 (默认 0.70，赋予活人重心微移与说话律动)
      legIntensity: 0.70,         // 双腿跟随权重 (默认 0.70，配合骨盆重心自然微动，足部由 FootIK 稳妥贴地)
      headIntensity: 0.80,        // 头部/颈部权重 (默认 0.80，防止脖子前伸乌龟颈，保持抬头挺胸)
      dampingStiffness: 4.2,      // 惯性阻尼刚度 (默认 4.2，数值越小越柔顺轻盈，消除“动得太快”)
      temporalSmoothRadius: 12,   // 时序高斯平滑半径 (默认 12 帧/约0.8s，消除“切换太频繁”)
    } as EmageMotionConfig,
  },
  // WebLLM 模型 id。改 model 即可换模型,必须是 WebLLM 预置表里的 model_id。
  // 在线列表: https://github.com/mlc-ai/web-llm/blob/main/src/config.ts
  //   打开后搜 `prebuiltAppConfig` → `model_list` → 复制 `model_id`。
  // 在线试跑: https://chat.webllm.ai/
  // 本机已安装的那份: node_modules/@mlc-ai/web-llm 里搜 `model_id:`。
  // 命名: q4f16_1 = 4bit 权重(小); q0f16 = 近 fp16(更大更准)。手机建议 ≤2B。
  // 加载失败会改用 fallback。
  // thinking: Qwen3 / Qwen3.5 的思考链。true=先想再答(更慢、更占 GPU);false=直接答。
  // 模型选项来自 WebLLM prebuiltAppConfig,按 provider 分组,同一模型优先 q4f16_1。
  llm: {
    model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    fallback: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    thinking: false,
  },
  // 端侧记忆: 小模型(0.5B/1.5B)对注意力与上下文长度极敏感，控制在 2 轮防止复读、人设漂移及 prefill 延迟
  memory: {
    shortTermTurns: 2,
    turnMaxChars: 120,
    // ponytail: 用户在「对话设置」可手动覆盖的范围 — UI slider 和 IDB setter 共用这一份,
    // 改了这里两边同步生效,避免 setter 上限跟 slider 不一致(以前踩过这个坑)。
    userTurnsMin: 1,
    userTurnsMax: 50,
  },
  camera: {
    defaultFov: 20,
    minFov: 15,
    maxFov: 60,
    defaultPosition: [0.0, 1.5, 3.6] as [number, number, number],
    defaultTarget: [0.0, 1.2, 0.0] as [number, number, number],
    // ponytail: 默认推镜按"想看多高(米)"反推距离 = extent / (2*tan(fov/2)),
    // 这样 FOV 20° 跟 60° 都能框出相同的主体大小,不会出现"长焦糊脸"。
    // 1.4m ≈ 头到小腿(半身再多一点),1.6m = 全身,0.9m = 标准半身。
    defaultShotExtent: 1.4,
    // ponytail: 鼠标滚轮 / 双指 pinch 缩放的距离上下限。改这里同时也是 devDrawer
    // "镜头距离范围" 两 slider 的默认值;运行时调整会覆盖并写 localStorage。
    defaultMinDistance: 1.0,
    defaultMaxDistance: 15.0,
  },
  renderer: {
    // iPhone 多是 3x;封顶 2 会按 2/3 分辨率画,头发和网袜特别容易锯齿。
    maxPixelRatio: 3,
  },
  lights: {
    dir: { base: 0.90, enabled: true },
    hemi: { base: 0.72, enabled: true },
    front: { base: 1.0, enabled: true },
    fill: { base: 0.70, enabled: true },
    leg: { base: 1.50, enabled: true },
    arm: { base: 0.40, enabled: true },
    globalMult: 1.0,
  } as LightConfig,
  saturation: {
    default: {
      preset: 'vibrant',
      clothing: 1.20,
      hair: 1.30,
      eyes: 1.30,
      skin: 0.95,
    } as MaterialSaturationConfig,
    presets: {
      vibrant: {
        clothing: 1.20,
        hair: 1.40,
        eyes: 1.30,
        skin: 0.95,
      },
      sweet: {
        clothing: 1.30,
        hair: 1.25,
        eyes: 1.20,
        skin: 1.05,
      },
      cinematic: {
        clothing: 1.15,
        hair: 1.10,
        eyes: 1.10,
        skin: 1.00,
      },
      original: {
        clothing: 1.00,
        hair: 1.00,
        eyes: 1.00,
        skin: 1.00,
      },
    },
  },
  bodyMorph: {
    default: {
      overallScale: 1.00,
      head: 1.00,
      neck: 1.00,
      neckDepth: 1.00,
      neckLength: 1.00,
      shoulderWidth: 1.10,
      torsoLength: 1.00,
      torsoThickness: 0.90,
      waist: 0.90,
      belly: 0.90,
      hips: 1.00,
      buttocks: 1.05,
      buttocksThickness: 1.00,
      buttocksPitch: -0.05,
      buttocksSpread: 0.002,
      bust: 1.00,
      bustThickness: 1.00,
      bustPitch: 0.10,
      bustSpread: -0.010,
      arms: 0.90,
      armLength: 1.00,
      hands: 1.00,
      fingerWidth: 1.00,
      thighs: 1.00,
      thighLength: 1.00,
      calves: 0.86,
      calfLength: 1.00,
      feet: 1.00,
    } as BodyMorphConfig,
    limits: {
      overallScale: { min: 0.70, max: 1.30, step: 0.01 },
      head: { min: 0.85, max: 1.20, step: 0.01 },
      neck: { min: 0.70, max: 1.40, step: 0.02 },
      neckDepth: { min: 0.70, max: 1.40, step: 0.02 },
      neckLength: { min: 0.80, max: 1.30, step: 0.01 },
      shoulderWidth: { min: 0.75, max: 1.35, step: 0.01 },
      torsoLength: { min: 0.75, max: 1.35, step: 0.01 },
      torsoThickness: { min: 0.70, max: 1.40, step: 0.01 },
      waist: { min: 0.70, max: 1.40, step: 0.02 },
      belly: { min: 0.70, max: 2.00, step: 0.01 },
      hips: { min: 0.70, max: 1.50, step: 0.02 },
      buttocks: { min: 0.70, max: 1.20, step: 0.01 },
      buttocksThickness: { min: 0.70, max: 1.20, step: 0.01 },
      buttocksPitch: { min: -0.20, max: 0.20, step: 0.01 },
      buttocksSpread: { min: -0.05, max: 0.08, step: 0.002 },
      bust: { min: 0.60, max: 2.20, step: 0.02 },
      bustThickness: { min: 0.60, max: 1.80, step: 0.02 },
      bustPitch: { min: -0.30, max: 0.30, step: 0.01 },
      bustSpread: { min: -0.04, max: 0.06, step: 0.002 },
      arms: { min: 0.70, max: 1.40, step: 0.02 },
      armLength: { min: 0.80, max: 1.20, step: 0.01 },
      hands: { min: 0.70, max: 1.30, step: 0.01 },
      fingerWidth: { min: 0.60, max: 1.50, step: 0.02 },
      thighs: { min: 0.70, max: 1.60, step: 0.02 },
      thighLength: { min: 0.80, max: 1.30, step: 0.01 },
      calves: { min: 0.70, max: 1.50, step: 0.02 },
      calfLength: { min: 0.80, max: 1.30, step: 0.01 },
      feet: { min: 0.70, max: 1.30, step: 0.01 },
    },
  },
  wardrobe: {
    categories: [
      { id: 'clothing', label: 'panel.partCategories.clothing', icon: '👗' },
      { id: 'accessory', label: 'panel.partCategories.accessory', icon: '👓' },
      { id: 'hair', label: 'panel.partCategories.hair', icon: '💇‍♀️' },
      { id: 'face', label: 'panel.partCategories.face', icon: '🎭' },
      { id: 'body', label: 'panel.partCategories.body', icon: '🧍‍♀️' },
    ] as ModelPartCategoryDefinition[],
    parts: [
      // 1~9: VRoid 官方服装部件规范
      { id: 'tops', category: 'clothing', label: 'panel.partItems.tops', icon: '👚', defaultVisible: true },
      { id: 'bottoms', category: 'clothing', label: 'panel.partItems.bottoms', icon: '👖', defaultVisible: true },
      { id: 'dress', category: 'clothing', label: 'panel.partItems.dress', icon: '👗', defaultVisible: true },
      { id: 'neckwear', category: 'clothing', label: 'panel.partItems.neckwear', icon: '👔', defaultVisible: true },
      { id: 'armwear', category: 'clothing', label: 'panel.partItems.armwear', icon: '🧤', defaultVisible: true },
      { id: 'inner_top', category: 'clothing', label: 'panel.partItems.inner_top', icon: '🩱', defaultVisible: true },
      { id: 'inner_bottom', category: 'clothing', label: 'panel.partItems.inner_bottom', icon: '🩲', defaultVisible: true },
      { id: 'legwear', category: 'clothing', label: 'panel.partItems.legwear', icon: '🧦', defaultVisible: true },
      { id: 'shoes', category: 'clothing', label: 'panel.partItems.shoes', icon: '👟', defaultVisible: true },

      // 10: VRoid 官方饰品部件规范
      { id: 'accessory', category: 'accessory', label: 'panel.partItems.accessory', icon: '👓', defaultVisible: true },

      // 发型部件
      { id: 'hair_front', category: 'hair', label: 'panel.partItems.hair_front', icon: '🎀', defaultVisible: true },
      { id: 'hair_main', category: 'hair', label: 'panel.partItems.hair_main', icon: '💇‍♀️', defaultVisible: true },
      { id: 'hair_back', category: 'hair', label: 'panel.partItems.hair_back', icon: '💆‍♀️', defaultVisible: true },

      // 面部部件
      { id: 'face_skin', category: 'face', label: 'panel.partItems.face_skin', icon: '👧', defaultVisible: true },
      { id: 'face_brows', category: 'face', label: 'panel.partItems.face_brows', icon: '🤨', defaultVisible: true },
      { id: 'face_eyelines', category: 'face', label: 'panel.partItems.face_eyelines', icon: '👁️', defaultVisible: true },
      { id: 'face_highlights', category: 'face', label: 'panel.partItems.face_highlights', icon: '✨', defaultVisible: true },
      { id: 'face_irises', category: 'face', label: 'panel.partItems.face_irises', icon: '🟣', defaultVisible: true },
      { id: 'face_mouth', category: 'face', label: 'panel.partItems.face_mouth', icon: '👄', defaultVisible: true },

      // 体型/素体部件
      { id: 'body_skin', category: 'body', label: 'panel.partItems.body_skin', icon: '🧍‍♀️', defaultVisible: true },
    ] as ModelPartDefinition[],
    // 部件默认可见性配置表（修改此处即可在加载时决定默认穿脱状态）
    defaultVisibility: {
      tops: true,
      bottoms: true,
      dress: true,
      neckwear: true,
      armwear: true,
      inner_top: true,
      inner_bottom: true,
      legwear: true,
      shoes: true,
      accessory: true,
      hair_front: true,
      hair_main: true,
      hair_back: true,
      face_skin: true,
      face_brows: true,
      face_eyelines: true,
      face_highlights: true,
      face_irises: true,
      face_mouth: true,
      body_skin: true,
    } as Record<string, boolean>,
  },
  expressions: [
    { key: 'neutral' },
    { key: 'happy' },
    { key: 'angry' },
    { key: 'sad' },
    { key: 'relaxed' },
    { key: 'surprised' },
  ],
  dev: {
    // 是否在本地开发调试 (DEV) 时禁用 LoadingOverlay 开屏遮罩，彻底消除 HMR 热更新时的弹窗与渲染暂停干扰
    disableLoadingOverlayInDev: true,
  },
} as const;

export type AppConfig = typeof APP_CONFIG;
