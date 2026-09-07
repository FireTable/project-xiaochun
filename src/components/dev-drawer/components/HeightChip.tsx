import React, { useEffect, useState } from 'react';
import { vrmEngine } from '@/core/vrmEngine';

/**
 * ponytail: 自带 state 自带订阅 — 高度每帧更新时只重渲这一颗 chip,
 * 不会把整个 drawer 重新过一遍,移动端 slider 拖动不会被 notifyHeightChange 打断。
 */
export const HeightChip: React.FC<{ title: string }> = ({ title }) => {
  const [height, setHeight] = useState<number>(() => vrmEngine.getHeightCm());
  useEffect(() => {
    const update = () => setHeight(vrmEngine.getHeightCm());
    const unsub = vrmEngine.onHeightChange(update);
    return unsub;
  }, []);
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-brand-500/20 text-brand-300 border border-brand-500/30 shrink-0 tabular-nums"
      title={title}
    >
      📏 {height.toFixed(1)}cm
    </span>
  );
};