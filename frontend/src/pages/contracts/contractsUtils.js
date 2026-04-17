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
  if (['active', 'paid', 'allowed'].includes(normalized)) return 'bg-[var(--status-success-bg)] border-[var(--status-success-border)] text-[var(--status-success-text)]';
  if (['pending', 'open', 'grace_period', 'pending_activation', 'scheduled_cancel', 'scheduled_freeze', 'draft', 'refunded'].includes(normalized)) return 'bg-[var(--status-info-bg)] border-[var(--status-info-border)] text-[var(--status-info-text)]';
  if (['frozen', 'overdue', 'failed', 'suspended', 'partially_paid'].includes(normalized)) return 'bg-[var(--status-warning-bg)] border-[var(--status-warning-border)] text-[var(--status-warning-text)]';
  return 'bg-[var(--status-danger-bg)] border-[var(--status-danger-border)] text-[var(--status-danger-text)]';
}

export function contractBadge(contractStatus) {
  const normalized = String(contractStatus || '').toLowerCase();
  return {
    className: badgeClass(contractStatus),
    tone: ['active'].includes(normalized)
      ? 'success'
      : ['pending_activation', 'scheduled_cancel', 'scheduled_freeze', 'draft'].includes(normalized)
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
      : ['pending', 'open', 'refunded'].includes(normalized)
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
      ? 'bg-[var(--status-neutral-bg)] border-[var(--status-neutral-border)] text-[var(--status-neutral-text)]'
      : 'bg-[var(--status-success-bg)] border-[var(--status-success-border)] text-[var(--status-success-text)]',
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
      dotClass: 'bg-[var(--status-neutral-text)]',
      bgClass: 'bg-[var(--status-neutral-bg)] border-[var(--status-neutral-border)]',
      textClass: 'text-[var(--status-neutral-text)]',
    };
  }

  if (['canceled', 'expired', 'ended'].includes(contractStatus)) {
    return {
      level: 'neutral',
      label: contractStatusLabel(contractStatus),
      sublabel: financialStatusLabel(financialStatus),
      dotClass: 'bg-[var(--status-neutral-text)]',
      bgClass: 'bg-[var(--status-neutral-bg)] border-[var(--status-neutral-border)]',
      textClass: 'text-[var(--status-neutral-text)]',
    };
  }

  if (accessStatus === 'blocked') {
    return {
      level: 'critical',
      label: 'Acesso bloqueado',
      sublabel: financialStatusLabel(financialStatus),
      dotClass: 'bg-[var(--status-danger)] animate-pulse',
      bgClass: 'bg-[var(--status-danger-bg)] border-[var(--status-danger-border)]',
      textClass: 'text-[var(--status-danger-text)]',
    };
  }

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
      dotClass: 'bg-[var(--status-warning)]',
      bgClass: 'bg-[var(--status-warning-bg)] border-[var(--status-warning-border)]',
      textClass: 'text-[var(--status-warning-text)]',
    };
  }

  if (contractStatus === 'pending_activation' || contractStatus === 'draft') {
    return {
      level: 'warning',
      label: contractStatus === 'draft' ? 'Rascunho' : 'Aguardando ativacao',
      sublabel: financialStatusLabel(financialStatus),
      dotClass: 'bg-[var(--status-info)]',
      bgClass: 'bg-[var(--status-info-bg)] border-[var(--status-info-border)]',
      textClass: 'text-[var(--status-info-text)]',
    };
  }

  return {
    level: 'healthy',
    label: 'Em dia',
    sublabel: contractStatusLabel(contractStatus),
    dotClass: 'bg-[var(--status-success)]',
    bgClass: 'bg-[var(--status-success-bg)] border-[var(--status-success-border)]',
    textClass: 'text-[var(--status-success-text)]',
  };
}
