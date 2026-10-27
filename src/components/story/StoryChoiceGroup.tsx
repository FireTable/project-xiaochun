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

  // 判断是否全为单行短选项（例如字符数 ≤ 16），在手机端优先采用紧凑微流光胶囊并排
  const isAllShortChoices = useMemo(() => {
    return !isGrid && choices.every((c) => (c.text?.length || 0) <= 16 && !c.subText);
  }, [isGrid, choices]);

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

  // 普通文本选项：
  // 如果全是短选项：手机端并排横向流微胶囊 (flex flex-row flex-wrap)，PC 端纵向右悬浮 (sm:flex-col)；
  // 如果含长选项：统一为紧凑流光卡片 (flex flex-col)
  return (
    <div
      className={`w-full animate-in fade-in slide-in-from-bottom-2 duration-300 ${
        isAllShortChoices
          ? 'flex flex-row flex-wrap sm:flex-col gap-1.5 sm:gap-2'
          : 'flex flex-col gap-1.5 sm:gap-2'
      }`}
    >
      {choices.map((choice, idx) => (
        <div
          key={choice.id || idx}
          className={isAllShortChoices ? 'flex-1 min-w-[120px] sm:min-w-0' : 'w-full'}
        >
          <StoryChoiceCard
            choice={choice}
            index={idx}
            layout="list"
            onSelect={onSelect}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
};
