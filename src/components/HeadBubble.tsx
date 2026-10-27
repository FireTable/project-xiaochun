import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { vrmEngine, type BubbleState } from '@/core/vrmEngine';
import { getBubbleTransform } from '@/core/ui/bubbleTracker';
import { Sparkles, Volume2, VolumeX, Activity, AlertCircle } from '@/components/icons';
import {
  getUserSettings,
  getCachedUserSettings,
  subscribeUserSettings,
  resolveShowHeadBubble,
} from '@/llm/userSettings';

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
  const [enabled, setEnabled] = useState(() => resolveShowHeadBubble(getCachedUserSettings()));
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getUserSettings().then((s) => {
      if (!cancelled) setEnabled(resolveShowHeadBubble(s));
    });
    const unsub = subscribeUserSettings(() => {
      setEnabled(resolveShowHeadBubble(getCachedUserSettings()));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // 动态监听气泡卡片渲染尺寸，使 BubbleTracker 防遮挡判定使用真实 DOM 高度
  useEffect(() => {
    if (!cardRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (width > 0 && height > 0) {
          vrmEngine.bubbleTracker.setMeasuredSize(width, height);
        }
      }
    });
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  // 对话设置关气泡：组件自己不画，ChatDirector / bubbleTracker 事件照发。
  if (!enabled || !state.visible) return null;

  const placement = state.placement || 'top';
  const iconKind = state.isError ? 'idle' : ICON_BY_KEY[state.statusKey] ?? 'idle';
  const isSpeaking = state.statusKey === 'speaking';
  // TTS 不可用：非错误状态；头部行换成 VolumeX + 简短提示，回复文字照常显示 (技术细节只进 console)。
  const ttsDown = state.statusKey === 'ttsUnavailable';

  return (
    <div
      id="head-bubble"
      data-placement={placement}
      className="pointer-events-none fixed top-0 left-0 z-35 will-change-transform transition-transform duration-150 ease-out"
      style={{
        transform: getBubbleTransform(placement, state.x, state.y),
      }}
    >
      {/* ponytail: 移动端 max-w 收紧到 240px,避免窄屏贴边;sm 起拉到 320px 让长句能展开。 */}
      <div
        ref={cardRef}
        style={{
          viewTransitionName: isSpeaking ? 'story-dialog-card' : undefined,
        }}
        className="relative max-w-[240px] sm:max-w-xs px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl bg-slate-950/90 shadow-2xl backdrop-blur-2xl flex flex-col gap-1 ring-1 ring-brand-400/30 animate-in fade-in zoom-in-95 duration-200 pointer-events-auto"
      >
        {state.statusKey && (
          <div
            className={`flex items-center gap-1.5 text-[11px] font-medium tracking-wide shrink-0 ${
              placement === 'top' ? 'justify-center' : 'justify-start'
            } ${state.isError ? 'text-rose-400 font-semibold' : 'text-brand-300'}`}
          >
            {ttsDown ? (
              <VolumeX className="w-3 h-3 text-brand-300 shrink-0" />
            ) : state.isError ? (
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
              {ttsDown ? t('bubble.ttsUnavailable') : t(`bubble.${state.statusKey}`, state.statusVars as Record<string, unknown> | undefined)}
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
        {(isSpeaking || ttsDown) && state.speechText && (
          <div
            className={`text-sm font-medium text-white leading-snug break-words max-h-[calc(5*1.375em)] overflow-y-auto pr-1.5 pl-0.5 select-text custom-bubble-scrollbar pointer-events-auto ${
              placement !== 'top' || state.speechText.length > 30 ? 'text-left' : 'text-center'
            }`}
          >
            {state.speechText}
          </div>
        )}
        {/* 对话框微光小尾巴 — 依据避让位置动态切换：右上角模式位于左下侧斜指角色，正上方模式居中指下 */}
        {placement === 'top-right' ? (
          <svg
            key="arrow-top-right"
            aria-hidden="true"
            className="absolute top-[calc(100%-1px)] left-5 sm:left-6 w-4 h-2.5 overflow-visible pointer-events-none z-10 animate-in fade-in duration-150"
            viewBox="-8 0 24 10"
            fill="none"
          >
            {/* 填充：与气泡 bg-slate-950 同色，无缝延伸 */}
            <path d="M0 0 L14 0 L-6 9 Z" className="fill-slate-950" />
            {/* 光晕外描边：从卡片底部斜向左下方指向角色面部 */}
            <path
              d="M14 0 L-6 9 L0 0"
              stroke="rgba(234, 131, 119, 0.30)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : placement === 'top-left' ? (
          <svg
            key="arrow-top-left"
            aria-hidden="true"
            className="absolute top-[calc(100%-1px)] right-5 sm:right-6 w-4 h-2.5 overflow-visible pointer-events-none z-10 animate-in fade-in duration-150"
            viewBox="0 0 24 10"
            fill="none"
          >
            <path d="M0 0 L14 0 L20 9 Z" className="fill-slate-950" />
            <path
              d="M0 0 L20 9 L14 0"
              stroke="rgba(234, 131, 119, 0.30)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg
            key="arrow-top"
            aria-hidden="true"
            className="absolute top-[calc(100%-1px)] left-1/2 -translate-x-1/2 w-3.5 h-2 overflow-visible pointer-events-none z-10 animate-in fade-in duration-150"
            viewBox="0 0 14 8"
            fill="none"
          >
            <path d="M0 0 L14 0 L7 7.5 Z" className="fill-slate-950" />
            <path
              d="M0 0 L7 7.5 L14 0"
              stroke="rgba(234, 131, 119, 0.30)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
};
