import React, { useEffect, useState } from 'react';
import { CreditCard, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

const FALLBACK_PLANS = [
  { plan_id: 'owner_monthly', nome: 'Mensal', valor: 139.90, duracao_dias: 30, descricao: 'Plano mensal para 1 franquia' },
  { plan_id: 'owner_quarterly', nome: 'Trimestral', valor: 419.70, duracao_dias: 90, descricao: 'Plano trimestral para 1 franquia' },
  { plan_id: 'owner_annual', nome: 'Anual', valor: 1678.80, duracao_dias: 365, descricao: 'Plano anual para 1 franquia' },
];

function formatDate(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('pt-BR');
  } catch {
    return String(value);
  }
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function SubscriptionPage() {
  const [status, setStatus] = useState(null);
  const [plans, setPlans] = useState(FALLBACK_PLANS);
  const [selectedPlan, setSelectedPlan] = useState('owner_monthly');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = async (opts = { silent: false }) => {
    const { silent } = opts;

    if (!silent) setRefreshing(true);
    setLoading((prev) => (status ? prev : true));

    try {
      const [subscriptionData, publicPlans] = await Promise.all([
        api.subscriptionStatus(),
        api.listPlansPublic().catch(() => FALLBACK_PLANS),
      ]);
      setStatus(subscriptionData);
      if (Array.isArray(publicPlans) && publicPlans.length > 0) {
        setPlans(publicPlans);
        if (!publicPlans.some((item) => item.plan_id === selectedPlan)) {
          setSelectedPlan(publicPlans[0].plan_id);
        }
      } else {
        setPlans(FALLBACK_PLANS);
      }

      if (!silent) toast.success('Status atualizado.');
    } catch (err) {
      if (!silent) toast.error(err?.message || 'Erro ao buscar status.');
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
    setProcessing(true);
    try {
      const result = await api.subscriptionCheckout({ plan_code: selectedPlan });
      if (result.checkout_url) {
        window.location.href = result.checkout_url;
        return;
      }
      toast.error('Nao foi possivel abrir o checkout.');
    } catch (err) {
      toast.error(err?.message || 'Erro ao abrir checkout.');
    } finally {
      setProcessing(false);
    }
  };

  const refreshNow = async () => {
    setLoading(true);
    try {
      const result = await api.subscriptionRefresh();
      setStatus(result.subscription);
      toast.success('Status atualizado com o Mercado Pago.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const active = Boolean(status?.can_login);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Assinatura</h1>
        <p className="text-zinc-400 mt-1">Escolha o plano da sua franquia e finalize no Mercado Pago.</p>
      </div>

      <div
        className={`rounded-md border p-5 ${
          active
            ? 'border-green-500/20 bg-green-500/5'
            : 'border-yellow-500/20 bg-yellow-500/5'
        }`}
      >
        <div className="flex items-start gap-3">
          {active ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
          )}
          <div className="space-y-1">
            <p className="font-semibold">Status atual: <span className="uppercase">{status?.status || 'indefinido'}</span></p>
            <p className="text-sm text-zinc-400">Trial ate: {formatDate(status?.trial_ends_at)}</p>
            <p className="text-sm text-zinc-400">Periodo pago ate: {formatDate(status?.current_period_end)}</p>
            <p className="text-sm text-zinc-400">Ultimo pagamento: {formatDate(status?.last_payment_at)}</p>
            <p className="text-sm text-zinc-400">Periodo de carencia ate: {formatDate(status?.grace_until)}</p>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5 space-y-4">
        <h2 className="font-heading text-xl uppercase font-semibold flex items-center gap-2"><CreditCard className="w-5 h-5" /> Renovar assinatura</h2>
        <p className="text-sm text-zinc-400">O acesso ao sistema fica bloqueado enquanto a assinatura estiver inativa.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {plans.map((plan) => {
            const isSelected = selectedPlan === plan.plan_id;
            return (
              <button
                key={plan.plan_id}
                type="button"
                onClick={() => setSelectedPlan(plan.plan_id)}
                className={`text-left rounded-md border p-3 transition-colors ${isSelected ? 'border-[#ccff00] bg-[#ccff00]/10' : 'border-zinc-700 bg-zinc-950 hover:border-zinc-500'}`}
              >
                <p className="font-heading text-lg uppercase">{plan.nome}</p>
                <p className="text-xl font-bold mt-1">{formatMoney(plan.valor)}</p>
                <p className="text-xs text-zinc-400 mt-1">{plan.duracao_dias} dias</p>
              </button>
            );
          })}
        </div>

        <div>
          <button onClick={startCheckout} disabled={processing} className="bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-11 px-6 rounded-sm hover:bg-[#b3e600] disabled:opacity-50">
            {processing ? 'Abrindo checkout...' : 'Assinar agora'}
          </button>
          <button onClick={() => loadStatus({ silent: false })} disabled={refreshing} className="ml-3 bg-zinc-800 text-white font-semibold uppercase tracking-wide text-sm h-11 px-6 rounded-sm hover:bg-zinc-700 disabled:opacity-60">
            {refreshing ? 'Atualizando...' : 'Atualizar status'}
          </button>
          <button onClick={refreshNow} className="ml-3 bg-blue-600 text-white font-semibold uppercase tracking-wide text-sm h-11 px-6 rounded-sm hover:bg-blue-500">
            Ja paguei, verificar agora
          </button>
        </div>
      </div>
    </div>
  );
}
