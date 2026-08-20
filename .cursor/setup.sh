#!/usr/bin/env bash
#
# setup.sh — Cursor Cloud Agent environment adapter for Trails.
#
# Thin wrapper around the shared repo bootstrap that only adds what the Cursor
# Cloud Agent VM specifically needs. The shared `scripts/bootstrap.sh cursor`
# owns the portable work (install the pinned Bun, install workspace
# dependencies, build the Oxlint plugin). This script then makes `bun` and a
# modern `node` resolvable ahead of the Cloud Agent execution-daemon PATH shims.
#
# Why the shims matter: the agent runtime prepends `/exec-daemon` to PATH, and
# its bundled `node` is older than oxlint's TypeScript-config requirement
# (Node >= 22.18). That older `node` shadows the image's nvm Node and makes
# `oxlint` fail to load `oxlint.config.ts`, which breaks `lint`, `format:check`,
# and `test`. `bun` is also absent from the default agent PATH. Symlinking both
# into `/usr/local/cargo/bin` (writable and ahead of `/exec-daemon` on PATH)
# fixes resolution. This is a Cursor-cloud-VM-specific accommodation, so it
# lives here rather than in the portable, multi-provider shared bootstrap.
#
# Idempotent: safe to run on every install.

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. Portable setup: install Bun + dependencies and build the Oxlint plugin.
./scripts/bootstrap.sh cursor

BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin"

# 2. Expose Bun and a compatible Node ahead of platform PATH shims.
PRIORITY_BIN="/usr/local/cargo/bin"

if [[ ! -d "$PRIORITY_BIN" || ! -w "$PRIORITY_BIN" ]]; then
  echo "setup.sh: priority bin dir '$PRIORITY_BIN' is not writable; cannot install required PATH shims." >&2
  exit 1
fi

link_priority() { # link_priority <target> <link-name>
  local target="$1" name="$2"
  if [[ ! -x "$target" ]]; then
    echo "setup.sh: required executable '$target' is unavailable." >&2
    return 1
  fi
  ln -sf "$target" "$PRIORITY_BIN/$name"
  echo "setup.sh: linked $PRIORITY_BIN/$name -> $target" >&2
}

# Bun (and its bunx alias) are installed under BUN_INSTALL but not on the
# default agent PATH.
link_priority "$BUN_BIN/bun" bun
if [[ -e "$BUN_BIN/bunx" ]]; then
  link_priority "$BUN_BIN/bunx" bunx
else
  link_priority "$BUN_BIN/bun" bunx
fi

# Newest installed nvm Node satisfies oxlint's Node >= 22.18 TS-config loader.
newest_node="$(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
if [[ -z "$newest_node" ]]; then
  echo "setup.sh: no nvm Node found; Node >= 22.18 is required." >&2
  exit 1
fi

if ! "$newest_node" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1)'; then
  echo "setup.sh: newest nvm Node ($("$newest_node" --version 2>/dev/null || echo unknown)) does not satisfy Node >= 22.18." >&2
  exit 1
fi
link_priority "$newest_node" node

# Do not report readiness until the installed shims satisfy the tools' runtime
# contract. This catches missing targets and stale or broken links explicitly.
"$PRIORITY_BIN/bun" --version >/dev/null
"$PRIORITY_BIN/node" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1)'

echo "setup.sh: environment ready (bun $("$PRIORITY_BIN/bun" --version), node $("$PRIORITY_BIN/node" --version))." >&2
