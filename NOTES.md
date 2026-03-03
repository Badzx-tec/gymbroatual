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

