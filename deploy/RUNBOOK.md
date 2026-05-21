# GymBro — Runbook Operacional

**Última revisão**: 2026-05-18  
**Ambiente de produção**: Oracle Cloud (`129.159.62.140`) — `gymbro.dev.br`  
**SSH**: `ssh -i ~/.ssh/oracle_migracao_teste_ed25519 ubuntu@129.159.62.140`  
**App path**: `/opt/gymbroatual/`  
**Compose file**: `docker-compose.prod.yml`

> **Regra de ouro**: nunca altere `gateway-toletus/main.py` ou `gateway-toletus/protocol.py`.  
> Catraca física em produção — qualquer mudança de lógica requer janela de manutenção com o cliente.

---

## 1. Deploy padrão (sem git no Oracle)

```bash
# 1. No local — copie os arquivos alterados para o servidor
scp -i ~/.ssh/oracle_migracao_teste_ed25519 \
    backend/app/routes/billing.py \
    ubuntu@129.159.62.140:/opt/gymbroatual/backend/app/routes/

# 2. No Oracle — rebuild e restart do serviço afetado
ssh -i ~/.ssh/oracle_migracao_teste_ed25519 ubuntu@129.159.62.140
cd /opt/gymbroatual

docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d --no-deps backend

# 3. Verificar saúde
curl -s https://gymbro.dev.br/health/ready | python3 -m json.tool
docker compose -f docker-compose.prod.yml logs --tail=50 backend
```

**Para o frontend:**
```bash
# No local
npm --prefix frontend run build
scp -i ~/.ssh/oracle_migracao_teste_ed25519 -r \
    frontend/build/ \
    ubuntu@129.159.62.140:/opt/gymbroatual/frontend/

docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml up -d --no-deps frontend
```

---

## 2. Rollback

```bash
# No Oracle — reverter backend para imagem anterior
docker compose -f docker-compose.prod.yml stop backend
# Restaurar arquivos via SCP (versão anterior)
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d --no-deps backend
```

**DigitalOcean como fallback de último recurso:**  
- IP: `167.71.177.198`  
- Alterar DNS no Cloudflare para `167.71.177.198` (propagação ~1 min via proxy)  
- SSH: `root@167.71.177.198`

---

## 3. Rotação de JWT_SECRET

> Invalida **todas as sessões ativas**. Avisar usuários 24 h antes via notificação in-app.

```bash
# Gerar novo segredo (no Oracle ou localmente)
openssl rand -base64 48

# Atualizar no servidor
ssh -i ~/.ssh/oracle_migracao_teste_ed25519 ubuntu@129.159.62.140
cd /opt/gymbroatual
nano .env
# Substituir JWT_SECRET=<valor antigo> por JWT_SECRET=<novo valor>

# Reiniciar backend
docker compose -f docker-compose.prod.yml up -d --no-deps backend

# Verificar — todas as sessões ativas agora expiram; usuários precisam fazer login
curl -s https://gymbro.dev.br/health | python3 -m json.tool
```

**Rollback**: manter o valor antigo anotado por 7 dias caso precise reverter.

---

## 4. Rotação de FERNET_KEY (biometrias criptografadas)

> **OBRIGATÓRIO**: usar MultiFernet — a chave antiga deve permanecer na lista por 30 dias.  
> Quebrar a chave sem esquema de múltiplas chaves destrói dados biométricos irrecuperáveis.

```bash
# Gerar nova chave
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# No .env de produção:
# FERNET_KEYS=<chave_nova>,<chave_antiga>   ← chave nova PRIMEIRO
# A chave antiga continua ativa para decrypt por 30 dias
# Após 30 dias remover a antiga da lista

ssh -i ~/.ssh/oracle_migracao_teste_ed25519 ubuntu@129.159.62.140
cd /opt/gymbroatual && nano .env
# Editar FERNET_KEYS

docker compose -f docker-compose.prod.yml up -d --no-deps backend
curl -s https://gymbro.dev.br/health/ready | python3 -m json.tool
```

---

## 5. Restore do MongoDB

```bash
# No Oracle
ssh -i ~/.ssh/oracle_migracao_teste_ed25519 ubuntu@129.159.62.140

# Verificar container MongoDB
docker compose -f docker-compose.prod.yml ps mongo

# Criar dump
docker exec gymbroatual-mongo-1 \
    mongodump --uri="mongodb://admin:<password>@localhost:27017/gymbro?authSource=admin" \
    --out=/tmp/dump_$(date +%Y%m%d_%H%M)

# Copiar dump para local (para backup seguro)
scp -i ~/.ssh/oracle_migracao_teste_ed25519 -r \
    ubuntu@129.159.62.140:/tmp/dump_* ./backups/

# Restore a partir de dump local
docker cp ./backup_gymbro/ gymbroatual-mongo-1:/tmp/restore/
docker exec gymbroatual-mongo-1 \
    mongorestore --uri="mongodb://admin:<password>@localhost:27017/gymbro?authSource=admin" \
    --drop /tmp/restore/

# Verificar contagem de documentos
docker exec gymbroatual-mongo-1 \
    mongosh --quiet \
    "mongodb://admin:<password>@localhost:27017/gymbro?authSource=admin" \
    --eval "db.students.countDocuments()"
```

> A senha do MongoDB está em `/opt/gymbroatual/.env` como `MONGO_ROOT_PASSWORD`.

---

## 6. Restart do gateway-toletus

> **Atenção**: a catraca fica offline durante o restart (~5 segundos).  
> Combinar com o cliente uma janela de 5 min onde podem liberar entrada manual.

```bash
ssh -i ~/.ssh/oracle_migracao_teste_ed25519 ubuntu@129.159.62.140
cd /opt/gymbroatual

# Verificar estado
docker compose -f docker-compose.prod.yml ps gateway

# Restart suave
docker compose -f docker-compose.prod.yml restart gateway

# Verificar logs
docker compose -f docker-compose.prod.yml logs --tail=30 gateway

# Confirmar heartbeat OK (deve aparecer dentro de 10 s)
docker compose -f docker-compose.prod.yml logs -f gateway | grep -i heartbeat
```

**Mudanças permitidas no gateway** (Fase 1.5):
- Pinar imagem Docker (`FROM python:3.11.9-slim@sha256:...`)
- Adicionar `USER appuser`
- Alterar variáveis de env de timeouts

**Proibido**:
- Alterar `gateway-toletus/main.py`
- Alterar `gateway-toletus/protocol.py`
- Mudar a lógica de handshake TCP/protocolo Toletus

---

## 7. Investigar fila de webhooks (MercadoPago)

```bash
# Verificar últimos eventos recebidos
docker exec gymbroatual-mongo-1 \
    mongosh --quiet \
    "mongodb://admin:<password>@localhost:27017/gymbro?authSource=admin" \
    --eval "db.billing_events.find({},{_id:0,event_id:1,action:1,status:1,received_at:1}).sort({received_at:-1}).limit(10)"

# Verificar rejeições de webhook (assinatura inválida)
docker exec gymbroatual-mongo-1 \
    mongosh --quiet \
    "mongodb://admin:<password>@localhost:27017/gymbro?authSource=admin" \
    --eval "db.billing_events.countDocuments({action:'webhook_rejected'})"

# Verificar logs estruturados do backend
docker compose -f docker-compose.prod.yml logs backend | grep 'webhook.received\|payment.paid\|billing_webhook_rejected' | tail -20

# Endpoint de alertas (requer token de owner/manager)
curl -H "Authorization: Bearer <token>" \
    https://gymbro.dev.br/api/billing/alerts
```

**Simular webhook com assinatura válida (staging):**
```bash
PAYLOAD='{"action":"payment.updated","data":{"id":"123"},"type":"payment"}'
TS=$(date +%s)
SECRET="<MP_WEBHOOK_SECRET>"
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -X POST https://gymbro.dev.br/api/billing/webhook/mercadopago \
    -H "Content-Type: application/json" \
    -H "X-Signature: ts=$TS,v1=$SIG" \
    -d "$PAYLOAD"
```

---

## 8. Investigar erros de frontend

```bash
# Últimos erros de cliente reportados (ErrorBoundary)
docker exec gymbroatual-mongo-1 \
    mongosh --quiet \
    "mongodb://admin:<password>@localhost:27017/gymbro?authSource=admin" \
    --eval "db.client_errors.find({},{_id:0,message:1,url:1,ua:1,created_at:1}).sort({created_at:-1}).limit(10)"

# Relatórios CSP (violações de Content-Security-Policy)
docker exec gymbroatual-mongo-1 \
    mongosh --quiet \
    "mongodb://admin:<password>@localhost:27017/gymbro?authSource=admin" \
    --eval "db.csp_reports.find({},{_id:0,report:1,created_at:1}).sort({created_at:-1}).limit(5)"
```

---

## 9. Verificar métricas em tempo real

```bash
# Endpoint /api/ops/metrics (requer token de owner/manager)
curl -s -H "Authorization: Bearer <token>" \
    https://gymbro.dev.br/api/ops/metrics | python3 -m json.tool

# Alertas
curl -s -H "Authorization: Bearer <token>" \
    https://gymbro.dev.br/api/ops/alerts | python3 -m json.tool

# Saúde completa (MongoDB + MP + SMTP)
curl -s https://gymbro.dev.br/health/ready | python3 -m json.tool
# status: "ready" = tudo OK
# status: "degraded" = MongoDB offline → 503
# checks.mercadopago.ok: false = MP inacessível (não impede operação local)
# checks.smtp.ok: false = e-mails falharão
```

---

## 10. Certificado TLS (Cloudflare)

- TLS é gerenciado pelo Cloudflare (modo Full Strict)
- Certificado de origem gerado no Cloudflare Dashboard → SSL/TLS → Origin Server
- Arquivo em `/opt/gymbroatual/deploy/nginx/certs/` no Oracle
- Renovação: gerar novo certificado de origem no Cloudflare, substituir arquivos, `docker compose restart nginx`

---

## 11. Checklist pós-deploy

Execute após qualquer deploy significativo:

```bash
# 1. Health
curl -s https://gymbro.dev.br/health | grep '"status": "ok"'

# 2. Readiness (verifica MongoDB + MP + SMTP)
curl -s https://gymbro.dev.br/health/ready | python3 -m json.tool

# 3. Headers de segurança
curl -sI https://gymbro.dev.br | grep -i 'strict-transport\|x-content-type\|content-security\|permissions-policy'

# 4. Login de owner (substituir credenciais)
curl -s -X POST https://gymbro.dev.br/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"<owner_email>","password":"<password>"}' | python3 -m json.tool

# 5. Webhook sem assinatura deve retornar 401
curl -s -o /dev/null -w "%{http_code}" \
    -X POST https://gymbro.dev.br/api/billing/webhook/mercadopago \
    -H "Content-Type: application/json" -d '{}'
# esperado: 401

# 6. Gateway heartbeat OK
docker compose -f /opt/gymbroatual/docker-compose.prod.yml logs --tail=5 gateway
```

---

## 12. Lighthouse — auditoria de performance e a11y

Thresholds (definidos em `frontend/.lighthouserc.json`):

| Categoria | Mínimo | Falha CI |
|---|---|---|
| Performance | 0.85 | error |
| Accessibility | 0.90 | error |
| Best-practices | 0.90 | warn |
| SEO | 0.85 | warn |

**Rodar local** (após `npm install`):
```bash
cd frontend
npm run lighthouse
# Abre o report HTML em .lighthouseci/
```

**Quando Lighthouse cair em PR**:
1. Ver o report no log do job `frontend-lighthouse`
2. Categorias mais comuns que despencam:
   - **Performance**: bundle maior que 250KB → checar `npm run build` size
   - **A11y**: contraste cor ↓; algum input sem `<label>`; img sem `alt`
   - **Best-practices**: console errors; libs com vulnerabilities (npm audit)
3. Para passar temporariamente, rebaixar threshold para `warn` no `.lighthouserc.json` (não merge!), criar issue para subir de volta

---

## 13. Escalonamento de incidentes

| Severidade | Critério | Ação |
|---|---|---|
| P1 | Catraca física não libera acesso | Restart gateway, checar logs TCP, acionar cliente |
| P1 | `/health/ready` retorna 503 | Verificar MongoDB (item 5), logs backend |
| P2 | Webhooks MP todos falhando | Item 7, verificar `MP_WEBHOOK_SECRET` |
| P2 | E-mails não enviados | `checks.smtp.ok: false` no `/health/ready` |
| P3 | Taxa de erro frontend > 2× normal | Checar `db.client_errors` (item 8) |

**Contato principal**: `juannicarosa@gmail.com`
