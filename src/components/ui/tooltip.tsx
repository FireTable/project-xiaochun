/**
 * shadcn-style Tooltip — 基于 @radix-ui/react-tooltip 手写,
 * 与项目现有 DropdownMenu / Button 同一套样式语言。
 *
 * ponytail: 默认 delayDuration 300ms — 桌面 hover 0.3s 才出,避免快速划过闪烁;
 * 移动端触屏无 hover 概念,Radix 会在 tap 后通过 focus 弹出,松手后消失,
 * 配合 TooltipProvider 的 skipDelayDuration 让连续 hover 不卡。
 */
import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-lg border border-white/20 bg-slate-950/95 px-2.5 py-1.5 text-xs text-white shadow-2xl backdrop-blur-2xl',
        'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=delayed-open]:zoom-in-95 origin-(--radix-tooltip-content-transform-origin)',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
