/**
 * Slider — shadcn Slider based on @radix-ui/react-slider.
 *
 * ponytail: 单 thumb 滑块,值用 onValueChange 回调给出去。
 * 视觉与现有 dark glass 风格对齐 — 轨道 white/15,填充 brand-400,
 * thumb 圆形带 brand 发光,hover 微放大。
 *
 * 横/纵向通用 — 用 data-orientation 属性选择器切换宽高语义:
 * - 横向: Track `h-1.5 w-full`, Range `h-full`, Root `items-center`
 * - 纵向: Track `w-1.5 h-full`, Range `w-full`, Root `justify-center flex-col`
 */

import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex touch-none select-none w-full h-full data-[orientation=horizontal]:items-center data-[orientation=horizontal]:flex-row',
      'data-[orientation=vertical]:justify-center data-[orientation=vertical]:flex-col',
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className={cn(
      'relative grow overflow-hidden rounded-full bg-white/15',
      'data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full',
      'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5'
    )}>
      <SliderPrimitive.Range className={cn(
        'absolute bg-brand-400',
        'data-[orientation=horizontal]:h-full data-[orientation=horizontal]:w-auto',
        'data-[orientation=vertical]:w-full data-[orientation=vertical]:h-auto'
      )} />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className={cn(
        'block h-3 w-3 rounded-full border border-white/80 bg-white cursor-grab active:cursor-grabbing',
        'shadow-md shadow-black/30',
        'transition-transform hover:scale-110 active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
        'disabled:pointer-events-none disabled:opacity-40'
      )}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
