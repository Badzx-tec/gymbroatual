import React from 'react';

import { cn } from '../../lib/cn';

export default function TextField({ label, className, inputClassName, ...props }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      {label ? <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</span> : null}
      <input
        className={cn(
          'h-11 w-full rounded-md border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]',
          inputClassName
        )}
        {...props}
      />
    </label>
  );
}
