# GymBro

Projeto focado em **backend Python (FastAPI)** + **frontend React** para gestão de academias.

## Estrutura atual
- `backend/`: API principal (autenticação, alunos, planos, pagamentos, catraca).
- `frontend/`: aplicação web React.
- `agente_local/`: agente Python para integrações locais (ex.: catraca).
- `backend_test.py`: suíte de testes de API.

## Requisitos
- Python 3.10+
- Node.js 18+
- MongoDB

## Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

## Frontend
```bash
cd frontend
npm install
npm start
```

## Observações
- Variáveis de ambiente de pagamentos/login/catraca estão descritas em `IMPLEMENTACAO_PAGAMENTO_LOGIN_CATRACA.md`.
