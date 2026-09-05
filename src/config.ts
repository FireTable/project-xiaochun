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
    base: import.meta.env.PROD
      ? ((import.meta.env.VITE_EMAGE_BASE_PROD as string | undefined) ?? 'https://cdn.firetable.tech/xiaochun')
      : ((import.meta.env.VITE_EMAGE_BASE as string | undefined) ?? '/onnx'),
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
  },
  camera: {
    defaultFov: 45,
    minFov: 15,
    maxFov: 60,
    defaultPosition: [0.0, 1.5, 3.6] as [number, number, number],
    defaultTarget: [0.0, 1.2, 0.0] as [number, number, number],
  },
  renderer: {
    // iPhone 多是 3x;封顶 2 会按 2/3 分辨率画,头发和网袜特别容易锯齿。
    maxPixelRatio: 3,
  },
  lights: {
    dir: { base: 1.00, enabled: true },
    hemi: { base: 0.60, enabled: true },
    front: { base: 0.70, enabled: true },
    fill: { base: 0.80, enabled: true },
    leg: { base: 0.45, enabled: true },
    arm: { base: 0.50, enabled: true },
    globalMult: 1.1,
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
  expressions: [
    { key: 'neutral' },
    { key: 'happy' },
    { key: 'angry' },
    { key: 'sad' },
    { key: 'relaxed' },
    { key: 'surprised' },
  ],
} as const;

export type AppConfig = typeof APP_CONFIG;
