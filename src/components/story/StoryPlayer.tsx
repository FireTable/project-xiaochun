import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { StoryCinematicOverlay } from './StoryCinematicOverlay';
import { StoryChoiceGroup } from './StoryChoiceGroup';
import { StoryChoiceCard } from './StoryChoiceCard';
import { StoryCameraTaskCard } from './StoryCameraTaskCard';
import { ChatBubble } from '@/components/ChatBubble';
import { ChatBar } from '@/components/ChatBar';
import { ProviderConfigDialog } from '@/components/ProviderConfigDialog';
import { vrmEngine, type BubbleState } from '@/core/vrmEngine';
import { storyDirectorEngine, type StoryState } from '@/story/storyEngine';
import { storyGenerator } from '@/story/storyGenerator';
import { prologueStory } from '@/story/prologueStory';
import type { StoryScript, StoryChoice } from '@/story/schema';
import { normalizeStoryLang, resolveLocalized } from '@/story/localize';

interface StoryPlayerProps {
  script?: StoryScript;
  onComplete?: () => void;
}

export const StoryPlayer: React.FC<StoryPlayerProps> = ({
  script = prologueStory,
  onComplete,
}) => {
  const { i18n, t } = useTranslation();
  const uiLang = normalizeStoryLang(i18n.resolvedLanguage || i18n.language);
  const [storyState, setStoryState] = useState<StoryState>(() => storyDirectorEngine.getState());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProviderConfigOpen, setIsProviderConfigOpen] = useState(false);
  const [cameraTasksDone, setCameraTasksDone] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [bubble, setBubble] = useState<BubbleState>(() => vrmEngine.bubbleTracker.state);
  const hasStartedRef = useRef(false);

  // 订阅 BubbleTracker 气泡状态 (完全复用原生状态，与日常模式保持 100% 同构)
  useEffect(() => {
    const unsub = vrmEngine.subscribeBubbleChange((state) => {
      setBubble({ ...state });
    });
    return () => {
      unsub();
    };
  }, []);

  // 初始化 i18n 引用与状态订阅 (带 hasStarted 防御，严防挂载期未启动即误触 onComplete)
  useEffect(() => {
    storyDirectorEngine.setI18n(i18n);
    const unsub = storyDirectorEngine.subscribe((state) => {
      setStoryState({ ...state });
      if (state.isActive) {
        hasStartedRef.current = true;
      } else if (hasStartedRef.current && onComplete) {
        // 唯有真正启动并由运行态转入结束态时才触发回调
        onComplete();
      }
    });

    const handleOpenProviderConfig = () => setIsProviderConfigOpen(true);
    window.addEventListener('xc-open-provider-config', handleOpenProviderConfig);

    return () => {
      unsub();
      window.removeEventListener('xc-open-provider-config', handleOpenProviderConfig);
    };
  }, [i18n, onComplete]);

  // 组件挂载时自动启动指定剧本 (严防外部已触发 playScript 时重复拉起导致 executionSequence 竞争)
  useEffect(() => {
    const cur = storyDirectorEngine.getState();
    if (!cur.isActive || cur.scriptId !== script.id) {
      void storyDirectorEngine.playScript(script);
    }
  }, [script]);

  // 处理自定义 AI 模型配置弹窗关闭回调
  const handleProviderConfigOpenChange = useCallback((open: boolean) => {
    setIsProviderConfigOpen(open);
    if (!open) {
      // 用户完成/关闭自定义模型配置后，自动推进至终章
      void storyDirectorEngine.goToBeat('beat_finale');
    }
  }, []);

  // 处理视角探索任务更新
  const handleCameraTasksUpdate = useCallback((completed: number, total: number) => {
    setCameraTasksDone(completed >= total);
  }, []);

  // 处理分支卡片点击
  const handleSelectChoice = useCallback(
    async (choice: StoryChoice) => {
      if (isGenerating) return;

      // 如果是换装试穿或场景试选预览动作，只驱动换装/场景切换预览，保留在当前拍自由试选
      if (
        choice.actionType === 'swap_outfit' ||
        (choice.actionType === 'change_scene' && !choice.nextBeatId)
      ) {
        await storyDirectorEngine.selectChoice(choice);
        return;
      }

      // 如果是打开 AI 模型配置弹窗
      if (choice.actionType === 'open_provider_config') {
        setIsProviderConfigOpen(true);
        return;
      }

      // 如果有结束动作
      if (choice.actionType === 'finish') {
        storyDirectorEngine.finish();
        onComplete?.();
        return;
      }

      // 如果选项指定了 nextBeatId，直接由引擎跳转
      if (choice.nextBeatId) {
        await storyDirectorEngine.selectChoice(choice);
        return;
      }

      // 否则将用户的选项作为意图，让 AI 生成下一拍
      setIsGenerating(true);
      try {
        await storyDirectorEngine.selectChoice(choice);
        await storyGenerator.generateAndPlayNextBeat({
          userInput: `用户选择了: "${choice.text}" (${choice.subText || ''})`,
          isInterruption: false,
        });
      } finally {
        setIsGenerating(false);
      }
    },
    [isGenerating, onComplete],
  );

  // 提交自由文本对话 / 插话 (复用 ChatBar onSend)
  const handleSendInput = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isGenerating) return;

      setIsGenerating(true);

      const wasSpeaking = storyState.isSpeaking;
      const interruptedSpeech = storyState.currentBeat?.actor.speechText || '';

      if (wasSpeaking) {
        // 全双工打断：立刻截停
        storyDirectorEngine.interrupt();
        storyGenerator.recordInterruption(interruptedSpeech, trimmed);
      }

      try {
        await storyGenerator.generateAndPlayNextBeat({
          userInput: trimmed,
          isInterruption: wasSpeaking,
          interruptedSpeech,
        });
      } finally {
        setIsGenerating(false);
      }
    },
    [isGenerating, storyState.isSpeaking, storyState.currentBeat],
  );

  // 跳过或退出故事模式
  const handleSkipOrExit = useCallback(() => {
    storyDirectorEngine.finish();
    onComplete?.();
  }, [onComplete]);

  const currentBeat = storyState.currentBeat;
  const showInput = Boolean(currentBeat?.allowInput);

  // 跟踪当前拍是否已开声发音：严格遵循“有语音才展示”的统一原生逻辑，杜绝发声前提前贴出文字
  const [hasSpokenInBeat, setHasSpokenInBeat] = useState(false);
  const prevBeatIdRef = useRef<string | null>(null);
  const wasSpeakingInBeatRef = useRef(false);

  useEffect(() => {
    const currentBeatId = storyState.currentBeat?.id || null;
    if (currentBeatId !== prevBeatIdRef.current) {
      prevBeatIdRef.current = currentBeatId;
      setHasSpokenInBeat(false);
      wasSpeakingInBeatRef.current = false;
    }
  }, [storyState.currentBeat?.id]);

  useEffect(() => {
    // 唯有当底层 ChatDirector 真正开声播报 (statusKey === 'speaking' 且有台词) 或 TTS 降级可用时才激活展示
    const isAudiblySpeaking =
      (bubble.statusKey === 'speaking' || bubble.statusKey === 'ttsUnavailable') &&
      Boolean(bubble.speechText);
    if (isAudiblySpeaking) {
      setHasSpokenInBeat(true);
    }
  }, [bubble.statusKey, bubble.speechText]);

  // 状态感知：跟踪本拍是否曾进入说话状态，在说话彻底结束时兜底维持展示，杜绝台词说完全句后突兀消失
  useEffect(() => {
    if (storyState.isSpeaking) {
      wasSpeakingInBeatRef.current = true;
    } else if (wasSpeakingInBeatRef.current && Boolean(currentBeat?.actor.speechText)) {
      setHasSpokenInBeat(true);
    }
  }, [storyState.isSpeaking, currentBeat?.actor.speechText]);

  // 获取当前拍对应的台词文本 (在播放完毕后持续保持，绝不在说完全句后突兀消失，交互完全统一)
  const currentSpeechText = useMemo(() => {
    return bubble.speechText || currentBeat?.actor.speechText || '';
  }, [bubble.speechText, currentBeat?.actor.speechText]);

  // 在视角教学拍中，根据任务完成度动态丰富下一步选项文案
  const displayChoices = useMemo(() => {
    if (currentBeat?.interaction === 'camera_drag') {
      return storyState.choices.map((c) => {
        if (c.id === 'camera_done' || c.id === 'look_done') {
          return {
            ...c,
            text: cameraTasksDone ? t('story.cameraAllDone') : c.text,
            subText: cameraTasksDone ? t('story.cameraAllDoneSub') : c.subText,
          };
        }
        return c;
      });
    }
    return storyState.choices;
  }, [currentBeat?.interaction, storyState.choices, cameraTasksDone, t]);

  // 判断是否为图文媒体网格展台布局 (如换装教学拍)
  const isMediaGrid = useMemo(() => {
    if (currentBeat?.choiceLayout === 'grid') return true;
    return displayChoices.some((c) => Boolean(c.image));
  }, [currentBeat?.choiceLayout, displayChoices]);

  // 对白卡展示逻辑：当前拍已开声发音且有台词（播毕后持续保持），或展开了对白回顾时挂载
  const showDialogue =
    ((hasSpokenInBeat && Boolean(currentSpeechText.trim())) || isHistoryExpanded) &&
    !storyState.isIntertitleActive;

  // 统一交互分支卡片群渲染 (PC 侧栏与 Mobile 底部共用单一 SSOT，消除 60+ 行重复代码)
  const renderChoices = () => {
    if (currentBeat?.interaction === 'camera_drag') {
      return (
        <div className="w-full flex flex-col gap-2">
          <StoryCameraTaskCard onTasksUpdate={handleCameraTasksUpdate} />
          {displayChoices.length > 0 && (
            <StoryChoiceGroup
              choices={displayChoices}
              layout="list"
              onSelect={handleSelectChoice}
              disabled={isGenerating}
            />
          )}
        </div>
      );
    }

    if (isMediaGrid && displayChoices.length > 0) {
      return (
        <div className="w-full flex flex-col gap-1.5">
          <StoryChoiceGroup
            choices={displayChoices}
            layout="compact-media"
            onSelect={handleSelectChoice}
            disabled={isGenerating}
          />
          {currentBeat?.confirmChoice && (
            <StoryChoiceCard
              choice={currentBeat.confirmChoice}
              index={displayChoices.length}
              layout="list"
              variant="primary"
              onSelect={handleSelectChoice}
              disabled={isGenerating}
            />
          )}
        </div>
      );
    }

    if (displayChoices.length > 0) {
      return (
        <div className="w-full flex flex-col gap-1.5">
          <StoryChoiceGroup
            choices={displayChoices}
            layout="list"
            onSelect={handleSelectChoice}
            disabled={isGenerating}
          />
          {currentBeat?.confirmChoice && (
            <StoryChoiceCard
              choice={currentBeat.confirmChoice}
              index={displayChoices.length}
              layout="list"
              variant="primary"
              onSelect={handleSelectChoice}
              disabled={isGenerating}
            />
          )}
        </div>
      );
    }

    return null;
  };

  // 渲染高质感纯净电影条 (直接复用 ChatBubble variant="cinematic"，0 冗余)
  const renderDialogueBubble = (maxWidthClass = 'max-w-lg sm:max-w-xl w-full') => {
    if (!showDialogue) return null;
    return (
      <ChatBubble
        isStatic
        variant="cinematic"
        placement="bottom"
        maxWidthClass={maxWidthClass}
        state={bubble}
        speechText={currentSpeechText}
        isSpeaking={storyState.isSpeaking}
        extraHeaderAction={
          storyState.history.length > 0 ? (
            <button
              type="button"
              onClick={() => setIsHistoryExpanded((prev) => !prev)}
              className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/15 active:scale-95 text-white/80 hover:text-white border border-white/10 text-[11px] transition-all duration-150 cursor-pointer shadow-sm backdrop-blur-md"
            >
              <span>{isHistoryExpanded ? t('story.historyCollapse') : t('story.historyOpen', { count: storyState.history.length })}</span>
              {isHistoryExpanded ? (
                <ChevronUp className="w-3 h-3 opacity-70" />
              ) : (
                <ChevronDown className="w-3 h-3 opacity-70" />
              )}
            </button>
          ) : undefined
        }
      >
        {isHistoryExpanded && (
          <div className="max-h-56 sm:max-h-64 overflow-y-auto space-y-3 pr-1.5 custom-bubble-scrollbar pt-2 pb-1 animate-in fade-in duration-200">
            {storyState.history.map((item, idx) => {
              const isUser = item.role === 'user';
              if (isUser) {
                return (
                  <div key={item.id || idx} className="flex flex-col items-end gap-1 w-full pl-8">
                    <span className="text-[10px] font-semibold text-sky-300 pr-1 select-none">
                      {t('story.you')}
                    </span>
                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/20 border border-primary/35 px-3 py-2 text-xs text-white leading-relaxed shadow-sm">
                      <p className="break-words select-text">{item.text}</p>
                      {item.subText && (
                        <p className="text-[10px] text-white/50 mt-1 border-t border-white/10 pt-1">
                          {item.subText}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }

              // 小蠢对话 (居左展示)
              return (
                <div key={item.id || idx} className="flex flex-col items-start gap-1 w-full pr-8">
                  <span className="text-[10px] font-semibold text-primary-light pl-1 select-none">
                    {t('story.xiaochun')}
                  </span>
                  <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/[0.07] border border-white/10 px-3 py-2 text-xs text-white/95 leading-relaxed shadow-sm">
                    <p className="break-words select-text">{item.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ChatBubble>
    );
  };

  return (
    <div className="fixed inset-0 z-40 pointer-events-none select-none font-sans antialiased">
      {/* 1. 21:9 电影遮幅、黑幕白字与第一人称睁眼蒙版 */}
      <StoryCinematicOverlay
        isLetterboxActive={storyState.isLetterboxActive}
        isIntertitleActive={storyState.isIntertitleActive}
        intertitleText={storyState.intertitleText}
        intertitleStyle={storyState.intertitleStyle}
        intertitleRequiresClick={storyState.intertitleRequiresClick}
        isEyeBlinkActive={storyState.isEyeBlinkActive}
        transitionKind={storyState.transitionKind}
        isTransitionCovered={storyState.isTransitionCovered}
        grading={storyState.grading}
        onSkipIntertitle={() => storyDirectorEngine.skipIntertitle()}
      />

      {/* 2. 顶部微拟态控制面板 (Top HUD) */}
      <div className="pointer-events-auto fixed top-3 inset-x-4 sm:top-3.5 sm:inset-x-8 z-40 flex items-center justify-between">
        {/* 左侧：章节标题 */}
        <div className="flex items-center px-3.5 py-1.5 rounded-full bg-[#0b0e1b]/80 backdrop-blur-xl border border-white/15 text-white shadow-lg">
          <span className="text-xs sm:text-sm font-medium tracking-wide">
            {resolveLocalized(script.title, uiLang)}
          </span>
        </div>

        {/* 右侧：整合进度指示与跳过动作胶囊 */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleSkipOrExit}
            className="flex items-center space-x-2 pl-2 pr-3 py-1.5 rounded-full bg-[#0b0e1b]/80 hover:bg-[#151b33] active:scale-95 backdrop-blur-xl border border-white/15 text-white/90 hover:text-white text-xs sm:text-sm transition-all duration-200 shadow-lg cursor-pointer"
          >
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-white/80 font-mono">
              {storyState.progress.current} / {storyState.progress.total}
            </span>
            <span>{t('story.skip')}</span>
            <X className="w-3.5 h-3.5 opacity-70" />
          </button>
        </div>
      </div>

      {/* 沉浸式电影底部遮光层：横跨屏幕底部的无截断全局渐变遮罩 (inset-x-0 bottom-0)，消除中间孤立切断，确保台词自然浮现 */}
      {showDialogue && (
        <div
          className={`pointer-events-none fixed bottom-0 inset-x-0 z-30 transition-all duration-500 ease-out animate-in fade-in duration-300 ${
            isHistoryExpanded
              ? 'h-80 sm:h-96 bg-gradient-to-t from-black/92 via-black/60 to-transparent'
              : 'h-36 sm:h-48 bg-gradient-to-t from-black/85 via-black/45 to-transparent'
          }`}
        />
      )}

      {/* 3. PC 宽屏专属一体化布局 (纯净电影条居中沉底 + 全部交互卡片统一定位于右侧且高于底部电影条，杜绝遮挡) */}
      <div className="hidden sm:block">
        {/* PC 宽屏中央沉底电影条 (唯一的对白展示，复用 HeadBubble variant="cinematic"，0 重复) */}
        {showDialogue && (
          <div className="pointer-events-none fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-lg md:max-w-xl w-full px-4 flex justify-center animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="pointer-events-auto w-full">
              {renderDialogueBubble()}
            </div>
          </div>
        )}

        {/* PC 宽屏右侧统一交互列 (全部卡片：选项 / 视角任务 / 换装 / 场景 统一定位于右侧，高度抬升避让底部电影条，z-50 防遮挡) */}
        <div
          className={`pointer-events-none fixed right-6 sm:right-8 ${
            showDialogue ? 'bottom-28 sm:bottom-32' : 'bottom-8 sm:bottom-10'
          } w-72 sm:w-80 z-50 flex flex-col gap-2 animate-in fade-in slide-in-from-right-4 duration-300 max-h-[calc(100vh-140px)] transition-all`}
        >
          <div className="pointer-events-auto w-full flex flex-col gap-2 max-h-[calc(100vh-150px)] overflow-y-auto custom-bubble-scrollbar p-1.5 -m-1.5">
            {renderChoices()}
            {showInput && (
              <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
                <ChatBar
                  isStatic
                  onSend={handleSendInput}
                  disabled={isGenerating}
                  placeholder={
                    storyState.isSpeaking
                      ? t('story.interruptPlaceholder')
                      : currentBeat?.inputPlaceholder || t('story.inputPlaceholder')
                  }
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. 移动竖屏专属一体化沉底流 (选项群占满宽度且位于最下方电影条的正上方，层级分明杜绝遮挡) */}
      <div className="pointer-events-none flex sm:hidden fixed inset-x-3 bottom-3 z-50 flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300 max-h-[85vh]">
        <div className="pointer-events-auto w-full flex flex-col gap-2 max-h-[55vh] overflow-y-auto custom-bubble-scrollbar p-1.5 -m-1.5">
          {renderChoices()}
          {showInput && (
            <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
              <ChatBar
                isStatic
                onSend={handleSendInput}
                disabled={isGenerating}
                placeholder={
                  storyState.isSpeaking
                    ? t('story.interruptPlaceholder')
                    : currentBeat?.inputPlaceholder || t('story.inputPlaceholder')
                }
              />
            </div>
          )}
        </div>

        {/* 移动端最下方沉底纯净电影条 */}
        {showDialogue && (
          <div className="pointer-events-auto w-full">
            {renderDialogueBubble('w-full')}
          </div>
        )}
      </div>

      {/* 5. 大语言模型配置面板 (接入自定义 AI 模型时呼出) */}
      <ProviderConfigDialog
        open={isProviderConfigOpen}
        onOpenChange={handleProviderConfigOpenChange}
      />
    </div>
  );
};
