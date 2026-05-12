# Local Review Round 4: Docs/Vocab/Agent Guidance Lane

Date: 2026-05-12
Branch reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`
Lane: Docs, lexicon, retired vocabulary guard, and agent guidance for the M4b/V1 stack tip.

## Result

Clean for P0/P1/P2 in this lane.

Round 3 reported a P2 that the TopoGraph retired-vocabulary guard still excluded active source/test files by whole path. That finding does not reproduce against the live stack tip. The `topograph-artifact-family-retired-term` rule excludes only historical or migration documentation paths, and the active cleanup/migration seams are represented as exact line-level `allowMatches`.

Residuals are P3-only:

- accepted historical ADRs still contain pre-ADR-0046 single-lock wording, which is historical context rather than active guidance drift;
- `.agents/` is not part of the automated vocab audit roots, which is acceptable while this packet and its reports are source artifacts rather than general active guidance.

## Findings

No P0/P1/P2 findings.

## Evidence

The TopoGraph rule's broad exclusions are historical/migration surfaces only:

- `scripts/vocab-cutover-map.ts:129-136`
  - `const topographArtifactFamilyRetiredMentionPaths = [`
  - `'docs/adr/0042-core-topographer-boundary-doctrine.md',`
  - `'docs/adr/0046-lock-v3-artifact-family.md',`
  - `'docs/lexicon.md',`
  - `'docs/migration',`
  - `'docs/releases',`

The active source/test cleanup seams are exact line allowances:

- `scripts/vocab-cutover-map.ts:147-181`
  - `const topographArtifactFamilyRetiredMatches = [`
  - `{ line: 265, path: 'apps/trails/src/trails/dev-support.ts' },`
  - `{ line: 270, path: 'apps/trails/src/trails/dev-support.ts' },`
  - `path: 'packages/topographer/src/internal/topo-snapshots.ts',`
  - `path: 'packages/topographer/src/__tests__/topo-store.test.ts',`

The audit engine treats `excludePaths` as whole-file or directory-prefix skips, and `allowMatches` as line-scoped skips:

- `scripts/vocab-cutover-audit.ts:32-38`
  - `globallyExcludedPaths.has(path) ||`
  - `path === excludedPath || path.startsWith(`${excludedPath}/`)`
- `scripts/vocab-cutover-audit.ts:40-46`
  - `rule.allowMatches?.some(`
  - `(allowed) => allowed.path === match.path && allowed.line === match.line`

The rule uses the line-scoped active seam list:

- `scripts/vocab-cutover-map.ts:329-335`
  - `allowMatches: topographArtifactFamilyRetiredMatches,`
  - `excludePaths: topographArtifactFamilyRetiredMentionPaths,`
  - `id: 'topograph-artifact-family-retired-term',`

Targeted rule output confirms no non-allowed retired terms:

```json
[
  {
    "description": "Retired TopoGraph artifact-family vocabulary still appears outside history, migration notes, and legacy cleanup seams.",
    "fileCount": 0,
    "id": "topograph-artifact-family-retired-term",
    "matches": [],
    "total": 0
  }
]
```

The normal vocab gate also passes:

```text
vocab-cutover audit passed for entire repo target set: no legacy patterns found.
```

## Commands Run

```bash
/usr/bin/git branch --show-current
/usr/bin/git status --short
rg -n "apps/trails/src/trails/dev-support|topo-store.test|topo-snapshots|topographArtifactFamilyRetiredMentionPaths|topographArtifactFamilyRetiredMatches|allowMatches: topograph" scripts/vocab-cutover-map.ts
nl -ba scripts/vocab-cutover-map.ts | sed -n '126,184p'
nl -ba scripts/vocab-cutover-map.ts | sed -n '326,336p'
nl -ba scripts/vocab-cutover-audit.ts | sed -n '28,48p'
bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term --json
bun run vocab:audit
```
