/**
 * shadcn-style Tooltip — 基于 @radix-ui/react-tooltip 手写,
 * 与项目现有 DropdownMenu / Button 同一套样式语言。
 *
 * ponytail: 默认 delayDuration 300ms — 桌面 hover 0.3s 才出,避免快速划过闪烁;
 * 移动端触屏无 hover 概念,Radix 会在 tap 后通过 focus 弹出,松手后消失,
 * 配合 TooltipProvider 的 skipDelayDuration 让连续 hover 不卡。
 *
 * TouchAwareTooltip: 在 (hover: none) 设备上 force open — 让 tooltip 在移动端
 * 一直可见,用户一眼看清每个图标按钮的作用,不用 hover / 长按。
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

// ponytail: 不引入 useMediaQuery hook,内联 matchMedia — 触屏判定是项目唯一的 media query,
// 多一个 hook 文件不划算。SSR 安全:window 不存在时返回 false,行为等同桌面端。
function useIsTouchDevice(): boolean {
  const [v, setV] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)');
    setV(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setV(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return v;
}

type TouchAwareTooltipProps = React.ComponentProps<typeof Tooltip>;

/** 触屏设备上强制 open,桌面端退化为原生 hover 行为。 */
function TouchAwareTooltip(props: TouchAwareTooltipProps) {
  const isTouch = useIsTouchDevice();
  // ponytail: 触屏 → 受控 open=true 永远展开;桌面 → 不传 open 走 Radix 默认 hover/focus。
  if (isTouch) return <Tooltip open={true} {...props} />;
  return <Tooltip {...props} />;
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TouchAwareTooltip };
