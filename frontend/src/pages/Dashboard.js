import React, { Suspense, useEffect, useMemo, useState } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  DollarSign,
  ScanLine,
  Activity,
  FileSpreadsheet,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { api, connectWebSocket } from '../api';
import Banner from '../components/ui/Banner';
import Button from '../components/ui/Button';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import { getStoredUser } from '../lib/session';

// Lazy-load Recharts to keep the initial bundle lighter (~45 KB saved)
const DashboardCharts = React.lazy(() => import('./dashboard/DashboardCharts'));

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function isAllowedAccess(log) {
  if (typeof log?.autorizado === 'boolean') return log.autorizado;
  return String(log?.decision || '').toLowerCase() === 'allow';
}

function isCriticalDeny(log) {
  if (isAllowedAccess(log)) return false;
  const reason = String(log?.reason || log?.motivo || '').toLowerCase();
  return [
    'contract_access_blocked',
    'student_manual_block',
    'plan_expired',
    'academy_subscription_inactive',
  ].includes(reason);
}

function reasonLabel(value) {
  const key = String(value || '').toLowerCase();
  const labels = {
    ok: 'Acesso valido',
    biometry_required: 'Biometria obrigatoria',
    credential_required: 'Credencial obrigatoria',
    contract_access_blocked: 'Contrato bloqueado',
    student_manual_block: 'Bloqueio manual',
    plan_expired: 'Plano vencido',
    credential_not_found: 'Credencial nao encontrada',
    passage_without_authorization: 'Passagem sem credencial/autorizacao',
    academy_subscription_inactive: 'Assinatura da academia inativa',
  };
  return labels[key] || key || '-';
}

function DashboardCard({ label, value, hint, className = '' }) {
  return (
    <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4 shadow-[var(--shadow-soft)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-bold tabular-nums leading-none ${className}`}>{value}</p>
      <p className="mt-2 text-xs text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [billingOverview, setBillingOverview] = useState(null);
  const [opsAlerts, setOpsAlerts] = useState(null);
  const [turnstileSummary, setTurnstileSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [realtimeLogs, setRealtimeLogs] = useState([]);
  const [logFilter, setLogFilter] = useState('all');
  const [reconciling, setReconciling] = useState(false);
  const [summaryWindowMinutes, setSummaryWindowMinutes] = useState(() => {
    const stored = Number(localStorage.getItem('gymbro_dashboard_summary_window') || 60);
    if ([60, 180, 1440].includes(stored)) return stored;
    return 60;
  });

  const role = String(getStoredUser()?.role || '').toUpperCase();
  const canSeeFinancial = ['OWNER', 'MANAGER'].includes(role);
  const canSeeOps = ['OWNER', 'MANAGER'].includes(role);
  const canExportFinancial = ['OWNER', 'MANAGER'].includes(role);
  const canRunReconcile = ['OWNER', 'MANAGER'].includes(role);

  const loadData = React.useCallback(async ({ silent = false, summaryWindow = summaryWindowMinutes } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError('');
    }

    try {
      const [dashboardData, chartData, billingData, opsData, turnstileData] = await Promise.all([
        api.dashboard(),
        api.dashboardCharts(),
        canSeeOps ? api.studentBillingOverview().catch(() => null) : Promise.resolve(null),
        canSeeOps
          ? api
              .opsAlerts()
              .catch((err) => (err?.status === 403 ? null : Promise.reject(err)))
          : Promise.resolve(null),
        canSeeOps
          ? api
              .turnstileAccessSummary(summaryWindow)
              .catch((err) => (err?.status === 403 ? null : Promise.reject(err)))
          : Promise.resolve(null),
      ]);

      setStats(dashboardData || {});
      setCharts(chartData || {});
      setBillingOverview(billingData);
      setOpsAlerts(opsData);
      setTurnstileSummary(turnstileData);
      setLastUpdatedAt(new Date());
    } catch (err) {
      setError(err?.message || 'Nao foi possivel carregar o dashboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canSeeOps, summaryWindowMinutes]);

  useEffect(() => {
    loadData();
    const cleanup = connectWebSocket((msg) => {
      if (msg.type === 'access') {
        setRealtimeLogs((prev) => [msg.data, ...prev].slice(0, 10));
      }
    });
    const interval = setInterval(() => {
      loadData({ silent: true });
    }, 30000);
    return () => {
      clearInterval(interval);
      cleanup();
    };
  }, [loadData]);

  useEffect(() => {
    localStorage.setItem('gymbro_dashboard_summary_window', String(summaryWindowMinutes));
    loadData({ silent: true, summaryWindow: summaryWindowMinutes });
  }, [loadData, summaryWindowMinutes]);

  const runReconcile = async () => {
    if (!canRunReconcile) return;
    setReconciling(true);
    try {
      const response = await api.runStudentBillingReconcile(500);
      const summary = response?.summary || {};
      toast.success(
        `Reconciliacao concluida. Contratos atualizados: ${summary.contracts_updated || 0}, cobrancas vencidas: ${summary.charge_overdue_marked || 0}.`,
      );
      await loadData({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Falha ao rodar reconciliacao.');
    } finally {
      setReconciling(false);
    }
  };

  const denyRateWindow = useMemo(() => {
    const total = Number(turnstileSummary?.window?.total || 0);
    const denied = Number(turnstileSummary?.window?.deny || 0);
    if (!total) return 0;
    return Number(((denied / total) * 100).toFixed(1));
  }, [turnstileSummary]);

  const opsCards = useMemo(() => {
    return [
      {
        label: 'Negacoes na janela',
        value: Number(turnstileSummary?.window?.deny || 0),
        hint: `${denyRateWindow}% do volume`,
        className: 'text-[var(--status-danger-text)]',
      },
      {
        label: 'Alunos em graca',
        value: Number(turnstileSummary?.grace_students || 0),
        hint: 'Acesso liberado temporariamente',
        className: 'text-[var(--status-info-text)]',
      },
      {
        label: 'Alunos bloqueados',
        value: Number(turnstileSummary?.blocked_students || 0),
        hint: 'Sem liberacao de acesso',
        className: 'text-[var(--status-warning-text)]',
      },
      {
        label: 'Dispositivos bloqueados',
        value: Number(turnstileSummary?.devices?.blocked || 0),
        hint: `${Number(turnstileSummary?.devices?.online_5m || 0)}/${Number(turnstileSummary?.devices?.total || 0)} online (5m)`,
        className: 'text-[var(--status-warning-text)]',
      },
    ];
  }, [denyRateWindow, turnstileSummary]);

  const topDenyReasons = useMemo(() => {
    return (turnstileSummary?.deny_reasons || []).slice(0, 3);
  }, [turnstileSummary]);

  const kpis = useMemo(() => {
    const cards = [
      { icon: Users, label: 'Total Alunos', value: Number(stats?.total_alunos || 0), color: '#ccff00' },
      { icon: UserCheck, label: 'Ativos', value: Number(stats?.alunos_ativos || 0), color: '#22c55e' },
      { icon: UserX, label: 'Inativos', value: Number(stats?.alunos_inativos || 0), color: '#ef4444' },
      { icon: ScanLine, label: 'Acessos Hoje', value: Number(stats?.acessos_hoje || 0), color: '#a855f7' },
      { icon: Activity, label: 'Na Academia', value: Number(stats?.ocupacao_atual || 0), color: '#f59e0b' },
    ];

    if (canSeeFinancial) {
      cards.splice(3, 0, {
        icon: DollarSign,
        label: 'Faturamento',
        value: formatMoney(stats?.faturamento_mensal || 0),
        color: '#3b82f6',
      });
    } else {
      cards.splice(3, 0, {
        icon: FileText,
        label: 'Sem treino',
        value: Number(stats?.alunos_sem_treino || 0),
        color: '#f59e0b',
      });
    }

    return cards;
  }, [canSeeFinancial, stats]);

  const baseLogs = useMemo(
    () => (realtimeLogs.length > 0 ? realtimeLogs : stats?.ultimos_acessos || []),
    [realtimeLogs, stats?.ultimos_acessos]
  );
  const filteredLogs = useMemo(() => {
    if (logFilter === 'allowed') return baseLogs.filter((item) => isAllowedAccess(item));
    if (logFilter === 'denied') return baseLogs.filter((item) => !isAllowedAccess(item));
    if (logFilter === 'critical') return baseLogs.filter((item) => isCriticalDeny(item));
    return baseLogs;
  }, [baseLogs, logFilter]);

  if (loading) {
    return <LoadingScreen label="Carregando dashboard..." />;
  }

  if (error && !stats) {
    return (
      <Banner
        tone="danger"
        title="Falha ao carregar dashboard"
        description={error}
        actions={
          <Button onClick={() => loadData()} size="sm" variant="secondary">
            Tentar novamente
          </Button>
        }
      />
    );
  }

  return (
    <div data-testid="dashboard-page" className="space-y-6">
      <PageHeader
        eyebrow="Painel administrativo"
        title="Dashboard"
        subtitle={`Visao operacional da academia${lastUpdatedAt ? ` - atualizado as ${lastUpdatedAt.toLocaleTimeString('pt-BR')}` : ''}`}
        actions={
          <>
            <Button onClick={() => loadData({ silent: true })} size="sm">
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            {canRunReconcile ? (
              <Button onClick={runReconcile} disabled={reconciling} variant="ghost" size="sm">
                {reconciling ? 'Processando...' : 'Rodar reconciliacao'}
              </Button>
            ) : null}
            {canExportFinancial ? (
              <Button
                data-testid="export-financial-btn"
                onClick={() => {
                  api.exportFinancialExcel();
                  toast.success('Exportando financeiro...');
                }}
                size="sm"
              >
                <FileSpreadsheet className="w-4 h-4 text-green-500" />
                Financeiro
              </Button>
            ) : null}
            <Button
              data-testid="export-students-pdf-btn"
              onClick={() => {
                api.exportStudentsPdf();
                toast.success('Exportando PDF...');
              }}
              size="sm"
            >
              <FileText className="w-4 h-4 text-[var(--status-danger)]" />
              Alunos PDF
            </Button>
            <Button onClick={() => navigate('/admin/contratos')} size="sm" variant="ghost">
              Contratos
            </Button>
            <Button onClick={() => navigate('/admin/catraca')} size="sm" variant="ghost">
              Catraca
            </Button>
          </>
        }
      />

      {error ? <Banner tone="warning" title="Atualizacao parcial" description={error} /> : null}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
        {kpis.map((kpi, index) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            data-testid={`kpi-card-${index}`}
          >
            <StatCard label={kpi.label} value={kpi.value} icon={kpi.icon} className="hover:border-[var(--surface-border-strong)]" />
          </motion.div>
        ))}
      </div>

      {canSeeOps && billingOverview && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            label="Contratos em atraso"
            value={Number(billingOverview.past_due_contracts || 0)}
            icon={UserX}
            accent={billingOverview.past_due_contracts > 0 ? 'danger' : 'default'}
            hint="Contratos com cobrancas vencidas"
          />
          <StatCard
            label="Cobrancas vencidas"
            value={Number(billingOverview.overdue_charges || 0)}
            icon={DollarSign}
            accent={billingOverview.overdue_charges > 0 ? 'warning' : 'default'}
            hint="Titulos nao pagos no prazo"
          />
          <StatCard
            label="Expiram em 7 dias"
            value={Number(billingOverview.expiring_next_7d || 0)}
            icon={Activity}
            accent={billingOverview.expiring_next_7d > 0 ? 'info' : 'default'}
            hint="Requerem renovacao breve"
          />
        </div>
      )}

      {canSeeOps && turnstileSummary && (
        <SectionCard title="Saude operacional de acesso" description="Janela configuravel de negacoes, bloqueios e sinais de dispositivos.">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Janela</label>
              <select
                value={summaryWindowMinutes}
                onChange={(event) => setSummaryWindowMinutes(Number(event.target.value) || 60)}
                className="h-8 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-2 text-xs text-[var(--text-primary)]"
              >
                <option value={60}>60 min</option>
                <option value={180}>3h</option>
                <option value={1440}>24h</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {opsCards.map((card) => (
              <DashboardCard key={card.label} label={card.label} value={card.value} hint={card.hint} className={card.className} />
            ))}
          </div>
          {topDenyReasons.length > 0 && (
            <div className="text-xs text-[var(--text-secondary)]">
              Principais motivos de negacao:
              {' '}
              {topDenyReasons.map((item) => `${reasonLabel(item.reason)} (${item.count})`).join(' | ')}
            </div>
          )}
        </SectionCard>
      )}

      {canSeeOps && (
        <SectionCard title="Alertas operacionais" description="Eventos com impacto direto em acesso, contratos e operacao da academia.">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              {opsAlerts?.generated_at ? `Gerado em ${new Date(opsAlerts.generated_at).toLocaleString('pt-BR')}` : 'Sem dados'}
            </p>
          </div>
          {opsAlerts?.alerts?.length ? (
            <div className="space-y-2">
              {opsAlerts.alerts.map((alert) => (
                <div
                  key={alert.code}
                  className={`rounded-xl border px-3 py-2.5 text-sm ${
                    alert.severity === 'high'
                      ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)]'
                      : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]'
                  }`}
                >
                  <p className="font-semibold">{alert.code}</p>
                  <p className="text-xs mt-0.5">{alert.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">Sem alertas criticos no momento.</p>
          )}
        </SectionCard>
      )}

      <Suspense fallback={<div className="h-52 flex items-center justify-center text-[var(--text-muted)] text-sm">Carregando graficos...</div>}>
        <DashboardCharts charts={charts} canSeeFinancial={canSeeFinancial} />
      </Suspense>

      <SectionCard title="Ultimos acessos" description="Atualizacao em tempo real quando o websocket estiver disponivel." bodyClassName="p-0">
        <div className="flex flex-col gap-3 border-b border-[var(--surface-border)] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <Button
              onClick={() => setLogFilter('all')}
              variant={logFilter === 'all' ? 'primary' : 'secondary'}
              size="sm"
            >
              Todos
            </Button>
            <Button
              onClick={() => setLogFilter('allowed')}
              variant={logFilter === 'allowed' ? 'primary' : 'secondary'}
              size="sm"
            >
              Liberados
            </Button>
            <Button
              onClick={() => setLogFilter('denied')}
              variant={logFilter === 'denied' ? 'primary' : 'secondary'}
              size="sm"
            >
              Negados
            </Button>
            <Button
              onClick={() => setLogFilter('critical')}
              variant={logFilter === 'critical' ? 'danger' : 'secondary'}
              size="sm"
            >
              Criticos
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table data-testid="recent-access-table" className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-muted)] text-xs uppercase tracking-wider border-b border-[var(--surface-border)]">
                <th className="text-left px-5 py-3 font-medium">Pessoa</th>
                <th className="text-left px-5 py-3 font-medium">Tipo</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Horario</th>
                <th className="text-left px-5 py-3 font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, index) => {
                const allowed = isAllowedAccess(log);
                const critical = isCriticalDeny(log);
                return (
                  <tr
                    key={`${log.log_id || log.access_id || 'log'}-${index}`}
                    className={`border-b border-[var(--surface-border)] transition-colors ${
                      critical ? 'bg-[var(--status-danger-bg)] hover:brightness-125' : 'hover:bg-[var(--surface-soft)]'
                    }`}
                  >
                    <td className="px-5 py-3 font-medium">{log.student_name || log.employee_name || 'Desconhecido'}</td>
                    <td className="px-5 py-3">
                      <StatusBadge label={log.tipo || log.method || log.subject_type || '-'} tone="neutral" size="sm" />
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-sm border ${
                          allowed
                            ? 'bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-border)]'
                            : 'bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border-[var(--status-danger-border)]'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${allowed ? 'bg-[var(--status-success)]' : 'bg-[var(--status-danger)]'}`} />
                        {allowed ? 'Liberado' : 'Negado'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">
                      {log.timestamp || log.created_at
                        ? new Date(log.timestamp || log.created_at).toLocaleString('pt-BR')
                        : '-'}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)] text-xs">{reasonLabel(log.motivo || log.reason)}</td>
                  </tr>
                );
              })}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-[var(--text-muted)]">
                    Nenhum acesso no filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
