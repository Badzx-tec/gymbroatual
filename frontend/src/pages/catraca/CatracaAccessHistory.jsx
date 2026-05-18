import React from 'react';
import { ScanLine } from 'lucide-react';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import SectionCard from '../../components/ui/SectionCard';
import SearchInput from '../../components/ui/SearchInput';
import SelectField from '../../components/ui/SelectField';
import SidePanel from '../../components/ui/SidePanel';
import StatusBadge from '../../components/ui/StatusBadge';
import TextField from '../../components/ui/TextField';
import { directionLabel, subjectTypeLabel } from '../../utils/labels';
import {
  decisionTone,
  extractReasonDetail,
  formatDateTime,
  reasonLabel,
} from './catracaUtils';

/**
 * Access-log filter bar + table + detail SidePanel.
 * All behaviour lives in the parent (CatracaPage); this component is display-only.
 */
export default function CatracaAccessHistory({
  visibleLogs,
  filters,
  setFilters,
  accessSearch,
  setAccessSearch,
  selectedLog,
  setSelectedLog,
}) {
  return (
    <>
      <SectionCard
        title="Filtros de acessos"
        description="Combine filtro de backend com busca local para encontrar eventos especificos com rapidez."
        actions={
          <div className="grid w-full gap-2 xl:grid-cols-[minmax(260px,1fr)_170px_170px_220px_170px_150px]">
            <SearchInput
              value={accessSearch}
              onChange={(event) => setAccessSearch(event.target.value)}
              placeholder="Buscar por pessoa, dispositivo, metodo ou credencial"
            />
            <SelectField
              label=""
              value={filters.decision}
              onChange={(event) => setFilters((current) => ({ ...current, decision: event.target.value }))}
            >
              <option value="">Todas as decisoes</option>
              <option value="allow">Somente liberados</option>
              <option value="deny">Somente negados</option>
            </SelectField>
            <SelectField
              label=""
              value={filters.subject_type}
              onChange={(event) => setFilters((current) => ({ ...current, subject_type: event.target.value }))}
            >
              <option value="">Todos os perfis</option>
              <option value="student">Alunos</option>
              <option value="employee">Funcionarios</option>
              <option value="owner">Dono da academia</option>
            </SelectField>
            <TextField
              label=""
              value={filters.reason}
              onChange={(event) =>
                setFilters((current) => ({ ...current, reason: event.target.value.trim().toLowerCase() }))
              }
              placeholder="Motivo tecnico"
            />
            <SelectField
              label=""
              value={filters.since_minutes}
              onChange={(event) =>
                setFilters((current) => ({ ...current, since_minutes: Number(event.target.value) || 60 }))
              }
            >
              <option value={15}>Ultimos 15 min</option>
              <option value={60}>Ultimos 60 min</option>
              <option value={180}>Ultimas 3 h</option>
              <option value={1440}>Ultimas 24 h</option>
            </SelectField>
            <SelectField
              label=""
              value={filters.limit}
              onChange={(event) =>
                setFilters((current) => ({ ...current, limit: Number(event.target.value) || 80 }))
              }
            >
              <option value={50}>50 linhas</option>
              <option value={80}>80 linhas</option>
              <option value={120}>120 linhas</option>
              <option value={200}>200 linhas</option>
            </SelectField>
          </div>
        }
        bodyClassName="p-0"
      >
        {visibleLogs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead>
                <tr className="border-b border-[var(--surface-border)] text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  <th className="px-5 py-4">Data</th>
                  <th className="px-5 py-4">Pessoa</th>
                  <th className="px-5 py-4">Perfil</th>
                  <th className="px-5 py-4">Direcao</th>
                  <th className="px-5 py-4">Metodo</th>
                  <th className="px-5 py-4">Decisao</th>
                  <th className="px-5 py-4">Motivo</th>
                  <th className="px-5 py-4 text-right">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((log) => (
                  <tr
                    key={log.access_id || `${log.created_at}-${log.credential_masked}`}
                    className="group/row border-b border-[var(--surface-border)] transition-colors hover:bg-[var(--surface-soft)]"
                  >
                    <td className="px-5 py-3 font-mono text-xs text-[var(--text-secondary)] whitespace-nowrap">
                      {formatDateTime(log.created_at || log.timestamp)}
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-[var(--text-primary)] transition-colors group-hover/row:text-[var(--brand-primary)]">
                        {log.subject_name || log.student_name || log.employee_name || log.owner_name || log.subject_id || '-'}
                      </p>
                      <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">{log.device_id || '-'}</p>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge label={subjectTypeLabel(log.subject_type)} tone="neutral" />
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-secondary)]">{directionLabel(log.direction)}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-secondary)]">{log.method || '-'}</td>
                    <td className="px-5 py-4">
                      <StatusBadge
                        label={String(log.decision || '-').toLowerCase() === 'allow' ? 'Liberado' : 'Negado'}
                        tone={decisionTone(log.decision)}
                      />
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      <div>{reasonLabel(log.reason)}</div>
                      {extractReasonDetail(log) ? (
                        <div className="mt-1 text-xs text-[var(--text-muted)]/70">{extractReasonDetail(log)}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedLog(log)}
                        aria-label="Ver detalhe"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-transparent text-[var(--text-muted)] transition hover:border-[var(--surface-border-strong)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
                      >
                        <ScanLine className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={ScanLine}
              title="Nenhum acesso encontrado"
              description="Ajuste os filtros ou a busca local para localizar outro evento da catraca."
            />
          </div>
        )}
      </SectionCard>

      <SidePanel
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title={
          selectedLog
            ? `Acesso ${String(selectedLog.decision || '').toLowerCase() === 'allow' ? 'liberado' : 'negado'}`
            : 'Detalhe do acesso'
        }
        description="Detalhes tecnicos do evento retornado pela catraca e pela regra de autorizacao."
        actions={
          <Button variant="ghost" onClick={() => setSelectedLog(null)}>
            Fechar
          </Button>
        }
      >
        {selectedLog ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                label={String(selectedLog.decision || '-').toLowerCase() === 'allow' ? 'Liberado' : 'Negado'}
                tone={decisionTone(selectedLog.decision)}
              />
              <StatusBadge label={subjectTypeLabel(selectedLog.subject_type)} tone="neutral" />
              <StatusBadge label={directionLabel(selectedLog.direction)} tone="info" />
            </div>

            <div className="grid gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-soft)] p-4 md:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Pessoa</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">
                  {selectedLog.subject_name || selectedLog.student_name || selectedLog.employee_name || selectedLog.owner_name || '-'}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Data</p>
                <p className="mt-1 font-mono text-sm text-[var(--text-primary)]">
                  {formatDateTime(selectedLog.created_at || selectedLog.timestamp)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Dispositivo</p>
                <p className="mt-1 font-mono text-sm text-[var(--text-primary)]">{selectedLog.device_id || '-'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Metodo</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{selectedLog.method || '-'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">ID do sujeito</p>
                <p className="mt-1 font-mono text-sm text-[var(--text-primary)]">{selectedLog.subject_id || '-'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Credencial mascarada</p>
                <p className="mt-1 font-mono text-sm text-[var(--text-primary)]">{selectedLog.credential_masked || '-'}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-soft)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Motivo principal</p>
              <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{reasonLabel(selectedLog.reason)}</p>
              {extractReasonDetail(selectedLog) ? (
                <p className="mt-2 text-sm text-[var(--text-secondary)]">{extractReasonDetail(selectedLog)}</p>
              ) : null}
            </div>

            {selectedLog.reason_detail ? (
              <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-soft)] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Contexto tecnico</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
                  {JSON.stringify(selectedLog.reason_detail, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </>
  );
}
