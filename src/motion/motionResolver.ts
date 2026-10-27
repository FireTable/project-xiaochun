/**
 * motionResolver.ts — 统一动作标识符与文件路径解析器
 *
 * 将动作语义 ID（如 waving、touchHair、bellyDance）、kebab-case 别名
 * 以及历史遗留命名（如 161_Waving、dm_124、4_Belly Dance）
 * 统一解析为标准语义化的 .vrma 资源路径。
 */

export const MOTION_FILES: Record<string, string> = {
  // ── 1. 核心待机与倾听姿态 (Core Idle & Listening) ──
  listening: '/vrm/motion/listening.vrma?v=10',
  thinking: '/vrm/motion/thinking.vrma',
  classicIdle: '/vrm/motion/classic-idle.vrma',
  'classic-idle': '/vrm/motion/classic-idle.vrma',
  elegantStand: '/vrm/motion/elegant-stand.vrma',
  'elegant-stand': '/vrm/motion/elegant-stand.vrma',
  maidPoise: '/vrm/motion/maid-poise.vrma',
  'maid-poise': '/vrm/motion/maid-poise.vrma',
  maid: '/vrm/motion/maid-poise.vrma',
  modelStand: '/vrm/motion/model-stand.vrma',
  'model-stand': '/vrm/motion/model-stand.vrma',
  attentiveLean: '/vrm/motion/attentive-lean.vrma',
  'attentive-lean': '/vrm/motion/attentive-lean.vrma',
  cozyLean: '/vrm/motion/cozy-lean.vrma',
  'cozy-lean': '/vrm/motion/cozy-lean.vrma',
  sleepyLean: '/vrm/motion/sleepy-lean.vrma',
  'sleepy-lean': '/vrm/motion/sleepy-lean.vrma',

  // ── 2. 问候与展示 (Greetings & Showcase) ──
  waving: '/vrm/motion/waving.vrma',
  wave: '/vrm/motion/waving.vrma',
  showFullBody: '/vrm/motion/show-full-body.vrma',
  'show-full-body': '/vrm/motion/show-full-body.vrma',
  show_body: '/vrm/motion/show-full-body.vrma',

  // ── 3. 情绪、娇羞与可爱卖萌 (Cute & Emotional) ──
  touchHair: '/vrm/motion/touch-hair.vrma',
  'touch-hair': '/vrm/motion/touch-hair.vrma',
  touch_hair: '/vrm/motion/touch-hair.vrma',
  shyBehindBack: '/vrm/motion/shy-behind-back.vrma',
  'shy-behind-back': '/vrm/motion/shy-behind-back.vrma',
  shy: '/vrm/motion/shy-behind-back.vrma',
  poutTurn: '/vrm/motion/pout-turn.vrma',
  'pout-turn': '/vrm/motion/pout-turn.vrma',
  pout: '/vrm/motion/pout-turn.vrma',
  cuteTilt: '/vrm/motion/cute-tilt.vrma',
  'cute-tilt': '/vrm/motion/cute-tilt.vrma',
  flowerChin: '/vrm/motion/flower-chin.vrma',
  'flower-chin': '/vrm/motion/flower-chin.vrma',
  catCheeks: '/vrm/motion/cat-cheeks.vrma',
  'cat-cheeks': '/vrm/motion/cat-cheeks.vrma',
  bashfulTwist: '/vrm/motion/bashful-twist.vrma',
  'bashful-twist': '/vrm/motion/bashful-twist.vrma',
  joyfulJump: '/vrm/motion/joyful-jump.vrma',
  'joyful-jump': '/vrm/motion/joyful-jump.vrma',

  // ── 4. 言语叙述与交谈手势 (Speech Gestures) ──
  gentleTalk: '/vrm/motion/gentle-talk.vrma',
  'gentle-talk': '/vrm/motion/gentle-talk.vrma',
  explainPoint: '/vrm/motion/explain-point.vrma',
  'explain-point': '/vrm/motion/explain-point.vrma',
  warmDialogue: '/vrm/motion/warm-dialogue.vrma',
  'warm-dialogue': '/vrm/motion/warm-dialogue.vrma',

  // ── 5. 浪漫情调 (Romance & Flirt) ──
  blowKiss: '/vrm/motion/blow-kiss.vrma',
  'blow-kiss': '/vrm/motion/blow-kiss.vrma',
  sweetKiss: '/vrm/motion/sweet-kiss.vrma',
  'sweet-kiss': '/vrm/motion/sweet-kiss.vrma',
  kiss: '/vrm/motion/sweet-kiss.vrma',

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
  stretchYawn: '/vrm/motion/stretch-yawn.vrma',
  'stretch-yawn': '/vrm/motion/stretch-yawn.vrma',
  airplaneGlide: '/vrm/motion/airplane-glide.vrma',
  'airplane-glide': '/vrm/motion/airplane-glide.vrma',
  airplane: '/vrm/motion/airplane-glide.vrma',

  // ── 8. 兼容历史遗留动作编号 (Legacy dm_ and raw names) ──
  '161_Waving': '/vrm/motion/waving.vrma',
  '4_Belly Dance': '/vrm/motion/belly-dance.vrma',
  '5_Bellydancing': '/vrm/motion/belly-dance-wave.vrma',
  '67_Rumba Dancing': '/vrm/motion/rumba-dance.vrma',
  dm_0: '/vrm/motion/gentle-talk.vrma',
  dm_6: '/vrm/motion/explain-point.vrma',
  dm_9: '/vrm/motion/pout-turn.vrma',
  dm_19: '/vrm/motion/joyful-jump.vrma',
  dm_22: '/vrm/motion/elegant-stand.vrma',
  dm_29: '/vrm/motion/blow-kiss.vrma',
  dm_40: '/vrm/motion/shy-behind-back.vrma',
  dm_43: '/vrm/motion/cat-cheeks.vrma',
  dm_56: '/vrm/motion/cute-tilt.vrma',
  dm_57: '/vrm/motion/flower-chin.vrma',
  dm_90: '/vrm/motion/warm-dialogue.vrma',
  dm_111: '/vrm/motion/sleepy-lean.vrma',
  dm_122: '/vrm/motion/touch-hair.vrma',
  dm_124: '/vrm/motion/attentive-lean.vrma',
  dm_125: '/vrm/motion/bashful-twist.vrma',
  dm_128: '/vrm/motion/classic-idle.vrma',
  dm_129: '/vrm/motion/cozy-lean.vrma',
  dm_135: '/vrm/motion/stretch-yawn.vrma',
  'preview/davinci-3dchat/kiss': '/vrm/motion/sweet-kiss.vrma',
  'preview/desktop-homunculus/idle-maid': '/vrm/motion/maid-poise.vrma',
  'preview/hoang-vrma/VRMA_01': '/vrm/motion/model-stand.vrma',
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
