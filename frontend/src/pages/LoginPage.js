import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dumbbell, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [gymName, setGymName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paymentRequired, setPaymentRequired] = useState(null);

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.register({ name, gym_name: gymName, email, password });
      await api.verifyStart(email);
      toast.success('Conta criada. Codigo enviado por e-mail.');
      setMode('verify');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.verifyConfirm(email, code);
      toast.success('E-mail verificado. Faça login para continuar.');
      setMode('login');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setPaymentRequired(null);
    try {
      const result = await api.login({ email, password });
      localStorage.setItem('gymbro_token', result.token);
      localStorage.setItem('gymbro_user', JSON.stringify(result.user));
      toast.success('Login realizado');
      navigate('/admin');
    } catch (err) {
      if (err.code === 'NEED_EMAIL_VERIFICATION') {
        await api.verifyStart(email);
        toast.error('Verifique seu e-mail para liberar o login.');
        setMode('verify');
      } else if (err.code === 'PAYMENT_REQUIRED') {
        setPaymentRequired({
          checkoutUrl: err.checkout_url || '',
          message: err.message || 'Assinatura inativa.',
        });
        toast.error('Assinatura necessaria para acessar o painel.');
      } else {
        toast.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2 mb-10">
          <Dumbbell className="w-8 h-8 text-[#ccff00]" />
          <span className="font-heading text-3xl font-bold tracking-tight uppercase">GymBro</span>
        </Link>

        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-8">
          <h2 className="font-heading text-2xl font-bold uppercase mb-6 text-center">
            {mode === 'login' ? 'Acessar Painel' : mode === 'register' ? 'Criar Conta' : 'Verificar E-mail'}
          </h2>

          {paymentRequired && (
            <div className="mb-5 p-4 rounded-sm border border-yellow-500/30 bg-yellow-500/10">
              <p className="text-yellow-300 font-semibold text-sm mb-2">Assinatura necessaria</p>
              <p className="text-zinc-300 text-sm mb-3">{paymentRequired.message}</p>
              <button
                type="button"
                onClick={() => {
                  if (paymentRequired.checkoutUrl) {
                    window.location.href = paymentRequired.checkoutUrl;
                  } else {
                    navigate('/');
                  }
                }}
                className="w-full bg-[#ccff00] text-black font-bold uppercase tracking-wider text-xs h-10 rounded-sm hover:bg-[#b3e600]"
              >
                Assinar agora
              </button>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <label className="text-sm font-medium text-zinc-400 mb-1 block">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4" />
              <label className="text-sm font-medium text-zinc-400 mb-1 block">Senha</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4 pr-12" />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  {showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <button type="submit" disabled={loading} className="w-full bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-12 rounded-sm hover:bg-[#b3e600] disabled:opacity-50">
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <label className="text-sm font-medium text-zinc-400 mb-1 block">Nome</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4" />
              <label className="text-sm font-medium text-zinc-400 mb-1 block">Academia</label>
              <input type="text" value={gymName} onChange={(e) => setGymName(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4" />
              <label className="text-sm font-medium text-zinc-400 mb-1 block">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4" />
              <label className="text-sm font-medium text-zinc-400 mb-1 block">Senha</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4" />
              <button type="submit" disabled={loading} className="w-full bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-12 rounded-sm hover:bg-[#b3e600] disabled:opacity-50">
                {loading ? 'Criando...' : 'Criar Conta'}
              </button>
            </form>
          )}

          {mode === 'verify' && (
            <form onSubmit={handleVerify} className="space-y-4">
              <p className="text-sm text-zinc-400">Informe o codigo de 6 digitos enviado para {email}.</p>
              <input type="text" value={code} onChange={(e) => setCode(e.target.value)} minLength={6} maxLength={6} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4 tracking-[0.4em] text-center" />
              <button type="submit" disabled={loading} className="w-full bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-12 rounded-sm hover:bg-[#b3e600] disabled:opacity-50">
                {loading ? 'Validando...' : 'Validar Codigo'}
              </button>
              <button type="button" onClick={() => api.verifyStart(email).then(() => toast.success('Codigo reenviado')).catch((err) => toast.error(err.message))} className="w-full bg-zinc-800 text-white font-semibold uppercase tracking-wider text-sm h-12 rounded-sm hover:bg-zinc-700">
                Reenviar Codigo
              </button>
            </form>
          )}

          <p className="text-center text-zinc-500 text-sm mt-6">
            {mode === 'login' && <>Nao tem conta? <button onClick={() => setMode('register')} className="text-[#ccff00] hover:underline">Criar conta</button></>}
            {mode === 'register' && <>Ja tem conta? <button onClick={() => setMode('login')} className="text-[#ccff00] hover:underline">Fazer login</button></>}
            {mode === 'verify' && <>Voltar para <button onClick={() => setMode('login')} className="text-[#ccff00] hover:underline">login</button></>}
          </p>
        </div>
      </div>
    </div>
  );
}
