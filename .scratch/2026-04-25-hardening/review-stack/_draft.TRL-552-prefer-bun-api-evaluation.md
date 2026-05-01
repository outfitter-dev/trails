# TRL-552 Prefer Bun API Evaluation

**Issue:** TRL-552
**Branch:** `trl-552-evaluate-expanded-prefer-bun-api-mappings-for-repo-local`

## Rule Baseline

`trails-local/prefer-bun-api` currently maps:

- `better-sqlite3` -> `bun:sqlite`
- `glob` -> `Bun.Glob`
- `semver` -> `Bun.semver`
- `uuid` -> `Bun.randomUUIDv7()`

The rule ignores type-only imports and allows custom mapping overrides.

## Evidence

Command:

```bash
rg -n "from ['\"](better-sqlite3|glob|semver|uuid|node:crypto|fs-extra|rimraf)|import .* from ['\"](better-sqlite3|glob|semver|uuid|node:crypto|fs-extra|rimraf)" packages apps connectors scripts docs -g '!node_modules'
```

Result: no production imports were found for the currently mapped packages or the sampled expansion candidates.

## Expansion Candidates

Do not add blanket mappings yet for:

- `node:crypto`: Bun alternatives depend on API shape and security semantics.
- `fs-extra`: replacements vary by operation and should not be suggested as one mapping.
- `rimraf`: may be replaceable by `rm(..., { recursive: true })`, but needs call-site context rather than import-source replacement.

## Decision

Keep the current mapping narrow. Expand only when a live import pattern appears and the replacement is safe enough for automated agent guidance.
