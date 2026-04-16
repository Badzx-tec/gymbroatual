import React from 'react';

import { cn } from '../../lib/cn';

const accentConfig = {
  success: {
    text: 'text-emerald-300',
    icon: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    bar: 'bg-emerald-400',
  },
  danger: {
    text: 'text-red-300',
    icon: 'border-red-500/30 bg-red-500/10 text-red-300',
    bar: 'bg-red-400',
  },
  warning: {
    text: 'text-amber-300',
    icon: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    bar: 'bg-amber-400',
  },
  info: {
    text: 'text-sky-300',
    icon: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    bar: 'bg-sky-400',
  },
  default: {
    text: 'text-[var(--text-primary)]',
    icon: 'border-[var(--surface-border)] bg-[var(--surface-soft)] text-[var(--text-muted)]',
    bar: 'bg-zinc-600',
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
