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

# Append signature marker used by openapi.sync.spec.ts
SIG=$(grep -E '^paths:' -n "${FEATURE_CONTRACT}" >/dev/null; awk '/^paths:/,0' "${FEATURE_CONTRACT}" | grep -E '^  /' | awk '{print $1}' ; awk '/^components:/,0' "${FEATURE_CONTRACT}" | awk '/^    [A-Za-z0-9_]+:$/ {gsub(":","",$1); print $1}')
# Fallback simpler: hash entire file if above fails
if [[ -z "${SIG}" ]]; then
  SIG_CONTENT=$(cat "${FEATURE_CONTRACT}")
else
  SIG_CONTENT="${SIG}"
fi
SHORT_HASH=$(printf "%s" "${SIG_CONTENT}" | sha256sum | cut -c1-16)
echo -e "\n// OPENAPI_CONTRACT_SIGNATURE: ${SHORT_HASH}" >> "${OUTPUT_FILE}"
