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

  // 1. 图文多媒体卡片 (Media / Grid 换装视觉展台布局)
  if (layout === 'media' || Boolean(choice.image)) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(choice)}
        className={`pointer-events-auto w-full group relative flex flex-col p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all duration-200 cursor-pointer text-left overflow-hidden ${
          isSelected
            ? 'bg-slate-900/90 border-2 border-[#ea8377] ring-2 ring-[#ea8377]/40 shadow-[0_0_24px_rgba(234,131,119,0.45)] -translate-y-0.5'
            : 'bg-black/50 hover:bg-slate-900/70 border border-white/15 hover:border-[#ea8377]/70 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_4px_16px_rgba(0,0,0,0.4)] hover:-translate-y-0.5'
        } active:scale-[0.98]`}
      >
        {/* 顶部 16:9 比例画面预览展台 */}
        <div className="relative w-full aspect-video rounded-lg sm:rounded-xl overflow-hidden bg-slate-900/60 border border-white/10 shadow-inner">
          {choice.image ? (
            <img
              src={choice.image}
              alt={choice.text}
              className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#ea8377]/25 to-purple-500/25 flex items-center justify-center text-3xl">
              <span>{choice.icon || '✨'}</span>
            </div>
          )}

          {/* 渐变遮罩压暗底部 */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />

          {/* 右上角业务徽标：仅在明确配置 choice.badge (如“当前在穿”) 时展示，无多余序号干扰 */}
          {choice.badge ? (
            <div className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-[#ea8377] text-white text-[10px] font-semibold shadow-md">
              {choice.badge}
            </div>
          ) : null}
        </div>

        {/* 底部文字信息 */}
        <div className="mt-2 flex flex-col gap-0.5 min-w-0">
          <span className={`text-xs sm:text-sm font-semibold truncate transition-colors ${
            isSelected ? 'text-[#f5aa9c]' : 'text-white/95 group-hover:text-[#f5aa9c]'
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

  // 2. 纯文字/图标列表项卡片 (PC 方案 6 白霜微晶 + 手机方案 4 紧凑微流光胶囊)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(choice)}
      className={`pointer-events-auto w-full group relative flex items-center justify-between px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl sm:rounded-2xl transition-all duration-200 cursor-pointer text-left overflow-hidden ${
        isSelected
          ? 'bg-white/20 border border-amber-300/80 ring-1 ring-amber-300/40 shadow-[0_0_20px_rgba(251,191,36,0.25)]'
          : isPrimary
          ? 'bg-gradient-to-r from-amber-500/25 via-white/10 to-amber-500/15 hover:from-amber-500/35 hover:via-white/15 hover:to-amber-500/25 border border-amber-300/60 hover:border-amber-300 shadow-[0_4px_20px_rgba(245,158,11,0.2)] hover:-translate-y-0.5'
          : 'bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 hover:border-white/30 backdrop-blur-md shadow-[0_4px_16px_rgba(0,0,0,0.25)] hover:shadow-[0_4px_20px_rgba(255,255,255,0.1)] hover:-translate-y-0.5'
      } active:scale-[0.98]`}
    >
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
        {/* 左侧微晶菱形或自定义小图标 (无多余大灰框) */}
        <span className={`shrink-0 transition-transform duration-200 group-hover:scale-110 ${
          isSelected || isPrimary
            ? 'text-amber-300 text-xs sm:text-sm drop-shadow-[0_0_8px_rgba(252,211,77,0.7)]'
            : 'text-amber-200/60 group-hover:text-amber-300 text-xs sm:text-sm'
        }`}>
          {choice.icon || '◆'}
        </span>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-xs sm:text-[13px] font-medium tracking-wide transition-colors truncate ${
              isSelected || isPrimary
                ? 'text-white drop-shadow-sm font-semibold'
                : 'text-white/90 group-hover:text-white'
            }`}>
              {choice.text}
            </span>
            {choice.badge ? (
              <span className="shrink-0 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-amber-400/20 border border-amber-300/40 text-amber-200">
                {choice.badge}
              </span>
            ) : null}
          </div>
          {choice.subText && (
            <p className="text-[10px] sm:text-[11px] text-white/45 group-hover:text-white/65 transition-colors line-clamp-1 font-normal">
              {choice.subText}
            </p>
          )}
        </div>
      </div>
    </button>
  );
};
