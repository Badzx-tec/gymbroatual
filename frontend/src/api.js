const API = process.env.REACT_APP_BACKEND_URL;

async function request(path, options = {}) {
  const token = localStorage.getItem('gymbro_token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers, credentials: 'include' });
  if (res.status === 401) {
    localStorage.removeItem('gymbro_token');
    localStorage.removeItem('gymbro_user');
    if (!path.includes('/auth/')) window.location.href = '/login';
    throw new Error('Nao autenticado');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
    throw new Error(err.detail || 'Erro na requisicao');
  }
  return res.json();
}

export const api = {
  // Auth
  login: (data) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  googleSession: (session_id) => request('/api/auth/google/session', { method: 'POST', body: JSON.stringify({ session_id }) }),
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  // Dashboard
  dashboard: () => request('/api/dashboard'),

  // Students
  listStudents: (search = '', status = '') => request(`/api/students?search=${encodeURIComponent(search)}&status=${status}`),
  createStudent: (data) => request('/api/students', { method: 'POST', body: JSON.stringify(data) }),
  getStudent: (id) => request(`/api/students/${id}`),
  updateStudent: (id, data) => request(`/api/students/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStudent: (id) => request(`/api/students/${id}`, { method: 'DELETE' }),

  // Plans
  listPlans: () => request('/api/plans'),
  listPlansPublic: () => request('/api/plans/public'),
  createPlan: (data) => request('/api/plans', { method: 'POST', body: JSON.stringify(data) }),
  updatePlan: (id, data) => request(`/api/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePlan: (id) => request(`/api/plans/${id}`, { method: 'DELETE' }),

  // Access Logs
  listAccessLogs: (limit = 50) => request(`/api/access-logs?limit=${limit}`),

  // Webhook Logs
  listWebhookLogs: (limit = 50) => request(`/api/webhook-logs?limit=${limit}`),

  // Seed
  seed: () => request('/api/seed', { method: 'POST' }),
};
