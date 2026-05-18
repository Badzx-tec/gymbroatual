import React from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '../../lib/cn';

const variantClasses = {
  primary: 'bg-[var(--brand-primary)] text-black hover:bg-[var(--brand-primary-hover)]',
  secondary: 'border border-[var(--surface-border)] bg-[var(--surface-soft)] text-[var(--text-primary)] hover:bg-[var(--surface-soft-hover)]',
  ghost: 'border border-[var(--surface-border)] bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]',
  danger: 'bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] hover:brightness-125 border border-[var(--status-danger-border)]',
};

const sizeClasses = {
  sm: 'h-9 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
};

export default function Button({
  as: Component = 'button',
  className,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  loading = false,
  children,
  disabled,
  ...props
}) {
  return (
    <Component
      type={Component === 'button' ? type : undefined}
      disabled={loading || disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </Component>
  );
}
