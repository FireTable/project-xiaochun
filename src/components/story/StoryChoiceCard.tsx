import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { StoryChoice } from '@/story/schema';

interface StoryChoiceCardProps {
  choice: StoryChoice;
  index: number;
  onSelect: (choice: StoryChoice) => void;
  disabled?: boolean;
}

export const StoryChoiceCard: React.FC<StoryChoiceCardProps> = ({
  choice,
  index,
  onSelect,
  disabled = false,
}) => {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(choice)}
      className="pointer-events-auto w-full group relative flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-slate-950/45 hover:bg-slate-900/60 border border-white/20 hover:border-[#ea8377]/70 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_16px_rgba(0,0,0,0.35)] hover:shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),0_0_20px_rgba(234,131,119,0.35)] transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer text-left overflow-hidden"
    >
      {/* 选项主体内容 */}
      <div className="flex items-center gap-3 sm:gap-4 min-w-0 pr-2">
        {/* 序号 / 图标指示器 */}
        <div className="shrink-0 w-7 h-7 rounded-xl bg-white/[0.08] border border-white/15 flex items-center justify-center text-xs font-mono font-medium text-white/80 group-hover:border-[#ea8377]/60 group-hover:text-[#ea8377] transition-colors">
          {choice.icon || `${index + 1}`}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm sm:text-base font-medium text-white/95 tracking-wide group-hover:text-white transition-colors truncate">
              {choice.text}
            </span>
            {choice.badge && (
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ea8377]/20 border border-[#ea8377]/40 text-[#ea8377]">
                {choice.badge}
              </span>
            )}
          </div>
          {choice.subText && (
            <p className="text-xs text-white/50 group-hover:text-white/70 transition-colors mt-0.5 line-clamp-1">
              {choice.subText}
            </p>
          )}
        </div>
      </div>

      {/* 右侧指示箭头 */}
      <div className="shrink-0 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
        <ChevronRight className="w-4 h-4 text-white group-hover:text-[#ea8377]" />
      </div>
    </button>
  );
};
