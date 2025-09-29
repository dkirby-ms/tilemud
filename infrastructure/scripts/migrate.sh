#!/bin/bash

# Database migration runner - Apply SQL migrations idempotently
# Usage: ./migrate.sh
# Maintains ledger of applied migrations to prevent re-application

set -euo pipefail

# Get script directory and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/infra-common.sh"

# Project root directory
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$PROJECT_ROOT/infrastructure/migrations"
LEDGER_FILE="$PROJECT_ROOT/infrastructure/migrations/ledger.json"
COMPOSE_FILE="$PROJECT_ROOT/infrastructure/docker-compose.dev.yml"

# Database connection defaults
TILEMUD_PG_USER="${TILEMUD_PG_USER:-tilemud}"
TILEMUD_PG_DB="${TILEMUD_PG_DB:-tilemud}"

# Initialize or read migration ledger
init_ledger() {
  if [[ ! -f "$LEDGER_FILE" ]]; then
    log_info "Initializing migration ledger"
    mkdir -p "$(dirname "$LEDGER_FILE")"
    echo '{"migrations": [], "last_updated": ""}' > "$LEDGER_FILE"
  fi
}

# Get list of applied migrations from ledger
get_applied_migrations() {
  if [[ -f "$LEDGER_FILE" ]]; then
    # Extract migration filenames from the ledger (simplified JSON parsing)
    grep -o '"filename":"[^"]*"' "$LEDGER_FILE" 2>/dev/null | cut -d'"' -f4 | sort || true
  fi
}

# Add migration to ledger
add_to_ledger() {
  local filename="$1"
  local checksum="$2"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  
  # Simple JSON manipulation (would use jq in production)
  local temp_file="${LEDGER_FILE}.tmp"
  
  # Read existing content or create new
  if [[ -f "$LEDGER_FILE" ]]; then
    local existing_content
    existing_content=$(cat "$LEDGER_FILE")
    
    # Remove the closing brace and add new migration entry
    echo "$existing_content" | sed 's/}$//' > "$temp_file"
    
    # Add comma if there are existing migrations
    if grep -q '"migrations":\s*\[' "$temp_file" && ! grep -q '"migrations":\s*\[\s*\]' "$temp_file"; then
      echo "," >> "$temp_file"
    fi
    
    # Add the new migration entry (simplified)
    cat >> "$temp_file" << EOF
    {
      "filename": "$filename",
      "checksum": "$checksum",
      "applied_at": "$timestamp"
    }
  ],
  "last_updated": "$timestamp"
}
EOF
  else
    # Create new ledger
    cat > "$temp_file" << EOF
{
  "migrations": [
    {
      "filename": "$filename",
      "checksum": "$checksum",
      "applied_at": "$timestamp"
    }
  ],
  "last_updated": "$timestamp"
}
EOF
  fi
  
  # Fix JSON structure (remove extra content before migrations array)
  sed -i '/^{$/,/"migrations": \[/{ /^{$/d; /"migrations": \[/!d; }' "$temp_file" 2>/dev/null || true
  
  # Atomic move
  mv "$temp_file" "$LEDGER_FILE"
}

# Execute a SQL file against the database
execute_sql_file() {
  local sql_file="$1"
  
  log_info "Executing migration: $(basename "$sql_file")"
  
  # Execute using docker compose exec
  if ! docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U "$TILEMUD_PG_USER" -d "$TILEMUD_PG_DB" -f - < "$sql_file"; then
    log_error "Failed to execute migration: $(basename "$sql_file")"
    return 12
  fi
  
  log_success "Migration completed: $(basename "$sql_file")"
}

# Main migration logic
main() {
  log_info "Starting database migrations..."
  
  # Check if migrations directory exists
  if [[ ! -d "$MIGRATIONS_DIR" ]]; then
    log_info "No migrations directory found - skipping migrations"
    return 0
  fi
  
  # Check if postgres container is running
  if ! docker compose -f "$COMPOSE_FILE" ps postgres | grep -q "Up.*healthy"; then
    log_error "PostgreSQL container is not running or not healthy"
    return 13
  fi
  
  # Initialize ledger
  init_ledger
  
  # Get list of applied migrations
  local applied_migrations
  applied_migrations=$(get_applied_migrations)
  
  # Find all SQL migration files
  local migration_files
  migration_files=$(find "$MIGRATIONS_DIR" -name "*.sql" | sort)
  
  if [[ -z "$migration_files" ]]; then
    log_info "No migration files found"
    return 0
  fi
  
  local migrations_applied=0
  
  # Process each migration file
  while IFS= read -r sql_file; do
    local filename
    filename=$(basename "$sql_file")
    
    # Skip if already applied
    if echo "$applied_migrations" | grep -q "^$filename$"; then
      log_info "Skipping already applied migration: $filename"
      continue
    fi
    
    # Calculate checksum
    local checksum
    checksum=$(hash_file "$sql_file")
    
    if [[ -z "$checksum" ]]; then
      log_error "Could not calculate checksum for $filename"
      return 1
    fi
    
    # Execute the migration
    if execute_sql_file "$sql_file"; then
      add_to_ledger "$filename" "$checksum"
      migrations_applied=$((migrations_applied + 1))
    else
      log_error "Migration failed: $filename"
      return 12
    fi
    
  done <<< "$migration_files"
  
  if [[ $migrations_applied -eq 0 ]]; then
    log_info "No new migrations to apply"
  else
    log_success "Applied $migrations_applied new migration(s)"
  fi
  
  log_info "Migration process completed"
}

# Handle script errors
trap 'log_error "Migration script failed at line $LINENO"' ERR

# Run main function
main "$@"