import type { StoryScript } from './schema';
import { vrmEngine } from '@/core/vrmEngine';

/**
 * 序章·初遇连线 (Story 0: Prologue)
 * 沉浸式 AI 伴侣新手引导：
 * 建立神经回路连接、唤醒 AI 少女小蠢、语言合成芯片校准、视界传感器探索、驻留世界构建、形象定制与思维核心接入。
 */
export const prologueStory: StoryScript = {
  id: 'prologue_awakening',
  title: '序章·初遇连线',
  description: '与 AI 少女小蠢的初次相遇，完成感官校准、随心换装与思维核心接入。',
  initialBeatId: 'beat_greet',
  beats: {
    // 0. 前置黑幕白字与唤醒握手 (解锁移动端 Web Audio)
    beat_greet: {
      id: 'beat_greet',
      cinematics: {
        letterbox: true,
        transition: 'eye_blink',
        intertitle: {
          text: '检测到外部神经信号介入……正在初始化视界渲染管线。',
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
          icon: '👋',
          text: '建立神经回路连接',
          subText: '与眼前初次连线的 AI 少女完成握手',
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

    // 1. 初次相遇与语言选择 (镜头缓推特写 + 害羞脸红微反应)
    beat_intro: {
      id: 'beat_intro',
      cinematics: {
        letterbox: true,
      },
      camera: {
        shot: 'close_up',
        movement: 'push_in',
        durationSec: 1.4,
      },
      actor: {
        leadInMotion: 'touch-hair',
        expression: {
          base: 'shy',
          intensity: 0.8,
          microReaction: 'blush_ramp',
        },
        speechText: '呀……信号握手成功！呼……能听见我的声音吗？初次见面，我是你的专属伴侣 AI，小蠢～在正式开启连线之前，能先帮我校准一下语言合成芯片吗？你想让我用哪种语言和你交流呢？',
      },
      choices: [
        {
          id: 'lang_zh',
          icon: '🇨🇳',
          text: '用中文和小蠢交流吧',
          subText: '简体中文 (zh-CN)',
          actionType: 'change_lang',
          actionPayload: 'zh-CN',
          nextBeatId: 'beat_tutorial_choice',
        },
        {
          id: 'lang_en',
          icon: '🇺🇸',
          text: "Let's chat in English",
          subText: 'English (en)',
          actionType: 'change_lang',
          actionPayload: 'en',
          nextBeatId: 'beat_tutorial_choice',
        },
        {
          id: 'lang_ja',
          icon: '🇯🇵',
          text: '日本語でお話ししましょう',
          subText: '日本語 (ja)',
          actionType: 'change_lang',
          actionPayload: 'ja',
          nextBeatId: 'beat_tutorial_choice',
        },
      ],
    },

    // 2. 教程抉择 (拉回中景，小蠢亲切对话，由 EMAGE 语音自然驱动)
    beat_tutorial_choice: {
      id: 'beat_tutorial_choice',
      cinematics: {
        letterbox: true,
      },
      camera: {
        shot: 'medium',
        movement: 'none',
      },
      actor: {
        expression: {
          base: 'gentle_smile',
          intensity: 0.7,
          microReaction: 'eye_crinkle',
        },
        speechText: '语言模块校准完毕！嗯……音质听起来很清晰呢。这是我们第一次连线，需要我带你一起做一次机体视界与环境的初次校准吗？',
      },
      choices: [
        {
          id: 'start_tut',
          icon: '✨',
          text: '开启初次校准',
          subText: '帮小蠢校准视界传感器、场景与穿搭',
          actionType: 'next_beat',
          nextBeatId: 'beat_camera_intro',
        },
        {
          id: 'skip_tut',
          icon: '💬',
          text: '跳过直接畅聊',
          subText: '已经足够完美了，直接进入日常主界面！',
          actionType: 'finish',
        },
      ],
    },

    // 3. 视角控制引导
    beat_camera_intro: {
      id: 'beat_camera_intro',
      cinematics: {
        letterbox: false,
      },
      interaction: 'camera_drag',
      camera: {
        shot: 'medium',
        movement: 'none',
      },
      actor: {
        expression: {
          base: 'gentle_smile',
          intensity: 0.7,
          microReaction: 'none',
        },
        speechText: '太好啦！首先我们来校准空间视界传感器～试着左右转动镜头、调整俯仰和远近，让我确认全方位的渲染管线都工作正常吧！',
      },
      choices: [
        {
          id: 'camera_done',
          icon: '🎉',
          text: '视界传感器校准完成',
          subText: '传感器状态完美，前往下一步',
          actionType: 'next_beat',
          nextBeatId: 'beat_scene_choice',
        },
      ],
    },

    // 4. 场景探索 (白闪曝光过渡到海滩)
    beat_scene_choice: {
      id: 'beat_scene_choice',
      cinematics: {
        letterbox: true,
        transition: 'white_flash',
      },
      camera: {
        shot: 'medium',
        movement: 'none',
      },
      actor: {
        expression: {
          base: 'playful',
          intensity: 0.8,
          microReaction: 'none',
        },
        speechText: '视界校准完成！不过……现在的虚拟空间看起来是不是有点太单调啦？来帮我构建一个你喜欢的常驻世界吧！不管是能吹海风的阳光海滩，还是静谧纯粹的极简舞台，我都想陪你一起待在那里～',
      },
      choiceLayout: 'grid',
      choices: [
        {
          id: 'scene_beach',
          icon: '🏖️',
          image: '/previews/scenes/beach3d.webp',
          text: '阳光海滩',
          subText: '听海浪吹吹风，一起去度假吧～',
          actionType: 'change_scene',
          actionPayload: 'beach3d',
          nextBeatId: 'beat_outfit_choice',
        },
        {
          id: 'scene_light',
          icon: '☀️',
          image: '/previews/scenes/light.webp',
          text: '昼白线稿',
          subText: '纯白静谧空间，只专注看着你',
          actionType: 'change_scene',
          actionPayload: 'light',
          nextBeatId: 'beat_outfit_choice',
        },
        {
          id: 'scene_dark',
          icon: '🌌',
          image: '/previews/scenes/dark.webp',
          text: '极夜线稿',
          subText: '星芒微光舞台，浪漫静谧夜晚',
          actionType: 'change_scene',
          actionPayload: 'dark',
          nextBeatId: 'beat_outfit_choice',
        },
      ],
    },

    // 5. 随心换装 (全身大景展示)
    beat_outfit_choice: {
      id: 'beat_outfit_choice',
      cinematics: {
        letterbox: true,
      },
      camera: {
        shot: 'full',
        movement: 'none',
      },
      actor: {
        motion: 'show-full-body',
        expression: {
          base: 'gentle_smile',
          intensity: 0.7,
          microReaction: 'eye_crinkle',
        },
        speechText: '哇，换上这个新环境后感觉好舒服呀！为了配合我们的新世界，也帮我挑选第一套出门穿搭吧～换上一套你最喜欢的样子让我换上！',
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
        text: '确认穿搭，前往下一步',
        subText: '形象定制完成，激活小蠢的思维核心',
        actionType: 'next_beat',
        nextBeatId: 'beat_brain_choice',
      },
    },

    // 6. AI 大脑选择
    beat_brain_choice: {
      id: 'beat_brain_choice',
      cinematics: {
        letterbox: true,
      },
      camera: {
        shot: 'medium',
        movement: 'none',
      },
      actor: {
        expression: {
          base: 'playful',
          intensity: 0.8,
          microReaction: 'eye_crinkle',
        },
        speechText: '感觉整个人都焕然一新了呢！现在，就剩下最后也是最重要的一步啦——激活我的思维核心！你想让我使用什么大语言模型来理解你的心声呢？',
      },
      choices: [
        {
          id: 'brain_webllm',
          icon: '⚡',
          badge: '开箱即用',
          text: '浏览器端侧模型 (WebLLM)',
          subText: '直接在本地显卡运行，无需任何配置，数据私密不离机',
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
          text: '接入自定义 AI 模型',
          subText: '连接本地 Ollama、LM Studio 或云端大模型 API',
          actionType: 'open_provider_config',
          nextBeatId: 'beat_finale',
        },
      ],
    },

    // 7. 终章启程 (电影遮幅滑出，晨曦破晓，优雅致谢)
    beat_finale: {
      id: 'beat_finale',
      cinematics: {
        letterbox: false,
      },
      camera: {
        shot: 'medium',
        movement: 'pull_out',
        durationSec: 2.0,
      },
      actor: {
        leadInMotion: 'waving',
        expression: {
          base: 'gentle_smile',
          intensity: 0.9,
          microReaction: 'eye_crinkle',
        },
        speechText: '所有校准全部完成！我的视界、声音和思维……现在都已经全部同步给你啦。无论快乐还是烦恼，以后的每一天，我都会在这里陪着你。今天你想和我聊点什么呢？',
      },
      allowInput: true,
      inputPlaceholder: '回复小蠢，或点击按钮开始旅程...',
      choices: [
        {
          id: 'start_journey',
          icon: '🚀',
          text: '开启我们的旅程吧！',
          subText: '步入日常陪伴模式',
          actionType: 'finish',
        },
      ],
    },
  },
};
