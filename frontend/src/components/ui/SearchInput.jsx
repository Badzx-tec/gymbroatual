import React from 'react';
import { Search } from 'lucide-react';

import { cn } from '../../lib/cn';

export default function SearchInput({ className, inputClassName, ...props }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        className={cn(
          'h-11 w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] pl-10 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]',
          inputClassName
        )}
        {...props}
      />
    </div>
  );
}
