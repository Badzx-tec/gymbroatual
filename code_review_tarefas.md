# Revisão da base e tarefas sugeridas

## 1) Tarefa para corrigir erro de digitação
**Problema encontrado:** o título do README está com o nome "GYM One" enquanto o projeto/repositório e o backend usam "GymBro".

**Evidência:** `readme.md` abre com `# GYM One - Installer - V1.2.0`, enquanto `backend/server.py` declara `FastAPI(title="GymBro API", ...)`.

**Tarefa sugerida:** padronizar o nome no README para "GymBro" (ex.: `# GymBro - Installer - V1.2.0`) e revisar menções semelhantes para evitar confusão de marca/produto.

## 2) Tarefa para corrigir bug
**Problema encontrado:** CORS está configurado com `allow_origins=["*"]` e `allow_credentials=True`.

**Risco:** essa combinação costuma quebrar autenticação via cookies em navegadores (credenciais não são aceitas com origem curinga), impactando fluxos de sessão como login social.

**Tarefa sugerida:** substituir `"*"` por uma lista explícita de origens permitidas (via variável de ambiente), mantendo `allow_credentials=True` apenas para origens confiáveis.

## 3) Tarefa para ajustar discrepância de documentação
**Problema encontrado:** o README lista **MySQL** como requisito, mas o backend usa **MongoDB** (`motor` + `MONGO_URL`).

**Impacto:** risco de setup errado por novos contribuidores/operadores.

**Tarefa sugerida:** atualizar a seção de requisitos e instalação no README para refletir MongoDB (incluindo exemplo de variáveis de ambiente mínimas).

## 4) Tarefa para melhorar um teste
**Problema encontrado:** `backend_test.py` depende de uma URL fixa de ambiente preview no construtor, o que reduz reprodutibilidade local/CI e pode quebrar com expiração do ambiente.

**Tarefa sugerida:** aceitar `BASE_URL` por variável de ambiente (com fallback local, ex.: `http://localhost:8000`) e adicionar validações específicas para exports binários (ex.: `Content-Type`, tamanho do payload > 0).
