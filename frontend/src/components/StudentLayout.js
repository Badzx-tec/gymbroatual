import React, { useMemo } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CreditCard, LayoutDashboard, LogOut, User } from 'lucide-react';
import { toast } from 'sonner';

import { APP_BRAND } from '../branding';
import { api } from '../api';
import BrandMark from './ui/BrandMark';
import Button from './ui/Button';
import { clearSession, getStoredUser } from '../lib/session';

const navItems = [
  { to: '/aluno', label: 'Meu painel', icon: LayoutDashboard, end: true, description: 'Acesso, contrato e avisos' },
  { to: '/aluno/financeiro', label: 'Financeiro', icon: CreditCard, description: 'Cobrancas, carencia e bloqueio' },
  { to: '/aluno/perfil', label: 'Perfil', icon: User, description: 'Dados pessoais e senha' },
];

export default function StudentLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = React.useMemo(() => getStoredUser(), []);

  const activeNav = useMemo(() => {
    return navItems.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))) || navItems[0];
  }, [location.pathname]);

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
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <header className="border-b border-zinc-900 bg-zinc-950/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-4">
            <Link to="/aluno" className="inline-flex">
              <BrandMark caption="Portal do aluno" tone="ghost" />
            </Link>
            <div className="hidden rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-3 text-right lg:block">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Sessao atual</p>
              <p className="mt-1 text-sm font-semibold text-zinc-100">{activeNav.label}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
            <div className="rounded-2xl border border-zinc-900 bg-zinc-950/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Aluno conectado</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="rounded-xl border border-zinc-900 bg-zinc-900/70 p-2 text-[var(--brand-primary)]">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{user.name || 'Aluno'}</p>
                  <p className="text-xs text-zinc-500">{user.email || 'Sem email cadastrado'}</p>
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
        <section className="rounded-2xl border border-zinc-900 bg-[radial-gradient(circle_at_top_left,rgba(var(--brand-primary-rgb),0.12),transparent_36%),linear-gradient(180deg,rgba(24,24,27,0.92),rgba(9,9,11,0.96))] px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Portal do aluno</p>
              <h1 className="mt-2 font-heading text-3xl uppercase tracking-[0.06em] text-zinc-50">{activeNav.label}</h1>
              <p className="mt-1 text-sm text-zinc-400">{activeNav.description}. {APP_BRAND.productLine}</p>
            </div>
            <div className="inline-flex rounded-2xl border border-zinc-900 bg-zinc-950/70 p-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition-colors ${isActive ? 'bg-[var(--brand-primary)] text-black' : 'text-zinc-400 hover:text-zinc-100'}`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </section>

        <section aria-label="Conteudo do portal do aluno">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
