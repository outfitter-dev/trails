# @ontrails/oxlint-plugin

Private repo-local Oxlint plugin for the Trails monorepo.

This package is not public Trails correctness doctrine. Use it for temporary
hardening cleanup rules and durable preferences that apply to this repository
but should not be inherited by Trails consumers.

Use Warden instead when a rule enforces Trails semantics, public framework
correctness, topology, owner-first authority, or consumer-facing doctrine.

Rules are authored in `src/` as TypeScript and built to `dist/` before Oxlint
loads the plugin. Repo lint and format scripts run that build first.

Initial rules cover low-blast repo hygiene:

- `no-console-in-packages`
- `no-process-exit-in-packages`
- `no-process-env-in-packages`
- `no-deep-relative-import`
- `no-nested-barrel`
- `prefer-bun-api`
- `snapshot-location`
- `test-file-naming`

These rules may carry Trails-specific carve-outs in `oxlint.config.ts`. Keep
semantic framework correctness in Warden.

Temporary audit rules use a `temp-*` prefix and must name the issue or state
that deletes them. During discovery, they may run from the root config at
warning severity so follow-up branches can burn down findings while CI stays
green. Promote a temporary rule to error only after its findings are fixed,
intentionally baselined, or rehomed as durable Warden coverage.
