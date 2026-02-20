# 🚀 Como Subir o GymBro para Testes Manuais

## ⚡ Opção 1: Script Automático (Recomendado)

```bash
chmod +x start-dev.sh
./start-dev.sh
```

Isso vai:
- ✅ Criar virtual env Python (se não existir)
- ✅ Instalar dependências do backend
- ✅ Instalar dependências do frontend
- ✅ Iniciar backend em http://localhost:8000
- ✅ Iniciar frontend em http://localhost:3000

---

## 🔧 Opção 2: Manual (Terminal por Terminal)

### Terminal 1: Backend (FastAPI)

```bash
cd backend

# Criar virtual environment (primeira vez)
python3 -m venv venv

# Ativar (Linux/Mac)
source venv/bin/activate

# Ativar (Windows)
venv\Scripts\activate

# Instalar dependências
pip install -r requirements.txt

# Rodar servidor
python server.py
```

✅ Backend rodando em: **http://localhost:8000**

### Terminal 2: Frontend (React)

```bash
cd frontend

# Instalar dependências (primeira vez)
npm install

# Rodar (com proxy para backend)
REACT_APP_API_BASE=http://localhost:8000 npm start
```

✅ Frontend rodando em: **http://localhost:3000**

---

## 📋 Checklist Antes de Iniciar

- [ ] MongoDB rodando em `localhost:27017`
  ```bash
  # Se não estiver rodando, start com Docker:
  docker run -d -p 27017:27017 -e MONGO_INITDB_ROOT_USERNAME=admin -e MONGO_INITDB_ROOT_PASSWORD=admin123 mongo
  ```

- [ ] Python 3.8+ instalado
  ```bash
  python3 --version
  ```

- [ ] Node.js 16+ e npm instalados
  ```bash
  node --version
  npm --version
  ```

---

## 🌐 URLs e Endpoints

| Recurso | URL |
|---------|-----|
| **Frontend** | http://localhost:3000 |
| **Backend API** | http://localhost:8000 |
| **Dashboard** | http://localhost:3000/admin |
| **Assinatura** | http://localhost:3000/admin/assinatura |
| **API Docs** | http://localhost:8000/docs |
| **WebSocket** | ws://localhost:8000/api/ws |

---

## 🧪 Fluxo de Teste Recomendado

### 1️⃣ Criar Conta
- Ir para http://localhost:3000/login
- Clique em "Criar conta"
- Preencha email/senha
- **Verificar e-mail** (simulado, check no console)
- Click no link de verificação

### 2️⃣ Login com 2FA
- Volte para login
- Email e senha
- Receberá código no email
- Digite o código

### 3️⃣ Criar Academia
- No dashboard, vá para "Franquias"
- Clique "Criar Academia"
- 30 dias de trial automático
- Vá para "Assinatura" para ver status

### 4️⃣ Testar Pagamento (Sandbox)
- Vá para http://localhost:3000/admin/assinatura
- Clique "Pagar com Mercado Pago"
- Use cartão **4111 1111 1111 1111**
- Vencimento: 11/25
- CVV: 123

### 5️⃣ Criar Alunos
- Vá para "Alunos"
- Clique "Novo Aluno"
- Teste CRUD completo

### 6️⃣ Testar Evolução e Presença
- Clique em um aluno
- Tab "Evolução": registre peso, altura
- Tab "Presença": registre entrada

---

## 🐛 Troubleshooting

### ❌ MongoDB conexão recusada
```bash
# Inicie MongoDB com Docker
docker run -d \
  --name mongo \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=admin123 \
  mongo
```

### ❌ Porta 3000/8000 já em uso
```bash
# Backend na 8001
cd backend && PORT=8001 python server.py

# Frontend na 3001
cd frontend && PORT=3001 npm start
# E ajuste: REACT_APP_API_BASE=http://localhost:8001
```

### ❌ Dependencies não instalam
```bash
# Backend
cd backend && pip install --upgrade -r requirements.txt

# Frontend
cd frontend && npm install --force
```

### ❌ Módulo Python não encontrado
```bash
# Verifique se venv está ativado
which python  # Deve mostrar venv/bin/python
```

---

## 📊 Email Simulado (Dev)

Como estamos em dev, emails não são enviados de verdade. Check os logs do backend:

```
[Backend Log] Email enviado para: teste@gymbro.local
[Backend Log] Assunto: Verificação de e-mail - GymBro
[Backend Log] Código: 123456
```

---

## 🔐 Credenciais Mercado Pago (Sandbox)

Já configuradas em `.env`:
```
MP_ACCESS_TOKEN=TEST-2643211117890593-...
MP_PUBLIC_KEY=TEST-58fe1a5c-...
```

**Cartões de teste**: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/test

---

## 📡 WebSocket (Catraca em Tempo Real)

Se testar eventos em tempo real:

```javascript
// Console do navegador
const ws = new WebSocket('ws://localhost:8000/api/ws');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

---

## ✅ Verificação Rápida

```bash
# Tudo funcionando? Teste os endpoints:

# Backend health
curl http://localhost:8000/api/health

# Frontend (deve devolver HTML)
curl http://localhost:3000/

# API Docs
curl http://localhost:8000/docs
```

---

## 🎯 Próximas Ações

Após subir e testar:
1. [ ] Testar fluxo de pagamento completo
2. [ ] Verificar webhook do Mercado Pago
3. [ ] Criar alguns alunos
4. [ ] Registrar presença + evolução
5. [ ] Check logs de ambos servers

---

**Status**: ✅ Pronto para testar  
**Última atualização**: Fevereiro 20, 2026  
**Versão**: 2.0.0

