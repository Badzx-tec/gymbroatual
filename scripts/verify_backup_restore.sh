#!/usr/bin/env bash
set -euo pipefail

STACK_FILE="${STACK_FILE:-docker-compose.prod.yml}"
BACKUP_FILE="${1:-}"
SOURCE_DB="${DB_NAME:-gymbro}"
TEST_DB="${SOURCE_DB}_restore_test_$(date -u +%Y%m%d)"

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "uso: $0 <arquivo.archive.gz>"
  exit 1
fi
if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "arquivo nao encontrado: ${BACKUP_FILE}"
  exit 1
fi

echo "[verify] restaurando backup em db temporaria ${TEST_DB}"
docker compose -f "${STACK_FILE}" exec -T mongo \
  mongorestore \
  --username "${MONGO_ROOT_USERNAME:?MONGO_ROOT_USERNAME ausente}" \
  --password "${MONGO_ROOT_PASSWORD:?MONGO_ROOT_PASSWORD ausente}" \
  --authenticationDatabase admin \
  --gzip \
  --archive \
  --nsFrom "${SOURCE_DB}.*" \
  --nsTo "${TEST_DB}.*" < "${BACKUP_FILE}"

echo "[verify] validando colecoes restauradas"
COUNT="$(docker compose -f "${STACK_FILE}" exec -T mongo mongosh \
  --quiet \
  --username "${MONGO_ROOT_USERNAME}" \
  --password "${MONGO_ROOT_PASSWORD}" \
  --authenticationDatabase admin \
  --eval "db.getSiblingDB('${TEST_DB}').getCollectionNames().length")"

if [[ "${COUNT}" -gt 0 ]]; then
  echo "[verify] sucesso: ${COUNT} colecoes encontradas em ${TEST_DB}"
else
  echo "[verify] falha: nenhuma colecao encontrada em ${TEST_DB}"
  exit 1
fi

echo "[verify] limpando db temporaria ${TEST_DB}"
docker compose -f "${STACK_FILE}" exec -T mongo mongosh \
  --quiet \
  --username "${MONGO_ROOT_USERNAME}" \
  --password "${MONGO_ROOT_PASSWORD}" \
  --authenticationDatabase admin \
  --eval "db.getSiblingDB('${TEST_DB}').dropDatabase()"

echo "[verify] concluido"
