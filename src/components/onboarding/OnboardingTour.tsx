import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  X,
  Check,
} from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { sceneManager } from '@/core/scene/sceneManager';
import { APP_CONFIG } from '@/config';
import { ONBOARDING_STORAGE_KEY } from '@/lib/constants';
import { getPrimaryModifierLabel, isMobile } from '@/lib/platform';
import {
  createOnboardingSteps,
  type OnboardingStep,
  type StepContext,
  type OnboardingChoice,
} from './onboardingSchema';

export { ONBOARDING_STORAGE_KEY };

interface OnboardingTourProps {
  onComplete: () => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ onComplete }) => {
  const { t, i18n } = useTranslation();
  const [currentStepId, setCurrentStepId] = useState<string>('step_intro');
  const [hasRotated, setHasRotated] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(true);
  const [isExiting, setIsExiting] = useState(false);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);

  // 记录当前正在播报的对话段落索引，防止竞争
  const speechSequenceRef = useRef<number>(0);

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

  const finishTour = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
      vrmEngine.stopSpeaking();
      // 若当前仍在虚空场景 (例如用户在未选场景前提前跳过)，自动回退到默认场景
      if (sceneManager.getCurrentSceneId() === 'void') {
        void sceneManager.setScene(APP_CONFIG.scenes.defaultSceneId, true);
      }
    } catch {
      // ignore
    }
    onComplete();
  }, [onComplete]);

  // 组件卸载时停止语音与动作
  useEffect(() => {
    return () => {
      try {
        vrmEngine.stopSpeaking();
      } catch {
        // ignore
      }
    };
  }, []);

  // 构造 Schema 上下文与步骤字典
  const steps: Record<string, OnboardingStep> = useMemo(
    () => createOnboardingSteps(t, i18n),
    [t, i18n],
  );

  const currentStep = steps[currentStepId] ?? steps.step_intro;

  const stepContext: StepContext = useMemo(
    () => ({
      t,
      i18n,
      hasRotated,
      goToStep: (stepId: string) => {
        setCurrentStepId(stepId);
      },
      finish: finishTour,
    }),
    [t, i18n, hasRotated, finishTour],
  );

  // 监听玩家 3D 旋转操作 (视角教学环节)
  useEffect(() => {
    if (currentStep.interaction !== 'camera_drag') return;

    (window as any).__onboardingSetRotated = setHasRotated;
    const unsub = vrmEngine.interaction.onStateChange((state) => {
      if (state.isDragging) {
        setHasRotated(true);
      }
    });

    return () => {
      delete (window as any).__onboardingSetRotated;
      unsub();
    };
  }, [currentStep.interaction]);

  // 步骤推进时：依序逐段朗读台词（多段自动衔接），直至全部播报完成才弹出选项卡片！
  useEffect(() => {
    const dialogues = currentStep.dialogues;
    if (!dialogues || dialogues.length === 0) {
      setIsSpeaking(false);
      return;
    }

    const currentSeq = ++speechSequenceRef.current;
    let isCancelled = false;
    setIsSpeaking(true);

    const playSequence = async () => {
      for (let i = 0; i < dialogues.length; i++) {
        if (isCancelled || currentSeq !== speechSequenceRef.current) break;

        const d = dialogues[i];
        const rawText = t(d.key, { defaultValue: d.defaultText, ...d.params });
        const cleanSpeech = rawText.replace(/^[…\.\s]+/, '').trim();

        if (cleanSpeech) {
          try {
            await vrmEngine.speakText(cleanSpeech);
          } catch (e) {
            console.warn('[OnboardingTour] speakText error:', e);
          }
        }

        // 若不是最后一段，稍作自然呼吸停顿后自动继续下一段
        if (i < dialogues.length - 1 && !isCancelled && currentSeq === speechSequenceRef.current) {
          await new Promise((r) => setTimeout(r, 450));
        }
      }

      if (!isCancelled && currentSeq === speechSequenceRef.current) {
        // 全部段落说完，角色讲完后卡片顺滑浮现
        setIsSpeaking(false);
      }
    };

    void playSequence();

    return () => {
      isCancelled = true;
    };
  }, [currentStepId, t]);

  // 用户点击屏幕任意处可快速略过语音等待，直接弹出选项
  const handleQuickReveal = useCallback(() => {
    if (isSpeaking) {
      setIsSpeaking(false);
      try {
        vrmEngine.stopSpeaking();
      } catch {}
    }
  }, [isSpeaking]);

  useEffect(() => {
    (window as any).__onboardingQuickReveal = handleQuickReveal;
    if (!isSpeaking) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button')) return;
      handleQuickReveal();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isSpeaking, handleQuickReveal]);

  const choices: OnboardingChoice[] = useMemo(() => {
    return currentStep.getChoices(stepContext);
  }, [currentStep, stepContext]);

  // 处理选项点击：先播放高光选中与离场折叠动效，再正式推进步骤
  const handleSelectChoice = async (choice: OnboardingChoice) => {
    if (isExiting) return;
    setIsExiting(true);
    setSelectedChoiceId(choice.id);

    try {
      const ctx = (vrmEngine as any).chatDirector?.ctx as AudioContext | undefined;
      if (ctx && ctx.state === 'suspended') void ctx.resume();
    } catch {}

    // 优雅离场动效 260ms
    await new Promise((resolve) => setTimeout(resolve, 260));

    try {
      await choice.onSelect(stepContext);
    } finally {
      setIsExiting(false);
      setSelectedChoiceId(null);
    }
  };

  return (
    <div
      onClick={handleQuickReveal}
      className="fixed inset-0 z-40 pointer-events-none select-none flex flex-col justify-between p-4 sm:p-6 overflow-hidden animate-in fade-in duration-500"
    >
      {/* 顶栏控制：右上角极简跳过按钮 */}
      <div className="relative z-10 flex justify-end pointer-events-auto">
        <button
          type="button"
          onClick={finishTour}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-950/60 hover:bg-slate-950/90 border border-white/15 text-white/60 hover:text-white text-xs font-medium backdrop-blur-md transition-all shadow-md active:scale-95"
        >
          <span>{t('onboarding.skip', '跳过')}</span>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 3D 视角教学时的悬浮修饰键指引条 (游戏/原神风格触控与机械键帽 HUD) */}
      {currentStep.interaction === 'camera_drag' && (
        <div className="relative z-20 pointer-events-auto w-fit mx-auto mt-auto mb-4 flex flex-col items-center gap-1.5 animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-slate-950/90 border border-[#ea8377]/60 shadow-[0_0_25px_rgba(234,131,119,0.35),inset_0_1px_1px_rgba(255,255,255,0.2)] backdrop-blur-2xl">
            {/* 游戏风格机械键帽 */}
            <div className="flex items-center gap-1.5">
              <span className="text-[#f5aa9c] text-xs">✦</span>
              <kbd className="inline-flex items-center justify-center px-2.5 py-1 text-xs font-mono font-black rounded-lg bg-gradient-to-b from-slate-700 via-slate-800 to-slate-950 text-amber-200 border-t border-white/30 border-x border-slate-700 border-b-2 border-slate-950 shadow-[0_2px_4px_rgba(0,0,0,0.6),0_0_8px_rgba(251,191,36,0.3)] tracking-wider">
                {modifierLabel}
              </kbd>
            </div>
            <div className="h-4 w-px bg-white/20" />
            <span className="text-xs font-medium text-white/95 tracking-wide">
              {isMobileDevice
                ? t('onboarding.mobileHint', '长按屏幕 480ms 后拖动')
                : t('onboarding.desktopHint', '按住按键 + 鼠标左键拖拽')}
            </span>
            {hasRotated ? (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 pl-1.5 border-l border-emerald-500/30">
                <Check className="w-3.5 h-3.5" />
                {t('onboarding.success', '转动成功！')}
              </span>
            ) : (
              <span className="text-[10px] text-white/60 hidden sm:inline pl-1">
                ({t('onboarding.cameraExtraHint', '支持 360° 自由环视 · 调整俯仰与视距')})
              </span>
            )}
          </div>
        </div>
      )}

      {/* 选项区域：角色说完台词后（!isSpeaking）平滑浮现 */}
      {!isSpeaking && choices.length > 0 && (
        <div
          className={`relative z-30 pointer-events-auto w-full mx-auto mt-auto mb-8 sm:mb-12 transition-all duration-300 ${
            isExiting ? 'onboarding-dock-exit' : ''
          }`}
        >
          {/* 布局 1：纯文字/图标精致卡片 (text) */}
          {currentStep.choiceLayout === 'text' && (
            <div className="w-full max-w-md mx-auto flex flex-col gap-2.5">
              {choices.map((choice, index) => {
                const isSelected = selectedChoiceId === choice.id;
                const isDimmed = selectedChoiceId !== null && !isSelected;

                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => void handleSelectChoice(choice)}
                    style={{ animationDelay: `${index * 60}ms` }}
                    className={`w-full py-3 px-4 sm:px-5 rounded-2xl bg-slate-950/80 hover:bg-slate-900/90 border text-white shadow-xl backdrop-blur-2xl flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] group cursor-pointer text-left overflow-hidden relative onboarding-card-enter ${
                      isSelected
                        ? 'border-[#ea8377] bg-[#ea8377]/25 shadow-[0_0_35px_rgba(234,131,119,0.5)] scale-[1.02]'
                        : isDimmed
                          ? 'opacity-25 scale-95 pointer-events-none border-white/10'
                          : 'border-white/15 hover:border-[#ea8377]/60 hover:shadow-[0_8px_30px_rgba(234,131,119,0.2)]'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0 pr-2">
                      {/* 左侧徽章 / 国旗 / 图标 */}
                      {choice.icon && (
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 shadow-inner transition-all duration-200 ${
                            isSelected
                              ? 'bg-[#ea8377] border border-[#f5aa9c] scale-110 shadow-[0_0_15px_rgba(234,131,119,0.5)]'
                              : 'bg-white/10 border border-white/15 group-hover:scale-110 group-hover:bg-[#ea8377]/20 group-hover:border-[#ea8377]/40'
                          }`}
                        >
                          {choice.icon}
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[#f5aa9c] text-[10px] opacity-75">✦</span>
                          <span
                            className={`text-sm sm:text-[15px] font-semibold tracking-wide transition-colors truncate ${
                              isSelected ? 'text-[#f5aa9c]' : 'text-white group-hover:text-[#f5aa9c]'
                            }`}
                          >
                            {choice.label}
                          </span>
                        </div>
                        {choice.subLabel && (
                          <span className="text-[11px] sm:text-xs text-white/50 group-hover:text-white/70 transition-colors truncate font-normal pl-3.5">
                            {choice.subLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${
                        isSelected
                          ? 'bg-[#ea8377] border border-[#f5aa9c]'
                          : 'bg-white/5 border border-white/10 group-hover:bg-[#ea8377] group-hover:border-[#f5aa9c]'
                      }`}
                    >
                      <ChevronRight
                        className={`w-3.5 h-3.5 transition-all ${
                          isSelected ? 'text-white translate-x-0.5' : 'text-white/40 group-hover:text-white group-hover:translate-x-0.5'
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* 布局 2：带图文卡片 (media，适用于场景选择与服装试穿) */}
          {currentStep.choiceLayout === 'media' && (
            <div className="w-full max-w-xl mx-auto grid grid-cols-2 gap-2.5 sm:gap-3.5">
              {choices.map((choice, index) => {
                const isSelected = selectedChoiceId === choice.id;
                const isDimmed = selectedChoiceId !== null && !isSelected;

                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => void handleSelectChoice(choice)}
                    style={{ animationDelay: `${index * 70}ms` }}
                    className={`group relative flex flex-col p-2.5 sm:p-3 rounded-2xl bg-slate-950/85 hover:bg-slate-900/95 border shadow-2xl backdrop-blur-2xl transition-all duration-200 cursor-pointer text-left overflow-hidden onboarding-card-enter ${
                      isSelected
                        ? 'border-[#ea8377] bg-[#ea8377]/25 shadow-[0_0_35px_rgba(234,131,119,0.5)] scale-[1.02]'
                        : isDimmed
                          ? 'opacity-25 scale-95 pointer-events-none border-white/10'
                          : 'border-white/20 hover:border-[#ea8377] hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(234,131,119,0.25)] active:scale-98'
                    }`}
                  >
                    {/* 顶部视觉预览展台 (16:9 比例) */}
                    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-900 border border-white/10 shadow-inner">
                      {choice.image ? (
                        <img
                          src={choice.image}
                          alt={choice.label}
                          className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-108"
                          loading="eager"
                        />
                      ) : (
                        <div
                          className={`w-full h-full bg-gradient-to-br ${
                            choice.mediaPreview?.gradient ?? 'from-brand-500/30 to-purple-500/30'
                          } flex items-center justify-center text-3xl sm:text-4xl shadow-inner group-hover:scale-105 transition-transform duration-300`}
                        >
                          <span>{choice.mediaPreview?.emoji ?? '✨'}</span>
                        </div>
                      )}

                      {/* 渐变遮罩压暗底部文字衔接处 */}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent pointer-events-none" />

                      {/* 角标 Badge (原神/二次元游戏风格) */}
                      {choice.badge && (
                        <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-slate-950/80 border border-white/20 backdrop-blur-md text-[10px] sm:text-[11px] font-semibold text-white/90 shadow-sm flex items-center gap-1">
                          <span className="text-[#f5aa9c] text-[9px]">✦</span>
                          <span>{choice.badge}</span>
                        </div>
                      )}

                      {/* 选中高亮勾选标 */}
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[#ea8377] border border-[#f5aa9c] flex items-center justify-center shadow-lg animate-in zoom-in-75 duration-200">
                          <Check className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                    </div>

                    {/* 底部标题与描述 */}
                    <div className="mt-2.5 flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs sm:text-sm font-bold transition-colors truncate ${
                            isSelected ? 'text-[#f5aa9c]' : 'text-white group-hover:text-[#f5aa9c]'
                          }`}
                        >
                          {choice.label}
                        </span>
                        <ChevronRight
                          className={`w-3.5 h-3.5 shrink-0 ml-1 transition-all ${
                            isSelected ? 'text-[#f5aa9c] translate-x-0.5' : 'text-white/30 group-hover:text-white group-hover:translate-x-0.5'
                          }`}
                        />
                      </div>
                      {choice.subLabel && (
                        <span className="text-[10px] sm:text-[11px] text-white/50 truncate font-normal">
                          {choice.subLabel}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
