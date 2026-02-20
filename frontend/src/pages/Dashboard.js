import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Users, UserCheck, UserX, DollarSign, ScanLine, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await api.dashboard();
      setStats(data);
    } catch {
      // Seed data if empty
      try {
        await api.seed();
        const data = await api.dashboard();
        setStats(data);
      } catch {}
    }
    setLoading(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const kpis = [
    { icon: Users, label: 'Total Alunos', value: stats?.total_alunos || 0, color: '#ccff00' },
    { icon: UserCheck, label: 'Ativos', value: stats?.alunos_ativos || 0, color: '#22c55e' },
    { icon: UserX, label: 'Inativos', value: stats?.alunos_inativos || 0, color: '#ef4444' },
    { icon: DollarSign, label: 'Faturamento', value: `R$ ${(stats?.faturamento_mensal || 0).toFixed(2).replace('.', ',')}`, color: '#3b82f6' },
    { icon: ScanLine, label: 'Acessos Hoje', value: stats?.acessos_hoje || 0, color: '#a855f7' },
    { icon: TrendingUp, label: 'Planos Ativos', value: stats?.total_planos || 0, color: '#f59e0b' },
  ];

  return (
    <div data-testid="dashboard-page" className="space-y-8">
      <div>
        <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Dashboard</h1>
        <p className="text-zinc-400 mt-1">Visao geral da sua academia</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {kpis.map((kpi, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            data-testid={`kpi-card-${i}`}
            className="bg-zinc-900 border border-zinc-800 rounded-md p-5 hover:border-zinc-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium uppercase tracking-wide text-zinc-400">{kpi.label}</span>
              <kpi.icon className="w-5 h-5" style={{ color: kpi.color }} />
            </div>
            <p className="text-2xl md:text-3xl font-bold">{kpi.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Recent Access Logs */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md">
        <div className="p-5 border-b border-zinc-800">
          <h3 className="font-heading text-lg font-semibold uppercase">Ultimos Acessos</h3>
        </div>
        <div className="overflow-x-auto">
          <table data-testid="recent-access-table" className="w-full text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
                <th className="text-left px-5 py-3 font-medium">Aluno</th>
                <th className="text-left px-5 py-3 font-medium">Tipo</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Horario</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.ultimos_acessos || []).map((log, i) => (
                <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                  <td className="px-5 py-3 font-medium">{log.student_name}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs uppercase tracking-wider bg-zinc-800 px-2 py-1 rounded-sm">{log.tipo}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-sm border ${log.autorizado ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${log.autorizado ? 'bg-green-500' : 'bg-red-500'}`} />
                      {log.autorizado ? 'Liberado' : 'Negado'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-zinc-400">
                    {log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : '-'}
                  </td>
                </tr>
              ))}
              {(!stats?.ultimos_acessos || stats.ultimos_acessos.length === 0) && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-zinc-500">Nenhum acesso registrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
