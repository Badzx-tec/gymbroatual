import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  CreditCard,
  RefreshCw,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
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
  eventTypeLabel,
  formatBillingDate,
  getBillingActionItems,
  getSubscriptionStateMeta,
} from '../features/billing/billingUtils';
import useBillingOverview from '../features/billing/useBillingOverview';

const checkoutMessages = {
  success: {
    tone: 'success',
    title: 'Checkout concluido',
    description: 'Se o status ainda nao atualizou, use "Ja paguei, verificar".',
  },
  pending: {
    tone: 'warning',
    title: 'Pagamento em analise',
    description: 'A confirmacao depende do provedor e pode levar alguns minutos.',
  },
  failure: {
    tone: 'danger',
    title: 'Pagamento nao confirmado',
    description: 'Revise o checkout ou tente novamente com outro meio de pagamento.',
  },
};

export default function SubscriptionPage() {
  const [searchParams] = useSearchParams();
  const { data, loading, refreshing, error, reload, syncWithProvider } = useBillingOverview({
    invoiceLimit: 6,
    attemptLimit: 4,
    eventLimit: 6,
  });

  const subscriptionMeta = React.useMemo(
    () => getSubscriptionStateMeta(data.subscription),
    [data.subscription]
  );
  const actionItems = React.useMemo(() => getBillingActionItems(data), [data]);
  const checkoutState = checkoutMessages[searchParams.get('status')] || null;

  const handleReload = async () => {
    try {
      await reload();
      toast.success('Status da assinatura atualizado.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao atualizar a assinatura.');
    }
  };

  const handleCheckout = async () => {
    try {
      const result = await api.subscriptionCheckout();
      if (!result?.checkout_url) {
        toast.error('Checkout indisponivel no momento.');
        return;
      }
      window.location.href = result.checkout_url;
    } catch (err) {
      toast.error(err?.message || 'Falha ao abrir checkout.');
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
    return <LoadingScreen label="Carregando assinatura..." />;
  }

  if (error && !data.subscription) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Nao foi possivel carregar a assinatura"
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
        eyebrow="Assinatura SaaS"
        title="Assinatura"
        subtitle="Visual rapido para checar liberacao do painel, datas de vigencia e proxima acao financeira."
        actions={
          <>
            <Button as={Link} to="/admin/cobranca" variant="ghost">
              Centro de cobranca
            </Button>
            <Button onClick={handleReload} variant="secondary">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Button onClick={handleCheckout} variant="primary">
              <CreditCard className="h-4 w-4" />
              Assinar ou renovar
            </Button>
          </>
        }
      />

      {checkoutState ? (
        <CheckoutNotice {...checkoutState} />
      ) : null}

      {error ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-900 bg-[linear-gradient(135deg,rgba(204,255,0,0.12),rgba(9,9,11,0.96)_34%),linear-gradient(180deg,rgba(24,24,27,0.92),rgba(9,9,11,0.96))] px-6 py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <StatusBadge label={subscriptionMeta.label} tone={subscriptionMeta.tone} />
            <div>
              <h2 className="text-2xl font-semibold text-zinc-50">Visao atual da assinatura</h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-300">{subscriptionMeta.summary}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <BillingStatusBadge status={data.subscription?.status} />
              <StatusBadge
                label={data.subscription?.can_login ? 'Painel liberado' : 'Painel restrito'}
                tone={data.subscription?.can_login ? 'success' : 'warning'}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSync} variant="secondary">
              <CheckCircle2 className="h-4 w-4" />
              Ja paguei, verificar
            </Button>
            <Button as={Link} to="/admin/cobranca" variant="ghost">
              <ArrowUpRight className="h-4 w-4" />
              Abrir detalhes
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Periodo pago ate"
          value={formatBillingDate(data.subscription?.current_period_end)}
          hint="Validade atual da assinatura"
          icon={CreditCard}
          accent="info"
        />
        <StatCard
          label="Ultimo pagamento"
          value={formatBillingDate(data.subscription?.last_payment_at)}
          hint="Ultima confirmacao recebida"
          icon={CheckCircle2}
          accent="success"
        />
        <StatCard
          label="Carencia ate"
          value={formatBillingDate(data.subscription?.grace_until)}
          hint="Se existir grace period ativo"
          icon={Clock3}
          accent={data.subscription?.grace_until ? 'warning' : 'default'}
        />
        <StatCard
          label="Faturas em atraso"
          value={String(data.summary?.past_due_invoice_count || 0)}
          hint="Pendencias que exigem acao"
          icon={AlertTriangle}
          accent={(data.summary?.past_due_invoice_count || 0) > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard title="Como o acesso e decidido" description="Resumo operacional do backend para suporte e gestao.">
          <div className="space-y-3">
            {actionItems.map((item) => (
              <div
                key={item}
                className="rounded-xl border border-zinc-900 bg-zinc-900/55 px-4 py-3 text-sm text-zinc-300"
              >
                {item}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Resumo tecnico" description="Campos que mais ajudam na validacao rapida.">
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoTile label="Plano" value={data.membership?.plan_code || '-'} />
            <InfoTile label="Status" value={<BillingStatusBadge status={data.subscription?.status} />} />
            <InfoTile label="Trial ate" value={formatBillingDate(data.subscription?.trial_ends_at)} />
            <InfoTile label="Ultimo evento" value={formatBillingDate(data.summary?.last_event_at)} />
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Atividade recente" description="Eventos e sincronizacoes mais recentes da assinatura.">
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
            icon={Clock3}
            title="Sem atividade recente"
            description="Quando houver webhook, checkout ou conciliacao, eles aparecerao aqui."
          />
        )}
      </SectionCard>
    </div>
  );
}

function CheckoutNotice({ tone, title, description }) {
  const toneClasses = {
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-100',
    danger: 'border-red-500/20 bg-red-500/10 text-red-100',
  };

  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClasses[tone] || toneClasses.warning}`}>
      <p className="text-sm font-semibold uppercase tracking-[0.16em]">{title}</p>
      <p className="mt-1 text-sm">{description}</p>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-xl border border-zinc-900 bg-zinc-900/55 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <div className="mt-2 text-sm text-zinc-200">{value}</div>
    </div>
  );
}
