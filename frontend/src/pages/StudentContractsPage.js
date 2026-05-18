import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Filter, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { api } from '../api';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import { getStoredUser } from '../lib/session';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SelectField from '../components/ui/SelectField';
import SectionCard from '../components/ui/SectionCard';
import TextField from '../components/ui/TextField';
import ContractDetailsDrawer from './contracts/ContractDetailsDrawer';
import ContractsFilters from './contracts/ContractsFilters';
import ContractsOverview from './contracts/ContractsOverview';
import ContractsTable from './contracts/ContractsTable';
import {
  formatContractValueBreakdown,
  toIsoDate,
  toLocalDateInput,
} from './contracts/contractsUtils';
import CreateContractDialog from './contracts/CreateContractDialog';
import {
  dateInputToIsoRangeEnd,
  dateInputToIsoRangeStart,
  toDateInputInTimeZone,
  toMonthInputInTimeZone,
} from '../utils/timezone';

const SAVED_VIEW_KEY = 'gymbro_contracts_saved_view';
const DEFAULT_SORT_BY = 'student';
const DEFAULT_SORT_DIR = 'asc';

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBool(value) {
  const raw = String(value || '').toLowerCase().trim();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

const textCollator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const SETTLEMENT_ELIGIBLE_STATUSES = new Set(['open', 'overdue', 'failed', 'partially_paid']);

function compareText(left, right, direction = 'asc') {
  const result = textCollator.compare(String(left || ''), String(right || ''));
  return direction === 'desc' ? -result : result;
}

function sortContractsForDisplay(rows, sortBy, sortDir) {
  if (String(sortBy || '').toLowerCase() !== DEFAULT_SORT_BY) {
    return Array.isArray(rows) ? rows : [];
  }
  const direction = String(sortDir || '').toLowerCase() === 'desc' ? 'desc' : 'asc';
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const primary = compareText(left?.student_name || left?.nome || left?.student_id, right?.student_name || right?.nome || right?.student_id, direction);
    if (primary !== 0) return primary;
    const secondary = compareText(left?.student_id, right?.student_id, direction);
    if (secondary !== 0) return secondary;
    return compareText(left?.contract_id, right?.contract_id, direction);
  });
}

function getTodayDateInputInSaoPaulo() {
  return toDateInputInTimeZone(new Date().toISOString());
}

function getCurrentMonthInSaoPaulo() {
  return toMonthInputInTimeZone(new Date().toISOString());
}

function getSettlementPreview(charges = [], actionDialog = null) {
  if (!actionDialog?.kind || actionDialog.kind !== 'settle') {
    return { charges: [], total: 0, count: 0 };
  }

  const mode = actionDialog.settleMode || 'all_overdue';
  const days = Math.max(1, Number(actionDialog.settleDays || 0) || 0);
  const month = actionDialog.settleMonth || getCurrentMonthInSaoPaulo();
  const includeFutureOpen = Boolean(actionDialog.includeFutureOpen);
  const todayInput = getTodayDateInputInSaoPaulo();
  const todayEnd = new Date(dateInputToIsoRangeEnd(todayInput));
  const todayStart = new Date(dateInputToIsoRangeStart(todayInput));
  const daysStart = new Date(todayStart.getTime());
  daysStart.setUTCDate(daysStart.getUTCDate() - (days - 1));

  const eligible = (Array.isArray(charges) ? charges : []).filter((charge) => {
    const status = String(charge?.status || '').toLowerCase();
    if (!SETTLEMENT_ELIGIBLE_STATUSES.has(status)) {
      return false;
    }
    const dueAt = charge?.due_at ? new Date(charge.due_at) : null;
    if (mode === 'all_overdue') {
      if (!includeFutureOpen && status === 'open') {
        return Boolean(dueAt && !Number.isNaN(dueAt.getTime()) && dueAt <= todayEnd);
      }
      return true;
    }
    if (!dueAt || Number.isNaN(dueAt.getTime())) {
      return false;
    }
    if (mode === 'days') {
      return dueAt >= daysStart && dueAt <= todayEnd;
    }
    if (mode === 'month') {
      return toMonthInputInTimeZone(charge.due_at) === month;
    }
    return true;
  });

  const total = eligible.reduce((sum, charge) => sum + Number(charge?.amount || 0), 0);

  return {
    charges: eligible,
    total,
    count: eligible.length,
    mode,
    days,
    month,
  };
}

function parseQuery(searchParams) {
  const hasSortBy = searchParams.has('sortBy');
  const hasSortDir = searchParams.has('sortDir');
  const page = parseIntOr(searchParams.get('page'), 1);
  const pageSize = parseIntOr(searchParams.get('pageSize'), 20);
  const sortBy = searchParams.get('sortBy') || DEFAULT_SORT_BY;
  const sortDir = searchParams.get('sortDir') || DEFAULT_SORT_DIR;
  return {
    hasExplicitSort: hasSortBy || hasSortDir,
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
  if (nextState.sortBy && nextState.sortDir) {
    const isDefaultStudentSort =
      nextState.sortBy === DEFAULT_SORT_BY && nextState.sortDir === DEFAULT_SORT_DIR;
    if (!isDefaultStudentSort) {
      query.set('sortBy', nextState.sortBy);
      query.set('sortDir', nextState.sortDir);
    }
  }
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
  const [actionDialog, setActionDialog] = useState(null);

  const user = useMemo(() => getStoredUser(), []);
  const role = String(user.role || '').toUpperCase();
  const canCreateContracts = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);
  const canManageContractRules = ['OWNER', 'MANAGER'].includes(role);
  const canSettleOverdue = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);

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
      const nextRows = sortContractsForDisplay(
        Array.isArray(response?.data) ? response.data : [],
        queryState.sortBy,
        queryState.sortDir
      );
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

  useEffect(() => {
    if (actionDialog?.kind !== 'settle') return;
    const contractId = String(actionDialog?.payload?.contract_id || '').trim();
    if (!contractId) return;
    if (detailOpen && queryState.contractId && queryState.contractId !== contractId) return;
    if (detailLoading) return;
    if (detailData?.contract?.contract_id === contractId) return;
    loadDetail(contractId);
  }, [actionDialog, detailData, detailLoading, detailOpen, loadDetail, queryState.contractId]);

  const settlePreview = useMemo(() => {
    if (actionDialog?.kind !== 'settle') return null;
    const payload = actionDialog.payload || {};
    const detailContractId = detailData?.contract?.contract_id;
    const contractId = String(payload.contract_id || '').trim();
    const detailMatches = contractId && detailContractId === contractId;
    const previewCharges = detailMatches ? (detailData?.charges || []) : [];
    const preview = getSettlementPreview(previewCharges, actionDialog);

    return {
      contract: detailMatches ? detailData?.contract || payload : payload,
      detailMatches,
      loading: detailLoading && !detailMatches,
      ...preview,
    };
  }, [actionDialog, detailData, detailLoading]);

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
      return true;
    } catch (err) {
      toast.error(err?.message || 'Falha ao executar acao.');
      return false;
    } finally {
      setBusyAction(false);
    }
  };

  const closeActionDialog = () => setActionDialog(null);

  const openActionDialog = (kind, payload = {}) => {
    const defaults = {
      kind,
      payload,
      pauseDays: '7',
      validityEndAt: toLocalDateInput(payload.current_period_end || ''),
      billingDueAt: toLocalDateInput(payload.next_charge_due_at || payload.next_billing_at || ''),
      billingDay: payload.billing_day ? String(payload.billing_day) : '',
      updateOpenCharges: true,
      includeFutureOpen: false,
      cancelMode: 'end_of_cycle',
      settleMode: 'all_overdue',
      settleDays: '7',
      settleMonth: getCurrentMonthInSaoPaulo(),
    };
    if (kind === 'cancel') defaults.cancelMode = 'immediate';
    setActionDialog(defaults);
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
    if (action === 'payCharge') {
      if (!canSettleOverdue) {
        toast.error('Sem permissao para registrar pagamento.');
        return;
      }
      const chargeId = String(row?.charge_id || '').trim();
      if (!chargeId) {
        toast.error('Cobranca invalida.');
        return;
      }
      await runMutation(
        () => api.markStudentChargePaid(chargeId, { payment_method: 'other', extend_contract: false }),
        'Cobranca marcada como paga.',
        contractId
      );
      return;
    }
    if (action === 'unpayCharge') {
      if (!canSettleOverdue) {
        toast.error('Sem permissao para cancelar pagamento.');
        return;
      }
      const chargeId = String(row?.charge_id || '').trim();
      if (!chargeId) {
        toast.error('Cobranca invalida.');
        return;
      }
      openActionDialog(action, row);
      return;
    }
    if (action === 'settle') {
      if (!canSettleOverdue) {
        toast.error('Sem permissao para colocar contrato em dia.');
        return;
      }
      openActionDialog(action, row);
      return;
    }
    if (action === 'adjustValidity') {
      if (!canManageContractRules) {
        toast.error('Somente Dono da academia ou Diretor pode ajustar validade.');
        return;
      }
      openActionDialog(action, row);
      return;
    }
    if (action === 'adjustBilling') {
      if (!canManageContractRules) {
        toast.error('Somente Dono da academia ou Diretor pode ajustar cobranca.');
        return;
      }
      openActionDialog(action, row);
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
      openActionDialog(action, row);
      return;
    }
    if (action === 'cancel') {
      if (!canManageContractRules) {
        toast.error('Somente Dono da academia ou Diretor pode cancelar contrato.');
        return;
      }
      openActionDialog(action, row);
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
    openActionDialog('bulkCancel', { count: selectedIds.length });
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

  const runRemoveCanceled = async () => {
    if (!canManageContractRules) {
      toast.error('Somente Dono da academia ou Diretor pode remover cancelados.');
      return;
    }
    openActionDialog('removeCanceled');
  };

  const confirmActionDialog = async () => {
    if (!actionDialog?.kind) return;
    const payload = actionDialog.payload || {};
    const contractId = String(payload.contract_id || '').trim();

    if (actionDialog.kind === 'unpayCharge') {
      const chargeId = String(payload.charge_id || '').trim();
      if (!chargeId || !contractId) {
        toast.error('Cobranca invalida.');
        return;
      }
      const success = await runMutation(
        () => api.markStudentChargeUnpaid(chargeId, { reason: 'reversao manual na central de contratos' }),
        'Pagamento cancelado com sucesso.',
        contractId
      );
      if (success) closeActionDialog();
      return;
    }

    if (actionDialog.kind === 'settle') {
      if (!contractId) {
        toast.error('Contrato invalido.');
        return;
      }
      const settleMode = actionDialog.settleMode || 'all_overdue';
      const payload = {
        payment_method: 'other',
        reason: 'baixa manual na central de contratos',
        settlement_mode: settleMode,
      };
      if (settleMode === 'all_overdue') {
        payload.include_future_open = Boolean(actionDialog.includeFutureOpen);
      }
      if (settleMode === 'days') {
        const days = Number(actionDialog.settleDays);
        if (!Number.isFinite(days) || days <= 0) {
          toast.error('Informe uma quantidade de dias valida.');
          return;
        }
        payload.days = days;
      }
      if (settleMode === 'month') {
        if (!actionDialog.settleMonth) {
          toast.error('Selecione um mes valido.');
          return;
        }
        payload.month = actionDialog.settleMonth;
      }
      setBusyAction(true);
      try {
        const response = await api.adminSettleOverdueContract(contractId, payload);
        const updatedCharges = Number(response?.updated_charges || 0);
        if (updatedCharges > 0) {
          toast.success(`Contrato atualizado. Cobrancas baixadas: ${updatedCharges}.`);
        } else {
          toast.success('Nenhuma cobranca pendente para baixa.');
        }
        await loadContracts();
        if (detailData?.contract?.contract_id === contractId || queryState.contractId === contractId) {
          await loadDetail(contractId);
        }
        closeActionDialog();
      } catch (err) {
        toast.error(err?.message || 'Falha ao colocar contrato em dia.');
      } finally {
        setBusyAction(false);
      }
      return;
    }

    if (actionDialog.kind === 'adjustValidity') {
      if (!contractId) {
        toast.error('Contrato invalido.');
        return;
      }
      const endAt = toIsoDate(actionDialog.validityEndAt);
      if (!endAt) {
        toast.error('Informe uma validade final valida.');
        return;
      }
      const success = await runMutation(
        () => api.adminAdjustContractValidity(contractId, {
          end_at: endAt,
          reason: 'ajuste manual de validade na central de contratos',
        }),
        'Validade do contrato atualizada.',
        contractId
      );
      if (success) closeActionDialog();
      return;
    }

    if (actionDialog.kind === 'adjustBilling') {
      if (!contractId) {
        toast.error('Contrato invalido.');
        return;
      }
      const dueAt = actionDialog.billingDueAt ? toIsoDate(actionDialog.billingDueAt) : undefined;
      const billingDay = actionDialog.billingDay ? Number(actionDialog.billingDay) : undefined;
      if (!dueAt && !billingDay) {
        toast.error('Informe um vencimento da cobranca e/ou um dia de cobranca.');
        return;
      }
      setBusyAction(true);
      try {
        const response = await api.adminAdjustContractBilling(contractId, {
          due_at: dueAt,
          billing_day: billingDay,
          update_open_charges: Boolean(actionDialog.updateOpenCharges),
          reason: 'ajuste manual de cobranca na central de contratos',
        });
        const updatedCharges = Number(response?.updated_charges || 0);
        toast.success(
          updatedCharges > 0
            ? `Cobranca ajustada. Titulos atualizados: ${updatedCharges}.`
            : 'Configuracao de cobranca atualizada.'
        );
        await loadContracts();
        if (detailData?.contract?.contract_id === contractId || queryState.contractId === contractId) {
          await loadDetail(contractId);
        }
        closeActionDialog();
      } catch (err) {
        toast.error(err?.message || 'Falha ao ajustar cobranca.');
      } finally {
        setBusyAction(false);
      }
      return;
    }

    if (actionDialog.kind === 'pause') {
      const days = Number(actionDialog.pauseDays);
      if (!contractId) {
        toast.error('Contrato invalido.');
        return;
      }
      if (!Number.isFinite(days) || days <= 0) {
        toast.error('Informe um numero de dias valido.');
        return;
      }
      const success = await runMutation(
        () => api.adminPauseContract(contractId, { days }),
        'Contrato pausado.',
        contractId
      );
      if (success) closeActionDialog();
      return;
    }

    if (actionDialog.kind === 'cancel') {
      if (!contractId) {
        toast.error('Contrato invalido.');
        return;
      }
      const mode = actionDialog.cancelMode === 'end_of_cycle' ? 'end_of_cycle' : 'immediate';
      const success = await runMutation(
        () => api.adminCancelContract(contractId, { mode, reason: 'cancelamento administrativo' }),
        mode === 'immediate' ? 'Contrato cancelado.' : 'Cancelamento agendado.',
        contractId
      );
      if (success) closeActionDialog();
      return;
    }

    if (actionDialog.kind === 'bulkCancel') {
      setBusyAction(true);
      try {
        const results = await Promise.allSettled(
          selectedIds.map((id) => api.adminCancelContract(id, { mode: 'end_of_cycle', reason: 'cancelamento em lote' }))
        );
        const success = results.filter((item) => item.status === 'fulfilled').length;
        const failed = results.length - success;
        toast.success(`Lote concluido. Sucesso: ${success} | Falhas: ${failed}`);
        setSelectedIds([]);
        await loadContracts();
        if (queryState.contractId) await loadDetail(queryState.contractId);
        closeActionDialog();
      } catch (err) {
        toast.error(err?.message || 'Falha ao processar lote.');
      } finally {
        setBusyAction(false);
      }
      return;
    }

    if (actionDialog.kind === 'removeCanceled') {
      setBusyAction(true);
      try {
        const response = await api.adminRemoveCanceledContracts({ older_than_days: 0 });
        const removed = Number(response?.removed_contracts || 0);
        toast.success(
          `Cancelados removidos: ${removed}. Cobrancas: ${Number(response?.removed_charges || 0)}.`
        );
        setSelectedIds([]);
        setDetailOpen(false);
        setDetailData(null);
        setContractInUrl('');
        await loadContracts();
        closeActionDialog();
      } catch (err) {
        toast.error(err?.message || 'Falha ao remover contratos cancelados.');
      } finally {
        setBusyAction(false);
      }
    }
  };

  const actionDialogMeta = useMemo(() => {
    if (!actionDialog?.kind) return null;
    if (actionDialog.kind === 'unpayCharge') {
      return {
        title: 'Cancelar pagamento',
        description: 'A cobranca volta para pendente ou atrasada conforme o vencimento.',
        confirmLabel: 'Cancelar pagamento',
        confirmVariant: 'danger',
      };
    }
    if (actionDialog.kind === 'settle') {
      return {
        title: 'Colocar contrato em dia',
        description: 'Escolha a regra de baixa antes de confirmar a atualizacao financeira. A validade do acesso nao muda aqui.',
        confirmLabel: 'Confirmar baixa',
        confirmVariant: 'primary',
      };
    }
    if (actionDialog.kind === 'adjustValidity') {
      return {
        title: 'Ajustar validade do contrato',
        description: 'Altere apenas a vigencia de acesso. Essa acao nao reescreve vencimentos financeiros anteriores.',
        confirmLabel: 'Salvar validade',
        confirmVariant: 'primary',
      };
    }
    if (actionDialog.kind === 'adjustBilling') {
      return {
        title: 'Ajustar cobranca',
        description: 'Altere apenas o vencimento financeiro e/ou o dia de cobranca, sem mexer na validade do acesso.',
        confirmLabel: 'Salvar cobranca',
        confirmVariant: 'primary',
      };
    }
    if (actionDialog.kind === 'pause') {
      return {
        title: 'Pausar contrato',
        description: 'Defina quantos dias a validade do contrato deve ser empurrada para frente.',
        confirmLabel: 'Aplicar pausa',
        confirmVariant: 'primary',
      };
    }
    if (actionDialog.kind === 'cancel') {
      return {
        title: 'Cancelar contrato',
        description: 'Escolha se o cancelamento corta o acesso agora ou no fim do ciclo atual.',
        confirmLabel: 'Confirmar cancelamento',
        confirmVariant: 'danger',
      };
    }
    if (actionDialog.kind === 'bulkCancel') {
      return {
        title: 'Cancelar contratos selecionados',
        description: 'Todos os contratos selecionados serao programados para encerramento no fim do ciclo.',
        confirmLabel: 'Cancelar selecionados',
        confirmVariant: 'danger',
      };
    }
    if (actionDialog.kind === 'removeCanceled') {
      return {
        title: 'Remover contratos cancelados',
        description: 'Essa limpeza apaga definitivamente contratos cancelados e seus titulos vinculados.',
        confirmLabel: 'Remover cancelados',
        confirmVariant: 'danger',
      };
    }
    return null;
  }, [actionDialog]);

  const renderActionDialogBody = () => {
    if (!actionDialog?.kind) return null;
    if (actionDialog.kind === 'settle') {
      const summaryContract = settlePreview?.contract || actionDialog.payload || {};
      const valueBreakdown = formatContractValueBreakdown(summaryContract);
      return (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Registre a baixa das cobrancas elegiveis deste contrato sem alterar a validade do acesso.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Modo de baixa"
              value={actionDialog.settleMode || 'all_overdue'}
              onChange={(event) => setActionDialog((current) => ({
                ...current,
                settleMode: event.target.value,
              }))}
            >
              <option value="all_overdue">Todas as pendencias vencidas</option>
              <option value="days">Ultimos N dias</option>
              <option value="month">Mes especifico</option>
            </SelectField>

            {actionDialog.settleMode === 'days' ? (
              <TextField
                label="Quantidade de dias"
                type="number"
                min="1"
                step="1"
                value={actionDialog.settleDays}
                onChange={(event) => setActionDialog((current) => ({
                  ...current,
                  settleDays: event.target.value,
                }))}
                placeholder="7"
              />
            ) : null}

            {actionDialog.settleMode === 'month' ? (
              <TextField
                label="Mes de referencia"
                type="month"
                value={actionDialog.settleMonth}
                onChange={(event) => setActionDialog((current) => ({
                  ...current,
                  settleMonth: event.target.value,
                }))}
              />
            ) : null}
          </div>

          {actionDialog.settleMode === 'all_overdue' ? (
            <label className="flex items-start gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
              <input
                type="checkbox"
                className="mt-1 accent-[var(--brand-primary)]"
                checked={Boolean(actionDialog.includeFutureOpen)}
                onChange={(event) => setActionDialog((current) => ({
                  ...current,
                  includeFutureOpen: event.target.checked,
                }))}
              />
              <span>Incluir tambem cobrancas futuras que ainda estao em aberto.</span>
            </label>
          ) : null}

          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 text-sm text-[var(--text-secondary)]">
            {settlePreview?.loading ? (
              <p>Carregando detalhes do contrato para montar a previa da baixa...</p>
            ) : settlePreview?.detailMatches ? (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Base</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{valueBreakdown.originalLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Desconto</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                      {valueBreakdown.hasDiscount ? `- ${valueBreakdown.discountLabel}` : 'Nenhum'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Final</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{valueBreakdown.finalLabel}</p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-3 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Cobrancas elegiveis</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                      {settlePreview.count} registro(s)
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-3 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Total previsto</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                      {formatContractValueBreakdown({
                        amount: settlePreview.total,
                        original_amount: settlePreview.total,
                      }).finalLabel}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  {settlePreview.mode === 'all_overdue'
                    ? 'Modo atual: todas as pendencias vencidas.'
                    : settlePreview.mode === 'days'
                      ? `Modo atual: atrasos dos ultimos ${settlePreview.days} dias.`
                      : `Modo atual: pendencias do mes ${settlePreview.month}.`}
                </p>
              </div>
            ) : (
              <p>Abra o contrato ou aguarde o carregamento para visualizar a previsao de baixa.</p>
            )}
          </div>
        </div>
      );
    }
    if (actionDialog.kind === 'adjustValidity') {
      return (
        <div className="space-y-4">
          <TextField
            label="Validade do contrato"
            type="datetime-local"
            value={actionDialog.validityEndAt}
            onChange={(event) => setActionDialog((current) => ({
              ...current,
              validityEndAt: event.target.value,
            }))}
          />
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            A data informada sera interpretada na semantica operacional de America/Sao_Paulo.
          </div>
        </div>
      );
    }
    if (actionDialog.kind === 'adjustBilling') {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Vencimento da cobranca"
              type="datetime-local"
              value={actionDialog.billingDueAt}
              onChange={(event) => setActionDialog((current) => ({
                ...current,
                billingDueAt: event.target.value,
              }))}
            />
            <TextField
              label="Dia de cobranca"
              type="number"
              min="1"
              max="28"
              value={actionDialog.billingDay}
              onChange={(event) => setActionDialog((current) => ({
                ...current,
                billingDay: event.target.value,
              }))}
              placeholder="10"
            />
          </div>
          <label className="flex items-start gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--brand-primary)]"
              checked={Boolean(actionDialog.updateOpenCharges)}
              onChange={(event) => setActionDialog((current) => ({
                ...current,
                updateOpenCharges: event.target.checked,
              }))}
            />
            <span>Atualizar tambem as cobrancas abertas ou vencidas ja existentes.</span>
          </label>
        </div>
      );
    }
    if (actionDialog.kind === 'pause') {
      return (
        <TextField
          label="Dias de pausa"
          type="number"
          min="1"
          step="1"
          value={actionDialog.pauseDays}
          onChange={(event) => setActionDialog((current) => ({
            ...current,
            pauseDays: event.target.value,
          }))}
          placeholder="7"
        />
      );
    }
    if (actionDialog.kind === 'cancel') {
      return (
        <div className="space-y-4">
          <SelectField
            label="Quando aplicar"
            value={actionDialog.cancelMode}
            onChange={(event) => setActionDialog((current) => ({
              ...current,
              cancelMode: event.target.value,
            }))}
          >
            <option value="immediate">Cancelar imediatamente</option>
            <option value="end_of_cycle">Cancelar no fim do ciclo</option>
          </SelectField>
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            {actionDialog.cancelMode === 'immediate'
              ? 'O acesso sera cortado agora e o contrato encerrado imediatamente.'
              : 'O contrato fica ativo ate o fim da vigencia atual e depois encerra automaticamente.'}
          </div>
        </div>
      );
    }
    if (actionDialog.kind === 'bulkCancel') {
      return (
        <p className="text-sm text-[var(--text-secondary)]">
          {selectedIds.length} contrato(s) selecionado(s) serao programados para cancelamento no fim do ciclo.
        </p>
      );
    }
    if (actionDialog.kind === 'removeCanceled') {
      return (
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            Essa limpeza remove historico financeiro e auditoria dos contratos cancelados.
          </p>
          <div className="rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger-text)]">
            Use apenas quando tiver certeza de que esses contratos nao precisam mais ficar visiveis.
          </div>
        </div>
      );
    }
    return (
      <p className="text-sm text-[var(--text-secondary)]">
        Confirme esta acao para seguir com a atualizacao do contrato.
      </p>
    );
  };

  const handleCreateSubmit = async (payload) => {
    if (!canCreateContracts) {
      toast.error('Sem permissao para criar contrato.');
      return;
    }
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
      <PageHeader
        eyebrow="Operacao"
        title="Contratos"
        subtitle="Gerencie contratos, renovacoes, pendencias e cobrancas em uma superficie mais operacional."
        actions={
          <>
            <Button type="button" onClick={() => setCreateOpen(true)} disabled={!canCreateContracts} variant="primary" size="sm">
              <Plus className="h-4 w-4" />
              Novo contrato
            </Button>
            <Button type="button" onClick={() => runExport([])} variant="secondary" size="sm">
              <Download className="h-4 w-4" />
              Exportar
            </Button>
            <Button type="button" onClick={openFilters} variant="ghost" size="sm">
              <Filter className="h-4 w-4" />
              Filtros
            </Button>
            {canManageContractRules ? (
              <Button type="button" onClick={runRemoveCanceled} disabled={busyAction} variant="danger" size="sm">
                Remover cancelados
              </Button>
            ) : null}
          </>
        }
      />

      <ContractsOverview
        overview={overview}
        quickFilterKey={quickFilterKey}
        onQuickFilter={toggleQuickFilter}
      />

      <SectionCard
        title="Busca e leitura rapida"
        description="Combine busca global, filtros salvos e atualizacao manual sem sair da tabela."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={restoreSavedView} variant="secondary" size="sm">
              Restaurar visao
            </Button>
            <Button type="button" onClick={() => loadContracts()} variant="ghost" size="sm">
              Atualizar
            </Button>
          </div>
        }
      >
        <div className="max-w-xl">
          <SearchInput
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar por aluno, ID, plano ou contrato"
            aria-label="Busca global de contratos"
          />
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            A busca considera aluno, matricula, plano e identificador do contrato. O sort padrao segue o aluno
            quando a URL nao traz ordenacao explicita.
          </p>
        </div>
      </SectionCard>

      {selectedIds.length ? (
        <SectionCard title="Acoes em lote" description={`${selectedIds.length} contrato(s) selecionado(s).`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={runBulkCancel} disabled={busyAction} variant="danger" size="sm">
                Cancelar selecionados
              </Button>
              <Button type="button" onClick={() => runExport(selectedIds)} variant="secondary" size="sm">
                Exportar selecionados
              </Button>
              <Button type="button" onClick={() => setSelectedIds([])} variant="ghost" size="sm">
                Limpar selecao
              </Button>
            </div>
          </div>
        </SectionCard>
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
        onCreateContract={() => setCreateOpen(true)}
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
        canSettleOverdue={canSettleOverdue}
        busy={busyAction}
      />

      <Dialog
        open={Boolean(actionDialog)}
        onClose={busyAction ? undefined : closeActionDialog}
        title={actionDialogMeta?.title}
        description={actionDialogMeta?.description}
        size="md"
        actions={
          <>
            <Button type="button" onClick={closeActionDialog} variant="ghost" disabled={busyAction}>
              Voltar
            </Button>
            <Button
              type="button"
              onClick={confirmActionDialog}
              disabled={busyAction}
              variant={actionDialogMeta?.confirmVariant || 'primary'}
            >
              {actionDialogMeta?.confirmLabel || 'Confirmar'}
            </Button>
          </>
        }
      >
        {renderActionDialogBody()}
      </Dialog>

      <CreateContractDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        students={students}
        plans={plans}
        plansById={plansById}
        busy={busyAction}
        onSubmit={handleCreateSubmit}
      />
    </div>
  );
}
