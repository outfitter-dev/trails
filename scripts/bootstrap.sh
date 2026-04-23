#!/usr/bin/env bash
#
# bootstrap.sh — Get this repo from clone to runnable
#
# Usage: ./scripts/bootstrap.sh [--force] [--update]
#
# By default, exits immediately if all tools and deps are present.
# Use --force to run full bootstrap regardless.
#
# This script is safe to run repeatedly. Cloud agents (Claude Code, Codex)
# should run this before any other commands.
#
# Runtime requirements:
#   - bash 4+
#   - one of: bun, node, python3, or python — used to parse package.json
#     before dependency install checks can trust workspace state. Prefer
#     Bun or Node when available so agent and CI environments do not depend
#     on Python being present.
#

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BUN_VERSION_FILE="$REPO_ROOT/.bun-version"

if [[ ! -f "$BUN_VERSION_FILE" ]]; then
  echo "Error: Missing .bun-version at $BUN_VERSION_FILE" >&2
  exit 1
fi

PINNED_BUN_VERSION="$(tr -d '[:space:]' < "$BUN_VERSION_FILE")"

if [[ -z "$PINNED_BUN_VERSION" ]]; then
  echo "Error: .bun-version is empty" >&2
  exit 1
fi

usage() {
  cat <<'EOF'
Usage: ./scripts/bootstrap.sh [--force] [--update]

  --force   Run the full bootstrap even if tools and dependencies look present.
  --update  Refresh dependencies with a non-frozen install.
EOF
}

# Colors (disabled when stderr is not a terminal — all log helpers write there)
if [[ -t 2 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

info() { echo -e "${BLUE}▸${NC} $1" >&2; }
success() { echo -e "${GREEN}✓${NC} $1" >&2; }
warn() { echo -e "${YELLOW}!${NC} $1" >&2; }
error() { echo -e "${RED}✗${NC} $1" >&2; }

# Check if command exists
has() { command -v "$1" &>/dev/null; }

list_workspace_globs() {
  if has bun; then
    TRAILS_PACKAGE_JSON="$REPO_ROOT/package.json" bun --eval '
      const packageJson = JSON.parse(
        await Bun.file(process.env.TRAILS_PACKAGE_JSON).text()
      );
      for (const workspace of packageJson.workspaces ?? []) {
        console.log(workspace);
      }
    '
  elif has node; then
    TRAILS_PACKAGE_JSON="$REPO_ROOT/package.json" node --input-type=module --eval '
      import { readFileSync } from "node:fs";

      const packageJson = JSON.parse(
        readFileSync(process.env.TRAILS_PACKAGE_JSON, "utf8")
      );
      for (const workspace of packageJson.workspaces ?? []) {
        console.log(workspace);
      }
    '
  elif has python3; then
    TRAILS_PACKAGE_JSON="$REPO_ROOT/package.json" python3 - <<'PY'
import json
import os

with open(os.environ["TRAILS_PACKAGE_JSON"], "r", encoding="utf-8") as fh:
    package = json.load(fh)

for workspace in package.get("workspaces", []):
    print(workspace)
PY
  elif has python; then
    TRAILS_PACKAGE_JSON="$REPO_ROOT/package.json" python - <<'PY'
import json
import os

with open(os.environ["TRAILS_PACKAGE_JSON"], "r", encoding="utf-8") as fh:
    package = json.load(fh)

for workspace in package.get("workspaces", []):
    print(workspace)
PY
  else
    warn "No Bun, Node, or Python runtime found; workspace install-state check skipped"
    return 1
  fi
}

has_repo_install_state() {
  [[ -e "$REPO_ROOT/node_modules" ]] || return 1

  local dir
  local workspace_glob
  local workspace_globs=()
  local nullglob_state
  local ws_output
  nullglob_state="$(shopt -p nullglob)"

  # Capture list_workspace_globs output into a variable so its exit code is
  # visible. Using process substitution hides failures (e.g. missing Python
  # or malformed JSON) and would cause the caller to skip install entirely.
  if ! ws_output="$(list_workspace_globs)"; then
    return 1
  fi

  shopt -s nullglob
  if [[ -n "$ws_output" ]]; then
    while IFS= read -r workspace_glob; do
      [[ -n "$workspace_glob" ]] || continue
      workspace_globs+=("$workspace_glob")
    done <<< "$ws_output"
  fi
  for workspace_glob in "${workspace_globs[@]}"; do
    [[ -n "$workspace_glob" ]] || continue
    for dir in "$REPO_ROOT"/$workspace_glob; do
      [[ -f "$dir/package.json" ]] || continue
      if [[ ! -e "$dir/node_modules" ]]; then
        eval "$nullglob_state"
        return 1
      fi
    done
  done
  eval "$nullglob_state"
}

FORCE=false
UPDATE_INSTALL=false
IS_MACOS=false

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force)
        FORCE=true
        ;;
      --update)
        UPDATE_INSTALL=true
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        error "Unknown option: $1"
        usage >&2
        exit 1
        ;;
    esac
    shift
  done
}

# Fast path — returns 0 if everything is present and we should exit early.
fast_path_ready() {
  if $FORCE || $UPDATE_INSTALL; then
    return 1
  fi

  local installed_bun_version
  if command -v bun &>/dev/null; then
    installed_bun_version="$(bun --version)"
    [[ "$installed_bun_version" == "$PINNED_BUN_VERSION" ]] || return 1
  else
    return 1
  fi

  command -v gh &>/dev/null || return 1
  command -v gt &>/dev/null || return 1
  has_repo_install_state || return 1
  return 0
}

detect_os() {
  local os
  os="$(uname -s)"
  case "$os" in
    Darwin) IS_MACOS=true ;;
    Linux)  IS_MACOS=false ;;
    *)      error "Unsupported OS: $os"; exit 1 ;;
  esac
}

# -----------------------------------------------------------------------------
# Homebrew (macOS only)
# -----------------------------------------------------------------------------
install_homebrew() {
  if $IS_MACOS && ! has brew; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add Homebrew to PATH for the rest of this script
    if [[ -x /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi

    success "Homebrew installed"
  fi
}

# -----------------------------------------------------------------------------
# Bun
# -----------------------------------------------------------------------------
install_bun() {
  local installed_bun_version=""

  if has bun; then
    installed_bun_version="$(bun --version)"
  fi

  if [[ "$installed_bun_version" == "$PINNED_BUN_VERSION" ]]; then
    success "Bun already installed ($installed_bun_version)"
    return
  fi

  if [[ -n "$installed_bun_version" ]]; then
    info "Updating Bun from $installed_bun_version to $PINNED_BUN_VERSION..."
  else
    info "Installing Bun $PINNED_BUN_VERSION..."
  fi

  curl -fsSL https://bun.sh/install | bash -s -- "bun-v$PINNED_BUN_VERSION"

  # Source the updated profile
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  hash -r

  local resolved_bun_version
  resolved_bun_version="$(bun --version)"

  if [[ "$resolved_bun_version" != "$PINNED_BUN_VERSION" ]]; then
    error "Expected Bun $PINNED_BUN_VERSION but found $resolved_bun_version after install"
    exit 1
  fi

  success "Bun ready ($resolved_bun_version)"
}

# -----------------------------------------------------------------------------
# GitHub CLI (gh)
# -----------------------------------------------------------------------------
install_gh() {
  if has gh; then
    success "GitHub CLI already installed ($(gh --version | head -1))"
  else
    info "Installing GitHub CLI..."
    if $IS_MACOS; then
      brew install gh
    else
      # Linux: use official apt repo
      curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
      sudo apt-get update -qq && sudo apt-get install -y -qq gh
    fi
    success "GitHub CLI installed"
  fi
}

# -----------------------------------------------------------------------------
# Graphite CLI (gt)
# -----------------------------------------------------------------------------
install_graphite() {
  if has gt; then
    success "Graphite CLI already installed ($(gt --version 2>/dev/null || echo 'unknown'))"
  else
    info "Installing Graphite CLI..."
    if $IS_MACOS && has brew; then
      brew install withgraphite/tap/graphite
    else
      bun install -g @withgraphite/graphite-cli
    fi
    success "Graphite CLI installed"
  fi
}

# -----------------------------------------------------------------------------
# Auth checks
# -----------------------------------------------------------------------------
check_auth() {
  echo ""
  info "Checking authentication..."

  # GitHub CLI
  if [[ -n "${GH_TOKEN:-}" ]] || [[ -n "${GITHUB_TOKEN:-}" ]]; then
    success "GitHub CLI token found in environment"
  elif gh auth status &>/dev/null; then
    success "GitHub CLI already authenticated"
  else
    warn "GitHub CLI not authenticated. Run 'gh auth login' or set GH_TOKEN"
  fi

  # Graphite CLI
  if [[ -n "${GT_AUTH_TOKEN:-}" ]]; then
    info "Authenticating Graphite CLI..."
    gt auth --token "$GT_AUTH_TOKEN"
    success "Graphite CLI authenticated"
  elif gt auth status &>/dev/null 2>&1; then
    success "Graphite CLI already authenticated"
  else
    warn "Graphite CLI not authenticated. Run 'gt auth' or set GT_AUTH_TOKEN"
  fi
}

# -----------------------------------------------------------------------------
# Project dependencies
# -----------------------------------------------------------------------------
install_deps() {
  if $UPDATE_INSTALL; then
    info "Refreshing project dependencies with Bun..."
  else
    info "Installing project dependencies with Bun (frozen lockfile)..."
  fi
  (
    cd "$REPO_ROOT"
    if $UPDATE_INSTALL; then
      bun install
    else
      bun install --frozen-lockfile
    fi
  )
  success "Dependencies installed"
}

ensure_project_deps() {
  if ! $FORCE && ! $UPDATE_INSTALL && has_repo_install_state; then
    success "Dependencies already available"
    return
  fi

  if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then
    local git_dir=""
    local common_dir=""

    git_dir="$(git -C "$REPO_ROOT" rev-parse --git-dir)"
    common_dir="$(git -C "$REPO_ROOT" rev-parse --git-common-dir)"

    if [[ "$git_dir" != "$common_dir" ]]; then
      info "Linked worktree detected; installing dependencies locally for this checkout"
    fi
  fi

  install_deps
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
  parse_args "$@"

  if fast_path_ready; then
    exit 0  # All good, nothing to do
  fi

  detect_os

  echo "" >&2
  echo -e "${BLUE}Trails Bootstrap${NC}" >&2
  echo "────────────────────" >&2
  echo "" >&2

  # Prerequisites
  if $IS_MACOS; then
    install_homebrew
  fi

  # Core tools
  install_bun
  install_gh
  install_graphite

  # Auth status
  check_auth

  echo "" >&2

  # Project setup
  ensure_project_deps

  echo "" >&2
  echo -e "${GREEN}Bootstrap complete!${NC}" >&2
  echo "" >&2
  echo "Next steps:" >&2
  echo "  bun run build      # Build all packages" >&2
  echo "  bun run test       # Run tests" >&2
  echo "  bun run check      # Lint + format + typecheck" >&2
  echo "  ./scripts/bootstrap.sh --update   # Refresh dependencies intentionally" >&2
  echo "" >&2
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
