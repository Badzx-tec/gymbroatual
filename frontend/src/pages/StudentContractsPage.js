import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Filter, Plus, RefreshCw, ShieldCheck, Wallet, Timer } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import {
  accessStatusLabel,
  contractStatusLabel,
  financialStatusLabel,
} from '../utils/labels';

const emptyForm = {
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

const emptyActionForm = {
  freeze_end_at: '',
  freeze_reason: '',
  cancel_mode: 'end_of_cycle',
  cancel_reason: '',
  manual_end_at: '',
  manual_amount: '',
  manual_reason: '',
};

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
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - timezoneOffset);
  return local.toISOString().slice(0, 16);
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
  if (['active', 'paid', 'allowed'].includes(normalized)) {
    return 'bg-green-500/15 border-green-500/30 text-green-300';
  }
  if (['pending', 'open', 'scheduled_cancel', 'scheduled_freeze', 'grace_period', 'pending_activation'].includes(normalized)) {
    return 'bg-blue-500/15 border-blue-500/30 text-blue-300';
  }
  if (['frozen', 'overdue', 'failed', 'suspended', 'partially_paid'].includes(normalized)) {
    return 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300';
  }
  return 'bg-red-500/15 border-red-500/30 text-red-300';
}

function normalizeEventLabel(value) {
  const normalized = String(value || '').toLowerCase().trim();
  if (!normalized) return '-';
  return normalized.replaceAll('_', ' ');
}

export default function StudentContractsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [overview, setOverview] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [reconcileRuns, setReconcileRuns] = useState([]);
  const [students, setStudents] = useState([]);
  const [plans, setPlans] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState({ contract: null, charges: [], events: [] });
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [manualEndEdited, setManualEndEdited] = useState(false);
  const [actionForm, setActionForm] = useState(emptyActionForm);
  const [filters, setFilters] = useState({
    q: '',
    contract_status: '',
    financial_status: '',
    access_status: '',
    plan_id: '',
  });

  const user = useMemo(() => JSON.parse(localStorage.getItem('gymbro_user') || '{}'), []);
  const role = String(user.role || '').toUpperCase();
  const canCreateContracts = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);
  const canManageContractRules = ['OWNER', 'MANAGER'].includes(role);

  const plansById = useMemo(() => {
    const map = new Map();
    plans.forEach((plan) => map.set(plan.plan_id, plan));
    return map;
  }, [plans]);

  const recalcEndAt = (nextForm) => {
    if (manualEndEdited) return nextForm;
    const plan = plansById.get(nextForm.plan_id);
    const durationFromPlan = Number(plan?.duracao_dias || 0);
    const duration = Number(nextForm.duration_days || durationFromPlan || 0);
    if (!nextForm.start_at || duration <= 0) {
      return { ...nextForm, end_at: nextForm.end_at || '' };
    }
    const start = new Date(nextForm.start_at);
    if (Number.isNaN(start.getTime())) return nextForm;
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + duration);
    return { ...nextForm, end_at: toLocalDateInput(end.toISOString()) };
  };

  const load = async () => {
    setLoading(true);
    try {
      const [overviewData, contractsData, studentsData, plansData, reconcileData] = await Promise.all([
        api.studentBillingOverview(),
        api.listStudentContracts({ ...filters, limit: 300 }),
        api.listStudents('', ''),
        api.listPlans(),
        canManageContractRules ? api.listStudentBillingReconcileRuns(20) : Promise.resolve([]),
      ]);
      setOverview(overviewData || {});
      setContracts(Array.isArray(contractsData) ? contractsData : []);
      setStudents(Array.isArray(studentsData) ? studentsData : []);
      setPlans(Array.isArray(plansData) ? plansData : []);
      setReconcileRuns(Array.isArray(reconcileData) ? reconcileData : []);
      if (!selectedId && contractsData?.length) {
        setSelectedId(contractsData[0].contract_id);
      } else if (selectedId && !contractsData.some((item) => item.contract_id === selectedId)) {
        setSelectedId(contractsData[0]?.contract_id || '');
      }
    } catch (err) {
      toast.error(err?.message || 'Erro ao carregar contratos');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (contractId) => {
    if (!contractId) {
      setDetail({ contract: null, charges: [], events: [] });
      return;
    }
    try {
      const response = await api.getStudentContractDetail(contractId);
      const contract = response?.contract || null;
      setDetail({ contract, charges: response?.charges || [], events: response?.events || [] });
      setActionForm({
        ...emptyActionForm,
        manual_end_at: toLocalDateInput(contract?.current_period_end),
        manual_amount: String(contract?.amount || ''),
      });
    } catch (err) {
      toast.error(err?.message || 'Erro ao carregar detalhe do contrato');
    }
  };

  useEffect(() => {
    load();
  }, [filters.contract_status, filters.financial_status, filters.access_status, filters.plan_id]);

  useEffect(() => {
    const timeout = setTimeout(() => load(), 300);
    return () => clearTimeout(timeout);
  }, [filters.q]);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId]);

  const runAction = async (fn, msg) => {
    setSaving(true);
    try {
      await fn();
      toast.success(msg);
      await load();
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      toast.error(err?.message || 'Falha ao executar acao');
    } finally {
      setSaving(false);
    }
  };

  const runReconcile = async () => {
    if (!canManageContractRules) {
      toast.error('Somente Dono da academia ou Diretor pode rodar reconciliacao.');
      return;
    }
    setSaving(true);
    try {
      const response = await api.runStudentBillingReconcile(500);
      const summary = response?.summary || {};
      toast.success(`Reconciliacao concluida (#${response?.run_id || '-'}) - contratos atualizados: ${summary.contracts_updated || 0}, cobrancas vencidas: ${summary.charge_overdue_marked || 0}.`);
      await load();
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      toast.error(err?.message || 'Erro ao rodar reconciliacao.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!canCreateContracts) {
      toast.error('Sem permissao para criar contrato.');
      return;
    }
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
    await runAction(async () => {
      await api.createStudentContract(payload);
      setCreateOpen(false);
      setForm(emptyForm);
      setManualEndEdited(false);
    }, 'Contrato criado com sucesso.');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 p-5">
        <div className="absolute -top-24 -right-20 h-56 w-56 rounded-full bg-[#ccff00]/10 blur-3xl" />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Central de contratos</h1>
            <p className="text-zinc-300/80 text-sm mt-1">Ciclo contratual, financeiro e acesso em um fluxo unico com controle operacional.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={load} className="h-10 px-4 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold uppercase tracking-wide inline-flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Atualizar
            </button>
            {canManageContractRules && (
              <button disabled={saving} onClick={runReconcile} className="h-10 px-4 rounded-sm bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold uppercase tracking-wide disabled:opacity-60">
                Rodar reconciliacao
              </button>
            )}
            {canCreateContracts && (
              <button onClick={() => { setForm(emptyForm); setManualEndEdited(false); setCreateOpen(true); }} className="h-10 px-4 rounded-sm bg-[#ccff00] hover:bg-[#b3e600] text-black text-xs font-bold uppercase tracking-wide inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Novo contrato
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3"><p className="text-zinc-500 text-xs uppercase inline-flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Contratos</p><p className="text-2xl font-bold">{overview?.total_contracts || 0}</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3"><p className="text-zinc-500 text-xs uppercase inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Ativos</p><p className="text-2xl font-bold text-green-300">{overview?.active_contracts || 0}</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3"><p className="text-zinc-500 text-xs uppercase inline-flex items-center gap-1"><Timer className="w-3.5 h-3.5" /> Congelados</p><p className="text-2xl font-bold text-blue-300">{overview?.frozen_contracts || 0}</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3"><p className="text-zinc-500 text-xs uppercase inline-flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Recebido no mes</p><p className="text-2xl font-bold">{formatMoney(overview?.month_received_amount || 0)}</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3"><p className="text-zinc-500 text-xs uppercase inline-flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> Cobrancas em atraso</p><p className="text-2xl font-bold text-red-300">{overview?.overdue_charges || 0}</p></div>
      </div>

      {canManageContractRules && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3">
          <div className="flex items-center justify-between gap-3 mb-2"><p className="text-xs uppercase tracking-wide text-zinc-500">Ultimas reconciliacoes</p><p className="text-[11px] text-zinc-500">Historico operacional do financeiro e de acesso</p></div>
          {reconcileRuns.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
              {reconcileRuns.slice(0, 8).map((run) => (
                <div key={run.run_id} className="border border-zinc-800 rounded-sm p-2 text-xs space-y-1">
                  <p className="font-semibold text-zinc-200">#{run.run_id}</p>
                  <p className="text-zinc-500">{formatDate(run.finished_at || run.started_at)}</p>
                  <p className="text-zinc-400">Atualizados: {Number(run?.summary?.contracts_updated || 0)} | Overdue: {Number(run?.summary?.charge_overdue_marked || 0)}</p>
                  <p className="text-zinc-500">Duracao: {formatDurationMs(run.duration_ms)}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-zinc-500">Sem execucoes de reconciliacao registradas ainda.</p>}
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3 grid grid-cols-1 md:grid-cols-5 gap-2">
        <div className="relative md:col-span-2">
          <Filter className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={filters.q} onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))} placeholder="Buscar por aluno, plano ou contrato..." className="w-full h-10 pl-9 pr-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
        </div>
        <select value={filters.contract_status} onChange={(event) => setFilters((prev) => ({ ...prev, contract_status: event.target.value }))} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm">
          <option value="">Status contratual</option><option value="active">Ativo</option><option value="pending_activation">Aguardando ativacao</option><option value="frozen">Congelado</option><option value="scheduled_cancel">Cancelamento agendado</option><option value="scheduled_freeze">Congelamento agendado</option><option value="canceled">Cancelado</option><option value="expired">Expirado</option>
        </select>
        <select value={filters.financial_status} onChange={(event) => setFilters((prev) => ({ ...prev, financial_status: event.target.value }))} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm">
          <option value="">Status financeiro</option><option value="paid">Pago</option><option value="pending">Pendente</option><option value="open">Aberto</option><option value="overdue">Atrasado</option><option value="failed">Falhou</option><option value="partially_paid">Pago parcialmente</option>
        </select>
        <select value={filters.access_status} onChange={(event) => setFilters((prev) => ({ ...prev, access_status: event.target.value }))} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm">
          <option value="">Status de acesso</option><option value="allowed">Liberado</option><option value="blocked">Bloqueado</option><option value="grace_period">Carencia</option><option value="suspended">Suspenso</option>
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.7fr,1fr] gap-6">
        <div className="space-y-3">
          {contracts.map((item) => (
            <button key={item.contract_id} type="button" onClick={() => setSelectedId(item.contract_id)} className={`w-full text-left bg-zinc-900 border rounded-md p-4 transition ${selectedId === item.contract_id ? 'border-[#ccff00]/60 bg-[#ccff00]/5' : 'border-zinc-800 hover:border-zinc-700'}`}>
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div><p className="font-semibold text-zinc-100">{item.student_name}</p><p className="text-xs text-zinc-500">{item.contract_id}</p><p className="text-xs text-zinc-400 mt-1">{item.plan_name || 'Sem plano'}</p></div>
                <div className="text-xs text-zinc-400 md:text-right"><p>Vencimento: {formatDate(item.current_period_end)}</p>{item.next_retry_at && <p>Prox. tentativa: {formatDate(item.next_retry_at)}</p>}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${badgeClass(item.contract_status)}`}>{contractStatusLabel(item.contract_status)}</span>
                <span className={`px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${badgeClass(item.financial_status)}`}>{financialStatusLabel(item.financial_status)}</span>
                <span className={`px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${badgeClass(item.access_status)}`}>{accessStatusLabel(item.access_status)}</span>
              </div>
              {item.access_status === 'grace_period' && <p className="text-[11px] text-zinc-500 mt-2">Carencia ate {formatDate(item.grace_until)}</p>}
            </button>
          ))}
          {!contracts.length && <div className="bg-zinc-900 border border-zinc-800 rounded-md p-6 text-center text-zinc-500">Nenhum contrato encontrado com os filtros atuais.</div>}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-4">
          <h2 className="font-semibold uppercase text-sm tracking-wide">Contrato selecionado</h2>
          {!detail.contract && <p className="text-zinc-500 text-sm">Selecione um contrato para ver os detalhes.</p>}
          {detail.contract && (
            <>
              <div className="space-y-1 text-sm">
                <p><span className="text-zinc-500">Aluno:</span> {detail.contract.student_name}</p>
                <p><span className="text-zinc-500">Plano:</span> {detail.contract.plan_name || '-'}</p>
                <p><span className="text-zinc-500">Valor:</span> {formatMoney(detail.contract.amount)}</p>
                <p><span className="text-zinc-500">Periodo:</span> {formatDate(detail.contract.current_period_start)} ate {formatDate(detail.contract.current_period_end)}</p>
                <p><span className="text-zinc-500">Carencia:</span> {detail.contract.grace_until ? formatDate(detail.contract.grace_until) : '-'}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button disabled={saving} onClick={() => runAction(() => api.renewStudentContract(detail.contract.contract_id, { duration_days: Number(detail.contract.duration_days || 30), create_charge: true }), 'Contrato renovado.')} className="h-9 rounded-sm bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-semibold uppercase disabled:opacity-60">
                  Renovar
                </button>
                {canManageContractRules && (
                  <button disabled={saving} onClick={() => runAction(() => api.cancelStudentContract(detail.contract.contract_id, { mode: actionForm.cancel_mode, reason: actionForm.cancel_reason || 'cancelamento administrativo' }), actionForm.cancel_mode === 'immediate' ? 'Contrato cancelado.' : 'Cancelamento agendado.')} className="h-9 rounded-sm bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-semibold uppercase disabled:opacity-60">
                    Cancelar
                  </button>
                )}
              </div>

              {canManageContractRules && (
                <div className="space-y-2 border border-zinc-800 rounded-sm p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Cancelamento</p>
                  <select value={actionForm.cancel_mode} onChange={(event) => setActionForm((prev) => ({ ...prev, cancel_mode: event.target.value }))} className="h-9 w-full px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-xs">
                    <option value="end_of_cycle">No fim do ciclo</option>
                    <option value="immediate">Imediato</option>
                  </select>
                  <input value={actionForm.cancel_reason} onChange={(event) => setActionForm((prev) => ({ ...prev, cancel_reason: event.target.value }))} placeholder="Motivo do cancelamento" className="h-9 w-full px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-xs" />
                </div>
              )}

              {canManageContractRules && (
                <div className="space-y-2 border border-zinc-800 rounded-sm p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Ajustes manuais</p>
                  <input type="datetime-local" value={actionForm.manual_end_at} onChange={(event) => setActionForm((prev) => ({ ...prev, manual_end_at: event.target.value }))} className="h-9 w-full px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-xs" />
                  <input type="number" min="0.01" step="0.01" value={actionForm.manual_amount} onChange={(event) => setActionForm((prev) => ({ ...prev, manual_amount: event.target.value }))} placeholder="Valor ajustado" className="h-9 w-full px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-xs" />
                  <input value={actionForm.manual_reason} onChange={(event) => setActionForm((prev) => ({ ...prev, manual_reason: event.target.value }))} placeholder="Motivo do ajuste" className="h-9 w-full px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-xs" />
                  <button disabled={saving} onClick={() => runAction(() => api.updateStudentContract(detail.contract.contract_id, { end_at: toIsoDate(actionForm.manual_end_at) || undefined, amount: actionForm.manual_amount ? Number(actionForm.manual_amount) : undefined, manual_override_reason: actionForm.manual_reason || undefined }), 'Contrato atualizado.')} className="w-full h-9 rounded-sm bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 text-xs font-semibold uppercase disabled:opacity-60">
                    Salvar ajuste
                  </button>
                </div>
              )}

              {canManageContractRules && (
                <div className="space-y-2 border border-zinc-800 rounded-sm p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Congelamento</p>
                  <input type="datetime-local" value={actionForm.freeze_end_at} onChange={(event) => setActionForm((prev) => ({ ...prev, freeze_end_at: event.target.value }))} className="h-9 w-full px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-xs" />
                  <input value={actionForm.freeze_reason} onChange={(event) => setActionForm((prev) => ({ ...prev, freeze_reason: event.target.value }))} placeholder="Motivo do congelamento" className="h-9 w-full px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-xs" />
                  <div className="grid grid-cols-2 gap-2">
                    <button disabled={saving || !actionForm.freeze_end_at} onClick={() => runAction(() => api.freezeStudentContract(detail.contract.contract_id, { end_at: toIsoDate(actionForm.freeze_end_at), reason: actionForm.freeze_reason || undefined, pause_charges: true, extend_end_by_frozen_days: true }), 'Contrato congelado.')} className="h-9 rounded-sm bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-xs font-semibold uppercase disabled:opacity-60">Congelar</button>
                    <button disabled={saving} onClick={() => runAction(() => api.resumeStudentContract(detail.contract.contract_id, {}), 'Contrato retomado.')} className="h-9 rounded-sm bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 text-xs font-semibold uppercase disabled:opacity-60">Retomar</button>
                  </div>
                </div>
              )}

              <div className="border border-zinc-800 rounded-sm p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Ultimas cobrancas</p>
                <ul className="space-y-1 max-h-32 overflow-auto text-xs">
                  {detail.charges.slice(0, 8).map((charge) => (
                    <li key={charge.charge_id} className="flex items-center justify-between gap-2">
                      <span className="text-zinc-300">{formatDate(charge.due_at)}</span>
                      <span>{formatMoney(charge.amount)}</span>
                      <span className={`px-2 py-0.5 rounded-sm border uppercase ${badgeClass(charge.status)}`}>{financialStatusLabel(charge.status)}</span>
                    </li>
                  ))}
                  {!detail.charges.length && <li className="text-zinc-500">Sem cobrancas.</li>}
                </ul>
              </div>

              <div className="border border-zinc-800 rounded-sm p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Timeline</p>
                <ul className="space-y-1 max-h-40 overflow-auto text-xs">
                  {detail.events.slice(0, 10).map((event) => (
                    <li key={event.event_id} className="border border-zinc-800 rounded-sm px-2 py-1">
                      <p className="font-semibold uppercase">{normalizeEventLabel(event.event_type)}</p>
                      <p className="text-zinc-500">{formatDate(event.created_at)}</p>
                    </li>
                  ))}
                  {!detail.events.length && <li className="text-zinc-500">Sem eventos.</li>}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCreateOpen(false)}>
          <div className="w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-md p-5 space-y-3" onClick={(event) => event.stopPropagation()}>
            <h3 className="font-heading text-xl uppercase">Novo contrato</h3>
            <p className="text-xs text-zinc-500">O vencimento e calculado automaticamente com base no plano e na data de inicio, com opcao de ajuste manual.</p>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <select required value={form.student_id} onChange={(event) => setForm((prev) => ({ ...prev, student_id: event.target.value }))} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm md:col-span-2">
                <option value="">Aluno</option>
                {students.map((student) => (<option key={student.student_id} value={student.student_id}>{student.nome}</option>))}
              </select>
              <select value={form.plan_id} onChange={(event) => {
                const next = { ...form, plan_id: event.target.value };
                const selectedPlan = plansById.get(event.target.value);
                if (selectedPlan?.duracao_dias && !form.duration_days) next.duration_days = String(selectedPlan.duracao_dias);
                if (selectedPlan?.valor && !form.amount) next.amount = String(selectedPlan.valor);
                setForm(recalcEndAt(next));
              }} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm">
                <option value="">Plano</option>
                {plans.map((plan) => (<option key={plan.plan_id} value={plan.plan_id}>{plan.nome}</option>))}
              </select>
              <input type="number" min="0.01" step="0.01" placeholder="Valor aplicado" value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
              <input type="datetime-local" value={form.start_at} onChange={(event) => setForm((prev) => recalcEndAt({ ...prev, start_at: event.target.value }))} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
              <input type="number" min="1" placeholder="Duracao (dias)" value={form.duration_days} onChange={(event) => setForm((prev) => recalcEndAt({ ...prev, duration_days: event.target.value }))} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
              <input type="datetime-local" value={form.end_at} onChange={(event) => { setManualEndEdited(Boolean(event.target.value)); setForm((prev) => ({ ...prev, end_at: event.target.value })); }} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
              <select value={form.payment_method} onChange={(event) => setForm((prev) => ({ ...prev, payment_method: event.target.value }))} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm">
                <option value="pix">PIX</option><option value="card">Cartao</option><option value="cash">Dinheiro</option><option value="boleto">Boleto</option><option value="transfer">Transferencia</option>
              </select>
              <label className="text-xs text-zinc-400 flex items-center gap-2"><input type="checkbox" checked={form.auto_renew} onChange={(event) => setForm((prev) => ({ ...prev, auto_renew: event.target.checked }))} /> Renovacao automatica</label>
              <label className="text-xs text-zinc-400 flex items-center gap-2"><input type="checkbox" checked={form.create_initial_charge} onChange={(event) => setForm((prev) => ({ ...prev, create_initial_charge: event.target.checked }))} /> Criar cobranca inicial</label>
              <button type="submit" className="h-10 px-4 rounded-sm bg-[#ccff00] text-black text-xs font-bold uppercase tracking-wide md:col-span-2">Criar contrato</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
