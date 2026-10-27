import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Sparkles,
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

  // 组件挂载时自动启动指定剧本
  useEffect(() => {
    if (!storyState.isActive || storyState.scriptId !== script.id) {
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

      {/* 2. 顶部微拟态控制面板 (Top HUD, 优雅嵌入顶部遮幅半透明渐变区内) */}
      <div className="pointer-events-auto fixed top-3 inset-x-4 sm:top-3.5 sm:inset-x-8 z-40 flex items-center justify-between">
        {/* 左侧：章节信息与进度胶囊 */}
        <div className="flex items-center space-x-2.5 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-white shadow-lg">
          <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
          <span className="text-xs sm:text-sm font-medium tracking-wide">
            {script.title}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/15 text-white/80 font-mono">
            {storyState.progress.current}/{storyState.progress.total}
          </span>
        </div>

        {/* 右侧：退出/跳过按钮 */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleSkipOrExit}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-full bg-black/50 hover:bg-black/70 active:scale-95 backdrop-blur-md border border-white/10 text-white/90 hover:text-white text-xs sm:text-sm transition-all duration-200 shadow-lg cursor-pointer"
          >
            <span>跳过</span>
            <X className="w-3.5 h-3.5 ml-0.5 opacity-70" />
          </button>
        </div>
      </div>

      {/* 3. 核心互动区：前情提要卡片 + 视角探索任务卡片 + 晶体分支卡片 + 可选自由打断条 (单列垂直流式排布) */}
      <div className="pointer-events-none fixed inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 bottom-5 sm:bottom-7 z-40 max-w-xl sm:max-w-2xl w-full flex flex-col gap-3">
        {/* 前情提要卡片：严格与选项组/交互任务同步升起；说话期间由 3D 头顶气泡承载，不在底部抢跑 */}
        {showRecap && (
          <StoryRecapCard
            currentSpeechText={speechText}
            history={storyState.history}
          />
        )}

        {/* 视角探索交互任务卡片 (当当前拍启用 camera_drag 交互时展开) */}
        {currentBeat?.interaction === 'camera_drag' && (
          <StoryCameraTaskCard onTasksUpdate={handleCameraTasksUpdate} />
        )}

        {/* 分支选项组 (根据 choiceLayout 或 image 自动切换图文卡片/纯文字列表) */}
        {displayChoices.length > 0 && (
          <div className="pointer-events-auto w-full flex flex-col gap-2.5">
            <StoryChoiceGroup
              choices={displayChoices}
              layout={currentBeat?.choiceLayout || 'auto'}
              onSelect={handleSelectChoice}
              disabled={isGenerating}
            />

            {/* 确认换装/进入下一步专用主选项卡片：使用统一的 StoryChoiceCard (primary 变体)，样式与交互语言严格一致 */}
            {currentBeat?.confirmChoice && (
              <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
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

        {/* 自由插话/写回输入条：仅在当前拍明确允许 (allowInput=true) 时作为补充选项呈现 */}
        {showInput && (
          <div className="pointer-events-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
            <form
              onSubmit={handleSendInput}
              className="flex items-center space-x-2 px-3.5 py-2 sm:py-2.5 rounded-2xl bg-black/70 backdrop-blur-xl border border-white/20 focus-within:border-[#ea8377]/80 focus-within:ring-2 focus-within:ring-[#ea8377]/25 shadow-2xl transition-all duration-200"
            >
              <input
                ref={inputRef}
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                disabled={isGenerating}
                placeholder={
                  storyState.isSpeaking
                    ? '小蠢正在说话，输入内容直接抢话打断...'
                    : currentBeat?.inputPlaceholder || '自由对小蠢说点什么，改变剧情走向...'
                }
                className="flex-1 bg-transparent px-2 text-xs sm:text-sm text-white placeholder-white/40 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!userInput.trim() || isGenerating}
                className="p-1.5 rounded-xl bg-[#ea8377] hover:bg-[#ea8377]/80 active:scale-90 disabled:opacity-30 disabled:hover:bg-[#ea8377] text-white transition-all duration-150 shadow-md cursor-pointer"
                title="发送"
              >
                {isGenerating ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <CornerDownLeft className="w-3.5 h-3.5" />
                )}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* 4. 大语言模型配置面板 (接入自定义 AI 模型时呼出) */}
      <ProviderConfigDialog
        open={isProviderConfigOpen}
        onOpenChange={handleProviderConfigOpenChange}
      />
    </div>
  );
};
