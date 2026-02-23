import { apiUrl, API_BASE } from './config';

function stringifyDetail(detail) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const loc = Array.isArray(item.loc) ? item.loc.join('.') : '';
          const msg = item.msg || item.detail || '';
          return [loc, msg].filter(Boolean).join(': ');
        }
        return String(item);
      })
      .filter(Boolean)
      .join(' | ');
  }
  if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string') return detail.message;
    if (typeof detail.detail === 'string') return detail.detail;
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
  return String(detail || '');
}

async function parseError(res) {
  const fallback = { detail: 'Erro na requisicao' };
  const body = await res.json().catch(() => fallback);
  const headerCode = res.headers.get('X-Error-Code');
  const checkoutUrl = res.headers.get('X-Checkout-Url');
  const rawDetail = body.detail ?? fallback.detail;
  const detail = stringifyDetail(rawDetail) || fallback.detail;

  return {
    status: res.status,
    code: body.code || headerCode || null,
    detail: detail || fallback.detail,
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
  if (res.status === 204) return null;
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
  registerStudentPasskey: (studentId, data) => request(`/api/students/${studentId}/passkey/register`, { method: 'POST', body: JSON.stringify(data || {}) }),
  passkeyRegisterOptions: (studentId) => request(`/api/students/${studentId}/passkey/register/options`, { method: 'POST' }),
  passkeyRegisterVerify: (studentId, data) => request(`/api/students/${studentId}/passkey/register/verify`, { method: 'POST', body: JSON.stringify(data) }),
  listStudentPasskeys: (studentId) => request(`/api/students/${studentId}/passkeys`),

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
  studentBillingOverview: () => request('/api/student-billing/overview'),
  listStudentContracts: (params = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.student_id) query.set('student_id', params.student_id);
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/student-billing/contracts${suffix}`);
  },
  createStudentContract: (data) => request('/api/student-billing/contracts', { method: 'POST', body: JSON.stringify(data) }),
  cancelStudentContract: (contractId) => request(`/api/student-billing/contracts/${contractId}/cancel`, { method: 'POST' }),
  listContractCharges: (contractId, limit = 200) => request(`/api/student-billing/contracts/${contractId}/charges?limit=${limit}`),
  createContractCharge: (contractId, data) => request(`/api/student-billing/contracts/${contractId}/charges`, { method: 'POST', body: JSON.stringify(data) }),
  cleanupContractCharges: (contractId, data = {}) => request(`/api/student-billing/contracts/${contractId}/charges/cleanup`, { method: 'POST', body: JSON.stringify(data) }),
  markStudentChargePaid: (chargeId, data) => request(`/api/student-billing/charges/${chargeId}/mark-paid`, { method: 'POST', body: JSON.stringify(data) }),
  listStudentBillingEvents: (limit = 100) => request(`/api/student-billing/events?limit=${limit}`),

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
  subscriptionStatusRefresh: () => request('/api/billing/subscription/status?refresh=true'),
  subscriptionCheckout: () => request('/api/billing/subscription/checkout', { method: 'POST' }),
  subscriptionRefresh: () => request('/api/billing/subscription/refresh', { method: 'POST' }),
  billingMembership: () => request('/api/billing/membership'),
  billingInvoices: (limit = 50) => request(`/api/billing/invoices?limit=${limit}`),
  billingPaymentAttempts: (limit = 100) => request(`/api/billing/payment-attempts?limit=${limit}`),
  billingEvents: (limit = 100) => request(`/api/billing/events?limit=${limit}`),
  createAcademySubscriptionCheckout: () => request('/api/payments/academy/subscription/checkout', { method: 'POST', body: JSON.stringify({}) }),

  tolletusEnrollStart: (data) => request('/api/tolletus/enroll/start', { method: 'POST', body: JSON.stringify(data) }),
  tolletusEnrollConfirm: (data) => request('/api/tolletus/enroll/confirm', { method: 'POST', body: JSON.stringify(data) }),
  tolletusStudentStatus: (studentId) => request(`/api/tolletus/students/${studentId}/status`),
  tolletusEmployeeEnrollStart: (data) => request('/api/tolletus/employees/enroll/start', { method: 'POST', body: JSON.stringify(data) }),
  tolletusEmployeeEnrollConfirm: (data) => request('/api/tolletus/employees/enroll/confirm', { method: 'POST', body: JSON.stringify(data) }),
  tolletusEmployeeStatus: (employeeId) => request(`/api/tolletus/employees/${employeeId}/status`),

  listStaffInvites: () => request('/api/staff/invites'),
  createStaffInvite: (data) => request('/api/staff/invites', { method: 'POST', body: JSON.stringify(data) }),
  cancelStaffInvite: (inviteId) => request(`/api/staff/invites/${inviteId}`, { method: 'DELETE' }),
  listEmployees: () => request('/api/staff/employees'),
  createEmployee: (data) => request('/api/staff/employees', { method: 'POST', body: JSON.stringify(data) }),
  deactivateEmployee: (employeeId) => request(`/api/staff/employees/${employeeId}/deactivate`, { method: 'POST' }),
  resetEmployeePassword: (employeeId, data = {}) => request(`/api/staff/employees/${employeeId}/reset-password`, { method: 'POST', body: JSON.stringify(data) }),
  updateEmployeeCredentials: (employeeId, data) => request(`/api/staff/employees/${employeeId}/credentials`, { method: 'POST', body: JSON.stringify(data) }),
  syncEmployeeShadowStudent: (employeeId) => request(`/api/staff/employees/${employeeId}/sync-shadow-student`, { method: 'POST' }),

  createTurnstileDevice: (data) => request('/api/turnstiles/devices', { method: 'POST', body: JSON.stringify(data) }),
  rotateTurnstileDeviceToken: (deviceId) => request(`/api/turnstiles/devices/${deviceId}/rotate-token`, { method: 'POST' }),
  listTurnstileDevices: () => request('/api/turnstiles/devices'),
  listTurnstileAccessLogs: (limit = 100) => request(`/api/turnstiles/access-logs?limit=${limit}`),

  opsMetrics: () => request('/api/ops/metrics'),
  opsAlerts: () => request('/api/ops/alerts'),

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
