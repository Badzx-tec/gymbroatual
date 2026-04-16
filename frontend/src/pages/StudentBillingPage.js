import React from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Clock3,
  CreditCard,
  FileClock,
  Receipt,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
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
import {
  formatBillingDate,
  formatBillingMoney,
  getBillingBanner,
  getBillingEventLabel,
  getBlockedReasonLabel,
  getChargeFilterOptions,
  getStatusMeta,
} from '../features/student-billing/studentBillingUtils';

function DetailItem({ label, value }) {
  return (
    <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-soft)] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-sm text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function ContractCard({ contract, isCurrent }) {
  const contractMeta = getStatusMeta(contract.contract_status || contract.status);
  const financialMeta = getStatusMeta(contract.financial_status);
  const accessMeta = getStatusMeta(contract.access_status);

  return (
    <article className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {contract.plan_name || contract.plan_id || 'Contrato sem plano'}
            </h3>
            {isCurrent ? <StatusBadge label="Atual" tone="info" size="sm" /> : null}
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Vigencia: {formatBillingDate(contract.current_period_start)} ate {formatBillingDate(contract.current_period_end)}
          </p>
        </div>
        <p className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">{formatBillingMoney(contract.amount)}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <StatusBadge label={`Contrato ${contractMeta.label}`} tone={contractMeta.tone} />
        <StatusBadge label={`Financeiro ${financialMeta.label}`} tone={financialMeta.tone} />
        <StatusBadge label={`Acesso ${accessMeta.label}`} tone={accessMeta.tone} />
      </div>

      {(contract.grace_until || contract.next_retry_at || Number(contract.dunning_level || 0) > 0) ? (
        <div className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">
          {contract.grace_until ? <p>Carencia ate {formatBillingDate(contract.grace_until)}</p> : null}
          {contract.next_retry_at ? <p>Proxima tentativa prevista em {formatBillingDate(contract.next_retry_at)}</p> : null}
          {Number(contract.dunning_level || 0) > 0 ? <p>Nivel de cobranca atual: {Number(contract.dunning_level || 0)}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

export default function StudentBillingPage() {
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState('');
  const [chargeFilter, setChargeFilter] = React.useState('all');
  const [selectedChargeId, setSelectedChargeId] = React.useState('');
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
        limitEvents: 120,
      });
      setData(response || { contracts: [], charges: [], events: [], summary: {} });
    } catch (err) {
      const message = err?.message || 'Falha ao carregar sua cobranca.';
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

  const summary = React.useMemo(() => data?.summary || {}, [data]);
  const contracts = React.useMemo(() => data?.contracts || [], [data]);
  const charges = React.useMemo(() => data?.charges || [], [data]);
  const events = React.useMemo(() => data?.events || [], [data]);

  const currentContract = React.useMemo(() => {
    const currentId = String(summary.current_contract_id || '').trim();
    if (currentId) {
      const match = contracts.find((item) => item.contract_id === currentId);
      if (match) return match;
    }
    return contracts[0] || null;
  }, [contracts, summary.current_contract_id]);

  const filteredCharges = React.useMemo(() => {
    if (chargeFilter === 'all') return charges;
    if (chargeFilter === 'overdue') {
      return charges.filter((charge) => ['overdue', 'failed'].includes(String(charge.status || '').toLowerCase()));
    }
    return charges.filter((charge) => String(charge.status || '').toLowerCase() === chargeFilter);
  }, [chargeFilter, charges]);

  const selectedCharge = React.useMemo(() => {
    return charges.find((item) => item.charge_id === selectedChargeId) || null;
  }, [charges, selectedChargeId]);

  const banner = React.useMemo(() => getBillingBanner(summary), [summary]);
  const accessMeta = React.useMemo(() => getStatusMeta(summary.current_access_status), [summary.current_access_status]);
  const financialMeta = React.useMemo(() => getStatusMeta(summary.current_financial_status), [summary.current_financial_status]);
  const chargeFilterOptions = React.useMemo(() => getChargeFilterOptions(summary), [summary]);

  if (loading) {
    return <LoadingScreen label="Carregando sua cobranca..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Portal do aluno"
        title="Cobranca"
        subtitle="Acompanhe vencimentos, carencia, bloqueio por inadimplencia e historico financeiro com mais clareza."
        actions={(
          <Button type="button" onClick={() => load({ silent: true })} variant="secondary" size="sm">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        )}
      />

      {error ? (
        <Banner
          tone="danger"
          title="Falha ao carregar cobranca"
          description={error}
          actions={(
            <Button type="button" onClick={() => load()} variant="danger" size="sm">
              Tentar novamente
            </Button>
          )}
        />
      ) : null}

      <Banner tone={banner.tone} title={banner.title} description={banner.description} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Acesso atual"
          value={accessMeta.label}
          hint={summary.grace_until ? `Carencia ate ${formatBillingDate(summary.grace_until)}` : (
            summary.blocked_reason ? getBlockedReasonLabel(summary.blocked_reason) : 'Sem restricoes no momento.'
          )}
          icon={ShieldAlert}
          accent={accessMeta.tone}
        />
        <StatCard
          label="Financeiro atual"
          value={financialMeta.label}
          hint={Number(summary.dunning_level || 0) > 0 ? `Nivel de cobranca ${Number(summary.dunning_level || 0)}` : 'Sem escalonamento de cobranca.'}
          icon={CreditCard}
          accent={financialMeta.tone}
        />
        <StatCard
          label="Em aberto"
          value={Number(summary.open_charges || 0)}
          hint="Titulos aguardando pagamento."
          icon={Receipt}
          accent={Number(summary.open_charges || 0) > 0 ? 'info' : 'default'}
        />
        <StatCard
          label="Em atraso"
          value={Number(summary.overdue_charges || 0)}
          hint={Number(summary.overdue_charges || 0) > 0 ? 'Regularize para evitar bloqueio.' : 'Nenhuma cobranca vencida.'}
          icon={AlertTriangle}
          accent={Number(summary.overdue_charges || 0) > 0 ? 'danger' : 'success'}
        />
        <StatCard
          label="Proximo vencimento"
          value={formatBillingDate(summary.next_due_at)}
          hint="Data da proxima cobranca em aberto."
          icon={CalendarClock}
          accent={summary.next_due_at ? 'info' : 'default'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard
          title="Situacao atual"
          description="Esta leitura combina contrato, financeiro e acesso para deixar claro quando a catraca continua liberada ou sera bloqueada."
        >
          {currentContract ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge label={`Contrato ${getStatusMeta(currentContract.contract_status || currentContract.status).label}`} tone={getStatusMeta(currentContract.contract_status || currentContract.status).tone} />
                <StatusBadge label={`Financeiro ${financialMeta.label}`} tone={financialMeta.tone} />
                <StatusBadge label={`Acesso ${accessMeta.label}`} tone={accessMeta.tone} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <DetailItem label="Plano" value={currentContract.plan_name || currentContract.plan_id || '-'} />
                <DetailItem label="Valor" value={formatBillingMoney(currentContract.amount)} />
                <DetailItem label="Inicio" value={formatBillingDate(currentContract.current_period_start)} />
                <DetailItem label="Fim" value={formatBillingDate(currentContract.current_period_end)} />
              </div>

              <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-soft)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                <p className="font-semibold text-[var(--text-primary)]">Como a liberacao funciona</p>
                <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
                  <li>Em dia: acesso continua liberado normalmente.</li>
                  <li>Em carencia: acesso segue liberado ate o prazo de carencia expirar.</li>
                  <li>Bloqueado: apos o fim da carencia, a inadimplencia bloqueia a catraca ate a regularizacao.</li>
                </ul>
              </div>

              {(summary.next_retry_at || summary.grace_until || Number(summary.dunning_level || 0) > 0 || summary.blocked_reason) ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {summary.grace_until ? <DetailItem label="Carencia ate" value={formatBillingDate(summary.grace_until)} /> : null}
                  {summary.next_retry_at ? <DetailItem label="Proxima tentativa" value={formatBillingDate(summary.next_retry_at)} /> : null}
                  {summary.blocked_reason ? <DetailItem label="Motivo do bloqueio" value={getBlockedReasonLabel(summary.blocked_reason)} /> : null}
                  {Number(summary.dunning_level || 0) > 0 ? <DetailItem label="Nivel de cobranca" value={String(Number(summary.dunning_level || 0))} /> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              icon={FileClock}
              title="Nenhum contrato vinculado"
              description="Quando a academia associar um contrato ao seu cadastro, o resumo financeiro aparecera aqui."
            />
          )}
        </SectionCard>

        <SectionCard title="Historico financeiro" description="Eventos de cobranca e mudancas de status mais recentes.">
          {events.length ? (
            <ul className="space-y-2">
              {events.slice(0, 12).map((item) => (
                <li key={item.event_id} className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-soft)] p-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{getBillingEventLabel(item.event_type)}</p>
                  <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">{formatBillingDate(item.created_at)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Clock3}
              title="Sem eventos financeiros"
              description="Seu historico de cobranca vai aparecer aqui conforme pagamentos, atrasos e regularizacoes forem registrados."
            />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Contratos vinculados" description="Lista completa dos contratos associados ao seu cadastro.">
        {contracts.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {contracts.map((contract) => (
              <ContractCard
                key={contract.contract_id}
                contract={contract}
                isCurrent={contract.contract_id === summary.current_contract_id}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FileClock}
            title="Sem contratos visiveis"
            description="Nao encontramos contratos associados ao seu usuario no momento."
          />
        )}
      </SectionCard>

      <SectionCard
        title="Minhas cobrancas"
        description="Veja quais titulos ja foram pagos, quais ainda estao em aberto e quais ja entraram em atraso."
        actions={(
          <div className="flex flex-wrap gap-2">
            {chargeFilterOptions.map((option) => (
              <Button
                key={option.key}
                type="button"
                variant={chargeFilter === option.key ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setChargeFilter(option.key)}
              >
                {option.label}
                {option.count !== null ? ` (${option.count})` : ''}
              </Button>
            ))}
          </div>
        )}
        bodyClassName="p-0"
      >
        {charges.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--surface-border)] text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  <th className="px-5 py-3">Vencimento</th>
                  <th className="px-5 py-3">Valor</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Contrato</th>
                  <th className="px-5 py-3">Pagamento</th>
                  <th className="px-5 py-3 text-right">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {filteredCharges.length ? filteredCharges.map((charge) => {
                  const statusMeta = getStatusMeta(charge.status);
                  const contract = contracts.find((item) => item.contract_id === charge.contract_id);
                  return (
                    <tr key={charge.charge_id} className="border-b border-[var(--surface-border)] transition-colors hover:bg-[var(--surface-soft)]">
                      <td className="px-5 py-3 font-mono text-xs text-[var(--text-secondary)]">{formatBillingDate(charge.due_at)}</td>
                      <td className="px-5 py-3 font-mono font-semibold tabular-nums text-[var(--text-primary)]">{formatBillingMoney(charge.amount)}</td>
                      <td className="px-5 py-4">
                        <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-secondary)]">{contract?.plan_name || contract?.plan_id || charge.contract_id}</td>
                      <td className="px-5 py-3 font-mono text-xs text-[var(--text-secondary)]">{formatBillingDate(charge.paid_at)}</td>
                      <td className="px-5 py-4 text-right">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedChargeId(charge.charge_id)}>
                          Ver detalhe
                        </Button>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-8">
                      <EmptyState
                        icon={Receipt}
                        title="Sem cobrancas neste filtro"
                        description="Troque o filtro acima para consultar outros status de cobranca."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={Receipt}
              title="Nenhuma cobranca registrada"
              description="Quando a academia gerar titulos para o seu contrato, eles ficarao disponiveis aqui."
            />
          </div>
        )}
      </SectionCard>

      <SidePanel
        open={Boolean(selectedCharge)}
        onClose={() => setSelectedChargeId('')}
        title="Detalhe da cobranca"
        description="Resumo do titulo financeiro selecionado."
        actions={(
          <Button type="button" variant="ghost" onClick={() => setSelectedChargeId('')}>
            Fechar
          </Button>
        )}
      >
        {selectedCharge ? (
          <div className="space-y-4">
            <Banner
              tone={getStatusMeta(selectedCharge.status).tone}
              title={getStatusMeta(selectedCharge.status).label}
              description={
                ['overdue', 'failed'].includes(String(selectedCharge.status || '').toLowerCase())
                  ? 'Esta cobranca esta em atraso. Regularize na recepcao para evitar ou remover bloqueio.'
                  : String(selectedCharge.status || '').toLowerCase() === 'paid'
                    ? 'Pagamento registrado com sucesso.'
                    : 'Acompanhe os dados desta cobranca abaixo.'
              }
            />

            <div className="grid gap-3">
              <DetailItem label="Valor" value={formatBillingMoney(selectedCharge.amount)} />
              <DetailItem label="Vencimento" value={formatBillingDate(selectedCharge.due_at)} />
              <DetailItem label="Status" value={getStatusMeta(selectedCharge.status).label} />
              <DetailItem label="Pago em" value={formatBillingDate(selectedCharge.paid_at)} />
              <DetailItem label="Forma de pagamento" value={selectedCharge.payment_method || '-'} />
              <DetailItem label="Referencia externa" value={selectedCharge.external_reference || '-'} />
              <DetailItem label="Periodo inicial" value={formatBillingDate(selectedCharge.period_start)} />
              <DetailItem label="Periodo final" value={formatBillingDate(selectedCharge.period_end)} />
              <DetailItem label="Observacoes" value={selectedCharge.notes || '-'} />
            </div>
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
