import React from 'react';
import { RefreshCw } from 'lucide-react';

import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import SectionCard from '../../components/ui/SectionCard';
import SidePanel from '../../components/ui/SidePanel';
import StatusBadge from '../../components/ui/StatusBadge';
import {
  accessBadge,
  contractBadge,
  financialBadge,
  formatDate,
  formatContractValueBreakdown,
  formatDurationLabel,
  normalizeEventLabel,
} from './contractsUtils';

function AuditItem({ item }) {
  return (
    <li className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        {item.action || 'acao'}
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{formatDate(item.created_at)}</p>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        {item.actor_role || '-'} | {item.actor_id || '-'}
      </p>
    </li>
  );
}

function BadgeRow({ contract }) {
  const contractState = contractBadge(contract.contract_status);
  const financialState = financialBadge(contract.financial_status);
  const accessState = accessBadge(contract.access_status);

  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge label={contractState.label} tone={contractState.tone} />
      <StatusBadge label={financialState.label} tone={financialState.tone} />
      <StatusBadge label={accessState.label} tone={accessState.tone} />
    </div>
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
  const contract = detail?.contract || null;
  const charges = detail?.charges || [];
  const events = detail?.events || [];
  const audits = detail?.audits || [];
  const valueBreakdown = formatContractValueBreakdown(contract || {});

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Detalhe do contrato"
      description="Resumo financeiro, timeline, auditoria e cobrancas vinculadas."
      actions={
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {loading ? (
        <SectionCard>
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Carregando detalhes...
          </div>
        </SectionCard>
      ) : null}

      {!loading && error ? (
        <SectionCard>
          <div className="rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger-text)]">
            <p>Falha ao carregar detalhe: {error}</p>
            <Button variant="danger" size="sm" className="mt-3" onClick={onRetry}>
              Tentar novamente
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {!loading && !error && contract ? (
        <div className="space-y-4">
          <SectionCard
            title={contract.student_name}
            description={contract.plan_name || contract.plan_id || '-'}
            actions={
              <div className="text-right">
                <p className="text-lg font-semibold text-[var(--text-primary)]">{valueBreakdown.finalLabel}</p>
                {valueBreakdown.hasDiscount ? (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Base {valueBreakdown.originalLabel} | Desconto {valueBreakdown.discountLabel}
                  </p>
                ) : null}
              </div>
            }
          >
            <div className="space-y-4">
              <BadgeRow contract={contract} />
              <div className="grid gap-2 text-sm text-[var(--text-muted)]">
                <p>Aluno: {contract.student_id}</p>
                <p>Validade do contrato: {formatDate(contract.current_period_start)} ate {formatDate(contract.current_period_end)}</p>
                <p>Vencimento da cobranca: {formatDate(contract.next_charge_due_at || contract.next_billing_at)}</p>
                <p>Dia de cobranca: {contract.billing_day || '-'}</p>
                <p>Duracao: {formatDurationLabel(contract.duration_value, contract.duration_unit, contract.duration_days)}</p>
                <p>Atualizado em {formatDate(contract.updated_at)}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Base</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{valueBreakdown.originalLabel}</p>
                </div>
                <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Desconto</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    {valueBreakdown.hasDiscount ? `- ${valueBreakdown.discountLabel}` : 'Nenhum'}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Final</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{valueBreakdown.finalLabel}</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                <Button variant="secondary" size="sm" onClick={() => onAction('renew', contract)}>
                  Renovar
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canManageContractRules}
                  onClick={() => onAction('adjustValidity', contract)}
                >
                  Ajustar validade
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canManageContractRules}
                  onClick={() => onAction('adjustBilling', contract)}
                >
                  Ajustar cobranca
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canSettleOverdue}
                  onClick={() => onAction('settle', contract)}
                >
                  Colocar em dia
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canManageContractRules}
                  onClick={() => onAction('pause', contract)}
                >
                  Pausar
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!canManageContractRules}
                  onClick={() => onAction('cancel', contract)}
                >
                  Cancelar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onAction('pdf', contract)}>
                  Baixar PDF
                </Button>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Timeline" description="Eventos cronologicos do contrato.">
            {events.length ? (
              <ul className="space-y-2">
                {events.slice(0, 16).map((item) => (
                  <li key={item.event_id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                      {normalizeEventLabel(item.event_type)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{formatDate(item.created_at)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Sem eventos registrados" description="A timeline passa a aparecer aqui conforme o contrato recebe eventos." />
            )}
          </SectionCard>

          <SectionCard title="Auditoria" description="Acoes administrativas persistidas no backend.">
            {audits.length ? (
              <ul className="space-y-2">
                {audits.slice(0, 16).map((item) => (
                  <AuditItem key={item.audit_id} item={item} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Sem auditoria registrada" description="Nenhuma acao administrativa persistida para este contrato." />
            )}
          </SectionCard>

          <SectionCard title="Cobrancas" description="Titulos vinculados ao contrato e acoes de baixa manual.">
            {charges.length ? (
              <ul className="space-y-2">
                {charges.slice(0, 12).map((charge) => {
                  const badge = financialBadge(charge.status);
                  const isPaid = String(charge.status || '').toLowerCase() === 'paid';
                  const isActionable = !['canceled', 'refunded'].includes(String(charge.status || '').toLowerCase());
                  const chargeBreakdown = formatContractValueBreakdown(charge);
                  return (
                    <li
                      key={charge.charge_id}
                      className="flex flex-col gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{chargeBreakdown.finalLabel}</p>
                        {chargeBreakdown.hasDiscount ? (
                          <p className="text-[11px] text-[var(--text-muted)]">
                            Base {chargeBreakdown.originalLabel} | Desconto {chargeBreakdown.discountLabel}
                          </p>
                        ) : null}
                        <p className="text-xs text-[var(--text-muted)]">Vencimento: {formatDate(charge.due_at)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge label={badge.label} tone={badge.tone} />
                        {canSettleOverdue && isPaid ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              onAction('unpayCharge', { ...charge, contract_id: contract.contract_id })
                            }
                          >
                            Cancelar pagto
                          </Button>
                        ) : null}
                        {canSettleOverdue && !isPaid && isActionable ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              onAction('payCharge', { ...charge, contract_id: contract.contract_id })
                            }
                          >
                            Marcar pago
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="Sem cobrancas registradas" description="Nenhum titulo foi vinculado a este contrato ate o momento." />
            )}
          </SectionCard>
        </div>
      ) : null}
    </SidePanel>
  );
}
