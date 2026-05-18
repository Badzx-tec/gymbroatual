import React, { useMemo } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CreditCard, LayoutDashboard, LogOut, User } from 'lucide-react';
import { toast } from 'sonner';

import { APP_BRAND, applyBrandingToDocument, loadBranding, saveBranding } from '../branding';
import { api } from '../api';
import BrandMark from './ui/BrandMark';
import Button from './ui/Button';
import ErrorBoundary from './ErrorBoundary';
import { clearSession, getStoredUser, updateStoredUser } from '../lib/session';

const navItems = [
  { to: '/aluno', label: 'Meu painel', icon: LayoutDashboard, end: true, description: 'Acesso, contrato e avisos' },
  { to: '/aluno/financeiro', label: 'Financeiro', icon: CreditCard, description: 'Cobrancas, carencia e bloqueio' },
  { to: '/aluno/perfil', label: 'Perfil', icon: User, description: 'Dados pessoais e senha' },
];

export default function StudentLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = React.useState(() => getStoredUser());
  const [branding, setBranding] = React.useState(() => loadBranding());

  const activeNav = useMemo(() => {
    return navItems.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))) || navItems[0];
  }, [location.pathname]);

  React.useEffect(() => {
    applyBrandingToDocument(branding);
  }, [branding]);

  React.useEffect(() => {
    api
      .profileMe()
      .then((profile) => {
        if (profile?.branding) {
          const normalized = {
            theme_key: profile.branding.theme_key,
            color_mode: profile.branding.color_mode,
            logo_data_url: profile.branding.logo_data_url || null,
          };
          setBranding(normalized);
          saveBranding(normalized);
        }
        if (profile?.name || profile?.email) {
          const updatedUser = updateStoredUser((current) => ({
            ...current,
            name: profile.name || current.name || user.name,
            email: profile.email || current.email || user.email,
          }));
          setUser(updatedUser);
        }
      })
      .catch(() => {});
  }, [user.email, user.name]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // noop
    }
    clearSession();
    toast.success('Logout realizado');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--surface-border)] bg-[color:rgb(255_255_255_/_0.08)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-4">
            <Link to="/aluno" className="inline-flex">
              <BrandMark caption="Portal do aluno" tone="ghost" />
            </Link>
            <div className="hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-4 py-3 text-right lg:block">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Sessao atual</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{activeNav.label}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
            <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Aluno conectado</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-soft)] p-2 text-[var(--brand-primary)]">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{user.name || 'Aluno'}</p>
                  <p className="text-xs text-[var(--text-muted)]">{user.email || 'Sem email cadastrado'}</p>
                </div>
              </div>
            </div>
            <Button type="button" onClick={handleLogout} variant="ghost" size="sm">
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <section className="rounded-2xl border border-[var(--surface-border)] bg-[var(--hero-surface)] px-5 py-5 shadow-[var(--shadow-soft)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">Portal do aluno</p>
              <h1 className="mt-2 font-heading text-3xl uppercase tracking-[0.06em] text-[var(--text-primary)]">{activeNav.label}</h1>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{activeNav.description}. {APP_BRAND.productLine}</p>
            </div>
            <div className="inline-flex rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] p-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition-colors ${isActive ? 'bg-[var(--brand-primary)] text-black' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </section>

        <section aria-label="Conteudo do portal do aluno">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </section>
      </main>
    </div>
  );
}
