import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Building2,
  DollarSign,
  LogOut,
  RefreshCw,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import { clearSession } from '../lib/session';
import Banner from '../components/ui/Banner';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SectionCard from '../components/ui/SectionCard';
import SelectField from '../components/ui/SelectField';
import SidePanel from '../components/ui/SidePanel';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return String(value);
  }
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function subscriptionMeta(status, canLogin) {
  const normalized = String(status || '').toLowerCase();
  if (canLogin && ['active', 'trialing'].includes(normalized)) {
    return { label: normalized === 'trialing' ? 'Em trial' : 'Ativa', tone: 'success' };
  }
  if (normalized === 'past_due') return { label: 'Em carencia', tone: 'warning' };
  if (normalized === 'canceled' || normalized === 'expired') return { label: 'Inativa', tone: 'danger' };
  if (normalized === 'trialing') return { label: 'Em trial', tone: 'info' };
  return { label: status || 'Indefinido', tone: 'neutral' };
}

export default function PlatformAdminPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [overview, setOverview] = useState(null);
  const [owners, setOwners] = useState([]);
  const [finance, setFinance] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [refreshingLogs, setRefreshingLogs] = useState(false);
  const [ownerActionLoading, setOwnerActionLoading] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [graceDialog, setGraceDialog] = useState(null);

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshingAll(true);
    } else {
      setLoading(true);
      setError('');
    }
    try {
      const [overviewData, ownersData, financeData, logsData] = await Promise.all([
        api.platformOverview(),
        api.platformOwners(200),
        api.platformFinanceSummary(30),
        api.platformLogs({ limit: 120 }),
      ]);
      setOverview(overviewData || null);
      setOwners((ownersData && ownersData.items) || []);
      setFinance(financeData || null);
      setLogs((logsData && logsData.items) || []);
    } catch (err) {
      const message = err?.message || 'Erro ao carregar painel da plataforma';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshingAll(false);
    }
  }, []);

  const loadLogs = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshingLogs(true);
    try {
      const data = await api.platformLogs({
        owner_id: ownerFilter || undefined,
        source: sourceFilter || undefined,
        limit: 120,
      });
      setLogs((data && data.items) || []);
    } catch (err) {
      toast.error(err?.message || 'Erro ao carregar logs');
    } finally {
      if (!silent) setRefreshingLogs(false);
    }
  }, [ownerFilter, sourceFilter]);

  useEffect(() => {
    loadAll().catch(() => {});
  }, [loadAll]);

  useEffect(() => {
    if (loading) return;
    loadLogs({ silent: true }).catch(() => {});
  }, [loading, loadLogs]);

  const filteredOwners = useMemo(() => {
    const term = ownerSearch.trim().toLowerCase();
    if (!term) return owners;
    return owners.filter((owner) => {
      const haystack = [owner.name, owner.email, owner.owner_id, owner.gym_name, owner.gym_id]
        .map((item) => String(item || '').toLowerCase())
        .join(' ');
      return haystack.includes(term);
    });
  }, [ownerSearch, owners]);

  const selectedOwner = useMemo(
    () => owners.find((item) => item.owner_id === selectedOwnerId) || null,
    [owners, selectedOwnerId]
  );

  const overdueOwners = Number(finance?.summary?.past_due_owners || 0);
  const paymentFailures = Number(overview?.kpis?.payment_failures_24h || 0);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // noop
    }
    clearSession();
    navigate('/login');
  };

  const openGrantGraceDialog = (owner) => {
    setGraceDialog({ mode: 'grant', owner, days: '3' });
  };

  const openClearGraceDialog = (owner) => {
    setGraceDialog({ mode: 'clear', owner, days: '3' });
  };

  const closeGraceDialog = () => setGraceDialog(null);

  const confirmGraceDialog = async () => {
    const owner = graceDialog?.owner;
    const ownerId = String(owner?.owner_id || '').trim();
    if (!ownerId) return;

    if (graceDialog.mode === 'grant') {
      const days = Number.parseInt(String(graceDialog.days || '').trim(), 10);
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        toast.error('Informe um numero entre 1 e 90 dias.');
        return;
      }
      setOwnerActionLoading(`grant:${ownerId}`);
      try {
        const result = await api.platformGrantGrace(ownerId, {
          days,
          reason: 'ajuste manual no painel da plataforma',
        });
        toast.success(`Carencia aplicada para ${owner.email || ownerId} ate ${formatDate(result?.grace_until)}.`);
        await loadAll({ silent: true });
        closeGraceDialog();
      } catch (err) {
        toast.error(err?.message || 'Falha ao aplicar carencia.');
      } finally {
        setOwnerActionLoading('');
      }
      return;
    }

    setOwnerActionLoading(`clear:${ownerId}`);
    try {
      await api.platformClearGrace(ownerId);
      toast.success(`Carencia removida para ${owner.email || ownerId}.`);
      await loadAll({ silent: true });
      closeGraceDialog();
    } catch (err) {
      toast.error(err?.message || 'Falha ao remover carencia.');
    } finally {
      setOwnerActionLoading('');
    }
  };

  if (loading) {
    return <LoadingScreen fullscreen label="Carregando plataforma..." />;
  }

  const kpis = overview?.kpis || {};

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)]">
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6 xl:px-8">
        <PageHeader
          eyebrow="Plataforma"
          title="Administracao global"
          subtitle="Acompanhe owners, faturamento, carencia manual e sinais de risco em um painel unico de operacao."
          actions={(
            <>
              <Button type="button" onClick={() => loadAll({ silent: true })} variant="secondary" size="sm">
                <RefreshCw className={`h-4 w-4 ${refreshingAll ? 'animate-spin' : ''}`} />
                Atualizar tudo
              </Button>
              <Button type="button" onClick={handleLogout} variant="danger" size="sm">
                <LogOut className="h-4 w-4" />
                Sair
              </Button>
            </>
          )}
        />

        {error ? <Banner tone="danger" title="Falha ao carregar plataforma" description={error} /> : null}

        {(overdueOwners > 0 || paymentFailures > 0) ? (
          <Banner
            tone={overdueOwners > 0 ? 'warning' : 'info'}
            title="Atencao operacional"
            description={`Owners em atraso: ${overdueOwners}. Falhas de pagamento nas ultimas 24h: ${paymentFailures}.`}
          />
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Donos cadastrados" value={Number(kpis.total_owners || 0)} hint={`${Number(kpis.verified_owners || 0)} verificados`} icon={Users} accent="info" />
          <StatCard label="Academias" value={Number(kpis.total_gyms || 0)} hint="Bases vinculadas a owners" icon={Building2} accent="info" />
          <StatCard label="Alunos totais" value={Number(kpis.total_students || 0)} hint={`${Number(kpis.total_employees || 0)} usuarios internos`} icon={Users} accent="info" />
          <StatCard label="Acessos 24h" value={Number(kpis.accesses_24h || 0)} hint={`${Number(kpis.total_turnstile_devices || 0)} dispositivos cadastrados`} icon={Activity} accent="success" />
          <StatCard label="MRR estimado" value={formatMoney(kpis.estimated_mrr || 0)} hint={`${Number(kpis.subscriptions_active || 0)} assinaturas ativas/trial`} icon={DollarSign} accent="success" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <SectionCard title="Financeiro da plataforma" description="Resumo consolidado de receita, inadimplencia e recorrencia nos ultimos 30 dias.">
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoTile label="Receita no periodo" value={formatMoney(finance?.summary?.revenue_in_period || 0)} />
              <InfoTile label="Faturas pagas" value={String(finance?.summary?.paid_invoices_in_period || 0)} />
              <InfoTile label="Valor em aberto" value={formatMoney(finance?.summary?.outstanding_amount || 0)} />
              <InfoTile label="Owners em atraso" value={String(finance?.summary?.past_due_owners || 0)} />
            </div>
            <div className="mt-4 space-y-2">
              {(finance?.monthly_revenue || []).map((item) => (
                <div key={item.month} className="flex items-center justify-between rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3 text-sm">
                  <span className="text-[var(--text-muted)]">{item.month}</span>
                  <span className="font-semibold text-[var(--text-primary)]">{formatMoney(item.amount || 0)}</span>
                </div>
              ))}
              {(!finance?.monthly_revenue || finance.monthly_revenue.length === 0) ? (
                <EmptyState title="Sem receita consolidada" description="Ainda nao ha historico suficiente para exibir a serie mensal." />
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Owners com maior receita" description="Top owners por faturamento pago no periodo analisado.">
            {(finance?.top_owners || []).length ? (
              <div className="space-y-3">
                {finance.top_owners.map((item) => (
                  <button
                    key={item.owner_id}
                    type="button"
                    onClick={() => setSelectedOwnerId(item.owner_id)}
                    className="w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3 text-left hover:border-[var(--surface-border-strong)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{item.name || '-'}</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">{item.email || '-'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{formatMoney(item.amount || 0)}</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">{item.paid_invoices || 0} faturas pagas</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="Sem dados de receita" description="Nenhum owner apareceu no ranking deste periodo." />
            )}
          </SectionCard>
        </div>

        <SectionCard
          title="Owners cadastrados"
          description="Busque por owner, academia ou email e aplique carencia manual com mais contexto."
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[240px]">
                <SearchInput
                  value={ownerSearch}
                  onChange={(event) => setOwnerSearch(event.target.value)}
                  placeholder="Buscar owner, email ou academia"
                  aria-label="Buscar owner"
                />
              </div>
            </div>
          )}
          bodyClassName="p-0"
        >
          {filteredOwners.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[1120px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--surface-border)] text-left text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    <th className="px-5 py-3">Owner</th>
                    <th className="px-5 py-3">Academia</th>
                    <th className="px-5 py-3">Assinatura</th>
                    <th className="px-5 py-3">Alunos</th>
                    <th className="px-5 py-3">Equipe</th>
                    <th className="px-5 py-3">Carencia</th>
                    <th className="px-5 py-3">Ultimo acesso</th>
                    <th className="px-5 py-3 text-right">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOwners.map((owner) => {
                    const meta = subscriptionMeta(owner.subscription_status, owner.subscription_can_login);
                    const busy = ownerActionLoading === `grant:${owner.owner_id}` || ownerActionLoading === `clear:${owner.owner_id}`;
                    return (
                      <tr
                        key={owner.owner_id}
                        className="cursor-pointer border-b border-[var(--surface-border)] hover:bg-[var(--surface-soft)]"
                        onClick={() => setSelectedOwnerId(owner.owner_id)}
                      >
                        <td className="px-5 py-4">
                          <p className="font-semibold text-[var(--text-primary)]">{owner.name || '-'}</p>
                          <p className="mt-1 text-xs text-[var(--text-muted)]">{owner.email || owner.owner_id}</p>
                        </td>
                        <td className="px-5 py-4 text-[var(--text-secondary)]">{owner.gym_name || owner.gym_id || '-'}</td>
                        <td className="px-5 py-4">
                          <StatusBadge label={meta.label} tone={meta.tone} />
                        </td>
                        <td className="px-5 py-4 text-[var(--text-secondary)]">{owner.students_active || 0} / {owner.students_total || 0}</td>
                        <td className="px-5 py-4 text-[var(--text-secondary)]">{owner.employees_active || 0}</td>
                        <td className="px-5 py-4 text-[var(--text-muted)]">{formatDate(owner.subscription_grace_until)}</td>
                        <td className="px-5 py-4 text-[var(--text-muted)]">{formatDate(owner.last_access_at)}</td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => openGrantGraceDialog(owner)}>
                              Dar carencia
                            </Button>
                            <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => openClearGraceDialog(owner)}>
                              Tirar carencia
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5">
              <EmptyState title="Nenhum owner encontrado" description="Ajuste a busca para localizar outro owner da plataforma." />
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Logs globais"
          description="Filtre eventos agregados por owner e origem para auditoria rapida."
          actions={(
            <div className="flex flex-wrap items-end gap-2">
              <SelectField label="Owner" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className="min-w-[220px]">
                <option value="">Todos os owners</option>
                {owners.map((owner) => (
                  <option key={owner.owner_id} value={owner.owner_id}>{owner.name || owner.owner_id}</option>
                ))}
              </SelectField>
              <SelectField label="Fonte" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="min-w-[190px]">
                <option value="">Todas as fontes</option>
                <option value="access">Acessos</option>
                <option value="billing">Billing</option>
                <option value="security">Seguranca</option>
                <option value="subscription">Assinatura</option>
              </SelectField>
              <Button type="button" onClick={() => loadLogs()} variant="ghost" size="sm">
                <RefreshCw className={`h-4 w-4 ${refreshingLogs ? 'animate-spin' : ''}`} />
                Atualizar logs
              </Button>
            </div>
          )}
          bodyClassName="p-0"
        >
          {logs.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--surface-border)] text-left text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    <th className="px-5 py-3">Data</th>
                    <th className="px-5 py-3">Owner ID</th>
                    <th className="px-5 py-3">Fonte</th>
                    <th className="px-5 py-3">Resumo</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((item, index) => (
                    <tr key={`${item.source}-${item.owner_id}-${index}`} className="border-b border-[var(--surface-border)]">
                      <td className="px-5 py-4 text-[var(--text-muted)]">{formatDate(item.timestamp)}</td>
                      <td className="px-5 py-4 font-mono text-xs text-[var(--text-secondary)]">{item.owner_id || '-'}</td>
                      <td className="px-5 py-4 text-[var(--text-secondary)]">{String(item.source || '').toUpperCase() || '-'}</td>
                      <td className="px-5 py-4 text-[var(--text-muted)]">{item.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5">
              <EmptyState title="Sem logs para estes filtros" description="Ajuste owner ou fonte para ampliar a leitura dos eventos globais." />
            </div>
          )}
        </SectionCard>
      </main>

      <SidePanel
        open={Boolean(selectedOwner)}
        onClose={() => setSelectedOwnerId('')}
        title="Detalhe do owner"
        description="Resumo operacional, acesso e acao de carencia manual."
        actions={(
          <Button type="button" variant="ghost" onClick={() => setSelectedOwnerId('')}>
            Fechar
          </Button>
        )}
      >
        {selectedOwner ? (
          <div className="space-y-4">
            <Banner
              tone={subscriptionMeta(selectedOwner.subscription_status, selectedOwner.subscription_can_login).tone}
              title={subscriptionMeta(selectedOwner.subscription_status, selectedOwner.subscription_can_login).label}
              description={selectedOwner.subscription_can_login ? 'O painel desta academia esta liberado no momento.' : 'Esta academia exige atencao financeira para manter o acesso.'}
            />

            <div className="grid gap-3">
              <InfoTile label="Owner" value={selectedOwner.name || '-'} />
              <InfoTile label="Email" value={selectedOwner.email || '-'} />
              <InfoTile label="Academia" value={selectedOwner.gym_name || selectedOwner.gym_id || '-'} />
              <InfoTile label="Assinatura" value={subscriptionMeta(selectedOwner.subscription_status, selectedOwner.subscription_can_login).label} />
              <InfoTile label="Carencia ate" value={formatDate(selectedOwner.subscription_grace_until)} />
              <InfoTile label="Periodo pago ate" value={formatDate(selectedOwner.subscription_current_period_end)} />
              <InfoTile label="Alunos ativos / total" value={`${selectedOwner.students_active || 0} / ${selectedOwner.students_total || 0}`} />
              <InfoTile label="Equipe ativa" value={String(selectedOwner.employees_active || 0)} />
              <InfoTile label="Ultimo acesso" value={formatDate(selectedOwner.last_access_at)} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => openGrantGraceDialog(selectedOwner)} disabled={ownerActionLoading.startsWith('grant:') || ownerActionLoading.startsWith('clear:')}>
                Dar carencia
              </Button>
              <Button type="button" variant="danger" onClick={() => openClearGraceDialog(selectedOwner)} disabled={ownerActionLoading.startsWith('grant:') || ownerActionLoading.startsWith('clear:')}>
                Tirar carencia
              </Button>
            </div>
          </div>
        ) : null}
      </SidePanel>

      <Dialog
        open={Boolean(graceDialog)}
        onClose={ownerActionLoading ? undefined : closeGraceDialog}
        title={graceDialog?.mode === 'grant' ? 'Aplicar carencia manual' : 'Remover carencia manual'}
        description={graceDialog?.mode === 'grant'
          ? 'Defina por quantos dias o owner podera continuar acessando o painel mesmo em situacao financeira pendente.'
          : 'Essa acao remove a carencia atual e devolve o owner ao status financeiro calculado.'}
        actions={(
          <>
            <Button type="button" variant="ghost" onClick={closeGraceDialog} disabled={Boolean(ownerActionLoading)}>
              Voltar
            </Button>
            <Button
              type="button"
              variant={graceDialog?.mode === 'grant' ? 'primary' : 'danger'}
              onClick={confirmGraceDialog}
              disabled={Boolean(ownerActionLoading)}
            >
              {graceDialog?.mode === 'grant' ? 'Aplicar carencia' : 'Remover carencia'}
            </Button>
          </>
        )}
      >
        {graceDialog?.mode === 'grant' ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-muted)]">Owner selecionado: <span className="text-[var(--text-primary)]">{graceDialog?.owner?.email || graceDialog?.owner?.owner_id}</span></p>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Dias de carencia</span>
              <input
                type="number"
                min="1"
                max="90"
                value={graceDialog?.days || '3'}
                onChange={(event) => setGraceDialog((current) => ({ ...current, days: event.target.value }))}
                className="h-11 w-full rounded-md border border-[var(--surface-border)] bg-[var(--surface-base)] px-3 text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-muted)]">Owner selecionado: <span className="text-[var(--text-primary)]">{graceDialog?.owner?.email || graceDialog?.owner?.owner_id}</span></p>
            <div className="rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger-text)]">
              Se a assinatura ainda estiver pendente, o painel pode voltar a ficar restrito imediatamente apos esta acao.
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-sm text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
