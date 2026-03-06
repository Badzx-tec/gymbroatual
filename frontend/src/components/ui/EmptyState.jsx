import React from 'react';

import { cn } from '../../lib/cn';

export default function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-10 text-center',
        className
      )}
    >
      {Icon ? (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
      {description ? <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-400">{description}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
