# Contratos Admin - Diagnostico, Implementacao e Testes

## FASE 0 - Diagnostico Obrigatorio

### 1) Stack identificado
- Frontend: React 18 + React Router 6 + Tailwind utilitario + `lucide-react` + `sonner`.
- Backend: FastAPI + Motor/PyMongo (MongoDB), organizacao por routers em `backend/app/routes`.
- Auth/RBAC: dependencias `require_roles`, `require_admin_actor`, `require_active_subscription` em `backend/app/core/deps.py`.
- Estado no frontend: `useState`, `useEffect`, `useMemo`, chamadas centralizadas em `frontend/src/api.js`.
- i18n: sem framework de i18n; textos em pt-BR direto nos componentes.

### 2) Onde /admin/contratos estava implementado
- Rota frontend:
  - `frontend/src/App.js` -> `path="contratos"` renderiza `StudentContractsPage`.
- Navegacao admin:
  - `frontend/src/components/AdminLayout.js` -> item `/admin/contratos`.
- Pagina antiga:
  - `frontend/src/pages/StudentContractsPage.js` (monolitica).
- Endpoints antigos usados pela pagina:
  - `/api/student-billing/overview`
  - `/api/student-billing/contracts`
  - `/api/student-billing/contracts/{id}`
  - `/api/student-billing/contracts/{id}/renew`
  - `/api/student-billing/contracts/{id}/cancel`
  - `/api/student-billing/contracts/{id}/freeze`
  - `/api/student-billing/contracts/{id}/resume`

### 3) Estado anterior levantado
- Campos e acoes existiam, mas UI estava densa e com pouco foco operacional.
- Lista sem paginacao server-side com meta completa; busca/filtros pouco compartilhaveis.
- Nao havia endpoint admin dedicado com sort/filter/page padronizados.
- Sem auditoria persistente dedicada para acoes do painel de contratos.
- Exportacao de contratos nao estava em endpoint administrativo especifico.

### 4) Baseline de comandos (antes da reforma)
- Frontend lint: passa com warnings preexistentes de hooks/deps.
- Frontend build: passa com os mesmos warnings.
- Backend (`test_student_billing.py`): 1 falha preexistente sensivel a data/hora atual (`status` esperado `active`, retornando `past_due`).

## Implementacao Entregue

## Frontend (reforma completa da UX da pagina)
- Nova composicao da pagina de contratos com componentes dedicados:
  - `frontend/src/pages/StudentContractsPage.js`
  - `frontend/src/pages/contracts/ContractsOverview.jsx`
  - `frontend/src/pages/contracts/ContractsTable.jsx`
  - `frontend/src/pages/contracts/ContractsFilters.jsx`
  - `frontend/src/pages/contracts/ContractDetailsDrawer.jsx`
  - `frontend/src/pages/contracts/contractsUtils.js`

### UX implementada
- Header claro:
  - Titulo "Contratos"
  - Subtitulo operacional
  - Acoes: Novo contrato, Exportar, Filtros.
- Overview compacto (4 cards clicaveis):
  - Ativos
  - Vencem em 7 dias
  - Pendentes/atraso
  - Cancelados no mes
- Tabela inteligente:
  - Paginacao server-side (20/50/100)
  - Busca global
  - Ordenacao server-side
  - Colunas principais + badges de status
  - Menu de acoes por linha (detalhes, renovar, pausar, cancelar, PDF, copiar link)
  - Selecao multipla + acoes em lote (cancelar/exportar selecionados)
- Filtros em drawer lateral:
  - Status (multi)
  - Plano (multi)
  - Periodo
  - Expira em (7/15/30)
  - Somente pendentes/inadimplentes
  - Aplicar/Limpar/Salvar visao (localStorage)
- Detalhe em drawer grande:
  - Resumo
  - Timeline
  - Auditoria
  - Cobrancas
  - Botoes contextuais (renovar/pausar/cancelar/baixar PDF)
- Estados UX:
  - Loading com skeleton
  - Empty state sem contratos
  - Empty state com filtros
  - Erro de API com retry

### Sincronizacao com URL
- Filtros, busca, ordenacao, pagina e contrato aberto ficam em querystring:
  - `page`, `pageSize`, `q`, `sortBy`, `sortDir`, `status[]`, `planoId[]`,
    `startDate`, `endDate`, `expiringInDays`, `pendingOnly`, `contractId`.

## Backend/API admin nova

- Novo router: `backend/app/routes/admin_contracts.py`
- Registrado em `backend/app/routes/__init__.py` com prefixo `/api/admin`.

### Endpoints adicionados
- `GET /api/admin/contratos`
  - filtros/paginacao/sort server-side
  - retorno: `{ data, meta }` com `totalsByStatus`, `expiringSoonCount`, `pendingCount`, `canceledMonthCount`.
- `GET /api/admin/contratos/{id}`
  - detalhe com contrato + cobrancas + eventos + auditoria + capacidades.
- `POST /api/admin/contratos/{id}/renovar`
- `POST /api/admin/contratos/{id}/cancelar`
- `POST /api/admin/contratos/{id}/pausar`
- `POST /api/admin/contratos/remover-cancelados`
- `GET /api/admin/contratos/{id}/pdf`
- `GET /api/admin/contratos/export`
  - `format=xlsx|csv` e suporte a `ids[]` para exportacao dos selecionados.

### Regras de seguranca mantidas
- Listar/detalhar/exportar/pdf: `OWNER`, `MANAGER`, `RECEPTION`.
- Cancelar/Pausar: `OWNER`, `MANAGER`.
- Renovar: `OWNER`, `MANAGER`, `RECEPTION`.
- Validacoes:
  - `sortBy` whitelist
  - `sortDir` whitelist
  - `q` limitado
  - datas validadas
  - range de pagina/tamanho.

### Auditoria
- Colecao persistente `contract_audit` com:
  - `action`, `actor_*`, `payload`, `before`, `after`, `created_at`.
- Gravada automaticamente em renovar/cancelar/pausar.

### Performance/consistencia
- Paginacao real no banco (`skip` + `limit`).
- Ordenacao no banco por colunas mapeadas.
- Pre-carga de proxima cobranca por lote (evitando N+1 por contrato).
- Indices adicionados:
  - `student_contracts(owner_id, current_period_start)`
  - `student_contracts(owner_id, updated_at)`
  - `contract_audit(owner_id, contract_id, created_at)`
  - `contract_audit(owner_id, action, created_at)`

## Testes e validacoes executados

### Backend
- `python -m pytest backend/tests/test_admin_contracts.py -q` -> **2 passed**
- `python -m pytest backend/tests/test_app_import.py -q` -> **1 passed**
- Observacao preexistente:
  - `python -m pytest backend/tests/test_student_billing.py -q` -> **1 falha antiga** por sensibilidade temporal.

### Frontend
- `npm --prefix frontend run lint` -> passa com warnings preexistentes globais.
- `npm --prefix frontend run build` -> build OK com warnings preexistentes globais.
- Infra de testes frontend dedicada nao estava configurada com script/test runner no `package.json`; mantido smoke por build + lint.

## Como testar manualmente

### UI
1. Acesse `/admin/contratos`.
2. Valide cards clicaveis e aplicacao de filtros rapidos.
3. Busque por nome/plano/ID e altere ordenacao nas colunas.
4. Teste paginacao em 20/50/100.
5. Abra filtros (drawer), aplique e limpe.
6. Clique linha -> drawer de detalhe com timeline/auditoria/cobrancas.
7. Execute acoes: renovar, pausar, cancelar.
8. Teste exportacao geral e exportacao de selecionados.
9. Teste botao "Remover cancelados" no header (acao permanente).

### API (exemplos)
- Lista paginada com filtros:
  - `/api/admin/contratos?page=1&pageSize=20&q=ana&sortBy=updatedAt&sortDir=desc&status=active&planoId=pln_basic&pendingOnly=true`
- Expirando em 7 dias:
  - `/api/admin/contratos?expiringInDays=7`
- Detalhe:
  - `/api/admin/contratos/ctr_xxx`
- Cancelar:
  - `POST /api/admin/contratos/ctr_xxx/cancelar` body `{ "mode": "end_of_cycle", "reason": "teste" }`
- Pausar:
  - `POST /api/admin/contratos/ctr_xxx/pausar` body `{ "days": 7, "reason": "ferias" }`
- PDF:
  - `/api/admin/contratos/ctr_xxx/pdf`
- Exportar:
  - `/api/admin/contratos/export?format=xlsx&status=active`

---

# Auditoria Global - 06/03/2026

## Stack real
- Frontend: React 18 com `react-scripts` (CRA), React Router 6, Tailwind CSS, `sonner`, `lucide-react`, `recharts`, `framer-motion`.
- Backend: FastAPI 0.110, Motor/PyMongo, Pydantic v2, JWT stateless, MongoDB.
- Infra: Docker Compose, Nginx reverso, Mongo, gateway Toletus separado.

## P0 encontrados e corrigidos
- Auth no frontend dependia de `localStorage` persistente para `gymbro_token`.
- Backend nao tinha logout real em `/api/auth/logout`; havia apenas um stub legado.
- Login de funcionario buscava por e-mail sem resolver ambiguidade multi-tenant.
- `get_current_actor` aceitava apenas bearer header; nao havia sessao `httpOnly` para reduzir exposicao.
- Healthcheck de producao validava apenas `health`, sem readiness real de banco.
- Dashboard tinha bug real no KPI de faturamento e o baseline de testes ja acusava isso.

## P1/P2 atacados nesta rodada
- Route-level code splitting no frontend com `React.lazy` + `Suspense`.
- Mini design system interno inicial em `frontend/src/components/ui`.
- Dashboard e Alunos com hierarquia visual e componentes padronizados.
- Headers de seguranca no Nginx e propagacao de `X-Request-ID`.
- Indices adicionais e auditoria persistente em `audit_logs`.
- Overview financeiro de contratos deixou de percorrer/refreshar todos os contratos em memoria.

## Mudancas principais desta rodada
- Backend:
  - cookie de sessao `httpOnly` com renovacao controlada
  - `/api/auth/logout` real com revogacao por `session_revoked_at`
  - `/health/ready` e `/api/health/ready`
  - auditoria de auth em `audit_logs`
  - CORS configuravel por metodos/headers
  - validacoes de seguranca para producao em `Settings`
  - protecao contra login ambiguo de funcionario
  - dashboard com receita dos ultimos 30 dias
  - `student-billing/overview` otimizado por `count_documents`
- Frontend:
  - sessao centralizada em `frontend/src/lib/session.js`
  - token migrado de `localStorage` legado para `sessionStorage`, mantendo compatibilidade
  - `App.js` refatorado com lazy routes
  - `api.js` centralizado com `clearSession()` e `X-Requested-With`
  - novos componentes: `Button`, `PageHeader`, `StatCard`, `LoadingScreen`, `EmptyState`, `TextField`, `SelectField`
  - Dashboard e Alunos atualizados para usar a base visual nova
  - warnings de lint eliminados

## Validacao atual
- `python -m pytest backend/tests -q` -> **88 passed**
- `npm --prefix frontend run lint` -> **passa sem warnings**
- `npm --prefix frontend run build` -> **passa**

## Como validar manualmente
1. Login no painel admin com owner, funcionario e aluno.
2. Recarregar a pagina e confirmar que a sessao continua valida sem depender de `localStorage`.
3. Abrir DevTools > Application e verificar:
   - token nao persistido em `localStorage`
   - cookie de sessao presente via backend/nginx
4. Testar logout e confirmar revogacao imediata.
5. Abrir `/admin` e conferir:
   - dashboard carregando com chunks separados
   - cards e acoes do topo
   - KPI financeiro coerente com ultimos 30 dias
6. Abrir `/admin/alunos` e conferir:
   - header novo
   - cards resumo
   - filtros/busca/exportacao
7. Validar readiness:
   - `/health/ready`
   - `/api/health/ready`

---

# Cobranca e Assinatura - 06/03/2026

## Objetivo
- Atacar a proxima tela critica do produto pelo impacto direto em receita e suporte.
- Reduzir waterfall no frontend de cobranca.
- Melhorar leitura operacional do status da assinatura SaaS.

## Backend
- Novo endpoint agregado:
  - `GET /api/billing/overview`
- Parametros:
  - `invoice_limit`
  - `attempt_limit`
  - `event_limit`
  - `refresh=true` para reconciliar com o provedor antes de responder
- Mantive compatibilidade:
  - endpoints antigos de `subscription/status`, `membership`, `invoices`, `payment-attempts` e `events` continuam existindo
- Resumo retornado no overview:
  - `recognized_revenue`
  - `outstanding_amount`
  - `paid_invoice_count`
  - `open_invoice_count`
  - `past_due_invoice_count`
  - `failed_attempt_count`
  - `next_invoice_due_at`
  - `last_event_at`
  - `action_required`

## Frontend
- Refatoradas:
  - `/admin/cobranca`
  - `/admin/assinatura`
- Nova base reutilizavel:
  - `frontend/src/features/billing/useBillingOverview.js`
  - `frontend/src/features/billing/billingUtils.js`
  - `frontend/src/features/billing/BillingStatusBadge.jsx`
  - `frontend/src/components/ui/SectionCard.jsx`
  - `frontend/src/components/ui/StatusBadge.jsx`
- Ganhos principais:
  - uma chamada agregada para a tela de cobranca
  - hierarquia visual melhor
  - estados vazios e erro mais claros
  - CTA mais evidente
  - copy operacional em pt-BR claro

## Validacao
- `python -m pytest backend/tests -q` -> **90 passed**
- `npm --prefix frontend run lint` -> **passa**
- `npm --prefix frontend run build` -> **passa**

## Teste manual sugerido
1. Abrir `/admin/assinatura`
2. Abrir `/admin/cobranca`
3. Testar:
   - `Abrir checkout`
   - `Ja paguei, verificar`
   - `Atualizar`
4. Validar cenarios:
   - assinatura ativa
   - assinatura `past_due`
   - retorno do checkout com `?status=success|pending|failure`

## Fix Mercado Pago - painel nao liberado apos pagamento
- Causa tratada:
  - em alguns fluxos o webhook chega como `type=payment` sem `external_reference` suficiente no payload
  - no fallback de Checkout Pro, o reconcile antigo so consultava `preapproval`, sem recuperar pagamento aprovado por `external_reference`
- Ajustes aplicados:
  - webhook agora busca detalhes do pagamento em `v1/payments/{id}` quando necessario
  - reconcile agora procura pagamento `approved` recente por `external_reference`
  - se encontrar pagamento aprovado recente, atualiza assinatura para `active` e reabre o painel
- Validacao:
  - `python -m pytest backend/tests -q` -> **92 passed**

---

# Visual System, Login, Equipe e Catraca - 08/03/2026

## Escopo entregue
- Shell administrativo premium com sidebar, topbar e branding mais coerentes.
- Tela de login refeita com hierarquia melhor, contexto comercial e confianca visual.
- Credenciais sensiveis migradas para dialogo reutilizavel.
- Tela de equipe refeita com:
  - cards KPI
  - formularios padronizados
  - busca e filtros
  - side panels para editar, credenciais e biometria
  - confirm dialog no lugar de `window.confirm`
  - eliminacao de `window.prompt`
- Tela de catraca refeita com:
  - cards de resumo
  - painel de controle direcional mais claro
  - filtros melhores
  - detalhe lateral por acesso
  - dispositivos e historico de tokens mais operacionais

## Bugs e debt corrigidos nesta rodada
- `StaffPage` dependia de `prompt/confirm`, gerando UX fragil e pouco auditavel.
- `StaffPage.load()` acionava loading cheio mesmo em refresh silencioso.
- `CredentialPanel` era apenas um bloco inline; agora virou dialogo reutilizavel.
- `LoginPage` tinha import morto e branding fraco.
- `CatracaPage` nao tinha detalhe lateral por acesso e misturava leitura critica com cards MVP.

## Validacao desta rodada
- `npm --prefix frontend run lint` -> **passa**
- `npm --prefix frontend run build` -> **passa**

## Validacao manual sugerida
1. Abrir `/login` e validar visual, estados e mensagens.
2. Abrir `/admin/funcionarios`:
   - criar funcionario
   - abrir credenciais
   - editar em side panel
   - cadastrar biometria em duas etapas
   - cancelar convite
3. Abrir `/admin/catraca`:
   - aplicar travas por escopo
   - abrir detalhes de um acesso
   - criar dispositivo
   - rotacionar token

## Dashboard, Alunos e Contratos - alinhamento visual adicional
- `Dashboard` harmonizado com `SectionCard`, `Banner`, `StatusBadge` e uso do token de marca nas visualizacoes.
- `Alunos` refeito sobre a base nova com:
  - filtros melhores
  - confirm dialog para exclusao
  - side panel para detalhe
  - dialog padronizado para criar/editar
  - historico de credenciais consistente
- `Contratos` harmonizado com:
  - `PageHeader`, `SectionCard`, `SearchInput`, `Button`
  - `ContractsFilters` movido para `SidePanel`
  - `ContractDetailsDrawer` migrado para a base visual nova
  - badges/status usando o mesmo padrao das outras telas

### Validacao complementar
- `npm --prefix frontend run lint` -> **passa**
- `npm --prefix frontend run build` -> **passa**
- `python -m pytest backend/tests -q` -> **92 passed**

## Contratos - cleanup de dialogs operacionais
- `StudentContractsPage` nao usa mais `window.confirm` e `window.prompt` para:
  - cancelar pagamento
  - colocar contrato em dia
  - pausar contrato
  - cancelar contrato
  - cancelar contratos em lote
  - remover cancelados
- Todas essas acoes agora usam `Dialog` com contexto, descricao curta e campos quando necessario.
- O fluxo de `Novo contrato` tambem foi migrado para o `Dialog` padrao com `TextField` e `SelectField`.

### Validacao desta etapa
- `npm --prefix frontend run lint` -> **passa**
- `npm --prefix frontend run build` -> **passa**

## NotificationsPage operacional
- `NotificationsPage` foi elevada para uma fila operacional real:
  - busca por texto
  - filtros por estado
  - selecao multipla
  - acoes em lote para marcar leitura e remover
  - painel lateral de detalhe
  - confirmacao para remocao
  - atualizacao local sem reload completo da pagina a cada acao
- O badge de notificacoes na sidebar agora reage imediatamente a alteracoes feitas na propria tela.
- Backend recebeu endpoints em lote compativeis com o fluxo novo:
  - `POST /api/notifications/read-bulk`
  - `POST /api/notifications/delete-bulk`
- O endpoint de leitura individual passou a registrar `read_at`.

### Validacao desta etapa
- `python -m pytest backend/tests/test_notifications.py -q` -> **2 passed**
- `python -m pytest backend/tests -q` -> **95 passed**
- `npm --prefix frontend run lint` -> **passa**
- `npm --prefix frontend run build` -> **passa**
- `python -m pytest backend/tests -q` -> **92 passed**

## Refino do modo claro nas telas principais
- O tema branco foi fechado nas paginas com maior volume operacional que ainda tinham resquicios de classes escuras hardcoded:
  - `LoginPage`
  - `Dashboard`
  - `StudentsPage`
  - `StudentContractsPage`
  - `NotificationsPage`
- `NotificationsPage` foi reorganizada como inbox operacional:
  - cards de resumo
  - filtros por estado
  - busca local
  - lista mais legivel com acoes claras
- Os componentes e blocos dessas telas agora usam tokens semanticos de superficie, texto e borda no lugar de `zinc-*` fixo.
- Foi corrigido texto com encoding visual quebrado na tela de login.

### Validacao desta etapa
- `npm --prefix frontend run lint` -> **passa**
- `npm --prefix frontend run build` -> **passa**

## Tema branco e sistema de aparencia
- O branding agora suporta `color_mode` com dois estados:
  - `dark`
  - `light`
- O backend passou a persistir `color_mode` no `branding` do owner e a propagar essa preferencia para:
  - owner
  - funcionarios
  - alunos
- `ProfilePage` ganhou escolha explicita de modo da interface na secao de branding.
- `App` agora adapta o `Toaster` ao modo atual.
- `applyBrandingToDocument` agora aplica:
  - `data-color-mode`
  - `color-scheme`
  - `meta[name="theme-color"]`
- A base visual foi adaptada para o modo claro em:
  - `Button`
  - `IconButton`
  - `SearchInput`
  - `TextField`
  - `SelectField`
  - `SectionCard`
  - `PageHeader`
  - `StatCard`
  - `Dialog`
  - `SidePanel`
  - `BrandMark`
  - `ContentCard`
  - `AdminLayout`
  - `StudentLayout`
- `index.css` passou a usar tokens semanticos e overrides controlados para os utilitarios mais frequentes, reduzindo retrabalho pagina por pagina.

### Validacao desta etapa
- `npm --prefix frontend run lint` -> **passa**
- `npm --prefix frontend run build` -> **passa**
- `python -m pytest backend/tests/test_auth_owner_role_payload.py -q` -> **3 passed**
- `python -m pytest backend/tests -q` -> **93 passed**

## Assinatura, Academias, Planos, Acessos e shell do aluno
- `SubscriptionPage` foi alinhada ao restante da base visual:
  - banner operacional por estado da assinatura
  - cards de vigencia, ultimo pagamento, carencia e faturas em atraso
  - secoes para leitura da assinatura, proximos passos, faturas e eventos
  - `SidePanel` para detalhe de fatura e evento
  - botao real de sincronizacao: `Ja paguei, verificar`
- `PlansPage` foi refeita:
  - sem `window.confirm`
  - cards de resumo
  - busca e filtro de status
  - dialog unico para criar e editar plano
  - confirmacao de exclusao com `Dialog`
- `AccessLogsPage` ganhou leitura operacional:
  - cards de resumo
  - filtros por perfil e decisao
  - busca local
  - destaque do principal motivo de negacao
  - `SidePanel` com detalhe do evento de acesso
- `StudentLayout` foi elevado para um shell mais premium:
  - hero superior com contexto da pagina
  - navegacao em pills
  - melhor apresentacao do aluno logado
  - branding mais consistente com o admin
- `AcademiesPage` tambem foi modernizada no codigo com busca, cards, KPIs e dialogs, mas continua sem rota exposta porque essa tela ja nao estava ligada ao menu nem ao `App.js` antes desta etapa.

### Validacao desta etapa
- `npm --prefix frontend run lint` -> **passa**
- `npm --prefix frontend run build` -> **passa**
- `python -m pytest backend/tests -q` -> **92 passed**

## Cobranca do aluno - clareza de atraso, carencia e bloqueio
- `GET /api/student/billing` agora retorna um resumo mais util sem quebrar compatibilidade:
  - `charge_status_totals`
  - `contract_financial_totals`
  - `contract_access_totals`
  - `current_contract_id`
  - `current_contract_status`
  - `current_financial_status`
  - `current_access_status`
  - `blocked_reason`
  - `grace_until`
  - `next_retry_at`
  - `dunning_level`
- `StudentBillingPage` foi refeita para deixar explicito:
  - quando o aluno esta em dia
  - quando esta em carencia
  - quando o acesso ja foi bloqueado
  - quais cobrancas estao em aberto, atrasadas e pagas
  - qual contrato esta dirigindo o acesso atual
- A tela ganhou:
  - `PageHeader`
  - `Banner` com semantica operacional
  - `StatCard`
  - `SectionCard`
  - `SidePanel` para detalhe de cobranca
  - `EmptyState`
  - badges de status consistentes
- A semantica de status foi extraida para `frontend/src/features/student-billing/studentBillingUtils.js`.

### Validacao desta etapa
- `npm --prefix frontend run lint` -> **passa**
- `npm --prefix frontend run build` -> **passa**
- `python -m pytest backend/tests/test_student_auth_and_portal.py -q` -> **6 passed**
- `python -m pytest backend/tests -q` -> **92 passed**

## Dashboard do aluno, Configuracoes, Plataforma e Cobranca admin
- `StudentDashboardPage` foi refeita com:
  - `PageHeader`
  - banner operacional de acesso
  - cards de resumo
  - blocos de contrato, cobrancas pendentes, acessos e avisos
  - status visuais alinhados com a semantica financeira e de acesso
- `ProfilePage` foi transformada em uma tela de configuracoes mais clara:
  - dados da conta
  - branding da academia
  - senha
  - leitura de papel/perfil
- `PlatformAdminPage` foi refeito para operacao real:
  - busca de owners
  - detalhe lateral por owner
  - dialogs para dar e remover carencia
  - fim de `window.prompt` e `window.confirm`
  - melhor leitura de financeiro, owners e logs globais
- `BillingCenterPage` recebeu melhoria operacional:
  - banner de risco financeiro
  - cards mais claros
  - detalhe lateral para faturas, tentativas e eventos
  - filtros e acoes mais consistentes
  - correcoes de copy e encoding visivel

### Validacao desta etapa
- `npm --prefix frontend run lint` -> **passa**
- `npm --prefix frontend run build` -> **passa**
- `python -m pytest backend/tests -q` -> **92 passed**
