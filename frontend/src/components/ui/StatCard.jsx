import React from 'react';

import { cn } from '../../lib/cn';

export default function StatCard({ label, value, hint, icon: Icon, accent = 'default', className }) {
  const accentClass =
    accent === 'success'
      ? 'text-emerald-300'
      : accent === 'danger'
        ? 'text-red-300'
        : accent === 'warning'
          ? 'text-amber-300'
          : accent === 'info'
            ? 'text-sky-300'
            : 'text-[var(--text-primary)]';

  return (
    <div className={cn('rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4 shadow-[var(--shadow-soft)]', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">{label}</p>
          <p className={cn('mt-2 text-2xl font-semibold', accentClass)}>{value}</p>
        </div>
        {Icon ? (
          <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-soft)] p-2 text-[var(--text-muted)]">
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
      {hint ? <p className="mt-2 text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}
