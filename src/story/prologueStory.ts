import type { StoryScript, LocalizedStoryBeat, LocalizedStoryChoice, LocalizedText, AudioDirective } from './schema';
import { vrmEngine } from '@/core/vrmEngine';
import { sceneManager } from '@/core/scene/sceneManager';

/**
 * 序章 v3 · 《黄昏的信》 (Mock 演示版：零 API Key、零外部音频资源，中 / 英 / 日三语)
 *
 * 一句话：小蠢每天傍晚去海边看灯塔亮没亮 —— 有人说过灯亮了就回来；
 * 她还写了封信，改了三遍，嫌太肉麻，一直没寄。语气轻、有点嘴贫，不煽情。
 *
 * 结构：共 13 拍；典型路径只有 9 拍、8 句台词 (= 8 次 TTS)。每拍一次说完，不再拆成短句：
 *   greet (轻触唤醒 + 选语言) → ask (点选卡片) → look (拖拽镜头) → sea (场景卡片：去海边)
 *   → arrive (逆光破晓，三选一) → dusk (无台词：天色沉下去) → light (灯亮) → wrap (教打断) → ramble (故意啰嗦，等你打断)
 *   可选支线各一拍：wait_here / letter / doubt / bye。
 *
 * 教学点 (全部由剧情动机驱动，每一步都接在上一句台词之后)：
 *   轻触 (同时解锁 AudioContext) → 选语言 → 点选卡片 → 拖拽镜头 → 场景卡片 → 选择影响结尾 → 打断 / 打字 / 语音。
 *
 * 引擎能力 (见 docs/STORY_DIRECTOR.md)：
 *   autoNextBeatId · 多语言文本 · 转场 fade_to_black / white_flash · 调色 sepia_memory / dream_bloom
 *   · 逆光破晓 hero_backlight_reveal / 荷兰角 dutch_tilt / 螺旋环绕 · 运镜阵风 windMultiplier
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

/** 她对“你是来找我的吗”的回答，用于 look 的回应与结尾回扣 */
type Mood = 'warm' | 'guard' | 'curious';
let mood: Mood = 'warm';
const setMood = (m: Mood) => () => {
  mood = m;
};

/** 随 mood 变化的三语文本：getter 在进入该拍时才求值，所以点完选项再进入的那一拍就是对应版本 */
const moodText = (table: Record<Mood, [string, string, string]>): LocalizedText => ({
  get 'zh-CN'() {
    return table[mood][0];
  },
  get en() {
    return table[mood][1];
  },
  get ja() {
    return table[mood][2];
  },
});

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

/** “陪你等灯亮”：天色从金黄一路沉到夜里，灯塔随之亮起 (约 7 秒，对齐 dusk 拍结束、light 拍闪白的时刻) */
function startDuskToNight() {
  tweenBeachHour(17.2, 20.8, 7000);
}

// ───────────────────────── 共享选项 ─────────────────────────

/** 去海边 / 再等等 (sea 与 wait_here 共用) */
const seaChoices: LocalizedStoryChoice[] = [
  {
    id: 'go_beach',
    icon: '🏖️',
    image: '/previews/scenes/beach3d.webp',
    text: L('好，一起去', "Sure, let's go", 'うん、行こう'),
    subText: L('黄昏的海边', 'Seaside at dusk', '夕暮れの海辺'),
    actionType: 'custom',
    actionPayload: goToBeachAtGoldenHour,
    nextBeatId: 'beat_arrive',
  },
  {
    id: 'wait_a_bit',
    icon: '⏳',
    text: L('再等等', 'Hold on a sec', 'ちょっと待って'),
    actionType: 'next_beat',
    nextBeatId: 'beat_wait_here',
  },
];

/** 等灯亮 / 先走了 (letter 与 doubt 共用) */
const stayOrLeave = (prefix: string): LocalizedStoryChoice[] => [
  {
    id: `${prefix}_stay`,
    icon: '🕯️',
    text: L('我陪你等灯亮', "I'll wait with you", '灯りがつくまで待つよ'),
    actionType: 'custom',
    actionPayload: startDuskToNight,
    nextBeatId: 'beat_dusk',
  },
  {
    id: `${prefix}_leave`,
    icon: '👋',
    text: L('我先走了', 'I should get going', 'そろそろ行くね'),
    actionType: 'next_beat',
    nextBeatId: 'beat_bye',
  },
];

// ───────────────────────── 剧本 ─────────────────────────

const beats: Record<string, LocalizedStoryBeat> = {
  // ═══ 一 · 唤醒 + 选语言 (教：轻触；点选卡片) ═══
  // ⚠ 引擎对 id === 'beat_greet' 有专属演出 (黑幕隐藏模型→点击→自下而上升镜→转身)，不要改 id。
  // 选语言就放在这一拍的卡片里：change_lang 选完立刻换语言，之后每一拍都用新语言 (台词 / 卡片 / TTS)。
  beat_greet: {
    id: 'beat_greet',
    cinematics: {
      letterbox: true,
      intertitle: {
        text: L(
          '一个很安静的地方。\n轻点屏幕，把她叫醒。',
          'A very quiet place.\nTap the screen to wake her up.',
          'とても静かな場所。\n画面をタップして、彼女を起こそう。',
        ),
        durationSec: 0,
        style: 'noto_serif',
        bgmFaded: true,
        requireClick: true, // ← 全片唯一一次“必须点击”：同时解锁浏览器音频
      },
    },
    camera: { shot: 'medium', movement: 'pedestal_up', durationSec: 2.2 }, // 实际由引擎 panUpReveal 接管
    actor: {
      expression: { base: 'surprised', intensity: 0.7, microReaction: 'sudden_shock' },
      speechText: L(
        '哎，有人戳我。你好，我是小蠢，刚睡醒，头发有点乱，别在意。先问个实际的：我们说哪种话？',
        "Oh, someone poked me. Hi, I'm XiaoChun. Just woke up, so ignore the hair. First, a practical question: which language do we speak?",
        'あ、誰かにつつかれた。こんにちは、小蠢です。起きたばかりで髪がぼさぼさだけど、気にしないで。まず聞くね、どの言葉で話そう？',
      ),
    },
    audio: music('void_drone', 0.28, 4), // 点击唤醒后：低沉的长音淡入，下一拍换成暖色
    choiceLayout: 'grid',
    choices: [
      { id: 'lang_zh', icon: '🇨🇳', text: '中文', subText: '简体中文', actionType: 'change_lang', actionPayload: 'zh-CN', nextBeatId: 'beat_ask' },
      { id: 'lang_en', icon: '🇺🇸', text: 'English', subText: 'English', actionType: 'change_lang', actionPayload: 'en', nextBeatId: 'beat_ask' },
      { id: 'lang_ja', icon: '🇯🇵', text: '日本語', subText: '日本語', actionType: 'change_lang', actionPayload: 'ja', nextBeatId: 'beat_ask' },
    ],
  },

  // ═══ 二 · 第一次回应 (教：点选卡片的“意义”，答案会影响结尾) ═══
  beat_ask: {
    id: 'beat_ask',
    camera: { shot: 'medium', movement: 'push_in', durationSec: 2.6 },
    actor: {
      motion: 'listening',
      expression: { base: 'gentle_smile', intensity: 0.7 },
      speechText: L(
        '好，就这么说。第二个问题：你是来找我的吗？不用出声，点下面的卡片就行。',
        "Great, settled. Second question: did you come here to see me? No need to talk, just tap a card below.",
        'うん、それでいこう。二つ目の質問。わたしに会いに来てくれたの？声は出さなくていいよ、下のカードをタップしてね。',
      ),
    },
    audio: music('dusk_warm', 0.3, 3),
    choices: [
      {
        id: 'ask_warm',
        icon: '💗',
        text: L('是啊，来找你的', 'Yes, I came to see you', 'うん、君に会いに来た'),
        actionType: 'custom',
        actionPayload: setMood('warm'),
        nextBeatId: 'beat_look',
      },
      {
        id: 'ask_guard',
        icon: '🚶',
        text: L('路过，顺便看看', 'Just passing by', '通りかかっただけ'),
        actionType: 'custom',
        actionPayload: setMood('guard'),
        nextBeatId: 'beat_look',
      },
      {
        id: 'ask_curious',
        icon: '❓',
        text: L('你在等谁吗？', 'Are you waiting for someone?', '誰かを待ってるの？'),
        actionType: 'custom',
        actionPayload: setMood('curious'),
        nextBeatId: 'beat_look',
      },
    ],
  },

  // ═══ 三 · 拖拽镜头 (教：拖拽 / 缩放；一拍说完回应 + 教学，三种回应由 mood 在进入本拍时选定) ═══
  beat_look: {
    id: 'beat_look',
    cinematics: { letterbox: false }, // 收起遮幅 = 画面放开，鼓励你自己动手
    interaction: 'camera_drag',
    camera: { shot: 'medium', movement: 'arc_sweep', orbitAngleDeg: 40, durationSec: 3 }, // 先替你转一小段，再把控制权交给你
    actor: {
      expression: { base: 'playful', intensity: 0.7, microReaction: 'eye_crinkle' },
      speechText: moodText({
        warm: [
          '真的？那我得好好招待。拖动屏幕，绕着我转一圈，随便看。别靠太近，我会不好意思。',
          "Really? Then I'd better be a good host. Drag the screen to walk a lap around me. Just not too close, I get shy.",
          'ほんと？じゃあちゃんとおもてなししなきゃ。画面をドラッグして、ぐるっと回って見ていいよ。近すぎるのは照れるからだめ。',
        ],
        guard: [
          '路过也算客人。拖动屏幕，绕着我转一圈，免费参观。别靠太近就行。',
          "Passers-by count as guests. Drag the screen to walk a lap around me. Free tour. Just not too close.",
          '通りかかった人も、お客さんだよ。画面をドラッグして、ぐるっと一周してみて。見学は無料。近すぎるのはなしね。',
        ],
        curious: [
          '被你猜中了，我是在等人。细节待会儿说，你先拖动屏幕，绕着我转一圈。别靠太近。',
          "You guessed it, I am waiting for someone. Details later. First, drag the screen to walk a lap around me. Not too close.",
          '当たり。実は人を待ってるの。くわしくは後でね。まず画面をドラッグして、わたしの周りを一周してみて。近すぎるのはだめ。',
        ],
      }),
    },
    choices: [
      {
        // id 刻意用 look_done：StoryPlayer 会按任务完成度把它换成本地化的完成提示
        id: 'look_done',
        icon: '👀',
        text: L('看够了', "That's enough", 'もう十分'),
        subText: L('没有靠太近哦', "I didn't get too close", '近づきすぎてないよ'),
        actionType: 'next_beat',
        nextBeatId: 'beat_sea',
      },
    ],
  },

  // ═══ 四 · 邀请去海边 (教：场景卡片；可拖延) ═══
  beat_sea: {
    id: 'beat_sea',
    camera: { shot: 'full', movement: 'pull_out', durationSec: 3.2 }, // 拉到全景：她站在一片空白里，自然引出“换个地方”
    actor: {
      motion: 'thinking',
      expression: { base: 'gentle_smile', intensity: 0.7 },
      speechText: L(
        '看完了？那我带你去个地方。每天傍晚，我都要去海边看灯塔亮了没，今天你一起去吧。',
        "Done looking? Then let me take you somewhere. Every dusk I go to the sea to check if the lighthouse is on. Come along today.",
        '見終わった？じゃあ、連れていきたい場所があるの。毎日夕暮れに、海へ灯台を見に行くんだ。今日は一緒にどう？',
      ),
    },
    choiceLayout: 'grid',
    choices: seaChoices,
  },
  beat_wait_here: {
    id: 'beat_wait_here',
    camera: { shot: 'medium', movement: 'push_in', durationSec: 1.6 },
    actor: {
      motion: 'poutHum',
      expression: { base: 'playful', intensity: 0.8 },
      speechText: L(
        '行，你慢慢想。不过太阳可不会等你。',
        "Sure, take your time. The sun won't wait for you, though.",
        'いいよ、ゆっくり考えて。ただ、太陽は待ってくれないけどね。',
      ),
    },
    choiceLayout: 'grid',
    choices: seaChoices,
  },

  // ═══ 五 · 黄昏海边 ═══
  // 从虚空到海边：fade_to_black 由 selectChoice 提前盖住画面，场景切换发生在黑幕之下，睁开就是黄昏。
  beat_arrive: {
    id: 'beat_arrive',
    cinematics: { letterbox: true, transition: 'fade_to_black', grading: 'default' },
    camera: {
      shot: 'medium',
      movement: 'hero_backlight_reveal', // 机位绕到太阳对面、压低：她站在落日与镜头之间，逆光剪影
      durationSec: 5,
      windMultiplier: 1.9, // 海风吹起发丝与裙摆，运镜结束后约 1 秒回落
    },
    actor: {
      motion: 'gazeObserve',
      expression: { base: 'gentle_smile', intensity: 0.8 },
      speechText: L(
        '到了。我每天傍晚都来，等灯塔亮。有人说过灯亮了就回来，我就当真了。信也写好了，改了三遍，嫌太肉麻，还没寄。',
        "We're here. I come every dusk to watch for the lighthouse. Someone said they'd be back when it lights up, and I took that seriously. I wrote a letter too, rewrote it three times, found it too cheesy, and haven't sent it.",
        '着いた。毎日夕暮れに来て、灯台がともるのを待ってるの。灯りがついたら戻る、って言われて、真に受けちゃった。手紙も書いたよ。三回書き直して、恥ずかしくてまだ出してない。',
      ),
    },
    audio: { ambience: 'sea_waves', ambienceVolume: 0.22, playSfx: 'bell' },
    choices: [
      {
        id: 'arrive_stay',
        icon: '🕯️',
        text: L('陪你等灯亮', "I'll wait with you", '灯りがつくまで待つ'),
        actionType: 'custom',
        actionPayload: startDuskToNight,
        nextBeatId: 'beat_dusk',
      },
      { id: 'arrive_letter', icon: '✉️', text: L('信里写了什么？', "What's in the letter?", '手紙には何て？'), actionType: 'next_beat', nextBeatId: 'beat_letter' },
      { id: 'arrive_doubt', icon: '🤔', text: L('他真会来吗？', 'Will he really come?', '本当に来るの？'), actionType: 'next_beat', nextBeatId: 'beat_doubt' },
    ],
  },

  // —— 支线：问起信 (暖褐回忆调色) ——
  beat_letter: {
    id: 'beat_letter',
    cinematics: { grading: 'sepia_memory' }, // 信的内容 = 回忆质感，下一拍恢复
    camera: { shot: 'close_up', movement: 'push_in', durationSec: 3.5 },
    actor: {
      expression: { base: 'shy', intensity: 0.7, microReaction: 'blush_ramp' },
      speechText: L(
        '就一句：“我还在这儿。”写完嫌太直白，划掉，又写回来了。',
        'Just one line: "I\'m still here." Wrote it, found it too blunt, crossed it out, wrote it back.',
        '一行だけ。「わたしはまだここにいる」。直接すぎるかなと思って消して、また書いたの。',
      ),
    },
    choices: stayOrLeave('letter'),
  },

  // —— 支线：问他会不会来 (荷兰角：画面微微歪一下，嘴贫) ——
  beat_doubt: {
    id: 'beat_doubt',
    camera: { shot: 'medium', movement: 'dutch_tilt', durationSec: 3 },
    actor: {
      motion: 'thinking',
      expression: { base: 'playful', intensity: 0.6 },
      speechText: L(
        '说不准。他那个人，守时这件事上没什么信誉。不过灯肯定会亮，这个我有把握。',
        "Hard to say. Punctuality was never his strong suit. The light will come on though, that part I'm sure of.",
        'どうかな。時間にルーズな人だから。でも灯りがつくのは確実。そこは自信あるよ。',
      ),
    },
    choices: stayOrLeave('doubt'),
  },

  // —— 提前离场结局 ——
  beat_bye: {
    id: 'beat_bye',
    cinematics: { transition: 'fade_to_black', grading: 'default' },
    camera: { shot: 'full', movement: 'pull_out', durationSec: 5 },
    actor: {
      motion: 'singleHandWave',
      expression: { base: 'gentle_smile', intensity: 0.6 },
      speechText: L(
        '好，那明天见。灯我替你看着。',
        "Okay, see you tomorrow. I'll keep an eye on the light for you.",
        'うん、また明日。灯りは、わたしが見ておくね。',
      ),
    },
    audio: music('farewell', 0.3, 3),
    choices: [{ id: 'bye_finish', icon: '🌙', text: L('明天见，小蠢', 'See you, XiaoChun', 'またね、小蠢'), actionType: 'finish' }],
  },

  // ═══ 六 · 等灯亮 (视觉事件：天色沉入夜，灯塔点亮) ═══
  // dusk 刻意无台词：不说话，让天色自己变。TTS 零请求。
  beat_dusk: auto(
    {
      id: 'beat_dusk',
      cinematics: { letterbox: true, grading: 'default' },
      camera: { shot: 'full', movement: 'pull_out', durationSec: 5 },
      actor: {
        motion: 'gazeObserve', // 非说话动作：安静地望向天边，动作会自然播完
        expression: { base: 'gentle_smile', intensity: 0.4 },
        speechText: '',
      },
    },
    'beat_light',
    5500,
  ),
  // 灯亮 = 闪白 → 梦境泛光 → 螺旋环绕 + 阵风 → 明亮的 BGM；画幅放开
  beat_light: auto(
    {
      id: 'beat_light',
      cinematics: { letterbox: false, transition: 'white_flash', grading: 'dream_bloom' },
      camera: {
        shot: 'medium',
        movement: 'hero_spiral_orbit',
        durationSec: 5.5,
          windMultiplier: 2.4,
      },
      actor: {
        leadInMotion: 'joyfulJump', // 起势：先蹦一下，自然播完，不会被开声打断
        expression: { base: 'playful', intensity: 0.9, microReaction: 'eye_crinkle' },
        speechText: L('亮了！我就说它会亮。', "It's on! Told you it would.", 'ついた！ほらね、ちゃんとつくって言ったでしょ。'),
      },
      audio: { ...music('lights_on', 0.34, 2), playSfx: 'whoosh', sfx: [{ id: 'crystal_chime', delaySec: 0.2, volume: 0.8 }] },
    },
    'beat_wrap',
    3200, // 留够运镜时间：下一拍的镜头不会把螺旋环绕拦腰截断
  ),

  // ═══ 七 · 结尾 + 教打断 / 打字 / 语音 ═══
  beat_wrap: auto(
    {
      id: 'beat_wrap',
      cinematics: { grading: 'default' },
      camera: { shot: 'medium', movement: 'orbit_subtle', durationSec: 4 },
      allowInput: true,
      inputPlaceholder: L('想说什么，写下来，或点麦克风对她说', 'Type something, or tap the mic to speak', '書いてもいいし、マイクで話してもいいよ'),
      actor: {
        motion: 'pokeFingers',
        expression: { base: 'gentle_smile', intensity: 0.8 },
        // 结尾回扣第一次的回应 (getter 在进入该拍时求值，三种语言各自回扣)
        speechText: moodText({
          warm: [
            '灯亮了，人还没到，算了，明天再等。不过今天有你来找我，不亏。对了，我话多，说久了你直接打断我就行：打字，或者点麦克风都可以。',
            "The light's on, he's not here yet. Oh well, tomorrow. Still, you came to see me today, so not a bad deal. Also, I talk a lot. If I go on too long, just cut in: type, or tap the mic.",
            '灯りはついたけど、まだ来ない。まあ、また明日。でも今日は君が会いに来てくれたから、悪くないね。それと、わたしは話が長いの。長くなったら、書くか、マイクで割り込んでね。',
          ],
          guard: [
            '灯亮了，人还没到，算了，明天再等。不过今天有个路过的人留了下来，不亏。对了，我话多，说久了你直接打断我就行：打字，或者点麦克风都可以。',
            "The light's on, he's not here yet. Oh well, tomorrow. Still, a passer-by stuck around today, so not a bad deal. Also, I talk a lot. If I go on too long, just cut in: type, or tap the mic.",
            '灯りはついたけど、まだ来ない。まあ、また明日。でも今日は通りがかった人が残ってくれたから、悪くないね。それと、わたしは話が長いの。長くなったら、書くか、マイクで割り込んでね。',
          ],
          curious: [
            '灯亮了，人还没到，算了，明天再等。不过今天有人猜中了我的心事，还留下陪我，不亏。对了，我话多，说久了你直接打断我就行：打字，或者点麦克风都可以。',
            "The light's on, he's not here yet. Oh well, tomorrow. Still, someone guessed my secret and stayed, so not a bad deal. Also, I talk a lot. If I go on too long, just cut in: type, or tap the mic.",
            '灯りはついたけど、まだ来ない。まあ、また明日。でも今日は気持ちを言い当てて、残ってくれた人がいたから、悪くないね。それと、わたしは話が長いの。長くなったら、書くか、マイクで割り込んでね。',
          ],
        }),
      },
    },
    'beat_ramble',
    300,
  ),
  // 故意啰嗦的一拍：说话时输入框一直在场，用户任何时候开口都是真正的“全双工打断”
  // (打断后引擎停止自动推进，由用户的输入 / AI 生成的下一拍接管剧情)
  beat_ramble: {
    id: 'beat_ramble',
    camera: { shot: 'medium', movement: 'orbit_subtle', durationSec: 9, easing: 'linear' },
    allowInput: true,
    inputPlaceholder: L('直接开口，打断她', 'Just speak up and cut in', 'そのまま話しかけて、割り込もう'),
    actor: {
      motion: 'detailNarrate',
      expression: { base: 'playful', intensity: 0.7 },
      speechText: L(
        '那我开始了。今天的云像棉花糖，昨天的云也像棉花糖，前天的云……好像是烤面包，不对，还是棉花糖。大前天的云我记得更清楚，它是……',
        "Here I go, then. Today's clouds looked like cotton candy, yesterday's too, the day before that, toast, no wait, cotton candy. Three days ago, I remember even better, it was…",
        'じゃあ始めるね。今日の雲は綿菓子みたいで、昨日の雲も綿菓子みたいで、一昨日の雲は……トースト、いや、やっぱり綿菓子。その前の日はもっとよく覚えてて、それは……',
      ),
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
    '海边黄昏，小蠢在等灯塔亮，还有一封改了三遍、没寄出去的信。',
    'At dusk by the sea, XiaoChun waits for the lighthouse to light up, with a letter she rewrote three times and never sent.',
    '夕暮れの海辺で、小蠢は灯台がともるのを待っている。三回書き直して、まだ出していない手紙と一緒に。',
  ),
  initialBeatId: 'beat_greet',
  beats,
};
