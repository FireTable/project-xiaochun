import React, { useMemo, useState, useEffect } from 'react';
import { APP_CONFIG } from '@/config';

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
  const typewriterCfg = APP_CONFIG.chat.typewriter;
  const isTypewriterEnabled = enabled ?? typewriterCfg.enabled;
  const effectiveSpeedMs = speedMs ?? typewriterCfg.speedMs;
  const effectiveMinorPauseMs = minorPauseMs ?? typewriterCfg.minorPauseMs;
  const effectiveMajorPauseMs = majorPauseMs ?? typewriterCfg.majorPauseMs;
  const effectiveRevealDurationMs = revealDurationMs ?? typewriterCfg.revealDurationMs;

  const [skip, setSkip] = useState(false);

  // 换文本或切段时重置跳过状态
  useEffect(() => {
    setSkip(false);
  }, [text, resetKey]);

  // 词组分词算法：保证英文单词整体折行，中日韩单字自然折行，并累积自然标点停顿
  const { tokens, totalDurationMs } = useMemo(() => {
    if (!text) return { tokens: [], totalDurationMs: 0 };
    // 匹配连续英数单词，或者单个非空白字符，或者连续空白符
    const regex = /([a-zA-Z0-9'_]+|[^\s\w]|\s+)/g;
    const matches = text.match(regex) || [text];
    let accumulatedDelayMs = 0;

    const parsedTokens = matches.map((token) => {
      const isWhitespace = /^\s+$/.test(token);
      const isWord = /^[a-zA-Z0-9'_]+$/.test(token);
      const chars = Array.from(token);

      const mappedChars = chars.map((ch) => {
        const currentDelay = accumulatedDelayMs;
        // 逗号/顿号/分号轻微停顿；句号/感叹号/问号/换行明确呼吸停顿
        const isMinorPause = /[，、,；;]/.test(ch);
        const isMajorPause = /[。！？!?…~～\n]/.test(ch);
        const pauseOffset = isMajorPause
          ? effectiveMajorPauseMs
          : isMinorPause
            ? effectiveMinorPauseMs
            : 0;

        accumulatedDelayMs += effectiveSpeedMs + pauseOffset;
        return {
          char: ch,
          delayMs: currentDelay,
        };
      });

      return {
        text: token,
        isWhitespace,
        isWord,
        chars: mappedChars,
      };
    });

    return {
      tokens: parsedTokens,
      totalDurationMs: accumulatedDelayMs + effectiveRevealDurationMs,
    };
  }, [text, effectiveSpeedMs, effectiveMinorPauseMs, effectiveMajorPauseMs, effectiveRevealDurationMs]);

  const isInstant = skip || !isTypewriterEnabled;

  // 动画完成计时
  useEffect(() => {
    if (isInstant || tokens.length === 0) {
      onComplete?.();
      return;
    }
    const timer = setTimeout(() => {
      onComplete?.();
    }, totalDurationMs);
    return () => clearTimeout(timer);
  }, [text, resetKey, totalDurationMs, isInstant, onComplete, tokens.length]);

  if (!text) return null;

  // 派生段落周期 key：当切段或更换文本时，强制 React 销毁旧 DOM 节点并重新挂载新 DOM 节点，
  // 彻底杜绝浏览器复用上一句已结束动画状态的 <span> 元素，确保新文字从首字开始 0ms 重新播放打字机动效
  const cycleKey = `${resetKey !== undefined ? `seg_${resetKey}_` : ''}${text}`;

  return (
    <span
      className={`inline select-text cursor-pointer ${className}`}
      onClick={(e) => {
        // 点击快速完成打字机跳过
        e.stopPropagation();
        setSkip(true);
      }}
      title="点击直接完整显示"
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
