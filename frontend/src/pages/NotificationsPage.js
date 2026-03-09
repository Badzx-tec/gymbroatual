import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronRight,
  Mail,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

import { api } from '../api';
import Banner from '../components/ui/Banner';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SectionCard from '../components/ui/SectionCard';
import SidePanel from '../components/ui/SidePanel';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import { cn } from '../lib/cn';

const FILTER_OPTIONS = [
  { id: 'all', label: 'Todas' },
  { id: 'unread', label: 'Nao lidas' },
  { id: 'read', label: 'Lidas' },
  { id: 'expiring', label: 'Vencimento' },
];

function notificationTone(type) {
  return String(type || '').toLowerCase() === 'vencimento' ? 'warning' : 'info';
}

function notificationTypeLabel(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (!normalized) return 'Sistema';
  if (normalized === 'vencimento') return 'Vencimento';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function emailStatusMeta(notification) {
  const rawStatus = String(notification.email_status || '').trim().toLowerCase();
  if (notification.email_enviado) {
    return {
      tone: 'success',
      label: rawStatus ? `E-mail ${rawStatus}` : 'E-mail enviado',
    };
  }
  if (rawStatus === 'simulado') {
    return { tone: 'info', label: 'Envio simulado' };
  }
  return { tone: 'neutral', label: rawStatus ? `E-mail ${rawStatus}` : 'Sem envio' };
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return '-';
  }
}

function emitNotificationsUpdate(notifications) {
  if (typeof window === 'undefined') return;
  const unreadCount = notifications.filter((item) => !item.lida).length;
  window.dispatchEvent(
    new CustomEvent('gymbro:notifications-updated', {
      detail: { unreadCount },
    })
  );
}

function matchesFilter(item, filter) {
  if (filter === 'all') return true;
  if (filter === 'unread') return !item.lida;
  if (filter === 'read') return !!item.lida;
  if (filter === 'expiring') return String(item.tipo || '').toLowerCase() === 'vencimento';
  return true;
}

function NotificationEmptyState({ onRetry, onClearFilters, hasFilters, checking }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--surface-border)] bg-[var(--surface-canvas)] px-6 py-10 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-soft)] text-[var(--text-muted)]">
        <Bell className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">Nenhuma notificacao encontrada</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-muted)]">
        {hasFilters
          ? 'Os filtros atuais nao retornaram notificacoes. Limpe a busca ou ajuste o estado selecionado.'
          : 'Ainda nao existem notificacoes para esta academia. Gere uma nova verificacao para popular a fila.'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {hasFilters ? (
          <Button type="button" variant="secondary" onClick={onClearFilters}>
            Limpar filtros
          </Button>
        ) : null}
        <Button type="button" variant="primary" onClick={onRetry} disabled={checking}>
          <RefreshCw className={cn('h-4 w-4', checking && 'animate-spin')} />
          Verificar vencimentos
        </Button>
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeNotificationId, setActiveNotificationId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState({ open: false, ids: [] });
  const [submitting, setSubmitting] = useState(false);

  const applyNotifications = useCallback((nextOrUpdater) => {
    setNotifications((current) => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
      const existingIds = new Set(next.map((item) => item.notif_id));
      setSelectedIds((previous) => previous.filter((id) => existingIds.has(id)));
      setActiveNotificationId((previous) => (previous && existingIds.has(previous) ? previous : ''));
      emitNotificationsUpdate(next);
      return next;
    });
  }, []);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError('');
      const result = await api.listNotifications(150);
      applyNotifications(result || []);
    } catch (err) {
      const message = err?.message || 'Falha ao carregar notificacoes.';
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyNotifications]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredNotifications = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return notifications.filter((item) => {
      if (!matchesFilter(item, filter)) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        item.titulo,
        item.mensagem,
        item.student_email,
        item.email_status,
        item.tipo,
        item.student_id,
        item.notif_id,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [filter, notifications, search]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const activeNotification = useMemo(
    () => notifications.find((item) => item.notif_id === activeNotificationId) || null,
    [activeNotificationId, notifications]
  );

  const unreadCount = useMemo(() => notifications.filter((item) => !item.lida).length, [notifications]);
  const readCount = notifications.length - unreadCount;
  const expiringCount = useMemo(
    () => notifications.filter((item) => String(item.tipo || '').toLowerCase() === 'vencimento').length,
    [notifications]
  );
  const emailCount = useMemo(
    () => notifications.filter((item) => item.email_enviado || item.email_status).length,
    [notifications]
  );

  const allFilteredSelected =
    filteredNotifications.length > 0
    && filteredNotifications.every((item) => selectedSet.has(item.notif_id));
  const selectedUnreadIds = filteredNotifications
    .filter((item) => selectedSet.has(item.notif_id) && !item.lida)
    .map((item) => item.notif_id);
  const hasFilters = filter !== 'all' || search.trim().length > 0;

  const statCards = [
    {
      id: 'all',
      label: 'Total',
      value: notifications.length,
      icon: Bell,
      accent: 'default',
      hint: 'Fila completa da academia',
    },
    {
      id: 'unread',
      label: 'Nao lidas',
      value: unreadCount,
      icon: AlertTriangle,
      accent: unreadCount ? 'warning' : 'default',
      hint: 'Exigem leitura ou acao',
    },
    {
      id: 'expiring',
      label: 'Vencimento',
      value: expiringCount,
      icon: RefreshCw,
      accent: expiringCount ? 'warning' : 'default',
      hint: 'Geradas por verificacao',
    },
    {
      id: 'read',
      label: 'Canal de e-mail',
      value: emailCount,
      icon: Mail,
      accent: 'info',
      hint: `${readCount} ja lidas`,
    },
  ];

  const toggleSelection = (notifId) => {
    setSelectedIds((current) => (
      current.includes(notifId)
        ? current.filter((item) => item !== notifId)
        : [...current, notifId]
    ));
  };

  const toggleSelectAllFiltered = () => {
    setSelectedIds((current) => {
      const currentSet = new Set(current);
      if (allFilteredSelected) {
        return current.filter((id) => !filteredNotifications.some((item) => item.notif_id === id));
      }
      filteredNotifications.forEach((item) => currentSet.add(item.notif_id));
      return Array.from(currentSet);
    });
  };

  const markAsRead = async (notifIds, successMessage = 'Notificacoes marcadas como lidas.') => {
    const ids = Array.from(new Set((notifIds || []).filter(Boolean)));
    if (!ids.length) return;
    setSubmitting(true);
    try {
      await api.markNotificationsRead(ids);
      applyNotifications((current) => current.map((item) => (
        ids.includes(item.notif_id)
          ? {
              ...item,
              lida: true,
              read_at: item.read_at || new Date().toISOString(),
            }
          : item
      )));
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      toast.success(ids.length === 1 ? 'Notificacao marcada como lida.' : successMessage);
    } catch (err) {
      toast.error(err?.message || 'Falha ao atualizar notificacoes.');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteNotifications = async (notifIds) => {
    const ids = Array.from(new Set((notifIds || []).filter(Boolean)));
    if (!ids.length) return;
    setSubmitting(true);
    try {
      await api.deleteNotifications(ids);
      applyNotifications((current) => current.filter((item) => !ids.includes(item.notif_id)));
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      setConfirmDelete({ open: false, ids: [] });
      toast.success(ids.length === 1 ? 'Notificacao removida.' : 'Notificacoes removidas.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao remover notificacoes.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckExpiring = async () => {
    setChecking(true);
    try {
      const result = await api.checkExpiring();
      toast.success(result.message || 'Verificacao concluida.');
      await loadData({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Falha ao verificar vencimentos.');
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return <LoadingScreen label="Carregando notificacoes..." />;
  }

  return (
    <div data-testid="notifications-page" className="space-y-6">
      <PageHeader
        eyebrow="Sistema"
        title="Notificacoes"
        subtitle={`${unreadCount} pendente(s) de leitura em ${notifications.length} registro(s). Use filtros e acoes em lote para limpar a fila com rapidez.`}
        actions={(
          <>
            <Button type="button" size="sm" variant="secondary" onClick={() => loadData({ silent: true })} disabled={refreshing}>
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
              Atualizar
            </Button>
            <Button data-testid="check-expiring-btn" type="button" onClick={handleCheckExpiring} disabled={checking} variant="primary" size="sm">
              <RefreshCw className={cn('h-4 w-4', checking && 'animate-spin')} />
              Verificar vencimentos
            </Button>
          </>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => setFilter(card.id)}
            className="text-left"
          >
            <StatCard
              label={card.label}
              value={card.value}
              icon={card.icon}
              accent={card.accent}
              hint={card.hint}
              className={cn(
                'h-full transition-colors',
                filter === card.id
                  ? 'border-[var(--surface-border-strong)] ring-1 ring-[rgba(var(--brand-primary-rgb),0.24)]'
                  : 'hover:border-[var(--surface-border-strong)]'
              )}
            />
          </button>
        ))}
      </div>

      <Banner
        tone={loadError ? 'warning' : 'info'}
        title={loadError ? 'Falha ao sincronizar a fila' : 'Canal de notificacao'}
        description={
          loadError
            ? `${loadError} Use atualizar para tentar novamente sem sair da tela.`
            : 'Os e-mails seguem em modo simulado enquanto nao existir um provedor configurado. A fila continua registrando leitura, envio e status operacional.'
        }
        actions={loadError ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => loadData({ silent: true })}>
            Tentar novamente
          </Button>
        ) : null}
      />

      <SectionCard
        title="Operacao da fila"
        description="Busque por aluno, status, notificacao ou e-mail. A selecao atual vale apenas para os itens visiveis no filtro."
        actions={selectedIds.length ? (
          <>
            <StatusBadge label={`${selectedIds.length} selecionada(s)`} tone="info" size="sm" />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => markAsRead(selectedUnreadIds, 'Selecao marcada como lida.')}
              disabled={!selectedUnreadIds.length || submitting}
            >
              <Check className="h-4 w-4" />
              Marcar lidas
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setConfirmDelete({ open: true, ids: selectedIds })}
              disabled={submitting}
            >
              <Trash2 className="h-4 w-4" />
              Remover selecionadas
            </Button>
          </>
        ) : (
          <StatusBadge
            label={`${filteredNotifications.length} visivel(is)`}
            tone={filteredNotifications.length ? 'neutral' : 'warning'}
            size="sm"
          />
        )}
      >
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por titulo, mensagem, aluno, e-mail ou identificador"
            aria-label="Buscar notificacoes"
          />
          <div className="flex flex-wrap gap-2">
            {FILTER_OPTIONS.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={filter === option.id ? 'primary' : 'secondary'}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </Button>
            ))}
            {hasFilters ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => { setSearch(''); setFilter('all'); }}>
                Limpar
              </Button>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Fila de notificacoes"
        description="Abra o detalhe lateral para ler contexto, destinatario, timestamps e status do canal."
        actions={filteredNotifications.length ? (
          <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAllFiltered}
              className="h-4 w-4 rounded border border-[var(--surface-border)] accent-[var(--brand-primary)]"
            />
            Selecionar visiveis
          </label>
        ) : null}
      >
        {filteredNotifications.length ? (
          <div className="space-y-3">
            {filteredNotifications.map((notification, index) => {
              const selected = selectedSet.has(notification.notif_id);
              const emailMeta = emailStatusMeta(notification);
              const unread = !notification.lida;
              return (
                <motion.article
                  key={notification.notif_id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.02 }}
                  data-testid={`notification-${notification.notif_id}`}
                  className={cn(
                    'rounded-2xl border px-4 py-4 transition-colors',
                    selected || activeNotificationId === notification.notif_id
                      ? 'border-[var(--surface-border-strong)] bg-[var(--surface-canvas)]'
                      : notification.lida
                        ? 'border-[var(--surface-border)] bg-[var(--surface-soft)]/55'
                        : 'border-[var(--surface-border)] bg-[var(--surface-canvas)]'
                  )}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelection(notification.notif_id)}
                        className="mt-1 h-4 w-4 rounded border border-[var(--surface-border)] accent-[var(--brand-primary)]"
                        aria-label={`Selecionar notificacao ${notification.titulo}`}
                      />
                      <div className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
                        notificationTone(notification.tipo) === 'warning'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                          : 'border-sky-500/30 bg-sky-500/10 text-sky-500'
                      )}>
                        {notificationTone(notification.tipo) === 'warning' ? (
                          <AlertTriangle className="h-5 w-5" />
                        ) : (
                          <Bell className="h-5 w-5" />
                        )}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{notification.titulo}</h3>
                        <StatusBadge label={unread ? 'Pendente' : 'Lida'} tone={unread ? 'warning' : 'neutral'} size="sm" />
                        <StatusBadge label={notificationTypeLabel(notification.tipo)} tone={notificationTone(notification.tipo)} size="sm" />
                        <StatusBadge label={emailMeta.label} tone={emailMeta.tone} size="sm" />
                      </div>

                      <p className="mt-2 text-sm text-[var(--text-secondary)]">{notification.mensagem}</p>

                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                        <span>Para: {notification.student_email || 'Sem e-mail'}</span>
                        <span>Criada em {formatDateTime(notification.created_at)}</span>
                        <span>{notification.student_id || 'Sem aluno vinculado'}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                      {unread ? (
                        <Button
                          data-testid={`mark-read-${notification.notif_id}`}
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => markAsRead([notification.notif_id])}
                          disabled={submitting}
                        >
                          <Check className="h-4 w-4" />
                          Marcar lida
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setActiveNotificationId(notification.notif_id)}
                      >
                        <ChevronRight className="h-4 w-4" />
                        Detalhes
                      </Button>
                      <Button
                        data-testid={`delete-notif-${notification.notif_id}`}
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDelete({ open: true, ids: [notification.notif_id] })}
                      >
                        <Trash2 className="h-4 w-4" />
                        Remover
                      </Button>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>
        ) : (
          <NotificationEmptyState
            onRetry={handleCheckExpiring}
            onClearFilters={() => { setSearch(''); setFilter('all'); }}
            hasFilters={hasFilters}
            checking={checking}
          />
        )}
      </SectionCard>

      <SidePanel
        open={Boolean(activeNotification)}
        onClose={() => setActiveNotificationId('')}
        title="Detalhe da notificacao"
        description={activeNotification?.titulo || 'Resumo operacional do item selecionado.'}
        actions={activeNotification ? (
          <>
            {!activeNotification.lida ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => markAsRead([activeNotification.notif_id])}
                disabled={submitting}
              >
                <Check className="h-4 w-4" />
                Marcar lida
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setConfirmDelete({ open: true, ids: [activeNotification.notif_id] })}
              disabled={submitting}
            >
              <Trash2 className="h-4 w-4" />
              Remover
            </Button>
          </>
        ) : null}
      >
        {activeNotification ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={activeNotification.lida ? 'Lida' : 'Pendente'} tone={activeNotification.lida ? 'neutral' : 'warning'} size="sm" />
              <StatusBadge label={notificationTypeLabel(activeNotification.tipo)} tone={notificationTone(activeNotification.tipo)} size="sm" />
              <StatusBadge label={emailStatusMeta(activeNotification).label} tone={emailStatusMeta(activeNotification).tone} size="sm" />
            </div>

            <SectionCard title="Mensagem" description="Conteudo entregue para a operacao da academia." bodyClassName="space-y-3">
              <p className="text-sm text-[var(--text-secondary)]">{activeNotification.mensagem}</p>
            </SectionCard>

            <SectionCard title="Contexto" description="Dados de destino, leitura e rastreabilidade." bodyClassName="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Destinatario</p>
                  <p className="mt-2 text-sm text-[var(--text-primary)]">{activeNotification.student_email || 'Sem e-mail cadastrado'}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{activeNotification.student_id || 'Sem aluno vinculado'}</p>
                </div>
                <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Rastreio</p>
                  <p className="mt-2 text-sm text-[var(--text-primary)]">{activeNotification.notif_id}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Owner atual isolado por `owner_id`</p>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Timeline" description="Leitura temporal e status do canal." bodyClassName="space-y-3">
              <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Criada</p>
                  <p className="text-xs text-[var(--text-muted)]">{formatDateTime(activeNotification.created_at)}</p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Leitura</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {activeNotification.lida ? formatDateTime(activeNotification.read_at || activeNotification.updated_at) : 'Ainda nao lida'}
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Canal</p>
                  <p className="text-xs text-[var(--text-muted)]">{emailStatusMeta(activeNotification).label}</p>
                </div>
              </div>
            </SectionCard>
          </div>
        ) : null}
      </SidePanel>

      <Dialog
        open={confirmDelete.open}
        onClose={() => setConfirmDelete({ open: false, ids: [] })}
        title={confirmDelete.ids.length > 1 ? 'Remover notificacoes selecionadas' : 'Remover notificacao'}
        description={
          confirmDelete.ids.length > 1
            ? `${confirmDelete.ids.length} notificacao(oes) serao removidas da fila da academia.`
            : 'A notificacao sera removida e nao aparecera mais nesta fila.'
        }
        actions={(
          <>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete({ open: false, ids: [] })} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="button" variant="danger" onClick={() => deleteNotifications(confirmDelete.ids)} disabled={submitting}>
              <Trash2 className="h-4 w-4" />
              Confirmar remocao
            </Button>
          </>
        )}
      >
        <div className="space-y-3 text-sm text-[var(--text-secondary)]">
          <p>
            Use esta acao quando a notificacao ja nao fizer sentido operacional. A remocao respeita o escopo da academia atual.
          </p>
          {confirmDelete.ids.length > 1 ? (
            <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-4 py-3 text-[var(--text-muted)]">
              Itens selecionados: {confirmDelete.ids.length}
            </div>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
