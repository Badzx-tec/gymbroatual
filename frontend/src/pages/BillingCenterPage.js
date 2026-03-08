import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CreditCard,
  History,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { api } from '../api';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import BillingStatusBadge from '../features/billing/BillingStatusBadge';
import {
  attemptReasonLabel,
  eventTypeLabel,
  formatBillingDate,
  formatBillingMoney,
  getBillingActionItems,
  getInvoiceStatusFilterOptions,
  getSubscriptionStateMeta,
} from '../features/billing/billingUtils';
import useBillingOverview from '../features/billing/useBillingOverview';

const tonePanelClasses = {
  success: 'border-emerald-500/25 bg-emerald-500/10',
  warning: 'border-amber-500/25 bg-amber-500/10',
  danger: 'border-red-500/25 bg-red-500/10',
  info: 'border-sky-500/25 bg-sky-500/10',
  neutral: 'border-zinc-800 bg-zinc-950/70',
};

export default function BillingCenterPage() {
  const [invoiceFilter, setInvoiceFilter] = React.useState('all');
  const { data, loading, refreshing, error, reload, syncWithProvider } = useBillingOverview({
    invoiceLimit: 12,
    attemptLimit: 10,
    eventLimit: 12,
  });

  const subscriptionMeta = React.useMemo(
    () => getSubscriptionStateMeta(data.subscription),
    [data.subscription]
  );
  const actionItems = React.useMemo(() => getBillingActionItems(data), [data]);
  const filteredInvoices = React.useMemo(() => {
    if (invoiceFilter === 'all') return data.invoices || [];
    return (data.invoices || []).filter(
      (invoice) => String(invoice.status || '').toLowerCase() === invoiceFilter
    );
  }, [data.invoices, invoiceFilter]);

  const handleCheckout = async () => {
    try {
      const checkout = await api.subscriptionCheckout();
      if (!checkout?.checkout_url) {
        toast.error('Checkout indisponivel no momento.');
        return;
      }
      window.location.href = checkout.checkout_url;
    } catch (err) {
      toast.error(err?.message || 'Falha ao abrir o checkout.');
    }
  };

  const handleReload = async () => {
    try {
      await reload();
      toast.success('Centro de cobranca atualizado.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao atualizar a cobranca.');
    }
  };

  const handleSync = async () => {
    try {
      await syncWithProvider();
      toast.success('Status sincronizado com o provedor.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao sincronizar com o provedor.');
    }
  };

  if (loading) {
    return <LoadingScreen label="Carregando centro de cobranca..." />;
  }

  if (error && !data.subscription) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Nao foi possivel carregar a cobranca"
        description={error}
        action={
          <Button variant="primary" onClick={handleReload}>
            Tentar novamente
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Receita SaaS"
        title="Centro de cobranca"
        subtitle="Acompanhe status da assinatura, faturas, falhas e eventos do provedor em um fluxo operacional unico."
        actions={
          <>
            <Button as={Link} to="/admin/assinatura" variant="ghost">
              Ver assinatura
            </Button>
            <Button onClick={handleSync} variant="secondary">
              <ShieldCheck className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Ja paguei, verificar
            </Button>
            <Button onClick={handleCheckout} variant="primary">
              <CreditCard className="h-4 w-4" />
              Abrir checkout
            </Button>
          </>
        }
      />

      {error ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      ) : null}

      <section
        className={`rounded-2xl border px-5 py-5 ${
          tonePanelClasses[subscriptionMeta.tone] || tonePanelClasses.neutral
        }`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <StatusBadge label={subscriptionMeta.label} tone={subscriptionMeta.tone} />
            <div>
              <h2 className="text-xl font-semibold text-zinc-50">Status operacional da academia</h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-200/80">{subscriptionMeta.summary}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleReload} variant="ghost">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Button as={Link} to="/admin/assinatura" variant="secondary">
              <ArrowUpRight className="h-4 w-4" />
              Detalhes da assinatura
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Receita reconhecida"
          value={formatBillingMoney(data.summary?.recognized_revenue)}
          hint={`${data.summary?.paid_invoice_count || 0} faturas pagas`}
          icon={Wallet}
          accent="success"
        />
        <StatCard
          label="Em aberto"
          value={formatBillingMoney(data.summary?.outstanding_amount)}
          hint={`${data.summary?.open_invoice_count || 0} abertas e ${data.summary?.past_due_invoice_count || 0} em atraso`}
          icon={Receipt}
          accent={(data.summary?.past_due_invoice_count || 0) > 0 ? 'warning' : 'info'}
        />
        <StatCard
          label="Ultimo evento"
          value={formatBillingDate(data.summary?.last_event_at)}
          hint="Timeline recente da assinatura"
          icon={History}
          accent="info"
        />
        <StatCard
          label="Falhas recentes"
          value={String(data.summary?.failed_attempt_count || 0)}
          hint="Tentativas marcadas como failed"
          icon={AlertTriangle}
          accent={(data.summary?.failed_attempt_count || 0) > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Contrato SaaS" description="Contexto tecnico e financeiro do plano atual.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <InfoItem label="Plano" value={data.membership?.plan_code || '-'} emphasize />
            <InfoItem label="Valor mensal" value={formatBillingMoney(data.membership?.amount)} emphasize />
            <InfoItem
              label="Status tecnico"
              value={<BillingStatusBadge status={data.subscription?.status} />}
            />
            <InfoItem label="Periodo pago ate" value={formatBillingDate(data.subscription?.current_period_end)} />
            <InfoItem label="Ultimo pagamento" value={formatBillingDate(data.subscription?.last_payment_at)} />
            <InfoItem label="Carencia ate" value={formatBillingDate(data.subscription?.grace_until)} />
            <InfoItem label="Trial ate" value={formatBillingDate(data.subscription?.trial_ends_at)} />
            <InfoItem
              label="Acesso administrativo"
              value={
                <StatusBadge
                  label={data.subscription?.can_login ? 'Liberado' : 'Bloqueado'}
                  tone={data.subscription?.can_login ? 'success' : 'warning'}
                />
              }
            />
            <InfoItem label="Proximo vencimento" value={formatBillingDate(data.summary?.next_invoice_due_at)} />
          </div>
        </SectionCard>

        <SectionCard title="Proximos passos" description="Leitura rapida para suporte e operacao.">
          <ul className="space-y-3">
            {actionItems.map((item) => (
              <li
                key={item}
                className="rounded-xl border border-zinc-900 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300"
              >
                {item}
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <SectionCard
        title="Faturas recentes"
        description="Ultimos ciclos de cobranca gerados para a assinatura SaaS."
        actions={
          <div className="flex flex-wrap gap-2">
            {getInvoiceStatusFilterOptions().map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setInvoiceFilter(option.value)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                  invoiceFilter === option.value
                    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-black'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-0"
      >
        {filteredInvoices.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Receipt}
              title="Nenhuma fatura para este filtro"
              description="Ajuste o filtro ou aguarde o proximo ciclo de cobranca."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-900 text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  <th className="px-5 py-3">Periodo</th>
                  <th className="px-5 py-3">Valor</th>
                  <th className="px-5 py-3">Vencimento</th>
                  <th className="px-5 py-3">Pagamento</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.invoice_id} className="border-b border-zinc-900/80 last:border-b-0">
                    <td className="px-5 py-4 font-medium text-zinc-100">{invoice.period_label}</td>
                    <td className="px-5 py-4 text-zinc-200">{formatBillingMoney(invoice.amount)}</td>
                    <td className="px-5 py-4 text-zinc-400">{formatBillingDate(invoice.due_date)}</td>
                    <td className="px-5 py-4 text-zinc-400">{formatBillingDate(invoice.paid_at)}</td>
                    <td className="px-5 py-4">
                      <BillingStatusBadge status={invoice.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Tentativas de pagamento" description="Falhas e sucessos mais recentes do provedor.">
          {data.attempts?.length ? (
            <div className="space-y-3">
              {data.attempts.map((attempt) => (
                <article
                  key={attempt.attempt_id}
                  className="rounded-xl border border-zinc-900 bg-zinc-900/55 px-4 py-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">
                        {formatBillingMoney(attempt.amount)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {formatBillingDate(attempt.created_at)} · {attemptReasonLabel(attempt.reason)}
                      </p>
                    </div>
                    <BillingStatusBadge status={attempt.status} size="sm" />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CreditCard}
              title="Sem tentativas registradas"
              description="Quando houver retorno do provedor, ele aparecera aqui."
            />
          )}
        </SectionCard>

        <SectionCard title="Timeline da assinatura" description="Eventos manuais, webhooks e reconciliacoes recentes.">
          {data.events?.length ? (
            <div className="space-y-3">
              {data.events.map((event) => (
                <article
                  key={event.event_id}
                  className="rounded-xl border border-zinc-900 bg-zinc-900/55 px-4 py-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{eventTypeLabel(event.event_type)}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {String(event.source || 'system').toUpperCase()} · {formatBillingDate(event.created_at)}
                      </p>
                    </div>
                    <BillingStatusBadge status={event.status} size="sm" />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={History}
              title="Sem eventos recentes"
              description="Os proximos webhooks, checkouts e reconciliacoes aparecerao aqui."
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function InfoItem({ label, value, emphasize = false }) {
  return (
    <div className="rounded-xl border border-zinc-900 bg-zinc-900/55 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <div className={`mt-2 text-sm ${emphasize ? 'font-semibold text-zinc-100' : 'text-zinc-300'}`}>
        {value}
      </div>
    </div>
  );
}
