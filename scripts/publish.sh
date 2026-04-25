#!/usr/bin/env bash
#
# publish.sh — Publish all @ontrails packages using bun publish
#
# Usage: ./scripts/publish.sh [--dry-run] [--otp <code>]
#
# Uses bun publish (not npm publish) so workspace:^ is automatically
# replaced with the actual version. Changesets handles versioning,
# this script handles publishing.
#

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

info() { echo -e "\033[0;34m▸\033[0m $1"; }
success() { echo -e "\033[0;32m✓\033[0m $1"; }
error() { echo -e "\033[0;31m✗\033[0m $1" >&2; }

DRY_RUN=false
OTP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --otp)
      if [[ -z "${2:-}" ]]; then
        error "--otp requires a code"
        exit 1
      fi
      OTP="${2:-}"
      shift 2
      ;;
    *)
      error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# Packages in dependency order (core first, dependents after)
PACKAGES=(
  packages/core
  packages/store
  packages/logging
  packages/logtape
  packages/schema
  packages/config
  packages/permits
  packages/tracing
  packages/cli
  packages/http
  packages/mcp
  packages/testing
  packages/warden
  connectors/drizzle
  connectors/hono
  connectors/vite
  apps/trails
)

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

  if [[ "$DRY_RUN" == "true" ]]; then
    info "Checking package contents for $pkg_name@$pkg_version..."
    pack_log=$(mktemp)
    if (cd "$pkg_path" && npm pack --dry-run >"$pack_log" 2>&1); then
      success "$pkg_name@$pkg_version pack check passed"
      rm -f "$pack_log"
      continue
    fi

    error "Failed pack check for $pkg_name"
    cat "$pack_log" >&2
    rm -f "$pack_log"
    exit 1
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
if [[ "$DRY_RUN" == "true" ]]; then
  success "All package pack checks passed!"
else
  success "All packages published!"
fi
