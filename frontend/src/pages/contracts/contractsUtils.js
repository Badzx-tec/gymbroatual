import { accessStatusLabel, contractStatusLabel, financialStatusLabel } from '../../utils/labels';

export function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return String(value || '-');
  }
}

export function toIsoDate(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

export function toLocalDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function badgeClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'paid', 'allowed'].includes(normalized)) return 'bg-green-500/15 border-green-500/30 text-green-300';
  if (['pending', 'open', 'grace_period', 'pending_activation', 'scheduled_cancel', 'scheduled_freeze'].includes(normalized)) return 'bg-blue-500/15 border-blue-500/30 text-blue-300';
  if (['frozen', 'overdue', 'failed', 'suspended', 'partially_paid'].includes(normalized)) return 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300';
  return 'bg-red-500/15 border-red-500/30 text-red-300';
}

export function contractBadge(contractStatus) {
  return {
    className: badgeClass(contractStatus),
    label: contractStatusLabel(contractStatus),
  };
}

export function financialBadge(financialStatus) {
  return {
    className: badgeClass(financialStatus),
    label: financialStatusLabel(financialStatus),
  };
}

export function accessBadge(accessStatus) {
  return {
    className: badgeClass(accessStatus),
    label: accessStatusLabel(accessStatus),
  };
}

export function normalizeEventLabel(value) {
  const normalized = String(value || '').toLowerCase().trim();
  return normalized ? normalized.replaceAll('_', ' ') : '-';
}
