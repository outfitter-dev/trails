---
created: "2026-05-01T14:16:21Z"
updated: "2026-05-01T14:16:21Z"
description: "Scoping decision for TRL-489 (source vocabulary enforcement). Source-code identifier enforcement can become Warden work only with precise terms, allowed replacements, tier, and false-positive exceptions. Markdown prose cleanup, ADR historical references, and broad word-sweep rules are excluded from durable Warden scope."
references: []
linear:
  - TRL-535
  - TRL-489
impl_status: implemented
---

# TRL-535 Source Vocabulary Rule Scope

**Issue:** TRL-535
**Target:** TRL-489
**Branch:** `trl-535-align-trl-489-source-vocabulary-rule-scope`

## Scope Decision

Source-code vocabulary enforcement can become Warden work only when terms and diagnostics are precise enough to protect framework correctness.

Markdown prose cleanup should remain editorial or advisory unless a separate docs-lint decision is made.

## Candidate Warden Scope

Good Warden candidates:

- Source identifiers that expose rejected public concepts in package APIs.
- Export names that conflict with the Trails lexicon.
- Framework-owned type/function names that would teach agents the wrong primitive grammar.

Required evidence:

- Exact denied term.
- Exact allowed replacement.
- Source tier and file scope.
- False-positive exceptions.
- Fixture showing accepted and rejected source identifiers.

## Non-Warden Scope

Keep these out of durable Warden until separately justified:

- General prose tone.
- Historical references in ADRs.
- User-facing docs where old wording is explicitly being explained.
- Broad "find every word" sweeps without API or source-contract impact.

## Decision

Align TRL-489 around precise source-code vocabulary enforcement. Treat docs prose as editorial/advisory work, not a default durable Warden rule.
