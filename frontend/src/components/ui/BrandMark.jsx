import React from 'react';

import { APP_BRAND } from '../../branding';
import { cn } from '../../lib/cn';

function BrandGlyph({ className }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn('h-10 w-10', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="18" fill="url(#brandGradient)" />
      <path
        d="M17 23.5C17 18.2533 21.2533 14 26.5 14H39C44.799 14 49.5 18.701 49.5 24.5C49.5 30.299 44.799 35 39 35H27.5C24.4624 35 22 37.4624 22 40.5C22 43.5376 24.4624 46 27.5 46H46"
        stroke="white"
        strokeWidth="7.5"
        strokeLinecap="round"
      />
      <circle cx="46" cy="46" r="5.5" fill="white" />
      <defs>
        <linearGradient id="brandGradient" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgb(var(--brand-primary-rgb))" />
          <stop offset="1" stopColor="#5DA6FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function BrandMark({ compact = false, className, caption, tone = 'default' }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-2xl border',
          tone === 'ghost'
            ? 'border-[var(--surface-border)] bg-[var(--surface-canvas)]'
            : 'border-[color:rgb(var(--brand-primary-rgb)/0.2)] bg-[linear-gradient(135deg,rgba(var(--brand-primary-rgb),0.18),rgba(96,165,250,0.12))]'
        )}
      >
        <BrandGlyph className="h-8 w-8" />
      </div>
      {!compact ? (
        <div className="min-w-0">
          <p className="font-heading text-2xl uppercase tracking-[0.08em] text-[var(--text-primary)]">{APP_BRAND.name}</p>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">{caption || APP_BRAND.tagline}</p>
        </div>
      ) : null}
    </div>
  );
}
