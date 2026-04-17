import React from 'react';

import { cn } from '../../lib/cn';

export default function LoadingScreen({ label = 'Carregando...', fullscreen = false, className }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-6 py-12',
        fullscreen && 'min-h-screen border-0 bg-[var(--surface-base)]',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-[var(--brand-primary)] border-t-transparent" />
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">{label}</p>
    </div>
  );
}
