import type { PlayMotionOptions } from './sources/clip';

export interface MotionCatalogItem extends PlayMotionOptions {
  /** 动作唯一标识 (camelCase) */
  id: string;
  /** 动作多语言名称 i18n Key */
  nameKey: string;
  /** 动作文件路径（或已预加载的 ArrayBuffer） */
  url: string;
  /** 动作多语言描述说明 i18n Key */
  descriptionKey?: string;
  /** 可选：静态回退名称或展示名（兼容非 i18n 场景） */
  name?: string;
  /** 可选：静态回退描述说明（兼容非 i18n 场景） */
  description?: string;
  /** 语义化分类 */
  category?: 'posture' | 'expression' | 'greeting' | 'dance' | 'speech' | 'cute' | 'romance' | 'casual' | 'playful' | 'showcase' | 'celebration';
}

export const MOTION_CATALOG = {
  // ── 1. 核心核心待机与倾听姿态 (Core Idle & Listening) ──
  listening: {
    id: 'listening',
    nameKey: 'motion.listening.name',
    descriptionKey: 'motion.listening.description',
    name: '纯净倾听',
    description: '身躯微倾、面带微笑的亲切专注倾听姿态',
    url: '/vrm/motion/listening.vrma?v=11',
    loop: true,
    fadeDuration: 0.95,
    antiClip: false,
    enableFootIK: false,
    mask: 'all',
    category: 'posture',
  },
  thinking: {
    id: 'thinking',
    nameKey: 'motion.thinking.name',
    descriptionKey: 'motion.thinking.description',
    name: '托腮沉思',
    description: '单手托下巴作沉思状',
    url: '/vrm/motion/thinking.vrma',
    loop: true,
    fadeDuration: 0.65,
    antiClip: false,
    mask: 'all',
    category: 'expression',
  },
  classicIdle: {
    id: 'classicIdle',
    nameKey: 'motion.classicIdle.name',
    descriptionKey: 'motion.classicIdle.description',
    name: '自然待机',
    description: '经典自然的呼吸起伏与站姿待机',
    url: '/vrm/motion/classic-idle.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'posture',
  },
  elegantStand: {
    id: 'elegantStand',
    nameKey: 'motion.elegantStand.name',
    descriptionKey: 'motion.elegantStand.description',
    name: '亭亭玉立',
    antiClip: false,
    description: '身体斜侧线条优美的优雅模特立姿',
    url: '/vrm/motion/elegant-stand.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'posture',
  },
  maidPoise: {
    id: 'maidPoise',
    nameKey: 'motion.maidPoise.name',
    descriptionKey: 'motion.maidPoise.description',
    name: '女仆端立',
    description: '双手交叠于腹前、脚步并拢的端庄女仆站姿',
    url: '/vrm/motion/maid-poise.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'posture',
  },
  modelStand: {
    id: 'modelStand',
    nameKey: 'motion.modelStand.name',
    descriptionKey: 'motion.modelStand.description',
    name: '模特立姿',
    description: '经典动捕立姿、重心稳固的全身展示',
    url: '/vrm/motion/model-stand.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'posture',
  },
  attentiveLean: {
    id: 'attentiveLean',
    nameKey: 'motion.attentiveLean.name',
    descriptionKey: 'motion.attentiveLean.description',
    name: '微笑前倾',
    description: '身躯前倾、面带喜悦的专注陪伴体态',
    url: '/vrm/motion/attentive-lean.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'posture',
  },
  cozyLean: {
    id: 'cozyLean',
    nameKey: 'motion.cozyLean.name',
    descriptionKey: 'motion.cozyLean.description',
    name: '惬意眯眼',
    description: '舒适惬意、享受安静陪伴的放松姿态',
    url: '/vrm/motion/cozy-lean.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'posture',
  },
  sleepyLean: {
    id: 'sleepyLean',
    nameKey: 'motion.sleepyLean.name',
    descriptionKey: 'motion.sleepyLean.description',
    name: '困倦微倚',
    description: '软绵绵快要睡着的轻微倚靠站姿',
    url: '/vrm/motion/sleepy-lean.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'posture',
  },

  // ── 2. 问候与展示 (Greetings & Showcase) ──
  waving: {
    id: 'waving',
    nameKey: 'motion.waving.name',
    descriptionKey: 'motion.waving.description',
    name: '热情招手',
    description: '高举右臂向远方用力挥手问好',
    url: '/vrm/motion/waving.vrma',
    loop: false,
    fadeDuration: 0.75,
    mask: 'all',
    category: 'greeting',
  },
  showFullBody: {
    id: 'showFullBody',
    nameKey: 'motion.showFullBody.name',
    descriptionKey: 'motion.showFullBody.description',
    name: '全身展示',
    description: '自信舒展双手、360度展示全身造型',
    url: '/vrm/motion/show-full-body.vrma',
    loop: false,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'showcase',
  },

  // ── 3. 情绪、娇羞与可爱卖萌 (Cute & Emotional) ──
  touchHair: {
    id: 'touchHair',
    nameKey: 'motion.touchHair.name',
    descriptionKey: 'motion.touchHair.description',
    name: '温柔抚发',
    description: '单手轻抚发丝、身体自然微晃的温婉姿态',
    url: '/vrm/motion/touch-hair.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'expression',
  },
  shyBehindBack: {
    id: 'shyBehindBack',
    nameKey: 'motion.shyBehindBack.name',
    descriptionKey: 'motion.shyBehindBack.description',
    name: '害羞背手',
    description: '双手背在身后低头微晃脚步的娇羞态',
    url: '/vrm/motion/shy-behind-back.vrma',
    loop: true,
    fadeDuration: 0.75,
    mask: 'all',
    category: 'expression',
  },
  poutTurn: {
    id: 'poutTurn',
    nameKey: 'motion.poutTurn.name',
    descriptionKey: 'motion.poutTurn.description',
    name: '傲娇轻哼',
    description: '微抬头转开视线的可爱娇嗔姿态',
    url: '/vrm/motion/pout-turn.vrma',
    loop: false,
    fadeDuration: 0.65,
    mask: 'upperBody',
    category: 'expression',
  },
  cuteTilt: {
    id: 'cuteTilt',
    nameKey: 'motion.cuteTilt.name',
    descriptionKey: 'motion.cuteTilt.description',
    name: '单手托脸',
    description: '单手轻托脸颊微偏头的绝美倾注',
    url: '/vrm/motion/cute-tilt.vrma',
    loop: false,
    fadeDuration: 0.65,
    mask: 'upperBody',
    category: 'cute',
  },
  flowerChin: {
    id: 'flowerChin',
    nameKey: 'motion.flowerChin.name',
    descriptionKey: 'motion.flowerChin.description',
    name: '花朵托下巴',
    description: '双手如花托般托住下巴露出笑脸',
    url: '/vrm/motion/flower-chin.vrma',
    loop: false,
    fadeDuration: 0.65,
    mask: 'upperBody',
    category: 'cute',
  },
  catCheeks: {
    id: 'catCheeks',
    nameKey: 'motion.catCheeks.name',
    descriptionKey: 'motion.catCheeks.description',
    name: '猫咪胡须',
    description: '双手手指放于脸颊两侧萌系比划',
    url: '/vrm/motion/cat-cheeks.vrma',
    loop: false,
    fadeDuration: 0.65,
    mask: 'upperBody',
    category: 'cute',
  },
  bashfulTwist: {
    id: 'bashfulTwist',
    nameKey: 'motion.bashfulTwist.name',
    descriptionKey: 'motion.bashfulTwist.description',
    name: '雀跃撒娇',
    description: '欣喜被夸奖后轻扭身躯的俏皮撒娇',
    url: '/vrm/motion/bashful-twist.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'cute',
  },
  joyfulJump: {
    id: 'joyfulJump',
    nameKey: 'motion.joyfulJump.name',
    descriptionKey: 'motion.joyfulJump.description',
    name: '惊喜轻跳',
    description: '瞬间被好消息点亮的兴奋拍手跳起',
    url: '/vrm/motion/joyful-jump.vrma',
    loop: false,
    fadeDuration: 0.65,
    mask: 'all',
    category: 'celebration',
  },

  // ── 4. 言语叙述与交谈手势 (Speech Gestures) ──
  gentleTalk: {
    id: 'gentleTalk',
    nameKey: 'motion.gentleTalk.name',
    descriptionKey: 'motion.gentleTalk.description',
    name: '温和倾诉',
    description: '柔和胸前手势，适合长句叙述与交谈',
    url: '/vrm/motion/gentle-talk.vrma',
    loop: true,
    fadeDuration: 0.75,
    mask: 'upperBody',
    category: 'speech',
  },
  explainPoint: {
    id: 'explainPoint',
    nameKey: 'motion.explainPoint.name',
    descriptionKey: 'motion.explainPoint.description',
    name: '重点强调',
    description: '单手重点强调与陈述阐释手势',
    url: '/vrm/motion/explain-point.vrma',
    loop: false,
    fadeDuration: 0.65,
    mask: 'upperBody',
    category: 'speech',
  },
  warmDialogue: {
    id: 'warmDialogue',
    nameKey: 'motion.warmDialogue.name',
    descriptionKey: 'motion.warmDialogue.description',
    name: '亲切讲述',
    description: '如知己好友般自然亲切的交谈手势',
    url: '/vrm/motion/warm-dialogue.vrma',
    loop: true,
    fadeDuration: 0.75,
    mask: 'upperBody',
    category: 'speech',
  },

  // ── 5. 浪漫情调 (Romance & Flirt) ──
  blowKiss: {
    id: 'blowKiss',
    nameKey: 'motion.blowKiss.name',
    descriptionKey: 'motion.blowKiss.description',
    name: '指尖飞吻',
    description: '手指轻触嘴唇向前温柔吹出飞吻',
    url: '/vrm/motion/blow-kiss.vrma',
    loop: false,
    fadeDuration: 0.65,
    mask: 'upperBody',
    category: 'romance',
  },
  sweetKiss: {
    id: 'sweetKiss',
    nameKey: 'motion.sweetKiss.name',
    descriptionKey: 'motion.sweetKiss.description',
    name: '甜蜜飞吻',
    description: '右手轻触嘴唇向前送出深情飞吻',
    url: '/vrm/motion/sweet-kiss.vrma',
    loop: false,
    fadeDuration: 0.65,
    mask: 'upperBody',
    category: 'romance',
  },

  // ── 6. 华丽舞蹈 (Dances) ──
  bellyDance: {
    id: 'bellyDance',
    nameKey: 'motion.bellyDance.name',
    descriptionKey: 'motion.bellyDance.description',
    name: '东方肚皮舞',
    description: '腹部腰肢柔韧曼妙扭动的东方舞',
    url: '/vrm/motion/belly-dance.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'dance',
  },
  bellyDanceWave: {
    id: 'bellyDanceWave',
    nameKey: 'motion.bellyDanceWave.name',
    descriptionKey: 'motion.bellyDanceWave.description',
    name: '波浪肚皮舞',
    description: '手臂舒展配合腰部波浪摆动的律动',
    url: '/vrm/motion/belly-dance-wave.vrma',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'dance',
  },
  rumbaDance: {
    id: 'rumbaDance',
    nameKey: 'motion.rumbaDance.name',
    descriptionKey: 'motion.rumbaDance.description',
    name: '拉丁伦巴舞',
    description: '优美曼妙的髋部画圆经典伦巴单人步态',
    url: '/vrm/motion/rumba-dance.vrma',
    loop: true,
    fadeDuration: 0.75,
    mask: 'all',
    category: 'dance',
  },

  // ── 7. 日常与搞怪互动 (Casual & Playful) ──
  stretchYawn: {
    id: 'stretchYawn',
    nameKey: 'motion.stretchYawn.name',
    descriptionKey: 'motion.stretchYawn.description',
    name: '伸展懒腰',
    description: '高举双臂伸展懒腰、长舒一口气',
    url: '/vrm/motion/stretch-yawn.vrma',
    loop: false,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'casual',
  },
  airplaneGlide: {
    id: 'airplaneGlide',
    nameKey: 'motion.airplaneGlide.name',
    descriptionKey: 'motion.airplaneGlide.description',
    name: '小飞机滑翔',
    description: '展开双臂低空滑行的小飞机搞怪姿势',
    url: '/vrm/motion/airplane-glide.vrma',
    loop: false,
    fadeDuration: 0.75,
    mask: 'all',
    category: 'playful',
  },
} as const satisfies Record<string, MotionCatalogItem>;

export type MotionCatalogId = keyof typeof MOTION_CATALOG;

export function isMotionCatalogId(id: string): id is MotionCatalogId {
  return id in MOTION_CATALOG;
}

/**
 * 获取动作的本地化显示名称
 */
export function getMotionName(item: MotionCatalogItem, t?: (key: string) => string): string {
  if (t) {
    const val = t(item.nameKey);
    if (val && val !== item.nameKey) return val;
  }
  return item.name ?? item.id;
}

/**
 * 获取动作的本地化描述说明
 */
export function getMotionDescription(item: MotionCatalogItem, t?: (key: string) => string): string {
  if (t && item.descriptionKey) {
    const val = t(item.descriptionKey);
    if (val && val !== item.descriptionKey) return val;
  }
  return item.description ?? '';
}
