export const API_BASE = (process.env.REACT_APP_API_BASE || '').replace(/\/+$|\s+/g, '');

export function apiUrl(path) {
  if (!path.startsWith('/')) path = '/' + path;
  return `${API_BASE}${path}`;
}

const config = { API_BASE, apiUrl };

export default config;
