import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CircleDollarSign, ClipboardList, FileText, Plus, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

const emptyContractForm = {
  student_id: '',
  plan_id: '',
  amount: '',
  duration_days: '30',
  start_at: '',
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

function toIsoDateStart(value) {
  if (!value) return undefined;
  return `${value}T00:00:00Z`;
}

export default function StudentContractsPage() {
  const [loading, setLoading] = useState(true);
  const [savingContract, setSavingContract] = useState(false);
  const [savingCharge, setSavingCharge] = useState(false);
  const [overview, setOverview] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [students, setStudents] = useState([]);
  const [plans, setPlans] = useState([]);
  const [events, setEvents] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterStudent, setFilterStudent] = useState('');
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractForm, setContractForm] = useState(emptyContractForm);
  const [chargeForm, setChargeForm] = useState(emptyChargeForm);
  const [selectedContract, setSelectedContract] = useState(null);
  const [charges, setCharges] = useState([]);
  const [chargesLoading, setChargesLoading] = useState(false);

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
      limit: 200,
    });
    setContracts(data);
  };

  const loadCharges = async (contractId) => {
    if (!contractId) {
      setCharges([]);
      return;
    }
    setChargesLoading(true);
    try {
      const data = await api.listContractCharges(contractId, 200);
      setCharges(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setChargesLoading(false);
    }
  };

  const refreshAll = async () => {
    setLoading(true);
    try {
      await Promise.all([loadStaticData(), loadOverview(), loadContracts()]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    if (!loading) {
      loadContracts().catch((err) => toast.error(err.message));
    }
  }, [filterStatus, filterStudent]);

  useEffect(() => {
    if (selectedContract?.contract_id) {
      loadCharges(selectedContract.contract_id);
    }
  }, [selectedContract?.contract_id]);

  const selectedStudentName = useMemo(() => {
    if (!selectedContract) return '-';
    return selectedContract.student_name || students.find((s) => s.student_id === selectedContract.student_id)?.nome || '-';
  }, [selectedContract, students]);

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
        auto_renew: !!contractForm.auto_renew,
        notes: contractForm.notes || undefined,
        create_initial_charge: !!contractForm.create_initial_charge,
      };
      await api.createStudentContract(payload);
      toast.success('Contrato criado');
      setContractModalOpen(false);
      await Promise.all([loadOverview(), loadContracts()]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingContract(false);
    }
  };

  const handleCancelContract = async (contractId) => {
    if (!window.confirm('Cancelar este contrato?')) return;
    try {
      await api.cancelStudentContract(contractId);
      toast.success('Contrato cancelado');
      if (selectedContract?.contract_id === contractId) {
        setSelectedContract(null);
      }
      await Promise.all([loadOverview(), loadContracts()]);
    } catch (err) {
      toast.error(err.message);
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
      toast.error(err.message);
    } finally {
      setSavingCharge(false);
    }
  };

  const handleMarkPaid = async (chargeId) => {
    try {
      await api.markStudentChargePaid(chargeId, {
        payment_method: 'cash',
        extend_contract: true,
      });
      toast.success('Cobranca marcada como paga');
      if (selectedContract?.contract_id) {
        await Promise.all([loadOverview(), loadContracts(), loadCharges(selectedContract.contract_id)]);
      }
    } catch (err) {
      toast.error(err.message);
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
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Contratos de Alunos</h1>
          <p className="text-zinc-400 mt-1">Gestao de contratos, cobrancas e renovacoes.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={refreshAll} className="h-10 px-4 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold uppercase tracking-wide">
            Atualizar
          </button>
          <button onClick={openCreateModal} className="h-10 px-4 rounded-sm bg-[#ccff00] hover:bg-[#b3e600] text-black text-xs font-bold uppercase tracking-wide flex items-center gap-2">
            <Plus className="w-4 h-4" /> Novo contrato
          </button>
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
          <p className="text-xs text-zinc-500 mt-1">Cobrancas vencidas: {overview?.overdue_charges || 0}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> Vencendo em 7d</p>
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
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 flex flex-col md:flex-row gap-3">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm">
              <option value="">Todos os status</option>
              <option value="active">Ativo</option>
              <option value="past_due">Past due</option>
              <option value="expired">Expirado</option>
              <option value="canceled">Cancelado</option>
            </select>
            <select value={filterStudent} onChange={(e) => setFilterStudent(e.target.value)} className="h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm flex-1">
              <option value="">Todos os alunos</option>
              {students.map((student) => (
                <option key={student.student_id} value={student.student_id}>{student.nome}</option>
              ))}
            </select>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Aluno</th>
                  <th className="text-left px-4 py-3">Plano</th>
                  <th className="text-left px-4 py-3">Valor</th>
                  <th className="text-left px-4 py-3">Periodo fim</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((contract) => (
                  <tr key={contract.contract_id} className="border-b border-zinc-800/50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{contract.student_name}</p>
                      <p className="text-xs text-zinc-500">{contract.contract_id}</p>
                    </td>
                    <td className="px-4 py-3">{contract.plan_name || '-'}</td>
                    <td className="px-4 py-3">{formatMoney(contract.amount)}</td>
                    <td className="px-4 py-3 text-zinc-400">{formatDate(contract.current_period_end)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-sm border text-xs font-semibold uppercase ${statusClass(contract.status)}`}>
                        {contract.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setSelectedContract(contract)} className="h-8 px-3 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-[11px] font-semibold uppercase tracking-wide">
                          Cobrancas
                        </button>
                        {['OWNER', 'MANAGER'].includes((JSON.parse(localStorage.getItem('gymbro_user') || '{}').role || 'OWNER').toUpperCase()) && (
                          <button onClick={() => handleCancelContract(contract.contract_id)} className="h-8 px-3 rounded-sm bg-red-500/10 hover:bg-red-500/20 text-red-300 text-[11px] font-semibold uppercase tracking-wide">
                            Cancelar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {contracts.length === 0 && (
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
            <h2 className="font-semibold uppercase tracking-wide text-sm flex items-center gap-2"><FileText className="w-4 h-4" /> Timeline</h2>
            <ul className="mt-3 space-y-2 text-xs">
              {events.map((item) => (
                <li key={item.event_id} className="border border-zinc-800 rounded-sm px-3 py-2">
                  <p className="font-semibold uppercase">{item.event_type}</p>
                  <p className="text-zinc-500 mt-1">{formatDate(item.created_at)}</p>
                </li>
              ))}
              {events.length === 0 && <li className="text-zinc-500">Sem eventos</li>}
            </ul>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
            <h2 className="font-semibold uppercase tracking-wide text-sm mb-3">Contrato selecionado</h2>
            {!selectedContract && <p className="text-sm text-zinc-500">Selecione um contrato para ver e gerenciar cobrancas.</p>}
            {selectedContract && (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-zinc-500">Aluno</p>
                  <p className="font-semibold">{selectedStudentName}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Status</p>
                  <p className={`inline-flex px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${statusClass(selectedContract.status)}`}>
                    {selectedContract.status}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">Periodo atual</p>
                  <p>{formatDate(selectedContract.current_period_start)} - {formatDate(selectedContract.current_period_end)}</p>
                </div>
                <button onClick={() => setSelectedContract(null)} className="h-9 px-3 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold uppercase tracking-wide">
                  Limpar selecao
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedContract && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <h2 className="font-semibold uppercase tracking-wide text-sm">Cobrancas do contrato {selectedContract.contract_id}</h2>
            <form onSubmit={handleCreateCharge} className="flex flex-wrap gap-2">
              <input type="number" min="0.01" step="0.01" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} placeholder="Valor" className="h-9 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-xs w-28" />
              <input type="date" value={chargeForm.due_at} onChange={(e) => setChargeForm({ ...chargeForm, due_at: e.target.value })} className="h-9 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-xs" />
              <input value={chargeForm.notes} onChange={(e) => setChargeForm({ ...chargeForm, notes: e.target.value })} placeholder="Observacao" className="h-9 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-xs w-40" />
              <button disabled={savingCharge} className="h-9 px-3 rounded-sm bg-[#ccff00] hover:bg-[#b3e600] text-black text-[11px] font-bold uppercase tracking-wide disabled:opacity-60">
                {savingCharge ? 'Salvando...' : 'Nova cobranca'}
              </button>
            </form>
          </div>

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
                {!chargesLoading && charges.map((charge) => (
                  <tr key={charge.charge_id} className="border-b border-zinc-800/50">
                    <td className="px-4 py-3 text-xs">{charge.charge_id}</td>
                    <td className="px-4 py-3 text-zinc-400">{formatDate(charge.due_at)}</td>
                    <td className="px-4 py-3">{formatMoney(charge.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-sm border text-xs font-semibold uppercase ${statusClass(charge.status)}`}>
                        {charge.status}
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
                {!chargesLoading && charges.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">Sem cobrancas registradas.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                  <select required value={contractForm.student_id} onChange={(e) => setContractForm({ ...contractForm, student_id: e.target.value })} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm">
                    <option value="">Selecione</option>
                    {students.map((student) => (
                      <option key={student.student_id} value={student.student_id}>{student.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Plano</label>
                  <select value={contractForm.plan_id} onChange={(e) => setContractForm({ ...contractForm, plan_id: e.target.value })} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm">
                    <option value="">Sem plano</option>
                    {plans.map((plan) => (
                      <option key={plan.plan_id} value={plan.plan_id}>{plan.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Inicio</label>
                  <input type="date" value={contractForm.start_at} onChange={(e) => setContractForm({ ...contractForm, start_at: e.target.value })} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Valor (BRL)</label>
                  <input type="number" min="0.01" step="0.01" value={contractForm.amount} onChange={(e) => setContractForm({ ...contractForm, amount: e.target.value })} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Duracao (dias)</label>
                  <input type="number" min="1" value={contractForm.duration_days} onChange={(e) => setContractForm({ ...contractForm, duration_days: e.target.value })} className="mt-1 w-full h-10 px-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs uppercase tracking-wider text-zinc-500">Observacao</label>
                  <textarea rows={3} value={contractForm.notes} onChange={(e) => setContractForm({ ...contractForm, notes: e.target.value })} className="mt-1 w-full p-3 rounded-sm bg-zinc-950 border border-zinc-800 text-sm resize-none" />
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={contractForm.auto_renew} onChange={(e) => setContractForm({ ...contractForm, auto_renew: e.target.checked })} className="accent-[#ccff00]" />
                  Auto renovar
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={contractForm.create_initial_charge} onChange={(e) => setContractForm({ ...contractForm, create_initial_charge: e.target.checked })} className="accent-[#ccff00]" />
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
