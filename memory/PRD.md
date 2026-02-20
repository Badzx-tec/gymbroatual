# GymBro - PRD (Product Requirements Document)

## Problema Original
Sistema SaaS de gestao de academias chamado "GymBro", totalmente em Portugues (PT-BR), focado em performance e seguranca. Inclui Landing Page, Painel Administrativo, CRUD de Alunos/Planos, integracao com Mercado Pago (webhooks), catraca Toletus LiteNet2 (IoT via TCP), dashboard com graficos, multi-tenancy, notificacoes, exportacao de relatorios e controle remoto da catraca.

## Arquitetura
- **Frontend**: React 18 + TailwindCSS + Framer Motion + Recharts
- **Backend**: FastAPI (Python) + Motor (async MongoDB driver) + WebSocket
- **Database**: MongoDB (collections: users, students, plans, access_logs, academies, notifications, catraca_commands, webhook_logs)
- **Auth**: JWT + Google OAuth (Emergent Auth)
- **Agente Local**: Python script standalone para comunicacao TCP com catraca Toletus
- **Real-time**: WebSocket nativo do FastAPI para atualizacoes em tempo real

## User Personas
- **Super Admin**: Gerencia todas as franquias, acesso total
- **Dono de Academia (Admin)**: Acessa dashboard da sua unidade, gerencia alunos e planos
- **Recepcionista**: Monitora acessos em tempo real, controla catraca remotamente
- **Aluno**: Visualiza planos na landing page, usa cartao RFID/biometria para acesso

## Core Requirements
1. Landing Page (Inicio, Planos, Contato) - IMPLEMENTADO
2. Autenticacao (JWT + Google OAuth) - IMPLEMENTADO
3. Dashboard com KPIs e Graficos Recharts - IMPLEMENTADO (20/02/2026)
4. CRUD de Alunos com exportacao PDF/Excel - IMPLEMENTADO (20/02/2026)
5. CRUD de Planos (Mensal R$139.90, Tri R$369.90, Sem R$669.90, Anual R$1249.90) - IMPLEMENTADO
6. Registro de Acessos com tempo real via WebSocket - IMPLEMENTADO (20/02/2026)
7. Webhook Mercado Pago - IMPLEMENTADO (token placeholder)
8. API de Validacao de Acesso - IMPLEMENTADO
9. Agente Local TCP para Toletus LiteNet2 - IMPLEMENTADO
10. Multi-tenancy (Franquias) com stats por academia - IMPLEMENTADO (20/02/2026)
11. Notificacoes de vencimento (email simulado) - IMPLEMENTADO (20/02/2026)
12. Exportacao de relatorios PDF/Excel (alunos, acessos, financeiro) - IMPLEMENTADO (20/02/2026)
13. Dashboard de ocupacao em tempo real - IMPLEMENTADO (20/02/2026)
14. Controle remoto da catraca (liberar, bloquear, mensagem) - IMPLEMENTADO (20/02/2026)

## O que foi Implementado

### Iteracao 1 (20/02/2026)
- Backend completo com 15+ endpoints (FastAPI)
- Frontend com 6 paginas (Landing, Login, Dashboard, Alunos, Planos, Acessos)
- Auth JWT + Google OAuth
- Design dark mode Electric Lime (#ccff00)
- Dados seed para demonstracao
- Webhook Mercado Pago
- API de validacao para catraca
- Agente Local Python

### Iteracao 2 (20/02/2026)
- Graficos Recharts no Dashboard (Receita por Plano, Acessos por Hora, Receita Mensal)
- Multi-tenancy completo (CRUD de academias com stats isolados)
- Notificacoes de vencimento (email simulado - 2 alunos detectados)
- Exportacao PDF/Excel (4 endpoints: alunos PDF/Excel, acessos Excel, financeiro Excel)
- WebSocket real-time para acessos e comandos de catraca
- Controle remoto da catraca (4 acoes: liberar entrada/saida, bloquear, mensagem)
- Precos atualizados: Mensal R$139.90, Trimestral R$369.90, Semestral R$669.90, Anual R$1249.90
- 7 paginas no admin: Dashboard, Alunos, Planos, Acessos, Franquias, Notificacoes, Catraca
- Testes: Backend 100% (15/15), Frontend 100% (35/35)

## Backlog Priorizado
### P0 (Critico)
- Configurar Access Token real do Mercado Pago
- Testar Agente Local com catraca Toletus real

### P1 (Importante)
- Integrar provedor de email real (SendGrid/Resend)
- Deploy em VPS DigitalOcean
- Logs de webhook detalhados

### P2 (Desejavel)
- App mobile para alunos
- Integracao com sistema de treinos
- Relatorios personalizados com filtros de data
- Backup automatico do MongoDB

## Proximos Passos
1. Configurar token Mercado Pago de producao
2. Testar Agente Local com catraca real na rede 192.168.1.9
3. Integrar provedor de email real
4. Deploy em DigitalOcean (Docker Compose recomendado)
