import React from 'react';
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
  index: _index,
  onSelect,
  disabled = false,
  layout = 'list',
  variant = 'default',
}) => {
  const isSelected = Boolean(choice.selected);
  const isPrimary = variant === 'primary';

  // 1. 图文多媒体卡片 (Media / Grid 展台布局)
  if (layout === 'media' || Boolean(choice.image)) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(choice)}
        className={`pointer-events-auto w-full group relative flex flex-col p-2.5 sm:p-3 rounded-2xl transition-all duration-200 cursor-pointer text-left overflow-hidden ${
          isSelected
            ? 'bg-[#151b33]/90 border-2 border-[#f3d09a] ring-2 ring-[#f3d09a]/40 shadow-[0_0_24px_rgba(243,208,154,0.3)] -translate-y-0.5'
            : 'bg-[#0b0e1b]/80 hover:bg-[#101426]/95 border border-white/15 hover:border-[#f3d09a]/50 shadow-[0_8px_24px_rgba(0,0,0,0.5)] hover:-translate-y-0.5'
        } active:scale-[0.98]`}
      >
        {/* 顶部 16:9 比例画面预览展台 */}
        <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-[#101426] border border-white/10 group-hover:border-white/20 transition-colors shadow-inner">
          {choice.image ? (
            <img
              src={choice.image}
              alt={choice.text}
              className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full bg-[#151b33]/60 flex items-center justify-center text-3xl">
              <span>{choice.icon || ''}</span>
            </div>
          )}

          {/* 渐变遮罩压暗底部 */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b0e1b]/80 via-transparent to-transparent pointer-events-none" />

          {/* 右上角状态徽标 (如“当前在穿”) */}
          {choice.badge ? (
            <div
              className={`absolute top-1.5 right-1.5 px-2 py-0.5 rounded-[4px] text-[10px] font-semibold shadow-md ${
                isSelected
                  ? 'bg-[#f3d09a] text-slate-950 shadow-sm'
                  : 'bg-black/70 backdrop-blur-sm border border-white/20 text-white/90'
              }`}
            >
              {choice.badge}
            </div>
          ) : null}
        </div>

        {/* 底部文字信息 */}
        <div className="mt-2 flex flex-col gap-0.5 min-w-0">
          <span
            className={`text-xs sm:text-sm font-semibold truncate transition-colors tracking-wide ${
              isSelected ? 'text-[#fdf2dd]' : 'text-white/95 group-hover:text-[#f3d09a]'
            }`}
          >
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

  // 2. 纯文字/对话分支列表项卡片
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(choice)}
      className={`pointer-events-auto w-full group relative flex items-center justify-between px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-xl sm:rounded-2xl transition-all duration-200 cursor-pointer text-left overflow-hidden ${
        isSelected || isPrimary
          ? 'bg-gradient-to-r from-[#f3d09a]/25 via-[#1a2038]/90 to-[#101426]/95 border border-[#f3d09a]/70 shadow-[0_4px_20px_rgba(243,208,154,0.2)] hover:border-[#f3d09a] hover:-translate-y-0.5'
          : 'bg-[#0b0e1b]/75 hover:bg-[#151b33]/90 border border-white/12 hover:border-[#f3d09a]/50 shadow-[0_4px_16px_rgba(0,0,0,0.4)] hover:-translate-y-0.5'
      } active:scale-[0.98]`}
    >
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 z-10">
        {/* 左侧图标（仅当配置了 icon 时显示，无图标时不堆砌多余符号） */}
        {choice.icon && (
          <span className="shrink-0 text-sm">
            {choice.icon}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs sm:text-[13px] tracking-wide transition-colors truncate ${
                isSelected || isPrimary
                  ? 'text-white font-semibold drop-shadow-sm'
                  : 'text-white/90 group-hover:text-white font-medium'
              }`}
            >
              {choice.text}
            </span>
            {choice.badge ? (
              <span className="shrink-0 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-[#f3d09a]/15 border border-[#f3d09a]/30 text-[#f3d09a]">
                {choice.badge}
              </span>
            ) : null}
          </div>
          {choice.subText && (
            <p className="text-[10px] sm:text-[11px] text-white/45 group-hover:text-white/65 transition-colors line-clamp-1 font-normal mt-0.5">
              {choice.subText}
            </p>
          )}
        </div>
      </div>
    </button>
  );
};
