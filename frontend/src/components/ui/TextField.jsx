import React from 'react';

import { cn } from '../../lib/cn';

export default function TextField({ label, className, inputClassName, ...props }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      {label ? <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</span> : null}
      <input
        className={cn(
          'h-11 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]',
          inputClassName
        )}
        {...props}
      />
    </label>
  );
}
