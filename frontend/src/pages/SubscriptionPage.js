import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  CreditCard,
  History,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { api } from '../api';
import Banner from '../components/ui/Banner';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import SidePanel from '../components/ui/SidePanel';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import BillingStatusBadge from '../features/billing/BillingStatusBadge';
import {
  eventTypeLabel,
  formatBillingDate,
  formatBillingMoney,
  getBillingActionItems,
  getSubscriptionStateMeta,
} from '../features/billing/billingUtils';
import useBillingOverview from '../features/billing/useBillingOverview';

const checkoutMessages = {
  success: {
    tone: 'success',
    title: 'Checkout concluido',
    description: 'Se o status ainda nao atualizou, use "Ja paguei, verificar" para sincronizar com o provedor.',
  },
  pending: {
    tone: 'warning',
    title: 'Pagamento em analise',
    description: 'A confirmacao ainda depende do provedor. O painel atualiza assim que a conciliacao concluir.',
  },
  failure: {
    tone: 'danger',
    title: 'Pagamento nao confirmado',
    description: 'Revise o checkout ou tente novamente com outro meio de pagamento.',
  },
};

function DetailItem({ label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <div className="mt-1 text-sm text-zinc-100">{value}</div>
    </div>
  );
}

function getSubscriptionBanner(subscriptionMeta, data) {
  const summary = data.summary || {};
  if ((summary.past_due_invoice_count || 0) > 0) {
    return {
      tone: 'warning',
      title: 'Assinatura com pendencia financeira',
      description: `Existem ${summary.past_due_invoice_count || 0} fatura(s) em atraso. Se o pagamento ja foi feito, use "Ja paguei, verificar".`,
    };
  }
  if (!data.subscription?.can_login) {
    return {
      tone: 'danger',
      title: 'Painel administrativo pode ser restringido',
      description: 'A assinatura atual ainda nao garante acesso pleno. Regularize para evitar bloqueio.',
    };
  }
  return {
    tone: subscriptionMeta.tone,
    title: subscriptionMeta.label,
    description: subscriptionMeta.summary,
  };
}

export default function SubscriptionPage() {
  const [searchParams] = useSearchParams();
  const [selectedDetail, setSelectedDetail] = React.useState(null);
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
  const banner = React.useMemo(() => getSubscriptionBanner(subscriptionMeta, data), [subscriptionMeta, data]);

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
        subtitle="Visual operacional para saber se o painel esta liberado, qual a vigencia atual e o que precisa ser feito em seguida."
        actions={
          <>
            <Button as={Link} to="/admin/cobranca" variant="ghost" size="sm">
              Centro de cobranca
            </Button>
            <Button onClick={handleReload} variant="secondary" size="sm">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Button onClick={handleSync} variant="ghost" size="sm">
              Ja paguei, verificar
            </Button>
            <Button onClick={handleCheckout} variant="primary" size="sm">
              <CreditCard className="h-4 w-4" />
              Assinar ou renovar
            </Button>
          </>
        }
      />

      {checkoutState ? <Banner tone={checkoutState.tone} title={checkoutState.title} description={checkoutState.description} /> : null}
      {error ? <Banner tone="warning" title="Aviso de sincronizacao" description={error} /> : null}
      <Banner tone={banner.tone} title={banner.title} description={banner.description} />

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
          hint="Se houver grace period ativo"
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
        <SectionCard title="Leitura da assinatura" description="Campos essenciais para suporte, financeiro e operacao."
          actions={<BillingStatusBadge status={data.subscription?.status} />}
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <DetailItem label="Plano" value={data.membership?.plan_code || '-'} />
            <DetailItem label="Acesso ao painel" value={<StatusBadge label={data.subscription?.can_login ? 'Liberado' : 'Restrito'} tone={data.subscription?.can_login ? 'success' : 'warning'} />} />
            <DetailItem label="Trial ate" value={formatBillingDate(data.subscription?.trial_ends_at)} />
            <DetailItem label="Periodo pago ate" value={formatBillingDate(data.subscription?.current_period_end)} />
            <DetailItem label="Ultimo evento" value={formatBillingDate(data.summary?.last_event_at)} />
            <DetailItem label="Ultimo pagamento" value={formatBillingDate(data.subscription?.last_payment_at)} />
          </div>
        </SectionCard>

        <SectionCard title="Proximos passos" description="Resumo operacional do backend para orientar a proxima acao.">
          <ul className="space-y-3">
            {actionItems.map((item) => (
              <li key={item} className="rounded-xl border border-zinc-900 bg-zinc-900/55 px-4 py-3 text-sm text-zinc-300">
                {item}
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Faturas recentes" description="Ciclos de cobranca mais recentes da assinatura.">
          {data.invoices?.length ? (
            <div className="space-y-3">
              {data.invoices.map((invoice) => (
                <article key={invoice.invoice_id} className="rounded-xl border border-zinc-900 bg-zinc-900/55 px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{invoice.period_label}</p>
                      <p className="mt-1 text-xs text-zinc-500">{formatBillingDate(invoice.due_date)} | {formatBillingMoney(invoice.amount)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <BillingStatusBadge status={invoice.status} size="sm" />
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedDetail({ type: 'invoice', item: invoice })}>
                        Ver
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={Receipt} title="Sem faturas recentes" description="Os proximos ciclos de cobranca aparecerao aqui." />
          )}
        </SectionCard>

        <SectionCard title="Atividade recente" description="Eventos mais importantes da assinatura e das sincronizacoes.">
          {data.events?.length ? (
            <div className="space-y-3">
              {data.events.map((event) => (
                <article key={event.event_id} className="rounded-xl border border-zinc-900 bg-zinc-900/55 px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{eventTypeLabel(event.event_type)}</p>
                      <p className="mt-1 text-xs text-zinc-500">{String(event.source || 'system').toUpperCase()} | {formatBillingDate(event.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <BillingStatusBadge status={event.status} size="sm" />
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedDetail({ type: 'event', item: event })}>
                        Ver
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={History} title="Sem atividade recente" description="Quando houver webhook, checkout ou conciliacao, eles aparecerao aqui." />
          )}
        </SectionCard>
      </div>

      <SidePanel
        open={Boolean(selectedDetail)}
        onClose={() => setSelectedDetail(null)}
        title={selectedDetail?.type === 'invoice' ? 'Detalhe da fatura' : 'Detalhe do evento'}
        description="Informacoes do item selecionado para validacao operacional."
        actions={<Button type="button" variant="ghost" onClick={() => setSelectedDetail(null)}>Fechar</Button>}
      >
        {selectedDetail?.type === 'invoice' ? (
          <div className="space-y-3">
            <DetailItem label="Periodo" value={selectedDetail.item.period_label || '-'} />
            <DetailItem label="Valor" value={formatBillingMoney(selectedDetail.item.amount)} />
            <DetailItem label="Vencimento" value={formatBillingDate(selectedDetail.item.due_date)} />
            <DetailItem label="Pago em" value={formatBillingDate(selectedDetail.item.paid_at)} />
            <DetailItem label="Status" value={<BillingStatusBadge status={selectedDetail.item.status} />} />
            <DetailItem label="Referencia" value={selectedDetail.item.external_reference || '-'} />
          </div>
        ) : null}

        {selectedDetail?.type === 'event' ? (
          <div className="space-y-3">
            <DetailItem label="Evento" value={eventTypeLabel(selectedDetail.item.event_type)} />
            <DetailItem label="Fonte" value={String(selectedDetail.item.source || 'system').toUpperCase()} />
            <DetailItem label="Status" value={<BillingStatusBadge status={selectedDetail.item.status} />} />
            <DetailItem label="Criado em" value={formatBillingDate(selectedDetail.item.created_at)} />
            <DetailItem label="Descricao" value={selectedDetail.item.summary || selectedDetail.item.description || '-'} />
            <DetailItem label="Atalho" value={<Button as={Link} to="/admin/cobranca" variant="secondary" size="sm"><ArrowUpRight className="h-4 w-4" />Abrir centro de cobranca</Button>} />
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
