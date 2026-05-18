import { directionLabel } from '../../utils/labels';
import { formatDateTimeInTimeZone } from '../../utils/timezone';

// ── Constants ─────────────────────────────────────────────────────────────────

export const CATRACA_TOKEN_HISTORY_KEY = 'gymbro_catraca_token_history';

export const REASON_LABELS = {
  ok: 'Acesso valido',
  biometry_required: 'Biometria obrigatoria',
  credential_required: 'Credencial obrigatoria',
  credential_not_found: 'Credencial nao encontrada',
  passage_without_authorization: 'Passagem sem credencial/autorizacao',
  student_not_found: 'Aluno nao encontrado',
  student_inactive: 'Aluno inativo',
  student_manual_block: 'Bloqueio manual do aluno',
  student_blocked_until: 'Aluno bloqueado temporariamente',
  outside_allowed_weekday: 'Dia fora da regra de acesso',
  outside_allowed_time: 'Horario fora da regra de acesso',
  plan_expired: 'Plano vencido',
  contract_access_blocked: 'Contrato bloqueado',
  employee_not_found: 'Funcionario nao encontrado',
  employee_inactive: 'Funcionario inativo',
  employee_manual_block: 'Bloqueio manual do funcionario',
  employee_blocked_until: 'Funcionario bloqueado temporariamente',
  employee_outside_allowed_weekday: 'Dia fora da regra do funcionario',
  employee_outside_allowed_time: 'Horario fora da regra do funcionario',
  owner_not_found: 'Dono da academia nao encontrado',
  owner_inactive: 'Dono da academia inativo',
  owner_manual_block: 'Bloqueio manual do dono da academia',
  owner_blocked_until: 'Dono da academia bloqueado temporariamente',
  owner_outside_allowed_weekday: 'Dia fora da regra do dono da academia',
  owner_outside_allowed_time: 'Horario fora da regra do dono da academia',
  turnstile_direction_locked: 'Fluxo travado na catraca',
  academy_subscription_inactive: 'Assinatura da academia inativa',
};

export const CONTROL_ACTIONS = [
  { key: 'lock_entry', label: 'Travar entrada', kind: 'lock' },
  { key: 'lock_exit', label: 'Travar saida', kind: 'lock' },
  { key: 'lock_both', label: 'Travar ambas', kind: 'lock' },
  { key: 'unlock_entry', label: 'Desbloquear entrada', kind: 'unlock' },
  { key: 'unlock_exit', label: 'Desbloquear saida', kind: 'unlock' },
  { key: 'unlock_both', label: 'Desbloquear ambas', kind: 'unlock' },
];

export const CONTROL_SCOPE_OPTIONS = [
  { value: 'all', label: 'Todos os perfis' },
  { value: 'students', label: 'Somente alunos' },
  { value: 'employees', label: 'Somente funcionarios' },
  { value: 'owners', label: 'Somente dono da academia' },
];

// ── Formatters ────────────────────────────────────────────────────────────────

/**
 * Formats an ISO timestamp using the academy's local timezone.
 *
 * @param {string|null|undefined} value  ISO 8601 string
 * @returns {string}
 */
export function formatDateTime(value) {
  return formatDateTimeInTimeZone(value);
}

/**
 * Maps a machine-readable reason code to a Portuguese label.
 *
 * @param {string|null|undefined} reason
 * @returns {string}
 */
export function reasonLabel(reason) {
  const key = String(reason || '').toLowerCase();
  if (!key) return '-';
  return REASON_LABELS[key] || key.replaceAll('_', ' ');
}

export function actionLabel(action) {
  const key = String(action || '').toLowerCase();
  const mapped = CONTROL_ACTIONS.find((item) => item.key === key);
  if (mapped) return mapped.label;
  return key || '-';
}

export function scopeLabel(scope) {
  const key = String(scope || '').toLowerCase();
  const mapped = CONTROL_SCOPE_OPTIONS.find((item) => item.value === key);
  return mapped?.label || 'Todos os perfis';
}

/**
 * Returns the StatusBadge tone for an access decision.
 *
 * @param {string|null|undefined} decision  "allow" | "deny"
 * @returns {'success'|'danger'}
 */
export function decisionTone(decision) {
  return String(decision || '').toLowerCase() === 'allow' ? 'success' : 'danger';
}

// ── State helpers ─────────────────────────────────────────────────────────────

export function normalizeControlState(state) {
  const base = {
    student: { entry_locked: false, exit_locked: false },
    employee: { entry_locked: false, exit_locked: false },
    owner: { entry_locked: false, exit_locked: false },
  };
  const controls = state?.subject_controls;
  if (!controls || typeof controls !== 'object') return base;
  const next = { ...base };
  ['student', 'employee', 'owner'].forEach((subject) => {
    if (controls[subject] && typeof controls[subject] === 'object') {
      next[subject] = {
        entry_locked: Boolean(controls[subject].entry_locked),
        exit_locked: Boolean(controls[subject].exit_locked),
      };
    }
  });
  return next;
}

/**
 * Returns a human-readable explanation of the reason_detail object
 * or an empty string if there is no actionable detail.
 *
 * @param {object|null|undefined} log  Access log record
 * @returns {string}
 */
export function extractReasonDetail(log) {
  const detail = log?.reason_detail;
  if (!detail || typeof detail !== 'object') return '';
  if (detail.contract_access_status === 'blocked' || detail.contract_access_status === 'suspended') {
    return 'Contrato sem liberacao de acesso.';
  }
  if (detail.grace_until) {
    return `Periodo de carencia ate ${formatDateTime(detail.grace_until)}.`;
  }
  if (detail.blocked_until) {
    return `Bloqueado ate ${formatDateTime(detail.blocked_until)}.`;
  }
  if (detail.rule === 'turnstile_control_state') {
    const requested = directionLabel(detail.requested_direction);
    return `Fluxo ${requested.toLowerCase()} travado para este perfil.`;
  }
  if (detail.rule === 'biometry_required') {
    return 'Entrada e saida exigem leitura biometrica.';
  }
  if (detail.rule === 'credential_required') {
    return 'Entrada e saida exigem credencial valida: biometria, RFID, senha ou matricula.';
  }
  if (detail.rule === 'passage_without_authorization') {
    return 'A catraca registrou passagem sem liberacao previa por credencial.';
  }
  return '';
}

/**
 * Returns true if the access log record matches a free-text search query.
 *
 * @param {object} log
 * @param {string} query  Lower-cased search string
 * @returns {boolean}
 */
export function matchesAccessSearch(log, query) {
  if (!query) return true;
  const haystack = [
    log?.subject_name,
    log?.student_name,
    log?.employee_name,
    log?.owner_name,
    log?.subject_id,
    log?.device_id,
    log?.method,
    log?.reason,
    log?.credential_masked,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * Returns true if `value` is an ISO timestamp within the last `minutes` minutes.
 *
 * @param {string|null|undefined} value
 * @param {number} [minutes=5]
 * @returns {boolean}
 */
export function isRecent(value, minutes = 5) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= minutes * 60 * 1000;
}
