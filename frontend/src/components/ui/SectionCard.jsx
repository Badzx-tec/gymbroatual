import React from 'react';

import { cn } from '../../lib/cn';

export default function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] shadow-[var(--shadow-soft)]',
        className
      )}
    >
      {(title || description || actions) ? (
        <div className="flex flex-col gap-3 border-b border-[var(--surface-border)] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-primary)]">{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn('px-5 py-4', bodyClassName)}>{children}</div>
    </section>
  );
}
