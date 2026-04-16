import React from 'react';
import { X } from 'lucide-react';

import { contractStatusLabel } from '../../utils/labels';

export default function ActiveFilterChips({ queryState, plans, onRemove, onClearAll }) {
  const chips = buildChips(queryState, plans);
  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-700/60 bg-zinc-800/60 pl-2.5 pr-1 py-1 text-[11px] font-medium text-zinc-300"
        >
          {chip.label}
          <button
            type="button"
            onClick={() => onRemove(chip)}
            aria-label={`Remover filtro: ${chip.label}`}
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-200"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-[11px] font-medium text-zinc-600 underline-offset-2 transition hover:text-zinc-400 hover:underline"
        >
          Limpar tudo
        </button>
      )}
    </div>
  );
}

function buildChips(q, plans) {
  const chips = [];
  const planMap = new Map((plans || []).map((p) => [p.plan_id, p.nome]));

  if (q.q) chips.push({ key: 'q', type: 'q', value: q.q, label: `"${q.q}"` });
  (q.status || []).forEach((s) => chips.push({ key: `status:${s}`, type: 'status', value: s, label: contractStatusLabel(s) }));
  (q.planoId || []).forEach((id) => chips.push({ key: `plano:${id}`, type: 'planoId', value: id, label: planMap.get(id) || id }));
  if (q.startDate) chips.push({ key: 'startDate', type: 'startDate', value: q.startDate, label: `De ${q.startDate}` });
  if (q.endDate) chips.push({ key: 'endDate', type: 'endDate', value: q.endDate, label: `Ate ${q.endDate}` });
  if (q.expiringInDays) chips.push({ key: 'expiring', type: 'expiringInDays', value: q.expiringInDays, label: `Vence ${q.expiringInDays}d` });
  if (q.pendingOnly) chips.push({ key: 'pending', type: 'pendingOnly', value: true, label: 'Inadimplentes' });
  if (q.includeArchived) chips.push({ key: 'archived', type: 'includeArchived', value: true, label: 'Com arquivados' });

  return chips;
}
