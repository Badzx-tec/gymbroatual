#!/usr/bin/env bash

# ==============================================================================
# GymBro Development Server Startup Script
# Run from the repo root: bash start-dev.sh
# ==============================================================================

set -euo pipefail

echo "Starting GymBro in dev mode..."
echo

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Validate prerequisites
for tool in python3 npm node; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "error: required tool '$tool' not found in PATH" >&2
        exit 1
    fi
done

if [[ ! -f .env ]]; then
    echo "error: .env not found. Generate secrets with: bash scripts/gen-secrets.sh" >&2
    echo "       Then create .env from .env.example with the generated values." >&2
    exit 1
fi

ROOT_DIR="$(pwd)"
trap 'echo; echo "Stopping background processes..."; jobs -p | xargs -r kill 2>/dev/null || true' EXIT INT TERM

# ==============================================================================
# 1. BACKEND
# ==============================================================================
echo -e "${BLUE}Starting Backend (FastAPI)...${NC}"
cd "${ROOT_DIR}/backend"

if [[ ! -d venv ]]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# shellcheck disable=SC1091
source venv/bin/activate

echo "Installing Python dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo -e "${GREEN}Backend booting at http://localhost:8000${NC}"
python server.py &
BACKEND_PID=$!

cd "${ROOT_DIR}"

# ==============================================================================
# 2. FRONTEND
# ==============================================================================
echo
echo -e "${BLUE}Starting Frontend (React)...${NC}"
cd "${ROOT_DIR}/frontend"

if [[ ! -d node_modules ]]; then
    echo "Installing npm dependencies..."
    npm install -q
fi

echo -e "${GREEN}Frontend booting at http://localhost:3000${NC}"
REACT_APP_API_BASE="http://localhost:8000" npm start &
FRONTEND_PID=$!

cd "${ROOT_DIR}"

echo
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}GymBro is running${NC}"
echo -e "${GREEN}========================================${NC}"
echo
echo "URLs:"
echo "  Frontend:   http://localhost:3000"
echo "  Backend:    http://localhost:8000"
echo "  Admin:      http://localhost:3000/admin"
echo "  Billing:    http://localhost:3000/admin/assinatura"
echo
echo "Seed a dev user (one-off):"
echo "  cd backend && python -m scripts.seed_dev   # if available"
echo
echo "Stop:"
echo "  kill ${BACKEND_PID}  # Backend"
echo "  kill ${FRONTEND_PID} # Frontend"
echo

wait
