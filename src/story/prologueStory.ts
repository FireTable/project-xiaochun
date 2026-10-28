import type { StoryScript, LocalizedStoryBeat, LocalizedStoryChoice, LocalizedText, AudioDirective } from './schema';
import { vrmEngine } from '@/core/vrmEngine';
import { sceneManager } from '@/core/scene/sceneManager';

/**
 * 序章 v2 · 《黄昏的信》 (Mock 演示版：零 API Key、零外部音频资源，中 / 英 / 日三语)
 *
 * 一句话：小蠢每个黄昏都在海边等一个人，她写了一封一直不敢寄出的信，
 * 也一直不敢等到天黑 —— 因为怕灯亮了，那个人还是没有来。
 * 你的每一次点击 / 拖拽 / 开口，都是在这个故事里的一次“回应”。
 *
 * 教学点 (全部由剧情动机驱动，不出现“设置 / API / 右上角”等出戏词)：
 *   轻触 (同时解锁 AudioContext) → 选语言 → 点选卡片 → 拖拽镜头(别靠太近) → 场景卡片 → 选择影响结局
 *   → 打断她说话 / 打字 / 语音。
 *
 * 引擎能力 (均已在 StoryDirectorEngine 里真正落地，见 docs/STORY_DIRECTOR.md)：
 *   autoNextBeatId 无点击自动推进 · 多语言文本 · 转场 white_flash / fade_to_black / eye_blink
 *   · 调色 grading · 逆光破晓 hero_backlight_reveal / 荷兰角 dutch_tilt · 运镜阵风 windMultiplier
 *   · 程序化 BGM (bgmMood) 与环境声 (ambience) · 起势动作 leadInMotion 自然播完。
 *
 * 全片只有第一下“轻触唤醒”是必须点击的；之后所有台词说完自动往下走，直到出现需要你回应的卡片。
 */

/** 若之后补了 BGM 资源 (public/audio/xxx.mp3)，在此填 URL，全片会自动用它；加载失败自动退回程序化 BGM。 */
const BGM_URL: string | undefined = undefined;

/** 三语文本：zh-CN 必填；缺哪个语言就回退 zh-CN。 */
const L = (zh: string, en: string, ja: string): LocalizedText => ({ 'zh-CN': zh, en, ja });

/** 程序化 BGM 指令 (有 BGM_URL 时同一首文件贯穿全片，mood 只作为加载失败时的兜底) */
const music = (mood: string, bgmVolume = 0.3, bgmFadeSec = 3): AudioDirective =>
  BGM_URL ? { bgmAction: 'play', bgmTrack: BGM_URL, bgmMood: mood, bgmVolume, bgmFadeSec } : { bgmAction: 'play', bgmMood: mood, bgmVolume, bgmFadeSec };

/** 让一拍“说完自动往下走” (无需点击)。delayMs 是说完后的停顿 = 留白 / 呼吸感。 */
function auto(beat: LocalizedStoryBeat, next: string, delayMs = 600): LocalizedStoryBeat {
  return { ...beat, autoNextBeatId: next, autoNextDelayMs: delayMs };
}

// ───────────────────────── 运行期小工具 (均只在点击回调里执行) ─────────────────────────

/** 她对“你是谁”的态度，用于结局回扣 */
let mood: 'warm' | 'guard' | 'curious' = 'warm';
const setMood = (m: typeof mood) => () => {
  mood = m;
};

let hourRaf: number | null = null;
/** 把海滩时间从 fromHour 平滑推到 toHour (引擎本身是瞬切，这里逐帧补间) */
function tweenBeachHour(fromHour: number, toHour: number, ms: number) {
  if (typeof requestAnimationFrame === 'undefined') {
    vrmEngine.setEnvironmentTime(toHour);
    return;
  }
  if (hourRaf !== null) cancelAnimationFrame(hourRaf);
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / ms);
    const e = p * p * (3 - 2 * p);
    // isDragging=true：节流落影烘焙、不写 localStorage；终帧再正式落定
    vrmEngine.setEnvironmentTime(fromHour + (toHour - fromHour) * e, { isDragging: p < 1 });
    hourRaf = p < 1 ? requestAnimationFrame(step) : null;
  };
  hourRaf = requestAnimationFrame(step);
}

/** 先存时间、再切场景：beach3d 激活时会直接读取已存的时间，不会闪一帧正午 */
async function goToBeachAtGoldenHour() {
  vrmEngine.setEnvironmentTime(17.2);
  await sceneManager.setScene('beach3d', true);
}

/** “我陪你等”：天色从金黄一路沉到夜里，灯塔随之亮起 (约 12 秒，对齐 x1~x4 四拍) */
function startDuskToNight() {
  tweenBeachHour(17.2, 20.8, 12000);
}

// ───────────────────────── 共享选项 ─────────────────────────

const seaChoices: LocalizedStoryChoice[] = [
  {
    id: 'go_beach',
    icon: '🏖️',
    image: '/previews/scenes/beach3d.webp',
    text: L('好，我跟你去', "Sure, I'll go with you", 'うん、一緒に行く'),
    subText: L('黄昏的海边', 'Seaside at dusk', '夕暮れの海辺'),
    actionType: 'custom',
    actionPayload: goToBeachAtGoldenHour,
    nextBeatId: 'beat_arrive',
  },
  {
    id: 'wait_a_bit',
    icon: '⏳',
    text: L('让我再想想', 'Let me think', 'ちょっと考えさせて'),
    actionType: 'next_beat',
    nextBeatId: 'beat_wait_here',
  },
];

const stayOrLeave = (prefix: string): LocalizedStoryChoice[] => [
  {
    id: `${prefix}_stay`,
    icon: '🕯️',
    text: L('我陪你等，等到灯亮', "I'll wait with you till the light", '灯りがつくまで一緒に待つ'),
    actionType: 'custom',
    actionPayload: startDuskToNight,
    nextBeatId: 'beat_x1',
  },
  {
    id: `${prefix}_leave`,
    icon: '👋',
    text: L('我该走了', 'I should go', 'もう行かなきゃ'),
    actionType: 'next_beat',
    nextBeatId: 'beat_bye',
  },
];

// ───────────────────────── 剧本 ─────────────────────────

const beats: Record<string, LocalizedStoryBeat> = {
  // ═══ 一 · 唤醒 (虚空 / 当前场景) ═══
  // ⚠ 引擎对 id === 'beat_greet' 有专属演出 (黑幕隐藏模型→点击→自下而上升镜→转身)，不要改 id。
  beat_greet: auto(
    {
      id: 'beat_greet',
      cinematics: {
        letterbox: true,
        intertitle: {
          text: L(
            '很久没有人来了。\n她在黑暗里，\n等一次轻轻的触碰。',
            'No one has come for a long time.\nShe waits in the dark\nfor a gentle touch.',
            '長いあいだ、誰も来なかった。\n彼女は暗闇のなかで、\nそっと触れられるのを待っている。',
          ),
          durationSec: 0,
          style: 'noto_serif',
          bgmFaded: true,
          requireClick: true, // ← 全片唯一一次“必须点击”：同时解锁浏览器音频
        },
      },
      camera: { shot: 'medium', movement: 'pedestal_up', durationSec: 2.2 }, // 实际由引擎 panUpReveal 接管
      actor: {
        expression: { base: 'surprised', intensity: 0.8, microReaction: 'sudden_shock' },
        speechText: L('……诶？有、有人碰我了？', '…Huh? Someone touched me?', '……え？だ、誰かが触れた？'),
      },
      // 点击唤醒后：低沉的虚空长音淡入 + 心跳
      audio: { ...music('void_drone', 0.28, 4), sfx: [{ id: 'heartbeat_pulse', delaySec: 0.3, volume: 0.7 }] },
    },
    'beat_intro',
    500,
  ),

  beat_intro: auto(
    {
      id: 'beat_intro',
      cinematics: { letterbox: true },
      camera: { shot: 'close_up', movement: 'push_in', durationSec: 1.8 },
      actor: {
        motion: 'pokeFingers',
        expression: { base: 'shy', intensity: 0.8, microReaction: 'blush_ramp' },
        speechText: L('对、对不起，我刚醒。我是小蠢。', "S-sorry, I just woke up. I'm XiaoChun.", 'ご、ごめんね、起きたばかりで。わたしは小蠢。'),
      },
    },
    'beat_lang',
    500,
  ),

  // ═══ 二 · 你从哪里来 (教：点选卡片；同时是真正的语言选择) ═══
  // change_lang：选完立刻切换剧情语言 (之后每一拍的台词 / 卡片 / 字卡 / TTS 都用新语言)，界面语言与 Cookie 同步
  beat_lang: {
    id: 'beat_lang',
    cinematics: { letterbox: true },
    camera: { shot: 'close_up', movement: 'none', durationSec: 0.8 },
    actor: {
      motion: 'listening',
      expression: { base: 'gentle_smile', intensity: 0.7 },
      speechText: L(
        '你从哪里来呀？我该说哪种话？',
        'Where are you from? Which language should I speak?',
        'どこから来たの？どの言葉で話そうか？',
      ),
    },
    choices: [
      { id: 'lang_zh', icon: '🇨🇳', text: '中文', subText: '简体中文', actionType: 'change_lang', actionPayload: 'zh-CN', nextBeatId: 'beat_ask' },
      { id: 'lang_en', icon: '🇺🇸', text: 'English', subText: 'English', actionType: 'change_lang', actionPayload: 'en', nextBeatId: 'beat_ask' },
      { id: 'lang_ja', icon: '🇯🇵', text: '日本語', subText: '日本語', actionType: 'change_lang', actionPayload: 'ja', nextBeatId: 'beat_ask' },
    ],
  },

  // ═══ 三 · 第一次回应 (教：点选卡片的“意义”) ═══
  beat_ask: {
    id: 'beat_ask',
    cinematics: { letterbox: true },
    camera: { shot: 'extreme_close_up', movement: 'push_in', durationSec: 2.6, easing: 'ease_out_dramatic' },
    actor: {
      motion: 'listening',
      expression: { base: 'hesitant', intensity: 0.7, microReaction: 'avert_gaze' },
      speechText: L(
        '你是来找我的吗？……不用出声，点一下，我就懂。',
        "Did you come for me? Just tap — I'll understand.",
        'わたしを探しに来たの？……タップしてくれたら、伝わるよ。',
      ),
    },
    choices: [
      {
        id: 'ask_warm',
        icon: '💗',
        text: L('是啊，我来找你了', 'Yes, I came to find you', 'うん、君に会いに来たよ'),
        actionType: 'custom',
        actionPayload: setMood('warm'),
        nextBeatId: 'beat_a1',
      },
      {
        id: 'ask_guard',
        icon: '🚶',
        text: L('我只是路过', 'Just passing by', '通りかかっただけ'),
        actionType: 'custom',
        actionPayload: setMood('guard'),
        nextBeatId: 'beat_b1',
      },
      {
        id: 'ask_curious',
        icon: '❓',
        text: L('你在等谁吗？', 'Are you waiting for someone?', '誰かを待ってるの？'),
        actionType: 'custom',
        actionPayload: setMood('curious'),
        nextBeatId: 'beat_c1',
      },
    ],
  },

  // —— A 支线：被找到，惊喜 (playful 大反应) ——
  beat_a1: auto(
    {
      id: 'beat_a1',
      cinematics: { letterbox: true },
      camera: { shot: 'medium', movement: 'pull_out', durationSec: 1.2 }, // 拉开景别，给“蹦起来”留空间
      actor: {
        motion: 'joyfulJump',
        expression: { base: 'playful', intensity: 0.9, microReaction: 'eye_crinkle' },
        speechText: L('真的？！……啊，我反应太大了。', 'Really?! …Ah, I overreacted.', 'ほんと？！……あ、騒ぎすぎちゃった。'),
      },
    },
    'beat_a2',
    400,
  ),
  beat_a2: auto(
    {
      id: 'beat_a2',
      camera: { shot: 'close_up', movement: 'push_in', durationSec: 1.6 },
      actor: {
        motion: 'pokeFingers',
        expression: { base: 'shy', intensity: 0.8, microReaction: 'blush_ramp' },
        speechText: L('那、那我有件事，想让你看看。', "Th-then… there's something I want you to see.", 'じゃ、じゃあ、見せたいものがあるの。'),
      },
    },
    'beat_look_a',
    500,
  ),

  // —— B 支线：被拒绝在外，失落 (sad_longing，慢推静默) ——
  beat_b1: auto(
    {
      id: 'beat_b1',
      cinematics: { letterbox: true },
      camera: { shot: 'close_up', movement: 'push_in', durationSec: 3.5, easing: 'linear' },
      actor: {
        expression: { base: 'sad_longing', intensity: 0.8, microReaction: 'avert_gaze' },
        speechText: L('……这样啊。路过，也好。', '…I see. Passing by is fine, too.', '……そっか。通りかかっただけでも、いいよ。'),
      },
    },
    'beat_b2',
    1400, // 刻意的长停顿：让失落“落地”
  ),
  beat_b2: auto(
    {
      id: 'beat_b2',
      camera: { shot: 'medium', movement: 'orbit_subtle', durationSec: 2.4 },
      actor: {
        motion: 'thinking',
        expression: { base: 'hesitant', intensity: 0.6 },
        speechText: L('那……能多留一会儿吗？一小会儿。', 'Then… could you stay a little? Just a little.', 'それなら……少しだけ、いてくれる？'),
      },
    },
    'beat_look_a',
    500,
  ),

  // —— C 支线：被看穿，慌张→嘴硬 (surprised → playful) ——
  beat_c1: auto(
    {
      id: 'beat_c1',
      camera: { shot: 'extreme_close_up', movement: 'none', durationSec: 0.4 }, // 硬切特写 = 惊吓
      actor: {
        expression: { base: 'surprised', intensity: 0.9, microReaction: 'sudden_shock' },
        speechText: L('诶？！你、你怎么知道……', 'Eh?! H-how did you know…', 'え？！ど、どうして分かるの……'),
      },
      audio: { sfx: [{ id: 'heartbeat_pulse', delaySec: 0.1, volume: 0.8 }] },
    },
    'beat_c2',
    500,
  ),
  beat_c2: auto(
    {
      id: 'beat_c2',
      camera: { shot: 'medium', movement: 'push_in', durationSec: 1.8 },
      actor: {
        motion: 'poutHum',
        expression: { base: 'playful', intensity: 0.7, microReaction: 'eye_crinkle' },
        speechText: L('……好吧，被看穿啦。是有一点。', '…Okay, you caught me. A little.', '……うん、バレちゃった。ちょっとだけね。'),
      },
    },
    'beat_look_a',
    500,
  ),

  // ═══ 四 · 别靠太近 (教：拖拽 / 缩放镜头) ═══
  beat_look_a: auto(
    {
      id: 'beat_look_a',
      cinematics: { letterbox: false },
      camera: { shot: 'medium', movement: 'none', durationSec: 1.2 },
      actor: {
        expression: { base: 'gentle_smile', intensity: 0.7 },
        speechText: L('想看看我吗？可以绕着我转一转。', 'Want a look at me? You can walk around me.', '見てみたい？ぐるっと回ってもいいよ。'),
      },
      // 暖黄昏的钢琴 pad 淡入：从这里开始“有了温度”
      audio: music('dusk_warm', 0.3, 3),
    },
    'beat_look',
    300,
  ),
  beat_look: {
    id: 'beat_look',
    cinematics: { letterbox: false },
    interaction: 'camera_drag',
    camera: { shot: 'medium', movement: 'arc_sweep', orbitAngleDeg: 40, durationSec: 2.2 },
    actor: {
      leadInMotion: 'pokeFingers', // 起势：先害羞地戳手指，自然播完，不被开声打断
      expression: { base: 'shy', intensity: 0.8, microReaction: 'blush_ramp' },
      speechText: L('……别靠太近。会不好意思的。', "…Not too close. I'll get shy.", '……近すぎはだめ。恥ずかしいから。'),
    },
    choices: [
      {
        // 注意：id 刻意不叫 camera_done 的出戏文案——StoryPlayer 会把 look_done / camera_done 的文案按任务完成度换成本地化的完成提示
        id: 'look_done',
        icon: '👀',
        text: L('我看够了', "I've seen enough", 'もう十分見たよ'),
        subText: L('没有靠太近哦', "I didn't get too close", '近づきすぎてないよ'),
        actionType: 'next_beat',
        nextBeatId: 'beat_go_sea1',
      },
    ],
  },

  // ═══ 五 · 邀请去海边 (教：场景卡片；可拖延，她会撒娇) ═══
  beat_go_sea1: auto(
    {
      id: 'beat_go_sea1',
      cinematics: { letterbox: true },
      camera: { shot: 'full', movement: 'pull_out', durationSec: 2.6 },
      actor: {
        motion: 'thinking',
        expression: { base: 'hesitant', intensity: 0.6 },
        speechText: L('我有封信。要在海边，才能给出去。', 'I have a letter. I can only hand it over by the sea.', '手紙があるの。海辺でないと、渡せない。'),
      },
    },
    'beat_go_sea2',
    500,
  ),
  beat_go_sea2: {
    id: 'beat_go_sea2',
    cinematics: { letterbox: true },
    camera: { shot: 'medium', movement: 'push_in', durationSec: 1.8 },
    actor: {
      expression: { base: 'gentle_smile', intensity: 0.7 },
      speechText: L('……你愿意，跟我去吗？', '…Will you come with me?', '……一緒に来てくれる？'),
    },
    choiceLayout: 'grid',
    choices: seaChoices,
  },
  beat_wait_here: auto(
    {
      id: 'beat_wait_here',
      camera: { shot: 'close_up', movement: 'none', durationSec: 0.8 },
      actor: {
        motion: 'poutHum',
        expression: { base: 'playful', intensity: 0.8 },
        speechText: L('……哼。不许想太久哦。', "…Hmph. Don't take too long.", '……むぅ。あまり待たせないでね。'),
      },
    },
    'beat_go_sea2',
    400,
  ),

  // ═══ 六 · 黄昏海边：她的“想要”与“秘密” ═══
  // 从虚空到海边：fade_to_black 由 selectChoice 提前盖住画面，场景切换发生在黑幕之下，睁开就是黄昏。
  beat_arrive: auto(
    {
      id: 'beat_arrive',
      cinematics: { letterbox: true, transition: 'fade_to_black', grading: 'default' },
      camera: {
        shot: 'medium',
        movement: 'hero_backlight_reveal', // 机位绕到太阳对面、压低：她站在落日与镜头之间，逆光剪影
        durationSec: 4.5,
        easing: 'ease_out_dramatic',
        windMultiplier: 1.9, // 海风吹起发丝与裙摆，运镜结束后约 1 秒回落
      },
      actor: {
        motion: 'gazeObserve',
        expression: { base: 'gentle_smile', intensity: 0.8 },
        speechText: L('到了。每个黄昏，我都来这里。', "We're here. I come every dusk.", '着いた。毎日、夕暮れにここへ来るの。'),
      },
      audio: {
        ambience: 'sea_waves',
        ambienceVolume: 0.22,
        playSfx: 'bell',
        sfx: [{ id: 'crystal_chime', delaySec: 0.8, volume: 0.4 }],
      },
    },
    'beat_w1',
    800,
  ),
  beat_w1: auto(
    {
      id: 'beat_w1',
      camera: { shot: 'close_up', movement: 'push_in', durationSec: 3 },
      actor: {
        expression: { base: 'sad_longing', intensity: 0.5 },
        speechText: L('我在等一个人。', "I'm waiting for someone.", '人を待っているの。'),
      },
      audio: music('longing', 0.3, 4),
    },
    'beat_w2',
    900,
  ),
  beat_w2: auto(
    {
      id: 'beat_w2',
      camera: { shot: 'medium', movement: 'orbit_subtle', durationSec: 3 },
      actor: {
        motion: 'checkTime', // 抬腕看表 = 等待
        expression: { base: 'hesitant', intensity: 0.5 },
        speechText: L('他说过，灯塔亮了，就回来。', 'He said: when the lighthouse glows, I\'ll be back.', '「灯台がともったら戻る」って言ってた。'),
      },
    },
    'beat_w3',
    600,
  ),
  beat_w3: auto(
    {
      id: 'beat_w3',
      camera: { shot: 'close_up', movement: 'push_in', durationSec: 2.4 },
      actor: {
        motion: 'pokeFingers',
        expression: { base: 'shy', intensity: 0.7 },
        speechText: L('我写了封信。一直，没敢给他。', "I wrote a letter. Never dared to give it.", '手紙を書いたの。ずっと、渡せなかった。'),
      },
    },
    'beat_w4',
    700,
  ),
  beat_w4: auto(
    {
      id: 'beat_w4',
      cinematics: { letterbox: true },
      camera: { shot: 'dramatic_low', movement: 'push_in', durationSec: 3.5 }, // 仰角：她望向天空，显得孤单又倔强
      actor: {
        expression: { base: 'sad_longing', intensity: 0.8, microReaction: 'avert_gaze' },
        speechText: L('可天一黑，我就跑回去了。怕等不到。', "But when dark falls, I run home. Afraid he won't come.", 'でも暗くなると、逃げ帰るの。来ないのが怖くて。'),
      },
    },
    'beat_w5',
    1200,
  ),
  beat_w5: {
    id: 'beat_w5',
    cinematics: { letterbox: true },
    camera: { shot: 'medium', movement: 'push_in', durationSec: 2.2 },
    actor: {
      motion: 'listening',
      expression: { base: 'hesitant', intensity: 0.7 },
      speechText: L(
        '今天……你能陪我，等到灯亮吗？',
        'Today… will you wait with me till the light comes on?',
        '今日は……灯りがともるまで、そばにいてくれる？',
      ),
    },
    audio: { sfx: [{ id: 'heartbeat_pulse', delaySec: 0.2, volume: 0.6 }] },
    choices: [
      {
        id: 'w5_stay',
        icon: '🕯️',
        text: L('我陪你等', "I'll wait with you", '一緒に待つよ'),
        actionType: 'custom',
        actionPayload: startDuskToNight,
        nextBeatId: 'beat_x1',
      },
      { id: 'w5_blunt', icon: '💔', text: L('他也许，不会来了', "Maybe he won't come", 'たぶん、もう来ないよ'), actionType: 'next_beat', nextBeatId: 'beat_y1' },
      { id: 'w5_letter', icon: '✉️', text: L('信里写了什么？', "What's in the letter?", '手紙には何て書いてあるの？'), actionType: 'next_beat', nextBeatId: 'beat_z1' },
    ],
  },

  // —— Y 支线：说了实话，她受伤 (荷兰角 + 冷色黑色电影调色) ——
  beat_y1: auto(
    {
      id: 'beat_y1',
      cinematics: { grading: 'rainy_noir' },
      camera: { shot: 'extreme_close_up', movement: 'dutch_tilt', durationSec: 0.6 }, // 画面歪了：世界在她面前倾斜
      actor: {
        expression: { base: 'surprised', intensity: 0.8, microReaction: 'sudden_shock' },
        speechText: L('……诶。', '…Oh.', '……え。'),
      },
      audio: { bgmAction: 'muffle' },
    },
    'beat_y2',
    900,
  ),
  beat_y2: auto(
    {
      id: 'beat_y2',
      cinematics: { letterbox: true },
      camera: { shot: 'close_up', movement: 'push_in', durationSec: 4.5, easing: 'linear' }, // 非 dutch 运镜：镜头自动回正
      actor: {
        expression: { base: 'sad_longing', intensity: 0.9, microReaction: 'avert_gaze' },
        speechText: L('……我知道。我，其实知道。', "…I know. I actually know.", '……分かってる。本当は、分かってるの。'),
      },
      audio: { sfx: [{ id: 'heartbeat_pulse', delaySec: 0.4, volume: 0.8 }] },
    },
    'beat_y3',
    1500,
  ),
  beat_y3: {
    id: 'beat_y3',
    camera: { shot: 'medium', movement: 'pull_out', durationSec: 2.8 },
    actor: {
      motion: 'fistThinking',
      expression: { base: 'hesitant', intensity: 0.7 },
      speechText: L('所以，才不敢等到天黑。', "That's why I never dare wait for dark.", 'だから、暗くなるまで待てないの。'),
    },
    choices: stayOrLeave('y'),
  },

  // —— Z 支线：问起信，她脸红说出秘密 (暖褐回忆调色) ——
  beat_z1: auto(
    {
      id: 'beat_z1',
      camera: { shot: 'close_up', movement: 'push_in', durationSec: 2 },
      actor: {
        motion: 'pokeFingers',
        expression: { base: 'shy', intensity: 0.9, microReaction: 'blush_ramp' },
        speechText: L('……就一句话。', '…Just one line.', '……たった一言だけ。'),
      },
    },
    'beat_z2',
    900,
  ),
  beat_z2: auto(
    {
      id: 'beat_z2',
      cinematics: { letterbox: true, grading: 'sepia_memory' }, // 信的内容 = 回忆质感
      camera: { shot: 'extreme_close_up', movement: 'push_in', durationSec: 3.2 },
      actor: {
        expression: { base: 'hesitant', intensity: 0.6, microReaction: 'avert_gaze' },
        speechText: L('“我还在这里。”', '"I\'m still here."', '「わたしは、まだここにいる」'),
      },
    },
    'beat_z3',
    1200,
  ),
  beat_z3: {
    id: 'beat_z3',
    camera: { shot: 'medium', movement: 'pull_out', durationSec: 2.6 },
    actor: {
      expression: { base: 'sad_longing', intensity: 0.6 },
      speechText: L('只有这几个字。……我不敢寄。', "That's all it says. …I can't send it.", 'それだけ。……出す勇気がないの。'),
    },
    choices: stayOrLeave('z'),
  },

  // —— 提前离场结局 ——
  beat_bye: {
    id: 'beat_bye',
    cinematics: { letterbox: true, transition: 'fade_to_black', grading: 'sepia_memory' },
    camera: { shot: 'full', movement: 'pull_out', durationSec: 6, easing: 'ease_out_dramatic' },
    actor: {
      motion: 'singleHandWave',
      expression: { base: 'sad_longing', intensity: 0.6 },
      speechText: L('好。……谢谢你，听我说了这么多。', 'Okay. …Thanks for listening to all this.', 'うん。……聞いてくれて、ありがとう。'),
    },
    audio: { ...music('farewell', 0.3, 3), bgmAction: 'play' },
    choices: [{ id: 'bye_finish', icon: '🌙', text: L('再见，小蠢', 'Goodbye, XiaoChun', 'またね、小蠢'), actionType: 'finish' }],
  },

  // ═══ 七 · 等灯亮 (视觉事件：天色沉入夜，灯塔点亮) ═══
  // x1 / x3 刻意无台词：留白 + 心跳，让画面自己说话
  beat_x1: auto(
    {
      id: 'beat_x1',
      cinematics: { letterbox: true, grading: 'default' },
      camera: { shot: 'full', movement: 'pull_out', durationSec: 5, easing: 'ease_out_dramatic' },
      actor: {
        motion: 'gazeObserve', // 非说话动作：安静地望向天边 (无台词的拍，动作会自然播完)
        expression: { base: 'gentle_smile', intensity: 0.4 },
        speechText: '',
      },
      audio: {
        ...music('longing', 0.3, 4),
        sfx: [
          { id: 'heartbeat_pulse', delaySec: 0.6, volume: 0.5 },
          { id: 'heartbeat_pulse', delaySec: 2.4, volume: 0.6 },
          { id: 'heartbeat_pulse', delaySec: 4.0, volume: 0.7 },
        ],
      },
    },
    'beat_x2',
    5200,
  ),
  beat_x2: auto(
    {
      id: 'beat_x2',
      camera: { shot: 'dramatic_low', movement: 'dutch_tilt', durationSec: 4 }, // 不安的微倾：天快黑了
      actor: {
        expression: { base: 'hesitant', intensity: 0.6 },
        speechText: L('……你看。天，快黑了。', "…Look. It's getting dark.", '……見て。もうすぐ暗くなる。'),
      },
    },
    'beat_x3',
    700,
  ),
  beat_x3: auto(
    {
      id: 'beat_x3',
      camera: { shot: 'extreme_close_up', movement: 'push_in', durationSec: 3.2 }, // 反应镜头：看她的眼睛 (同时镜头回正)
      actor: {
        motion: 'checkTime',
        expression: { base: 'surprised', intensity: 0.5 },
        speechText: '',
      },
      audio: { sfx: [{ id: 'heartbeat_pulse', delaySec: 0.3, volume: 0.9 }], bgmAction: 'muffle' },
    },
    'beat_x4',
    3400,
  ),
  // 高潮：灯亮 = 强光闪白 → 梦境泛光调色 → 英雄螺旋环绕 + 阵风 → 明亮的 BGM
  beat_x4: auto(
    {
      id: 'beat_x4',
      cinematics: { letterbox: false, transition: 'white_flash', grading: 'dream_bloom' }, // 画幅放开 = 情绪释放
      camera: {
        shot: 'medium',
        movement: 'hero_spiral_orbit',
        durationSec: 5,
        easing: 'ease_out_dramatic',
        windMultiplier: 2.4, // 灯亮的一瞬，风起
      },
      actor: {
        leadInMotion: 'joyfulJump', // 起势：先蹦起来，自然播完；之后的台词由语音手势接管
        expression: { base: 'playful', intensity: 0.9, microReaction: 'eye_crinkle' },
        speechText: L('亮了……灯、灯亮了！', "It's on… the light's on!", 'ともった……灯りが、ともった！'),
      },
      audio: {
        ...music('lights_on', 0.34, 1.5),
        bgmAction: 'play',
        playSfx: 'whoosh',
        sfx: [{ id: 'crystal_chime', delaySec: 0.2, volume: 0.9 }],
      },
    },
    'beat_x5',
    1500,
  ),
  beat_x5: auto(
    {
      id: 'beat_x5',
      cinematics: { letterbox: true, transition: 'eye_blink' }, // 眨一下眼：把眼泪眨回去
      camera: { shot: 'close_up', movement: 'push_in', durationSec: 3.5 },
      actor: {
        expression: { base: 'gentle_smile', intensity: 0.9, microReaction: 'eye_crinkle' },
        // 结局回扣：按第一次回应换一句 (getter 在进入该拍时求值，三种语言各自回扣)
        speechText: {
          get 'zh-CN'() {
            return mood === 'warm'
              ? '他没来。……可你说过，你是来找我的。'
              : mood === 'guard'
                ? '他没来。……你说只是路过，却留下了。'
                : '他没来。……可你看穿了我，还留下了。';
          },
          get en() {
            return mood === 'warm'
              ? "He didn't come. …But you said you came for me."
              : mood === 'guard'
                ? "He didn't come. …You said passing by, yet you stayed."
                : "He didn't come. …You saw through me, and stayed.";
          },
          get ja() {
            return mood === 'warm'
              ? '彼は来なかった。……でも君は、会いに来たって言った。'
              : mood === 'guard'
                ? '彼は来なかった。……通りかかっただけなのに、残ってくれた。'
                : '彼は来なかった。……見抜いたうえで、残ってくれた。';
          },
        },
      },
    },
    'beat_end1',
    900,
  ),

  // ═══ 八 · 开口 (教：打断 / 打字 / 语音) ═══
  beat_end1: auto(
    {
      id: 'beat_end1',
      cinematics: { grading: 'default' },
      camera: { shot: 'medium', movement: 'orbit_subtle', durationSec: 2.6 },
      allowInput: true,
      inputPlaceholder: L('想说什么，写下来，或点麦克风对她说……', 'Type something, or tap the mic to speak…', '書いてもいいし、マイクで話しかけてもいいよ……'),
      actor: {
        motion: 'pokeFingers',
        expression: { base: 'shy', intensity: 0.8, microReaction: 'blush_ramp' },
        speechText: L(
          '那封信，我想念给你听。可我一紧张，话就停不下来……',
          "I'll read you the letter. But I ramble when nervous…",
          '手紙を読むね。緊張すると、話が止まらなくて……',
        ),
      },
      audio: music('dusk_warm', 0.3, 3),
    },
    'beat_end2',
    300,
  ),
  beat_end2: auto(
    {
      id: 'beat_end2',
      camera: { shot: 'medium', movement: 'none', durationSec: 1 },
      allowInput: true,
      inputPlaceholder: L('直接开口，打断她……', 'Just speak up and cut in…', 'そのまま話しかけて、割り込もう……'),
      actor: {
        expression: { base: 'playful', intensity: 0.6 },
        speechText: L('要是我说太久，你就直接打断我吧。', 'If I talk too long, just cut in.', '長くなったら、遠慮なく割り込んでね。'),
      },
    },
    'beat_r1',
    300,
  ),
  // 啰嗦三连：说话时输入框一直在场 —— 用户任何时候开口，都是真正的“全双工打断”
  // (打断后引擎停止自动推进，由用户的输入 / AI 生成的下一拍接管剧情)
  beat_r1: auto(
    {
      id: 'beat_r1',
      camera: { shot: 'medium', movement: 'orbit_subtle', durationSec: 8, easing: 'linear' },
      allowInput: true,
      inputPlaceholder: L('直接开口，打断她……', 'Just speak up and cut in…', 'そのまま話しかけて、割り込もう……'),
      actor: {
        motion: 'detailNarrate',
        expression: { base: 'playful', intensity: 0.6 },
        speechText: L('我还在这里，每个黄昏都在，刮风也在，', "I'm still here, every dusk, in the wind,", 'わたしはここにいる、毎夕、風の日も、'),
      },
    },
    'beat_r2',
    80,
  ),
  beat_r2: auto(
    {
      id: 'beat_r2',
      camera: { shot: 'medium', movement: 'orbit_subtle', durationSec: 8, easing: 'linear' },
      allowInput: true,
      inputPlaceholder: L('直接开口，打断她……', 'Just speak up and cut in…', 'そのまま話しかけて、割り込もう……'),
      actor: {
        motion: 'detailNarrate',
        expression: { base: 'playful', intensity: 0.7 },
        speechText: L('下雨也在，没人来也在，一直，一直，', 'in the rain, even when no one comes, always, always,', '雨の日も、誰も来ない日も、ずっと、ずっと、'),
      },
    },
    'beat_r3',
    80,
  ),
  beat_r3: {
    id: 'beat_r3',
    camera: { shot: 'close_up', movement: 'push_in', durationSec: 1.6 },
    allowInput: true,
    inputPlaceholder: L('直接开口，打断她……', 'Just speak up and cut in…', 'そのまま話しかけて、割り込もう……'),
    actor: {
      motion: 'detailNarrate',
      expression: { base: 'shy', intensity: 0.8, microReaction: 'blush_ramp' },
      speechText: L('一直都在这里……啊，我是不是说太多了？', 'always right here… Ah, am I talking too much?', 'ずっとここに……あ、しゃべりすぎかな？'),
    },
    choices: [
      { id: 'r_listen', icon: '👂', text: L('没有，我想听', 'No, I want to hear it', 'ううん、聞きたいよ'), actionType: 'next_beat', nextBeatId: 'beat_final' },
    ],
  },
  beat_final: {
    id: 'beat_final',
    cinematics: { letterbox: true },
    camera: { shot: 'close_up', movement: 'push_in', durationSec: 3 },
    allowInput: true,
    inputPlaceholder: L('对小蠢说点什么，或点麦克风直接说……', 'Say something to XiaoChun, or tap the mic…', '小蠢に話しかけてみてね……'),
    actor: {
      motion: 'handHeart',
      expression: { base: 'gentle_smile', intensity: 0.9, microReaction: 'eye_crinkle' },
      speechText: L('以后想说什么，写给我，或者直接对我说。', 'Next time, write to me, or just speak to me.', 'これからは、書いても、話しかけてもいいよ。'),
    },
    choices: [
      {
        id: 'finale_finish',
        icon: '🌅',
        text: L('明天黄昏，我还来', "I'll come again tomorrow dusk", '明日の夕暮れも、また来るよ'),
        subText: L('结束序章，开始日常陪伴', 'End the prologue, start daily life together', 'プロローグを終えて、日常へ'),
        actionType: 'finish',
      },
    ],
  },
};

export const prologueStory: StoryScript = {
  id: 'prologue_awakening',
  title: L('序章·黄昏的信', 'Prologue · The Letter at Dusk', 'プロローグ・黄昏の手紙'),
  description: L(
    '海边黄昏，小蠢在等一个人，和一封一直没敢寄出的信。',
    'At dusk by the sea, XiaoChun waits for someone, and for a letter she never dared to send.',
    '夕暮れの海辺で、小蠢は人を待っている。出せなかった手紙と一緒に。',
  ),
  initialBeatId: 'beat_greet',
  beats,
};
