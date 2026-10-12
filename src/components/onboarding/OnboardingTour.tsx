import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  X,
  Check,
  RotateCcw,
  ArrowUpDown,
  Camera,
  ZoomIn,
  Move,
  Sparkles,
} from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { sceneManager } from '@/core/scene/sceneManager';
import { APP_CONFIG } from '@/config';
import { ONBOARDING_STORAGE_KEY } from '@/lib/constants';
import { getPrimaryModifierLabel, isMobile, isTauri } from '@/lib/platform';
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

  // 视角探索任务清单完成状态 (0 ~ 5)
  const [cameraTasks, setCameraTasks] = useState({
    modifierHeld: false,
    modifierDone: false,
    orbit360: false,
    pitch: false,
    cameraHeight: false,
    wheelZoom: false,
    dragCharacter: false,
  });

  // 记录当前正在播报的对话段落索引，防止竞争
  const speechSequenceRef = useRef<number>(0);

  const isMobileDevice = isMobile();
  const isTauriEnv = isTauri();
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

  // 仅在任务清单面板正式浮现 (!isSpeaking) 且当前是 camera_drag 教学步骤时，才开启手势统计与事件监听！
  // 台词播报期间绝不监听或统计，彻底杜绝全局误触与视角推拉打断台词
  useEffect(() => {
    if (currentStep.interaction !== 'camera_drag' || isSpeaking) return;

    (window as any).__onboardingSetRotated = setHasRotated;
    (window as any).__onboardingSetCameraTasks = setCameraTasks;

    // 1. 订阅 InteractionController 状态变化 (修饰键按下状态)
    const unsubState = vrmEngine.interaction.onStateChange((state) => {
      if (state.isModifierActive) {
        setCameraTasks((prev) => ({ ...prev, modifierHeld: true, modifierDone: true }));
      } else {
        setCameraTasks((prev) => ({ ...prev, modifierHeld: false }));
      }
    });

    // 2. 订阅底层细粒度手势并累计旋转量 (累计达到足够角度/位移才触发完成，避免微触即触发)
    let cumTurnDx = 0;
    let cumTurnDy = 0;
    let cumGuideDy = 0;
    let cumWheel = 0;

    const unsubGesture = vrmEngine.interaction.onGesture((ev) => {
      if (ev.type === 'turn') {
        cumTurnDx += Math.abs(ev.dx);
        cumTurnDy += Math.abs(ev.dy);

        // 任务 1：水平 360° 环视拖动（累计拖动 ≥ 100px，约对应 30°~45° 转角，真正转动角色才判定完成）
        if (cumTurnDx >= 100) {
          setCameraTasks((prev) => ({ ...prev, orbit360: true }));
          setHasRotated(true);
        }
        // 任务 2：垂直俯仰角拖动（累计上下拖动 ≥ 65px，显著调整镜头高度俯仰角才判定完成）
        if (cumTurnDy >= 65) {
          setCameraTasks((prev) => ({ ...prev, pitch: true }));
          setHasRotated(true);
        }
      } else if (ev.type === 'guide-drag') {
        cumGuideDy += Math.abs(ev.dy);
        if (cumGuideDy >= 25) {
          setCameraTasks((prev) => ({ ...prev, cameraHeight: true }));
        }
      } else if (ev.type === 'move-start' || ev.type === 'move-delta') {
        setCameraTasks((prev) => ({ ...prev, dragCharacter: true }));
      }
    });

    // 3. 监听全局键盘事件 (针对直接按下/松开 Cmd/Ctrl 键)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') {
        setCameraTasks((prev) => ({ ...prev, modifierHeld: true, modifierDone: true }));
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') {
        setCameraTasks((prev) => ({ ...prev, modifierHeld: false }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // 4. 监听鼠标滚轮缩放事件 (累计滚轮距离 ≥ 60，避免单次微滚误判)
    const handleWheel = (e: WheelEvent) => {
      cumWheel += Math.abs(e.deltaY);
      if (cumWheel >= 60) {
        setCameraTasks((prev) => ({ ...prev, wheelZoom: true }));
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: true });

    return () => {
      delete (window as any).__onboardingSetRotated;
      delete (window as any).__onboardingSetCameraTasks;
      unsubState();
      unsubGesture();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [currentStep.interaction, isSpeaking]);

  const tRef = useRef(t);
  tRef.current = t;

  // 步骤推进时：依序逐段朗读台词（多段自动衔接），直至全部播报完成才弹出选项卡片！
  // 严格仅在步骤 ID 切换时触发，防止因外部组件刷新或其它状态变动误打断语音播放
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
        const rawText = tRef.current(d.key, { defaultValue: d.defaultText, ...d.params });
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
        // 全部段落说完，角色讲完后卡片顺滑浮现，并开启任务手势统计
        setIsSpeaking(false);
      }
    };

    void playSequence();

    return () => {
      isCancelled = true;
    };
  }, [currentStepId]);

  // 仅对外暴露测试钩子，不监听用户任何点击事件（确保等话说完再自然弹出卡片）
  useEffect(() => {
    (window as any).__onboardingQuickReveal = () => {
      setIsSpeaking(false);
      try {
        vrmEngine.stopSpeaking();
      } catch { }
    };
    return () => {
      delete (window as any).__onboardingQuickReveal;
    };
  }, []);

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
    } catch { }

    // 优雅离场动效 260ms
    await new Promise((resolve) => setTimeout(resolve, 260));

    try {
      await choice.onSelect(stepContext);
    } finally {
      setIsExiting(false);
      setSelectedChoiceId(null);
    }
  };

  // 视角探索任务清单 (0 ~ 5)
// 拟物液体玻璃按键 (响应按压/按住修饰键状态)
const LiquidGlassKey: React.FC<{ label: string; isPressed: boolean }> = ({ label, isPressed }) => {
  return (
    <kbd
      className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[10.5px] font-mono font-medium rounded-md border backdrop-blur-md transition-all duration-150 select-none ${
        isPressed
          ? 'bg-white/25 border-white/60 text-white shadow-[0_0_12px_rgba(255,255,255,0.4),inset_0_1px_2px_rgba(255,255,255,0.6)] scale-95 translate-y-[0.5px]'
          : 'bg-white/[0.08] hover:bg-white/[0.12] border-white/20 text-white/85 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_2px_4px_rgba(0,0,0,0.3)]'
      }`}
    >
      {label}
    </kbd>
  );
};

  // 视角探索任务清单 (从 1 开始编号，修饰键下沉到各任务 subtitle 作为触发指引)
  const taskItems = useMemo(() => {
    const list = [
      {
        id: 'orbit',
        num: 1,
        label: t('onboarding.cameraTaskOrbit', '调整 360° 环视'),
        subLabel: t('onboarding.cameraOrbitSub', '水平左右拖动'),
        done: cameraTasks.orbit360,
        needsModifier: true,
        icon: RotateCcw,
      },
      {
        id: 'pitch',
        num: 2,
        label: t('onboarding.cameraTaskPitch', '调整俯仰角'),
        subLabel: t('onboarding.cameraPitchSub', '垂直上下拖动'),
        done: cameraTasks.pitch,
        needsModifier: true,
        icon: ArrowUpDown,
      },
      {
        id: 'height',
        num: 3,
        label: t('onboarding.cameraTaskHeight', '调整相机高度'),
        subLabel: t('onboarding.cameraHeightSub', '拖动左侧标尺滑块'),
        done: cameraTasks.cameraHeight,
        needsModifier: true,
        icon: Camera,
      },
      {
        id: 'zoom',
        num: 4,
        label: t('onboarding.cameraTaskZoom', '鼠标滚轮缩放'),
        subLabel: t('onboarding.cameraZoomSub', '前后推拉镜头视距'),
        done: cameraTasks.wheelZoom,
        needsModifier: false,
        icon: ZoomIn,
      },
    ];

    if (isTauriEnv) {
      list.push({
        id: 'drag',
        num: 5,
        label: t('onboarding.cameraTaskDrag', '拖动角色'),
        subLabel: t('onboarding.cameraDragSub', '拖拽角色移动桌面窗口'),
        done: cameraTasks.dragCharacter,
        needsModifier: false,
        icon: Move,
      });
    }

    return list;
  }, [t, cameraTasks, isTauriEnv]);

  const completedCount = useMemo(() => {
    return taskItems.filter((item) => item.done).length;
  }, [taskItems]);
  const isAllTasksDone = completedCount === taskItems.length;

  return (
    <div
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

      {/* 选项区域：角色说完台词后（!isSpeaking）平滑浮现 */}
      {!isSpeaking && choices.length > 0 && (
        <div
          className={`relative z-30 pointer-events-auto w-full mx-auto mt-auto mb-8 sm:mb-12 transition-all duration-300 ${
            isExiting ? 'onboarding-dock-exit' : ''
          }`}
        >
          {/* 布局 0：视角探索任务清单 + 独立下一步卡片 (interaction === 'camera_drag') */}
          {currentStep.interaction === 'camera_drag' && (
            <div className="w-full max-w-lg mx-auto flex flex-col gap-2.5 onboarding-card-enter">
              {/* 任务清单面板 */}
              <div className="w-full flex flex-col rounded-3xl bg-slate-950/90 border border-white/20 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl p-4 sm:p-5 gap-3">
                {/* 面板头部：标题与完成计数指示器 */}
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-widest text-[#f5aa9c] bg-[#ea8377]/20 border border-[#ea8377]/35 px-2 py-0.5 rounded-full uppercase">
                      MISSION
                    </span>
                    <h3 className="text-sm sm:text-[15px] font-bold text-white tracking-wide">
                      {t('onboarding.cameraTaskListTitle', '视角探索任务')}
                    </h3>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className={`font-mono font-bold ${isAllTasksDone ? 'text-emerald-400' : 'text-amber-300'}`}>
                      {completedCount}
                    </span>
                    <span className="text-white/40 font-mono">/</span>
                    <span className="text-white/60 font-mono">{taskItems.length}</span>
                    {isAllTasksDone && (
                      <span className="ml-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        <Check className="w-3 h-3" />
                        All Clear
                      </span>
                    )}
                  </div>
                </div>

                {/* 任务项清单 (从 1 开始编号) */}
                <div className="flex flex-col gap-1.5">
                  {taskItems.map((item) => {
                    const Icon = item.icon;
                    const isModifierActiveOnRow = item.needsModifier && cameraTasks.modifierHeld && !item.done;

                    return (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl transition-all duration-200 border ${
                          item.done
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-100'
                            : isModifierActiveOnRow
                              ? 'bg-white/[0.07] border-white/35 text-white shadow-[0_0_15px_rgba(255,255,255,0.08)]'
                              : 'bg-white/[0.03] border-white/10 text-white/80'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          {/* 左侧序号与图标 */}
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs font-mono font-semibold text-white/40 w-3.5 text-right">
                              {item.num}.
                            </span>
                            <div
                              className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
                                item.done
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : isModifierActiveOnRow
                                    ? 'bg-white/20 text-white'
                                    : 'bg-white/10 text-white/70'
                              }`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                          </div>

                          {/* 任务标题与带液体玻璃按键指引的 Subtitle */}
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs sm:text-[13px] font-medium tracking-wide truncate ${
                                  item.done ? 'text-emerald-200' : 'text-white'
                                }`}
                              >
                                {item.label}
                              </span>
                              {!item.needsModifier && (
                                <span className="text-[10px] text-white/40 bg-white/[0.05] border border-white/10 px-1.5 py-0.2 rounded-full font-normal">
                                  {t('onboarding.cameraDirectAction', '无需按键')}
                                </span>
                              )}
                            </div>

                            {/* 副标题：对于 1/2/3 任务展示液体玻璃按键，对于滚轮任务直接展示文案 */}
                            {item.needsModifier ? (
                              <div className="flex items-center gap-1.5 text-[10.5px] sm:text-[11px] text-white/50 mt-0.5">
                                <span>{t('onboarding.cameraHoldPrefix', '按住')}</span>
                                <LiquidGlassKey label={modifierLabel} isPressed={cameraTasks.modifierHeld} />
                                <span>{item.subLabel}</span>
                              </div>
                            ) : (
                              <span className="text-[10.5px] sm:text-[11px] text-white/50 truncate font-normal mt-0.5">
                                {item.subLabel}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* 右侧打勾状态 */}
                        <div className="shrink-0 pl-2">
                          {item.done ? (
                            <div className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-in zoom-in-75 duration-200">
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                            </div>
                          ) : isModifierActiveOnRow ? (
                            <div className="w-5 h-5 rounded-full border border-white/40 bg-white/10 flex items-center justify-center animate-pulse">
                              <div className="w-2 h-2 rounded-full bg-white/70" />
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-full border border-white/20 flex items-center justify-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 独立下一步选项卡片（复用全局统一的选项卡片样式） */}
              {choices.map((choice) => {
                const isSelected = selectedChoiceId === choice.id;
                const isDimmed = selectedChoiceId !== null && !isSelected;
                const label = isAllTasksDone
                  ? t('onboarding.cameraDoneNext', '转动好啦，看到全方位的你啦！')
                  : choice.label;
                const subLabel = isAllTasksDone
                  ? t('onboarding.cameraDoneNextSub', '视角操作已掌握，进入场景探索')
                  : choice.subLabel || t('onboarding.cameraSkipNextSub', '随时可进入下一步选择心仪场景');
                const icon = isAllTasksDone ? '🎉' : choice.icon || '✨';

                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => void handleSelectChoice(choice)}
                    className={`w-full py-3 px-4 sm:px-5 rounded-2xl bg-slate-950/80 hover:bg-slate-900/90 border text-white shadow-xl backdrop-blur-2xl flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] group cursor-pointer text-left overflow-hidden relative ${
                      isSelected
                        ? 'border-[#ea8377] bg-[#ea8377]/25 shadow-[0_0_35px_rgba(234,131,119,0.5)] scale-[1.02]'
                        : isDimmed
                          ? 'opacity-25 scale-95 pointer-events-none border-white/10'
                          : isAllTasksDone
                            ? 'border-[#ea8377]/70 bg-[#ea8377]/10 hover:border-[#ea8377] hover:bg-[#ea8377]/20 shadow-[0_0_25px_rgba(234,131,119,0.25)]'
                            : 'border-white/15 hover:border-[#ea8377]/60 hover:shadow-[0_8px_30px_rgba(234,131,119,0.2)]'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0 pr-2">
                      {/* 左侧徽章 */}
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 shadow-inner transition-all duration-200 ${
                          isSelected || isAllTasksDone
                            ? 'bg-[#ea8377] border border-[#f5aa9c] scale-110 shadow-[0_0_15px_rgba(234,131,119,0.5)]'
                            : 'bg-white/10 border border-white/15 group-hover:scale-110 group-hover:bg-[#ea8377]/20 group-hover:border-[#ea8377]/40'
                        }`}
                      >
                        {icon}
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm sm:text-[15px] font-semibold tracking-wide transition-colors truncate ${
                              isSelected ? 'text-[#f5aa9c]' : 'text-white group-hover:text-[#f5aa9c]'
                            }`}
                          >
                            {label}
                          </span>
                          {isAllTasksDone && (
                            <span className="text-[10px] bg-[#ea8377]/20 border border-[#ea8377]/40 text-[#f5aa9c] px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              全部达成
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] sm:text-xs text-white/50 group-hover:text-white/70 transition-colors truncate font-normal">
                          {subLabel}
                        </span>
                      </div>
                    </div>
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${
                        isSelected || isAllTasksDone
                          ? 'bg-[#ea8377] border border-[#f5aa9c]'
                          : 'bg-white/5 border border-white/10 group-hover:bg-[#ea8377] group-hover:border-[#f5aa9c]'
                      }`}
                    >
                      <ChevronRight
                        className={`w-3.5 h-3.5 transition-all ${
                          isSelected || isAllTasksDone
                            ? 'text-white translate-x-0.5'
                            : 'text-white/40 group-hover:text-white group-hover:translate-x-0.5'
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* 布局 1：纯文字/图标精致卡片 (text, 非视角教学) */}
          {currentStep.choiceLayout === 'text' && currentStep.interaction !== 'camera_drag' && (
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
                    className={`w-full py-3 px-4 sm:px-5 rounded-2xl bg-slate-950/80 hover:bg-slate-900/90 border text-white shadow-xl backdrop-blur-2xl flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] group cursor-pointer text-left overflow-hidden relative onboarding-card-enter ${isSelected
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
                          className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 shadow-inner transition-all duration-200 ${isSelected
                            ? 'bg-[#ea8377] border border-[#f5aa9c] scale-110 shadow-[0_0_15px_rgba(234,131,119,0.5)]'
                            : 'bg-white/10 border border-white/15 group-hover:scale-110 group-hover:bg-[#ea8377]/20 group-hover:border-[#ea8377]/40'
                            }`}
                        >
                          {choice.icon}
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span
                          className={`text-sm sm:text-[15px] font-semibold tracking-wide transition-colors truncate ${isSelected ? 'text-[#f5aa9c]' : 'text-white group-hover:text-[#f5aa9c]'
                            }`}
                        >
                          {choice.label}
                        </span>
                        {choice.subLabel && (
                          <span className="text-[11px] sm:text-xs text-white/50 group-hover:text-white/70 transition-colors truncate font-normal">
                            {choice.subLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${isSelected
                        ? 'bg-[#ea8377] border border-[#f5aa9c]'
                        : 'bg-white/5 border border-white/10 group-hover:bg-[#ea8377] group-hover:border-[#f5aa9c]'
                        }`}
                    >
                      <ChevronRight
                        className={`w-3.5 h-3.5 transition-all ${isSelected ? 'text-white translate-x-0.5' : 'text-white/40 group-hover:text-white group-hover:translate-x-0.5'
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
                    className={`group relative flex flex-col p-2.5 sm:p-3 rounded-2xl bg-slate-950/85 hover:bg-slate-900/95 border shadow-2xl backdrop-blur-2xl transition-all duration-200 cursor-pointer text-left overflow-hidden onboarding-card-enter ${isSelected
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
                          className={`w-full h-full bg-gradient-to-br ${choice.mediaPreview?.gradient ?? 'from-brand-500/30 to-purple-500/30'
                            } flex items-center justify-center text-3xl sm:text-4xl shadow-inner group-hover:scale-105 transition-transform duration-300`}
                        >
                          <span>{choice.mediaPreview?.emoji ?? '✨'}</span>
                        </div>
                      )}

                      {/* 渐变遮罩压暗底部文字衔接处 */}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent pointer-events-none" />

                      {/* 角标 Badge */}
                      {choice.badge && (
                        <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-slate-950/80 border border-white/20 backdrop-blur-md text-[10px] sm:text-[11px] font-semibold text-white/90 shadow-sm">
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
                          className={`text-xs sm:text-sm font-bold transition-colors truncate ${isSelected ? 'text-[#f5aa9c]' : 'text-white group-hover:text-[#f5aa9c]'
                            }`}
                        >
                          {choice.label}
                        </span>
                        <ChevronRight
                          className={`w-3.5 h-3.5 shrink-0 ml-1 transition-all ${isSelected ? 'text-[#f5aa9c] translate-x-0.5' : 'text-white/30 group-hover:text-white group-hover:translate-x-0.5'
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
