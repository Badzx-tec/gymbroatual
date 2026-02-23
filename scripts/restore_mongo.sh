#!/usr/bin/env bash
set -euo pipefail

STACK_FILE="${STACK_FILE:-docker-compose.prod.yml}"
BACKUP_FILE="${1:-}"

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "uso: $0 <arquivo.archive.gz>"
  exit 1
fi
if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "arquivo nao encontrado: ${BACKUP_FILE}"
  exit 1
fi

echo "[restore] restaurando dump ${BACKUP_FILE}"
docker compose -f "${STACK_FILE}" exec -T mongo \
  mongorestore \
  --drop \
  --username "${MONGO_ROOT_USERNAME:?MONGO_ROOT_USERNAME ausente}" \
  --password "${MONGO_ROOT_PASSWORD:?MONGO_ROOT_PASSWORD ausente}" \
  --authenticationDatabase admin \
  --gzip \
  --archive < "${BACKUP_FILE}"

echo "[restore] concluido"
