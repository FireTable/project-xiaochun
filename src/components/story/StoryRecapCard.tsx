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
          ? 'p-4 rounded-2xl bg-black/85 backdrop-blur-2xl border border-white/15 shadow-[0_12px_40px_rgba(0,0,0,0.7)]'
          : 'px-4 py-3 sm:px-5 sm:py-3.5 rounded-2xl bg-gradient-to-t from-black/85 via-black/60 to-black/35 backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)]'
      } flex flex-col gap-2`}
    >
      {/* 头部行：角色名 ✦ 小蠢 与 极简回顾按钮 (已移除冗余标签) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-1.5">
          <span className="text-xs sm:text-[13px] font-semibold tracking-wider text-amber-200/90 flex items-center gap-1 drop-shadow-sm font-sans">
            <span className="text-amber-300 text-xs">✦</span>
            <span>小蠢</span>
          </span>
        </div>

        {/* 展开/收起完整历史记录开关 (极简无框晶莹胶囊) */}
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/15 active:scale-95 text-white/70 hover:text-white border border-white/10 text-[11px] sm:text-xs transition-all duration-150 cursor-pointer"
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
        <div className="max-h-52 sm:max-h-60 overflow-y-auto space-y-2 pr-1 custom-bubble-scrollbar pt-1 animate-in fade-in duration-200">
          {history.map((item, idx) => {
            const isUser = item.role === 'user';
            return (
              <div key={item.id || idx} className="flex flex-col gap-1">
                {isUser ? (
                  <div className="flex items-start gap-2 bg-white/[0.04] px-2.5 py-1.5 rounded-xl border border-white/5">
                    <span className="shrink-0 text-[11px] font-medium text-amber-200/80 font-mono pt-0.5">
                      ✦ 你
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm text-white/95">
                        {item.text}
                      </p>
                      {item.subText && (
                        <p className="text-[10px] text-white/40 mt-0.5">
                          {item.subText}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 px-1 py-0.5">
                    <span className="shrink-0 text-[11px] font-medium text-[#f5aa9c] font-mono pt-0.5">
                      ✦ 小蠢
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
        <p className="text-sm sm:text-[15px] text-white/95 leading-relaxed tracking-wide font-normal drop-shadow pt-0.5">
          {latestText}
        </p>
      )}
    </div>
  );
};
