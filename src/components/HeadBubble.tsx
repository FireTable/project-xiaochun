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
  const isSpeaking = state.statusKey === 'speaking';

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
            className={`flex items-center justify-center gap-1.5 text-[11px] font-medium tracking-wide shrink-0 ${state.isError ? 'text-rose-400 font-semibold' : 'text-brand-300'
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
            {/* 多段流式朗读进度指示胶囊 (并排放在 来啦来啦~ 旁边) */}
            {isSpeaking && state.totalSegments && state.totalSegments > 1 && state.segmentIndex ? (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/10 text-[10px] font-medium text-brand-200 tracking-wider inline-flex items-center gap-1 border border-white/10 shadow-sm backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-white font-bold">{state.segmentIndex}</span>
                <span className="opacity-40 text-[9px]">/</span>
                <span className="text-slate-300">{state.totalSegments}</span>
              </span>
            ) : null}
          </div>
        )}
        {/* 只有在“来啦来啦～” (speaking) 状态时才展示文本，其他时候仅展示状态提示 */}
        {isSpeaking && state.speechText && (
          <div
            className={`text-sm font-medium text-white leading-snug break-words max-h-[calc(5*1.375em)] overflow-y-auto pr-1.5 pl-0.5 select-text custom-bubble-scrollbar pointer-events-auto ${state.speechText.length > 30 ? 'text-left' : 'text-center'
              }`}
          >
            {state.speechText}
          </div>
        )}
        {/* 对话框微光小尾巴 — 倒三角，位于气泡底部外侧向下延伸，描边与气泡边框及光晕完美融合 */}
        <svg
          aria-hidden="true"
          className="absolute top-[calc(100%+1px)] left-1/2 -translate-x-1/2 w-3.5 h-2 overflow-visible pointer-events-none z-10"
          viewBox="0 0 14 8"
          fill="none"
        >
          {/* 填充：顶部向上延伸 1px 覆盖住气泡底边框，气泡内部与小尾巴完全连通 */}
          <path
            d="M-0.5 -1 L14.5 -1 L14 0 L7 7.5 L0 0 Z"
            className="fill-slate-950"
          />
          {/* 光晕外描边：与气泡 ring-1 ring-brand-400/30 严丝合缝 */}
          <path
            d="M0 0 L7 7.5 L14 0"
            stroke="rgba(234, 131, 119, 0.30)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* 核心边框描边：与气泡 border-white/20 严格对齐一致 */}
          <path
            d="M0 0 L7 7.5 L14 0"
            stroke="rgba(255, 255, 255, 0.20)"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
};
