import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain } from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { isWebLLMReady, onWebLLMReady, isThinkingEnabled, setThinkingEnabled } from '@/llm/webLLM';
import { Send, Sparkles, Loader2 } from '@/components/icons';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

function AccentFill({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-0 rounded-full bg-gradient-to-r from-[#ea8377] to-[#e06d64] transition-opacity duration-200 ${on ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}

export const ChatBar: React.FC = () => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasText, setHasText] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isQueued, setIsQueued] = useState(false);
  const queuedTextRef = useRef('');
  const [thinkingOn, setThinkingOn] = useState(() => isThinkingEnabled());

  // 模型与引擎就绪感知
  const [isVRMReady, setIsVRMReady] = useState(() => vrmEngine.isReady());
  const [isLLMReady, setIsLLMReady] = useState(() => isWebLLMReady());

  useEffect(() => {
    // 监听 3D VRM 模型就绪状态
    const unsubVRM = vrmEngine.onReadyChange((ready) => {
      setIsVRMReady(ready);
    });
    // 监听 WebLLM 神经核心 Worker 权重预热就绪状态
    const unsubLLM = onWebLLMReady(() => {
      setIsLLMReady(true);
    });

    return () => {
      unsubVRM();
      unsubLLM();
    };
  }, []);

  const isModelReady = isVRMReady && isLLMReady;

  // 智能排队机制：一旦模型加载完毕，若此前有排队中的输入，自动无缝触发发送，绝不丢字
  useEffect(() => {
    if (isModelReady && isQueued && queuedTextRef.current) {
      const toSend = queuedTextRef.current;
      queuedTextRef.current = '';
      if (inputRef.current) inputRef.current.value = '';
      setHasText(false);
      setIsQueued(false);
      setIsSending(true);

      void vrmEngine
        .sendMessage(toSend)
        .catch((e) => console.error('[ChatBar Queue] Send failed:', e))
        .finally(() => {
          setIsSending(false);
        });
    }
  }, [isModelReady, isQueued]);

  const handleSend = async () => {
    const text = inputRef.current?.value.trim() ?? '';
    if (!text || isSending) return;

    // 模型尚未完全就绪：智能转入排队状态，输入内容安全保留，不吞字
    if (!isModelReady) {
      setIsQueued(true);
      queuedTextRef.current = text;
      return;
    }

    if (inputRef.current) inputRef.current.value = '';
    setHasText(false);
    setIsQueued(false);
    setIsSending(true);

    try {
      await vrmEngine.sendMessage(text);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleInput = () => {
    const val = inputRef.current?.value ?? '';
    const nowHasText = val.trim().length > 0;
    if (nowHasText !== hasText) {
      setHasText(nowHasText);
    }
    if (isQueued) {
      queuedTextRef.current = val.trim();
      if (!val.trim()) setIsQueued(false);
    }
  };

  return (
    <div className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:bottom-8 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-3 sm:px-4 pointer-events-auto select-none">
      <div className="flex items-center gap-2 sm:gap-2.5 w-full">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              id="chat-thinking"
              aria-pressed={thinkingOn}
              aria-label={thinkingOn ? t('chat.thinkingOn') : t('chat.thinkingOff')}
              onClick={() => {
                const next = !thinkingOn;
                setThinkingOn(next);
                setThinkingEnabled(next);
              }}
              className={`relative h-11 w-11 rounded-full shrink-0 flex items-center justify-center select-none touch-manipulation active:scale-95 cursor-pointer appearance-none outline-none border-none ${
                thinkingOn
                  ? 'text-white bg-[#ea8377] shadow-[0_4px_16px_rgba(234,131,119,0.35)]'
                  : 'text-white/70 bg-[#13111c]/85 backdrop-blur-2xl shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)] hover:text-white'
              }`}
            >
              <AccentFill on={thinkingOn} />
              <Brain className="relative z-10 w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {thinkingOn ? t('chat.thinkingOn') : t('chat.thinkingOff')}
          </TooltipContent>
        </Tooltip>

        {/* 输入框主胶囊：高度严格 h-11 (44px)，非阻塞可随时聚焦输入，排队时呼吸高亮 */}
        <div
          className={`flex-1 flex items-center h-11 sm:h-11 rounded-full bg-[#13111c]/85 border shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-2xl px-3.5 sm:px-4 transition-all duration-300 ${
            isQueued
              ? 'border-[#ea8377] ring-2 ring-[#ea8377]/40 shadow-[0_0_24px_rgba(234,131,119,0.35)]'
              : 'border-white/15 focus-within:border-[#ea8377] focus-within:ring-2 focus-within:ring-[#ea8377]/30 focus-within:shadow-[0_0_24px_rgba(234,131,119,0.3)]'
          }`}
        >
          {/* 左侧状态感知指示器 */}
          {isQueued ? (
            <Loader2 className="w-4 h-4 text-[#ea8377] animate-spin shrink-0 mr-2 sm:mr-2.5" />
          ) : !isModelReady ? (
            <div className="flex items-center gap-1 shrink-0 mr-2 sm:mr-2.5">
              <Sparkles className="w-4 h-4 text-[#f5aa9c] animate-pulse shrink-0 opacity-90" />
              <span className="hidden sm:inline-block text-[9px] font-mono font-bold text-[#f5aa9c] bg-[#ea8377]/15 border border-[#ea8377]/30 px-1 py-0.2 rounded uppercase">
                SYNC
              </span>
            </div>
          ) : (
            <Sparkles className="w-4 h-4 text-[#ea8377] shrink-0 mr-2 sm:mr-2.5 opacity-90 animate-pulse" />
          )}

          <input
            ref={inputRef}
            type="text"
            id="chatText"
            placeholder={isModelReady ? t('chat.placeholder') : t('chat.syncingPlaceholder')}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            disabled={isSending}
            className="w-full h-full bg-transparent border-none outline-none text-white placeholder:text-white/40 text-sm sm:text-sm touch-manipulation select-text"
          />
        </div>

        {/* 发送按钮：高度严格 h-11 (44px)，状态随就绪度与排队状态联动 */}
        <button
          id="chatSend"
          type="button"
          onClick={() => void handleSend()}
          disabled={isSending || !hasText}
          className={`relative h-11 sm:h-11 px-4 sm:px-5 rounded-full font-medium text-sm flex items-center justify-center gap-1.5 shrink-0 select-none touch-manipulation active:scale-95 appearance-none outline-none border-none ${
            isSending
              ? 'bg-[#13111c]/85 text-white/50 cursor-wait'
              : isQueued || hasText
              ? 'text-white bg-[#ea8377] shadow-[0_4px_16px_rgba(234,131,119,0.35)] cursor-pointer'
              : 'text-white/40 bg-[#13111c]/85 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)] cursor-not-allowed'
          }`}
        >
          <AccentFill on={!isSending && (isQueued || hasText)} />
          <span className="relative z-10 flex items-center gap-1.5">
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>{t('chat.sending')}</span>
              </>
            ) : isQueued ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>{t('chat.queued')}</span>
              </>
            ) : hasText && !isModelReady ? (
              <>
                <Sparkles className="w-4 h-4 text-white animate-pulse" />
                <span>{t('chat.queueSend')}</span>
              </>
            ) : (
              <>
                <Send className={`w-4 h-4 ${hasText ? 'text-white' : 'text-white/40'}`} />
                <span>{t('chat.send')}</span>
              </>
            )}
          </span>
        </button>
      </div>
    </div>
  );
};
