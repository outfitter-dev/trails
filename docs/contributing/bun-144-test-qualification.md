# Bun 1.4.4 test qualification

The Bun 1.4.4 test audit for [TRL-1430](https://linear.app/outfitter/issue/TRL-1430) required no compatibility fixes, snapshot updates, or test policy changes. This record describes the measured scope; it does not enable parallel tests by default.

## Source and scope

Qualification ran on 2026-10-29 against source `bee00cf34392b0d620220fdc23dd59aff1ced744`, with the same lockfile-backed dependency installation and no source edits between runtime scenarios. The runtime builds were `1.4.2+744846f84` and `1.4.4+38afee6c8`.

The canonical root script is `bun run test`, which delegates to Turbo. At this source it selects 33 package test tasks and 19 prerequisite build tasks. Root `scripts/__tests__` files are outside that selection. They were included in the source-pattern audit, but were not run as an additional full matrix.

Package-specific test flags remained intact, including Cloudflare's `--max-concurrency=1` and the library package's `--timeout 30000`. No timeout, assertion, or coverage gate was weakened.

## Serial and parallel qualification

With Bun 1.4.4 first on `PATH`, run:

```bash
bun run test --concurrency=1 --force
bun run test --concurrency=1 --force -- --parallel=2
```

Both commands passed all 33 package test tasks: 7,426 passing tests and two skipped tests, 52 successful Turbo tasks, and zero cached tasks. The serial run took 6m1.764s; the parallel run took 3m54.865s. These are individual local observations, not a performance guarantee.

Turbo's `--concurrency=1` keeps package tasks sequential. Arguments after `--` reach the package commands: all 33 test tasks logged an actual Bun `--parallel=2` invocation. This qualifies two Bun file workers per package; it does not qualify unbounded worker counts or change the repository default.

A separate four-file probe observed two worker PIDs. Each PID ran two files, and every file observed a fresh global before assigning its marker. The probe is isolation evidence and is not included in the 7,426-pass total.

`@ontrails/testing` passed its 239 tests in both runs. Its resource `mock()` factories are framework resource factories; the package does not wrap Bun's mock-reset, spy, or fake-timer APIs.

## Compatibility-pattern audit

The audit covered 1,337 tracked TypeScript, JavaScript, and shell files, including tests, fixtures, generated code, and root scripts. Lexical hits were inspected before being classified.

| Pattern | Disposition |
| --- | --- |
| `resetAllMocks` | No occurrences. |
| `toContain(NaN)` | No occurrences. |
| `writeHeader(` | No occurrences. |
| Recursive `rmdir` | No occurrences. The two `rmdirSync` calls remove empty directories without a recursive option. |
| `import "."` | No occurrences. |
| Bun `$` tags with interpolated globs | No applicable tags. Five lexical matches were regex anchors or comment punctuation. |
| `process.on("warning")` | No occurrences. |

The two directory removals are in `scripts/check-readme-snippets.ts` and `scripts/check-trail-input-type-cost.ts`. No tracked `.snap` files, snapshot matchers, `styleText()` calls, or Temporal uses were found. No snapshot was regenerated.

## Coverage comparison

With each runtime first on `PATH`, run the same canonical selection:

```bash
bun run test --concurrency=1 --force -- --coverage --coverage-reporter=text
```

Use explicit `--coverage` for both versions. Bun 1.4.4's help states that `--coverage-reporter` implies coverage, while 1.4.2's does not. An initial reporter-only 1.4.2 attempt produced no coverage reports and was interrupted; it is excluded from this comparison.

Both coverage runs passed all 52 Turbo tasks, with zero cached tasks and 33 package coverage reports. Bun 1.4.2 took 6m18.136s; Bun 1.4.4 took 6m5.113s. No source or test changes separate these runs.

The percentages changed in both directions. For example, `packages/core/src/activation-provenance.ts` lists the same uncovered lines, 88 and 106, in both reports, while line coverage changes from 97.18% to 96.77%. This demonstrates a runtime accounting difference; the aggregate deltas alone do not establish removed or added test coverage.

Each row below is the package task's own `All files` summary, including imported source. Package reports overlap, so their percentages must not be summed or averaged into a repository-wide coverage figure. Values are percentages; changes are percentage points.

| Package task | Functions: 1.4.2 → 1.4.4 | Δ pp | Lines: 1.4.2 → 1.4.4 | Δ pp |
| --- | --- | --- | --- | --- |
| `@ontrails/adapter-kit` | 19.06 → 19.07 | +0.01 | 29.39 → 31.59 | +2.20 |
| `@ontrails/blob` | 28.54 → 28.32 | -0.22 | 35.78 → 37.64 | +1.86 |
| `@ontrails/cli` | 50.49 → 50.14 | -0.35 | 55.46 → 55.18 | -0.28 |
| `@ontrails/cloudflare` | 55.41 → 55.03 | -0.38 | 56.04 → 56.68 | +0.64 |
| `@ontrails/commander` | 37.42 → 37.28 | -0.14 | 44.12 → 45.12 | +1.00 |
| `@ontrails/config` | 40.43 → 40.43 | +0.00 | 47.91 → 49.45 | +1.54 |
| `@ontrails/core` | 95.98 → 95.89 | -0.09 | 93.67 → 92.88 | -0.79 |
| `@ontrails/drizzle` | 25.10 → 25.13 | +0.03 | 35.30 → 38.03 | +2.73 |
| `@ontrails/hono` | 38.16 → 37.87 | -0.29 | 44.06 → 44.83 | +0.77 |
| `@ontrails/http` | 54.15 → 53.84 | -0.31 | 57.61 → 57.42 | -0.19 |
| `@ontrails/kv` | 27.36 → 27.14 | -0.22 | 34.95 → 36.90 | +1.95 |
| `@ontrails/library` | 31.08 → 31.04 | -0.04 | 45.50 → 47.30 | +1.80 |
| `@ontrails/logtape` | 100.00 → 100.00 | +0.00 | 100.00 → 100.00 | +0.00 |
| `@ontrails/mcp` | 50.04 → 49.65 | -0.39 | 53.87 → 54.08 | +0.21 |
| `@ontrails/observability` | 30.54 → 30.54 | +0.00 | 40.24 → 42.18 | +1.94 |
| `@ontrails/oxlint-plugin` | 96.39 → 96.39 | +0.00 | 94.07 → 93.57 | -0.50 |
| `@ontrails/permits` | 31.57 → 31.42 | -0.15 | 40.80 → 42.62 | +1.82 |
| `@ontrails/pino` | 100.00 → 100.00 | +0.00 | 100.00 → 100.00 | +0.00 |
| `@ontrails/queue` | 28.11 → 27.86 | -0.25 | 35.63 → 37.57 | +1.94 |
| `@ontrails/regrade` | 34.77 → 34.69 | -0.08 | 47.91 → 49.43 | +1.52 |
| `@ontrails/source` | 41.58 → 41.58 | +0.00 | 42.56 → 43.38 | +0.82 |
| `@ontrails/store` | 41.96 → 41.73 | -0.23 | 48.38 → 49.16 | +0.78 |
| `@ontrails/testing` | 57.50 → 57.05 | -0.45 | 59.13 → 59.10 | -0.03 |
| `@ontrails/topography` | 50.35 → 50.23 | -0.12 | 56.34 → 56.81 | +0.47 |
| `@ontrails/trails` | 43.34 → 43.25 | -0.09 | 76.08 → 76.72 | +0.64 |
| `@ontrails/vite` | 27.95 → 27.67 | -0.28 | 36.84 → 38.06 | +1.22 |
| `@ontrails/warden` | 66.56 → 66.49 | -0.07 | 73.94 → 74.58 | +0.64 |
| `junction` | 56.49 → 56.12 | -0.37 | 58.81 → 58.94 | +0.13 |
| `lookout` | 54.69 → 54.40 | -0.29 | 56.94 → 57.58 | +0.64 |
| `packlist` | 50.14 → 49.79 | -0.35 | 54.17 → 54.66 | +0.49 |
| `stash` | 55.62 → 55.21 | -0.41 | 58.54 → 58.88 | +0.34 |
| `switchback` | 50.48 → 50.28 | -0.20 | 57.84 → 58.79 | +0.95 |
| `trails-demo` | 39.81 → 39.70 | -0.11 | 51.65 → 52.79 | +1.14 |

No tracked coverage command, Bun coverage configuration, or numerical threshold was configured at the audited source. The comparison records the existing baseline without introducing or lowering a threshold.

## Distribution disposition

This is contributor documentation only: `release:none`. Package behavior, public contracts, generated artifacts, agent rules, and migration commands did not change. A changeset, Warden rule, Skillset regeneration, Wayfinder dogfood run, lock round-trip, and publish check are not applicable to this documentation change.
