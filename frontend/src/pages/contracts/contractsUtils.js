import { accessStatusLabel, contractStatusLabel, financialStatusLabel } from '../../utils/labels';
import {
  addDurationToDateTimeLocalInTimeZone,
  dateTimeLocalToIsoInTimeZone,
  formatCurrency,
  formatDateTimeInTimeZone,
  toDateInputInTimeZone,
  toDateTimeLocalInTimeZone,
  safeNumber,
} from '../../utils/timezone';

export function formatMoney(value) {
  return formatCurrency(value);
}

export function formatDate(value) {
  return formatDateTimeInTimeZone(value);
}

export function toIsoDate(value) {
  return dateTimeLocalToIsoInTimeZone(value);
}

export function toLocalDateInput(value) {
  return toDateTimeLocalInTimeZone(value);
}

export function toDateInput(value) {
  return toDateInputInTimeZone(value);
}

export function formatDurationLabel(durationValue, durationUnit, fallbackDays) {
  const normalizedUnit = String(durationUnit || '').toLowerCase() === 'months' ? 'months' : 'days';
  const rawValue = durationValue ?? fallbackDays;
  const safeValue = Number(rawValue);
  if (!Number.isFinite(safeValue) || safeValue <= 0) return '-';
  if (normalizedUnit === 'months') {
    return `${safeValue} ${safeValue === 1 ? 'mes' : 'meses'}`;
  }
  return `${safeValue} ${safeValue === 1 ? 'dia' : 'dias'}`;
}

export function calculateContractEndAt(startAt, durationUnit, durationValue) {
  return addDurationToDateTimeLocalInTimeZone(startAt, {
    durationUnit,
    durationValue,
  });
}

export function getContractValueBreakdown(contract = {}) {
  const originalAmount = safeNumber(contract.original_amount, safeNumber(contract.amount));
  const finalAmount = safeNumber(contract.amount, originalAmount);
  const discountAmountRaw = contract.discount_amount;
  const discountAmount = Number.isFinite(Number(discountAmountRaw))
    ? Math.max(0, Number(discountAmountRaw))
    : Math.max(0, originalAmount - finalAmount);

  return {
    originalAmount,
    discountAmount,
    finalAmount,
    hasDiscount: discountAmount > 0 || originalAmount !== finalAmount,
  };
}

export function formatContractValueBreakdown(contract = {}) {
  const breakdown = getContractValueBreakdown(contract);
  return {
    ...breakdown,
    originalLabel: formatMoney(breakdown.originalAmount),
    discountLabel: formatMoney(breakdown.discountAmount),
    finalLabel: formatMoney(breakdown.finalAmount),
  };
}

export function badgeClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'paid', 'allowed'].includes(normalized)) return 'bg-green-500/15 border-green-500/30 text-green-300';
  if (['pending', 'open', 'grace_period', 'pending_activation', 'scheduled_cancel', 'scheduled_freeze'].includes(normalized)) return 'bg-blue-500/15 border-blue-500/30 text-blue-300';
  if (['frozen', 'overdue', 'failed', 'suspended', 'partially_paid'].includes(normalized)) return 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300';
  return 'bg-red-500/15 border-red-500/30 text-red-300';
}

export function contractBadge(contractStatus) {
  const normalized = String(contractStatus || '').toLowerCase();
  return {
    className: badgeClass(contractStatus),
    tone: ['active'].includes(normalized)
      ? 'success'
      : ['pending_activation', 'scheduled_cancel', 'scheduled_freeze'].includes(normalized)
        ? 'info'
        : ['frozen'].includes(normalized)
          ? 'warning'
          : 'danger',
    label: contractStatusLabel(contractStatus),
  };
}

export function financialBadge(financialStatus) {
  const normalized = String(financialStatus || '').toLowerCase();
  return {
    className: badgeClass(financialStatus),
    tone: ['paid'].includes(normalized)
      ? 'success'
      : ['pending', 'open'].includes(normalized)
        ? 'info'
        : ['overdue', 'failed', 'partially_paid'].includes(normalized)
          ? 'warning'
          : 'danger',
    label: normalized === 'paid' ? 'Em dia' : financialStatusLabel(financialStatus),
  };
}

export function accessBadge(accessStatus) {
  const normalized = String(accessStatus || '').toLowerCase();
  return {
    className: badgeClass(accessStatus),
    tone: ['allowed'].includes(normalized)
      ? 'success'
      : ['grace_period'].includes(normalized)
        ? 'info'
        : ['suspended'].includes(normalized)
          ? 'warning'
          : 'danger',
    label: accessStatusLabel(accessStatus),
  };
}

export function normalizeEventLabel(value) {
  const normalized = String(value || '').toLowerCase().trim();
  return normalized ? normalized.replaceAll('_', ' ') : '-';
}
