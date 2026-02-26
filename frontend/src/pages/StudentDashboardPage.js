import React from 'react';
import { CalendarClock, ShieldCheck, Bell, ScanLine, AlertTriangle, RefreshCw } from 'lucide-react';
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

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusLabel(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'active') return 'Ativo';
  if (normalized === 'allowed') return 'Liberado';
  if (normalized === 'grace_period') return 'Carencia';
  if (normalized === 'past_due') return 'Em atraso';
  if (normalized === 'overdue') return 'Atrasado';
  if (normalized === 'failed') return 'Falha';
  if (normalized === 'expired') return 'Vencido';
  if (normalized === 'canceled') return 'Cancelado';
  if (normalized === 'blocked') return 'Bloqueado';
  if (normalized === 'suspended') return 'Suspenso';
  if (normalized === 'frozen') return 'Congelado';
  if (normalized === 'pending') return 'Pendente';
  return value || '-';
}

function statusClass(value) {
  const normalized = String(value || '').toLowerCase();
  if (['active', 'allowed', 'paid'].includes(normalized)) {
    return 'bg-green-500/15 border-green-500/30 text-green-300';
  }
  if (['pending', 'open', 'grace_period', 'scheduled_cancel', 'scheduled_freeze'].includes(normalized)) {
    return 'bg-blue-500/15 border-blue-500/30 text-blue-300';
  }
  if (['overdue', 'failed', 'frozen', 'suspended', 'partially_paid'].includes(normalized)) {
    return 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300';
  }
  return 'bg-red-500/15 border-red-500/30 text-red-300';
}

function accessExplanation(accessStatus, accessContext) {
  const status = String(accessStatus || '').toLowerCase();
  const reason = String(accessContext?.blocked_reason || '').toLowerCase();
  if (status === 'grace_period') {
    return accessContext?.grace_until
      ? `Seu acesso esta em carencia ate ${formatDate(accessContext.grace_until)}.`
      : 'Seu acesso esta em periodo de carencia.';
  }
  if (status === 'blocked') {
    if (reason === 'financial_default_after_grace') {
      return 'Acesso bloqueado por inadimplencia apos o fim da carencia. Procure a recepcao.';
    }
    if (reason === 'manual_block') {
      return 'Acesso bloqueado manualmente pela academia. Procure a recepcao.';
    }
    if (reason === 'contract_ended') {
      return 'Contrato encerrado. Renove seu plano para voltar a acessar.';
    }
    if (reason === 'contract_frozen') {
      return 'Contrato congelado no momento.';
    }
    return 'Acesso temporariamente bloqueado.';
  }
  if (status === 'suspended') return 'Seu contrato esta suspenso.';
  return 'Seu acesso esta liberado.';
}

export default function StudentDashboardPage() {
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError('');
    }
    try {
      const response = await api.studentPortalDashboard();
      setData(response);
    } catch (err) {
      const message = err?.message || 'Erro ao carregar painel do aluno';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
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
  const accessContext = data?.access_context || {};
  const logs = data?.recent_access_logs || [];
  const notifications = data?.notifications || [];
  const upcomingCharges = data?.upcoming_charges || [];
  const nextCharge = upcomingCharges.find((item) => ['open', 'overdue', 'partially_paid', 'failed'].includes(String(item?.status || '').toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold uppercase tracking-tight">Meu Painel</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Acompanhe seu plano, situacao de acesso e cobrancas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load({ silent: true })}
          className="h-9 px-3 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-xs uppercase tracking-wide inline-flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 text-xs text-yellow-200">
          {error}
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-[#ccff00] mt-0.5" />
          <div>
            <p className="text-sm font-semibold">{statusLabel(accessStatus)}</p>
            <p className="text-xs text-zinc-400 mt-1">{accessExplanation(accessStatus, accessContext)}</p>
            {accessContext?.next_retry_at && (
              <p className="text-xs text-zinc-500 mt-1">
                Proxima tentativa de cobranca: {formatDate(accessContext.next_retry_at)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Situacao de acesso
          </p>
          <p className="text-xl font-semibold mt-2">{statusLabel(accessStatus)}</p>
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
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Proxima cobranca</p>
          <p className="text-sm font-semibold mt-2">
            {nextCharge ? `${formatDate(nextCharge.due_at)} - ${formatMoney(nextCharge.amount)}` : '-'}
          </p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <h2 className="font-semibold uppercase text-sm tracking-wide mb-3">Meu contrato atual</h2>
        {!contract && <p className="text-sm text-zinc-500">Nenhum contrato encontrado.</p>}
        {contract && (
          <>
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
                <p className="text-zinc-500">Valor</p>
                <p>{formatMoney(contract.amount)}</p>
              </div>
              <div>
                <p className="text-zinc-500">Matricula</p>
                <p>{student.matricula || '-'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className={`px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${statusClass(contract.contract_status)}`}>
                Contratual: {statusLabel(contract.contract_status)}
              </span>
              <span className={`px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${statusClass(contract.financial_status)}`}>
                Financeiro: {statusLabel(contract.financial_status)}
              </span>
              <span className={`px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${statusClass(contract.access_status)}`}>
                Acesso: {statusLabel(contract.access_status)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <h2 className="font-semibold uppercase text-sm tracking-wide mb-3 flex items-center gap-2">
            <ScanLine className="w-4 h-4" /> Historico de acessos
          </h2>
          <ul className="space-y-2 text-sm max-h-72 overflow-auto pr-1">
            {logs.map((log) => (
              <li key={log.log_id || `${log.timestamp || log.created_at}-${log.tipo || log.method || ''}`} className="border border-zinc-800 rounded-sm p-2">
                <p className="font-medium">
                  {(log.autorizado || log.decision === 'allow') ? 'Acesso liberado' : 'Acesso negado'}
                </p>
                <p className="text-zinc-500 text-xs">{formatDate(log.timestamp || log.created_at)}</p>
                <p className="text-zinc-500 text-xs">{log.reason || log.motivo || '-'}</p>
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
