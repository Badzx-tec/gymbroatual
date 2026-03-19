import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import CredentialPanel from '../components/CredentialPanel';
import Banner from '../components/ui/Banner';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SectionCard from '../components/ui/SectionCard';
import SelectField from '../components/ui/SelectField';
import SidePanel from '../components/ui/SidePanel';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import TextField from '../components/ui/TextField';
import {
  clearCredentialHistory,
  loadCredentialHistory,
  pushCredentialHistory,
} from '../utils/credentialHistory';
import { getStoredUser } from '../lib/session';
import { formatDateTimeInTimeZone, SAO_PAULO_TIME_ZONE } from '../utils/timezone';

const emptyStudent = {
  nome: '',
  email: '',
  cpf: '',
  telefone: '',
  plano_id: '',
  matricula: '',
  tag_rfid: '',
  biometria_id: '',
  status: 'ativo',
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

const STUDENT_CREDENTIAL_HISTORY_KEY = 'gymbro_student_credentials_history';

const normalizeCpfInput = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

function statusTone(status) {
  return String(status || '').toLowerCase() === 'ativo' ? 'success' : 'danger';
}

function usageTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active_recent') return 'success';
  if (normalized === 'inactive_recent') return 'warning';
  return 'neutral';
}

function usageLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active_recent') return 'Uso recente';
  if (normalized === 'inactive_recent') return 'Sem uso recente';
  return 'Sem historico';
}

function formatDateOnly(value) {
  return formatDateTimeInTimeZone(value, { dateOnly: true });
}

function formatDateTime(value) {
  return formatDateTimeInTimeZone(value);
}

function studentMatchesSearch(student, query) {
  if (!query) return true;
  const haystack = [
    student?.nome,
    student?.email,
    student?.cpf,
    student?.telefone,
    student?.matricula,
    student?.tag_rfid,
    student?.biometria_id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function buildStudentForm(student) {
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

function StudentFormFields({ form, setForm, plans }) {
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

export default function StudentsPage() {
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [passkeys, setPasskeys] = useState([]);
  const [plans, setPlans] = useState([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [usageFilter, setUsageFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState('');
  const [form, setForm] = useState(emptyStudent);
  const [editId, setEditId] = useState('');
  const [saving, setSaving] = useState(false);
  const [credentialPanel, setCredentialPanel] = useState(null);
  const [credentialHistory, setCredentialHistory] = useState(() =>
    loadCredentialHistory(STUDENT_CREDENTIAL_HISTORY_KEY)
  );
  const [confirmAction, setConfirmAction] = useState(null);
  const user = useMemo(() => getStoredUser(), []);
  const role = String(user.role || '').toUpperCase();
  const canManageStudents = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);

  const loadData = useCallback(async (nextSearch = search, nextStatus = filterStatus) => {
    try {
      const [studentsData, plansData] = await Promise.all([
        api.listStudents(nextSearch, nextStatus),
        api.listPlans(),
      ]);
      setStudents(Array.isArray(studentsData) ? studentsData : []);
      setPlans(Array.isArray(plansData) ? plansData : []);
    } catch (err) {
      toast.error(err?.message || 'Falha ao carregar alunos.');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadData(search, filterStatus);
    }, 280);
    return () => clearTimeout(timeout);
  }, [filterStatus, loadData, search]);

  const openCredentialPanel = (payload) => {
    if (!payload?.fields?.length) return;
    const entry = {
      ...payload,
      id: `student_cred_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
    };
    setCredentialPanel(entry);
    setCredentialHistory(pushCredentialHistory(STUDENT_CREDENTIAL_HISTORY_KEY, entry, 12));
  };

  const clearStudentCredentialHistory = () => {
    clearCredentialHistory(STUDENT_CREDENTIAL_HISTORY_KEY);
    setCredentialHistory([]);
    toast.success('Historico de credenciais de aluno limpo.');
  };

  const openCreate = () => {
    if (!canManageStudents) {
      toast.error('Sem permissao para cadastrar aluno.');
      return;
    }
    setForm(emptyStudent);
    setEditId('');
    setFormMode('create');
  };

  const openEdit = (student) => {
    if (!canManageStudents) {
      toast.error('Sem permissao para editar aluno.');
      return;
    }
    setForm(buildStudentForm(student));
    setEditId(student.student_id);
    setFormMode('edit');
  };

  const viewStudent = async (student) => {
    try {
      const full = await api.getStudent(student.student_id);
      setSelectedStudent(full);
      try {
        const pk = await api.listStudentPasskeys(student.student_id);
        setPasskeys(pk.webauthn_credentials || []);
      } catch {
        setPasskeys([]);
      }
    } catch (err) {
      toast.error(err?.message || 'Erro ao carregar aluno.');
    }
  };

  const closeDetail = () => {
    setSelectedStudent(null);
    setPasskeys([]);
  };

  const saveStudentDetails = async (updates) => {
    if (!selectedStudent?.student_id) return;
    try {
      await api.updateStudent(selectedStudent.student_id, updates);
      const refreshed = await api.getStudent(selectedStudent.student_id);
      setSelectedStudent(refreshed);
      toast.success('Dados do aluno atualizados.');
      loadData();
    } catch (err) {
      toast.error(err?.message || 'Erro ao salvar aluno.');
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!canManageStudents) {
      toast.error('Sem permissao para salvar aluno.');
      return;
    }
    setSaving(true);
    try {
      let result;
      if (formMode === 'create') {
        result = await api.createStudent(form);
        toast.success('Aluno cadastrado.');
      } else {
        result = await api.updateStudent(editId, form);
        toast.success('Aluno atualizado.');
      }

      if (result?.matricula_auto_generated && result?.generated_matricula) {
        toast.success(`Matricula gerada automaticamente: ${result.generated_matricula}`);
      }
      if (result?.temp_password) {
        const fields = [];
        if (result?.email || form.email) fields.push({ label: 'Login (e-mail)', value: result?.email || form.email });
        if (result?.cpf || form.cpf) fields.push({ label: 'Login (CPF)', value: result?.cpf || form.cpf });
        if (result?.matricula || form.matricula || result?.generated_matricula) {
          fields.push({
            label: 'Login (matricula)',
            value: result?.matricula || form.matricula || result?.generated_matricula,
          });
        }
        fields.push({ label: 'Senha temporaria', value: result.temp_password });
        openCredentialPanel({
          title: `Credenciais do aluno ${result?.nome || form.nome}`,
          description: 'Copie agora e entregue ao aluno. Ele pode entrar com e-mail, CPF ou matricula.',
          fields,
        });
      }
      setFormMode('');
      await loadData();
    } catch (err) {
      toast.error(err?.message || 'Erro ao salvar aluno.');
    } finally {
      setSaving(false);
    }
  };

  const askDelete = (id, nome) => {
    if (!canManageStudents) {
      toast.error('Sem permissao para remover aluno.');
      return;
    }
    setConfirmAction({
      title: 'Remover aluno',
      description: `O cadastro de ${nome} sera removido permanentemente.`,
      actionLabel: 'Remover',
      run: async () => {
        await api.deleteStudent(id);
        toast.success('Aluno removido.');
        await loadData();
      },
    });
  };

  const getPlanName = (planId) => plans.find((plan) => plan.plan_id === planId)?.nome || '-';

  const handleRegisterBiometria = async () => {
    if (!editId || !form.biometria_id) {
      toast.error('Informe o ID de biometria.');
      return;
    }
    try {
      await api.registerBiometria(editId, form.biometria_id);
      toast.success('Biometria cadastrada com sucesso.');
      await loadData();
    } catch (err) {
      toast.error(err?.message || 'Erro ao registrar biometria.');
    }
  };

  const registerPasskey = async () => {
    if (!selectedStudent?.student_id) return;
    if (!window.PublicKeyCredential) {
      toast.error('WebAuthn nao suportado neste navegador.');
      return;
    }
    try {
      const { base64ToBuffer, bufferToBase64 } = await import('../webauthn');
      const optsResp = await api.passkeyRegisterOptions(selectedStudent.student_id);
      const state_id = optsResp.state_id;
      const publicKey = optsResp.publicKey;
      if (publicKey.challenge) publicKey.challenge = base64ToBuffer(publicKey.challenge);
      if (publicKey.user?.id) publicKey.user.id = base64ToBuffer(publicKey.user.id);
      if (publicKey.excludeCredentials && Array.isArray(publicKey.excludeCredentials)) {
        publicKey.excludeCredentials = publicKey.excludeCredentials.map((credential) => ({
          ...credential,
          id: base64ToBuffer(credential.id),
        }));
      }
      const cred = await navigator.credentials.create({ publicKey });
      if (!cred) throw new Error('Falha ao criar credencial.');
      const payload = {
        state_id,
        id: cred.id,
        rawId: bufferToBase64(cred.rawId),
        publicKey: bufferToBase64(cred.response.attestationObject),
        clientDataJSON: bufferToBase64(cred.response.clientDataJSON),
      };
      await api.passkeyRegisterVerify(selectedStudent.student_id, payload);
      const pk = await api.listStudentPasskeys(selectedStudent.student_id);
      setPasskeys(pk.webauthn_credentials || []);
      toast.success('Passkey registrada com sucesso.');
    } catch (err) {
      console.error(err);
      toast.error(err?.message || 'Erro no registro WebAuthn.');
    }
  };

  const refreshPasskeys = async () => {
    if (!selectedStudent?.student_id) return;
    try {
      const pk = await api.listStudentPasskeys(selectedStudent.student_id);
      setPasskeys(pk.webauthn_credentials || []);
    } catch (err) {
      toast.error(err?.message || 'Erro ao atualizar passkeys.');
    }
  };

  const studentStats = useMemo(() => {
    const active = students.filter((student) => String(student.status || '').toLowerCase() === 'ativo').length;
    const inactive = students.filter((student) => String(student.status || '').toLowerCase() === 'inativo').length;
    const withLogin = students.filter((student) => student.auth_login_enabled !== false).length;
    const withBiometry = students.filter((student) => Boolean(student.biometria_id)).length;
    const activeRecent = students.filter((student) => String(student.operational_usage_status || '').toLowerCase() === 'active_recent').length;
    const inactiveRecent = students.filter((student) => String(student.operational_usage_status || '').toLowerCase() === 'inactive_recent').length;
    return { active, inactive, withLogin, withBiometry, activeRecent, inactiveRecent };
  }, [students]);

  const visibleStudents = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return [...students]
      .filter((student) => {
        if (!studentMatchesSearch(student, normalizedSearch)) return false;
        if (filterStatus && String(student?.status || '').toLowerCase() !== String(filterStatus).toLowerCase()) {
          return false;
        }
        if (
          usageFilter
          && String(student?.operational_usage_status || '').toLowerCase() !== String(usageFilter).toLowerCase()
        ) {
          return false;
        }
        return true;
      })
      .sort((left, right) =>
        String(left?.nome || '').localeCompare(String(right?.nome || ''), 'pt-BR', {
          sensitivity: 'base',
        })
      );
  }, [filterStatus, search, students, usageFilter]);

  if (loading) return <LoadingScreen label="Carregando alunos..." />;

  return (
    <div data-testid="students-page" className="space-y-6">
      <PageHeader
        eyebrow="Operacao"
        title="Alunos"
        subtitle={
          search || filterStatus || usageFilter
            ? `${visibleStudents.length} alunos encontrados${students.length !== visibleStudents.length ? ` de ${students.length}` : ''}, em ordem alfabetica.`
            : `${visibleStudents.length} alunos em ordem alfabetica para operacao diaria, credenciais e acesso.`
        }
        actions={
          <>
            <Button data-testid="export-students-excel-btn" onClick={() => { api.exportStudentsExcel(); toast.success('Exportando Excel...'); }} size="sm">
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </Button>
            <Button data-testid="export-students-pdf-btn" onClick={() => { api.exportStudentsPdf(); toast.success('Exportando PDF...'); }} size="sm">
              <FileText className="h-4 w-4" />
              PDF
            </Button>
            {canManageStudents ? (
              <Button data-testid="add-student-btn" onClick={openCreate} size="sm" variant="primary">
                <Plus className="h-4 w-4" />
                Novo aluno
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Ativos" value={studentStats.active} icon={User} accent="success" />
        <StatCard label="Inativos" value={studentStats.inactive} icon={User} accent="danger" />
        <StatCard label="Login liberado" value={studentStats.withLogin} icon={ShieldCheck} accent="info" />
        <StatCard label="Biometria cadastrada" value={studentStats.withBiometry} icon={Fingerprint} accent="warning" />
        <StatCard label="Uso recente" value={studentStats.activeRecent} icon={Users} accent="success" />
        <StatCard label="Sem uso recente" value={studentStats.inactiveRecent} icon={Users} accent="warning" />
      </div>

      {credentialPanel ? (
        <CredentialPanel
          title={credentialPanel.title}
          description={credentialPanel.description}
          fields={credentialPanel.fields}
          onClose={() => setCredentialPanel(null)}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard title="Busca e filtros" description="Use busca rapida, status e uso operacional real sem poluir a listagem.">
          <div className="grid gap-3 md:grid-cols-[minmax(280px,1fr)_220px_240px]">
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail, CPF, matricula ou RFID"
            />
            <SelectField label="" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
              <option value="">Todos os status</option>
              <option value="ativo">Ativos</option>
              <option value="inativo">Inativos</option>
            </SelectField>
            <SelectField label="" value={usageFilter} onChange={(event) => setUsageFilter(event.target.value)}>
              <option value="">Todo uso operacional</option>
              <option value="active_recent">Uso recente</option>
              <option value="inactive_recent">Sem uso recente</option>
              <option value="unknown">Sem historico</option>
            </SelectField>
          </div>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            O uso operacional considera ultima catraca autorizada ou presenca manual, sem alterar o status financeiro do aluno. Datas em {SAO_PAULO_TIME_ZONE}.
          </p>
        </SectionCard>

        <SectionCard
          title="Credenciais sensiveis"
          description="Reabra logins e senhas temporarias geradas recentemente."
          actions={
            credentialHistory.length ? (
              <Button size="sm" variant="secondary" onClick={clearStudentCredentialHistory}>
                Limpar historico
              </Button>
            ) : null
          }
        >
          {credentialHistory.length > 0 ? (
            <div className="space-y-3">
              {credentialHistory.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{item.title}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {item.created_at ? formatDateTime(item.created_at) : '-'}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setCredentialPanel(item)}>
                    Abrir
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="Sem historico de credenciais"
              description="Senhas temporarias e logins copiados nesta tela ficam disponiveis aqui enquanto a sessao estiver ativa."
            />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Base de alunos" description="Lista operacional com leitura rapida de plano, status, uso real e vencimento." bodyClassName="p-0">
        {visibleStudents.length > 0 ? (
          <div className="overflow-x-auto">
            <table data-testid="students-table" className="w-full min-w-[1120px] text-sm">
              <thead>
                <tr className="border-b border-[var(--surface-border)] text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  <th className="px-5 py-4">Aluno</th>
                  <th className="px-5 py-4">CPF</th>
                  <th className="px-5 py-4">Plano</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Uso real</th>
                  <th className="px-5 py-4">Vencimento</th>
                  <th className="px-5 py-4 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {visibleStudents.map((student) => (
                  <tr key={student.student_id} className="border-b border-[var(--surface-border)] hover:bg-[var(--surface-soft)]">
                    <td className="px-5 py-4">
                      <button type="button" onClick={() => viewStudent(student)} className="text-left">
                        <p className="font-semibold text-[var(--text-primary)]">{student.nome}</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">{student.email || 'Sem e-mail'}</p>
                      </button>
                    </td>
                    <td className="px-5 py-4 text-[var(--text-secondary)]">{student.cpf || '-'}</td>
                    <td className="px-5 py-4 text-[var(--text-secondary)]">{getPlanName(student.plano_id)}</td>
                    <td className="px-5 py-4">
                      <StatusBadge label={String(student.status || '').toLowerCase() === 'ativo' ? 'Ativo' : 'Inativo'} tone={statusTone(student.status)} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-1">
                        <StatusBadge label={usageLabel(student.operational_usage_status)} tone={usageTone(student.operational_usage_status)} />
                        <p className="text-xs text-[var(--text-muted)]">
                          {student.last_real_usage_at ? formatDateTime(student.last_real_usage_at) : 'Sem registro operacional'}
                        </p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-[var(--text-secondary)]">
                      {student.data_vencimento ? formatDateOnly(student.data_vencimento) : '-'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => viewStudent(student)}>
                          Ver
                        </Button>
                        {canManageStudents ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(student)}>
                              <Pencil className="h-4 w-4" />
                              Editar
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => askDelete(student.student_id, student.nome)}>
                              <Trash2 className="h-4 w-4" />
                              Remover
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={Users}
              title="Nenhum aluno encontrado"
              description={
                search || filterStatus || usageFilter
                  ? 'Ajuste a busca ou os filtros para localizar outro aluno.'
                  : 'Cadastre o primeiro aluno para iniciar a operacao.'
              }
            />
          </div>
        )}
      </SectionCard>

      <SidePanel
        open={Boolean(selectedStudent)}
        onClose={closeDetail}
        title={selectedStudent ? selectedStudent.nome : 'Detalhes do aluno'}
        description="Dados fisicos, credenciais e passkeys do aluno sem trocar de contexto."
        actions={
          <Button variant="ghost" onClick={closeDetail}>
            Fechar
          </Button>
        }
      >
        {selectedStudent ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={String(selectedStudent.status || '').toLowerCase() === 'ativo' ? 'Ativo' : 'Inativo'} tone={statusTone(selectedStudent.status)} />
              <StatusBadge label={usageLabel(selectedStudent.operational_usage_status)} tone={usageTone(selectedStudent.operational_usage_status)} />
              <StatusBadge label={selectedStudent.auth_login_enabled !== false ? 'Login liberado' : 'Sem login'} tone={selectedStudent.auth_login_enabled !== false ? 'info' : 'neutral'} />
            </div>

            <div className="grid gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4 md:grid-cols-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Contato</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{selectedStudent.email || 'Sem e-mail'}</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{selectedStudent.cpf || '-'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Plano</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{getPlanName(selectedStudent.plano_id)}</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Vence em {selectedStudent.data_vencimento ? formatDateOnly(selectedStudent.data_vencimento) : '-'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Uso operacional</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{usageLabel(selectedStudent.operational_usage_status)}</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  Ultimo registro: {selectedStudent.last_real_usage_at ? formatDateTime(selectedStudent.last_real_usage_at) : 'Sem historico'}
                </p>
              </div>
            </div>

            <SectionCard title="Indicadores fisicos" description="Edicao rapida com salvamento por campo ao perder o foco.">
              <div className="grid gap-4 md:grid-cols-2">
                <TextField label="Peso (kg)" type="number" step="0.1" defaultValue={selectedStudent.peso_kg ?? selectedStudent.peso ?? ''} onBlur={(event) => saveStudentDetails({ peso_kg: parseFloat(event.target.value) || 0 })} />
                <TextField label="Idade" type="number" defaultValue={selectedStudent.idade || ''} onBlur={(event) => saveStudentDetails({ idade: parseInt(event.target.value, 10) || 0 })} />
                <TextField label="Altura (cm)" type="number" step="0.1" defaultValue={selectedStudent.altura_cm ?? selectedStudent.altura ?? ''} onBlur={(event) => saveStudentDetails({ altura_cm: parseFloat(event.target.value) || 0 })} />
                <TextField label="Frequencia semanal" type="number" defaultValue={selectedStudent.dias_frequencia ?? selectedStudent.dias_presenca ?? 0} onBlur={(event) => saveStudentDetails({ dias_frequencia: parseInt(event.target.value, 10) || 0 })} />
              </div>
              <label className="mt-4 block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Treino e observacoes</span>
                <textarea defaultValue={selectedStudent.treino || ''} onBlur={(event) => saveStudentDetails({ treino: event.target.value })} className="min-h-[112px] w-full rounded-md border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-3 py-3 text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]" />
              </label>
            </SectionCard>

            <SectionCard
              title="Passkeys e biometria"
              description="Registro WebAuthn e leitura das credenciais modernas do aluno."
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={registerPasskey}>Registrar passkey</Button>
                  <Button size="sm" variant="ghost" onClick={refreshPasskeys}>Atualizar</Button>
                </div>
              }
            >
              <Banner tone="info" title="Credenciais modernas" description={`Passkeys registradas: ${passkeys.length}. Biometria vinculada: ${selectedStudent.biometria_id || 'nao informada'}.`} />
              <div className="mt-4 space-y-3">
                {passkeys.length > 0 ? passkeys.map((passkey, index) => (
                  <div key={`${passkey.id}-${index}`} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4">
                    <p className="font-mono text-xs text-[var(--text-primary)]">{passkey.id}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">Criado em {formatDateTime(passkey.created_at)}</p>
                  </div>
                )) : <EmptyState icon={Fingerprint} title="Sem passkeys registradas" description="Registre uma passkey neste painel para habilitar autenticacao moderna do aluno." />}
              </div>
            </SectionCard>
          </div>
        ) : null}
      </SidePanel>

      <Dialog
        open={Boolean(formMode)}
        onClose={() => setFormMode('')}
        size="lg"
        title={formMode === 'create' ? 'Novo aluno' : 'Editar aluno'}
        description="Cadastre dados cadastrais, credenciais e contexto fisico do aluno em um unico fluxo."
        actions={
          <>
            {formMode === 'edit' ? (
              <Button type="button" variant="ghost" onClick={handleRegisterBiometria}>
                Registrar biometria
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => setFormMode('')}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => document.getElementById('student-form')?.requestSubmit()}>
              {saving ? 'Salvando...' : 'Salvar aluno'}
            </Button>
          </>
        }
      >
        <form id="student-form" onSubmit={handleSave} className="space-y-4">
          <StudentFormFields form={form} setForm={setForm} plans={plans} />
        </form>
      </Dialog>

      <Dialog
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        size="sm"
        title={confirmAction?.title}
        description={confirmAction?.description}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>Voltar</Button>
            <Button variant="danger" onClick={async () => {
              try {
                await confirmAction?.run?.();
                setConfirmAction(null);
              } catch (err) {
                toast.error(err?.message || 'Falha ao executar acao.');
              }
            }}>
              {confirmAction?.actionLabel || 'Confirmar'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">A lista sera atualizada automaticamente apos a resposta do backend.</p>
      </Dialog>
    </div>
  );
}
