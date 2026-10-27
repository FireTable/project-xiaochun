import type { PlayMotionOptions } from './sources/clip';

export interface MotionCatalogItem extends PlayMotionOptions {
  /** 动作唯一标识 (camelCase) */
  id: string;
  /** 动作多语言名称 i18n Key */
  nameKey: string;
  /** 动作文件路径（或已预加载的 ArrayBuffer） */
  url: string;
  /** 是否在初始化阶段提前拉取并预解析至常驻内存池 (0ms 瞬时起播) */
  warmup?: boolean;
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
    url: '/vrm/motion/listening.vrma?v=12',
    warmup: true,
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
    description: '单手轻托下巴、陷入思索的专注思考姿态',
    url: '/vrm/motion/thinking.vrma',
    warmup: true,
    loop: true,
    fadeDuration: 0.75,
    antiClip: true,
    enableFootIK: false,
    mask: 'all',
    category: 'posture',
  },
  relaxStretch: {
    id: 'relaxStretch',
    nameKey: 'motion.relaxStretch.name',
    descriptionKey: 'motion.relaxStretch.description',
    name: '放松舒展',
    description: '全身舒展放松、调整站姿的自然一次性动作',
    url: '/vrm/motion/relax-stretch.vrma?v=3',
    loop: false,
    fadeDuration: 0.85,
    mask: 'all',
    antiClip: false,
    category: 'posture',
  },
  shhLean: {
    id: 'shhLean',
    nameKey: 'motion.shhLean.name',
    descriptionKey: 'motion.shhLean.description',
    name: '前倾比嘘',
    antiClip: false,
    description: '身躯前倾、食指轻抵唇边的俏皮比嘘手势',
    url: '/vrm/motion/shh-lean.vrma?v=2',
    loop: false,
    fadeDuration: 0.85,
    mask: 'all',
    category: 'posture',
  },
  gazeObserve: {
    id: 'gazeObserve',
    nameKey: 'motion.gazeObserve.name',
    descriptionKey: 'motion.gazeObserve.description',
    name: '观望打量',
    description: '左右轻轻观望打量周围环境的惬意站姿',
    url: '/vrm/motion/gaze-observe.vrma?v=4',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    antiClip: false,
    category: 'posture',
  },
  sleepyNod: {
    id: 'sleepyNod',
    nameKey: 'motion.sleepyNod.name',
    descriptionKey: 'motion.sleepyNod.description',
    name: '困倦打盹',
    description: '脑袋轻点打盹、困意朦胧的可爱瞬间',
    url: '/vrm/motion/sleepy-nod.vrma?v=3',
    loop: false,
    fadeDuration: 0.85,
    mask: 'all',
    antiClip: false,
    category: 'posture',
  },

  // ── 2. 问候与展示 (Greetings & Showcase) ──
  waving: {
    id: 'waving',
    nameKey: 'motion.waving.name',
    descriptionKey: 'motion.waving.description',
    name: '热情招手',
    description: '高举右臂向远方用力挥手问好',
    url: '/vrm/motion/waving.vrma?v=2',
    loop: false,
    fadeDuration: 0.75,
    mask: 'all',
    antiClip: false,
    category: 'greeting',
  },
  showFullBody: {
    id: 'showFullBody',
    nameKey: 'motion.showFullBody.name',
    descriptionKey: 'motion.showFullBody.description',
    name: '全身展示',
    description: '自信舒展双手、360度展示全身造型',
    url: '/vrm/motion/show-full-body.vrma?v=6',
    warmup: true,
    loop: false,
    fadeDuration: 0.85,
    mask: 'all',
    antiClip: false,
    category: 'showcase',
  },

  // ── 3. 情绪、娇羞与可爱卖萌 (Cute & Emotional) ──
  fingerObserve: {
    id: 'fingerObserve',
    nameKey: 'motion.fingerObserve.name',
    descriptionKey: 'motion.fingerObserve.description',
    name: '三角打量',
    description: '双手比出三角取景框专注打量的姿态',
    url: '/vrm/motion/finger-observe.vrma?v=3',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    antiClip: false,
    category: 'expression',
  },
  pokeFingers: {
    id: 'pokeFingers',
    nameKey: 'motion.pokeFingers.name',
    descriptionKey: 'motion.pokeFingers.description',
    name: '戳小手指',
    description: '双手在胸前紧张戳着小手指的害羞姿态',
    url: '/vrm/motion/poke-fingers.vrma?v=3',
    loop: true,
    fadeDuration: 0.75,
    mask: 'all',
    antiClip: false,
    category: 'expression',
  },
  poutHum: {
    id: 'poutHum',
    nameKey: 'motion.poutHum.name',
    descriptionKey: 'motion.poutHum.description',
    name: '撒娇轻哼',
    description: '微偏过头轻哼一声的傲娇撒娇小动作',
    url: '/vrm/motion/pout-hum.vrma?v=2',
    loop: false,
    fadeDuration: 0.65,
    mask: 'all',
    antiClip: false,
    category: 'expression',
  },
  pokeDimple: {
    id: 'pokeDimple',
    nameKey: 'motion.pokeDimple.name',
    descriptionKey: 'motion.pokeDimple.description',
    name: '戳小酒窝',
    description: '食指轻戳自己小酒窝的可爱卖萌手势',
    url: '/vrm/motion/poke-dimple.vrma?v=3',
    warmup: true,
    loop: false,
    fadeDuration: 0.65,
    mask: 'all',
    antiClip: false,
    category: 'cute',
  },
  catPaws: {
    id: 'catPaws',
    nameKey: 'motion.catPaws.name',
    descriptionKey: 'motion.catPaws.description',
    name: '猫咪拳头',
    description: '双手握成猫咪小拳头放在腮边的萌态',
    url: '/vrm/motion/cat-paws.vrma?v=4',
    loop: false,
    fadeDuration: 0.65,
    mask: 'all',
    antiClip: false,
    category: 'cute',
  },
  puppyPaws: {
    id: 'puppyPaws',
    nameKey: 'motion.puppyPaws.name',
    descriptionKey: 'motion.puppyPaws.description',
    name: '小狗拳头',
    description: '双手如小狗爪爪般乖巧握拳比划',
    url: '/vrm/motion/puppy-paws.vrma?v=3',
    loop: false,
    fadeDuration: 0.65,
    mask: 'all',
    antiClip: false,
    category: 'cute',
  },
  fistCute: {
    id: 'fistCute',
    nameKey: 'motion.fistCute.name',
    descriptionKey: 'motion.fistCute.description',
    name: '比拳卖萌',
    description: '双手握拳轻扭身躯的俏皮卖萌姿态',
    url: '/vrm/motion/fist-cute.vrma?v=3',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    antiClip: false,
    category: 'cute',
  },
  joyfulJump: {
    id: 'joyfulJump',
    nameKey: 'motion.joyfulJump.name',
    descriptionKey: 'motion.joyfulJump.description',
    name: '惊喜轻跳',
    description: '瞬间被好消息点亮的兴奋拍手跳起',
    url: '/vrm/motion/joyful-jump.vrma?v=8',
    warmup: true,
    loop: false,
    fadeDuration: 0.65,
    mask: 'all',
    antiClip: false,
    category: 'celebration',
  },

  // ── 4. 言语叙述与交谈手势 (Speech Gestures) ──
  gentleEncourage: {
    id: 'gentleEncourage',
    nameKey: 'motion.gentleEncourage.name',
    descriptionKey: 'motion.gentleEncourage.description',
    name: '温和鼓励',
    description: '柔和温暖的胸前手势，给予鼓励与支持',
    url: '/vrm/motion/gentle-encourage.vrma?v=2',
    loop: true,
    fadeDuration: 0.75,
    mask: 'all',
    antiClip: false,
    category: 'speech',
  },
  explainPoint: {
    id: 'explainPoint',
    nameKey: 'motion.explainPoint.name',
    descriptionKey: 'motion.explainPoint.description',
    name: '重点强调',
    description: '单手重点强调与陈述阐释手势',
    url: '/vrm/motion/explain-point.vrma?v=3',
    loop: false,
    fadeDuration: 0.65,
    mask: 'all',
    antiClip: false,
    category: 'speech',
  },
  detailNarrate: {
    id: 'detailNarrate',
    nameKey: 'motion.detailNarrate.name',
    descriptionKey: 'motion.detailNarrate.description',
    name: '仔细讲述',
    description: '专注且条理清晰地娓娓道来的交谈手势',
    url: '/vrm/motion/detail-narrate.vrma?v=2',
    loop: true,
    fadeDuration: 0.75,
    mask: 'all',
    antiClip: false,
    category: 'speech',
  },

  // ── 5. 浪漫情调 (Romance & Flirt) ──
  handHeart: {
    id: 'handHeart',
    nameKey: 'motion.handHeart.name',
    descriptionKey: 'motion.handHeart.description',
    name: '双手比心',
    description: '双手在胸前合拢比出爱心的甜蜜互动',
    url: '/vrm/motion/hand-heart.vrma?v=3',
    warmup: true,
    loop: false,
    fadeDuration: 0.65,
    mask: 'all',
    antiClip: false,
    category: 'romance',
  },

  // ── 6. 华丽舞蹈 (Dances) ──
  bellyDance: {
    id: 'bellyDance',
    nameKey: 'motion.bellyDance.name',
    descriptionKey: 'motion.bellyDance.description',
    name: '东方肚皮舞',
    description: '腹部腰肢柔韧曼妙扭动的东方舞',
    url: '/vrm/motion/belly-dance.vrma?v=2',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    antiClip: false,
    category: 'dance',
  },
  bellyDanceWave: {
    id: 'bellyDanceWave',
    nameKey: 'motion.bellyDanceWave.name',
    descriptionKey: 'motion.bellyDanceWave.description',
    name: '波浪肚皮舞',
    description: '手臂舒展配合腰部波浪摆动的律动',
    url: '/vrm/motion/belly-dance-wave.vrma?v=2',
    loop: true,
    fadeDuration: 0.85,
    mask: 'all',
    antiClip: false,
    category: 'dance',
  },
  rumbaDance: {
    id: 'rumbaDance',
    nameKey: 'motion.rumbaDance.name',
    descriptionKey: 'motion.rumbaDance.description',
    name: '拉丁伦巴舞',
    description: '优美曼妙的髋部画圆经典伦巴单人步态',
    url: '/vrm/motion/rumba-dance.vrma?v=2',
    loop: true,
    fadeDuration: 0.75,
    mask: 'all',
    antiClip: false,
    category: 'dance',
  },

  // ── 7. 日常与搞怪互动 (Casual & Playful) ──
  checkTime: {
    id: 'checkTime',
    nameKey: 'motion.checkTime.name',
    descriptionKey: 'motion.checkTime.description',
    name: '核对时间',
    description: '抬起手腕认真查看手表核对时间的日常动作',
    url: '/vrm/motion/check-time.vrma?v=3',
    loop: false,
    fadeDuration: 0.85,
    mask: 'all',
    antiClip: false,
    category: 'casual',
  },
  airplaneGlide: {
    id: 'airplaneGlide',
    nameKey: 'motion.airplaneGlide.name',
    descriptionKey: 'motion.airplaneGlide.description',
    name: '小飞机滑翔',
    description: '展开双臂低空滑行的小飞机搞怪姿势',
    url: '/vrm/motion/airplane-glide.vrma?v=2',
    loop: false,
    fadeDuration: 0.75,
    mask: 'all',
    antiClip: false,
    category: 'playful',
  },
} as const satisfies Record<string, MotionCatalogItem>;

export type MotionCatalogId = keyof typeof MOTION_CATALOG;

export function isMotionCatalogId(id: string): id is MotionCatalogId {
  return id in MOTION_CATALOG;
}

/**
 * 动作组加权项定义
 * @template T 严格约束于 MOTION_CATALOG 中的动作 ID。若对应动作被删除或重命名，TypeScript 会立即报类型错误。
 */
export interface MotionGroupItem<T extends MotionCatalogId = MotionCatalogId> {
  readonly id: T;
  readonly weight: number;
}

/**
 * 动作情境与交互动作组配置表（严格关联 MOTION_CATALOG）
 * 包含随机触发权重（权重不必归一化为 100，自动按相对比例抽取）。
 */
export const MOTION_GROUPS = {
  /** 换装走秀展示动作组 (showcase: 60% 全身展示, 20% 惊喜轻跳, 15% 双手比心, 5% 戳小酒窝) */
  outfitShowcase: [
    { id: 'showFullBody', weight: 60 },
    { id: 'joyfulJump', weight: 20 },
    { id: 'handHeart', weight: 15 },
    { id: 'pokeDimple', weight: 5 },
  ],
} as const satisfies Record<string, readonly MotionGroupItem<MotionCatalogId>[]>;

export type MotionGroupName = keyof typeof MOTION_GROUPS;

/**
 * 根据权重从动作组中随机抽取一个动作 ID
 */
export function selectMotionFromGroup(groupName: MotionGroupName): MotionCatalogId {
  const group = MOTION_GROUPS[groupName];
  if (!group || (group as readonly unknown[]).length === 0) {
    return 'showFullBody';
  }
  const totalWeight = group.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return group[0].id;

  let random = Math.random() * totalWeight;
  for (const item of group) {
    if (random < item.weight) {
      return item.id;
    }
    random -= item.weight;
  }
  return group[group.length - 1].id;
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
