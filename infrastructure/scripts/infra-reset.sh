#!/bin/bash

# Infrastructure reset script - Stop containers and remove all data
# Usage: ./infra-reset.sh
# WARNING: This will permanently delete all PostgreSQL data and migration state

set -euo pipefail

# Get script directory and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/infra-common.sh"

# Project root directory
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/infrastructure/docker-compose.dev.yml"
MIGRATIONS_STATE_DIR="$PROJECT_ROOT/infrastructure/migrations/state"
LEDGER_FILE="$PROJECT_ROOT/infrastructure/migrations/ledger.json"

# Default values for volume names
TILEMUD_PG_VOLUME="${TILEMUD_PG_VOLUME:-tilemud_pg_data}"

main() {
  log_info "Resetting TileMUD local infrastructure..."
  log_warn "This will permanently delete all data!"
  
  # Check if compose file exists
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    log_error "Docker Compose file not found: $COMPOSE_FILE"
    exit 1
  fi
  
  # Step 1: Stop all containers first
  log_info "=== Stopping containers ==="
  if docker compose -f "$COMPOSE_FILE" ps -q 2>/dev/null | grep -q .; then
    log_info "Stopping running containers..."
    docker compose -f "$COMPOSE_FILE" down
  else
    log_info "No containers are running"
  fi
  
  # Step 2: Remove PostgreSQL volume
  log_info "=== Removing data volumes ==="
  if docker volume ls -q | grep -q "^${TILEMUD_PG_VOLUME}$"; then
    log_info "Removing PostgreSQL volume: $TILEMUD_PG_VOLUME"
    docker volume rm "$TILEMUD_PG_VOLUME"
    log_success "PostgreSQL volume removed"
  else
    log_info "PostgreSQL volume $TILEMUD_PG_VOLUME does not exist"
  fi
  
  # Step 3: Remove migration state files
  log_info "=== Cleaning migration state ==="
  if [[ -f "$LEDGER_FILE" ]]; then
    log_info "Removing migration ledger: $LEDGER_FILE"
    rm -f "$LEDGER_FILE"
  fi
  
  if [[ -d "$MIGRATIONS_STATE_DIR" ]]; then
    log_info "Removing migration state directory: $MIGRATIONS_STATE_DIR"
    rm -rf "$MIGRATIONS_STATE_DIR"
  fi
  
  # Step 4: Clean up any orphaned networks (best effort)
  log_info "=== Cleaning up networks ==="
  local network_name="${TILEMUD_INFRA_NETWORK:-tilemud_net}"
  if docker network ls --format '{{.Name}}' | grep -q "^${network_name}$"; then
    log_info "Removing network: $network_name"
    docker network rm "$network_name" 2>/dev/null || log_warn "Could not remove network (may be in use)"
  fi
  
  log_success "Infrastructure reset completed"
  echo
  log_info "All data has been permanently deleted including:"
  log_info "  - PostgreSQL database contents"
  log_info "  - Migration history and state"
  log_info "  - Docker volumes and networks"
  echo
  log_info "To restart with fresh infrastructure:"
  log_info "  ./infrastructure/scripts/infra-up.sh"
}

# Handle script errors
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"