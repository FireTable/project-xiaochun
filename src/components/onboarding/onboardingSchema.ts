import { sceneManager } from '@/core/scene/sceneManager';
import { vrmEngine } from '@/core/vrmEngine';
import { APP_CONFIG } from '@/config';
import { changeLang, type Lang } from '@/i18n';
import { isTauri } from '@/lib/platform';
import { setActiveProviderId } from '@/llm/customProvider';
import type { TFunction, i18n as I18nInstance } from 'i18next';

export type ChoiceLayoutType = 'text' | 'media';

export interface OnboardingChoice {
  id: string;
  label: string;
  subLabel?: string;
  badge?: string;
  mediaPreview?: {
    gradient: string;
    emoji: string;
    description?: string;
  };
  onSelect: (ctx: StepContext) => Promise<void> | void;
}

export interface OnboardingDialogue {
  key: string;
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
}

export const createOnboardingSteps = (t: TFunction, i18n: I18nInstance): Record<string, OnboardingStep> => ({
  // 1. 初次见面 -> 自动分两段推进 (段1自我介绍打招呼 -> 段2询问语言展开选项，无需人工确认)
  step_intro: {
    id: 'step_intro',
    dialogues: [
      {
        key: 'onboarding.galIntro1',
        defaultText: '你好呀！初次见面，我是小蠢～',
      },
      {
        key: 'onboarding.galIntro2',
        defaultText: '请问我们用哪种语言交流呢？',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'zh-CN',
        label: '用中文和小蠢交流吧',
        subLabel: '简体中文 (zh-CN)',
        onSelect: () => {
          changeLang(i18n, 'zh-CN');
          ctx.goToStep('step_tutorial_choice');
        },
      },
      {
        id: 'en',
        label: "Let's chat in English",
        subLabel: 'English (en)',
        onSelect: () => {
          changeLang(i18n, 'en');
          ctx.goToStep('step_tutorial_choice');
        },
      },
      {
        id: 'ja',
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
        defaultText: '太好啦！以后请多关照哦～需要带你了解一下小蠢的操作方式与各项功能吗？',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'start_tut',
        label: t('onboarding.galChoiceStartTutorial', '了解一下（开始新手教程）'),
        subLabel: '学习视角控制、场景穿梭与个性化换装',
        onSelect: () => ctx.goToStep('step_camera_intro'),
      },
      {
        id: 'skip_tut',
        label: t('onboarding.galChoiceSkipTutorial', '不用啦，直接开始日常（跳过教程）'),
        subLabel: '立即进入对话，随时可在右上角重温',
        onSelect: () => ctx.finish(),
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
        defaultText: '试着转动一下我吧！按住修饰键拖拽（手机长按拖动），可以从全方位看我哦～',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'camera_next',
        label: ctx.hasRotated
          ? t('onboarding.cameraDoneNext', '转动好啦，进入下一步！')
          : t('onboarding.cameraSkipNext', '学会啦，进入下一步'),
        onSelect: () => ctx.goToStep(ctx.hasRotated ? 'step_camera_done' : 'step_scene_choice'),
      },
    ],
  },

  // 4. 视角转动成功反馈
  step_camera_done: {
    id: 'step_camera_done',
    dialogues: [
      {
        key: 'onboarding.galCameraDone',
        defaultText: '哇，很熟练嘛！就是这样转动视角与镜头哦～',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'scene_next',
        label: t('onboarding.cameraExploreScene', '真棒！去看看不同的世界吧～'),
        onSelect: () => ctx.goToStep('step_scene_choice'),
      },
    ],
  },

  // 5. 场景世界选择 — 【图文卡片 (media)】
  step_scene_choice: {
    id: 'step_scene_choice',
    dialogues: [
      {
        key: 'onboarding.galSceneAsk',
        defaultText: '除了现在这个场景，我还可以住在不同的世界哦，你想去哪里看看？',
      },
    ],
    choiceLayout: 'media',
    getChoices: (ctx) => [
      {
        id: 'beach3d',
        label: '阳光沙滩',
        subLabel: '夏日海浪、沙滩与椰林实景',
        mediaPreview: {
          gradient: 'from-amber-500/30 via-orange-500/20 to-sky-500/30',
          emoji: '🏖️',
          description: 'Beach 3D World',
        },
        onSelect: async () => {
          await sceneManager.setScene('beach3d', true);
          ctx.goToStep('step_outfit_choice');
        },
      },
      {
        id: 'light',
        label: '极简昼白',
        subLabel: '纯白线稿空间，极简专注',
        mediaPreview: {
          gradient: 'from-slate-100/30 via-sky-100/20 to-amber-100/30',
          emoji: '☀️',
          description: 'Minimalist Light',
        },
        onSelect: async () => {
          await sceneManager.setScene('light', true);
          ctx.goToStep('step_outfit_choice');
        },
      },
      {
        id: 'dark',
        label: '极夜星空',
        subLabel: '黑夜与微光静谧舞台',
        mediaPreview: {
          gradient: 'from-indigo-950/50 via-purple-900/40 to-slate-900/50',
          emoji: '🌌',
          description: 'Starry Dark Night',
        },
        onSelect: async () => {
          await sceneManager.setScene('dark', true);
          ctx.goToStep('step_outfit_choice');
        },
      },
      ...(isTauri()
        ? [
            {
              id: 'transparent',
              label: '透明桌宠',
              subLabel: '无边框透明窗口，驻留桌面',
              mediaPreview: {
                gradient: 'from-pink-500/30 via-rose-500/20 to-purple-500/30',
                emoji: '👻',
                description: 'Transparent Pet',
              },
              onSelect: async () => {
                await sceneManager.setScene('transparent', true);
                ctx.goToStep('step_outfit_choice');
              },
            },
          ]
        : []),
    ],
  },

  // 6. 服装试穿选择 — 【图文卡片 (media)】
  step_outfit_choice: {
    id: 'step_outfit_choice',
    dialogues: [
      {
        key: 'onboarding.galOutfitAsk',
        defaultText: '我平时还可以换上不同风格的服装哦！你也可以随时把本地制作的 .vrm 模型文件拖进窗口让我换上～',
      },
    ],
    choiceLayout: 'media',
    getChoices: (ctx) => [
      ...Object.entries(APP_CONFIG.model.addons).map(([k, addon]) => {
        const isBikini = k.includes('bikini');
        const isCheongsam = k.includes('cheongsam');
        const emoji = isBikini ? '👙' : isCheongsam ? '🌸' : '⚡';
        const gradient = isBikini
          ? 'from-sky-400/30 via-teal-400/20 to-cyan-400/30'
          : isCheongsam
          ? 'from-rose-500/30 via-pink-400/20 to-amber-400/30'
          : 'from-purple-500/30 via-indigo-400/20 to-blue-400/30';

        return {
          id: k,
          label: addon.name.replace('XiaoChun ', ''),
          subLabel: '实时热换装体验',
          mediaPreview: {
            gradient,
            emoji,
            description: addon.name,
          },
          onSelect: async () => {
            await vrmEngine.swapOutfit(addon.source, addon.name);
            ctx.goToStep('step_brain_choice');
          },
        };
      }),
      {
        id: 'keep_outfit',
        label: '保持当前服装',
        subLabel: '随时可在右上角衣架换装',
        mediaPreview: {
          gradient: 'from-slate-700/40 via-slate-800/30 to-slate-900/40',
          emoji: '👗',
          description: 'Keep Current Outfit',
        },
        onSelect: () => ctx.goToStep('step_brain_choice'),
      },
    ],
  },

  // 7. AI 大脑选择 — 【纯文字卡片 (text)】
  step_brain_choice: {
    id: 'step_brain_choice',
    dialogues: [
      {
        key: 'onboarding.galBrainAsk',
        defaultText: '最后是我的“思考大脑”～你想先怎么和我聊天呢？',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'brain_webllm',
        label: '⚡ 端侧轻量模型（开箱即用，无需配置）',
        subLabel: '直接在浏览器内部运行，保护隐私且无需任何额外配置',
        onSelect: async () => {
          await setActiveProviderId(null);
          ctx.goToStep('step_finale');
        },
      },
      {
        id: 'brain_custom',
        label: '🖥️ 本地模型服务（Ollama / LM Studio）',
        subLabel: '连接本地运行的强大开源大模型',
        onSelect: () => ctx.goToStep('step_finale'),
      },
      {
        id: 'brain_default',
        label: '💬 稍后再配，先默认开聊',
        subLabel: '直接进入主界面体验',
        onSelect: () => ctx.goToStep('step_finale'),
      },
    ],
  },

  // 8. 终章启航 — 【纯文字卡片 (text)】
  step_finale: {
    id: 'step_finale',
    dialogues: [
      {
        key: 'onboarding.galFinale',
        defaultText: '耶！所有准备都就绪啦～有想对我说的话，随时在下面的对话框告诉我哦！',
      },
    ],
    choiceLayout: 'text',
    getChoices: (ctx) => [
      {
        id: 'start_game',
        label: '🚀 启程，开始与小蠢的日常！',
        subLabel: '揭幕完整界面，随时开启畅聊',
        onSelect: () => ctx.finish(),
      },
    ],
  },
});
