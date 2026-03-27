import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Tag, Timer, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SelectField from '../components/ui/SelectField';
import SectionCard from '../components/ui/SectionCard';
import StatCard from '../components/ui/StatCard';
import TextField from '../components/ui/TextField';
import { getStoredUser } from '../lib/session';
import { formatDurationLabel } from './contracts/contractsUtils';

const emptyPlan = {
  nome: '',
  valor: '',
  duration_value: '',
  duration_unit: 'days',
  descricao: '',
  ativo: true,
};

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function PlanCard({ plan, onEdit, onDelete, canManagePlans }) {
  return (
    <article className="rounded-2xl border border-zinc-900 bg-zinc-950/72 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl border border-zinc-900 bg-zinc-900/70 p-2 text-[var(--brand-primary)]">
              <Tag className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">{plan.nome}</h3>
              <p className="text-xs text-zinc-500">{plan.descricao || 'Plano sem descricao operacional.'}</p>
            </div>
          </div>
        </div>
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${plan.ativo ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}>
          {plan.ativo ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-zinc-900 bg-zinc-900/60 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Valor</p>
          <p className="mt-2 text-lg font-semibold text-zinc-100">{formatMoney(plan.valor)}</p>
        </div>
        <div className="rounded-xl border border-zinc-900 bg-zinc-900/60 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Duracao</p>
          <p className="mt-2 text-lg font-semibold text-zinc-100">
            {formatDurationLabel(plan.duration_value, plan.duration_unit, plan.duracao_dias)}
          </p>
        </div>
      </div>

      {canManagePlans ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => onEdit(plan)}>
            Editar plano
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={() => onDelete(plan)}>
            Remover plano
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export default function PlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState(emptyPlan);
  const [editId, setEditId] = useState('');
  const [saving, setSaving] = useState(false);
  const user = React.useMemo(() => getStoredUser(), []);
  const role = String(user.role || '').toUpperCase();
  const canManagePlans = ['OWNER', 'MANAGER'].includes(role);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.listPlans();
      setPlans(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err?.message || 'Falha ao carregar planos.');
    } finally {
      setLoading(false);
    }
  };

  const filteredPlans = useMemo(() => {
    const term = search.trim().toLowerCase();
    return plans.filter((plan) => {
      const matchesSearch = !term || [plan.nome, plan.descricao]
        .map((item) => String(item || '').toLowerCase())
        .join(' ')
        .includes(term);
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? plan.ativo : !plan.ativo);
      return matchesSearch && matchesStatus;
    });
  }, [plans, search, statusFilter]);

  const summary = useMemo(() => {
    return plans.reduce((acc, plan) => {
      acc.total += 1;
      if (plan.ativo) acc.active += 1;
      acc.revenue += Number(plan.valor || 0);
      if (String(plan.duration_unit || '').toLowerCase() === 'months') {
        acc.monthBased += 1;
      } else {
        acc.dayBased += 1;
      }
      return acc;
    }, { total: 0, active: 0, revenue: 0, monthBased: 0, dayBased: 0 });
  }, [plans]);

  const openCreate = () => {
    if (!canManagePlans) {
      toast.error('Sem permissao para criar plano.');
      return;
    }
    setForm({ ...emptyPlan });
    setEditId('');
    setFormOpen(true);
  };

  const openEdit = (plan) => {
    if (!canManagePlans) {
      toast.error('Sem permissao para editar plano.');
      return;
    }
    setForm({
      nome: plan.nome,
      valor: String(plan.valor),
      duration_value: String(plan.duration_value || plan.duracao_dias || ''),
      duration_unit: plan.duration_unit || 'days',
      descricao: plan.descricao || '',
      ativo: plan.ativo,
    });
    setEditId(plan.plan_id);
    setFormOpen(true);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!canManagePlans) {
      toast.error('Sem permissao para salvar plano.');
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      valor: parseFloat(form.valor),
      duration_value: parseInt(form.duration_value, 10),
      duration_unit: form.duration_unit,
    };
    try {
      if (editId) {
        await api.updatePlan(editId, payload);
        toast.success('Plano atualizado.');
      } else {
        await api.createPlan(payload);
        toast.success('Plano criado.');
      }
      setFormOpen(false);
      setEditId('');
      await loadData();
    } catch (err) {
      toast.error(err?.message || 'Falha ao salvar plano.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await api.deletePlan(deleteTarget.plan_id);
      toast.success('Plano removido.');
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      toast.error(err?.message || 'Falha ao remover plano.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingScreen label="Carregando planos..." />;
  }

  return (
    <div className="space-y-6" data-testid="plans-page">
      <PageHeader
        eyebrow="Oferta comercial"
        title="Planos"
        subtitle="Organize o catalogo de planos, precificacao e duracao com uma superficie mais clara para operacao."
        actions={canManagePlans ? (
          <Button type="button" onClick={openCreate} variant="primary" size="sm">
            <Plus className="h-4 w-4" />
            Novo plano
          </Button>
        ) : null}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Planos" value={summary.total} hint={`${summary.active} ativos`} icon={Tag} accent="info" />
        <StatCard label="Preco acumulado" value={formatMoney(summary.revenue)} hint="Soma dos valores cadastrados" icon={Wallet} accent="success" />
        <StatCard label="Planos mensais" value={summary.monthBased} hint={`${summary.dayBased} com duracao em dias`} icon={Timer} accent="info" />
        <StatCard label="Visiveis no filtro" value={filteredPlans.length} hint="Resultados conforme busca e status" icon={Tag} accent="default" />
      </div>

      <SectionCard title="Catalogo" description="Busque planos por nome ou descricao e refine a exibicao por status.">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-xl">
            <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou descricao do plano" aria-label="Buscar plano" />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant={statusFilter === 'all' ? 'primary' : 'ghost'} size="sm" onClick={() => setStatusFilter('all')}>Todos</Button>
            <Button type="button" variant={statusFilter === 'active' ? 'primary' : 'ghost'} size="sm" onClick={() => setStatusFilter('active')}>Ativos</Button>
            <Button type="button" variant={statusFilter === 'inactive' ? 'primary' : 'ghost'} size="sm" onClick={() => setStatusFilter('inactive')}>Inativos</Button>
          </div>
        </div>
      </SectionCard>

      {filteredPlans.length ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {filteredPlans.map((plan) => (
            <PlanCard key={plan.plan_id} plan={plan} onEdit={openEdit} onDelete={setDeleteTarget} canManagePlans={canManagePlans} />
          ))}
        </div>
      ) : (
        <EmptyState title="Nenhum plano encontrado" description={canManagePlans ? 'Ajuste os filtros ou cadastre um novo plano.' : 'Ajuste os filtros para localizar outro plano.'} action={canManagePlans ? <Button type="button" variant="primary" onClick={openCreate}>Cadastrar plano</Button> : null} />
      )}

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editId ? 'Editar plano' : 'Novo plano'}
        description="Defina nome, valor, quantidade, unidade e disponibilidade comercial deste plano."
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button type="submit" form="plan-form" variant="primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar plano'}</Button>
          </>
        }
      >
        <form id="plan-form" onSubmit={handleSave} className="grid gap-4 md:grid-cols-2">
          <TextField label="Nome" value={form.nome} onChange={(event) => setForm((prev) => ({ ...prev, nome: event.target.value }))} required className="md:col-span-2" />
          <TextField label="Valor (R$)" type="number" step="0.01" value={form.valor} onChange={(event) => setForm((prev) => ({ ...prev, valor: event.target.value }))} required />
          <TextField label="Quantidade" type="number" min="1" value={form.duration_value} onChange={(event) => setForm((prev) => ({ ...prev, duration_value: event.target.value }))} required />
          <SelectField label="Unidade" value={form.duration_unit} onChange={(event) => setForm((prev) => ({ ...prev, duration_unit: event.target.value }))}>
            <option value="days">Dias</option>
            <option value="months">Meses</option>
          </SelectField>
          <div className="rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-300 md:col-span-2">
            Resumo: <span className="font-semibold text-zinc-100">{formatDurationLabel(form.duration_value, form.duration_unit)}</span>
          </div>
          <label className="block space-y-1.5 md:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Descricao</span>
            <textarea value={form.descricao} onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value }))} rows={4} className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]" />
          </label>
          <label className="flex items-start gap-3 rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-300 md:col-span-2">
            <input type="checkbox" className="mt-1 accent-[var(--brand-primary)]" checked={Boolean(form.ativo)} onChange={(event) => setForm((prev) => ({ ...prev, ativo: event.target.checked }))} />
            <span>Manter plano disponivel para novos contratos.</span>
          </label>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Remover plano"
        description="Confirme a exclusao apenas se esse plano nao for mais usado pela operacao."
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={saving}>Voltar</Button>
            <Button type="button" variant="danger" onClick={handleDelete} disabled={saving}>{saving ? 'Removendo...' : 'Remover plano'}</Button>
          </>
        }
      >
        <p className="text-sm text-zinc-400">Plano selecionado: <span className="text-zinc-100">{deleteTarget?.nome || '-'}</span></p>
      </Dialog>
    </div>
  );
}
