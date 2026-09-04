/**
 * shadcn-style Tooltip — 基于 @radix-ui/react-tooltip 手写,
 * 与项目现有 DropdownMenu / Button 同一套样式语言。
 *
 * ponytail: 全局通过 TouchAwareTooltip 强制 open=true,任何设备/任何交互
 * 模式下 tooltip 都常驻可见 — icon-only 按钮没有可见文字标签,tooltip
 * 是唯一的语义提示;hover 才显示对触屏 + 桌面快速浏览都不友好。
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

// ponytail: 桌面也强制一直显示,不做端区分 — 项目方要求全局常驻。icon-only 按钮
// 没有可见文字标签,tooltip 是唯一的语义提示;hover 才显示对触屏 + 桌面快速浏览都不友好。
type TouchAwareTooltipProps = React.ComponentProps<typeof Tooltip>;

/** 全端常驻 tooltip:无论桌面/移动,都强制 open=true。 */
function TouchAwareTooltip(props: TouchAwareTooltipProps) {
  return <Tooltip open={true} {...props} />;
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TouchAwareTooltip };
