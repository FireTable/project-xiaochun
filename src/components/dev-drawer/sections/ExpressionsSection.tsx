import React, { useState } from 'react';
import { APP_CONFIG } from '@/config';
import { vrmEngine } from '@/core/vrmEngine';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { saveDevDrawerSettings } from '../storage';

/**
 * ponytail: 这段是 6 个预设表情按钮 + modified 检测 + reset 回 neutral。
 * 自带 state 自带 engine 调用,跟 drawer 壳完全解耦。
 */
export const ExpressionsSection: React.FC = () => {
  const { t } = useDevDrawer();
  const expressions = APP_CONFIG.expressions;
  const [activeExpr, setActiveExpr] = useState<string>(() => {
    try {
      const raw = localStorage.getItem('xiaochun_dev_drawer_all_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.activeExpr ?? 'neutral';
      }
    } catch {}
    return 'neutral';
  });

  const handleClick = (expr: string) => {
    setActiveExpr(expr);
    vrmEngine.setExpression(expr);
    saveDevDrawerSettings({ activeExpr: expr });
  };

  const handleReset = () => {
    setActiveExpr('neutral');
    vrmEngine.setExpression('neutral');
    saveDevDrawerSettings({ activeExpr: 'neutral' });
  };

  const modified = activeExpr !== 'neutral';

  return (
    <SectionCard id="expressions">
      <SectionHeader
        id="expressions"
        title={t('panel.expressionsLabel')}
        modified={modified}
        onReset={handleReset}
        showReset={modified}
      />
      <div className="grid grid-cols-3 gap-2">
        {expressions.map((e) => (
          <button
            key={e.key}
            onClick={() => handleClick(e.key)}
            className={`py-2 px-1 rounded-xl text-xs font-medium cursor-pointer text-center select-none ${
              activeExpr === e.key
                ? 'bg-brand-500/25 border border-brand-400/60 text-brand-100 shadow-sm shadow-brand-500/20'
                : 'bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white'
            }`}
          >
            {t(`panel.expressionList.${e.key}`)}
          </button>
        ))}
      </div>
    </SectionCard>
  );
};