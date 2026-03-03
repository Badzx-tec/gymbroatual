import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import CredentialPanel from '../components/CredentialPanel';
import {
  clearCredentialHistory,
  loadCredentialHistory,
  pushCredentialHistory,
} from '../utils/credentialHistory';
import { directionLabel, roleLabel, subjectTypeLabel } from '../utils/labels';

const REASON_LABELS = {
  ok: 'Acesso valido',
  credential_not_found: 'Credencial nao encontrada',
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
const CONTROL_ACTIONS = [
  { key: 'lock_entry', label: 'Travar entrada', kind: 'lock' },
  { key: 'lock_exit', label: 'Travar saida', kind: 'lock' },
  { key: 'lock_both', label: 'Travar ambas', kind: 'lock' },
  { key: 'unlock_entry', label: 'Desbloquear entrada', kind: 'unlock' },
  { key: 'unlock_exit', label: 'Desbloquear saida', kind: 'unlock' },
  { key: 'unlock_both', label: 'Desbloquear ambas', kind: 'unlock' },
];
const CONTROL_SCOPE_OPTIONS = [
  { value: 'all', label: 'Todos os perfis' },
  { value: 'students', label: 'Somente alunos' },
  { value: 'employees', label: 'Somente funcionarios' },
  { value: 'owners', label: 'Somente dono da academia' },
];
const CATRACA_TOKEN_HISTORY_KEY = 'gymbro_catraca_token_history';

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return String(value);
  }
}

function reasonLabel(reason) {
  const key = String(reason || '').toLowerCase();
  if (!key) return '-';
  return REASON_LABELS[key] || key.replaceAll('_', ' ');
}

function actionLabel(action) {
  const key = String(action || '').toLowerCase();
  const mapped = CONTROL_ACTIONS.find((item) => item.key === key);
  if (mapped) return mapped.label;
  return key || '-';
}

function scopeLabel(scope) {
  const key = String(scope || '').toLowerCase();
  const mapped = CONTROL_SCOPE_OPTIONS.find((item) => item.value === key);
  return mapped?.label || 'Todos os perfis';
}

function decisionBadgeClass(decision) {
  return String(decision || '').toLowerCase() === 'allow'
    ? 'bg-green-500/15 text-green-300 border-green-500/30'
    : 'bg-red-500/15 text-red-300 border-red-500/30';
}

function extractReasonDetail(log) {
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
  return '';
}

function normalizeControlState(state) {
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

export default function CatracaPage() {
  const user = useMemo(() => JSON.parse(localStorage.getItem('gymbro_user') || '{}'), []);
  const role = String(user.role || '').toUpperCase();
  const canManageDevices = ['OWNER', 'MANAGER'].includes(role);
  const canIssueCommands = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);
  const canViewOpsAlerts = ['OWNER', 'MANAGER'].includes(role);

  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [commands, setCommands] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [controlState, setControlState] = useState(null);
  const [controlScope, setControlScope] = useState('all');
  const [deviceName, setDeviceName] = useState('Gateway Toletus');
  const [loading, setLoading] = useState(true);
  const [executingControlAction, setExecutingControlAction] = useState(false);
  const [tokenPanel, setTokenPanel] = useState(null);
  const [tokenHistory, setTokenHistory] = useState(() =>
    loadCredentialHistory(CATRACA_TOKEN_HISTORY_KEY)
  );
  const [filters, setFilters] = useState({
    limit: 80,
    decision: '',
    subject_type: '',
    reason: '',
    since_minutes: 60,
  });

  const openTokenPanel = (payload) => {
    if (!payload?.fields?.length) return;
    const entry = {
      ...payload,
      id: `token_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
    };
    setTokenPanel(entry);
    setTokenHistory(pushCredentialHistory(CATRACA_TOKEN_HISTORY_KEY, entry, 12));
  };

  const clearTokenHistory = () => {
    clearCredentialHistory(CATRACA_TOKEN_HISTORY_KEY);
    setTokenHistory([]);
    toast.success('Historico de tokens limpo.');
  };

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [cmds, access, devs, summaryData, controlData, opsAlerts] = await Promise.all([
        api.catracaCommands().catch(() => []),
        api.listTurnstileAccessLogs(filters),
        api.listTurnstileDevices(),
        api.turnstileAccessSummary(filters.since_minutes || 60),
        api.catracaControlState().catch(() => null),
        canViewOpsAlerts ? api.opsAlerts().catch(() => ({ alerts: [] })) : Promise.resolve({ alerts: [] }),
      ]);
      setCommands(cmds || []);
      setLogs(access || []);
      setDevices(devs || []);
      setSummary(summaryData || null);
      setControlState(controlData);
      setAlerts(opsAlerts?.alerts || []);
    } catch (err) {
      toast.error(err?.message || 'Falha ao carregar dados da catraca.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filters.decision, filters.subject_type, filters.reason, filters.since_minutes, filters.limit]);

  useEffect(() => {
    const interval = setInterval(() => {
      load({ silent: true });
    }, 8000);
    return () => clearInterval(interval);
  }, [filters.decision, filters.subject_type, filters.reason, filters.since_minutes, filters.limit]);

  const createDevice = async () => {
    if (!canManageDevices) {
      toast.error('Somente Dono da academia ou Diretor pode criar dispositivo.');
      return;
    }
    try {
      const created = await api.createTurnstileDevice({ name: deviceName });
      toast.success('Dispositivo criado.');
      openTokenPanel({
        title: `Token do dispositivo ${created.device_id}`,
        description: 'Copie e guarde. O token aparece somente na criacao/rotacao.',
        fields: [
          { label: 'Device ID', value: created.device_id },
          { label: 'Device Token', value: created.token },
        ],
      });
      load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Erro ao criar dispositivo.');
    }
  };

  const runControlAction = async (action) => {
    if (!canIssueCommands) {
      toast.error('Seu perfil nao pode controlar a catraca.');
      return;
    }
    setExecutingControlAction(true);
    try {
      const response = await api.catracaCommand({
        action,
        target_scope: controlScope,
        message: '',
      });
      if (response?.control_state) {
        setControlState(response.control_state);
      }
      toast.success(`${actionLabel(action)} aplicado para ${scopeLabel(controlScope)}.`);
      load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Erro ao aplicar controle da catraca.');
    } finally {
      setExecutingControlAction(false);
    }
  };

  const rotateToken = async (deviceId) => {
    if (!canManageDevices) {
      toast.error('Somente Dono da academia ou Diretor pode rotacionar token.');
      return;
    }
    try {
      const rotated = await api.rotateTurnstileDeviceToken(deviceId);
      toast.success(`Token rotacionado para ${deviceId}.`);
      openTokenPanel({
        title: `Novo token de ${deviceId}`,
        description: 'Atualize esse valor no gateway imediatamente.',
        fields: [
          { label: 'Device ID', value: deviceId },
          { label: 'Novo token', value: rotated.token },
        ],
      });
      load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Erro ao rotacionar token.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const normalizedControl = normalizeControlState(controlState);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Controle de catraca</h1>
          <p className="text-zinc-400 mt-1">
            Operacao em tempo real com bloqueio por direcao e perfil, seguindo o LiteNet2.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="h-10 px-4 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold uppercase tracking-wide inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="font-semibold uppercase text-sm tracking-wide">Travamento direcional</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Perfil logado: {roleLabel(role)}. Acoes aplicam estado persistente no backend.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={controlScope}
              onChange={(e) => setControlScope(e.target.value)}
              className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm"
            >
              {CONTROL_SCOPE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
          {[
            { key: 'student', label: 'Alunos' },
            { key: 'employee', label: 'Funcionarios' },
            { key: 'owner', label: 'Dono da academia' },
          ].map((row) => {
            const state = normalizedControl[row.key];
            return (
              <div key={row.key} className="border border-zinc-800 rounded-sm p-3">
                <p className="font-semibold text-zinc-200">{row.label}</p>
                <p className={`text-xs mt-1 ${state.entry_locked ? 'text-red-300' : 'text-green-300'}`}>
                  Entrada: {state.entry_locked ? 'Travada' : 'Liberada'}
                </p>
                <p className={`text-xs ${state.exit_locked ? 'text-red-300' : 'text-green-300'}`}>
                  Saida: {state.exit_locked ? 'Travada' : 'Liberada'}
                </p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {CONTROL_ACTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => runControlAction(item.key)}
              disabled={!canIssueCommands || executingControlAction}
              className={`h-10 rounded-sm text-xs font-semibold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed ${
                item.kind === 'lock'
                  ? 'bg-red-500/15 hover:bg-red-500/25 text-red-200'
                  : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {!canIssueCommands && (
          <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-sm px-3 py-2">
            Seu perfil esta em modo leitura para comandos de controle.
          </p>
        )}
      </div>

      {tokenPanel && (
        <CredentialPanel
          title={tokenPanel.title}
          description={tokenPanel.description}
          fields={tokenPanel.fields}
          onClose={() => setTokenPanel(null)}
        />
      )}

      {tokenHistory.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold uppercase text-sm tracking-wide">Historico de tokens</h3>
              <p className="text-xs text-zinc-500 mt-1">
                Reabra os ultimos tokens para copiar quando precisar.
              </p>
            </div>
            <button
              type="button"
              onClick={clearTokenHistory}
              className="text-xs uppercase tracking-wide px-3 py-2 rounded-sm bg-zinc-800 hover:bg-zinc-700"
            >
              Limpar
            </button>
          </div>
          <ul className="space-y-2">
            {tokenHistory.map((item) => (
              <li
                key={item.id}
                className="border border-zinc-800 rounded-sm px-3 py-2 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-zinc-500">
                    {item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : '-'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTokenPanel(item)}
                  className="text-xs uppercase tracking-wide px-3 py-2 rounded-sm bg-zinc-800 hover:bg-zinc-700"
                >
                  Abrir
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-sm">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3">
          <p className="text-zinc-500 text-xs uppercase">Janela ({summary?.window_minutes || filters.since_minutes} min)</p>
          <p className="text-2xl font-bold">{summary?.window?.total || 0}</p>
          <p className="text-[11px] text-zinc-400 mt-1">
            Liberados {summary?.window?.allow || 0} | Negados {summary?.window?.deny || 0}
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3">
          <p className="text-zinc-500 text-xs uppercase">Ultimas 24h</p>
          <p className="text-2xl font-bold">{summary?.last_24h?.total || 0}</p>
          <p className="text-[11px] text-zinc-400 mt-1">
            Negados {summary?.last_24h?.deny || 0}
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3">
          <p className="text-zinc-500 text-xs uppercase">Alunos em carencia</p>
          <p className="text-2xl font-bold text-blue-300">{summary?.grace_students || 0}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3">
          <p className="text-zinc-500 text-xs uppercase">Alunos bloqueados</p>
          <p className="text-2xl font-bold text-red-300">{summary?.blocked_students || 0}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3">
          <p className="text-zinc-500 text-xs uppercase">Dispositivos</p>
          <p className="text-2xl font-bold">{summary?.devices?.online_5m || 0}/{summary?.devices?.total || 0}</p>
          <p className="text-[11px] text-zinc-400 mt-1">Online nos ultimos 5 min</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3">
          <p className="text-zinc-500 text-xs uppercase">Falhas auth (1h)</p>
          <p className="text-2xl font-bold text-amber-300">{summary?.gateway_auth_failures_1h || 0}</p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
        <h2 className="font-semibold uppercase text-sm tracking-wide">Dispositivos</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3"
            placeholder="Nome do dispositivo"
          />
          <button
            onClick={createDevice}
            disabled={!canManageDevices}
            className="bg-[#ccff00] text-black font-bold text-xs uppercase tracking-wider px-4 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Criar
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {devices.map((device) => (
            <li key={device.device_id} className="border border-zinc-800 rounded-sm px-3 py-2 flex items-center justify-between gap-3">
              <div>
                <div>{device.device_id} - {device.name}</div>
                <div className="text-xs text-zinc-500">
                  Ultimo sinal: {device.last_seen_at ? formatDateTime(device.last_seen_at) : 'nunca'}
                  {device.blocked_until ? ` | Bloqueado ate ${formatDateTime(device.blocked_until)}` : ''}
                </div>
              </div>
              <button
                onClick={() => rotateToken(device.device_id)}
                disabled={!canManageDevices}
                className="bg-zinc-800 px-3 h-8 rounded-sm text-xs uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Rotacionar token
              </button>
            </li>
          ))}
          {devices.length === 0 && <li className="text-zinc-500">Nenhum dispositivo criado para este owner.</li>}
        </ul>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
        <h2 className="font-semibold uppercase text-sm tracking-wide">Filtros de acesso</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <select
            value={filters.decision}
            onChange={(e) => setFilters((prev) => ({ ...prev, decision: e.target.value }))}
            className="bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3 text-sm"
          >
            <option value="">Todas decisoes</option>
            <option value="allow">Somente liberados</option>
            <option value="deny">Somente negados</option>
          </select>
          <select
            value={filters.subject_type}
            onChange={(e) => setFilters((prev) => ({ ...prev, subject_type: e.target.value }))}
            className="bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3 text-sm"
          >
            <option value="">Todos perfis</option>
            <option value="student">Alunos</option>
            <option value="employee">Funcionarios</option>
            <option value="owner">Dono da academia</option>
          </select>
          <input
            value={filters.reason}
            onChange={(e) => setFilters((prev) => ({ ...prev, reason: e.target.value.trim().toLowerCase() }))}
            placeholder="Motivo (ex: turnstile_direction_locked)"
            className="bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3 text-sm"
          />
          <select
            value={filters.since_minutes}
            onChange={(e) => setFilters((prev) => ({ ...prev, since_minutes: Number(e.target.value) || 60 }))}
            className="bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3 text-sm"
          >
            <option value={15}>Ultimos 15 min</option>
            <option value={60}>Ultimos 60 min</option>
            <option value={180}>Ultimas 3 h</option>
            <option value={1440}>Ultimas 24 h</option>
          </select>
          <select
            value={filters.limit}
            onChange={(e) => setFilters((prev) => ({ ...prev, limit: Number(e.target.value) || 80 }))}
            className="bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3 text-sm"
          >
            <option value={50}>50 linhas</option>
            <option value={80}>80 linhas</option>
            <option value={120}>120 linhas</option>
            <option value={200}>200 linhas</option>
          </select>
        </div>
        {(summary?.deny_reasons || []).length > 0 && (
          <div className="text-xs text-zinc-400">
            Top motivos de negacao (24h):
            {' '}
            {summary.deny_reasons.map((item) => `${reasonLabel(item.reason)} (${item.count})`).join(' | ')}
          </div>
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <h2 className="font-semibold uppercase text-sm tracking-wide mb-2">Alertas operacionais</h2>
        <ul className="space-y-2 text-sm">
          {alerts.map((alert) => (
            <li key={alert.code} className="border border-amber-500/30 bg-amber-500/10 rounded-sm px-3 py-2">
              <span className="font-semibold mr-2">[{alert.severity}]</span>
              {alert.message}
            </li>
          ))}
          {alerts.length === 0 && <li className="text-zinc-500">Sem alertas no momento.</li>}
        </ul>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
        <div className="px-4 py-3 border-b border-zinc-800 font-semibold uppercase text-sm tracking-wide">Ultimos acessos</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
              <th className="text-left px-4 py-3">Data</th>
              <th className="text-left px-4 py-3">Pessoa</th>
              <th className="text-left px-4 py-3">Perfil</th>
              <th className="text-left px-4 py-3">Direcao</th>
              <th className="text-left px-4 py-3">Dispositivo</th>
              <th className="text-left px-4 py-3">Metodo</th>
              <th className="text-left px-4 py-3">Decisao</th>
              <th className="text-left px-4 py-3">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.access_id || `${log.created_at}-${log.credential_masked}`} className="border-b border-zinc-800/50">
                <td className="px-4 py-3 text-zinc-400">{formatDateTime(log.created_at || log.timestamp)}</td>
                <td className="px-4 py-3">
                  {log.subject_name || log.student_name || log.employee_name || log.owner_name || log.subject_id || '-'}
                </td>
                <td className="px-4 py-3">{subjectTypeLabel(log.subject_type)}</td>
                <td className="px-4 py-3">{directionLabel(log.direction)}</td>
                <td className="px-4 py-3 font-mono text-xs">{log.device_id || '-'}</td>
                <td className="px-4 py-3">{log.method || '-'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded-sm text-[11px] uppercase border ${decisionBadgeClass(log.decision)}`}>
                    {String(log.decision || '-').toLowerCase() === 'allow' ? 'Liberado' : 'Negado'}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-400">
                  <div>{reasonLabel(log.reason)}</div>
                  {extractReasonDetail(log) && <div className="text-[11px] text-zinc-500">{extractReasonDetail(log)}</div>}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-zinc-500">Sem acessos no filtro atual.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <h3 className="font-semibold uppercase text-sm tracking-wide mb-2">Historico de comandos</h3>
        <ul className="space-y-2 text-sm">
          {commands.map((command) => (
            <li key={command.cmd_id} className="border border-zinc-800 rounded-sm px-3 py-2">
              <div className="font-medium">{actionLabel(command.action)}</div>
              <div className="text-xs text-zinc-500">
                Escopo: {scopeLabel(command.target_scope)} | Status: {command.status || '-'} | {formatDateTime(command.created_at)}
              </div>
            </li>
          ))}
          {commands.length === 0 && <li className="text-zinc-500">Sem comandos.</li>}
        </ul>
      </div>
    </div>
  );
}
