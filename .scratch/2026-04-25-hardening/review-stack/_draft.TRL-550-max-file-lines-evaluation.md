# TRL-550 Max File Lines Evaluation

**Issue:** TRL-550
**Branch:** `trl-550-evaluate-progressive-max-file-lines-enforcement-for-trails`

## Question

Should Trails add a repo-local `max-file-lines` rule now?

## Evidence

Command:

```bash
fd '\.(ts|tsx|md)$' packages apps connectors docs scripts | xargs wc -l | sort -nr | sed -n '1,40p'
```

Largest source files observed:

- `packages/warden/src/rules/ast.ts`: 3054 lines
- `packages/core/src/__tests__/execute.test.ts`: 2166 lines
- `connectors/drizzle/src/runtime.ts`: 1345 lines
- `packages/warden/src/rules/implementation-returns-result.ts`: 1320 lines
- `packages/core/src/internal/topo-store.ts`: 1213 lines
- `packages/warden/src/rules/no-sync-result-assumption.ts`: 1191 lines
- `scripts/vocab-cutover-rewrite.ts`: 1146 lines
- `packages/warden/src/__tests__/implementation-returns-result.test.ts`: 1143 lines
- `packages/mcp/src/__tests__/build.test.ts`: 1139 lines
- `packages/core/src/__tests__/fire.test.ts`: 1100 lines
- `packages/core/src/execute.ts`: 1059 lines

## Evaluation

A hard threshold now would create a broad refactor queue. The largest files include rule implementations, runtime internals, and test suites where mechanical splitting should be planned carefully.

## Recommendation

Do not add a blocking max-file-lines rule in this closeout stack.

If the repo wants progressive enforcement later:

- Start as advisory/private repo-local hygiene, not Warden doctrine.
- Use a high initial threshold above the current worst offender or a warn-only/report-only mode.
- Exclude or separately plan tests and generated/migration scripts.
- Add deletion triggers for each large-file exception.

## Decision

Treat file length as private hygiene/advisory pressure for now. Do not promote it to public Warden correctness.
