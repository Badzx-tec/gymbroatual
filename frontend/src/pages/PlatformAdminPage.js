import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Building2,
  DollarSign,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return String(value);
  }
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusBadge(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return 'bg-green-500/20 text-green-300 border-green-500/30';
  if (normalized === 'trialing') return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
  if (normalized === 'past_due') return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
  if (normalized === 'canceled' || normalized === 'expired') {
    return 'bg-red-500/20 text-red-300 border-red-500/30';
  }
  return 'bg-zinc-700/30 text-zinc-300 border-zinc-600';
}

export default function PlatformAdminPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [owners, setOwners] = useState([]);
  const [finance, setFinance] = useState(null);
  const [logs, setLogs] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [refreshingLogs, setRefreshingLogs] = useState(false);
  const [ownerActionLoading, setOwnerActionLoading] = useState('');

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('gymbro_user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewData, ownersData, financeData, logsData] = await Promise.all([
        api.platformOverview(),
        api.platformOwners(200),
        api.platformFinanceSummary(30),
        api.platformLogs({ limit: 120 }),
      ]);
      setOverview(overviewData);
      setOwners((ownersData && ownersData.items) || []);
      setFinance(financeData);
      setLogs((logsData && logsData.items) || []);
    } catch (err) {
      toast.error(err.message || 'Erro ao carregar painel da plataforma');
    } finally {
      setLoading(false);
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
      toast.error(err.message || 'Erro ao carregar logs');
    } finally {
      if (!silent) setRefreshingLogs(false);
    }
  }, [ownerFilter, sourceFilter]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (loading) return;
    loadLogs({ silent: true });
  }, [loading, loadLogs]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // noop
    }
    localStorage.removeItem('gymbro_token');
    localStorage.removeItem('gymbro_user');
    navigate('/login');
  };

  const handleGrantGrace = async (owner) => {
    const ownerId = String(owner?.owner_id || '').trim();
    if (!ownerId) return;
    const daysInput = window.prompt('Quantos dias de carencia deseja aplicar?', '3');
    if (daysInput === null) return;
    const days = Number.parseInt(String(daysInput || '').trim(), 10);
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
      await loadAll();
    } catch (err) {
      toast.error(err?.message || 'Falha ao aplicar carencia.');
    } finally {
      setOwnerActionLoading('');
    }
  };

  const handleClearGrace = async (owner) => {
    const ownerId = String(owner?.owner_id || '').trim();
    if (!ownerId) return;
    const confirmed = window.confirm(`Remover a carencia de ${owner.email || ownerId}?`);
    if (!confirmed) return;
    setOwnerActionLoading(`clear:${ownerId}`);
    try {
      await api.platformClearGrace(ownerId);
      toast.success(`Carencia removida para ${owner.email || ownerId}.`);
      await loadAll();
    } catch (err) {
      toast.error(err?.message || 'Falha ao remover carencia.');
    } finally {
      setOwnerActionLoading('');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const kpis = overview?.kpis || {};

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <header className="h-16 border-b border-zinc-800 bg-zinc-900/70 backdrop-blur-md px-4 lg:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-sm bg-[#ccff00]/20 flex items-center justify-center border border-[#ccff00]/30">
            <ShieldCheck className="w-5 h-5 text-[#ccff00]" />
          </div>
          <div>
            <h1 className="font-heading text-lg uppercase tracking-wide">GymBro Platform Admin</h1>
            <p className="text-xs text-zinc-500">Subdominio administrativo global</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAll}
            className="bg-zinc-800 text-zinc-200 text-xs uppercase tracking-wide px-3 h-9 rounded-sm hover:bg-zinc-700"
          >
            Atualizar Tudo
          </button>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-2 bg-red-500/20 text-red-300 text-xs uppercase tracking-wide px-3 h-9 rounded-sm hover:bg-red-500/30"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </header>

      <main className="p-4 lg:p-8 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div>
            <h2 className="font-heading text-3xl font-bold uppercase">Visao da Plataforma</h2>
            <p className="text-zinc-400 text-sm mt-1">
              Admin: {user?.name || 'Platform Admin'} - {user?.email || 'sem email'}
            </p>
          </div>
          <p className="text-xs text-zinc-500">
            Atualizado em: {formatDate(overview?.generated_at || finance?.generated_at)}
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
            <p className="text-[10px] uppercase text-zinc-500">Donos cadastrados</p>
            <p className="text-2xl font-bold mt-2">{kpis.total_owners || 0}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
            <p className="text-[10px] uppercase text-zinc-500">Academias</p>
            <p className="text-2xl font-bold mt-2 inline-flex items-center gap-2">
              {kpis.total_gyms || 0} <Building2 className="w-4 h-4 text-zinc-500" />
            </p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
            <p className="text-[10px] uppercase text-zinc-500">Alunos totais</p>
            <p className="text-2xl font-bold mt-2 inline-flex items-center gap-2">
              {kpis.total_students || 0} <Users className="w-4 h-4 text-zinc-500" />
            </p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
            <p className="text-[10px] uppercase text-zinc-500">Acessos 24h</p>
            <p className="text-2xl font-bold mt-2 inline-flex items-center gap-2">
              {kpis.accesses_24h || 0} <Activity className="w-4 h-4 text-zinc-500" />
            </p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
            <p className="text-[10px] uppercase text-zinc-500">MRR estimado</p>
            <p className="text-2xl font-bold mt-2 inline-flex items-center gap-2">
              {formatMoney(kpis.estimated_mrr || 0)} <DollarSign className="w-4 h-4 text-zinc-500" />
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
            <h3 className="font-semibold uppercase text-sm tracking-wide mb-3">Financeiro da plataforma (30 dias)</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-zinc-800 rounded-sm p-3">
                <p className="text-xs text-zinc-500 uppercase">Receita periodo</p>
                <p className="text-lg font-bold mt-1">{formatMoney(finance?.summary?.revenue_in_period || 0)}</p>
              </div>
              <div className="border border-zinc-800 rounded-sm p-3">
                <p className="text-xs text-zinc-500 uppercase">Faturas pagas</p>
                <p className="text-lg font-bold mt-1">{finance?.summary?.paid_invoices_in_period || 0}</p>
              </div>
              <div className="border border-zinc-800 rounded-sm p-3">
                <p className="text-xs text-zinc-500 uppercase">Em aberto/past_due</p>
                <p className="text-lg font-bold mt-1">{formatMoney(finance?.summary?.outstanding_amount || 0)}</p>
              </div>
              <div className="border border-zinc-800 rounded-sm p-3">
                <p className="text-xs text-zinc-500 uppercase">Donos em atraso</p>
                <p className="text-lg font-bold mt-1 inline-flex items-center gap-2">
                  {finance?.summary?.past_due_owners || 0}
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-xs text-zinc-500 uppercase">Receita mensal (6 meses)</p>
              {(finance?.monthly_revenue || []).map((item) => (
                <div key={item.month} className="flex items-center justify-between text-sm border-b border-zinc-800/50 py-1">
                  <span className="text-zinc-400">{item.month}</span>
                  <span className="font-semibold">{formatMoney(item.amount)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 overflow-x-auto">
            <h3 className="font-semibold uppercase text-sm tracking-wide mb-3">Top donos (receita no periodo)</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                  <th className="text-left py-2">Dono</th>
                  <th className="text-left py-2">Email</th>
                  <th className="text-left py-2">Faturas</th>
                  <th className="text-left py-2">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(finance?.top_owners || []).map((item) => (
                  <tr key={item.owner_id} className="border-b border-zinc-800/40">
                    <td className="py-2">{item.name || '-'}</td>
                    <td className="py-2 text-zinc-400">{item.email || '-'}</td>
                    <td className="py-2">{item.paid_invoices || 0}</td>
                    <td className="py-2 font-semibold">{formatMoney(item.amount || 0)}</td>
                  </tr>
                ))}
                {(!finance?.top_owners || finance.top_owners.length === 0) && (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-zinc-500">Sem dados no periodo.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 overflow-x-auto">
          <h3 className="font-semibold uppercase text-sm tracking-wide mb-3">Donos cadastrados</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                <th className="text-left py-2">Dono</th>
                <th className="text-left py-2">Academia</th>
                <th className="text-left py-2">Assinatura</th>
                <th className="text-left py-2">Alunos</th>
                <th className="text-left py-2">Equipe</th>
                <th className="text-left py-2">Carencia</th>
                <th className="text-left py-2">Ultimo acesso</th>
                <th className="text-left py-2">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((owner) => (
                <tr key={owner.owner_id} className="border-b border-zinc-800/40">
                  <td className="py-2">
                    <p className="font-semibold">{owner.name || '-'}</p>
                    <p className="text-xs text-zinc-500">{owner.email || '-'}</p>
                  </td>
                  <td className="py-2 text-zinc-300">{owner.gym_name || owner.gym_id || '-'}</td>
                  <td className="py-2">
                    <span className={`inline-flex px-2 py-1 rounded-sm border text-xs uppercase ${statusBadge(owner.subscription_status)}`}>
                      {owner.subscription_status || 'unknown'}
                    </span>
                  </td>
                  <td className="py-2">{owner.students_active || 0} / {owner.students_total || 0}</td>
                  <td className="py-2">{owner.employees_active || 0}</td>
                  <td className="py-2 text-zinc-400">{formatDate(owner.subscription_grace_until)}</td>
                  <td className="py-2 text-zinc-400">{formatDate(owner.last_access_at)}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => handleGrantGrace(owner)}
                        disabled={ownerActionLoading === `grant:${owner.owner_id}` || ownerActionLoading === `clear:${owner.owner_id}`}
                        className="h-8 rounded-sm border border-blue-500/40 bg-blue-500/15 px-2 text-[11px] uppercase text-blue-300 disabled:opacity-50"
                      >
                        Dar carencia
                      </button>
                      <button
                        onClick={() => handleClearGrace(owner)}
                        disabled={ownerActionLoading === `grant:${owner.owner_id}` || ownerActionLoading === `clear:${owner.owner_id}`}
                        className="h-8 rounded-sm border border-red-500/40 bg-red-500/15 px-2 text-[11px] uppercase text-red-300 disabled:opacity-50"
                      >
                        Tirar carencia
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {owners.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-zinc-500">Nenhum dono encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 mb-3">
            <h3 className="font-semibold uppercase text-sm tracking-wide">Logs globais dos donos</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-sm h-9 px-3 text-xs"
              >
                <option value="">Todos os donos</option>
                {owners.map((owner) => (
                  <option key={owner.owner_id} value={owner.owner_id}>
                    {owner.name || owner.owner_id}
                  </option>
                ))}
              </select>
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-sm h-9 px-3 text-xs"
              >
                <option value="">Todas as fontes</option>
                <option value="access">Acessos</option>
                <option value="billing">Billing</option>
                <option value="security">Seguranca</option>
                <option value="subscription">Assinatura</option>
              </select>
              <button
                onClick={() => loadLogs()}
                className="inline-flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 rounded-sm h-9 px-3 text-xs uppercase"
              >
                <RefreshCw className={`w-3 h-3 ${refreshingLogs ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                  <th className="text-left py-2">Data</th>
                  <th className="text-left py-2">Owner ID</th>
                  <th className="text-left py-2">Fonte</th>
                  <th className="text-left py-2">Resumo</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((item, index) => (
                  <tr key={`${item.source}-${item.owner_id}-${index}`} className="border-b border-zinc-800/40">
                    <td className="py-2 text-zinc-400">{formatDate(item.timestamp)}</td>
                    <td className="py-2 font-mono text-xs">{item.owner_id || '-'}</td>
                    <td className="py-2 uppercase text-xs">{item.source}</td>
                    <td className="py-2">{item.summary}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-zinc-500">Sem logs para os filtros selecionados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
