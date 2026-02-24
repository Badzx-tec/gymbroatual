import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { api } from '../api';
import {
  BRAND_THEMES,
  applyBrandingToDocument,
  normalizeBranding,
  saveBranding,
} from '../branding';

const MAX_LOGO_SIZE_BYTES = 800 * 1024;

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [actorType, setActorType] = useState('owner');
  const [role, setRole] = useState('OWNER');
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    phone: '',
    gym_name: '',
    theme_key: 'lime',
    logo_data_url: null,
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const canManageBranding = useMemo(() => actorType === 'owner', [actorType]);

  const loadProfile = async () => {
    setLoading(true);
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
        theme_key: branding.theme_key,
        logo_data_url: branding.logo_data_url,
      });
      applyBrandingToDocument(branding);
      saveBranding(branding);
    } catch (err) {
      toast.error(err.message || 'Erro ao carregar perfil');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const updateLocalUser = (name, email) => {
    const currentUser = JSON.parse(localStorage.getItem('gymbro_user') || '{}');
    const updatedUser = { ...currentUser, name, email };
    localStorage.setItem('gymbro_user', JSON.stringify(updatedUser));
  };

  const onLogoFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione uma imagem valida');
      return;
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      toast.error('Logo muito grande (maximo 800KB)');
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
        payload.logo_data_url = profile.logo_data_url || null;
      }

      const updated = await api.updateProfile(payload);
      const branding = normalizeBranding(updated.branding || { theme_key: profile.theme_key, logo_data_url: profile.logo_data_url });
      applyBrandingToDocument(branding);
      saveBranding(branding);
      setProfile((prev) => ({
        ...prev,
        name: updated.name || prev.name,
        email: updated.email || prev.email,
        phone: updated.phone || '',
        gym_name: updated.gym_name || prev.gym_name,
        theme_key: branding.theme_key,
        logo_data_url: branding.logo_data_url,
      }));
      updateLocalUser(updated.name || profile.name, updated.email || profile.email);
      toast.success('Perfil atualizado');
    } catch (err) {
      toast.error(err.message || 'Erro ao atualizar perfil');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      toast.error('Confirmacao da nova senha nao confere');
      return;
    }
    setSavingPassword(true);
    try {
      await api.changeMyPassword({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      toast.success('Senha atualizada com sucesso');
    } catch (err) {
      toast.error(err.message || 'Erro ao atualizar senha');
    } finally {
      setSavingPassword(false);
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
        <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Perfil</h1>
        <p className="text-zinc-400 mt-1">Dados da conta, identidade visual e seguranca.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <form onSubmit={saveProfile} className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
          <h2 className="font-semibold uppercase text-sm tracking-wide">Informacoes da conta</h2>
          <input
            placeholder="Nome"
            value={profile.name}
            onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3"
            required
          />
          <input
            placeholder="Email"
            type="email"
            value={profile.email}
            onChange={(event) => setProfile((prev) => ({ ...prev, email: event.target.value }))}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3"
            required
          />
          <input
            placeholder="Telefone"
            value={profile.phone}
            onChange={(event) => setProfile((prev) => ({ ...prev, phone: event.target.value }))}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3"
          />
          {canManageBranding && (
            <input
              placeholder="Nome da academia"
              value={profile.gym_name}
              onChange={(event) => setProfile((prev) => ({ ...prev, gym_name: event.target.value }))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3"
              required
            />
          )}

          <button
            type="submit"
            disabled={savingProfile}
            className="bg-[#ccff00] text-black font-bold text-xs uppercase tracking-wider h-10 px-4 rounded-sm disabled:opacity-60"
          >
            {savingProfile ? 'Salvando...' : 'Salvar Perfil'}
          </button>
        </form>

        {canManageBranding && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-4">
            <h2 className="font-semibold uppercase text-sm tracking-wide">Marca e cores</h2>

            <div className="space-y-2">
              <p className="text-xs text-zinc-400">Logo</p>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-md border border-zinc-800 bg-zinc-950 flex items-center justify-center overflow-hidden">
                  {profile.logo_data_url ? (
                    <img src={profile.logo_data_url} alt="Logo da academia" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-zinc-500 uppercase">Sem logo</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <label className="bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold uppercase tracking-wide h-9 px-3 rounded-sm inline-flex items-center cursor-pointer">
                    Upload
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogoFile} className="hidden" />
                  </label>
                  <button
                    type="button"
                    onClick={() => setProfile((prev) => ({ ...prev, logo_data_url: null }))}
                    className="bg-red-500/20 text-red-300 text-xs font-semibold uppercase tracking-wide h-9 px-3 rounded-sm"
                  >
                    Remover
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-zinc-400">Tema (5 opcoes)</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {BRAND_THEMES.map((theme) => (
                  <button
                    key={theme.key}
                    type="button"
                    onClick={() => {
                      const nextBranding = { theme_key: theme.key, logo_data_url: profile.logo_data_url };
                      setProfile((prev) => ({ ...prev, theme_key: theme.key }));
                      applyBrandingToDocument(nextBranding);
                    }}
                    className={`border rounded-sm px-2 py-2 text-xs font-semibold uppercase tracking-wide ${profile.theme_key === theme.key ? 'border-zinc-200 text-white' : 'border-zinc-700 text-zinc-400'}`}
                  >
                    <span className="inline-block w-3 h-3 rounded-full mr-2 align-middle" style={{ backgroundColor: theme.primary }} />
                    {theme.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-zinc-500">Perfil atual: {role}</p>
          </div>
        )}
      </div>

      <form onSubmit={savePassword} className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
        <h2 className="font-semibold uppercase text-sm tracking-wide">Alterar senha</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            type="password"
            placeholder="Senha atual"
            value={passwordForm.current_password}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, current_password: event.target.value }))}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3"
            required
          />
          <input
            type="password"
            placeholder="Nova senha"
            value={passwordForm.new_password}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, new_password: event.target.value }))}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3"
            required
          />
          <input
            type="password"
            placeholder="Confirmar nova senha"
            value={passwordForm.confirm_password}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirm_password: event.target.value }))}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3"
            required
          />
        </div>
        <button
          type="submit"
          disabled={savingPassword}
          className="bg-zinc-800 text-white font-semibold text-xs uppercase tracking-wider h-10 px-4 rounded-sm hover:bg-zinc-700 disabled:opacity-60"
        >
          {savingPassword ? 'Atualizando...' : 'Atualizar Senha'}
        </button>
      </form>
    </div>
  );
}
