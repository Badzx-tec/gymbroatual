import React, { useEffect, useMemo, useState } from 'react';
import { Building2, DollarSign, MapPin, Plus, Router, Users } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SectionCard from '../components/ui/SectionCard';
import StatCard from '../components/ui/StatCard';
import TextField from '../components/ui/TextField';

const emptyAcademy = {
  nome: '',
  endereco: '',
  telefone: '',
  cnpj: '',
  email: '',
  catraca_ip: '192.168.1.9',
  catraca_port: 7878,
  ativo: true,
};

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function AcademyCard({ academy, stats, onEdit, onDelete }) {
  return (
    <article className="rounded-2xl border border-zinc-900 bg-zinc-950/72 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl border border-zinc-900 bg-zinc-900/70 p-2 text-[var(--brand-primary)]">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">{academy.nome}</h3>
              <p className="text-xs text-zinc-500">{academy.email || 'Sem email cadastrado'}</p>
            </div>
          </div>
          {academy.endereco ? (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-400">
              <MapPin className="h-4 w-4" />
              {academy.endereco}
            </p>
          ) : null}
        </div>
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${academy.ativo ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}>
          {academy.ativo ? 'Ativa' : 'Inativa'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <MiniMetric icon={Users} label="Alunos" value={stats.total_alunos || 0} />
        <MiniMetric icon={Users} label="Ativos" value={stats.alunos_ativos || 0} accent="success" />
        <MiniMetric icon={DollarSign} label="Faturamento" value={formatMoney(stats.faturamento || 0)} accent="info" />
      </div>

      <div className="mt-4 grid gap-2 text-sm text-zinc-400">
        <p>Telefone: {academy.telefone || '-'}</p>
        <p>CNPJ: {academy.cnpj || '-'}</p>
        <p className="inline-flex items-center gap-2"><Router className="h-4 w-4" /> Catraca: {academy.catraca_ip}:{academy.catraca_port}</p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => onEdit(academy)}>
          Editar unidade
        </Button>
        <Button type="button" variant="danger" size="sm" onClick={() => onDelete(academy)}>
          Remover unidade
        </Button>
      </div>
    </article>
  );
}

function MiniMetric({ icon: Icon, label, value, accent = 'default' }) {
  const colorClass = accent === 'success' ? 'text-emerald-300' : accent === 'info' ? 'text-sky-300' : 'text-zinc-100';
  return (
    <div className="rounded-xl border border-zinc-900 bg-zinc-900/60 px-3 py-3 text-center">
      <Icon className="mx-auto h-4 w-4 text-zinc-500" />
      <p className={`mt-2 text-sm font-semibold ${colorClass}`}>{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-zinc-500">{label}</p>
    </div>
  );
}

export default function AcademiesPage() {
  const [academies, setAcademies] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState(emptyAcademy);
  const [editId, setEditId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const acads = await api.listAcademies();
      setAcademies(Array.isArray(acads) ? acads : []);
      const statsMap = {};
      await Promise.all(
        (Array.isArray(acads) ? acads : []).map(async (academy) => {
          try {
            statsMap[academy.academy_id] = await api.academyStats(academy.academy_id);
          } catch {
            statsMap[academy.academy_id] = { total_alunos: 0, alunos_ativos: 0, faturamento: 0 };
          }
        })
      );
      setStats(statsMap);
    } catch (err) {
      toast.error(err?.message || 'Falha ao carregar unidades.');
    } finally {
      setLoading(false);
    }
  };

  const filteredAcademies = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return academies;
    return academies.filter((academy) => (
      [academy.nome, academy.email, academy.endereco, academy.cnpj, academy.catraca_ip]
        .map((item) => String(item || '').toLowerCase())
        .join(' ')
        .includes(term)
    ));
  }, [academies, search]);

  const totals = useMemo(() => {
    return academies.reduce((acc, academy) => {
      const item = stats[academy.academy_id] || {};
      acc.units += 1;
      if (academy.ativo) acc.activeUnits += 1;
      acc.students += Number(item.total_alunos || 0);
      acc.revenue += Number(item.faturamento || 0);
      return acc;
    }, { units: 0, activeUnits: 0, students: 0, revenue: 0 });
  }, [academies, stats]);

  const openCreate = () => {
    setForm({ ...emptyAcademy });
    setEditId('');
    setFormOpen(true);
  };

  const openEdit = (academy) => {
    setForm({
      nome: academy.nome,
      endereco: academy.endereco || '',
      telefone: academy.telefone || '',
      cnpj: academy.cnpj || '',
      email: academy.email || '',
      catraca_ip: academy.catraca_ip || '192.168.1.9',
      catraca_port: academy.catraca_port || 7878,
      ativo: academy.ativo,
    });
    setEditId(academy.academy_id);
    setFormOpen(true);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    const payload = { ...form, catraca_port: parseInt(form.catraca_port, 10) };
    try {
      if (editId) {
        await api.updateAcademy(editId, payload);
        toast.success('Unidade atualizada.');
      } else {
        await api.createAcademy(payload);
        toast.success('Unidade criada.');
      }
      setFormOpen(false);
      setEditId('');
      await loadData();
    } catch (err) {
      toast.error(err?.message || 'Falha ao salvar unidade.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await api.deleteAcademy(deleteTarget.academy_id);
      toast.success('Unidade removida.');
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      toast.error(err?.message || 'Falha ao remover unidade.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingScreen label="Carregando unidades..." />;
  }

  return (
    <div className="space-y-6" data-testid="academies-page">
      <PageHeader
        eyebrow="Estrutura"
        title="Unidades"
        subtitle="Cadastre franquias, acompanhe volume de alunos e mantenha o endpoint da catraca organizado."
        actions={
          <Button type="button" onClick={openCreate} variant="primary" size="sm">
            <Plus className="h-4 w-4" />
            Nova unidade
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Unidades" value={totals.units} hint={`${totals.activeUnits} ativas`} icon={Building2} accent="info" />
        <StatCard label="Alunos" value={totals.students} hint="Soma das unidades cadastradas" icon={Users} accent="success" />
        <StatCard label="Faturamento" value={formatMoney(totals.revenue)} hint="Estimativa agregada por unidade" icon={DollarSign} accent="info" />
        <StatCard label="Busca atual" value={filteredAcademies.length} hint="Resultados da pesquisa acima" icon={MapPin} accent="default" />
      </div>

      <SectionCard title="Mapa de unidades" description="Use a busca para localizar rapidamente uma franquia por nome, endereco ou infraestrutura.">
        <div className="max-w-xl">
          <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, email, endereco, CNPJ ou IP da catraca" aria-label="Buscar unidade" />
        </div>
      </SectionCard>

      {filteredAcademies.length ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {filteredAcademies.map((academy) => (
            <AcademyCard
              key={academy.academy_id}
              academy={academy}
              stats={stats[academy.academy_id] || {}}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="Nenhuma unidade encontrada" description="Ajuste a busca ou cadastre a primeira unidade da rede." action={<Button type="button" variant="primary" onClick={openCreate}>Cadastrar unidade</Button>} />
      )}

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editId ? 'Editar unidade' : 'Nova unidade'}
        description="Mantenha os dados operacionais e o endpoint da catraca organizados por unidade."
        size="lg"
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button type="submit" form="academy-form" variant="primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar unidade'}</Button>
          </>
        }
      >
        <form id="academy-form" onSubmit={handleSave} className="grid gap-4 md:grid-cols-2">
          <TextField label="Nome" value={form.nome} onChange={(event) => setForm((prev) => ({ ...prev, nome: event.target.value }))} required className="md:col-span-2" />
          <TextField label="Email" type="email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
          <TextField label="Telefone" value={form.telefone} onChange={(event) => setForm((prev) => ({ ...prev, telefone: event.target.value }))} />
          <TextField label="CNPJ" value={form.cnpj} onChange={(event) => setForm((prev) => ({ ...prev, cnpj: event.target.value }))} />
          <TextField label="Endereco" value={form.endereco} onChange={(event) => setForm((prev) => ({ ...prev, endereco: event.target.value }))} className="md:col-span-2" />
          <TextField label="IP da catraca" value={form.catraca_ip} onChange={(event) => setForm((prev) => ({ ...prev, catraca_ip: event.target.value }))} />
          <TextField label="Porta da catraca" type="number" value={form.catraca_port} onChange={(event) => setForm((prev) => ({ ...prev, catraca_port: event.target.value }))} />
          <label className="flex items-start gap-3 rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-300 md:col-span-2">
            <input type="checkbox" className="mt-1 accent-[var(--brand-primary)]" checked={Boolean(form.ativo)} onChange={(event) => setForm((prev) => ({ ...prev, ativo: event.target.checked }))} />
            <span>Manter unidade ativa para operacao e dashboards.</span>
          </label>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Remover unidade"
        description="Essa acao exclui a unidade selecionada. Confirme apenas se tiver certeza."
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={saving}>Voltar</Button>
            <Button type="button" variant="danger" onClick={handleDelete} disabled={saving}>{saving ? 'Removendo...' : 'Remover unidade'}</Button>
          </>
        }
      >
        <p className="text-sm text-zinc-400">Unidade selecionada: <span className="text-zinc-100">{deleteTarget?.nome || '-'}</span></p>
      </Dialog>
    </div>
  );
}
