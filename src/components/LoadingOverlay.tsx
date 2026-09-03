import React from 'react';
import { useTranslation } from 'react-i18next';
import type { LoadingState } from '@/core/vrmEngine';
import { Loader2 } from '@/components/icons';

interface LoadingOverlayProps {
  state: LoadingState;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ state }) => {
  const { t } = useTranslation();
  if (!state.active) return null;

  const subtitle = state.subtitleKey
    ? t(`loading.${state.subtitleKey}`, state.subtitleVars as Record<string, unknown> | undefined)
    : t('loading.parsingModel');

  return (
    <div
      id="loading-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl transition-opacity duration-300"
    >
      {/* ponytail: 移动端 mx-4 + p-6 让卡片两端不贴边;sm 起拉回 mx-auto + p-7。 */}
      <div className="w-full max-w-xs mx-4 sm:mx-auto p-6 sm:p-7 rounded-2xl flex flex-col items-center gap-3 sm:gap-3.5 text-center shadow-2xl bg-slate-950/85 backdrop-blur-2xl border border-white/20">
        {/* 微光脉冲动效 */}
        <div className="relative flex items-center justify-center w-12 h-12">
          <div className="absolute inset-0 rounded-full bg-brand-500/20 blur-md animate-pulse" />
          <Loader2 className="w-8 h-8 text-brand-300 animate-spin relative" />
        </div>

        <div>
          <h2 id="loading-title" className="text-base font-bold text-white tracking-tight">
            {t('loading.title')}
          </h2>
          <p id="loading-subtitle" className="text-xs text-white/50 mt-1 break-words">
            {subtitle}
          </p>
        </div>

        {/* 拟态进度条 */}
        <div className="w-full mt-2">
          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden border border-white/10">
            <div
              id="progress-bar"
              className="h-full rounded-full bg-gradient-to-r from-brand-500 via-brand-400 to-brand-200 transition-all duration-200"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <div className="flex justify-end mt-1.5">
            <span id="progress-text" className="text-[11px] font-semibold text-brand-300">
              {state.progress}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
