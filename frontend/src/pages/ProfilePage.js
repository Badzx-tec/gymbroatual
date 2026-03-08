import React, { useEffect, useMemo, useState } from 'react';
import { ImagePlus, Lock, Palette, ShieldCheck, User } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import Banner from '../components/ui/Banner';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import LoadingScreen from '../components/ui/LoadingScreen';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import StatCard from '../components/ui/StatCard';
import TextField from '../components/ui/TextField';
import {
  COLOR_MODES,
  BRAND_THEMES,
  applyBrandingToDocument,
  normalizeBranding,
  saveBranding,
} from '../branding';
import { updateStoredUser } from '../lib/session';
import { roleLabel } from '../utils/labels';

const MAX_LOGO_SIZE_BYTES = 800 * 1024;

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState('');
  const [actorType, setActorType] = useState('owner');
  const [role, setRole] = useState('OWNER');
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    phone: '',
    gym_name: '',
    plan_id: '',
    plan_expires_at: null,
    auth_login_enabled: true,
    theme_key: 'lime',
    color_mode: 'dark',
    logo_data_url: null,
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const canManageBranding = useMemo(() => actorType === 'owner', [actorType]);
  const isStudent = actorType === 'student';
  const isEmployee = actorType === 'employee';

  const loadProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.profileMe();
      const branding = normalizeBranding(data.branding || {});
      setActorType(data.actor_type || 'owner');
      setRole((data.role || 'OWNER').toUpperCase());
      setProfile({
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        gym_name: data.gym_name || '',
        plan_id: data.plan_id || '',
        plan_expires_at: data.plan_expires_at || null,
        auth_login_enabled: data.auth_login_enabled !== false,
        theme_key: branding.theme_key,
        color_mode: branding.color_mode,
        logo_data_url: branding.logo_data_url,
      });
      applyBrandingToDocument(branding);
      saveBranding(branding);
    } catch (err) {
      const message = err?.message || 'Erro ao carregar perfil';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const updateLocalUser = (name, email) => {
    updateStoredUser((currentUser) => ({ ...currentUser, name, email }));
  };

  const onLogoFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione uma imagem valida.');
      return;
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      toast.error('Logo muito grande. O limite e 800 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const logoDataUrl = String(reader.result || '');
      setProfile((prev) => ({ ...prev, logo_data_url: logoDataUrl }));
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const payload = {
        name: profile.name,
        email: profile.email,
        phone: profile.phone || null,
      };
      if (canManageBranding) {
        payload.gym_name = profile.gym_name;
        payload.theme_key = profile.theme_key;
        payload.color_mode = profile.color_mode;
        payload.logo_data_url = profile.logo_data_url || null;
      }

      const updated = await api.updateProfile(payload);
      const branding = normalizeBranding(updated.branding || {
        theme_key: profile.theme_key,
        color_mode: profile.color_mode,
        logo_data_url: profile.logo_data_url,
      });
      applyBrandingToDocument(branding);
      saveBranding(branding);
      setProfile((prev) => ({
        ...prev,
        name: updated.name || prev.name,
        email: updated.email || prev.email,
        phone: updated.phone || '',
        gym_name: updated.gym_name || prev.gym_name,
        plan_id: updated.plan_id || prev.plan_id,
        plan_expires_at: updated.plan_expires_at || prev.plan_expires_at,
        auth_login_enabled: updated.auth_login_enabled !== false,
        theme_key: branding.theme_key,
        color_mode: branding.color_mode,
        logo_data_url: branding.logo_data_url,
      }));
      updateLocalUser(updated.name || profile.name, updated.email || profile.email);
      toast.success('Perfil atualizado com sucesso.');
    } catch (err) {
      toast.error(err?.message || 'Erro ao atualizar perfil');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      toast.error('A confirmacao da nova senha nao confere.');
      return;
    }
    setSavingPassword(true);
    try {
      await api.changeMyPassword({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      toast.success('Senha atualizada com sucesso.');
    } catch (err) {
      toast.error(err?.message || 'Erro ao atualizar senha');
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return <LoadingScreen label="Carregando configuracoes..." />;
  }

  const activeTheme = BRAND_THEMES.find((item) => item.key === profile.theme_key) || BRAND_THEMES[0];
  const activeColorMode = COLOR_MODES.find((item) => item.key === profile.color_mode) || COLOR_MODES[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuracoes"
        title="Perfil e preferencias"
        subtitle="Atualize seus dados, senha e identidade visual da academia em uma unica tela."
      />

      {error ? <Banner tone="danger" title="Falha ao carregar perfil" description={error} /> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Perfil atual"
          value={roleLabel(role)}
          hint={profile.gym_name || 'Sem academia vinculada'}
          icon={User}
          accent="info"
        />
        <StatCard
          label="Email de acesso"
          value={profile.email || '-'}
          hint="Usado para entrar na plataforma."
          icon={ShieldCheck}
          accent="success"
          className="xl:col-span-2"
        />
        <StatCard
          label="Tema ativo"
          value={activeColorMode.label}
          hint={`${activeTheme.label}. ${canManageBranding ? 'Pode ser alterado abaixo.' : 'Branding controlado pela academia.'}`}
          icon={Palette}
          accent="info"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <form onSubmit={saveProfile} className="space-y-6">
          <SectionCard
            title="Informacoes da conta"
            description="Esses dados aparecem no painel e sustentam comunicacoes e login."
            actions={(
              <Button type="submit" variant="primary" disabled={savingProfile}>
                {savingProfile ? 'Salvando...' : 'Salvar perfil'}
              </Button>
            )}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Nome"
                value={profile.name}
                onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Seu nome completo"
                required
              />
              <TextField
                label="Email"
                type="email"
                value={profile.email}
                onChange={(event) => setProfile((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="voce@academia.com"
                required
              />
              <TextField
                label="Telefone"
                value={profile.phone}
                onChange={(event) => setProfile((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="(00) 00000-0000"
              />
              {canManageBranding ? (
                <TextField
                  label="Nome da academia"
                  value={profile.gym_name}
                  onChange={(event) => setProfile((prev) => ({ ...prev, gym_name: event.target.value }))}
                  placeholder="Nome comercial da academia"
                  required
                />
              ) : null}
              {isStudent ? (
                <>
                  <InfoTile label="Plano vinculado" value={profile.plan_id || '-'} />
                  <InfoTile label="Validade do plano" value={profile.plan_expires_at ? new Date(profile.plan_expires_at).toLocaleString('pt-BR') : '-'} />
                </>
              ) : null}
              {isStudent ? (
                <InfoTile label="Login do aluno" value={profile.auth_login_enabled ? 'Ativo' : 'Desativado'} />
              ) : null}
              {isEmployee ? (
                <InfoTile label="Escopo da conta" value="Credenciais e dados pessoais" />
              ) : null}
            </div>
          </SectionCard>
        </form>

        <div className="space-y-6">
          <SectionCard title="Seguranca" description="Troque a senha de acesso com confirmacao local antes do envio.">
            <form onSubmit={savePassword} className="space-y-4">
              <TextField
                label="Senha atual"
                type="password"
                value={passwordForm.current_password}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, current_password: event.target.value }))}
                placeholder="Digite sua senha atual"
                required
              />
              <TextField
                label="Nova senha"
                type="password"
                value={passwordForm.new_password}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, new_password: event.target.value }))}
                placeholder="Minimo de 8 caracteres"
                required
              />
              <TextField
                label="Confirmar nova senha"
                type="password"
                value={passwordForm.confirm_password}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirm_password: event.target.value }))}
                placeholder="Repita a nova senha"
                required
              />
              <Button type="submit" variant="secondary" disabled={savingPassword}>
                <Lock className="h-4 w-4" />
                {savingPassword ? 'Atualizando...' : 'Atualizar senha'}
              </Button>
            </form>
          </SectionCard>

          {canManageBranding ? (
            <SectionCard title="Branding da academia" description="Escolha o tema e a marca que serao aplicados no admin e no portal do aluno.">
              <div className="space-y-5">
                <div className="flex items-start gap-4 rounded-2xl border border-zinc-900 bg-zinc-950/70 p-4">
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950">
                    {profile.logo_data_url ? (
                      <img src={profile.logo_data_url} alt="Logo da academia" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Sem logo</span>
                    )}
                  </div>
                  <div className="space-y-3">
                    <p className="text-sm text-zinc-400">PNG, JPG, WEBP ou SVG com ate 800 KB.</p>
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-100 hover:bg-zinc-800">
                        <ImagePlus className="h-4 w-4" />
                        Enviar logo
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogoFile} className="hidden" />
                      </label>
                      <Button type="button" variant="danger" onClick={() => setProfile((prev) => ({ ...prev, logo_data_url: null }))}>
                        Remover logo
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {BRAND_THEMES.map((theme) => (
                    <button
                      key={theme.key}
                      type="button"
                      onClick={() => {
                        const nextBranding = { theme_key: theme.key, color_mode: profile.color_mode, logo_data_url: profile.logo_data_url };
                        setProfile((prev) => ({ ...prev, theme_key: theme.key }));
                        applyBrandingToDocument(nextBranding);
                      }}
                      className={`rounded-2xl border px-4 py-4 text-left transition-colors ${profile.theme_key === theme.key ? 'border-[var(--brand-primary)] bg-zinc-900 text-zinc-100' : 'border-zinc-900 bg-zinc-950/70 text-zinc-400 hover:border-zinc-800 hover:text-zinc-200'}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="h-4 w-4 rounded-full" style={{ backgroundColor: theme.primary }} />
                        <span className="text-sm font-semibold uppercase tracking-[0.16em]">{theme.label}</span>
                      </div>
                      <p className="mt-2 text-xs text-current/80">Tema principal aplicado ao shell, acoes e destaques.</p>
                    </button>
                  ))}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Modo da interface</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {COLOR_MODES.map((mode) => (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() => {
                          const nextBranding = { theme_key: profile.theme_key, color_mode: mode.key, logo_data_url: profile.logo_data_url };
                          setProfile((prev) => ({ ...prev, color_mode: mode.key }));
                          applyBrandingToDocument(nextBranding);
                        }}
                        className={`rounded-2xl border px-4 py-4 text-left transition-colors ${profile.color_mode === mode.key ? 'border-[var(--brand-primary)] bg-[var(--surface-soft)] text-[var(--text-primary)]' : 'border-[var(--surface-border)] bg-[var(--surface-canvas)] text-[var(--text-secondary)] hover:border-[var(--surface-border-strong)] hover:text-[var(--text-primary)]'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold uppercase tracking-[0.16em]">{mode.label}</span>
                          <span className={`h-4 w-4 rounded-full border ${mode.key === 'light' ? 'border-slate-300 bg-white' : 'border-zinc-700 bg-zinc-950'}`} />
                        </div>
                        <p className="mt-2 text-xs text-current/80">{mode.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="Branding da academia" description="As cores e a marca desta conta sao controladas pelo dono da academia.">
              <EmptyState
                icon={Palette}
                title="Branding bloqueado para este perfil"
                description="Recepcionistas, treinadores e alunos apenas visualizam a identidade visual e o modo claro/escuro definidos pela academia."
              />
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm text-zinc-100">{value}</p>
    </div>
  );
}
