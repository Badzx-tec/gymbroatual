import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { api } from '../api';

export default function StaffPage() {
  const [employees, setEmployees] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', role: 'RECEPTION' });
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
      setForm({ name: '', email: '', role: 'RECEPTION' });
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
          <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" required />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3">
            <option value="MANAGER">MANAGER</option>
            <option value="RECEPTION">RECEPTION</option>
            <option value="TRAINER">TRAINER</option>
          </select>
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
                <td className="px-4 py-3">{employee.is_active ? 'Ativo' : 'Inativo'}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => api.resetEmployeePassword(employee.employee_id).then((r) => toast.success(`Senha: ${r.temp_password}`)).catch((err) => toast.error(err.message))} className="bg-zinc-800 px-3 py-1 rounded-sm text-xs">Reset</button>
                  <button onClick={() => api.deactivateEmployee(employee.employee_id).then(load).catch((err) => toast.error(err.message))} className="bg-red-500/20 text-red-300 px-3 py-1 rounded-sm text-xs">Desativar</button>
                </td>
              </tr>
            ))}
            {employees.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500">Nenhum funcionario</td></tr>}
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
