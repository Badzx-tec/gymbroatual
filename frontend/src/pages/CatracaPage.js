import React, { useState, useEffect } from 'react';
import { api, connectWebSocket } from '../api';
import { toast } from 'sonner';
import { Wifi, WifiOff, DoorOpen, DoorClosed, Lock, MessageSquare, Send, RotateCcw, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

export default function CatracaPage() {
  const [academies, setAcademies] = useState([]);
  const [selectedAcademy, setSelectedAcademy] = useState('');
  const [commands, setCommands] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState('');
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    loadData();
    const cleanup = connectWebSocket((msg) => {
      setWsConnected(true);
      if (msg.type === 'catraca_command') {
        loadCommands();
      }
    });
    setWsConnected(true);
    return cleanup;
  }, []);

  const loadData = async () => {
    try {
      const [acads, cmds] = await Promise.all([api.listAcademies(), api.catracaCommands()]);
      setAcademies(acads);
      setCommands(cmds);
      if (acads.length > 0 && !selectedAcademy) setSelectedAcademy(acads[0].academy_id);
    } catch {}
    setLoading(false);
  };

  const loadCommands = async () => {
    try { setCommands(await api.catracaCommands()); } catch {}
  };

  const sendCommand = async (action) => {
    setSending(action);
    try {
      await api.catracaCommand({ action, message: message || '', academy_id: selectedAcademy });
      toast.success(`Comando "${action}" enviado!`);
      setMessage('');
      loadCommands();
    } catch (err) { toast.error(err.message); }
    setSending('');
  };

  const selectedAcad = academies.find(a => a.academy_id === selectedAcademy);

  const actions = [
    { id: 'release_entry', icon: DoorOpen, label: 'Liberar Entrada', desc: 'Libera um giro na direcao de entrada', color: '#22c55e' },
    { id: 'release_exit', icon: DoorClosed, label: 'Liberar Saida', desc: 'Libera um giro na direcao de saida', color: '#3b82f6' },
    { id: 'block', icon: Lock, label: 'Bloquear', desc: 'Bloqueia a catraca em ambas direcoes', color: '#ef4444' },
    { id: 'message', icon: MessageSquare, label: 'Enviar Mensagem', desc: 'Exibe mensagem no display da catraca', color: '#f59e0b' },
  ];

  const statusColors = {
    pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    delivered: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    executed: 'bg-green-500/10 text-green-500 border-green-500/20',
    error: 'bg-red-500/10 text-red-500 border-red-500/20',
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div data-testid="catraca-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Controle da Catraca</h1>
          <p className="text-zinc-400 mt-1">Gerencie a catraca remotamente</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-sm border text-xs font-semibold uppercase tracking-wider ${wsConnected ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
            {wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {wsConnected ? 'Conectado' : 'Desconectado'}
          </div>
          <button onClick={loadCommands} className="p-2 bg-zinc-800 rounded-sm hover:bg-zinc-700 transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Academy Selector */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
        <label className="text-sm font-medium text-zinc-400 mb-2 block">Selecionar Unidade</label>
        <select data-testid="catraca-academy-select" value={selectedAcademy} onChange={e => setSelectedAcademy(e.target.value)}
          className="w-full sm:w-auto bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#ccff00]">
          {academies.map(a => <option key={a.academy_id} value={a.academy_id}>{a.nome} ({a.catraca_ip}:{a.catraca_port})</option>)}
        </select>
        {selectedAcad && (
          <p className="text-xs text-zinc-500 mt-2">Catraca: {selectedAcad.catraca_ip}:{selectedAcad.catraca_port}</p>
        )}
      </div>

      {/* Control Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {actions.map((a, i) => (
          <motion.button key={a.id} data-testid={`catraca-${a.id}-btn`}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            onClick={() => sendCommand(a.id)} disabled={!!sending}
            className="bg-zinc-900 border border-zinc-800 rounded-md p-5 text-left hover:border-zinc-700 transition-all group disabled:opacity-50">
            <div className="w-10 h-10 rounded-sm flex items-center justify-center mb-3" style={{ background: `${a.color}15` }}>
              <a.icon className="w-5 h-5" style={{ color: a.color }} />
            </div>
            <h3 className="font-heading text-lg font-semibold uppercase mb-1">{a.label}</h3>
            <p className="text-zinc-500 text-xs">{a.desc}</p>
            {sending === a.id && <p className="text-[#ccff00] text-xs mt-2 animate-pulse">Enviando...</p>}
          </motion.button>
        ))}
      </div>

      {/* Message Input */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-3">Mensagem para o Display</h3>
        <div className="flex gap-3">
          <input data-testid="catraca-message-input" value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Texto (max 16 caracteres)" maxLength={16}
            className="flex-1 bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm font-mono" />
          <button data-testid="catraca-send-message-btn" onClick={() => sendCommand('message')} disabled={!message || !!sending}
            className="flex items-center gap-2 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-6 rounded-sm hover:bg-[#b3e600] disabled:opacity-50">
            <Send className="w-4 h-4" /> Enviar
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-2">O display da Toletus LiteNet2 suporta ate 16 caracteres ASCII</p>
      </div>

      {/* Command History */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md">
        <div className="p-5 border-b border-zinc-800">
          <h3 className="font-heading text-lg font-semibold uppercase">Historico de Comandos</h3>
        </div>
        <div className="overflow-x-auto">
          <table data-testid="catraca-commands-table" className="w-full text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
                <th className="text-left px-5 py-3 font-medium">Acao</th>
                <th className="text-left px-5 py-3 font-medium">Mensagem</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {commands.map((cmd, i) => (
                <tr key={cmd.cmd_id || i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                  <td className="px-5 py-3 font-medium capitalize">{cmd.action?.replace('_', ' ')}</td>
                  <td className="px-5 py-3 text-zinc-400 font-mono text-xs">{cmd.message || '-'}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${statusColors[cmd.status] || statusColors.pending}`}>
                      <Clock className="w-3 h-3" /> {cmd.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-zinc-400 text-xs">{cmd.created_at ? new Date(cmd.created_at).toLocaleString('pt-BR') : '-'}</td>
                </tr>
              ))}
              {commands.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-zinc-500">Nenhum comando enviado</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
