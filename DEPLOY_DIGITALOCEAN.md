# DEPLOY_DIGITALOCEAN

## 1. Criar droplet
- Ubuntu 24.04 LTS
- 1 vCPU / 1 GB RAM
- Disco SSD padrão
- Liberar portas 22, 80 e 443 no firewall

## 2. Instalar Docker + Compose
```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

## 3. Clonar repositório e configurar ENV
```bash
git clone https://github.com/Badzx-tec/gymbroatual.git
cd gymbroatual
cp .env.example .env
```

Preencher obrigatórios:
- `MONGO_ROOT_USERNAME`
- `MONGO_ROOT_PASSWORD`
- `JWT_SECRET`
- `FERNET_KEY`
- `APP_BASE_URL`
- `FRONTEND_BASE_URL`
- `MP_ACCESS_TOKEN` / `MP_PUBLIC_KEY` / `MP_WEBHOOK_SECRET`
- `SMTP_*`

## 4. Subir stack de produção
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## 5. HTTPS (Let's Encrypt)
Opção rápida com Nginx + Certbot:
```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d seu-dominio.com -d www.seu-dominio.com
```

Copie os certificados para `deploy/certs` e ajuste `deploy/nginx/default.conf` para escutar `443` com SSL.

## 6. Healthcheck e logs
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f nginx
curl http://SEU_HOST/health
```

## 7. Backup Mongo
Backup manual:
```bash
docker exec -it $(docker ps -qf name=mongo) mongodump \
  --username "$MONGO_ROOT_USERNAME" \
  --password "$MONGO_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  --archive=/tmp/gymbro.archive

docker cp $(docker ps -qf name=mongo):/tmp/gymbro.archive ./gymbro.archive
```

## 8. Ajustes para 1GB RAM
- Backend com `--workers 1`
- Sem serviços extras (não subir ferramentas de admin)
- Evitar logs em modo debug
- Rebuild apenas quando necessário

## 9. Webhook Mercado Pago
Configure no painel do Mercado Pago:
- URL: `https://seu-dominio.com/api/billing/webhook/mercadopago`
- Secret alinhado com `MP_WEBHOOK_SECRET`

## 10. Rollback rápido
```bash
git checkout <tag_ou_commit_estavel>
docker compose -f docker-compose.prod.yml up -d --build
```
