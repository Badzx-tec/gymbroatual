import React from 'react';

import { cn } from '../../lib/cn';

export default function PageHeader({ title, subtitle, actions, eyebrow, className }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--surface-border)] bg-[var(--hero-surface)] px-6 py-5 shadow-[var(--shadow-soft)]',
        className
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-heading text-3xl uppercase tracking-[0.04em] text-[var(--text-primary)]">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-[var(--text-secondary)]">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
