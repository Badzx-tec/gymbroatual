#!/usr/bin/env bash
set -euo pipefail

STACK_FILE="${STACK_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_DIR}/mongo-${TIMESTAMP}.archive.gz"

mkdir -p "${BACKUP_DIR}"

echo "[backup] criando dump em ${BACKUP_FILE}"
docker compose -f "${STACK_FILE}" exec -T mongo \
  mongodump \
  --username "${MONGO_ROOT_USERNAME:?MONGO_ROOT_USERNAME ausente}" \
  --password "${MONGO_ROOT_PASSWORD:?MONGO_ROOT_PASSWORD ausente}" \
  --authenticationDatabase admin \
  --gzip \
  --archive > "${BACKUP_FILE}"

echo "[backup] concluido: ${BACKUP_FILE}"
