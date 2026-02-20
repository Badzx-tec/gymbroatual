import React, { useState, useEffect } from 'react';
import { api, connectWebSocket } from '../api';
import { Users, UserCheck, UserX, DollarSign, ScanLine, TrendingUp, Activity, FileSpreadsheet, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { toast } from 'sonner';

const CHART_COLORS = ['#ccff00', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444'];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [realtimeLogs, setRealtimeLogs] = useState([]);

  useEffect(() => {
    loadData();
    const cleanup = connectWebSocket((msg) => {
      if (msg.type === 'access') {
        setRealtimeLogs(prev => [msg.data, ...prev].slice(0, 10));
        loadData();
      }
    });
    return cleanup;
  }, []);

  const loadData = async () => {
    try {
      const [d, c] = await Promise.all([api.dashboard(), api.dashboardCharts()]);
      setStats(d);
      setCharts(c);
    } catch {
      try { await api.seed(); const [d, c] = await Promise.all([api.dashboard(), api.dashboardCharts()]); setStats(d); setCharts(c); } catch {}
    }
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" /></div>;

  const kpis = [
    { icon: Users, label: 'Total Alunos', value: stats?.total_alunos || 0, color: '#ccff00' },
    { icon: UserCheck, label: 'Ativos', value: stats?.alunos_ativos || 0, color: '#22c55e' },
    { icon: UserX, label: 'Inativos', value: stats?.alunos_inativos || 0, color: '#ef4444' },
    { icon: DollarSign, label: 'Faturamento', value: `R$ ${(stats?.faturamento_mensal || 0).toFixed(2).replace('.', ',')}`, color: '#3b82f6' },
    { icon: ScanLine, label: 'Acessos Hoje', value: stats?.acessos_hoje || 0, color: '#a855f7' },
    { icon: Activity, label: 'Na Academia', value: stats?.ocupacao_atual || 0, color: '#f59e0b' },
  ];

  const allLogs = realtimeLogs.length > 0 ? realtimeLogs : (stats?.ultimos_acessos || []);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-sm px-3 py-2 text-xs">
        <p className="text-zinc-300 mb-1">{label}</p>
        {payload.map((p, i) => <p key={i} style={{ color: p.color || '#ccff00' }}>{p.name}: {typeof p.value === 'number' ? p.value.toLocaleString('pt-BR') : p.value}</p>)}
      </div>
    );
  };

  return (
    <div data-testid="dashboard-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Dashboard</h1>
          <p className="text-zinc-400 mt-1">Visao geral da sua academia</p>
        </div>
        <div className="flex gap-2">
          <button data-testid="export-financial-btn" onClick={() => { api.exportFinancialExcel(); toast.success('Exportando financeiro...'); }}
            className="flex items-center gap-2 bg-zinc-800 text-white text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded-sm hover:bg-zinc-700 transition-colors">
            <FileSpreadsheet className="w-4 h-4 text-green-500" /> Financeiro
          </button>
          <button data-testid="export-students-pdf-btn" onClick={() => { api.exportStudentsPdf(); toast.success('Exportando PDF...'); }}
            className="flex items-center gap-2 bg-zinc-800 text-white text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded-sm hover:bg-zinc-700 transition-colors">
            <FileText className="w-4 h-4 text-red-400" /> Alunos PDF
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
        {kpis.map((kpi, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            data-testid={`kpi-card-${i}`}
            className="bg-zinc-900 border border-zinc-800 rounded-md p-4 hover:border-zinc-700 transition-colors">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{kpi.label}</span>
              <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
            </div>
            <p className="text-xl md:text-2xl font-bold">{kpi.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Revenue by Plan */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5 lg:col-span-1">
          <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4">Receita por Plano</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={charts?.receita_por_plano || []} dataKey="valor" nameKey="plano" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3}>
                  {(charts?.receita_por_plano || []).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {(charts?.receita_por_plano || []).map((r, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-zinc-400">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                {r.plano}
              </div>
            ))}
          </div>
        </div>

        {/* Access by Hour */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5 lg:col-span-2">
          <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4">Acessos por Hora (24h)</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts?.acessos_por_hora || []}>
                <defs>
                  <linearGradient id="colorAccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ccff00" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ccff00" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="hora" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="acessos" stroke="#ccff00" fill="url(#colorAccess)" strokeWidth={2} name="Acessos" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Monthly Revenue */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4">Receita Mensal (6 meses)</h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts?.receita_mensal || []}>
              <XAxis dataKey="mes" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="valor" fill="#ccff00" radius={[4, 4, 0, 0]} name="Receita (R$)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Access Logs (Real-time) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md">
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="font-heading text-lg font-semibold uppercase">Ultimos Acessos</h3>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Tempo Real</span>
          </div>
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
              {allLogs.map((log, i) => (
                <tr key={log.log_id || i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                  <td className="px-5 py-3 font-medium">{log.student_name}</td>
                  <td className="px-5 py-3"><span className="text-xs uppercase tracking-wider bg-zinc-800 px-2 py-1 rounded-sm">{log.tipo}</span></td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-sm border ${log.autorizado ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${log.autorizado ? 'bg-green-500' : 'bg-red-500'}`} />
                      {log.autorizado ? 'Liberado' : 'Negado'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-zinc-400">{log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : '-'}</td>
                </tr>
              ))}
              {allLogs.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-zinc-500">Nenhum acesso registrado</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
