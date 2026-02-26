import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  FileText,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

const emptyContractForm = {
  student_id: '',
  plan_id: '',
  amount: '',
  duration_days: '30',
  start_at: '',
  end_at: '',
  manual_end_override: false,
  auto_renew: false,
  notes: '',
  create_initial_charge: true,
};

const emptyChargeForm = {
  amount: '',
  due_at: '',
  notes: '',
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

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active' || normalized === 'paid') return 'bg-green-500/15 border-green-500/30 text-green-300';
  if (normalized === 'open') return 'bg-blue-500/15 border-blue-500/30 text-blue-300';
  if (normalized === 'past_due' || normalized === 'overdue') return 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300';
  if (normalized === 'canceled' || normalized === 'expired') return 'bg-red-500/15 border-red-500/30 text-red-300';
  return 'bg-zinc-500/15 border-zinc-500/30 text-zinc-300';
}

function statusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return 'Ativo';
  if (normalized === 'paid') return 'Pago';
  if (normalized === 'open') return 'Aberto';
  if (normalized === 'past_due') return 'Atrasado';
  if (normalized === 'overdue') return 'Vencido';
  if (normalized === 'canceled') return 'Cancelado';
  if (normalized === 'expired') return 'Expirado';
  return status || '-';
}

function toIsoDateStart(value) {
  if (!value) return undefined;
  return value;
}

function addDaysToDateString(dateString, days) {
  if (!dateString || !days) return '';
  const [year, month, day] = String(dateString).split('-').map((item) => Number(item));
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Math.max(1, Number(days)));
  return date.toISOString().slice(0, 10);
}

function eventLabel(value) {
  return String(value || '-')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function StudentContractsPage() {
  const [loading, setLoading] = useState(true);
  const [savingContract, setSavingContract] = useState(false);
  const [savingCharge, setSavingCharge] = useState(false);
  const [cancelingContract, setCancelingContract] = useState(false);
  const [overview, setOverview] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [students, setStudents] = useState([]);
  const [plans, setPlans] = useState([]);
  const [events, setEvents] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterStudent, setFilterStudent] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractForm, setContractForm] = useState(emptyContractForm);
  const [chargeForm, setChargeForm] = useState(emptyChargeForm);
  const [selectedContract, setSelectedContract] = useState(null);
  const [charges, setCharges] = useState([]);
  const [chargesLoading, setChargesLoading] = useState(false);
  const [cleaningCharges, setCleaningCharges] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [extendContractOnPayment, setExtendContractOnPayment] = useState(true);

  const user = useMemo(() => JSON.parse(localStorage.getItem('gymbro_user') || '{}'), []);
  const role = String(user.role || 'OWNER').toUpperCase();
  const canManageContracts = ['OWNER', 'MANAGER'].includes(role);

  const loadStaticData = async () => {
    const [studentsData, plansData] = await Promise.all([api.listStudents('', ''), api.listPlans()]);
    setStudents(studentsData);
    setPlans(plansData);
  };

  const loadOverview = async () => {
    const [overviewData, eventsData] = await Promise.all([
      api.studentBillingOverview(),
      api.listStudentBillingEvents(10),
    ]);
    setOverview(overviewData);
    setEvents(eventsData);
  };

  const loadContracts = async () => {
    const data = await api.listStudentContracts({
      status: filterStatus,
      student_id: filterStudent,
      limit: 300,
    });
    setContracts(data);
    setSelectedContract((previous) => {
      if (!data.length) return null;
      if (previous?.contract_id) {
        const sameContract = data.find((item) => item.contract_id === previous.contract_id);
        if (sameContract) return sameContract;
      }
      return data[0];
    });
    return data;
  };

  const loadCharges = async (contractId) => {
    if (!contractId) {
      setCharges([]);
      return;
    }
    setChargesLoading(true);
    try {
      const data = await api.listContractCharges(contractId, 300);
      setCharges(data);
    } catch (err) {
      toast.error(err?.message || 'Erro ao carregar cobrancas');
    } finally {
      setChargesLoading(false);
    }
  };

  const refreshAll = async () => {
    setLoading(true);
    try {
      await Promise.all([loadStaticData(), loadOverview(), loadContracts()]);
    } catch (err) {
      toast.error(err?.message || 'Erro ao atualizar contratos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    if (!loading) {
      loadContracts().catch((err) => toast.error(err?.message || 'Erro ao carregar contratos'));
    }
  }, [filterStatus, filterStudent]);

  useEffect(() => {
    if (selectedContract?.contract_id) {
      loadCharges(selectedContract.contract_id);
    }
  }, [selectedContract?.contract_id]);

  useEffect(() => {
    if (!selectedContract?.contract_id) return;
    const updated = contracts.find((item) => item.contract_id === selectedContract.contract_id);
    if (!updated) {
      setSelectedContract(null);
      return;
    }
    setSelectedContract(updated);
  }, [contracts, selectedContract?.contract_id]);

  const selectedStudentName = useMemo(() => {
    if (!selectedContract) return '-';
    return selectedContract.student_name || students.find((s) => s.student_id === selectedContract.student_id)?.nome || '-';
  }, [selectedContract, students]);

  const selectedPlanForForm = useMemo(
    () => plans.find((plan) => plan.plan_id === contractForm.plan_id) || null,
    [plans, contractForm.plan_id],
  );

  const visibleContracts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return contracts;
    return contracts.filter((contract) => {
      const studentName = String(contract.student_name || '').toLowerCase();
      const contractId = String(contract.contract_id || '').toLowerCase();
      const planName = String(contract.plan_name || '').toLowerCase();
      return studentName.includes(term) || contractId.includes(term) || planName.includes(term);
    });
  }, [contracts, searchTerm]);

  const chargeStats = useMemo(() => {
    const summary = { open: 0, overdue: 0, paid: 0, canceled: 0 };
    charges.forEach((charge) => {
      const key = String(charge.status || '').toLowerCase();
      if (summary[key] !== undefined) summary[key] += 1;
    });
    return summary;
  }, [charges]);

  useEffect(() => {
    if (!contractModalOpen) return;
    if (contractForm.manual_end_override) return;
    const durationDays = Number(contractForm.duration_days || selectedPlanForForm?.duracao_dias || 0);
    if (!contractForm.start_at || !durationDays) {
      if (contractForm.end_at) {
        setContractForm((prev) => ({ ...prev, end_at: '' }));
      }
      return;
    }
    const nextEnd = addDaysToDateString(contractForm.start_at, durationDays);
    if (nextEnd && contractForm.end_at !== nextEnd) {
      setContractForm((prev) => ({ ...prev, end_at: nextEnd }));
    }
  }, [
    contractModalOpen,
    contractForm.manual_end_override,
    contractForm.start_at,
    contractForm.duration_days,
    selectedPlanForForm?.duracao_dias,
  ]);

  const openCreateModal = () => {
    setContractForm(emptyContractForm);
    setContractModalOpen(true);
  };

  const handleCreateContract = async (event) => {
    event.preventDefault();
    if (!contractForm.student_id) {
      toast.error('Selecione um aluno');
      return;
    }

    setSavingContract(true);
    try {
      const payload = {
        student_id: contractForm.student_id,
        plan_id: contractForm.plan_id || undefined,
        amount: contractForm.amount ? Number(contractForm.amount) : undefined,
        duration_days: contractForm.duration_days ? Number(contractForm.duration_days) : undefined,
        start_at: toIsoDateStart(contractForm.start_at),
        end_at: toIsoDateStart(contractForm.end_at),
        auto_renew: !!contractForm.auto_renew,
        notes: contractForm.notes || undefined,
        create_initial_charge: !!contractForm.create_initial_charge,
      };
      await api.createStudentContract(payload);
      toast.success('Contrato criado com sucesso');
      setContractModalOpen(false);
      await Promise.all([loadOverview(), loadContracts()]);
    } catch (err) {
      toast.error(err?.message || 'Erro ao criar contrato');
    } finally {
      setSavingContract(false);
    }
  };

  const handleCancelContract = async (contractId = null) => {
    const targetId = contractId || selectedContract?.contract_id;
    if (!targetId) {
      toast.error('Selecione um contrato');
      return;
    }
    if (!window.confirm('Cancelar este contrato?')) return;
    setCancelingContract(true);
    try {
      await api.cancelStudentContract(targetId);
      toast.success('Contrato cancelado');
      await Promise.all([loadOverview(), loadContracts()]);
    } catch (err) {
      toast.error(err?.message || 'Erro ao cancelar contrato');
    } finally {
      setCancelingContract(false);
    }
  };

  const handleCreateCharge = async (event) => {
    event.preventDefault();
    if (!selectedContract?.contract_id) return;
    setSavingCharge(true);
    try {
      await api.createContractCharge(selectedContract.contract_id, {
        amount: chargeForm.amount ? Number(chargeForm.amount) : undefined,
        due_at: toIsoDateStart(chargeForm.due_at),
        notes: chargeForm.notes || undefined,
      });
      toast.success('Cobranca criada');
      setChargeForm(emptyChargeForm);
      await Promise.all([loadOverview(), loadContracts(), loadCharges(selectedContract.contract_id)]);
    } catch (err) {
      toast.error(err?.message || 'Erro ao criar cobranca');
    } finally {
      setSavingCharge(false);
    }
  };

  const handleMarkPaid = async (chargeId) => {
    try {
      await api.markStudentChargePaid(chargeId, {
        payment_method: paymentMethod,
        extend_contract: extendContractOnPayment,
      });
      toast.success('Cobranca marcada como paga');
      if (selectedContract?.contract_id) {
        await Promise.all([loadOverview(), loadContracts(), loadCharges(selectedContract.contract_id)]);
      }
    } catch (err) {
      toast.error(err?.message || 'Erro ao marcar cobranca como paga');
    }
  };

  const handleCleanupCharges = async (contract = null) => {
    const targetContract = contract || selectedContract;
    if (!targetContract?.contract_id) {
      toast.error('Selecione um contrato');
      return;
    }
    const confirmed = window.confirm(
      `Cancelar todas as cobrancas pendentes do contrato ${targetContract.contract_id}?`
    );
    if (!confirmed) return;

    setCleaningCharges(true);
    try {
      const result = await api.cleanupContractCharges(targetContract.contract_id, {
        status_filter: 'pending',
        reason: 'cleanup_manual_panel',
      });
      toast.success(`${result.cleaned_count || 0} cobranca(s) cancelada(s)`);
      await Promise.all([
        loadOverview(),
        loadContracts(),
        loadCharges(targetContract.contract_id),
      ]);
    } catch (err) {
      toast.error(err?.message || 'Erro ao limpar cobrancas');
    } finally {
      setCleaningCharges(false);
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
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-800 border border-zinc-800 rounded-md p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Contratos</h1>
            <p className="text-zinc-400 mt-1">Workspace profissional para contratos, cobrancas e renovacoes.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={refreshAll} className="h-10 px-4 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold uppercase tracking-wide inline-flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Atualizar
            </button>
            {canManageContracts && (
              <button onClick={openCreateModal} className="h-10 px-4 rounded-sm bg-[#ccff00] hover:bg-[#b3e600] text-black text-xs font-bold uppercase tracking-wide inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Novo contrato
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" /> Contratos</p>
          <p className="text-2xl font-bold mt-2">{overview?.total_contracts || 0}</p>
          <p className="text-xs text-zinc-500 mt-1">Ativos: {overview?.active_contracts || 0}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> Em risco</p>
          <p className="text-2xl font-bold mt-2">{overview?.past_due_contracts || 0}</p>
          <p className="text-xs text-zinc-500 mt-1">Vencidas: {overview?.overdue_charges || 0}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> Vencendo em 7 dias</p>
          <p className="text-2xl font-bold mt-2">{overview?.expiring_next_7d || 0}</p>
          <p className="text-xs text-zinc-500 mt-1">Abertas: {overview?.open_charges || 0}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1"><CircleDollarSign className="w-3.5 h-3.5" /> Recebido no mes</p>
          <p className="text-2xl font-bold mt-2">{formatMoney(overview?.month_received_amount || 0)}</p>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-6">
        <div className="xl:w-2/3 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 flex flex-col lg:flex-row gap-3">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm lg:w-40">
              <option value="">Todos os status</option>
              <option value="active">Ativo</option>
              <option value="past_due">Atrasado</option>
              <option value="expired">Expirado</option>
              <option value="canceled">Cancelado</option>
            </select>
            <select value={filterStudent} onChange={(e) => setFilterStudent(e.target.value)} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm lg:flex-1">
              <option value="">Todos os alunos</option>
              {students.map((student) => (
                <option key={student.student_id} value={student.student_id}>{student.nome}</option>
              ))}
            </select>
            <div className="relative lg:w-64">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar contrato/aluno"
                className="w-full h-10 pl-9 pr-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm"
              />
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Aluno</th>
                  <th className="text-left px-4 py-3">Plano</th>
                  <th className="text-left px-4 py-3">Valor</th>
                  <th className="text-left px-4 py-3">Vigencia ate</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {visibleContracts.map((contract) => {
                  const selected = selectedContract?.contract_id === contract.contract_id;
                  return (
                    <tr
                      key={contract.contract_id}
                      onClick={() => setSelectedContract(contract)}
                      className={`border-b border-zinc-800/50 cursor-pointer transition-colors ${selected ? 'bg-zinc-800/45' : 'hover:bg-zinc-800/30'}`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{contract.student_name}</p>
                        <p className="text-xs text-zinc-500">{contract.contract_id}</p>
                      </td>
                      <td className="px-4 py-3">{contract.plan_name || '-'}</td>
                      <td className="px-4 py-3">{formatMoney(contract.amount)}</td>
                      <td className="px-4 py-3 text-zinc-400">{formatDate(contract.current_period_end)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-sm border text-xs font-semibold uppercase ${statusClass(contract.status)}`}>
                          {statusLabel(contract.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                          <button onClick={() => setSelectedContract(contract)} className="h-8 px-3 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-[11px] font-semibold uppercase tracking-wide">
                            Gerenciar
                          </button>
                          {canManageContracts && (
                            <button
                              onClick={() => handleCleanupCharges(contract)}
                              disabled={cleaningCharges}
                              className="h-8 px-3 rounded-sm bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-[11px] font-semibold uppercase tracking-wide disabled:opacity-60"
                            >
                              Limpar pendentes
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleContracts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Nenhum contrato encontrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="xl:w-1/3 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
            <h2 className="font-semibold uppercase tracking-wide text-sm flex items-center gap-2"><ListChecks className="w-4 h-4" /> Painel do contrato</h2>
            {!selectedContract && (
              <div className="mt-3 border border-dashed border-zinc-700 rounded-sm p-3 text-sm text-zinc-500">
                Selecione um contrato na tabela para abrir a gestao de cobrancas.
              </div>
            )}
            {selectedContract && (
              <div className="space-y-3 text-sm mt-3">
                <div>
                  <p className="text-zinc-500">Aluno</p>
                  <p className="font-semibold">{selectedStudentName}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Status</p>
                  <p className={`inline-flex px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${statusClass(selectedContract.status)}`}>
                    {statusLabel(selectedContract.status)}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">Periodo atual</p>
                  <p>{formatDate(selectedContract.current_period_start)} - {formatDate(selectedContract.current_period_end)}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={() => handleCleanupCharges()}
                    disabled={cleaningCharges || !canManageContracts}
                    className="h-9 px-3 rounded-sm bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-semibold uppercase tracking-wide disabled:opacity-60 inline-flex items-center justify-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> {cleaningCharges ? 'Limpando...' : 'Limpar pendentes'}
                  </button>
                  <button
                    onClick={() => handleCancelContract()}
                    disabled={cancelingContract || !canManageContracts}
                    className="h-9 px-3 rounded-sm bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-semibold uppercase tracking-wide disabled:opacity-60"
                  >
                    {cancelingContract ? 'Cancelando...' : 'Cancelar contrato'}
                  </button>
                  <button
                    onClick={() => document.getElementById('charge-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    className="h-9 px-3 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold uppercase tracking-wide"
                  >
                    Nova cobranca
                  </button>
                  <button onClick={() => setSelectedContract(null)} className="h-9 px-3 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold uppercase tracking-wide">
                    Limpar selecao
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
            <h2 className="font-semibold uppercase tracking-wide text-sm flex items-center gap-2"><FileText className="w-4 h-4" /> Timeline</h2>
            <ul className="mt-3 space-y-2 text-xs max-h-[360px] overflow-auto pr-1">
              {events.map((item) => (
                <li key={item.event_id} className="border border-zinc-800 rounded-sm px-3 py-2">
                  <p className="font-semibold uppercase">{eventLabel(item.event_type)}</p>
                  <p className="text-zinc-500 mt-1">{formatDate(item.created_at)}</p>
                </li>
              ))}
              {events.length === 0 && <li className="text-zinc-500">Sem eventos</li>}
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <h2 className="font-semibold uppercase tracking-wide text-sm">
            {selectedContract ? `Cobrancas do contrato ${selectedContract.contract_id}` : 'Workspace de cobrancas'}
          </h2>
          {selectedContract && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 rounded-sm border border-blue-500/30 bg-blue-500/10 text-blue-300">Abertas: {chargeStats.open}</span>
              <span className="px-2 py-1 rounded-sm border border-yellow-500/30 bg-yellow-500/10 text-yellow-300">Vencidas: {chargeStats.overdue}</span>
              <span className="px-2 py-1 rounded-sm border border-green-500/30 bg-green-500/10 text-green-300">Pagas: {chargeStats.paid}</span>
              <span className="px-2 py-1 rounded-sm border border-zinc-600 bg-zinc-800 text-zinc-300">Canceladas: {chargeStats.canceled}</span>
            </div>
          )}
        </div>

        {!selectedContract && (
          <div className="border border-dashed border-zinc-700 rounded-sm p-4 text-sm text-zinc-500">
            Selecione um contrato para criar, limpar ou marcar cobrancas.
          </div>
        )}

        {selectedContract && (
          <>
            <form id="charge-form" onSubmit={handleCreateCharge} className="grid grid-cols-1 md:grid-cols-12 gap-2">
              <input type="number" min="0.01" step="0.01" value={chargeForm.amount} onChange={(event) => setChargeForm({ ...chargeForm, amount: event.target.value })} placeholder="Valor" className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm md:col-span-2" />
              <input type="date" value={chargeForm.due_at} onChange={(event) => setChargeForm({ ...chargeForm, due_at: event.target.value })} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm md:col-span-2" />
              <input value={chargeForm.notes} onChange={(event) => setChargeForm({ ...chargeForm, notes: event.target.value })} placeholder="Observacao" className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm md:col-span-5" />
              <button disabled={savingCharge} className="h-10 px-3 rounded-sm bg-[#ccff00] hover:bg-[#b3e600] text-black text-xs font-bold uppercase tracking-wide disabled:opacity-60 md:col-span-3">
                {savingCharge ? 'Salvando...' : 'Adicionar cobranca'}
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-sm p-3">
              <label className="text-xs text-zinc-400 uppercase tracking-wider">Metodo de pagamento</label>
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="h-8 px-3 rounded-sm bg-zinc-900 border border-zinc-700 text-xs">
                <option value="cash">Dinheiro</option>
                <option value="pix">PIX</option>
                <option value="card">Cartao</option>
                <option value="transfer">Transferencia</option>
              </select>
              <label className="inline-flex items-center gap-2 text-xs">
                <input type="checkbox" className="accent-[#ccff00]" checked={extendContractOnPayment} onChange={(event) => setExtendContractOnPayment(event.target.checked)} />
                Estender contrato automaticamente ao marcar pagamento
              </label>
              <button
                onClick={() => handleCleanupCharges()}
                disabled={cleaningCharges || !canManageContracts}
                className="ml-auto h-8 px-3 rounded-sm bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-[11px] font-semibold uppercase tracking-wide disabled:opacity-60 inline-flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> {cleaningCharges ? 'Limpando...' : 'Limpar pendentes'}
              </button>
            </div>
          </>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">ID</th>
                <th className="text-left px-4 py-3">Vencimento</th>
                <th className="text-left px-4 py-3">Valor</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Pago em</th>
                <th className="text-right px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {chargesLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">Carregando cobrancas...</td>
                </tr>
              )}
              {!chargesLoading && !selectedContract && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Selecione um contrato para ver as cobrancas.</td>
                </tr>
              )}
              {!chargesLoading && selectedContract && charges.map((charge) => (
                <tr key={charge.charge_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/25">
                  <td className="px-4 py-3 text-xs">{charge.charge_id}</td>
                  <td className="px-4 py-3 text-zinc-400">{formatDate(charge.due_at)}</td>
                  <td className="px-4 py-3">{formatMoney(charge.amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-sm border text-xs font-semibold uppercase ${statusClass(charge.status)}`}>
                      {statusLabel(charge.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{formatDate(charge.paid_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {charge.status !== 'paid' && (
                      <button onClick={() => handleMarkPaid(charge.charge_id)} className="h-8 px-3 rounded-sm bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[11px] font-semibold uppercase tracking-wide">
                        Marcar pago
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!chargesLoading && selectedContract && charges.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">Sem cobrancas registradas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {contractModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setContractModalOpen(false)}>
          <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-md" onClick={(event) => event.stopPropagation()}>
            <div className="h-14 px-5 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-heading text-xl font-semibold uppercase">Novo contrato</h3>
              <button onClick={() => setContractModalOpen(false)} className="p-1 hover:bg-zinc-800 rounded-sm">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateContract} className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Aluno</label>
                  <select required value={contractForm.student_id} onChange={(event) => setContractForm({ ...contractForm, student_id: event.target.value })} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm">
                    <option value="">Selecione</option>
                    {students.map((student) => (
                      <option key={student.student_id} value={student.student_id}>{student.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Plano</label>
                  <select value={contractForm.plan_id} onChange={(event) => {
                    const nextPlanId = event.target.value;
                    const plan = plans.find((item) => item.plan_id === nextPlanId);
                    setContractForm((prev) => ({
                      ...prev,
                      plan_id: nextPlanId,
                      amount: prev.amount || (plan?.valor ? String(plan.valor) : ''),
                      duration_days: plan?.duracao_dias ? String(plan.duracao_dias) : prev.duration_days,
                      manual_end_override: false,
                    }));
                  }} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm">
                    <option value="">Sem plano</option>
                    {plans.map((plan) => (
                      <option key={plan.plan_id} value={plan.plan_id}>{plan.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Inicio</label>
                  <input type="date" value={contractForm.start_at} onChange={(event) => setContractForm({ ...contractForm, start_at: event.target.value, manual_end_override: false })} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Valor (BRL)</label>
                  <input type="number" min="0.01" step="0.01" value={contractForm.amount} onChange={(event) => setContractForm({ ...contractForm, amount: event.target.value })} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Duracao (dias)</label>
                  <input type="number" min="1" value={contractForm.duration_days} onChange={(event) => setContractForm({ ...contractForm, duration_days: event.target.value, manual_end_override: false })} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Vencimento</label>
                  <input type="date" value={contractForm.end_at} onChange={(event) => setContractForm({ ...contractForm, end_at: event.target.value, manual_end_override: true })} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
                </div>
                <div className="md:col-span-2 border border-zinc-800 rounded-sm p-3 bg-zinc-950/40 text-xs text-zinc-400">
                  O vencimento e calculado automaticamente com base no plano e na data de inicio, mas pode ser alterado manualmente em casos excepcionais.
                  <button
                    type="button"
                    onClick={() => setContractForm((prev) => ({ ...prev, manual_end_override: false }))}
                    className="ml-2 underline text-[#ccff00]"
                  >
                    Recalcular automatico
                  </button>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Observacao</label>
                  <textarea rows={3} value={contractForm.notes} onChange={(event) => setContractForm({ ...contractForm, notes: event.target.value })} className="mt-1 w-full p-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm resize-none" />
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={contractForm.auto_renew} onChange={(event) => setContractForm({ ...contractForm, auto_renew: event.target.checked })} className="accent-[#ccff00]" />
                  Auto renovar
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={contractForm.create_initial_charge} onChange={(event) => setContractForm({ ...contractForm, create_initial_charge: event.target.checked })} className="accent-[#ccff00]" />
                  Criar cobranca inicial
                </label>
              </div>
              <div className="flex gap-3 pt-2">
                <button disabled={savingContract} className="flex-1 h-10 rounded-sm bg-[#ccff00] hover:bg-[#b3e600] text-black text-xs font-bold uppercase tracking-wide disabled:opacity-60">
                  {savingContract ? 'Salvando...' : 'Criar contrato'}
                </button>
                <button type="button" onClick={() => setContractModalOpen(false)} className="h-10 px-5 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold uppercase tracking-wide">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
