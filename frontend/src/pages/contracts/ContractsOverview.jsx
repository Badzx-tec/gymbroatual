import React from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, XCircle } from 'lucide-react';

function Card({ icon: Icon, title, value, tone = 'default', active = false, onClick }) {
  const toneClass = tone === 'danger' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-zinc-100';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        active ? 'border-[#ccff00]/70 bg-[#ccff00]/10' : 'border-zinc-800 bg-zinc-900/80 hover:border-zinc-700'
      }`}
      aria-pressed={active}
    >
      <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </button>
  );
}

export default function ContractsOverview({ overview, quickFilterKey, onQuickFilter }) {
  const cards = [
    {
      key: 'active',
      title: 'Ativos',
      value: Number(overview.active || 0),
      icon: CheckCircle2,
      tone: 'default',
    },
    {
      key: 'expiring',
      title: 'Vencem em 7 dias',
      value: Number(overview.expiringSoon || 0),
      icon: CalendarClock,
      tone: 'warn',
    },
    {
      key: 'pending',
      title: 'Pendentes / atraso',
      value: Number(overview.pending || 0),
      icon: AlertTriangle,
      tone: 'warn',
    },
    {
      key: 'canceled',
      title: 'Cancelados (mes)',
      value: Number(overview.canceledMonth || 0),
      icon: XCircle,
      tone: 'danger',
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card
          key={card.key}
          icon={card.icon}
          title={card.title}
          value={card.value}
          tone={card.tone}
          active={quickFilterKey === card.key}
          onClick={() => onQuickFilter(card.key)}
        />
      ))}
    </section>
  );
}
