import React, { useState, useEffect } from 'react';
import { api, connectWebSocket } from '../api';
import { ScanLine, CheckCircle, XCircle, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

const toDate = (log) => {
  const value = log?.timestamp || log?.created_at || null;
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const isToday = (date) => {
  if (!date) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
};

const dailyOnly = (items) =>
  (items || []).filter((log) => isToday(toDate(log)));

export default function AccessLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const cleanup = connectWebSocket((msg) => {
      if (msg.type === 'access') {
        setLogs((prev) => dailyOnly([msg.data, ...prev]).slice(0, 100));
      }
    });
    const keepTodayOnly = setInterval(() => {
      setLogs((prev) => dailyOnly(prev));
    }, 60 * 1000);

    return () => {
      cleanup();
      clearInterval(keepTodayOnly);
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.listAccessLogs(300);
      setLogs(dailyOnly(data).slice(0, 100));
    } catch {}
    setLoading(false);
  };

  return (
    <div data-testid="access-logs-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Registro de Acessos</h1>
          <p className="text-zinc-400 mt-1">Somente acessos de hoje - atualizacao em tempo real</p>
        </div>
        <div className="flex gap-2">
          <button data-testid="export-access-excel-btn" onClick={() => { api.exportAccessExcel(); toast.success('Exportando...'); }}
            className="flex items-center gap-2 bg-zinc-800 text-white text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded-sm hover:bg-zinc-700">
            <FileSpreadsheet className="w-4 h-4 text-green-500" /> Excel
          </button>
          <button data-testid="refresh-logs-btn" onClick={loadData}
            className="flex items-center gap-2 bg-zinc-800 text-white font-semibold uppercase tracking-wide text-sm px-6 py-2.5 rounded-sm hover:bg-zinc-700">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium uppercase tracking-wide text-zinc-400">Total</span>
            <ScanLine className="w-5 h-5 text-zinc-400" />
          </div>
          <p className="text-2xl font-bold mt-2">{logs.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium uppercase tracking-wide text-zinc-400">Liberados</span>
            <CheckCircle className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-2xl font-bold mt-2 text-green-500">{logs.filter(l => l.autorizado).length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium uppercase tracking-wide text-zinc-400">Negados</span>
            <XCircle className="w-5 h-5 text-red-500" />
          </div>
          <p className="text-2xl font-bold mt-2 text-red-500">{logs.filter(l => !l.autorizado).length}</p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
        <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Atualizacao em Tempo Real via WebSocket</span>
        </div>
        <table data-testid="access-logs-table" className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
              <th className="text-left px-5 py-3 font-medium">Horario</th>
              <th className="text-left px-5 py-3 font-medium">Aluno</th>
              <th className="text-left px-5 py-3 font-medium">Tag/ID</th>
              <th className="text-left px-5 py-3 font-medium">Tipo</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <motion.tr key={log.log_id || i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                <td className="px-5 py-3 text-zinc-300 whitespace-nowrap">{log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : '-'}</td>
                <td className="px-5 py-3 font-medium">{log.student_name || 'Desconhecido'}</td>
                <td className="px-5 py-3 text-zinc-400 font-mono text-xs">{log.tag_id}</td>
                <td className="px-5 py-3"><span className="text-xs uppercase tracking-wider bg-zinc-800 px-2 py-1 rounded-sm">{log.tipo}</span></td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-sm border ${log.autorizado ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${log.autorizado ? 'bg-green-500' : 'bg-red-500'}`} />
                    {log.autorizado ? 'Liberado' : 'Negado'}
                  </span>
                </td>
                <td className="px-5 py-3 text-zinc-400">{log.motivo}</td>
              </motion.tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-zinc-500">Nenhum registro de acesso</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
