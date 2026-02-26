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

const REASON_LABELS = {
  ok: 'Acesso valido',
  credential_not_found: 'Credencial nao encontrada',
  student_not_found: 'Aluno nao encontrado',
  student_inactive: 'Aluno inativo',
  student_manual_block: 'Bloqueio manual',
  student_blocked_until: 'Bloqueio temporario',
  outside_allowed_weekday: 'Dia fora da regra',
  outside_allowed_time: 'Horario fora da regra',
  plan_expired: 'Plano vencido',
  contract_access_blocked: 'Contrato bloqueado',
  employee_not_found: 'Funcionario nao encontrado',
  employee_inactive: 'Funcionario inativo',
  employee_manual_block: 'Bloqueio manual funcionario',
  employee_blocked_until: 'Bloqueio temporario funcionario',
  employee_outside_allowed_weekday: 'Dia fora da regra funcionario',
  employee_outside_allowed_time: 'Horario fora da regra funcionario',
  academy_subscription_inactive: 'Assinatura da academia inativa',
};
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
    return `Periodo de graca ate ${formatDateTime(detail.grace_until)}.`;
  }
  if (detail.blocked_until) {
    return `Bloqueado ate ${formatDateTime(detail.blocked_until)}.`;
  }
  return '';
}

export default function CatracaPage() {
  const user = useMemo(() => JSON.parse(localStorage.getItem('gymbro_user') || '{}'), []);
  const role = String(user.role || '').toUpperCase();
  const canManageDevices = ['OWNER', 'MANAGER'].includes(role);
  const canIssueCommands = ['OWNER', 'MANAGER'].includes(role);
  const canViewOpsAlerts = ['OWNER', 'MANAGER'].includes(role);

  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [commands, setCommands] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [deviceName, setDeviceName] = useState('Gateway Toletus');
  const [loading, setLoading] = useState(true);
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
      const [cmds, access, devs, summaryData, opsAlerts] = await Promise.all([
        api.catracaCommands().catch(() => []),
        api.listTurnstileAccessLogs(filters),
        api.listTurnstileDevices(),
        api.turnstileAccessSummary(filters.since_minutes || 60),
        canViewOpsAlerts ? api.opsAlerts().catch(() => ({ alerts: [] })) : Promise.resolve({ alerts: [] }),
      ]);
      setCommands(cmds || []);
      setLogs(access || []);
      setDevices(devs || []);
      setSummary(summaryData || null);
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
      toast.error('Somente OWNER/MANAGER pode criar dispositivo.');
      return;
    }
    try {
      const created = await api.createTurnstileDevice({ name: deviceName });
      toast.success('Dispositivo criado.');
      openTokenPanel({
        title: `Token do dispositivo ${created.device_id}`,
        description: 'Copie e guarde. O token so aparece no momento da criacao/rotacao.',
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

  const sendCommand = async (action) => {
    if (!canIssueCommands) {
      toast.error('Somente OWNER/MANAGER pode enviar comandos.');
      return;
    }
    try {
      await api.catracaCommand({ action, message: '' });
      toast.success(`Comando ${action} enviado.`);
      load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Erro ao enviar comando.');
    }
  };

  const rotateToken = async (deviceId) => {
    if (!canManageDevices) {
      toast.error('Somente OWNER/MANAGER pode rotacionar token.');
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Catraca</h1>
          <p className="text-zinc-400 mt-1">
            Operacao em tempo real com foco em acesso, grace period e saude do gateway.
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

      {!canManageDevices && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-md px-4 py-3 text-sm text-blue-200">
          Perfil em modo leitura operacional. Criacao de dispositivo, rotacao de token e comandos exigem OWNER/MANAGER.
        </div>
      )}

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
          <p className="text-zinc-500 text-xs uppercase">Alunos em graca</p>
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
                  Ultimo seen: {device.last_seen_at ? formatDateTime(device.last_seen_at) : 'nunca'}
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
          </select>
          <input
            value={filters.reason}
            onChange={(e) => setFilters((prev) => ({ ...prev, reason: e.target.value.trim().toLowerCase() }))}
            placeholder="Motivo (ex: contract_access_blocked)"
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

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <h2 className="font-semibold uppercase text-sm tracking-wide mb-3">Comandos rapidos</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => sendCommand('release_entry')}
            disabled={!canIssueCommands}
            className="bg-zinc-800 px-4 h-10 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Liberar entrada
          </button>
          <button
            onClick={() => sendCommand('release_exit')}
            disabled={!canIssueCommands}
            className="bg-zinc-800 px-4 h-10 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Liberar saida
          </button>
          <button
            onClick={() => sendCommand('block')}
            disabled={!canIssueCommands}
            className="bg-zinc-800 px-4 h-10 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Bloquear
          </button>
        </div>
        <div className="mt-3 text-xs text-zinc-500">Comandos locais legados para o agente da catraca.</div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
        <div className="px-4 py-3 border-b border-zinc-800 font-semibold uppercase text-sm tracking-wide">Ultimos acessos</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
              <th className="text-left px-4 py-3">Data</th>
              <th className="text-left px-4 py-3">Tipo</th>
              <th className="text-left px-4 py-3">ID</th>
              <th className="text-left px-4 py-3">Dispositivo</th>
              <th className="text-left px-4 py-3">Metodo</th>
              <th className="text-left px-4 py-3">Decisao</th>
              <th className="text-left px-4 py-3">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.access_id || `${log.created_at}-${log.credential}`} className="border-b border-zinc-800/50">
                <td className="px-4 py-3 text-zinc-400">{formatDateTime(log.created_at)}</td>
                <td className="px-4 py-3">{log.subject_type || '-'}</td>
                <td className="px-4 py-3 font-mono text-xs">{log.subject_id || '-'}</td>
                <td className="px-4 py-3 font-mono text-xs">{log.device_id || '-'}</td>
                <td className="px-4 py-3">{log.method || '-'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded-sm text-[11px] uppercase border ${decisionBadgeClass(log.decision)}`}>
                    {log.decision || '-'}
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
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">Sem acessos no filtro atual.</td>
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
              {command.action} - {command.status} - {formatDateTime(command.created_at)}
            </li>
          ))}
          {commands.length === 0 && <li className="text-zinc-500">Sem comandos.</li>}
        </ul>
      </div>
    </div>
  );
}
