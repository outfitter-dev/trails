# TRL-546 Prevention Rule Follow-Ups

**Issue:** TRL-546
**Branch:** `trl-546-create-prevention-rule-follow-up-issues-from-prevention`
**Purpose:** Translate surviving deterministic prevention-rule candidates into precise Linear follow-ups.

## Inputs

- `.scratch/2026-04-25-hardening/08-prevention-rails.md`
- `.scratch/2026-04-25-hardening/tmp-audits/08-prevention-rails-reconciliation.md`
- `docs/rule-design.md`
- Warden source-tier foundation from TRL-512 through TRL-514
- Owner-first rewires from TRL-528 and TRL-529

## Created Follow-Ups

### TRL-599: Owner-Projection Parity

Owner data should remain the source of truth for projections. Warden should prevent new parallel tables when a framework owner already exports the relevant facts.

Required issue shape:

- Owner data source: the package/module that owns the source fact.
- Projection target: rule, surface, docs, or runtime mapper that consumes it.
- Diagnostic: identify the shadow copy and the owner export it should consume.
- False-positive risk: intentional policy deny lists may remain local to a rule when they are not duplicated framework data.
- Tests: one fixture with a compliant owner-derived projection and one fixture with a shadow table.

### TRL-600: Public Union Output Discriminants

Public/queryable outputs consumed by agents should expose stable branch discriminants rather than requiring callers to infer shape from optional fields.

Required issue shape:

- Owner data source: the public schema or trail output.
- Warden tier: source-tier for schema definitions or project-tier if topo output metadata is needed.
- Diagnostic: name the union-like output and the missing/unstable discriminant.
- False-positive risk: private implementation unions and internal helper types should not be flagged.
- Tests: one public output with `kind`/`mode`/`type`, and one ambiguous public output.

### TRL-601: Public/Internal Deep Imports

Public framework packages should not depend on internal subpaths except for explicitly allowed migration seams.

Required issue shape:

- Owner data source: package `exports` maps and documented public entrypoints.
- Warden tier: source-tier import scan, with project-tier package metadata if needed.
- Diagnostic: importer, internal target, and preferred public entrypoint.
- False-positive risk: package-local private imports and explicitly allowed migration seams.
- Tests: one compliant public import, one prohibited public-to-internal import, and one package-local internal import.

## Covered Or Retired Candidates

- Error projection ownership is covered by TRL-529, TRL-526, TRL-561, and TRL-564 host-boundary documentation.
- Resource lifecycle posture is covered by TRL-558 and TRL-592.
- Filesystem/generated-code safety is covered by TRL-553, TRL-565, and TRL-576.
- Lexicon/prose cleanup should remain editorial unless TRL-535/TRL-489 defines precise source-code diagnostics.
- Repo-local hygiene remains in `@ontrails/oxlint-plugin` unless it encodes durable Trails correctness.

## Decision

Create the three durable Warden follow-ups above. Do not file duplicates for covered lanes.
