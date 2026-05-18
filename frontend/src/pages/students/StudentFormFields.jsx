import React from 'react';
import SelectField from '../../components/ui/SelectField';
import TextField from '../../components/ui/TextField';

// ── Shared form defaults ──────────────────────────────────────────────────────

export const emptyStudent = {
  nome: '',
  email: '',
  cpf: '',
  telefone: '',
  plano_id: '',
  matricula: '',
  tag_rfid: '',
  biometria_id: '',
  status: 'inativo',
  data_vencimento: '',
  peso_kg: '',
  idade: '',
  altura_cm: '',
  treino: '',
  dias_frequencia: 0,
  auth_login_enabled: true,
  password: '',
  auto_generate_password: false,
  force_password_reset: false,
};

export function buildStudentForm(student) {
  return {
    nome: student?.nome || '',
    email: student?.email || '',
    cpf: student?.cpf || '',
    telefone: student?.telefone || '',
    plano_id: student?.plano_id || '',
    matricula: student?.matricula || '',
    tag_rfid: student?.tag_rfid || '',
    biometria_id: student?.biometria_id || '',
    status: student?.status || 'ativo',
    data_vencimento: student?.data_vencimento ? String(student.data_vencimento).split('T')[0] : '',
    peso_kg: student?.peso_kg ?? '',
    idade: student?.idade ?? '',
    altura_cm: student?.altura_cm ?? '',
    treino: student?.treino || '',
    dias_frequencia: student?.dias_frequencia ?? 0,
    auth_login_enabled: student?.auth_login_enabled !== false,
    password: '',
    auto_generate_password: false,
    force_password_reset: false,
  };
}

export function normalizeCpfInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

// ── Field group component ─────────────────────────────────────────────────────

export default function StudentFormFields({ form, setForm, plans }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <TextField
          label="Nome"
          value={form.nome}
          onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
          placeholder="Nome completo do aluno"
          required
        />
        <TextField
          label="E-mail"
          type="email"
          value={form.email}
          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          placeholder="aluno@academia.com"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TextField
          label="CPF"
          value={form.cpf}
          onChange={(event) => setForm((current) => ({ ...current, cpf: normalizeCpfInput(event.target.value) }))}
          placeholder="000.000.000-00"
          required
        />
        <TextField
          label="Telefone"
          value={form.telefone}
          onChange={(event) => setForm((current) => ({ ...current, telefone: event.target.value }))}
          placeholder="(00) 00000-0000"
        />
        <SelectField
          label="Status"
          value={form.status}
          onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
        >
          <option value="ativo">Ativo</option>
          <option value="inativo">Inativo</option>
        </SelectField>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SelectField
          label="Plano"
          value={form.plano_id}
          onChange={(event) => setForm((current) => ({ ...current, plano_id: event.target.value }))}
        >
          <option value="">Selecionar plano</option>
          {plans.map((plan) => (
            <option key={plan.plan_id} value={plan.plan_id}>
              {plan.nome} - R$ {Number(plan.valor || 0).toFixed(2).replace('.', ',')}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Vencimento"
          type="date"
          value={form.data_vencimento}
          onChange={(event) => setForm((current) => ({ ...current, data_vencimento: event.target.value }))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TextField
          label="Matricula"
          value={form.matricula}
          onChange={(event) => setForm((current) => ({ ...current, matricula: event.target.value }))}
          placeholder="ALU0001"
        />
        <TextField
          label="Tag RFID"
          value={form.tag_rfid}
          onChange={(event) => setForm((current) => ({ ...current, tag_rfid: event.target.value }))}
          placeholder="Cartao ou pulseira"
        />
        <TextField
          label="ID biometria"
          value={form.biometria_id}
          onChange={(event) => setForm((current) => ({ ...current, biometria_id: event.target.value }))}
          placeholder="ID retornado pela Toletus"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <TextField
          label="Peso (kg)"
          type="number"
          step="0.1"
          value={form.peso_kg}
          onChange={(event) => setForm((current) => ({ ...current, peso_kg: event.target.value }))}
        />
        <TextField
          label="Idade"
          type="number"
          value={form.idade}
          onChange={(event) => setForm((current) => ({ ...current, idade: event.target.value }))}
        />
        <TextField
          label="Altura (cm)"
          type="number"
          step="0.1"
          value={form.altura_cm}
          onChange={(event) => setForm((current) => ({ ...current, altura_cm: event.target.value }))}
        />
        <TextField
          label="Frequencia semanal"
          type="number"
          value={form.dias_frequencia}
          onChange={(event) => setForm((current) => ({ ...current, dias_frequencia: event.target.value }))}
        />
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Treino e observacoes</span>
        <textarea
          value={form.treino}
          onChange={(event) => setForm((current) => ({ ...current, treino: event.target.value }))}
          className="min-h-[112px] w-full rounded-md border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-3 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
        />
      </label>

      <div className="grid gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Login do aluno</p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Defina senha inicial ou deixe em branco para senha temporaria. E-mail, CPF e matricula podem ser usados como login.
          </p>
        </div>
        <div className="space-y-3">
          <TextField
            label="Senha inicial"
            type="password"
            value={form.password}
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            placeholder="Opcional"
          />
          <label className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.auth_login_enabled} onChange={(event) => setForm((current) => ({ ...current, auth_login_enabled: event.target.checked }))} className="accent-[var(--brand-primary)]" />
            Permitir login do aluno
          </label>
          <label className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.auto_generate_password} onChange={(event) => setForm((current) => ({ ...current, auto_generate_password: event.target.checked }))} className="accent-[var(--brand-primary)]" />
            Gerar senha temporaria automaticamente
          </label>
          <label className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.force_password_reset} onChange={(event) => setForm((current) => ({ ...current, force_password_reset: event.target.checked }))} className="accent-[var(--brand-primary)]" />
            Exigir troca de senha no primeiro acesso
          </label>
        </div>
      </div>
    </div>
  );
}
