import React from 'react';

import { cn } from '../../lib/cn';

export default function ContentCard({ className, children, elevated = false }) {
  return (
    <section
      className={cn(
        'rounded-[var(--radius-md)] border border-[color:rgba(39,49,58,0.88)] bg-[linear-gradient(180deg,rgba(17,22,26,0.9),rgba(12,16,19,0.92))]',
        elevated ? 'shadow-[var(--shadow-panel)]' : 'shadow-[var(--shadow-soft)]',
        className
      )}
    >
      {children}
    </section>
  );
}
