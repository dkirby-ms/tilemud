#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)
FEATURE_CONTRACT="${PROJECT_ROOT}/../specs/004-i-want-to/contracts/game-service.yaml"
OUTPUT_FILE="${PROJECT_ROOT}/src/contracts/api-types.d.ts"

if [[ ! -f "${FEATURE_CONTRACT}" ]]; then
  echo "error: OpenAPI contract not found at ${FEATURE_CONTRACT}" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_FILE}")"

npx --yes openapi-typescript "${FEATURE_CONTRACT}" --output "${OUTPUT_FILE}"
