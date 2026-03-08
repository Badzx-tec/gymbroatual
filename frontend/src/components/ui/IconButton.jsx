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
    secondary: 'border border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800',
    ghost: 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
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
