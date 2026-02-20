async function request(path, options = {}) {
  const token = localStorage.getItem('gymbro_token');
  const headers = { ...options.headers };
  if (!options.isBlob) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // use apiUrl helper to build URL (supports empty API_BASE -> relative URLs)
  const { apiUrl } = await import('./config');
  const url = apiUrl(path);
  const res = await fetch(url, { ...options, headers, credentials: 'include' });
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
  if (options.isBlob) return res.blob();
  return res.json();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  login: (data) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
<<<<<<< HEAD
  requestEmailCode: (email) => request('/api/auth/email/request-code', { method: 'POST', body: JSON.stringify({ email }) }),
  confirmEmailCode: (email, code) => request('/api/auth/email/confirm-code', { method: 'POST', body: JSON.stringify({ email, code }) }),
=======
  loginStart: (data) => request('/api/auth/login/start', { method: 'POST', body: JSON.stringify(data) }),
  loginVerify: (data) => request('/api/auth/login/verify', { method: 'POST', body: JSON.stringify(data) }),
>>>>>>> d3764ba4 (versão 2.0)
  register: (data) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  googleSession: (sid) => request('/api/auth/google/session', { method: 'POST', body: JSON.stringify({ session_id: sid }) }),
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  dashboard: () => request('/api/dashboard'),
  dashboardCharts: () => request('/api/dashboard/charts'),

  listStudents: (search = '', status = '', academy_id = '') => request(`/api/students?search=${encodeURIComponent(search)}&status=${status}&academy_id=${academy_id}`),
  createStudent: (data) => request('/api/students', { method: 'POST', body: JSON.stringify(data) }),
  getStudent: (id) => request(`/api/students/${id}`),
  updateStudent: (id, data) => request(`/api/students/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  registerBiometria: (id, biometria_id) => request(`/api/students/${id}/biometria`, { method: 'POST', body: JSON.stringify({ biometria_id }) }),
  deleteStudent: (id) => request(`/api/students/${id}`, { method: 'DELETE' }),
  registerStudentPasskey: (studentId, credential) => request(`/api/students/${studentId}/passkey/register`, { method: 'POST', body: JSON.stringify({ credential }) }),
  listStudentPasskeys: (studentId) => request(`/api/students/${studentId}/passkeys`),
  passkeyRegisterOptions: (studentId) => request(`/api/students/${studentId}/passkey/register/options`, { method: 'POST', body: JSON.stringify({}) }),
  passkeyRegisterVerify: (studentId, payload) => request(`/api/students/${studentId}/passkey/register/verify`, { method: 'POST', body: JSON.stringify(payload) }),

  listPlans: () => request('/api/plans'),
  listPlansPublic: () => request('/api/plans/public'),
  createPlan: (data) => request('/api/plans', { method: 'POST', body: JSON.stringify(data) }),
  updatePlan: (id, data) => request(`/api/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePlan: (id) => request(`/api/plans/${id}`, { method: 'DELETE' }),

  listAccessLogs: (limit = 50) => request(`/api/access-logs?limit=${limit}`),

  listWebhookLogs: (limit = 50) => request(`/api/webhook-logs?limit=${limit}`),

  // Billing
  getAcademyBilling: (academyId) => request(`/api/academies/${academyId}/billing`),

  // Student Progress (Evolução)
  recordStudentProgress: (studentId, data) => request(`/api/students/${studentId}/progress`, { method: 'POST', body: JSON.stringify(data) }),
  listStudentProgress: (studentId, limit = 50) => request(`/api/students/${studentId}/progress?limit=${limit}`),

  // Attendance (Presença)
  recordAttendance: (studentId, data) => request(`/api/students/${studentId}/attendance`, { method: 'POST', body: JSON.stringify(data) }),
  listStudentAttendance: (studentId, limit = 100) => request(`/api/students/${studentId}/attendance?limit=${limit}`),

  // Academies
  listAcademies: () => request('/api/academies'),
  createAcademy: (data) => request('/api/academies', { method: 'POST', body: JSON.stringify(data) }),
  updateAcademy: (id, data) => request(`/api/academies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAcademy: (id) => request(`/api/academies/${id}`, { method: 'DELETE' }),
  academyStats: (id) => request(`/api/academies/${id}/stats`),

  // Notifications
  listNotifications: (limit = 50) => request(`/api/notifications?limit=${limit}`),
  checkExpiring: () => request('/api/notifications/check-expiring', { method: 'POST' }),
  markRead: (id) => request(`/api/notifications/${id}/read`, { method: 'PUT' }),
  deleteNotification: (id) => request(`/api/notifications/${id}`, { method: 'DELETE' }),

  // Reports
  exportStudentsExcel: () => request('/api/reports/students/excel', { isBlob: true }).then(b => downloadBlob(b, 'alunos_gymbro.xlsx')),
  exportStudentsPdf: () => request('/api/reports/students/pdf', { isBlob: true }).then(b => downloadBlob(b, 'alunos_gymbro.pdf')),
  exportAccessExcel: () => request('/api/reports/access-logs/excel', { isBlob: true }).then(b => downloadBlob(b, 'acessos_gymbro.xlsx')),
  exportFinancialExcel: () => request('/api/reports/financial/excel', { isBlob: true }).then(b => downloadBlob(b, 'financeiro_gymbro.xlsx')),


  createAcademySubscriptionCheckout: (data) => request('/api/payments/academy/subscription/checkout', { method: 'POST', body: JSON.stringify(data) }),

  // Catraca
  catracaCommand: (data) => request('/api/catraca/command', { method: 'POST', body: JSON.stringify(data) }),
  catracaCommands: () => request('/api/catraca/commands'),
  catracaIlnet2Execute: (data) => request('/api/catraca/ilnet2/execute', { method: 'POST', body: JSON.stringify(data) }),

  seed: () => request('/api/seed', { method: 'POST' }),
};

// WebSocket helper
export function connectWebSocket(onMessage) {
  const base = (process.env.REACT_APP_API_BASE || '') || window.location.origin;
  const wsUrl = base.replace('https://', 'wss://').replace('http://', 'ws://') + '/api/ws';
  let ws = null;
  let reconnectTimeout = null;

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => console.log('WS connected');
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = () => {
      reconnectTimeout = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();
  }
  connect();

  return () => {
    clearTimeout(reconnectTimeout);
    if (ws) ws.close();
  };
}
