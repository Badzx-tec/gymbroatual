const TOKEN_KEY = 'gymbro_token';
const USER_KEY = 'gymbro_user';

function safeStorage(kind) {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readRaw(key) {
  const session = safeStorage('session');
  const local = safeStorage('local');
  return session?.getItem(key) || local?.getItem(key) || '';
}

function removeEverywhere(key) {
  safeStorage('session')?.removeItem(key);
  safeStorage('local')?.removeItem(key);
}

export function migrateLegacySession() {
  const session = safeStorage('session');
  const local = safeStorage('local');
  if (!session || !local) return;

  const sessionToken = session.getItem(TOKEN_KEY);
  const legacyToken = local.getItem(TOKEN_KEY);
  if (!sessionToken && legacyToken) {
    session.setItem(TOKEN_KEY, legacyToken);
  }

  const sessionUser = session.getItem(USER_KEY);
  const legacyUser = local.getItem(USER_KEY);
  if (!sessionUser && legacyUser) {
    session.setItem(USER_KEY, legacyUser);
  }

  local.removeItem(TOKEN_KEY);
  local.removeItem(USER_KEY);
}

export function getSessionToken() {
  migrateLegacySession();
  return readRaw(TOKEN_KEY);
}

export function getStoredUser() {
  migrateLegacySession();
  const raw = readRaw(USER_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function storeSession(token, user) {
  const session = safeStorage('session');
  if (!session) return;
  if (token) {
    session.setItem(TOKEN_KEY, token);
  }
  if (user) {
    session.setItem(USER_KEY, JSON.stringify(user));
  }
  safeStorage('local')?.removeItem(TOKEN_KEY);
  safeStorage('local')?.removeItem(USER_KEY);
}

export function updateStoredUser(updater) {
  const current = getStoredUser();
  const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
  safeStorage('session')?.setItem(USER_KEY, JSON.stringify(next));
  safeStorage('local')?.removeItem(USER_KEY);
  return next;
}

export function clearSession() {
  removeEverywhere(TOKEN_KEY);
  removeEverywhere(USER_KEY);
}
