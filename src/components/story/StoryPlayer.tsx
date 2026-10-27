import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  CornerDownLeft,
} from 'lucide-react';
import { StoryCinematicOverlay } from './StoryCinematicOverlay';
import { StoryChoiceGroup } from './StoryChoiceGroup';
import { StoryChoiceCard } from './StoryChoiceCard';
import { StoryCameraTaskCard } from './StoryCameraTaskCard';
import { StoryRecapCard } from './StoryRecapCard';
import { ProviderConfigDialog } from '@/components/ProviderConfigDialog';
import { storyDirectorEngine, type StoryState } from '@/story/storyEngine';
import { storyGenerator } from '@/story/storyGenerator';
import { prologueStory } from '@/story/prologueStory';
import type { StoryScript, StoryChoice } from '@/story/schema';

interface StoryPlayerProps {
  script?: StoryScript;
  onComplete?: () => void;
}

export const StoryPlayer: React.FC<StoryPlayerProps> = ({
  script = prologueStory,
  onComplete,
}) => {
  const { i18n } = useTranslation();
  const [storyState, setStoryState] = useState<StoryState>(() => storyDirectorEngine.getState());
  const [userInput, setUserInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProviderConfigOpen, setIsProviderConfigOpen] = useState(false);
  const [cameraTasksDone, setCameraTasksDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasStartedRef = useRef(false);

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

      // 如果是换装试穿动作，只驱动换装与全身展示，保留在当前拍自由试穿
      if (choice.actionType === 'swap_outfit') {
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

  // 提交自由文本对话 / 插话
  const handleSendInput = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      const text = userInput.trim();
      if (!text || isGenerating) return;

      setUserInput('');
      setIsGenerating(true);

      const wasSpeaking = storyState.isSpeaking;
      const interruptedSpeech = storyState.currentBeat?.actor.speechText || '';

      if (wasSpeaking) {
        // 全双工打断：立刻截停
        storyDirectorEngine.interrupt();
        storyGenerator.recordInterruption(interruptedSpeech, text);
      }

      try {
        await storyGenerator.generateAndPlayNextBeat({
          userInput: text,
          isInterruption: wasSpeaking,
          interruptedSpeech,
        });
      } finally {
        setIsGenerating(false);
      }
    },
    [userInput, isGenerating, storyState.isSpeaking, storyState.currentBeat],
  );

  // 跳过或退出故事模式
  const handleSkipOrExit = useCallback(() => {
    storyDirectorEngine.finish();
    onComplete?.();
  }, [onComplete]);

  const currentBeat = storyState.currentBeat;
  const speechText = currentBeat?.actor.speechText;
  const showInput = Boolean(currentBeat?.allowInput);

  // 在视角教学拍中，根据任务完成度动态丰富下一步选项文案
  const displayChoices = useMemo(() => {
    if (currentBeat?.interaction === 'camera_drag') {
      return storyState.choices.map((c) => {
        if (c.id === 'camera_done') {
          return {
            ...c,
            text: cameraTasksDone ? '🎉 全部视角探索完成，前往下一步！' : c.text,
            subText: cameraTasksDone ? '视角操控已全部解锁掌握' : c.subText,
          };
        }
        return c;
      });
    }
    return storyState.choices;
  }, [currentBeat?.interaction, storyState.choices, cameraTasksDone]);

  // 判断是否为图文媒体网格展台布局 (如换装教学拍)
  const isMediaGrid = useMemo(() => {
    if (currentBeat?.choiceLayout === 'grid') return true;
    return displayChoices.some((c) => Boolean(c.image));
  }, [currentBeat?.choiceLayout, displayChoices]);

  // 前情提要严格与选项组/任务交互卡片同步挂载；说话期间由 3D 头顶气泡承载，不在底部提前抢跑
  const hasInteractiveElement =
    displayChoices.length > 0 ||
    currentBeat?.interaction === 'camera_drag' ||
    (showInput && !storyState.isSpeaking);

  const showRecap =
    !storyState.isSpeaking &&
    hasInteractiveElement &&
    Boolean(speechText || storyState.history.length > 0);

  return (
    <div className="fixed inset-0 z-40 pointer-events-none select-none font-sans antialiased">
      {/* 1. 21:9 电影遮幅、黑幕白字与第一人称睁眼蒙版 (半透明渐变过渡，绝不生硬裁切) */}
      <StoryCinematicOverlay
        isLetterboxActive={storyState.isLetterboxActive}
        isIntertitleActive={storyState.isIntertitleActive}
        intertitleText={storyState.intertitleText}
        intertitleStyle={storyState.intertitleStyle}
        isEyeBlinkActive={storyState.isEyeBlinkActive}
        onSkipIntertitle={() => storyDirectorEngine.skipIntertitle()}
      />

      {/* 2. 顶部微拟态控制面板 (Top HUD) */}
      <div className="pointer-events-auto fixed top-3 inset-x-4 sm:top-3.5 sm:inset-x-8 z-40 flex items-center justify-between">
        {/* 左侧：章节标题 */}
        <div className="flex items-center px-3.5 py-1.5 rounded-full bg-[#0b0e1b]/80 backdrop-blur-xl border border-white/15 text-white shadow-lg">
          <span className="text-xs sm:text-sm font-medium tracking-wide">
            {script.title}
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
            <span>跳过</span>
            <X className="w-3.5 h-3.5 opacity-70" />
          </button>
        </div>
      </div>

      {/* 3. 核心交互流分层排布 */}

      {/* 3A. 视角探索教学拍 (居中引导任务卡片 + 对白自然沉底) */}
      {currentBeat?.interaction === 'camera_drag' && (
        <div className="pointer-events-none fixed inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 bottom-3 sm:bottom-6 z-40 max-w-xl sm:max-w-2xl w-full flex flex-col gap-2.5">
          <StoryCameraTaskCard onTasksUpdate={handleCameraTasksUpdate} />
          {displayChoices.length > 0 && (
            <div className="pointer-events-auto w-full">
              <StoryChoiceGroup
                choices={displayChoices}
                layout="list"
                onSelect={handleSelectChoice}
                disabled={isGenerating}
              />
            </div>
          )}
          {showRecap && (
            <div className="pointer-events-auto w-full">
              <StoryRecapCard
                currentSpeechText={speechText}
                history={storyState.history}
              />
            </div>
          )}
        </div>
      )}

      {/* 3B. 换装多媒体展台拍 (居中 3 列并排展台 + 统一确认按钮 + 对白沉底，保证新手换装教学流畅完整) */}
      {isMediaGrid && currentBeat?.interaction !== 'camera_drag' && displayChoices.length > 0 && (
        <div className="pointer-events-none fixed inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 bottom-3 sm:bottom-6 z-40 max-w-xl sm:max-w-2xl w-full flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="pointer-events-auto w-full flex flex-col gap-2.5">
            <StoryChoiceGroup
              choices={displayChoices}
              layout="grid"
              onSelect={handleSelectChoice}
              disabled={isGenerating}
            />
            {currentBeat?.confirmChoice && (
              <div className="w-full">
                <StoryChoiceCard
                  choice={currentBeat.confirmChoice}
                  index={displayChoices.length}
                  layout="list"
                  variant="primary"
                  onSelect={handleSelectChoice}
                  disabled={isGenerating}
                />
              </div>
            )}
          </div>
          {showRecap && (
            <div className="pointer-events-auto w-full">
              <StoryRecapCard
                currentSpeechText={speechText}
                history={storyState.history}
              />
            </div>
          )}
        </div>
      )}

      {/* 3C. PC 方案 6：普通文字分支 + 自由输入 右悬浮融合流 (PC 宽屏下：中央沉底对白 + 右侧悬浮选项与输入) */}
      {!isMediaGrid && currentBeat?.interaction !== 'camera_drag' && (
        <>
          {/* PC 宽屏中央沉底对白 */}
          {showRecap && (
            <div className="pointer-events-none hidden sm:block fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-xl sm:max-w-2xl w-full px-4">
              <StoryRecapCard
                currentSpeechText={speechText}
                history={storyState.history}
              />
            </div>
          )}

          {/* PC 宽屏右侧悬浮选项群与打字框 */}
          {(displayChoices.length > 0 || showInput) && (
            <div className="pointer-events-none hidden sm:flex fixed sm:right-8 sm:bottom-24 md:right-12 md:bottom-28 sm:w-80 md:w-88 z-40 flex-col gap-2.5 animate-in fade-in slide-in-from-right-4 duration-300">
              {displayChoices.length > 0 && (
                <div className="pointer-events-auto w-full flex flex-col gap-2">
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
              )}

              {/* PC 端融合自由输入条 */}
              {showInput && (
                <div className="pointer-events-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <form
                    onSubmit={handleSendInput}
                    className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-[#0b0e1b]/85 hover:bg-[#101426]/95 backdrop-blur-xl border border-white/15 focus-within:border-[#f3d09a] focus-within:ring-1 focus-within:ring-[#f3d09a]/40 shadow-[0_8px_32px_rgba(0,0,0,0.6)] transition-all duration-200"
                  >
                    <input
                      ref={inputRef}
                      type="text"
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      disabled={isGenerating}
                      placeholder={
                        storyState.isSpeaking
                          ? '直接输入打断...'
                          : currentBeat?.inputPlaceholder || '输入对话或自选动作...'
                      }
                      className="flex-1 bg-transparent px-1.5 text-xs text-white placeholder-white/40 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!userInput.trim() || isGenerating}
                      className="p-1.5 rounded-lg bg-[#f3d09a] hover:bg-[#fdf2dd] active:scale-90 disabled:opacity-30 disabled:hover:bg-[#f3d09a] text-slate-950 font-bold transition-all shadow-[0_0_12px_rgba(243,208,154,0.4)] cursor-pointer"
                      title="发送"
                    >
                      {isGenerating ? (
                        <div className="w-3.5 h-3.5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CornerDownLeft className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 3D. 手机方案 4：移动竖屏专属一体化沉底流 (选项微流光胶囊 + 沉底输入条 + 沉底对白，自适应自然堆叠，0 重叠，全屏 75%+ 露白) */}
      {!isMediaGrid && currentBeat?.interaction !== 'camera_drag' && (
        <div className="pointer-events-none flex sm:hidden fixed inset-x-3 bottom-3 z-40 flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* 选项微流光胶囊群 */}
          {displayChoices.length > 0 && (
            <div className="pointer-events-auto w-full">
              <StoryChoiceGroup
                choices={displayChoices}
                layout="list"
                onSelect={handleSelectChoice}
                disabled={isGenerating}
              />
              {currentBeat?.confirmChoice && (
                <div className="mt-1.5 w-full">
                  <StoryChoiceCard
                    choice={currentBeat.confirmChoice}
                    index={displayChoices.length}
                    layout="list"
                    variant="primary"
                    onSelect={handleSelectChoice}
                    disabled={isGenerating}
                  />
                </div>
              )}
            </div>
          )}

          {/* 手机端紧凑输入条 */}
          {showInput && (
            <div className="pointer-events-auto w-full animate-in fade-in slide-in-from-bottom-1 duration-200">
              <form
                onSubmit={handleSendInput}
                className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-[#0b0e1b]/90 backdrop-blur-xl border border-white/15 focus-within:border-[#f3d09a]/70 shadow-lg"
              >
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  disabled={isGenerating}
                  placeholder={
                    storyState.isSpeaking
                      ? '输入抢话打断...'
                      : currentBeat?.inputPlaceholder || '自由说点什么...'
                  }
                  className="flex-1 bg-transparent px-1 text-xs text-white placeholder-white/40 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!userInput.trim() || isGenerating}
                  className="p-1 rounded-lg bg-[#f3d09a] hover:bg-[#fdf2dd] active:scale-90 disabled:opacity-30 disabled:hover:bg-[#f3d09a] text-slate-950 font-bold transition-all shadow cursor-pointer"
                  title="发送"
                >
                  {isGenerating ? (
                    <div className="w-3 h-3 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <CornerDownLeft className="w-3 h-3" />
                  )}
                </button>
              </form>
            </div>
          )}

          {/* 手机端沉底对白卡片 */}
          {showRecap && (
            <div className="pointer-events-auto w-full">
              <StoryRecapCard
                currentSpeechText={speechText}
                history={storyState.history}
              />
            </div>
          )}
        </div>
      )}

      {/* 5. 大语言模型配置面板 (接入自定义 AI 模型时呼出) */}
      <ProviderConfigDialog
        open={isProviderConfigOpen}
        onOpenChange={handleProviderConfigOpenChange}
      />
    </div>
  );
};
