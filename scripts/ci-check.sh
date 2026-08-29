#!/usr/bin/env bash
set -euo pipefail
bun apps/trails/bin/trails.ts warden --ci --summary "$@"
