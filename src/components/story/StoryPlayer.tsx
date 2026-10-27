import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Sparkles,
  HandMetal,
  Radio,
  CornerDownLeft,
} from 'lucide-react';
import { StoryCinematicOverlay } from './StoryCinematicOverlay';
import { StoryChoiceGroup } from './StoryChoiceGroup';
import { storyDirectorEngine, type StoryState } from '@/story/storyEngine';
import { storyGenerator } from '@/story/storyGenerator';
import { prologueStory } from '@/story/prologueStory';
import type { StoryScript, StoryChoice } from '@/story/schema';

interface StoryPlayerProps {
  script?: StoryScript;
  onComplete?: () => void;
  allowInterrupt?: boolean;
}

export const StoryPlayer: React.FC<StoryPlayerProps> = ({
  script = prologueStory,
  onComplete,
  allowInterrupt = true,
}) => {
  const { i18n } = useTranslation();
  const [storyState, setStoryState] = useState<StoryState>(() => storyDirectorEngine.getState());
  const [userInput, setUserInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 初始化 i18n 引用与状态订阅
  useEffect(() => {
    storyDirectorEngine.setI18n(i18n);
    const unsub = storyDirectorEngine.subscribe((state) => {
      setStoryState({ ...state });
      if (!state.isActive && onComplete) {
        onComplete();
      }
    });
    return unsub;
  }, [i18n, onComplete]);

  // 组件挂载时自动启动指定剧本
  useEffect(() => {
    if (!storyState.isActive || storyState.scriptId !== script.id) {
      void storyDirectorEngine.playScript(script);
    }
  }, [script]);

  // 处理分支卡片点击
  const handleSelectChoice = useCallback(
    async (choice: StoryChoice) => {
      if (isGenerating) return;

      // 如果有自定义或者内置动作
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

  // 处理全双工打断
  const handleInterrupt = useCallback(() => {
    if (!storyState.isSpeaking) return;
    const interruptedSpeech = storyState.currentBeat?.actor.speechText || '';
    storyDirectorEngine.interrupt();
    storyGenerator.recordInterruption(interruptedSpeech, '（打断了小蠢的发言）');
  }, [storyState.isSpeaking, storyState.currentBeat]);

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

  const speechText = storyState.currentBeat?.actor.speechText;
  const showSubtitles = Boolean(speechText && speechText.trim().length > 0 && !storyState.isIntertitleActive);

  return (
    <div className="fixed inset-0 z-40 pointer-events-none select-none font-sans antialiased">
      {/* 1. 21:9 电影遮幅、黑幕白字与第一人称睁眼蒙版 */}
      <StoryCinematicOverlay
        isLetterboxActive={storyState.isLetterboxActive}
        isIntertitleActive={storyState.isIntertitleActive}
        intertitleText={storyState.intertitleText}
        intertitleStyle={storyState.intertitleStyle}
        isEyeBlinkActive={storyState.isEyeBlinkActive}
        onSkipIntertitle={() => storyDirectorEngine.skipIntertitle()}
      />

      {/* 2. 顶部微拟态控制面板 (Top HUD) */}
      <div className="pointer-events-auto fixed top-4 inset-x-4 sm:top-6 sm:inset-x-8 z-50 flex items-center justify-between">
        {/* 左侧：章节信息与进度胶囊 */}
        <div className="flex items-center space-x-2.5 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white shadow-lg">
          <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
          <span className="text-xs sm:text-sm font-medium tracking-wide">
            {script.title}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/15 text-white/80 font-mono">
            {storyState.progress.current}/{storyState.progress.total}
          </span>
        </div>

        {/* 右侧：静音与退出按钮 */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleSkipOrExit}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-full bg-black/40 hover:bg-black/60 active:scale-95 backdrop-blur-md border border-white/10 text-white/90 hover:text-white text-xs sm:text-sm transition-all duration-200 shadow-lg cursor-pointer"
          >
            <span>跳过</span>
            <X className="w-3.5 h-3.5 ml-0.5 opacity-70" />
          </button>
        </div>
      </div>

      {/* 3. 核心互动区：台词字幕与晶体分支卡片 (垂直流式排布，永不重叠，在底部输入栏上方优雅悬浮) */}
      <div className="pointer-events-none fixed inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 bottom-16 sm:bottom-20 z-30 max-w-xl w-full flex flex-col gap-3">
        {/* 台词字幕卡片 (带全双工打断按钮与声波律动) */}
        {showSubtitles && (
          <div className="pointer-events-auto p-4 sm:p-5 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-300 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-gradient-to-r from-pink-500/80 to-purple-500/80 text-white tracking-wider">
                  小蠢
                </span>
                {storyState.isSpeaking && (
                  <div className="flex items-center space-x-0.5 text-pink-300">
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                    <span className="text-[11px] font-mono opacity-80">演出中...</span>
                  </div>
                )}
              </div>

              {/* 全双工打断按钮：角色说话时呈现 */}
              {storyState.isSpeaking && allowInterrupt && (
                <button
                  type="button"
                  onClick={handleInterrupt}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-pink-500/20 hover:bg-pink-500/40 text-pink-200 hover:text-white border border-pink-500/30 text-xs transition-all duration-150 active:scale-95 cursor-pointer"
                  title="立即插话打断当前台词"
                >
                  <HandMetal className="w-3 h-3" />
                  <span>插话打断</span>
                </button>
              )}
            </div>

            <p className="text-sm sm:text-base text-white/95 leading-relaxed tracking-wide font-medium drop-shadow-sm">
              {speechText}
            </p>
          </div>
        )}

        {/* 晶体分支选项组 (StoryChoiceGroup) */}
        {storyState.choices.length > 0 && (
          <div className="pointer-events-auto w-full">
            <StoryChoiceGroup
              choices={storyState.choices}
              onSelect={handleSelectChoice}
              disabled={isGenerating}
            />
          </div>
        )}
      </div>

      {/* 4. 自由互动插话条 (支持用户在任何时刻抢话改变剧情) */}
      <div className="pointer-events-auto fixed inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 bottom-3 sm:bottom-4 z-40 max-w-lg w-full">
        <form
          onSubmit={handleSendInput}
          className="flex items-center space-x-2 px-3 py-2 rounded-full bg-black/60 backdrop-blur-xl border border-white/20 shadow-2xl focus-within:border-pink-400/60 focus-within:ring-2 focus-within:ring-pink-400/20 transition-all duration-200"
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
                : '自由对小蠢说点什么，改变剧情走向...'
            }
            className="flex-1 bg-transparent px-2 text-xs sm:text-sm text-white placeholder-white/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!userInput.trim() || isGenerating}
            className="p-1.5 rounded-full bg-pink-500 hover:bg-pink-400 active:scale-90 disabled:opacity-40 disabled:hover:bg-pink-500 text-white transition-all duration-150 shadow-md"
            title="发送"
          >
            {isGenerating ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <CornerDownLeft className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
