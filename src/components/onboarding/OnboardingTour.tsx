import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  ChevronRight,
  X,
  Check,
} from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { sceneManager } from '@/core/scene/sceneManager';
import { APP_CONFIG } from '@/config';
import { changeLang } from '@/i18n';
import { isTauri, getPrimaryModifierLabel, isMobile } from '@/lib/platform';
import { setActiveProviderId } from '@/llm/customProvider';

export const ONBOARDING_STORAGE_KEY = 'xc_onboarding_completed_v1';

interface OnboardingTourProps {
  onComplete: () => void;
}

type DialogueStage =
  | 'stage_wake' // 1. 觉醒初遇
  | 'stage_lang_choice' // 2. 语言选择
  | 'stage_lang_confirm' // 3. 语言确认台词
  | 'stage_tutorial_choice' // 4. 教程选择 (开始 vs 跳过)
  | 'stage_camera_intro' // 5. 视角旋转引导
  | 'stage_camera_done' // 6. 视角转动成功反馈
  | 'stage_scene_choice' // 7. 场景世界选择
  | 'stage_outfit_choice' // 8. 换装试穿选择
  | 'stage_brain_choice' // 9. AI 大脑选择
  | 'stage_finale'; // 10. 终章启航

interface GalChoice {
  id: string;
  label: string;
  subLabel?: string;
  onSelect: () => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ onComplete }) => {
  const { t, i18n } = useTranslation();
  const [stage, setStage] = useState<DialogueStage>('stage_wake');
  const [hasRotated, setHasRotated] = useState(false);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const isMobileDevice = isMobile();
  const modifierLabel = isMobileDevice ? t('onboarding.mobileHold', '长按') : getPrimaryModifierLabel();

  // 预热重资源 (EMAGE)
  useEffect(() => {
    try {
      vrmEngine.preloadHeavyResources(true);
    } catch {
      // ignore
    }
  }, []);

  // 监听玩家 3D 旋转操作 (阶段 5)
  useEffect(() => {
    if (stage !== 'stage_camera_intro') return;

    const unsub = vrmEngine.interaction.onStateChange((state) => {
      if (state.isDragging) {
        setHasRotated(true);
      }
    });

    return () => {
      unsub();
    };
  }, [stage]);

  const finishTour = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
    } catch {
      // ignore
    }
    onComplete();
  }, [onComplete]);

  // 当前阶段台词与选择分支
  const getStageContent = (): {
    text: string;
    choices?: GalChoice[];
    canClickNext?: boolean;
    onNext?: () => void;
  } => {
    switch (stage) {
      case 'stage_wake':
        return {
          text: t('onboarding.galWake', '……呼啊，能听到我的声音吗？'),
          canClickNext: true,
          onNext: () => setStage('stage_lang_choice'),
        };

      case 'stage_lang_choice':
        return {
          text: t('onboarding.galLangAsk', '初次见面，我是小蠢～请问我们用哪种语言交流呢？'),
          choices: [
            {
              id: 'zh-CN',
              label: '用中文和小蠢交流吧',
              subLabel: '简体中文 (zh-CN)',
              onSelect: () => {
                changeLang(i18n, 'zh-CN');
                setStage('stage_lang_confirm');
              },
            },
            {
              id: 'en',
              label: "Let's chat in English",
              subLabel: 'English (en)',
              onSelect: () => {
                changeLang(i18n, 'en');
                setStage('stage_lang_confirm');
              },
            },
            {
              id: 'ja',
              label: '日本語でお話ししましょう',
              subLabel: '日本語 (ja)',
              onSelect: () => {
                changeLang(i18n, 'ja');
                setStage('stage_lang_confirm');
              },
            },
          ],
        };

      case 'stage_lang_confirm':
        return {
          text: t('onboarding.galLangConfirmed', '太好啦！以后请多关照哦～能在这里遇见你真开心！'),
          canClickNext: true,
          onNext: () => setStage('stage_tutorial_choice'),
        };

      case 'stage_tutorial_choice':
        return {
          text: t('onboarding.galTutorialAsk', '初次见面，需要带你了解一下小蠢的操作方式与各项功能吗？'),
          choices: [
            {
              id: 'start_tut',
              label: t('onboarding.galChoiceStartTutorial', '了解一下（开始新手教程）'),
              subLabel: '学习视角控制、场景切换与个性化配置',
              onSelect: () => setStage('stage_camera_intro'),
            },
            {
              id: 'skip_tut',
              label: t('onboarding.galChoiceSkipTutorial', '不用啦，直接开始日常（跳过教程）'),
              subLabel: '立即进入对话，随时可在右上角重温',
              onSelect: finishTour,
            },
          ],
        };

      case 'stage_camera_intro':
        return {
          text: t(
            'onboarding.galCameraAsk',
            '试着转动一下我吧！按住修饰键拖拽（手机长按拖动），可以从全方位看我哦～',
          ),
          canClickNext: true,
          onNext: () => setStage(hasRotated ? 'stage_camera_done' : 'stage_scene_choice'),
        };

      case 'stage_camera_done':
        return {
          text: t('onboarding.galCameraDone', '哇，很熟练嘛！就是这样转动视角与镜头哦～'),
          canClickNext: true,
          onNext: () => setStage('stage_scene_choice'),
        };

      case 'stage_scene_choice':
        return {
          text: t('onboarding.galSceneAsk', '除了现在这个场景，我还可以住在不同的世界哦，你想去哪里看看？'),
          choices: [
            {
              id: 'beach3d',
              label: '阳光灿烂的海滩（海浪与落影）',
              subLabel: '阳光、沙滩与椰子树的夏日世界',
              onSelect: () => {
                void sceneManager.setScene('beach3d', true);
                setStage('stage_outfit_choice');
              },
            },
            {
              id: 'light',
              label: '纯净的极简世界（极简昼白）',
              subLabel: '纯白线稿空间，极简专注',
              onSelect: () => {
                void sceneManager.setScene('light', true);
                setStage('stage_outfit_choice');
              },
            },
            {
              id: 'dark',
              label: '静谧的极夜星空（极夜黑）',
              subLabel: '黑夜与微光舞台',
              onSelect: () => {
                void sceneManager.setScene('dark', true);
                setStage('stage_outfit_choice');
              },
            },
            ...(isTauri()
              ? [
                  {
                    id: 'transparent',
                    label: '透明桌宠模式（直接驻留在桌面）',
                    subLabel: '无背景窗口，像桌宠一样陪伴在你身边',
                    onSelect: () => {
                      void sceneManager.setScene('transparent', true);
                      setStage('stage_outfit_choice');
                    },
                  },
                ]
              : []),
          ],
        };

      case 'stage_outfit_choice':
        return {
          text: t(
            'onboarding.galOutfitAsk',
            '我平时还可以换上不同风格的服装哦！你也可以随时把本地制作的 .vrm 模型文件拖进窗口让我换上～',
          ),
          choices: [
            ...Object.entries(APP_CONFIG.model.addons).map(([k, addon]) => ({
              id: k,
              label: `试穿服装：${addon.name}`,
              subLabel: '实时热换装体验',
              onSelect: () => {
                void vrmEngine.swapOutfit(addon.source, addon.name);
                setStage('stage_brain_choice');
              },
            })),
            {
              id: 'keep_outfit',
              label: '保持当前服装，继续下一步',
              subLabel: '以后随时可以在右上角衣架换装',
              onSelect: () => setStage('stage_brain_choice'),
            },
          ],
        };

      case 'stage_brain_choice':
        return {
          text: t('onboarding.galBrainAsk', '最后是我的“思考大脑”～你想先怎么和我聊天呢？'),
          choices: [
            {
              id: 'brain_webllm',
              label: '⚡ 端侧轻量模型（开箱即用，无需配置）',
              subLabel: '直接在浏览器内部运行，保护隐私且无需任何额外配置',
              onSelect: async () => {
                await setActiveProviderId(null);
                setStage('stage_finale');
              },
            },
            {
              id: 'brain_custom',
              label: '🖥️ 本地模型服务（Ollama / LM Studio）',
              subLabel: '连接本地运行的强大开源大模型',
              onSelect: () => setStage('stage_finale'),
            },
            {
              id: 'brain_default',
              label: '💬 稍后再配，先默认开聊',
              subLabel: '直接进入主界面体验',
              onSelect: () => setStage('stage_finale'),
            },
          ],
        };

      case 'stage_finale':
        return {
          text: t('onboarding.galFinale', '耶！所有准备都就绪啦～有想对我说的话，随时在下面的对话框告诉我哦！'),
          choices: [
            {
              id: 'start_game',
              label: '🚀 启程，开始与小蠢的日常！',
              subLabel: '揭幕完整界面，随时开启畅聊',
              onSelect: finishTour,
            },
          ],
        };

      default:
        return {
          text: '',
        };
    }
  };

  const currentContent = getStageContent();

  // 打字机逐字显示动效
  useEffect(() => {
    const fullText = currentContent.text;
    if (!fullText) return;

    setDisplayedText('');
    setIsTyping(true);

    let idx = 0;
    const interval = setInterval(() => {
      idx++;
      setDisplayedText(fullText.slice(0, idx));
      if (idx >= fullText.length) {
        clearInterval(interval);
        setIsTyping(false);
      }
    }, 28);

    return () => clearInterval(interval);
  }, [stage, currentContent.text]);

  const handleBoxClick = () => {
    // 若正在打字，点击立即显示全部文字；若打字完成且有下一步，则推进阶段
    if (isTyping) {
      setDisplayedText(currentContent.text);
      setIsTyping(false);
      return;
    }
    if (currentContent.canClickNext && currentContent.onNext) {
      currentContent.onNext();
    }
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none select-none flex flex-col justify-between p-4 sm:p-6 overflow-hidden animate-in fade-in duration-700">
      {/* 顶部微弱暗角，让小蠢主体自然浮现 */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none" />

      {/* 顶栏控制：右上角极简跳过按钮 */}
      <div className="relative z-10 flex justify-end pointer-events-auto">
        <button
          type="button"
          onClick={finishTour}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-950/60 hover:bg-slate-950/90 border border-white/15 text-white/60 hover:text-white text-xs font-medium backdrop-blur-md transition-all shadow-md active:scale-95"
        >
          <span>{t('onboarding.skip', '跳过剧情')}</span>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 屏幕中央：Galgame 悬浮剧情选项分支 (Choice Branches) */}
      {currentContent.choices && currentContent.choices.length > 0 && !isTyping && (
        <div className="relative z-20 pointer-events-auto w-full max-w-lg mx-auto flex flex-col gap-2.5 my-auto animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300">
          {currentContent.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={choice.onSelect}
              className="w-full py-3.5 px-5 rounded-2xl bg-slate-950/85 hover:bg-[#ea8377]/25 border border-white/20 hover:border-[#ea8377] text-white shadow-2xl backdrop-blur-2xl flex items-center justify-between transition-all duration-200 hover:translate-x-1.5 hover:scale-[1.01] active:scale-98 group cursor-pointer text-left"
            >
              <div className="flex flex-col gap-0.5 min-w-0 pr-3">
                <div className="flex items-center gap-2">
                  <span className="text-[#ea8377] text-sm group-hover:scale-125 transition-transform shrink-0">
                    ✦
                  </span>
                  <span className="text-sm sm:text-base font-semibold tracking-wide text-white group-hover:text-[#f5aa9c] transition-colors truncate">
                    {choice.label}
                  </span>
                </div>
                {choice.subLabel && (
                  <span className="text-[11px] text-white/50 pl-5 truncate font-normal">
                    {choice.subLabel}
                  </span>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-white/40 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* 3D 视角教学时的悬浮修饰键指引条 */}
      {stage === 'stage_camera_intro' && (
        <div className="relative z-20 pointer-events-auto w-fit mx-auto mb-3 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-950/85 border border-[#ea8377]/60 shadow-[0_0_20px_rgba(234,131,119,0.3)] backdrop-blur-xl animate-bounce">
          <kbd className="px-2 py-0.5 text-xs font-mono font-bold rounded bg-gradient-to-b from-[#ea8377] to-[#d65f52] border border-[#f5aa9c] text-white shadow-sm">
            {modifierLabel}
          </kbd>
          <span className="text-xs font-medium text-white/90">
            {isMobileDevice
              ? t('onboarding.mobileHint', '长按屏幕 480ms 后拖动')
              : t('onboarding.desktopHint', '按住按键 + 鼠标左键拖拽')}
          </span>
          {hasRotated && (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400 pl-1">
              <Check className="w-3.5 h-3.5" />
              {t('onboarding.success', '转动成功！')}
            </span>
          )}
        </div>
      )}

      {/* 屏幕底部：正统 Galgame 文本框 (Dialogue Box) */}
      <div
        onClick={handleBoxClick}
        className={`relative z-20 pointer-events-auto w-full max-w-4xl mx-auto rounded-2xl bg-slate-950/88 border border-white/15 shadow-[0_12px_40px_rgba(0,0,0,0.75)] backdrop-blur-2xl px-5 sm:px-7 pt-4 pb-4 min-h-[6.5rem] sm:min-h-[7.5rem] flex flex-col justify-between transition-all duration-300 ${
          currentContent.canClickNext ? 'cursor-pointer hover:border-white/25 active:scale-[0.998]' : ''
        }`}
      >
        {/* Galgame 角色名字标牌 */}
        <div className="absolute -top-3.5 left-6 px-3 py-0.5 rounded-md bg-gradient-to-r from-[#ea8377] to-[#d65f52] text-white font-bold text-xs tracking-wider shadow-md flex items-center gap-1.5 border border-white/20">
          <Sparkles className="w-3 h-3 text-amber-200" />
          <span>{t('onboarding.characterName', '小蠢')}</span>
        </div>

        {/* 逐字台词文本区 */}
        <div className="pt-2">
          <p className="text-sm sm:text-base font-medium text-white/95 leading-relaxed tracking-wide select-text">
            {displayedText}
            {isTyping && <span className="inline-block w-1.5 h-4 bg-[#ea8377] ml-1 animate-pulse" />}
          </p>
        </div>

        {/* 右下角跳动推进指示器 */}
        <div className="flex justify-end items-center pt-2">
          {currentContent.canClickNext && !isTyping ? (
            <span className="flex items-center gap-1 text-[11px] font-mono text-[#f5aa9c] animate-bounce">
              <span>{t('onboarding.clickToContinue', '点击继续')}</span>
              <span>▼</span>
            </span>
          ) : (
            <div className="h-4" />
          )}
        </div>
      </div>
    </div>
  );
};
