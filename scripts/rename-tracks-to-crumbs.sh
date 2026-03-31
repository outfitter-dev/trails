#!/usr/bin/env bash
set -euo pipefail

# Rename script: tracks → crumbs
# This script handles the mechanical rename of the tracks system to crumbs.
# It is NOT .gitignored — it serves as an audit trail for the rename.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/packages/crumbs"

echo "=== Phase 1: Rename source files ==="

# Source files
for old in \
  "$PKG/src/tracks-accessor.ts" \
  "$PKG/src/tracks-api.ts" \
  "$PKG/src/tracks-layer.ts" \
  "$PKG/src/tracks-service.ts"; do
  new="${old//tracks-/crumbs-}"
  echo "  mv $(basename "$old") → $(basename "$new")"
  mv "$old" "$new"
done

# Trail files
for old in \
  "$PKG/src/trails/tracks-status.ts" \
  "$PKG/src/trails/tracks-query.ts"; do
  new="${old//tracks-/crumbs-}"
  echo "  mv $(basename "$old") → $(basename "$new")"
  mv "$old" "$new"
done

# Test files
for old in \
  "$PKG/src/__tests__/tracks-api.test.ts" \
  "$PKG/src/__tests__/tracks-layer.test.ts" \
  "$PKG/src/__tests__/tracks-service.test.ts" \
  "$PKG/src/__tests__/tracks-status.test.ts" \
  "$PKG/src/__tests__/tracks-query.test.ts"; do
  new="${old//tracks-/crumbs-}"
  echo "  mv $(basename "$old") → $(basename "$new")"
  mv "$old" "$new"
done

echo ""
echo "=== Phase 2: Content replacements in packages/crumbs/ ==="

# Precise replacements in source/test files (order matters — longer patterns first)
# These are all within packages/crumbs/src/ to avoid false positives elsewhere.

find "$PKG/src" -name '*.ts' -print0 | xargs -0 sed -i '' \
  -e 's/TracksApiWithState/CrumbsApiWithState/g' \
  -e 's/TracksLayerOptions/CrumbsLayerOptions/g' \
  -e 's/createTracksLayer/createCrumbsLayer/g' \
  -e 's/createTracksApi/createCrumbsApi/g' \
  -e 's/TracksState/CrumbsState/g' \
  -e 's/TracksApi/CrumbsApi/g' \
  -e 's/tracksService/crumbsService/g' \
  -e 's/tracksStatus/crumbsStatus/g' \
  -e 's/tracksQuery/crumbsQuery/g' \
  -e 's/tracksApi/crumbsApi/g' \
  -e 's/TrackSinkLike/CrumbSinkLike/g' \
  -e 's/TrackSink/CrumbSink/g' \
  -e 's/TrackRecord/Crumb/g' \
  -e 's/TrackRow/CrumbRow/g' \
  -e "s/TRACKS_API_KEY/CRUMBS_API_KEY/g" \
  -e "s/'__tracks_api'/'__crumbs_api'/g" \
  -e "s/'__tracks_trace'/'__crumbs_trace'/g" \
  -e "s/registerTracksState/registerCrumbsState/g" \
  -e "s/getTracksState/getCrumbsState/g" \
  -e "s/clearTracksState/clearCrumbsState/g" \
  -e "s/registerTrackStore/registerCrumbStore/g" \
  -e "s/getTrackStore/getCrumbStore/g" \
  -e "s/clearTrackStore/clearCrumbStore/g" \
  -e "s/tracksQueryOutput/crumbsQueryOutput/g" \
  -e "s/tracksStatusOutput/crumbsStatusOutput/g"

# Fix import paths (file references within the package)
find "$PKG/src" -name '*.ts' -print0 | xargs -0 sed -i '' \
  -e "s|'./tracks-layer.js'|'./crumbs-layer.js'|g" \
  -e "s|'./tracks-api.js'|'./crumbs-api.js'|g" \
  -e "s|'./tracks-accessor.js'|'./crumbs-accessor.js'|g" \
  -e "s|'./tracks-service.js'|'./crumbs-service.js'|g" \
  -e "s|'../tracks-layer.js'|'../crumbs-layer.js'|g" \
  -e "s|'../tracks-api.js'|'../crumbs-api.js'|g" \
  -e "s|'../tracks-service.js'|'../crumbs-service.js'|g" \
  -e "s|'../trails/tracks-status.js'|'../trails/crumbs-status.js'|g" \
  -e "s|'../trails/tracks-query.js'|'../trails/crumbs-query.js'|g"

# Trail IDs and service IDs (string literals)
find "$PKG/src" -name '*.ts' -print0 | xargs -0 sed -i '' \
  -e "s/'tracks\.query'/'crumbs.query'/g" \
  -e "s/'tracks\.status'/'crumbs.status'/g" \
  -e "s/service<CrumbsState>('tracks'/service<CrumbsState>('crumbs'/g"

# Layer name
find "$PKG/src" -name '*.ts' -print0 | xargs -0 sed -i '' \
  -e "s/name: 'tracks'/name: 'crumbs'/g"

# TSDoc and comments — targeted patterns only
find "$PKG/src" -name '*.ts' -print0 | xargs -0 sed -i '' \
  -e 's/the tracks layer/the crumbs layer/g' \
  -e 's/the tracks telemetry/the crumbs telemetry/g' \
  -e 's/the tracks dev store/the crumbs dev store/g' \
  -e 's/the tracks system/the crumbs system/g' \
  -e "s/tracks gracefully/crumbs gracefully/g" \
  -e "s/Check tracks status/Check crumbs status/g" \
  -e "s/the tracks table/the crumbs table/g" \
  -e "s/tracks\.query trail/crumbs.query trail/g"

# SQLite table and index names
find "$PKG/src" -name '*.ts' -print0 | xargs -0 sed -i '' \
  -e 's/CREATE TABLE IF NOT EXISTS tracks/CREATE TABLE IF NOT EXISTS crumbs/g' \
  -e 's/idx_tracks_/idx_crumbs_/g' \
  -e "s/ ON tracks(/ ON crumbs(/g" \
  -e "s/FROM tracks/FROM crumbs/g" \
  -e "s/INTO tracks/INTO crumbs/g" \
  -e "s/SELECT \* FROM tracks/SELECT * FROM crumbs/g"

# DB file paths in code and tests
find "$PKG/src" -name '*.ts' -print0 | xargs -0 sed -i '' \
  -e "s|tracks\.db|crumbs.db|g" \
  -e "s|tracks-query-|crumbs-query-|g"

# Test describe blocks and extension keys
find "$PKG/src" -name '*.ts' -print0 | xargs -0 sed -i '' \
  -e "s/describe('tracks\./describe('crumbs./g" \
  -e "s/extensions: { tracks:/extensions: { crumbs:/g" \
  -e "s/test-tracks/test-crumbs/g"

echo "  Done with packages/crumbs/src/"

echo ""
echo "=== Phase 3: Content replacements in docs/ ==="

# ADR-013 — the tracks ADR itself
if [ -f "$ROOT/docs/adr/013-tracks.md" ]; then
  sed -i '' \
    -e 's/# ADR-013: Tracks/# ADR-013: Crumbs/g' \
    -e 's/`tracksLayer`/`crumbsLayer`/g' \
    -e 's/`tracksService`/`crumbsService`/g' \
    -e 's/`tracks` service/`crumbs` service/g' \
    -e 's/`TrackRecord`/`Crumb`/g' \
    -e "s|@ontrails/tracks/otel|@ontrails/crumbs/otel|g" \
    -e "s|@ontrails/tracks|@ontrails/crumbs|g" \
    -e 's/tracks\.from(ctx)/crumbs.from(ctx)/g' \
    -e "s/\`trails tracks\`/\`trails crumbs\`/g" \
    -e 's/trails tracks /trails crumbs /g' \
    -e "s|\.trails/dev/tracks\.db|.trails/dev/crumbs.db|g" \
    -e "s/createTracksLayer/createCrumbsLayer/g" \
    -e "s/createMemorySink/createMemorySink/g" \
    -e 's/TrackScope/CrumbScope/g' \
    -e 's/"Tracks" is the reserved/"Crumbs" is the reserved/g' \
    -e 's/Development tracks write/Development crumbs write/g' \
    -e 's/Tracks records/Crumbs records/g' \
    -e 's/from tracks\. But tracks itself/from crumbs. But crumbs itself/g' \
    -e 's/it reads from tracks/it reads from crumbs/g' \
    "$ROOT/docs/adr/013-tracks.md"
  echo "  Updated docs/adr/013-tracks.md"
fi

# ADR index
if [ -f "$ROOT/docs/adr/README.md" ]; then
  sed -i '' \
    -e 's/| Tracks |/| Crumbs |/g' \
    "$ROOT/docs/adr/README.md"
  echo "  Updated docs/adr/README.md"
fi

# ADR-010 infrastructure services pattern
if [ -f "$ROOT/docs/adr/010-infrastructure-services-pattern.md" ]; then
  sed -i '' \
    -e 's/\*\*Tracks\*\*/\*\*Crumbs\*\*/g' \
    -e 's/`tracksService`/`crumbsService`/g' \
    -e 's/`tracksLayer`/`crumbsLayer`/g' \
    -e 's/`tracks\.status`/`crumbs.status`/g' \
    -e 's/| Tracks example/| Crumbs example/g' \
    -e 's/from permits, which will wire differently from tracks/from permits, which will wire differently from crumbs/g' \
    -e 's/Tracks observes everything/Crumbs observes everything/g' \
    -e 's/config → permits → tracks/config → permits → crumbs/g' \
    -e 's/Tracks records/Crumbs records/g' \
    -e 's/permits and tracks depend/permits and crumbs depend/g' \
    -e 's/permits and tracks might/permits and crumbs might/g' \
    -e 's/\*\*Tracks locks after/\*\*Crumbs locks after/g' \
    -e "s/Tracks observing/Crumbs observing/g" \
    "$ROOT/docs/adr/010-infrastructure-services-pattern.md"
  echo "  Updated docs/adr/010-infrastructure-services-pattern.md"
fi

# ADR-011 config resolution
if [ -f "$ROOT/docs/adr/011-config-resolution.md" ]; then
  sed -i '' \
    -e 's/\*\*Tracks\*\*/\*\*Crumbs\*\*/g' \
    -e 's/Tracks need sampling/Crumbs need sampling/g' \
    -e 's/ADR-013: Tracks/ADR-013: Crumbs/g' \
    -e "s/tracks consume config/crumbs consume config/g" \
    "$ROOT/docs/adr/011-config-resolution.md"
  echo "  Updated docs/adr/011-config-resolution.md"
fi

# ADR-009 services
if [ -f "$ROOT/docs/adr/009-services.md" ]; then
  sed -i '' \
    -e 's/tracks will add `TrackScope`/crumbs will add `CrumbScope`/g' \
    "$ROOT/docs/adr/009-services.md"
  echo "  Updated docs/adr/009-services.md"
fi

# vocabulary.md
if [ -f "$ROOT/docs/vocabulary.md" ]; then
  sed -i '' \
    -e "s/### \`tracks\`/### \`crumbs\`/g" \
    -e 's/The tracks layer captures/The crumbs layer captures/g' \
    -e "s/createTracksLayer/createCrumbsLayer/g" \
    -e "s|@ontrails/tracks|@ontrails/crumbs|g" \
    -e "s/\`tracks\` -- telemetry/\`crumbs\` -- telemetry/g" \
    "$ROOT/docs/vocabulary.md"
  echo "  Updated docs/vocabulary.md"
fi

# horizons.md
if [ -f "$ROOT/docs/horizons.md" ]; then
  sed -i '' \
    -e "s/\*\*Tracks (\`@ontrails\/tracks\`)\.\*\*/\*\*Crumbs (\`@ontrails\/crumbs\`)\.\*\*/g" \
    -e "s/createTracksLayer/createCrumbsLayer/g" \
    -e "s/The tracks system already/The crumbs system already/g" \
    -e "s/The framework tracks progression/The framework crumbs progression/g" \
    "$ROOT/docs/horizons.md"
  echo "  Updated docs/horizons.md"
fi

# architecture.md
if [ -f "$ROOT/docs/architecture.md" ]; then
  sed -i '' \
    -e "s/Tracks (tracks)/Crumbs (crumbs)/g" \
    -e "s/telemetry tracks/telemetry crumbs/g" \
    -e "s|@ontrails/tracks|@ontrails/crumbs|g" \
    -e "s/The tracks (\`@ontrails\/crumbs\`)/The crumbs (\`@ontrails\/crumbs\`)/g" \
    "$ROOT/docs/architecture.md"
  echo "  Updated docs/architecture.md"
fi

# testing.md
if [ -f "$ROOT/docs/testing.md" ]; then
  sed -i '' \
    -e "s/and tracks packages/and crumbs packages/g" \
    -e "s/\*\*Tracks memory sink\.\*\*/\*\*Crumbs memory sink\.\*\*/g" \
    -e "s/track records/crumb records/g" \
    -e "s/createTracksLayer/createCrumbsLayer/g" \
    -e "s|@ontrails/tracks|@ontrails/crumbs|g" \
    "$ROOT/docs/testing.md"
  echo "  Updated docs/testing.md"
fi

# why-trails.md
if [ -f "$ROOT/docs/why-trails.md" ]; then
  sed -i '' \
    -e "s/the tracks system/the crumbs system/g" \
    "$ROOT/docs/why-trails.md"
  echo "  Updated docs/why-trails.md"
fi

# index.md
if [ -f "$ROOT/docs/index.md" ]; then
  sed -i '' \
    -e "s/permits, mounts, tracks/permits, mounts, crumbs/g" \
    "$ROOT/docs/index.md"
  echo "  Updated docs/index.md"
fi

echo ""
echo "=== Phase 4: Plugin skill references ==="

if [ -f "$ROOT/plugin/skills/trails/references/architecture.md" ]; then
  sed -i '' \
    -e "s/Tracks (tracks)/Crumbs (crumbs)/g" \
    -e "s|@ontrails/tracks|@ontrails/crumbs|g" \
    "$ROOT/plugin/skills/trails/references/architecture.md"
  echo "  Updated plugin architecture reference"
fi

echo ""
echo "=== Phase 5: Agent planning docs ==="

# Update any .agents/ references
find "$ROOT/.agents" -name '*.md' -print0 2>/dev/null | xargs -0 sed -i '' \
  -e "s|@ontrails/tracks|@ontrails/crumbs|g" \
  -e "s/\`trails tracks\`/\`trails crumbs\`/g" \
  -e 's/trails tracks /trails crumbs /g' \
  -e "s/\`tracksService\`/\`crumbsService\`/g" \
  -e "s/\`tracksLayer\`/\`crumbsLayer\`/g" \
  -e "s/\`tracks\.status\`/\`crumbs.status\`/g" \
  -e "s/\`TrackRecord\`/\`Crumb\`/g" \
  2>/dev/null || true
echo "  Updated .agents/ docs"

echo ""
echo "=== Done ==="
echo ""
echo "Remaining manual steps:"
echo "  1. Run: bun install (to update lockfile)"
echo "  2. Run: bun run check"
echo "  3. Review the horizons.md 'tracks progression' line — may need manual rewording"
echo "  4. Rename docs/adr/013-tracks.md → 013-crumbs.md if desired"
