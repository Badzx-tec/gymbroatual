import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CreditCard, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '../api';
import { APP_BRAND } from '../branding';
import BrandMark from '../components/ui/BrandMark';
import Banner from '../components/ui/Banner';
import Button from '../components/ui/Button';
import ContentCard from '../components/ui/ContentCard';
import TextField from '../components/ui/TextField';
import { clearSession, storeSession } from '../lib/session';

const modeCopy = {
  login: {
    title: 'Entrar no painel',
    subtitle: 'Acesse contratos, alunos, cobranca e operacao diaria da academia.',
  },
  register: {
    title: 'Criar conta',
    subtitle: 'Abra sua operacao no GymBro e siga para a ativacao da assinatura.',
  },
  verify: {
    title: 'Verificar e-mail',
    subtitle: 'Confirme o codigo recebido para liberar o primeiro acesso.',
  },
};

function PasswordField({ label, value, onChange, visible, onToggle, ...props }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <div className="relative">
        <input
          value={value}
          onChange={onChange}
          type={visible ? 'text' : 'password'}
          className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 pr-11 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
          {...props}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPlatformSubdomain = /^admin\./i.test(window.location.hostname);

  const [mode, setMode] = React.useState('login');
  const [name, setName] = React.useState('');
  const [gymName, setGymName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [loginIdentifier, setLoginIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [showLoginPw, setShowLoginPw] = React.useState(false);
  const [showRegisterPw, setShowRegisterPw] = React.useState(false);
  const [showRegisterConfirmPw, setShowRegisterConfirmPw] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [paymentRequired, setPaymentRequired] = React.useState(null);
  const [selectedPlan, setSelectedPlan] = React.useState('');
  const [origin, setOrigin] = React.useState('');

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
    landing: 'Fluxo iniciado pelo site institucional.',
    hero: 'Fluxo iniciado pelo CTA principal da landing.',
    pricing: 'Fluxo iniciado pela secao de planos.',
    contact: 'Fluxo iniciado pela secao de contato.',
    payment_required: 'Fluxo iniciado por assinatura pendente.',
  };
  const originHint = originHintMap[origin] || (origin ? `Origem: ${origin}.` : '');
  const currentModeCopy = modeCopy[mode] || modeCopy.login;

  const handleRegister = async (event) => {
    event.preventDefault();
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

  const handleVerify = async (event) => {
    event.preventDefault();
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

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setPaymentRequired(null);
    try {
      const result = await api.login({ identifier: loginIdentifier, password });
      storeSession(result.token, result.user);
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
        clearSession();
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
    <div className="min-h-screen bg-[var(--surface-base)] px-4 py-6">
      <div className="mx-auto grid min-h-[calc(100vh-48px)] max-w-[1280px] gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <ContentCard className="surface-panel relative overflow-hidden px-6 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(var(--brand-primary-rgb),0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(96,165,250,0.12),transparent_22%)]" />
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <BrandMark className="mb-8" caption={APP_BRAND.tagline} />
              <div className="max-w-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                  Plataforma SaaS para academias
                </p>
                <h1 className="mt-3 font-heading text-5xl uppercase tracking-[0.04em] text-zinc-50 sm:text-6xl">
                  Gestao com ritmo, clareza e controle.
                </h1>
                <p className="mt-4 max-w-lg text-base text-zinc-300">
                  {APP_BRAND.productLine} O produto foi desenhado para operacao real, sem ruído e com foco em receita, acesso e equipe.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { title: 'Assinatura e cobranca', text: 'Status financeiro claro, retorno do checkout e conciliacao com menos atrito.' },
                { title: 'Acesso e catraca', text: 'Visao operacional, bloqueios por perfil e leitura rapida de incidentes.' },
                { title: 'Contratos e equipe', text: 'Fluxos administrativos com menos friccao e mais hierarquia visual.' },
              ].map((item) => (
                <div key={item.title} className="rounded-[var(--radius-md)] border border-zinc-900 bg-zinc-950/70 p-4">
                  <p className="text-sm font-semibold text-zinc-100">{item.title}</p>
                  <p className="mt-2 text-sm text-zinc-500">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </ContentCard>

        <ContentCard className="surface-panel flex items-center px-5 py-6 sm:px-7 lg:px-8">
          <div className="w-full">
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Acesso seguro</p>
              <h2 className="mt-2 text-2xl font-semibold text-zinc-50">{currentModeCopy.title}</h2>
              <p className="mt-1 text-sm text-zinc-500">{currentModeCopy.subtitle}</p>
            </div>

            {paymentRequired ? (
              <Banner
                tone="warning"
                className="mb-5"
                title="Assinatura necessaria"
                description={paymentRequired.message}
                actions={
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      if (paymentRequired.checkoutUrl) {
                        window.location.href = paymentRequired.checkoutUrl;
                      } else {
                        navigate('/signup?origin=payment_required');
                      }
                    }}
                  >
                    <CreditCard className="h-4 w-4" />
                    Assinar agora
                  </Button>
                }
              />
            ) : null}

            {originHint ? (
              <Banner className="mb-5" tone="info" title="Contexto do fluxo" description={originHint} />
            ) : null}

            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <TextField
                  label="Login"
                  value={loginIdentifier}
                  onChange={(event) => setLoginIdentifier(event.target.value)}
                  placeholder="E-mail, CPF ou matricula"
                  required
                />
                <PasswordField
                  label="Senha"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  visible={showLoginPw}
                  onToggle={() => setShowLoginPw((current) => !current)}
                  required
                />
                <Button type="submit" variant="primary" className="w-full" size="lg" disabled={loading}>
                  {loading ? 'Entrando...' : 'Entrar'}
                  {!loading ? <ArrowRight className="h-4 w-4" /> : null}
                </Button>
              </form>
            ) : null}

            {mode === 'register' && !isPlatformSubdomain ? (
              <form onSubmit={handleRegister} className="space-y-4">
                {(selectedPlan || originHint) ? (
                  <Banner
                    className="mb-1"
                    tone="info"
                    title="Origem comercial"
                    description={
                      selectedPlan
                        ? `Plano de origem: ${selectedPlan}. Voce pode ajustar depois no painel.`
                        : originHint
                    }
                  />
                ) : null}
                <TextField label="Nome do responsavel" value={name} onChange={(event) => setName(event.target.value)} required />
                <TextField label="Nome da academia" value={gymName} onChange={(event) => setGymName(event.target.value)} required />
                <TextField label="E-mail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                <PasswordField
                  label="Senha"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  visible={showRegisterPw}
                  onToggle={() => setShowRegisterPw((current) => !current)}
                  required
                />
                <PasswordField
                  label="Confirmar senha"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  visible={showRegisterConfirmPw}
                  onToggle={() => setShowRegisterConfirmPw((current) => !current)}
                  required
                />
                <Button type="submit" variant="primary" className="w-full" size="lg" disabled={loading}>
                  {loading ? 'Criando conta...' : 'Criar conta'}
                </Button>
              </form>
            ) : null}

            {mode === 'verify' && !isPlatformSubdomain ? (
              <form onSubmit={handleVerify} className="space-y-4">
                <Banner
                  tone="success"
                  title="Quase pronto"
                  description={`Confirme o codigo enviado para ${email}.`}
                />
                <TextField
                  label="Codigo de verificacao"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  minLength={6}
                  maxLength={6}
                  placeholder="000000"
                  required
                />
                <Button type="submit" variant="primary" className="w-full" size="lg" disabled={loading}>
                  {loading ? 'Validando...' : 'Validar codigo'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  size="lg"
                  onClick={() =>
                    api
                      .verifyStart(email)
                      .then(() => toast.success('Codigo reenviado.'))
                      .catch((err) => toast.error(err.message))
                  }
                >
                  Reenviar codigo
                </Button>
              </form>
            ) : null}

            <div className="mt-6 border-t border-zinc-900 pt-5 text-sm text-zinc-500">
              {mode === 'login' && !isPlatformSubdomain ? (
                <p>
                  Nao tem conta?{' '}
                  <button type="button" onClick={() => setMode('register')} className="font-semibold text-[var(--brand-primary)] hover:underline">
                    Criar conta
                  </button>
                </p>
              ) : null}
              {mode === 'register' && !isPlatformSubdomain ? (
                <p>
                  Ja tem conta?{' '}
                  <button type="button" onClick={() => setMode('login')} className="font-semibold text-[var(--brand-primary)] hover:underline">
                    Fazer login
                  </button>
                </p>
              ) : null}
              {mode === 'verify' && !isPlatformSubdomain ? (
                <p>
                  Voltar para{' '}
                  <button type="button" onClick={() => setMode('login')} className="font-semibold text-[var(--brand-primary)] hover:underline">
                    login
                  </button>
                </p>
              ) : null}
              {mode === 'login' && isPlatformSubdomain ? (
                <p>Acesso restrito ao super admin da plataforma.</p>
              ) : null}
            </div>

            <div className="mt-5 flex items-center gap-3 border-t border-zinc-900 pt-5 text-xs text-zinc-500">
              <div className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[var(--brand-primary)]" />
                Sessao validada no backend
              </div>
              <div className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-sky-300" />
                RBAC por perfil
              </div>
            </div>
          </div>
        </ContentCard>
      </div>
    </div>
  );
}
