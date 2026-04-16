import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { api } from '../../api';

/**
 * Manages contract list data fetching, detail loading, and support data (plans/students).
 * Takes queryState from useContractFilters as its only input.
 */
export function useContracts(queryState) {
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
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);

  const [plans, setPlans] = useState([]);
  const [students, setStudents] = useState([]);

  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

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
        includeArchived: queryState.includeArchived,
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
      const [plansData, studentsData] = await Promise.all([api.listPlans(), api.listStudents('', '')]);
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

  const clearDetail = useCallback(() => {
    setDetailData(null);
    setDetailError('');
  }, []);

  useEffect(() => {
    loadSupportData();
  }, [loadSupportData]);

  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  const toggleRow = useCallback((contractId, checked) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(contractId);
      else next.delete(contractId);
      return Array.from(next);
    });
  }, []);

  const toggleAllRows = useCallback(
    (checked) => {
      setSelectedIds(checked ? rows.map((item) => item.contract_id) : []);
    },
    [rows]
  );

  const overview = {
    active: Number(meta?.totalsByStatus?.active || 0),
    expiringSoon: Number(meta?.expiringSoonCount || 0),
    pending: Number(meta?.pendingCount || 0),
    canceledMonth: Number(meta?.canceledMonthCount || 0),
  };

  return {
    // list
    rows,
    meta,
    loadingList,
    listError,
    loadContracts,
    overview,
    // selection
    selectedIds,
    setSelectedIds,
    toggleRow,
    toggleAllRows,
    // support data
    plans,
    students,
    // detail
    detailData,
    detailLoading,
    detailError,
    loadDetail,
    clearDetail,
  };
}
