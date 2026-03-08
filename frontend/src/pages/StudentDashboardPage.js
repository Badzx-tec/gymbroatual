import React from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CreditCard,
  RefreshCw,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import Banner from '../components/ui/Banner';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import {
  formatBillingDate,
  formatBillingMoney,
  getBlockedReasonLabel,
  getStatusMeta,
} from '../features/student-billing/studentBillingUtils';

function getAccessBanner(accessStatus, accessContext, nextCharge) {
  const status = String(accessStatus || '').toLowerCase();
  const blockedReason = String(accessContext?.blocked_reason || '').toLowerCase();

  if (status === 'blocked') {
    return {
      tone: 'danger',
      title: 'Acesso bloqueado',
      description: blockedReason
        ? `Motivo atual: ${getBlockedReasonLabel(blockedReason)}.`
        : 'Seu acesso esta bloqueado. Procure a recepcao para regularizar.',
    };
  }

  if (status === 'grace_period') {
    return {
      tone: 'warning',
      title: 'Acesso liberado em carencia',
      description: accessContext?.grace_until
        ? `Voce ainda pode entrar ate ${formatBillingDate(accessContext.grace_until)}. Regularize antes desse prazo para evitar bloqueio.`
        : 'Existe carencia ativa. Regularize o financeiro antes do bloqueio.',
    };
  }

  if (nextCharge && ['overdue', 'failed', 'partially_paid'].includes(String(nextCharge.status || '').toLowerCase())) {
    return {
      tone: 'warning',
      title: 'Pendencia financeira em aberto',
      description: 'Existe cobranca com atraso ou falha. Procure a recepcao para manter a catraca liberada.',
    };
  }

  return {
    tone: 'success',
    title: 'Acesso liberado',
    description: 'Seu contrato e acesso estao em situacao regular no momento.',
  };
}

function AccessLogItem({ item }) {
  const allowed = Boolean(item.autorizado || item.decision === 'allow');
  const reason = item.reason || item.motivo || '-';

  return (
    <li className="rounded-2xl border border-zinc-900 bg-zinc-950/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-100">
            {allowed ? 'Acesso liberado' : 'Acesso negado'}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{formatBillingDate(item.timestamp || item.created_at)}</p>
        </div>
        <StatusBadge label={allowed ? 'Liberado' : 'Negado'} tone={allowed ? 'success' : 'danger'} size="sm" />
      </div>
      <p className="mt-2 text-sm text-zinc-400">{reason}</p>
    </li>
  );
}

function NotificationItem({ item }) {
  return (
    <li className="rounded-2xl border border-zinc-900 bg-zinc-950/70 p-3">
      <p className="text-sm font-semibold text-zinc-100">{item.titulo || 'Aviso'}</p>
      <p className="mt-1 text-sm text-zinc-400">{item.mensagem || '-'}</p>
      <p className="mt-2 text-xs text-zinc-500">{formatBillingDate(item.created_at)}</p>
    </li>
  );
}

export default function StudentDashboardPage() {
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError('');
    }
    try {
      const response = await api.studentPortalDashboard();
      setData(response || null);
      return response || null;
    } catch (err) {
      const message = err?.message || 'Erro ao carregar painel do aluno';
      setError(message);
      toast.error(message);
      throw err;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    load().catch(() => {});
  }, [load]);

  if (loading) {
    return <LoadingScreen label="Carregando painel do aluno..." />;
  }

  const student = data?.student || {};
  const contract = data?.contract || null;
  const accessStatus = data?.access_status || 'active';
  const accessContext = data?.access_context || {};
  const logs = data?.recent_access_logs || [];
  const notifications = data?.notifications || [];
  const upcomingCharges = data?.upcoming_charges || [];
  const nextCharge = upcomingCharges.find((item) => ['open', 'overdue', 'partially_paid', 'failed'].includes(String(item?.status || '').toLowerCase())) || null;
  const accessMeta = getStatusMeta(accessStatus);
  const contractMeta = getStatusMeta(contract?.contract_status || contract?.status);
  const financialMeta = getStatusMeta(contract?.financial_status);
  const banner = getAccessBanner(accessStatus, accessContext, nextCharge);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Portal do aluno"
        title="Meu painel"
        subtitle="Veja rapidamente se sua entrada esta liberada, quando vence o plano e quais cobrancas exigem atencao."
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
          title="Falha ao carregar o painel"
          description={error}
          actions={(
            <Button type="button" onClick={() => load()} variant="danger" size="sm">
              Tentar novamente
            </Button>
          )}
        />
      ) : null}

      <Banner tone={banner.tone} title={banner.title} description={banner.description} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Situacao de acesso"
          value={accessMeta.label}
          hint={accessContext?.grace_until ? `Carencia ate ${formatBillingDate(accessContext.grace_until)}` : 'Use este status para saber se a catraca libera agora.'}
          icon={ShieldCheck}
          accent={accessMeta.tone}
        />
        <StatCard
          label="Plano atual"
          value={contract?.plan_name || student.plan_id || '-'}
          hint={`Matricula ${student.matricula || '-'}`}
          icon={CalendarClock}
          accent="info"
        />
        <StatCard
          label="Vigencia atual"
          value={formatBillingDate(contract?.current_period_end || student.plan_expires_at)}
          hint="Data limite do contrato ou plano em vigor."
          icon={CalendarClock}
          accent={contract ? contractMeta.tone : 'default'}
        />
        <StatCard
          label="Proxima cobranca"
          value={nextCharge ? formatBillingMoney(nextCharge.amount) : '-'}
          hint={nextCharge ? formatBillingDate(nextCharge.due_at) : 'Nenhuma cobranca pendente.'}
          icon={CreditCard}
          accent={nextCharge ? getStatusMeta(nextCharge.status).tone : 'default'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard title="Resumo do contrato" description="Leitura rapida do contrato que hoje dirige seu acesso.">
          {contract ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge label={`Contrato ${contractMeta.label}`} tone={contractMeta.tone} />
                <StatusBadge label={`Financeiro ${financialMeta.label}`} tone={financialMeta.tone} />
                <StatusBadge label={`Acesso ${accessMeta.label}`} tone={accessMeta.tone} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <InfoTile label="Inicio" value={formatBillingDate(contract.current_period_start)} />
                <InfoTile label="Fim" value={formatBillingDate(contract.current_period_end)} />
                <InfoTile label="Valor" value={formatBillingMoney(contract.amount)} />
                <InfoTile label="Aluno" value={student.name || '-'} />
              </div>
              {(accessContext?.next_retry_at || accessContext?.blocked_reason) ? (
                <div className="rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-300">
                  {accessContext?.next_retry_at ? (
                    <p>Proxima tentativa de cobranca prevista em {formatBillingDate(accessContext.next_retry_at)}.</p>
                  ) : null}
                  {accessContext?.blocked_reason ? (
                    <p className="mt-2">Motivo operacional: {getBlockedReasonLabel(accessContext.blocked_reason)}.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title="Sem contrato associado"
              description="A academia ainda nao vinculou um contrato ativo ao seu cadastro."
            />
          )}
        </SectionCard>

        <SectionCard title="Cobrancas pendentes" description="Titulos abertos ou vencidos que merecem atencao imediata.">
          {upcomingCharges.length ? (
            <ul className="space-y-2">
              {upcomingCharges.slice(0, 6).map((charge) => {
                const chargeMeta = getStatusMeta(charge.status);
                return (
                  <li key={charge.charge_id} className="rounded-2xl border border-zinc-900 bg-zinc-950/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-100">{formatBillingMoney(charge.amount)}</p>
                        <p className="mt-1 text-xs text-zinc-500">Vencimento: {formatBillingDate(charge.due_at)}</p>
                      </div>
                      <StatusBadge label={chargeMeta.label} tone={chargeMeta.tone} size="sm" />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={CreditCard}
              title="Sem cobrancas pendentes"
              description="Nao encontramos titulos em aberto ou em atraso neste momento."
            />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Historico de acessos" description="Ultimos eventos da catraca associados ao seu cadastro.">
          {logs.length ? (
            <ul className="space-y-2">
              {logs.slice(0, 10).map((log) => (
                <AccessLogItem key={log.log_id || `${log.timestamp || log.created_at}-${log.reason || log.motivo || ''}`} item={log} />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={ScanLine}
              title="Sem acessos registrados"
              description="Quando houver leituras de catraca, elas aparecerao aqui."
            />
          )}
        </SectionCard>

        <SectionCard title="Avisos da academia" description="Comunicados e lembretes mais recentes da operacao.">
          {notifications.length ? (
            <ul className="space-y-2">
              {notifications.slice(0, 10).map((item) => (
                <NotificationItem key={item.notif_id} item={item} />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Bell}
              title="Sem avisos no momento"
              description="Quando a academia publicar um aviso para seu cadastro, ele aparecera aqui."
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm text-zinc-100">{value}</p>
    </div>
  );
}
