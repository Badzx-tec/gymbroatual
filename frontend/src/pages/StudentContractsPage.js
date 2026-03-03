import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Filter, Plus, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { api } from '../api';
import ContractDetailsDrawer from './contracts/ContractDetailsDrawer';
import ContractsFilters from './contracts/ContractsFilters';
import ContractsOverview from './contracts/ContractsOverview';
import ContractsTable from './contracts/ContractsTable';
import { toIsoDate, toLocalDateInput } from './contracts/contractsUtils';

const SAVED_VIEW_KEY = 'gymbro_contracts_saved_view';

const createFormDefault = {
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

const paymentMethods = [
  ['pix', 'PIX'],
  ['card', 'Cartao'],
  ['cash', 'Dinheiro'],
  ['boleto', 'Boleto'],
  ['transfer', 'Transferencia'],
];

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBool(value) {
  const raw = String(value || '').toLowerCase().trim();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function parseQuery(searchParams) {
  const page = parseIntOr(searchParams.get('page'), 1);
  const pageSize = parseIntOr(searchParams.get('pageSize'), 20);
  const sortBy = searchParams.get('sortBy') || 'updatedAt';
  const sortDir = searchParams.get('sortDir') || 'desc';
  return {
    page,
    pageSize,
    q: searchParams.get('q') || '',
    sortBy,
    sortDir: sortDir === 'asc' ? 'asc' : 'desc',
    status: searchParams.getAll('status').filter(Boolean),
    planoId: searchParams.getAll('planoId').filter(Boolean),
    startDate: searchParams.get('startDate') || '',
    endDate: searchParams.get('endDate') || '',
    expiringInDays: searchParams.get('expiringInDays') || '',
    pendingOnly: parseBool(searchParams.get('pendingOnly')),
    contractId: searchParams.get('contractId') || '',
  };
}

function parseQueryFromString(queryString) {
  return parseQuery(new URLSearchParams(queryString || ''));
}

function buildQuery(nextState) {
  const query = new URLSearchParams();
  if (nextState.page && nextState.page !== 1) query.set('page', String(nextState.page));
  if (nextState.pageSize && nextState.pageSize !== 20) query.set('pageSize', String(nextState.pageSize));
  if (nextState.q) query.set('q', nextState.q);
  if (nextState.sortBy && nextState.sortBy !== 'updatedAt') query.set('sortBy', nextState.sortBy);
  if (nextState.sortDir && nextState.sortDir !== 'desc') query.set('sortDir', nextState.sortDir);
  (nextState.status || []).filter(Boolean).forEach((value) => query.append('status', String(value)));
  (nextState.planoId || []).filter(Boolean).forEach((value) => query.append('planoId', String(value)));
  if (nextState.startDate) query.set('startDate', nextState.startDate);
  if (nextState.endDate) query.set('endDate', nextState.endDate);
  if (nextState.expiringInDays) query.set('expiringInDays', String(nextState.expiringInDays));
  if (nextState.pendingOnly) query.set('pendingOnly', 'true');
  if (nextState.contractId) query.set('contractId', nextState.contractId);
  return query;
}

function normalizeDraftFromQuery(queryState) {
  return {
    status: [...(queryState.status || [])],
    planoId: [...(queryState.planoId || [])],
    startDate: queryState.startDate || '',
    endDate: queryState.endDate || '',
    expiringInDays: String(queryState.expiringInDays || ''),
    pendingOnly: Boolean(queryState.pendingOnly),
  };
}

export default function StudentContractsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryKey = searchParams.toString();
  const queryState = useMemo(() => parseQueryFromString(queryKey), [queryKey]);

  const [searchInput, setSearchInput] = useState(queryState.q || '');
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalsByStatus: {},
    expiringSoonCount: 0,
    pendingCount: 0,
    canceledMonthCount: 0,
  });

  const [plans, setPlans] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busyAction, setBusyAction] = useState(false);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersDraft, setFiltersDraft] = useState(() => normalizeDraftFromQuery(queryState));

  const [detailOpen, setDetailOpen] = useState(Boolean(queryState.contractId));
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailData, setDetailData] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(createFormDefault);
  const [manualEndEdited, setManualEndEdited] = useState(false);

  const user = useMemo(() => JSON.parse(localStorage.getItem('gymbro_user') || '{}'), []);
  const role = String(user.role || '').toUpperCase();
  const canCreateContracts = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);
  const canManageContractRules = ['OWNER', 'MANAGER'].includes(role);

  const plansById = useMemo(() => new Map(plans.map((plan) => [plan.plan_id, plan])), [plans]);

  const hasActiveFilters = useMemo(() => {
    return Boolean(
      (queryState.status || []).length
        || (queryState.planoId || []).length
        || queryState.startDate
        || queryState.endDate
        || queryState.expiringInDays
        || queryState.pendingOnly
        || queryState.q
    );
  }, [queryState]);

  const quickFilterKey = useMemo(() => {
    if (queryState.pendingOnly) return 'pending';
    if (String(queryState.expiringInDays) === '7') return 'expiring';
    if (queryState.status.length === 1 && queryState.status[0] === 'active') return 'active';
    if (queryState.status.length === 1 && queryState.status[0] === 'canceled') return 'canceled';
    return '';
  }, [queryState]);

  const overview = useMemo(() => ({
    active: Number(meta?.totalsByStatus?.active || 0),
    expiringSoon: Number(meta?.expiringSoonCount || 0),
    pending: Number(meta?.pendingCount || 0),
    canceledMonth: Number(meta?.canceledMonthCount || 0),
  }), [meta]);

  const updateQueryState = useCallback((patch, options = {}) => {
    const next = {
      ...queryState,
      ...patch,
    };
    if (options.resetPage) next.page = 1;
    const query = buildQuery(next);
    setSearchParams(query, { replace: options.replace !== false });
  }, [queryState, setSearchParams]);

  const loadContracts = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const response = await api.adminContracts({
        page: queryState.page,
        pageSize: queryState.pageSize,
        q: queryState.q,
        sortBy: queryState.sortBy,
        sortDir: queryState.sortDir,
        status: queryState.status,
        planoId: queryState.planoId,
        startDate: queryState.startDate || undefined,
        endDate: queryState.endDate || undefined,
        expiringInDays: queryState.expiringInDays || undefined,
        pendingOnly: queryState.pendingOnly,
      });
      const nextRows = Array.isArray(response?.data) ? response.data : [];
      setRows(nextRows);
      setMeta(response?.meta || {});
      setSelectedIds((current) => current.filter((id) => nextRows.some((row) => row.contract_id === id)));
    } catch (err) {
      setListError(err?.message || 'erro inesperado');
    } finally {
      setLoadingList(false);
    }
  }, [queryState]);

  const loadSupportData = useCallback(async () => {
    try {
      const [plansData, studentsData] = await Promise.all([
        api.listPlans(),
        api.listStudents('', ''),
      ]);
      setPlans(Array.isArray(plansData) ? plansData : []);
      setStudents(Array.isArray(studentsData) ? studentsData : []);
    } catch (err) {
      toast.error(err?.message || 'Falha ao carregar planos/alunos.');
    }
  }, []);

  const loadDetail = useCallback(async (contractId) => {
    if (!contractId) return;
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await api.adminContractDetail(contractId);
      setDetailData(response || null);
    } catch (err) {
      setDetailError(err?.message || 'falha ao carregar detalhe');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSupportData();
  }, [loadSupportData]);

  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  useEffect(() => {
    setSearchInput(queryState.q || '');
  }, [queryState.q]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput === queryState.q) return;
      updateQueryState({ q: searchInput, contractId: queryState.contractId }, { resetPage: true });
    }, 320);
    return () => clearTimeout(handle);
  }, [searchInput, queryState.q, queryState.contractId, updateQueryState]);

  useEffect(() => {
    if (!queryState.contractId) {
      setDetailOpen(false);
      return;
    }
    setDetailOpen(true);
    loadDetail(queryState.contractId);
  }, [queryState.contractId, loadDetail]);

  const openFilters = () => {
    setFiltersDraft(normalizeDraftFromQuery(queryState));
    setFiltersOpen(true);
  };

  const applyFilters = () => {
    updateQueryState({
      status: filtersDraft.status || [],
      planoId: filtersDraft.planoId || [],
      startDate: filtersDraft.startDate || '',
      endDate: filtersDraft.endDate || '',
      expiringInDays: filtersDraft.expiringInDays || '',
      pendingOnly: Boolean(filtersDraft.pendingOnly),
    }, { resetPage: true });
    setFiltersOpen(false);
  };

  const clearFilters = () => {
    updateQueryState({
      status: [],
      planoId: [],
      startDate: '',
      endDate: '',
      expiringInDays: '',
      pendingOnly: false,
      q: '',
    }, { resetPage: true });
    setFiltersDraft({
      status: [],
      planoId: [],
      startDate: '',
      endDate: '',
      expiringInDays: '',
      pendingOnly: false,
    });
  };

  const saveView = () => {
    localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify(filtersDraft));
    toast.success('Visao de filtros salva neste navegador.');
  };

  const restoreSavedView = () => {
    try {
      const raw = localStorage.getItem(SAVED_VIEW_KEY);
      if (!raw) {
        toast.error('Nenhuma visao salva neste navegador.');
        return;
      }
      const parsed = JSON.parse(raw);
      setFiltersDraft(parsed);
      updateQueryState({
        status: Array.isArray(parsed.status) ? parsed.status : [],
        planoId: Array.isArray(parsed.planoId) ? parsed.planoId : [],
        startDate: parsed.startDate || '',
        endDate: parsed.endDate || '',
        expiringInDays: parsed.expiringInDays || '',
        pendingOnly: Boolean(parsed.pendingOnly),
      }, { resetPage: true });
      toast.success('Visao restaurada.');
    } catch {
      toast.error('Falha ao restaurar visao salva.');
    }
  };

  const setContractInUrl = (contractId) => {
    updateQueryState({ contractId: contractId || '' }, { replace: true });
  };

  const openDetails = (contractId) => {
    setDetailOpen(true);
    setContractInUrl(contractId);
  };

  const closeDetails = () => {
    setDetailOpen(false);
    setContractInUrl('');
    setDetailData(null);
  };

  const runMutation = async (task, successMessage, contractIdToReload = '') => {
    setBusyAction(true);
    try {
      await task();
      toast.success(successMessage);
      await loadContracts();
      if (contractIdToReload) {
        await loadDetail(contractIdToReload);
      }
    } catch (err) {
      toast.error(err?.message || 'Falha ao executar acao.');
    } finally {
      setBusyAction(false);
    }
  };

  const onRowAction = async (action, row) => {
    const contractId = row?.contract_id;
    if (!contractId) return;

    if (action === 'detail') {
      openDetails(contractId);
      return;
    }
    if (action === 'pdf') {
      try {
        await api.adminContractPdf(contractId);
      } catch (err) {
        toast.error(err?.message || 'Falha ao baixar contrato em PDF.');
      }
      return;
    }
    if (action === 'copy') {
      try {
        const url = `${window.location.origin}/admin/contratos?contractId=${contractId}`;
        await navigator.clipboard.writeText(url);
        toast.success('Link copiado.');
      } catch {
        toast.error('Nao foi possivel copiar o link.');
      }
      return;
    }
    if (action === 'renew') {
      await runMutation(
        () => api.adminRenewContract(contractId, { create_charge: true }),
        'Contrato renovado.',
        contractId
      );
      return;
    }
    if (action === 'pause') {
      if (!canManageContractRules) {
        toast.error('Somente Dono da academia ou Diretor pode pausar contrato.');
        return;
      }
      const daysInput = window.prompt('Pausar por quantos dias?', '7');
      if (!daysInput) return;
      const days = Number(daysInput);
      if (!Number.isFinite(days) || days <= 0) {
        toast.error('Informe um numero de dias valido.');
        return;
      }
      await runMutation(
        () => api.adminPauseContract(contractId, { days }),
        'Contrato pausado.',
        contractId
      );
      return;
    }
    if (action === 'cancel') {
      if (!canManageContractRules) {
        toast.error('Somente Dono da academia ou Diretor pode cancelar contrato.');
        return;
      }
      const immediate = window.confirm('Clique em OK para cancelar imediatamente. Clique em Cancelar para agendar no fim do ciclo.');
      const mode = immediate ? 'immediate' : 'end_of_cycle';
      await runMutation(
        () => api.adminCancelContract(contractId, { mode, reason: 'cancelamento administrativo' }),
        mode === 'immediate' ? 'Contrato cancelado.' : 'Cancelamento agendado.',
        contractId
      );
    }
  };

  const toggleQuickFilter = (key) => {
    if (quickFilterKey === key) {
      clearFilters();
      return;
    }
    if (key === 'active') {
      updateQueryState({ status: ['active'], expiringInDays: '', pendingOnly: false }, { resetPage: true });
    }
    if (key === 'expiring') {
      updateQueryState({ expiringInDays: '7', status: [], pendingOnly: false }, { resetPage: true });
    }
    if (key === 'pending') {
      updateQueryState({ pendingOnly: true, status: [], expiringInDays: '' }, { resetPage: true });
    }
    if (key === 'canceled') {
      updateQueryState({ status: ['canceled'], expiringInDays: '', pendingOnly: false }, { resetPage: true });
    }
  };

  const toggleRow = (contractId, checked) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(contractId);
      else next.delete(contractId);
      return Array.from(next);
    });
  };

  const toggleAllRows = (checked) => {
    if (!checked) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(rows.map((item) => item.contract_id));
  };

  const runBulkCancel = async () => {
    if (!selectedIds.length) return;
    if (!canManageContractRules) {
      toast.error('Somente Dono da academia ou Diretor pode cancelar em lote.');
      return;
    }
    if (!window.confirm(`Cancelar ${selectedIds.length} contrato(s) no fim do ciclo?`)) return;
    setBusyAction(true);
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => api.adminCancelContract(id, { mode: 'end_of_cycle', reason: 'cancelamento em lote' }))
      );
      const success = results.filter((item) => item.status === 'fulfilled').length;
      const failed = results.length - success;
      toast.success(`Lote concluido. Sucesso: ${success} • Falhas: ${failed}`);
      setSelectedIds([]);
      await loadContracts();
      if (queryState.contractId) await loadDetail(queryState.contractId);
    } catch (err) {
      toast.error(err?.message || 'Falha ao processar lote.');
    } finally {
      setBusyAction(false);
    }
  };

  const runExport = async (ids = []) => {
    try {
      await api.exportAdminContracts({
        format: 'xlsx',
        q: queryState.q || undefined,
        status: queryState.status,
        planoId: queryState.planoId,
        startDate: queryState.startDate || undefined,
        endDate: queryState.endDate || undefined,
        expiringInDays: queryState.expiringInDays || undefined,
        pendingOnly: queryState.pendingOnly,
        ids,
      });
      toast.success(ids.length ? 'Exportacao dos selecionados concluida.' : 'Exportacao concluida.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao exportar contratos.');
    }
  };

  const recalcCreateEndAt = useCallback((nextForm) => {
    if (manualEndEdited) return nextForm;
    const selectedPlan = plansById.get(nextForm.plan_id);
    const duration = Number(nextForm.duration_days || selectedPlan?.duracao_dias || 0);
    if (!nextForm.start_at || duration <= 0) return nextForm;
    const start = new Date(nextForm.start_at);
    if (Number.isNaN(start.getTime())) return nextForm;
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + duration);
    return { ...nextForm, end_at: toLocalDateInput(end.toISOString()) };
  }, [manualEndEdited, plansById]);

  const openCreateModal = () => {
    setCreateForm({ ...createFormDefault, start_at: toLocalDateInput(new Date().toISOString()) });
    setManualEndEdited(false);
    setCreateOpen(true);
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!canCreateContracts) {
      toast.error('Sem permissao para criar contrato.');
      return;
    }
    const payload = {
      student_id: createForm.student_id,
      plan_id: createForm.plan_id || undefined,
      amount: createForm.amount ? Number(createForm.amount) : undefined,
      duration_days: createForm.duration_days ? Number(createForm.duration_days) : undefined,
      start_at: toIsoDate(createForm.start_at) || undefined,
      end_at: toIsoDate(createForm.end_at) || undefined,
      auto_renew: Boolean(createForm.auto_renew),
      create_initial_charge: Boolean(createForm.create_initial_charge),
      payment_method: createForm.payment_method || undefined,
    };

    setBusyAction(true);
    try {
      await api.createStudentContract(payload);
      toast.success('Contrato criado com sucesso.');
      setCreateOpen(false);
      await loadContracts();
    } catch (err) {
      toast.error(err?.message || 'Falha ao criar contrato.');
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Contratos</h1>
            <p className="mt-1 text-sm text-zinc-400">Gerencie contratos, renovacoes e pendencias</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openCreateModal}
              disabled={!canCreateContracts}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[#ccff00] px-4 text-xs font-bold uppercase tracking-wide text-black hover:bg-[#b3e600] disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              Novo contrato
            </button>
            <button
              type="button"
              onClick={() => runExport([])}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-4 text-xs font-semibold uppercase tracking-wide hover:bg-zinc-700"
            >
              <Download className="h-4 w-4" />
              Exportar
            </button>
            <button
              type="button"
              onClick={openFilters}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-4 text-xs font-semibold uppercase tracking-wide hover:bg-zinc-700"
            >
              <Filter className="h-4 w-4" />
              Filtros
            </button>
          </div>
        </div>
      </header>

      <ContractsOverview
        overview={overview}
        quickFilterKey={quickFilterKey}
        onQuickFilter={toggleQuickFilter}
      />

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por aluno, ID, plano ou contrato"
              className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-sm"
              aria-label="Busca global de contratos"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={restoreSavedView}
              className="h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-semibold uppercase tracking-wide"
            >
              Restaurar visao
            </button>
            <button
              type="button"
              onClick={() => loadContracts()}
              className="h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-semibold uppercase tracking-wide"
            >
              Atualizar
            </button>
          </div>
        </div>
      </section>

      {selectedIds.length ? (
        <section className="rounded-xl border border-zinc-700 bg-zinc-900/90 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-zinc-300">{selectedIds.length} contrato(s) selecionado(s)</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={runBulkCancel}
                disabled={busyAction}
                className="h-9 rounded-md border border-red-500/40 bg-red-500/15 px-3 text-xs font-semibold uppercase text-red-300 disabled:opacity-50"
              >
                Cancelar selecionados
              </button>
              <button
                type="button"
                onClick={() => runExport(selectedIds)}
                className="h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-semibold uppercase"
              >
                Exportar selecionados
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-semibold uppercase"
              >
                Limpar selecao
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <ContractsTable
        rows={rows}
        loading={loadingList}
        error={listError}
        page={queryState.page}
        pageSize={queryState.pageSize}
        total={meta.total || 0}
        sortBy={queryState.sortBy}
        sortDir={queryState.sortDir}
        selectedIds={selectedIds}
        onSort={(nextSortBy) => {
          const nextDir = queryState.sortBy === nextSortBy && queryState.sortDir === 'asc' ? 'desc' : 'asc';
          updateQueryState({ sortBy: nextSortBy, sortDir: nextDir }, { resetPage: true });
        }}
        onToggleRow={toggleRow}
        onToggleAll={toggleAllRows}
        onAction={onRowAction}
        onOpenDetails={openDetails}
        onPageChange={(page) => updateQueryState({ page })}
        onPageSizeChange={(pageSize) => updateQueryState({ pageSize }, { resetPage: true })}
        onRetry={loadContracts}
        isFiltered={hasActiveFilters}
        onClearFilters={clearFilters}
        canCreateContracts={canCreateContracts}
        onCreateContract={openCreateModal}
      />

      <ContractsFilters
        open={filtersOpen}
        draft={filtersDraft}
        plans={plans}
        onDraftChange={setFiltersDraft}
        onClose={() => setFiltersOpen(false)}
        onApply={applyFilters}
        onClear={clearFilters}
        onSaveView={saveView}
      />

      <ContractDetailsDrawer
        open={detailOpen}
        loading={detailLoading}
        error={detailError}
        detail={detailData}
        onClose={closeDetails}
        onRetry={() => loadDetail(queryState.contractId)}
        onAction={onRowAction}
        canManageContractRules={canManageContractRules}
      />

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900 p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-2xl font-bold uppercase">Novo contrato</h3>
                <p className="text-xs text-zinc-500">Cadastro rapido com calculo automatico de vigencia.</p>
              </div>
              <button type="button" onClick={() => setCreateOpen(false)} className="h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-semibold uppercase">Fechar</button>
            </div>

            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <select required value={createForm.student_id} onChange={(event) => setCreateForm((prev) => ({ ...prev, student_id: event.target.value }))} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm md:col-span-2">
                <option value="">Aluno</option>
                {students.map((student) => (
                  <option key={student.student_id} value={student.student_id}>{student.nome}</option>
                ))}
              </select>
              <select
                value={createForm.plan_id}
                onChange={(event) => {
                  const next = { ...createForm, plan_id: event.target.value };
                  const plan = plansById.get(event.target.value);
                  if (plan?.duracao_dias && !createForm.duration_days) next.duration_days = String(plan.duracao_dias);
                  if (plan?.valor && !createForm.amount) next.amount = String(plan.valor);
                  setCreateForm(recalcCreateEndAt(next));
                }}
                className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
              >
                <option value="">Plano</option>
                {plans.map((plan) => (
                  <option key={plan.plan_id} value={plan.plan_id}>{plan.nome}</option>
                ))}
              </select>
              <select value={createForm.payment_method} onChange={(event) => setCreateForm((prev) => ({ ...prev, payment_method: event.target.value }))} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm">
                {paymentMethods.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input type="number" min="0.01" step="0.01" placeholder="Valor" value={createForm.amount} onChange={(event) => setCreateForm((prev) => ({ ...prev, amount: event.target.value }))} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
              <input type="number" min="1" placeholder="Duracao (dias)" value={createForm.duration_days} onChange={(event) => setCreateForm((prev) => recalcCreateEndAt({ ...prev, duration_days: event.target.value }))} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
              <input type="datetime-local" value={createForm.start_at} onChange={(event) => setCreateForm((prev) => recalcCreateEndAt({ ...prev, start_at: event.target.value }))} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
              <input type="datetime-local" value={createForm.end_at} onChange={(event) => { setManualEndEdited(Boolean(event.target.value)); setCreateForm((prev) => ({ ...prev, end_at: event.target.value })); }} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
              <label className="inline-flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" className="accent-[#ccff00]" checked={createForm.auto_renew} onChange={(event) => setCreateForm((prev) => ({ ...prev, auto_renew: event.target.checked }))} />Renovacao automatica</label>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" className="accent-[#ccff00]" checked={createForm.create_initial_charge} onChange={(event) => setCreateForm((prev) => ({ ...prev, create_initial_charge: event.target.checked }))} />Criar cobranca inicial</label>
              <div className="md:col-span-2 flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCreateOpen(false)} className="h-10 rounded-md border border-zinc-700 bg-zinc-800 px-4 text-xs font-semibold uppercase">Cancelar</button>
                <button type="submit" disabled={busyAction} className="h-10 rounded-md bg-[#ccff00] px-4 text-xs font-bold uppercase text-black disabled:opacity-60">Criar contrato</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
