import { z } from 'zod';

/**
 * 镜头景别与预设 (Camera Shot Presets)
 */
export const CameraShotTypeSchema = z.enum([
  'extreme_close_up', // 面部微距特写 (眼眸、微表情)
  'close_up',         // 半身特写 (肩膀以上，标准独白机位)
  'medium_close_up',  // 中近景 (胸口以上、比 medium 更紧，抓拍反应镜头)
  'medium',           // 中景 (胸部以上，默认交互交流景)
  'full',             // 全身大景 (展示服饰、步态与环境)
  'wide',             // 远景 (全身 + 大量环境留白，开场 / 空间展示)
  'dramatic_low',     // 仰角低机位 (地平线压低，庄严或向阳感)
]);
export type CameraShotType = z.infer<typeof CameraShotTypeSchema>;

/**
 * 镜头运镜轨迹动势 (Camera Trajectories)
 */
export const CameraTrajectoryTypeSchema = z.enum([
  'none',                    // 保持当前或瞬切
  'push_in',                 // 斯坦尼康平缓推近 (拉近心理距离)
  'pull_out',                // 缓退后拉 (展示环境留白)
  'hero_spiral_orbit',       // 英雄螺旋升空环绕 (360°旋转并升为俯角)
  'hero_backlight_reveal',   // 英雄逆光破晓 (机位绕到太阳对面、压低并收窄视角，人物压在落日轮廓上)
  'dutch_tilt',              // 荷兰角微倾 (镜头滚转约 -9°，内心犹豫不安；下一个非 dutch 运镜会自动回正)
  'arc_sweep',               // 侧方微弧度横摇
  'orbit_subtle',            // 微妙环绕微动
  'pedestal_up',             // 垂直升镜打量 (自裙摆腰身自下而上缓缓升至胸前/面部)
]);
export type CameraTrajectoryType = z.infer<typeof CameraTrajectoryTypeSchema>;

/**
 * 镜头调度规范 (Camera Directive)
 */
export const CameraDirectiveSchema = z.object({
  shot: CameraShotTypeSchema.default('medium'),
  movement: CameraTrajectoryTypeSchema.default('none'),
  durationSec: z.number().min(0.2).max(12.0).default(1.2),
  easing: z.enum(['quintic_smooth', 'ease_out_dramatic', 'linear']).default('quintic_smooth'),
  targetFov: z.number().min(15).max(65).optional(),
  /** 运镜期间的环境风力倍率 (>1 时角色发丝/裙摆被阵风吹动，运镜结束后约 1s 内平滑回落) */
  windMultiplier: z.number().min(1.0).max(3.5).default(1.0),
  alignSunBacklight: z.boolean().default(false),
  /** 自定义水平环绕角度 (度数，例如 +40, -45, 180, 360) */
  orbitAngleDeg: z.number().optional(),
});
export type CameraDirective = z.input<typeof CameraDirectiveSchema>;

/**
 * 基础情绪基调 (Base Emotion Presets)
 */
export const EmotionBaseSchema = z.enum([
  'neutral',      // 平和自然
  'gentle_smile',// 温柔浅笑
  'hesitant',    // 迟疑隐忍
  'shy',         // 羞怯低回
  'surprised',   // 惊讶一怔
  'sad_longing', // 忧伤期盼
  'playful',     // 俏皮灵动
  'happy',       // 开心舒畅
  'angry',       // 生气 / 嫌弃 (傲娇的可爱小脾气)
]);
export type EmotionBase = z.infer<typeof EmotionBaseSchema>;

/**
 * 戏剧性面部微反应脉冲 (Facial Micro-Reactions)
 */
export const EmotionMicroReactionSchema = z.enum([
  'none',          // 无特殊微事件
  'blush_ramp',    // 脸红缓缓晕染 (1.2s 渐显, 6s 半衰)
  'avert_gaze',    // 羞怯垂眸避开视线 (随后害羞回视)
  'eye_crinkle',   // 轻笑眼角微眯抽动
  'sudden_shock',  // 瞳孔一怔放大随后眨眼回神
]);
export type EmotionMicroReaction = z.infer<typeof EmotionMicroReactionSchema>;

/**
 * 动态活体表情规范 (Expression Directive)
 */
export const ExpressionDirectiveSchema = z.object({
  base: EmotionBaseSchema.default('gentle_smile'),
  intensity: z.number().min(0).max(1).default(0.7),
  microReaction: EmotionMicroReactionSchema.optional().default('none'),
});
export type ExpressionDirective = z.input<typeof ExpressionDirectiveSchema>;

// ─────────────────────────── 多语言文本 (i18n) ───────────────────────────

/** 剧本支持的语言，与 `@/i18n` 的 Lang 同构 (这里不 import i18n，保持 schema 纯净) */
export const STORY_LANGS = ['zh-CN', 'en', 'ja'] as const;
export type StoryLang = (typeof STORY_LANGS)[number];

/**
 * 可本地化文本：直接写字符串 = 所有语言通用 (向后兼容)；
 * 写对象 = 按语言取值，`zh-CN` 必填，缺失的语言回退到 zh-CN。
 * 在每一拍「进入时」按当前语言解析 (见 `localize.ts`)，所以 getter 也可以用来做“按剧情状态变化的台词”。
 */
export const LocalizedTextSchema = z.union([
  z.string(),
  z.object({
    'zh-CN': z.string(),
    en: z.string().optional(),
    ja: z.string().optional(),
  }),
]);
export type LocalizedText = z.input<typeof LocalizedTextSchema>;

/**
 * 舞台画幅与转场规范 (Cinematics Directive)
 */
const buildCinematicsSchema = <T extends z.ZodTypeAny>(text: T) =>
  z.object({
    /** 是否开启 21:9 电影遮幅 (粘性：未写则沿用上一拍) */
    letterbox: z.boolean().optional().default(false),
    /** 全屏黑幕白字 (用于幕间转场或内心独白) */
    intertitle: z.object({
      text,
      durationSec: z.number().default(2.5),
      style: z.enum(['noto_serif', 'modern_sans', 'typewriter']).default('noto_serif'),
      bgmFaded: z.boolean().default(true),
      requireClick: z.boolean().optional().default(false),
    }).optional(),
    /**
     * 视觉转场：
     * - eye_blink：黑场睁眼；white_flash：强光闪白后缓缓褪去；fade_to_black：淡入黑场再淡出。
     * 由 change_scene / custom 选项进入的拍，会先“盖住画面”再执行动作，所以场景切换发生在遮罩之下。
     */
    transition: z.enum(['none', 'fade_to_black', 'white_flash', 'eye_blink']).optional().default('none'),
    /** 后期调色预设 (粘性：写了才改变，`default` 复位；剧终自动复位) */
    grading: z.enum(['default', 'sepia_memory', 'rainy_noir', 'dream_bloom']).optional().default('default'),
    /**
     * 环境风力 0~3 (粘性：写了才改变；剧终复位)。0 = 无风，1 = 微风，2 = 清风，3 = 海风。
     * 与镜头的 windMultiplier (运镜期间的阵风) 叠加，取两者较大值。
     */
    wind: z.number().min(0).max(3).optional(),
    /**
     * 环境时间补间 (小时，仅 beach3d 这类带昼夜的场景有效)：从 `from` (缺省 = 直接用 `to`) 平滑推到 `to`，用时 `durationSec`。
     * 例：下午 14:30 → 傍晚 17:30，光线慢慢变金。离开本拍 / 剧终会停掉补间。
     */
    timeOfDay: z.object({
      from: z.number().min(0).max(24).optional(),
      to: z.number().min(0).max(24),
      durationSec: z.number().min(0).max(120).default(8),
    }).optional(),
  });

export const CinematicsDirectiveSchema = buildCinematicsSchema(z.string());
export type CinematicsDirective = z.input<typeof CinematicsDirectiveSchema>;
export type GradingPreset = z.infer<typeof CinematicsDirectiveSchema>['grading'];
export type TransitionKind = z.infer<typeof CinematicsDirectiveSchema>['transition'];

/**
 * 角色表演调度规范 (Actor Directive: 起势 ➔ 开声 ➔ 余韵)
 */
const buildActorSchema = <T extends z.ZodTypeAny>(speech: T) =>
  z.object({
    /** 起势动作 (VRMA 动作 key，必须是 MOTION_CATALOG 里的 id)：开场即播、单次、自然播完，不会被开声打断 */
    leadInMotion: z.string().optional(),
    /** 发音期间的主干动作 (VRMA 动作 key 或空由 EMAGE 接管) */
    motion: z.string().optional(),
    /** 朝向：back = 背对镜头 (瞬间就位)，front = 迈步转身面向镜头 (bodyTurn 踏步) */
    facing: z.enum(['front', 'back']).optional(),
    /** 面部活体表情 */
    expression: ExpressionDirectiveSchema.default({
      base: 'gentle_smile',
      intensity: 0.7,
      microReaction: 'none',
    }),
    /** 台词文本 (推送到 TTS 发音并驱动口型) */
    speechText: speech.describe('角色的说话对白'),
  });

export const ActorDirectiveSchema = buildActorSchema(z.string());
export type ActorDirective = z.input<typeof ActorDirectiveSchema>;

/**
 * 音乐与音效规范 (Audio Directive)
 */
export const AudioDirectiveSchema = z.object({
  /** play/fade_in 播放(或切到)指定 BGM；fade_out 淡出；stop_cut 立停；duck 持续压低；muffle 低通闷住 */
  bgmAction: z.enum(['play', 'fade_in', 'fade_out', 'stop_cut', 'duck', 'muffle']).default('play'),
  /** 程序化 BGM 预设 id (无需任何音频文件)：void_drone / dusk_warm / longing / lights_on / farewell */
  bgmMood: z.string().optional(),
  /** BGM 文件 URL (循环播放)；加载失败会回退到 bgmMood，再失败则静音继续 */
  bgmTrack: z.string().optional(),
  bgmVolume: z.number().min(0).max(1).default(0.4),
  /** BGM 渐入/渐出秒数 */
  bgmFadeSec: z.number().min(0).max(10).optional(),
  /** 环境声 (程序化)：sea_waves / wind / none */
  ambience: z.string().optional(),
  ambienceVolume: z.number().min(0).max(1).optional(),
  /** 单个内置音效 id */
  playSfx: z.string().optional(),
  sfx: z.array(z.object({
    id: z.string(),
    delaySec: z.number().default(0),
    volume: z.number().default(0.8),
  })).optional(),
});
export type AudioDirective = z.input<typeof AudioDirectiveSchema>;

/**
 * 剧情历史记录项 (Story History Entry)
 */
export const StoryHistoryEntrySchema = z.object({
  id: z.string(),
  role: z.enum(['xiaochun', 'user', 'system']),
  text: z.string(),
  subText: z.string().optional(),
  choiceBadge: z.string().optional(),
  timestamp: z.number().default(() => Date.now()),
});
export type StoryHistoryEntry = z.infer<typeof StoryHistoryEntrySchema>;

/**
 * 抉择分支与交互引子 (Story Choice)
 */
const buildChoiceSchema = <T extends z.ZodTypeAny>(text: T) =>
  z.object({
    id: z.string(),
    text,
    subText: text.optional(),
    badge: z.string().optional(),
    icon: z.string().optional(),
    image: z.string().optional(),
    actionType: z.enum([
      'next_beat',           // 推进到指定下一拍
      'change_scene',        // 切换 3D 场景世界 (void / beach3d / light / dark)
      'swap_outfit',         // 换装 (dress / qipao / maid / school)
      'change_lang',         // 切换语言 (zh-CN / en / ja)，之后的台词按新语言播放
      'open_provider_config',// 打开自定义大模型服务配置弹窗
      'finish',              // 结束并退出剧情
      'custom',              // 自定义回调 (actionPayload 为函数；务必同时给 nextBeatId，否则会进入 LLM 生成通路)
    ]).optional().default('next_beat'),
    actionPayload: z.any().optional(),
    nextBeatId: z.string().optional(),
    selected: z.boolean().optional(),
    /** 选了这张卡之后，本拍的后续拍可按 `variants[branch]` 改写 (场景 / 调色 / 风力 / BGM / 音效等) */
    branch: z.string().optional(),
    /** 剧本场景别名 (lineart_day / lineart_night / beach)；在下一拍的转场遮罩下切换 */
    scene: z.string().optional(),
    /** 切到支持时间的场景 (如 beach) 之前先把环境时间设到这个小时 (scene 与 change_scene 预览都适用) */
    sceneHour: z.number().min(0).max(24).optional(),
  });

export const StoryChoiceSchema = buildChoiceSchema(z.string());
export type StoryChoice = z.input<typeof StoryChoiceSchema>;
export const LocalizedStoryChoiceSchema = buildChoiceSchema(LocalizedTextSchema);
export type LocalizedStoryChoice = z.input<typeof LocalizedStoryChoiceSchema>;

/**
 * 核心情节点 (Story Beat)
 */
const buildBeatSchema = <T extends z.ZodTypeAny>(text: T) => {
  const choice = buildChoiceSchema(text);
  return z.object({
    id: z.string(),
    cinematics: buildCinematicsSchema(text).optional(),
    camera: CameraDirectiveSchema.optional(),
    actor: buildActorSchema(text),
    audio: AudioDirectiveSchema.optional(),
    choices: z.array(choice).optional(),
    confirmChoice: choice.optional(),
    choiceLayout: z.enum(['list', 'grid', 'auto']).optional().default('auto'),
    allowInput: z.boolean().optional().default(false),
    inputPlaceholder: text.optional(),
    interaction: z.enum(['none', 'camera_drag']).optional().default('none'),
    /** 台词说完后自动进入的下一拍 (无需点击)；与 choices 互斥使用 */
    autoNextBeatId: z.string().optional(),
    /** 说完后的停顿毫秒 (留白 / 呼吸感)，默认 600；TTS 不可用时会按字数补足最短阅读时间 */
    autoNextDelayMs: z.number().min(0).max(30000).optional(),
    /** 台词说完 + autoNextDelayMs 后结束整段剧情 (镜头平滑回到默认视角，交还自由聊天) */
    autoFinish: z.boolean().optional(),
    /** 屏幕提示 (非角色、不朗读、不进对白回顾)：告诉用户“现在可以做什么” */
    hint: text.optional(),
    /** 进入本拍时切换到的场景 (剧本别名 lineart_day / lineart_night / beach，或真实场景 id)，在转场遮罩下切换 */
    scene: z.string().optional(),
    /**
     * 按 choice.branch 改写本拍：`variants[branch]` 是本拍的一个局部覆盖 (cinematics / camera / audio / actor / hint / scene 等逐层合并)。
     */
    variants: z.record(z.string(), z.any()).optional(),
  });
};

/** 已解析成单一语言的情节点 (引擎状态 / Player / LLM 生成都用这个) */
export const StoryBeatSchema = buildBeatSchema(z.string());
export type StoryBeat = z.input<typeof StoryBeatSchema>;
/** 剧本作者写的情节点：文本字段可以是多语言对象 */
export const LocalizedStoryBeatSchema = buildBeatSchema(LocalizedTextSchema);
export type LocalizedStoryBeat = z.input<typeof LocalizedStoryBeatSchema>;

/**
 * 完整故事剧本 (Story Script)
 */
export const StoryScriptSchema = z.object({
  id: z.string(),
  title: LocalizedTextSchema,
  description: LocalizedTextSchema.optional(),
  initialBeatId: z.string(),
  /** 'browser'：开场语言取浏览器语言 (zh / en / ja，其余回退 en)；缺省沿用 UI 语言 */
  startLang: z.enum(['browser']).optional(),
  beats: z.record(z.string(), LocalizedStoryBeatSchema),
});
export type StoryScript = z.input<typeof StoryScriptSchema>;
