/**
 * Project XiaoChun 全局配置中心 (Single Source of Truth)
 */
import * as THREE from 'three';
import { GUIDE_COLOR } from './core/interaction/guideStyle';
export * from './types/config';
import type {
  LightConfig,
  SceneRegistryConfig,
  CameraGroundClampConfig,
  Beach3DSceneConfig,
  MaterialSaturationConfig,
  VrmOutlineConfig,
  VrmMToonConfig,
  EmageMotionConfig,
  BodyMorphConfig,
  ModelPartCategoryDefinition,
  ModelPartDefinition,
  AddonDefinition,
} from './types/config';

export const POSTFX_TONE_MAPPING_MODE = {
  NEUTRAL: THREE.NeutralToneMapping,
  ACES_FILMIC: THREE.ACESFilmicToneMapping,
  LINEAR: THREE.LinearToneMapping,
} as const;

// INT8 量化开关：useInt8 = true 加载 _int8.onnx 模型
const useInt8 = true;
const q = (fp32: string) => (useInt8 ? fp32.replace('.onnx', '_int8.onnx') : fp32);

export const APP_CONFIG = {
  brand: {
    name: 'Project XiaoChun',
    logo: '/logo.png',
    favicon: '/favicon.png',
    github: 'https://github.com/FireTable/project-xiaochun',
  },
  api: {
    baseUrl: (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? 'https://xiaochun.firetable.tech',
  },
  model: {
    defaultSource: '/vrm/xiaochun_base.vrmbase',
    defaultName: 'XiaoChun',
    defaultSha: 'e99fcc335a512b5a',
    spawn: { x: 0, y: 0, z: -4 },
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
        sha: '92d19fdee413d436',
        bodyMorph: {
          shoulderWidth: 0.95,
          buttocks: 1.16,
          buttocksPitch: 0.15,
          bustThickness: 1.12,
          bustPitch: -0.04,
          bustSpread: -0.02,
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
        bodyMorph: {
          shoulderWidth: 1.38,
          bustPitch: 0.0,
          bustSpread: -0.018,
        },
      },
      'xiaochun_shroud': {
        source: '/vrm/addons/xiaochun_shroud.vrmaddon',
        name: 'XiaoChun Shroud',
        sha: 'f4a49a7ae2cd2dc5',
        bodyMorph: {
          waist: 0.72,
          belly: 0.81,
          bust: 1.18,
          bustThickness: 1.06,
          bustPitch: 0,
          thighs: 0.98,
        },
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
  emage: {
    base: Boolean(import.meta.env?.PROD)
      ? ((import.meta.env?.VITE_EMAGE_BASE_PROD as string | undefined) ?? 'https://cdn.firetable.tech/xiaochun/emage')
      : ((import.meta.env?.VITE_EMAGE_BASE as string | undefined) ?? '/onnx'),
    // v2: slim step set (packages/emage-onnx, 71.6 MB) at <base>/emage/. Same file names as v1, so the bucket name must change;
    // emageWorker.ts deletes older `emage-models-*` buckets after a successful load.
    cacheName: 'emage-models-v2',
    models: {
      step: { file: q('emage_step.onnx'), enabled: true, label: 'step (autoregressive temporal)' },
      vqUpper: { file: q('vq_upper_idx.onnx'), enabled: true, label: 'vq_upper (head/neck/shoulders 78D)' },
      vqHands: { file: q('vq_hands_idx.onnx'), enabled: true, label: 'vq_hands (30 finger joints 180D)' },
      vqLower: { file: q('vq_lower_idx.onnx'), enabled: true, label: 'vq_lower (legs/hips/spine 61D)' },
      postprocess: { file: q('postprocess.onnx'), enabled: true, label: 'postprocess (VQ heads → 6D rot)' },
      vqFace: { file: q('vq_face.onnx'), enabled: false, label: 'vq_face (jaw + face 106D, disabled)' },
      vqGlobal: { file: q('vq_global.onnx'), enabled: false, label: 'vq_global (root translation 61D, disabled)' },
    } satisfies Record<string, { file: string; enabled: boolean; label: string }>,
    motion: {
      gestureIntensity: 1.0,
      fingerIntensity: 0.5,
      torsoIntensity: 0.75,
      spineIntensity: 0.3,
      hipIntensity: 0.70,
      legIntensity: 0.40,
      footIkIdlePlant: 0.92,
      headIntensity: 0.80,
      dampingStiffness: 6.5,
      temporalSmoothRadius: 12,
      chunkSeamMaxFrames: 14,
      streamingCatchUpRate: 1.08,
      advanceFrames: 64,
      fadeInDuration: 0.60,
      switchSegmentCrossFade: 0.24,
      poseMicroFadeJumpDiv: 1.15,
      poseMicroFadeMinSec: 0.05,
      poseMicroFadeMaxSec: 0.36,
      poseMicroFadeJumpMin: 0.015,
      seamJumpThreshold: 0.02,
      seamJumpFramesScale: 0.015,
      vqSampleTemperature: 0.85,
      vqSampleTopK: 6,
    } as EmageMotionConfig,
  },
  stt: {
    base: Boolean(import.meta.env?.PROD)
      ? ((import.meta.env?.VITE_STT_BASE_PROD as string | undefined) ??
        'https://cdn.firetable.tech/xiaochun/stt/sensevoice-zh-en-ja-ko-yue-int8-2024-07-17')
      : ((import.meta.env?.VITE_STT_BASE as string | undefined) ??
        'https://cdn.firetable.tech/xiaochun/stt/sensevoice-zh-en-ja-ko-yue-int8-2024-07-17'),
    cacheName: 'xiaochun-stt-v2024-07-17',
    cacheKeyPrefix: 'xiaochun-stt/v2024-07-17',
    modelFile: 'model.int8.onnx',
    tokensFile: 'tokens.txt',
    useItn: true,
    vadSilenceMs: 600,
    vadMaxMs: 20_000,
    sampleRate: 16_000,
    vadStartThreshold: 0.014,
    vadSilenceThreshold: 0.008,
    vadStartMs: 80,
    vadPrerollMs: 300,
    minUtteranceMs: 250,
  },
  llm: {
    model: 'MiniCPM5-2B-q4f16_1-MLC',
    fallback: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    thinking: false,
  },
  memory: {
    shortTermTurns: 2,
    turnMaxChars: 120,
    userTurnsMin: 1,
    userTurnsMax: 50,
  },
  chat: {
    showHeadBubble: true as boolean,
  },
  camera: {
    defaultFov: 30,
    minFov: 15,
    maxFov: 60,
    defaultPosition: [0.0, 0.95, 2.2] as [number, number, number],
    defaultTarget: [0.0, 0.9, 0.0] as [number, number, number],
    defaultShotExtent: 1.34,
    defaultMinDistance: 1.0,
    defaultMaxDistance: 15.0,
    /** /embed 宿主 camera.height 可调的上下范围 (m, ±); 与 SDK protocol.XC_CAMERA_RANGES.height 保持一致 (单测校验) */
    hostMaxYOffset: 1.0,
    defaultEnableBodyTurn: true as boolean,
    defaultEnableGaze: true as boolean,
    minPolarAngle: 0.01,
    maxPolarAngle: Math.PI - 0.01,
    pitchSensitivityY: 0.005,
    // 相机不穿地: 仰视时相机贴地沿视线推近, 地平线固定在世界空间 (透明场景不生效)。字段说明见 types/config.ts 的 CameraGroundClampConfig
    groundClamp: {
      enabled: true,
      minHeight: 0.15,       // 相机离地最小高度 (m), 建议 0.1 ~ 0.3; 太低沙纹 / 网格掠射易闪, 太高地平线高于脚踝
      fovCompensation: 0.1,  // 推近时放宽视角补偿取景 (0 = 不补偿, 1 = 人物大小基本不变, 上限 maxFov)
      minDollyDistance: 0.6, // 推近下限 (m), 再近则改为抬高环绕中心
    } as CameraGroundClampConfig,
  },
  interaction: {
    characterTurnSensitivityX: 0.0102,
    cameraYGuide: { xOffset: -0.38 },
    guideColor: GUIDE_COLOR,
  },
  bodyTurn: {
    turnStartThreshold: 0.42,
    turnStopThreshold: 0.20,
    springK: 5.95,
    maxYawVel: 2.6,
    phaseDuration: { idle: 0, lift: 0.21, swing: 0.16, plant: 0.09, settle: 0.21 },
    stepLowerLegBend: 0.48,
    stepUpperLegLift: 0.24,
    stepAnkleFlex: 0.12,
    hipSwayAmount: 0.012,
    hipRollAmount: 0.012,
    hipYawAmount: 0.012,
    hipBounceAmount: 0.036,
  },
  gaze: {
    maxHeadTurnSpeed: 4.2,
    fovComfortHalfAngle: 1.57,
    fovBlindHalfAngle: 2.35,
    trackSpeed: 10.0,
  },
  springBone: {
    bust: { stiffness: 0.22, dragForce: 0.26, gravityPower: 0.005, hitRadius: 0.0232 },
    // 裙子: stiffness 合法 0~1, 越大越硬回弹越快; dragForce 合法 0~1, 越大阻尼越大、晃动停得越快 (调大=更稳, 调小=更飘); gravityPower 越大越下垂
    skirt: { stiffness: 0.35, dragForce: 0.40, gravityPower: 0.10, hitRadius: 0.018 },
    ribbon: { stiffness: 0.42, dragForce: 0.16, gravityPower: 0.005, hitRadius: 0.025 },
  },
  wind: {
    mouseRadius: 0.58,
    wakeRadius: 0.95,
    mouseWindStrength: 0.32,
    wakeStrengthRatio: 0.12,
    mouseSpeedReference: 2000,
    mouseSpeedSmoothing: 0.35,
    skirtMultiplier: 0.7, // 裙子风力放大倍数, 合法 >=0, 建议 0.5~1.5; 调大=鼠标一扫裙子更猛, 调小=更温和
    ribbonMultiplier: 1.35,
    idleTimeoutMs: 120,
    bust: { sensitivity: 0.23, speedExponent: 0.85, impulseBonus: 1.35 },
  },
  renderer: {
    maxPixelRatioMobile: 2.75,
    maxPixelRatioDesktop: 3,
    targetFpsMobile: 40,
    targetFpsDesktop: 60,
  },
  scene: {
    theme: 'light' as 'light' | 'dark',
  },
  shadow: {
    planeSize: 12,
    planeY: 0.0005,
    opacityDark: 0.50,
    opacityLight: 0.40,
    softShadow: {
      enabled: true,
      radialStops: [
        { pos: 0.00, alpha: 1.00 },
        { pos: 0.03, alpha: 0.70 },
        { pos: 0.06, alpha: 0.30 },
        { pos: 0.09, alpha: 0.00 },
        { pos: 1.00, alpha: 0.00 },
      ],
      edgeFadeStart: 0.5,
      edgeFadeEnd: 0.8,
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
        components: { topHeader: true, chatBar: true, headBubble: true, heightRuler: true, dropZone: true },
        tauri: { resizable: true, cornerHandles: false },
      },
      dark: {
        id: 'dark',
        nameKey: 'header.switchScene.dark',
        icon: 'Moon',
        lineworkTheme: 'dark',
        isTransparent: false,
        components: { topHeader: true, chatBar: true, headBubble: true, heightRuler: true, dropZone: true },
        tauri: { resizable: true, cornerHandles: false },
      },
      transparent: {
        id: 'transparent',
        nameKey: 'header.switchScene.transparent',
        icon: 'Ghost',
        lineworkTheme: 'transparent',
        isTransparent: true,
        components: { topHeader: true, chatBar: true, headBubble: true, heightRuler: false, dropZone: true },
        tauri: { resizable: false, cornerHandles: true },
      },
      // 海滩: 纯 Three.js 3D 场景 (src/core/scene/beach3d/), 真实地面 + 实时落影。不透明场景, 规则同 light / dark (TopHeader / ChatBar 常显, Tauri 20px 圆角)。
      beach3d: {
        id: 'beach3d',
        nameKey: 'header.switchScene.beach3d',
        icon: 'TreePalm',
        lineworkTheme: 'beach3d',
        isTransparent: false,
        components: { topHeader: true, chatBar: true, headBubble: true, heightRuler: true, dropZone: true },
        tauri: { resizable: true, cornerHandles: false },
      },
    },
  } as SceneRegistryConfig,
  // 海滩 3D (id: beach3d)。完整说明见 docs/BEACH3D_SCENE.md, 每个字段的含义 / 范围也写在 types/config.ts 的 Beach3DSceneConfig。
  // 颜色是 sRGB 十六进制, 画面上就是这个颜色 (已抵消曝光)。
  beach3dScene: {
    layout: {
      shoreZ: -6.0,        // 角色身后岸线 Z (m), 范围 −12 ~ −3; 调大 = 海更近, 调小 = 沙滩更深
      shoreCurve: 0.03,    // 岸线两侧后弯 (海湾), 范围 0 ~ 0.06; 调大 = 两侧沙地包得更远
      shoreWiggle: 0.45,   // 岸线蜿蜒幅度 (m), 范围 0 ~ 1.2; 调大 = 更曲折
      horizonCurveR: 700,  // 地平线弧度半径 (m), 范围 200 ~ 5000; 调小 = 可见海平线更低 (700 ≈ 眼高下 2.5°, 全身镜头落在胯部), 调大 = 接近平面 (= 眼高)
    },
    sky: {
      zenith: 0x2c8be6,    // 天顶: 饱和的蓝
      mid: 0x79c6f3,
      horizon: 0xe2f8f6,   // 地平线: 浅青白
      sunGlow: 0.22,       // 太阳一侧柔光, 范围 0 ~ 0.6; 调大 = 更亮更暖, 0 = 纯渐变
      cirrus: 0.5,         // 高空浅云 (斜向白丝带) 强度, 范围 0 ~ 1; 0 = 无, 调大更白更明显
      horizonBand: 0.7,    // 地平线附近亮带强度, 范围 0 ~ 1; 调大 = 天边更白更宽
    },
    sea: {
      shallow: 0x8ef0dc,
      mid: 0x2cc2cc,
      deep: 0x1690c4,
      horizon: 0x7dd6dc,
      foam: 0xffffff,
      glint: 0.9,          // 阳光闪光亮度, 范围 0 ~ 1.5; 调大更白更大 (>1 抢眼)
      glintDensity: 0.3,   // 闪光密度 (每格出现的概率), 范围 0 ~ 0.6; 调大 = 满海闪
      glintSpeed: 1.0,     // 闪烁速度倍率, 范围 0 ~ 3
      foamWidth: 0.7,      // 冲刷浪头白浪宽 (m), 范围 0.1 ~ 1.2; 调大更宽更显眼 (推上沙滩时自动再厚一些)
      swashAmp: 0.9,       // 浪推上沙滩的幅度 (m, 实际推进约 1.35 倍), 范围 0 ~ 1.5; 0 = 岸线静止
      swashSpeed: 0.55,    // 冲刷浪节奏 (rad/s, 周期 = 2π/值 秒), 范围 0.1 ~ 1.5; 调大更急
      waves: 1.0,          // 近岸浪峰 (白线 + 浪前浅亮 + 浪后深一档) 强度, 范围 0 ~ 1.5; 0 = 无
      waveBands: 4,        // 近岸浪峰道数 (各自速度 / 起点 / 相位不同), 范围 0 ~ 4 (整数); 调大 = 海面层次更多, 调小 = 更平静
      foamVariation: 0.7,  // 冲刷浪头宽度 / 推进距离沿岸与每轮的起伏, 范围 0 ~ 1; 0 = 整齐划一, 调大 = 更自然更不规则
      foamBreakup: 0.65,   // 白浪头的孔洞 / 蕾丝碎纹, 范围 0 ~ 1; 0 = 实心白带, 调大 = 更碎更透 (>0.9 显得稀)
      depthVariation: 0.7, // 深浅渐变分界的不规则度 (浅滩亮带 + 深色斑块), 范围 0 ~ 1; 0 = 平行色带, 调大 = 更有水下地形感
      glintSize: 1.0,      // 闪光十字星的像素大小倍率, 范围 0.5 ~ 2; 调大 = 更大更抢眼, 调小 = 更细碎
    },
    sand: {
      base: 0xf4e1c2,
      shade: 0xe2c49e,
      light: 0xf9ecd6,
      wet: 0xdcc097,
      rippleSpacing: 0.45, // 沙纹间距 (m), 范围 0.15 ~ 1.5; 调小更密 (只在几块区域出现, 远处淡出防闪烁)
      ripple: 0.5,         // 沙纹明暗强度, 范围 0 ~ 1; 0 = 无沙纹
      grain: 1.0,          // 细颗粒强度, 范围 0 ~ 2; 0 = 纯色 (远处自动淡出, 不闪)
    },
    haze: {
      start: 16,           // 空气透视起点 (m), 范围 5 ~ 60; 调小 = 中景就发白
      end: 75,             // 完全淡到海平线色的距离 (m), 范围 30 ~ 95 (须 < 相机远裁剪面 100)
    },
    mountains: {
      enabled: true,
      far: 0xa9b9e6,       // 远层岛色: 薰衣草蓝 (之后还会叠一层浓雾, 实际几乎融进天边)
      mid: 0x6fa6c4,       // 中层岛色: 灰蓝绿 (叠一层中等的雾)
      near: 0x4fae96,      // 近层小岛色: 薄荷青绿 (雾最薄, 顶上有树冠鼓包)
      heightScale: 1.0,    // 岛屿高度倍率, 范围 0.3 ~ 2; 1 = 最高的岛约海平线上 3°; 调大 = 岛更高更抢眼
      detail: 1.0,         // 轮廓细节 (远层起伏 / 中层山脊 / 近层树冠鼓包) 倍率, 范围 0 ~ 2; 0 = 光滑穹顶, 调大 = 更崎岖
      haze: 1.0,           // 空气透视强度 (每层融进天色的程度), 范围 0 ~ 1.5; 调大 = 远岛更淡更远, 调小 = 更清楚更近
    },
    // 手绘贴图素材 (public/ 下, 不带内容哈希; 缓存策略见 public/_headers 的 /scene/*)
    assets: {
      clouds: '/scene/beach3d/clouds.webp',     // 云图集 (2×2 → 1024², 透明底): 高耸积云 / 宽积云 / 扁长低云 / 小云簇
      frond: '/scene/beach3d/palm-frond.webp',  // 棕榈羽叶 (1024×320, 透明底, 叶柄在左、叶尖在右, 叶轴拉直在正中)
    },
    clouds: {
      density: 1.0,        // 云量: 正前方 11 朵手工构图的主角云之外, 其余方位的散云数量倍率 (1 = 16 朵), 范围 0 ~ 2; 0 = 只留主角云, 调大 = 天更满; 全部 1 次绘制
      size: 1.0,           // 云大小倍率, 范围 0.5 ~ 1.8; 调大 = 云更大更近 (>1.4 竖屏里会挤满), 调小 = 更远更碎
      opacity: 1.0,        // 云不透明度, 范围 0.3 ~ 1; 调小 = 更薄更透、更融进天色
      tint: 0xffffff,      // 云整体染色 (乘在手绘云贴图上), 白 = 原色; 偏暖 (如 0xfff4ec) = 更奶油, 偏冷 (如 0xeef0ff) = 更薰衣草
      tintJitter: 0.06,    // 每朵云的随机冷暖偏移, 范围 0 ~ 0.15; 调大 = 重复的贴图更不容易认出来, 太大会花
      driftDegPerSec: 0.12,// 漂移角速度 (°/s), 范围 0 ~ 1; 0 = 静止 (每朵云在此基础上 ±30% 随机)
      light: 0xfffbf2,     // 地平线积云带亮面: 奶白
      shade: 0xc3c2ea,     // 地平线积云带暗面: 淡薰衣草紫
      bank: 0.85,          // 地平线积云带 (最远的一圈低云, 画在远岛后面) 强度, 范围 0 ~ 1; 0 = 无
      bankHeightDeg: 1.8,  // 积云带最高处的仰角 (°), 范围 0.3 ~ 5; 调大 = 云带更高更厚
    },
    vegetation: {
      leafLight: 0x3fd08a,
      leafShade: 0x179a72,
      trunkLight: 0xddbf98, // 树干亮部: 温暖的浅棕灰
      trunkShade: 0x9d8a8e, // 树干暗部: 偏冷的灰棕
      sway: 0.08,          // 叶尖摆动幅度 (m), 范围 0 ~ 0.3; 0 = 不动
      fronds: 14,          // 每棵树的叶片数 (从冠顶嫩叶到下层老叶分层排布), 范围 8 ~ 16; 调大 = 叶冠更茂密 (每片 48 三角), 调小 = 更稀疏
      frondWidth: 1.15,    // 叶片宽度倍率 (手绘羽叶贴图的横向拉伸), 范围 0.7 ~ 1.4; 调大 = 叶更宽更蓬, 调小 = 更细长
      frondRiseDeg: 36,    // 中层叶叶柄的起始仰角 (°), 范围 10 ~ 60; 调大 = 叶冠整体更上扬挺拔, 调小 = 更平伸
      frondTierSpreadDeg: 34, // 分层: 冠顶嫩叶 / 最下层老叶相对中层的仰角差 (°), 范围 0 ~ 45; 调大 = 上层更朝天、下层更下垂 (星芒更开), 0 = 所有叶同一仰角
      frondDroop: 1.0,     // 叶轴后半段的下弯量倍率, 范围 0.4 ~ 1.6; 调大 = 叶尖垂得更低 (更柔软), 调小 = 叶更直更硬挺
      frondStiffness: 0.35, // 叶轴从叶柄起保持笔直的比例, 范围 0 ~ 0.6; 调大 = 硬挺段更长、拱形更高, 0 = 从叶柄起就开始弯
      frondFoldDeg: 24,    // 倒 V 形折叠: 两侧小叶向下折的角度 (°), 范围 0 ~ 45; 调大 = 叶片更立体 (侧看呈尖顶), 0 = 平板叶
    },
    rocks: {
      enabled: true,
      light: 0xe2d6c6,
      shade: 0x9a93b4,
      detail: 1,           // 礁石细分, 范围 0 ~ 2; 0 = 80 面, 1 = 320 面 (默认, 已足够圆润), 2 = 1280 面 (三角面 ×4)
    },
    shells: {
      enabled: true,
      count: 32,           // 贝壳 / 海螺 / 海星总数 (含近景 4 个大的), 范围 0 ~ 60; 沿整条海岸分布, 越近湿沙线越密 (>45 显得乱), 全部 1 次绘制
      size: 1.0,           // 大小倍率, 范围 0.5 ~ 2 (默认约 6~13cm, 近景大贝壳约 15cm, 比真实略大, 远处才认得出)
      colors: [0xfff0e0, 0xffc6ce, 0xffab92], // 奶白 / 浅粉 / 浅珊瑚 (随机取)
    },
    props: {
      enabled: true,       // 沙滩椅 + 遮阳伞 (角色右后方, 面朝大海; 1 次绘制, 约 2.3k 三角)
      frame: 0xf4e6d6,     // 椅架 / 伞杆: 奶白
      cushion: 0xffb4b0,   // 坐垫主色: 蜜桃粉
      stripe: 0xfbebdd,    // 坐垫条纹: 奶油色
      canopyA: 0xff9fb2,   // 伞面色 A: 蜜桃粉
      canopyB: 0xfaece0,   // 伞面色 B: 奶油白
      pillow: 0xb3e8d4,    // 小枕头: 薄荷绿
      groundShadow: 0.85,  // 道具 (棕榈 / 椅子 / 伞) 在沙地上的落影强度, 范围 0 ~ 1; 1 ≈ 与角色落影一样深, 0 = 无落影
    },
    lighthouse: {
      enabled: true,       // 海上小灯塔 (角色右前方的海面上, 替代原来右侧的远山; 与沙滩椅同一次绘制, 约 0.9k 三角; props.enabled = false 时一并隐藏)
      x: 10,               // 位置 x (m, 角色为原点, 正值 = 画面右侧), 范围 4 ~ 30
      z: -30,              // 位置 z (m, 负值 = 往海里), 范围 -60 ~ -14; 调小 = 更远更小
      scale: 1.0,          // 大小倍率, 范围 0.5 ~ 2; 1 ≈ 总高 5.2m (含礁石底座)
      body: 0xfff4ea,      // 塔身 / 栏杆: 奶白
      band: 0xffa3a8,      // 塔身色带 / 门 / 观景平台: 珊瑚粉
      roof: 0xc4b2ee,      // 灯室框 / 圆锥顶 / 顶珠: 薰衣草紫
      glass: 0xfff1c2,     // 灯室玻璃 / 小窗: 暖黄
      rock: 0xd6cbc6,      // 礁石底座: 浅灰米
      glow: 0.7,           // 灯室暖光自发光强度, 范围 0 ~ 1; 0 = 和其它部件一样受光, 1 = 完全不受明暗影响
    },
    dynamics: {
      enabled: true,
      respectReducedMotion: true,
      autoDowngrade: { enabled: true, minFps: 24, windowFrames: 120 }, // 平均帧率 < minFps (15 ~ 40) 时本次会话静止
    },
  } as Beach3DSceneConfig,
  lights: {
    dir: { base: 1.10, enabled: true },
    hemi: { base: 0.80, enabled: true },
    fill: { base: 0.65, enabled: true },
    globalMult: 1.0,
  } as LightConfig,
  postfx: {
    enabled: true,
    bloom: { strength: 0.045, radius: 0.36, threshold: 0.76 },
    vignette: { darkness: 0.0, offset: 0.5 },
    toneMapping: { mode: THREE.LinearToneMapping, exposure: 1.06 },
    bc: { brightness: 0.0, contrast: 0.035 },
    hs: { hue: 0.0, saturation: 0.01 },
    bloomInputScaleMobile: 0.3,
    bloomInputScaleDesktop: 0.5,
    composerMSAASamplesMobile: 3,
    composerMSAASamplesDesktop: 4,
  },
  saturation: {
    default: {
      preset: 'custom',
      clothing: 1.05,
      hair: 1.35,
      eyes: 1.35,
      skin: 1.02,
    } as MaterialSaturationConfig,
    presets: {
      vibrant: { preset: 'vibrant', clothing: 1.12, hair: 1.25, eyes: 1.25, skin: 1.04 } as MaterialSaturationConfig,
      sweet: { preset: 'sweet', clothing: 1.05, hair: 1.18, eyes: 1.20, skin: 1.02 } as MaterialSaturationConfig,
      cinematic: { preset: 'cinematic', clothing: 0.95, hair: 1.05, eyes: 1.10, skin: 0.98 } as MaterialSaturationConfig,
      original: { preset: 'original', clothing: 1.0, hair: 1.0, eyes: 1.0, skin: 1.0 } as MaterialSaturationConfig,
    },
  },
  outline: {
    enabled: true,
    widthMode: 'screenCoordinates',
    widthFactor: 0.0016,
    color: '#968890',
    lightingMix: 0.25,
  } as VrmOutlineConfig,
  mtoon: {
    skin: {
      face: {
        shadeShift: 0.0,
        shadeToony: 0.85,
        shadeColor: '#ede0ea', // 高明度纯净粉紫阴影
        litColor: '#ffffff', // 纯正白皙高光面
        rimLightingMix: 0.08,
        rimColor: '#fff0ea',
        rimFresnelPower: 5.5,
        rimLift: 0.03,
      },
      body: {
        shadeShift: -0.01,
        shadeToony: 0.82,
        shadeColor: '#e8d8e3', // 清透粉紫阴影
        litColor: '#ffffff', // 纯白受光面
        rimLightingMix: 0.16,
        rimColor: '#fff0ea',
        rimFresnelPower: 4.2,
        rimLift: 0.04,
      },
      polygonOffset: { enabled: false, factor: 0.0, units: 0.0 },
    },
    socks: {
      npr: {
        shadeShift: -0.05,
        shadeToony: 0.80,
        rimLightingMix: 0.60,
        rimColor: '#ffffff',
        rimFresnelPower: 3.0,
        rimLift: 0.15,
      },
      polygonOffset: { enabled: true, factor: -1.0, units: -4.0 },
    },
    cloth: {
      npr: {
        shadeShift: 0.0,
        shadeToony: 0.85,
        shadeColor: '#e6e2ed', // 清透微冷灰紫布料阴影
        rimLightingMix: 0.35,
        rimColor: '#ffffff',
        rimFresnelPower: 4.0,
        rimLift: 0.10,
      },
      innerPolygonOffset: { enabled: true, factor: -1.0, units: -2.0 },
      outerPolygonOffset: { enabled: true, factor: -3.0, units: -10.0 },
    },
    parts: {
      enabled: true,
      shadow2ndColor: [0.82, 0.76, 0.85] as [number, number, number],
      shadow3rdColor: [0.65, 0.60, 0.72] as [number, number, number],
      faceShadow2ndColor: [0.88, 0.82, 0.90] as [number, number, number],
      face: {
        softMix: 0.55,
        blurBoost: 0.32,
        shadowBorder: 0.48,
        shadowBlur: 0.32,
        shadow2ndStrength: 0.0,
        shadow2ndBorder: 0.3,
        shadow2ndBlur: 0.3,
        shadow3rdStrength: 0.0,
        shadow3rdBorder: 0.12,
        shadow3rdBlur: 0.26,
        rimBoost: 1.35,
        rimBorder: 0.45,
        rimBlur: 0.2,
        rimDirStrength: 0.28,
        rimMainStrength: 0.35,
        rimShadowMask: 0.4,
        hairSpecStrength: 0.0,
        clothSpecStrength: 0.0,
        skinSpecStrength: 0.0,
        skinSpecPower: 36,
        skinSpecFresnel: 0.0,
        skinSpecColor: [1.0, 0.97, 0.95],
        ambientLift: 0.12,
        shadeMainStrength: 0.18,
        matcap2ndStrength: 0.0,
        specularStrength: 0.0,
        specularPower: 36,
        specularBorder: 0.42,
        specularBlur: 0.22,
        reflectStrength: 0.0,
        reflectFresnel: 0.5,
        reflectMetallic: 0.0,
        reflectSmoothness: 0.45,
        backlightStrength: 0.0,
        backlightColor: [1.0, 0.82, 0.75],
        rimFresnelPower: 3.2,
        rimIndirStrength: 0.0,
        matcap2ndContrast: 1.0,
        matcap2ndScale: 1.05,
        emissionBoost: 0.0,
        distanceFade: 0.15,
        faceSoft: 0.25,
        normalSkinBoost: 0.0,
        envStrength: 0.08,
        gemFresnel: 0.0,
        outlineMix: 0.0,
        receiveShadowRate: 0.0,
      },
      body: {
        softMix: 0.6,
        blurBoost: 0.34,
        shadowBorder: 0.5,
        shadowBlur: 0.34,
        shadow2ndStrength: 0.0,
        shadow2ndBorder: 0.32,
        shadow2ndBlur: 0.32,
        shadow3rdStrength: 0.0,
        shadow3rdBorder: 0.14,
        shadow3rdBlur: 0.28,
        rimBoost: 1.4,
        rimBorder: 0.46,
        rimBlur: 0.2,
        rimDirStrength: 0.32,
        rimMainStrength: 0.3,
        rimShadowMask: 0.35,
        hairSpecStrength: 0.0,
        clothSpecStrength: 0.0,
        skinSpecStrength: 0.0,
        skinSpecPower: 38,
        skinSpecFresnel: 0.0,
        skinSpecColor: [1.0, 0.96, 0.94],
        ambientLift: 0.10,
        shadeMainStrength: 0.22,
        matcap2ndStrength: 0.0,
        specularStrength: 0.0,
        specularPower: 32,
        specularBorder: 0.4,
        specularBlur: 0.24,
        reflectStrength: 0.0,
        reflectFresnel: 0.55,
        reflectMetallic: 0.0,
        reflectSmoothness: 0.5,
        backlightStrength: 0.0,
        backlightColor: [1.0, 0.8, 0.72],
        rimFresnelPower: 3.0,
        rimIndirStrength: 0.0,
        matcap2ndContrast: 1.4,
        matcap2ndScale: 1.08,
        emissionBoost: 0.0,
        distanceFade: 0.12,
        faceSoft: 0.0,
        normalSkinBoost: 0.0,
        envStrength: 0.08,
        gemFresnel: 0.0,
        outlineMix: 0.0,
        receiveShadowRate: 1.0,
      },
      hair: {
        softMix: 0.0,
        blurBoost: 0.0,
        shadowBorder: -1.0,
        shadowBlur: 0.0,
        shadow2ndStrength: 0.0,
        shadow3rdStrength: 0.0,
        rimBoost: 1.0,
        rimBorder: 0.0,
        rimBlur: 0.0,
        rimDirStrength: 0.0,
        rimMainStrength: 0.0,
        rimShadowMask: 0.0,
        hairSpecStrength: 0.0,
        hairSpecPower: 56,
        hairSpecShift: -0.1,
        clothSpecStrength: 0.0,
        skinSpecStrength: 0.0,
        ambientLift: 0.0,
        shadeMainStrength: 0.0,
        matcap2ndStrength: 0.0,
        specularStrength: 0.0,
        reflectStrength: 0.0,
        reflectFresnel: 0.0,
        reflectSmoothness: 0.0,
        backlightStrength: 0.0,
        rimFresnelPower: 0.0,
        rimIndirStrength: 0.0,
        matcap2ndContrast: 1.0,
        matcap2ndScale: 1.0,
        faceSoft: 0.0,
        normalSkinBoost: 0.0,
        envStrength: 0.0,
        gemFresnel: 0.0,
        outlineMix: 0.0,
        receiveShadowRate: 1.0,
        fabricSheenStrength: 0.35,
        fabricSheenPower: 3.5,
        fabricSheenColor: [1.0, 0.92, 0.88],
      },
      eyes: {
        softMix: 0.7,
        blurBoost: 0.12,
        shadow2ndStrength: 0.0,
        shadow3rdStrength: 0.0,
        rimBoost: 1.0,
        rimBorder: 0.55,
        rimBlur: 0.12,
        rimDirStrength: 0.12,
        rimMainStrength: 0.1,
        rimShadowMask: 0.2,
        hairSpecStrength: 0.0,
        clothSpecStrength: 0.0,
        skinSpecStrength: 0.0,
        ambientLift: 0.05,
        shadeMainStrength: 0.15,
        matcap2ndStrength: 0.0,
        reflectStrength: 0.0,
        matcap2ndContrast: 1.15,
        faceSoft: 0.0,
        envStrength: 0.05,
        gemFresnel: 0.0,
        outlineMix: 0.0,
      },
      cloth: {
        softMix: 0.82,
        blurBoost: 0.3,
        shadowBorder: 0.5,
        shadowBlur: 0.16,
        shadow2ndStrength: 0.2,
        shadow2ndBorder: 0.32,
        shadow2ndBlur: 0.28,
        shadow3rdStrength: 0.0,
        shadow3rdBorder: 0.14,
        shadow3rdBlur: 0.26,
        rimBoost: 1.22,
        rimBorder: 0.5,
        rimBlur: 0.16,
        rimDirStrength: 0.35,
        rimMainStrength: 0.2,
        rimShadowMask: 0.3,
        hairSpecStrength: 0.0,
        clothSpecStrength: 0.0,
        clothSpecPower: 88,
        clothSpecDarkLuma: 0.0,
        clothSpecDarkBoost: 0.0,
        skinSpecStrength: 0.0,
        ambientLift: 0.05,
        shadeMainStrength: 0.3,
        matcap2ndStrength: 0.0,
        specularStrength: 0.0,
        specularPower: 64,
        specularBorder: 0.5,
        specularBlur: 0.12,
        reflectStrength: 0.0,
        reflectFresnel: 0.6,
        reflectMetallic: 0.0,
        reflectSmoothness: 0.55,
        backlightStrength: 0.0,
        rimFresnelPower: 2.8,
        rimIndirStrength: 0.0,
        matcap2ndContrast: 1.45,
        matcap2ndScale: 1.12,
        faceSoft: 0.0,
        normalSkinBoost: 0.0,
        envStrength: 0.18,
        gemFresnel: 0.0,
        outlineMix: 0.0,
      },
      socks: {
        softMix: 0.8,
        blurBoost: 0.28,
        shadow2ndStrength: 0.1,
        shadow3rdStrength: 0.0,
        rimBoost: 1.15,
        rimBorder: 0.5,
        rimBlur: 0.16,
        rimDirStrength: 0.28,
        rimMainStrength: 0.2,
        rimShadowMask: 0.28,
        hairSpecStrength: 0.0,
        clothSpecStrength: 0.0,
        clothSpecPower: 72,
        skinSpecStrength: 0.0,
        ambientLift: 0.1,
        shadeMainStrength: 0.28,
        matcap2ndStrength: 0.0,
        specularStrength: 0.0,
        reflectStrength: 0.0,
        reflectFresnel: 0.45,
        backlightStrength: 0.0,
        faceSoft: 0.0,
        envStrength: 0.14,
        gemFresnel: 0.0,
        outlineMix: 0.0,
      },
    },
  } as unknown as VrmMToonConfig,
  bodyMorph: {
    default: {
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
      thighs: 1.02,
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
      { id: 'tops', category: 'clothing', label: 'panel.partItems.tops', icon: '👚', defaultVisible: true },
      { id: 'bottoms', category: 'clothing', label: 'panel.partItems.bottoms', icon: '👖', defaultVisible: true },
      { id: 'dress', category: 'clothing', label: 'panel.partItems.dress', icon: '👗', defaultVisible: true },
      { id: 'neckwear', category: 'clothing', label: 'panel.partItems.neckwear', icon: '👔', defaultVisible: true },
      { id: 'armwear', category: 'clothing', label: 'panel.partItems.armwear', icon: '🧤', defaultVisible: true },
      { id: 'inner_top', category: 'clothing', label: 'panel.partItems.inner_top', icon: '🩱', defaultVisible: true },
      { id: 'inner_bottom', category: 'clothing', label: 'panel.partItems.inner_bottom', icon: '🩲', defaultVisible: true },
      { id: 'legwear', category: 'clothing', label: 'panel.partItems.legwear', icon: '🧦', defaultVisible: true },
      { id: 'shoes', category: 'clothing', label: 'panel.partItems.shoes', icon: '👟', defaultVisible: true },
      { id: 'accessory', category: 'accessory', label: 'panel.partItems.accessory', icon: '👓', defaultVisible: true },
      { id: 'hair_front', category: 'hair', label: 'panel.partItems.hair_front', icon: '🎀', defaultVisible: true },
      { id: 'hair_main', category: 'hair', label: 'panel.partItems.hair_main', icon: '💇‍♀️', defaultVisible: true },
      { id: 'hair_back', category: 'hair', label: 'panel.partItems.hair_back', icon: '💆‍♀️', defaultVisible: true },
      { id: 'face_skin', category: 'face', label: 'panel.partItems.face_skin', icon: '👧', defaultVisible: true },
      { id: 'face_brows', category: 'face', label: 'panel.partItems.face_brows', icon: '🤨', defaultVisible: true },
      { id: 'face_eyelines', category: 'face', label: 'panel.partItems.face_eyelines', icon: '👁️', defaultVisible: true },
      { id: 'face_highlights', category: 'face', label: 'panel.partItems.face_highlights', icon: '✨', defaultVisible: true },
      { id: 'face_irises', category: 'face', label: 'panel.partItems.face_irises', icon: '🟣', defaultVisible: true },
      { id: 'face_mouth', category: 'face', label: 'panel.partItems.face_mouth', icon: '👄', defaultVisible: true },
      { id: 'body_skin', category: 'body', label: 'panel.partItems.body_skin', icon: '🧍‍♀️', defaultVisible: true },
    ] as ModelPartDefinition[],
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
    disableLoadingOverlayInDev: true,
  },
} as const;

export type AppConfig = typeof APP_CONFIG;
