import React from 'react';
import { useDevDrawer } from '../context';

/**
 * 段卡片包裹:统一所有可折叠段的视觉(p-3.5 + 浅色背景 + 细边)。
 * ponytail: 抽出来防止 N 处复制粘贴后某个角落偷偷改样式又对不齐。
 *
 * 折叠门控:传 `id` 时,第一个子(SectionHeader)始终渲染,其余按 collapsed 隐藏。
 * 不传 id 则纯容器,所有子始终渲染(给未来非折叠段留口子)。
 */
export const SectionCard: React.FC<{ id?: string; children: React.ReactNode }> = ({ id, children }) => {
  const ctx = useDevDrawer();
  const gateCollapsed = id !== undefined && ctx.collapsed.has(id);

  const arr = React.Children.toArray(children);
  return (
    <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
      {arr.map((child, idx) => {
        if (idx === 0) return child;
        return gateCollapsed ? null : child;
      })}
    </div>
  );
};