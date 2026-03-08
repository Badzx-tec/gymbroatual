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
        'rounded-2xl border border-zinc-900 bg-zinc-950/72 shadow-[0_16px_52px_-40px_rgba(0,0,0,0.92)]',
        className
      )}
    >
      {(title || description || actions) ? (
        <div className="flex flex-col gap-3 border-b border-zinc-900 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-100">{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn('px-5 py-4', bodyClassName)}>{children}</div>
    </section>
  );
}
