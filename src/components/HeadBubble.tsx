import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleState } from '@/core/vrmEngine';
import { Sparkles, Volume2, Activity, AlertCircle } from '@/components/icons';

interface HeadBubbleProps {
  state: BubbleState;
}

const ICON_BY_KEY: Record<string, 'thinking' | 'speaking' | 'emoting' | 'idle'> = {
  thinking: 'thinking',
  speaking: 'speaking',
  tts: 'speaking',
  emage: 'emoting',
};

export const HeadBubble: React.FC<HeadBubbleProps> = ({ state }) => {
  const { t } = useTranslation();
  if (!state.visible) return null;

  const iconKind = state.isError ? 'idle' : ICON_BY_KEY[state.statusKey] ?? 'idle';

  return (
    <div
      id="head-bubble"
      className="pointer-events-none fixed top-0 left-0 z-20 will-change-transform transition-transform duration-150 ease-out"
      style={{
        transform: `translate3d(calc(${state.x}px - 50%), calc(${state.y}px - 100% - 16px), 0)`,
      }}
    >
      {/* ponytail: 移动端 max-w 收紧到 240px,避免窄屏贴边;sm 起拉到 320px 让长句能展开。 */}
      <div className="relative max-w-[240px] sm:max-w-xs px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl bg-slate-950/90 border border-white/20 shadow-2xl backdrop-blur-2xl flex flex-col gap-1 text-center ring-1 ring-brand-400/30 animate-in fade-in zoom-in-95 duration-200 pointer-events-auto">
        {state.statusKey && (
          <div
            className={`flex items-center justify-center gap-1.5 text-[11px] font-medium tracking-wide shrink-0 ${
              state.isError ? 'text-rose-400 font-semibold' : 'text-brand-300'
            }`}
          >
            {state.isError ? (
              <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
            ) : iconKind === 'thinking' ? (
              <Sparkles className="w-3 h-3 text-brand-300 animate-spin shrink-0" />
            ) : iconKind === 'speaking' ? (
              <Volume2 className="w-3 h-3 text-brand-300 animate-pulse shrink-0" />
            ) : iconKind === 'emoting' ? (
              <Activity className="w-3 h-3 text-brand-300 animate-pulse shrink-0" />
            ) : (
              <Sparkles className="w-3 h-3 text-brand-300 shrink-0" />
            )}
            <span>
              {t(`bubble.${state.statusKey}`, state.statusVars as Record<string, unknown> | undefined)}
            </span>
          </div>
        )}
        {state.speechText && (
          <div
            className={`text-sm font-medium text-white leading-snug break-words max-h-[calc(5*1.375em)] overflow-y-auto pr-1.5 pl-0.5 select-text custom-bubble-scrollbar pointer-events-auto ${
              state.speechText.length > 30 ? 'text-left' : 'text-center'
            }`}
          >
            {state.speechText}
          </div>
        )}
        {/* 对话框微光小尾巴 — 纯下三角(clip-path) */}
        <div
          aria-hidden
          className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-2 bg-slate-950/90"
          style={{ clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)' }}
        />
      </div>
    </div>
  );
};
