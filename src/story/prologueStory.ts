import type { StoryScript } from './schema';
import { vrmEngine } from '@/core/vrmEngine';

/**
 * 序章·初遇之约 (Story 0: Prologue)
 * 沉浸式 3D AI 伴侣新手相遇物语：
 * 轻触唤醒、初遇问候、语言选择、视角转动环绕、常驻世界挑选、形象随心换装、伴侣大脑接入与终章启程。
 */
export const prologueStory: StoryScript = {
  id: 'prologue_awakening',
  title: '序章·初遇之约',
  description: '与 3D AI 少女小蠢的初次相遇，探索立体视界、随心换装与开启日常陪伴。',
  initialBeatId: 'beat_greet',
  beats: {
    // 0. 前置黑幕与轻触唤醒 (解锁移动端 Web Audio)
    beat_greet: {
      id: 'beat_greet',
      cinematics: {
        letterbox: true,
        transition: 'eye_blink',
        intertitle: {
          text: '……嘘。能听到吗？\n轻触屏幕……把我唤醒吧。',
          durationSec: 0,
          style: 'noto_serif',
          bgmFaded: true,
          requireClick: true,
        },
      },
      camera: {
        shot: 'medium',
        movement: 'push_in',
        durationSec: 1.5,
      },
      actor: {
        expression: {
          base: 'gentle_smile',
          intensity: 0.6,
          microReaction: 'none',
        },
        speechText: '', // 无台词，等待用户点击问候以解锁 AudioContext
      },
      choices: [
        {
          id: 'greet_unlock',
          icon: '✨',
          text: '轻触唤醒',
          subText: '唤醒初次相遇的小蠢',
          actionType: 'custom',
          actionPayload: () => {
            try {
              const ctx = (vrmEngine as any).chatDirector?.ctx as AudioContext | undefined;
              if (ctx && ctx.state === 'suspended') void ctx.resume();
            } catch { }
          },
          nextBeatId: 'beat_intro',
        },
      ],
    },

    // 1. 初次相遇与语言选择 (镜头缓推近景 + 害羞脸红微反应)
    beat_intro: {
      id: 'beat_intro',
      cinematics: {
        letterbox: true,
      },
      camera: {
        shot: 'close_up',
        movement: 'push_in',
        durationSec: 1.5,
      },
      actor: {
        leadInMotion: 'touch-hair',
        expression: {
          base: 'shy',
          intensity: 0.8,
          microReaction: 'blush_ramp',
        },
        speechText: '你真的来啦。初次见面，我是小蠢。从今天开始，就由我来陪你啦。对了，听这个声音还习惯吗？如果想换英文或者日文，随时告诉我。',
      },
      choices: [
        {
          id: 'lang_zh',
          icon: '🇨🇳',
          text: '用中文和小蠢交流',
          subText: '开启中文日常交流',
          actionType: 'change_lang',
          actionPayload: 'zh-CN',
          nextBeatId: 'beat_tutorial_choice',
        },
        {
          id: 'lang_en',
          icon: '🇺🇸',
          text: "Let's chat in English",
          subText: "Chat with XiaoChun in English",
          actionType: 'change_lang',
          actionPayload: 'en',
          nextBeatId: 'beat_tutorial_choice',
        },
        {
          id: 'lang_ja',
          icon: '🇯🇵',
          text: '日本語でお話ししましょう',
          subText: '日本語で楽しくおしゃべり',
          actionType: 'change_lang',
          actionPayload: 'ja',
          nextBeatId: 'beat_tutorial_choice',
        },
      ],
    },

    // 2. 教程抉择 (镜头微弧环绕，空间景深流动)
    beat_tutorial_choice: {
      id: 'beat_tutorial_choice',
      cinematics: {
        letterbox: true,
      },
      camera: {
        shot: 'medium',
        movement: 'orbit_subtle',
        orbitAngleDeg: 18,
        durationSec: 1.6,
      },
      actor: {
        leadInMotion: 'listening',
        expression: {
          base: 'gentle_smile',
          intensity: 0.7,
          microReaction: 'eye_crinkle',
        },
        speechText: '要不要让我带你熟悉一下这里的交互方式？……当然，如果你想直接开始聊天，也可以随时跳过。',
      },
      choices: [
        {
          id: 'start_tut',
          icon: '✨',
          text: '带我熟悉一下',
          subText: '逛逛新空间、挑挑新衣服',
          actionType: 'next_beat',
          nextBeatId: 'beat_camera_intro',
        },
        {
          id: 'skip_tut',
          icon: '💬',
          text: '不用啦，直接开始聊',
          subText: '跳过新手引导，直接进入日常陪伴模式',
          actionType: 'finish',
        },
      ],
    },

    // 3. 视角控制引导 (镜头侧方弧度横摇演示 3D 环绕)
    beat_camera_intro: {
      id: 'beat_camera_intro',
      cinematics: {
        letterbox: false,
      },
      interaction: 'camera_drag',
      camera: {
        shot: 'medium',
        movement: 'arc_sweep',
        orbitAngleDeg: 40,
        durationSec: 2.2,
      },
      actor: {
        expression: {
          base: 'playful',
          intensity: 0.8,
          microReaction: 'eye_crinkle',
        },
        speechText: '试着滑一滑屏幕，转转视角、拉近一点看看？……欸，也别靠得太近，靠太近还是会有点不好意思的。',
      },
      choices: [
        {
          id: 'camera_done',
          icon: '🎉',
          text: '掌握得差不多了',
          subText: '转动很顺畅，视角已熟悉',
          actionType: 'next_beat',
          nextBeatId: 'beat_scene_choice',
        },
      ],
    },

    // 4. 场景探索 (全身大景拉远，留白展现宏大新世界)
    beat_scene_choice: {
      id: 'beat_scene_choice',
      cinematics: {
        letterbox: true,
        transition: 'white_flash',
      },
      camera: {
        shot: 'full',
        movement: 'pull_out',
        durationSec: 2.0,
      },
      actor: {
        expression: {
          base: 'gentle_smile',
          intensity: 0.8,
          microReaction: 'none',
        },
        speechText: '这里好像有点空荡荡的，我们换个新地方吧。你想去吹着海风的金色沙滩，还是静谧的线稿世界？挑一个你喜欢的，我们一起去。',
      },
      choiceLayout: 'grid',
      choices: [
        {
          id: 'scene_beach',
          icon: '🏖️',
          image: '/previews/scenes/beach3d.webp',
          text: '阳光海滩',
          subText: '听海浪与微风，看日出与晚霞',
          actionType: 'change_scene',
          actionPayload: 'beach3d',
          selected: true,
        },
        {
          id: 'scene_light',
          icon: '☀️',
          image: '/previews/scenes/light.webp',
          text: '昼白线稿',
          subText: '纯白静谧空间，只专注看着你',
          actionType: 'change_scene',
          actionPayload: 'light',
        },
        {
          id: 'scene_dark',
          icon: '🌌',
          image: '/previews/scenes/dark.webp',
          text: '极夜线稿',
          subText: '星芒微光舞台，浪漫静谧夜晚',
          actionType: 'change_scene',
          actionPayload: 'dark',
        },
      ],
      confirmChoice: {
        id: 'scene_confirm',
        icon: '✨',
        text: '就决定去这里了',
        subText: '确定常驻世界并挑选衣服',
        actionType: 'next_beat',
        nextBeatId: 'beat_outfit_choice',
      },
    },

    // 5. 随心换装 (全身模特级升镜打量新服饰搭配)
    beat_outfit_choice: {
      id: 'beat_outfit_choice',
      cinematics: {
        letterbox: true,
      },
      camera: {
        shot: 'full',
        movement: 'arc_sweep',
        orbitAngleDeg: -25,
        durationSec: 2.4,
      },
      actor: {
        motion: 'show-full-body',
        expression: {
          base: 'playful',
          intensity: 0.8,
          microReaction: 'eye_crinkle',
        },
        speechText: '换了新环境，也顺便帮我挑套新衣服吧。这几套平时我都挺喜欢的，你觉得哪一身最合适？挑好后告诉我就好。',
      },
      choiceLayout: 'grid',
      choices: [
        {
          id: 'outfit_dress',
          icon: '👗',
          image: '/previews/outfits/xiaochun_dinner_dress.webp',
          text: '优雅晚礼服',
          subText: '黑白双色轻奢长裙',
          actionType: 'swap_outfit',
          actionPayload: 'xiaochun_dinner_dress',
          selected: true,
        },
        {
          id: 'outfit_maid',
          icon: '☕',
          image: '/previews/outfits/xiaochun_maid.webp',
          text: '古典女仆装',
          subText: '黑白围裙荷叶边女仆装',
          actionType: 'swap_outfit',
          actionPayload: 'xiaochun_maid',
        },
        {
          id: 'outfit_qipao',
          icon: '🏮',
          image: '/previews/outfits/xiaochun_cheongsam.webp',
          text: '墨韵旗袍',
          subText: '中式典雅暗金刺绣旗袍',
          actionType: 'swap_outfit',
          actionPayload: 'xiaochun_cheongsam',
        },
      ],
      confirmChoice: {
        id: 'outfit_confirm',
        icon: '✨',
        text: '就决定是这身了',
        subText: '很适合你，准备迈出最后一步',
        actionType: 'next_beat',
        nextBeatId: 'beat_brain_choice',
      },
    },

    // 6. AI 大脑选择 (近景推近特写，眼神交汇期待)
    beat_brain_choice: {
      id: 'beat_brain_choice',
      cinematics: {
        letterbox: true,
      },
      camera: {
        shot: 'close_up',
        movement: 'push_in',
        durationSec: 1.5,
      },
      actor: {
        expression: {
          base: 'shy',
          intensity: 0.7,
          microReaction: 'avert_gaze',
        },
        speechText: '好看吗？……最后一步，帮我选一个适合你当前设备的大脑吧。不用担心配置，选开箱即用就能立刻开聊，以后在右上角随时可以调整。',
      },
      choices: [
        {
          id: 'brain_webllm',
          icon: '⚡',
          badge: '开箱即用',
          text: '本地端侧大脑 (WebLLM)',
          subText: '直接在本地显卡运行，无需任何 API Key，隐私安全不离机',
          actionType: 'custom',
          actionPayload: async () => {
            const { setActiveProviderId } = await import('@/llm/customProvider');
            const { preloadWebLLM } = await import('@/llm/webLLMProvider');
            await setActiveProviderId(null);
            preloadWebLLM({ warmup: true });
          },
          nextBeatId: 'beat_finale',
        },
        {
          id: 'brain_custom',
          icon: '🖥️',
          badge: '高级扩展',
          text: '自定义外部模型 (API / 本地)',
          subText: '接入 OpenAI、Claude 或本地 Ollama，解锁更强大的推理与创意',
          actionType: 'open_provider_config',
          nextBeatId: 'beat_finale',
        },
      ],
    },

    // 7. 终章启程 (★ 360° 英雄全景螺旋升空环绕 + 微风拂动 + 挥手告白)
    beat_finale: {
      id: 'beat_finale',
      cinematics: {
        letterbox: false,
      },
      camera: {
        shot: 'medium',
        movement: 'hero_spiral_orbit',
        durationSec: 3.2,
        windMultiplier: 1.5,
      },
      actor: {
        leadInMotion: 'waving',
        expression: {
          base: 'gentle_smile',
          intensity: 0.9,
          microReaction: 'eye_crinkle',
        },
        speechText: '这就全部准备好了。从现在开始，不管是清晨的一句早安，还是深夜睡不着时的闲聊，我都会在这里陪着你。……今天，想先和我聊点什么？',
      },
      choices: [
        {
          id: 'start_journey',
          icon: '🚀',
          text: '开启我们的日常吧',
          subText: '和小蠢开始第一句畅聊',
          actionType: 'finish',
        },
        {
          id: 'chat_first',
          icon: '💬',
          text: '今天心情特别好，来跟你打个招呼！',
          subText: '进入日常陪伴闲聊',
          actionType: 'finish',
        },
      ],
    },
  },
};
