import React from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';

import { cn } from '../../lib/cn';

const toneMap = {
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-amber-500/20 bg-amber-500/10 text-amber-100',
  },
  danger: {
    icon: ShieldAlert,
    className: 'border-red-500/20 bg-red-500/10 text-red-100',
  },
  info: {
    icon: Info,
    className: 'border-sky-500/20 bg-sky-500/10 text-sky-100',
  },
};

export default function Banner({ tone = 'info', title, description, actions, className }) {
  const meta = toneMap[tone] || toneMap.info;
  const Icon = meta.icon;

  return (
    <div className={cn('rounded-[var(--radius-md)] border px-4 py-3', meta.className, className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {title ? <p className="text-sm font-semibold uppercase tracking-[0.16em]">{title}</p> : null}
            {description ? <p className="mt-1 text-sm text-current/85">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
