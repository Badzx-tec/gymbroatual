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
            : 'text-zinc-100';

  return (
    <div className={cn('rounded-xl border border-zinc-900 bg-zinc-950/70 p-4 shadow-[0_16px_48px_-36px_rgba(0,0,0,0.85)]', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{label}</p>
          <p className={cn('mt-2 text-2xl font-semibold', accentClass)}>{value}</p>
        </div>
        {Icon ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2 text-zinc-400">
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
      {hint ? <p className="mt-2 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}
