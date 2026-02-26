import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, User, LayoutDashboard, Dumbbell } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

const navItems = [
  { to: '/aluno', label: 'Meu Painel', icon: LayoutDashboard, end: true },
  { to: '/aluno/perfil', label: 'Meu Perfil', icon: User },
];

export default function StudentLayout() {
  const navigate = useNavigate();
  const user = React.useMemo(() => JSON.parse(localStorage.getItem('gymbro_user') || '{}'), []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {}
    localStorage.removeItem('gymbro_token');
    localStorage.removeItem('gymbro_user');
    toast.success('Logout realizado');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-[#ccff00]" />
            <span className="font-heading uppercase tracking-wide text-sm">Area do Aluno</span>
          </div>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-2 text-xs uppercase tracking-wide font-semibold px-3 h-9 rounded-sm bg-zinc-800 hover:bg-zinc-700"
          >
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Bem-vindo</p>
          <h1 className="font-heading text-2xl uppercase">{user.name || 'Aluno'}</h1>
        </div>
        <nav className="flex gap-2 mb-6">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `inline-flex items-center gap-2 h-9 px-3 rounded-sm text-xs uppercase tracking-wide font-semibold border ${
                  isActive
                    ? 'border-[#ccff00]/40 bg-[#ccff00]/10 text-[#ccff00]'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                }`
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </main>
    </div>
  );
}
