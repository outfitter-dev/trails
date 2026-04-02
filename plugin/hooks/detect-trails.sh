#!/usr/bin/env bash
# SessionStart hook: detect if this project uses Trails.
# Exits silently if not a Trails project. Injects context if it is.

set -euo pipefail

# Fast bail: check for @ontrails in package.json
pkg="$CLAUDE_PROJECT_DIR/package.json"
[[ -f "$pkg" ]] && grep -q '@ontrails' "$pkg" || exit 0

msg="This project uses the Trails framework (@ontrails/*). Load the \`trails\` skill before writing trail code."

# Check if trails CLI is available
if ! which trails >/dev/null 2>&1; then
  msg="$msg The \`trails\` CLI is not installed — blaze: bun add -g @ontrails/trails"
fi

echo "$msg"
