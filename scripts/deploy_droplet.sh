#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/gymbroatual}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BRANCH="${BRANCH:-main}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://gymbro.dev.br/api/health}"

cd "$PROJECT_DIR"

echo "==> Updating repository ($BRANCH)"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Validating compose file"
docker compose -f "$COMPOSE_FILE" config -q

echo "==> Rebuilding and restarting services"
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans backend frontend nginx

echo "==> Waiting for local health"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1/api/health >/dev/null; then
    break
  fi
  sleep 2
done

echo "==> Container status"
docker compose -f "$COMPOSE_FILE" ps

echo "==> Local health"
curl -fsS http://127.0.0.1/api/health
echo

echo "==> Public health ($PUBLIC_HEALTH_URL)"
curl -fsS "$PUBLIC_HEALTH_URL"
echo

echo "==> Tail backend logs"
docker compose -f "$COMPOSE_FILE" logs --tail=80 backend

echo "==> Deploy done"
