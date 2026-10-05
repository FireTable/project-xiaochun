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

/** 场景背景主题。light/dark = 线稿世界; transparent = 透明桌宠; beach = 海滩 (AI 插画长条背景, 见 BeachSceneConfig)。 */
export type LineworkTheme = 'light' | 'dark' | 'transparent' | 'beach';

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
 * 背景 = 一张 1280×1930 的竖长条 (天空/主景/沙地), 随相机俯仰角滚动; 左右不随角色 bodyTurn 变。
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
  /** 脚下沙地 (真实的 3D 地面): 一块边缘柔和淡出的沙色圆盘, 铺在角色脚下, 让脚"踩"在沙上而不是悬在背景前。 */
  ground: {
    /** 总开关。false = 不画沙地 (只剩落影 / 接触影)。 */
    enabled: boolean;
    /** 沙地圆盘半径 (m)。范围 0.6 ~ 4。调大 = 脚下沙地铺得更开 (拉远 / 俯视时更明显); 调小 = 只在脚边一小圈。 */
    radiusM: number;
    /** 沙色 (要和 beach-strip 里的沙地同色, 俯视时才能与背景无缝衔接)。 */
    color: number;
    /** 沙地整体不透明度。范围 0 ~ 1。调小 = 与背景融合得更淡; 1 = 中心完全盖住背景。 */
    opacity: number;
    /** 沙纹明暗幅度。范围 0 ~ 0.2。0 = 纯色; 调大 = 沙纹更明显 (>0.12 开始像条纹)。 */
    rippleStrength: number;
    /** 圆盘从多大半径(占 radiusM 的比例)开始向外淡出。范围 0.2 ~ 0.9。调小 = 过渡带更宽更柔; 调大 = 边缘更清晰。 */
    featherStart: number;
    /**
     * 脚没入画面时才显示沙地: 脚底在屏幕上的 NDC y 低于 fadeOutNdcY 时完全隐藏 (半身取景脚在画面外, 保持原样、不穿帮),
     * 高于 fadeInNdcY 时完全显示, 之间线性过渡。范围 −2 ~ 0.5, 且 fadeOutNdcY < fadeInNdcY。
     */
    fadeOutNdcY: number;
    fadeInNdcY: number;
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
