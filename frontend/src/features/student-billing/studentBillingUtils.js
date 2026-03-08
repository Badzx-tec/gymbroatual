export function formatBillingDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return '-';
  }
}

export function formatBillingMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function getStatusMeta(status) {
  const normalized = String(status || '').toLowerCase();
  const base = { label: status || '-', tone: 'neutral' };

  if (normalized === 'active') return { label: 'Ativo', tone: 'success' };
  if (normalized === 'allowed') return { label: 'Liberado', tone: 'success' };
  if (normalized === 'paid') return { label: 'Pago', tone: 'success' };
  if (normalized === 'grace_period') return { label: 'Carencia', tone: 'warning' };
  if (normalized === 'pending') return { label: 'Pendente', tone: 'info' };
  if (normalized === 'open') return { label: 'Em aberto', tone: 'info' };
  if (normalized === 'scheduled_cancel') return { label: 'Cancelamento agendado', tone: 'warning' };
  if (normalized === 'scheduled_freeze') return { label: 'Pausa agendada', tone: 'warning' };
  if (normalized === 'overdue') return { label: 'Atrasado', tone: 'warning' };
  if (normalized === 'failed') return { label: 'Falhou', tone: 'danger' };
  if (normalized === 'partially_paid') return { label: 'Parcial', tone: 'warning' };
  if (normalized === 'frozen') return { label: 'Congelado', tone: 'warning' };
  if (normalized === 'blocked') return { label: 'Bloqueado', tone: 'danger' };
  if (normalized === 'suspended') return { label: 'Suspenso', tone: 'danger' };
  if (normalized === 'expired') return { label: 'Vencido', tone: 'danger' };
  if (normalized === 'ended') return { label: 'Encerrado', tone: 'danger' };
  if (normalized === 'canceled') return { label: 'Cancelado', tone: 'danger' };
  if (normalized === 'refunded') return { label: 'Estornado', tone: 'neutral' };
  return base;
}

export function getBlockedReasonLabel(reason) {
  const normalized = String(reason || '').toLowerCase();
  if (normalized === 'financial_default_after_grace') return 'Inadimplencia apos o fim da carencia';
  if (normalized === 'manual_block') return 'Bloqueio manual pela academia';
  if (normalized === 'contract_frozen') return 'Contrato congelado';
  if (normalized === 'contract_ended') return 'Contrato encerrado';
  if (normalized === 'policy_restriction') return 'Restricao operacional';
  return 'Restricao nao informada';
}

export function getBillingBanner(summary = {}) {
  const accessStatus = String(summary.current_access_status || '').toLowerCase();
  const financialStatus = String(summary.current_financial_status || '').toLowerCase();
  const contractStatus = String(summary.current_contract_status || '').toLowerCase();
  const graceUntil = summary.grace_until;
  const nextRetryAt = summary.next_retry_at;
  const blockedReason = summary.blocked_reason;
  const overdueCharges = Number(summary.overdue_charges || 0);

  if (accessStatus === 'blocked') {
    return {
      tone: 'danger',
      title: 'Acesso bloqueado',
      description:
        blockedReason === 'financial_default_after_grace'
          ? 'Seu acesso foi bloqueado por inadimplencia apos o fim da carencia. Regularize na recepcao para voltar a liberar a catraca.'
          : `Seu acesso esta bloqueado. Motivo: ${getBlockedReasonLabel(blockedReason)}.`,
    };
  }

  if (accessStatus === 'grace_period') {
    return {
      tone: 'warning',
      title: 'Acesso liberado em carencia',
      description: graceUntil
        ? `Voce ainda pode acessar a academia ate ${formatBillingDate(graceUntil)}. Regularize antes desse prazo para evitar bloqueio.`
        : 'Voce esta em periodo de carencia. Regularize o financeiro para evitar bloqueio.',
    };
  }

  if (accessStatus === 'suspended' || ['expired', 'canceled', 'ended'].includes(accessStatus) || ['expired', 'canceled', 'ended'].includes(contractStatus)) {
    return {
      tone: 'danger',
      title: 'Contrato sem acesso liberado',
      description: contractStatus === 'expired' || accessStatus === 'expired'
        ? 'Seu contrato venceu. Procure a academia para renovar e voltar a liberar a catraca.'
        : contractStatus === 'canceled' || accessStatus === 'canceled'
          ? 'Seu contrato foi cancelado. Procure a academia para contratar um novo plano.'
          : 'Seu contrato nao permite acesso no momento. Procure a recepcao para regularizar.',
    };
  }

  if (financialStatus === 'overdue' || financialStatus === 'failed' || overdueCharges > 0) {
    return {
      tone: 'warning',
      title: 'Ha pendencias financeiras',
      description: nextRetryAt
        ? `Existe cobranca pendente. A proxima tentativa prevista e ${formatBillingDate(nextRetryAt)}.`
        : 'Existe cobranca pendente vinculada ao seu contrato. Procure a recepcao para regularizar.',
    };
  }

  return {
    tone: 'success',
    title: 'Financeiro em dia',
    description: 'Sua cobranca esta regular e seu acesso segue liberado conforme o contrato atual.',
  };
}

export function getBillingEventLabel(eventType) {
  const type = String(eventType || '').toLowerCase();
  if (type === 'charge_overdue_marked') return 'Cobranca marcada como vencida';
  if (type === 'dunning_step_advanced') return 'Cobranca escalada';
  if (type === 'grace_started') return 'Carencia iniciada';
  if (type === 'grace_expired_access_blocked') return 'Carencia encerrada com bloqueio';
  if (type === 'charge_paid') return 'Pagamento registrado';
  if (type === 'charge_payment_reverted') return 'Pagamento revertido';
  if (type === 'contract_renewed') return 'Contrato renovado';
  if (type === 'contract_created') return 'Contrato criado';
  if (type === 'contract_overdue_settled') return 'Pendencias baixadas';
  return eventType || 'Evento';
}

export function getChargeFilterOptions(summary = {}) {
  const totals = summary.charge_status_totals || {};
  return [
    { key: 'all', label: 'Todas', count: null },
    { key: 'open', label: 'Em aberto', count: Number(totals.open || 0) },
    { key: 'overdue', label: 'Atrasadas', count: Number(totals.overdue || 0) + Number(totals.failed || 0) },
    { key: 'paid', label: 'Pagas', count: Number(totals.paid || 0) },
  ];
}
