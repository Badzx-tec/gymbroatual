import React from 'react';

import { cn } from '../../lib/cn';

const accentConfig = {
  success: {
    text: 'text-[var(--status-success-text)]',
    icon: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-text)]',
    bar: 'bg-[var(--status-success)]',
  },
  danger: {
    text: 'text-[var(--status-danger-text)]',
    icon: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)]',
    bar: 'bg-[var(--status-danger)]',
  },
  warning: {
    text: 'text-[var(--status-warning-text)]',
    icon: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]',
    bar: 'bg-[var(--status-warning)]',
  },
  info: {
    text: 'text-[var(--status-info-text)]',
    icon: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-text)]',
    bar: 'bg-[var(--status-info)]',
  },
  default: {
    text: 'text-[var(--text-primary)]',
    icon: 'border-[var(--surface-border)] bg-[var(--surface-soft)] text-[var(--text-muted)]',
    bar: 'bg-[var(--surface-border-strong)]',
  },
};

export default function StatCard({ label, value, hint, icon: Icon, accent = 'default', className }) {
  const cfg = accentConfig[accent] || accentConfig.default;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4 shadow-[var(--shadow-soft)]',
        className
      )}
    >
      {/* Left accent stripe */}
      <span className={cn('absolute bottom-3 left-0 top-3 w-[3px] rounded-r-full opacity-60', cfg.bar)} />

      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">{label}</p>
          <p className={cn('mt-2 font-mono text-2xl font-bold tabular-nums leading-none', cfg.text)}>{value}</p>
        </div>
        {Icon ? (
          <div className={cn('shrink-0 rounded-lg border p-2', cfg.icon)}>
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
      {hint ? <p className="mt-2 pl-2 text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}
