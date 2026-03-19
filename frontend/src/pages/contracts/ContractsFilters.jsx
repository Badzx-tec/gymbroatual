import React from 'react';

import Button from '../../components/ui/Button';
import SelectField from '../../components/ui/SelectField';
import SidePanel from '../../components/ui/SidePanel';
import { SAO_PAULO_TIME_ZONE } from '../../utils/timezone';

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
    <label className="inline-flex items-center gap-3 text-sm text-zinc-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="accent-[var(--brand-primary)]"
      />
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
  const statusSet = new Set(draft.status || []);
  const planSet = new Set(draft.planoId || []);

  const toggleMulti = (key, value) => {
    const current = new Set((draft[key] || []).map(String));
    if (current.has(value)) current.delete(value);
    else current.add(value);
    onDraftChange({ ...draft, [key]: Array.from(current) });
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Filtros de contratos"
      description="Refine a listagem e salve a configuracao mais usada neste navegador."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="secondary" onClick={onClear}>
            Limpar
          </Button>
          <Button variant="secondary" onClick={onSaveView}>
            Salvar visao
          </Button>
          <Button variant="primary" onClick={onApply}>
            Aplicar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <section className="rounded-2xl border border-zinc-900 bg-zinc-950/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Status</p>
          <div className="mt-3 grid gap-2">
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

        <section className="rounded-2xl border border-zinc-900 bg-zinc-950/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Planos</p>
          <div className="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
            {plans.map((plan) => (
              <Checkbox
                key={plan.plan_id}
                checked={planSet.has(plan.plan_id)}
                onChange={() => toggleMulti('planoId', plan.plan_id)}
                label={plan.nome}
              />
            ))}
            {!plans.length ? <p className="text-sm text-zinc-500">Nenhum plano cadastrado.</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-900 bg-zinc-950/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Periodo</p>
          <div className="mt-3 grid gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Inicio</span>
              <input
                type="date"
                value={draft.startDate || ''}
                onChange={(event) => onDraftChange({ ...draft, startDate: event.target.value })}
                className="h-11 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Fim</span>
              <input
                type="date"
                value={draft.endDate || ''}
                onChange={(event) => onDraftChange({ ...draft, endDate: event.target.value })}
                className="h-11 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
              />
            </label>
            <p className="text-xs text-zinc-500">
              As datas desta tela sao interpretadas em {SAO_PAULO_TIME_ZONE}.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-900 bg-zinc-950/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Expiracao</p>
          <div className="mt-3 space-y-4">
            <SelectField
              label="Expira em"
              value={draft.expiringInDays || ''}
              onChange={(event) => onDraftChange({ ...draft, expiringInDays: event.target.value })}
            >
              {expiringOptions.map((option) => (
                <option key={option.value || 'none'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <Checkbox
              checked={Boolean(draft.pendingOnly)}
              onChange={(event) => onDraftChange({ ...draft, pendingOnly: event.target.checked })}
              label="Somente inadimplentes ou pendentes"
            />
          </div>
        </section>
      </div>
    </SidePanel>
  );
}
