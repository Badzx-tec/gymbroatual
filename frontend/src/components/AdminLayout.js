import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CreditCard,
  FileText,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  ScanLine,
  Settings,
  Tag,
  UserCog,
  Users,
  Wifi,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import { applyBrandingToDocument, loadBranding, saveBranding } from '../branding';
import { clearSession, getStoredUser, updateStoredUser } from '../lib/session';
import { roleLabel } from '../utils/labels';
import BrandMark from './ui/BrandMark';
import ErrorBoundary from './ErrorBoundary';
import IconButton from './ui/IconButton';

const navItems = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true, group: 'Visao geral' },
  { to: '/admin/alunos', icon: Users, label: 'Alunos', group: 'Operacao' },
  { to: '/admin/contratos', icon: FileText, label: 'Contratos', group: 'Operacao' },
  { to: '/admin/planos', icon: Tag, label: 'Planos', group: 'Operacao' },
  { to: '/admin/acessos', icon: ScanLine, label: 'Acessos', group: 'Operacao' },
  { to: '/admin/catraca', icon: Wifi, label: 'Catraca', group: 'Operacao' },
  { to: '/admin/funcionarios', icon: UserCog, label: 'Equipe', group: 'Operacao' },
  { to: '/admin/assinatura', icon: CreditCard, label: 'Assinatura', group: 'Receita' },
  { to: '/admin/cobranca', icon: FileText, label: 'Cobranca', group: 'Receita' },
  { to: '/admin/notificacoes', icon: Bell, label: 'Notificacoes', group: 'Sistema' },
];

const SUPPORT_WHATSAPP = '5533988515895';

const groupOrder = ['Visao geral', 'Operacao', 'Receita', 'Sistema'];

function buildHelpUrl({ user, pathname }) {
  const helpMessage = [
    'Ola! Preciso de ajuda no GymBro.',
    `Usuario: ${user.name || 'Nao informado'}`,
    `Email: ${user.email || 'Nao informado'}`,
    `Tela: ${pathname || '/admin'}`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
  ].join('\n');
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(helpMessage)}`;
}

function buildPageCopy(pathname) {
  if (pathname === '/admin') {
    return {
      title: 'Operacao da academia',
      subtitle: 'Acompanhe receita, contratos, acesso e equipe em um unico shell operacional.',
    };
  }

  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || 'dashboard';
  const label = navItems.find((item) => item.to === pathname)?.label || last.replaceAll('-', ' ');
  return {
    title: label,
    subtitle: 'Fluxo administrativo com contexto, acoes rapidas e leitura de status mais clara.',
  };
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [user, setUser] = React.useState(() => getStoredUser());
  const [branding, setBranding] = React.useState(() => loadBranding());

  const role = String(user.role || 'OWNER').toUpperCase();
  const helpUrl = buildHelpUrl({ user, pathname: location.pathname });
  const pageCopy = React.useMemo(() => buildPageCopy(location.pathname), [location.pathname]);

  const canSeeBilling = ['OWNER', 'MANAGER'].includes(role);
  const canSeeStaff = ['OWNER', 'MANAGER'].includes(role);
  const canSeeContracts = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);
  const canSeeTurnstile = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);

  const visibleNavItems = React.useMemo(
    () =>
      navItems.filter((item) => {
        if (item.to === '/admin/assinatura') return canSeeBilling;
        if (item.to === '/admin/cobranca') return canSeeBilling;
        if (item.to === '/admin/funcionarios') return canSeeStaff;
        if (item.to === '/admin/contratos') return canSeeContracts;
        if (item.to === '/admin/catraca') return canSeeTurnstile;
        return true;
      }),
    [canSeeBilling, canSeeContracts, canSeeStaff, canSeeTurnstile]
  );

  const groupedItems = React.useMemo(() => {
    const groups = new Map();
    visibleNavItems.forEach((item) => {
      const current = groups.get(item.group) || [];
      current.push(item);
      groups.set(item.group, current);
    });
    return groupOrder
      .map((group) => ({
        group,
        items: groups.get(group) || [],
      }))
      .filter((entry) => entry.items.length > 0);
  }, [visibleNavItems]);

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

  React.useEffect(() => {
    const syncUnreadCount = () => {
      api
        .listNotifications(50)
        .then((notifs) => {
          setUnreadCount(notifs.filter((n) => !n.lida).length);
        })
        .catch(() => {});
    };

    const handleNotificationsUpdated = (event) => {
      if (typeof event?.detail?.unreadCount === 'number') {
        setUnreadCount(event.detail.unreadCount);
      }
    };

    syncUnreadCount();
    window.addEventListener('gymbro:notifications-updated', handleNotificationsUpdated);
    return () => {
      window.removeEventListener('gymbro:notifications-updated', handleNotificationsUpdated);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {}
    clearSession();
    toast.success('Logout realizado');
    navigate('/login');
  };

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--surface-border)] px-5 py-5">
        <BrandMark compact={false} caption="Gestao, acesso e recorrencia" />
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-5">
        <div className="space-y-5">
          {groupedItems.map((entry) => (
            <div key={entry.group}>
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">
                {entry.group}
              </p>
              <div className="mt-2 space-y-1">
                {entry.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setSidebarOpen(false)}
                    data-testid={`nav-${item.label.toLowerCase()}`}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition ${
                        isActive
                          ? 'bg-[linear-gradient(135deg,rgba(var(--brand-primary-rgb),0.18),rgba(96,165,250,0.08))] text-[var(--text-primary)] shadow-[0_18px_50px_-38px_rgba(0,0,0,0.8)]'
                          : 'text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]'
                      }`
                    }
                  >
                    <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] text-[var(--text-muted)] transition group-hover:text-[var(--text-primary)]">
                      <item.icon className="h-4 w-4" />
                      {item.label === 'Notificacoes' && unreadCount > 0 ? (
                        <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--status-danger)] px-1 text-[10px] font-bold text-white">
                          {unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate">{item.label}</p>
                      <p className="truncate text-xs text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                        {item.group}
                      </p>
                    </div>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="border-t border-[var(--surface-border)] px-4 py-4">
        <div className="rounded-[var(--radius-md)] border border-[var(--surface-border)] bg-[var(--surface-card-bg)] p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-soft)] text-sm font-bold text-[var(--brand-primary)]">
              {(user.name || 'A')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{user.name || 'Administrador'}</p>
              <p className="truncate text-xs text-[var(--text-muted)]">{roleLabel(role)}</p>
            </div>
            <IconButton
              variant="ghost"
              onClick={() => navigate('/admin/perfil')}
              aria-label="Abrir perfil"
            >
              <Settings className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <a
              href={helpUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)] hover:border-[var(--surface-border-strong)] hover:bg-[var(--surface-soft-hover)]"
            >
              <HelpCircle className="h-4 w-4" />
              Ajuda
            </a>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--status-danger-text)] hover:brightness-125"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--surface-base)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px]">
        <aside className="hidden w-[308px] shrink-0 p-4 xl:block">
          <div className="surface-panel sticky top-4 h-[calc(100vh-32px)] overflow-hidden rounded-[28px]">
            {sidebarContent}
          </div>
        </aside>

        <AnimatePresence>
          {sidebarOpen ? (
            <motion.div
              className="fixed inset-0 z-[120] xl:hidden"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={reduceMotion ? {} : { opacity: 1 }}
              exit={reduceMotion ? {} : { opacity: 0 }}
            >
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
              <motion.aside
                className="surface-panel relative h-full w-[88vw] max-w-[320px] rounded-none"
                initial={reduceMotion ? false : { x: -24, opacity: 0 }}
                animate={reduceMotion ? {} : { x: 0, opacity: 1 }}
                exit={reduceMotion ? {} : { x: -24, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {sidebarContent}
              </motion.aside>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col px-3 pb-6 pt-3 sm:px-4 lg:px-6">
          <header className="surface-panel sticky top-3 z-40 rounded-[26px] px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconButton
                  className="xl:hidden"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Abrir menu lateral"
                >
                  <Menu className="h-4 w-4" />
                </IconButton>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                    Painel administrativo
                  </p>
                  <h1 className="truncate text-lg font-semibold text-[var(--text-primary)]">{pageCopy.title}</h1>
                  <p className="hidden truncate text-sm text-[var(--text-muted)] md:block">{pageCopy.subtitle}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/admin/notificacoes')}
                  className="relative inline-flex items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)] hover:border-[var(--surface-border-strong)] hover:bg-[var(--surface-soft)]"
                >
                  <Bell className="h-4 w-4" />
                  <span className="hidden sm:inline">Alertas</span>
                  {unreadCount > 0 ? (
                    <span className="ml-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--status-danger)] px-1 text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/admin/perfil')}
                  className="inline-flex items-center gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-3 py-2 text-left hover:border-[var(--surface-border-strong)] hover:bg-[var(--surface-soft)]"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-soft)] text-sm font-bold text-[var(--brand-primary)]">
                    {(user.name || 'A')[0].toUpperCase()}
                  </div>
                  <div className="hidden min-w-0 sm:block">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{user.name || 'Administrador'}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">{user.email || 'Sem e-mail'}</p>
                  </div>
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 pt-6">
            <div className="mx-auto w-full max-w-[1460px]">
              <ErrorBoundary key={location.pathname}>
                <Outlet />
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
