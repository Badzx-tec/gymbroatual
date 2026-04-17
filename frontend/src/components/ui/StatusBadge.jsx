import React from 'react';

import { cn } from '../../lib/cn';

const toneClasses = {
  success: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-text)]',
  warning: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]',
  danger: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)]',
  info: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-text)]',
  neutral: 'border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)]',
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
