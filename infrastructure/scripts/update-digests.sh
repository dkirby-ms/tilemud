#!/bin/bash

# Update IMAGE_DIGESTS file with current digests from pulled images
# Usage: ./update-digests.sh
# This script pulls the latest versions of our pinned images and updates the digest file

set -euo pipefail

# Get script directory and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/infra-common.sh"

# Project root directory
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_DIGESTS_FILE="$PROJECT_ROOT/infrastructure/IMAGE_DIGESTS"

# Images to update (matching our compose file)
IMAGES=(
  "postgres:18.0-alpine"
  "redis:8.2-alpine"
)

main() {
  log_info "Updating IMAGE_DIGESTS file with current digests..."
  
  # Check Docker availability
  check_docker || exit $?
  
  # Create backup of existing file
  if [[ -f "$IMAGE_DIGESTS_FILE" ]]; then
    cp "$IMAGE_DIGESTS_FILE" "${IMAGE_DIGESTS_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    log_info "Backed up existing IMAGE_DIGESTS file"
  fi
  
  # Pull fresh images and collect digests
  log_info "=== Pulling images and collecting digests ==="
  local temp_file="${IMAGE_DIGESTS_FILE}.tmp"
  
  cat > "$temp_file" << 'EOF'
# TileMUD Infrastructure Image Digests
# This file pins container images to specific SHA256 digests for security and reproducibility
# 
# Format: image:tag@sha256:digest
# 
# Auto-updated by scripts/update-digests.sh
# Last updated: TIMESTAMP_PLACEHOLDER
#
# To verify current images match these digests:
# ./infrastructure/scripts/infra-verify.sh

EOF
  
  for image in "${IMAGES[@]}"; do
    log_info "Processing $image..."
    
    # Pull the image to get fresh repo digest
    if docker pull "$image" >/dev/null 2>&1; then
      # Get the repo digest
      local digest
      digest=$(docker image inspect "$image" --format '{{range .RepoDigests}}{{.}}{{end}}' 2>/dev/null | head -n1)
      
      if [[ -n "$digest" ]]; then
        # Extract just the sha256 part from the full repo digest
        local sha_part
        sha_part=$(echo "$digest" | grep -o 'sha256:[a-f0-9]\{64\}')
        
        if [[ -n "$sha_part" ]]; then
          echo "" >> "$temp_file"
          echo "# $(echo "$image" | cut -d: -f1 | tr '[:lower:]' '[:upper:]') $(echo "$image" | cut -d: -f2)" >> "$temp_file"
          echo "${image}@${sha_part}" >> "$temp_file"
          log_success "Updated digest for $image"
        else
          log_error "Could not extract SHA256 digest from: $digest"
          return 1
        fi
      else
        log_error "Could not get repo digest for $image"
        return 1
      fi
    else
      log_error "Failed to pull $image"
      return 1
    fi
  done
  
  # Update timestamp
  local timestamp
  timestamp=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
  sed -i "s/TIMESTAMP_PLACEHOLDER/$timestamp/" "$temp_file"
  
  # Atomically replace the original file
  mv "$temp_file" "$IMAGE_DIGESTS_FILE"
  
  log_success "IMAGE_DIGESTS file updated successfully"
  echo
  log_info "Updated file:"
  cat "$IMAGE_DIGESTS_FILE"
  echo
  log_info "To verify the updated digests:"
  log_info "  ./infrastructure/scripts/infra-verify.sh"
}

# Handle script errors
trap 'log_error "Update digests script failed at line $LINENO"' ERR

# Run main function
main "$@"