import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { toast } from 'sonner';
import { Plus, Search, Edit2, Trash2, X, User, FileSpreadsheet, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const emptyStudent = { nome: '', email: '', cpf: '', telefone: '', plano_id: '', matricula: '', tag_rfid: '', biometria_id: '', status: 'ativo', data_vencimento: '', peso_kg: '', idade: '', altura_cm: '', treino: '', dias_frequencia: 0, auth_login_enabled: true, password: '', auto_generate_password: false, force_password_reset: false };

const normalizeCpfInput = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

export default function StudentsPage() {
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [passkeys, setPasskeys] = useState([]);
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
    setForm({ nome: s.nome, email: s.email, cpf: s.cpf, telefone: s.telefone || '', plano_id: s.plano_id || '', matricula: s.matricula || '', tag_rfid: s.tag_rfid || '', biometria_id: s.biometria_id || '', status: s.status, data_vencimento: s.data_vencimento ? s.data_vencimento.split('T')[0] : '', peso_kg: s.peso_kg ?? '', idade: s.idade ?? '', altura_cm: s.altura_cm ?? '', treino: s.treino || '', dias_frequencia: s.dias_frequencia ?? 0, auth_login_enabled: s.auth_login_enabled !== false, password: '', auto_generate_password: false, force_password_reset: false });
    setEditId(s.student_id);
    setModal('edit');
  };

  const viewStudent = async (s) => {
    try {
      const full = await api.getStudent(s.student_id);
      setSelectedStudent(full);
      // fetch passkeys
      try { const pk = await api.listStudentPasskeys(s.student_id); setPasskeys(pk.webauthn_credentials || []); } catch { setPasskeys([]); }
    } catch (err) { toast.error('Erro ao carregar aluno'); }
  };

  const closeDetail = () => { setSelectedStudent(null); setPasskeys([]); };

  const saveStudentDetails = async (updates) => {
    try {
      await api.updateStudent(selectedStudent.student_id, updates);
      toast.success('Dados do aluno atualizados');
      const refreshed = await api.getStudent(selectedStudent.student_id);
      setSelectedStudent(refreshed);
      loadData();
    } catch (err) { toast.error(err?.message || 'Erro ao salvar aluno'); }
  };

  const registerPasskey = async (cred) => {
    try {
      await api.registerStudentPasskey(selectedStudent.student_id, cred);
      toast.success('Passkey registrada');
      const pk = await api.listStudentPasskeys(selectedStudent.student_id);
      setPasskeys(pk.webauthn_credentials || []);
    } catch (err) { toast.error(err?.message || 'Erro ao registrar passkey'); }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      let result;
      if (modal === 'create') {
        result = await api.createStudent(form);
        toast.success('Aluno cadastrado!');
      } else {
        result = await api.updateStudent(editId, form);
        toast.success('Aluno atualizado!');
      }
      if (result?.matricula_auto_generated && result?.generated_matricula) {
        toast.success(`Matricula gerada automaticamente: ${result.generated_matricula}`);
      }
      if (result?.temp_password) {
        toast.success(`Senha temporaria do aluno: ${result.temp_password}`);
      }
      setModal(null);
      loadData();
    } catch (err) { toast.error(err?.message || 'Erro ao salvar aluno'); }
    setSaving(false);
  };

  const handleDelete = async (id, nome) => {
    if (!window.confirm(`Remover aluno ${nome}?`)) return;
    try {
      await api.deleteStudent(id);
      toast.success('Aluno removido');
      loadData();
    } catch (err) { toast.error(err?.message || 'Erro ao remover aluno'); }
  };

  const getPlanName = (pid) => plans.find(p => p.plan_id === pid)?.nome || '-';

  const handleRegisterBiometria = async () => {
    if (!editId || !form.biometria_id) return toast.error('Informe o ID de biometria');
    try {
      await api.registerBiometria(editId, form.biometria_id);
      toast.success('Biometria cadastrada com sucesso');
      loadData();
    } catch (err) {
      toast.error(err?.message || 'Erro ao registrar biometria');
    }
  };

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
                <td className="px-5 py-3" onClick={() => viewStudent(s)} style={{cursor: 'pointer'}}>
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

      {/* Detail sidebar */}
      {selectedStudent && (
        <div className="fixed right-6 top-20 w-[420px] z-50 bg-zinc-900 border border-zinc-800 rounded-md p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-heading text-xl font-semibold">{selectedStudent.nome}</h3>
              <p className="text-zinc-400 text-sm">{selectedStudent.email} • {selectedStudent.cpf}</p>
            </div>
            <button onClick={closeDetail} className="text-zinc-400 hover:text-white">Fechar</button>
          </div>
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400">Peso (kg)</label>
                <input type="number" step="0.1" defaultValue={selectedStudent.peso_kg ?? selectedStudent.peso ?? ''} onBlur={e => saveStudentDetails({ peso_kg: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Idade</label>
                <input type="number" defaultValue={selectedStudent.idade || ''} onBlur={e => saveStudentDetails({ idade: parseInt(e.target.value) || 0 })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Altura (cm)</label>
                <input type="number" step="0.1" defaultValue={selectedStudent.altura_cm ?? selectedStudent.altura ?? ''} onBlur={e => saveStudentDetails({ altura_cm: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Frequência (dias)</label>
                <input type="number" defaultValue={selectedStudent.dias_frequencia ?? selectedStudent.dias_presenca ?? 0} onBlur={e => saveStudentDetails({ dias_frequencia: parseInt(e.target.value) || 0 })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3 text-sm" />
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400">Treino / Observações</label>
              <textarea defaultValue={selectedStudent.treino || ''} onBlur={e => saveStudentDetails({ treino: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-sm p-3 text-sm h-24" />
            </div>

            <div>
              <h4 className="font-medium">Biometria (Passkeys)</h4>
              <p className="text-zinc-400 text-sm">Credenciais registradas: {passkeys.length}</p>
              <div className="mt-2 flex gap-2">
                <button onClick={async () => {
                  if (!window.PublicKeyCredential) { toast.error('WebAuthn nao suportado neste navegador'); return; }
                  try {
                    const { base64ToBuffer, bufferToBase64 } = await import('../webauthn');
                    // request registration options from server
                    const optsResp = await api.passkeyRegisterOptions(selectedStudent.student_id);
                    const state_id = optsResp.state_id;
                    const publicKey = optsResp.publicKey;
                    // decode challenge and user.id from base64 -> ArrayBuffer
                    if (publicKey.challenge) publicKey.challenge = base64ToBuffer(publicKey.challenge);
                    if (publicKey.user && publicKey.user.id) publicKey.user.id = base64ToBuffer(publicKey.user.id);
                    // decode any allowCredentials ids
                    if (publicKey.excludeCredentials && Array.isArray(publicKey.excludeCredentials)) {
                      publicKey.excludeCredentials = publicKey.excludeCredentials.map(c => ({ ...c, id: base64ToBuffer(c.id) }));
                    }
                    const cred = await navigator.credentials.create({ publicKey });
                    if (!cred) throw new Error('Falha ao criar credencial');
                    const rawId = cred.rawId;
                    const attObj = cred.response.attestationObject;
                    const clientJSON = cred.response.clientDataJSON;
                    const payload = {
                      state_id,
                      id: cred.id,
                      rawId: bufferToBase64(rawId),
                      publicKey: bufferToBase64(attObj),
                      clientDataJSON: bufferToBase64(clientJSON),
                    };
                    await api.passkeyRegisterVerify(selectedStudent.student_id, payload);
                    const pk = await api.listStudentPasskeys(selectedStudent.student_id);
                    setPasskeys(pk.webauthn_credentials || []);
                    toast.success('Passkey registrada com sucesso');
                  } catch (err) {
                    console.error(err);
                    toast.error(err.message || 'Erro no registro WebAuthn');
                  }
                }} className="bg-[#ccff00] text-black px-3 py-2 rounded-sm">Registrar Passkey</button>
                <button onClick={async () => { const pk = await api.listStudentPasskeys(selectedStudent.student_id); setPasskeys(pk.webauthn_credentials || []); }} className="bg-zinc-800 text-white px-3 py-2 rounded-sm">Atualizar</button>
              </div>
              <ul className="mt-3 text-sm text-zinc-300 space-y-1">
                {passkeys.map((p, i) => (
                  <li key={i} className="border border-zinc-800 rounded-sm p-2">ID: {p.id} • Criado: {new Date(p.created_at).toLocaleString()}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

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
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">E-mail</label>
                    <input data-testid="student-email-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">CPF *</label>
                    <input data-testid="student-cpf-input" value={form.cpf} onChange={e => setForm({ ...form, cpf: normalizeCpfInput(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" placeholder="000.000.000-00" required />
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
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Matricula</label>
                    <input value={form.matricula} onChange={e => setForm({ ...form, matricula: e.target.value })}
                      placeholder="Opcional - ex.: ALU0001"
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
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
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Peso (kg)</label>
                    <input type="number" step="0.1" value={form.peso_kg} onChange={e => setForm({ ...form, peso_kg: e.target.value === '' ? '' : Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Idade</label>
                    <input type="number" value={form.idade} onChange={e => setForm({ ...form, idade: e.target.value === '' ? '' : Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Altura (cm)</label>
                    <input type="number" step="0.1" value={form.altura_cm} onChange={e => setForm({ ...form, altura_cm: e.target.value === '' ? '' : Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Dias de frequência</label>
                    <input type="number" value={form.dias_frequencia} onChange={e => setForm({ ...form, dias_frequencia: e.target.value === '' ? 0 : Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-zinc-400 mb-1 block">Treino</label>
                    <textarea value={form.treino} onChange={e => setForm({ ...form, treino: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm min-h-20 p-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
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
                  <div className="md:col-span-2 border border-zinc-800 rounded-sm p-3 bg-zinc-950/40">
                    <p className="text-xs text-zinc-400 mb-2">
                      Matricula e um codigo interno de identificacao. Voce pode informar manualmente ou deixar em branco para geracao automatica.
                    </p>
                    <p className="text-xs text-zinc-500 mb-2">
                      Login do aluno: defina senha inicial ou deixe em branco para gerar senha temporaria segura.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium text-zinc-400 mb-1 block">Senha inicial do aluno</label>
                        <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                          placeholder={modal === 'create' ? 'Minimo 8 caracteres (opcional)' : 'Preencha para redefinir'}
                          className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-10 px-3 focus:outline-none focus:ring-1 focus:ring-[#ccff00] text-sm" />
                      </div>
                      <div className="flex flex-col justify-center gap-2 text-xs text-zinc-300">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={form.auth_login_enabled} onChange={e => setForm({ ...form, auth_login_enabled: e.target.checked })} />
                          Permitir login do aluno
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={form.auto_generate_password} onChange={e => setForm({ ...form, auto_generate_password: e.target.checked })} />
                          Gerar senha temporaria automaticamente
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={form.force_password_reset} onChange={e => setForm({ ...form, force_password_reset: e.target.checked })} />
                          Exigir troca de senha no primeiro acesso
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button data-testid="save-student-btn" type="submit" disabled={saving}
                    className="flex-1 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-10 rounded-sm hover:bg-[#b3e600] transition-all disabled:opacity-50">
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                  {modal === 'edit' && (
                    <button type="button" onClick={handleRegisterBiometria} className="px-4 bg-blue-700 text-white font-semibold uppercase tracking-wide text-xs h-10 rounded-sm hover:bg-blue-600">
                      Registrar biometria
                    </button>
                  )}
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
