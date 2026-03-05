import React from 'react';
import { RefreshCw, X } from 'lucide-react';

import { accessBadge, contractBadge, financialBadge, formatDate, formatMoney, normalizeEventLabel } from './contractsUtils';

function AuditItem({ item }) {
  return (
    <li className="rounded-md border border-zinc-800 bg-zinc-950/70 p-2">
      <p className="text-[11px] font-semibold uppercase text-zinc-300">{item.action || 'acao'}</p>
      <p className="text-xs text-zinc-500">{formatDate(item.created_at)}</p>
      <p className="mt-1 text-xs text-zinc-400">
        {item.actor_role || '-'} • {item.actor_id || '-'}
      </p>
    </li>
  );
}

export default function ContractDetailsDrawer({
  open,
  loading,
  error,
  detail,
  onClose,
  onRetry,
  onAction,
  canManageContractRules,
  canSettleOverdue,
}) {
  if (!open) return null;

  const contract = detail?.contract || null;
  const charges = detail?.charges || [];
  const events = detail?.events || [];
  const audits = detail?.audits || [];

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Detalhes do contrato">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold uppercase tracking-wide">Detalhe do contrato</h2>
            <p className="text-xs text-zinc-500">Resumo, timeline, documentos e acoes contextualizadas.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 bg-zinc-800 p-2 hover:bg-zinc-700"
            aria-label="Fechar detalhe"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-5 text-sm text-zinc-400">
            <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />
            Carregando detalhes...
          </div>
        ) : null}

        {!loading && error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <p>Falha ao carregar detalhe: {error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 h-9 rounded-md border border-red-400/40 bg-red-500/20 px-3 text-xs font-semibold uppercase"
            >
              Tentar novamente
            </button>
          </div>
        ) : null}

        {!loading && !error && contract ? (
          <div className="space-y-4">
            <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold">{contract.student_name}</p>
                  <p className="text-xs text-zinc-500">{contract.student_id}</p>
                  <p className="mt-1 text-sm text-zinc-300">{contract.plan_name || contract.plan_id || '-'}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{formatMoney(contract.amount)}</p>
                  <p className="text-xs text-zinc-500">Atualizado em {formatDate(contract.updated_at)}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(() => {
                  const c = contractBadge(contract.contract_status);
                  return <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${c.className}`}>{c.label}</span>;
                })()}
                {(() => {
                  const f = financialBadge(contract.financial_status);
                  return <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${f.className}`}>{f.label}</span>;
                })()}
                {(() => {
                  const a = accessBadge(contract.access_status);
                  return <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${a.className}`}>{a.label}</span>;
                })()}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-zinc-400">
                <p>Vigencia: {formatDate(contract.current_period_start)} ate {formatDate(contract.current_period_end)}</p>
                <p>Proxima cobranca: {formatDate(contract.next_charge_due_at)}</p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <button type="button" onClick={() => onAction('renew', contract)} className="h-9 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs font-semibold uppercase text-emerald-300">Renovar</button>
                {canSettleOverdue ? (
                  <button type="button" onClick={() => onAction('settle', contract)} className="h-9 rounded-md border border-cyan-500/40 bg-cyan-500/15 text-xs font-semibold uppercase text-cyan-300">Colocar em dia</button>
                ) : (
                  <button type="button" disabled className="h-9 rounded-md border border-zinc-700 bg-zinc-800 text-xs font-semibold uppercase text-zinc-500">Colocar em dia</button>
                )}
                {canManageContractRules ? (
                  <>
                    <button type="button" onClick={() => onAction('pause', contract)} className="h-9 rounded-md border border-blue-500/40 bg-blue-500/15 text-xs font-semibold uppercase text-blue-300">Pausar</button>
                    <button type="button" onClick={() => onAction('cancel', contract)} className="h-9 rounded-md border border-red-500/40 bg-red-500/15 text-xs font-semibold uppercase text-red-300">Cancelar</button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled className="h-9 rounded-md border border-zinc-700 bg-zinc-800 text-xs font-semibold uppercase text-zinc-500">Pausar</button>
                    <button type="button" disabled className="h-9 rounded-md border border-zinc-700 bg-zinc-800 text-xs font-semibold uppercase text-zinc-500">Cancelar</button>
                  </>
                )}
                <button type="button" onClick={() => onAction('pdf', contract)} className="h-9 rounded-md border border-zinc-700 bg-zinc-800 text-xs font-semibold uppercase">Baixar PDF</button>
              </div>
            </section>

            <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Timeline</h3>
              <ul className="mt-2 max-h-44 space-y-2 overflow-auto pr-1">
                {events.slice(0, 16).map((item) => (
                  <li key={item.event_id} className="rounded-md border border-zinc-800 p-2">
                    <p className="text-xs font-semibold uppercase text-zinc-300">{normalizeEventLabel(item.event_type)}</p>
                    <p className="text-xs text-zinc-500">{formatDate(item.created_at)}</p>
                  </li>
                ))}
                {!events.length ? <li className="text-xs text-zinc-500">Sem eventos registrados.</li> : null}
              </ul>
            </section>

            <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Auditoria</h3>
              <ul className="mt-2 max-h-40 space-y-2 overflow-auto pr-1">
                {audits.slice(0, 16).map((item) => (
                  <AuditItem key={item.audit_id} item={item} />
                ))}
                {!audits.length ? <li className="text-xs text-zinc-500">Sem auditoria registrada.</li> : null}
              </ul>
            </section>

            <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Cobrancas</h3>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto pr-1">
                {charges.slice(0, 12).map((charge) => (
                  <li key={charge.charge_id} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 px-2 py-2 text-xs">
                    <span>{formatDate(charge.due_at)}</span>
                    <span>{formatMoney(charge.amount)}</span>
                    {(() => {
                      const badge = financialBadge(charge.status);
                      return <span className={`rounded-md border px-2 py-0.5 font-semibold uppercase ${badge.className}`}>{badge.label}</span>;
                    })()}
                    {canSettleOverdue && !['paid', 'canceled', 'refunded'].includes(String(charge.status || '').toLowerCase()) ? (
                      <button
                        type="button"
                        onClick={() => onAction('payCharge', { ...charge, contract_id: contract.contract_id })}
                        className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300"
                      >
                        Marcar pago
                      </button>
                    ) : null}
                  </li>
                ))}
                {!charges.length ? <li className="text-xs text-zinc-500">Sem cobrancas registradas.</li> : null}
              </ul>
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
