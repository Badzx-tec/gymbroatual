import React from 'react';

import { cn } from '../../lib/cn';

export default function IconButton({
  className,
  children,
  variant = 'secondary',
  type = 'button',
  ...props
}) {
  const variantClasses = {
    primary: 'bg-[var(--brand-primary)] text-black hover:bg-[var(--brand-primary-hover)]',
    secondary: 'border border-[var(--surface-border)] bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft-hover)]',
    ghost: 'text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]',
  };

  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]',
        variantClasses[variant] || variantClasses.secondary,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
