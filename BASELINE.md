# BASELINE

Data: 2026-02-22

## Comandos executados

1. `docker compose config`
- Erro: `docker: command not found`

2. `docker compose up -d`
- Erro: `docker: command not found`

3. `cd backend && python -m py_compile server.py`
- Resultado: OK

4. `cd backend && python -m pytest -q`
- Erro: `No module named pytest`

5. `cd frontend && npm run lint`
- Erro: `npm: command not found`

6. `cd frontend && npm run build`
- Erro: `npm: command not found`

7. `python -m pytest backend/tests -q`
- Resultado: `12 passed`

8. `python -m ruff check backend/app backend/tests gateway-toletus`
- Resultado: `All checks passed`

9. `python -m black --check backend/app backend/tests gateway-toletus`
- Resultado inicial: pendências de formatação (correção aplicada depois)

## Problemas encontrados

### Bloqueadores de ambiente
- Docker/Compose ausentes no host.
- Node/NPM ausentes no host.
- Frontend build/lint não validado localmente por ausência de Node/NPM.

### Configuração
- (Inicial) Repositório continha múltiplos arquivos `.md` além de `README.md` (consolidado).
- (Inicial) Existia pasta `.venv/` na raiz (removida do controle de versão).

### Segurança
- Não foram encontrados tokens TEST hardcoded nas configurações atuais após a limpeza inicial.
- Necessário manter varredura contínua para evitar regressão (`.env` não versionado).

## Prioridades de correção

1. Consolidar documentação em `README.md` único e remover docs redundantes.
2. Implementar sistema de funcionários por academia com RBAC (`OWNER`, `MANAGER`, `RECEPTION`, `TRAINER`).
3. Implementar integração Toletus com arquitetura correta SaaS + Gateway local:
   - módulo LiteNet2 (encoder/decoder 20 bytes)
   - gateway TCP local + assinatura HMAC
   - endpoints SaaS para decisão/eventos/dispositivos
4. Fortalecer billing (Mercado Pago): metadata, external_reference, notification_url, logs e atualização robusta de status.
5. Ajustes de deploy low-resource (1vCPU/1GB): compose, healthchecks, docs de runbook e hardening.

## Estado atual após correções

- Backend com testes e lint executando localmente.
- Estrutura Toletus LiteNet2 com gateway local, assinatura HMAC e anti-replay implementada.
- Billing, auth (verificação de e-mail + bloqueio por assinatura) e RBAC de funcionários integrados.

## Referência técnica usada
- Manual oficial Toletus LiteNet2 (repositório oficial):
  - https://github.com/Toletus/LiteNet2-ManuaisDeIntegracao
  - raw: https://raw.githubusercontent.com/Toletus/litenet2-manuaisdeintegracao/main/Manual%20de%20Integra%C3%A7%C3%A3o%20Toletus%20LiteNet2.md

