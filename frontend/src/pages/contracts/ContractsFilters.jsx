import React from 'react';
import { X } from 'lucide-react';

const statusOptions = [
  { value: 'active', label: 'Ativo' },
  { value: 'pending_activation', label: 'Aguardando ativacao' },
  { value: 'frozen', label: 'Congelado' },
  { value: 'scheduled_cancel', label: 'Cancelamento agendado' },
  { value: 'scheduled_freeze', label: 'Congelamento agendado' },
  { value: 'canceled', label: 'Cancelado' },
  { value: 'expired', label: 'Expirado' },
  { value: 'ended', label: 'Encerrado' },
];

const expiringOptions = [
  { value: '', label: 'Nao aplicar' },
  { value: '7', label: '7 dias' },
  { value: '15', label: '15 dias' },
  { value: '30', label: '30 dias' },
];

function Checkbox({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-zinc-200">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-[#ccff00]" />
      {label}
    </label>
  );
}

export default function ContractsFilters({
  open,
  draft,
  plans,
  onDraftChange,
  onClose,
  onApply,
  onClear,
  onSaveView,
}) {
  if (!open) return null;

  const statusSet = new Set(draft.status || []);
  const planSet = new Set(draft.planoId || []);

  const toggleMulti = (key, value) => {
    const current = new Set((draft[key] || []).map(String));
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    onDraftChange({ ...draft, [key]: Array.from(current) });
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Filtros de contratos">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold uppercase tracking-wide">Filtros</h2>
            <p className="text-xs text-zinc-500">Refine a listagem e salve sua visao atual.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 bg-zinc-800 p-2 hover:bg-zinc-700"
            aria-label="Fechar filtros"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Status</p>
          <div className="grid grid-cols-1 gap-1">
            {statusOptions.map((option) => (
              <Checkbox
                key={option.value}
                checked={statusSet.has(option.value)}
                onChange={() => toggleMulti('status', option.value)}
                label={option.label}
              />
            ))}
          </div>
        </section>

        <section className="mt-4 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Planos</p>
          <div className="max-h-40 space-y-1 overflow-auto pr-1">
            {plans.map((plan) => (
              <Checkbox
                key={plan.plan_id}
                checked={planSet.has(plan.plan_id)}
                onChange={() => toggleMulti('planoId', plan.plan_id)}
                label={plan.nome}
              />
            ))}
            {!plans.length ? <p className="text-xs text-zinc-500">Nenhum plano cadastrado.</p> : null}
          </div>
        </section>

        <section className="mt-4 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Periodo</p>
          <input
            type="date"
            value={draft.startDate || ''}
            onChange={(event) => onDraftChange({ ...draft, startDate: event.target.value })}
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm"
            aria-label="Data inicial"
          />
          <input
            type="date"
            value={draft.endDate || ''}
            onChange={(event) => onDraftChange({ ...draft, endDate: event.target.value })}
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm"
            aria-label="Data final"
          />
        </section>

        <section className="mt-4 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Expira em</p>
          <select
            value={draft.expiringInDays || ''}
            onChange={(event) => onDraftChange({ ...draft, expiringInDays: event.target.value })}
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm"
            aria-label="Expira em"
          >
            {expiringOptions.map((option) => (
              <option key={option.value || 'none'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Checkbox
            checked={Boolean(draft.pendingOnly)}
            onChange={(event) => onDraftChange({ ...draft, pendingOnly: event.target.checked })}
            label="Somente inadimplentes ou pendentes"
          />
        </section>

        <div className="mt-6 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onApply}
            className="h-10 rounded-md bg-[#ccff00] text-xs font-bold uppercase tracking-wide text-black hover:bg-[#b3e600]"
          >
            Aplicar
          </button>
          <button
            type="button"
            onClick={onClear}
            className="h-10 rounded-md border border-zinc-700 bg-zinc-800 text-xs font-semibold uppercase tracking-wide hover:bg-zinc-700"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={onSaveView}
            className="h-10 rounded-md border border-blue-500/40 bg-blue-500/15 text-xs font-semibold uppercase tracking-wide text-blue-300 hover:bg-blue-500/20"
          >
            Salvar visao
          </button>
        </div>
      </aside>
    </div>
  );
}
