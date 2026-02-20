import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { toast } from 'sonner';
import { Plus, Search, Edit2, Trash2, X, User, FileSpreadsheet, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const emptyStudent = { nome: '', email: '', cpf: '', telefone: '', plano_id: '', tag_rfid: '', biometria_id: '', status: 'ativo', data_vencimento: '' };

export default function StudentsPage() {
  const [students, setStudents] = useState([]);
  const [plans, setPlans] = useState([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'create' | 'edit'
  const [form, setForm] = useState(emptyStudent);
  const [editId, setEditId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [s, p] = await Promise.all([api.listStudents(search, filterStatus), api.listPlans()]);
      setStudents(s);
      setPlans(p);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      api.listStudents(search, filterStatus).then(setStudents).catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, filterStatus]);

  const openCreate = () => { setForm(emptyStudent); setEditId(''); setModal('create'); };
  const openEdit = (s) => {
    setForm({ nome: s.nome, email: s.email, cpf: s.cpf, telefone: s.telefone || '', plano_id: s.plano_id || '', tag_rfid: s.tag_rfid || '', biometria_id: s.biometria_id || '', status: s.status, data_vencimento: s.data_vencimento ? s.data_vencimento.split('T')[0] : '' });
    setEditId(s.student_id);
    setModal('edit');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal === 'create') {
        await api.createStudent(form);
        toast.success('Aluno cadastrado!');
      } else {
        await api.updateStudent(editId, form);
        toast.success('Aluno atualizado!');
      }
      setModal(null);
      loadData();
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const handleDelete = async (id, nome) => {
    if (!window.confirm(`Remover aluno ${nome}?`)) return;
    try {
      await api.deleteStudent(id);
      toast.success('Aluno removido');
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const getPlanName = (pid) => plans.find(p => p.plan_id === pid)?.nome || '-';

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div data-testid="students-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Alunos</h1>
          <p className="text-zinc-400 mt-1">{students.length} alunos cadastrados</p>
        </div>
        <div className="flex gap-2">
          <button data-testid="export-students-excel-btn" onClick={() => { api.exportStudentsExcel(); toast.success('Exportando Excel...'); }}
            className="flex items-center gap-2 bg-zinc-800 text-white text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded-sm hover:bg-zinc-700">
            <FileSpreadsheet className="w-4 h-4 text-green-500" /> Excel
          </button>
          <button data-testid="export-students-pdf-btn" onClick={() => { api.exportStudentsPdf(); toast.success('Exportando PDF...'); }}
            className="flex items-center gap-2 bg-zinc-800 text-white text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded-sm hover:bg-zinc-700">
            <FileText className="w-4 h-4 text-red-400" /> PDF
          </button>
          <button data-testid="add-student-btn" onClick={openCreate}
            className="flex items-center gap-2 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-6 py-2.5 rounded-sm hover:bg-[#b3e600] transition-all hover:-translate-y-0.5">
            <Plus className="w-4 h-4" /> Novo Aluno
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input data-testid="student-search-input" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, email, CPF ou RFID..."
            className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 pl-10 pr-4 focus:outline-none focus:ring-1 focus:ring-[#ccff00] focus:border-[#ccff00] text-sm" />
        </div>
        <select data-testid="student-status-filter" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#ccff00]">
          <option value="">Todos</option>
          <option value="ativo">Ativos</option>
          <option value="inativo">Inativos</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
        <table data-testid="students-table" className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
              <th className="text-left px-5 py-3 font-medium">Aluno</th>
              <th className="text-left px-5 py-3 font-medium hidden md:table-cell">CPF</th>
              <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Plano</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Vencimento</th>
              <th className="text-right px-5 py-3 font-medium">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, i) => (
              <motion.tr key={s.student_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
                      <User className="w-4 h-4 text-zinc-400" />
                    </div>
                    <div>
                      <p className="font-medium">{s.nome}</p>
                      <p className="text-zinc-500 text-xs">{s.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-zinc-400 hidden md:table-cell">{s.cpf}</td>
                <td className="px-5 py-3 hidden lg:table-cell">{getPlanName(s.plano_id)}</td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-sm border ${s.status === 'ativo' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'ativo' ? 'bg-green-500' : 'bg-red-500'}`} />
                    {s.status === 'ativo' ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-5 py-3 text-zinc-400 hidden lg:table-cell">
                  {s.data_vencimento ? new Date(s.data_vencimento).toLocaleDateString('pt-BR') : '-'}
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button data-testid={`edit-student-${s.student_id}`} onClick={() => openEdit(s)} className="p-2 hover:bg-zinc-800 rounded-sm transition-colors text-zinc-400 hover:text-white">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button data-testid={`delete-student-${s.student_id}`} onClick={() => handleDelete(s.student_id, s.nome)} className="p-2 hover:bg-red-500/10 rounded-sm transition-colors text-zinc-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </motion.tr>
            ))}
            {students.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-zinc-500">Nenhum aluno encontrado</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setModal(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-md w-full max-w-lg max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-zinc-800">
                <h3 className="font-heading text-xl font-semibold uppercase">{modal === 'create' ? 'Novo Aluno' : 'Editar Aluno'}</h3>
                <button data-testid="close-modal-btn" onClick={() => setModal(null)} className="p-1 hover:bg-zinc-800 rounded-sm"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSave} className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Nome *</label>
                    <input data-testid="student-nome-input" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">E-mail *</label>
                    <input data-testid="student-email-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">CPF *</label>
                    <input data-testid="student-cpf-input" value={form.cpf} onChange={e => setForm({ ...form, cpf: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Telefone</label>
                    <input data-testid="student-telefone-input" value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Plano</label>
                    <select data-testid="student-plano-select" value={form.plano_id} onChange={e => setForm({ ...form, plano_id: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm">
                      <option value="">Selecionar plano</option>
                      {plans.map(p => <option key={p.plan_id} value={p.plan_id}>{p.nome} - R$ {p.valor.toFixed(2).replace('.', ',')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Tag RFID</label>
                    <input data-testid="student-rfid-input" value={form.tag_rfid} onChange={e => setForm({ ...form, tag_rfid: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">ID Biometria</label>
                    <input data-testid="student-bio-input" value={form.biometria_id} onChange={e => setForm({ ...form, biometria_id: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Status</label>
                    <select data-testid="student-status-select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm">
                      <option value="ativo">Ativo</option>
                      <option value="inativo">Inativo</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Vencimento</label>
                    <input data-testid="student-vencimento-input" type="date" value={form.data_vencimento} onChange={e => setForm({ ...form, data_vencimento: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button data-testid="save-student-btn" type="submit" disabled={saving}
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
