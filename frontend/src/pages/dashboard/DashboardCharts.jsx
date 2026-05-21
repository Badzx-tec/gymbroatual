import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';

const CHART_COLORS = ['var(--brand-primary)', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444'];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-soft)] px-3 py-2 text-xs shadow-[var(--shadow-soft)]">
      <p className="mb-1 text-[var(--text-primary)]">{label}</p>
      {payload.map((item, index) => (
        <p key={`${item?.name || 'item'}-${index}`} style={{ color: item.color || 'var(--brand-primary)' }}>
          {item.name}: {typeof item.value === 'number' ? item.value.toLocaleString('pt-BR') : item.value}
        </p>
      ))}
    </div>
  );
}

/**
 * Visually-hidden data table for screen readers. WCAG 1.1.1 + 1.3.1.
 * Renders the same data as the chart in a structured, navigable form.
 */
function AccessibleChartTable({ caption, columns, rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>{columns.map((col) => <th key={col} scope="col">{col}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx}>
            {row.map((cell, cellIdx) => (
              <td key={cellIdx}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Lazy-loaded chart panels for the Dashboard.
 * Keeping Recharts in a separate chunk reduces the initial bundle by ~45 KB.
 * Each chart is paired with a visually-hidden <table> so screen readers can
 * navigate the underlying data.
 */
export default function DashboardCharts({ charts = {}, canSeeFinancial = false }) {
  const receitaPlano = charts?.receita_por_plano || [];
  const acessosHora = charts?.acessos_por_hora || [];
  const receitaMensal = charts?.receita_mensal || [];

  return (
    <>
      <div className={`grid grid-cols-1 ${canSeeFinancial ? 'lg:grid-cols-3' : ''} gap-4 md:gap-6`}>
        {canSeeFinancial ? (
          <figure
            role="figure"
            aria-label="Receita por plano: distribuicao de receita entre planos contratados"
            className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-5 shadow-[var(--shadow-soft)] lg:col-span-1"
          >
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
              Receita por Plano
            </h3>
            {receitaPlano.length > 0 ? (
              <>
                <div className="h-52" aria-hidden="true">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={receitaPlano}
                        dataKey="valor"
                        nameKey="plano"
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={3}
                      >
                        {receitaPlano.map((_, index) => (
                          <Cell key={`slice-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-3 mt-2">
                  {receitaPlano.map((item, index) => (
                    <div key={`${item.plano}-${index}`} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                        aria-hidden="true"
                      />
                      {item.plano}
                    </div>
                  ))}
                </div>
                <AccessibleChartTable
                  caption="Receita por plano em reais"
                  columns={['Plano', 'Valor (R$)']}
                  rows={receitaPlano.map((item) => [
                    item.plano,
                    Number(item.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                  ])}
                />
              </>
            ) : (
              <div className="h-52 flex items-center justify-center text-[var(--text-muted)] text-sm">
                Sem dados de receita por plano.
              </div>
            )}
          </figure>
        ) : null}

        <figure
          role="figure"
          aria-label="Acessos por hora nas ultimas 24 horas"
          className={`rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-5 shadow-[var(--shadow-soft)] ${canSeeFinancial ? 'lg:col-span-2' : ''}`}
        >
          <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
            Acessos por Hora (24h)
          </h3>
          <div className="h-52" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={acessosHora}>
                <defs>
                  <linearGradient id="colorAccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--brand-primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--brand-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="hora" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="acessos" stroke="var(--brand-primary)" fill="url(#colorAccess)" strokeWidth={2} name="Acessos" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <AccessibleChartTable
            caption="Acessos por hora"
            columns={['Hora', 'Acessos']}
            rows={acessosHora.map((item) => [item.hora, String(item.acessos ?? 0)])}
          />
        </figure>
      </div>

      {canSeeFinancial ? (
        <figure
          role="figure"
          aria-label="Receita mensal dos ultimos 6 meses"
          className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-5 shadow-[var(--shadow-soft)]"
        >
          <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
            Receita Mensal (6 meses)
          </h3>
          <div className="h-52" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={receitaMensal}>
                <XAxis dataKey="mes" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="valor" fill="var(--brand-primary)" radius={[4, 4, 0, 0]} name="Receita (R$)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <AccessibleChartTable
            caption="Receita mensal em reais"
            columns={['Mes', 'Receita']}
            rows={receitaMensal.map((item) => [
              item.mes,
              Number(item.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
            ])}
          />
        </figure>
      ) : null}
    </>
  );
}
