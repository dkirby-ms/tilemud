#!/usr/bin/env bash
# Derive application runtime env vars (DATABASE_URL, REDIS_URL, PORT) from the
# infra-generated .env.local.infra file. Source this script after infrastructure
# is up to export required variables for server scripts (migrations, seeding, dev).
#
# Usage:
#   source ./scripts/derive-env.sh [--port <port>] [--env-file <path>]
#
# Options:
#   --port       Override PORT (default 4000)
#   --env-file   Path to infra env file (default ../../.env.local.infra relative to this script)
#
# This script is idempotent; re-sourcing updates variables.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INFRA_ENV="$(cd "$SCRIPT_DIR/../.." && pwd)/.env.local.infra"
PORT_OVERRIDE=""
INFRA_ENV_FILE="$DEFAULT_INFRA_ENV"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT_OVERRIDE="$2"; shift 2 ;;
    --env-file)
      INFRA_ENV_FILE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; return 2 ;;
  esac
done

if [[ ! -f "$INFRA_ENV_FILE" ]]; then
  echo "[derive-env] Infra env file not found: $INFRA_ENV_FILE" >&2
  echo "Run ./infrastructure/scripts/infra-up.sh first." >&2
  return 3
fi

# shellcheck disable=SC1090
source "$INFRA_ENV_FILE"

: "${TILEMUD_PG_HOST:=localhost}"
: "${TILEMUD_PG_PORT:=5438}"
: "${TILEMUD_PG_USER:=tilemud}"
: "${TILEMUD_PG_PASSWORD:=tilemud_dev_pw}"
: "${TILEMUD_PG_DB:=tilemud}"
: "${TILEMUD_REDIS_HOST:=localhost}"
: "${TILEMUD_REDIS_PORT:=6380}"

export DATABASE_URL="postgres://${TILEMUD_PG_USER}:${TILEMUD_PG_PASSWORD}@${TILEMUD_PG_HOST}:${TILEMUD_PG_PORT}/${TILEMUD_PG_DB}"
export REDIS_URL="redis://${TILEMUD_REDIS_HOST}:${TILEMUD_REDIS_PORT}/0"
export PORT="${PORT_OVERRIDE:-${PORT:-4000}}"

echo "[derive-env] Exported DATABASE_URL=$DATABASE_URL"
echo "[derive-env] Exported REDIS_URL=$REDIS_URL"
echo "[derive-env] Exported PORT=$PORT"
