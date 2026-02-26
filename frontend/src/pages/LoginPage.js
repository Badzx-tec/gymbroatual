import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Dumbbell, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPlatformSubdomain = /^admin\./i.test(window.location.hostname);
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [gymName, setGymName] = useState('');
  const [email, setEmail] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [showRegisterPw, setShowRegisterPw] = useState(false);
  const [showRegisterConfirmPw, setShowRegisterConfirmPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paymentRequired, setPaymentRequired] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [origin, setOrigin] = useState('');

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedMode = params.get('mode');
    setOrigin((params.get('origin') || '').toLowerCase());
    setSelectedPlan(params.get('plan') || '');
    if (requestedMode === 'register' && !isPlatformSubdomain) {
      setMode('register');
      return;
    }
    if (requestedMode === 'verify' && !isPlatformSubdomain) {
      setMode('verify');
    }
  }, [location.search, isPlatformSubdomain]);

  const originHintMap = {
    landing: 'Fluxo iniciado pela landing page.',
    hero: 'Fluxo iniciado pelo CTA principal da home.',
    pricing: 'Fluxo iniciado pela secao de planos.',
    contact: 'Fluxo iniciado pela secao de contato.',
    payment_required: 'Fluxo iniciado por assinatura pendente.',
  };
  const originHint = originHintMap[origin] || (origin ? `Origem: ${origin}.` : '');

  const handleRegister = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('As senhas nao conferem.');
      return;
    }
    if (password.length < 8) {
      toast.error('A senha deve ter pelo menos 8 caracteres.');
      return;
    }

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
      toast.success('E-mail verificado. Faca login para continuar.');
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
      const result = await api.login({ identifier: loginIdentifier, password });
      localStorage.setItem('gymbro_token', result.token);
      localStorage.setItem('gymbro_user', JSON.stringify(result.user));
      const role = String(result?.user?.role || '').toUpperCase();

      if (role === 'SUPER_ADMIN') {
        toast.success('Login administrativo realizado.');
        navigate('/platform');
        return;
      }
      if (role === 'STUDENT') {
        toast.success('Login do aluno realizado.');
        navigate('/aluno');
        return;
      }

      if (isPlatformSubdomain) {
        localStorage.removeItem('gymbro_token');
        localStorage.removeItem('gymbro_user');
        toast.error('Esse subdominio e exclusivo para o super admin.');
        return;
      }

      const shouldGoSubscription = ['landing', 'hero', 'pricing', 'contact', 'payment_required'].includes(origin);
      if (shouldGoSubscription && ['OWNER', 'MANAGER'].includes(role)) {
        toast.success('Login realizado. Continue para ativar sua assinatura.');
        navigate('/admin/assinatura');
        return;
      }

      toast.success('Login realizado.');
      navigate('/admin');
    } catch (err) {
      if (err.code === 'NEED_EMAIL_VERIFICATION') {
        if (loginIdentifier.includes('@')) {
          await api.verifyStart(loginIdentifier);
          setEmail(loginIdentifier);
          toast.error('Verifique seu e-mail para liberar o login.');
          setMode('verify');
        } else {
          toast.error('Conta pendente de verificacao por e-mail.');
        }
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
                    navigate('/signup?origin=payment_required');
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
              {originHint && (
                <div className="p-3 rounded-sm border border-blue-500/30 bg-blue-500/10 text-blue-200 text-xs">
                  {originHint}
                </div>
              )}
              <label className="text-sm font-medium text-zinc-400 mb-1 block">Login (e-mail, CPF ou matricula)</label>
              <input value={loginIdentifier} onChange={(e) => setLoginIdentifier(e.target.value)} required placeholder="ex.: aluno@email.com, 000.000.000-00 ou ALU0001" className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4" />
              <label className="text-sm font-medium text-zinc-400 mb-1 block">Senha</label>
              <div className="relative">
                <input type={showLoginPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4 pr-12" />
                <button type="button" onClick={() => setShowLoginPw(!showLoginPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  {showLoginPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <button type="submit" disabled={loading} className="w-full bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-12 rounded-sm hover:bg-[#b3e600] disabled:opacity-50">
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
          )}

          {mode === 'register' && !isPlatformSubdomain && (
            <form onSubmit={handleRegister} className="space-y-4">
              {(selectedPlan || originHint) && (
                <div className="p-3 rounded-sm border border-blue-500/30 bg-blue-500/10 text-blue-200 text-xs">
                  {originHint && <p>{originHint}</p>}
                  {selectedPlan && (
                    <p>
                      Plano selecionado no site: <strong>{selectedPlan}</strong>. Voce pode ajustar esse plano depois no painel.
                    </p>
                  )}
                </div>
              )}
              <label className="text-sm font-medium text-zinc-400 mb-1 block">Nome</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4" />
              <label className="text-sm font-medium text-zinc-400 mb-1 block">Academia</label>
              <input type="text" value={gymName} onChange={(e) => setGymName(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4" />
              <label className="text-sm font-medium text-zinc-400 mb-1 block">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4" />

              <label className="text-sm font-medium text-zinc-400 mb-1 block">Senha</label>
              <div className="relative">
                <input type={showRegisterPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4 pr-12" />
                <button type="button" onClick={() => setShowRegisterPw(!showRegisterPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  {showRegisterPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              <label className="text-sm font-medium text-zinc-400 mb-1 block">Confirmar senha</label>
              <div className="relative">
                <input type={showRegisterConfirmPw ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4 pr-12" />
                <button type="button" onClick={() => setShowRegisterConfirmPw(!showRegisterConfirmPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  {showRegisterConfirmPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              <button type="submit" disabled={loading} className="w-full bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm h-12 rounded-sm hover:bg-[#b3e600] disabled:opacity-50">
                {loading ? 'Criando...' : 'Criar Conta'}
              </button>
            </form>
          )}

          {mode === 'verify' && !isPlatformSubdomain && (
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
            {mode === 'login' && !isPlatformSubdomain && <>Nao tem conta? <button onClick={() => setMode('register')} className="text-[#ccff00] hover:underline">Criar conta</button></>}
            {mode === 'register' && !isPlatformSubdomain && <>Ja tem conta? <button onClick={() => setMode('login')} className="text-[#ccff00] hover:underline">Fazer login</button></>}
            {mode === 'verify' && !isPlatformSubdomain && <>Voltar para <button onClick={() => setMode('login')} className="text-[#ccff00] hover:underline">login</button></>}
            {mode === 'login' && isPlatformSubdomain && <>Acesso restrito ao super admin da plataforma.</>}
          </p>
        </div>
      </div>
    </div>
  );
}
