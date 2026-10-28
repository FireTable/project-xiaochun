import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { vrmEngine, type BubbleState } from '@/core/vrmEngine';
import { getBubbleTransform, type BubblePlacement } from '@/core/ui/bubbleTracker';
import { Sparkles, VolumeX, Activity, AlertCircle } from '@/components/icons';
import { TypewriterText } from '@/components/TypewriterText';
import {
  getUserSettings,
  getCachedUserSettings,
  subscribeUserSettings,
  resolveShowHeadBubble,
} from '@/llm/userSettings';

export interface ChatBubbleProps {
  state?: BubbleState;
  customHeader?: React.ReactNode;
  extraHeaderAction?: React.ReactNode;
  speechText?: string;
  isSpeaking?: boolean;
  placement?: BubblePlacement;
  isStatic?: boolean;
  className?: string;
  maxWidthClass?: string;
  children?: React.ReactNode;
  variant?: 'bubble' | 'cinematic';
}

/** @deprecated 向后兼容别名，推荐使用 ChatBubbleProps */
export type HeadBubbleProps = ChatBubbleProps;

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

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  state,
  customHeader,
  extraHeaderAction,
  speechText: speechTextProp,
  isSpeaking: isSpeakingProp,
  placement: placementProp,
  isStatic = false,
  className = '',
  maxWidthClass = 'max-w-[240px] sm:max-w-xs',
  children,
  variant = 'bubble',
}) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() => resolveShowHeadBubble(getCachedUserSettings()));
  const cardRef = useRef<HTMLDivElement>(null);
  const [measuredSize, setMeasuredSize] = useState({ width: 240, height: 44 });

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

  const rawSpeechText = speechTextProp ?? state?.speechText ?? '';
  const placement = placementProp ?? state?.placement ?? (isStatic ? 'bottom' : 'top');
  const statusKey = state?.statusKey ?? '';
  const iconKind = state?.isError ? 'idle' : ICON_BY_KEY[statusKey] ?? 'idle';
  const isSpeaking = isSpeakingProp !== undefined ? isSpeakingProp : (statusKey === 'speaking' || Boolean(speechTextProp));
  const ttsDown = statusKey === 'ttsUnavailable';

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
        if (!isStatic && variant === 'bubble') {
          vrmEngine.bubbleTracker.setMeasuredSize(w, h);
        }
      }
    };
    updateSize();

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
        const height = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
        if (width > 0 && height > 0) {
          setMeasuredSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
          if (!isStatic && variant === 'bubble') {
            vrmEngine.bubbleTracker.setMeasuredSize(width, height);
          }
        }
      }
    });
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [rawSpeechText, statusKey, isStatic, variant, children]);

  // 对话设置关气泡：仅对日常悬浮气泡生效；
  // 静态电影字幕条模式 (variant === 'cinematic')：只在存在台词正文、展开回顾、或明确处于思考中(thinking)时展示，杜绝在 TTS/EMAGE 缓冲无声音阶段提前露出空白外壳
  const isCinematic = variant === 'cinematic';
  const hasCinematicContent =
    Boolean(children) ||
    Boolean(rawSpeechText) ||
    (statusKey === 'thinking');

  const isVisible = isStatic
    ? isCinematic
      ? hasCinematicContent
      : Boolean(children) || Boolean(rawSpeechText) || (state ? state.visible && Boolean(statusKey) : Boolean(statusKey))
    : enabled && Boolean(state?.visible);

  if (!isVisible) return null;

  // ── 电影级纯净发光字幕条模式 (0 实底黑盒遮挡，纯净发光投影，100% 复用打字机动效与状态) ──
  if (variant === 'cinematic') {
    const cinematicContent = (
      <div
        ref={cardRef}
        style={{
          viewTransitionName: isSpeaking ? 'story-dialog-card' : undefined,
        }}
        className={`relative ${maxWidthClass} px-3 py-1.5 flex flex-col items-center pointer-events-auto animate-in fade-in duration-200 select-text ${className}`}
      >
        {/* 顶部状态与角色标识行 */}
        {customHeader ? (
          <div className="w-full mb-1">
            {customHeader}
          </div>
        ) : (
          <div className="flex items-center justify-between w-full max-w-xl px-1 mb-1">
            <div
              className="inline-flex items-center gap-1.5 text-xs text-rose-300 font-bold tracking-wider"
              style={{
                textShadow: '0 0 8px rgba(234,131,119,0.95), 0 2px 4px rgba(0,0,0,0.95)',
              }}
            >
              {/* 角色名作为第一锚点固定在最左侧，绝不受后续图标显隐干扰 */}
              <span>小蠢</span>
              {state?.totalSegments && state.totalSegments > 1 && state.segmentIndex ? (
                <span className="text-[10px] font-mono text-white/50 tracking-wider">
                  ({state.segmentIndex}/{state.totalSegments})
                </span>
              ) : null}
              {/* 发声波形指示器置于名字右侧，发声时柔和渐显，播毕自然隐退，角色名坐标纹丝不动 */}
              {isSpeaking && (
                <span className="inline-flex items-center gap-0.5 px-0.5 shrink-0 opacity-80 animate-in fade-in duration-150">
                  <span className="w-0.5 h-2 bg-rose-400 rounded-full animate-pulse" />
                  <span className="w-0.5 h-3 bg-rose-300 rounded-full animate-pulse [animation-delay:150ms]" />
                  <span className="w-0.5 h-2 bg-rose-400 rounded-full animate-pulse [animation-delay:300ms]" />
                </span>
              )}
              {iconKind === 'thinking' && (
                <Sparkles className="w-3.5 h-3.5 text-brand-300 animate-spin shrink-0" />
              )}
              {ttsDown ? (
                <span className="text-[10px] text-brand-300 font-normal">
                  ({t('bubble.ttsUnavailable')})
                </span>
              ) : statusKey === 'thinking' && !rawSpeechText ? (
                <span className="text-[10px] text-white/60 font-normal">
                  {t('bubble.thinking')}
                </span>
              ) : null}
            </div>
            {extraHeaderAction && (
              <div className="shrink-0 pointer-events-auto">
                {extraHeaderAction}
              </div>
            )}
          </div>
        )}

        {/* 展开内容 (如历史回顾) */}
        {Boolean(children) && (
          <div className="w-full my-2 animate-in fade-in duration-200">
            {children}
          </div>
        )}

        {/* 纯净发光正文：严格与上方角色名保持完全一致的 max-w-xl px-1 左对齐垂线 */}
        {rawSpeechText && !children && (
          <div
            key={state?.segmentIndex ?? rawSpeechText}
            className="w-full text-left max-w-xl px-1 text-xs sm:text-base font-medium text-white/95 leading-relaxed break-words max-h-[calc(4*1.7em)] overflow-y-auto overflow-x-hidden select-text custom-bubble-scrollbar pointer-events-auto animate-in fade-in duration-150"
            style={{
              textShadow:
                '0 2px 4px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.75), 0 1px 2px rgba(0,0,0,0.95)',
            }}
          >
            <TypewriterText
              resetKey={state?.segmentIndex}
              text={rawSpeechText}
            />
          </div>
        )}
      </div>
    );

    if (isStatic) {
      return cinematicContent;
    }

    return (
      <div
        id="chat-bubble"
        data-placement={placement}
        className="pointer-events-none fixed top-0 left-0 z-35 will-change-transform transition-transform duration-150 ease-out"
        style={{
          transform: state ? getBubbleTransform(placement, state.x, state.y) : undefined,
        }}
      >
        {cinematicContent}
      </div>
    );
  }

  const cardContent = (
    <div
      ref={cardRef}
      style={{
        viewTransitionName: isSpeaking ? 'story-dialog-card' : undefined,
      }}
      className={`relative ${maxWidthClass} px-4 py-2.5 sm:py-3 flex flex-col animate-in fade-in zoom-in-95 duration-200 pointer-events-auto filter drop-shadow-[0_12px_32px_rgba(0,0,0,0.50)] drop-shadow-[0_0_16px_rgba(234,131,119,0.18)] ${className}`}
    >
      {/* 一体化全景矢量轮廓与高质感渐变光晕 (含对应方向自然流淌的角尖) */}
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

      {/* 头部行：支持 customHeader 槽位 (如小蠢角色名 + 回顾按钮) 或默认状态胶囊 */}
      {customHeader ? (
        <div className="w-full mb-1">
          {customHeader}
        </div>
      ) : statusKey ? (
        <div
          key={statusKey}
          className={`flex items-center justify-center gap-1.5 text-[11px] font-medium tracking-wide shrink-0 animate-status-push ${
            state?.isError ? 'text-rose-400 font-semibold' : 'text-brand-300'
          }`}
        >
          {ttsDown ? (
            <VolumeX className="w-3.5 h-3.5 text-brand-300 shrink-0" />
          ) : state?.isError ? (
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : iconKind === 'thinking' ? (
            <Sparkles className="w-3.5 h-3.5 text-brand-300 animate-spin shrink-0" />
          ) : iconKind === 'speaking' ? (
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
            {ttsDown ? t('bubble.ttsUnavailable') : t(`bubble.${statusKey}`, state?.statusVars as Record<string, unknown> | undefined)}
          </span>
          {isSpeaking && state?.totalSegments && state.totalSegments > 1 && state.segmentIndex ? (
            <span
              key={state.segmentIndex}
              className="ml-1 px-1.5 py-0.5 rounded-full bg-white/10 text-[10px] font-medium text-brand-200 tracking-wider inline-flex items-center gap-1 border border-white/10 shadow-sm backdrop-blur-sm animate-status-push"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-white font-bold">{state.segmentIndex}</span>
              <span className="opacity-40 text-[9px]">/</span>
              <span className="text-slate-300">{state.totalSegments}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* 如果传入了 children (如展开的历史记录)，渲染 children */}
      {Boolean(children) && (
        <div className="w-full animate-in fade-in duration-200">
          {children}
        </div>
      )}

      {/* 对话正文：双轨 CSS Grid 柔顺高度舒展 (展开历史时通过 0fr 柔和折叠，绝不销毁 DOM 节点) */}
      <div
        className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          rawSpeechText && !children
            ? 'grid-rows-[1fr] opacity-100 mt-1'
            : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'
        }`}
      >
        <div className="overflow-hidden">
          <div
            key={state?.segmentIndex ?? rawSpeechText}
            className="text-xs sm:text-sm font-medium text-white/95 leading-relaxed break-words text-left max-h-[calc(5*1.7em)] overflow-y-auto overflow-x-hidden pr-0.5 select-text custom-bubble-scrollbar pointer-events-auto animate-segment-push"
          >
            <TypewriterText
              resetKey={state?.segmentIndex}
              text={rawSpeechText}
            />
          </div>
        </div>
      </div>
    </div>
  );

  if (isStatic) {
    return cardContent;
  }

  return (
    <div
      id="chat-bubble"
      data-placement={placement}
      className="pointer-events-none fixed top-0 left-0 z-35 will-change-transform transition-transform duration-150 ease-out"
      style={{
        transform: state ? getBubbleTransform(placement, state.x, state.y) : undefined,
      }}
    >
      {cardContent}
    </div>
  );
};

/** @deprecated 向后兼容别名，推荐使用 ChatBubble */
export const HeadBubble = ChatBubble;
