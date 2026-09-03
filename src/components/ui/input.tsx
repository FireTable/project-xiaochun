import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-full border border-white/15 bg-slate-950/70 px-4 py-2 text-sm text-white placeholder:text-slate-400 backdrop-blur-xl transition-all duration-200 focus-visible:outline-none focus-visible:border-brand-300 focus-visible:ring-2 focus-visible:ring-brand-400/30 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
