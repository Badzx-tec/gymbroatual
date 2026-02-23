import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, FileText, History } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return String(value);
  }
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusPill(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active' || normalized === 'paid') return 'bg-green-500/15 text-green-300 border-green-500/30';
  if (normalized === 'trialing' || normalized === 'open' || normalized === 'pending') return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
  if (normalized === 'past_due' || normalized === 'failed') return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
  if (normalized === 'canceled' || normalized === 'expired') return 'bg-red-500/15 text-red-300 border-red-500/30';
  return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
}

export default function BillingCenterPage() {
  const [loading, setLoading] = useState(true);
  const [processingCheckout, setProcessingCheckout] = useState(false);
  const [data, setData] = useState({
    subscription: null,
    membership: null,
    invoices: [],
    attempts: [],
    events: [],
  });

  const load = async () => {
    setLoading(true);
    try {
      const [subscription, membership, invoices, attempts, events] = await Promise.all([
        api.subscriptionStatus(),
        api.billingMembership(),
        api.billingInvoices(30),
        api.billingPaymentAttempts(30),
        api.billingEvents(40),
      ]);
      setData({ subscription, membership, invoices, attempts, events });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const startCheckout = async () => {
    setProcessingCheckout(true);
    try {
      const checkout = await api.subscriptionCheckout();
      if (checkout.checkout_url) {
        window.location.href = checkout.checkout_url;
        return;
      }
      toast.error('Checkout indisponível no momento.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessingCheckout(false);
    }
  };

  const refreshFromMp = async () => {
    setLoading(true);
    try {
      await api.subscriptionRefresh();
      await load();
      toast.success('Status conferido com o Mercado Pago.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    const paidInvoices = data.invoices.filter((item) => item.status === 'paid');
    const revenue = paidInvoices.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const failedAttempts = data.attempts.filter((item) => item.status === 'failed').length;
    return { revenue, failedAttempts };
  }, [data.invoices, data.attempts]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Centro de Cobrança</h1>
        <p className="text-zinc-400 mt-1">Contratos, faturas, tentativas e eventos da assinatura SaaS.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Status atual</p>
          <p className={`inline-flex mt-2 px-2 py-1 rounded-sm border text-xs font-semibold uppercase ${statusPill(data.subscription?.status)}`}>
            {data.subscription?.status || 'desconhecido'}
          </p>
          <p className="text-xs text-zinc-500 mt-2">Acesso liberado: {data.subscription?.can_login ? 'sim' : 'não'}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Receita reconhecida</p>
          <p className="mt-2 text-xl font-bold">{formatMoney(summary.revenue)}</p>
          <p className="text-xs text-zinc-500 mt-2">{data.invoices.filter((item) => item.status === 'paid').length} faturas pagas</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Tentativas falhas</p>
          <p className="mt-2 text-xl font-bold">{summary.failedAttempts}</p>
          <p className="text-xs text-zinc-500 mt-2">Últimos registros financeiros</p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
        <h2 className="font-heading text-xl uppercase font-semibold flex items-center gap-2"><CreditCard className="w-5 h-5" /> Contrato / Membership</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mt-4">
          <div>
            <p className="text-zinc-500">Plano</p>
            <p className="font-semibold uppercase">{data.membership?.plan_code || '-'}</p>
          </div>
          <div>
            <p className="text-zinc-500">Valor</p>
            <p className="font-semibold">{formatMoney(data.membership?.amount)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Status</p>
            <p className={`inline-flex mt-1 px-2 py-1 rounded-sm border text-xs font-semibold uppercase ${statusPill(data.membership?.status)}`}>
              {data.membership?.status || '-'}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">Início</p>
            <p>{formatDate(data.membership?.started_at)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Trial até</p>
            <p>{formatDate(data.membership?.trial_ends_at)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Período atual (fim)</p>
            <p>{formatDate(data.membership?.current_period_end)}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={startCheckout} disabled={processingCheckout} className="bg-[#ccff00] text-black font-bold uppercase tracking-wide text-xs h-10 px-4 rounded-sm hover:bg-[#b3e600] disabled:opacity-50">
            {processingCheckout ? 'Abrindo...' : 'Assinar / Renovar'}
          </button>
          <button onClick={refreshFromMp} className="bg-blue-600 text-white font-semibold uppercase tracking-wide text-xs h-10 px-4 rounded-sm hover:bg-blue-500">
            Ja paguei, verificar
          </button>
          <button onClick={load} className="bg-zinc-800 text-white font-semibold uppercase tracking-wide text-xs h-10 px-4 rounded-sm hover:bg-zinc-700">
            Atualizar
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
        <div className="px-4 py-3 border-b border-zinc-800 font-semibold uppercase text-sm tracking-wide flex items-center gap-2"><FileText className="w-4 h-4" /> Faturas</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3">Período</th>
              <th className="text-left px-4 py-3">Valor</th>
              <th className="text-left px-4 py-3">Vencimento</th>
              <th className="text-left px-4 py-3">Pagamento</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((invoice) => (
              <tr key={invoice.invoice_id} className="border-b border-zinc-800/50">
                <td className="px-4 py-3">{invoice.period_label}</td>
                <td className="px-4 py-3">{formatMoney(invoice.amount)}</td>
                <td className="px-4 py-3 text-zinc-400">{formatDate(invoice.due_date)}</td>
                <td className="px-4 py-3 text-zinc-400">{formatDate(invoice.paid_at)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-sm border text-xs font-semibold uppercase ${statusPill(invoice.status)}`}>{invoice.status}</span>
                </td>
              </tr>
            ))}
            {data.invoices.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500">Sem faturas registradas.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
          <div className="px-4 py-3 border-b border-zinc-800 font-semibold uppercase text-sm tracking-wide flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Tentativas de pagamento</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Valor</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {data.attempts.map((attempt) => (
                <tr key={attempt.attempt_id} className="border-b border-zinc-800/50">
                  <td className="px-4 py-3 text-zinc-400">{formatDate(attempt.created_at)}</td>
                  <td className="px-4 py-3">{formatMoney(attempt.amount)}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-sm border text-xs font-semibold uppercase ${statusPill(attempt.status)}`}>{attempt.status}</span></td>
                  <td className="px-4 py-3 text-zinc-400">{attempt.reason || '-'}</td>
                </tr>
              ))}
              {data.attempts.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-zinc-500">Sem tentativas registradas.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <h3 className="font-semibold uppercase text-sm tracking-wide mb-3 flex items-center gap-2"><History className="w-4 h-4" /> Timeline da assinatura</h3>
          <ul className="space-y-2 text-sm">
            {data.events.map((event) => (
              <li key={event.event_id} className="border border-zinc-800 rounded-sm px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold uppercase text-xs">{event.event_type}</span>
                  <span className={`px-2 py-1 rounded-sm border text-[10px] font-semibold uppercase ${statusPill(event.status)}`}>{event.status}</span>
                </div>
                <p className="text-zinc-500 text-xs mt-1">{event.source} - {formatDate(event.created_at)}</p>
              </li>
            ))}
            {data.events.length === 0 && <li className="text-zinc-500">Sem eventos registrados.</li>}
          </ul>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 text-sm text-zinc-400 flex items-start gap-2">
        {data.subscription?.can_login ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-yellow-500" />}
        <p>
          Esse painel consolida os dados financeiros da assinatura SaaS do dono da academia (contrato, faturas, tentativas e eventos).
        </p>
      </div>
    </div>
  );
}
