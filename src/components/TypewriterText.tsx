import React, { useMemo, useState, useEffect } from 'react';

export interface TypewriterTextProps {
  /** 待展示的对话文本 */
  text: string;
  /** 单字阶梯级联间隔 (毫秒，默认 32ms，契合日常交谈语速) */
  speedMs?: number;
  /** 容器自定义类名 */
  className?: string;
  /** 全部文字展开完成回调 */
  onComplete?: () => void;
}

/**
 * TypewriterText — 视觉小说级高质感平滑打字机组件 (方案一：字符微渐显 Cascade Blur & Fade)
 * 
 * 核心性能保证：
 * 1. 零 Layout Reflow：首帧即挂载全部文字完成物理排版占位，气泡容器高度从始至终 100% 恒定，杜绝避让震颤；
 * 2. 零 JS 运行时损耗：拆解为带 animation-delay 的字符后，全权由浏览器 Compositor 合成线程硬件加速调度；
 * 3. 双语智能排版：连续英数单词自动以 inline-block 整体包裹，绝不在单词中途拆行；标点与中日韩文字自然流动折行；
 * 4. 点击快速跳过 (Instant Finish)：支持点击快速略过打字动效，瞬间完整清晰呈现。
 */
export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  speedMs = 32,
  className = '',
  onComplete,
}) => {
  const [skip, setSkip] = useState(false);

  // 换文本或切段时重置跳过状态
  useEffect(() => {
    setSkip(false);
  }, [text]);

  // 词组分词算法：保证英文单词整体折行，中日韩单字自然折行
  const tokens = useMemo(() => {
    if (!text) return [];
    // 匹配连续英数单词，或者单个非空白字符，或者连续空白符
    const regex = /([a-zA-Z0-9'_]+|[^\s\w]|\s+)/g;
    const matches = text.match(regex) || [text];
    let globalIndex = 0;

    return matches.map((token) => {
      const isWhitespace = /^\s+$/.test(token);
      const isWord = /^[a-zA-Z0-9'_]+$/.test(token);
      const chars = Array.from(token);
      const tokenStartIndex = globalIndex;
      globalIndex += chars.length;

      return {
        text: token,
        isWhitespace,
        isWord,
        chars: chars.map((ch, idx) => ({
          char: ch,
          index: tokenStartIndex + idx,
        })),
      };
    });
  }, [text]);

  const totalChars = useMemo(() => Array.from(text).length, [text]);

  // 动画完成计时
  useEffect(() => {
    if (skip || totalChars === 0) {
      onComplete?.();
      return;
    }
    const timer = setTimeout(() => {
      onComplete?.();
    }, totalChars * speedMs + 140);
    return () => clearTimeout(timer);
  }, [text, totalChars, speedMs, skip, onComplete]);

  if (!text) return null;

  return (
    <span
      className={`inline-block select-text cursor-pointer ${className}`}
      onClick={(e) => {
        // 点击快速完成打字机跳过
        e.stopPropagation();
        setSkip(true);
      }}
      title="点击直接完整显示"
    >
      {tokens.map((token, tIdx) => {
        if (token.isWhitespace) {
          return <span key={tIdx}>{token.text}</span>;
        }

        const tokenContent = token.chars.map((item) => (
          <span
            key={item.index}
            className={skip ? 'inline-block opacity-100' : 'animate-char-reveal'}
            style={
              skip
                ? undefined
                : {
                    animationDelay: `${item.index * speedMs}ms`,
                  }
            }
          >
            {item.char}
          </span>
        ));

        // 如果是英文单词，整体以 inline-block 包装，杜绝英文单词被折行截断
        if (token.isWord) {
          return (
            <span key={tIdx} className="inline-block whitespace-nowrap">
              {tokenContent}
            </span>
          );
        }

        return <React.Fragment key={tIdx}>{tokenContent}</React.Fragment>;
      })}
    </span>
  );
};
