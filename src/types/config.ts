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

/** 场景背景主题。light/dark = 线稿世界; transparent = 透明桌宠; beach3d = 海滩 (纯 Three.js 3D 场景, 见 Beach3DSceneConfig)。 */
export type LineworkTheme = 'light' | 'dark' | 'transparent' | 'beach3d';

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

/**
 * 相机不穿地 (APP_CONFIG.camera.groundClamp, 实现见 src/core/camera/groundClamp.ts)。
 * 俯仰范围不变 (近 180°); 请求的机位低于 地面 + minHeight 时沿视线推近, 让线稿地板 / 海滩沙地永远在相机下方、地平线固定在世界空间。
 * 透明场景 (transparent) 不生效。
 */
export interface CameraGroundClampConfig {
  /** 总开关。false = 相机可以穿到地面以下 (旧行为)。 */
  enabled: boolean;
  /** 相机离地最小高度 (m)。范围 0.05 ~ 0.5, 建议 0.1 ~ 0.3; 调小 = 地平线更贴近脚底, 但沙纹 / 网格掠射更容易闪; 调大 = 地平线高于脚踝。 */
  minHeight: number;
  /** FOV 补偿强度。范围 0 ~ 1; 0 = 推近时不放宽视角 (人物变大最多), 1 = 人物大小基本不变 (透视畸变最强); 上限 camera.maxFov。 */
  fovCompensation: number;
  /** 沿视线推近的最小视距 (m)。范围 0.3 ~ 1.0; 再近就改为抬高环绕中心 (只在相机 Y 偏移把目标点压到贴地时出现)。 */
  minDollyDistance: number;
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
    /** 近岸浪峰 (从外海推向岸边的浪: 断续白线 + 浪前浅亮 + 浪后深一档) 强度。范围 0 ~ 1.5。0 = 无。 */
    waves: number;
    /** 近岸浪峰道数 (各道速度 / 起点 / 相位不同, 浪峰线沿岸弯曲、粗细与断续沿岸变化)。范围 0 ~ 4 (整数)。调大 = 海面层次更多; 调小 = 更平静。 */
    waveBands: number;
    /** 冲刷浪头宽度与推进距离的起伏 (沿岸 + 每一轮都不同)。范围 0 ~ 1。0 = 整齐划一的白带; 调大 = 更自然、更不规则。 */
    foamVariation: number;
    /** 白浪头的孔洞与蕾丝碎纹。范围 0 ~ 1。0 = 实心白带; 调大 = 更碎更透 (>0.9 显得稀)。 */
    foamBreakup: number;
    /** 深浅渐变分界的不规则度 (噪声打乱的分界 + 外侧浅滩亮带 + 中段深色斑块)。范围 0 ~ 1。0 = 平行色带; 调大 = 更有水下地形感。 */
    depthVariation: number;
    /** 闪光十字星的像素大小倍率 (屏幕空间, 不受透视拉伸)。范围 0.5 ~ 2。调大 = 更大更抢眼; 调小 = 更细碎。 */
    glintSize: number;
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
    /** 不规则沙纹 (只在噪声圈出的几块区域, 迎光坡亮 / 背光坡暗的柔和起伏) 间距 (m)。范围 0.15 ~ 1.5。调小 = 更密更碎; 调大 = 更稀更舒缓 (远处按屏幕导数淡出防闪烁)。 */
    rippleSpacing: number;
    /** 沙纹明暗强度。范围 0 ~ 1。0 = 无沙纹; 调大 = 起伏更明显 (>0.5 显得条纹很重)。 */
    ripple: number;
    /** 沙纹覆盖面积: 噪声圈出的沙纹区块占地面的比例。范围 0 ~ 1。0 = 没有沙纹区块; 调大 = 区块更多更大 (1 ≈ 满地沙纹)。 */
    rippleCoverage: number;
    /** 近处淡出距离 (m, 离相机)。这个距离以外沙纹满强度, 越近越淡, 相机脚下只剩约 15% 的隐约纹路。范围 0 ~ 20。调大 = 近景沙地更平滑干净; 0 = 不淡出。 */
    rippleNearFade: number;
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
  /** 远岛剪影 (随相机平移的远景层, 逐像素解析的三层岛屿 + 空气透视, 永远贴在海平线上)。 */
  mountains: {
    /** 是否显示。 */
    enabled: boolean;
    /** 远层岛色 (薰衣草蓝; 着色时再叠一层浓雾, 看上去几乎融进天边)。 */
    far: number;
    /** 中层岛色 (灰蓝绿, 叠中等的雾)。 */
    mid: number;
    /** 近层小岛色 (薄荷青绿, 雾最薄, 顶上有树冠鼓包)。 */
    near: number;
    /** 高度倍率。范围 0.3 ~ 2。1 = 最高的岛约海平线上 3°; 调大 = 岛更高更抢眼。 */
    heightScale: number;
    /** 轮廓细节倍率 (远层柔和起伏 / 中层山脊 / 近层树冠鼓包)。范围 0 ~ 2。0 = 光滑穹顶; 调大 = 更崎岖。 */
    detail: number;
    /** 空气透视强度 (每层融进天色的程度)。范围 0 ~ 1.5。调大 = 远岛更淡更远; 调小 = 更清楚更近。 */
    haze: number;
  };
  /** 手绘贴图素材的 URL (放在 public/ 下)。 */
  assets: {
    /** 云图集: 2×2 张透明底手绘积云 (高耸积云 / 宽积云 / 扁长低云 / 小云簇), 每朵云的格子位置写在 beach3dLayout.ts 的 CLOUD_SPRITES。 */
    clouds: string;
    /** 棕榈羽叶贴图: 一整片羽状叶, 透明底, 叶柄在左 (u = 0)、叶尖在右 (u = 1), 叶轴拉直在 v = 0.5。 */
    frond: string;
  };
  /** 二次元积云 (手绘云贴图的实例化面片, 一次绘制; 永远在可见海平线之上) + 天空穹顶里的地平线积云带。 */
  clouds: {
    /** 云量: 正前方 11 朵手工构图的主角云之外, 其余方位散云的数量倍率 (1 = 16 朵)。范围 0 ~ 2。0 = 只留主角云; 调大 = 天更满。全部 1 次绘制。 */
    density: number;
    /** 云大小倍率。范围 0.5 ~ 1.8。调大 = 云更大更近; 调小 = 更远更碎。 */
    size: number;
    /** 云不透明度。范围 0.3 ~ 1。调小 = 更薄更透、更融进天色。 */
    opacity: number;
    /** 云整体染色 (sRGB, 乘在手绘云贴图上)。白 = 原色; 偏暖 = 更奶油, 偏冷 = 更薰衣草。 */
    tint: number;
    /** 每朵云的随机冷暖偏移。范围 0 ~ 0.15。调大 = 同一张贴图的重复更难认出; 太大会花。 */
    tintJitter: number;
    /** 漂移角速度 (°/s)。范围 0 ~ 1。0 = 静止; 0.12 ≈ 一朵云 1 分钟挪约 7° (每朵 ±30% 随机)。 */
    driftDegPerSec: number;
    /** 地平线积云带 (天空着色器里画的最远一圈低云) 亮面色 (奶白)。 */
    light: number;
    /** 地平线积云带暗面色 (淡薰衣草紫)。 */
    shade: number;
    /** 地平线积云带 (天空穹顶里最远的一圈低云, 画在远岛后面, 只在部分方位出现) 强度。范围 0 ~ 1。0 = 无。 */
    bank: number;
    /** 积云带最高处的仰角 (°)。范围 0.3 ~ 5。调大 = 云带更高更厚。 */
    bankHeightDeg: number;
  };
  /** 棕榈 (实例化渲染, 布局见 beach3dLayout.ts)。 */
  vegetation: {
    /** 棕榈叶亮部色 (翠绿)。 */
    leafLight: number;
    /** 棕榈叶暗部色。 */
    leafShade: number;
    /** 树干亮部色 (温暖的浅棕灰)。 */
    trunkLight: number;
    /** 树干暗部色 (偏冷的灰紫; 叶冠下方会再深一点)。 */
    trunkShade: number;
    /** 叶片随风摆动幅度 (m, 叶尖)。范围 0 ~ 0.3。0 = 不动; 调大 = 风更大。 */
    sway: number;
    /** 每棵树的叶片数 (从冠顶嫩叶到下层老叶分层排布)。范围 8 ~ 16。调大 = 叶冠更茂密 (每片 48 三角); 调小 = 更稀疏。 */
    fronds: number;
    /** 叶片宽度倍率 (手绘羽叶贴图的横向拉伸)。范围 0.7 ~ 1.4。调大 = 叶更宽更蓬; 调小 = 更细长。 */
    frondWidth: number;
    /** 中层叶叶柄的起始仰角 (°)。范围 10 ~ 60。调大 = 叶冠整体更上扬挺拔; 调小 = 更平伸。 */
    frondRiseDeg: number;
    /** 分层: 冠顶嫩叶 / 最下层老叶相对中层的仰角差 (°)。范围 0 ~ 45。调大 = 上层更朝天、下层更下垂 (星芒更开); 0 = 所有叶同一仰角。 */
    frondTierSpreadDeg: number;
    /** 叶轴后半段 (硬挺段之后) 的下弯量倍率。范围 0.4 ~ 1.6。调大 = 叶尖垂得更低; 调小 = 叶更直更硬挺。 */
    frondDroop: number;
    /** 叶轴从叶柄起保持笔直的比例。范围 0 ~ 0.6。调大 = 硬挺段更长、拱形更高; 0 = 从叶柄起就开始弯。 */
    frondStiffness: number;
    /** 倒 V 形折叠: 两侧小叶向下折的角度 (°)。范围 0 ~ 45。调大 = 叶片更立体 (侧看呈尖顶); 0 = 平板叶。 */
    frondFoldDeg: number;
    /** 叶冠落影的深浅 (相对树干落影)。范围 0.4 ~ 1。调小 = 叶影更透更浅 (小叶间漏光); 1 = 与树干一样深。 */
    frondShadow: number;
    /** 棕榈 / 沙堡落影边缘的柔化倍率。范围 0.3 ~ 2。1 ≈ 与角色 / 椅子落影一样柔; 调大 = 更虚 (小叶锯齿变淡); 调小 = 更锐利。 */
    shadowSoftness: number;
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
  /** 扇贝 (实例化, 1 次绘制; 放射肋条 + 波浪壳缘 + 铰合部一对小耳朵), 稀疏地散在湿沙线附近 (相机附近一左一右两个大的), 避开角色脚下 / 椅子 / 树根 / 沙堡。 */
  shells: {
    /** 是否显示。 */
    enabled: boolean;
    /** 总数 (含近景 2 个大扇贝)。范围 0 ~ 30。彼此至少隔 0.8m; 调大 = 更热闹 (>18 开始显得多)。 */
    count: number;
    /** 大小倍率。范围 0.5 ~ 2。1 = 壳宽约 6~11cm (近景大扇贝约 15cm)。 */
    size: number;
    /** 颜色: 每个扇贝随机取一个, 越靠前的颜色出现概率越大 (前两个约占 2/3)。默认暖调米白 / 奶油色 / 浅粉 / 浅珊瑚; 不要用纯白 (受光面会比沙子亮, 像在反光)。 */
    colors: number[];
  };
  /** 沙滩椅 + 遮阳伞 (角色右后方, 面朝大海, 1 次绘制) 与道具落影。位置见 beach3dLayout.ts (CHAIR / PARASOL)。 */
  props: {
    /** 是否显示沙滩椅 + 遮阳伞 (关掉后地面上也没有它们的落影; 棕榈落影不受影响)。 */
    enabled: boolean;
    /** 椅架 / 伞杆色。 */
    frame: number;
    /** 坐垫主色。 */
    cushion: number;
    /** 坐垫条纹色。 */
    stripe: number;
    /** 伞面色 A (相间的布片)。 */
    canopyA: number;
    /** 伞面色 B (相间的布片)。 */
    canopyB: number;
    /** 小枕头色。 */
    pillow: number;
    /** 道具 (棕榈 / 椅子 / 伞 / 沙堡) 在沙地上的落影强度 (按太阳方向投影)。范围 0 ~ 1。1 ≈ 与角色实时落影一样深; 0 = 无落影。 */
    groundShadow: number;
  };
  /** 海上小灯塔 (角色右前方的海面上, 礁石底座 + 一圈白浪; 与沙滩椅同一次绘制, props.enabled = false 时一并隐藏)。 */
  lighthouse: {
    /** 是否显示。 */
    enabled: boolean;
    /** 位置 x (m, 角色为原点, 正值 = 画面右侧)。范围 4 ~ 30。 */
    x: number;
    /** 位置 z (m, 负值 = 往海里)。范围 -60 ~ -14。调小 = 更远更小。 */
    z: number;
    /** 大小倍率。范围 0.5 ~ 2。1 ≈ 总高 5.2m (含礁石底座)。 */
    scale: number;
    /** 塔身 / 栏杆色 (奶白)。 */
    body: number;
    /** 塔身色带 / 门 / 观景平台色 (珊瑚粉)。 */
    band: number;
    /** 灯室框 / 圆锥顶 / 顶珠色 (薰衣草紫)。 */
    roof: number;
    /** 灯室玻璃 / 小窗色 (暖黄)。 */
    glass: number;
    /** 礁石底座色。 */
    rock: number;
    /** 灯室暖光自发光强度。范围 0 ~ 1。0 = 和其它部件一样受光; 1 = 完全不受明暗影响。 */
    glow: number;
  };
  /** 湿沙堆成的小沙堡 (角色左前方的沙地上, 左侧棕榈树干的前面; 与沙滩椅同一次绘制, props.enabled = false 时一并隐藏)。贝壳 / 海星会避开它。 */
  sandcastle: {
    /** 是否显示。 */
    enabled: boolean;
    /** 位置 x (m, 角色为原点, 负值 = 画面左侧)。范围 −3 ~ 3。|x| 太小会挨着角色 (离角色至少约 1.5m)。 */
    x: number;
    /** 位置 z (m, 正值 = 往镜头方向)。范围 0.6 ~ 3.5。调大 = 离镜头更近、画面里更靠下更大。 */
    z: number;
    /** 大小倍率。范围 0.6 ~ 1.6。1 ≈ 最高塔 0.45m (旗尖约 0.52m), 底台约 0.52 × 0.44m。 */
    scale: number;
    /** 朝向 (°)。范围 −180 ~ 180。0 = 城门正对镜头方向 (+Z); 正值 = 城门转向画面右侧 (露出左侧的塔), 负值反之。 */
    yawDeg: number;
    /** 沙堡沙色 (比沙滩更深更暖的湿沙色)。调浅 = 更像干沙; 调深 = 更湿。 */
    color: number;
    /** 塔顶小旗色。 */
    flag: number;
  };
  /** 局部动态 (浪花 / 波纹 / 闪光 / 云 / 树叶)。降级逻辑见 sceneMotion.ts。 */
  dynamics: {
    /** 总开关。false = 全部静止 (停在一个固定的好看时刻), 零额外 CPU 开销。 */
    enabled: boolean;
    /** 系统开启"减少动态效果" (prefers-reduced-motion) 时自动静止。建议保持 true。 */
    respectReducedMotion: boolean;
    /** 低帧率自动降级: 连续 windowFrames 帧平均帧率 < minFps 时本次会话静止 (切走再切回重新评估)。minFps 范围 15 ~ 40, windowFrames ≥ 30。 */
    autoDowngrade: { enabled: boolean; minFps: number; windowFrames: number };
  };
}
