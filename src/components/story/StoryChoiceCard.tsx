import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { StoryChoice } from '@/story/schema';

interface StoryChoiceCardProps {
  choice: StoryChoice;
  index: number;
  onSelect: (choice: StoryChoice) => void;
  disabled?: boolean;
  layout?: 'list' | 'media';
  variant?: 'default' | 'primary';
}

export const StoryChoiceCard: React.FC<StoryChoiceCardProps> = ({
  choice,
  index,
  onSelect,
  disabled = false,
  layout = 'list',
  variant = 'default',
}) => {
  const isSelected = Boolean(choice.selected);
  const isPrimary = variant === 'primary';

  // 1. 图文多媒体卡片 (Media / Grid 视觉展台布局)
  if (layout === 'media' || Boolean(choice.image)) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(choice)}
        className={`pointer-events-auto w-full group relative flex flex-col p-2.5 sm:p-3 rounded-2xl transition-all duration-200 cursor-pointer text-left overflow-hidden ${
          isSelected
            ? 'bg-slate-900/95 border-2 border-[#ea8377] ring-2 ring-[#ea8377]/40 shadow-[0_0_24px_rgba(234,131,119,0.45)] -translate-y-1'
            : 'bg-slate-950/65 hover:bg-slate-900/80 border border-white/20 hover:border-[#ea8377]/75 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_16px_rgba(0,0,0,0.4)] hover:shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),0_0_20px_rgba(234,131,119,0.35)] hover:-translate-y-0.5'
        } active:scale-[0.98]`}
      >
        {/* 顶部 16:9 比例画面预览展台 */}
        <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-900/60 border border-white/10 shadow-inner">
          {choice.image ? (
            <img
              src={choice.image}
              alt={choice.text}
              className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-108"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#ea8377]/25 to-purple-500/25 flex items-center justify-center text-3xl">
              <span>{choice.icon || '✨'}</span>
            </div>
          )}

          {/* 渐变遮罩压暗底部 */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/15 to-transparent pointer-events-none" />

          {/* 左上角序号气泡 */}
          <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/20 text-[10px] font-mono text-white/90">
            {index + 1}
          </div>

          {/* 右上角角标：仅在明确配置 choice.badge 时展示 */}
          {choice.badge ? (
            <div className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-[#ea8377] text-white text-[10px] font-semibold shadow-md">
              {choice.badge}
            </div>
          ) : null}
        </div>

        {/* 底部文字信息 */}
        <div className="mt-2.5 flex flex-col gap-0.5 min-w-0">
          <span className={`text-xs sm:text-sm font-bold truncate transition-colors ${
            isSelected ? 'text-[#f5aa9c]' : 'text-white group-hover:text-[#f5aa9c]'
          }`}>
            {choice.text}
          </span>
          {choice.subText && (
            <span className="text-[10px] sm:text-xs text-white/50 group-hover:text-white/70 truncate font-normal">
              {choice.subText}
            </span>
          )}
        </div>
      </button>
    );
  }

  // 2. 纯文字/图标列表项卡片 (List 布局)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(choice)}
      className={`pointer-events-auto w-full group relative flex items-center justify-between p-3.5 sm:p-4 rounded-2xl transition-all duration-200 cursor-pointer text-left overflow-hidden ${
        isSelected
          ? 'bg-slate-900/90 border-2 border-[#ea8377] ring-2 ring-[#ea8377]/40 shadow-[0_0_24px_rgba(234,131,119,0.4)]'
          : isPrimary
          ? 'bg-gradient-to-r from-slate-950/80 via-slate-900/85 to-[#ea8377]/15 hover:from-slate-900/90 hover:via-slate-800/90 hover:to-[#ea8377]/25 border border-[#ea8377]/50 hover:border-[#ea8377] shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_20px_rgba(234,131,119,0.25)] hover:shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),0_0_24px_rgba(234,131,119,0.35)] hover:-translate-y-0.5'
          : 'bg-slate-950/60 hover:bg-slate-900/75 border border-white/20 hover:border-[#ea8377]/75 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_16px_rgba(0,0,0,0.35)] hover:shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),0_0_20px_rgba(234,131,119,0.35)] hover:-translate-y-0.5'
      } active:scale-[0.98]`}
    >
      <div className="flex items-center gap-3 sm:gap-4 min-w-0 pr-2">
        <div className={`shrink-0 w-7 h-7 rounded-xl border flex items-center justify-center text-xs font-mono font-medium transition-colors ${
          isSelected
            ? 'bg-[#ea8377]/20 border-[#ea8377] text-[#ea8377]'
            : isPrimary
            ? 'bg-[#ea8377]/20 border-[#ea8377]/50 text-[#f5aa9c] group-hover:border-[#ea8377] group-hover:bg-[#ea8377]/30'
            : 'bg-white/[0.08] border-white/15 text-white/80 group-hover:border-[#ea8377]/60 group-hover:text-[#ea8377]'
        }`}>
          {choice.icon || `${index + 1}`}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm sm:text-base font-medium tracking-wide transition-colors truncate ${
              isSelected || isPrimary ? 'text-[#f5aa9c] group-hover:text-white' : 'text-white/95 group-hover:text-white'
            }`}>
              {choice.text}
            </span>
            {choice.badge ? (
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ea8377]/20 border border-[#ea8377]/40 text-[#ea8377]">
                {choice.badge}
              </span>
            ) : null}
          </div>
          {choice.subText && (
            <p className="text-xs text-white/50 group-hover:text-white/70 transition-colors mt-0.5 line-clamp-1">
              {choice.subText}
            </p>
          )}
        </div>
      </div>

      <div className={`shrink-0 transition-all ${
        isPrimary ? 'opacity-80 group-hover:opacity-100 group-hover:translate-x-1' : 'opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5'
      }`}>
        <ChevronRight className={`w-4 h-4 ${isPrimary ? 'text-[#ea8377] group-hover:text-white' : 'text-white group-hover:text-[#ea8377]'}`} />
      </div>
    </button>
  );
};
