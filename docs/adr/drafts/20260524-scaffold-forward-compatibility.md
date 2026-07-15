---
slug: scaffold-forward-compatibility
title: Scaffold Forward Compatibility
status: draft
created: 2026-05-24
updated: 2026-05-24
owners: ['[galligan](https://github.com/galligan)']
depends_on: [10, 47, 48]
description: "Decides that generated apps pin `@ontrails/*` dependencies to the exact scaffolding tool version, and generated apps include `.trails/scaffold.json` as a minimal provenance breadcrumb for future upgrade tooling."
references:
  - docs/adr/0010-native-infrastructure.md
  - docs/adr/0047-stable-release-line-discipline.md
  - docs/adr/0048-trail-versioning-v3.md
  - apps/trails/src/trails/create-scaffold.ts
  - docs/releases/stable-cutover.md
  - docs/releases/beta-channel-policy.md
linear: []
impl_status: partial
---

# ADR: Scaffold Forward Compatibility

## Context

`trails create` gives a new app its first authored project shape. That shape is not just example code: it chooses package ranges, scripts, local `.trails/` policy, test wiring, and the first agent guidance a developer sees.

During the beta line, this creates two related problems:

- A generated app that uses floating prerelease ranges can silently install a
  newer beta than the one that generated it.
- Once scaffolded code is owned by the app, future tooling needs a small clue
  about where that owned source began.

ADR-0047 already says fresh generated apps are a release gate. ADR-0048 says trail versioning is trail-only: it preserves capability contracts inside a topo, not project templates or package distribution. Scaffold forward compatibility therefore needs its own lightweight project-level posture.

## Decision

### Generated `@ontrails/*` dependencies are exact pins

Generated apps pin public `@ontrails/*` dependencies and devDependencies to the exact `@ontrails/trails` package version that produced the scaffold.

During the beta line, exact pins are safer than caret prerelease ranges because they make generated output reproducible. During stable cutover, exact pins make the release PR's generated-app inspection concrete: the scaffold names the intended stable package family exactly, and the post-publish smoke proves those packages exist.

This rule covers Trails-owned packages only. Third-party packages continue to use the curated ranges captured by the internal scaffold-version helper.

### Scaffolds stamp a minimal provenance breadcrumb

Every generated app includes `.trails/scaffold.json`:

```json
{
  "schemaVersion": 1,
  "scaffoldVersion": "1.0.0-beta.18",
  "template": "hello",
  "generatedAt": "2026-05-24T19:34:00.000Z"
}
```

The breadcrumb is informational in the current beta line. It records only the minimum facts future tooling needs before it can decide whether a project came from a known scaffold shape:

- `schemaVersion` names the breadcrumb schema.
- `scaffoldVersion` names the `@ontrails/trails` package that created the
  generated app.
- `template` names the starter selected by `trails create`.
- `generatedAt` records when the project was generated.

The file lives under `.trails/` because it is framework-owned project metadata, but it is not part of `.trails/trails.lock`, `.trails/topo.lock`, or the topo store. It does not describe the app's current resolved graph.

### Version-bump tooling keeps the scaffold synchronized

The internal `scaffold-versions` helper remains the operator path for keeping generated scaffold dependency versions current. Its check mode validates two things together:

- generated third-party scaffold versions match the root catalog/devDependency
  source of truth;
- generated `@ontrails/*` pins match `@ontrails/trails` exactly.

After `bun run version:packages`, release operators run `bun run scaffold-versions:sync` so the generated scaffold package story moves with the package version calculation instead of becoming hand-edit debt.

### Upgrade tooling is deferred

This ADR does not introduce any public upgrade command or migration system.

Deferred work includes:

- reading `.trails/scaffold.json`;
- diffing current source against a scaffold baseline;
- applying generated migrations;
- template hashes or full source manifests;
- a public `trails upgrade` command;
- package or registry mutation.

Those features may follow once there are real scaffold-to-scaffold migrations to design around. The breadcrumb is the seed, not the upgrade system.

## Consequences

- Freshly generated apps are more reproducible during beta and stable release
  work.
- Release operators have one internal check/sync path for both third-party
  scaffold dependency versions and exact Trails package pins.
- Future migration tooling has a small, stable starting point without requiring
  a large manifest today.
- Existing generated apps do not receive retroactive provenance unless a future
  migration tool chooses to add it.

## Non-Goals

- This is not trail versioning, and it does not amend ADR-0048's trail-only
  versioning doctrine.
- This is not lockfile or TopoGraph metadata.
- This does not make generated source framework-owned after scaffolding. The
  app owns its source files.
- This does not define package publication or dist-tag policy beyond the exact
  pins emitted by the scaffolder.

## References

- [ADR-0010: Trails-Native Infrastructure](../0010-native-infrastructure.md)
- [ADR-0047: Stable Release Line Discipline](../0047-stable-release-line-discipline.md)
- [ADR-0048: Trail Versioning v3](../0048-trail-versioning-v3.md)
- [`trails create` scaffold implementation](../../../apps/trails/src/trails/create-scaffold.ts)
- [Stable Cutover Runbook](../../releases/stable-cutover.md)
- [Beta Channel Policy](../../releases/beta-channel-policy.md)
