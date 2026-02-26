import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, CreditCard, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

function formatDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('pt-BR');
}

function statusMeta(rawStatus, canLogin) {
  const status = String(rawStatus || '').toLowerCase();
  if (canLogin) {
    return {
      label: 'Acesso liberado',
      className: 'border-green-500/30 bg-green-500/10 text-green-200',
      icon: CheckCircle2,
    };
  }
  if (status === 'past_due') {
    return {
      label: 'Pagamento pendente',
      className: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
      icon: AlertTriangle,
    };
  }
  if (status === 'canceled' || status === 'expired') {
    return {
      label: 'Assinatura inativa',
      className: 'border-red-500/30 bg-red-500/10 text-red-200',
      icon: AlertTriangle,
    };
  }
  return {
    label: 'Status em analise',
    className: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
    icon: Clock3,
  };
}

export default function SubscriptionPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processingCheckout, setProcessingCheckout] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    if (!silent && !status) setLoading(true);
    try {
      const data = await api.subscriptionStatus();
      setStatus(data);
      if (!silent) toast.success('Status da assinatura atualizado.');
    } catch (err) {
      if (!silent) toast.error(err?.message || 'Erro ao atualizar status.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadStatus({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCheckout = async () => {
    setProcessingCheckout(true);
    try {
      const result = await api.subscriptionCheckout();
      if (!result?.checkout_url) {
        toast.error('Checkout indisponivel no momento.');
        return;
      }
      toast.message('Abrindo checkout...');
      window.location.href = result.checkout_url;
    } catch (err) {
      toast.error(err?.message || 'Falha ao abrir checkout.');
    } finally {
      setProcessingCheckout(false);
    }
  };

  const refreshFromProvider = async () => {
    setLoading(true);
    try {
      const result = await api.subscriptionRefresh();
      setStatus(result?.subscription || null);
      toast.success('Status sincronizado com o provedor.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao sincronizar status.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-56">
        <div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const active = Boolean(status?.can_login);
  const meta = statusMeta(status?.status, active);
  const StatusIcon = meta.icon;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Assinatura</h1>
          <p className="text-zinc-400 mt-1">
            Gerencie o plano SaaS da academia e valide o status em tempo real.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadStatus()}
          className="h-10 px-4 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold uppercase tracking-wide inline-flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className={`rounded-md border p-5 ${meta.className}`}>
        <div className="flex items-start gap-3">
          <StatusIcon className="w-5 h-5 mt-0.5" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold uppercase tracking-wide">{meta.label}</p>
            <p>Status tecnico: {String(status?.status || 'indefinido').toUpperCase()}</p>
            <p>Trial ate: {formatDate(status?.trial_ends_at)}</p>
            <p>Periodo pago ate: {formatDate(status?.current_period_end)}</p>
            <p>Ultimo pagamento: {formatDate(status?.last_payment_at)}</p>
            <p>Carencia ate: {formatDate(status?.grace_until)}</p>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5 space-y-4">
        <h2 className="font-heading text-xl uppercase font-semibold flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          Acoes de assinatura
        </h2>
        <p className="text-sm text-zinc-400">
          Se a assinatura estiver inativa, o acesso administrativo pode ser bloqueado apos a carencia.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startCheckout}
            disabled={processingCheckout}
            className="bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-11 px-6 rounded-sm hover:bg-[#b3e600] disabled:opacity-50"
          >
            {processingCheckout ? 'Abrindo checkout...' : 'Assinar agora'}
          </button>
          <button
            type="button"
            onClick={refreshFromProvider}
            className="bg-blue-600 text-white font-semibold uppercase tracking-wide text-sm h-11 px-6 rounded-sm hover:bg-blue-500"
          >
            Ja paguei, verificar agora
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 text-sm text-zinc-400 flex items-start gap-2">
        <Clock3 className="w-4 h-4 mt-0.5 text-zinc-500" />
        <p>
          O backend controla trial, carencia e bloqueio por assinatura. Este painel e operacional e nao substitui o status validado no servidor.
        </p>
      </div>
    </div>
  );
}
