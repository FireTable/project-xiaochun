import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  X,
  Check,
} from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { getPrimaryModifierLabel, isMobile } from '@/lib/platform';
import {
  createOnboardingSteps,
  type OnboardingStep,
  type StepContext,
  type OnboardingChoice,
} from './onboardingSchema';

export const ONBOARDING_STORAGE_KEY = 'xc_onboarding_completed_v1';

interface OnboardingTourProps {
  onComplete: () => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ onComplete }) => {
  const { t, i18n } = useTranslation();
  const [currentStepId, setCurrentStepId] = useState<string>('step_intro');
  const [hasRotated, setHasRotated] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(true);

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
      vrmEngine.chatDirector.stop();
    } catch {
      // ignore
    }
    onComplete();
  }, [onComplete]);

  // 组件卸载时停止语音与动作
  useEffect(() => {
    return () => {
      try {
        vrmEngine.chatDirector.stop();
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

    const unsub = vrmEngine.interaction.onStateChange((state) => {
      if (state.isDragging) {
        setHasRotated(true);
      }
    });

    return () => {
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
        const rawText = t(d.key, d.defaultText);
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
  const handleQuickReveal = () => {
    if (isSpeaking) {
      setIsSpeaking(false);
    }
  };

  const choices: OnboardingChoice[] = useMemo(() => {
    return currentStep.getChoices(stepContext);
  }, [currentStep, stepContext]);

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

      {/* 3D 视角教学时的悬浮修饰键指引条 */}
      {currentStep.interaction === 'camera_drag' && (
        <div className="relative z-20 pointer-events-auto w-fit mx-auto mt-auto mb-3 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-950/85 border border-[#ea8377]/60 shadow-[0_0_20px_rgba(234,131,119,0.3)] backdrop-blur-xl animate-bounce">
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

      {/* 选项区域：角色说完台词后（!isSpeaking）平滑浮现 */}
      {!isSpeaking && choices.length > 0 && (
        <div className="relative z-30 pointer-events-auto w-full mx-auto mt-auto mb-8 sm:mb-12 animate-in fade-in zoom-in-95 slide-in-from-bottom-5 duration-300">
          {/* 布局 1：纯文字卡片 (text) */}
          {currentStep.choiceLayout === 'text' && (
            <div className="w-full max-w-md mx-auto flex flex-col gap-2.5">
              {choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => {
                    try {
                      const ctx = (vrmEngine.chatDirector as any).ctx as AudioContext | undefined;
                      if (ctx && ctx.state === 'suspended') void ctx.resume();
                    } catch {}
                    choice.onSelect(stepContext);
                  }}
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

          {/* 布局 2：带图文卡片 (media，适用于场景选择与服装试穿) */}
          {currentStep.choiceLayout === 'media' && (
            <div className="w-full max-w-lg mx-auto grid grid-cols-2 gap-2.5 sm:gap-3.5">
              {choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => {
                    try {
                      const ctx = (vrmEngine.chatDirector as any).ctx as AudioContext | undefined;
                      if (ctx && ctx.state === 'suspended') void ctx.resume();
                    } catch {}
                    choice.onSelect(stepContext);
                  }}
                  className="group relative flex flex-col p-3 rounded-2xl bg-slate-950/85 hover:bg-slate-900/90 border border-white/20 hover:border-[#ea8377] shadow-2xl backdrop-blur-2xl transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(234,131,119,0.25)] active:scale-98 cursor-pointer text-left overflow-hidden"
                >
                  {/* 顶部彩色微缩视觉展台 Banner */}
                  <div
                    className={`w-full h-16 sm:h-20 rounded-xl bg-gradient-to-br ${
                      choice.mediaPreview?.gradient ?? 'from-brand-500/30 to-purple-500/30'
                    } border border-white/10 flex items-center justify-center text-3xl sm:text-4xl shadow-inner group-hover:scale-105 transition-transform duration-300`}
                  >
                    <span>{choice.mediaPreview?.emoji ?? '✨'}</span>
                  </div>

                  {/* 底部标题与描述 */}
                  <div className="mt-2.5 flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs sm:text-sm font-bold text-white group-hover:text-[#f5aa9c] transition-colors truncate">
                        {choice.label}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-white/30 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0 ml-1" />
                    </div>
                    {choice.subLabel && (
                      <span className="text-[10px] sm:text-[11px] text-white/50 truncate font-normal">
                        {choice.subLabel}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
