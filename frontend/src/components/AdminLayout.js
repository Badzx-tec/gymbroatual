import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Tag, ScanLine, Menu, X, LogOut, Dumbbell, Bell, Wifi, CreditCard, UserCog, FileText, MessageCircle, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api';
import { applyBrandingToDocument, loadBranding, saveBranding } from '../branding';
import { clearSession, getStoredUser, updateStoredUser } from '../lib/session';

const navItems = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/admin/alunos', icon: Users, label: 'Alunos' },
  { to: '/admin/contratos', icon: FileText, label: 'Contratos' },
  { to: '/admin/planos', icon: Tag, label: 'Planos' },
  { to: '/admin/acessos', icon: ScanLine, label: 'Acessos' },
  { to: '/admin/assinatura', icon: CreditCard, label: 'Assinatura' },
  { to: '/admin/cobranca', icon: FileText, label: 'Cobranca' },
  { to: '/admin/notificacoes', icon: Bell, label: 'Notificacoes' },
  { to: '/admin/catraca', icon: Wifi, label: 'Catraca' },
  { to: '/admin/funcionarios', icon: UserCog, label: 'Funcionarios' },
];

const SUPPORT_WHATSAPP = '5533988515895';

const buildHelpUrl = ({ user, pathname }) => {
  const helpMessage = [
    'Ola! Preciso de ajuda no GymBro.',
    `Usuario: ${user.name || 'Nao informado'}`,
    `Email: ${user.email || 'Nao informado'}`,
    `Tela: ${pathname || '/admin'}`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
  ].join('\n');
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(helpMessage)}`;
};

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [user, setUser] = useState(() => getStoredUser());
  const [branding, setBranding] = useState(() => loadBranding());
  const helpUrl = buildHelpUrl({ user, pathname: location.pathname });
  const role = (user.role || 'OWNER').toUpperCase();
  const canSeeBilling = ['OWNER', 'MANAGER'].includes(role);
  const canSeeStaff = ['OWNER', 'MANAGER'].includes(role);
  const canSeeContracts = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);
  const canSeeTurnstile = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);
  const visibleNavItems = navItems.filter((item) => {
    if (item.to === '/admin/assinatura') return canSeeBilling;
    if (item.to === '/admin/cobranca') return canSeeBilling;
    if (item.to === '/admin/funcionarios') return canSeeStaff;
    if (item.to === '/admin/contratos') return canSeeContracts;
    if (item.to === '/admin/catraca') return canSeeTurnstile;
    return true;
  });

  useEffect(() => {
    applyBrandingToDocument(branding);
  }, [branding]);

  useEffect(() => {
    api.profileMe().then((profile) => {
      if (profile?.branding) {
        const normalized = {
          theme_key: profile.branding.theme_key,
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
    }).catch(() => {});
  }, [user.email, user.name]);

  useEffect(() => {
    api.listNotifications(50).then(notifs => {
      setUnreadCount(notifs.filter(n => !n.lida).length);
    }).catch(() => {});
  }, []);

  const handleLogout = async () => {
    try { await api.logout(); } catch {}
    clearSession();
    toast.success('Logout realizado');
    navigate('/login');
  };

  const SidebarContent = ({ onNavClick }) => (
    <>
      <div className="flex items-center gap-2 px-6 h-16 border-b border-zinc-800 shrink-0">
        {branding.logo_data_url ? (
          <img src={branding.logo_data_url} alt="Logo da academia" className="w-8 h-8 rounded-sm object-cover border border-zinc-700" />
        ) : (
          <Dumbbell className="w-6 h-6 text-[#ccff00]" />
        )}
        <span className="font-heading text-xl font-bold tracking-tight uppercase">GymBro</span>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {visibleNavItems.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavClick}
            data-testid={`nav-${item.label.toLowerCase()}`}
            className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 rounded-sm text-sm font-medium transition-colors relative ${isActive ? 'bg-[#ccff00]/10 text-[#ccff00]' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>
            <item.icon className="w-5 h-5" />
            {item.label}
            {item.label === 'Notificacoes' && unreadCount > 0 && (
              <span className="absolute right-3 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">{unreadCount}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-zinc-800 shrink-0">
        <div className="flex items-center gap-3 px-4 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-[#ccff00]">
            {(user.name || 'A')[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{user.name || 'Admin'}</p>
            <p className="text-xs text-zinc-500 truncate">{user.email || ''}</p>
          </div>
          <button
            data-testid="profile-link-btn"
            onClick={() => {
              navigate('/admin/perfil');
              if (onNavClick) onNavClick();
            }}
            className="ml-auto text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-sm p-2 transition-colors"
            title="Perfil"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
        <button data-testid="logout-btn" onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-2.5 rounded-sm text-sm font-medium text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors w-full">
          <LogOut className="w-5 h-5" /> Sair
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#09090b] flex">
      <aside data-testid="admin-sidebar" className="hidden lg:flex flex-col w-64 bg-zinc-900 border-r border-zinc-800 fixed h-screen">
        <SidebarContent />
      </aside>

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-64 bg-zinc-900 h-full flex flex-col">
            <div className="absolute top-4 right-4 z-10">
              <button onClick={() => setSidebarOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <SidebarContent onNavClick={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 lg:ml-64">
        <header className="h-16 bg-zinc-900/50 backdrop-blur-md border-b border-zinc-800 flex items-center px-4 lg:px-8 sticky top-0 z-40">
          <button data-testid="mobile-menu-btn" onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 hover:bg-zinc-800 rounded-sm mr-3">
            <Menu className="w-5 h-5" />
          </button>
          <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-zinc-300">Painel Administrativo</h2>
        </header>
        <main className="p-4 lg:p-8">
          <Outlet />
        </main>
      </div>

      <a
        data-testid="help-whatsapp-btn"
        href={helpUrl}
        target="_blank"
        rel="noreferrer"
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[#25D366] text-black font-bold text-sm px-4 py-3 shadow-lg hover:brightness-110 transition"
      >
        <MessageCircle className="w-4 h-4" />
        Ajuda
      </a>
    </div>
  );
}
