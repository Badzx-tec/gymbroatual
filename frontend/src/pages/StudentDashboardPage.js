import React from 'react';
import { CalendarClock, ShieldCheck, Bell, ScanLine } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return '-';
  }
}

function formatStatus(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'active') return 'Ativo';
  if (normalized === 'past_due') return 'Em atraso';
  if (normalized === 'expired') return 'Vencido';
  if (normalized === 'canceled') return 'Cancelado';
  if (normalized === 'blocked') return 'Bloqueado';
  return value || '-';
}

export default function StudentDashboardPage() {
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.studentPortalDashboard();
      setData(response);
    } catch (err) {
      toast.error(err.message || 'Erro ao carregar painel do aluno');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const student = data?.student || {};
  const contract = data?.contract || null;
  const accessStatus = data?.access_status || 'active';
  const logs = data?.recent_access_logs || [];
  const notifications = data?.notifications || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Situacao de acesso
          </p>
          <p className="text-xl font-semibold mt-2">{formatStatus(accessStatus)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Plano</p>
          <p className="text-xl font-semibold mt-2">{contract?.plan_name || student.plan_id || '-'}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide flex items-center gap-1">
            <CalendarClock className="w-3.5 h-3.5" /> Vencimento
          </p>
          <p className="text-sm font-semibold mt-2">{formatDate(contract?.current_period_end || student.plan_expires_at)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Matricula</p>
          <p className="text-xl font-semibold mt-2">{student.matricula || '-'}</p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <h2 className="font-semibold uppercase text-sm tracking-wide mb-3">Meu contrato atual</h2>
        {!contract && <p className="text-sm text-zinc-500">Nenhum contrato encontrado.</p>}
        {contract && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-zinc-500">Inicio</p>
              <p>{formatDate(contract.current_period_start)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Vencimento</p>
              <p>{formatDate(contract.current_period_end)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Status do plano</p>
              <p>{formatStatus(contract.status)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Valor</p>
              <p>{Number(contract.amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <h2 className="font-semibold uppercase text-sm tracking-wide mb-3 flex items-center gap-2">
            <ScanLine className="w-4 h-4" /> Historico de acessos
          </h2>
          <ul className="space-y-2 text-sm max-h-72 overflow-auto pr-1">
            {logs.map((log) => (
              <li key={log.log_id || `${log.timestamp}-${log.tipo}`} className="border border-zinc-800 rounded-sm p-2">
                <p className="font-medium">{(log.autorizado || log.decision === 'allow') ? 'Acesso liberado' : 'Acesso negado'}</p>
                <p className="text-zinc-500 text-xs">{formatDate(log.timestamp || log.created_at)}</p>
              </li>
            ))}
            {logs.length === 0 && <li className="text-zinc-500">Sem acessos registrados.</li>}
          </ul>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <h2 className="font-semibold uppercase text-sm tracking-wide mb-3 flex items-center gap-2">
            <Bell className="w-4 h-4" /> Avisos
          </h2>
          <ul className="space-y-2 text-sm max-h-72 overflow-auto pr-1">
            {notifications.map((item) => (
              <li key={item.notif_id} className="border border-zinc-800 rounded-sm p-2">
                <p className="font-medium">{item.titulo || 'Aviso'}</p>
                <p className="text-zinc-400 text-xs">{item.mensagem || '-'}</p>
              </li>
            ))}
            {notifications.length === 0 && <li className="text-zinc-500">Sem avisos no momento.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
