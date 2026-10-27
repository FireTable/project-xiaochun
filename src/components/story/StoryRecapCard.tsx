import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { StoryHistoryEntry } from '@/story/schema';

interface StoryRecapCardProps {
  currentSpeechText?: string;
  history: StoryHistoryEntry[];
}

export const StoryRecapCard: React.FC<StoryRecapCardProps> = ({
  currentSpeechText,
  history,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // 若无台词且无历史记录，则不渲染
  if (!currentSpeechText && history.length === 0) return null;

  const latestText =
    currentSpeechText ||
    history.slice().reverse().find((h) => h.role === 'xiaochun')?.text ||
    (history.length > 0 ? history[history.length - 1].text : '');

  return (
    <div
      style={{ viewTransitionName: 'story-dialog-card' }}
      className={`pointer-events-auto w-full transition-all duration-300 ease-out animate-in fade-in slide-in-from-bottom-2 ${
        isExpanded
          ? 'p-4 sm:p-5 rounded-2xl bg-[#0b0e1b]/90 backdrop-blur-2xl border border-white/15 shadow-[0_16px_48px_rgba(0,0,0,0.75)]'
          : 'px-4 py-3 sm:px-5 sm:py-3.5 rounded-2xl bg-gradient-to-t from-[#0b0e1b]/95 via-[#0b0e1b]/80 to-[#101426]/60 backdrop-blur-xl border border-white/15 shadow-[0_12px_36px_rgba(0,0,0,0.6)]'
      } flex flex-col gap-2`}
    >
      {/* 头部行：角色名与回顾开关 */}
      <div className="flex items-center justify-between">
        <span className="text-xs sm:text-sm font-semibold tracking-wide text-white">
          小蠢
        </span>

        {/* 展开/收起完整历史记录开关 */}
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/15 active:scale-95 text-white/80 hover:text-white border border-white/10 text-xs transition-all duration-150 cursor-pointer shadow-sm"
          >
            <span>{isExpanded ? '收起' : `回顾 · ${history.length}`}</span>
            {isExpanded ? (
              <ChevronUp className="w-3 h-3 opacity-70" />
            ) : (
              <ChevronDown className="w-3 h-3 opacity-70" />
            )}
          </button>
        )}
      </div>

      {/* 展开态：完整对话记录流水线 (Backlog) */}
      {isExpanded ? (
        <div className="max-h-52 sm:max-h-60 overflow-y-auto space-y-2.5 pr-1 custom-bubble-scrollbar pt-1 animate-in fade-in duration-200">
          {history.map((item, idx) => {
            const isUser = item.role === 'user';
            return (
              <div key={item.id || idx} className="flex flex-col gap-1">
                {isUser ? (
                  <div className="flex items-start gap-2.5 bg-white/[0.04] hover:bg-white/[0.06] px-3 py-2 rounded-xl border border-white/8 transition-colors">
                    <span className="shrink-0 text-xs font-semibold text-[#f3d09a] pt-0.5">
                      你
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm text-white/95 leading-relaxed">
                        {item.text}
                      </p>
                      {item.subText && (
                        <p className="text-[10px] text-white/45 mt-0.5">
                          {item.subText}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 px-1 py-1">
                    <span className="shrink-0 text-xs font-semibold text-[#f5aa9c] pt-0.5">
                      小蠢
                    </span>
                    <p className="text-xs sm:text-sm text-white/90 leading-relaxed font-normal">
                      {item.text}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* 折叠态：清晰展示小蠢的核心台词，沉浸无扰 */
        <p className="text-sm sm:text-[15px] text-white/95 leading-relaxed tracking-wide font-normal drop-shadow-sm pt-0.5 select-text">
          {latestText}
        </p>
      )}
    </div>
  );
};
