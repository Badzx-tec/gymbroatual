import { apiUrl, API_BASE } from './config';
import { clearSession, getSessionToken } from './lib/session';
import { dateInputToIsoRangeEnd, dateInputToIsoRangeStart } from './utils/timezone';

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
  const requestId = body.request_id || res.headers.get('X-Request-ID') || null;
  const rawDetail = body.detail ?? fallback.detail;
  const detail = stringifyDetail(rawDetail) || fallback.detail;
  const normalizedDetail = requestId ? `${detail} (Ref: ${requestId})` : detail;

  return {
    status: res.status,
    code: body.code || headerCode || null,
    detail: normalizedDetail || fallback.detail,
    checkout_url: body.checkout_url || checkoutUrl || null,
    request_id: requestId,
  };
}

function shouldLogoutOnUnauthorized(path, detail, code) {
  if (path.includes('/auth/login') || path.includes('/auth/register')) return false;
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (normalizedCode === 'AUTH_INVALID_SESSION' || normalizedCode === 'AUTH_INVALID_TOKEN') {
    return true;
  }

  if (path.includes('/auth/me')) return true;

  const normalizedDetail = String(detail || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const invalidSessionSignals = [
    'sessao expirada',
    'token invalido',
    'nao autenticado',
  ];
  return invalidSessionSignals.some((signal) => normalizedDetail.includes(signal));
}

async function request(path, options = {}) {
  const token = getSessionToken();
  const headers = { ...(options.headers || {}) };
  if (!options.isBlob && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (!headers['X-Requested-With']) {
    headers['X-Requested-With'] = 'XMLHttpRequest';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const err = await parseError(res);
    if (err.status === 401 && shouldLogoutOnUnauthorized(path, err.detail, err.code)) {
      clearSession();
      if (!path.includes('/auth/')) window.location.href = '/login';
    }
    const e = new Error(err.detail);
    e.status = err.status;
    e.code = err.code;
    e.checkout_url = err.checkout_url;
    e.request_id = err.request_id;
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
  profileMe: () => request('/api/auth/profile'),
  updateProfile: (data) => request('/api/auth/profile', { method: 'PUT', body: JSON.stringify(data) }),
  changeMyPassword: (data) => request('/api/auth/profile/password', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  studentPortalDashboard: () => request('/api/student/dashboard'),
  studentPortalProfile: () => request('/api/student/profile'),
  updateStudentPortalProfile: (data) => request('/api/student/profile', { method: 'PUT', body: JSON.stringify(data) }),
  studentPortalContracts: (limit = 20) => request(`/api/student/contracts?limit=${limit}`),
  studentPortalBilling: (params = {}) => {
    const query = new URLSearchParams();
    if (params.limitContracts) query.set('limit_contracts', String(params.limitContracts));
    if (params.limitCharges) query.set('limit_charges', String(params.limitCharges));
    if (params.limitEvents) query.set('limit_events', String(params.limitEvents));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/student/billing${suffix}`);
  },
  studentPortalAccessLogs: (limit = 50) => request(`/api/student/access-logs?limit=${limit}`),

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
  adminContracts: (params = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.q) query.set('q', String(params.q));
    if (params.sortBy) query.set('sortBy', String(params.sortBy));
    if (params.sortDir) query.set('sortDir', String(params.sortDir));
    const startDate = params.startDate ? dateInputToIsoRangeStart(params.startDate) : null;
    const endDate = params.endDate ? dateInputToIsoRangeEnd(params.endDate) : null;
    if (startDate) query.set('startDate', startDate);
    if (endDate) query.set('endDate', endDate);
    if (params.expiringInDays) query.set('expiringInDays', String(params.expiringInDays));
    if (params.pendingOnly) query.set('pendingOnly', 'true');
    if (params.includeArchived) query.set('includeArchived', 'true');
    if (Array.isArray(params.status)) {
      params.status.filter(Boolean).forEach((status) => query.append('status', String(status)));
    }
    if (Array.isArray(params.planoId)) {
      params.planoId.filter(Boolean).forEach((planId) => query.append('planoId', String(planId)));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/admin/contratos${suffix}`);
  },
  adminContractDetail: (contractId) => request(`/api/admin/contratos/${contractId}`),
  adminRenewContract: (contractId, data = {}) =>
    request(`/api/admin/contratos/${contractId}/renovar`, { method: 'POST', body: JSON.stringify(data) }),
  adminCancelContract: (contractId, data = {}) =>
    request(`/api/admin/contratos/${contractId}/cancelar`, { method: 'POST', body: JSON.stringify(data) }),
  adminPauseContract: (contractId, data = {}) =>
    request(`/api/admin/contratos/${contractId}/pausar`, { method: 'POST', body: JSON.stringify(data) }),
  adminAdjustContractValidity: (contractId, data = {}) =>
    request(`/api/admin/contratos/${contractId}/ajustar-validade`, { method: 'POST', body: JSON.stringify(data) }),
  adminAdjustContractBilling: (contractId, data = {}) =>
    request(`/api/admin/contratos/${contractId}/ajustar-cobranca`, { method: 'POST', body: JSON.stringify(data) }),
  adminArchiveContract: (contractId, data) =>
    request(`/api/admin/contratos/${contractId}/arquivar`, { method: 'POST', body: JSON.stringify(data) }),
  adminRestoreContract: (contractId, data = {}) =>
    request(`/api/admin/contratos/${contractId}/restaurar`, { method: 'POST', body: JSON.stringify(data) }),
  adminCleanupInvalidContractCharges: (contractId, data = {}) =>
    request(`/api/admin/contratos/${contractId}/limpar-pendencias`, { method: 'POST', body: JSON.stringify(data) }),
  adminSettleOverdueContract: (contractId, data = {}) =>
    request(`/api/admin/contratos/${contractId}/quitar-atrasos`, { method: 'POST', body: JSON.stringify(data) }),
  adminRemoveCanceledContracts: (data = {}) =>
    request('/api/admin/contratos/remover-cancelados', { method: 'POST', body: JSON.stringify(data) }),
  adminContractPdf: (contractId) =>
    request(`/api/admin/contratos/${contractId}/pdf`, { isBlob: true }).then((b) =>
      downloadBlob(b, `contrato_${contractId}.pdf`)
    ),
  exportAdminContracts: (params = {}) => {
    const query = new URLSearchParams();
    if (params.format) query.set('format', String(params.format));
    if (params.q) query.set('q', String(params.q));
    const startDate = params.startDate ? dateInputToIsoRangeStart(params.startDate) : null;
    const endDate = params.endDate ? dateInputToIsoRangeEnd(params.endDate) : null;
    if (startDate) query.set('startDate', startDate);
    if (endDate) query.set('endDate', endDate);
    if (params.expiringInDays) query.set('expiringInDays', String(params.expiringInDays));
    if (params.pendingOnly) query.set('pendingOnly', 'true');
    if (params.includeArchived) query.set('includeArchived', 'true');
    if (Array.isArray(params.status)) {
      params.status.filter(Boolean).forEach((status) => query.append('status', String(status)));
    }
    if (Array.isArray(params.planoId)) {
      params.planoId.filter(Boolean).forEach((planId) => query.append('planoId', String(planId)));
    }
    if (Array.isArray(params.ids)) {
      params.ids.filter(Boolean).forEach((id) => query.append('ids', String(id)));
    }
    const format = String(params.format || 'xlsx').toLowerCase();
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const filename = format === 'csv' ? 'contratos_gymbro.csv' : 'contratos_gymbro.xlsx';
    return request(`/api/admin/contratos/export${suffix}`, { isBlob: true }).then((b) => downloadBlob(b, filename));
  },
  studentBillingOverview: () => request('/api/student-billing/overview'),
  runStudentBillingReconcile: (limit = 500) =>
    request(`/api/student-billing/reconcile/run?limit=${encodeURIComponent(String(limit))}`, {
      method: 'POST',
    }),
  listStudentBillingReconcileRuns: (limit = 30) =>
    request(`/api/student-billing/reconcile/runs?limit=${encodeURIComponent(String(limit))}`),
  listStudentContracts: (params = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.contract_status) query.set('contract_status', params.contract_status);
    if (params.financial_status) query.set('financial_status', params.financial_status);
    if (params.access_status) query.set('access_status', params.access_status);
    if (params.student_id) query.set('student_id', params.student_id);
    if (params.plan_id) query.set('plan_id', params.plan_id);
    if (params.q) query.set('q', params.q);
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/student-billing/contracts${suffix}`);
  },
  getStudentContractDetail: (contractId) => request(`/api/student-billing/contracts/${contractId}`),
  createStudentContract: (data) => request('/api/student-billing/contracts', { method: 'POST', body: JSON.stringify(data) }),
  updateStudentContract: (contractId, data) => request(`/api/student-billing/contracts/${contractId}`, { method: 'PUT', body: JSON.stringify(data) }),
  renewStudentContract: (contractId, data) => request(`/api/student-billing/contracts/${contractId}/renew`, { method: 'POST', body: JSON.stringify(data || {}) }),
  freezeStudentContract: (contractId, data) => request(`/api/student-billing/contracts/${contractId}/freeze`, { method: 'POST', body: JSON.stringify(data) }),
  resumeStudentContract: (contractId, data) => request(`/api/student-billing/contracts/${contractId}/resume`, { method: 'POST', body: JSON.stringify(data || {}) }),
  changeStudentContractPlan: (contractId, data) => request(`/api/student-billing/contracts/${contractId}/change-plan`, { method: 'POST', body: JSON.stringify(data) }),
  cancelStudentContract: (contractId, data = {}) => request(`/api/student-billing/contracts/${contractId}/cancel`, { method: 'POST', body: JSON.stringify(data) }),
  listContractCharges: (contractId, limit = 200) => request(`/api/student-billing/contracts/${contractId}/charges?limit=${limit}`),
  createContractCharge: (contractId, data) => request(`/api/student-billing/contracts/${contractId}/charges`, { method: 'POST', body: JSON.stringify(data) }),
  cleanupContractCharges: (contractId, data = {}) => request(`/api/student-billing/contracts/${contractId}/charges/cleanup`, { method: 'POST', body: JSON.stringify(data) }),
  markStudentChargePaid: (chargeId, data) => request(`/api/student-billing/charges/${chargeId}/mark-paid`, { method: 'POST', body: JSON.stringify(data) }),
  markStudentChargeUnpaid: (chargeId, data = {}) => request(`/api/student-billing/charges/${chargeId}/mark-unpaid`, { method: 'POST', body: JSON.stringify(data) }),
  listStudentBillingEvents: (limit = 100, contractId = '') => request(`/api/student-billing/events?limit=${limit}${contractId ? `&contract_id=${encodeURIComponent(contractId)}` : ''}`),

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
  markNotificationsRead: (notifIds) => request('/api/notifications/read-bulk', { method: 'POST', body: JSON.stringify({ notif_ids: notifIds }) }),
  deleteNotification: (id) => request(`/api/notifications/${id}`, { method: 'DELETE' }),
  deleteNotifications: (notifIds) => request('/api/notifications/delete-bulk', { method: 'POST', body: JSON.stringify({ notif_ids: notifIds }) }),

  subscriptionStatus: () => request('/api/billing/subscription/status'),
  subscriptionStatusRefresh: () => request('/api/billing/subscription/status?refresh=true'),
  subscriptionCheckout: () => request('/api/billing/subscription/checkout', { method: 'POST' }),
  subscriptionRefresh: () => request('/api/billing/subscription/refresh', { method: 'POST' }),
  billingOverview: (params = {}) => {
    const query = new URLSearchParams();
    if (params.invoiceLimit) query.set('invoice_limit', String(params.invoiceLimit));
    if (params.attemptLimit) query.set('attempt_limit', String(params.attemptLimit));
    if (params.eventLimit) query.set('event_limit', String(params.eventLimit));
    if (params.refresh) query.set('refresh', 'true');
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/billing/overview${suffix}`);
  },
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
  updateEmployee: (employeeId, data) => request(`/api/staff/employees/${employeeId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmployee: (employeeId) => request(`/api/staff/employees/${employeeId}`, { method: 'DELETE' }),
  deactivateEmployee: (employeeId) => request(`/api/staff/employees/${employeeId}/deactivate`, { method: 'POST' }),
  resetEmployeePassword: (employeeId, data = {}) => request(`/api/staff/employees/${employeeId}/reset-password`, { method: 'POST', body: JSON.stringify(data) }),
  updateEmployeeCredentials: (employeeId, data) => request(`/api/staff/employees/${employeeId}/credentials`, { method: 'POST', body: JSON.stringify(data) }),
  syncEmployeeShadowStudent: (employeeId) => request(`/api/staff/employees/${employeeId}/sync-shadow-student`, { method: 'POST' }),

  createTurnstileDevice: (data) => request('/api/turnstiles/devices', { method: 'POST', body: JSON.stringify(data) }),
  rotateTurnstileDeviceToken: (deviceId) => request(`/api/turnstiles/devices/${deviceId}/rotate-token`, { method: 'POST' }),
  listTurnstileDevices: () => request('/api/turnstiles/devices'),
  listTurnstileAccessLogs: (params = {}) => {
    const normalized = typeof params === 'number' ? { limit: params } : params || {};
    const query = new URLSearchParams();
    if (normalized.limit) query.set('limit', String(normalized.limit));
    if (normalized.decision) query.set('decision', String(normalized.decision));
    if (normalized.reason) query.set('reason', String(normalized.reason));
    if (normalized.subject_type) query.set('subject_type', String(normalized.subject_type));
    if (normalized.device_id) query.set('device_id', String(normalized.device_id));
    if (normalized.since_minutes) query.set('since_minutes', String(normalized.since_minutes));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/turnstiles/access-logs${suffix}`);
  },
  turnstileAccessSummary: (windowMinutes = 60) =>
    request(`/api/turnstiles/access-summary?window_minutes=${encodeURIComponent(String(windowMinutes))}`),

  opsMetrics: () => request('/api/ops/metrics'),
  opsAlerts: () => request('/api/ops/alerts'),
  platformOverview: () => request('/api/platform/overview'),
  platformOwners: (limit = 100) => request(`/api/platform/owners?limit=${limit}`),
  platformGrantGrace: (ownerId, data = {}) =>
    request(`/api/platform/owners/${encodeURIComponent(ownerId)}/grace`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  platformClearGrace: (ownerId) =>
    request(`/api/platform/owners/${encodeURIComponent(ownerId)}/grace`, {
      method: 'DELETE',
    }),
  platformFinanceSummary: (days = 30) => request(`/api/platform/finance/summary?days=${days}`),
  platformLogs: (params = {}) => {
    const query = new URLSearchParams();
    if (params.owner_id) query.set('owner_id', params.owner_id);
    if (params.source) query.set('source', params.source);
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/platform/logs${suffix}`);
  },

  catracaCommand: (data) => request('/api/catraca/command', { method: 'POST', body: JSON.stringify(data) }),
  catracaCommands: () => request('/api/catraca/commands'),
  catracaControlState: () => request('/api/catraca/control-state'),
  turnstileManualRelease: (data) =>
    request('/api/turnstiles/manual-releases', { method: 'POST', body: JSON.stringify(data) }),
  turnstileQuickRelease: (data) =>
    request('/api/turnstiles/quick-releases', { method: 'POST', body: JSON.stringify(data) }),

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
  let hasOpenedAtLeastOnce = false;
  let failedBeforeOpen = false;

  const connect = () => {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      hasOpenedAtLeastOnce = true;
      failedBeforeOpen = false;
    };
    ws.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        // ignore malformed payloads
      }
    };
    ws.onclose = () => {
      if (!hasOpenedAtLeastOnce || failedBeforeOpen) {
        return;
      }
      reconnect = setTimeout(connect, 3000);
    };
    ws.onerror = () => {
      if (!hasOpenedAtLeastOnce) failedBeforeOpen = true;
      ws.close();
    };
  };

  connect();

  return () => {
    clearTimeout(reconnect);
    if (ws) ws.close();
  };
}
