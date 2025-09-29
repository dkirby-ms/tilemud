#!/bin/bash

# Infrastructure verification script - Verify container images match expected digests
# Usage: ./infra-verify.sh [--pull-missing]
# Ensures running infrastructure uses pinned image digests for security

set -euo pipefail

# Get script directory and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/infra-common.sh"

# Project root directory
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/infrastructure/docker-compose.dev.yml"
IMAGE_DIGESTS_FILE="$PROJECT_ROOT/infrastructure/IMAGE_DIGESTS"

# Parse command line arguments
PULL_MISSING=false
if [[ "$#" -gt 0 && "$1" == "--pull-missing" ]]; then
  PULL_MISSING=true
fi

# Parse IMAGE_DIGESTS file and return array of image:digest pairs
parse_digests_file() {
  local digests_file="$1"
  
  if [[ ! -f "$digests_file" ]]; then
    log_error "IMAGE_DIGESTS file not found: $digests_file"
    return 41
  fi
  
  # Extract non-comment lines containing image digests
  grep -v '^#' "$digests_file" | grep -v '^[[:space:]]*$' | grep '@sha256:' || true
}

# Get the actual digest of a local image
get_image_digest() {
  local image_tag="$1"
  
  # First check if image exists locally
  if ! docker image inspect "$image_tag" >/dev/null 2>&1; then
    if [[ "$PULL_MISSING" == "true" ]]; then
      log_info "Pulling missing image: $image_tag"
      docker pull "$image_tag" >/dev/null 2>&1
    else
      echo ""
      return 1
    fi
  fi
  
  # Get the repo digest (the digest from the registry)
  local repo_digests
  repo_digests=$(docker image inspect "$image_tag" --format '{{range .RepoDigests}}{{.}} {{end}}' 2>/dev/null || echo "")
  
  if [[ -n "$repo_digests" ]]; then
    # Return the first repo digest, extract just the sha256 part
    echo "$repo_digests" | tr ' ' '\n' | head -n1 | grep -o 'sha256:[a-f0-9]\{64\}' || echo ""
  else
    # Fallback to image ID if no repo digest (shouldn't happen for pulled images)
    echo ""
  fi
}

# Main verification logic
main() {
  log_info "Verifying infrastructure image digests..."
  
  # Check if IMAGE_DIGESTS file exists
  if [[ ! -f "$IMAGE_DIGESTS_FILE" ]]; then
    log_error "IMAGE_DIGESTS file missing: $IMAGE_DIGESTS_FILE"
    exit 41
  fi
  
  # Warn if containers are not running (but continue verification)
  if [[ -f "$COMPOSE_FILE" ]]; then
    local running_containers
    running_containers=$(docker compose -f "$COMPOSE_FILE" ps -q 2>/dev/null | wc -l)
    
    if [[ "$running_containers" -eq 0 ]]; then
      log_warn "No containers are currently running, but continuing image verification"
    fi
  fi
  
  # Parse expected digests
  local expected_digests
  expected_digests=$(parse_digests_file "$IMAGE_DIGESTS_FILE")
  
  if [[ -z "$expected_digests" ]]; then
    log_error "No valid image digests found in $IMAGE_DIGESTS_FILE"
    exit 41
  fi
  
  echo
  log_info "VERIFY SUMMARY"
  echo "=============="
  
  local mismatches=0
  local total_images=0
  
  # Process each expected digest
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    
    # Parse line: image:tag@sha256:digest
    local image_with_digest="$line"
    local image_tag expected_digest
    
    image_tag=$(echo "$image_with_digest" | cut -d'@' -f1)
    expected_digest=$(echo "$image_with_digest" | cut -d'@' -f2)
    
    if [[ -z "$image_tag" || -z "$expected_digest" ]]; then
      log_warn "Malformed line in IMAGE_DIGESTS: $line"
      continue
    fi
    
    total_images=$((total_images + 1))
    
    # Get actual digest
    local actual_digest
    actual_digest=$(get_image_digest "$image_tag")
    
    if [[ -z "$actual_digest" ]]; then
      echo "MISSING $image_tag (image not found locally)"
      mismatches=$((mismatches + 1))
      continue
    fi
    
    # Compare digests
    if [[ "$expected_digest" == "$actual_digest" ]]; then
      echo "OK $image_tag $actual_digest"
    else
      echo "MISMATCH $image_tag expected $expected_digest got $actual_digest"
      mismatches=$((mismatches + 1))
    fi
    
  done <<< "$expected_digests"
  
  echo
  
  # Summary
  if [[ $mismatches -eq 0 ]]; then
    log_success "All $total_images image(s) verified successfully"
    exit 0
  else
    log_error "$mismatches of $total_images image(s) have digest mismatches"
    log_error "Run with --pull-missing to pull missing images"
    log_error "Update IMAGE_DIGESTS file if intentional image changes were made"
    exit 40
  fi
}

# Handle script errors
trap 'log_error "Verification script failed at line $LINENO"' ERR

# Run main function
main "$@"