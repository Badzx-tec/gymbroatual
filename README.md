# GymBro SaaS (FastAPI + MongoDB + React)

Plataforma SaaS para academias com:
- autenticação de owner e funcionários (RBAC)
- bloqueio por assinatura mensal (Mercado Pago)
- verificação de e-mail antes do login
- gestão de alunos (CRUD, medidas, treinos, frequência)
- integração de catraca Toletus LiteNet2 via **Gateway Local**

## Arquitetura

- `backend/`: API FastAPI modular (`backend/app`)
- `frontend/`: painel React
- `gateway-toletus/`: serviço local que fala TCP com a catraca e HTTPS com o SaaS
- `docker-compose.yml`: stack local
- `docker-compose.prod.yml`: stack produção (droplet barato)
- `BASELINE.md`: diagnóstico inicial executado

Fluxo Toletus correto (NAT-safe):
1. Gateway roda dentro da academia (rede local)
2. Gateway recebe eventos da catraca (RFID/teclado/biometria)
3. Gateway chama SaaS `POST /api/turnstiles/decision`
4. SaaS decide allow/deny e Gateway envia comando na catraca

## Requisitos

- Docker + Docker Compose
- Python 3.11+ (para rodar backend/testes local sem Docker)
- Node 20+ (para build/lint frontend sem Docker)

## Variáveis de ambiente

Copie e edite:

```bash
cp .env.example .env
```

Principais:
- `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, `DB_NAME`
- `JWT_SECRET`, `FERNET_KEY`
- `APP_BASE_URL`, `FRONTEND_BASE_URL`, `CORS_ORIGINS`
- `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`
- `GATEWAY_DEVICE_ID`, `GATEWAY_DEVICE_TOKEN`, `TOLETUS_*`
- `SAAS_URL` (gateway local -> URL pública do backend)
- `GATEWAY_MAX_SKEW_SECONDS`, `GATEWAY_NONCE_TTL_SECONDS`
- `GATEWAY_INVALID_ATTEMPT_THRESHOLD`, `GATEWAY_BLOCK_SECONDS`
- `AUTH_LOGIN_RATE_LIMIT`, `AUTH_VERIFY_RATE_LIMIT`, `WEBHOOK_RATE_LIMIT`
- `BILLING_RECONCILE_ENABLED`, `BILLING_RECONCILE_INTERVAL_SECONDS`
- `ALERT_WEBHOOK_FAILURES_THRESHOLD`, `ALERT_ACCESS_DENIES_THRESHOLD`

## Rodando localmente com Docker

```bash
docker compose up -d --build
```

URLs:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`

Gateway (simulador) via profile:

```bash
docker compose --profile gateway up -d gateway-toletus
```

## Rodando sem Docker

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm ci
npm run lint
npm run build
npm start
```

## Billing (Mercado Pago)

Endpoints principais:
- `POST /api/billing/subscription/checkout`
- `GET /api/billing/subscription/status`
- `GET /api/billing/membership`
- `GET /api/billing/invoices`
- `GET /api/billing/payment-attempts`
- `GET /api/billing/events`
- `POST /api/billing/webhook/mercadopago`
- `GET /api/billing/webhook/logs`
- `POST /api/billing/reconcile/run`

Implementado:
- `notification_url`
- `external_reference` = `owner_id`
- `metadata.owner_id`
- fallback para `sandbox_init_point`
- idempotência por `event_id`
- atualização robusta de `active/past_due/canceled`
- reconciliação ativa com Mercado Pago (loop de background + endpoint manual)
- rate limit no webhook + logs de rejeição por assinatura inválida
- domínio financeiro de assinatura com membership, invoices, payment attempts e subscription events
- painel financeiro no frontend: `/admin/cobranca` (OWNER/MANAGER)

## Funcionários por academia (RBAC)

Perfis mínimos:
- `OWNER`
- `MANAGER`
- `RECEPTION`
- `TRAINER`

Coleções:
- `employees`
- `employee_invites`

Rotas:
- `POST /api/staff/invites`
- `GET /api/staff/invites`
- `DELETE /api/staff/invites/{invite_id}`
- `GET /api/staff/employees`
- `POST /api/staff/employees`
- `POST /api/staff/employees/{employee_id}/deactivate`
- `POST /api/staff/employees/{employee_id}/reset-password`
- `POST /api/staff/employees/{employee_id}/credentials`
- `POST /api/staff/employees/{employee_id}/sync-shadow-student`

Login é unificado (`/api/auth/login`) para owner e employee.
JWT inclui `role`, `gym_id`, `owner_id` e `actor_type`.

## Contratos de alunos (billing interno)

Modulo para operacao financeira da academia com contratos por aluno, cobrancas e renovacao.

Rotas principais:
- `GET /api/student-billing/overview`
- `GET /api/student-billing/contracts`
- `POST /api/student-billing/contracts`
- `POST /api/student-billing/contracts/{contract_id}/charges`
- `GET /api/student-billing/contracts/{contract_id}/charges`
- `POST /api/student-billing/charges/{charge_id}/mark-paid`
- `POST /api/student-billing/contracts/{contract_id}/cancel`
- `GET /api/student-billing/events`

Implementado:
- cria contrato com plano/valor/duracao e cobranca inicial opcional
- marca pagamento e estende periodo automaticamente
- sincroniza validade no aluno (`plan_expires_at`, `subscription_end`, `data_vencimento`)
- status automatico de contrato (`active`, `past_due`, `expired`, `canceled`)
- pagina admin para gestao: `/admin/contratos` (OWNER, MANAGER, RECEPTION)

## Toletus LiteNet2

### Protocolo (porta 7878)
Arquivo: `gateway-toletus/protocol.py`
- pacote fixo 20 bytes
- prefixo `0x53`, sufixo `0xC3`
- comando 2 bytes little-endian + dados 16 bytes
- referência oficial Toletus LiteNet2:
  - https://github.com/Toletus/LiteNet2-ManuaisDeIntegracao

Comandos implementados:
- `0x0001`: liberar entrada
- `0x0002`: liberar saída
- `0x0005`: notificar usuário (bip/led)
- `0x0006`: reservado para bidirecional

Eventos parseados:
- `0x0301`: RFID
- `0x0303`: teclado
- `0x0306`: biometria
- `0x0304`: passagem

### API SaaS para Gateway
- `POST /api/turnstiles/devices`
- `POST /api/turnstiles/devices/{device_id}/rotate-token`
- `POST /api/turnstiles/decision`
- `POST /api/turnstiles/events`
- `GET /api/turnstiles/access-logs`
- aliases legados: `/api/turnstile/decision` e `/api/turnstile/events`

A decisão da catraca aceita credenciais de:
- alunos (`students.tag_rfid`, `students.biometria_id`, `students.keypad_code`, `students.matricula`)
- funcionários (`employees.tag_rfid`, `employees.biometria_id`, `employees.keypad_code`, `employees.matricula`)

Modo compatibilidade (legado):
- sincronizar funcionário como "aluno técnico" com
  - `POST /api/staff/employees/{employee_id}/sync-shadow-student`
- útil para cenários onde integrações antigas leem apenas `students`.

Autenticação do gateway:
- `device_token` por dispositivo enviado no header `X-Device-Token`
- assinatura HMAC SHA256 com `timestamp` + `nonce` + payload
- proteção anti-replay:
  - janela de tempo configurável (`GATEWAY_MAX_SKEW_SECONDS`)
  - nonce único com TTL (`GATEWAY_NONCE_TTL_SECONDS`)
- auto-bloqueio de dispositivo após tentativas inválidas repetidas

### Exemplo de payload (Gateway -> SaaS)
`POST /api/turnstiles/decision`

```json
{
  "device_id": "dev_filial_01",
  "method": "rfid",
  "credential": "00012345",
  "timestamp": "2026-02-22T14:10:00Z",
  "nonce": "a1b2c3d4e5f60708",
  "signature": "<hmac_sha256>"
}
```
Header obrigatório:
`X-Device-Token: <token_em_texto_claro_no_gateway>`

`POST /api/turnstiles/events`

```json
{
  "device_id": "dev_filial_01",
  "method": "rfid",
  "credential": "00012345",
  "timestamp": "2026-02-22T14:10:01Z",
  "nonce": "c9d8e7f6a5b4c3d2",
  "signature": "<hmac_sha256>",
  "decision": true,
  "message": "Acesso liberado"
}
```

### Teste sem catraca física (simulador)
1. Crie um dispositivo na API: `POST /api/turnstiles/devices` (guarde `device_id` e `token`).
2. Configure `.env` do gateway com `GATEWAY_DEVICE_ID`, `GATEWAY_DEVICE_TOKEN`, `TOLETUS_SIMULATOR=true`.
3. Suba: `docker compose --profile gateway up -d gateway-toletus`.
4. Acompanhe logs: `docker compose logs -f gateway-toletus backend`.

### Cadastro de biometria (alunos e funcionários)
Aluno:
- `POST /api/tolletus/enroll/start`
- `POST /api/tolletus/enroll/confirm`
- `GET /api/tolletus/students/{student_id}/status`

Funcionário:
- `POST /api/tolletus/employees/enroll/start`
- `POST /api/tolletus/employees/enroll/confirm`
- `GET /api/tolletus/employees/{employee_id}/status`

Importante:
- salvar apenas template/identificador da biometria (nunca imagem)
- para liberação na catraca, vincule o identificador em `biometria_id`
  (aluno ou funcionário)

## Observabilidade

Implementado no backend:
- `X-Request-ID` em todas as respostas
- logs estruturados JSON por request
- métricas de runtime (throughput, latência média, taxa de erro)
- alertas operacionais com thresholds configuráveis

Endpoints:
- `GET /api/ops/metrics`
- `GET /api/ops/alerts`

## Deploy Produção (Droplet barato 1vCPU/1GB)

### Compose
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Ajustes low-memory
- backend com 1 worker
- apenas serviços essenciais
- healthchecks ativos
- Mongo sem exposição pública

### Swap no host
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Firewall
- liberar apenas `22`, `80`, `443`
- **não expor `27017`** para internet

## TLS / Reverse Proxy

`deploy/nginx/default.conf` roteia:
- `/` -> frontend
- `/api` -> backend

Para HTTPS:
- usar Nginx + Certbot ou Caddy na frente
- configurar domínio e certificados antes de abrir tráfego público

## Qualidade e testes

### Backend
```bash
cd backend
ruff check .
black --check .
pytest
```

### Frontend
```bash
cd frontend
npm ci
npm run lint
npm run build
npm exec --yes playwright@1.52.0 test -c playwright.config.mjs
```

Testes mínimos incluídos:
- auth/subscription/webhook
- integração auth + billing (PAYMENT_REQUIRED + checkout)
- RBAC básico
- protocolo LiteNet2 encoder/decoder
- E2E frontend do fluxo crítico de auth+billing gate (`frontend/e2e/auth-billing.spec.mjs`)

## Runbook de Produção (checklist)

1. Configurar `.env` sem segredos default
2. Subir stack com `docker compose -f docker-compose.prod.yml up -d --build`
3. Verificar health endpoints
4. Criar device token da catraca (`/api/turnstiles/devices`)
5. Configurar gateway local com `DEVICE_ID`/`DEVICE_TOKEN`
   - opcional API Toletus real: `TOLETUS_MODE=real`, `TOLETUS_API_BASE_URL`, `TOLETUS_API_KEY`
6. Configurar webhook Mercado Pago
7. Ativar backup periódico Mongo:
   - `bash scripts/backup_mongo.sh`
8. Testar restauração mensalmente:
   - `bash scripts/verify_backup_restore.sh backups/<arquivo>.archive.gz`
9. Monitorar logs (`docker compose logs -f backend nginx gateway-toletus`)

Exemplo de agendamento no host (cron):
- diário 02:30 UTC (backup): `30 2 * * * cd /opt/gymbro && /usr/bin/env bash scripts/backup_mongo.sh >> /var/log/gymbro-backup.log 2>&1`
- mensal dia 1, 03:00 UTC (restore test): `0 3 1 * * cd /opt/gymbro && /usr/bin/env bash scripts/verify_backup_restore.sh $(ls -1t backups/*.archive.gz | head -n 1) >> /var/log/gymbro-restore-check.log 2>&1`

## Segurança

- Não versionar `.env`, tokens ou senhas reais
- Não logar dados sensíveis
- `template` biométrico é armazenado criptografado (`FERNET_KEY`)
- remover artefatos locais (`venv`, `__pycache__`, `node_modules`)

