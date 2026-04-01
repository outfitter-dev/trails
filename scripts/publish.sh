#!/usr/bin/env bash
#
# publish.sh — Publish all @ontrails packages using bun publish
#
# Usage: ./scripts/publish.sh [--otp <code>]
#
# Uses bun publish (not npm publish) so workspace:^ is automatically
# replaced with the actual version. Changesets handles versioning,
# this script handles publishing.
#

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

OTP=""
if [[ "${1:-}" == "--otp" ]] && [[ -n "${2:-}" ]]; then
  OTP="$2"
fi

# Packages in dependency order (core first, dependents after)
PACKAGES=(
  packages/core
  packages/logging
  packages/schema
  packages/config
  packages/permits
  packages/crumbs
  packages/cli
  packages/http
  packages/mcp
  packages/testing
  packages/warden
  apps/trails
)

info() { echo -e "\033[0;34m▸\033[0m $1"; }
success() { echo -e "\033[0;32m✓\033[0m $1"; }
error() { echo -e "\033[0;31m✗\033[0m $1" >&2; }

for pkg in "${PACKAGES[@]}"; do
  pkg_path="$REPO_ROOT/$pkg"
  pkg_name=$(jq -r '.name' "$pkg_path/package.json")
  pkg_version=$(jq -r '.version' "$pkg_path/package.json")

  # Skip private packages that shouldn't be published
  is_private=$(jq -r '.private // false' "$pkg_path/package.json")
  if [[ "$is_private" == "true" ]]; then
    info "Skipping $pkg_name (private)"
    continue
  fi

  info "Publishing $pkg_name@$pkg_version..."

  publish_args=(--access public)
  if [[ -n "$OTP" ]]; then
    publish_args+=(--otp "$OTP")
  fi

  if (cd "$pkg_path" && bun publish "${publish_args[@]}"); then
    success "$pkg_name@$pkg_version published"
  else
    error "Failed to publish $pkg_name"
    exit 1
  fi
done

echo ""
success "All packages published!"
