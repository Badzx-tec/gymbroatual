import React from 'react';
import { Search } from 'lucide-react';

import { cn } from '../../lib/cn';

export default function SearchInput({ className, inputClassName, ...props }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
      <input
        className={cn(
          'h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/90 pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]',
          inputClassName
        )}
        {...props}
      />
    </div>
  );
}
