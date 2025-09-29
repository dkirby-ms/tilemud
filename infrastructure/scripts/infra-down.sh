#!/bin/bash

# Infrastructure shutdown script - Stop PostgreSQL + Redis containers (preserves data)
# Usage: ./infra-down.sh
# Note: This does NOT remove volumes - data persists across restarts

set -euo pipefail

# Get script directory and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/infra-common.sh"

# Project root directory
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/infrastructure/docker-compose.dev.yml"

main() {
  log_info "Stopping TileMUD local infrastructure..."
  
  # Check if compose file exists
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    log_error "Docker Compose file not found: $COMPOSE_FILE"
    exit 1
  fi
  
  # Check if containers are running
  local running_containers
  running_containers=$(docker compose -f "$COMPOSE_FILE" ps -q 2>/dev/null | wc -l)
  
  if [[ "$running_containers" -eq 0 ]]; then
    log_info "No containers are currently running"
    return 0
  fi
  
  # Stop the containers (preserves volumes)
  log_info "Stopping containers..."
  docker compose -f "$COMPOSE_FILE" down
  
  log_success "Infrastructure stopped successfully"
  echo
  log_info "Data volumes preserved:"
  log_info "  - PostgreSQL data: ${TILEMUD_PG_VOLUME:-tilemud_pg_data}"
  echo
  log_info "To restart: ./infrastructure/scripts/infra-up.sh"
  log_info "To reset all data: ./infrastructure/scripts/infra-reset.sh"
}

# Handle script errors
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"