# TRL-365 CI Baseline And Scoped Optimization

Date: 2026-05-16

## Measured Baseline

Source: recent successful `CI` workflow runs on `main`, queried with `gh run view --json jobs`.

| Run | Event | Build | Typecheck | Test | Lint & Format | Governance | Dead Code |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `25859151108` | `push` | 74s | 72s | 76s | 17s | 28s | 8s |
| `25822675749` | `push` | 62s | 73s | 81s | 23s | 24s | 10s |

The long poles are still `Build`, `Typecheck`, and `Test`. The shared setup path runs in every job and accounts for roughly 3-8 seconds per job in these samples, so install/cache work is the lowest-risk optimization that does not change required gates.

## Implemented Change

`./.github/actions/setup` now caches Bun's install cache at `~/.bun/install/cache`, keyed by:

```text
bun-install-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('.bun-version', 'bun.lock') }}
```

This keeps `bun install --frozen-lockfile` as the correctness gate while reducing repeated dependency archive downloads across the fan-out jobs. The cache is scoped by OS, architecture, Bun version file, and lockfile.

## Audited But Not Changed

- `Build` remains a separate required job. Folding it into another job would change the required-check shape and risks weakening release signal.
- `Lint & Format` remains one job with distinct `lint`, `lint:ast-grep`, and `format:check` steps. The commands overlap filesystem traversal, but they enforce different gates and the formatter path also builds the private Oxlint plugin before Ultracite runs.
- Reusable workflows or a matrix would mostly reshape YAML right now; the current shared setup composite already gives one maintenance point for dependency setup.
