import React, { useState, useEffect } from 'react';
import { apiUrl } from '../config';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Dumbbell, Shield, Zap, Users, ChevronRight, Check, Mail, Phone, MapPin } from 'lucide-react';

export default function LandingPage() {
  const [plans, setPlans] = useState([]);
  const registerUrl = '/login?mode=register';
  const contactItems = [
    { icon: Mail, label: 'Email', text: 'juannicarosa@gmail.com', href: 'mailto:juannicarosa@gmail.com' },
    { icon: Phone, label: 'Telefone', text: '(33) 98851-5895', href: 'tel:+5533988515895' },
    { icon: MapPin, label: 'Endereco', text: 'Machacalis/MG', href: null },
  ];

  useEffect(() => {
    fetch(apiUrl('/api/plans/public')).then(r => r.json()).then(setPlans).catch(() => {});
  }, []);

  return (
    <div className="bg-[#09090b] text-white font-body min-h-screen">
      {/* Nav */}
      <nav data-testid="landing-nav" className="fixed top-0 w-full z-50 bg-[#09090b]/80 backdrop-blur-md border-b border-zinc-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Dumbbell className="w-7 h-7 text-[#ccff00]" />
            <span className="font-heading text-2xl font-bold tracking-tight uppercase">GymBro</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
            <a href="#inicio" className="hover:text-white transition-colors">Inicio</a>
            <a href="#planos" className="hover:text-white transition-colors">Planos</a>
            <a href="#contato" className="hover:text-white transition-colors">Contato</a>
          </div>
          <Link to="/login" data-testid="nav-login-btn" className="bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-6 py-2.5 rounded-sm hover:bg-[#b3e600] transition-all hover:-translate-y-0.5">
            Entrar
          </Link>
        </div>
      </nav>

      {/* Hero */}
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
            <p className="text-zinc-400 text-lg md:text-xl max-w-xl mb-10 leading-relaxed">
              Controle de alunos, assinaturas, catracas e pagamentos em uma unica plataforma. Simples, rapido e seguro.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                to={registerUrl}
                data-testid="hero-cta-btn"
                className="inline-flex items-center gap-2 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-8 py-3.5 rounded-sm hover:bg-[#b3e600] transition-all hover:-translate-y-1 shadow-[0_0_20px_rgba(204,255,0,0.25)]"
              >
                Assinar e criar conta <ChevronRight className="w-4 h-4" />
              </Link>
              <Link to="/login" className="inline-flex items-center gap-2 border-2 border-zinc-700 text-white font-semibold uppercase tracking-wide text-sm px-8 py-3.5 rounded-sm hover:border-[#ccff00] hover:text-[#ccff00] transition-all">
                Acessar Painel
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 md:py-32 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <h2 className="font-heading text-3xl md:text-5xl font-bold tracking-tight uppercase mb-4">Tudo que voce precisa</h2>
            <p className="text-zinc-400 text-lg max-w-2xl mx-auto">Uma plataforma completa para a gestao da sua academia</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {[
              { icon: Users, title: 'Gestao de Alunos', desc: 'Cadastro completo com CPF, planos, RFID e biometria. Controle total dos seus alunos.' },
              { icon: Shield, title: 'Controle de Acesso', desc: 'Integracao com catracas Toletus via RFID, biometria e teclado. Seguranca em tempo real.' },
              { icon: Zap, title: 'Pagamentos Automaticos', desc: 'Webhooks do Mercado Pago para renovacao automatica de assinaturas via PIX ou cartao.' },
            ].map((f, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="bg-zinc-900 border border-zinc-800 rounded-md p-6 md:p-8 hover:border-zinc-700 transition-colors duration-300 group">
                <div className="w-12 h-12 rounded-sm bg-[#ccff00]/10 flex items-center justify-center mb-5 group-hover:bg-[#ccff00]/20 transition-colors">
                  <f.icon className="w-6 h-6 text-[#ccff00]" />
                </div>
                <h3 className="font-heading text-xl font-semibold uppercase mb-3">{f.title}</h3>
                <p className="text-zinc-400 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section id="planos" className="py-24 md:py-32 bg-zinc-950/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <h2 className="font-heading text-3xl md:text-5xl font-bold tracking-tight uppercase mb-4">Nossos Planos</h2>
            <p className="text-zinc-400 text-lg">Escolha o plano ideal para a sua academia</p>
          </motion.div>
          <div data-testid="plans-grid" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.length > 0 ? plans.map((plan, i) => (
              <motion.div key={plan.plan_id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className={`bg-zinc-900 border rounded-md p-6 md:p-8 transition-all duration-300 ${i === 1 ? 'border-[#ccff00] scale-[1.02] shadow-[0_0_30px_rgba(204,255,0,0.1)]' : 'border-zinc-800 hover:border-zinc-700'}`}>
                {i === 1 && <span className="text-[10px] font-bold uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 px-3 py-1 rounded-sm mb-4 inline-block">Popular</span>}
                <h3 className="font-heading text-2xl font-bold uppercase mb-2">{plan.nome}</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold">R$ {plan.valor.toFixed(2).replace('.', ',')}</span>
                  <span className="text-zinc-500 text-sm ml-1">/{plan.duracao_dias} dias</span>
                </div>
                <p className="text-zinc-400 text-sm mb-6">{plan.descricao}</p>
                <ul className="space-y-3 mb-8">
                  {['Acesso completo', 'Suporte prioritario', 'App mobile'].map((item, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm text-zinc-300">
                      <Check className="w-4 h-4 text-[#ccff00]" /> {item}
                    </li>
                  ))}
                </ul>
                <Link
                  to={`${registerUrl}${plan.plan_id ? `&plan=${encodeURIComponent(plan.plan_id)}` : ''}`}
                  className={`w-full inline-flex items-center justify-center font-bold uppercase tracking-wider text-sm py-3 rounded-sm transition-all ${i === 1 ? 'bg-[#ccff00] text-black hover:bg-[#b3e600]' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}
                >
                  Assinar
                </Link>
              </motion.div>
            )) : (
              [
                { nome: 'Mensal', valor: 139.90, dias: 30 },
                { nome: 'Trimestral', valor: 369.90, dias: 90 },
                { nome: 'Semestral', valor: 669.90, dias: 180 },
                { nome: 'Anual', valor: 1249.90, dias: 365 },
              ].map((plan, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                  className={`bg-zinc-900 border rounded-md p-6 md:p-8 ${i === 1 ? 'border-[#ccff00]' : 'border-zinc-800'}`}>
                  {i === 1 && <span className="text-[10px] font-bold uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 px-3 py-1 rounded-sm mb-4 inline-block">Popular</span>}
                  <h3 className="font-heading text-2xl font-bold uppercase mb-2">{plan.nome}</h3>
                  <div className="mb-6">
                    <span className="text-4xl font-bold">R$ {plan.valor.toFixed(2).replace('.', ',')}</span>
                    <span className="text-zinc-500 text-sm ml-1">/{plan.dias} dias</span>
                  </div>
                  <Link
                    to={registerUrl}
                    className={`w-full inline-flex items-center justify-center font-bold uppercase tracking-wider text-sm py-3 rounded-sm ${i === 1 ? 'bg-[#ccff00] text-black' : 'bg-zinc-800 text-white'}`}
                  >
                    Assinar
                  </Link>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contato" className="py-24 md:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-16">
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
              <h2 className="font-heading text-3xl md:text-5xl font-bold tracking-tight uppercase mb-6">Entre em<br /><span className="text-[#ccff00]">contato</span></h2>
              <p className="text-zinc-400 text-lg mb-8 leading-relaxed">Canal direto para contratacao e suporte comercial da plataforma.</p>
              <div className="space-y-4">
                {contactItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-zinc-300">
                    <item.icon className="w-5 h-5 text-[#ccff00]" />
                    <div className="flex flex-col">
                      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{item.label}</span>
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
                  to={registerUrl}
                  className="inline-flex items-center gap-2 bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-6 py-3 rounded-sm hover:bg-[#b3e600] transition-all"
                >
                  Assinar agora <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </motion.div>
            <motion.form initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
              data-testid="contact-form" className="space-y-4" onSubmit={e => e.preventDefault()}>
              <input data-testid="contact-name-input" type="text" placeholder="Seu nome" className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4 focus:outline-none focus:ring-1 focus:ring-[#ccff00] focus:border-[#ccff00] transition-colors" />
              <input data-testid="contact-email-input" type="email" placeholder="Seu e-mail" className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm h-12 px-4 focus:outline-none focus:ring-1 focus:ring-[#ccff00] focus:border-[#ccff00] transition-colors" />
              <textarea data-testid="contact-message-input" placeholder="Sua mensagem" rows={4} className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-sm p-4 focus:outline-none focus:ring-1 focus:ring-[#ccff00] focus:border-[#ccff00] transition-colors resize-none" />
              <button data-testid="contact-submit-btn" type="submit" className="bg-[#ccff00] text-black font-bold uppercase tracking-wider text-sm px-8 py-3.5 rounded-sm hover:bg-[#b3e600] transition-all hover:-translate-y-0.5 w-full md:w-auto">
                Enviar Mensagem
              </button>
            </motion.form>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
          <div className="flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-[#ccff00]" />
            <span className="font-heading text-lg font-bold uppercase">GymBro</span>
          </div>
          <div className="text-sm text-zinc-400">
            <p>Contato: juannicarosa@gmail.com | (33) 98851-5895 | Machacalis/MG</p>
            <p className="text-zinc-500">&copy; 2026 GymBro. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
