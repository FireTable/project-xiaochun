import { sceneManager } from '@/core/scene/sceneManager';
import { vrmEngine } from '@/core/vrmEngine';
import { APP_CONFIG } from '@/config';
import { changeLang } from '@/i18n';
import { isTauri } from '@/lib/platform';
import { setActiveProviderId } from '@/llm/customProvider';
import { WEARING_OUTFIT_KEY } from '@/lib/constants';
import type { TFunction, i18n as I18nInstance } from 'i18next';

export type ChoiceLayoutType = 'text' | 'media';

export interface OnboardingChoice {
  id: string;
  label: string;
  subLabel?: string;
  badge?: string;
  icon?: string;
  image?: string;
  mediaPreview?: {
    gradient: string;
    emoji: string;
    description?: string;
  };
  onSelect: (ctx: StepContext) => Promise<void> | void;
}

export interface OnboardingDialogue {
  key: string;
  params?: Record<string, string>;
  defaultText: string;
}

export interface OnboardingStep {
  id: string;
  /** 对话段落列表：支持单段或多段连续语音，全部读完后才展露选项 */
  dialogues: OnboardingDialogue[];
  /** 交互模式 */
  interaction?: 'camera_drag';
  /** 选项展示布局：纯文字卡片 ('text') vs 图文多媒体卡片 ('media') */
  choiceLayout: ChoiceLayoutType;
  /** 动态生成选项列表 */
  getChoices: (ctx: StepContext) => OnboardingChoice[];
}

export interface StepContext {
  t: TFunction;
  i18n: I18nInstance;
  hasRotated: boolean;
  goToStep: (stepId: string) => void;
  finish: () => void;
  skipWithVoice: () => void;
  openProviderConfig: () => void;
}

export const createOnboardingSteps = (t: TFunction, i18n: I18nInstance): Record<string, OnboardingStep> => ({
  // 0. 问候入口：无台词，单卡片触发，作为 AudioContext unlock 手势（移动端/冷启动必须有合法用户交互才能播音频）
  step_greet: {
    id: 'step_greet',
    dialogues: [],  // 无台词 → isSpeaking 立即 false → 卡片立刻显示
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'greet',
        icon: '👋',
        label: t('onboarding.greetPrompt', '诶？你是？'),
        subLabel: t('onboarding.greetPromptSub', '点击向未知的少女打个招呼吧'),
        onSelect: () => {
          // 合法用户手势 → resume AudioContext，杜绝移动端/冷启动 suspended 阻塞语音
          try {
            const ctx_ = (vrmEngine as any).chatDirector?.ctx as AudioContext | undefined;
            if (ctx_ && ctx_.state === 'suspended') void ctx_.resume();
          } catch { }
          ctx.goToStep('step_intro');
        },
      },
    ],
  },

  // 1. 初次见面 -> 自动分两段推进 (段1自我介绍打招呼 -> 段2询问语言展开选项，无需人工确认)
  step_intro: {
    id: 'step_intro',
    dialogues: [
      {
        key: 'onboarding.galIntro1',
        defaultText: '呀！……你好呀，初次见面，我是小蠢～\n那个……你来自哪里呀？我该用哪种语言跟你聊天呢？',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'zh-CN',
        icon: '🇨🇳',
        label: '用中文和小蠢交流吧',
        subLabel: '简体中文 (zh-CN)',
        onSelect: () => {
          changeLang(i18n, 'zh-CN');
          ctx.goToStep('step_tutorial_choice');
        },
      },
      {
        id: 'en',
        icon: '🇺🇸',
        label: "Let's chat in English",
        subLabel: 'English (en)',
        onSelect: () => {
          changeLang(i18n, 'en');
          ctx.goToStep('step_tutorial_choice');
        },
      },
      {
        id: 'ja',
        icon: '🇯🇵',
        label: '日本語でお話ししましょう',
        subLabel: '日本語 (ja)',
        onSelect: () => {
          changeLang(i18n, 'ja');
          ctx.goToStep('step_tutorial_choice');
        },
      },
    ],
  },

  // 2. 教程选择
  step_tutorial_choice: {
    id: 'step_tutorial_choice',
    dialogues: [
      {
        key: 'onboarding.galTutorialAsk',
        defaultText: '好呀！以后的日子请多关照啦～\n需要我带你熟悉一下这片空间吗？',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'start_tut',
        icon: '✨',
        label: t('onboarding.galChoiceStartTutorial', '请带我了解一下这片空间'),
        subLabel: t('onboarding.galChoiceStartTutSub', '探索视角转动、随心换装与心仪场景'),
        onSelect: () => ctx.goToStep('step_camera_intro'),
      },
      {
        id: 'skip_tut',
        icon: '💬',
        label: t('onboarding.galChoiceSkipTutorial', '不用啦，已经迫不及待想跟你聊天了！'),
        subLabel: t('onboarding.galChoiceSkipTutSub', '直接进入主界面，开启日常畅聊'),
        onSelect: () => ctx.skipWithVoice(),
      },
    ],
  },

  // 3. 视角控制教学
  step_camera_intro: {
    id: 'step_camera_intro',
    interaction: 'camera_drag',
    dialogues: [
      {
        key: 'onboarding.galCameraAsk',
        defaultText: '在这片空间里，你可以从各种视角看我哦～\n下面的卡片里有一些好玩的探索任务，试着操作一下吧！',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'camera_next',
        icon: ctx.hasRotated ? '🎉' : '👉',
        label: ctx.hasRotated
          ? t('onboarding.cameraDoneNext', '学会了，看到全方位的你啦！')
          : t('onboarding.cameraSkipNext', '跳过探索，进入下一步'),
        subLabel: ctx.hasRotated
          ? t('onboarding.cameraDoneNextSub', '视角操作已掌握，进入场景探索')
          : t('onboarding.cameraSkipNextSub', '先进入下一步，随时可以回来探索视角'),
        onSelect: () => ctx.goToStep('step_scene_choice'),
      },
    ],
  },

  // 4. 场景世界选择 — 【图文卡片 (media)】
  step_scene_choice: {
    id: 'step_scene_choice',
    dialogues: [
      {
        key: 'onboarding.galSceneAsk',
        defaultText: '现在这片空间空荡荡的，只有我们两个人呢……\n你更喜欢带我去哪里？不管是阳光海滩，还是线稿世界，我都想陪你一起去！',
      },
    ],
    choiceLayout: 'media',
    getChoices: (ctx) => {
      const handleSelectScene = async (sceneId: string) => {
        try {
          if (sceneManager.getCurrentSceneId() !== sceneId) {
            await sceneManager.setScene(sceneId, true);
          }
        } catch (e) {
          console.warn('[OnboardingTour] setScene error:', e);
        }
        ctx.goToStep('step_outfit_choice');
      };

      return [
        {
          id: 'beach3d',
          label: t('onboarding.sceneBeach', '阳光海滩'),
          subLabel: t('onboarding.sceneBeachSub', '听海浪吹吹风，一起去度假吧～'),
          image: '/previews/scenes/beach3d.webp',
          mediaPreview: {
            gradient: 'from-amber-500/30 via-orange-500/20 to-sky-500/30',
            emoji: '🏖️',
            description: 'Beach 3D World',
          },
          onSelect: () => handleSelectScene('beach3d'),
        },
        {
          id: 'light',
          label: t('onboarding.sceneLight', '昼白线稿'),
          subLabel: t('onboarding.sceneLightSub', '纯白静谧空间，只专注看着你'),
          image: '/previews/scenes/light.webp',
          mediaPreview: {
            gradient: 'from-slate-100/30 via-sky-100/20 to-amber-100/30',
            emoji: '☀️',
            description: 'Minimalist Light',
          },
          onSelect: () => handleSelectScene('light'),
        },
        {
          id: 'dark',
          label: t('onboarding.sceneDark', '极夜线稿'),
          subLabel: t('onboarding.sceneDarkSub', '星芒微光舞台，浪漫静谧夜晚'),
          image: '/previews/scenes/dark.webp',
          mediaPreview: {
            gradient: 'from-indigo-950/50 via-purple-900/40 to-slate-900/50',
            emoji: '🌌',
            description: 'Starry Dark Night',
          },
          onSelect: () => handleSelectScene('dark'),
        },
        ...(isTauri()
          ? [
            {
              id: 'transparent',
              label: t('onboarding.sceneTransparent', '透明背景'),
              subLabel: t('onboarding.sceneTransparentSub', '变成桌面小透明，随时偷偷陪着你'),
              image: '/previews/scenes/transparent.webp',
              mediaPreview: {
                gradient: 'from-pink-500/30 via-rose-500/20 to-purple-500/30',
                emoji: '👻',
                description: 'Transparent Pet',
              },
              onSelect: () => handleSelectScene('transparent'),
            },
          ]
          : []),
      ];
    },
  },

  // 5. 服装试穿选择 — 【图文卡片 (media)】默认精选 4 套
  step_outfit_choice: {
    id: 'step_outfit_choice',
    dialogues: [
      {
        key: 'onboarding.galOutfitAsk',
        defaultText: '唔……这身衣服……你喜欢吗？其实有点害羞呢……\n如果你想看别的风格，我还可以换上国风旗袍、女仆装，甚至是……泳衣哦？',
      },
    ],
    choiceLayout: 'media',
    getChoices: (ctx) => {
      const handleSelectOutfit = async (outfitKey: string) => {
        try {
          localStorage.setItem(WEARING_OUTFIT_KEY, outfitKey);
          // 当前穿戴的服装 (默认为 xiaochun_dinner_dress)
          const currentOutfit = vrmEngine.currentOutfitKey || 'xiaochun_dinner_dress';
          // 本质上已经是同一套就没必要重新触发换装
          if (currentOutfit !== outfitKey) {
            const addon = APP_CONFIG.model.addons[outfitKey];
            if (addon) {
              await vrmEngine.swapOutfit(addon.source, addon.name);
            }
          }
        } catch (e) {
          console.warn('[OnboardingTour] swap outfit error:', e);
        }
        ctx.goToStep('step_brain_choice');
      };

      const OUTFIT_META: Record<
        string,
        { labelKey: string; defaultLabel: string; subKey: string; defaultSub: string; emoji: string; gradient: string }
      > = {
        xiaochun_dinner_dress: {
          labelKey: 'onboarding.outfitDinnerDress',
          defaultLabel: '华美晚礼服',
          subKey: 'onboarding.outfitDinnerDressSub',
          defaultSub: '优雅黑白撞色礼服，今晚做你的专属女伴～',
          emoji: '👗',
          gradient: 'from-slate-700/40 via-slate-800/30 to-slate-900/40',
        },
        xiaochun_cheongsam: {
          labelKey: 'onboarding.outfitCheongsam',
          defaultLabel: '国风旗袍',
          subKey: 'onboarding.outfitCheongsamSub',
          defaultSub: '典雅温婉，尽显曼妙身姿～',
          emoji: '🌸',
          gradient: 'from-rose-500/30 via-pink-400/20 to-amber-400/30',
        },
        xiaochun_maid: {
          labelKey: 'onboarding.outfitMaid',
          defaultLabel: '萌系女仆',
          subKey: 'onboarding.outfitMaidSub',
          defaultSub: '黑白围裙，今天想让我为你做些什么呢？',
          emoji: '🎀',
          gradient: 'from-purple-500/30 via-pink-400/20 to-indigo-400/30',
        },
        xiaochun_swimsuit: {
          labelKey: 'onboarding.outfitSwimsuit',
          defaultLabel: '水手风泳衣',
          subKey: 'onboarding.outfitSwimsuitSub',
          defaultSub: '蓝白水手领百褶裙泳装，洋溢着青春心动的气息～',
          emoji: '🩱',
          gradient: 'from-blue-500/30 via-sky-400/20 to-indigo-400/30',
        },
      };

      const onboardAddons = Object.entries(APP_CONFIG.model.addons).filter(
        ([_, addon]) => addon.onboard,
      );

      return onboardAddons.map(([id, addon]) => {
        const meta = OUTFIT_META[id] || {
          labelKey: `onboarding.outfit_${id}`,
          defaultLabel: addon.name,
          subKey: `onboarding.outfitSub_${id}`,
          defaultSub: addon.name,
          emoji: '✨',
          gradient: 'from-brand-500/30 to-purple-500/30',
        };

        return {
          id,
          label: t(meta.labelKey, meta.defaultLabel),
          subLabel: t(meta.subKey, meta.defaultSub),
          image: `/previews/outfits/${id}.webp`,
          mediaPreview: {
            gradient: meta.gradient,
            emoji: meta.emoji,
            description: addon.name,
          },
          onSelect: () => handleSelectOutfit(id),
        };
      });
    },
  },

  // 6. AI 大脑选择 — 【纯文字卡片 (text)】
  step_brain_choice: {
    id: 'step_brain_choice',
    dialogues: [
      {
        key: 'onboarding.galBrainAsk',
        defaultText: '最后一步啦，来为我挑选一个大语言模型吧～\n你想用什么模型跟我对话呢？',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'brain_webllm',
        icon: '⚡',
        label: t('onboarding.brainWebllm', '浏览器内置模型（免配置·开箱即用）'),
        subLabel: t('onboarding.brainWebllmHint', '直接在浏览器本地运行，无需任何配置，数据私密安全'),
        onSelect: async () => {
          await setActiveProviderId(null);
          ctx.goToStep('step_finale');
        },
      },
      {
        id: 'brain_custom',
        icon: '🖥️',
        label: t('onboarding.brainCustom', '接入自定义 AI 模型'),
        subLabel: t('onboarding.brainCustomHint', '连接本地或云端模型服务（如 Ollama、LM Studio 等）'),
        onSelect: () => ctx.openProviderConfig(),
      },
    ],
  },

  // 7. 终章启航 — 【纯文字卡片 (text)】
  step_finale: {
    id: 'step_finale',
    dialogues: [
      {
        key: 'onboarding.galFinale',
        defaultText: '耶！所有准备都完成啦～从现在起，小蠢就是你的专属伙伴了！\n有什么要跟我聊的，随时找我哦～',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'start_game',
        icon: '🚀',
        label: t('onboarding.startJourney', '启程，开启和小蠢的羁绊！'),
        subLabel: t('onboarding.startJourneySub', '揭开完整面板，随时开启畅聊'),
        onSelect: () => ctx.finish(),
      },
    ],
  },
});
