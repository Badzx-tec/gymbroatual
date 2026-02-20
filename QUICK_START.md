# 🚀 Quick Start - Subir GymBro em 2 Minutos

## ✨ Opção 1: Com Docker Compose (Mais Fácil)

### Pré-requisitos
- Docker e Docker Compose instalados
- Ports 3000, 8000, 27017 disponíveis

### Executar
```bash
# Usar apenas MongoDB + Mongo Express (sem backend/frontend)
docker-compose up

# OU subir TUDO (incluindo backend e frontend)
docker-compose --profile full up

# Para rodar em background
docker-compose up -d
```

### URLs
- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:8000
- **Mongo Express**: http://localhost:8081 (admin/admin123)
- **API Docs**: http://localhost:8000/docs

### Parar
```bash
docker-compose down
```

### Limpar tudo (volumes e dados)
```bash
docker-compose down -v
```

---

## 🔧 Opção 2: Local (Machine Nativa)

### Pré-requisitos
- Python 3.8+
- Node.js 16+
- MongoDB 6.0+

### Executar (3 Terminais)

**Terminal 1: MongoDB**
```bash
# Com Docker (mais fácil)
docker run -d \
  --name gymbro-mongo \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=admin123 \
  mongo:7.0
```

**Terminal 2: Backend**
```bash
cd backend

# Primeira execução
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate  # Windows

pip install -r requirements.txt

# Rodar
python server.py
```

**Terminal 3: Frontend**
```bash
cd frontend

# Primeira execução
npm install

# Rodar
REACT_APP_API_BASE=http://localhost:8000 npm start
```

### URLs
- Frontend: http://localhost:3000
- Backend: http://localhost:8000

---

## 📊 Verificações Rápidas

```bash
# Health check backend
curl http://localhost:8000/api/health

# Frontend (deve devolver HTML)
curl http://localhost:3000/

# API Docs
open http://localhost:8000/docs

# Mongo Express
open http://localhost:8081
```

---

## 🧪 Primeira Execução (Teste Completo)

1. **Criar Conta**
   - ➡️ http://localhost:3000/login
   - "Criar conta"
   - Email: teste@gymbro.local
   - Senha: Senha123456

2. **Verificar Email** (Simulado em Dev)
   - Check console do backend
   - Click no link (ou copy token)

3. **Login com 2FA**
   - Email + Senha
   - Digite código (check logs)

4. **Ver Trial**
   - Dashboard → Assinatura
   - Vê "Trial até: [data]"

5. **Criar Academia**
   - Franquias → Criar
   - Preencha dados
   - Trial começa automaticamente

6. **Testar Pagamento** (Sandbox)
   - Assinatura → "Pagar com Mercado Pago"
   - Cartão: 4111 1111 1111 1111
   - Vencimento: 11/25
   - CVV: 123

7. **Criar Alunos**
   - Alunos → Novo
   - CRUD completo

---

## 📁 Estrutura de Diretórios

```
gymbroatual/
├── backend/              # FastAPI
│   ├── server.py
│   ├── requirements.txt
│   ├── .env
│   └── Dockerfile
├── frontend/             # React
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml    # Orquestração
├── start-dev.sh         # Script de inicialização
└── COMO_SUBIR.md        # Instruções detalhadas
```

---

## 🐛 Troubleshooting

### Porta em uso
```bash
# Mudar para outra porta
docker run -p 8001:8000 ...  # Backend
docker run -p 3001:3000 ...  # Frontend
```

### MongoDB recusa conexão
```bash
# Verificar se está rodando
docker ps | grep mongo

# Reiniciar
docker-compose restart mongodb
```

### Módulo Python não encontrado
```bash
# Reativar venv e reinstalar
source venv/bin/activate
pip install --upgrade -r requirements.txt
```

### npm install lento
```bash
# Usar npm ci (mais rápido)
npm ci
```

### React não carrega
```bash
# Limpar cache
rm -rf frontend/node_modules/.cache
npm start
```

---

## 📊 Credenciais Padrão

| Serviço | Usuário | Senha |
|---------|---------|-------|
| MongoDB | admin | admin123 |
| Mongo Express | admin | admin123 |
| Frontend | teste@gymbro.local | Senha123456 |
| Mercado Pago | (Sandbox) | (TEST tokens) |

---

## 🎯 Próximos Passos

1. Testar fluxo completo de pagamento
2. Verificar webhook do Mercado Pago
3. Criar alunos + registrar presença
4. Check logs de ambos servidores
5. Fazer commit das mudanças

---

## 📝 Logs Úteis

```bash
# Backend
cd backend && python server.py  # Logs diretos

# Frontend
cd frontend && npm start        # Logs diretos

# Docker
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f mongodb
```

---

## ✅ Checklist de Pronto

- [ ] Docker instalado e rodando
- [ ] Ports 3000, 8000, 27017 livres
- [ ] `docker-compose up` funcionou
- [ ] Frontend carrega em localhost:3000
- [ ] Backend responde em localhost:8000/api/health
- [ ] Pode fazer login
- [ ] Assinatura exibe status trial
- [ ] Alunos CRUD funciona

---

**Status**: ✅ Pronto para testar  
**Versão**: 2.0.0  
**Data**: Fevereiro 20, 2026

