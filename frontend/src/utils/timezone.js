export const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string' && value.trim()) return new Date(value);
  return null;
}

function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function getZonedParts(date, timeZone = SAO_PAULO_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const resolved = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') {
      resolved[part.type] = part.value;
    }
  });
  return resolved;
}

function getTimeZoneOffset(date, timeZone = SAO_PAULO_TIME_ZONE) {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

function parseDateTimeLocal(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const [datePart, timePart = '00:00'] = raw.split('T');
  const [year, month, day] = datePart.split('-').map((token) => Number(token));
  const [hour, minute, second = '0'] = timePart.split(':');
  if (!year || !month || !day) return null;
  return {
    year,
    month,
    day,
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}

function parseDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const [year, month, day] = raw.split('-').map((token) => Number(token));
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function localPartsToUtcIso(parts, timeZone = SAO_PAULO_TIME_ZONE) {
  if (!parts) return null;
  const utcGuess = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour || 0,
      parts.minute || 0,
      parts.second || 0,
      0
    )
  );
  if (!isValidDate(utcGuess)) return null;
  const offset = getTimeZoneOffset(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offset).toISOString();
}

export function formatDateTimeInTimeZone(value, { timeZone = SAO_PAULO_TIME_ZONE, dateOnly = false } = {}) {
  const date = toDate(value);
  if (!isValidDate(date)) return '-';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      dateStyle: 'short',
      ...(dateOnly ? {} : { timeStyle: 'short' }),
    }).format(date);
  } catch {
    return String(value || '-');
  }
}

export function toDateTimeLocalInTimeZone(value, { timeZone = SAO_PAULO_TIME_ZONE } = {}) {
  const date = toDate(value);
  if (!isValidDate(date)) return '';
  try {
    const parts = getZonedParts(date, timeZone);
    return [
      `${parts.year}-${parts.month}-${parts.day}`,
      `${parts.hour}:${parts.minute}`,
    ].join('T');
  } catch {
    return '';
  }
}

export function dateTimeLocalToIsoInTimeZone(value, { timeZone = SAO_PAULO_TIME_ZONE } = {}) {
  const parts = parseDateTimeLocal(value);
  return localPartsToUtcIso(parts, timeZone);
}

export function dateInputToIsoRangeStart(value, { timeZone = SAO_PAULO_TIME_ZONE } = {}) {
  const parts = parseDateOnly(value);
  return localPartsToUtcIso(
    parts
      ? {
          ...parts,
          hour: 0,
          minute: 0,
          second: 0,
        }
      : null,
    timeZone
  );
}

export function dateInputToIsoRangeEnd(value, { timeZone = SAO_PAULO_TIME_ZONE } = {}) {
  const parts = parseDateOnly(value);
  return localPartsToUtcIso(
    parts
      ? {
          ...parts,
          hour: 23,
          minute: 59,
          second: 59,
        }
      : null,
    timeZone
  );
}

export function toDateInputInTimeZone(value, { timeZone = SAO_PAULO_TIME_ZONE } = {}) {
  const date = toDate(value);
  if (!isValidDate(date)) return '';
  try {
    const parts = getZonedParts(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return '';
  }
}

export function toMonthInputInTimeZone(value, { timeZone = SAO_PAULO_TIME_ZONE } = {}) {
  const date = toDate(value);
  if (!isValidDate(date)) return '';
  try {
    const parts = getZonedParts(date, timeZone);
    return `${parts.year}-${parts.month}`;
  } catch {
    return '';
  }
}

export function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
