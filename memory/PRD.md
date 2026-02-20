# GymBro - PRD (Product Requirements Document)

## Problema Original
Sistema SaaS de gestao de academias chamado "GymBro", totalmente em Portugues (PT-BR), focado em performance e seguranca. Inclui Landing Page, Painel Administrativo, CRUD de Alunos/Planos, integracao com Mercado Pago (webhooks) e catraca Toletus LiteNet2 (IoT via TCP).

## Arquitetura
- **Frontend**: React 18 + TailwindCSS + Framer Motion
- **Backend**: FastAPI (Python) + Motor (async MongoDB driver)
- **Database**: MongoDB
- **Auth**: JWT + Google OAuth (Emergent Auth)
- **Agente Local**: Python script standalone para comunicacao TCP com catraca Toletus

## User Personas
- **Dono de Academia**: Acessa dashboard, gerencia alunos e planos, monitora acessos
- **Recepcionista**: Monitora acessos em tempo real via dashboard
- **Aluno**: Visualiza planos na landing page, usa cartao RFID/biometria para acesso

## Core Requirements
1. Landing Page (Inicio, Planos, Contato) - IMPLEMENTADO
2. Autenticacao (JWT + Google OAuth) - IMPLEMENTADO
3. Dashboard com KPIs (alunos ativos/inativos, faturamento, acessos) - IMPLEMENTADO
4. CRUD de Alunos (nome, email, CPF, plano, RFID, biometria) - IMPLEMENTADO
5. CRUD de Planos (nome, valor, duracao, descricao) - IMPLEMENTADO
6. Webhook Mercado Pago (/api/webhooks/mercadopago) - IMPLEMENTADO (token placeholder)
7. API de Validacao de Acesso (/api/access/validate) - IMPLEMENTADO
8. Registro de Acessos - IMPLEMENTADO
9. Agente Local TCP para Toletus LiteNet2 - IMPLEMENTADO

## O que foi Implementado (20/02/2026)
- [x] Backend completo com 15+ endpoints
- [x] Frontend com 6 paginas (Landing, Login, Dashboard, Alunos, Planos, Acessos)
- [x] Auth JWT + Google OAuth via Emergent Auth
- [x] Design dark mode com Electric Lime (#ccff00)
- [x] Dados seed para demonstracao
- [x] Webhook Mercado Pago (com logica completa de renovacao)
- [x] API de validacao de acesso para catraca
- [x] Agente Local Python para Toletus LiteNet2
- [x] Testes: Backend 100% (10/10), Frontend 100% (22/22)

## Backlog Priorizado
### P0 (Critico)
- Configurar Access Token real do Mercado Pago
- Testar Agente Local com catraca real

### P1 (Importante)
- Graficos de faturamento no dashboard (Recharts)
- Exportacao de relatorios (PDF/Excel)
- Notificacoes por email para vencimentos

### P2 (Desejavel)
- App mobile para alunos
- Dashboard de ocupacao em tempo real via WebSocket
- Integracao com sistema de treinos
- Multi-tenancy para franquias

## Proximos Passos
1. Configurar token Mercado Pago de producao
2. Testar Agente Local na rede da academia com catraca real
3. Adicionar graficos ao dashboard
4. Deploy em VPS DigitalOcean
