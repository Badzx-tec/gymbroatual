import React from 'react';

import { cn } from '../../lib/cn';

const toneClasses = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  danger: 'border-red-500/30 bg-red-500/10 text-red-200',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  neutral: 'border-zinc-700 bg-zinc-900 text-zinc-300',
};

const sizeClasses = {
  sm: 'px-2 py-1 text-[10px]',
  md: 'px-2.5 py-1 text-[11px]',
};

export default function StatusBadge({ label, tone = 'neutral', size = 'md', className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-semibold uppercase tracking-[0.18em]',
        toneClasses[tone] || toneClasses.neutral,
        sizeClasses[size] || sizeClasses.md,
        className
      )}
    >
      {label}
    </span>
  );
}
