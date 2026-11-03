import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_CONFIG } from '@/config';

/**
 * 记录已经完整播放完毕或跳过的打字机文本周期 key (LRU Set)，
 * 保证当组件在对白历史折叠/展开、响应式媒体查询切端 (PC <-> 移动端)、或者父组件局部重渲染挂载时，
 * 已完成朗读的文字绝对不会从头重新打一遍，瞬间完整呈现。
 */
const MAX_COMPLETED_KEYS = 300;
export const COMPLETED_TYPEWRITER_CYCLE_KEYS = new Set<string>();

export function markTypewriterCompleted(key: string): void {
  if (!key) return;
  if (COMPLETED_TYPEWRITER_CYCLE_KEYS.size >= MAX_COMPLETED_KEYS) {
    const firstKey = COMPLETED_TYPEWRITER_CYCLE_KEYS.values().next().value;
    if (firstKey) COMPLETED_TYPEWRITER_CYCLE_KEYS.delete(firstKey);
  }
  COMPLETED_TYPEWRITER_CYCLE_KEYS.add(key);
}

export interface TypewriterTextProps {
  /** 待展示的对话文本 */
  text: string;
  /** 外部切段或重置标识 (可选，例如 segmentIndex，默认跟随 text) */
  resetKey?: string | number;
  /** 是否启用打字机渐显动效 (可选，默认从 APP_CONFIG.chat.typewriter.enabled 读取) */
  enabled?: boolean;
  /** 单字阶梯级联间隔 (毫秒，默认从 APP_CONFIG.chat.typewriter.speedMs 读取) */
  speedMs?: number;
  /** 逗号、顿号轻微呼吸停顿 (毫秒，默认从 APP_CONFIG.chat.typewriter.minorPauseMs 读取) */
  minorPauseMs?: number;
  /** 句号、感叹号、问号、换行等主要段落呼吸停顿 (毫秒，默认从 APP_CONFIG.chat.typewriter.majorPauseMs 读取) */
  majorPauseMs?: number;
  /** 字符渐现动效时长 (毫秒，默认从 APP_CONFIG.chat.typewriter.revealDurationMs 读取) */
  revealDurationMs?: number;
  /** 容器自定义类名 */
  className?: string;
  /** 全部文字展开完成回调 */
  onComplete?: () => void;
}

/**
 * TypewriterText — 视觉小说级高质感平滑打字机组件 (方案一：字符微渐显 Cascade Blur & Fade)
 * 
 * 核心优化：
 * 1. 零 Layout Reflow & 零滚动条闪现：首帧即挂载全部文字完成物理排版占位，字符动效仅在当前 inline 盒子内缩放渐显，绝不改变垂直高度；
 * 2. 舒缓语流律动：默认 60ms 单字间隔，标点逗句号自动注入呼吸微停顿，契合小蠢语音合成节奏；全参数均可在 config.ts 配置；
 * 3. 多段切段干净重置：通过 cycleKey 与内部 DOM 隔离，切段或换句时杜绝复用上一句已结束动画的 DOM 元素，确保新文字从头开始优雅渐显；
 * 4. 双语智能排版：连续英数单词自动以 inline-block 整体包裹，绝不在单词中途拆行；标点与中日韩文字自然流动折行；
 * 5. 点击快速跳过 (Instant Finish)：支持点击快速略过打字动效，瞬间完整清晰呈现。
 */
export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  resetKey,
  enabled,
  speedMs,
  minorPauseMs,
  majorPauseMs,
  revealDurationMs,
  className = '',
  onComplete,
}) => {
  const { t } = useTranslation();
  const typewriterCfg = APP_CONFIG.chat.typewriter;
  const isTypewriterEnabled = enabled ?? typewriterCfg.enabled;
  const effectiveSpeedMs = speedMs ?? typewriterCfg.speedMs;
  const effectiveMinorPauseMs = minorPauseMs ?? typewriterCfg.minorPauseMs;
  const effectiveMajorPauseMs = majorPauseMs ?? typewriterCfg.majorPauseMs;
  const effectiveRevealDurationMs = revealDurationMs ?? typewriterCfg.revealDurationMs;

  // 派生段落周期 key：当切段或更换文本时，用于 DOM 隔离与已播放历史状态记忆
  const cycleKey = `${resetKey !== undefined ? `seg_${resetKey}_` : ''}${text}`;
  const alreadyCompleted = Boolean(cycleKey && COMPLETED_TYPEWRITER_CYCLE_KEYS.has(cycleKey));

  const [skip, setSkip] = useState(() => alreadyCompleted);

  // 换文本或切段时根据记忆状态决定是否直接展开
  useEffect(() => {
    setSkip(alreadyCompleted);
  }, [cycleKey, alreadyCompleted]);

  // 词组分词算法：保证英文单词整体折行，中日韩单字自然折行，并累积自然标点停顿
  // 核心安全保证：通过标准 Intl.Segmenter (或 Unicode 增强正则) 精准处理 Grapheme Cluster，
  // 绝对杜绝 Emoji、复合修饰符或 UTF-16 代理对被拆开成为孤立 high/low surrogate 导致渲染为  问号乱码！
  const { tokens, totalDurationMs } = useMemo(() => {
    if (!text) return { tokens: [], totalDurationMs: 0 };

    // 1. 获取完整字形簇 (Grapheme Clusters)
    let rawSegments: string[] = [];
    if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
      const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
      rawSegments = Array.from(segmenter.segment(text), (s: any) => s.segment);
    } else {
      // 降级使用带 u 标志的 Unicode 感知正则，保证 Emoji 与代理对绝不被破坏
      const fallbackRegex = /(\p{Extended_Pictographic}(?:\u200D\p{Extended_Pictographic}|\uFE0F|\p{Emoji_Modifier})*|[a-zA-Z0-9'_]+|\s+|[^\s\w])/gu;
      rawSegments = text.match(fallbackRegex) || Array.from(text);
    }

    const parsedTokens: {
      text: string;
      isWhitespace: boolean;
      isWord: boolean;
      chars: { char: string; delayMs: number }[];
    }[] = [];

    let currentWordChars: { char: string; delayMs: number }[] = [];

    const flushWord = () => {
      if (currentWordChars.length === 0) return;
      const wordText = currentWordChars.map((c) => c.char).join('');
      parsedTokens.push({
        text: wordText,
        isWhitespace: false,
        isWord: true,
        chars: currentWordChars,
      });
      currentWordChars = [];
    };

    let accumulatedDelayMs = 0;

    for (const seg of rawSegments) {
      const isWhitespace = /^\s+$/.test(seg);
      const isWordChar = /^[a-zA-Z0-9'_]+$/.test(seg);

      // 如果是连续英文单词字符，聚合进当前单词
      if (isWordChar) {
        const currentDelay = accumulatedDelayMs;
        accumulatedDelayMs += effectiveSpeedMs;
        currentWordChars.push({
          char: seg,
          delayMs: currentDelay,
        });
        continue;
      }

      // 非英文单词字符：先结算之前的单词
      flushWord();

      const currentDelay = accumulatedDelayMs;
      // 逗号/顿号/分号轻微停顿；句号/感叹号/问号/换行明确呼吸停顿
      const isMinorPause = /[，、,；;]/.test(seg);
      const isMajorPause = /[。！？!?…~～\n]/.test(seg);
      const pauseOffset = isMajorPause
        ? effectiveMajorPauseMs
        : isMinorPause
          ? effectiveMinorPauseMs
          : 0;

      accumulatedDelayMs += effectiveSpeedMs + pauseOffset;

      parsedTokens.push({
        text: seg,
        isWhitespace,
        isWord: false,
        chars: [{ char: seg, delayMs: currentDelay }],
      });
    }

    flushWord();

    return {
      tokens: parsedTokens,
      totalDurationMs: accumulatedDelayMs + effectiveRevealDurationMs,
    };
  }, [text, effectiveSpeedMs, effectiveMinorPauseMs, effectiveMajorPauseMs, effectiveRevealDurationMs]);

  const isInstant = skip || !isTypewriterEnabled;

  // 动画完成计时与状态持久记忆
  useEffect(() => {
    if (isInstant || tokens.length === 0) {
      if (cycleKey) markTypewriterCompleted(cycleKey);
      onComplete?.();
      return;
    }
    const timer = setTimeout(() => {
      if (cycleKey) markTypewriterCompleted(cycleKey);
      onComplete?.();
    }, totalDurationMs);
    return () => clearTimeout(timer);
  }, [cycleKey, totalDurationMs, isInstant, onComplete, tokens.length]);

  if (!text) return null;

  return (
    <span
      className={`inline select-text cursor-pointer ${className}`}
      onClick={(e) => {
        // 点击快速完成打字机跳过并永久记住已完成状态
        e.stopPropagation();
        setSkip(true);
        if (cycleKey) markTypewriterCompleted(cycleKey);
      }}
      title={t('chat.typewriterSkipTitle')}
    >
      <span key={cycleKey} className="inline">
        {tokens.map((token, tIdx) => {
          if (token.isWhitespace) {
            return <span key={`ws_${tIdx}`}>{token.text}</span>;
          }

          const tokenContent = token.chars.map((item, cIdx) => (
            <span
              key={`c_${tIdx}_${cIdx}_${item.char}`}
              className={isInstant ? 'inline-block opacity-100' : 'animate-char-reveal'}
              style={
                isInstant
                  ? undefined
                  : {
                      animationDelay: `${item.delayMs}ms`,
                      animationDuration: `${effectiveRevealDurationMs}ms`,
                    }
              }
            >
              {item.char}
            </span>
          ));

          // 如果是英文单词，整体以 inline-block 包装，杜绝英文单词被折行截断
          if (token.isWord) {
            return (
              <span key={`w_${tIdx}`} className="inline-block whitespace-nowrap">
                {tokenContent}
              </span>
            );
          }

          return <React.Fragment key={`t_${tIdx}`}>{tokenContent}</React.Fragment>;
        })}
      </span>
    </span>
  );
};
