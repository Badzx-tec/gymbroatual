import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { toast } from 'sonner';
import { Bell, Mail, Check, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try { setNotifications(await api.listNotifications(100)); } catch {}
    setLoading(false);
  };

  const checkExpiring = async () => {
    setChecking(true);
    try {
      const result = await api.checkExpiring();
      toast.success(result.message);
      loadData();
    } catch (err) { toast.error(err.message); }
    setChecking(false);
  };

  const markRead = async (id) => {
    try { await api.markRead(id); loadData(); } catch {}
  };

  const deleteNotif = async (id) => {
    try { await api.deleteNotification(id); toast.success('Removida'); loadData(); } catch {}
  };

  const unread = notifications.filter(n => !n.lida).length;

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div data-testid="notifications-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Notificacoes</h1>
          <p className="text-zinc-400 mt-1">{unread} nao lidas de {notifications.length} total</p>
        </div>
        <button data-testid="check-expiring-btn" onClick={checkExpiring} disabled={checking}
          className="flex items-center gap-2 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-6 py-2.5 rounded-sm hover:bg-[#b3e600] transition-all disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} /> Verificar Vencimentos
        </button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-4 flex items-start gap-3">
        <Mail className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm text-blue-300 font-medium">Emails Simulados</p>
          <p className="text-xs text-blue-400/70 mt-1">Os emails de notificacao estao sendo simulados. Quando um aluno esta proximo do vencimento, o sistema registra a notificacao e marca como "enviado (simulado)". Conecte um provedor de email real para enviar notificacoes reais.</p>
        </div>
      </div>

      <div className="space-y-3">
        {notifications.map((n, i) => (
          <motion.div key={n.notif_id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
            data-testid={`notification-${n.notif_id}`}
            className={`bg-zinc-900 border rounded-md p-4 flex items-start gap-4 transition-colors ${n.lida ? 'border-zinc-800/50 opacity-60' : 'border-zinc-700'}`}>
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center shrink-0 ${n.tipo === 'vencimento' ? 'bg-yellow-500/10' : 'bg-blue-500/10'}`}>
              <AlertTriangle className={`w-5 h-5 ${n.tipo === 'vencimento' ? 'text-yellow-500' : 'text-blue-500'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-sm font-semibold">{n.titulo}</h4>
                {!n.lida && <span className="w-2 h-2 rounded-full bg-[#ccff00]" />}
              </div>
              <p className="text-sm text-zinc-400 mb-2">{n.mensagem}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                {n.email_enviado && (
                  <span className="flex items-center gap-1 bg-green-500/10 text-green-400 px-2 py-0.5 rounded-sm border border-green-500/20">
                    <Mail className="w-3 h-3" /> {n.email_status}
                  </span>
                )}
                <span>Para: {n.student_email}</span>
                <span>{n.created_at ? new Date(n.created_at).toLocaleString('pt-BR') : ''}</span>
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              {!n.lida && (
                <button data-testid={`mark-read-${n.notif_id}`} onClick={() => markRead(n.notif_id)}
                  className="p-2 hover:bg-zinc-800 rounded-sm text-zinc-400 hover:text-green-500" title="Marcar como lida">
                  <Check className="w-4 h-4" />
                </button>
              )}
              <button data-testid={`delete-notif-${n.notif_id}`} onClick={() => deleteNotif(n.notif_id)}
                className="p-2 hover:bg-red-500/10 rounded-sm text-zinc-400 hover:text-red-500" title="Remover">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        ))}
        {notifications.length === 0 && (
          <div className="text-center py-16">
            <Bell className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500 text-lg">Nenhuma notificacao</p>
            <p className="text-zinc-600 text-sm mt-1">Clique em "Verificar Vencimentos" para checar alunos com assinatura proxima do vencimento</p>
          </div>
        )}
      </div>
    </div>
  );
}
