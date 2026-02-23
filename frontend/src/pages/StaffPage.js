import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { api } from '../api';

export default function StaffPage() {
  const [employees, setEmployees] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'RECEPTION',
    matricula: '',
    tag_rfid: '',
    biometria_id: '',
    keypad_code: '',
    sync_shadow_student: true,
  });
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'RECEPTION' });

  const load = async () => {
    setLoading(true);
    try {
      const [emp, inv] = await Promise.all([api.listEmployees(), api.listStaffInvites()]);
      setEmployees(emp);
      setInvites(inv);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createEmployee = async (e) => {
    e.preventDefault();
    try {
      const result = await api.createEmployee(form);
      toast.success(`Funcionario criado. Senha temporaria: ${result.temp_password}`);
      if (result.shadow_student_id) {
        toast.success(`Compatibilidade ativada. Aluno tecnico: ${result.shadow_student_id}`);
      }
      setForm({
        name: '',
        email: '',
        role: 'RECEPTION',
        matricula: '',
        tag_rfid: '',
        biometria_id: '',
        keypad_code: '',
        sync_shadow_student: true,
      });
      load();
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
      load();
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
      load();
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
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Funcionarios</h1>
        <p className="text-zinc-400 mt-1">RBAC por academia: OWNER, MANAGER, RECEPTION, TRAINER.</p>
      </div>

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
            <input placeholder="Matricula (catraca)" value={form.matricula} onChange={(e) => setForm({ ...form, matricula: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
            <input placeholder="Tag RFID" value={form.tag_rfid} onChange={(e) => setForm({ ...form, tag_rfid: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
            <input placeholder="ID Biometria" value={form.biometria_id} onChange={(e) => setForm({ ...form, biometria_id: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
            <input placeholder="Codigo teclado" value={form.keypad_code} onChange={(e) => setForm({ ...form, keypad_code: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" />
          </div>
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
                  <button onClick={() => enrollEmployeeBiometry(employee)} className="bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-sm text-xs">Biometria</button>
                  <button onClick={() => updateCredentials(employee)} className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-sm text-xs">Credenciais</button>
                  <button onClick={() => syncShadowStudent(employee.employee_id)} className="bg-amber-500/20 text-amber-300 px-3 py-1 rounded-sm text-xs">Sync</button>
                  <button onClick={() => api.resetEmployeePassword(employee.employee_id).then((r) => toast.success(`Senha: ${r.temp_password}`)).catch((err) => toast.error(err.message))} className="bg-zinc-800 px-3 py-1 rounded-sm text-xs">Reset</button>
                  <button onClick={() => api.deactivateEmployee(employee.employee_id).then(load).catch((err) => toast.error(err.message))} className="bg-red-500/20 text-red-300 px-3 py-1 rounded-sm text-xs">Desativar</button>
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
              <button onClick={() => api.cancelStaffInvite(invite.invite_id).then(load).catch((err) => toast.error(err.message))} className="text-red-300 text-xs">Cancelar</button>
            </li>
          ))}
          {invites.length === 0 && <li className="text-zinc-500">Sem convites ativos.</li>}
        </ul>
      </div>
    </div>
  );
}
