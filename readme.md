# GymBro SaaS

SaaS para gestão de academias com:
- FastAPI + MongoDB (backend modular)
- React (frontend)
- assinatura mensal do dono (R$ 139,90/mês)
- login bloqueado por pagamento e verificação de e-mail
- área completa de alunos (CRUD, medidas, treinos e frequência)
- integração Tolletus (mock + interface para API/SDK real)

## Estrutura
- `backend/app/main.py`: app FastAPI
- `backend/app/core`: config, deps, security
- `backend/app/db`: conexão Mongo
- `backend/app/routes`: auth, billing, students, gyms, tolletus e compatibilidade
- `frontend/src`: app React
- `docker-compose.prod.yml`: stack de produção
- `DEPLOY_DIGITALOCEAN.md`: guia de deploy

## Ambiente local
```bash
cp .env.example .env
```

## Subir com Docker (local)
```bash
docker compose up -d --build
```

- Frontend: `http://localhost:3000`
- API: `http://localhost:8000`

## Rodar sem Docker
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
npm start
```

## Qualidade
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
```

## Deploy
Use `DEPLOY_DIGITALOCEAN.md` para produção em droplet 1vCPU/1GB.
