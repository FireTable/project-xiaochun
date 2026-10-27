import React, { useEffect, useMemo } from 'react';
import { StoryChoiceCard } from './StoryChoiceCard';
import type { StoryChoice } from '@/story/schema';

interface StoryChoiceGroupProps {
  choices: StoryChoice[];
  onSelect: (choice: StoryChoice) => void;
  disabled?: boolean;
  layout?: 'list' | 'grid' | 'auto';
}

export const StoryChoiceGroup: React.FC<StoryChoiceGroupProps> = ({
  choices,
  onSelect,
  disabled = false,
  layout = 'auto',
}) => {
  // 键盘 1 / 2 / 3 数字键快速选择
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled || choices.length === 0) return;
      // 忽略正在输入文本的场景
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= choices.length) {
        onSelect(choices[num - 1]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [choices, onSelect, disabled]);

  const isGrid = useMemo(() => {
    if (layout === 'grid') return true;
    if (layout === 'list') return false;
    // auto 模式：如果任意选项包含图片，自动开启视觉网格卡片布局
    return choices.some((c) => Boolean(c.image));
  }, [layout, choices]);

  if (!choices || choices.length === 0) return null;

  if (isGrid) {
    return (
      <div className="w-full grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
        {choices.map((choice, idx) => (
          <StoryChoiceCard
            key={choice.id || idx}
            choice={choice}
            index={idx}
            layout="media"
            onSelect={onSelect}
            disabled={disabled}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="w-full space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {choices.map((choice, idx) => (
        <StoryChoiceCard
          key={choice.id || idx}
          choice={choice}
          index={idx}
          layout="list"
          onSelect={onSelect}
          disabled={disabled}
        />
      ))}
    </div>
  );
};
