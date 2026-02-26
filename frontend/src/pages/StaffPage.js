import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { api } from '../api';
import CredentialPanel from '../components/CredentialPanel';

const emptyEmployeeForm = {
  name: '',
  email: '',
  role: 'RECEPTION',
  matricula: '',
  tag_rfid: '',
  biometria_id: '',
  keypad_code: '',
  sync_shadow_student: true,
};

export default function StaffPage() {
  const [employees, setEmployees] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyEmployeeForm);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'RECEPTION' });
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [editForm, setEditForm] = useState({
    ...emptyEmployeeForm,
    is_active: true,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [credentialPanel, setCredentialPanel] = useState(null);

  const load = async ({ silent = false } = {}) => {
    setLoading(true);
    const [employeesRes, invitesRes] = await Promise.allSettled([
      api.listEmployees(),
      api.listStaffInvites(),
    ]);

    if (employeesRes.status === 'fulfilled') {
      setEmployees(employeesRes.value);
    } else if (!silent) {
      toast.error(employeesRes.reason?.message || 'Erro ao carregar funcionarios');
    }

    if (invitesRes.status === 'fulfilled') {
      setInvites(invitesRes.value);
    } else {
      setInvites([]);
      const inviteErr = invitesRes.reason;
      if (!silent && inviteErr?.status !== 403) {
        toast.error(inviteErr?.message || 'Erro ao carregar convites');
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const createEmployee = async (e) => {
    e.preventDefault();
    try {
      const result = await api.createEmployee(form);
      toast.success('Funcionario criado');
      const fields = [];
      if (result.email) {
        fields.push({ label: 'Login (e-mail)', value: result.email });
      }
      if (result.temp_password) {
        fields.push({ label: 'Senha temporaria', value: result.temp_password });
      }
      if (result.matricula) {
        fields.push({ label: 'Matricula', value: result.matricula });
      }
      if (fields.length) {
        setCredentialPanel({
          title: `Credenciais de ${result.name || form.name}`,
          description: 'Copie e guarde agora. A senha temporaria nao sera exibida novamente.',
          fields,
        });
      }
      if (result.matricula_auto_generated && result.generated_matricula) {
        toast.success(`Matricula gerada automaticamente: ${result.generated_matricula}`);
      }
      if (result.shadow_student_id) {
        toast.success(`Compatibilidade ativada. Aluno tecnico: ${result.shadow_student_id}`);
      }
      if (result.shadow_sync_warning) {
        toast.warning(result.shadow_sync_warning);
      }
      setForm(emptyEmployeeForm);
      await load({ silent: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const resetEmployeePassword = async (employee) => {
    try {
      const result = await api.resetEmployeePassword(employee.employee_id);
      toast.success('Senha redefinida');
      const fields = [];
      if (employee.email) {
        fields.push({ label: 'Login (e-mail)', value: employee.email });
      }
      if (result.temp_password) {
        fields.push({ label: 'Nova senha temporaria', value: result.temp_password });
      }
      if (fields.length) {
        setCredentialPanel({
          title: `Nova senha de ${employee.name}`,
          description: 'Copie e entregue ao funcionario. O acesso e feito pela tela de login.',
          fields,
        });
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const createInvite = async (e) => {
    e.preventDefault();
    try {
      await api.createStaffInvite(inviteForm);
      toast.success('Convite criado');
      setInviteForm({ email: '', role: 'RECEPTION' });
      await load({ silent: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const syncShadowStudent = async (employeeId) => {
    try {
      const result = await api.syncEmployeeShadowStudent(employeeId);
      toast.success(`Sincronizado: ${result.shadow_student_id}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openEditModal = (employee) => {
    setEditingEmployee(employee);
    setEditForm({
      name: employee.name || '',
      email: employee.email || '',
      role: employee.role || 'RECEPTION',
      matricula: employee.matricula || '',
      tag_rfid: employee.tag_rfid || '',
      biometria_id: employee.biometria_id || '',
      keypad_code: employee.keypad_code || '',
      sync_shadow_student: true,
      is_active: employee.is_active !== false,
    });
  };

  const saveEmployeeEdit = async (e) => {
    e.preventDefault();
    if (!editingEmployee) return;
    setSavingEdit(true);
    try {
      const result = await api.updateEmployee(editingEmployee.employee_id, editForm);
      toast.success('Funcionario atualizado');
      if (result.shadow_sync_warning) {
        toast.warning(result.shadow_sync_warning);
      }
      setEditingEmployee(null);
      await load({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteEmployee = async (employee) => {
    const confirmed = window.confirm(
      `Apagar funcionario ${employee.name}? Esta acao remove o cadastro.`
    );
    if (!confirmed) return;
    try {
      await api.deleteEmployee(employee.employee_id);
      toast.success('Funcionario removido');
      await load({ silent: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const updateCredentials = async (employee) => {
    const biometria_id = window.prompt('ID de biometria', employee.biometria_id || '');
    if (biometria_id === null) return;
    const tag_rfid = window.prompt('Tag RFID', employee.tag_rfid || '');
    if (tag_rfid === null) return;
    const keypad_code = window.prompt('Codigo teclado', employee.keypad_code || '');
    if (keypad_code === null) return;
    const matricula = window.prompt('Matricula', employee.matricula || '');
    if (matricula === null) return;

    try {
      const updated = await api.updateEmployeeCredentials(employee.employee_id, {
        biometria_id,
        tag_rfid,
        keypad_code,
        matricula,
        sync_shadow_student: true,
      });
      toast.success(`Credenciais atualizadas para ${updated.name}`);
      if (updated.shadow_sync_warning) {
        toast.warning(updated.shadow_sync_warning);
      }
      await load({ silent: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const enrollEmployeeBiometry = async (employee) => {
    const deviceId = window.prompt('ID do dispositivo Toletus', 'toletus-unidade-1');
    if (!deviceId) return;

    try {
      await api.tolletusEmployeeEnrollStart({
        employee_id: employee.employee_id,
        device_id: deviceId,
      });
    } catch (err) {
      toast.error(err.message);
      return;
    }

    const template = window.prompt('Cole o template/ID retornado pela catraca');
    if (!template) return;

    try {
      const result = await api.tolletusEmployeeEnrollConfirm({
        employee_id: employee.employee_id,
        device_id: deviceId,
        template,
        external_id: template,
      });
      await api.updateEmployeeCredentials(employee.employee_id, {
        biometria_id: result.biometria_id || template,
        sync_shadow_student: true,
      });
      toast.success('Biometria cadastrada e credencial vinculada');
      await load({ silent: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Funcionarios</h1>
        <p className="text-zinc-400 mt-1">RBAC por academia: OWNER, MANAGER, RECEPTION, TRAINER.</p>
      </div>

      {credentialPanel && (
        <CredentialPanel
          title={credentialPanel.title}
          description={credentialPanel.description}
          fields={credentialPanel.fields}
          onClose={() => setCredentialPanel(null)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={createEmployee} className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
          <h2 className="font-semibold uppercase text-sm tracking-wide">Criar funcionario</h2>
          <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" required />
          <input placeholder="Email (opcional)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3">
            <option value="MANAGER">MANAGER</option>
            <option value="RECEPTION">RECEPTION</option>
            <option value="TRAINER">TRAINER</option>
          </select>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input placeholder="Matricula (opcional)" value={form.matricula} onChange={(e) => setForm({ ...form, matricula: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
            <input placeholder="Tag RFID" value={form.tag_rfid} onChange={(e) => setForm({ ...form, tag_rfid: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
            <input placeholder="ID Biometria" value={form.biometria_id} onChange={(e) => setForm({ ...form, biometria_id: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
            <input placeholder="Codigo teclado" value={form.keypad_code} onChange={(e) => setForm({ ...form, keypad_code: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
          </div>
          <p className="text-xs text-zinc-500">
            Matricula e um codigo interno. Pode informar manualmente ou deixar em branco para gerar automaticamente (ex.: FUNC0001).
          </p>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={form.sync_shadow_student}
              onChange={(e) => setForm({ ...form, sync_shadow_student: e.target.checked })}
            />
            Criar/sincronizar aluno tecnico (compatibilidade)
          </label>
          <button className="bg-[#ccff00] text-black font-bold text-xs uppercase tracking-wider h-10 px-4 rounded-sm">Criar</button>
        </form>

        <form onSubmit={createInvite} className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
          <h2 className="font-semibold uppercase text-sm tracking-wide">Criar convite</h2>
          <input placeholder="Email" type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" required />
          <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3">
            <option value="MANAGER">MANAGER</option>
            <option value="RECEPTION">RECEPTION</option>
            <option value="TRAINER">TRAINER</option>
          </select>
          <button className="bg-zinc-800 text-white font-semibold text-xs uppercase tracking-wider h-10 px-4 rounded-sm">Convidar</button>
        </form>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Credenciais</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.employee_id} className="border-b border-zinc-800/50">
                <td className="px-4 py-3">{employee.name}</td>
                <td className="px-4 py-3 text-zinc-400">{employee.email}</td>
                <td className="px-4 py-3">{employee.role}</td>
                <td className="px-4 py-3 text-xs text-zinc-400">
                  BIO: {employee.biometria_id || '-'} | RFID: {employee.tag_rfid || '-'} | KEY: {employee.keypad_code || '-'}
                </td>
                <td className="px-4 py-3">{employee.is_active ? 'Ativo' : 'Inativo'}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => openEditModal(employee)} className="bg-emerald-500/20 text-emerald-300 px-3 py-1 rounded-sm text-xs">Editar</button>
                  <button onClick={() => deleteEmployee(employee)} className="bg-red-500/20 text-red-300 px-3 py-1 rounded-sm text-xs">Apagar</button>
                  <button onClick={() => enrollEmployeeBiometry(employee)} className="bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-sm text-xs">Biometria</button>
                  <button onClick={() => updateCredentials(employee)} className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-sm text-xs">Credenciais</button>
                  <button onClick={() => syncShadowStudent(employee.employee_id)} className="bg-amber-500/20 text-amber-300 px-3 py-1 rounded-sm text-xs">Sync</button>
                  <button onClick={() => resetEmployeePassword(employee)} className="bg-zinc-800 px-3 py-1 rounded-sm text-xs">Reset</button>
                  <button onClick={() => api.deactivateEmployee(employee.employee_id).then(() => load({ silent: true })).catch((err) => toast.error(err.message))} className="bg-red-500/20 text-red-300 px-3 py-1 rounded-sm text-xs">Desativar</button>
                </td>
              </tr>
            ))}
            {employees.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500">Nenhum funcionario</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <h3 className="font-semibold text-sm uppercase tracking-wide mb-3">Convites</h3>
        <ul className="space-y-2 text-sm">
          {invites.map((invite) => (
            <li key={invite.invite_id} className="flex items-center justify-between border border-zinc-800 rounded-sm px-3 py-2">
              <span>{invite.email} - {invite.role}</span>
              <button onClick={() => api.cancelStaffInvite(invite.invite_id).then(() => load({ silent: true })).catch((err) => toast.error(err.message))} className="text-red-300 text-xs">Cancelar</button>
            </li>
          ))}
          {invites.length === 0 && <li className="text-zinc-500">Sem convites ativos.</li>}
        </ul>
      </div>

      {editingEmployee && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold uppercase text-sm tracking-wide">Editar funcionario</h3>
              <button className="text-zinc-400 hover:text-white" onClick={() => setEditingEmployee(null)}>Fechar</button>
            </div>

            <form onSubmit={saveEmployeeEdit} className="space-y-3">
              <input placeholder="Nome" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" required />
              <input placeholder="Email" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
              <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3">
                <option value="MANAGER">MANAGER</option>
                <option value="RECEPTION">RECEPTION</option>
                <option value="TRAINER">TRAINER</option>
              </select>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input placeholder="Matricula" value={editForm.matricula} onChange={(e) => setEditForm({ ...editForm, matricula: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
                <input placeholder="Tag RFID" value={editForm.tag_rfid} onChange={(e) => setEditForm({ ...editForm, tag_rfid: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
                <input placeholder="ID Biometria" value={editForm.biometria_id} onChange={(e) => setEditForm({ ...editForm, biometria_id: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
                <input placeholder="Codigo teclado" value={editForm.keypad_code} onChange={(e) => setEditForm({ ...editForm, keypad_code: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
              </div>
              <p className="text-xs text-zinc-500">
                Matricula e um codigo interno unico por academia (ex.: FUNC0001).
              </p>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} />
                Funcionario ativo
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={editForm.sync_shadow_student} onChange={(e) => setEditForm({ ...editForm, sync_shadow_student: e.target.checked })} />
                Sincronizar aluno tecnico
              </label>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={savingEdit} className="bg-[#ccff00] text-black font-bold text-xs uppercase tracking-wider h-10 px-4 rounded-sm disabled:opacity-60">
                  {savingEdit ? 'Salvando...' : 'Salvar'}
                </button>
                <button type="button" onClick={() => setEditingEmployee(null)} className="bg-zinc-800 text-white font-semibold text-xs uppercase tracking-wide h-10 px-4 rounded-sm">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
