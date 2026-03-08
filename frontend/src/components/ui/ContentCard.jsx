import React from 'react';

import { cn } from '../../lib/cn';

export default function ContentCard({ className, children, elevated = false }) {
  return (
    <section
      className={cn(
        'rounded-[var(--radius-md)] border border-[var(--surface-border)] bg-[var(--surface-panel-bg)]',
        elevated ? 'shadow-[var(--shadow-panel)]' : 'shadow-[var(--shadow-soft)]',
        className
      )}
    >
      {children}
    </section>
  );
}
