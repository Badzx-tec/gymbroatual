import React from 'react';
import {
  AlertTriangle,
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
  attemptReasonLabel,
  eventTypeLabel,
  formatBillingDate,
  formatBillingMoney,
  getBillingActionItems,
  getInvoiceStatusFilterOptions,
  getSubscriptionStateMeta,
} from '../features/billing/billingUtils';
import useBillingOverview from '../features/billing/useBillingOverview';

function getOperationalBanner(data, subscriptionMeta) {
  const summary = data.summary || {};
  if ((summary.past_due_invoice_count || 0) > 0) {
    return {
      tone: 'warning',
      title: 'Assinatura com pendencia financeira',
      description: `Existem ${summary.past_due_invoice_count || 0} fatura(s) em atraso e ${summary.failed_attempt_count || 0} tentativa(s) com falha recente.`,
    };
  }
  if (!data.subscription?.can_login) {
    return {
      tone: 'danger',
      title: 'Acesso administrativo em risco',
      description: 'A academia pode ficar sem acesso ao painel ate a regularizacao da assinatura.',
    };
  }
  return {
    tone: subscriptionMeta.tone,
    title: subscriptionMeta.label,
    description: subscriptionMeta.summary,
  };
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <div className="mt-1 text-sm text-zinc-100">{value}</div>
    </div>
  );
}

export default function BillingCenterPage() {
  const [invoiceFilter, setInvoiceFilter] = React.useState('all');
  const [selectedDetail, setSelectedDetail] = React.useState(null);
  const { data, loading, refreshing, error, reload, syncWithProvider } = useBillingOverview({
    invoiceLimit: 12,
    attemptLimit: 10,
    eventLimit: 12,
  });

  const subscriptionMeta = React.useMemo(
    () => getSubscriptionStateMeta(data.subscription),
    [data.subscription]
  );
  const operationalBanner = React.useMemo(
    () => getOperationalBanner(data, subscriptionMeta),
    [data, subscriptionMeta]
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
        subtitle="Monitore a assinatura da academia, a inadimplencia e o historico do provedor em uma operacao unica."
        actions={
          <>
            <Button as={Link} to="/admin/assinatura" variant="ghost" size="sm">
              Ver assinatura
            </Button>
            <Button onClick={handleSync} variant="secondary" size="sm">
              <ShieldCheck className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Ja paguei, verificar
            </Button>
            <Button onClick={handleCheckout} variant="primary" size="sm">
              <CreditCard className="h-4 w-4" />
              Abrir checkout
            </Button>
          </>
        }
      />

      {error ? <Banner tone="warning" title="Aviso de sincronizacao" description={error} /> : null}
      <Banner tone={operationalBanner.tone} title={operationalBanner.title} description={operationalBanner.description} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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
          label="Acesso ao painel"
          value={data.subscription?.can_login ? 'Liberado' : 'Restrito'}
          hint={formatBillingDate(data.subscription?.current_period_end)}
          icon={ShieldCheck}
          accent={data.subscription?.can_login ? 'success' : 'danger'}
        />
        <StatCard
          label="Ultimo evento"
          value={formatBillingDate(data.summary?.last_event_at)}
          hint="Historico recente da assinatura"
          icon={History}
          accent="info"
        />
        <StatCard
          label="Falhas recentes"
          value={String(data.summary?.failed_attempt_count || 0)}
          hint="Tentativas com status failed"
          icon={AlertTriangle}
          accent={(data.summary?.failed_attempt_count || 0) > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard title="Contrato SaaS" description="Campos que mais ajudam suporte e operacao a entender a situacao atual.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <DetailItem label="Plano" value={data.membership?.plan_code || '-'} />
            <DetailItem label="Valor mensal" value={formatBillingMoney(data.membership?.amount)} />
            <DetailItem label="Status tecnico" value={<BillingStatusBadge status={data.subscription?.status} />} />
            <DetailItem label="Periodo pago ate" value={formatBillingDate(data.subscription?.current_period_end)} />
            <DetailItem label="Ultimo pagamento" value={formatBillingDate(data.subscription?.last_payment_at)} />
            <DetailItem label="Carencia ate" value={formatBillingDate(data.subscription?.grace_until)} />
            <DetailItem label="Trial ate" value={formatBillingDate(data.subscription?.trial_ends_at)} />
            <DetailItem
              label="Acesso administrativo"
              value={<StatusBadge label={data.subscription?.can_login ? 'Liberado' : 'Bloqueado'} tone={data.subscription?.can_login ? 'success' : 'warning'} />}
            />
            <DetailItem label="Proximo vencimento" value={formatBillingDate(data.summary?.next_invoice_due_at)} />
          </div>
        </SectionCard>

        <SectionCard title="Proximos passos" description="Leitura operacional para decidir a proxima acao."
          actions={
            <Button type="button" onClick={handleReload} variant="ghost" size="sm">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          }
        >
          <ul className="space-y-3">
            {actionItems.map((item) => (
              <li key={item} className="rounded-xl border border-zinc-900 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
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
              <Button
                key={option.value}
                type="button"
                onClick={() => setInvoiceFilter(option.value)}
                variant={invoiceFilter === option.value ? 'primary' : 'ghost'}
                size="sm"
              >
                {option.label}
              </Button>
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
            <table className="min-w-[980px] w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-900 text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  <th className="px-5 py-3">Periodo</th>
                  <th className="px-5 py-3">Valor</th>
                  <th className="px-5 py-3">Vencimento</th>
                  <th className="px-5 py-3">Pagamento</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.invoice_id} className="border-b border-zinc-900/80 last:border-b-0">
                    <td className="px-5 py-4 font-medium text-zinc-100">{invoice.period_label}</td>
                    <td className="px-5 py-4 text-zinc-200">{formatBillingMoney(invoice.amount)}</td>
                    <td className="px-5 py-4 text-zinc-400">{formatBillingDate(invoice.due_date)}</td>
                    <td className="px-5 py-4 text-zinc-400">{formatBillingDate(invoice.paid_at)}</td>
                    <td className="px-5 py-4"><BillingStatusBadge status={invoice.status} /></td>
                    <td className="px-5 py-4 text-right">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedDetail({ type: 'invoice', item: invoice })}>
                        Ver detalhe
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Tentativas de pagamento" description="Falhas e sucessos mais recentes enviados pelo provedor.">
          {data.attempts?.length ? (
            <div className="space-y-3">
              {data.attempts.map((attempt) => (
                <article key={attempt.attempt_id} className="rounded-xl border border-zinc-900 bg-zinc-900/55 px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{formatBillingMoney(attempt.amount)}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {formatBillingDate(attempt.created_at)} | {attemptReasonLabel(attempt.reason)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <BillingStatusBadge status={attempt.status} size="sm" />
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedDetail({ type: 'attempt', item: attempt })}>
                        Ver
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={CreditCard} title="Sem tentativas registradas" description="Quando houver retorno do provedor, ele aparecera aqui." />
          )}
        </SectionCard>

        <SectionCard title="Timeline da assinatura" description="Eventos manuais, webhooks e reconciliacoes recentes.">
          {data.events?.length ? (
            <div className="space-y-3">
              {data.events.map((event) => (
                <article key={event.event_id} className="rounded-xl border border-zinc-900 bg-zinc-900/55 px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{eventTypeLabel(event.event_type)}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {String(event.source || 'system').toUpperCase()} | {formatBillingDate(event.created_at)}
                      </p>
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
            <EmptyState icon={History} title="Sem eventos recentes" description="Os proximos webhooks, checkouts e reconciliacoes aparecerao aqui." />
          )}
        </SectionCard>
      </div>

      <SidePanel
        open={Boolean(selectedDetail)}
        onClose={() => setSelectedDetail(null)}
        title={selectedDetail?.type === 'invoice' ? 'Detalhe da fatura' : selectedDetail?.type === 'attempt' ? 'Detalhe da tentativa' : 'Detalhe do evento'}
        description="Resumo do item selecionado para analise operacional e suporte."
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

        {selectedDetail?.type === 'attempt' ? (
          <div className="space-y-3">
            <DetailItem label="Valor" value={formatBillingMoney(selectedDetail.item.amount)} />
            <DetailItem label="Status" value={<BillingStatusBadge status={selectedDetail.item.status} />} />
            <DetailItem label="Motivo" value={attemptReasonLabel(selectedDetail.item.reason)} />
            <DetailItem label="Criada em" value={formatBillingDate(selectedDetail.item.created_at)} />
            <DetailItem label="Mensagem" value={selectedDetail.item.message || '-'} />
            <DetailItem label="Referencia externa" value={selectedDetail.item.external_reference || '-'} />
          </div>
        ) : null}

        {selectedDetail?.type === 'event' ? (
          <div className="space-y-3">
            <DetailItem label="Evento" value={eventTypeLabel(selectedDetail.item.event_type)} />
            <DetailItem label="Fonte" value={String(selectedDetail.item.source || 'system').toUpperCase()} />
            <DetailItem label="Status" value={<BillingStatusBadge status={selectedDetail.item.status} />} />
            <DetailItem label="Criado em" value={formatBillingDate(selectedDetail.item.created_at)} />
            <DetailItem label="Descricao" value={selectedDetail.item.summary || selectedDetail.item.description || '-'} />
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
