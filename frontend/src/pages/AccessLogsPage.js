import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ScanLine, CheckCircle, XCircle, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { directionLabel, subjectTypeLabel } from '../utils/labels';

const REASON_LABELS = {
  ok: 'Acesso valido',
  credential_not_found: 'Credencial nao encontrada',
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
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
};

function reasonLabel(reason) {
  const key = String(reason || '').toLowerCase();
  if (!key) return '-';
  return REASON_LABELS[key] || key.replaceAll('_', ' ');
}

export default function AccessLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profileFilter, setProfileFilter] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const response = await api.listTurnstileAccessLogs({
        limit: 300,
        subject_type: profileFilter || undefined,
        since_minutes: 24 * 60,
      });
      const onlyToday = (response || []).filter((item) => isToday(toDate(item)));
      setLogs(onlyToday.slice(0, 200));
    } catch (err) {
      toast.error(err?.message || 'Erro ao carregar os acessos.');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [profileFilter]);

  const stats = useMemo(() => {
    const total = logs.length;
    const liberados = logs.filter((item) => String(item.decision || '').toLowerCase() === 'allow').length;
    const negados = total - liberados;
    return { total, liberados, negados };
  }, [logs]);

  return (
    <div data-testid="access-logs-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Registro de acessos</h1>
          <p className="text-zinc-400 mt-1">Acessos de hoje com identificacao de aluno, funcionario e dono da academia.</p>
        </div>
        <div className="flex gap-2">
          <select
            value={profileFilter}
            onChange={(event) => setProfileFilter(event.target.value)}
            className="h-10 bg-zinc-800 border border-zinc-700 rounded-sm px-3 text-sm"
          >
            <option value="">Todos os perfis</option>
            <option value="student">Alunos</option>
            <option value="employee">Funcionarios</option>
            <option value="owner">Dono da academia</option>
          </select>
          <button data-testid="export-access-excel-btn" onClick={() => { api.exportAccessExcel(); toast.success('Exportando...'); }}
            className="flex items-center gap-2 bg-zinc-800 text-white text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded-sm hover:bg-zinc-700">
            <FileSpreadsheet className="w-4 h-4 text-green-500" /> Excel
          </button>
          <button data-testid="refresh-logs-btn" onClick={loadData}
            className="flex items-center gap-2 bg-zinc-800 text-white font-semibold uppercase tracking-wide text-sm px-6 py-2.5 rounded-sm hover:bg-zinc-700">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium uppercase tracking-wide text-zinc-400">Total</span>
            <ScanLine className="w-5 h-5 text-zinc-400" />
          </div>
          <p className="text-2xl font-bold mt-2">{stats.total}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium uppercase tracking-wide text-zinc-400">Liberados</span>
            <CheckCircle className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-2xl font-bold mt-2 text-green-500">{stats.liberados}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium uppercase tracking-wide text-zinc-400">Negados</span>
            <XCircle className="w-5 h-5 text-red-500" />
          </div>
          <p className="text-2xl font-bold mt-2 text-red-500">{stats.negados}</p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
        <table data-testid="access-logs-table" className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
              <th className="text-left px-5 py-3 font-medium">Horario</th>
              <th className="text-left px-5 py-3 font-medium">Pessoa</th>
              <th className="text-left px-5 py-3 font-medium">Perfil</th>
              <th className="text-left px-5 py-3 font-medium">Direcao</th>
              <th className="text-left px-5 py-3 font-medium">Metodo</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr key={log.access_id || i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                <td className="px-5 py-3 text-zinc-300 whitespace-nowrap">{formatDateTime(log.created_at || log.timestamp)}</td>
                <td className="px-5 py-3 font-medium">
                  {log.subject_name || log.student_name || log.employee_name || log.owner_name || log.subject_id || 'Nao identificado'}
                </td>
                <td className="px-5 py-3">{subjectTypeLabel(log.subject_type)}</td>
                <td className="px-5 py-3">{directionLabel(log.direction)}</td>
                <td className="px-5 py-3"><span className="text-xs uppercase tracking-wider bg-zinc-800 px-2 py-1 rounded-sm">{log.method || '-'}</span></td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-sm border ${String(log.decision || '').toLowerCase() === 'allow' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${String(log.decision || '').toLowerCase() === 'allow' ? 'bg-green-500' : 'bg-red-500'}`} />
                    {String(log.decision || '').toLowerCase() === 'allow' ? 'Liberado' : 'Negado'}
                  </span>
                </td>
                <td className="px-5 py-3 text-zinc-400">{reasonLabel(log.reason)}</td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-zinc-500">Nenhum registro de acesso</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
