import React from 'react';

import { cn } from '../../lib/cn';

export default function SelectField({ label, className, selectClassName, children, ...props }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      {label ? <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</span> : null}
      <select
        className={cn(
          'h-11 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]',
          selectClassName
        )}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}
