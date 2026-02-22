import { apiUrl, API_BASE } from './config';

async function parseError(res) {
  const fallback = { detail: 'Erro na requisicao' };
  const body = await res.json().catch(() => fallback);
  const headerCode = res.headers.get('X-Error-Code');
  const checkoutUrl = res.headers.get('X-Checkout-Url');
  return {
    status: res.status,
    code: body.code || headerCode || null,
    detail: body.detail || fallback.detail,
    checkout_url: body.checkout_url || checkoutUrl || null,
  };
}

async function request(path, options = {}) {
  const token = localStorage.getItem('gymbro_token');
  const headers = { ...(options.headers || {}) };
  if (!options.isBlob && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    localStorage.removeItem('gymbro_token');
    localStorage.removeItem('gymbro_user');
    if (!path.includes('/auth/')) window.location.href = '/login';
  }

  if (!res.ok) {
    const err = await parseError(res);
    const e = new Error(err.detail);
    e.status = err.status;
    e.code = err.code;
    e.checkout_url = err.checkout_url;
    throw e;
  }

  if (options.isBlob) return res.blob();
  return res.json();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  register: (data) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  verifyStart: (email) => request('/api/auth/verify/start', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyConfirm: (email, code) => request('/api/auth/verify/confirm', { method: 'POST', body: JSON.stringify({ email, code }) }),
  login: (data) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  dashboard: () => request('/api/dashboard'),
  dashboardCharts: () => request('/api/dashboard/charts'),

  listStudents: (search = '', status = '') => request(`/api/students?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  createStudent: (data) => request('/api/students', { method: 'POST', body: JSON.stringify(data) }),
  getStudent: (id) => request(`/api/students/${id}`),
  updateStudent: (id, data) => request(`/api/students/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStudent: (id) => request(`/api/students/${id}`, { method: 'DELETE' }),
  registerBiometria: (id, biometria_id) => request(`/api/students/${id}/biometria`, { method: 'POST', body: JSON.stringify({ biometria_id }) }),

  addMeasurement: (studentId, data) => request(`/api/students/${studentId}/measurements`, { method: 'POST', body: JSON.stringify(data) }),
  listMeasurements: (studentId) => request(`/api/students/${studentId}/measurements`),
  addWorkout: (studentId, data) => request(`/api/students/${studentId}/workouts`, { method: 'POST', body: JSON.stringify(data) }),
  listWorkouts: (studentId) => request(`/api/students/${studentId}/workouts`),
  recordAttendance: (studentId, data) => request(`/api/students/${studentId}/attendance`, { method: 'POST', body: JSON.stringify(data) }),
  listStudentAttendance: (studentId, limit = 100) => request(`/api/students/${studentId}/attendance?limit=${limit}`),
  recordStudentProgress: (studentId, data) => request(`/api/students/${studentId}/progress`, { method: 'POST', body: JSON.stringify(data) }),
  listStudentProgress: (studentId, limit = 50) => request(`/api/students/${studentId}/progress?limit=${limit}`),

  listPlans: () => request('/api/plans'),
  listPlansPublic: () => request('/api/plans/public'),
  createPlan: (data) => request('/api/plans', { method: 'POST', body: JSON.stringify(data) }),
  updatePlan: (id, data) => request(`/api/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePlan: (id) => request(`/api/plans/${id}`, { method: 'DELETE' }),

  listAccessLogs: (limit = 50) => request(`/api/access-logs?limit=${limit}`),
  listWebhookLogs: (limit = 50) => request(`/api/webhook-logs?limit=${limit}`),

  listAcademies: () => request('/api/academies'),
  createAcademy: (data) => request('/api/academies', { method: 'POST', body: JSON.stringify(data) }),
  updateAcademy: (id, data) => request(`/api/academies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAcademy: (id) => request(`/api/academies/${id}`, { method: 'DELETE' }),
  academyStats: (id) => request(`/api/academies/${id}/stats`),
  getAcademyBilling: (academyId) => request(`/api/academies/${academyId}/billing`),

  listNotifications: (limit = 50) => request(`/api/notifications?limit=${limit}`),
  checkExpiring: () => request('/api/notifications/check-expiring', { method: 'POST' }),
  markRead: (id) => request(`/api/notifications/${id}/read`, { method: 'PUT' }),
  deleteNotification: (id) => request(`/api/notifications/${id}`, { method: 'DELETE' }),

  subscriptionStatus: () => request('/api/billing/subscription/status'),
  subscriptionCheckout: () => request('/api/billing/subscription/checkout', { method: 'POST' }),
  createAcademySubscriptionCheckout: () => request('/api/payments/academy/subscription/checkout', { method: 'POST', body: JSON.stringify({}) }),

  tolletusEnrollStart: (data) => request('/api/tolletus/enroll/start', { method: 'POST', body: JSON.stringify(data) }),
  tolletusEnrollConfirm: (data) => request('/api/tolletus/enroll/confirm', { method: 'POST', body: JSON.stringify(data) }),
  tolletusStudentStatus: (studentId) => request(`/api/tolletus/students/${studentId}/status`),

  listStaffInvites: () => request('/api/staff/invites'),
  createStaffInvite: (data) => request('/api/staff/invites', { method: 'POST', body: JSON.stringify(data) }),
  cancelStaffInvite: (inviteId) => request(`/api/staff/invites/${inviteId}`, { method: 'DELETE' }),
  listEmployees: () => request('/api/staff/employees'),
  createEmployee: (data) => request('/api/staff/employees', { method: 'POST', body: JSON.stringify(data) }),
  deactivateEmployee: (employeeId) => request(`/api/staff/employees/${employeeId}/deactivate`, { method: 'POST' }),
  resetEmployeePassword: (employeeId, data = {}) => request(`/api/staff/employees/${employeeId}/reset-password`, { method: 'POST', body: JSON.stringify(data) }),

  createTurnstileDevice: (data) => request('/api/turnstiles/devices', { method: 'POST', body: JSON.stringify(data) }),
  listTurnstileDevices: () => request('/api/turnstiles/devices'),
  listTurnstileAccessLogs: (limit = 100) => request(`/api/turnstiles/access-logs?limit=${limit}`),

  catracaCommand: (data) => request('/api/catraca/command', { method: 'POST', body: JSON.stringify(data) }),
  catracaCommands: () => request('/api/catraca/commands'),

  exportStudentsExcel: () => request('/api/reports/students/excel', { isBlob: true }).then((b) => downloadBlob(b, 'alunos_gymbro.xlsx')),
  exportStudentsPdf: () => request('/api/reports/students/pdf', { isBlob: true }).then((b) => downloadBlob(b, 'alunos_gymbro.pdf')),
  exportAccessExcel: () => request('/api/reports/access-logs/excel', { isBlob: true }).then((b) => downloadBlob(b, 'acessos_gymbro.xlsx')),
  exportFinancialExcel: () => request('/api/reports/financial/excel', { isBlob: true }).then((b) => downloadBlob(b, 'financeiro_gymbro.xlsx')),

  seed: () => request('/api/seed', { method: 'POST' }),
};

export function connectWebSocket(onMessage) {
  const origin = API_BASE || window.location.origin;
  const wsBase = origin.replace('https://', 'wss://').replace('http://', 'ws://').replace(/\/+$/, '');
  const wsUrl = `${wsBase}/api/ws`;

  let ws;
  let reconnect;

  const connect = () => {
    ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        // ignore malformed payloads
      }
    };
    ws.onclose = () => {
      reconnect = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();
  };

  connect();

  return () => {
    clearTimeout(reconnect);
    if (ws) ws.close();
  };
}
