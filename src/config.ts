/**
 * Project XiaoChun 全局配置中心与单一可信源 (Single Source of Truth)
 */

export interface LightChannelConfig {
  base: number;
  enabled: boolean;
}

/**
 * ponytail: 后期管线配置。Drawer 改这里 → applyConfig 同步到 effect。
 * 注意:这套默认针对 maid 站姿 + 棚灯调过,换 outfit 后可微调。
 */
import * as THREE from 'three';

export const POSTFX_TONE_MAPPING_MODE = {
  NEUTRAL: THREE.NeutralToneMapping,        // 7: Khronos PBR Neutral (自然透亮，二次元首选)
  ACES_FILMIC: THREE.ACESFilmicToneMapping, // 4: 真正的好莱坞电影胶片曲线
  LINEAR: THREE.LinearToneMapping,          // 1: 原色直出 (无曲线映射)
} as const;

export interface LightConfig {
  // ponytail: 精简到 3 盏 — dir (key) / hemi (ambient) / fill (冷补)。
  // 之前的 front / leg / arm 是额外 SpotLight 调试通道,Unity / Three.js 标准
  // 影棚配置不需要,删干净避免误用。
  dir: LightChannelConfig;
  hemi: LightChannelConfig;
  fill: LightChannelConfig;
  globalMult: number;
}

export type LineworkTheme = 'light' | 'dark' | 'transparent';

export interface SceneComponentConfig {
  /** 顶部控制栏 */
  topHeader?: boolean;
  /** 底部对话条 */
  chatBar?: boolean;
  /** 角色头顶气泡 */
  headBubble?: boolean;
  /** 身高测量 HUD 虚线与标牌 */
  heightRuler?: boolean;
  /** 拖拽模型/换装触发层 */
  dropZone?: boolean;
}

export interface SceneTauriConfig {
  /** 待机状态下是否允许调整窗口大小（在透明桌宠叠加模式下默认 false，普通窗口模式下为 true） */
  resizable: boolean;
  /** 是否启用 corner 缩放拉伸把手（透明模式下通常需要 corner 边标） */
  cornerHandles?: boolean;
  /** 默认窗口是否置顶 */
  alwaysOnTop?: boolean;
}

export interface SceneItemConfig {
  id: string;
  /** i18n 语言包 key */
  nameKey: string;
  /** 图标名称或类型 */
  icon?: string;
  /** 关联的 3D 背景线稿主题 */
  lineworkTheme: LineworkTheme;
  /** 是否开启透明叠加模式 (Overlay) */
  isTransparent?: boolean;
  /** 该场景下各 UI 组件的可见性控制 */
  components: SceneComponentConfig;
  /** 该场景在 Tauri 桌面端下的原生窗口表现 */
  tauri: SceneTauriConfig;
}

export interface SceneRegistryConfig {
  defaultSceneId: string;
  items: Record<string, SceneItemConfig>;
}

export interface MaterialSaturationConfig {
  preset: 'vibrant' | 'sweet' | 'cinematic' | 'original' | 'custom';
  clothing: number;
  hair: number;
  eyes: number;
  skin: number;
}

/**
 * MToon 材质外轮廓描边计算模式
 * - 'none': 关闭背面法线外推描边
 * - 'worldCoordinates': 世界坐标模式（根据与相机距离自然缩放，近粗远细）
 * - 'screenCoordinates': 屏幕坐标模式（固定屏幕像素宽度，无论远近粗细恒定）
 */
export type VrmOutlineWidthMode = 'none' | 'worldCoordinates' | 'screenCoordinates';

/**
 * VRM MToon 材质轮廓描边全局配置
 */
export interface VrmOutlineConfig {
  /**
   * 是否全局启用角色的 MToon 背面膨胀外轮廓描边。
   * - false: 彻底关闭角色描边（推荐）。根除大腿内侧/四肢圆柱体 UV 接缝处因法线断开外推暴露的黑色缝隙线，
   *   呈现自然柔和的高级 3D 原生手办质感，并彻底省去模型每个 Mesh 的第二遍背面 Draw Call；
   * - true: 启用传统二次元动漫黑边勾线风格。
   */
  enabled: boolean;
  /**
   * 描边宽度模式
   */
  widthMode: VrmOutlineWidthMode;
  /**
   * 描边外推宽度系数（仅在 enabled: true 时生效）。
   * 推荐精细范围：0.001 ~ 0.005，过大会引起复杂曲面破面与穿插。
   */
  widthFactor: number;
  /**
   * 描边颜色（HEX 颜色字符串，如 '#000000'、'#2e2226'）。
   * 默认 '#000000' (纯黑墨水勾线)。
   * 💡 动漫美学技巧：尝试使用深暖棕/深褐紫（如 '#2c2024' 或 '#332429'），
   * 相比死黑能让角色视觉边缘更柔和、更透光，消除生硬的剪纸塑料感。
   */
  color: string;
  /**
   * 描边与光照及材质原本贴图颜色的混合系数 (0.0 ~ 1.0)。
   * - 0.0 (默认): 纯色无光照墨线（不受明暗阴影影响，对比度最强、线条最鲜明稳定）；
   * - 1.0: 描边完全参与光照计算并与漫反射贴图相乘。
   */
  lightingMix: number;
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
  // ponytail: overallScale 用户版默认移除,但 vrmBodyMorph.ts 5 处直接读它,
  // 留 required + default 1.00 — UI 不渲染 slider 即可,不影响 UI 简洁。
  overallScale: number;     // 全局大小 (默认 1.00，范围 0.70 ~ 1.30)

  // 头部与颈部
  head: number;             // 头部比例/头身比 (默认 1.00，范围 0.85 ~ 1.20)
  neck: number;             // 颈部左右宽度 (兼容旧配置，默认 1.00，范围 0.70 ~ 1.40)
  neckDepth: number;        // 颈部前后深度 (默认 1.00，范围 0.70 ~ 1.40)
  neckLength: number;       // 颈部长短 (默认 1.00，范围 0.80 ~ 1.30)

  // 躯干、肩宽与腰臀
  shoulderWidth: number;    // 肩宽 (默认 1.00，范围 0.75 ~ 2.50)
  torsoLength: number;      // 躯干长度 (默认 1.00，范围 0.75 ~ 1.35)
  torsoThickness: number;   // 躯干厚度 (默认 1.00，范围 0.70 ~ 1.40，统一控制胸背与腰腹前后厚度)
  waist: number;            // 纤细腰部 (默认 1.00，范围 0.50 ~ 1.40，控制腰部横向宽度)
  belly: number;            // 肚子大小 (默认 1.00，范围 0.70 ~ 1.80，纯粹控制小腹平坦或微凸，绝不影响后腰)
  hips: number;             // 胯部左右宽度 (默认 1.00，范围 0.70 ~ 1.50)
  buttocks: number;         // 臀部大小 (默认 1.00，范围 0.70 ~ 1.50，对齐胸部大小)
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

export interface AddonDefinition {
  source: string;
  name: string;
  sha: string;
  default?: boolean;
  /**
   * 针对该服装特化的体型微调覆盖项（覆盖全局 APP_CONFIG.bodyMorph.default）
   */
  bodyMorph?: Partial<BodyMorphConfig>;
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
    // ponytail: 冷启动默认 base (.vrmbase zip)。
    defaultSource: '/vrm/xiaochun_base.vrmbase',
    defaultName: 'XiaoChun',
    // ponytail: base 产物 sha256 — IDB cache key 的一部分,build 后产物变了 runtime
    // 就 miss,自动重 fetch。短截(16 字符)够去重,sha256 完整值在 build 时会跟
    // HEAD sha 比对。workflow 跑完会打 "actual" / "config" mismatch 提示更新。
    defaultSha: 'e99fcc335a512b5a',

    // 角色出生点 (世界坐标, 米):
    // - x/z: 场景水平位置 (默认 0 = 场景中心)
    // - y: 在自动贴地后再加这个高度偏移 (默认 0 = 脚踩地面)
    //   改 spawn.y = 0.5 让角色悬浮半米,改 x = 0.3 让角色偏移到右
    spawn: {
      x: 0,
      y: 0,
      z: -4,
    },
    // 换装 addons: key 是 addon 唯一 id(用作按钮标识 + 持久化匹配),
    // source 是 .vrmaddon / .vrmbase 路径,name 是 UI 展示的名字,
    // sha 是产物 sha256 (见 defaultSha 注释,跟 base 同作用)。
    // 加新 outfit: 加一行,TopHeader dropdown 自动出现按钮(无需改组件)。
    // default: true 标默认加载的 addon,冷启动无 user 偏好时用这个,普通用户
    // 进站就穿衣服,不用先点菜单。多个 default 时 workflow 警告,取第一个。
    addons: {
      'xiaochun_techwear': {
        source: '/vrm/addons/xiaochun_techwear.vrmaddon',
        name: 'XiaoChun Techwear',
        sha: '5b82a059455ce7bc',
        bodyMorph: {
          shoulderWidth: 1,
          buttocks: 1.2,
          bust: 1.1,
          bustThickness: 1,
          bustPitch: 0,
        },
      },
      'xiaochun_cheongsam': {
        source: '/vrm/addons/xiaochun_cheongsam.vrmaddon',
        name: 'XiaoChun Cheongsam',
        sha: 'c2bf3c1591a5a22a',
        bodyMorph: {
          waist: 0.74,
          bust: 1.2,
          bustThickness: 1.04,
          bustPitch: 0.03,
          bustSpread: -0.012,
        },
      },
      'xiaochun_bikini': {
        source: '/vrm/addons/xiaochun_bikini.vrmaddon',
        name: 'XiaoChun Bikini',
        sha: 'a70c7d5a10665b72',
        bodyMorph: {
          "shoulderWidth": 0.95,
          "buttocks": 1.16,
          "buttocksPitch": 0.15,
          "bustThickness": 1.12,
          "bustPitch": -0.04,
          "bustSpread": -0.02
        },
      },
      'xiaochun_maid': {
        source: '/vrm/addons/xiaochun_maid.vrmaddon',
        name: 'XiaoChun Maid',
        sha: '318e2d2914d76b4d',
        bodyMorph: {
          shoulderWidth: 1.4,
          waist: 0.7,
        },
      },
      'xiaochun_swimsuit': {
        source: '/vrm/addons/xiaochun_swimsuit.vrmaddon',
        name: 'XiaoChun Swimsuit',
        sha: 'b7511150c85ce0c1',
      },
      'xiaochun_dinner_dress': {
        source: '/vrm/addons/xiaochun_dinner_dress.vrmaddon',
        name: 'XiaoChun Dinner Dress',
        sha: 'bc2e42f754e635af',
        default: true,
        bodyMorph: {
          shoulderWidth: 1.05,
          waist: 0.7,
          bustPitch: 0.01,
          bustSpread: -0.024,
        },
      },
      'xiaochun_office_lady': {
        source: '/vrm/addons/xiaochun_office_lady.vrmaddon',
        name: 'XiaoChun Office Lady',
        sha: '7d4f1f5c98bb0434',
        bodyMorph: {
          shoulderWidth: 0.96,
          waist: 0.82,
          bust: 1.02,
          bustPitch: 0.19,
          bustSpread: -0.018,
        },
      },
      'xiaochun_wedding': {
        source: '/vrm/addons/xiaochun_wedding.vrmaddon',
        name: 'XiaoChun Wedding',
        sha: '3214c9a2cb40d310',
        bodyMorph: {
          shoulderWidth: 1.2,
          torsoThickness: 0.8,
          waist: 0.66,
          bust: 1.1,
          bustSpread: -0.016,
        },
      },
    } as Record<string, AddonDefinition>,
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
      dampingStiffness: 6.5,           // 阻尼刚度约 2~8；↑跟手更快更硬，↓更柔可能拖影
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
    model: 'MiniCPM5-2B-q4f16_1-MLC',
    fallback: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    thinking: false,
  },
  // 端侧记忆: 小模型(0.5B/2B)对注意力与上下文长度极敏感，控制在 2 轮防止复读、人设漂移及 prefill 延迟
  memory: {
    shortTermTurns: 2,
    turnMaxChars: 120,
    // ponytail: 用户在「对话设置」可手动覆盖的范围 — UI slider 和 IDB setter 共用这一份,
    // 改了这里两边同步生效,避免 setter 上限跟 slider 不一致(以前踩过这个坑)。
    userTurnsMin: 1,
    userTurnsMax: 50,
  },
  camera: {
    defaultFov: 30,
    minFov: 15,
    maxFov: 60,
    defaultPosition: [0.0, 0.95, 2.2] as [number, number, number],
    defaultTarget: [0.0, 0.9, 0.0] as [number, number, number],
    // ponytail: 默认推镜按"想看多高(米)"反推距离 = extent / (2*tan(fov/2)),
    // 这样 FOV 30° 跟 60° 都能框出相同的主体大小,不会出现"长焦糊脸"。
    // 1.34m ≈ 75% 视口饱满人像景别，下方自然展示到大腿上部，对齐 ani 标准人像质感
    defaultShotExtent: 1.34,
    // ponytail: 鼠标滚轮 / 双指 pinch 缩放的距离上下限。改这里同时也是 devDrawer
    // "镜头距离范围" 两 slider 的默认值;运行时调整会覆盖并写 localStorage。
    defaultMinDistance: 1.0,
    defaultMaxDistance: 15.0,
    // 镜头跟随自动转身：默认开启 true。如果在 devDrawer 导出的结果中看到 bodyTurnEnabled，可以忽略不要更新
    defaultEnableBodyTurn: true as boolean,
    // 视线与头部注视跟随：默认开启 true
    defaultEnableGaze: true as boolean,
    // 垂直俯仰极角可视扇区范围 (rad): 0.01 俯视头顶，Math.PI - 0.01 仰视脚底 (180° 扇区)
    minPolarAngle: 0.01,
    maxPolarAngle: Math.PI - 0.01,
    // 垂直拖拽俯仰灵敏度 (rad / 像素，调谐至贴合手感，顺畅微调)
    pitchSensitivityY: 0.0065,
  },
  interaction: {
    // 鼠标水平拖拽驱动角色转向灵敏度 (rad / 像素，较原版降低 15% 保证跟手更温和)
    characterTurnSensitivityX: 0.0102,
    // ponytail: 相机 Y 高度尺 (cameraYGuide3D) 距角色脚底的水平偏移 (米, 负=左侧)。
    // 调大往角色靠近, 调小远离。改这里不需要碰 cameraYGuide3D.ts。
    cameraYGuide: {
      xOffset: -0.4,
    },
    // 3D 空间交互导引轨（TurnGuide / PitchGuide / CameraYGuide）全息纯白发光基色
    guideColor: '#ffffff',
  },
  bodyTurn: {
    // 触发转身踏步的偏角阈值 (rad，约 24°)
    turnStartThreshold: 0.42,
    // 结束转身踏步的舒适区阈值 (rad，约 11.5°)
    turnStopThreshold: 0.20,
    // 转向追踪弹簧刚度 (临界阻尼 d = 2*√k，降低 15% 柔化角加速度)
    springK: 5.95,
    // 角色生理最大角速度上限 (rad/s，约 195°/s，降低 15% 更拟真)
    maxYawVel: 3.4,
    // 步态状态机单步各阶段时长 (秒，步频与角速度同步慢 15%，总计 0.67s 优雅拟人生理单步周期)
    phaseDuration: {
      idle: 0,
      lift: 0.21,
      swing: 0.16,
      plant: 0.09,
      settle: 0.21,
    },
    // 踱步抬腿时 lowerLeg 弯曲角度 (rad)
    stepLowerLegBend: 0.5,
    // 踱步时 upperLeg 前抬角度 (rad)
    stepUpperLegLift: 0.30,
    // 踱步时脚踝背屈角度 (rad)
    stepAnkleFlex: 0.12,
    // 踱步时髋部侧移量 (hips local X，m，轻柔自然的重心微移 ~12mm)
    hipSwayAmount: 0.012,
    // 踱步时骨盆生理横滚倾角 (Roll，rad，约 1.0°，支撑腿受力侧骨盆优雅微提)
    hipRollAmount: 0.012,
    // 踱步时骨盆跟随偏航微旋 (Yaw，rad，约 0.7°，迈步腿带动骨盆自然微扭)
    hipYawAmount: 0.012,
    // 踱步时重心上下沉浮回弹 (Bounce，Y 轴 m，落脚时轻柔缓冲 ~36mm)
    hipBounceAmount: 0.036,
  },
  gaze: {
    // 最大转头角速度上限 (rad/s，约 240°/s，严格对齐人体颈椎最大生理转动速度，彻底消除大角度剧烈甩头甩发)
    maxHeadTurnSpeed: 4.2,
    // 视线舒适扇区半角 (rad，约 90°，超出此角度视线开始平滑淡出回正)
    fovComfortHalfAngle: 1.57,
    // 视线背后盲区半角 (rad，约 135°，完全超出进入盲区时头部处于自然中立位)
    fovBlindHalfAngle: 2.35,
    // 视线追踪平滑阻尼基础速率
    trackSpeed: 10.0,
  },
  springBone: {
    bust: {
      // 1. 刚度 stiffness (弹性回正力)：
      //    - 【官方默认值】: 0.75 (实测 VRoid 导出值，极度僵硬像硬塑料/盔甲，微动几乎不形变)
      //    - 往大调 (0.6 ~ 1.0): 越来越硬挺，摆动幅度极小；
      //    - 往小调 (0.10 ~ 0.25): 越来越柔软，惯性摆幅增大；调过小 (<0.08) 会松垮变形像水球；
      //    - 【推荐甜点值】: 0.20 ~ 0.25 (柔软而有支撑力，灵动富有弹性)
      stiffness: 0.22,

      // 2. 空气阻尼 dragForce (能量衰减速率 / 粘滞度)：
      //    - 【官方默认值】: 0.05 (实测 VRoid 导出值，阻尼极低)
      //    - 往大调 (0.5 ~ 0.8): 像泡在浓稠糖浆里，粘滞迟缓，摆一下就瞬间定住；
      //    - 往小调 (0.01 ~ 0.10): 缺乏阻尼，柔软时会像果冻一样高频剧烈“余震”，极假；
      //    - 【推荐甜点值】: 0.26 ~ 0.32 (优雅吸收动能，摆动后回弹 1~2 下自然平稳收敛)
      dragForce: 0.06,

      // 3. 重力强度 gravityPower (垂直下坠受力)：
      //    - 【官方默认值】: 0.0 (实测 VRoid 导出值，完全处于失重状态)
      //    - 往大调 (> 0.15): 明显受重力下拽，胸型变沉、下垂；
      //    - 往小调 (0.0): 纯失重，缺乏纵向回弹的沉浮韵律；
      //    - 【推荐甜点值】: 0.03 ~ 0.05 (赋予水滴形下胸自然的自重下垂与踏步回弹)
      gravityPower: 0.005,

      // 4. 碰撞体安全半径 hitRadius (防穿模球体半径，单位 m)：
      //    - 【官方默认值】: 0.0232 (实测 VRoid 导出值，约 2.32cm)
      //    - 往大调 (> 0.04): 容易与身体/手臂碰撞体隔空反弹产生悬空畸变；
      //    - 往小调 (< 0.01): 剧烈晃动时可能与胸腔网格或衣服穿模；
      //    - 【推荐甜点值】: 0.0232 ~ 0.025
      hitRadius: 0.0232,
    },
    skirt: {
      // 1. 裙摆刚度 stiffness (回弹速度与布料挺括度)：
      //    - 调至 0.35：赋予百褶裙扎实有型的织物质感，避免过于轻薄松散
      stiffness: 0.35,
      // 2. 空气阻尼 dragForce：
      //    - 调至 0.18：吸收高频多余晃动，裙摆摆动沉稳优雅
      dragForce: 0.18,
      // 3. 裙摆自重重力 gravityPower：
      //    - 调至 0.10：充沛的下垂自重感，风过即自然利落垂坠，彻底告别轻飘浮空感
      gravityPower: 0.10,
      // 4. 碰撞体安全半径 hitRadius (m)：
      hitRadius: 0.018,
    },
    ribbon: {
      // 1. 飘带/腰带配饰刚度 stiffness (丝绸轻盈回弹)：
      //    - 适度柔韧 (0.42)：既杜绝 0.75 的硬塑料木讷无动静，又避免 0.28 的下垂塌陷穿模
      stiffness: 0.42,
      // 2. 空气阻尼 dragForce：
      dragForce: 0.16,
      // 3. 自重重力 gravityPower (极轻丝绸)：
      gravityPower: 0.005,
      // 4. 防穿模安全半径 hitRadius (m)：
      hitRadius: 0.025,
    },
  },
  wind: {
    // 1. 鼠标局部核心风场半径 (米)：
    //    - 适度扩大至 0.58m，确保在 3D 正切截面上稳定覆盖短裙 (Y~0.65m, Z~0.13m) 与前胸配饰
    mouseRadius: 0.58,

    // 2. 扩散波及微风半径 (米)：
    //    - 扩展至 0.95m，提供平滑自然的空气外层涟漪
    wakeRadius: 0.95,

    // 3. 鼠标快划最大风力强度 (m/s²)：
    //    - 调优至 0.32 (温和舒适同时具备足够的掀风动量)
    mouseWindStrength: 0.32,

    // 4. 周边波及微风比例 (0~1)：
    //    - 轻柔波及 (0.12)
    wakeStrengthRatio: 0.12,

    // 5. 鼠标滑动速度归一化参考 (px/s)：
    //    - 优化至 2000 px/s，手感更线性灵敏，来回扇动清风拂面
    mouseSpeedReference: 2000,

    // 6. 速度平滑 EMA 系数 (0~1)：
    mouseSpeedSmoothing: 0.35,

    // 7. 裙摆受力增益系数：
    //    - 适度调至 1.45：既能克服大腿碰撞体自然掀拂，又保持百褶裙应有的厚实质感与垂坠感
    skirtMultiplier: 1.45,

    // 8. 飘带配饰受力增益系数：
    //    - 1.35，赋予丝绸飘带灵敏轻灵的受风响应
    ribbonMultiplier: 1.35,

    // 9. 鼠标停滞超时 (ms)，超过此时间未动风力自然收敛归零
    idleTimeoutMs: 120,

    // 10. 胸部专属风感动态调优 (解决“稍微划过动作大、快划上限低”的问题)：
    bust: {
      // 基础受力敏感度 (降低慢速基础扰动)
      sensitivity: 0.23,
      // 速度幂律响应指数 (慢移超微弱，快划迅速起量，拉开动态范围)
      speedExponent: 0.85,
      // 快速划动冲量补偿倍率 (快划时瞬时接触时间短，通过冲量补偿打开动作上限)
      impulseBonus: 1.35,
    },
  },
  renderer: {
    // iPhone 多是 3x;封顶 2 会按 2/3 分辨率画,头发和网袜特别容易锯齿。
    maxPixelRatio: 3,
  },
  scene: {
    // 线稿背景世界主题：'light' (昼白线稿) 或 'dark' (极夜深蓝黑线稿)
    theme: 'light' as 'light' | 'dark',
  },
  // ponytail: 角色脚下阴影配置。softShadow 仅在 transparent 桌宠主题下生效,
  // 走 radial alpha mask + 屏幕边界 fade; light/dark 主题下走原版 plane 全显。
  // opacity 直接调阴影黑度 (值越高阴影越深), 改这里调完不需要碰 vrmEngine.ts。
  shadow: {
    planeSize: 12,                          // shadowPlane 几何尺寸 (米)
    planeY: 0.0005,                         // 紧贴世界地面底层, 低于 linework 网格
    opacityDark: 0.50,                      // dark 主题透明度
    opacityLight: 0.40,                     // light/transparent 主题透明度
    softShadow: {
      enabled: true,                        // 软影开关 — transparent 主题下自动用 1.0, 其他自动 0.0
      radialStops: [                        // radial mask CanvasTexture 5 个 stop (UV 归一化距离)
        { pos: 0.00, alpha: 1.00 },
        { pos: 0.03, alpha: 0.70 },
        { pos: 0.06, alpha: 0.30 },
        { pos: 0.09, alpha: 0.00 },
        { pos: 1.00, alpha: 0.00 },
      ],
      edgeFadeStart: 0.5,                   // 脚底 NDC 距中心 max(|x|,|y|) 超过 0.5 起 fade
      edgeFadeEnd: 0.8,                    // 到 0.8 全淡出
    },
  },
  scenes: {
    defaultSceneId: 'light',
    items: {
      light: {
        id: 'light',
        nameKey: 'header.switchScene.light',
        icon: 'Sun',
        lineworkTheme: 'light',
        isTransparent: false,
        components: {
          topHeader: true,
          chatBar: true,
          headBubble: true,
          heightRuler: true,
          dropZone: true,
        },
        tauri: {
          resizable: true,
          cornerHandles: false,
        },
      },
      dark: {
        id: 'dark',
        nameKey: 'header.switchScene.dark',
        icon: 'Moon',
        lineworkTheme: 'dark',
        isTransparent: false,
        components: {
          topHeader: true,
          chatBar: true,
          headBubble: true,
          heightRuler: true,
          dropZone: true,
        },
        tauri: {
          resizable: true,
          cornerHandles: false,
        },
      },
      transparent: {
        id: 'transparent',
        nameKey: 'header.switchScene.transparent',
        icon: 'Ghost',
        lineworkTheme: 'transparent',
        isTransparent: true,
        components: {
          topHeader: true,
          chatBar: true,
          headBubble: true,
          heightRuler: false,
          dropZone: true,
        },
        tauri: {
          resizable: false, // 待机下 false 屏蔽透明区域拉伸，交互时动态激活
          cornerHandles: true,
        },
      },
    },
  } as SceneRegistryConfig,
  lights: {
    dir: { base: 1.00, enabled: true },
    hemi: { base: 0.95, enabled: true },
    fill: { base: 1.40, enabled: true },
    globalMult: 1.0,
  } as LightConfig,
  // ponytail: 后期管线配置。针对浅色/白底二次元优化：
  // 1. 默认采用 Linear 原色直出 + 1.05 曝光，避免 Neutral 压暗肤色变灰黄；
  // 2. 暗角默认 0，避免浅底周围一圈灰脏感；
  // 3. Bloom 在着色器层精准剔除白底后，阈值设在 0.72，微量强度 0.015 + 半径 0.32，发丝与高光极简纯净绝不起雾；
  // 4. 微量对比度 +0.02，瞳孔更透亮，原画纯净直出。
  postfx: {
    enabled: true,
    bloom: { strength: 0.015, radius: 0.32, threshold: 0.72 },
    vignette: { darkness: 0.0, offset: 0.5 },
    toneMapping: { mode: THREE.LinearToneMapping, exposure: 1.05 },
    bc: { brightness: 0.0, contrast: 0.02 },
    hs: { hue: 0.0, saturation: 0.0 },
  },
  saturation: {
    default: {
      preset: 'custom',
      clothing: 1.00,
      hair: 1.40,
      eyes: 1.40,
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
  /**
   * VRM 角色 MToon 轮廓描边全局配置
   *
   * 💡 切换方案说明：
   * 1. 【当前方案・粗细均匀的二次元发丝描边】：
   *    - enabled: true
   *    - widthMode: 'screenCoordinates' (根据深度反向补偿相机透视，无论走近拉远全屏粗细恒定，彻底避免近大远小)
   *    - widthFactor: 0.0012 (精细 1 像素克制墨线，杜绝发梢/下巴等尖锐拐角处过度外扩膨胀)
   *    - 注意：贴身丝袜已在底层强制关闭描边，大腿内侧接缝黑线绝不复发。
   *
   * 2. 【备选方案・无描边的现代手办质感（推荐）】：
   *    - enabled: false, widthMode: 'none', widthFactor: 0.0
   */
  outline: {
    /**
     * 是否全局启用 MToon 轮廓描边。
     * - true: 开启精细二次元墨线描边；
     * - false: 彻底关闭角色所有部件的描边 Pass，展现无描边的纯净手办质感。
     */
    enabled: true,

    /**
     * 描边计算模式：
     * - 'screenCoordinates': 【推荐・粗细均匀】屏幕像素坐标模式。
     *   通过深度值反向补偿相机的透视投影（抵消近大远小），使整个模型从头到脚在屏幕上
     *   始终保持恒定粗细的 1 像素高画质墨线，避免近处大粗边、远处断裂的粗细不均。
     * - 'worldCoordinates': 世界物理坐标模式。固定外推物理厚度，会导致特写极粗、拉远消失。
     * - 'none': 不进行外推。
     */
    widthMode: 'screenCoordinates',

    /**
     * 描边外推宽度系数。
     * 在 screenCoordinates 模式下：
     * - 0.0010 ~ 0.0015: 黄金推荐值。刚好呈现高品质二次元番剧的 1 像素发丝级边缘勾勒，
     *   线条细腻平滑，避免在发梢、指尖等高曲率锐角处产生过多粗糙堆积。
     * - 0.0020+: 线条较重，呈现强烈粗边漫画感。
     */
    widthFactor: 0.0010,

    /**
     * 描边颜色（HEX 颜色字符串）：
     * - '#000000': 经典纯黑墨水线条（鲜明硬朗）；
     * - '#2a1e24': 深暖褐紫（极佳二次元插画推荐，比死黑更通透高级）；
     * - '#3b2f2f': 柔和深咖啡色（手办模型常用）；
     * 甚至可以设为你想要的任意主题色（如浅金色 '#d4af37'、天蓝色等）。
     */
    color: '#2a1e24',

    /**
     * 描边与环境光照混合度：
     * - 0.0: 纯色不变，线条无论在背光暗处还是亮处都保持一致；
     * - 1.0: 随光影变暗，融入场景光照。
     */
    lightingMix: 0.7,
  } as VrmOutlineConfig,
  bodyMorph: {
    default: {
      // ponytail: 用户最新 bodyMorph 默认值 — 肩宽 +0.2 / 腰 -0.2 / 大腿 +0.06
      // 小腿 -0.02 / 臀 pitch +0.05 等,目标偏"slim + athletic"。
      // overallScale 留 1.00 (接口 optional 但 vrmBodyMorph.ts 5 处直接读 config.overallScale,
      // 不设 → NaN → 模型缩放 / 头部偏移炸)。用户 UI 不渲染 slider,但 runtime 仍用 1.00。
      overallScale: 1.00,
      head: 0.98,
      neck: 0.96,
      neckDepth: 1.00,
      neckLength: 1.00,
      shoulderWidth: 1.10,
      torsoLength: 0.92,
      torsoThickness: 0.88,
      waist: 0.86,
      belly: 0.80,
      hips: 1.00,
      buttocks: 1.13,
      buttocksThickness: 1.00,
      buttocksPitch: 0.02,
      buttocksSpread: 0.002,
      bust: 1.24,
      bustThickness: 1.08,
      bustPitch: 0.06,
      bustSpread: -0.032,
      arms: 0.86,
      armLength: 1.00,
      hands: 1.00,
      fingerWidth: 0.96,
      thighs: 1.06,
      thighLength: 1.00,
      calves: 0.82,
      calfLength: 1.00,
      feet: 0.96,
    } as BodyMorphConfig,
    limits: {
      overallScale: { min: 0.70, max: 1.30, step: 0.01 },
      head: { min: 0.85, max: 1.20, step: 0.01 },
      neck: { min: 0.70, max: 1.40, step: 0.02 },
      neckDepth: { min: 0.70, max: 1.40, step: 0.02 },
      neckLength: { min: 0.80, max: 1.30, step: 0.01 },
      shoulderWidth: { min: 0.75, max: 2.50, step: 0.01 },
      torsoLength: { min: 0.75, max: 1.35, step: 0.01 },
      torsoThickness: { min: 0.70, max: 1.40, step: 0.01 },
      waist: { min: 0.50, max: 1.40, step: 0.02 },
      belly: { min: 0.70, max: 2.00, step: 0.01 },
      hips: { min: 0.70, max: 1.50, step: 0.02 },
      buttocks: { min: 0.70, max: 1.50, step: 0.01 },
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
