export function formatBillingDate(value, { dateOnly = false } = {}) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  if (dateOnly) {
    return parsed.toLocaleDateString('pt-BR');
  }
  return parsed.toLocaleString('pt-BR');
}

export function formatBillingMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

const STATUS_META = {
  active: { label: 'Ativa', tone: 'success' },
  paid: { label: 'Pago', tone: 'success' },
  succeeded: { label: 'Sucesso', tone: 'success' },
  trialing: { label: 'Em trial', tone: 'info' },
  pending: { label: 'Pendente', tone: 'info' },
  open: { label: 'Em aberto', tone: 'info' },
  past_due: { label: 'Em atraso', tone: 'warning' },
  failed: { label: 'Falhou', tone: 'warning' },
  canceled: { label: 'Cancelada', tone: 'danger' },
  expired: { label: 'Expirada', tone: 'danger' },
  draft: { label: 'Rascunho', tone: 'neutral' },
};

export function getBillingStatusMeta(status) {
  const key = String(status || '').trim().toLowerCase();
  if (!key) return { label: 'Indefinido', tone: 'neutral' };
  return STATUS_META[key] || { label: key.replaceAll('_', ' '), tone: 'neutral' };
}

export function getSubscriptionStateMeta(subscription) {
  const status = String(subscription?.status || '').toLowerCase();
  if (subscription?.can_login) {
    return {
      label: 'Operacao liberada',
      tone: 'success',
      summary: 'A academia pode acessar o sistema normalmente.',
    };
  }
  if (status === 'past_due') {
    return {
      label: 'Pagamento pendente',
      tone: 'warning',
      summary: 'Existe pendencia financeira. Verifique o checkout ou confirme o pagamento.',
    };
  }
  if (status === 'canceled' || status === 'expired') {
    return {
      label: 'Assinatura inativa',
      tone: 'danger',
      summary: 'O acesso administrativo pode ser bloqueado ate a regularizacao.',
    };
  }
  return {
    label: 'Status em analise',
    tone: 'info',
    summary: 'A assinatura ainda esta sincronizando com o provedor.',
  };
}

export function getBillingActionItems(overview) {
  const items = [];
  const subscription = overview?.subscription || {};
  const summary = overview?.summary || {};

  if (summary.past_due_invoice_count > 0) {
    items.push('Regularize as faturas em atraso para evitar bloqueio administrativo.');
  }
  if (!subscription.can_login && subscription.grace_until) {
    items.push(`A carencia vai ate ${formatBillingDate(subscription.grace_until)}.`);
  }
  if (summary.failed_attempt_count > 0) {
    items.push('Houve tentativa de pagamento com falha. Confira o provedor antes de tentar novamente.');
  }
  if (subscription.can_login && summary.past_due_invoice_count === 0) {
    items.push('Status financeiro estavel. Mantenha a cobranca recorrente acompanhada por aqui.');
  }
  if (!items.length) {
    items.push('Sem acao imediata. Continue monitorando renovo e webhooks de pagamento.');
  }
  return items;
}

export function getInvoiceStatusFilterOptions() {
  return [
    { value: 'all', label: 'Todas' },
    { value: 'paid', label: 'Pagas' },
    { value: 'open', label: 'Em aberto' },
    { value: 'past_due', label: 'Em atraso' },
  ];
}

export function eventTypeLabel(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'checkout_created') return 'Checkout criado';
  if (key === 'payment_failed') return 'Pagamento falhou';
  if (key === 'payment_approved') return 'Pagamento aprovado';
  if (key === 'subscription_canceled') return 'Assinatura cancelada';
  if (key === 'subscription_reactivated') return 'Assinatura reativada';
  return value || 'Evento';
}

export function attemptReasonLabel(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'checkout_created') return 'Checkout iniciado';
  if (key === 'payment_failed') return 'Falha no pagamento';
  if (key === 'payment_approved') return 'Pagamento aprovado';
  return value || '-';
}
