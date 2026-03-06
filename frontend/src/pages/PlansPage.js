import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, X, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getStoredUser } from '../lib/session';

const emptyPlan = { nome: '', valor: '', duracao_dias: '', descricao: '', ativo: true };

export default function PlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyPlan);
  const [editId, setEditId] = useState('');
  const [saving, setSaving] = useState(false);
  const user = React.useMemo(() => getStoredUser(), []);
  const role = String(user.role || '').toUpperCase();
  const canManagePlans = ['OWNER', 'MANAGER'].includes(role);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const data = await api.listPlans();
      setPlans(data);
    } catch {}
    setLoading(false);
  };

  const openCreate = () => {
    if (!canManagePlans) {
      toast.error('Sem permissao para criar plano.');
      return;
    }
    setForm(emptyPlan);
    setEditId('');
    setModal('create');
  };
  const openEdit = (p) => {
    if (!canManagePlans) {
      toast.error('Sem permissao para editar plano.');
      return;
    }
    setForm({ nome: p.nome, valor: String(p.valor), duracao_dias: String(p.duracao_dias), descricao: p.descricao || '', ativo: p.ativo });
    setEditId(p.plan_id);
    setModal('edit');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canManagePlans) {
      toast.error('Sem permissao para salvar plano.');
      return;
    }
    setSaving(true);
    const payload = { ...form, valor: parseFloat(form.valor), duracao_dias: parseInt(form.duracao_dias) };
    try {
      if (modal === 'create') {
        await api.createPlan(payload);
        toast.success('Plano criado!');
      } else {
        await api.updatePlan(editId, payload);
        toast.success('Plano atualizado!');
      }
      setModal(null);
      loadData();
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const handleDelete = async (id, nome) => {
    if (!canManagePlans) {
      toast.error('Sem permissao para remover plano.');
      return;
    }
    if (!window.confirm(`Remover plano "${nome}"?`)) return;
    try {
      await api.deletePlan(id);
      toast.success('Plano removido');
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div data-testid="plans-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Planos</h1>
          <p className="text-zinc-400 mt-1">{plans.length} planos cadastrados</p>
        </div>
        {canManagePlans && (
          <button data-testid="add-plan-btn" onClick={openCreate}
            className="flex items-center gap-2 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-6 py-2.5 rounded-sm hover:bg-[#b3e600] transition-all hover:-translate-y-0.5">
            <Plus className="w-4 h-4" /> Novo Plano
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {plans.map((p, i) => (
          <motion.div key={p.plan_id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            data-testid={`plan-card-${p.plan_id}`}
            className="bg-zinc-900 border border-zinc-800 rounded-md p-6 hover:border-zinc-700 transition-colors">
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-sm bg-[#ccff00]/10 flex items-center justify-center">
                <Tag className="w-5 h-5 text-[#ccff00]" />
              </div>
              {canManagePlans && (
                <div className="flex gap-1">
                  <button data-testid={`edit-plan-${p.plan_id}`} onClick={() => openEdit(p)} className="p-1.5 hover:bg-zinc-800 rounded-sm transition-colors text-zinc-400 hover:text-white">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button data-testid={`delete-plan-${p.plan_id}`} onClick={() => handleDelete(p.plan_id, p.nome)} className="p-1.5 hover:bg-red-500/10 rounded-sm transition-colors text-zinc-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            <h3 className="font-heading text-xl font-semibold uppercase mb-1">{p.nome}</h3>
            <p className="text-3xl font-bold mb-1">R$ {p.valor.toFixed(2).replace('.', ',')}</p>
            <p className="text-zinc-500 text-sm mb-3">{p.duracao_dias} dias</p>
            {p.descricao && <p className="text-zinc-400 text-sm">{p.descricao}</p>}
            <div className="mt-4">
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-sm border ${p.ativo ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'}`}>
                {p.ativo ? 'Ativo' : 'Inativo'}
              </span>
            </div>
          </motion.div>
        ))}
        {plans.length === 0 && (
          <div className="col-span-full text-center py-12 text-zinc-500">Nenhum plano cadastrado</div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setModal(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-md w-full max-w-md"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-zinc-800">
                <h3 className="font-heading text-xl font-semibold uppercase">{modal === 'create' ? 'Novo Plano' : 'Editar Plano'}</h3>
                <button data-testid="close-plan-modal-btn" onClick={() => setModal(null)} className="p-1 hover:bg-zinc-800 rounded-sm"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSave} className="p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-zinc-400 mb-1 block">Nome *</label>
                  <input data-testid="plan-nome-input" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Valor (R$) *</label>
                    <input data-testid="plan-valor-input" type="number" step="0.01" value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Duracao (dias) *</label>
                    <input data-testid="plan-duracao-input" type="number" value={form.duracao_dias} onChange={e => setForm({ ...form, duracao_dias: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" required />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-zinc-400 mb-1 block">Descricao</label>
                  <textarea data-testid="plan-descricao-input" value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })}
                    rows={3} className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm p-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm resize-none" />
                </div>
                <div className="flex items-center gap-2">
                  <input data-testid="plan-ativo-checkbox" type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })}
                    className="w-4 h-4 accent-[#ccff00]" />
                  <label className="text-sm text-zinc-300">Plano ativo</label>
                </div>
                <div className="flex gap-3 pt-2">
                  <button data-testid="save-plan-btn" type="submit" disabled={saving}
                    className="flex-1 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-10 rounded-sm hover:bg-[#b3e600] transition-all disabled:opacity-50">
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                  <button type="button" onClick={() => setModal(null)} className="px-6 bg-zinc-800 text-white font-semibold uppercase tracking-wide text-sm h-10 rounded-sm hover:bg-zinc-700">
                    Cancelar
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
