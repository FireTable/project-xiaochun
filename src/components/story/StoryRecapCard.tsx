import React, { useState } from 'react';
import { ChevronDown, ChevronUp, History, BookOpen } from 'lucide-react';
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

  return (
    <div
      style={{ viewTransitionName: 'story-dialog-card' }}
      className="pointer-events-auto w-full p-4 sm:p-4.5 rounded-2xl bg-black/75 backdrop-blur-xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-300 ease-out animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-2.5"
    >
      {/* 卡片头部行 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-gradient-to-r from-[#ea8377] to-purple-500 text-white tracking-wider flex items-center gap-1 shadow-sm">
            <BookOpen className="w-3 h-3" />
            <span>前情提要</span>
          </span>
          {history.length > 1 && (
            <span className="text-[11px] text-white/50 font-mono">
              共 {history.length} 条对话
            </span>
          )}
        </div>

        {/* 展开/收起完整历史记录开关 */}
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 hover:text-white border border-white/15 text-xs transition-all duration-150 active:scale-95 cursor-pointer"
          >
            <History className="w-3 h-3 text-[#f5aa9c]" />
            <span>{isExpanded ? '收起记录' : '展开历史'}</span>
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5 opacity-70" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            )}
          </button>
        )}
      </div>

      {/* 展开态：完整对话记录流水线 (Backlog) */}
      {isExpanded ? (
        <div className="max-h-56 sm:max-h-64 overflow-y-auto space-y-2.5 pr-1.5 custom-bubble-scrollbar pt-1 animate-in fade-in duration-200">
          {history.map((item, idx) => {
            const isUser = item.role === 'user';
            return (
              <div key={item.id || idx} className="flex flex-col gap-1">
                {isUser ? (
                  <div className="flex items-start gap-2 bg-white/[0.04] p-2 rounded-xl border border-white/10">
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">
                      你已选择
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-medium text-white/95">
                        {item.text}
                      </p>
                      {item.subText && (
                        <p className="text-[10px] text-white/50 mt-0.5">
                          {item.subText}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 p-1">
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ea8377]/20 border border-[#ea8377]/40 text-[#f5aa9c]">
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
        /* 折叠态：仅清晰展示小蠢刚才所说的核心台词 */
        <p className="text-sm sm:text-base text-white/95 leading-relaxed tracking-wide font-medium drop-shadow-sm pt-0.5">
          {currentSpeechText ||
            history.slice().reverse().find((h) => h.role === 'xiaochun')?.text ||
            (history.length > 0 ? history[history.length - 1].text : '')}
        </p>
      )}
    </div>
  );
};
