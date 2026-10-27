/**
 * motionResolver.ts — 统一动作标识符与文件路径解析器
 *
 * 将动作语义 ID（如 waving、touchHair、bellyDance）、kebab-case 别名
 * 以及历史遗留命名（如 161_Waving、dm_124、4_Belly Dance）
 * 统一解析为标准语义化的 .vrma 资源路径。
 */

export const MOTION_FILES: Record<string, string> = {
  // ── 1. 核心待机与倾听姿态 (Core Idle & Listening) ──
  listening: '/vrm/motion/listening.vrma?v=11',
  thinking: '/vrm/motion/listening.vrma?v=11',
  relaxStretch: '/vrm/motion/relax-stretch.vrma',
  'relax-stretch': '/vrm/motion/relax-stretch.vrma',
  classicIdle: '/vrm/motion/relax-stretch.vrma',
  'classic-idle': '/vrm/motion/relax-stretch.vrma',
  shhLean: '/vrm/motion/shh-lean.vrma',
  'shh-lean': '/vrm/motion/shh-lean.vrma',
  elegantStand: '/vrm/motion/shh-lean.vrma',
  'elegant-stand': '/vrm/motion/shh-lean.vrma',
  modelStand: '/vrm/motion/show-full-body.vrma',
  'model-stand': '/vrm/motion/show-full-body.vrma',
  attentiveLean: '/vrm/motion/listening.vrma?v=11',
  'attentive-lean': '/vrm/motion/listening.vrma?v=11',
  gazeObserve: '/vrm/motion/gaze-observe.vrma',
  'gaze-observe': '/vrm/motion/gaze-observe.vrma',
  cozyLean: '/vrm/motion/gaze-observe.vrma',
  'cozy-lean': '/vrm/motion/gaze-observe.vrma',
  sleepyNod: '/vrm/motion/sleepy-nod.vrma',
  'sleepy-nod': '/vrm/motion/sleepy-nod.vrma',
  sleepyLean: '/vrm/motion/sleepy-nod.vrma',
  'sleepy-lean': '/vrm/motion/sleepy-nod.vrma',

  // ── 2. 问候与展示 (Greetings & Showcase) ──
  waving: '/vrm/motion/waving.vrma',
  wave: '/vrm/motion/waving.vrma',
  showFullBody: '/vrm/motion/show-full-body.vrma',
  'show-full-body': '/vrm/motion/show-full-body.vrma',
  show_body: '/vrm/motion/show-full-body.vrma',

  // ── 3. 情绪、娇羞与可爱卖萌 (Cute & Emotional) ──
  fingerObserve: '/vrm/motion/finger-observe.vrma',
  'finger-observe': '/vrm/motion/finger-observe.vrma',
  touchHair: '/vrm/motion/finger-observe.vrma',
  'touch-hair': '/vrm/motion/finger-observe.vrma',
  touch_hair: '/vrm/motion/finger-observe.vrma',
  pokeFingers: '/vrm/motion/poke-fingers.vrma',
  'poke-fingers': '/vrm/motion/poke-fingers.vrma',
  shyBehindBack: '/vrm/motion/poke-fingers.vrma',
  'shy-behind-back': '/vrm/motion/poke-fingers.vrma',
  shy: '/vrm/motion/poke-fingers.vrma',
  poutHum: '/vrm/motion/pout-hum.vrma',
  'pout-hum': '/vrm/motion/pout-hum.vrma',
  poutTurn: '/vrm/motion/pout-hum.vrma',
  'pout-turn': '/vrm/motion/pout-hum.vrma',
  pout: '/vrm/motion/pout-hum.vrma',
  pokeDimple: '/vrm/motion/poke-dimple.vrma',
  'poke-dimple': '/vrm/motion/poke-dimple.vrma',
  cuteTilt: '/vrm/motion/poke-dimple.vrma',
  'cute-tilt': '/vrm/motion/poke-dimple.vrma',
  catPaws: '/vrm/motion/cat-paws.vrma',
  'cat-paws': '/vrm/motion/cat-paws.vrma',
  flowerChin: '/vrm/motion/cat-paws.vrma',
  'flower-chin': '/vrm/motion/cat-paws.vrma',
  puppyPaws: '/vrm/motion/puppy-paws.vrma',
  'puppy-paws': '/vrm/motion/puppy-paws.vrma',
  catCheeks: '/vrm/motion/puppy-paws.vrma',
  'cat-cheeks': '/vrm/motion/puppy-paws.vrma',
  fistCute: '/vrm/motion/fist-cute.vrma',
  'fist-cute': '/vrm/motion/fist-cute.vrma',
  bashfulTwist: '/vrm/motion/fist-cute.vrma',
  'bashful-twist': '/vrm/motion/fist-cute.vrma',
  joyfulJump: '/vrm/motion/joyful-jump.vrma',
  'joyful-jump': '/vrm/motion/joyful-jump.vrma',

  // ── 4. 言语叙述与交谈手势 (Speech Gestures) ──
  gentleEncourage: '/vrm/motion/gentle-encourage.vrma',
  'gentle-encourage': '/vrm/motion/gentle-encourage.vrma',
  gentleTalk: '/vrm/motion/gentle-encourage.vrma',
  'gentle-talk': '/vrm/motion/gentle-encourage.vrma',
  explainPoint: '/vrm/motion/explain-point.vrma',
  'explain-point': '/vrm/motion/explain-point.vrma',
  detailNarrate: '/vrm/motion/detail-narrate.vrma',
  'detail-narrate': '/vrm/motion/detail-narrate.vrma',
  warmDialogue: '/vrm/motion/detail-narrate.vrma',
  'warm-dialogue': '/vrm/motion/detail-narrate.vrma',

  // ── 5. 浪漫情调 (Romance & Flirt) ──
  handHeart: '/vrm/motion/hand-heart.vrma',
  'hand-heart': '/vrm/motion/hand-heart.vrma',
  blowKiss: '/vrm/motion/hand-heart.vrma',
  'blow-kiss': '/vrm/motion/hand-heart.vrma',
  demandKiss: '/vrm/motion/hand-heart.vrma',
  'demand-kiss': '/vrm/motion/hand-heart.vrma',
  sweetKiss: '/vrm/motion/hand-heart.vrma',
  'sweet-kiss': '/vrm/motion/hand-heart.vrma',
  kiss: '/vrm/motion/hand-heart.vrma',

  // ── 6. 华丽舞蹈 (Dances) ──
  bellyDance: '/vrm/motion/belly-dance.vrma',
  'belly-dance': '/vrm/motion/belly-dance.vrma',
  belly_dance: '/vrm/motion/belly-dance.vrma',
  bellyDanceWave: '/vrm/motion/belly-dance-wave.vrma',
  'belly-dance-wave': '/vrm/motion/belly-dance-wave.vrma',
  bellydancing: '/vrm/motion/belly-dance-wave.vrma',
  rumbaDance: '/vrm/motion/rumba-dance.vrma',
  'rumba-dance': '/vrm/motion/rumba-dance.vrma',
  rumba: '/vrm/motion/rumba-dance.vrma',

  // ── 7. 日常与搞怪互动 (Casual & Playful) ──
  checkTime: '/vrm/motion/check-time.vrma',
  'check-time': '/vrm/motion/check-time.vrma',
  stretchYawn: '/vrm/motion/check-time.vrma',
  'stretch-yawn': '/vrm/motion/check-time.vrma',
  airplaneGlide: '/vrm/motion/airplane-glide.vrma',
  'airplane-glide': '/vrm/motion/airplane-glide.vrma',
  airplane: '/vrm/motion/airplane-glide.vrma',

  // ── 8. 兼容历史遗留动作编号 (Legacy dm_ and raw names) ──
  '161_Waving': '/vrm/motion/waving.vrma',
  '4_Belly Dance': '/vrm/motion/belly-dance.vrma',
  '5_Bellydancing': '/vrm/motion/belly-dance-wave.vrma',
  '67_Rumba Dancing': '/vrm/motion/rumba-dance.vrma',
  dm_0: '/vrm/motion/gentle-encourage.vrma',
  dm_6: '/vrm/motion/explain-point.vrma',
  dm_9: '/vrm/motion/pout-hum.vrma',
  dm_19: '/vrm/motion/joyful-jump.vrma',
  dm_22: '/vrm/motion/shh-lean.vrma',
  dm_29: '/vrm/motion/hand-heart.vrma',
  dm_40: '/vrm/motion/poke-fingers.vrma',
  dm_43: '/vrm/motion/puppy-paws.vrma',
  dm_56: '/vrm/motion/poke-dimple.vrma',
  dm_57: '/vrm/motion/cat-paws.vrma',
  dm_90: '/vrm/motion/detail-narrate.vrma',
  dm_111: '/vrm/motion/sleepy-nod.vrma',
  dm_122: '/vrm/motion/finger-observe.vrma',
  dm_124: '/vrm/motion/listening.vrma?v=11',
  dm_125: '/vrm/motion/fist-cute.vrma',
  dm_128: '/vrm/motion/relax-stretch.vrma',
  dm_129: '/vrm/motion/gaze-observe.vrma',
  dm_135: '/vrm/motion/check-time.vrma',
  'preview/davinci-3dchat/kiss': '/vrm/motion/hand-heart.vrma',
  'preview/hoang-vrma/VRMA_01': '/vrm/motion/show-full-body.vrma',
  'preview/voxavatar/airplane-05': '/vrm/motion/airplane-glide.vrma',
  'preview/vroid-official/ShowFullBody': '/vrm/motion/show-full-body.vrma',
  ShowFullBody: '/vrm/motion/show-full-body.vrma',
};

/**
 * 将任意动作标识解析为可直接 fetch 的完整相对或绝对 URL
 */
export function resolveMotionUrl(input: string): string {
  if (MOTION_FILES[input]) {
    return MOTION_FILES[input];
  }
  if (input.startsWith('/') || input.startsWith('http://') || input.startsWith('https://')) {
    return input;
  }
  if (input.endsWith('.vrma')) {
    return `/vrm/motion/${input}`;
  }
  return `/vrm/motion/${input}.vrma`;
}
