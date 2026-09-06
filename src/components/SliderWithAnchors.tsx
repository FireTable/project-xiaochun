import React from 'react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

/**
 * ponytail: 范围滑块的「锚点」概念。DevDrawer 里每个滑块标记两个参考值:
 * - 1.0(100% 中性点)— 全身大小、灯光亮度、饱和度这些归一化值都靠这个回归
 * - config.ts 当前默认值 — 不同滑块默认值不一样(light base / saturation default),
 *   跟 1.0 经常不同 — 标记让用户一眼看到「出厂设定」在哪
 *
 * ponytail: 刻度线位置用 Radix 真实公式 `getThumbInBoundsOffset`
 * (node_modules/@radix-ui/react-slider/dist/index.mjs:609) — 低端加偏移、高端不加,
 * 之前的 inset-x-1.5 是基于「track = root - thumb」的错误假设,导致刻线在高/低端
 * 分别偏左/偏右 6px。这里镜像 Radix 的 thumbInBoundsOffset,刻线就跟 thumb 中心严丝合缝。
 */

export type SliderAnchorColor = 'brand' | 'emerald' | 'amber';

export interface SliderAnchor {
  value: number;
  label: string;
  color?: SliderAnchorColor;
}

interface SliderWithAnchorsProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
  anchors: SliderAnchor[];
  className?: string;
}

// ponytail: 镜像 Radix Slider thumb 的偏移公式 (LTR direction, thumb w-3 = 12px)。
// thumb 宽度若改,这里同步改。
export const THUMB_HALF_WIDTH_PX = 6;
export function thumbInBoundsOffset(percent: number): number {
  const halfPercent = 50;
  const offset = (Math.min(percent, halfPercent) / halfPercent) * THUMB_HALF_WIDTH_PX;
  return THUMB_HALF_WIDTH_PX - offset;
}

const COLOR_MAP: Record<SliderAnchorColor, string> = {
  brand: 'bg-brand-400',
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-400',
};

export const SliderWithAnchors: React.FC<SliderWithAnchorsProps> = ({
  value,
  min,
  max,
  step,
  onChange,
  anchors,
  className = '',
}) => {
  const range = max - min;
  return (
    <div className={cn('relative w-full py-1', className)}>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="w-full"
      />
      {/* 刻度层 — 纯 visual, 0 事件 handler。
          left = calc(pct% + thumbInBoundsOffset px),transform translateX(-50%) ——
          跟 Radix Thumb 同一个坐标系,严丝合缝。 */}
      <div className="pointer-events-none absolute inset-y-0 inset-x-0 z-10">
        {anchors.map((anchor, idx) => {
          const pct = range > 0 ? ((anchor.value - min) / range) * 100 : 0;
          const isActive = Math.abs(value - anchor.value) <= step / 2;
          const color = anchor.color ?? 'brand';
          return (
            <span
              key={`${anchor.label}-${idx}`}
              title={`${anchor.label} → ${anchor.value}`}
              className={cn(
                'absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2',
                isActive ? COLOR_MAP[color] : 'bg-white/40',
                isActive && 'shadow-[0_0_4px_currentColor]'
              )}
              style={{ left: `calc(${pct}% + ${thumbInBoundsOffset(pct)}px)` }}
            />
          );
        })}
      </div>
    </div>
  );
};
