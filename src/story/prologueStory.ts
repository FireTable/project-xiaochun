import type { StoryScript } from './schema';
import { vrmEngine } from '@/core/vrmEngine';

/**
 * 序章·虚空初醒 (Story 0: Prologue)
 * 沉浸式新手引导的高维升阶剧本：
 * 融合黑幕白字、眼睑睁开 (POV Eye Blink)、电影机位推拉、活体表情与纯透晶体卡片。
 */
export const prologueStory: StoryScript = {
  id: 'prologue_awakening',
  title: '序章·虚空初醒',
  description: '与小蠢的初次相遇，探索 3D 空间、随心换装与心仪世界。',
  initialBeatId: 'beat_greet',
  beats: {
    // 0. 前置黑幕白字与唤醒握手 (解锁移动端 Web Audio)
    beat_greet: {
      id: 'beat_greet',
      cinematics: {
        letterbox: true,
        transition: 'eye_blink',
        intertitle: {
          text: '……在虚空的彼端，沉睡的意识听到了微弱的呼唤。',
          durationSec: 2.2,
          style: 'noto_serif',
          bgmFaded: true,
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
          text: '诶？你是？',
          subText: '向眼前初醒的少女打个招呼吧',
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
        speechText: '呀！……你好呀，初次见面，我是小蠢～那个……你来自哪里呀？我该用哪种语言跟你聊天呢？',
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

    // 2. 教程抉择 (拉回中景，小蠢双手后背温婉倾听)
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
        motion: 'listening',
        expression: {
          base: 'gentle_smile',
          intensity: 0.7,
          microReaction: 'eye_crinkle',
        },
        speechText: '好呀！以后的日子请多关照啦～需要我带你熟悉一下这片空间吗？',
      },
      choices: [
        {
          id: 'start_tut',
          icon: '✨',
          text: '请带我了解一下这片空间',
          subText: '探索视角转动、随心换装与心仪场景',
          actionType: 'next_beat',
          nextBeatId: 'beat_camera_intro',
        },
        {
          id: 'skip_tut',
          icon: '💬',
          text: '不用啦，已经迫不及待想跟你聊天了！',
          subText: '直接进入主界面，开启日常畅聊',
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
        speechText: '在这片空间里，你可以从各种视角看我哦～试着用鼠标或触摸滑动屏幕，看看全方位的我吧！',
      },
      choices: [
        {
          id: 'camera_done',
          icon: '🎉',
          text: '我已大致掌握，前往下一步',
          subText: '视角操作已掌握，进入场景探索',
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
        motion: 'listening',
        expression: {
          base: 'playful',
          intensity: 0.8,
          microReaction: 'none',
        },
        speechText: '现在这片空间空荡荡的，只有我们两个人呢……你更喜欢去哪？不管是阳光海滩，还是线稿世界，我都可以陪你一起去！',
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
        speechText: '看！我还准备了好多不同风格的衣服呢～挑选一套你最喜欢的让我换上吧！',
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
        text: '确定这套穿搭，前往下一步',
        subText: '换装完成，探索小蠢的 AI 大脑',
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
        leadInMotion: 'attentive-lean',
        expression: {
          base: 'playful',
          intensity: 0.8,
          microReaction: 'eye_crinkle',
        },
        speechText: '最后一步啦，来为我挑选一个大语言模型吧～你想用什么模型跟我对话呢？',
      },
      choices: [
        {
          id: 'brain_webllm',
          icon: '⚡',
          badge: '开箱即用',
          text: '浏览器内置模型 (WebLLM)',
          subText: '直接在本地浏览器显卡运行，无需任何配置，数据私密安全',
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

    // 6. 终章启程 (电影遮幅滑出，晨曦破晓，优雅致谢)
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
        speechText: '太棒啦！这下所有的准备工作都完成啦～从现在开始，我就在这里一直陪着你。有什么想聊的，随时都可以跟我说哦！',
      },
      allowInput: true,
      inputPlaceholder: '回复小蠢，或点击按钮开始旅程...',
      choices: [
        {
          id: 'start_journey',
          icon: '🚀',
          text: '开始我们俩的旅程吧！',
          subText: '开启全新沉浸式伴侣体验',
          actionType: 'finish',
        },
      ],
    },
  },
};
