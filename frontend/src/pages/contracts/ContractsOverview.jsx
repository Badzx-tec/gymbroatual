import React from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, TrendingDown } from 'lucide-react';

const CARD_DEFS = [
  {
    key: 'active',
    label: 'Contratos ativos',
    sublabel: 'Vigentes agora',
    icon: CheckCircle2,
    iconClass: 'text-[var(--status-success)]',
    ringClass: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)]',
    activeRingClass: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)]',
    numClass: 'text-[var(--text-primary)]',
  },
  {
    key: 'expiring',
    label: 'Vencem em 7 dias',
    sublabel: 'Renovacao pendente',
    icon: CalendarClock,
    iconClass: 'text-[var(--status-warning)]',
    ringClass: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]',
    activeRingClass: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]',
    numClass: 'text-[var(--status-warning-text)]',
  },
  {
    key: 'pending',
    label: 'Inadimplentes',
    sublabel: 'Pendentes ou atrasados',
    icon: AlertTriangle,
    iconClass: 'text-[var(--status-warning)]',
    ringClass: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]',
    activeRingClass: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]',
    numClass: 'text-[var(--status-warning-text)]',
  },
  {
    key: 'canceled',
    label: 'Cancelados',
    sublabel: 'Neste mes',
    icon: TrendingDown,
    iconClass: 'text-[var(--status-danger)]',
    ringClass: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]',
    activeRingClass: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]',
    numClass: 'text-[var(--status-danger-text)]',
  },
];

export default function ContractsOverview({ overview, quickFilterKey, onQuickFilter }) {
  const values = {
    active: Number(overview.active || 0),
    expiring: Number(overview.expiringSoon || 0),
    pending: Number(overview.pending || 0),
    canceled: Number(overview.canceledMonth || 0),
  };

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {CARD_DEFS.map((card) => {
        const isActive = quickFilterKey === card.key;
        const Icon = card.icon;
        const value = values[card.key];

        return (
          <button
            key={card.key}
            type="button"
            onClick={() => onQuickFilter(card.key)}
            aria-pressed={isActive}
            className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition-all duration-150 ${
              isActive
                ? `${card.activeRingClass} ring-1 ring-inset ring-white/5`
                : `border-[var(--surface-border)] bg-[var(--surface-card-bg)] hover:border-[var(--surface-border-strong)] hover:bg-[var(--surface-soft)]`
            }`}
          >
            {/* Active indicator */}
            {isActive && (
              <span className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full bg-[var(--brand-primary)]" />
            )}

            {/* Icon */}
            <span
              className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-colors ${
                isActive ? card.ringClass : 'border-[var(--surface-border)] bg-[var(--surface-soft)] group-hover:border-[var(--surface-border-strong)]'
              }`}
            >
              <Icon className={`h-4 w-4 ${card.iconClass}`} />
            </span>

            {/* Number */}
            <p className={`mt-3 font-mono text-3xl font-bold tabular-nums leading-none ${
              isActive ? card.numClass : 'text-[var(--text-primary)]'
            }`}>
              {value.toLocaleString('pt-BR')}
            </p>

            {/* Labels */}
            <p className="mt-2 text-xs font-semibold text-[var(--text-secondary)]">{card.label}</p>
            <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{card.sublabel}</p>
          </button>
        );
      })}
    </div>
  );
}
