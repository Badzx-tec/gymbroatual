import React from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';

import { cn } from '../../lib/cn';

const toneMap = {
  success: {
    icon: CheckCircle2,
    className: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-text)]',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]',
  },
  danger: {
    icon: ShieldAlert,
    className: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)]',
  },
  info: {
    icon: Info,
    className: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-text)]',
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
