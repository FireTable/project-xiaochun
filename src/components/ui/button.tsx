import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-xs font-semibold ring-offset-background transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 select-none cursor-pointer touch-manipulation',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-r from-brand-500 via-brand-400 to-brand-300 text-white shadow-lg shadow-brand-500/30 hover:from-brand-600 hover:via-brand-500 hover:to-brand-400 hover:shadow-brand-500/45 active:scale-95',
        glass:
          'bg-slate-950/80 hover:bg-slate-900/90 text-white/90 hover:text-white border border-white/20 hover:border-brand-300/60 backdrop-blur-xl shadow-lg shadow-black/40 active:scale-95',
        secondary:
          'bg-white/10 hover:bg-white/20 text-white border border-white/10 backdrop-blur-md active:scale-95',
        ghost:
          'hover:bg-white/10 text-white/80 hover:text-white active:scale-95',
        outline:
          'border border-brand-400/40 bg-brand-400/10 text-brand-200 hover:bg-brand-400/20 active:scale-95',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6 text-sm',
        icon: 'h-9 w-9 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
