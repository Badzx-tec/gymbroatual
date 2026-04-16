import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const SAVED_VIEW_KEY = 'gymbro_contracts_saved_view';

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBool(value) {
  const raw = String(value || '').toLowerCase().trim();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function parseQuery(searchParams) {
  return {
    page: parseIntOr(searchParams.get('page'), 1),
    pageSize: parseIntOr(searchParams.get('pageSize'), 20),
    q: searchParams.get('q') || '',
    sortBy: searchParams.get('sortBy') || 'updatedAt',
    sortDir: (searchParams.get('sortDir') || 'desc') === 'asc' ? 'asc' : 'desc',
    status: searchParams.getAll('status').filter(Boolean),
    planoId: searchParams.getAll('planoId').filter(Boolean),
    startDate: searchParams.get('startDate') || '',
    endDate: searchParams.get('endDate') || '',
    expiringInDays: searchParams.get('expiringInDays') || '',
    pendingOnly: parseBool(searchParams.get('pendingOnly')),
    includeArchived: parseBool(searchParams.get('includeArchived')),
    contractId: searchParams.get('contractId') || '',
  };
}

function buildQuery(state) {
  const query = new URLSearchParams();
  if (state.page && state.page !== 1) query.set('page', String(state.page));
  if (state.pageSize && state.pageSize !== 20) query.set('pageSize', String(state.pageSize));
  if (state.q) query.set('q', state.q);
  if (state.sortBy && state.sortBy !== 'updatedAt') query.set('sortBy', state.sortBy);
  if (state.sortDir && state.sortDir !== 'desc') query.set('sortDir', state.sortDir);
  (state.status || []).filter(Boolean).forEach((v) => query.append('status', v));
  (state.planoId || []).filter(Boolean).forEach((v) => query.append('planoId', v));
  if (state.startDate) query.set('startDate', state.startDate);
  if (state.endDate) query.set('endDate', state.endDate);
  if (state.expiringInDays) query.set('expiringInDays', String(state.expiringInDays));
  if (state.pendingOnly) query.set('pendingOnly', 'true');
  if (state.includeArchived) query.set('includeArchived', 'true');
  if (state.contractId) query.set('contractId', state.contractId);
  return query;
}

function blankDraft() {
  return {
    status: [],
    planoId: [],
    startDate: '',
    endDate: '',
    expiringInDays: '',
    pendingOnly: false,
    includeArchived: false,
  };
}

function draftFromQuery(queryState) {
  return {
    status: [...(queryState.status || [])],
    planoId: [...(queryState.planoId || [])],
    startDate: queryState.startDate || '',
    endDate: queryState.endDate || '',
    expiringInDays: String(queryState.expiringInDays || ''),
    pendingOnly: Boolean(queryState.pendingOnly),
    includeArchived: Boolean(queryState.includeArchived),
  };
}

/**
 * Manages all filter/query state for the contracts list.
 * The URL is the single source of truth for committed filters.
 * filtersDraft is staging state for the filter panel (not yet applied).
 */
export function useContractFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryState = useMemo(() => parseQuery(searchParams), [searchParams]);

  const [filtersDraft, setFiltersDraft] = useState(() => draftFromQuery(queryState));
  const [filtersOpen, setFiltersOpen] = useState(false);

  const updateQueryState = useCallback(
    (patch, options = {}) => {
      const next = { ...queryState, ...patch };
      if (options.resetPage) next.page = 1;
      setSearchParams(buildQuery(next), { replace: options.replace !== false });
    },
    [queryState, setSearchParams]
  );

  const openFilters = useCallback(() => {
    setFiltersDraft(draftFromQuery(queryState));
    setFiltersOpen(true);
  }, [queryState]);

  const applyFilters = useCallback(() => {
    updateQueryState(
      {
        status: filtersDraft.status || [],
        planoId: filtersDraft.planoId || [],
        startDate: filtersDraft.startDate || '',
        endDate: filtersDraft.endDate || '',
        expiringInDays: filtersDraft.expiringInDays || '',
        pendingOnly: Boolean(filtersDraft.pendingOnly),
        includeArchived: Boolean(filtersDraft.includeArchived),
      },
      { resetPage: true }
    );
    setFiltersOpen(false);
  }, [filtersDraft, updateQueryState]);

  const clearFilters = useCallback(() => {
    updateQueryState(
      {
        status: [],
        planoId: [],
        startDate: '',
        endDate: '',
        expiringInDays: '',
        pendingOnly: false,
        includeArchived: false,
        q: '',
      },
      { resetPage: true }
    );
    setFiltersDraft(blankDraft());
  }, [updateQueryState]);

  const saveView = useCallback(() => {
    localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify(filtersDraft));
  }, [filtersDraft]);

  const restoreSavedView = useCallback(() => {
    const raw = localStorage.getItem(SAVED_VIEW_KEY);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      setFiltersDraft(parsed);
      updateQueryState(
        {
          status: Array.isArray(parsed.status) ? parsed.status : [],
          planoId: Array.isArray(parsed.planoId) ? parsed.planoId : [],
          startDate: parsed.startDate || '',
          endDate: parsed.endDate || '',
          expiringInDays: parsed.expiringInDays || '',
          pendingOnly: Boolean(parsed.pendingOnly),
          includeArchived: Boolean(parsed.includeArchived),
        },
        { resetPage: true }
      );
      return true;
    } catch {
      return false;
    }
  }, [updateQueryState]);

  const setContractInUrl = useCallback(
    (contractId) => {
      updateQueryState({ contractId: contractId || '' }, { replace: true });
    },
    [updateQueryState]
  );

  const toggleQuickFilter = useCallback(
    (key) => {
      const quickFilterKey =
        queryState.pendingOnly
          ? 'pending'
          : String(queryState.expiringInDays) === '7'
            ? 'expiring'
            : queryState.status.length === 1 && queryState.status[0] === 'active'
              ? 'active'
              : queryState.status.length === 1 && queryState.status[0] === 'canceled'
                ? 'canceled'
                : '';

      if (quickFilterKey === key) {
        clearFilters();
        return;
      }
      if (key === 'active') updateQueryState({ status: ['active'], expiringInDays: '', pendingOnly: false }, { resetPage: true });
      if (key === 'expiring') updateQueryState({ expiringInDays: '7', status: [], pendingOnly: false }, { resetPage: true });
      if (key === 'pending') updateQueryState({ pendingOnly: true, status: [], expiringInDays: '' }, { resetPage: true });
      if (key === 'canceled') updateQueryState({ status: ['canceled'], expiringInDays: '', pendingOnly: false }, { resetPage: true });
    },
    [queryState, clearFilters, updateQueryState]
  );

  // Derived
  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        (queryState.status || []).length ||
          (queryState.planoId || []).length ||
          queryState.startDate ||
          queryState.endDate ||
          queryState.expiringInDays ||
          queryState.pendingOnly ||
          queryState.includeArchived ||
          queryState.q
      ),
    [queryState]
  );

  const quickFilterKey = useMemo(() => {
    if (queryState.pendingOnly) return 'pending';
    if (String(queryState.expiringInDays) === '7') return 'expiring';
    if (queryState.status.length === 1 && queryState.status[0] === 'active') return 'active';
    if (queryState.status.length === 1 && queryState.status[0] === 'canceled') return 'canceled';
    return '';
  }, [queryState]);

  return {
    // committed query state (URL-driven)
    queryState,
    updateQueryState,
    // filter panel draft
    filtersOpen,
    setFiltersOpen,
    filtersDraft,
    setFiltersDraft,
    openFilters,
    applyFilters,
    clearFilters,
    saveView,
    restoreSavedView,
    // detail URL helper
    setContractInUrl,
    // quick filter
    quickFilterKey,
    toggleQuickFilter,
    // derived
    hasActiveFilters,
  };
}
