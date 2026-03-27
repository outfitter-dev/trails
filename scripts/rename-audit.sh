#!/usr/bin/env bash
# Audit current usage of names that will be renamed.
# Run this to see scope of changes before applying renames.
# Usage: ./scripts/rename-audit.sh [--docs | --code | --all]

set -euo pipefail

MODE="${1:---all}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

blue="\033[34m"
yellow="\033[33m"
green="\033[32m"
dim="\033[2m"
reset="\033[0m"

section() {
  echo ""
  echo -e "${blue}━━━ $1 ━━━${reset}"
}

count() {
  local pattern="$1"
  local glob="${2:-*.ts}"
  local label="$3"
  local n
  n=$(rg --count-matches "$pattern" --glob "$glob" --glob '!node_modules/**' --glob '!dist/**' --glob '!.scratch/**' 2>/dev/null | awk -F: '{sum += $2} END {print sum+0}')
  if [ "$n" -gt 0 ]; then
    echo -e "  ${yellow}$n${reset} occurrences — $label"
    rg -l "$pattern" --glob "$glob" --glob '!node_modules/**' --glob '!dist/**' --glob '!.scratch/**' 2>/dev/null | sed 's/^/    /'
  else
    echo -e "  ${green}0${reset} occurrences — $label"
  fi
}

# ─── Safe mechanical renames (unique, low false-positive risk) ───

if [ "$MODE" = "--code" ] || [ "$MODE" = "--all" ]; then
  section "SAFE MECHANICAL RENAMES (code)"

  echo -e "\n${dim}trailhead → topo${reset}"
  count 'trailhead' '*.ts' 'trailhead in .ts files'

  echo -e "\n${dim}RouteSpec → HikeSpec${reset}"
  count 'RouteSpec' '*.ts' 'RouteSpec in .ts files'

  echo -e "\n${dim}AnyRoute → AnyHike${reset}"
  count 'AnyRoute' '*.ts' 'AnyRoute in .ts files'

  echo -e "\n${dim}testAllExamples → testExamples${reset}"
  count 'testAllExamples' '*.ts' 'testAllExamples in .ts files'

  echo -e "\n${dim}createTestTrailContext → createTestContext${reset}"
  count 'createTestTrailContext' '*.ts' 'createTestTrailContext in .ts files'

  echo -e "\n${dim}passthroughInput → passthroughResolver${reset}"
  count 'passthroughInput' '*.ts' 'passthroughInput in .ts files'

  echo -e "\n${dim}allRules → wardenRules${reset}"
  count '\ballRules\b' '*.ts' 'allRules in .ts files'

  echo -e "\n${dim}formatReport → formatWardenReport${reset}"
  count '\bformatReport\b' '*.ts' 'formatReport in .ts files'

  echo -e "\n${dim}TestLoggerInstance → TestLogger${reset}"
  count 'TestLoggerInstance' '*.ts' 'TestLoggerInstance in .ts files'

  echo -e "\n${dim}LoggerInstance → (drop, use Logger)${reset}"
  count 'LoggerInstance' '*.ts' 'LoggerInstance in .ts files'

  section "NEEDS MANUAL ATTENTION (code)"

  echo -e "\n${dim}route( → hike( — watch for HTTP route contexts${reset}"
  count "\broute\b" '*.ts' '"route" as a word in .ts files'

  echo -e "\n${dim}Route< → Hike< — generic type usage${reset}"
  count '\bRoute<' '*.ts' 'Route< in .ts files'

  echo -e "\n${dim}derive( → deriveFields( — only the standalone export${reset}"
  count "\bderive\b" '*.ts' '"derive" as a word in .ts files'

  echo -e "\n${dim}App type → Topo — very generic word${reset}"
  count '\bApp\b' '*.ts' '"App" as a word in .ts files'

  echo -e "\n${dim}fromFetch → Result.fromFetch — structural move${reset}"
  count '\bfromFetch\b' '*.ts' 'fromFetch in .ts files'

  echo -e "\n${dim}safeParse → Result.fromJson — name + behavior change${reset}"
  count '\bsafeParse\b' '*.ts' 'safeParse in .ts files'

  echo -e "\n${dim}safeStringify → Result.toJson — name + behavior change${reset}"
  count '\bsafeStringify\b' '*.ts' 'safeStringify in .ts files'

  echo -e "\n${dim}Sink (type) → LogSink — watch for ConsoleSinkOptions etc.${reset}"
  count '\bSink\b' '*.ts' '"Sink" as a word in .ts files'

  echo -e "\n${dim}Formatter (type) → LogFormatter — watch for other Formatter contexts${reset}"
  count '\bFormatter\b' '*.ts' '"Formatter" as a word in .ts files'

  echo -e "\n${dim}testTrail → testScenarios — but not testTrailContext${reset}"
  count '\btestTrail\b' '*.ts' '"testTrail" as a word in .ts files'
fi

if [ "$MODE" = "--docs" ] || [ "$MODE" = "--all" ]; then
  section "DOCUMENTATION RENAMES"

  echo -e "\n${dim}trailhead → topo${reset}"
  count 'trailhead' '*.md' 'trailhead in .md files'

  echo -e "\n${dim}route( or route() → hike${reset}"
  count '\broute\b' '*.md' '"route" in .md files'

  echo -e "\n${dim}Route (type) in docs${reset}"
  count '\bRoute\b' '*.md' '"Route" in .md files'

  echo -e "\n${dim}testAllExamples → testExamples${reset}"
  count 'testAllExamples' '*.md' 'testAllExamples in .md files'

  echo -e "\n${dim}testTrail → testScenarios${reset}"
  count '\btestTrail\b' '*.md' '"testTrail" in .md files'

  echo -e "\n${dim}App (as type) in docs${reset}"
  count '\bApp\b' '*.md' '"App" in .md files'

  echo -e "\n${dim}fromFetch in docs${reset}"
  count 'fromFetch' '*.md' 'fromFetch in .md files'

  echo -e "\n${dim}safeParse / safeStringify in docs${reset}"
  count 'safeParse\|safeStringify' '*.md' 'safeParse/safeStringify in .md files'

  echo -e "\n${dim}scout (as trail/command) in docs${reset}"
  count '\bscout\b' '*.md' '"scout" in .md files'
fi

echo ""
echo -e "${blue}━━━ SUMMARY ━━━${reset}"
echo "Run with --code, --docs, or --all (default)"
echo "Safe renames can be applied with: ./scripts/rename-apply.sh"
echo "Manual renames need per-file review."
