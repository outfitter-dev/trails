---
created: "2026-08-06T21:00:00Z"
updated: "2026-08-07T13:41:37Z"
description: Durable completion contract for migrating Trails agent generation to standalone Skillset.
linear:
  - TRL-1271
  - TRL-1272
  - TRL-1273
  - TRL-1274
  - TRL-1275
impl_status: in_progress
references:
  - PLAN.md
  - RETRO.md
  - REFS.md
---

# Trails to standalone Skillset

## Objective

Bring TRL-1271 through TRL-1275 to a ready-for-approval Graphite topology by proving parity, adopting canonical Skillset source and lock provenance, cutting generation and drift-check ownership over to standalone Skillset, and consolidating plugin and Warden projections where published capability is proven.

## Completion horizon

Ready for approval means every required migration PR is non-draft, locally reviewed, freshly green in PR-triggered CI, mergeable, free of unresolved human or review-bot threads, and has no open P0-P2 findings. P3 findings must be fixed or explicitly accepted with evidence.

Ready does not mean merged. This goal does not authorize merge, queue, release, npm or plugin publication, deployment, global Skillset activation, HOME-installed output mutation, ancestor rewriting, or destructive cleanup.

## Baseline and topology

The authorized baseline is the live head of `docs/agents/process-capture` ([#991](https://github.com/outfitter-dev/trails/pull/991)), assuming #991 lands. Execution reverified that head as `76e4711b627867d5e23056a2976cd17f18b45d58` on 2026-08-06.

```text
docs/agents/process-capture (#991)
└── TRL-1271 parity proof
    └── TRL-1272 canonical Skillset source and lock
        └── TRL-1273 standalone CLI cutover
            ├── TRL-1274 plugin projection consolidation
            └── TRL-1275 Warden guidance projection
```

TRL-1274 and TRL-1275 are siblings. PRs #990 and #991 remain immutable code, branch, metadata, draft-state, and topology ancestors. The 2026-08-07 authority amendment permits only rerunning their existing cancelled CI workflows after the GitHub Actions outage.

SET-396 and SET-394 are upstream Skillset work, not Trails stack branches. They may proceed in dependency-honest Skillset branches and draft PRs. Their merge and publication remain separate approval gates; Trails may update its exact pin only after a published release exists.

## Authority amendment — 2026-08-07

Matt authorized:

- returning Trails #992 to draft and retriggering its PR CI;
- rerunning the existing cancelled CI workflows for #990 and #991 without changing their branches, commits, metadata, draft state, or Graphite topology;
- working in the Skillset repository on SET-396 and SET-394 through dependency-honest branches, focused commits, checks, reviews, and draft PRs;
- updating Trails to the exact published Skillset release once the required capabilities exist.

Still not authorized: merge, queue, Skillset or Trails publication, release, deployment, global activation, HOME-installed output mutation, ancestor editing/restacking, or destructive cleanup. Stop at reviewed draft Skillset PRs and request separate merge/publication authority.

## Done means

- The exact npm `latest` is reverified before every pin change.
- TRL-1271 hermetically proves the accepted #991 output contract.
- SET-396 and SET-394 have reviewed Skillset draft PRs with current CI and no unresolved P0-P2 findings; their eventual published release is separately approved and verified before the Trails pin moves.
- TRL-1272 commits one canonical Skillset source, deterministic managed output, deliberate Clark/Lewis agents, and lock provenance.
- TRL-1273 makes standalone Skillset the only owner of skill lowering and drift checks and removes the accepted legacy oracle.
- TRL-1274 proceeds only after a published Skillset release fixes SET-394; no Trails-local mode workaround is allowed.
- TRL-1275 preserves `live Warden manifest -> Trails derivation -> explicit Skillset source seam -> provider projections` and gives each artifact exactly one command owner.
- Documentation, governance, generated artifacts, migration guidance, and release intent match the implementation.
- Linear, Graphite, GitHub, CI, and review state match reality.
- No forbidden action occurred.

## Verification contract

Focused tests precede the applicable repository gates:

```bash
bun run skillset:check
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run build
bun run format:check
bun run check
git diff --check
```

Run applicable Warden, changeset, publication, Wayfinder dogfood, and lock-roundtrip checks, or record a concrete not-applicable reason. Local green does not replace fresh PR-triggered CI.

## Stop rules

Stop and record exact evidence if a Skillset gap would require a Trails-local compiler seam, a required branch is captive, unrelated dirt cannot be preserved, a public contract or doctrine must change outside the issues, unrelated verification remains broken after a focused retry, or secrets/global/provider/irreversible state would be required.
