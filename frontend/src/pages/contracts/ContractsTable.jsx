import React from 'react';
import { ChevronDown, ChevronUp, MoreHorizontal, RefreshCw } from 'lucide-react';

import { SkeletonTableRows } from '../../components/ui/Skeleton';

import {
  accessBadge,
  contractBadge,
  financialBadge,
  formatDate,
  formatContractValueBreakdown,
} from './contractsUtils';

const sortableHeaders = [
  { key: 'student', label: 'Cliente/Aluno', sortable: true },
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
    <div className="absolute right-0 top-8 z-30 w-40 rounded-md border border-[var(--surface-border)] bg-[var(--surface-raised)] shadow-xl">
      <button type="button" onClick={() => onAction('detail')} className="w-full border-b border-[var(--surface-border)] px-3 py-2 text-left text-xs hover:bg-[var(--surface-soft)]">Ver detalhes</button>
      <button type="button" onClick={() => onAction('settle')} className="w-full border-b border-[var(--surface-border)] px-3 py-2 text-left text-xs hover:bg-[var(--surface-soft)]">Colocar em dia</button>
      <button type="button" onClick={() => onAction('renew')} className="w-full border-b border-[var(--surface-border)] px-3 py-2 text-left text-xs hover:bg-[var(--surface-soft)]">Renovar</button>
      <button type="button" onClick={() => onAction('pause')} className="w-full border-b border-[var(--surface-border)] px-3 py-2 text-left text-xs hover:bg-[var(--surface-soft)]">Pausar</button>
      <button type="button" onClick={() => onAction('cancel')} className="w-full border-b border-[var(--surface-border)] px-3 py-2 text-left text-xs hover:bg-[var(--surface-soft)]">Cancelar</button>
      <button type="button" onClick={() => onAction('pdf')} className="w-full border-b border-[var(--surface-border)] px-3 py-2 text-left text-xs hover:bg-[var(--surface-soft)]">Baixar PDF</button>
      <button type="button" onClick={() => onAction('copy')} className="w-full px-3 py-2 text-left text-xs hover:bg-[var(--surface-soft)]">Copiar link</button>
    </div>
  );
}

function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(Number(total || 0) / Number(pageSize || 20)));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--surface-border)] px-4 py-3 text-xs text-[var(--text-muted)]">
      <p>
        Pagina {page} de {totalPages} | {total} contratos
      </p>
      <div className="flex items-center gap-2">
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-8 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-soft)] px-2 text-xs text-[var(--text-secondary)]"
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
          className="h-8 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-soft)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft-hover)] disabled:opacity-40"
        >
          Anterior
        </button>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          className="h-8 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-soft)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft-hover)] disabled:opacity-40"
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
      <div className="rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-6 text-sm text-[var(--status-danger-text)]">
        <p>Falha ao carregar contratos: {error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-xs font-semibold uppercase"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!loading && !rows.length) {
    return (
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-10 text-center">
        <p className="text-sm text-[var(--text-secondary)]">
          {isFiltered ? 'Nenhum contrato encontrado para os filtros aplicados.' : 'Nenhum contrato cadastrado ainda.'}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {isFiltered ? (
            <button
              type="button"
              onClick={onClearFilters}
              className="h-9 rounded-md border border-[var(--surface-border-strong)] bg-[var(--surface-soft)] px-3 text-xs font-semibold uppercase"
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

  // Mobile card list (< md breakpoint)
  const MobileList = () => (
    <div className="divide-y divide-[var(--surface-border)] md:hidden">
      {loading
        ? Array.from({ length: 4 }).map((_, index) => (
            <div key={`m_sk_${index}`} className="space-y-2 p-4">
              <div className="h-4 w-40 animate-pulse rounded bg-[var(--surface-soft)]" />
              <div className="h-3 w-32 animate-pulse rounded bg-[var(--surface-soft)]" />
            </div>
          ))
        : rows.map((row) => {
            const contract = contractBadge(row.contract_status);
            const financial = financialBadge(row.financial_status);
            const access = accessBadge(row.access_status);
            const valueBreakdown = formatContractValueBreakdown(row);
            return (
              <div key={row.contract_id} className="flex items-start justify-between gap-3 p-4">
                <button
                  type="button"
                  onClick={() => onOpenDetails(row.contract_id)}
                  className="flex-1 text-left"
                >
                  <p className="font-semibold text-[var(--text-primary)]">{row.student_name}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">{row.plan_name || row.plan_id || '-'}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${contract.className}`}>{contract.label}</span>
                    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${financial.className}`}>{financial.label}</span>
                    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${access.className}`}>{access.label}</span>
                  </div>
                  <p className="mt-1 font-mono font-semibold text-[var(--text-primary)]">{valueBreakdown.finalLabel}</p>
                </button>
                <button
                  type="button"
                  onClick={() => onAction('detail', row)}
                  className="shrink-0 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-soft)] p-2 transition-colors hover:bg-[var(--surface-soft-hover)]"
                  aria-label={`Acoes do contrato ${row.contract_id}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
            );
          })}
    </div>
  );

  return (
    <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] overflow-hidden">
      <MobileList />
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-[960px] w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--surface-border)] bg-[var(--surface-soft)] text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
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
              ? <SkeletonTableRows rows={8} columns={9} />
              : rows.map((row) => {
                  const contract = contractBadge(row.contract_status);
                  const financial = financialBadge(row.financial_status);
                  const access = accessBadge(row.access_status);
                  const valueBreakdown = formatContractValueBreakdown(row);
                  const menuOpen = openMenuFor === row.contract_id;

                  return (
                    <tr key={row.contract_id} className="group/row border-b border-[var(--surface-border)] transition-colors hover:bg-[var(--surface-soft)]">
                      <td className="px-3 py-2.5 align-middle">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(row.contract_id)}
                          onChange={(event) => onToggleRow(row.contract_id, event.target.checked)}
                          aria-label={`Selecionar contrato ${row.contract_id}`}
                          className="accent-[var(--brand-primary)]"
                        />
                      </td>
                      <td className="px-2 py-2.5 align-middle">
                        <button type="button" onClick={() => onOpenDetails(row.contract_id)} className="text-left">
                          <p className="font-medium text-[var(--text-primary)] group-hover/row:text-[var(--brand-primary)] transition-colors">{row.student_name}</p>
                          <p className="font-mono text-[11px] text-[var(--text-muted)]">{row.student_id}</p>
                        </button>
                      </td>
                      <td className="px-2 py-2.5 align-middle text-[var(--text-secondary)] text-xs">{row.plan_name || row.plan_id || '-'}</td>
                      <td className="px-2 py-2.5 align-middle font-mono text-xs text-[var(--text-secondary)] whitespace-nowrap">{formatDate(row.current_period_start)}</td>
                      <td className="px-2 py-2.5 align-middle font-mono text-xs text-[var(--text-secondary)] whitespace-nowrap">{formatDate(row.current_period_end)}</td>
                      <td className="px-2 py-2.5 align-middle">
                        <div className="flex flex-wrap gap-1 max-w-[280px]">
                          <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${contract.className}`}>{contract.label}</span>
                          <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${financial.className}`}>{financial.label}</span>
                          <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${access.className}`}>{access.label}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 align-middle">
                        <p className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">{valueBreakdown.finalLabel}</p>
                        {valueBreakdown.hasDiscount ? (
                          <p className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                            -{valueBreakdown.discountLabel}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2.5 align-middle font-mono text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDate(row.updated_at)}</td>
                      <td className="relative px-2 py-2.5 align-middle">
                        <button
                          type="button"
                          onClick={() => setOpenMenuFor(menuOpen ? '' : row.contract_id)}
                          className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-soft)] p-2 transition-colors hover:bg-[var(--surface-soft-hover)] hover:border-[var(--surface-border-strong)]"
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
