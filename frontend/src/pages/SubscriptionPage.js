import React, { useEffect, useState } from 'react';
import { CreditCard, AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleDateString('pt-BR');
  } catch {
    return String(value);
  }
}

export default function SubscriptionPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const data = await api.subscriptionStatus();
      setStatus(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const startCheckout = async () => {
    setProcessing(true);
    try {
      const result = await api.subscriptionCheckout();
      if (result.checkout_url) {
        window.location.href = result.checkout_url;
        return;
      }
      toast.error('Não foi possível abrir o checkout.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" /></div>;
  }

  const active = status?.can_login;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Assinatura</h1>
        <p className="text-zinc-400 mt-1">Assinatura mensal do dono da academia: R$ 139,90/mês.</p>
      </div>

      <div className={`rounded-md border p-5 ${active ? 'border-green-500/20 bg-green-500/5' : 'border-yellow-500/20 bg-yellow-500/5'}`}>
        <div className="flex items-start gap-3">
          {active ? <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />}
          <div className="space-y-1">
            <p className="font-semibold">Status atual: <span className="uppercase">{status?.status || 'indefinido'}</span></p>
            <p className="text-sm text-zinc-400">Trial até: {formatDate(status?.trial_ends_at)}</p>
            <p className="text-sm text-zinc-400">Período pago até: {formatDate(status?.current_period_end)}</p>
            <p className="text-sm text-zinc-400">Último pagamento: {formatDate(status?.last_payment_at)}</p>
            <p className="text-sm text-zinc-400">Período de carência até: {formatDate(status?.grace_until)}</p>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5 space-y-4">
        <h2 className="font-heading text-xl uppercase font-semibold flex items-center gap-2"><CreditCard className="w-5 h-5" /> Renovar assinatura</h2>
        <p className="text-sm text-zinc-400">O acesso ao sistema fica bloqueado enquanto a assinatura estiver inativa.</p>
        <button onClick={startCheckout} disabled={processing} className="bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-11 px-6 rounded-sm hover:bg-[#b3e600] disabled:opacity-50">
          {processing ? 'Abrindo checkout...' : 'Assinar agora'}
        </button>
        <button onClick={loadStatus} className="ml-3 bg-zinc-800 text-white font-semibold uppercase tracking-wide text-sm h-11 px-6 rounded-sm hover:bg-zinc-700">
          Atualizar status
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 text-sm text-zinc-400 flex items-start gap-2">
        <Clock3 className="w-4 h-4 mt-0.5 text-zinc-500" />
        <p>
          Trial e período de carência são configuráveis por ENV no backend. Webhooks do Mercado Pago atualizam automaticamente o estado da assinatura.
        </p>
      </div>
    </div>
  );
}
