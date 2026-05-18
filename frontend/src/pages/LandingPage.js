import React, { useState, useEffect } from 'react';
import { apiUrl } from '../config';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Dumbbell, Shield, Zap, Users, ChevronRight, Check, Mail, Phone, MapPin } from 'lucide-react';
import { toast } from 'sonner';

const CONTACT_DEFAULTS = {
  email: 'contato@gymbro.dev.br',
  phone: '',
  phone_link: '',
  address: '',
  whatsapp_link: '',
};

function buildSignupUrl(params = {}) {
  const query = new URLSearchParams({ origin: 'landing', ...params });
  return `/signup?${query.toString()}`;
}

export default function LandingPage() {
  const [plans, setPlans] = useState([]);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactInfo, setContactInfo] = useState(CONTACT_DEFAULTS);
  const registerUrl = buildSignupUrl();

  useEffect(() => {
    fetch(apiUrl('/api/platform/contact'))
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setContactInfo({ ...CONTACT_DEFAULTS, ...data }); })
      .catch(() => {});
  }, []);

  const contactItems = [
    contactInfo.email ? { icon: Mail, label: 'Email', text: contactInfo.email, href: `mailto:${contactInfo.email}` } : null,
    contactInfo.phone ? { icon: Phone, label: 'Telefone', text: contactInfo.phone, href: contactInfo.phone_link ? `tel:${contactInfo.phone_link}` : null } : null,
    contactInfo.address ? { icon: MapPin, label: 'Endereco', text: contactInfo.address, href: null } : null,
  ].filter(Boolean);

  const faqItems = [
    {
      question: 'Como funciona o botao Assinar?',
      answer:
        'Ao clicar em Assinar voce vai direto para criar sua conta. Depois da validacao de e-mail, acessa o painel e segue para ativacao da assinatura.',
    },
    {
      question: 'Preciso de cartao para testar?',
      answer:
        'Nao. Voce pode criar conta e configurar o sistema primeiro. A ativacao comercial e de assinatura acontece no fluxo de cobranca.',
    },
    {
      question: 'O sistema integra com catraca?',
      answer:
        'Sim. O GymBro suporta operacao com gateway Toletus, logs de acesso e regras de bloqueio/liberacao por status do contrato.',
    },
  ];

  useEffect(() => {
    fetch(apiUrl('/api/plans/public')).then((r) => r.json()).then(setPlans).catch(() => {});
  }, []);

  const handleContactSubmit = (event) => {
    event.preventDefault();
    const name = contactName.trim();
    const email = contactEmail.trim();
    const message = contactMessage.trim();
    if (!name || !email || !message) {
      toast.error('Preencha nome, e-mail e mensagem para continuar.');
      return;
    }
    const subject = encodeURIComponent('Contato comercial GymBro');
    const body = encodeURIComponent(
      `Nome: ${name}\nE-mail: ${email}\n\nMensagem:\n${message}`,
    );
    window.location.href = `mailto:${contactInfo.email}?subject=${subject}&body=${body}`;
    toast.success('Abrindo seu cliente de e-mail.');
  };

  return (
    <div data-color-mode="dark" className="bg-[#09090b] text-white font-body min-h-screen">
      <nav data-testid="landing-nav" className="fixed top-0 w-full z-50 bg-[#09090b]/80 backdrop-blur-md border-b border-[var(--surface-border)]/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Dumbbell className="w-7 h-7 text-[#ccff00]" />
            <span className="font-heading text-2xl font-bold tracking-tight uppercase">GymBro</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[var(--text-muted)]">
            <a href="#inicio" className="hover:text-white transition-colors">Inicio</a>
            <a href="#planos" className="hover:text-white transition-colors">Planos</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <a href="#contato" className="hover:text-white transition-colors">Contato</a>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login" data-testid="nav-login-btn" className="border border-[var(--surface-border-strong)] text-white font-semibold uppercase tracking-wider text-xs px-4 py-2.5 rounded-sm hover:border-[var(--surface-border-strong)] transition-all">
              Entrar
            </Link>
            <Link to={registerUrl} data-testid="nav-signup-btn" className="bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-5 py-2.5 rounded-sm hover:bg-[#b3e600] transition-all hover:-translate-y-0.5">
              Assinar
            </Link>
          </div>
        </div>
      </nav>

      <section id="inicio" className="relative min-h-screen flex items-center pt-16">
        <div className="absolute inset-0 z-0">
          <img src="https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1920&q=80" alt="" className="w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#09090b] via-[#09090b]/90 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#09090b] via-transparent to-transparent" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <p className="text-[#ccff00] font-heading text-lg font-semibold uppercase tracking-[0.2em] mb-4">Sistema de Gestao</p>
            <h1 className="font-heading text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight uppercase leading-[0.95] mb-6">
              Gerencie sua<br />
              <span className="text-[#ccff00]">academia</span> com<br />
              inteligencia
            </h1>
            <p className="text-[var(--text-muted)] text-lg md:text-xl max-w-xl mb-10 leading-relaxed">
              Controle de alunos, assinaturas, catracas e pagamentos em uma unica plataforma. Simples, rapido e seguro.
            </p>
            <div className="flex flex-wrap gap-4 mb-6">
              <Link
                to={buildSignupUrl({ origin: 'hero' })}
                data-testid="hero-cta-btn"
                className="inline-flex items-center gap-2 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-8 py-3.5 rounded-sm hover:bg-[#b3e600] transition-all hover:-translate-y-1 shadow-[0_0_20px_rgba(204,255,0,0.25)]"
              >
                Assinar e criar conta <ChevronRight className="w-4 h-4" />
              </Link>
              <Link to="/login" className="inline-flex items-center gap-2 border-2 border-[var(--surface-border-strong)]text-white font-semibold uppercase tracking-wide text-sm px-8 py-3.5 rounded-sm hover:border-[#ccff00] hover:text-[#ccff00] transition-all">
                Acessar Painel
              </Link>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-[var(--text-muted)] uppercase tracking-wide">
              <span>1. Cria conta</span>
              <span className="hidden sm:inline text-[var(--text-muted)]">|</span>
              <span>2. Verifica e-mail</span>
              <span className="hidden sm:inline text-[var(--text-muted)]">|</span>
              <span>3. Ativa assinatura</span>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="py-24 md:py-32 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <h2 className="font-heading text-3xl md:text-5xl font-bold tracking-tight uppercase mb-4">Tudo que voce precisa</h2>
            <p className="text-[var(--text-muted)] text-lg max-w-2xl mx-auto">Uma plataforma completa para a gestao da sua academia</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {[
              { icon: Users, title: 'Gestao de Alunos', desc: 'Cadastro completo com CPF, planos, RFID e biometria. Controle total dos seus alunos.' },
              { icon: Shield, title: 'Controle de Acesso', desc: 'Integracao com catracas Toletus via RFID, biometria e teclado. Seguranca em tempo real.' },
              { icon: Zap, title: 'Pagamentos Automaticos', desc: 'Webhooks do Mercado Pago para renovacao automatica de assinaturas via PIX ou cartao.' },
            ].map((f, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="bg-[var(--surface-raised)] border border-[var(--surface-border)] rounded-md p-6 md:p-8 hover:border-[var(--surface-border-strong)]transition-colors duration-300 group">
                <div className="w-12 h-12 rounded-sm bg-[#ccff00]/10 flex items-center justify-center mb-5 group-hover:bg-[#ccff00]/20 transition-colors">
                  <f.icon className="w-6 h-6 text-[#ccff00]" />
                </div>
                <h3 className="font-heading text-xl font-semibold uppercase mb-3">{f.title}</h3>
                <p className="text-[var(--text-muted)] leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-20 bg-[var(--surface-canvas)]/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { title: 'Cadastro em minutos', desc: 'Crie sua conta e confirme o e-mail para liberar o ambiente.' },
              { title: 'Operacao organizada', desc: 'Contratos, cobrancas e acessos com status claros para reduzir erro operacional.' },
              { title: 'Escala com seguranca', desc: 'RBAC, trilhas de eventos e regras de acesso no backend.' },
            ].map((item) => (
              <div key={item.title} className="border border-[var(--surface-border)] rounded-md p-5 bg-[var(--surface-raised)]/60">
                <h3 className="font-heading text-lg uppercase mb-2">{item.title}</h3>
                <p className="text-[var(--text-muted)] text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="planos" className="py-24 md:py-32 bg-[var(--surface-canvas)]/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <h2 className="font-heading text-3xl md:text-5xl font-bold tracking-tight uppercase mb-4">Nossos Planos</h2>
            <p className="text-[var(--text-muted)] text-lg">Escolha o plano ideal para a sua academia</p>
          </motion.div>
          <div data-testid="plans-grid" className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {plans.length > 0 ? plans.map((plan, i) => (
              <motion.div key={plan.plan_id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className={`bg-[var(--surface-raised)] border rounded-md p-6 md:p-8 transition-all duration-300 ${i === 1 ? 'border-[#ccff00] scale-[1.02] shadow-[0_0_30px_rgba(204,255,0,0.1)]' : 'border-[var(--surface-border)] hover:border-[var(--surface-border-strong)]'}`}>
                {i === 1 && <span className="text-[10px] font-bold uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 px-3 py-1 rounded-sm mb-4 inline-block">Popular</span>}
                <h3 className="font-heading text-2xl font-bold uppercase mb-2">{plan.nome}</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold">R$ {Number(plan.valor || 0).toFixed(2).replace('.', ',')}</span>
                  <span className="text-[var(--text-muted)] text-sm ml-1">/{plan.duracao_dias} dias</span>
                </div>
                <p className="text-[var(--text-muted)] text-sm mb-6">{plan.descricao}</p>
                <ul className="space-y-3 mb-8">
                  {['Acesso completo', 'Suporte prioritario', 'App mobile'].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <Check className="w-4 h-4 text-[#ccff00]" /> {item}
                    </li>
                  ))}
                </ul>
                <Link
                  to={buildSignupUrl({ origin: 'pricing', plan: plan.plan_id })}
                  className={`w-full inline-flex items-center justify-center font-bold uppercase tracking-wider text-sm py-3 rounded-sm transition-all ${i === 1 ? 'bg-[#ccff00] text-black hover:bg-[#b3e600]' : 'bg-[var(--surface-soft)] text-white hover:bg-[var(--surface-soft-hover)]'}`}
                >
                  Assinar
                </Link>
              </motion.div>
            )) : (
              [
                { nome: 'Mensal', valor: 139.90, dias: 30, planId: 'owner_monthly' },
                { nome: 'Trimestral Pre-pago', valor: 369.90, dias: 90, planId: 'owner_quarterly' },
              ].map((plan, i) => (
                <motion.div key={plan.planId} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                  className={`bg-[var(--surface-raised)] border rounded-md p-6 md:p-8 ${i === 1 ? 'border-[#ccff00]' : 'border-[var(--surface-border)]'}`}>
                  {i === 1 && <span className="text-[10px] font-bold uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 px-3 py-1 rounded-sm mb-4 inline-block">Popular</span>}
                  <h3 className="font-heading text-2xl font-bold uppercase mb-2">{plan.nome}</h3>
                  <div className="mb-6">
                    <span className="text-4xl font-bold">R$ {plan.valor.toFixed(2).replace('.', ',')}</span>
                    <span className="text-[var(--text-muted)] text-sm ml-1">/{plan.dias} dias</span>
                  </div>
                  <Link
                    to={buildSignupUrl({ origin: 'pricing', plan: plan.planId })}
                    className={`w-full inline-flex items-center justify-center font-bold uppercase tracking-wider text-sm py-3 rounded-sm ${i === 1 ? 'bg-[#ccff00] text-black' : 'bg-[var(--surface-soft)] text-white'}`}
                  >
                    Assinar
                  </Link>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </section>

      <section id="faq" className="py-20 md:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-heading text-3xl md:text-5xl font-bold tracking-tight uppercase mb-4 text-center">FAQ</h2>
          <p className="text-[var(--text-muted)] text-center mb-10">Respostas rapidas para reduzir friccao no cadastro.</p>
          <div className="space-y-3">
            {faqItems.map((item) => (
              <div key={item.question} className="bg-[var(--surface-raised)] border border-[var(--surface-border)] rounded-md p-5">
                <h3 className="font-heading text-lg uppercase mb-2">{item.question}</h3>
                <p className="text-[var(--text-muted)] text-sm leading-relaxed">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="contato" className="py-24 md:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-16">
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
              <h2 className="font-heading text-3xl md:text-5xl font-bold tracking-tight uppercase mb-6">Entre em<br /><span className="text-[#ccff00]">contato</span></h2>
              <p className="text-[var(--text-muted)] text-lg mb-8 leading-relaxed">Canal direto para contratacao e suporte comercial da plataforma.</p>
              <div className="space-y-4">
                {contactItems.map((item) => (
                  <div key={item.label} className="flex items-center gap-3 text-[var(--text-secondary)]">
                    <item.icon className="w-5 h-5 text-[#ccff00]" />
                    <div className="flex flex-col">
                      <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{item.label}</span>
                      {item.href ? (
                        <a href={item.href} className="hover:text-white transition-colors">{item.text}</a>
                      ) : (
                        <span>{item.text}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <Link
                  to={buildSignupUrl({ origin: 'contact' })}
                  className="inline-flex items-center gap-2 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-6 py-3 rounded-sm hover:bg-[#b3e600] transition-all"
                >
                  Assinar agora <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </motion.div>
            <motion.form initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
              data-testid="contact-form" className="space-y-4" onSubmit={handleContactSubmit}>
              <input
                data-testid="contact-name-input"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Seu nome"
                className="w-full bg-[var(--surface-canvas)] border border-[var(--surface-border)] text-[var(--text-primary)] rounded-sm h-12 px-4 focus:outline-none focus:ring-1 focus:ring-[#ccff00] focus:border-[#ccff00] transition-colors"
              />
              <input
                data-testid="contact-email-input"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Seu e-mail"
                className="w-full bg-[var(--surface-canvas)] border border-[var(--surface-border)] text-[var(--text-primary)] rounded-sm h-12 px-4 focus:outline-none focus:ring-1 focus:ring-[#ccff00] focus:border-[#ccff00] transition-colors"
              />
              <textarea
                data-testid="contact-message-input"
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                placeholder="Sua mensagem"
                rows={4}
                className="w-full bg-[var(--surface-canvas)] border border-[var(--surface-border)] text-[var(--text-primary)] rounded-sm p-4 focus:outline-none focus:ring-1 focus:ring-[#ccff00] focus:border-[#ccff00] transition-colors resize-none"
              />
              <button data-testid="contact-submit-btn" type="submit" className="bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-8 py-3.5 rounded-sm hover:bg-[#b3e600] transition-all hover:-translate-y-0.5 w-full md:w-auto">
                Enviar Mensagem
              </button>
            </motion.form>
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--surface-border)] py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
          <div className="flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-[#ccff00]" />
            <span className="font-heading text-lg font-bold uppercase">GymBro</span>
          </div>
          <div className="text-sm text-[var(--text-muted)]">
            <p>
              {[contactInfo.email, contactInfo.phone, contactInfo.address].filter(Boolean).join(' | ') || 'GymBro'}
            </p>
            <p className="text-[var(--text-muted)]">&copy; 2026 GymBro. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
