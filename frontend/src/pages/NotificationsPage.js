import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, Check, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

import { api } from '../api';
import Banner from '../components/ui/Banner';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SectionCard from '../components/ui/SectionCard';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';

function notificationTone(type) {
  return String(type || '').toLowerCase() === 'vencimento' ? 'warning' : 'info';
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const loadData = async () => {
    try {
      setNotifications(await api.listNotifications(100));
    } catch (err) {
      toast.error(err?.message || 'Falha ao carregar notificacoes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const checkExpiring = async () => {
    setChecking(true);
    try {
      const result = await api.checkExpiring();
      toast.success(result.message || 'Verificacao concluida.');
      await loadData();
    } catch (err) {
      toast.error(err?.message || 'Falha ao verificar vencimentos.');
    } finally {
      setChecking(false);
    }
  };

  const markRead = async (id) => {
    try {
      await api.markRead(id);
      await loadData();
    } catch (err) {
      toast.error(err?.message || 'Falha ao marcar notificacao.');
    }
  };

  const deleteNotif = async (id) => {
    try {
      await api.deleteNotification(id);
      toast.success('Notificacao removida.');
      await loadData();
    } catch (err) {
      toast.error(err?.message || 'Falha ao remover notificacao.');
    }
  };

  const unread = useMemo(() => notifications.filter((item) => !item.lida).length, [notifications]);
  const expiringCount = useMemo(
    () => notifications.filter((item) => String(item.tipo || '').toLowerCase() === 'vencimento').length,
    [notifications]
  );

  const filteredNotifications = useMemo(() => {
    return notifications.filter((item) => {
      const matchesFilter =
        filter === 'all'
        || (filter === 'unread' && !item.lida)
        || (filter === 'read' && item.lida)
        || (filter === 'expiring' && String(item.tipo || '').toLowerCase() === 'vencimento');
      const haystack = [item.titulo, item.mensagem, item.student_email, item.email_status, item.tipo]
        .join(' ')
        .toLowerCase();
      const matchesSearch = !search || haystack.includes(search.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [filter, notifications, search]);

  if (loading) {
    return <LoadingScreen label="Carregando notificacoes..." />;
  }

  return (
    <div data-testid="notifications-page" className="space-y-6">
      <PageHeader
        eyebrow="Sistema"
        title="Notificacoes"
        subtitle={`${unread} nao lida(s) de ${notifications.length} total. Use a busca para localizar comunicacoes por aluno, status ou tipo.`}
        actions={(
          <Button data-testid="check-expiring-btn" onClick={checkExpiring} disabled={checking} variant="primary" size="sm">
            <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
            Verificar vencimentos
          </Button>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Nao lidas" value={unread} icon={Bell} accent={unread ? 'warning' : 'default'} />
        <StatCard label="Vencimento" value={expiringCount} icon={AlertTriangle} accent={expiringCount ? 'warning' : 'default'} />
        <StatCard label="Enviadas por e-mail" value={notifications.filter((item) => item.email_enviado).length} icon={Mail} accent="info" />
        <StatCard label="Lidas" value={notifications.filter((item) => item.lida).length} icon={Check} accent="success" />
      </div>

      <Banner
        tone="info"
        title="Emails simulados"
        description='Os envios ainda estao em modo simulado. O sistema registra a notificacao e o status de envio, mas nao dispara e-mail real sem um provedor configurado.'
      />

      <SectionCard title="Busca e filtros" description="Filtre comunicacoes por estado de leitura, vencimento ou conteudo.">
        <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_auto]">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por titulo, mensagem, e-mail do aluno ou status"
            aria-label="Buscar notificacoes"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={filter === 'all' ? 'primary' : 'secondary'} onClick={() => setFilter('all')}>Todas</Button>
            <Button type="button" size="sm" variant={filter === 'unread' ? 'primary' : 'secondary'} onClick={() => setFilter('unread')}>Nao lidas</Button>
            <Button type="button" size="sm" variant={filter === 'read' ? 'primary' : 'secondary'} onClick={() => setFilter('read')}>Lidas</Button>
            <Button type="button" size="sm" variant={filter === 'expiring' ? 'primary' : 'secondary'} onClick={() => setFilter('expiring')}>Vencimento</Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Fila de notificacoes" description="Leitura operacional das mensagens geradas pelo sistema.">
        {filteredNotifications.length ? (
          <div className="space-y-3">
            {filteredNotifications.map((notification, index) => (
              <motion.article
                key={notification.notif_id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.03 }}
                data-testid={`notification-${notification.notif_id}`}
                className={`flex items-start gap-4 rounded-2xl border px-4 py-4 transition-colors ${notification.lida ? 'border-[var(--surface-border)] bg-[var(--surface-soft)]/50 opacity-80' : 'border-[var(--surface-border-strong)] bg-[var(--surface-canvas)]'}`}
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${notificationTone(notification.tipo) === 'warning' ? 'border-amber-500/30 bg-amber-500/10 text-amber-500' : 'border-sky-500/30 bg-sky-500/10 text-sky-500'}`}>
                  <AlertTriangle className="h-5 w-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">{notification.titulo}</h3>
                    <StatusBadge label={notification.lida ? 'Lida' : 'Pendente'} tone={notification.lida ? 'neutral' : 'warning'} size="sm" />
                    <StatusBadge label={String(notification.tipo || 'sistema')} tone={notificationTone(notification.tipo)} size="sm" />
                  </div>

                  <p className="mt-2 text-sm text-[var(--text-secondary)]">{notification.mensagem}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                    {notification.email_enviado ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-600">
                        <Mail className="h-3 w-3" />
                        {notification.email_status || 'Enviado'}
                      </span>
                    ) : null}
                    <span>Para: {notification.student_email || 'Sem e-mail'}</span>
                    <span>{notification.created_at ? new Date(notification.created_at).toLocaleString('pt-BR') : '-'}</span>
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  {!notification.lida ? (
                    <Button data-testid={`mark-read-${notification.notif_id}`} size="sm" variant="ghost" onClick={() => markRead(notification.notif_id)}>
                      <Check className="h-4 w-4" />
                      Marcar lida
                    </Button>
                  ) : null}
                  <Button data-testid={`delete-notif-${notification.notif_id}`} size="sm" variant="danger" onClick={() => deleteNotif(notification.notif_id)}>
                    <Trash2 className="h-4 w-4" />
                    Remover
                  </Button>
                </div>
              </motion.article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Bell}
            title="Nenhuma notificacao encontrada"
            description="Ajuste os filtros ou use a verificacao de vencimentos para gerar novas notificacoes operacionais."
            action={(
              <Button type="button" variant="secondary" onClick={checkExpiring} disabled={checking}>
                <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
                Verificar vencimentos
              </Button>
            )}
          />
        )}
      </SectionCard>
    </div>
  );
}
