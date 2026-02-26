const DEFAULT_LIMIT = 10;

function sanitizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field) => field && typeof field === 'object')
    .map((field) => ({
      label: String(field.label || '').trim() || 'Campo',
      value: String(field.value || ''),
    }))
    .filter((field) => field.value);
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const fields = sanitizeFields(entry.fields);
  if (!fields.length) return null;
  return {
    id: String(entry.id || `cred_${Date.now().toString(36)}`),
    title: String(entry.title || 'Credenciais'),
    description: String(entry.description || ''),
    fields,
    created_at: entry.created_at || new Date().toISOString(),
  };
}

export function loadCredentialHistory(storageKey) {
  if (!storageKey) return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeEntry).filter(Boolean);
  } catch {
    return [];
  }
}

export function clearCredentialHistory(storageKey) {
  if (!storageKey) return;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore storage errors
  }
}

export function pushCredentialHistory(storageKey, entry, limit = DEFAULT_LIMIT) {
  const normalized = sanitizeEntry(entry);
  if (!storageKey || !normalized) return loadCredentialHistory(storageKey);

  const current = loadCredentialHistory(storageKey);
  const deduped = current.filter((item) => {
    const sameTitle = item.title === normalized.title;
    const sameFields = JSON.stringify(item.fields) === JSON.stringify(normalized.fields);
    return !(sameTitle && sameFields);
  });
  const next = [normalized, ...deduped].slice(0, Math.max(1, Number(limit) || DEFAULT_LIMIT));
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

