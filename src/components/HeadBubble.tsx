import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { vrmEngine, type BubbleState } from '@/core/vrmEngine';
import { getBubbleTransform, type BubblePlacement } from '@/core/ui/bubbleTracker';
import { Sparkles, VolumeX, Activity, AlertCircle } from '@/components/icons';
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

/**
 * 生成全景无缝矢量气泡闭合路径
 * 
 * 彻底消除卡片与独立 SVG 三角之间的拼接缝隙与错位，
 * 将圆角矩形与对应方位的流体气泡嘴（Speech Beak）熔铸于单一闭合轮廓：
 * - 'top-right': 气泡嘴位于左下圆角处，圆弧顺滑延伸并斜向左下方指向角色面部
 * - 'top-left': 气泡嘴位于右下圆角处，镜像对称指向角色面部
 * - 'top': 正上方居中模式，底部中央优雅向下微光小尖角
 */
function getBalloonPath(w: number, h: number, placement: BubblePlacement, r = 16): string {
  if (w <= 0 || h <= 0) return '';
  if (placement === 'bottom') {
    // 移动端底部悬浮对白卡：上边缘居中微尖优雅向上指引角色 (midX - 5, 0) -> (midX, -5) -> (midX + 5, 0)
    const midX = w / 2;
    return `M ${r} 0 H ${midX - 5} L ${midX} -5 L ${midX + 5} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`.replace(/\s+/g, ' ').trim();
  }
  if (placement === 'top-right') {
    // 精致小巧的左下圆角气泡嘴：微角仅向左下伸出 5px，小巧灵动，绝不喧宾夺主
    return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H 18 C 12 ${h} 4 ${h + 2} -5 ${h + 5} C -1 ${h + 1} 0 ${h - 4} 0 ${h - 12} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`.replace(/\s+/g, ' ').trim();
  }
  if (placement === 'top-left') {
    // 右下圆角对称精致微气泡嘴
    return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - 12} C ${w} ${h - 4} ${w + 1} ${h + 1} ${w + 5} ${h + 5} C ${w - 4} ${h + 2} ${w - 12} ${h} ${w - 18} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`.replace(/\s+/g, ' ').trim();
  }
  // 正上方居中模式：精致小巧的下向微角 (宽 10px, 高 5px)
  const midX = w / 2;
  return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${midX + 5} L ${midX} ${h + 5} L ${midX - 5} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`.replace(/\s+/g, ' ').trim();
}

export const HeadBubble: React.FC<HeadBubbleProps> = ({ state }) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() => resolveShowHeadBubble(getCachedUserSettings()));
  const cardRef = useRef<HTMLDivElement>(null);
  const [measuredSize, setMeasuredSize] = useState({ width: 280, height: 85 });

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

  // 动态同步实测尺寸，并驱动 SVG 一体化矢量轮廓重绘
  useEffect(() => {
    if (!cardRef.current) return;
    const updateSize = () => {
      if (!cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w > 0 && h > 0) {
        setMeasuredSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
        vrmEngine.bubbleTracker.setMeasuredSize(w, h);
      }
    };
    updateSize();

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
        const height = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
        if (width > 0 && height > 0) {
          setMeasuredSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
          vrmEngine.bubbleTracker.setMeasuredSize(width, height);
        }
      }
    });
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [state.speechText, state.statusKey]);

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
      {/* 
        视觉小说高质感气泡容器：
        放弃生硬的 1px 固体线框，改用【全景无缝矢量气泡 + 微晶极光渐变描边 + 柔光漫反射阴影】
      */}
      <div
        ref={cardRef}
        style={{
          viewTransitionName: isSpeaking ? 'story-dialog-card' : undefined,
        }}
        className="relative max-w-[240px] sm:max-w-xs px-4 py-2.5 sm:py-3 flex flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-200 pointer-events-auto filter drop-shadow-[0_12px_32px_rgba(0,0,0,0.50)] drop-shadow-[0_0_16px_rgba(234,131,119,0.18)]"
      >
        {/* 一体化全景矢量轮廓与高质感渐变光晕 (含左下圆角自然流淌的角尖) */}
        <svg
          aria-hidden="true"
          className="absolute inset-0 w-full h-full pointer-events-none -z-10 overflow-visible"
          viewBox={`0 0 ${measuredSize.width} ${measuredSize.height}`}
        >
          <defs>
            {/* 深邃星空半透毛玻璃填充渐变 */}
            <linearGradient id="bubble-bg-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#181a2e" stopOpacity="0.94" />
              <stop offset="50%" stopColor="#101322" stopOpacity="0.96" />
              <stop offset="100%" stopColor="#1c152d" stopOpacity="0.97" />
            </linearGradient>
            {/* 纯净小蠢主题珊瑚粉描边 (#ea8377) */}
            <linearGradient id="bubble-border-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(234, 131, 119, 0.55)" />
              <stop offset="100%" stopColor="rgba(234, 131, 119, 0.35)" />
            </linearGradient>
          </defs>
          <path
            d={getBalloonPath(measuredSize.width, measuredSize.height, placement)}
            fill="url(#bubble-bg-grad)"
            stroke="url(#bubble-border-grad)"
            strokeWidth="1.25"
            strokeLinejoin="round"
          />
        </svg>

        {/* 顶部状态与律动指示 — 无论在正上方还是侧面均保持居中对齐 */}
        {state.statusKey && (
          <div
            className={`flex items-center justify-center gap-1.5 text-[11px] font-medium tracking-wide shrink-0 ${
              state.isError ? 'text-rose-400 font-semibold' : 'text-brand-300'
            }`}
          >
            {ttsDown ? (
              <VolumeX className="w-3.5 h-3.5 text-brand-300 shrink-0" />
            ) : state.isError ? (
              <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            ) : iconKind === 'thinking' ? (
              <Sparkles className="w-3.5 h-3.5 text-brand-300 animate-spin shrink-0" />
            ) : iconKind === 'speaking' ? (
              // 番剧风格律动音频条 (声波跳跃反馈)
              <span className="inline-flex items-center gap-0.5 shrink-0 px-0.5">
                <span className="w-0.5 h-2 bg-brand-300 rounded-full animate-pulse" />
                <span className="w-0.5 h-3.5 bg-brand-200 rounded-full animate-pulse [animation-delay:150ms]" />
                <span className="w-0.5 h-2.5 bg-brand-300 rounded-full animate-pulse [animation-delay:300ms]" />
              </span>
            ) : iconKind === 'emoting' ? (
              <Activity className="w-3.5 h-3.5 text-brand-300 animate-pulse shrink-0" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-brand-300 shrink-0" />
            )}
            <span className="font-semibold text-rose-200/90 tracking-normal">
              {ttsDown ? t('bubble.ttsUnavailable') : t(`bubble.${state.statusKey}`, state.statusVars as Record<string, unknown> | undefined)}
            </span>
            {/* 多段流式朗读进度胶囊 */}
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

        {/* 对话正文：视觉小说舒适字距与清晰行高，统一左对齐 */}
        {(isSpeaking || ttsDown) && state.speechText && (
          <div className="text-sm font-medium text-white/95 leading-relaxed break-words text-left max-h-[calc(5*1.45em)] overflow-y-auto pr-1 select-text custom-bubble-scrollbar pointer-events-auto">
            {state.speechText}
          </div>
        )}
      </div>
    </div>
  );
};
