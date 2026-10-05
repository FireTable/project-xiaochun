/**
 * Project XiaoChun 全局配置类型定义 (Single Source of Truth)
 */

export interface LightChannelConfig {
  base: number;
  enabled: boolean;
}

export interface LightConfig {
  dir: LightChannelConfig;
  hemi: LightChannelConfig;
  fill: LightChannelConfig;
  globalMult: number;
}

/** 场景背景主题。light/dark = 线稿世界; transparent = 透明桌宠; beach = 海滩 (AI 插画长条背景, 见 BeachSceneConfig); beach3d = 海滩 3D (纯 Three.js 场景, 见 Beach3DSceneConfig)。 */
export type LineworkTheme = 'light' | 'dark' | 'transparent' | 'beach' | 'beach3d';

export interface SceneComponentConfig {
  topHeader?: boolean;
  chatBar?: boolean;
  headBubble?: boolean;
  heightRuler?: boolean;
  dropZone?: boolean;
}

export interface SceneTauriConfig {
  resizable: boolean;
  cornerHandles?: boolean;
  alwaysOnTop?: boolean;
}

export interface SceneItemConfig {
  id: string;
  nameKey: string;
  icon?: string;
  lineworkTheme: LineworkTheme;
  isTransparent?: boolean;
  components: SceneComponentConfig;
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

export type VrmOutlineWidthMode = 'none' | 'worldCoordinates' | 'screenCoordinates';

export interface VrmOutlineConfig {
  enabled: boolean;
  widthMode: VrmOutlineWidthMode;
  widthFactor: number;
  color: string;
  lightingMix: number;
}

export interface VrmMaterialNprShadingConfig {
  shadeShift: number;
  shadeToony: number;
  shadeColor?: string;
  litColor?: string;
  rimLightingMix: number;
  rimColor: string;
  rimFresnelPower: number;
  rimLift: number;
}

export interface PolygonOffsetConfig {
  enabled: boolean;
  factor: number;
  units: number;
}

/** MToon 部件特化着色参数 */
export interface VrmMToonPartConfig {
  softMix: number;
  blurBoost: number;
  shadow2ndStrength: number;
  shadow2ndBorder?: number;
  shadow2ndBlur?: number;
  shadow3rdStrength: number;
  shadow3rdBorder?: number;
  shadow3rdBlur?: number;
  shadowBorder?: number;
  shadowBlur?: number;
  rimBoost: number;
  rimBorder: number;
  rimBlur: number;
  rimDirStrength: number;
  rimMainStrength?: number;
  rimShadowMask?: number;
  rimFresnelPower?: number;
  rimIndirStrength?: number;
  hairSpecStrength: number;
  hairSpecPower?: number;
  hairSpecShift?: number;
  clothSpecStrength: number;
  clothSpecPower?: number;
  clothSpecDarkLuma?: number;
  clothSpecDarkBoost?: number;
  skinSpecStrength?: number;
  skinSpecPower?: number;
  skinSpecFresnel?: number;
  skinSpecColor?: [number, number, number];
  specularStrength?: number;
  specularPower?: number;
  specularBorder?: number;
  specularBlur?: number;
  reflectStrength?: number;
  reflectFresnel?: number;
  reflectMetallic?: number;
  reflectSmoothness?: number;
  backlightStrength?: number;
  backlightColor?: [number, number, number];
  matcap2ndStrength: number;
  matcap2ndContrast?: number;
  matcap2ndScale?: number;
  emissionBoost?: number;
  distanceFade?: number;
  faceSoft?: number;
  normalSkinBoost?: number;
  envStrength?: number;
  ambientLift?: number;
  shadeMainStrength?: number;
  gemFresnel?: number;
  outlineMix?: number;
  receiveShadowRate?: number;
  fabricSheenStrength?: number;
  fabricSheenPower?: number;
  fabricSheenColor?: [number, number, number];
}

/** MToon 全部件分级预设配置 */
export interface VrmMToonPartsConfig {
  enabled: boolean;
  shadow2ndColor: [number, number, number];
  shadow3rdColor: [number, number, number];
  faceShadow2ndColor?: [number, number, number];
  face: VrmMToonPartConfig;
  body: VrmMToonPartConfig;
  hair: VrmMToonPartConfig;
  eyes: VrmMToonPartConfig;
  cloth: VrmMToonPartConfig;
  socks: VrmMToonPartConfig;
}

export interface VrmMToonConfig {
  skin: {
    face: VrmMaterialNprShadingConfig;
    body: VrmMaterialNprShadingConfig;
    polygonOffset: PolygonOffsetConfig;
  };
  socks: {
    npr: VrmMaterialNprShadingConfig;
    polygonOffset: PolygonOffsetConfig;
  };
  cloth: {
    npr: VrmMaterialNprShadingConfig;
    innerPolygonOffset: PolygonOffsetConfig;
    outerPolygonOffset: PolygonOffsetConfig;
  };
  parts: VrmMToonPartsConfig;
}

export interface EmageMotionConfig {
  gestureIntensity: number;
  fingerIntensity: number;
  torsoIntensity: number;
  spineIntensity: number;
  hipIntensity: number;
  legIntensity: number;
  footIkIdlePlant: number;
  headIntensity: number;
  dampingStiffness: number;
  temporalSmoothRadius: number;
  chunkSeamMaxFrames: number;
  streamingCatchUpRate: number;
  advanceFrames: number;
  fadeInDuration: number;
  switchSegmentCrossFade: number;
  poseMicroFadeJumpDiv: number;
  poseMicroFadeMinSec: number;
  poseMicroFadeMaxSec: number;
  poseMicroFadeJumpMin: number;
  seamJumpThreshold: number;
  seamJumpFramesScale: number;
  vqSampleTemperature: number;
  vqSampleTopK: number;
}

export interface BodyMorphConfig {
  overallScale: number;
  head: number;
  neck: number;
  neckDepth: number;
  neckLength: number;
  shoulderWidth: number;
  torsoLength: number;
  torsoThickness: number;
  waist: number;
  belly: number;
  hips: number;
  buttocks: number;
  buttocksThickness: number;
  buttocksPitch: number;
  buttocksSpread: number;
  bust: number;
  bustThickness: number;
  bustPitch: number;
  bustSpread: number;
  arms: number;
  armLength: number;
  hands: number;
  fingerWidth: number;
  thighs: number;
  thighLength: number;
  calves: number;
  calfLength: number;
  feet: number;
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
  bodyMorph?: Partial<BodyMorphConfig>;
}

/**
 * 海滩场景 (id: beach) 的全部可调参数。每项注释写明 合法范围 / 调大调小的效果。
 * 背景 = 一张 1280×1810 的竖长条 (天空/主景/沙地), 随相机俯仰角滚动; 左右不随角色 bodyTurn 变。
 */
export interface BeachSceneConfig {
  assets: {
    /** 竖长条贴图 (scripts/build-beach-strip.mjs 生成)。 */
    strip: string;
    /** 动态遮罩贴图: R = 海面 (波光 / 水波只作用于此), G = 纯天空 (云漂移只作用于此)。 */
    mask: string;
  };
  /** 背景滚动 / 海平线对位。 */
  scroll: {
    /** 海平线对齐到角色髋部上方多少米 (m)。范围 -0.3 ~ 0.6。调大 = 海平线在屏幕上升高 (更接近腰/胸), 调小 = 更低 (贴近髋/大腿)。 */
    horizonAboveHipsM: number;
    /** 背景随俯仰的滚动幅度 (倍率)。范围 0.2 ~ 1。1 = 用满整条长条 (±89° 刚好滚到天空 / 沙地的另一端); 调小 = 滚得更少更"远" (但俯视极限看到的沙地也更少)。 */
    parallax: number;
  };
  /**
   * 滚轮缩放 (相机前后距离变化) 时背景跟着缩放: 推近 → 背景一起放大, 拉远 → 一起缩小。
   * 缩放中心是平视时的海平线在屏幕上的位置 (髋部附近), 所以海平线不会因为缩放上下乱跳。
   * 缩放倍率 = (默认取景视距 / 当前视距) ^ strength, 再夹到 [minScale, maxScale]。
   */
  zoom: {
    /** 总开关。false = 背景大小固定 (滚轮只放大缩小角色)。 */
    enabled: boolean;
    /**
     * 背景跟随程度。范围 0 ~ 1。0 = 背景完全不动 (像无限远); 1 = 背景与角色等比缩放 (像贴在角色身后的一堵墙)。
     * 调大 = 推近时背景放大更多、全身时人物与场景比例更"锁定"; 调小 = 背景更远更稳, 但近景时人与景的比例变化更明显。建议 0.5 ~ 0.8。
     */
    strength: number;
    /** 背景最小缩放倍率 (拉远极限)。范围 0.4 ~ 1。调小 = 拉远时能看到更宽的海面 (横屏受素材宽度限制, 最多缩到刚好铺满 1280 宽, 竖屏空间大)。 */
    minScale: number;
    /** 背景最大缩放倍率 (推近极限)。范围 1 ~ 3。素材只有 1280 宽, >2 开始明显发糊; 调大 = 近景背景更大更糊。 */
    maxScale: number;
  };
  /** 局部动态。总开关 enabled=false 时背景完全静止、不画粒子 (波光停在一个固定好看的帧)。 */
  dynamics: {
    /** 总开关。关闭后只剩静态背景, 零额外动态开销。 */
    enabled: boolean;
    /** 系统开启"减少动态效果" (prefers-reduced-motion) 时自动关闭动态。建议保持 true。 */
    respectReducedMotion: boolean;
    /** 低性能自动降级: 连续 windowFrames 帧的平均帧率低于 minFps 时, 本次会话内关闭动态 (切走再切回海滩会重新评估)。 */
    autoDowngrade: { enabled: boolean; minFps: number; windowFrames: number };
    /** 海面。 */
    sea: {
      /** 波光亮度。范围 0 ~ 1。0 = 无波光; 调大 = 亮斑更白更显眼 (>0.8 开始抢眼); 调小 = 更含蓄。 */
      glint: number;
      /** 波光密度 (每个格子出现亮斑的概率)。范围 0 ~ 0.6。调大 = 满海闪; 调小 = 零星几点。 */
      glintDensity: number;
      /** 波光闪烁速度倍率。范围 0 ~ 3。1 = 默认 (每个亮斑 2~4 秒一闪); 调大更急促, 调小更慵懒。 */
      glintSpeed: number;
      /** 水面微扰幅度 (strip 像素, 作用于海面画面本身)。范围 0 ~ 3。0 = 海面纹理不动; 调大 = 波纹晃动更明显 (>2 开始像"水波滤镜"而不是赛璐璐)。 */
      wobble: number;
    };
    /** 云。只让纯天空区域横向漂移, 采样做镜像边界, 不会露边。 */
    cloud: {
      /** 云来回漂移的幅度 (strip 像素, 1280 宽的图)。范围 0 ~ 40。0 = 不动; 调大 = 漂得远 (>25 能看出云与棕榈叶/远岛的相对错位)。 */
      driftPx: number;
      /** 一个来回的周期 (秒)。范围 20 ~ 300。调大 = 更慢更克制。 */
      periodSec: number;
    };
    /** 飘落的花瓣 / 光点 (GPU 粒子, 零 CPU 开销, 画在角色身后, 不会遮挡角色)。 */
    particles: {
      /** 桌面端数量。范围 0 ~ 64。0 = 不画粒子; 调大 = 更热闹 (>30 开始抢戏)。 */
      count: number;
      /** 移动端数量 (isMobile)。范围 0 ~ 32。 */
      countMobile: number;
      /** 下落速度倍率。范围 0.2 ~ 3。1 = 一片花瓣约 45~100 秒从屏幕上方飘到下方, 偏慢; 调大会显得"刮风"。 */
      speed: number;
      /** 大小倍率 (CSS 像素)。范围 0.5 ~ 2。1 = 花瓣约 9~15px。 */
      size: number;
      /** 整体不透明度。范围 0 ~ 1。调小 = 更淡更不抢眼。 */
      opacity: number;
      /** 粒子里"光点"(圆形柔光) 所占比例。范围 0 ~ 1。0 = 全是花瓣; 1 = 全是光点。 */
      moteRatio: number;
    };
  };
  /** 角色与背景融合 (只是场景级微调, 不改任何角色材质)。 */
  blend: {
    /** 半球光天空色 (偏冷的奶白青), 默认线稿场景为 0xfffaf8。 */
    hemiSky: number;
    /** 半球光地面反射色 (奶油沙色), 默认线稿场景为 0xe2d6e6 (薰衣草灰)。沙滩上人物暗部应反射奶油暖色而不是紫灰。 */
    hemiGround: number;
    /** 主方向光颜色 (略暖的日光)。 */
    dirColor: number;
    /** 地面落影颜色 (奶茶褐偏粉, 不用纯黑)。 */
    shadowColor: number;
    /** 地面落影不透明度。范围 0 ~ 0.6。调大 = 影子更实。 */
    shadowOpacity: number;
    /** 脚下柔和接触影的颜色。 */
    contactColor: number;
    /** 脚下接触影不透明度。范围 0 ~ 0.6。 */
    contactOpacity: number;
    /** 脚下接触影直径 (m)。范围 0.4 ~ 1.6。 */
    contactSizeM: number;
  };
}

/**
 * 海滩 3D 场景 (id: beach3d) 的全部可调参数 (src/core/scene/beach3d/)。
 * 颜色一律写 sRGB 十六进制 (与设计稿取色一致); 画面最终颜色 = 这里的颜色 (已抵消色调映射曝光), 不受角色灯光影响。
 * 每个影响画质 / 性能的数值都写了 合法范围 与 调大调小的效果。
 */
export interface Beach3DSceneConfig {
  /** 岸线 / 地面布局 (单位 m; 角色站在原点, 相机在 +Z 一侧, 海在 −Z 方向)。 */
  layout: {
    /** 角色正后方岸线 (海水最远退到的位置) 的 Z。范围 −12 ~ −3。调大 (接近 0) = 海离脚更近, 全身镜头里能看到浪花线; 调小 = 沙滩更深, 海退到更远。 */
    shoreZ: number;
    /** 岸线向两侧往后弯的程度 (海湾感, z −= shoreCurve·x²)。范围 0 ~ 0.06。0 = 笔直海岸; 调大 = 两侧沙地包得更远, 棕榈可以种得更靠后。 */
    shoreCurve: number;
    /** 岸线的小幅蜿蜒幅度 (m)。范围 0 ~ 1.2。0 = 光滑弧线; 调大 = 岸线更曲折。 */
    shoreWiggle: number;
    /**
     * 地平线弧度半径 (m): 离相机 (视距+3m) 以外的地面按 e²/(2R) 往下弯, 让可见海平线落在眼高以下 (参考图: 海平线在胯部)。
     * 范围 200 ~ 5000。调小 = 海平线更低 (默认机位 700 ≈ 低 2.5°; 300 ≈ 低 3.8°), 远景更"球面"; 调大 = 越接近真实平面 (海平线 = 相机眼高)。
     * 角色附近完全是平的, 不影响脚下沙地 / 落影。
     */
    horizonCurveR: number;
  };
  /** 天空 (全屏着色器, 不依赖几何, 任何俯仰都覆盖整屏)。 */
  sky: {
    /** 天顶色。 */
    zenith: number;
    /** 中段天空色。 */
    mid: number;
    /** 海平线附近天空色 (高调奶白青)。 */
    horizon: number;
    /** 太阳方向的柔光强度 (太阳方向 = 主方向光方向)。范围 0 ~ 0.6。调大 = 朝太阳一侧天空更亮更暖; 0 = 纯渐变。 */
    sunGlow: number;
    /** 高空浅云 (斜向的柔和白丝带, 只在中高仰角, 缓慢漂移) 强度。范围 0 ~ 1。0 = 无; 调大 = 更白更明显。 */
    cirrus: number;
    /** 地平线附近亮带 (天边泛白) 强度。范围 0 ~ 1。0 = 只有渐变; 调大 = 天边更白更宽。 */
    horizonBand: number;
  };
  /** 海 (与沙地同一张地面着色器, 无实时反射)。 */
  sea: {
    /** 岸边浅水色 (薄荷松石)。 */
    shallow: number;
    /** 中段海水色 (青绿松石)。 */
    mid: number;
    /** 远海色。 */
    deep: number;
    /** 海平线处的海色 (与天空着色器 "海平线以下" 共用, 保证远处无缝)。 */
    horizon: number;
    /** 浪花 / 波纹线颜色。 */
    foam: number;
    /** 卡通波纹 (浅色短横纹) 强度。范围 0 ~ 1。0 = 纯色海面; 调大 = 波纹更明显 (>0.8 显得花)。 */
    ripple: number;
    /** 卡通波纹密度 (每格出现的概率)。范围 0.1 ~ 1。调大 = 满海波纹; 调小 = 零星几道。 */
    rippleDensity: number;
    /** 阳光闪光亮度。范围 0 ~ 1.5。0 = 无闪光; 调大 = 星形亮点更白更大 (>1 开始抢眼)。 */
    glint: number;
    /** 阳光闪光密度。范围 0 ~ 0.6。调大 = 满海闪; 调小 = 零星几点。 */
    glintDensity: number;
    /** 闪光闪烁速度倍率。范围 0 ~ 3。调大 = 更急促, 调小 = 更慵懒。 */
    glintSpeed: number;
    /** 冲刷浪头 (推上沙滩的白浪, 扇贝形边) 宽度 (m)。范围 0.1 ~ 1.2。推上时自动加厚约 1.2 倍、退回时变薄。调大 = 白浪更宽更显眼。 */
    foamWidth: number;
    /** 冲刷浪推上沙滩的幅度 (m; 实际从岸线下 0.3m 推进到约 1.35 倍此值)。范围 0 ~ 1.5。0 = 岸线静止; 调大 = 浪冲得更远 (湿沙带也随之加宽)。 */
    swashAmp: number;
    /** 冲刷浪节奏 (rad/s, 周期 = 2π/值 秒; 快推慢退)。范围 0.1 ~ 1.5。调大 = 浪更急。 */
    swashSpeed: number;
    /** 近岸浪峰 (3 道从外海推向岸边的浪: 断续白线 + 浪前浅亮 + 浪后深一档) 强度。范围 0 ~ 1.5。0 = 无。 */
    waves: number;
  };
  /** 沙地 (真实地平面 y=0, 角色踩在上面, 落影是原有的实时阴影投射)。 */
  sand: {
    /** 沙地主色 (奶油色)。 */
    base: number;
    /** 沙纹 / 暗部色。 */
    shade: number;
    /** 亮部色块色。 */
    light: number;
    /** 湿沙色 (浪花退去的区域)。 */
    wet: number;
    /** 不规则沙纹 (只在噪声圈出的几块区域, 迎光坡亮 / 背光坡暗的柔和起伏) 间距 (m)。范围 0.15 ~ 1.5。调小 = 更密 (远处按距离淡出防闪烁)。 */
    rippleSpacing: number;
    /** 沙纹明暗强度。范围 0 ~ 1。0 = 无沙纹; 调大 = 起伏更明显。 */
    ripple: number;
    /** 细颗粒 (高频噪声 + 零星亮晶粒) 强度。范围 0 ~ 2。0 = 纯色; 调大 = 颗粒更粗糙。按屏幕导数自动淡出, 远处不闪。 */
    grain: number;
  };
  /** 空气透视 (远处物体向天空 / 海平线色淡出, 赛璐璐背景的"高调远景")。 */
  haze: {
    /** 开始淡出的距离 (m)。范围 5 ~ 60。调小 = 中景就开始发白发淡。 */
    start: number;
    /** 完全淡到海平线色的距离 (m)。范围 30 ~ 95 (相机远裁剪面 100m, 需小于它)。调小 = 远处更朦胧 (可见海平线约在 35~40m 处, end 越接近它海平线越白)。 */
    end: number;
  };
  /** 远山剪影 (随相机平移的远景层, 永远贴在海平线上)。 */
  mountains: {
    /** 是否显示。 */
    enabled: boolean;
    /** 远层山色 (淡薰衣草蓝)。 */
    far: number;
    /** 近层岛色 (淡松石绿)。 */
    near: number;
    /** 高度倍率。范围 0.3 ~ 2。1 = 最高峰约海平线上 7°; 调大 = 山更高更抢眼。 */
    heightScale: number;
  };
  /** 卡通云 (实例化面片, 一次绘制)。 */
  clouds: {
    /** 云朵数量 (360° 均布)。范围 0 ~ 40。调大 = 天空更热闹, 每朵都是一个面片 (开销极小)。 */
    count: number;
    /** 漂移角速度 (°/s)。范围 0 ~ 1。0 = 静止; 0.15 ≈ 一朵云 1 分钟挪约 9°。 */
    driftDegPerSec: number;
    /** 大小倍率。范围 0.5 ~ 2。 */
    scale: number;
    /** 云亮部色。 */
    light: number;
    /** 云暗部色 (底部的薰衣草蓝阴影)。 */
    shade: number;
  };
  /** 棕榈 / 草丛 (实例化渲染, 布局见 beach3dLayout.ts)。 */
  vegetation: {
    /** 棕榈叶亮部色 (翠绿)。 */
    leafLight: number;
    /** 棕榈叶暗部色。 */
    leafShade: number;
    /** 树干亮部色。 */
    trunkLight: number;
    /** 树干暗部色。 */
    trunkShade: number;
    /** 草丛亮部色。 */
    grassLight: number;
    /** 草丛暗部色。 */
    grassShade: number;
    /** 草丛里点缀的小花色 (与角色粉色系呼应)。 */
    flower: number;
    /** 叶片随风摆动幅度 (m, 叶尖)。范围 0 ~ 0.3。0 = 不动; 调大 = 风更大。 */
    sway: number;
    /** 草丛数量倍率。范围 0 ~ 1 (1 = 布局里全部草丛)。调小 = 更少的实例 (三角面线性减少)。 */
    grassDensity: number;
  };
  /** 岸边礁石 (实例化低模, 卡通三阶明暗; 在水里的礁石周围有一圈白浪)。 */
  rocks: {
    /** 是否显示。 */
    enabled: boolean;
    /** 亮面色。 */
    light: number;
    /** 暗面色 (偏薰衣草的冷灰, 与角色暗部色调呼应)。 */
    shade: number;
    /** 礁石细分级别 (平滑法线的细分二十面体)。范围 0 ~ 2。0 = 80 面 (轮廓略多边形); 1 = 320 面 (默认, 圆润); 2 = 1280 面 (三角面 ×4)。 */
    detail: number;
  };
  /** 飘落花瓣 (GPU 粒子, 世界空间, 只在角色身后)。 */
  petals: {
    /** 桌面端数量。范围 0 ~ 80。0 = 不画; 调大 = 更热闹 (>40 抢戏)。 */
    count: number;
    /** 移动端数量。范围 0 ~ 40。 */
    countMobile: number;
    /** 大小倍率。范围 0.5 ~ 2。 */
    size: number;
    /** 下落速度倍率。范围 0.2 ~ 3。 */
    speed: number;
    /** 不透明度。范围 0 ~ 1。 */
    opacity: number;
  };
  /** 局部动态 (浪花 / 波纹 / 闪光 / 云 / 树叶 / 花瓣)。降级逻辑与 beach 场景共用 (sceneMotion.ts)。 */
  dynamics: {
    /** 总开关。false = 全部静止 (停在一个固定的好看时刻), 零额外 CPU 开销。 */
    enabled: boolean;
    /** 系统开启"减少动态效果" (prefers-reduced-motion) 时自动静止。建议保持 true。 */
    respectReducedMotion: boolean;
    /** 低帧率自动降级: 连续 windowFrames 帧平均帧率 < minFps 时本次会话静止 (切走再切回重新评估)。minFps 范围 15 ~ 40, windowFrames ≥ 30。 */
    autoDowngrade: { enabled: boolean; minFps: number; windowFrames: number };
  };
  /** 场景级灯光 / 落影配色 (只改灯色与落影色, 不改强度、不改角色材质)。 */
  light: {
    /** 半球光天空色。 */
    hemiSky: number;
    /** 半球光地面反射色 (奶油沙色, 角色暗部带一点暖)。 */
    hemiGround: number;
    /** 主方向光颜色 (暖日光)。主光方向不变 = 场景太阳方向 (天空柔光 / 树木明暗都读主光方向)。 */
    dirColor: number;
    /** 沙地上的落影颜色 (淡紫褐, 赛璐璐的影色而不是黑)。 */
    shadowColor: number;
    /** 落影不透明度。范围 0 ~ 0.7。调大 = 影子更实。 */
    shadowOpacity: number;
  };
}
