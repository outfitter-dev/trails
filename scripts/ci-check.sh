#!/usr/bin/env bash
set -euo pipefail
bun apps/ci/bin/ci.ts --format summary "$@"
