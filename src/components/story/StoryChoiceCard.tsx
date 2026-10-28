import React from 'react';
import { useTranslation } from 'react-i18next';
import type { StoryChoice } from '@/story/schema';

interface StoryChoiceCardProps {
  choice: StoryChoice;
  index: number;
  onSelect: (choice: StoryChoice) => void;
  disabled?: boolean;
  layout?: 'list' | 'media' | 'compact-media';
}

export const StoryChoiceCard: React.FC<StoryChoiceCardProps> = ({
  choice,
  index: _index,
  onSelect,
  disabled = false,
  layout = 'list',
}) => {
  const { t } = useTranslation();
  const isSelected = Boolean(choice.selected);

  // 1. 紧凑型媒体卡片 (PC 端右侧列表专用：左侧 16:9 缩略图 + 中间文本 + 右侧状态)
  if (layout === 'compact-media') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(choice)}
        className={`pointer-events-auto w-full group relative flex items-center justify-between p-1.5 sm:p-2 rounded-xl transition-all duration-200 cursor-pointer text-left overflow-hidden ${
          isSelected
            ? 'bg-[#151b33]/95 border border-primary ring-1 ring-primary/50 shadow-primary/25'
            : 'bg-[#0b0e1b]/85 hover:bg-[#151b33]/90 border border-white/12 hover:border-primary/40 shadow-[0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-md'
        } active:scale-[0.98]`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* 左侧微缩 16:9 缩略图 */}
          <div className="relative w-12 sm:w-14 aspect-video rounded-lg overflow-hidden bg-[#101426] border border-white/10 shrink-0">
            {choice.image ? (
              <img
                src={choice.image}
                alt={choice.text}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm">
                {choice.icon || ''}
              </div>
            )}
          </div>
          {/* 中间文字 */}
          <div className="min-w-0 flex-1">
            <span
              className={`text-xs font-semibold truncate block ${
                isSelected ? 'text-white' : 'text-white/95 group-hover:text-primary-light'
              }`}
            >
              {choice.text}
            </span>
            {choice.subText && (
              <span className="text-[10px] text-white/50 truncate block">
                {choice.subText}
              </span>
            )}
          </div>
        </div>
        {/* 右侧徽章 */}
        <div className="shrink-0 pl-1">
          {choice.badge ? (
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                isSelected ? 'bg-primary text-slate-950 font-bold' : 'bg-white/10 text-white/80'
              }`}
            >
              {choice.badge}
            </span>
          ) : isSelected ? (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary text-slate-950 shadow-sm">
              {t('story.selectedBadge')}
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-white/8 text-white/60 group-hover:text-primary-light">
              {t('story.tryBadge')}
            </span>
          )}
        </div>
      </button>
    );
  }

  // 2. 网格图文多媒体卡片 (Grid 展台布局)
  if (layout === 'media' || Boolean(choice.image)) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(choice)}
        className={`pointer-events-auto w-full group relative flex flex-col p-2 sm:p-2.5 rounded-xl transition-all duration-200 cursor-pointer text-left overflow-hidden ${
          isSelected
            ? 'bg-[#151b33]/95 border-2 border-primary ring-2 ring-primary/40 shadow-primary/30'
            : 'bg-[#0b0e1b]/85 hover:bg-[#101426]/95 border border-white/15 hover:border-primary/50 shadow-[0_8px_24px_rgba(0,0,0,0.5)] hover:shadow-primary/20 backdrop-blur-md'
        } active:scale-[0.98]`}
      >
        {/* 顶部 16:9 比例画面预览展台 */}
        <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-[#101426] border border-white/10 group-hover:border-white/20 transition-colors shadow-inner">
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
              className={`absolute top-1 right-1 px-1.5 py-0.2 rounded-[4px] text-[9px] font-semibold shadow-md ${
                isSelected
                  ? 'bg-primary text-slate-950 shadow-sm font-bold'
                  : 'bg-black/70 backdrop-blur-sm border border-white/20 text-white/90'
              }`}
            >
              {choice.badge}
            </div>
          ) : isSelected ? (
            <div className="absolute top-1 right-1 px-1.5 py-0.2 rounded-[4px] text-[9px] font-bold bg-primary text-slate-950 shadow-sm">
              {t('story.selectedBadge')}
            </div>
          ) : null}
        </div>

        {/* 底部文字信息 */}
        <div className="mt-1.5 flex flex-col gap-0.5 min-w-0">
          <span
            className={`text-xs font-semibold truncate transition-colors tracking-wide ${
              isSelected ? 'text-white' : 'text-white/95 group-hover:text-primary-light'
            }`}
          >
            {choice.text}
          </span>
          {choice.subText && (
            <span className="text-[10px] text-white/50 group-hover:text-white/70 truncate font-normal">
              {choice.subText}
            </span>
          )}
        </div>
      </button>
    );
  }

  // 3. 纯文字/对话分支列表项卡片与确认行动卡片 (语义化 primary 驱动)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(choice)}
      className={`pointer-events-auto w-full group relative flex items-center justify-between px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl transition-all duration-200 cursor-pointer text-left overflow-hidden ${
        isSelected
          ? 'bg-[#151b33]/95 border border-primary ring-1 ring-primary/40 shadow-primary/25 hover:border-primary-light'
          : 'bg-[#0b0e1b]/85 hover:bg-[#151b33]/95 border border-white/12 hover:border-primary/40 shadow-[0_4px_14px_rgba(0,0,0,0.35)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.55)] backdrop-blur-md'
      } active:scale-[0.98]`}
    >
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 z-10 flex-1">
        {/* 左侧图标 */}
        {choice.icon && (
          <span className="shrink-0 text-xs sm:text-sm">
            {choice.icon}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-xs sm:text-[13px] tracking-wide transition-colors truncate ${
                isSelected
                  ? 'text-white font-semibold drop-shadow-sm'
                  : 'text-white/90 group-hover:text-white font-medium'
              }`}
            >
              {choice.text}
            </span>
            {choice.badge ? (
              <span
                className={`shrink-0 px-1 py-0.2 rounded text-[9px] font-semibold ${
                  'bg-primary/20 border border-primary/30 text-primary-light'
                }`}
              >
                {choice.badge}
              </span>
            ) : null}
          </div>
          {choice.subText && (
            <p className="text-[10px] transition-colors line-clamp-1 font-normal mt-0.5 text-white/50 group-hover:text-white/70">
              {choice.subText}
            </p>
          )}
        </div>
      </div>
    </button>
  );
};
