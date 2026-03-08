import React from 'react';
import { ChevronDown, ChevronUp, MoreHorizontal, RefreshCw } from 'lucide-react';

import { accessBadge, contractBadge, financialBadge, formatDate, formatMoney } from './contractsUtils';

const sortableHeaders = [
  { key: 'student', label: 'Cliente/Aluno', sortable: false },
  { key: 'plan', label: 'Plano', sortable: false },
  { key: 'startDate', label: 'Inicio', sortable: true },
  { key: 'endDate', label: 'Fim', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'value', label: 'Valor', sortable: true },
  { key: 'updatedAt', label: 'Atualizacao', sortable: true },
];

const pageSizes = [20, 50, 100];

function SortHeader({ label, active, direction, onClick }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-left">
      <span>{label}</span>
      {active ? (
        direction === 'asc' ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )
      ) : null}
    </button>
  );
}

function RowMenu({ onAction }) {
  return (
    <div className="absolute right-0 top-8 z-30 w-40 rounded-md border border-zinc-700 bg-zinc-950 shadow-xl">
      <button type="button" onClick={() => onAction('detail')} className="w-full border-b border-zinc-800 px-3 py-2 text-left text-xs hover:bg-zinc-800">Ver detalhes</button>
      <button type="button" onClick={() => onAction('settle')} className="w-full border-b border-zinc-800 px-3 py-2 text-left text-xs hover:bg-zinc-800">Colocar em dia</button>
      <button type="button" onClick={() => onAction('renew')} className="w-full border-b border-zinc-800 px-3 py-2 text-left text-xs hover:bg-zinc-800">Renovar</button>
      <button type="button" onClick={() => onAction('pause')} className="w-full border-b border-zinc-800 px-3 py-2 text-left text-xs hover:bg-zinc-800">Pausar</button>
      <button type="button" onClick={() => onAction('cancel')} className="w-full border-b border-zinc-800 px-3 py-2 text-left text-xs hover:bg-zinc-800">Cancelar</button>
      <button type="button" onClick={() => onAction('pdf')} className="w-full border-b border-zinc-800 px-3 py-2 text-left text-xs hover:bg-zinc-800">Baixar PDF</button>
      <button type="button" onClick={() => onAction('copy')} className="w-full px-3 py-2 text-left text-xs hover:bg-zinc-800">Copiar link</button>
    </div>
  );
}

function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(Number(total || 0) / Number(pageSize || 20)));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 px-3 py-3 text-xs text-zinc-400">
      <p>
        Pagina {page} de {totalPages} • {total} contratos
      </p>
      <div className="flex items-center gap-2">
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs"
          aria-label="Itens por pagina"
        >
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {size}/pagina
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
          className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs disabled:opacity-40"
        >
          Anterior
        </button>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs disabled:opacity-40"
        >
          Proxima
        </button>
      </div>
    </div>
  );
}

export default function ContractsTable({
  rows,
  loading,
  error,
  page,
  pageSize,
  total,
  sortBy,
  sortDir,
  selectedIds,
  onSort,
  onToggleRow,
  onToggleAll,
  onAction,
  onOpenDetails,
  onPageChange,
  onPageSizeChange,
  onRetry,
  isFiltered,
  onClearFilters,
  canCreateContracts,
  onCreateContract,
}) {
  const [openMenuFor, setOpenMenuFor] = React.useState('');
  const selectedSet = new Set(selectedIds || []);
  const allSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row.contract_id));

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
        <p>Falha ao carregar contratos: {error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-red-400/40 bg-red-500/20 px-3 text-xs font-semibold uppercase"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!loading && !rows.length) {
    return (
      <div className="rounded-2xl border border-zinc-900 bg-zinc-950/72 p-10 text-center">
        <p className="text-sm text-zinc-300">
          {isFiltered ? 'Nenhum contrato encontrado para os filtros aplicados.' : 'Nenhum contrato cadastrado ainda.'}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {isFiltered ? (
            <button
              type="button"
              onClick={onClearFilters}
              className="h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-semibold uppercase"
            >
              Limpar filtros
            </button>
          ) : null}
          {!isFiltered && canCreateContracts ? (
            <button
              type="button"
              onClick={onCreateContract}
              className="h-9 rounded-md bg-[var(--brand-primary)] px-3 text-xs font-bold uppercase text-black hover:bg-[var(--brand-primary-hover)]"
            >
              Criar primeiro contrato
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950/72">
      <div className="overflow-x-auto">
        <table className="min-w-[1080px] w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => onToggleAll(event.target.checked)}
                  aria-label="Selecionar todos"
                  className="accent-[var(--brand-primary)]"
                />
              </th>
              {sortableHeaders.map((header) => (
                <th key={header.key} className="px-2 py-3 text-left">
                  {header.sortable ? (
                    <SortHeader
                      label={header.label}
                      active={sortBy === header.key}
                      direction={sortDir}
                      onClick={() => onSort(header.key)}
                    />
                  ) : (
                    header.label
                  )}
                </th>
              ))}
              <th className="w-14 px-2 py-3 text-left">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <tr key={`skeleton_${index}`} className="border-b border-zinc-800/70">
                    <td className="px-3 py-3"><div className="h-4 w-4 animate-pulse rounded bg-zinc-800" /></td>
                    <td className="px-2 py-3"><div className="h-4 w-40 animate-pulse rounded bg-zinc-800" /></td>
                    <td className="px-2 py-3"><div className="h-4 w-28 animate-pulse rounded bg-zinc-800" /></td>
                    <td className="px-2 py-3"><div className="h-4 w-24 animate-pulse rounded bg-zinc-800" /></td>
                    <td className="px-2 py-3"><div className="h-4 w-24 animate-pulse rounded bg-zinc-800" /></td>
                    <td className="px-2 py-3"><div className="h-6 w-28 animate-pulse rounded bg-zinc-800" /></td>
                    <td className="px-2 py-3"><div className="h-4 w-20 animate-pulse rounded bg-zinc-800" /></td>
                    <td className="px-2 py-3"><div className="h-4 w-28 animate-pulse rounded bg-zinc-800" /></td>
                    <td className="px-2 py-3"><div className="h-8 w-8 animate-pulse rounded bg-zinc-800" /></td>
                  </tr>
                ))
              : rows.map((row) => {
                  const contract = contractBadge(row.contract_status);
                  const financial = financialBadge(row.financial_status);
                  const access = accessBadge(row.access_status);
                  const menuOpen = openMenuFor === row.contract_id;

                  return (
                    <tr key={row.contract_id} className="border-b border-zinc-800/70 hover:bg-zinc-950/60">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(row.contract_id)}
                          onChange={(event) => onToggleRow(row.contract_id, event.target.checked)}
                          aria-label={`Selecionar contrato ${row.contract_id}`}
                          className="accent-[var(--brand-primary)]"
                        />
                      </td>
                      <td className="px-2 py-3">
                        <button type="button" onClick={() => onOpenDetails(row.contract_id)} className="text-left">
                          <p className="font-medium text-zinc-100">{row.student_name}</p>
                          <p className="text-xs text-zinc-500">{row.student_id}</p>
                        </button>
                      </td>
                      <td className="px-2 py-3 text-zinc-300">{row.plan_name || row.plan_id || '-'}</td>
                      <td className="px-2 py-3 text-zinc-300">{formatDate(row.current_period_start)}</td>
                      <td className="px-2 py-3 text-zinc-300">{formatDate(row.current_period_end)}</td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-1">
                          <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${contract.className}`}>{contract.label}</span>
                          <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${financial.className}`}>{financial.label}</span>
                          <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${access.className}`}>{access.label}</span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-zinc-100">{formatMoney(row.amount)}</td>
                      <td className="px-2 py-3 text-zinc-400">{formatDate(row.updated_at)}</td>
                      <td className="relative px-2 py-3">
                        <button
                          type="button"
                          onClick={() => setOpenMenuFor(menuOpen ? '' : row.contract_id)}
                          className="rounded-md border border-zinc-700 bg-zinc-800 p-2 hover:bg-zinc-700"
                          aria-label={`Acoes do contrato ${row.contract_id}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menuOpen ? (
                          <RowMenu
                            onAction={(action) => {
                              setOpenMenuFor('');
                              onAction(action, row);
                            }}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}
