import React from 'react';

import { cn } from '../../lib/cn';

export default function PageHeader({ title, subtitle, actions, eyebrow, className }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-zinc-900 bg-[radial-gradient(circle_at_top_left,rgba(204,255,0,0.08),transparent_28%),linear-gradient(180deg,rgba(24,24,27,0.92),rgba(9,9,11,0.96))] px-6 py-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.85)]',
        className
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-heading text-3xl uppercase tracking-[0.04em] text-zinc-50">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-zinc-400">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
