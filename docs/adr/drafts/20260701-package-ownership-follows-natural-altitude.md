---
slug: package-ownership-follows-natural-altitude
title: Package Ownership Follows Natural Altitude
status: draft
created: 2026-07-01
updated: 2026-07-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [1, 9, 41]
---

# ADR: Package Ownership Follows Natural Altitude

## Context

Trails has been cleaning up repeated helper logic across packages. The repeated shape was not the root problem. The root problem was missing ownership.

The useful cases follow one pattern:

- glob and path-scope logic belongs in `@ontrails/core`;
- activation graph facts belong in `@ontrails/topographer`;
- diagnostic base fields belong in `@ontrails/core`;
- app and package code should consume those owners instead of copying the kernel locally.

The tracing cleanup is the live proof. [ADR-0041](../0041-unified-observability.md) already says core owns intrinsic tracing, `@ontrails/observe` owns app-facing sink contracts, and `@ontrails/tracing` remains compatibility plus developer state. The code still carries two forks: signal trace helpers in `packages/tracing/src/signal-trace.ts` and a bounded memory sink in `packages/tracing/src/memory-sink.ts`.

Without a package ownership rule, each cleanup is argued from scratch. Agents can fix the local duplicate while missing the reusable owner. That is how parallel ledgers grow.

## Decision

Each reusable capability has one canonical owner. The owner is the lowest package where the concept is still coherent and reusable. That is the capability's natural altitude.

This means:

- The owner exports the smallest stable contract other packages need.
- Consumers compose the owner contract instead of reimplementing it.
- Higher packages may render, configure, or adapt the owner contract for their domain, but they do not own the kernel.
- If a consumer needs a different behavior, the choice is explicit: add an extension point to the owner, or declare a distinct capability.
- Similarity alone is not debt. The ownership test cares about duplicate authority, not repeated scaffolding.

The review test is:

> Can this package consume an owner-owned contract, or is it quietly re-authoring the same concept?

The committed [Package Ownership Map](../../contributing/package-ownership.md) is the evidence appendix for this ADR. It records owned capabilities, migrations, proposed extractions, and tracked unknowns. The first pass deliberately proposes new extraction issues inline instead of creating them automatically. Issue creation remains a separate approval step.

This ADR stays draft until the tracing migration lands. Acceptance should cite the migration as proof that the doctrine works on real code, not only on paper.

## Consequences

- Contributors get a repeatable test for extraction work.
- Future cleanup can separate true ownership debt from similar-but-valid code.
- Docs, PRs, and review comments can name natural altitude instead of arguing package boundaries ad hoc.
- Warden hardening rules should land after the code is clean enough for the rule to encode a real boundary.
- The ownership map must stay honest about unknowns. A bounded map with tracked unknowns is better than a broad claim that silently under-audits the repo.

## References

- [Package Ownership Map](../../contributing/package-ownership.md)
- [ADR-0001: Naming Conventions](../0001-naming-conventions.md)
- [ADR-0009: First-Class Resources](../0009-first-class-resources.md)
- [ADR-0041: Unified Observability](../0041-unified-observability.md)
