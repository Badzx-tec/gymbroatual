import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock3,
  Lock,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import CredentialPanel from '../components/CredentialPanel';
import Banner from '../components/ui/Banner';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SectionCard from '../components/ui/SectionCard';
import SelectField from '../components/ui/SelectField';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import TextField from '../components/ui/TextField';
import {
  clearCredentialHistory,
  loadCredentialHistory,
  pushCredentialHistory,
} from '../utils/credentialHistory';
import { getStoredUser } from '../lib/session';
import { SAO_PAULO_TIME_ZONE } from '../utils/timezone';

import CatracaAccessHistory from './catraca/CatracaAccessHistory';
import {
  CATRACA_TOKEN_HISTORY_KEY,
  CONTROL_ACTIONS,
  CONTROL_SCOPE_OPTIONS,
  actionLabel,
  formatDateTime,
  isRecent,
  matchesAccessSearch,
  normalizeControlState,
  scopeLabel,
} from './catraca/catracaUtils';

export default function CatracaPage() {
  const user = useMemo(() => getStoredUser(), []);
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
  const [refreshing, setRefreshing] = useState(false);
  const [executingControlAction, setExecutingControlAction] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [tokenPanel, setTokenPanel] = useState(null);
  const [tokenHistory, setTokenHistory] = useState(() =>
    loadCredentialHistory(CATRACA_TOKEN_HISTORY_KEY)
  );
  const [accessSearch, setAccessSearch] = useState('');
  const [filters, setFilters] = useState({
    limit: 80,
    decision: '',
    subject_type: '',
    reason: '',
    since_minutes: 60,
  });
  const [manualReleaseSearch, setManualReleaseSearch] = useState('');
  const [manualReleaseCandidates, setManualReleaseCandidates] = useState([]);
  const [manualReleaseLoading, setManualReleaseLoading] = useState(false);
  const [manualReleaseSelectedStudent, setManualReleaseSelectedStudent] = useState(null);
  const [manualReleaseReason, setManualReleaseReason] = useState('');
  const [manualReleaseSubmitting, setManualReleaseSubmitting] = useState(false);
  const [quickReleaseSubmitting, setQuickReleaseSubmitting] = useState(false);

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

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

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
      setLoading(false);
      setRefreshing(false);
    }
  }, [canViewOpsAlerts, filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => {
      load({ silent: true });
    }, 8000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    let active = true;
    const term = manualReleaseSearch.trim();

    if (!term) {
      setManualReleaseCandidates([]);
      setManualReleaseLoading(false);
      return () => {
        active = false;
      };
    }

    setManualReleaseLoading(true);
    const handle = setTimeout(async () => {
      try {
        const result = await api.listStudents(term, '');
        if (active) {
          setManualReleaseCandidates(Array.isArray(result) ? result : []);
        }
      } catch (err) {
        if (active) {
          setManualReleaseCandidates([]);
          toast.error(err?.message || 'Falha ao buscar alunos para liberacao manual.');
        }
      } finally {
        if (active) setManualReleaseLoading(false);
      }
    }, 280);

    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [manualReleaseSearch]);

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
        description: 'Copie e guarde. O token aparece somente na criacao ou rotacao.',
        fields: [
          { label: 'Device ID', value: created.device_id },
          { label: 'Device token', value: created.token },
        ],
      });
      setDeviceName('Gateway Toletus');
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

  const submitManualRelease = async (direction) => {
    if (!canIssueCommands) {
      toast.error('Seu perfil nao pode liberar acesso manualmente.');
      return;
    }
    if (!manualReleaseSelectedStudent?.student_id) {
      toast.error('Selecione um aluno antes de liberar a catraca.');
      return;
    }
    const reason = manualReleaseReason.trim();
    if (!reason) {
      toast.error('Informe o motivo operacional.');
      return;
    }

    setManualReleaseSubmitting(true);
    try {
      await api.turnstileManualRelease({
        student_id: manualReleaseSelectedStudent.student_id,
        student_name: manualReleaseSelectedStudent.nome || manualReleaseSelectedStudent.name || '',
        direction,
        reason,
        source: 'frontend_operational_manual_release',
      });
      toast.success(
        `${direction === 'entry' ? 'Liberacao de entrada' : 'Liberacao de saida'} solicitada para ${manualReleaseSelectedStudent.nome || manualReleaseSelectedStudent.name || manualReleaseSelectedStudent.student_id}.`
      );
      setManualReleaseReason('');
      setManualReleaseSearch('');
      setManualReleaseCandidates([]);
      setManualReleaseSelectedStudent(null);
      await load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Falha ao solicitar liberacao manual.');
    } finally {
      setManualReleaseSubmitting(false);
    }
  };

  const submitQuickRelease = async (direction) => {
    if (!canIssueCommands) {
      toast.error('Seu perfil nao pode liberar acesso manualmente.');
      return;
    }

    setQuickReleaseSubmitting(true);
    try {
      await api.turnstileQuickRelease({
        direction,
        source: 'frontend_operational_quick_release',
      });
      toast.success(
        `${direction === 'entry' ? 'Liberacao rapida de entrada' : 'Liberacao rapida de saida'} enviada para a catraca.`
      );
      await load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Falha ao solicitar liberacao rapida.');
    } finally {
      setQuickReleaseSubmitting(false);
    }
  };

  const normalizedControl = useMemo(() => normalizeControlState(controlState), [controlState]);

  const visibleLogs = useMemo(() => {
    const normalizedSearch = accessSearch.trim().toLowerCase();
    return logs.filter((log) => matchesAccessSearch(log, normalizedSearch));
  }, [accessSearch, logs]);

  const summaryCards = useMemo(
    () => [
      {
        label: `Janela (${summary?.window_minutes || filters.since_minutes} min)`,
        value: summary?.window?.total || 0,
        hint: `Liberados ${summary?.window?.allow || 0} | Negados ${summary?.window?.deny || 0}`,
        icon: Activity,
      },
      {
        label: 'Ultimas 24h',
        value: summary?.last_24h?.total || 0,
        hint: `Negados ${summary?.last_24h?.deny || 0}`,
        accent: 'info',
        icon: Clock3,
      },
      {
        label: 'Alunos em carencia',
        value: summary?.grace_students || 0,
        hint: 'Acesso ainda permitido temporariamente',
        accent: 'warning',
        icon: ShieldAlert,
      },
      {
        label: 'Alunos bloqueados',
        value: summary?.blocked_students || 0,
        hint: 'Sem liberacao de acesso',
        accent: 'danger',
        icon: Lock,
      },
      {
        label: 'Dispositivos online',
        value: `${summary?.devices?.online_5m || 0}/${summary?.devices?.total || 0}`,
        hint: 'Ultimos 5 minutos',
        accent: 'success',
        icon: Wifi,
      },
      {
        label: 'Falhas de auth (1h)',
        value: summary?.gateway_auth_failures_1h || 0,
        hint: 'Monitoramento do gateway',
        accent: 'warning',
        icon: AlertTriangle,
      },
    ],
    [filters.since_minutes, summary]
  );

  if (loading) {
    return <LoadingScreen label="Carregando catraca..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operacao"
        title="Catraca"
        subtitle="Controle direcional, dispositivos, acessos recentes e incidentes em uma unica superficie operacional."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => load({ silent: true })}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            {tokenHistory.length > 0 ? (
              <Button size="sm" variant="secondary" onClick={clearTokenHistory}>
                Limpar tokens
              </Button>
            ) : null}
          </>
        }
      />

      {!canIssueCommands ? (
        <Banner
          tone="warning"
          title="Modo leitura"
          description="Seu perfil consegue acompanhar acessos, mas nao pode enviar comandos de bloqueio para a catraca."
        />
      ) : (
        <Banner
          tone="info"
          title="Sincronizacao automatica"
          description="A tela atualiza em segundo plano a cada 8 segundos para manter a leitura operacional consistente."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {summaryCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            hint={card.hint}
            accent={card.accent}
            icon={card.icon}
          />
        ))}
      </div>

      <SectionCard
        title="Controle direcional"
        description="Travamento persistente por direcao e perfil, aplicado no backend e refletido imediatamente na operacao."
        actions={
          <div className="w-full sm:w-[220px]">
            <SelectField
              label="Escopo"
              value={controlScope}
              onChange={(event) => setControlScope(event.target.value)}
            >
              {CONTROL_SCOPE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </SelectField>
          </div>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
            {[
              { key: 'student', label: 'Alunos' },
              { key: 'employee', label: 'Funcionarios' },
              { key: 'owner', label: 'Dono da academia' },
            ].map((row) => {
              const state = normalizedControl[row.key];
              return (
                <div key={row.key} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-soft)] p-4">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{row.label}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusBadge
                      label={`Entrada ${state.entry_locked ? 'travada' : 'liberada'}`}
                      tone={state.entry_locked ? 'danger' : 'success'}
                    />
                    <StatusBadge
                      label={`Saida ${state.exit_locked ? 'travada' : 'liberada'}`}
                      tone={state.exit_locked ? 'danger' : 'success'}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CONTROL_ACTIONS.map((item) => (
              <Button
                key={item.key}
                variant={item.kind === 'lock' ? 'danger' : 'secondary'}
                className="h-auto min-h-[54px] w-full justify-between rounded-2xl px-4 py-3 normal-case tracking-[0.08em]"
                onClick={() => runControlAction(item.key)}
                disabled={!canIssueCommands || executingControlAction}
              >
                <span>{item.label}</span>
                {item.kind === 'lock' ? <Lock className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              </Button>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Liberacao manual assistida por aluno"
        description="Fluxo auditavel para casos assistidos por aluno. Mantem selecao do cadastro e justificativa obrigatoria."
      >
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-3">
            <SearchInput
              value={manualReleaseSearch}
              onChange={(event) => setManualReleaseSearch(event.target.value)}
              placeholder="Buscar aluno para liberacao manual"
              aria-label="Buscar aluno para liberacao manual"
            />
            <p className="text-xs text-[var(--text-muted)]">
              Digite nome, matricula ou parte do cadastro. Este fluxo continua separado da liberacao rapida e do controle global da catraca.
            </p>
            <div className="max-h-72 space-y-2 overflow-auto pr-1">
              {manualReleaseLoading ? (
                <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 text-sm text-[var(--text-muted)]">
                  Buscando alunos...
                </div>
              ) : manualReleaseSearch.trim() ? (
                manualReleaseCandidates.length > 0 ? (
                  manualReleaseCandidates.map((student) => {
                    const selected = manualReleaseSelectedStudent?.student_id === student.student_id;
                    return (
                      <button
                        key={student.student_id}
                        type="button"
                        onClick={() => setManualReleaseSelectedStudent(student)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                          selected
                            ? 'border-[color:rgb(var(--brand-primary-rgb)/0.55)] bg-[color:rgb(var(--brand-primary-rgb)/0.10)]'
                            : 'border-[var(--surface-border)] bg-[var(--surface-card-bg)] hover:border-[var(--surface-border-strong)]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-[var(--text-primary)]">{student.nome || student.name || student.student_id}</p>
                          <span className="rounded-md border border-[var(--surface-border-strong)] px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                            {student.student_id}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {student.status ? `Status: ${student.status}` : 'Cadastro encontrado'} |{' '}
                          {student.biometria_id || student.biometry_id ? 'Biometria cadastrada' : 'Sem biometria cadastrada'}
                        </p>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 text-sm text-[var(--text-muted)]">
                    Nenhum aluno encontrado para o termo informado.
                  </div>
                )
              ) : (
                <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 text-sm text-[var(--text-muted)]">
                  Comece a digitar para localizar o aluno da liberacao manual.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4">
            {manualReleaseSelectedStudent ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {manualReleaseSelectedStudent.nome || manualReleaseSelectedStudent.name || manualReleaseSelectedStudent.student_id}
                </p>
                <p className="text-xs text-[var(--text-muted)]">Aluno: {manualReleaseSelectedStudent.student_id}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {manualReleaseSelectedStudent.status ? `Status: ${manualReleaseSelectedStudent.status}` : 'Status nao informado'}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {manualReleaseSelectedStudent.biometria_id || manualReleaseSelectedStudent.biometry_id
                    ? 'Biometria cadastrada'
                    : 'Sem biometria cadastrada'}
                </p>
              </div>
            ) : (
              <EmptyState
                icon={ScanLine}
                title="Selecione um aluno"
                description="A liberacao manual so fica disponivel depois que um aluno for escolhido."
              />
            )}

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Motivo operacional</span>
              <textarea
                value={manualReleaseReason}
                onChange={(event) => setManualReleaseReason(event.target.value)}
                placeholder="Ex.: aluno sem biometria no atendimento presencial"
                rows={4}
                className="min-h-[110px] w-full rounded-md border border-[var(--surface-border)] bg-[var(--surface-base)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
              />
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => submitManualRelease('entry')}
                disabled={
                  !canIssueCommands
                  || manualReleaseSubmitting
                  || !manualReleaseSelectedStudent
                  || !manualReleaseReason.trim()
                }
              >
                Liberar entrada
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => submitManualRelease('exit')}
                disabled={
                  !canIssueCommands
                  || manualReleaseSubmitting
                  || !manualReleaseSelectedStudent
                  || !manualReleaseReason.trim()
                }
              >
                Liberar saida
              </Button>
            </div>

            <p className="text-xs text-[var(--text-muted)]">
              Cada liberacao assistida continua exigindo justificativa e fica auditada na semantica operacional de {SAO_PAULO_TIME_ZONE}.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Liberacao rapida"
        description="Fluxo operacional imediato, sem aluno e sem justificativa obrigatoria. Continua auditavel com operador, horario, dispositivo e origem."
      >
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div className="space-y-2">
            <p className="text-sm text-[var(--text-secondary)]">
              Use este atalho quando a operacao precisar apenas comandar a catraca agora, sem vincular aluno.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              O comando segue com origem explicita, direcao e horario operacional em {SAO_PAULO_TIME_ZONE}.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => submitQuickRelease('entry')}
              disabled={!canIssueCommands || quickReleaseSubmitting}
            >
              Liberar entrada
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => submitQuickRelease('exit')}
              disabled={!canIssueCommands || quickReleaseSubmitting}
            >
              Liberar saida
            </Button>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <SectionCard
          title="Dispositivos"
          description="Gateways cadastrados, ultimo sinal e rotacao controlada de token."
          actions={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <TextField
                label=""
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                placeholder="Nome do dispositivo"
                className="min-w-[240px]"
              />
              <Button variant="primary" onClick={createDevice} disabled={!canManageDevices}>
                Criar dispositivo
              </Button>
            </div>
          }
        >
          {devices.length > 0 ? (
            <div className="space-y-3">
              {devices.map((device) => {
                const online = isRecent(device.last_seen_at, 5);
                return (
                  <div
                    key={device.device_id}
                    className="flex flex-col gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{device.name}</p>
                        <StatusBadge label={online ? 'Online' : 'Offline'} tone={online ? 'success' : 'warning'} />
                        {device.blocked_until ? <StatusBadge label="Bloqueado" tone="danger" /> : null}
                      </div>
                      <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">{device.device_id}</p>
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        Ultimo sinal: {device.last_seen_at ? formatDateTime(device.last_seen_at) : 'nunca'}
                      </p>
                      {device.blocked_until ? (
                        <p className="text-xs text-[var(--status-danger-text)]">Bloqueado ate {formatDateTime(device.blocked_until)}</p>
                      ) : null}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => rotateToken(device.device_id)} disabled={!canManageDevices}>
                      Rotacionar token
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Wifi}
              title="Nenhum dispositivo cadastrado"
              description="Crie o primeiro gateway para receber comandos, sinais de vida e eventos de acesso."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Historico de tokens"
          description="Reabra o ultimo token criado ou rotacionado sem depender de alerta temporario."
        >
          {tokenHistory.length > 0 ? (
            <div className="space-y-3">
              {tokenHistory.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{item.title}</p>
                    <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">
                      {item.created_at ? formatDateTime(item.created_at) : '-'}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setTokenPanel(item)}>
                    Abrir token
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ScanLine}
              title="Sem tokens recentes"
              description="Tokens novos aparecem aqui quando voce cria um dispositivo ou faz rotacao manual."
            />
          )}
        </SectionCard>
      </div>

      <CatracaAccessHistory
        visibleLogs={visibleLogs}
        filters={filters}
        setFilters={setFilters}
        accessSearch={accessSearch}
        setAccessSearch={setAccessSearch}
        selectedLog={selectedLog}
        setSelectedLog={setSelectedLog}
      />

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard title="Alertas operacionais" description="Leitura rapida de incidentes vindos da camada operacional do backend.">
          {alerts.length > 0 ? (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.code}
                  className="rounded-2xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-4 text-sm text-[var(--status-warning-text)]"
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge label={alert.severity || 'info'} tone="warning" />
                    <p className="font-semibold">{alert.code}</p>
                  </div>
                  <p className="mt-2 text-sm text-[var(--status-warning-text)]">{alert.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="Sem alertas operacionais"
              description="Nenhum sinal critico foi emitido pela camada de operacao neste momento."
            />
          )}
        </SectionCard>

        <SectionCard title="Historico de comandos" description="Ultimas acoes enviadas para bloqueio, desbloqueio e controle do fluxo.">
          {commands.length > 0 ? (
            <div className="space-y-3">
              {commands.map((command) => (
                <div
                  key={command.cmd_id}
                  className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-soft)] px-4 py-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{actionLabel(command.action)}</p>
                    <StatusBadge label={scopeLabel(command.target_scope)} tone="neutral" />
                    <StatusBadge label={command.status || 'pendente'} tone="info" />
                  </div>
                  <p className="mt-2 font-mono text-xs text-[var(--text-muted)]">{formatDateTime(command.created_at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="Sem comandos recentes"
              description="Os comandos enviados para travar ou destravar a catraca passam a aparecer aqui."
            />
          )}
        </SectionCard>
      </div>

      {tokenPanel ? (
        <CredentialPanel
          title={tokenPanel.title}
          description={tokenPanel.description}
          fields={tokenPanel.fields}
          onClose={() => setTokenPanel(null)}
        />
      ) : null}

    </div>
  );
}
