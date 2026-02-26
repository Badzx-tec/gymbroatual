import React from 'react';
import { CalendarClock, CreditCard, FileClock, RefreshCw, AlertTriangle } from 'lucide-react';
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

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['paid', 'active', 'allowed'].includes(normalized)) {
    return 'bg-green-500/15 border-green-500/30 text-green-300';
  }
  if (['pending', 'open', 'scheduled_cancel', 'grace_period'].includes(normalized)) {
    return 'bg-blue-500/15 border-blue-500/30 text-blue-300';
  }
  if (['overdue', 'failed', 'frozen', 'suspended', 'partially_paid'].includes(normalized)) {
    return 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300';
  }
  return 'bg-red-500/15 border-red-500/30 text-red-300';
}

function statusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'grace_period') return 'Carencia';
  if (normalized === 'overdue') return 'Atrasado';
  if (normalized === 'failed') return 'Falha';
  if (normalized === 'partially_paid') return 'Parcial';
  if (normalized === 'paid') return 'Pago';
  if (normalized === 'open') return 'Aberto';
  return status || '-';
}

function eventLabel(eventType) {
  const type = String(eventType || '').toLowerCase();
  if (type === 'charge_overdue_marked') return 'Cobranca marcada como vencida';
  if (type === 'dunning_step_advanced') return 'Etapa de cobranca avancou';
  if (type === 'grace_started') return 'Periodo de carencia iniciado';
  if (type === 'grace_expired_access_blocked') return 'Carencia encerrada e acesso bloqueado';
  if (type === 'charge_paid') return 'Pagamento registrado';
  if (type === 'contract_renewed') return 'Contrato renovado';
  return eventType || 'Evento';
}

export default function StudentBillingPage() {
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState('');
  const [chargeFilter, setChargeFilter] = React.useState('all');
  const [data, setData] = React.useState({ contracts: [], charges: [], events: [], summary: {} });

  const load = React.useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError('');
    }
    try {
      const response = await api.studentPortalBilling({
        limitContracts: 40,
        limitCharges: 200,
        limitEvents: 200,
      });
      setData(response || { contracts: [], charges: [], events: [], summary: {} });
    } catch (err) {
      const message = err?.message || 'Erro ao carregar financeiro';
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

  const filteredCharges = (data.charges || []).filter((charge) => {
    if (chargeFilter === 'all') return true;
    return String(charge.status || '').toLowerCase() === chargeFilter;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold uppercase tracking-tight">Financeiro</h1>
          <p className="text-zinc-400 text-sm mt-1">Consulte seus contratos, cobrancas e eventos.</p>
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

      {(data.summary?.overdue_charges || 0) > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-300 mt-0.5" />
          <p className="text-xs text-yellow-200">
            Voce possui {data.summary.overdue_charges} cobranca(s) em atraso. Procure a recepcao para regularizar.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500 inline-flex items-center gap-1">
            <CreditCard className="w-3.5 h-3.5" /> Cobrancas em aberto
          </p>
          <p className="text-2xl font-bold mt-2">{data.summary?.open_charges || 0}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500 inline-flex items-center gap-1">
            <CalendarClock className="w-3.5 h-3.5" /> Proximo vencimento
          </p>
          <p className="text-sm font-semibold mt-2">{formatDate(data.summary?.next_due_at)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500 inline-flex items-center gap-1">
            <FileClock className="w-3.5 h-3.5" /> Contratos
          </p>
          <p className="text-2xl font-bold mt-2">{data.summary?.total_contracts || 0}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500 inline-flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Em atraso
          </p>
          <p className="text-2xl font-bold mt-2">{data.summary?.overdue_charges || 0}</p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
        <h2 className="font-semibold uppercase text-sm tracking-wide">Meus contratos</h2>
        <div className="grid grid-cols-1 gap-2">
          {data.contracts.map((contract) => (
            <div key={contract.contract_id} className="border border-zinc-800 rounded-sm p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{contract.plan_name || contract.plan_id || 'Contrato'}</p>
                <span className={`px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${statusClass(contract.contract_status)}`}>
                  {statusLabel(contract.contract_status)}
                </span>
              </div>
              <p className="text-zinc-400 text-xs mt-1">
                Vigencia: {formatDate(contract.current_period_start)} ate {formatDate(contract.current_period_end)}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className={`px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${statusClass(contract.financial_status)}`}>
                  Financeiro: {statusLabel(contract.financial_status)}
                </span>
                <span className={`px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${statusClass(contract.access_status)}`}>
                  Acesso: {statusLabel(contract.access_status)}
                </span>
              </div>
              {(contract.grace_until || contract.next_retry_at || Number(contract.dunning_level || 0) > 0) && (
                <div className="mt-2 text-xs text-zinc-500 space-y-1">
                  {contract.grace_until && <p>Carencia ate: {formatDate(contract.grace_until)}</p>}
                  {contract.next_retry_at && <p>Proxima tentativa: {formatDate(contract.next_retry_at)}</p>}
                  {Number(contract.dunning_level || 0) > 0 && <p>Nivel de cobranca: {Number(contract.dunning_level || 0)}</p>}
                </div>
              )}
            </div>
          ))}
          {!data.contracts.length && <p className="text-zinc-500 text-sm">Nenhum contrato encontrado.</p>}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
        <div className="px-4 py-3 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="font-semibold uppercase text-sm tracking-wide">Minhas cobrancas</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setChargeFilter('all')}
              className={`h-8 px-3 rounded-sm text-xs font-semibold uppercase tracking-wide ${
                chargeFilter === 'all' ? 'bg-[#ccff00] text-black' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Todas
            </button>
            <button
              onClick={() => setChargeFilter('open')}
              className={`h-8 px-3 rounded-sm text-xs font-semibold uppercase tracking-wide ${
                chargeFilter === 'open' ? 'bg-[#ccff00] text-black' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Abertas
            </button>
            <button
              onClick={() => setChargeFilter('overdue')}
              className={`h-8 px-3 rounded-sm text-xs font-semibold uppercase tracking-wide ${
                chargeFilter === 'overdue' ? 'bg-[#ccff00] text-black' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Atrasadas
            </button>
            <button
              onClick={() => setChargeFilter('paid')}
              className={`h-8 px-3 rounded-sm text-xs font-semibold uppercase tracking-wide ${
                chargeFilter === 'paid' ? 'bg-[#ccff00] text-black' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Pagas
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3">Vencimento</th>
              <th className="text-left px-4 py-3">Valor</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Pagamento</th>
            </tr>
          </thead>
          <tbody>
            {filteredCharges.map((charge) => (
              <tr key={charge.charge_id} className="border-b border-zinc-800/50">
                <td className="px-4 py-3 text-zinc-300">{formatDate(charge.due_at)}</td>
                <td className="px-4 py-3">{formatMoney(charge.amount)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-sm border text-xs uppercase font-semibold ${statusClass(charge.status)}`}>
                    {statusLabel(charge.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-400">{formatDate(charge.paid_at)}</td>
              </tr>
            ))}
            {!filteredCharges.length && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  Sem cobrancas no filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <h2 className="font-semibold uppercase text-sm tracking-wide mb-3">Historico de eventos</h2>
        <ul className="space-y-2 max-h-56 overflow-auto pr-1 text-sm">
          {(data.events || []).map((item) => (
            <li key={item.event_id} className="border border-zinc-800 rounded-sm p-2">
              <p className="font-medium">{eventLabel(item.event_type)}</p>
              <p className="text-zinc-500 text-xs">{formatDate(item.created_at)}</p>
            </li>
          ))}
          {!(data.events || []).length && <li className="text-zinc-500">Sem eventos registrados.</li>}
        </ul>
      </div>
    </div>
  );
}
