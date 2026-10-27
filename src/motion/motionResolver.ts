import { MOTION_CATALOG, isMotionCatalogId } from './catalog';

/**
 * motionResolver.ts — 统一动作标识符与文件路径解析器
 *
 * 将动作语义 ID（如 waving、touchHair、bellyDance）、kebab-case 别名
 * 以及历史遗留命名（如 161_Waving、dm_124、4_Belly Dance）
 * 统一解析为标准语义化的 .vrma 资源路径（严格继承 MOTION_CATALOG 带有缓存破除版本号的 SSOT URL）。
 */

export const MOTION_FILES: Record<string, string> = {
  // ── 1. 核心待机与倾听姿态 (Core Idle & Listening) ──
  listening: MOTION_CATALOG.listening.url,
  thinking: MOTION_CATALOG.thinking.url,
  relaxStretch: MOTION_CATALOG.relaxStretch.url,
  'relax-stretch': MOTION_CATALOG.relaxStretch.url,
  classicIdle: MOTION_CATALOG.relaxStretch.url,
  'classic-idle': MOTION_CATALOG.relaxStretch.url,
  shhLean: MOTION_CATALOG.shhLean.url,
  'shh-lean': MOTION_CATALOG.shhLean.url,
  elegantStand: MOTION_CATALOG.shhLean.url,
  'elegant-stand': MOTION_CATALOG.shhLean.url,
  modelStand: MOTION_CATALOG.showFullBody.url,
  'model-stand': MOTION_CATALOG.showFullBody.url,
  attentiveLean: MOTION_CATALOG.listening.url,
  'attentive-lean': MOTION_CATALOG.listening.url,
  gazeObserve: MOTION_CATALOG.gazeObserve.url,
  'gaze-observe': MOTION_CATALOG.gazeObserve.url,
  cozyLean: MOTION_CATALOG.gazeObserve.url,
  'cozy-lean': MOTION_CATALOG.gazeObserve.url,
  sleepyNod: MOTION_CATALOG.sleepyNod.url,
  'sleepy-nod': MOTION_CATALOG.sleepyNod.url,
  sleepyLean: MOTION_CATALOG.sleepyNod.url,
  'sleepy-lean': MOTION_CATALOG.sleepyNod.url,

  // ── 2. 问候与展示 (Greetings & Showcase) ──
  waving: MOTION_CATALOG.waving.url,
  wave: MOTION_CATALOG.waving.url,
  showFullBody: MOTION_CATALOG.showFullBody.url,
  'show-full-body': MOTION_CATALOG.showFullBody.url,
  show_body: MOTION_CATALOG.showFullBody.url,

  // ── 3. 情绪、娇羞与可爱卖萌 (Cute & Emotional) ──
  fingerObserve: MOTION_CATALOG.fingerObserve.url,
  'finger-observe': MOTION_CATALOG.fingerObserve.url,
  touchHair: MOTION_CATALOG.fingerObserve.url,
  'touch-hair': MOTION_CATALOG.fingerObserve.url,
  touch_hair: MOTION_CATALOG.fingerObserve.url,
  pokeFingers: MOTION_CATALOG.pokeFingers.url,
  'poke-fingers': MOTION_CATALOG.pokeFingers.url,
  shyBehindBack: MOTION_CATALOG.pokeFingers.url,
  'shy-behind-back': MOTION_CATALOG.pokeFingers.url,
  shy: MOTION_CATALOG.pokeFingers.url,
  poutHum: MOTION_CATALOG.poutHum.url,
  'pout-hum': MOTION_CATALOG.poutHum.url,
  poutTurn: MOTION_CATALOG.poutHum.url,
  'pout-turn': MOTION_CATALOG.poutHum.url,
  pout: MOTION_CATALOG.poutHum.url,
  pokeDimple: MOTION_CATALOG.pokeDimple.url,
  'poke-dimple': MOTION_CATALOG.pokeDimple.url,
  cuteTilt: MOTION_CATALOG.pokeDimple.url,
  'cute-tilt': MOTION_CATALOG.pokeDimple.url,
  catPaws: MOTION_CATALOG.catPaws.url,
  'cat-paws': MOTION_CATALOG.catPaws.url,
  flowerChin: MOTION_CATALOG.catPaws.url,
  'flower-chin': MOTION_CATALOG.catPaws.url,
  puppyPaws: MOTION_CATALOG.puppyPaws.url,
  'puppy-paws': MOTION_CATALOG.puppyPaws.url,
  catCheeks: MOTION_CATALOG.puppyPaws.url,
  'cat-cheeks': MOTION_CATALOG.puppyPaws.url,
  fistCute: MOTION_CATALOG.fistCute.url,
  'fist-cute': MOTION_CATALOG.fistCute.url,
  bashfulTwist: MOTION_CATALOG.fistCute.url,
  'bashful-twist': MOTION_CATALOG.fistCute.url,
  joyfulJump: MOTION_CATALOG.joyfulJump.url,
  'joyful-jump': MOTION_CATALOG.joyfulJump.url,

  // ── 4. 言语叙述与交谈手势 (Speech Gestures) ──
  gentleEncourage: MOTION_CATALOG.gentleEncourage.url,
  'gentle-encourage': MOTION_CATALOG.gentleEncourage.url,
  gentleTalk: MOTION_CATALOG.gentleEncourage.url,
  'gentle-talk': MOTION_CATALOG.gentleEncourage.url,
  explainPoint: MOTION_CATALOG.explainPoint.url,
  'explain-point': MOTION_CATALOG.explainPoint.url,
  detailNarrate: MOTION_CATALOG.detailNarrate.url,
  'detail-narrate': MOTION_CATALOG.detailNarrate.url,
  warmDialogue: MOTION_CATALOG.detailNarrate.url,
  'warm-dialogue': MOTION_CATALOG.detailNarrate.url,

  // ── 5. 浪漫情调 (Romance & Flirt) ──
  handHeart: MOTION_CATALOG.handHeart.url,
  'hand-heart': MOTION_CATALOG.handHeart.url,
  blowKiss: MOTION_CATALOG.handHeart.url,
  'blow-kiss': MOTION_CATALOG.handHeart.url,
  demandKiss: MOTION_CATALOG.handHeart.url,
  'demand-kiss': MOTION_CATALOG.handHeart.url,
  sweetKiss: MOTION_CATALOG.handHeart.url,
  'sweet-kiss': MOTION_CATALOG.handHeart.url,
  kiss: MOTION_CATALOG.handHeart.url,

  // ── 6. 华丽舞蹈 (Dances) ──
  bellyDance: MOTION_CATALOG.bellyDance.url,
  'belly-dance': MOTION_CATALOG.bellyDance.url,
  belly_dance: MOTION_CATALOG.bellyDance.url,
  bellyDanceWave: MOTION_CATALOG.bellyDanceWave.url,
  'belly-dance-wave': MOTION_CATALOG.bellyDanceWave.url,
  bellydancing: MOTION_CATALOG.bellyDanceWave.url,
  rumbaDance: MOTION_CATALOG.rumbaDance.url,
  'rumba-dance': MOTION_CATALOG.rumbaDance.url,
  rumba: MOTION_CATALOG.rumbaDance.url,

  // ── 7. 日常与搞怪互动 (Casual & Playful) ──
  checkTime: MOTION_CATALOG.checkTime.url,
  'check-time': MOTION_CATALOG.checkTime.url,
  stretchYawn: MOTION_CATALOG.checkTime.url,
  'stretch-yawn': MOTION_CATALOG.checkTime.url,
  airplaneGlide: MOTION_CATALOG.airplaneGlide.url,
  'airplane-glide': MOTION_CATALOG.airplaneGlide.url,
  airplane: MOTION_CATALOG.airplaneGlide.url,

  // ── 8. 兼容历史遗留动捕编号别名 ──
  '161_Waving': MOTION_CATALOG.waving.url,
  '4_Belly Dance': MOTION_CATALOG.bellyDance.url,
  '5_Bellydancing': MOTION_CATALOG.bellyDanceWave.url,
  '67_Rumba Dancing': MOTION_CATALOG.rumbaDance.url,
  dm_0: MOTION_CATALOG.gentleEncourage.url,
  dm_6: MOTION_CATALOG.explainPoint.url,
  dm_9: MOTION_CATALOG.poutHum.url,
  dm_19: MOTION_CATALOG.joyfulJump.url,
  dm_22: MOTION_CATALOG.shhLean.url,
  dm_29: MOTION_CATALOG.handHeart.url,
  dm_40: MOTION_CATALOG.pokeFingers.url,
  dm_43: MOTION_CATALOG.puppyPaws.url,
  dm_56: MOTION_CATALOG.pokeDimple.url,
  dm_57: MOTION_CATALOG.catPaws.url,
  dm_90: MOTION_CATALOG.detailNarrate.url,
  dm_111: MOTION_CATALOG.sleepyNod.url,
  dm_122: MOTION_CATALOG.fingerObserve.url,
  dm_124: MOTION_CATALOG.listening.url,
  dm_125: MOTION_CATALOG.fistCute.url,
  dm_128: MOTION_CATALOG.relaxStretch.url,
  dm_129: MOTION_CATALOG.gazeObserve.url,
  dm_135: MOTION_CATALOG.checkTime.url,
  'preview/davinci-3dchat/kiss': MOTION_CATALOG.handHeart.url,
  'preview/hoang-vrma/VRMA_01': MOTION_CATALOG.showFullBody.url,
  'preview/voxavatar/airplane-05': MOTION_CATALOG.airplaneGlide.url,
  'preview/vroid-official/ShowFullBody': MOTION_CATALOG.showFullBody.url,
  ShowFullBody: MOTION_CATALOG.showFullBody.url,
};

/**
 * 将任意动作标识解析为可直接 fetch 的完整相对或绝对 URL
 */
export function resolveMotionUrl(input: string): string {
  if (isMotionCatalogId(input)) {
    return MOTION_CATALOG[input].url;
  }
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
