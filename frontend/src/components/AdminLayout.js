import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Tag, ScanLine, Menu, X, LogOut, Dumbbell } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api';

const navItems = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/admin/alunos', icon: Users, label: 'Alunos' },
  { to: '/admin/planos', icon: Tag, label: 'Planos' },
  { to: '/admin/acessos', icon: ScanLine, label: 'Acessos' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = JSON.parse(localStorage.getItem('gymbro_user') || '{}');

  const handleLogout = async () => {
    try { await api.logout(); } catch {}
    localStorage.removeItem('gymbro_token');
    localStorage.removeItem('gymbro_user');
    toast.success('Logout realizado');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex">
      {/* Sidebar Desktop */}
      <aside data-testid="admin-sidebar" className="hidden lg:flex flex-col w-64 bg-zinc-900 border-r border-zinc-800 fixed h-screen">
        <div className="flex items-center gap-2 px-6 h-16 border-b border-zinc-800">
          <Dumbbell className="w-6 h-6 text-[#ccff00]" />
          <span className="font-heading text-xl font-bold tracking-tight uppercase">GymBro</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} data-testid={`nav-${item.label.toLowerCase()}`}
              className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 rounded-sm text-sm font-medium transition-colors ${isActive ? 'bg-[#ccff00]/10 text-[#ccff00]' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center gap-3 px-4 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-[#ccff00]">
              {(user.name || 'A')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user.name || 'Admin'}</p>
              <p className="text-xs text-zinc-500 truncate">{user.email || ''}</p>
            </div>
          </div>
          <button data-testid="logout-btn" onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-2.5 rounded-sm text-sm font-medium text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors w-full">
            <LogOut className="w-5 h-5" /> Sair
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-64 bg-zinc-900 h-full flex flex-col">
            <div className="flex items-center justify-between px-6 h-16 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Dumbbell className="w-6 h-6 text-[#ccff00]" />
                <span className="font-heading text-xl font-bold uppercase">GymBro</span>
              </div>
              <button onClick={() => setSidebarOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <nav className="flex-1 p-4 space-y-1">
              {navItems.map(item => (
                <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 rounded-sm text-sm font-medium transition-colors ${isActive ? 'bg-[#ccff00]/10 text-[#ccff00]' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="p-4 border-t border-zinc-800">
              <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-2.5 rounded-sm text-sm font-medium text-zinc-400 hover:text-red-400 w-full">
                <LogOut className="w-5 h-5" /> Sair
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 lg:ml-64">
        {/* Topbar */}
        <header className="h-16 bg-zinc-900/50 backdrop-blur-md border-b border-zinc-800 flex items-center px-4 lg:px-8 sticky top-0 z-40">
          <button data-testid="mobile-menu-btn" onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 hover:bg-zinc-800 rounded-sm mr-3">
            <Menu className="w-5 h-5" />
          </button>
          <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-zinc-300">Painel Administrativo</h2>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
