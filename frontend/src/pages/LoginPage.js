import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Dumbbell, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api';

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      let result;
      if (mode === 'login') {
        result = await api.login({ email, password });
      } else {
        result = await api.register({ email, password, name });
      }
      localStorage.setItem('gymbro_token', result.token);
      localStorage.setItem('gymbro_user', JSON.stringify(result.user));
      toast.success(mode === 'login' ? 'Login realizado!' : 'Conta criada!');
      navigate('/admin');
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  const handleGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + '/admin';
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2 mb-10">
          <Dumbbell className="w-8 h-8 text-[#ccff00]" />
          <span className="font-heading text-3xl font-bold tracking-tight uppercase">GymBro</span>
        </Link>

        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-8">
          <h2 data-testid="login-title" className="font-heading text-2xl font-bold uppercase mb-6 text-center">
            {mode === 'login' ? 'Acessar Painel' : 'Criar Conta'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="text-sm font-medium text-zinc-400 mb-1 block">Nome</label>
                <input data-testid="register-name-input" type="text" value={name} onChange={e => setName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4 focus:outline-none focus:ring-1 focus:ring-[#ccff00] focus:border-[#ccff00]" required />
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-zinc-400 mb-1 block">E-mail</label>
              <input data-testid="login-email-input" type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4 focus:outline-none focus:ring-1 focus:ring-[#ccff00] focus:border-[#ccff00]" required />
            </div>
            <div>
              <label className="text-sm font-medium text-zinc-400 mb-1 block">Senha</label>
              <div className="relative">
                <input data-testid="login-password-input" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4 pr-12 focus:outline-none focus:ring-1 focus:ring-[#ccff00] focus:border-[#ccff00]" required />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  {showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <button data-testid="login-submit-btn" type="submit" disabled={loading}
              className="w-full bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-12 rounded-sm hover:bg-[#b3e600] transition-all disabled:opacity-50">
              {loading ? 'Carregando...' : mode === 'login' ? 'Entrar' : 'Criar Conta'}
            </button>
          </form>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-zinc-500 text-xs uppercase tracking-wider">ou</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          <button data-testid="google-login-btn" onClick={handleGoogle}
            className="w-full flex items-center justify-center gap-3 bg-zinc-800 text-white font-semibold uppercase tracking-wide text-sm h-12 rounded-sm hover:bg-zinc-700 transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Entrar com Google
          </button>

          <p className="text-center text-zinc-500 text-sm mt-6">
            {mode === 'login' ? (
              <>Nao tem conta? <button data-testid="switch-to-register" onClick={() => setMode('register')} className="text-[#ccff00] hover:underline">Criar conta</button></>
            ) : (
              <>Ja tem conta? <button data-testid="switch-to-login" onClick={() => setMode('login')} className="text-[#ccff00] hover:underline">Fazer login</button></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
