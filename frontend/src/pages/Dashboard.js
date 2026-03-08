import React, { useEffect, useMemo, useState } from 'react';
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';
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

const CHART_COLORS = ['var(--brand-primary)', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444'];

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
    contract_access_blocked: 'Contrato bloqueado',
    student_manual_block: 'Bloqueio manual',
    plan_expired: 'Plano vencido',
    credential_not_found: 'Credencial nao encontrada',
    academy_subscription_inactive: 'Assinatura da academia inativa',
  };
  return labels[key] || key || '-';
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
        className: 'text-red-300',
      },
      {
        label: 'Alunos em graca',
        value: Number(turnstileSummary?.grace_students || 0),
        hint: 'Acesso liberado temporariamente',
        className: 'text-blue-300',
      },
      {
        label: 'Alunos bloqueados',
        value: Number(turnstileSummary?.blocked_students || 0),
        hint: 'Sem liberacao de acesso',
        className: 'text-amber-300',
      },
      {
        label: 'Dispositivos bloqueados',
        value: Number(turnstileSummary?.devices?.blocked || 0),
        hint: `${Number(turnstileSummary?.devices?.online_5m || 0)}/${Number(turnstileSummary?.devices?.total || 0)} online (5m)`,
        className: 'text-yellow-300',
      },
    ];
  }, [denyRateWindow, turnstileSummary]);

  const topDenyReasons = useMemo(() => {
    return (turnstileSummary?.deny_reasons || []).slice(0, 3);
  }, [turnstileSummary]);

  const kpis = useMemo(
    () => [
      { icon: Users, label: 'Total Alunos', value: Number(stats?.total_alunos || 0), color: '#ccff00' },
      { icon: UserCheck, label: 'Ativos', value: Number(stats?.alunos_ativos || 0), color: '#22c55e' },
      { icon: UserX, label: 'Inativos', value: Number(stats?.alunos_inativos || 0), color: '#ef4444' },
      {
        icon: DollarSign,
        label: 'Faturamento',
        value: formatMoney(stats?.faturamento_mensal || 0),
        color: '#3b82f6',
      },
      { icon: ScanLine, label: 'Acessos Hoje', value: Number(stats?.acessos_hoje || 0), color: '#a855f7' },
      { icon: Activity, label: 'Na Academia', value: Number(stats?.ocupacao_atual || 0), color: '#f59e0b' },
    ],
    [stats]
  );

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

  const customTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-soft)] px-3 py-2 text-xs shadow-[var(--shadow-soft)]">
        <p className="mb-1 text-[var(--text-primary)]">{label}</p>
        {payload.map((item, index) => (
          <p key={`${item?.name || 'item'}-${index}`} style={{ color: item.color || 'var(--brand-primary)' }}>
            {item.name}: {typeof item.value === 'number' ? item.value.toLocaleString('pt-BR') : item.value}
          </p>
        ))}
      </div>
    );
  };

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
              <FileText className="w-4 h-4 text-red-400" />
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
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4 shadow-[var(--shadow-soft)]">
            <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider">Contratos em atraso</p>
            <p className="text-2xl font-bold mt-1">{Number(billingOverview.past_due_contracts || 0)}</p>
          </div>
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4 shadow-[var(--shadow-soft)]">
            <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider">Cobrancas vencidas</p>
            <p className="text-2xl font-bold mt-1">{Number(billingOverview.overdue_charges || 0)}</p>
          </div>
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4 shadow-[var(--shadow-soft)]">
            <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider">Expiram em 7 dias</p>
            <p className="text-2xl font-bold mt-1">{Number(billingOverview.expiring_next_7d || 0)}</p>
          </div>
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
              <div key={card.label} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] p-3">
                <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{card.label}</p>
                <p className={`text-2xl font-bold mt-1 ${card.className}`}>{card.value}</p>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">{card.hint}</p>
              </div>
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
                  className={`border rounded-sm px-3 py-2 text-sm ${
                    alert.severity === 'high'
                      ? 'border-red-500/30 bg-red-500/10 text-red-200'
                      : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-5 shadow-[var(--shadow-soft)] lg:col-span-1">
          <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
            Receita por Plano
          </h3>
          {(charts?.receita_por_plano || []).length > 0 ? (
            <>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={charts?.receita_por_plano || []}
                      dataKey="valor"
                      nameKey="plano"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={3}
                    >
                      {(charts?.receita_por_plano || []).map((_, index) => (
                        <Cell key={`slice-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={customTooltip} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {(charts?.receita_por_plano || []).map((item, index) => (
                  <div key={`${item.plano}-${index}`} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                    />
                    {item.plano}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-52 flex items-center justify-center text-[var(--text-muted)] text-sm">Sem dados de receita por plano.</div>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-5 shadow-[var(--shadow-soft)] lg:col-span-2">
          <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
            Acessos por Hora (24h)
          </h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts?.acessos_por_hora || []}>
                <defs>
                  <linearGradient id="colorAccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--brand-primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--brand-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="hora" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={customTooltip} />
                <Area type="monotone" dataKey="acessos" stroke="var(--brand-primary)" fill="url(#colorAccess)" strokeWidth={2} name="Acessos" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-5 shadow-[var(--shadow-soft)]">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
          Receita Mensal (6 meses)
        </h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts?.receita_mensal || []}>
              <XAxis dataKey="mes" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={customTooltip} />
              <Bar dataKey="valor" fill="var(--brand-primary)" radius={[4, 4, 0, 0]} name="Receita (R$)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

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
                      critical ? 'bg-red-500/5 hover:bg-red-500/10' : 'hover:bg-[var(--surface-soft)]'
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
                            ? 'bg-green-500/10 text-green-500 border-green-500/20'
                            : 'bg-red-500/10 text-red-500 border-red-500/20'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${allowed ? 'bg-green-500' : 'bg-red-500'}`} />
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
