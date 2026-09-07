import React, { useContext } from 'react';
import { ChevronDown, RotateCcw } from '@/components/icons';
import { DevDrawerContext } from '../context';

interface SectionHeaderProps {
  id: string;
  title: string;
  modified: boolean;
  onReset?: () => void;
  showReset?: boolean;
  uppercase?: boolean;
}

/**
 * 段折叠头:chevron + 标题 + (已修改)小点 + (可选)单段重置按钮。
 * 两态标题行都固定 py-1.5,折叠时去掉下划线 + 收紧字色;展开态用独立 1px 分割线
 * 取代 border-b,避免 border 计入 padding box 干扰 items-center 居中。
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({
  id,
  title,
  modified,
  onReset,
  showReset,
  uppercase = true,
}) => {
  const { t, collapsed, toggleCollapsed } = useContext(DevDrawerContext);
  const isCollapsed = collapsed.has(id);
  return (
    <div className="flex flex-col min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0 py-1.5">
        <button
          type="button"
          onClick={() => toggleCollapsed(id)}
          aria-expanded={!isCollapsed}
          className={`flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer transition-colors text-left ${isCollapsed ? 'text-white/55 hover:text-white/80' : 'text-white/70 hover:text-white'
            }`}
        >
          <ChevronDown className={`w-3 h-3 text-white/40 shrink-0 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`} />
          <h3 className={`text-xs font-semibold tracking-wider truncate min-w-0 ${uppercase ? 'uppercase' : ''}`}>{title}</h3>
          {modified && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 shadow-[0_0_4px_rgba(251,191,36,0.6)]"
              title={t('panel.devDrawer.modifiedDot')}
            />
          )}
        </button>
        {showReset && onReset && !isCollapsed && (
          <button
            onClick={onReset}
            className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white transition-colors cursor-pointer shrink-0"
            title={t('panel.devDrawer.resetSection')}
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t('panel.devDrawerExtra.reset')}</span>
          </button>
        )}
      </div>
      {!isCollapsed && <div className="h-px bg-white/10 mt-2 shrink-0" aria-hidden />}
    </div>
  );
};