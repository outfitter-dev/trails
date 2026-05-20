# Local Review Round 1: Doctrine / CLI

Date: 2026-05-19
Stack tip reviewed: `trl-116-run-examples-and-testall-across-live-version-entries`

## Scope

- Trail-only versioning doctrine.
- Current top-level contract semantics.
- Revision/fork vocabulary.
- Pure `transpose:` wording.
- Projected `marker:` and graph-only `kind`.
- Blaze language from PR #530.

## Findings

No unresolved P0/P1/P2 doctrine findings remain.

The initial docs/CLI pass found stale command names in accepted ADR snippets and bundled agent guidance. Those were fixed on `TRL-729`; see `local-review-round-1-docs-cli.md`.

## Clean Checks

- ADR-0048 is accepted and ADR-0044 is marked superseded.
- ADR-0016 points forward from draft `mark()` vocabulary to projected `marker:` identities and later `trails revise` / `trails deprecate` work.
- The lexicon and language styleguide use `version`, `versions`, `revision`, `fork`, `transpose`, `marker`, `@N`, and `(trail, version)` in the ADR-0048 shape.
- Retired forms such as `.v*.ts`, `version.current`, `adapt:`, `version.markers`, `trails version`, and sunset-style commands appear only as historical or explicitly negative guidance.
- Blaze wording preserves the PR #530 grammar: a `blaze` establishes how a trail runs; surfaces and composition do not call blazes directly.

## Result

Round 1 doctrine review is P3-only. The only accepted residual is the ADR-0048 ADR-0008 reference link noted in the docs/CLI report.
