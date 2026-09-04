import React, { useState, useEffect, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import {
  isWebLLMReady,
  onWebLLMReadyChange,
  isThinkingEnabled,
  setThinkingEnabled,
  onLlmLoadProgress,
  getLlmLoadProgress,
  getActiveModelId,
  setActiveModelId,
  listModelGroups,
  modelBaseId,
} from '@/llm/transformersLLM';
import { Send, Sparkles, Loader2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { LlmProviderIcon } from '@/components/LlmProviderIcon';

function MenuSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
        on ? 'bg-[#ea8377]' : 'bg-white/20'
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </span>
  );
}

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
  const [activeModel, setActiveModel] = useState(() => getActiveModelId());
  const [pickingModel, setPickingModel] = useState(false);
  const llmGroups = listModelGroups();
  const activeBase = modelBaseId(activeModel);
  const thinkingSupported = activeBase.startsWith('Qwen3');

  // 模型与引擎就绪感知
  const [isVRMReady, setIsVRMReady] = useState(() => vrmEngine.isReady());
  const [isLLMReady, setIsLLMReady] = useState(() => isWebLLMReady());
  const [llmProgress, setLlmProgress] = useState(() => getLlmLoadProgress());

  useEffect(() => {
    // 监听 3D VRM 模型就绪状态
    const unsubVRM = vrmEngine.onReadyChange((ready) => {
      setIsVRMReady(ready);
    });
    const unsubLLM = onWebLLMReadyChange((ready) => {
      setIsLLMReady(ready);
    });
    const unsubProgress = onLlmLoadProgress((p) => {
      setLlmProgress(p);
    });

    return () => {
      unsubVRM();
      unsubLLM();
      unsubProgress();
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

    inputRef.current?.blur();

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
        <DropdownMenu onOpenChange={(open) => { if (!open) setPickingModel(false); }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  id="chat-menu"
                  variant="glass"
                  size="icon"
                  aria-label={t('chat.chatMenu')}
                  className="h-11 w-11 shrink-0"
                >
                  <Menu className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">{t('chat.chatMenu')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            side="top"
            align="start"
            collisionPadding={12}
            className="w-[min(18rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-x-hidden"
          >
            {pickingModel ? (
              <>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setPickingModel(false);
                  }}
                >
                  <ChevronLeft className="h-4 w-4 shrink-0 text-white/50" />
                  <span className="flex-1">{t('chat.switchModel')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div className="max-h-[min(18rem,50dvh)] overflow-x-hidden overflow-y-auto">
                  {llmGroups.map((group, i) => (
                    <Fragment key={group.provider}>
                      {i > 0 ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuLabel className="flex min-w-0 items-center gap-2 normal-case tracking-normal">
                        <LlmProviderIcon name={group.provider} />
                        <span className="truncate">{group.provider}</span>
                      </DropdownMenuLabel>
                      {group.models.map((m) => {
                        const selected = modelBaseId(m.id) === activeBase;
                        return (
                          <DropdownMenuItem
                            key={m.id}
                            disabled={isSending}
                            onSelect={() => {
                              if (selected) return;
                              setActiveModel(m.id);
                              setActiveModelId(m.id);
                            }}
                            className="min-w-0 justify-between"
                          >
                            <span className="min-w-0 flex-1 truncate">{m.label}</span>
                            {selected ? <span className="shrink-0 text-brand-300 text-xs">✓</span> : null}
                          </DropdownMenuItem>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </>
            ) : (
              <>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setPickingModel(true);
                  }}
                  className="justify-between"
                >
                  <span>{t('chat.switchModel')}</span>
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="max-w-[7.5rem] truncate text-xs text-white/50">{activeBase}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-white/50" />
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!thinkingSupported}
                  aria-checked={thinkingOn}
                  onSelect={(e) => {
                    e.preventDefault();
                    const next = !thinkingOn;
                    setThinkingOn(next);
                    setThinkingEnabled(next);
                  }}
                  className="justify-between"
                >
                  <span>{t('chat.thinkingMode')}</span>
                  <MenuSwitch on={thinkingOn} />
                </DropdownMenuItem>
                <p className="px-2.5 pb-1.5 text-[10px] leading-snug text-white/40">
                  {t('chat.thinkingHint')}
                </p>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

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
        {(() => {
          const llmPct = Math.round(Math.min(1, Math.max(0, llmProgress.progress)) * 100);
          const waitTooltip = (
            <div className="flex flex-col gap-0.5 max-w-[16rem]">
              {!isVRMReady ? <span>{t('chat.waitVrm')}</span> : null}
              {!isLLMReady ? <span>{t('chat.waitLlm', { percent: llmPct, model: getActiveModelId() })}</span> : null}
              {!isLLMReady && llmProgress.text ? (
                <span className="text-white/50 break-all">{llmProgress.text}</span>
              ) : null}
              {isQueued ? <span className="text-white/70">{t('chat.waitReadyHint')}</span> : null}
            </div>
          );
          const sendBtn = (
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
                    <span>{t('chat.queued')}{!isLLMReady ? ` ${llmPct}%` : ''}</span>
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
          );
          if (!isQueued && !(!isModelReady && hasText)) return sendBtn;
          // ponytail: 等待就绪时按钮处于禁用态,移动端没有 hover 看不到提示,
          // 这里强制 open=true 让 tooltip 常驻,直到按钮重新可点。
          return (
            <Tooltip delayDuration={0} open={true}>
              <TooltipTrigger asChild>{sendBtn}</TooltipTrigger>
              <TooltipContent side="top">{waitTooltip}</TooltipContent>
            </Tooltip>
          );
        })()}
      </div>
    </div>
  );
};
