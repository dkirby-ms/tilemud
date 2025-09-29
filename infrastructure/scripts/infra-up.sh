#!/bin/bash

# Infrastructure startup script - Launch PostgreSQL + Redis containers for development
# Usage: ./infra-up.sh
# Environment variables can override defaults (see contracts/environment-variables.md)

set -euo pipefail

# Get script directory and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/infra-common.sh"

# Project root directory
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/infrastructure/docker-compose.dev.yml"
ENV_FILE="$PROJECT_ROOT/.env.local.infra"
IMAGE_DIGESTS_FILE="$PROJECT_ROOT/infrastructure/IMAGE_DIGESTS"

# Default values (can be overridden by environment)
export TILEMUD_PG_PORT="${TILEMUD_PG_PORT:-5438}"
export TILEMUD_REDIS_PORT="${TILEMUD_REDIS_PORT:-6380}"
export TILEMUD_PG_USER="${TILEMUD_PG_USER:-tilemud}"
export TILEMUD_PG_PASSWORD="${TILEMUD_PG_PASSWORD:-tilemud_dev_pw}"
export TILEMUD_PG_DB="${TILEMUD_PG_DB:-tilemud}"
export TILEMUD_INFRA_NETWORK="${TILEMUD_INFRA_NETWORK:-tilemud_net}"
export TILEMUD_PG_VOLUME="${TILEMUD_PG_VOLUME:-tilemud_pg_data}"
export TILEMUD_PG_IMAGE="${TILEMUD_PG_IMAGE:-postgres:18.0-alpine}"
export TILEMUD_REDIS_IMAGE="${TILEMUD_REDIS_IMAGE:-redis:8.2-alpine}"

main() {
  log_info "Starting TileMUD local infrastructure..."
  
  # Step 1: Pre-flight checks
  log_info "=== Pre-flight checks ==="
  check_docker || exit $?
  check_resources
  check_port_free "$TILEMUD_PG_PORT" "PG" || exit $?
  check_port_free "$TILEMUD_REDIS_PORT" "REDIS" || exit $?
  
  # Check if compose file exists
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    log_error "Docker Compose file not found: $COMPOSE_FILE"
    exit 1
  fi
  
  # Optional digest check (warn only)
  if [[ -f "$IMAGE_DIGESTS_FILE" ]]; then
    log_info "IMAGE_DIGESTS file found - consider running infra-verify.sh after startup"
  else
    log_warn "IMAGE_DIGESTS file not found at $IMAGE_DIGESTS_FILE"
  fi
  
  # Step 2: Pull images if not present
  log_info "=== Pulling container images ==="
  docker compose -f "$COMPOSE_FILE" pull --quiet
  
  # Step 3: Bring up compose stack
  log_info "=== Starting containers ==="
  docker compose -f "$COMPOSE_FILE" up -d
  
  # Step 4: Wait for health checks
  log_info "=== Waiting for services to become healthy ==="
  local max_wait=30
  local waited=0
  
  while [[ $waited -lt $max_wait ]]; do
    local pg_health redis_health
    pg_health=$(docker compose -f "$COMPOSE_FILE" ps --format json postgres 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "")
    redis_health=$(docker compose -f "$COMPOSE_FILE" ps --format json redis 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "")
    
    if [[ "$pg_health" == "healthy" && "$redis_health" == "healthy" ]]; then
      log_success "All services are healthy"
      break
    fi
    
    if [[ $waited -eq 0 ]]; then
      log_info "Waiting for services to become healthy (PostgreSQL: $pg_health, Redis: $redis_health)..."
    fi
    
    sleep 2
    waited=$((waited + 2))
  done
  
  if [[ $waited -ge $max_wait ]]; then
    log_error "Services did not become healthy within ${max_wait}s"
    log_error "Current status:"
    docker compose -f "$COMPOSE_FILE" ps
    exit 13
  fi
  
  # Step 5: Run migrations (placeholder for now)
  log_info "=== Running database migrations ==="
  if [[ -x "$SCRIPT_DIR/migrate.sh" ]]; then
    "$SCRIPT_DIR/migrate.sh" || {
      log_error "Migration failed"
      exit 12
    }
  else
    log_info "Migration script not found - skipping migrations"
  fi
  
  # Step 6: Generate environment file
  log_info "=== Generating environment configuration ==="
  write_env_file_atomic "$ENV_FILE"
  
  # Step 7: Print summary
  log_info "=== Startup Summary ==="
  log_success "TileMUD infrastructure is ready!"
  echo
  log_info "Services:"
  log_info "  PostgreSQL: localhost:$TILEMUD_PG_PORT (user: $TILEMUD_PG_USER, db: $TILEMUD_PG_DB)"
  log_info "  Redis:      localhost:$TILEMUD_REDIS_PORT"
  echo
  log_info "Environment file: $ENV_FILE"
  log_info "Docker network:   $TILEMUD_INFRA_NETWORK"
  log_info "Postgres volume:  $TILEMUD_PG_VOLUME"
  echo
  log_info "Next steps:"
  log_info "  - Source the environment file: source $ENV_FILE"
  log_info "  - Run verification: ./infrastructure/scripts/infra-verify.sh"
  log_info "  - Stop services: ./infrastructure/scripts/infra-down.sh"
  log_info "  - Reset data: ./infrastructure/scripts/infra-reset.sh"
}

# Handle script errors
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"