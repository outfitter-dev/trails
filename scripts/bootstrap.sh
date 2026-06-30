#!/usr/bin/env bash
#
# bootstrap.sh — cold-start trampoline for Trails repo lifecycle commands.
#
# Usage:
#   ./scripts/bootstrap.sh [repo|agent|codex|claude|doctor|teardown] [--force] [--update]
#   ./scripts/bootstrap.sh --force   # legacy alias for repo --force
#   ./scripts/bootstrap.sh --update  # legacy alias for repo --update

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BUN_VERSION_FILE="$REPO_ROOT/.bun-version"

usage() {
  cat <<'EOF'
Usage: ./scripts/bootstrap.sh [repo|agent|codex|claude|cursor|doctor|teardown] [--force] [--update]

Commands:
  repo     Make this checkout runnable (default)
  agent    Repo bootstrap plus agent lifecycle diagnostics
  codex    Codex agent bootstrap with provider-specific root detection
  claude   Claude agent bootstrap with provider-specific root detection
  cursor   Cursor agent bootstrap with provider-specific root detection
  doctor   Diagnostics only; no install, cleanup, or mutation
  teardown Conservative cleanup of configured runtime artifacts only

Compatibility:
  ./scripts/bootstrap.sh --force
  ./scripts/bootstrap.sh --update
  ./scripts/bootstrap.sh sweep
EOF
}

if [[ ! -f "$BUN_VERSION_FILE" ]]; then
  echo "Error: Missing .bun-version at $BUN_VERSION_FILE" >&2
  exit 1
fi

SUBCOMMAND="${1:-repo}"
case "$SUBCOMMAND" in
  repo|agent|codex|claude|cursor|doctor|sweep|teardown)
    shift || true
    ;;
  --force|--update)
    SUBCOMMAND="repo"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown bootstrap subcommand: $SUBCOMMAND" >&2
    usage >&2
    exit 2
    ;;
esac

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"

# Lifecycle-safe PATH. Normal agent command shells keep their provider shims;
# bootstrap install paths need real system tools first so installer-style
# commands such as curl | bash are not intercepted by local host shims.
export PATH="$BUN_INSTALL/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
hash -r 2>/dev/null || true

cd "$REPO_ROOT"

read_pinned_bun_version() {
  tr -d '[:space:]' < "$BUN_VERSION_FILE"
}

install_pinned_bun() {
  local pinned_version="$1"
  echo "Installing Bun $pinned_version..." >&2
  curl -fsSL https://bun.sh/install | bash -s -- "bun-v$pinned_version"
  export PATH="$BUN_INSTALL/bin:$PATH"
  hash -r 2>/dev/null || true
}

bun_version_is_compatible() {
  local actual="$1"
  local pinned="$2"
  local actual_major actual_minor actual_patch_raw actual_patch
  local pinned_major pinned_minor pinned_patch_raw pinned_patch

  IFS=. read -r actual_major actual_minor actual_patch_raw <<< "$actual"
  IFS=. read -r pinned_major pinned_minor pinned_patch_raw <<< "$pinned"
  actual_patch="${actual_patch_raw%%[^0-9]*}"
  pinned_patch="${pinned_patch_raw%%[^0-9]*}"

  [[ "${actual_major:-0}" =~ ^[0-9]+$ ]] || return 1
  [[ "${actual_minor:-0}" =~ ^[0-9]+$ ]] || return 1
  [[ "${actual_patch:-0}" =~ ^[0-9]+$ ]] || return 1
  [[ "${pinned_major:-0}" =~ ^[0-9]+$ ]] || return 1
  [[ "${pinned_minor:-0}" =~ ^[0-9]+$ ]] || return 1
  [[ "${pinned_patch:-0}" =~ ^[0-9]+$ ]] || return 1

  [[ "$actual_major" -eq "$pinned_major" ]] &&
    [[ "$actual_minor" -eq "$pinned_minor" ]] &&
    [[ "$actual_patch" -ge "$pinned_patch" ]]
}

pinned_version="$(read_pinned_bun_version)"
if [[ -z "$pinned_version" ]]; then
  echo "Error: .bun-version is empty" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  if [[ "$SUBCOMMAND" == "doctor" || "$SUBCOMMAND" == "sweep" ]]; then
    echo "Error: Bun is required for '$SUBCOMMAND' and will not be installed by that command." >&2
    exit 1
  fi

  install_pinned_bun "$pinned_version"
else
  actual_version="$(bun --version 2>/dev/null || true)"
  if [[ "$SUBCOMMAND" != "doctor" && "$SUBCOMMAND" != "sweep" ]] &&
    ! bun_version_is_compatible "$actual_version" "$pinned_version"; then
    echo "Bun $actual_version is not compatible with pinned $pinned_version; repairing bootstrap runtime..." >&2
    install_pinned_bun "$pinned_version"
  fi
fi

exec bun "$SCRIPT_DIR/bootstrap/main.ts" "$SUBCOMMAND" "$@"
