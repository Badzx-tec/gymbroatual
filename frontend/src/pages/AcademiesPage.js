import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { toast } from 'sonner';
import { Building2, Plus, Edit2, Trash2, X, Users, DollarSign, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const emptyAcademy = { nome: '', endereco: '', telefone: '', cnpj: '', email: '', catraca_ip: '192.168.1.9', catraca_port: 7878, ativo: true };

export default function AcademiesPage() {
  const [academies, setAcademies] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyAcademy);
  const [editId, setEditId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const acads = await api.listAcademies();
      setAcademies(acads);
      const statsMap = {};
      for (const a of acads) {
        try {
          statsMap[a.academy_id] = await api.academyStats(a.academy_id);
        } catch { statsMap[a.academy_id] = { total_alunos: 0, alunos_ativos: 0, faturamento: 0 }; }
      }
      setStats(statsMap);
    } catch {}
    setLoading(false);
  };

  const openCreate = () => { setForm(emptyAcademy); setEditId(''); setModal('create'); };
  const openEdit = (a) => {
    setForm({ nome: a.nome, endereco: a.endereco || '', telefone: a.telefone || '', cnpj: a.cnpj || '', email: a.email || '', catraca_ip: a.catraca_ip || '192.168.1.9', catraca_port: a.catraca_port || 7878, ativo: a.ativo });
    setEditId(a.academy_id);
    setModal('edit');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = { ...form, catraca_port: parseInt(form.catraca_port) };
    try {
      if (modal === 'create') { await api.createAcademy(payload); toast.success('Academia criada!'); }
      else { await api.updateAcademy(editId, payload); toast.success('Academia atualizada!'); }
      setModal(null);
      loadData();
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const handleDelete = async (id, nome) => {
    if (!window.confirm(`Remover academia "${nome}"?`)) return;
    try { await api.deleteAcademy(id); toast.success('Academia removida'); loadData(); } catch (err) { toast.error(err.message); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div data-testid="academies-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Franquias</h1>
          <p className="text-zinc-400 mt-1">{academies.length} unidades cadastradas</p>
        </div>
        <button data-testid="add-academy-btn" onClick={openCreate}
          className="flex items-center gap-2 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-6 py-2.5 rounded-sm hover:bg-[#b3e600] transition-all hover:-translate-y-0.5">
          <Plus className="w-4 h-4" /> Nova Unidade
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {academies.map((a, i) => {
          const s = stats[a.academy_id] || {};
          return (
            <motion.div key={a.academy_id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              data-testid={`academy-card-${a.academy_id}`}
              className="bg-zinc-900 border border-zinc-800 rounded-md p-6 hover:border-zinc-700 transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-sm bg-[#ccff00]/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-[#ccff00]" />
                </div>
                <div className="flex gap-1">
                  <button data-testid={`edit-academy-${a.academy_id}`} onClick={() => openEdit(a)} className="p-1.5 hover:bg-zinc-800 rounded-sm text-zinc-400 hover:text-white"><Edit2 className="w-4 h-4" /></button>
                  <button data-testid={`delete-academy-${a.academy_id}`} onClick={() => handleDelete(a.academy_id, a.nome)} className="p-1.5 hover:bg-red-500/10 rounded-sm text-zinc-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <h3 className="font-heading text-xl font-semibold uppercase mb-1">{a.nome}</h3>
              {a.endereco && <p className="text-zinc-500 text-sm flex items-center gap-1 mb-3"><MapPin className="w-3 h-3" /> {a.endereco}</p>}
              <div className="grid grid-cols-3 gap-2 mt-4">
                <div className="text-center p-2 bg-zinc-800/50 rounded-sm">
                  <Users className="w-4 h-4 mx-auto mb-1 text-[#ccff00]" />
                  <p className="text-lg font-bold">{s.total_alunos || 0}</p>
                  <p className="text-[10px] text-zinc-500 uppercase">Alunos</p>
                </div>
                <div className="text-center p-2 bg-zinc-800/50 rounded-sm">
                  <Users className="w-4 h-4 mx-auto mb-1 text-green-500" />
                  <p className="text-lg font-bold">{s.alunos_ativos || 0}</p>
                  <p className="text-[10px] text-zinc-500 uppercase">Ativos</p>
                </div>
                <div className="text-center p-2 bg-zinc-800/50 rounded-sm">
                  <DollarSign className="w-4 h-4 mx-auto mb-1 text-blue-500" />
                  <p className="text-lg font-bold">{(s.faturamento || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                  <p className="text-[10px] text-zinc-500 uppercase">R$/mes</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800">
                <span className="text-xs text-zinc-500">IP Catraca: {a.catraca_ip}:{a.catraca_port}</span>
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${a.ativo ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'}`}>
                  {a.ativo ? 'Ativa' : 'Inativa'}
                </span>
              </div>
            </motion.div>
          );
        })}
        {academies.length === 0 && <div className="col-span-full text-center py-12 text-zinc-500">Nenhuma franquia cadastrada</div>}
      </div>

      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setModal(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 rounded-md w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-zinc-800">
                <h3 className="font-heading text-xl font-semibold uppercase">{modal === 'create' ? 'Nova Unidade' : 'Editar Unidade'}</h3>
                <button data-testid="close-academy-modal" onClick={() => setModal(null)} className="p-1 hover:bg-zinc-800 rounded-sm"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSave} className="p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-zinc-400 mb-1 block">Nome *</label>
                  <input data-testid="academy-nome-input" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" required />
                </div>
                <div>
                  <label className="text-sm font-medium text-zinc-400 mb-1 block">Endereco</label>
                  <input data-testid="academy-endereco-input" value={form.endereco} onChange={e => setForm({ ...form, endereco: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Telefone</label>
                    <input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">CNPJ</label>
                    <input value={form.cnpj} onChange={e => setForm({ ...form, cnpj: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-zinc-400 mb-1 block">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">IP Catraca</label>
                    <input data-testid="academy-catraca-ip" value={form.catraca_ip} onChange={e => setForm({ ...form, catraca_ip: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Porta Catraca</label>
                    <input type="number" value={form.catraca_port} onChange={e => setForm({ ...form, catraca_port: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} className="w-4 h-4 accent-[#ccff00]" />
                  <label className="text-sm text-zinc-300">Unidade ativa</label>
                </div>
                <div className="flex gap-3 pt-2">
                  <button data-testid="save-academy-btn" type="submit" disabled={saving}
                    className="flex-1 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-10 rounded-sm hover:bg-[#b3e600] disabled:opacity-50">
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                  <button type="button" onClick={() => setModal(null)} className="px-6 bg-zinc-800 text-white font-semibold uppercase text-sm h-10 rounded-sm hover:bg-zinc-700">Cancelar</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
