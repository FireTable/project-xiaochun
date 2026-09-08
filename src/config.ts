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
  /**
   * 手臂幅度相对 rest 的混合 (0.1~1.0，默认 1.0)。
   * 调大：手势更开；调小：更收、更贴身。
   */
  gestureIntensity: number;
  /**
   * 指关节活跃度 (0.1~1.0，默认 0.5)。
   * 调大：手指更活/更张；调小：更柔和半卷，少乱指。
   */
  fingerIntensity: number;
  /**
   * 胸腔微动权重 (0.1~1.0，默认 0.75)。
   * 调大：呼吸/胸动更明显；调小：上身更稳。
   */
  torsoIntensity: number;
  /**
   * 腰椎微动权重 (0.1~1.0，默认 0.3)。
   * 调大：腰部起伏更大；调小：站姿更直、少晃。
   */
  spineIntensity: number;
  /**
   * 骨盆/胯部微动权重 (0.1~1.0，默认 0.70)。
   * 调大：重心微移更明显；调小：下盘更钉死。
   */
  hipIntensity: number;
  /**
   * 双腿跟随权重 (0.1~1.0，默认 0.70)；足部仍由 FootIK 贴地。
   * 调大：腿更跟胯；调小：腿更静。
   */
  legIntensity: number;
  /**
   * 头/颈权重 (0.1~1.0，默认 0.80)。
   * 调大：点头/转头更跟模型；调小：更少「乌龟颈」前伸感。
   */
  headIntensity: number;
  /**
   * 骨姿追目标的阻尼刚度 (约 2~8，默认 4.2)。
   * 调大：跟手更快、更「硬」；调小：更柔顺，可能拖影。
   */
  dampingStiffness: number;
  /**
   * Worker 时序高斯平滑半径（帧，约 3~24，默认 12 ≈0.8s@30fps）。
   * 调大：更糊、接缝更软、细节少；调小：更跟音频、窗边界可能更硬。
   */
  temporalSmoothRadius: number;
  /**
   * rot6d chunk 接缝几何缝合最大帧数（约 3~24，默认 14）。
   * 调大：接缝更长更柔，可能略糊；调小：更短，大跳变更易「拽一下」。
   */
  chunkSeamMaxFrames: number;
  /**
   * streaming playhead 追赶倍率（约 1.0~1.3，默认 1.08）。
   * 调大：欠载后更快追上音频钟，易 yank；调小：更稳但可能更久口型/动作滞后。
   */
  streamingCatchUpRate: number;
  /**
   * 每步 PCM hop（帧）。**不要随意改**。
   * 合法约 **60..64**（EFF..WINDOW）：<60 重叠更大、窗次更多更慢；>64 音频空洞（Worker 会夹到 64）。
   * 调大（在合法内）：少跑 step、墙钟略降，时域拉伸略多；调小：更密窗、更贴模型原生时序。
   * 默认 64。回滚少窗策略改 60。
   */
  advanceFrames: number;
  /**
   * 首段/释放可听时的淡入秒数（约 0.2~1.2，默认 0.60）。
   * 调大：切入更慢；调小：更快露动作（仍受 A/V hold 约束）。
   */
  fadeInDuration: number;
  /**
   * 非流式 switchSegment 的 crossfade 秒数（约 0.08~0.6，默认 0.24）。
   * 调大：段切换更软；调小：更快切、大姿态差易顿。
   * 流式 motion_chunk 路径不会走 switchSegment。
   */
  switchSegmentCrossFade: number;
  /**
   * 姿态微 crossfade：跳变→时长 的除数（约 0.8~2.0，默认 1.15）。
   * duration ≈ clamp(jump / div, min, max)。调大：同样 jump 更短 fade。
   */
  poseMicroFadeJumpDiv: number;
  /** 微 fade 最短秒（约 0.02~0.12，默认 0.05）。调大：小跳变也更拖。 */
  poseMicroFadeMinSec: number;
  /** 微 fade 最长秒（约 0.15~0.6，默认 0.36）。调大：大接缝更慢收。 */
  poseMicroFadeMaxSec: number;
  /**
   * 微 fade 启动的最小 jump（约 0.005~0.05，默认 0.015）。
   * 调大：更少触发微 fade；调小：更敏感。
   */
  poseMicroFadeJumpMin: number;
  /**
   * 接缝 L2 低于此则跳过几何缝合（约 0.005~0.05，默认 0.02）。
   * 调大：少缝合；调小：更常缝。
   */
  seamJumpThreshold: number;
  /**
   * 接缝帧数公式尺度：frames ≈ 3+(jump-thresh)/scale（约 0.008~0.03，默认 0.015）。
   * 调大：同样 jump 更少缝合帧；调小：更多帧。
   */
  seamJumpFramesScale: number;
  /**
   * VQ upper/hands Top-K 采样温度相关（约 0.5~1.2，默认 0.85；与 topK 联立）。
   * 调大：手势更随机多样；调小：更贪心、更稳、更易重复。
   */
  vqSampleTemperature: number;
  /**
   * VQ upper/hands Top-K（约 1~16，默认 6）。
   * 调大：更多样；调小（→1）：近 argmax，更稳。
   */
  vqSampleTopK: number;
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

// ponytail: INT8 量化开关。useInt8 = true 时加载 _int8.onnx (体积 -67%,rot6d 误差 +33%,动作可能走样)。
// FP16 暂不可用 (浏览器 FP16 tensor 输入 dtype 处理有 edge cases) → 不开
const useInt8 = true;
const q = (fp32: string) => {
  if (useInt8) return fp32.replace('.onnx', '_int8.onnx');
  return fp32;
};

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
    // ponytail: EMAGE 推理需要的 ONNX 模型文件清单 + 每个的元信息。
    // emageWorker 通用调度器按 models 清单按需加载与推理，enabled=false 的模型自动跳过加载，
    // 并由 runOptionalSession 自动补齐全零张量喂给 postprocess，增删改模型无需修改 Worker 核心代码。
    models: {
      // ─── 活跃推理核心 (Active Pipeline) ───
      // 1. 主时序自回归 step (听音频 + 上一窗口 seed → 5 段 VQ 分类 + 潜空间 seed)
      step: { file: q('emage_step.onnx'), enabled: true, label: 'step (autoregressive temporal)' },

      // 2. 核心身体部位 VQ 解码 (把 step 输出的潜空间 / codebook 索引 → 物理姿态特征)
      vqUpper: { file: q('vq_upper_idx.onnx'), enabled: true, label: 'vq_upper (head/neck/shoulders 78D)' },
      vqHands: { file: q('vq_hands_idx.onnx'), enabled: true, label: 'vq_hands (30 finger joints 180D)' },
      vqLower: { file: q('vq_lower_idx.onnx'), enabled: true, label: 'vq_lower (legs/hips/spine 61D)' },

      // 3. 最终装配输出 (将已启用的解码特征拼接为 330 维 6D rot6d 骨骼姿态)
      postprocess: { file: q('postprocess.onnx'), enabled: true, label: 'postprocess (VQ heads → 6D rot)' },

      // ─── 旁路与禁用模型 (Disabled / Zero-padded Fallbacks) ───
      // ponytail: 面部/下颌表情头 — VRM 模型的自然说话张嘴目前由 chatDirector 的 Web Audio RMS 实时驱动，
      // 不需要跑 vqFace 的 106D 脸部形变模型；禁用后自动以全零 106 维向量喂给 postprocess，省去网络拉取与矩阵运算。
      vqFace: { file: q('vq_face.onnx'), enabled: false, label: 'vq_face (jaw + face 106D, disabled)' },

      // ponytail: 全局根骨骼位移 (trans X/Y/Z) — 小蠢当前作为立定交流的数字人，场景基准由 FootIK 锁定在 baseY，
      // 未接入 scene.position，禁用省去 14.6MB 模型下载与 decode 推理。后续支持自由踱步走动时再设为 true。
      vqGlobal: { file: q('vq_global.onnx'), enabled: false, label: 'vq_global (root translation 61D, disabled)' },
    } satisfies Record<string, { file: string; enabled: boolean; label: string }>,
    // ─── 动作速度与频率优化权威配置 ───
    motion: {
      gestureIntensity: 1.0,           // 手臂幅度 0.1~1.0；↑更开手势，↓更收贴身
      fingerIntensity: 0.5,            // 手指活跃 0.1~1.0；↑更张更活，↓更半卷少乱指
      torsoIntensity: 0.75,            // 胸腔微动 0.1~1.0；↑呼吸更明显，↓上身更稳
      spineIntensity: 0.3,             // 腰椎微动 0.1~1.0；↑腰更晃，↓站姿更直
      hipIntensity: 0.70,              // 骨盆微动 0.1~1.0；↑重心微移，↓下盘更钉
      legIntensity: 0.70,              // 腿跟随 0.1~1.0；↑更跟胯，↓腿更静（脚仍 FootIK）
      headIntensity: 0.80,             // 头颈 0.1~1.0；↑更跟模型点头，↓少乌龟颈
      dampingStiffness: 4.2,           // 阻尼刚度约 2~8；↑跟手更快更硬，↓更柔可能拖影
      temporalSmoothRadius: 12,        // 时序平滑帧约 3~24（12≈0.8s@30fps）；↑更糊更软，↓更跟音频但窗缝更硬
      chunkSeamMaxFrames: 14,          // chunk 接缝最大帧约 3~24；↑接缝更长更柔，↓大跳易拽一下
      streamingCatchUpRate: 1.08,      // 追音频钟倍率约 1.0~1.3；↑追上更快易 yank，↓更稳但可能更滞后
      advanceFrames: 64,               // hop 帧；仅 60~64 可改；↑少跑 step，↓更密窗；>64 会空洞被夹，<60 更慢
      fadeInDuration: 0.60,            // 首段淡入秒约 0.2~1.2；↑切入更慢，↓更快露动作
      switchSegmentCrossFade: 0.24,    // 非流式切段 crossfade 秒约 0.08~0.6；↑更软，↓更快易顿（流式 chunk 不走）
      poseMicroFadeJumpDiv: 1.15,      // 微 fade：duration≈jump/div，div 约 0.8~2；↑同样跳变更短 fade
      poseMicroFadeMinSec: 0.05,       // 微 fade 最短秒约 0.02~0.12；↑小跳变也更拖
      poseMicroFadeMaxSec: 0.36,       // 微 fade 最长秒约 0.15~0.6；↑大接缝更慢收
      poseMicroFadeJumpMin: 0.015,     // 触发微 fade 的最小 jump 约 0.005~0.05；↑更少触发，↓更敏感
      seamJumpThreshold: 0.02,         // 低于此 L2 跳过几何缝合约 0.005~0.05；↑少缝，↓更常缝
      seamJumpFramesScale: 0.015,      // 缝合帧尺度约 0.008~0.03；↑同样 jump 更少帧，↓更多帧
      vqSampleTemperature: 0.85,       // VQ Top-K 温度约 0.5~1.2；↑更多样随机，↓更贪心更稳易重复
      vqSampleTopK: 6,                 // VQ Top-K 约 1~16；↑更多样，↓近 argmax 更稳
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
