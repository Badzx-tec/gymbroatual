/**
 * Feature flags — read from localStorage or env REACT_APP_FEATURES.
 *
 * To enable a flag in the browser:
 *   localStorage.setItem('ff_NEW_CONTRACTS_LAYOUT', '1')
 *
 * To enable via env (build-time):
 *   REACT_APP_FEATURES=NEW_CONTRACTS_LAYOUT,NEW_CATRACA_LAYOUT npm run build
 */

const ENV_FLAGS = new Set(
  (process.env.REACT_APP_FEATURES || '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
);

function isFlagEnabled(flag) {
  if (ENV_FLAGS.has(flag)) return true;
  try {
    return localStorage.getItem(`ff_${flag}`) === '1';
  } catch {
    return false;
  }
}

export const FLAGS = {
  NEW_CONTRACTS_LAYOUT: 'NEW_CONTRACTS_LAYOUT',
  NEW_CATRACA_LAYOUT: 'NEW_CATRACA_LAYOUT',
  NEW_STUDENTS_LAYOUT: 'NEW_STUDENTS_LAYOUT',
};

const cache = {};

/**
 * Returns true if the given feature flag is active (env or localStorage).
 * Result is cached for the page lifetime.
 *
 * @param {string} flag  One of the {@link FLAGS} constants
 * @returns {boolean}
 */
export function isEnabled(flag) {
  if (!(flag in cache)) {
    cache[flag] = isFlagEnabled(flag);
  }
  return cache[flag];
}

/**
 * Enables a feature flag in localStorage and clears the in-memory cache.
 *
 * @param {string} flag  One of the {@link FLAGS} constants
 * @returns {void}
 */
export function enableFlag(flag) {
  try {
    localStorage.setItem(`ff_${flag}`, '1');
    delete cache[flag];
  } catch {
    // ignore
  }
}

/**
 * Disables a feature flag in localStorage and clears the in-memory cache.
 *
 * @param {string} flag  One of the {@link FLAGS} constants
 * @returns {void}
 */
export function disableFlag(flag) {
  try {
    localStorage.removeItem(`ff_${flag}`);
    delete cache[flag];
  } catch {
    // ignore
  }
}
