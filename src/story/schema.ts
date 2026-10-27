import { z } from 'zod';

/**
 * 镜头景别与预设 (Camera Shot Presets)
 */
export const CameraShotTypeSchema = z.enum([
  'extreme_close_up', // 面部微距特写 (眼眸、微表情)
  'close_up',         // 半身特写 (肩膀以上，标准独白机位)
  'medium',           // 中景 (胸部以上，默认交互交流景)
  'full',             // 全身大景 (展示服饰、步态与环境)
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
  'hero_backlight_reveal',   // 英雄逆光破晓 (对齐太阳轮廓爆光)
  'dutch_tilt',              // 荷兰角微倾 (内心犹豫不安)
  'arc_sweep',               // 侧方微弧度横摇
  'orbit_subtle',            // 微妙环绕微动
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
  windMultiplier: z.number().min(1.0).max(3.5).default(1.0),
  alignSunBacklight: z.boolean().default(false),
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

/**
 * 角色表演调度规范 (Actor Directive: 起势 ➔ 开声 ➔ 余韵)
 */
export const ActorDirectiveSchema = z.object({
  /** 开声前 0.4s 的起势特征动作 (VRMA 动作 key) */
  leadInMotion: z.string().optional(),
  /** 发音期间的主干动作 (VRMA 动作 key 或空由 EMAGE 接管) */
  motion: z.string().optional(),
  /** 面部活体表情 */
  expression: ExpressionDirectiveSchema.default({
    base: 'gentle_smile',
    intensity: 0.7,
    microReaction: 'none',
  }),
  /** 台词文本 (推送到 TTS 发音并驱动口型) */
  speechText: z.string().describe("角色的说话对白"),
});
export type ActorDirective = z.input<typeof ActorDirectiveSchema>;

/**
 * 舞台画幅与转场规范 (Cinematics Directive)
 */
export const CinematicsDirectiveSchema = z.object({
  /** 是否开启 21:9 电影遮幅 */
  letterbox: z.boolean().optional().default(false),
  /** 全屏黑幕白字 (用于幕间转场或内心独白) */
  intertitle: z.object({
    text: z.string(),
    durationSec: z.number().default(2.5),
    style: z.enum(['noto_serif', 'modern_sans', 'typewriter']).default('noto_serif'),
    bgmFaded: z.boolean().default(true),
    requireClick: z.boolean().optional().default(false),
  }).optional(),
  /** 视觉转场特效 */
  transition: z.enum(['none', 'fade_to_black', 'white_flash', 'eye_blink']).optional().default('none'),
  /** 后期调色预设 */
  grading: z.enum(['default', 'sepia_memory', 'rainy_noir', 'dream_bloom']).optional().default('default'),
});
export type CinematicsDirective = z.input<typeof CinematicsDirectiveSchema>;

/**
 * 音乐与音效规范 (Audio Directive)
 */
export const AudioDirectiveSchema = z.object({
  bgmAction: z.enum(['play', 'fade_in', 'fade_out', 'stop_cut', 'duck', 'muffle']).default('play'),
  bgmMood: z.string().optional(),
  bgmTrack: z.string().optional(),
  bgmVolume: z.number().min(0).max(1).default(0.4),
  ambience: z.string().optional(),
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
export const StoryChoiceSchema = z.object({
  id: z.string(),
  text: z.string(),
  subText: z.string().optional(),
  badge: z.string().optional(),
  icon: z.string().optional(),
  image: z.string().optional(),
  actionType: z.enum([
    'next_beat',           // 推进到指定下一拍
    'change_scene',        // 切换 3D 场景世界 (void / beach3d / light / dark)
    'swap_outfit',         // 换装 (dress / qipao / maid / school)
    'change_lang',         // 切换语言 (zh-CN / en / ja)
    'open_provider_config',// 打开自定义大模型服务配置弹窗
    'finish',              // 结束并退出剧情
    'custom',              // 自定义回调
  ]).optional().default('next_beat'),
  actionPayload: z.any().optional(),
  nextBeatId: z.string().optional(),
  selected: z.boolean().optional(),
});
export type StoryChoice = z.input<typeof StoryChoiceSchema>;

/**
 * 核心情节点 (Story Beat)
 */
export const StoryBeatSchema = z.object({
  id: z.string(),
  cinematics: CinematicsDirectiveSchema.optional(),
  camera: CameraDirectiveSchema.optional(),
  actor: ActorDirectiveSchema,
  audio: AudioDirectiveSchema.optional(),
  choices: z.array(StoryChoiceSchema).optional(),
  confirmChoice: StoryChoiceSchema.optional(),
  choiceLayout: z.enum(['list', 'grid', 'auto']).optional().default('auto'),
  allowInput: z.boolean().optional().default(false),
  inputPlaceholder: z.string().optional(),
  interaction: z.enum(['none', 'camera_drag']).optional().default('none'),
});
export type StoryBeat = z.input<typeof StoryBeatSchema>;

/**
 * 完整故事剧本 (Story Script)
 */
export const StoryScriptSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  initialBeatId: z.string(),
  beats: z.record(z.string(), StoryBeatSchema),
});
export type StoryScript = z.input<typeof StoryScriptSchema>;
