/** @type {string} */
const TOKEN_KEY = 'gymbro_token';
/** @type {string} */
const USER_KEY = 'gymbro_user';

/**
 * @typedef {Object} StoredUser
 * @property {string} [id]
 * @property {string} [email]
 * @property {string} [name]
 * @property {string} [role]
 * @property {string} [owner_id]
 * @property {string} [academy_name]
 */

/**
 * Returns a safe reference to localStorage or sessionStorage,
 * or null if unavailable (SSR / private mode).
 *
 * @param {'local'|'session'} kind
 * @returns {Storage|null}
 */
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

/**
 * One-time migration: moves token/user from localStorage to sessionStorage.
 * Called automatically by getSessionToken / getStoredUser.
 *
 * @returns {void}
 */
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

/**
 * Returns the current session JWT, or an empty string if not logged in.
 *
 * @returns {string}
 */
export function getSessionToken() {
  migrateLegacySession();
  return readRaw(TOKEN_KEY);
}

/**
 * Returns the stored user object, or an empty object if absent / malformed.
 *
 * @returns {StoredUser}
 */
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

/**
 * Persists the JWT and user object to sessionStorage.
 *
 * @param {string} token
 * @param {StoredUser} user
 * @returns {void}
 */
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

/**
 * Merges updates into the stored user object and persists them.
 *
 * @param {Partial<StoredUser> | ((current: StoredUser) => StoredUser)} updater
 * @returns {StoredUser}
 */
export function updateStoredUser(updater) {
  const current = getStoredUser();
  const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
  safeStorage('session')?.setItem(USER_KEY, JSON.stringify(next));
  safeStorage('local')?.removeItem(USER_KEY);
  return next;
}

/**
 * Removes session token and user from all storage locations.
 * Called on logout and on invalid-token 401 responses.
 *
 * @returns {void}
 */
export function clearSession() {
  removeEverywhere(TOKEN_KEY);
  removeEverywhere(USER_KEY);
}
