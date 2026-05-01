# TRL-551 Nested Barrel Depth Audit

**Issue:** TRL-551
**Branch:** `trl-551-audit-nested-barrel-depth-before-tightening-repo-local-rule`

## Rule Baseline

`trails-local/no-nested-barrel` currently defaults to `maxDepth: 2`.

Rule behavior:

- `packages/*/src/index.ts` has depth 1 and is allowed.
- `packages/*/src/<dir>/index.ts` has depth 2 and is allowed.
- `packages/*/src/<dir>/<dir>/index.ts` has depth 3 and is flagged.

## Evidence

Command:

```bash
fd '^index\.ts$' packages apps connectors | sort
```

Observed package barrels:

- Depth 1 package barrels exist across most packages.
- Depth 2 package subpath barrels exist in:
  - `packages/config/src/derive/index.ts`
  - `packages/core/src/patterns/index.ts`
  - `packages/core/src/redaction/index.ts`
  - `packages/core/src/store/index.ts`
  - `packages/core/src/trails/index.ts`
  - `packages/store/src/jsonfile/index.ts`
  - `packages/store/src/trails/index.ts`
  - `packages/warden/src/rules/index.ts`
  - `packages/warden/src/trails/index.ts`
- No package barrel deeper than the current `maxDepth: 2` threshold was found.

## Tightening Impact

Changing to `maxDepth: 1` would intentionally flag first-level subpath barrels. That may be a valid future convention, but it is not a zero-violation tightening.

## Decision

Keep `maxDepth: 2` for now. If Trails wants `maxDepth: 1`, schedule it as a deliberate package-shape cleanup with explicit exceptions or migration commits.
