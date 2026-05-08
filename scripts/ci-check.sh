#!/usr/bin/env bash
set -euo pipefail
bun packages/warden/bin/warden.ts --ci --summary "$@"
