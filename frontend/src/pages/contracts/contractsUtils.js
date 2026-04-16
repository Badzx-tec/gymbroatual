import { accessStatusLabel, archivedFlagLabel, contractStatusLabel, financialStatusLabel } from '../../utils/labels';
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

export function archivedBadge(isArchived) {
  return {
    className: isArchived
      ? 'bg-zinc-800/80 border-zinc-700 text-zinc-300'
      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200',
    tone: isArchived ? 'neutral' : 'success',
    label: archivedFlagLabel(Boolean(isArchived)),
  };
}

export function normalizeEventLabel(value) {
  const normalized = String(value || '').toLowerCase().trim();
  return normalized ? normalized.replaceAll('_', ' ') : '-';
}

/**
 * Collapses all 4 contract dimensions (contract_status, financial_status,
 * access_status, is_archived) into a single health level using a
 * "worst-case-dominates" priority:  critical > warning > healthy > neutral
 *
 * Returns { level, label, sublabel, dotClass, bgClass, textClass }
 */
export function computeContractHealth(contract) {
  const contractStatus = String(contract?.contract_status || '').toLowerCase();
  const financialStatus = String(contract?.financial_status || '').toLowerCase();
  const accessStatus = String(contract?.access_status || '').toLowerCase();
  const isArchived = Boolean(contract?.is_archived);

  // Neutral — archived contracts are out of the operational flow
  if (isArchived) {
    return {
      level: 'neutral',
      label: 'Arquivado',
      sublabel: contractStatusLabel(contractStatus),
      dotClass: 'bg-zinc-500',
      bgClass: 'bg-zinc-800/60 border-zinc-700',
      textClass: 'text-zinc-400',
    };
  }

  // Terminal — canceled/expired/ended with no archive flag
  if (['canceled', 'expired', 'ended'].includes(contractStatus)) {
    return {
      level: 'neutral',
      label: contractStatusLabel(contractStatus),
      sublabel: financialStatusLabel(financialStatus),
      dotClass: 'bg-zinc-500',
      bgClass: 'bg-zinc-800/60 border-zinc-700',
      textClass: 'text-zinc-400',
    };
  }

  // Critical — access blocked due to financial default or other reason
  if (accessStatus === 'blocked') {
    return {
      level: 'critical',
      label: 'Acesso bloqueado',
      sublabel: financialStatusLabel(financialStatus),
      dotClass: 'bg-red-400 animate-pulse',
      bgClass: 'bg-red-500/10 border-red-500/30',
      textClass: 'text-red-300',
    };
  }

  // Warning — financial overdue but within grace, or contract frozen/scheduled ops
  const isFinancialWarning = ['overdue', 'failed', 'partially_paid'].includes(financialStatus);
  const isContractWarning = ['frozen', 'scheduled_cancel', 'scheduled_freeze'].includes(contractStatus);

  if (accessStatus === 'grace_period' || isFinancialWarning || isContractWarning) {
    const label = accessStatus === 'grace_period'
      ? 'Periodo de graca'
      : isContractWarning
        ? contractStatusLabel(contractStatus)
        : financialStatusLabel(financialStatus);
    return {
      level: 'warning',
      label,
      sublabel: accessStatus === 'grace_period' ? financialStatusLabel(financialStatus) : accessStatusLabel(accessStatus),
      dotClass: 'bg-amber-400',
      bgClass: 'bg-amber-500/10 border-amber-500/30',
      textClass: 'text-amber-300',
    };
  }

  // Pending activation — not yet active but on track
  if (contractStatus === 'pending_activation') {
    return {
      level: 'warning',
      label: 'Aguardando ativacao',
      sublabel: financialStatusLabel(financialStatus),
      dotClass: 'bg-blue-400',
      bgClass: 'bg-blue-500/10 border-blue-500/30',
      textClass: 'text-blue-300',
    };
  }

  // Healthy — active, paid, allowed
  return {
    level: 'healthy',
    label: 'Em dia',
    sublabel: contractStatusLabel(contractStatus),
    dotClass: 'bg-emerald-400',
    bgClass: 'bg-emerald-500/10 border-emerald-500/30',
    textClass: 'text-emerald-300',
  };
}
