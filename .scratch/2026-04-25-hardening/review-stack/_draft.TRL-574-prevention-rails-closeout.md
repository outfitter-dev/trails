# TRL-574 Prevention Rails Closeout

**Issue:** TRL-574
**Branch:** `trl-574-hardening-use-static-discovery-rails-to-find-repeated-audit`
**Purpose:** Close the prevention-rails parent after advisory, rule, architecture, and backlog translation.

## Stack Artifacts

- TRL-509: advisory skill briefs
- TRL-546: durable prevention-rule follow-ups
- TRL-547: architecture follow-up decisions
- TRL-545: advisory skill issue map
- TRL-536: backlog alignment overview
- TRL-532: duplicate primitive ID scope
- TRL-533: activation-cycle/runtime-depth split
- TRL-535: source vocabulary scope
- TRL-551: nested barrel depth audit
- TRL-552: prefer-bun-api evaluation
- TRL-550: max-file-lines evaluation

## New Backlog Issues

Advisory skills under TRL-545:

- TRL-593: `trails-warden-advisory`
- TRL-594: `trails-dogfood-check`
- TRL-595: `trails-primitive-parity`
- TRL-596: `trails-derive-from-source`
- TRL-597: `trails-error-format`
- TRL-598: `trails-discriminate-union`

Durable Warden rules under TRL-546:

- TRL-599: owner-projection parity guardrail
- TRL-600: public union output discriminants
- TRL-601: public/internal deep imports

## Retired Or Covered Candidates

- Construction/materializer throw-vs-Result ambiguity was addressed by TRL-564 and documented as host-boundary behavior where appropriate.
- Error projection/redaction ownership is covered by TRL-529, TRL-526, TRL-561, and TRL-564.
- Resource lifecycle ambiguity is covered by TRL-558 and TRL-592.
- Filesystem/generated-code safety remains covered by TRL-553, TRL-565, and TRL-576.
- Repo-local hygiene remains in private Oxlint unless it becomes durable Trails correctness.

## Final State

The prevention audit output has been translated into concrete future work or retired with evidence. No additional architecture issue is needed from this closeout pass.
