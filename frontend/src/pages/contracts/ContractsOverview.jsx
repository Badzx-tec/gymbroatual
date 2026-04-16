import React from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, TrendingDown } from 'lucide-react';

const CARD_DEFS = [
  {
    key: 'active',
    label: 'Contratos ativos',
    sublabel: 'Vigentes agora',
    icon: CheckCircle2,
    iconClass: 'text-emerald-400',
    ringClass: 'border-emerald-500/20 bg-emerald-500/5',
    activeRingClass: 'border-emerald-500/40 bg-emerald-500/10',
    numClass: 'text-zinc-100',
  },
  {
    key: 'expiring',
    label: 'Vencem em 7 dias',
    sublabel: 'Renovacao pendente',
    icon: CalendarClock,
    iconClass: 'text-amber-400',
    ringClass: 'border-amber-500/20 bg-amber-500/5',
    activeRingClass: 'border-amber-500/40 bg-amber-500/10',
    numClass: 'text-amber-300',
  },
  {
    key: 'pending',
    label: 'Inadimplentes',
    sublabel: 'Pendentes ou atrasados',
    icon: AlertTriangle,
    iconClass: 'text-orange-400',
    ringClass: 'border-orange-500/20 bg-orange-500/5',
    activeRingClass: 'border-orange-500/40 bg-orange-500/10',
    numClass: 'text-orange-300',
  },
  {
    key: 'canceled',
    label: 'Cancelados',
    sublabel: 'Neste mes',
    icon: TrendingDown,
    iconClass: 'text-red-400',
    ringClass: 'border-red-500/20 bg-red-500/5',
    activeRingClass: 'border-red-500/40 bg-red-500/10',
    numClass: 'text-red-300',
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
                : `border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-900/60`
            }`}
          >
            {/* Active indicator */}
            {isActive && (
              <span className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full bg-[var(--brand-primary)]" />
            )}

            {/* Icon */}
            <span
              className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-colors ${
                isActive ? card.ringClass : 'border-zinc-800 bg-zinc-900 group-hover:border-zinc-700'
              }`}
            >
              <Icon className={`h-4 w-4 ${card.iconClass}`} />
            </span>

            {/* Number */}
            <p className={`mt-3 font-mono text-3xl font-bold tabular-nums leading-none ${
              isActive ? card.numClass : 'text-zinc-100'
            }`}>
              {value.toLocaleString('pt-BR')}
            </p>

            {/* Labels */}
            <p className="mt-2 text-xs font-semibold text-zinc-300">{card.label}</p>
            <p className="mt-0.5 text-[10px] text-zinc-600">{card.sublabel}</p>
          </button>
        );
      })}
    </div>
  );
}
