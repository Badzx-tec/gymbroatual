import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  FileText,
  Filter,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import { accessStatusLabel, contractStatusLabel, financialStatusLabel } from '../utils/labels';

const defaultFilters = {
  q: '',
  contract_status: '',
  financial_status: '',
  access_status: '',
  plan_id: '',
};

const defaultForm = {
  student_id: '',
  plan_id: '',
  amount: '',
  duration_days: '',
  start_at: '',
  end_at: '',
  auto_renew: false,
  create_initial_charge: true,
  payment_method: 'pix',
};

const defaultActionForm = {
  freeze_end_at: '',
  freeze_reason: '',
  cancel_mode: 'end_of_cycle',
  cancel_reason: '',
  manual_end_at: '',
  manual_amount: '',
  manual_reason: '',
};

const contractStatusOptions = [
  ['active', 'Ativo'],
  ['pending_activation', 'Aguardando ativacao'],
  ['frozen', 'Congelado'],
  ['scheduled_cancel', 'Cancelamento agendado'],
  ['scheduled_freeze', 'Congelamento agendado'],
  ['canceled', 'Cancelado'],
  ['expired', 'Expirado'],
  ['ended', 'Encerrado'],
];

const financialStatusOptions = [
  ['paid', 'Pago'],
  ['pending', 'Pendente'],
  ['open', 'Aberto'],
  ['overdue', 'Atrasado'],
  ['failed', 'Falhou'],
  ['partially_paid', 'Pago parcialmente'],
];

const accessStatusOptions = [
  ['allowed', 'Liberado'],
  ['blocked', 'Bloqueado'],
  ['grace_period', 'Carencia'],
  ['suspended', 'Suspenso'],
];

const paymentOptions = [
  ['pix', 'PIX'],
  ['card', 'Cartao'],
  ['cash', 'Dinheiro'],
  ['boleto', 'Boleto'],
  ['transfer', 'Transferencia'],
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return String(value);
  }
}

function formatDurationMs(value) {
  const total = Number(value || 0);
  if (total < 1000) return `${total} ms`;
  return `${(total / 1000).toFixed(1)} s`;
}

function toLocalDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoDate(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function badgeClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'paid', 'allowed'].includes(normalized)) return 'bg-green-500/15 border-green-500/30 text-green-300';
  if (['pending', 'open', 'grace_period', 'pending_activation', 'scheduled_cancel', 'scheduled_freeze'].includes(normalized)) return 'bg-blue-500/15 border-blue-500/30 text-blue-300';
  if (['frozen', 'overdue', 'failed', 'suspended', 'partially_paid'].includes(normalized)) return 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300';
  return 'bg-red-500/15 border-red-500/30 text-red-300';
}

function normalizeEventLabel(value) {
  const normalized = String(value || '').toLowerCase().trim();
  return normalized ? normalized.replaceAll('_', ' ') : '-';
}

export default function StudentContractsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const [overview, setOverview] = useState({});
  const [contracts, setContracts] = useState([]);
  const [reconcileRuns, setReconcileRuns] = useState([]);
  const [students, setStudents] = useState([]);
  const [plans, setPlans] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState({ contract: null, charges: [], events: [] });

  const [filters, setFilters] = useState(defaultFilters);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [manualEndEdited, setManualEndEdited] = useState(false);
  const [actionForm, setActionForm] = useState(defaultActionForm);

  const user = useMemo(() => JSON.parse(localStorage.getItem('gymbro_user') || '{}'), []);
  const role = String(user.role || '').toUpperCase();
  const canCreateContracts = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);
  const canManageContractRules = ['OWNER', 'MANAGER'].includes(role);

  const plansById = useMemo(() => new Map(plans.map((plan) => [plan.plan_id, plan])), [plans]);

  const recalcEndAt = useCallback((nextForm) => {
    if (manualEndEdited) return nextForm;
    const plan = plansById.get(nextForm.plan_id);
    const duration = Number(nextForm.duration_days || plan?.duracao_dias || 0);
    if (!nextForm.start_at || duration <= 0) return { ...nextForm, end_at: nextForm.end_at || '' };
    const start = new Date(nextForm.start_at);
    if (Number.isNaN(start.getTime())) return nextForm;
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + duration);
    return { ...nextForm, end_at: toLocalDateInput(end.toISOString()) };
  }, [manualEndEdited, plansById]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewData, contractsData, studentsData, plansData, reconcileData] = await Promise.all([
        api.studentBillingOverview(),
        api.listStudentContracts({ ...filters, limit: 350 }),
        api.listStudents('', ''),
        api.listPlans(),
        canManageContractRules ? api.listStudentBillingReconcileRuns(20) : Promise.resolve([]),
      ]);

      const list = Array.isArray(contractsData) ? contractsData : [];
      setOverview(overviewData || {});
      setContracts(list);
      setStudents(Array.isArray(studentsData) ? studentsData : []);
      setPlans(Array.isArray(plansData) ? plansData : []);
      setReconcileRuns(Array.isArray(reconcileData) ? reconcileData : []);
      setSelectedId((current) => {
        if (!list.length) return '';
        if (current && list.some((item) => item.contract_id === current)) return current;
        return list[0].contract_id;
      });
    } catch (err) {
      toast.error(err?.message || 'Erro ao carregar contratos.');
    } finally {
      setLoading(false);
    }
  }, [canManageContractRules, filters]);

  const loadDetail = useCallback(async (contractId) => {
    if (!contractId) {
      setDetail({ contract: null, charges: [], events: [] });
      return;
    }
    setDetailLoading(true);
    try {
      const response = await api.getStudentContractDetail(contractId);
      const contract = response?.contract || null;
      setDetail({
        contract,
        charges: Array.isArray(response?.charges) ? response.charges : [],
        events: Array.isArray(response?.events) ? response.events : [],
      });
      setActionForm({
        ...defaultActionForm,
        manual_end_at: toLocalDateInput(contract?.current_period_end),
        manual_amount: String(contract?.amount || ''),
      });
    } catch (err) {
      toast.error(err?.message || 'Erro ao carregar o contrato.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(timeout);
  }, [load, filters.q]);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const runAction = async (fn, message) => {
    setSaving(true);
    try {
      await fn();
      toast.success(message);
      await load();
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      toast.error(err?.message || 'Falha ao executar operacao.');
    } finally {
      setSaving(false);
    }
  };

  const runReconcile = async () => {
    if (!canManageContractRules) return;
    setSaving(true);
    try {
      const response = await api.runStudentBillingReconcile(500);
      const summary = response?.summary || {};
      toast.success(`Reconciliacao concluida #${response?.run_id || '-'} - atualizados: ${summary.contracts_updated || 0}, vencidas: ${summary.charge_overdue_marked || 0}.`);
      await load();
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      toast.error(err?.message || 'Erro ao rodar reconciliacao.');
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setForm({ ...defaultForm, start_at: toLocalDateInput(new Date().toISOString()) });
    setManualEndEdited(false);
    setCreateOpen(true);
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!canCreateContracts) return;
    const payload = {
      student_id: form.student_id,
      plan_id: form.plan_id || undefined,
      amount: form.amount ? Number(form.amount) : undefined,
      duration_days: form.duration_days ? Number(form.duration_days) : undefined,
      start_at: toIsoDate(form.start_at) || undefined,
      end_at: toIsoDate(form.end_at) || undefined,
      auto_renew: form.auto_renew,
      create_initial_charge: form.create_initial_charge,
      payment_method: form.payment_method || undefined,
    };

    setSaving(true);
    try {
      const created = await api.createStudentContract(payload);
      toast.success('Contrato criado com sucesso.');
      setCreateOpen(false);
      await load();
      const nextSelected = created?.contract_id || selectedId;
      if (nextSelected) {
        setSelectedId(nextSelected);
        await loadDetail(nextSelected);
      }
    } catch (err) {
      toast.error(err?.message || 'Falha ao criar contrato.');
    } finally {
      setSaving(false);
    }
  };

  const selected = detail.contract;
  const metrics = [
    { icon: FileText, label: 'Contratos', value: overview?.total_contracts || 0 },
    { icon: ShieldCheck, label: 'Ativos', value: overview?.active_contracts || 0, color: 'text-green-300' },
    { icon: Timer, label: 'Congelados', value: overview?.frozen_contracts || 0 },
    { icon: Wallet, label: 'Recebido no mes', value: formatMoney(overview?.month_received_amount || 0), color: 'text-green-300' },
    { icon: AlertTriangle, label: 'Inadimplentes', value: overview?.past_due_contracts || 0, color: 'text-amber-300' },
    { icon: CalendarClock, label: 'Cobrancas vencidas', value: overview?.overdue_charges || 0, color: 'text-red-300' },
  ];

  if (loading) {
    return <div className="flex h-48 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ccff00] border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Operacao financeira</p>
            <h1 className="mt-1 font-heading text-3xl font-bold uppercase tracking-tight">Central de contratos</h1>
            <p className="mt-2 text-sm text-zinc-300">Fluxo operacional unico para contrato, cobranca e acesso.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={load} className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-4 text-xs font-semibold uppercase hover:bg-zinc-700"><RefreshCw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />Atualizar</button>
            {canManageContractRules ? <button type="button" disabled={saving} onClick={runReconcile} className="h-10 rounded-md border border-amber-500/30 bg-amber-500/15 px-4 text-xs font-semibold uppercase text-amber-200 disabled:opacity-60">Rodar reconciliacao</button> : null}
            {canCreateContracts ? <button type="button" onClick={openCreate} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#ccff00] px-4 text-xs font-bold uppercase text-black hover:bg-[#b3e600]"><Plus className="h-4 w-4" />Novo contrato</button> : null}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {metrics.map((item) => (
          <div key={item.label} className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
            <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-500"><item.icon className="h-3.5 w-3.5" />{item.label}</p>
            <p className={`mt-2 text-2xl font-semibold ${item.color || 'text-zinc-100'}`}>{item.value}</p>
          </div>
        ))}
      </section>

      {canManageContractRules ? (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold uppercase">Ultimas reconciliacoes</h2><p className="text-xs text-zinc-500">Historico operacional</p></div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            {reconcileRuns.slice(0, 8).map((run) => <div key={run.run_id} className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs"><p className="font-semibold">#{run.run_id}</p><p className="text-zinc-500">{formatDate(run.finished_at || run.started_at)}</p><p className="mt-1 text-zinc-400">Atualizados: {Number(run?.summary?.contracts_updated || 0)} | Overdue: {Number(run?.summary?.charge_overdue_marked || 0)}</p><p className="text-zinc-500">Duracao: {formatDurationMs(run.duration_ms)}</p></div>)}
            {!reconcileRuns.length ? <p className="text-sm text-zinc-500">Nenhuma reconciliacao registrada.</p> : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase">Filtros</h2>
          <button type="button" onClick={() => setFilters(defaultFilters)} className="h-8 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-[11px] font-semibold uppercase">Limpar filtros</button>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input value={filters.q} onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))} placeholder="Aluno, plano ou id do contrato..." className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-sm" />
          </div>
          <label className="inline-flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3"><Filter className="h-4 w-4 text-zinc-500" /><select value={filters.contract_status} onChange={(e) => setFilters((p) => ({ ...p, contract_status: e.target.value }))} className="h-10 w-full bg-transparent text-sm outline-none"><option value="">Status contratual</option>{contractStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <select value={filters.financial_status} onChange={(e) => setFilters((p) => ({ ...p, financial_status: e.target.value }))} className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm"><option value="">Status financeiro</option>{financialStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={filters.access_status} onChange={(e) => setFilters((p) => ({ ...p, access_status: e.target.value }))} className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm"><option value="">Status de acesso</option>{accessStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={filters.plan_id} onChange={(e) => setFilters((p) => ({ ...p, plan_id: e.target.value }))} className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm"><option value="">Todos os planos</option>{plans.map((plan) => <option key={plan.plan_id} value={plan.plan_id}>{plan.nome}</option>)}</select>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr,1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold uppercase">Lista de contratos</h2><p className="text-xs text-zinc-500">{contracts.length} resultado(s)</p></div>
          {contracts.map((item) => (
            <button key={item.contract_id} type="button" onClick={() => setSelectedId(item.contract_id)} className={`w-full rounded-xl border p-4 text-left transition ${selectedId === item.contract_id ? 'border-[#ccff00]/60 bg-[#ccff00]/5' : 'border-zinc-800 bg-zinc-900/80 hover:border-zinc-700'}`}>
              <div className="flex flex-col gap-2 md:flex-row md:justify-between">
                <div><p className="font-semibold">{item.student_name}</p><p className="text-xs text-zinc-500">{item.plan_name || 'Sem plano vinculado'}</p><p className="text-[11px] text-zinc-500">{item.contract_id}</p></div>
                <div className="text-xs text-zinc-400 md:text-right"><p>Inicio: {formatDate(item.current_period_start)}</p><p>Fim: {formatDate(item.current_period_end)}</p>{item.next_retry_at ? <p className="text-amber-300">Proxima tentativa: {formatDate(item.next_retry_at)}</p> : null}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${badgeClass(item.contract_status)}`}>{contractStatusLabel(item.contract_status)}</span>
                <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${badgeClass(item.financial_status)}`}>{financialStatusLabel(item.financial_status)}</span>
                <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${badgeClass(item.access_status)}`}>{accessStatusLabel(item.access_status)}</span>
              </div>
            </button>
          ))}
          {!contracts.length ? <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-8 text-center text-sm text-zinc-500">Nenhum contrato encontrado.</div> : null}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-4">
            <h2 className="text-sm font-semibold uppercase">Contrato selecionado</h2>
            {!selected && !detailLoading ? <p className="mt-3 text-sm text-zinc-500">Selecione um contrato para operar.</p> : null}
            {detailLoading ? <p className="mt-3 text-sm text-zinc-400">Carregando...</p> : null}
            {selected ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-sm">
                  <p className="font-semibold">{selected.student_name}</p>
                  <p className="text-xs text-zinc-500">{selected.plan_name || 'Sem plano'}</p>
                  <p className="mt-1 text-xs text-zinc-400">Periodo: {formatDate(selected.current_period_start)} ate {formatDate(selected.current_period_end)}</p>
                  <p className="text-xs text-zinc-400">Valor: {formatMoney(selected.amount)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={saving} onClick={() => runAction(() => api.renewStudentContract(selected.contract_id, { duration_days: Number(selected.duration_days || 30), create_charge: true }), 'Contrato renovado.')} className="h-9 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs font-semibold uppercase text-emerald-300 disabled:opacity-60">Renovar</button>
                  {canManageContractRules ? <button disabled={saving} onClick={() => runAction(() => api.cancelStudentContract(selected.contract_id, { mode: actionForm.cancel_mode, reason: actionForm.cancel_reason || 'cancelamento administrativo' }), actionForm.cancel_mode === 'immediate' ? 'Contrato cancelado.' : 'Cancelamento agendado.')} className="h-9 rounded-md border border-red-500/40 bg-red-500/15 text-xs font-semibold uppercase text-red-300 disabled:opacity-60">Cancelar</button> : <button disabled className="h-9 rounded-md border border-zinc-700 bg-zinc-800 text-xs font-semibold uppercase text-zinc-500">Sem permissao</button>}
                </div>
              </div>
            ) : null}
          </div>

          {selected && canManageContractRules ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-4 space-y-3">
              <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase text-zinc-400">Cancelamento</p>
                <select value={actionForm.cancel_mode} onChange={(e) => setActionForm((p) => ({ ...p, cancel_mode: e.target.value }))} className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs"><option value="end_of_cycle">No fim do ciclo</option><option value="immediate">Imediato</option></select>
                <input value={actionForm.cancel_reason} onChange={(e) => setActionForm((p) => ({ ...p, cancel_reason: e.target.value }))} placeholder="Motivo" className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs" />
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase text-zinc-400">Congelamento e retomada</p>
                <input type="datetime-local" value={actionForm.freeze_end_at} onChange={(e) => setActionForm((p) => ({ ...p, freeze_end_at: e.target.value }))} className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs" />
                <input value={actionForm.freeze_reason} onChange={(e) => setActionForm((p) => ({ ...p, freeze_reason: e.target.value }))} placeholder="Motivo" className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs" />
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={saving || !actionForm.freeze_end_at} onClick={() => runAction(() => api.freezeStudentContract(selected.contract_id, { end_at: toIsoDate(actionForm.freeze_end_at), reason: actionForm.freeze_reason || undefined, pause_charges: true, extend_end_by_frozen_days: true }), 'Contrato congelado.')} className="h-9 rounded-md border border-blue-500/40 bg-blue-500/15 text-xs font-semibold uppercase text-blue-300 disabled:opacity-60">Congelar</button>
                  <button disabled={saving} onClick={() => runAction(() => api.resumeStudentContract(selected.contract_id, {}), 'Contrato retomado.')} className="h-9 rounded-md border border-indigo-500/40 bg-indigo-500/15 text-xs font-semibold uppercase text-indigo-300 disabled:opacity-60">Retomar</button>
                </div>
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase text-zinc-400">Ajuste manual</p>
                <input type="datetime-local" value={actionForm.manual_end_at} onChange={(e) => setActionForm((p) => ({ ...p, manual_end_at: e.target.value }))} className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs" />
                <input type="number" min="0.01" step="0.01" value={actionForm.manual_amount} onChange={(e) => setActionForm((p) => ({ ...p, manual_amount: e.target.value }))} placeholder="Valor" className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs" />
                <input value={actionForm.manual_reason} onChange={(e) => setActionForm((p) => ({ ...p, manual_reason: e.target.value }))} placeholder="Motivo" className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs" />
                <button disabled={saving} onClick={() => runAction(() => api.updateStudentContract(selected.contract_id, { end_at: toIsoDate(actionForm.manual_end_at) || undefined, amount: actionForm.manual_amount ? Number(actionForm.manual_amount) : undefined, manual_override_reason: actionForm.manual_reason || undefined }), 'Ajuste salvo.')} className="h-9 w-full rounded-md border border-indigo-500/40 bg-indigo-500/15 text-xs font-semibold uppercase text-indigo-300 disabled:opacity-60">Salvar ajuste</button>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-4">
            <h3 className="text-xs font-semibold uppercase text-zinc-400">Ultimas cobrancas</h3>
            <div className="mt-2 max-h-44 space-y-1 overflow-auto">
              {detail.charges.slice(0, 8).map((charge) => <div key={charge.charge_id} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-2 text-xs"><span>{formatDate(charge.due_at)}</span><span>{formatMoney(charge.amount)}</span><span className={`rounded-md border px-2 py-0.5 font-semibold uppercase ${badgeClass(charge.status)}`}>{financialStatusLabel(charge.status)}</span></div>)}
              {!detail.charges.length ? <p className="text-xs text-zinc-500">Sem cobrancas.</p> : null}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-4">
            <h3 className="text-xs font-semibold uppercase text-zinc-400">Timeline</h3>
            <div className="mt-2 max-h-56 space-y-2 overflow-auto">
              {detail.events.slice(0, 12).map((event) => <div key={event.event_id} className="rounded-md border border-zinc-800 bg-zinc-950/70 p-2"><p className="text-xs font-semibold uppercase">{normalizeEventLabel(event.event_type)}</p><p className="text-xs text-zinc-500">{formatDate(event.created_at)}</p></div>)}
              {!detail.events.length ? <p className="text-xs text-zinc-500">Sem eventos.</p> : null}
            </div>
          </div>
        </aside>
      </section>

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setCreateOpen(false)}>
          <div className="w-full max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="font-heading text-2xl font-bold uppercase">Novo contrato</h3><p className="text-xs text-zinc-500">Calculo de termino automatico por inicio + duracao.</p></div><button type="button" onClick={() => setCreateOpen(false)} className="h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-semibold uppercase">Fechar</button></div>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <select required value={form.student_id} onChange={(e) => setForm((p) => ({ ...p, student_id: e.target.value }))} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm md:col-span-2"><option value="">Aluno</option>{students.map((s) => <option key={s.student_id} value={s.student_id}>{s.nome}</option>)}</select>
              <select value={form.plan_id} onChange={(e) => { const next = { ...form, plan_id: e.target.value }; const plan = plansById.get(e.target.value); if (plan?.duracao_dias && !form.duration_days) next.duration_days = String(plan.duracao_dias); if (plan?.valor && !form.amount) next.amount = String(plan.valor); setForm(recalcEndAt(next)); }} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"><option value="">Plano</option>{plans.map((plan) => <option key={plan.plan_id} value={plan.plan_id}>{plan.nome}</option>)}</select>
              <select value={form.payment_method} onChange={(e) => setForm((p) => ({ ...p, payment_method: e.target.value }))} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm">{paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} placeholder="Valor" className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
              <input type="number" min="1" value={form.duration_days} onChange={(e) => setForm((p) => recalcEndAt({ ...p, duration_days: e.target.value }))} placeholder="Duracao (dias)" className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
              <input type="datetime-local" value={form.start_at} onChange={(e) => setForm((p) => recalcEndAt({ ...p, start_at: e.target.value }))} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
              <input type="datetime-local" value={form.end_at} onChange={(e) => { setManualEndEdited(Boolean(e.target.value)); setForm((p) => ({ ...p, end_at: e.target.value })); }} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
              <label className="inline-flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" className="accent-[#ccff00]" checked={form.auto_renew} onChange={(e) => setForm((p) => ({ ...p, auto_renew: e.target.checked }))} />Renovacao automatica</label>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" className="accent-[#ccff00]" checked={form.create_initial_charge} onChange={(e) => setForm((p) => ({ ...p, create_initial_charge: e.target.checked }))} />Criar cobranca inicial</label>
              <div className="md:col-span-2 flex justify-end gap-2 pt-1"><button type="button" onClick={() => setCreateOpen(false)} className="h-10 rounded-md border border-zinc-700 bg-zinc-800 px-4 text-xs font-semibold uppercase">Cancelar</button><button type="submit" disabled={saving} className="h-10 rounded-md bg-[#ccff00] px-4 text-xs font-bold uppercase text-black disabled:opacity-60">Criar contrato</button></div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
