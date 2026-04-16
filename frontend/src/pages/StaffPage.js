import React, { useEffect, useMemo, useState } from 'react';
import {
  Fingerprint,
  KeyRound,
  Lock,
  MailPlus,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import TableActionMenu from '../components/ui/TableActionMenu';
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
import { roleLabel } from '../utils/labels';
import {
  clearCredentialHistory,
  loadCredentialHistory,
  pushCredentialHistory,
} from '../utils/credentialHistory';

const ROLE_OPTIONS = [
  { value: 'MANAGER', label: 'Diretor' },
  { value: 'RECEPTION', label: 'Recepcionista' },
  { value: 'TRAINER', label: 'Treinador' },
];

const emptyEmployeeForm = {
  name: '',
  email: '',
  password: '',
  role: 'RECEPTION',
  matricula: '',
  tag_rfid: '',
  biometria_id: '',
  keypad_code: '',
  sync_shadow_student: true,
};

const STAFF_CREDENTIAL_HISTORY_KEY = 'gymbro_staff_credentials_history';

function buildEmployeeForm(employee) {
  return {
    name: employee?.name || '',
    email: employee?.email || '',
    password: '',
    role: employee?.role || 'RECEPTION',
    matricula: employee?.matricula || '',
    tag_rfid: employee?.tag_rfid || '',
    biometria_id: employee?.biometria_id || '',
    keypad_code: employee?.keypad_code || '',
    sync_shadow_student: true,
    is_active: employee?.is_active !== false,
  };
}

function buildCredentialsForm(employee) {
  return {
    matricula: employee?.matricula || '',
    tag_rfid: employee?.tag_rfid || '',
    biometria_id: employee?.biometria_id || '',
    keypad_code: employee?.keypad_code || '',
    sync_shadow_student: true,
  };
}

function roleTone(role) {
  const normalized = String(role || '').toUpperCase();
  if (normalized === 'MANAGER') return 'info';
  if (normalized === 'RECEPTION') return 'warning';
  if (normalized === 'TRAINER') return 'success';
  return 'neutral';
}

function countConfiguredCredentials(employee) {
  return ['biometria_id', 'tag_rfid', 'keypad_code', 'matricula'].filter((key) => Boolean(employee?.[key]))
    .length;
}

function credentialsSummary(employee) {
  const total = countConfiguredCredentials(employee);
  if (!total) return 'Sem credenciais';
  if (total === 4) return 'Kit completo';
  return `${total} de 4 credenciais`;
}

function employeeFilterMatcher(employee, query) {
  if (!query) return true;
  const haystack = [
    employee?.name,
    employee?.email,
    employee?.matricula,
    employee?.tag_rfid,
    employee?.biometria_id,
    employee?.role,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function EmployeeFields({ model, onChange, includePassword = false, includeActive = false }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <TextField
          label="Nome"
          value={model.name}
          onChange={(event) => onChange('name', event.target.value)}
          placeholder="Nome completo do funcionario"
          required
        />
        <TextField
          label="E-mail"
          type="email"
          value={model.email}
          onChange={(event) => onChange('email', event.target.value)}
          placeholder="login@academia.com"
        />
      </div>

      {includePassword ? (
        <TextField
          label="Senha inicial"
          value={model.password}
          onChange={(event) => onChange('password', event.target.value)}
          placeholder="Deixe em branco para gerar automaticamente"
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SelectField
          label="Perfil"
          value={model.role}
          onChange={(event) => onChange('role', event.target.value)}
        >
          {ROLE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Matricula"
          value={model.matricula}
          onChange={(event) => onChange('matricula', event.target.value)}
          placeholder="FUNC0001"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TextField
          label="Tag RFID"
          value={model.tag_rfid}
          onChange={(event) => onChange('tag_rfid', event.target.value)}
          placeholder="Tag ou cartao"
        />
        <TextField
          label="Biometria"
          value={model.biometria_id}
          onChange={(event) => onChange('biometria_id', event.target.value)}
          placeholder="ID retornado pela Toletus"
        />
        <TextField
          label="Codigo de teclado"
          value={model.keypad_code}
          onChange={(event) => onChange('keypad_code', event.target.value)}
          placeholder="Codigo numerico"
        />
      </div>

      <div className="grid gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-4 md:grid-cols-2">
        <label className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={Boolean(model.sync_shadow_student)}
            onChange={(event) => onChange('sync_shadow_student', event.target.checked)}
            className="mt-1 accent-[var(--brand-primary)]"
          />
          <span>
            <strong className="block text-[var(--text-primary)]">Sincronizar aluno tecnico</strong>
            Mantem compatibilidade com fluxos antigos de biometria e acesso.
          </span>
        </label>

        {includeActive ? (
          <label className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={Boolean(model.is_active)}
              onChange={(event) => onChange('is_active', event.target.checked)}
              className="mt-1 accent-[var(--brand-primary)]"
            />
            <span>
              <strong className="block text-[var(--text-primary)]">Funcionario ativo</strong>
              Desative para impedir login e operacao sem remover o cadastro.
            </span>
          </label>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--surface-border)] px-4 py-3 text-sm text-[var(--text-muted)]">
            E-mail permite login no painel. Sem senha informada, o sistema gera uma senha temporaria.
          </div>
        )}
      </div>
    </div>
  );
}

export default function StaffPage() {
  const [employees, setEmployees] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyEmployeeForm);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'RECEPTION' });
  const [creatingEmployee, setCreatingEmployee] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [editForm, setEditForm] = useState(() => ({ ...emptyEmployeeForm, is_active: true }));
  const [savingEdit, setSavingEdit] = useState(false);
  const [credentialsEditor, setCredentialsEditor] = useState(null);
  const [credentialsForm, setCredentialsForm] = useState(() => buildCredentialsForm(null));
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [biometryFlow, setBiometryFlow] = useState(null);
  const [runningBiometry, setRunningBiometry] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [credentialPanel, setCredentialPanel] = useState(null);
  const [credentialHistory, setCredentialHistory] = useState(() =>
    loadCredentialHistory(STAFF_CREDENTIAL_HISTORY_KEY)
  );
  const [passwordEditor, setPasswordEditor] = useState(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const openCredentialPanel = (payload) => {
    if (!payload?.fields?.length) return;
    const entry = {
      ...payload,
      id: `cred_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
    };
    setCredentialPanel(entry);
    setCredentialHistory(pushCredentialHistory(STAFF_CREDENTIAL_HISTORY_KEY, entry, 12));
  };

  const clearCredentialPanels = () => {
    clearCredentialHistory(STAFF_CREDENTIAL_HISTORY_KEY);
    setCredentialHistory([]);
    toast.success('Historico de credenciais limpo.');
  };

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const [employeesRes, invitesRes] = await Promise.allSettled([
      api.listEmployees(),
      api.listStaffInvites(),
    ]);

    if (employeesRes.status === 'fulfilled') {
      const sorted = [...(employeesRes.value || [])].sort((left, right) =>
        String(left?.name || '').localeCompare(String(right?.name || ''), 'pt-BR')
      );
      setEmployees(sorted);
    } else if (!silent) {
      toast.error(employeesRes.reason?.message || 'Erro ao carregar funcionarios.');
    }

    if (invitesRes.status === 'fulfilled') {
      setInvites(invitesRes.value || []);
    } else {
      setInvites([]);
      const inviteErr = invitesRes.reason;
      if (!silent && inviteErr?.status !== 403) {
        toast.error(inviteErr?.message || 'Erro ao carregar convites.');
      }
    }

    if (!silent) setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const employeeStats = useMemo(() => {
    const total = employees.length;
    const active = employees.filter((item) => item?.is_active !== false).length;
    const withLogin = employees.filter((item) => Boolean(item?.email)).length;
    const withBiometry = employees.filter((item) => Boolean(item?.biometria_id)).length;
    return { total, active, withLogin, withBiometry };
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return employees.filter((employee) => {
      if (!employeeFilterMatcher(employee, normalizedSearch)) return false;
      if (roleFilter && String(employee?.role || '').toUpperCase() !== roleFilter) return false;
      if (statusFilter === 'active' && employee?.is_active === false) return false;
      if (statusFilter === 'inactive' && employee?.is_active !== false) return false;
      return true;
    });
  }, [employees, roleFilter, search, statusFilter]);

  const handleCreateEmployee = async (event) => {
    event.preventDefault();
    setCreatingEmployee(true);
    try {
      const result = await api.createEmployee(form);
      toast.success('Funcionario criado.');

      const fields = [];
      if (result?.email) fields.push({ label: 'Login', value: result.email });
      if (result?.temp_password) {
        fields.push({
          label: form.password ? 'Senha inicial' : 'Senha temporaria',
          value: result.temp_password,
        });
      }
      if (result?.matricula) fields.push({ label: 'Matricula', value: result.matricula });
      if (fields.length) {
        openCredentialPanel({
          title: `Credenciais de ${result.name || form.name}`,
          description: 'Copie e guarde agora. A senha inicial ou temporaria nao sera exibida novamente.',
          fields,
        });
      }
      if (result?.matricula_auto_generated && result?.generated_matricula) {
        toast.success(`Matricula gerada automaticamente: ${result.generated_matricula}`);
      }
      if (result?.shadow_student_id) {
        toast.success(`Compatibilidade ativada. Aluno tecnico: ${result.shadow_student_id}`);
      }
      if (result?.shadow_sync_warning) toast.warning(result.shadow_sync_warning);

      setForm(emptyEmployeeForm);
      await load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Nao foi possivel criar o funcionario.');
    } finally {
      setCreatingEmployee(false);
    }
  };

  const handleCreateInvite = async (event) => {
    event.preventDefault();
    setCreatingInvite(true);
    try {
      await api.createStaffInvite(inviteForm);
      toast.success('Convite criado.');
      setInviteForm({ email: '', role: 'RECEPTION' });
      await load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Nao foi possivel criar o convite.');
    } finally {
      setCreatingInvite(false);
    }
  };

  const openEditPanel = (employee) => {
    setEditingEmployee(employee);
    setEditForm(buildEmployeeForm(employee));
  };

  const saveEmployeeEdit = async (event) => {
    event.preventDefault();
    if (!editingEmployee) return;
    setSavingEdit(true);
    try {
      const result = await api.updateEmployee(editingEmployee.employee_id, editForm);
      toast.success('Funcionario atualizado.');
      if (result?.shadow_sync_warning) toast.warning(result.shadow_sync_warning);
      setEditingEmployee(null);
      await load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Nao foi possivel atualizar o funcionario.');
    } finally {
      setSavingEdit(false);
    }
  };

  const openPasswordEditor = (employee) => {
    setPasswordEditor(employee);
    setPasswordDraft('');
  };

  const submitPasswordUpdate = async (event) => {
    event.preventDefault();
    if (!passwordEditor) return;
    setSavingPassword(true);
    try {
      const trimmedPassword = passwordDraft.trim();
      const result = await api.resetEmployeePassword(
        passwordEditor.employee_id,
        trimmedPassword ? { new_password: trimmedPassword } : {}
      );
      toast.success(trimmedPassword ? 'Senha atualizada.' : 'Senha temporaria gerada.');

      const fields = [];
      if (passwordEditor?.email) fields.push({ label: 'Login', value: passwordEditor.email });
      if (result?.temp_password) {
        fields.push({
          label: trimmedPassword ? 'Nova senha' : 'Senha temporaria',
          value: result.temp_password,
        });
      }
      if (fields.length) {
        openCredentialPanel({
          title: `Acesso de ${passwordEditor.name}`,
          description: trimmedPassword
            ? 'Copie a nova senha e entregue ao funcionario por um canal seguro.'
            : 'Copie e entregue a senha temporaria agora. Ela nao sera exibida novamente.',
          fields,
        });
      }

      setPasswordEditor(null);
      setPasswordDraft('');
    } catch (err) {
      toast.error(err?.message || 'Nao foi possivel atualizar a senha.');
    } finally {
      setSavingPassword(false);
    }
  };

  const syncShadowStudent = async (employeeId) => {
    try {
      const result = await api.syncEmployeeShadowStudent(employeeId);
      toast.success(`Sincronizado: ${result.shadow_student_id}`);
      await load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Falha ao sincronizar aluno tecnico.');
    }
  };

  const openCredentialsPanel = (employee) => {
    setCredentialsEditor(employee);
    setCredentialsForm(buildCredentialsForm(employee));
  };

  const saveCredentials = async (event) => {
    event.preventDefault();
    if (!credentialsEditor) return;
    setSavingCredentials(true);
    try {
      const updated = await api.updateEmployeeCredentials(credentialsEditor.employee_id, credentialsForm);
      toast.success(`Credenciais atualizadas para ${updated.name}.`);
      if (updated?.shadow_sync_warning) toast.warning(updated.shadow_sync_warning);
      setCredentialsEditor(null);
      await load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Nao foi possivel atualizar credenciais.');
    } finally {
      setSavingCredentials(false);
    }
  };

  const openBiometryPanel = (employee) => {
    setBiometryFlow({
      employee,
      device_id: 'toletus-unidade-1',
      template: '',
      stage: 'prepare',
    });
  };

  const startBiometry = async () => {
    if (!biometryFlow?.employee) return;
    setRunningBiometry(true);
    try {
      await api.tolletusEmployeeEnrollStart({
        employee_id: biometryFlow.employee.employee_id,
        device_id: biometryFlow.device_id,
      });
      toast.success('Captura iniciada. Cole o template retornado pela catraca.');
      setBiometryFlow((current) => (current ? { ...current, stage: 'confirm' } : current));
    } catch (err) {
      toast.error(err?.message || 'Nao foi possivel iniciar a captura.');
    } finally {
      setRunningBiometry(false);
    }
  };

  const confirmBiometry = async () => {
    if (!biometryFlow?.employee || !biometryFlow?.template) return;
    setRunningBiometry(true);
    try {
      const result = await api.tolletusEmployeeEnrollConfirm({
        employee_id: biometryFlow.employee.employee_id,
        device_id: biometryFlow.device_id,
        template: biometryFlow.template,
        external_id: biometryFlow.template,
      });
      await api.updateEmployeeCredentials(biometryFlow.employee.employee_id, {
        biometria_id: result.biometria_id || biometryFlow.template,
        sync_shadow_student: true,
      });
      toast.success('Biometria cadastrada e vinculada.');
      setBiometryFlow(null);
      await load({ silent: true });
    } catch (err) {
      toast.error(err?.message || 'Nao foi possivel confirmar a biometria.');
    } finally {
      setRunningBiometry(false);
    }
  };

  const runConfirmAction = async () => {
    if (!confirmAction?.run) return;
    try {
      await confirmAction.run();
      setConfirmAction(null);
    } catch (err) {
      toast.error(err?.message || 'Nao foi possivel concluir a acao.');
    }
  };

  const askDeleteEmployee = (employee) => {
    setConfirmAction({
      title: 'Remover funcionario',
      description: `Essa acao remove ${employee.name} da equipe e nao pode ser desfeita.`,
      actionLabel: 'Remover',
      tone: 'danger',
      run: async () => {
        await api.deleteEmployee(employee.employee_id);
        toast.success('Funcionario removido.');
        await load({ silent: true });
      },
    });
  };

  const askToggleEmployee = (employee) => {
    const willDeactivate = employee?.is_active !== false;
    setConfirmAction({
      title: willDeactivate ? 'Desativar funcionario' : 'Reativar funcionario',
      description: willDeactivate
        ? `O acesso de ${employee.name} ao painel e a operacao sera interrompido.`
        : `O acesso de ${employee.name} voltara a ficar disponivel.`,
      actionLabel: willDeactivate ? 'Desativar' : 'Reativar',
      tone: willDeactivate ? 'danger' : 'primary',
      run: async () => {
        if (willDeactivate) {
          await api.deactivateEmployee(employee.employee_id);
        } else {
          await api.updateEmployee(employee.employee_id, {
            ...buildEmployeeForm(employee),
            is_active: true,
          });
        }
        toast.success(willDeactivate ? 'Funcionario desativado.' : 'Funcionario reativado.');
        await load({ silent: true });
      },
    });
  };

  const askCancelInvite = (invite) => {
    setConfirmAction({
      title: 'Cancelar convite',
      description: `O convite enviado para ${invite.email} sera invalidado imediatamente.`,
      actionLabel: 'Cancelar convite',
      tone: 'danger',
      run: async () => {
        await api.cancelStaffInvite(invite.invite_id);
        toast.success('Convite cancelado.');
        await load({ silent: true });
      },
    });
  };

  if (loading) {
    return <LoadingScreen label="Carregando equipe..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operacao"
        title="Equipe"
        subtitle="Gerencie perfis, credenciais de acesso e compatibilidade operacional sem fluxo improvisado."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => load()}>
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
            {credentialHistory.length > 0 ? (
              <Button size="sm" variant="secondary" onClick={clearCredentialPanels}>
                Limpar historico
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total da equipe"
          value={employeeStats.total}
          hint="Funcionarios cadastrados na academia"
          icon={Users}
        />
        <StatCard
          label="Ativos"
          value={employeeStats.active}
          hint="Com acesso operacional liberado"
          accent="success"
          icon={ShieldCheck}
        />
        <StatCard
          label="Com login"
          value={employeeStats.withLogin}
          hint="Podem acessar o painel com e-mail"
          accent="info"
          icon={KeyRound}
        />
        <StatCard
          label="Biometria cadastrada"
          value={employeeStats.withBiometry}
          hint="Prontos para a catraca biometrica"
          accent="warning"
          icon={Fingerprint}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          title="Novo funcionario"
          description="Cadastre o colaborador com perfil, login e credenciais operacionais."
        >
          <form onSubmit={handleCreateEmployee} className="space-y-4">
            <EmployeeFields
              model={form}
              includePassword
              onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[var(--text-muted)]">
                Diretor, recepcionista e treinador herdam as permissoes do RBAC ja configurado no backend.
              </p>
              <Button type="submit" variant="primary" disabled={creatingEmployee}>
                <UserPlus className="h-4 w-4" />
                {creatingEmployee ? 'Criando...' : 'Criar funcionario'}
              </Button>
            </div>
          </form>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard
            title="Convite por e-mail"
            description="Use convite quando quiser liberar o onboarding do funcionario com antecedencia."
          >
            <form onSubmit={handleCreateInvite} className="space-y-4">
              <TextField
                label="E-mail do convite"
                type="email"
                value={inviteForm.email}
                onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="colaborador@academia.com"
                required
              />
              <SelectField
                label="Perfil"
                value={inviteForm.role}
                onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value }))}
              >
                {ROLE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </SelectField>
              <Button type="submit" variant="secondary" disabled={creatingInvite}>
                <MailPlus className="h-4 w-4" />
                {creatingInvite ? 'Enviando...' : 'Criar convite'}
              </Button>
            </form>
          </SectionCard>

          <SectionCard
            title="Credenciais sensiveis"
            description="Reabra copias recentes quando precisar redistribuir senha ou token."
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
                        {item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : '-'}
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
                icon={ShieldAlert}
                title="Sem historico de credenciais"
                description="Senhas temporarias e tokens abertos nesta tela passam a aparecer aqui enquanto a sessao estiver ativa."
              />
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Base da equipe"
        description="Busque por nome, matricula, credencial ou perfil e opere a equipe sem trocar de tela."
        actions={
          <div className="grid w-full gap-2 md:grid-cols-[minmax(260px,1fr)_180px_180px]">
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail, matricula ou credencial"
            />
            <SelectField
              label=""
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="">Todos os perfis</option>
              {ROLE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label=""
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">Todos os status</option>
              <option value="active">Somente ativos</option>
              <option value="inactive">Somente inativos</option>
            </SelectField>
          </div>
        }
        bodyClassName="p-0"
      >
        {filteredEmployees.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-[var(--surface-border)] text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  <th className="px-5 py-3">Funcionario</th>
                  <th className="px-5 py-3">Perfil</th>
                  <th className="px-5 py-3">Credenciais</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Compatibilidade</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((employee) => {
                  const isActive = employee?.is_active !== false;
                  return (
                    <tr key={employee.employee_id} className="group/row border-b border-[var(--surface-border)] transition-colors hover:bg-[var(--surface-soft)]">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-[var(--text-primary)]">{employee.name}</p>
                        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                          {employee.email || 'Sem login configurado'}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{employee.matricula || '-'}</p>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge label={roleLabel(employee.role)} tone={roleTone(employee.role)} />
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-secondary)]">
                        {credentialsSummary(employee)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge
                          label={isActive ? 'Ativo' : 'Inativo'}
                          tone={isActive ? 'success' : 'danger'}
                        />
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-secondary)]">
                        {employee.shadow_student_id ? 'Sync ativo' : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <TableActionMenu
                          sections={[
                            [
                              { label: 'Editar', icon: Pencil, onClick: () => openEditPanel(employee) },
                            ],
                            [
                              { label: 'Credenciais', icon: KeyRound, onClick: () => openCredentialsPanel(employee) },
                              { label: 'Biometria', icon: Fingerprint, onClick: () => openBiometryPanel(employee) },
                              { label: 'Atualizar senha', icon: Lock, onClick: () => openPasswordEditor(employee) },
                              { label: 'Sync tecnico', icon: RefreshCw, onClick: () => syncShadowStudent(employee.employee_id) },
                            ],
                            [
                              {
                                label: isActive ? 'Desativar' : 'Reativar',
                                icon: isActive ? UserMinus : UserPlus,
                                danger: isActive,
                                onClick: () => askToggleEmployee(employee),
                              },
                              { label: 'Remover', icon: Trash2, danger: true, onClick: () => askDeleteEmployee(employee) },
                            ],
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={UserCog}
              title="Nenhum funcionario encontrado"
              description="Ajuste os filtros ou cadastre o primeiro colaborador para liberar operacao e login."
            />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Convites ativos" description="Convites pendentes antes do primeiro acesso do colaborador.">
        {invites.length > 0 ? (
          <div className="space-y-3">
            {invites.map((invite) => (
              <div
                key={invite.invite_id}
                className="flex flex-col gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{invite.email}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{roleLabel(invite.role)}</p>
                </div>
                <Button size="sm" variant="danger" onClick={() => askCancelInvite(invite)}>
                  Cancelar convite
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={MailPlus}
            title="Sem convites ativos"
            description="Crie um convite quando quiser antecipar o cadastro do colaborador por e-mail."
          />
        )}
      </SectionCard>

      {credentialPanel ? (
        <CredentialPanel
          title={credentialPanel.title}
          description={credentialPanel.description}
          fields={credentialPanel.fields}
          onClose={() => setCredentialPanel(null)}
        />
      ) : null}

      <Dialog
        open={Boolean(passwordEditor)}
        onClose={() => {
          setPasswordEditor(null);
          setPasswordDraft('');
        }}
        size="sm"
        title={passwordEditor ? `Atualizar senha de ${passwordEditor.name}` : 'Atualizar senha'}
        description="Defina uma nova senha agora ou deixe o campo vazio para gerar uma senha temporaria automaticamente."
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPasswordEditor(null);
                setPasswordDraft('');
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => document.getElementById('staff-password-form')?.requestSubmit()}
              disabled={savingPassword}
            >
              {savingPassword
                ? 'Salvando...'
                : passwordDraft.trim()
                  ? 'Salvar nova senha'
                  : 'Gerar senha temporaria'}
            </Button>
          </>
        }
      >
        <form id="staff-password-form" onSubmit={submitPasswordUpdate} className="space-y-4">
          <Banner
            tone="info"
            title="Atualizacao segura de acesso"
            description="Ao salvar, as sessoes atuais do funcionario serao encerradas e a nova senha passa a valer imediatamente."
          />
          <TextField
            label="Nova senha"
            type="password"
            value={passwordDraft}
            onChange={(event) => setPasswordDraft(event.target.value)}
            placeholder="Deixe em branco para gerar uma senha temporaria"
            autoComplete="new-password"
            minLength={6}
          />
          <p className="text-sm text-[var(--text-muted)]">
            Use uma senha definida quando quiser entregar acesso permanente. Para atendimento rapido, deixe em branco e gere uma senha temporaria.
          </p>
        </form>
      </Dialog>

      <SidePanel
        open={Boolean(editingEmployee)}
        onClose={() => setEditingEmployee(null)}
        title={editingEmployee ? `Editar ${editingEmployee.name}` : 'Editar funcionario'}
        description="Ajuste perfil, login e estado operacional sem sair da listagem."
        actions={
          <>
            <Button variant="ghost" onClick={() => setEditingEmployee(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => document.getElementById('staff-edit-form')?.requestSubmit()}
              disabled={savingEdit}
            >
              {savingEdit ? 'Salvando...' : 'Salvar alteracoes'}
            </Button>
          </>
        }
      >
        <form id="staff-edit-form" onSubmit={saveEmployeeEdit} className="space-y-4">
          <EmployeeFields
            model={editForm}
            includeActive
            onChange={(field, value) => setEditForm((current) => ({ ...current, [field]: value }))}
          />
        </form>
      </SidePanel>

      <SidePanel
        open={Boolean(credentialsEditor)}
        onClose={() => setCredentialsEditor(null)}
        title={credentialsEditor ? `Credenciais de ${credentialsEditor.name}` : 'Credenciais'}
        description="Atualize RFID, biometria, teclado e matricula em um unico formulario."
        actions={
          <>
            <Button variant="ghost" onClick={() => setCredentialsEditor(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => document.getElementById('staff-credentials-form')?.requestSubmit()}
              disabled={savingCredentials}
            >
              {savingCredentials ? 'Salvando...' : 'Salvar credenciais'}
            </Button>
          </>
        }
      >
        <form id="staff-credentials-form" onSubmit={saveCredentials} className="space-y-4">
          <Banner
            tone="info"
            title="Compatibilidade operacional"
            description="Esses campos afetam login tecnico, catraca e integracoes legadas da academia."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <TextField
              label="Matricula"
              value={credentialsForm.matricula}
              onChange={(event) =>
                setCredentialsForm((current) => ({ ...current, matricula: event.target.value }))
              }
              placeholder="FUNC0001"
            />
            <TextField
              label="Tag RFID"
              value={credentialsForm.tag_rfid}
              onChange={(event) =>
                setCredentialsForm((current) => ({ ...current, tag_rfid: event.target.value }))
              }
              placeholder="Cartao ou pulseira"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <TextField
              label="ID de biometria"
              value={credentialsForm.biometria_id}
              onChange={(event) =>
                setCredentialsForm((current) => ({ ...current, biometria_id: event.target.value }))
              }
              placeholder="ID retornado pelo dispositivo"
            />
            <TextField
              label="Codigo de teclado"
              value={credentialsForm.keypad_code}
              onChange={(event) =>
                setCredentialsForm((current) => ({ ...current, keypad_code: event.target.value }))
              }
              placeholder="Codigo numerico"
            />
          </div>
          <label className="flex items-start gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={Boolean(credentialsForm.sync_shadow_student)}
              onChange={(event) =>
                setCredentialsForm((current) => ({
                  ...current,
                  sync_shadow_student: event.target.checked,
                }))
              }
              className="mt-1 accent-[var(--brand-primary)]"
            />
            <span>
              <strong className="block text-[var(--text-primary)]">Sincronizar aluno tecnico</strong>
              Atualiza o espelho usado por fluxos antigos de biometria e acesso.
            </span>
          </label>
        </form>
      </SidePanel>

      <SidePanel
        open={Boolean(biometryFlow)}
        onClose={() => setBiometryFlow(null)}
        title={biometryFlow ? `Biometria de ${biometryFlow.employee.name}` : 'Cadastro de biometria'}
        description="O fluxo segue duas etapas: iniciar captura e confirmar o template retornado pela Toletus."
        actions={
          biometryFlow?.stage === 'prepare' ? (
            <>
              <Button variant="ghost" onClick={() => setBiometryFlow(null)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={startBiometry} disabled={runningBiometry}>
                {runningBiometry ? 'Iniciando...' : 'Iniciar captura'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setBiometryFlow(null)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={confirmBiometry}
                disabled={runningBiometry || !biometryFlow?.template}
              >
                {runningBiometry ? 'Confirmando...' : 'Confirmar biometria'}
              </Button>
            </>
          )
        }
      >
        {biometryFlow ? (
          <div className="space-y-4">
            <Banner
              tone={biometryFlow.stage === 'prepare' ? 'info' : 'warning'}
              title={biometryFlow.stage === 'prepare' ? 'Etapa 1: iniciar captura' : 'Etapa 2: confirmar template'}
              description={
                biometryFlow.stage === 'prepare'
                  ? 'Informe o dispositivo Toletus que fara a captura da digital.'
                  : 'Cole o template ou identificador retornado pelo gateway para vincular a credencial.'
              }
            />
            <TextField
              label="ID do dispositivo"
              value={biometryFlow.device_id}
              onChange={(event) =>
                setBiometryFlow((current) => (current ? { ...current, device_id: event.target.value } : current))
              }
              placeholder="toletus-unidade-1"
            />
            {biometryFlow.stage === 'confirm' ? (
              <TextField
                label="Template ou identificador retornado"
                value={biometryFlow.template}
                onChange={(event) =>
                  setBiometryFlow((current) => (current ? { ...current, template: event.target.value } : current))
                }
                placeholder="Cole o retorno do dispositivo"
              />
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      <Dialog
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        size="sm"
        title={confirmAction?.title}
        description={confirmAction?.description}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>
              Voltar
            </Button>
            <Button
              variant={confirmAction?.tone === 'danger' ? 'danger' : 'primary'}
              onClick={runConfirmAction}
            >
              {confirmAction?.actionLabel || 'Confirmar'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          O estado da interface sera atualizado logo apos a resposta do backend.
        </p>
      </Dialog>
    </div>
  );
}
