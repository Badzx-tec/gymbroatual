#!/bin/bash

# ==============================================================================
# GymBro Development Server Startup Script
# ==============================================================================

set -e

echo "🚀 Iniciando GymBro em modo desenvolvimento..."
echo ""

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ==============================================================================
# 1. BACKEND
# ==============================================================================
echo -e "${BLUE}📦 Iniciando Backend (FastAPI)...${NC}"
cd backend

# Verificar se virtual env existe
if [ ! -d "venv" ]; then
    echo "Criando virtual environment..."
    python3 -m venv venv
fi

# Ativar venv
source venv/bin/activate

# Instalar dependências
echo "Instalando dependências Python..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

# Iniciar servidor Backend em background
echo -e "${GREEN}✅ Backend iniciado em http://localhost:8000${NC}"
python server.py &
BACKEND_PID=$!

# Voltar para root
cd ..

echo ""

# ==============================================================================
# 2. FRONTEND
# ==============================================================================
echo -e "${BLUE}📦 Iniciando Frontend (React)...${NC}"
cd frontend

# Verificar se node_modules existe
if [ ! -d "node_modules" ]; then
    echo "Instalando dependências npm..."
    npm install -q
fi

# Iniciar servidor Frontend em background
echo -e "${GREEN}✅ Frontend iniciado em http://localhost:3000${NC}"
REACT_APP_API_BASE=http://localhost:8000 npm start &
FRONTEND_PID=$!

# Voltar para root
cd ..

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✨ GymBro está rodando!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "URLs:"
echo "  Frontend:  http://localhost:3000"
echo "  Backend:   http://localhost:8000"
echo "  Dashboard: http://localhost:3000/admin"
echo "  Assinatura: http://localhost:3000/admin/assinatura"
echo ""
echo "Credenciais de Teste:"
echo "  Email: teste@gymbro.local"
echo "  Senha: Senha123456"
echo ""
echo "Para parar:"
echo "  kill $BACKEND_PID  # Backend"
echo "  kill $FRONTEND_PID # Frontend"
echo ""

# Aguardar sinais de término
wait

