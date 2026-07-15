#!/usr/bin/env bash
set -euo pipefail

# Rename script: telemetry package → tracker
# This script documents the mechanical package/content rename that produced the
# current tracker package. It is kept as an audit trail for the cutover, not as
# an actively supported migration utility.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/packages/tracker"

echo "This repository has already been cut over to the tracker package."
echo "Use Regrade and Warden for any follow-up governed cleanup:"
echo ""
echo "  bun apps/trails/bin/trails.ts regrade audit --fail-on-open --root-dir ."
echo "  bun run trails:check"
echo ""
echo "Package root: $PKG"
