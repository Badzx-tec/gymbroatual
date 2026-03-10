import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, FileSpreadsheet, RefreshCw, ScanLine, Search, ShieldAlert, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SectionCard from '../components/ui/SectionCard';
import SelectField from '../components/ui/SelectField';
import SidePanel from '../components/ui/SidePanel';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import { directionLabel, subjectTypeLabel } from '../utils/labels';

const REASON_LABELS = {
  ok: 'Acesso valido',
  biometry_required: 'Biometria obrigatoria',
  credential_required: 'Credencial obrigatoria',
  credential_not_found: 'Credencial nao encontrada',
  passage_without_authorization: 'Passagem sem credencial/autorizacao',
  contract_access_blocked: 'Contrato bloqueado',
  student_manual_block: 'Bloqueio manual do aluno',
  employee_manual_block: 'Bloqueio manual do funcionario',
  owner_manual_block: 'Bloqueio manual do dono da academia',
  turnstile_direction_locked: 'Fluxo travado na catraca',
  academy_subscription_inactive: 'Assinatura da academia inativa',
};

const formatDateTime = (value) => {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return String(value);
  }
};

const toDate = (log) => {
  const value = log?.created_at || log?.timestamp || null;
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const isToday = (date) => {
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
};

function reasonLabel(reason) {
  const key = String(reason || '').toLowerCase();
  if (!key) return '-';
  return REASON_LABELS[key] || key.replaceAll('_', ' ');
}

function decisionMeta(log) {
  const allowed = String(log?.decision || '').toLowerCase() === 'allow';
  return allowed ? { label: 'Liberado', tone: 'success' } : { label: 'Negado', tone: 'danger' };
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm text-zinc-100">{value}</p>
    </div>
  );
}

export default function AccessLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileFilter, setProfileFilter] = useState('');
  const [decisionFilter, setDecisionFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);

  const loadData = React.useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const response = await api.listTurnstileAccessLogs({
        limit: 300,
        subject_type: profileFilter || undefined,
        decision: decisionFilter || undefined,
        since_minutes: 24 * 60,
      });
      const onlyToday = (response || []).filter((item) => isToday(toDate(item)));
      setLogs(onlyToday.slice(0, 200));
    } catch (err) {
      toast.error(err?.message || 'Erro ao carregar os acessos.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profileFilter, decisionFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredLogs = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return logs;
    return logs.filter((log) => {
      const haystack = [
        log.subject_name,
        log.student_name,
        log.employee_name,
        log.owner_name,
        log.subject_id,
        log.reason,
        log.method,
        log.direction,
      ]
        .map((item) => String(item || '').toLowerCase())
        .join(' ');
      return haystack.includes(term);
    });
  }, [logs, search]);

  const stats = useMemo(() => {
    const total = filteredLogs.length;
    const liberados = filteredLogs.filter((item) => String(item.decision || '').toLowerCase() === 'allow').length;
    const negados = total - liberados;
    const topReason = Object.entries(filteredLogs.reduce((acc, item) => {
      const key = String(item.reason || 'unknown').toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1])[0];
    return { total, liberados, negados, topReason };
  }, [filteredLogs]);

  if (loading) {
    return <LoadingScreen label="Carregando acessos..." />;
  }

  return (
    <div className="space-y-6" data-testid="access-logs-page">
      <PageHeader
        eyebrow="Acesso"
        title="Registro de acessos"
        subtitle="Acompanhe entradas e negacoes de hoje com foco em perfil, direcao e motivo operacional."
        actions={
          <>
            <Button type="button" onClick={() => { api.exportAccessExcel(); toast.success('Exportando acessos para Excel.'); }} variant="ghost" size="sm">
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </Button>
            <Button type="button" onClick={() => loadData({ silent: true })} variant="secondary" size="sm">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total de hoje" value={stats.total} hint="Acessos apos filtros locais" icon={ScanLine} accent="info" />
        <StatCard label="Liberados" value={stats.liberados} hint="Leituras autorizadas" icon={CheckCircle} accent="success" />
        <StatCard label="Negados" value={stats.negados} hint="Leituras bloqueadas" icon={XCircle} accent={stats.negados > 0 ? 'danger' : 'default'} />
        <StatCard label="Motivo mais comum" value={stats.topReason ? reasonLabel(stats.topReason[0]) : '-'} hint={stats.topReason ? `${stats.topReason[1]} ocorrencias` : 'Sem motivos registrados'} icon={ShieldAlert} accent={stats.negados > 0 ? 'warning' : 'default'} />
      </div>

      <SectionCard title="Filtros" description="Combine perfil, decisao e busca local para reduzir o ruido da operacao.">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <div className="max-w-xl">
            <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por pessoa, metodo, motivo ou direcao" aria-label="Buscar acessos" />
          </div>
          <SelectField label="Perfil" value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)} className="min-w-[200px]">
            <option value="">Todos os perfis</option>
            <option value="student">Alunos</option>
            <option value="employee">Funcionarios</option>
            <option value="owner">Dono da academia</option>
          </SelectField>
          <SelectField label="Decisao" value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value)} className="min-w-[180px]">
            <option value="">Todas</option>
            <option value="allow">Liberados</option>
            <option value="deny">Negados</option>
          </SelectField>
        </div>
      </SectionCard>

      <SectionCard title="Leituras de hoje" description="Lista das leituras de catraca mais recentes do dia atual." bodyClassName="p-0">
        {filteredLogs.length ? (
          <div className="overflow-x-auto">
            <table data-testid="access-logs-table" className="min-w-[1100px] w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-900 text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  <th className="px-5 py-3">Horario</th>
                  <th className="px-5 py-3">Pessoa</th>
                  <th className="px-5 py-3">Perfil</th>
                  <th className="px-5 py-3">Direcao</th>
                  <th className="px-5 py-3">Metodo</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Motivo</th>
                  <th className="px-5 py-3 text-right">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log, index) => {
                  const meta = decisionMeta(log);
                  return (
                    <tr key={log.access_id || `${log.created_at || log.timestamp}-${index}`} className="border-b border-zinc-900/70 hover:bg-zinc-950/40">
                      <td className="px-5 py-4 text-zinc-300 whitespace-nowrap">{formatDateTime(log.created_at || log.timestamp)}</td>
                      <td className="px-5 py-4 font-medium text-zinc-100">{log.subject_name || log.student_name || log.employee_name || log.owner_name || log.subject_id || 'Nao identificado'}</td>
                      <td className="px-5 py-4 text-zinc-400">{subjectTypeLabel(log.subject_type)}</td>
                      <td className="px-5 py-4 text-zinc-400">{directionLabel(log.direction)}</td>
                      <td className="px-5 py-4 text-zinc-400">{log.method || '-'}</td>
                      <td className="px-5 py-4"><StatusBadge label={meta.label} tone={meta.tone} /></td>
                      <td className="px-5 py-4 text-zinc-400">{reasonLabel(log.reason)}</td>
                      <td className="px-5 py-4 text-right"><Button type="button" variant="ghost" size="sm" onClick={() => setSelectedLog(log)}>Ver detalhe</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={Search} title="Nenhum acesso encontrado" description="Ajuste os filtros ou aguarde novas leituras de catraca." />
          </div>
        )}
      </SectionCard>

      <SidePanel
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title="Detalhe do acesso"
        description="Resumo tecnico da leitura selecionada."
        actions={<Button type="button" variant="ghost" onClick={() => setSelectedLog(null)}>Fechar</Button>}
      >
        {selectedLog ? (
          <div className="space-y-3">
            <DetailItem label="Pessoa" value={selectedLog.subject_name || selectedLog.student_name || selectedLog.employee_name || selectedLog.owner_name || selectedLog.subject_id || 'Nao identificado'} />
            <DetailItem label="Perfil" value={subjectTypeLabel(selectedLog.subject_type)} />
            <DetailItem label="Horario" value={formatDateTime(selectedLog.created_at || selectedLog.timestamp)} />
            <DetailItem label="Direcao" value={directionLabel(selectedLog.direction)} />
            <DetailItem label="Metodo" value={selectedLog.method || '-'} />
            <DetailItem label="Resultado" value={decisionMeta(selectedLog).label} />
            <DetailItem label="Motivo" value={reasonLabel(selectedLog.reason)} />
            <DetailItem label="Dispositivo" value={selectedLog.device_id || '-'} />
            <DetailItem label="Credencial" value={selectedLog.credential_masked || selectedLog.credential || '-'} />
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
