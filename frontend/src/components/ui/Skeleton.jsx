import React from 'react';

import { cn } from '../../lib/cn';

/**
 * Visual placeholder that mimics content shape while data loads.
 * Respects `prefers-reduced-motion`: animation disabled for users who opt out.
 *
 * @param {object}   props
 * @param {string}   [props.className]  Extra Tailwind classes (sizing, shape).
 * @param {boolean}  [props.rounded]    If true, applies rounded-full instead of rounded.
 * @param {string}   [props.label]      Optional aria-label for screen readers.
 */
export function Skeleton({ className, rounded = false, label }) {
  return (
    <div
      role="status"
      aria-label={label || 'Carregando'}
      aria-live="polite"
      className={cn(
        'motion-safe:animate-pulse bg-[var(--surface-soft)]',
        rounded ? 'rounded-full' : 'rounded',
        className,
      )}
    />
  );
}

/**
 * Row of skeleton placeholders mimicking a list item.
 */
export function SkeletonRow({ columns = 5, className }) {
  return (
    <div className={cn('flex items-center gap-3 py-3', className)}>
      {Array.from({ length: columns }).map((_, idx) => (
        <Skeleton
          key={idx}
          className={cn('h-4', idx === 0 ? 'w-10' : idx === columns - 1 ? 'w-16' : 'w-32')}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton suitable for table loading states. Renders <tr>+<td> rows so it can
 * sit directly inside a <tbody>.
 */
export function SkeletonTableRows({ rows = 5, columns = 6 }) {
  return Array.from({ length: rows }).map((_, rowIdx) => (
    <tr key={rowIdx} className="border-b border-[var(--surface-border)]">
      {Array.from({ length: columns }).map((__, colIdx) => (
        <td key={colIdx} className="px-2 py-3">
          <Skeleton
            className={cn(
              'h-4',
              colIdx === 0 ? 'w-10' : colIdx === columns - 1 ? 'w-16' : 'w-28',
            )}
          />
        </td>
      ))}
    </tr>
  ));
}

/**
 * Card-shaped skeleton mimicking a StatCard while metrics load.
 */
export function SkeletonStatCard() {
  return (
    <div
      role="status"
      aria-label="Carregando metrica"
      className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-5"
    >
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="mb-2 h-7 w-32" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

/**
 * Chart-shaped skeleton for lazy-loaded chart panels.
 */
export function SkeletonChart({ height = 'h-52' }) {
  return (
    <div
      role="status"
      aria-label="Carregando grafico"
      className={cn(
        'rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-5',
      )}
    >
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className={cn('w-full', height)} />
    </div>
  );
}

export default Skeleton;
