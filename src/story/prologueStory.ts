import type { StoryScript, LocalizedStoryBeat, LocalizedText, AudioDirective } from './schema';

/**
 * 序章 v4 · 《初遇小蠢》 (Meeting XiaoChun)  —— Mock 演示版：零 API Key、零外部音频资源，中 / 英 / 日三语
 *
 * 一句话：用户提前进场，撞见小蠢正对着空气排练一套做作的“女神欢迎词”。
 * 抓包 → 破功嘴硬 → 让你帮忙检查仪容 → 嫌弃空荡荡的虚空、换场景 → 经费燃烧、让你说句话 → 扔掉台本，进入自由聊天。
 * 每个操作教学点都有剧情动机，小蠢只说戏里的话；操作提示由卡片自己的标题 / 副标题承担。
 *
 * 结构：叫醒拍 (beat_greet，沿用原来的黑幕“轻点屏幕，把她叫醒”，同时解锁浏览器音频) + 6 拍 + 1 拍换装，每拍 1 句台词 = 1 次 TTS：
 *   1 后台抓包 (auto 400ms) → 2 社死破功 (选语言) → 3 检查仪容 (camera_drag 教学卡：转视角 / 缩放)
 *   → 3.5 帮我挑衣服 (衣服卡：当场换装预览 + 确认) → 4 嫌弃虚空 (场景卡：带预览图，海边 / 昼白线稿 / 极夜线稿)
 *   → 5 经费燃烧 (白闪切场景 + 昼夜光影 + input：说句话) → 6 剧本杀青 (auto 300ms → finish → 自由聊天)。
 * 额外语音只在两种情况：镜头任务 6 秒超时的兜底台词；用户输入后的固定回复。
 *
 * 参数名与引擎 id 的对应 (剧本策划稿 → 代码)：
 *   场景 void (开场，叫醒 + 前几拍都在虚空里) ；lineart_day / lineart_night / beach → light / dark / beach3d (见 scenes.ts)
 *   调色 dreamy_soft → dream_bloom，memory_sepia → sepia_memory，none → default
 *   运镜 spiral_rise → hero_spiral_orbit，arc_pan → arc_sweep，static → none，orbit → orbit_subtle (配合 showFullBody 原地转圈)
 *   转场 letterbox_on/off → cinematics.letterbox；eye_blink / white_flash 同名 (叫醒后的第 1 拍改用 fade_to_black，不眨眼)
 *   BGM calm / bright / mystic → dusk_warm / lights_on / void_drone (audioDirector 别名)；none → fade_out
 *   音效 crystal / shutter / heartbeat / wind / waves 同名别名 (audioDirector SFX_ALIASES)；whoosh / bell 同名
 *   风力 0~3：环境阵风倍率 1 + 0.5 × 等级 (与运镜阵风取较大者)
 *   景别 wide / medium_close_up 为新增预设；情绪 happy / angry 为新增枚举 (表情控制器早已支持)
 */

/** 三语文本：zh-CN 必填；缺哪个语言就回退 zh-CN。 */
const L = (zh: string, en: string, ja: string): LocalizedText => ({ 'zh-CN': zh, en, ja });

/** 程序化 BGM 指令 (同一个 mood 再次触发只更新音量，不会重启) */
const music = (mood: string, bgmVolume = 0.3, bgmFadeSec = 3): AudioDirective => ({ bgmAction: 'play', bgmMood: mood, bgmVolume, bgmFadeSec });

const beats: Record<string, LocalizedStoryBeat> = {
  // ═══ 叫醒 (沿用原来的黑幕“轻点屏幕，把她叫醒”) ═══
  // 全片唯一必须的点击，同时在手势调用栈里解锁浏览器音频。点完之后什么都不说，立刻进入第 1 拍 (睁眼转场)。
  // ⚠ 引擎对 id === 'beat_greet' 有专属处理 (黑幕隐藏模型 + 背对镜头)，不要改 id。
  beat_greet: {
    id: 'beat_greet',
    cinematics: {
      letterbox: true,
      intertitle: {
        // 旁白 (不是小蠢在说话)：门后有人在自言自语，轻触 = 推门进去
        text: L(
          '门后有人在小声嘀咕……好像在排练什么。',
          'Someone behind the door is muttering to herself... rehearsing something?',
          '扉の向こうで誰かがぶつぶつ……何かの練習？',
        ),
        // 黑幕下方的小字 (按剧情语言显示)
        subtitle: L('轻触推门进去', 'Tap to step in', 'タップして中へ'),
        durationSec: 0,
        style: 'noto_serif',
        bgmFaded: true,
        requireClick: true,
      },
    },
    actor: { speechText: '', expression: { base: 'neutral', intensity: 0.5 } }, // 叫醒拍不说话
    autoNextBeatId: 'beat_1',
    autoNextDelayMs: 0,
  },

  // ═══ 1 · 后台抓包 (偷窥感：遮幅；镜头在远处斜后方就位，随她的台词缓缓推近；小蠢背对镜头排练) ═══
  beat_1: {
    id: 'beat_1',
    scene: 'void', // 开场：虚空场景 (叫醒拍结束后才露出来)
    cinematics: { letterbox: true, transition: 'fade_to_black', grading: 'dream_bloom', wind: 0 }, // 黑幕淡出 (不眨眼)：盖住镜头跳到远处斜后方的那一下
    // 不绕到她前面：远处 (6.5m) 斜后方 25° 就位，约一句台词的时间缓推到全身景别并转正到正后方
    camera: { shot: 'full', movement: 'slow_push_in', startDistance: 6.5, startAzimuthOffsetDeg: 25, durationSec: 9 },
    actor: {
      facing: 'back', // 背对画面
      motion: 'singleHandWave', // 单手抚胸，对着空气深情款款地挥手排练
      expression: { base: 'gentle_smile', intensity: 0.8 },
      speechText: L(
        '……咳，命运指引的旅人啊，欢迎来到我的领域……\n不对，这句太中二了，重来重来！',
        '...Ahem! O traveler guided by fate, welcome to my realm... \nUgh, way too edgy. Take two!',
        '……コホン。運命に導かれし旅人よ、我が領域へようこそ……\nって、さすがに中二すぎるわね。もう一回！',
      ),
    },
    audio: { bgmAction: 'fade_out', bgmFadeSec: 0.6, sfx: [{ id: 'crystal', delaySec: 0.2, volume: 0.7 }] },
    autoNextBeatId: 'beat_2',
    autoNextDelayMs: 400,
  },

  // ═══ 2 · 社死破功 (教：点选回应 + 切换语言；卡片只显示各自语言的原文) ═══
  beat_2: {
    id: 'beat_2',
    cinematics: { letterbox: false, grading: 'default', wind: 0 },
    // 第 1 拍说完才绕：相机沿最短弧环绕到她正面 (她的世界朝向不动，相机绕到她面朝的方向)，收在 medium_close_up；和 whoosh 同步
    camera: { shot: 'medium_close_up', movement: 'orbit_to_front', durationSec: 2.4 },
    waitForCamera: true, // 镜头完整转到她面前之后，才跺脚 / 变脸 / 心跳 / 开口 (whoosh 仍与镜头同时)
    actor: {
      leadInMotion: 'angryJump', // 被抓包又羞又恼：气鼓鼓地跺脚轻跳 (MOTION_CATALOG.angryJump，自带 angry 表情曲线)
      expression: { base: 'angry', intensity: 0.6, microReaction: 'sudden_shock' }, // 惊吓一抖，随即恼羞成怒
      speechText: L(
        '哇啊！你什么时候进来的？！不带这么偷听人彩排的啊……等等，你能听懂我说话吗？',
        'Whoa! How long have you been standing there?! Eavesdropping is foul play... Wait, do you understand me?',
        'わあっ！いつからそこにいたの！？リハーサルの盗み聞きは反則でしょ……って、私の言葉わかる？',
      ),
    },
    audio: {
      ...music('calm', 0.3, 2),
      sfx: [
        { id: 'whoosh', delaySec: 0.1, volume: 0.6 },
        { id: 'heartbeat', delaySec: 0.1, volume: 0.7, afterCamera: true },
      ],
    },
    choiceLayout: 'list',
    choices: [
      // 每张卡片只写自己语言的原文 (纯字符串 = 所有语言下都是这句)：选哪张，从下一拍起就用哪种语言说话。
      { id: 'lang_zh', icon: '🇨🇳', text: '全听见了，大女神', actionType: 'change_lang', actionPayload: 'zh-CN', nextBeatId: 'beat_3' },
      { id: 'lang_en', icon: '🇺🇸', text: 'Loud and clear!', actionType: 'change_lang', actionPayload: 'en', nextBeatId: 'beat_3' },
      { id: 'lang_ja', icon: '🇯🇵', text: 'いいセリフだったね', actionType: 'change_lang', actionPayload: 'ja', nextBeatId: 'beat_3' },
    ],
  },

  // ═══ 3 · 检查仪容 (教：拖动视角 + 缩放，旧版 camera_drag 教学卡 + 按钮进入下一拍) ═══
  beat_3: {
    id: 'beat_3',
    cinematics: { grading: 'default', wind: 0 },
    // 正面、水平：相机沿最短弧绕到她面朝的方向 (已在正面时只是不动)，并把上一拍可能残留的滚转缓回 0°；
    // 不用 dutch_tilt (滚转 -9° 会让画面歪) —— 这一拍要用户安心检查发型，不是内心不安
    camera: { shot: 'medium', movement: 'orbit_to_front', durationSec: 2.0 },
    actor: {
      leadInMotion: 'pokeFingers', // 低头整理裙摆，随后叉腰等待检查
      expression: { base: 'shy', intensity: 0.8, microReaction: 'blush_ramp' },
      speechText: L(
        '那叫专业热身懂不懂！都怪你突然袭击，快帮我看看背后头发乱没乱？凑近点看也行！',
        "That was a pro warm-up, okay?! You startled me, so check if my hair's a mess in the back! Look closer!",
        '今のはプロの準備運動よ！急に来たせいなんだから、後ろ髪がハネてないか近くでちゃんと見てよね！',
      ),
    },
    audio: { sfx: [{ id: 'shutter', delaySec: 0.5, volume: 0.7 }] },
    // 旧版 camera_drag 教学卡 (StoryCameraTaskCard：拖动 / 缩放手势任务清单，PC + 触屏文案各一套) + 用户口吻的“继续”按钮；
    // 不做自动检测、不做兜底：用户想看多久看多久，自己点按钮进入下一拍 (全部任务完成后按钮文案会变成“前往下一步”)。
    interaction: 'camera_drag',
    choices: [
      {
        id: 'look_done',
        icon: '👀',
        text: L('看好了，没乱', "Looks good, nothing's messy", '大丈夫、乱れてないよ'),
        subText: L('绕着你转了一圈', 'I walked all the way around', 'ぐるっと一周して見たよ'),
        actionType: 'next_beat',
        nextBeatId: 'beat_outfit_choice',
      },
    ],
  },

  // ═══ 3.5 · 帮我挑衣服 (教：换装。接在“检查仪容”之后：被你绕着看了一圈，她才发现这身太正式) ═══
  // 点一张衣服卡 = 当场换上并转一圈展示 (可以来回试)，点“就这身了”才进入下一拍；ids 与引擎的历史记录文案对应，别改。
  beat_outfit_choice: {
    id: 'beat_outfit_choice',
    cinematics: { grading: 'default', wind: 0 },
    camera: { shot: 'wide', movement: 'arc_sweep', durationSec: 2.4 }, // 全身入镜且以身体为中心 (full 的取景底边会切到脚)；仍远大于 1.8 m
    actor: {
      leadInMotion: 'fingerObserve', // 比出取景框打量自己
      expression: { base: 'playful', intensity: 0.8, microReaction: 'eye_crinkle' },
      speechText: L(
        '等等，被你绕着看了一圈我才发现，这身是不是太正式了？你来当造型师，帮我挑一套！',
        "Wait, now that you've circled me, this outfit is way too stiff, isn't it? You're my stylist now. Pick me something!",
        'ちょっと待って、ぐるっと見られて気づいたけど、この服ちょっと堅すぎない？スタイリスト役、お願い！',
      ),
    },
    choiceLayout: 'grid',
    choices: [
      {
        id: 'outfit_dress',
        icon: '👗',
        image: '/previews/outfits/xiaochun_dinner_dress.webp',
        text: L('晚礼服最衬你', 'The evening dress suits you', 'ドレスが似合うよ'),
        subText: L('优雅晚礼服', 'Evening dress', 'エレガントなドレス'),
        actionType: 'swap_outfit',
        actionPayload: 'xiaochun_dinner_dress',
      },
      {
        id: 'outfit_maid',
        icon: '☕',
        image: '/previews/outfits/xiaochun_maid.webp',
        text: L('来套女仆装吧', 'Go with the maid outfit', 'メイド服でいこう'),
        subText: L('古典女仆装', 'Classic maid outfit', 'クラシックなメイド服'),
        actionType: 'swap_outfit',
        actionPayload: 'xiaochun_maid',
      },
      {
        id: 'outfit_qipao',
        icon: '🏮',
        image: '/previews/outfits/xiaochun_cheongsam.webp',
        text: L('旗袍，肯定好看', 'Cheongsam, no question', 'チャイナドレスがいい'),
        subText: L('墨韵旗袍', 'Ink cheongsam', '墨色のチャイナドレス'),
        actionType: 'swap_outfit',
        actionPayload: 'xiaochun_cheongsam',
      },
    ],
    confirmChoice: {
      id: 'outfit_confirm',
      text: L('就这身了', "That's the one", 'それに決まり'),
      subText: L('穿着它继续', "Keep it on and move on", 'この服で先へ進む'),
      actionType: 'next_beat',
      nextBeatId: 'beat_4',
    },
  },

  // ═══ 4 · 嫌弃虚空 (教：选场景；选哪个分支决定第 5 拍的场景 / 调色 / 风 / BGM / 音效) ═══
  beat_4: {
    id: 'beat_4',
    cinematics: { grading: 'default', wind: 1 }, // 选场景这一拍不加任何滤镜 (显式回到 default，不继承上一拍)
    camera: { shot: 'full', movement: 'pull_out', durationSec: 2.5 },
    actor: {
      leadInMotion: 'gazeObserve', // 双手一摊，嫌弃地打量四周
      expression: { base: 'angry', intensity: 0.7 },
      speechText: L(
        '行啦，检查合格！不过这个场景除了黑就是紫，什么都没有，太寒酸了。走，带你换个地方待会儿！',
        'Alright, inspection passed! But there\'s nothing here but black and purple. Way too cheap. Come on, let\'s go somewhere nice!',
        'よし、チェック合格！でもここ、黒と紫しかなくて何もないじゃない。味気なさすぎるわよね。どっかいい場所に行こっか！',
      ),
    },
    audio: { sfx: [{ id: 'wind', delaySec: 0.3, volume: 0.6 }] },
    // 场景卡带预览图：点一张就当场换过去看 (可以来回看)，再点“就这儿了”才进入下一拍；选了哪张决定第 5 拍的分支。
    // 即使没点预览直接确认，第 5 拍自己的 scene 也会保证场景对得上。
    choiceLayout: 'grid',
    choices: [
      {
        id: 'scene_beach',
        icon: '🏖️',
        image: '/previews/scenes/beach3d.webp',
        text: L('去海边吹吹风', 'Hit the sunny beach', '海辺で風にあたりたい'),
        subText: L('听海浪，吹海风', 'Waves and sea breeze', '波の音と潮風'),
        actionType: 'change_scene',
        actionPayload: 'beach3d',
        sceneHourFromNow: true, // 不写死钟点：预览用“现在 − 12 小时”的起点，和第 5 拍的推到现在衔接
        branch: 'beach',
      },
      {
        id: 'scene_light',
        icon: '☀️',
        image: '/previews/scenes/light.webp',
        text: L('要个亮堂的白天', 'Somewhere clean and bright', '明るい昼がいい'),
        subText: L('纯白线稿，安静专注', 'Pure line art, calm and quiet', '真っ白な線画で静かに'),
        actionType: 'change_scene',
        actionPayload: 'light',
        branch: 'day',
      },
      {
        id: 'scene_dark',
        icon: '🌌',
        image: '/previews/scenes/dark.webp',
        text: L('换个酷点的夜色', 'Somewhere cool & dark', 'クールな夜がいい'),
        subText: L('星光与冷色夜景', 'Starlight and a cool night', '星明かりのクールな夜'),
        actionType: 'change_scene',
        actionPayload: 'dark',
        branch: 'night',
      },
    ],
    confirmChoice: {
      id: 'scene_confirm',
      text: L('就去这儿了', "That's the place", 'ここに決めた'),
      subText: L('把这里设为常驻世界', 'Make this our home world', 'ここを常駐の世界にする'),
      actionType: 'next_beat',
      nextBeatId: 'beat_5',
    },
  },

  // ═══ 5 · 经费燃烧 (白闪切到所选场景；教：固定回复的“暗号”选项卡，无输入栏。默认 = 海边，variants.day = 昼白线稿，variants.night = 极夜线稿) ═══
  beat_5: {
    id: 'beat_5',
    scene: 'beach', // 兜底：没点过预览卡也保证场景对得上 (已经在这个场景就什么也不做)
    cinematics: {
      transition: 'white_flash',
      grading: 'default',
      wind: 3,
      timeOfDay: { toNow: true, durationSec: 12 }, // 从“现在 − 12 小时”的光影一路走到此刻，再切 auto 跟随真实时间
    },
    camera: { shot: 'wide', movement: 'pull_out', durationSec: 3.0, keepPitch: true }, // 从当前机位原地后拉揭开新场景：方位角与俯仰角都不变 (不再 360° 环绕到她背后)
    actor: {
      leadInMotion: 'relaxStretch', // 张开双臂深呼吸，随后俏皮地歪头看向正前方
      expression: { base: 'happy', intensity: 0.9 },
      speechText: L(
        '呼——这还差不多，总算有点经费燃烧的味道了！好了，轮到你了，来，对个暗号！',
        'Phew—now we\'re talking! Finally feels like we have a real budget! Your turn now, give me the password!',
        'ふぅー、こうでなくっちゃ！やっと予算の匂いがしてきたわね。さあ次はあなたの番、合言葉をどうぞ！',
      ),
    },
    audio: {
      ...music('bright', 0.3, 2.5),
      ambience: 'sea_waves',
      ambienceVolume: 0.2,
      sfx: [
        { id: 'waves', delaySec: 0.1, volume: 0.6 },
        { id: 'wind', delaySec: 1.2, volume: 0.6 },
      ],
    },
    variants: {
      day: {
        scene: 'lineart_day',
        cinematics: { grading: 'dream_bloom', wind: 1, timeOfDay: undefined },
        audio: {
          ...music('calm', 0.3, 2.5),
          ambience: 'none',
          sfx: [
            { id: 'crystal', delaySec: 0.1, volume: 0.6 },
            { id: 'wind', delaySec: 1.2, volume: 0.5 },
          ],
        },
      },
      night: {
        scene: 'lineart_night',
        cinematics: { grading: 'rainy_noir', wind: 2, timeOfDay: undefined },
        audio: {
          ...music('mystic', 0.3, 2.5),
          ambience: 'none',
          sfx: [
            { id: 'bell', delaySec: 0.1, volume: 0.6 },
            { id: 'wind', delaySec: 1.2, volume: 0.6 },
          ],
        },
      },
    },
    // 不开输入栏：只有固定“暗号”卡 (用户口吻，点哪张都进入 beat_5_reply 的同一句固定回应)
    choices: [
      {
        id: 'say_open_sesame',
        icon: '🗝️',
        text: L('芝麻开门！', 'Open sesame!', '開けゴマ！'),
        subText: L('最经典的暗号', 'The classic password', '定番の合言葉'),
        actionType: 'next_beat',
        nextBeatId: 'beat_5_reply',
      },
      {
        id: 'say_budget',
        icon: '💰',
        text: L('经费请批准！', 'Budget approved!', '予算、承認！'),
        subText: L('财大气粗型暗号', 'The deep-pockets password', '財布が重い人の合言葉'),
        actionType: 'next_beat',
        nextBeatId: 'beat_5_reply',
      },
      {
        id: 'say_best',
        icon: '🌟',
        text: L('小蠢天下第一！', 'XiaoChun is the best!', '小蠢が世界一！'),
        subText: L('拍马屁型暗号', 'The flattery password', 'ごますり合言葉'),
        actionType: 'next_beat',
        nextBeatId: 'beat_5_reply',
      },
    ],
  },

  // ═══ 5.5 · 暗号回应 (点任意“暗号”卡之后她的固定回应，说完自动进入选大脑) ═══
  beat_5_reply: {
    id: 'beat_5_reply',
    cinematics: { grading: 'default' },
    camera: { shot: 'medium', movement: 'orbit_to_front', durationSec: 1.8 }, // 正面半身 (不再侧偏、不再连推两次)：从第 5 拍的 wide 平滑收到 medium，并转回她的正前方
    actor: {
      motion: 'pokeDimple',
      expression: { base: 'playful', intensity: 0.9 },
      speechText: L(
        '噗，收到！这暗号听着还挺顺耳的嘛，算你通过本小姐的默契认证啦！',
        'Pfft, copy that! Not a bad password, actually. Consider yourself officially approved by me!',
        'ぷっ、受信完了！なかなかいい合言葉じゃない。私の相棒テスト、合格にしてあげる！',
      ),
    },
    autoNextBeatId: 'beat_brain_choice',
    autoNextDelayMs: 500,
  },

  // ═══ 5.8 · 选大脑 (旧版 beat_brain_choice：本地 WebLLM 开箱即用 / 自定义外部模型 → 打开服务配置弹窗；无 key 也能走完) ═══
  // 两张卡都进入第 6 拍；选自定义时由 StoryPlayer 打开配置弹窗，弹窗关闭 (配没配都行) 后进入第 6 拍。
  beat_brain_choice: {
    id: 'beat_brain_choice',
    cinematics: { grading: 'default' },
    camera: { shot: 'medium', movement: 'none', durationSec: 1.2 }, // 与上一拍同景别、同正面机位：不推近、不环绕 (只保持构图)
    actor: {
      expression: { base: 'shy', intensity: 0.7, microReaction: 'avert_gaze' },
      speechText: L(
        '最后一件事！台词都背熟了，可我还缺个会即兴发挥的脑袋，你帮我挑一个？',
        'One last thing! The lines are memorized, but I still need a brain that can ad-lib. Pick one for me?',
        '最後にひとつ！台詞は覚えたけど、アドリブのきく頭がまだないの。選んでくれる？',
      ),
    },
    choices: [
      {
        id: 'brain_webllm',
        icon: '⚡',
        badge: L('开箱即用', 'Ready to go', 'すぐ使える'),
        text: L('本地端侧大脑 (WebLLM)', 'On-device brain (WebLLM)', 'ローカル脳 (WebLLM)'),
        subText: L(
          '在本机显卡运行，无需 API Key，隐私不离机；以后可在右上角更换',
          'Runs on this device, no API key, nothing leaves your machine; change it later at the top right',
          '端末内で動作、APIキー不要、データは外に出ない。あとで右上から変更できる',
        ),
        actionType: 'custom',
        actionPayload: async () => {
          try {
            const { setActiveProviderId } = await import('@/llm/customProvider');
            const { preloadWebLLM } = await import('@/llm/webLLMProvider');
            await setActiveProviderId(null);
            preloadWebLLM({ warmup: true });
          } catch (err) {
            console.warn('[Prologue] on-device brain setup skipped:', err);
          }
        },
        nextBeatId: 'beat_6',
      },
      {
        id: 'brain_custom',
        icon: '🖥️',
        badge: L('高级扩展', 'Advanced', '上級'),
        text: L('自定义外部模型 (API / 本地)', 'Custom model (API / local)', 'カスタムモデル (API / ローカル)'),
        subText: L(
          '接入 OpenAI、Claude 或本地 Ollama，解锁更强的推理与创意',
          'Plug in OpenAI, Claude or a local Ollama for stronger reasoning and creativity',
          'OpenAI・Claude・ローカルOllamaにつないで、より強力な推論と創造性を',
        ),
        actionType: 'open_provider_config',
        nextBeatId: 'beat_6',
      },
    ],
  },

  // ═══ 6 · 剧本杀青 (沿用第 5 拍的场景 / BGM；说完 300ms 后结束序章 → 镜头回到默认视角 → 自由聊天) ═══
  beat_6: {
    id: 'beat_6',
    cinematics: { transition: 'eye_blink', grading: 'default', wind: 1 },
    camera: { shot: 'full', movement: 'none', durationSec: 2.0 }, // 全身：看她把台本一丢、蹦起来
    actor: {
      leadInMotion: 'joyfulJump', // 把藏在身后的台本随手一丢，拍拍手
      expression: { base: 'playful', intensity: 0.7 },
      speechText: L(
        '行啦，那些死板的台词本我全扔了。现在开始没有剧本，你想跟我聊点什么？',
        "Alright, I tossed that stiff script out the window. No more rehearsals from here on—what's on your mind?",
        'よし、堅苦しい台本はもうポイしちゃった！ここからは台本なし、何から話す？',
      ),
    },
    audio: { sfx: [{ id: 'bell', delaySec: 0.2, volume: 0.6 }] },
    autoFinish: true,
    autoNextDelayMs: 300,
  },
};

export const prologueStory: StoryScript = {
  id: 'prologue_awakening',
  title: L('序章·初遇小蠢', 'Prologue: Meeting XiaoChun', '序章・小蠢との出会い'),
  description: L(
    '你提前进了场，撞见小蠢正对着空气排练一套做作的女神欢迎词。',
    'You walk in early and catch XiaoChun rehearsing an absurdly cheesy goddess welcome speech to thin air.',
    '早く来てしまったあなたは、小蠢が誰もいない空間に向かって大げさな女神の挨拶を練習しているところを目撃する。',
  ),
  initialBeatId: 'beat_greet',
  startLang: 'browser',
  beats,
};
