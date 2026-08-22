---
slug: scaffold-forward-compatibility
title: Scaffold Forward Compatibility
status: draft
created: 2026-05-24
updated: 2026-08-22
owners: ['[galligan](https://github.com/galligan)']
depends_on: [10, 47, 48, 52, 54]
description: "Decides that generated apps pin `@ontrails/*` dependencies to the exact scaffolding tool version and author deterministic scaffold provenance through the lock's generic overlay mechanism."
references:
  - docs/adr/0010-native-infrastructure.md
  - docs/adr/0047-stable-release-line-discipline.md
  - docs/adr/0048-trail-versioning-v3.md
  - docs/adr/0052-overlays-one-extension-mechanism.md
  - docs/adr/0054-project-substrate-names-its-truth.md
  - apps/trails/src/trails/create-scaffold.ts
  - docs/releases/stable-cutover.md
  - docs/releases/beta-channel-policy.md
linear: []
impl_status: partial
---

# ADR: Scaffold Forward Compatibility

## Context

`trails create` gives a new app its first authored project shape. That shape is not just example code: it chooses package ranges, scripts, app identity, artifact ownership, test wiring, and the first agent guidance a developer sees.

During the beta line, this creates two related problems:

- A generated app that uses floating prerelease ranges can silently install a newer beta than the one that generated it.
- Once scaffolded code is owned by the app, future tooling needs a small clue about where that owned source began.

ADR-0047 already says fresh generated apps are a release gate. ADR-0048 says trail versioning is trail-only: it preserves capability contracts inside a topo, not scaffold templates or package distribution. ADR-0052 establishes overlays as the lock's one extension mechanism, and ADR-0054 assigns identity to Config plus artifacts to apps. Scaffold forward compatibility therefore needs a lightweight posture that follows those existing owners.

## Decision

### Generated `@ontrails/*` dependencies are exact pins

Generated apps pin public `@ontrails/*` dependencies and devDependencies to the exact `@ontrails/trails` package version that produced the scaffold.

During the beta line, exact pins are safer than caret prerelease ranges because they make generated output reproducible. During stable cutover, exact pins make the release PR's generated-app inspection concrete: the scaffold names the intended stable package family exactly, and the post-publish smoke proves those packages exist.

This rule covers Trails-owned packages only. Third-party packages continue to use the curated ranges captured by the internal scaffold-version helper.

### Scaffolds author minimal provenance as an overlay

Every generated app exports a deterministic, schema-registered `scaffold` overlay alongside its side-effect-free topo entry:

```typescript
export const trailsOverlays = [
  {
    namespace: 'scaffold',
    schema: z.object({
      scaffoldVersion: z.string(),
      schemaVersion: z.literal(1),
      template: z.enum(['empty', 'entity', 'hello']),
    }),
    derive: () => ({
      scaffoldVersion: '1.0.0-beta.50',
      schemaVersion: 1,
      template: 'hello',
    }),
  },
];
```

The overlay is informational in the current beta line. It records only the minimum facts future tooling needs before it can decide whether a project came from a known scaffold shape:

- `schemaVersion` names the overlay payload schema.
- `scaffoldVersion` names the `@ontrails/trails` package that created the app.
- `template` names the starter selected by `trails create`.

There is no `generatedAt`: machine- or invocation-local time would create lock hash churn without helping compatibility. The normal compile path validates and embeds the overlay in the selected app's `trails.lock`, where generic hash, drift, tolerant-read, and Wayfinder behavior already exists under ADR-0052. Scaffolding does not write a separate `.trails/scaffold.json` or invent a second lock writer.

### Standalone apps and configured workspaces use the same lifecycle

`trails create <name>` creates a standalone app. `trails create <name> --workspace` creates a workspace root with a literal `workspace.apps` entry and places the app under `apps/<name>`. Generated surface entrypoints live under `bin/`; the topo entry under `src/` stays safe to load for derivation.

Both layouts follow one lifecycle:

1. Scaffold authored files.
2. Install dependencies.
3. Run `trails compile` for a standalone app or `trails compile --app <id>` at a configured workspace root.
4. Run `trails validate`.

Compile writes one app-root `trails.lock`. A configured workspace derives its view from `workspace.apps` and app-owned locks and never receives an aggregate root lock. `create --dry-run` reports the complete planned file set and this post-install guidance without writing either source or artifacts.

### Version-bump tooling keeps the scaffold synchronized

The internal `scaffold-versions` helper remains the operator path for keeping generated scaffold dependency versions current. Its check mode validates two things together:

- generated third-party scaffold versions match the root catalog/devDependency source of truth;
- generated `@ontrails/*` pins match `@ontrails/trails` exactly.

After `bun run version:packages`, release operators run `bun run scaffold-versions:sync` so the generated scaffold package story moves with the package version calculation instead of becoming hand-edit debt.

### Upgrade tooling is deferred

This ADR does not introduce any public upgrade command or migration system.

Deferred work includes:

- diffing current source against a scaffold baseline;
- applying generated migrations;
- template hashes or full source manifests;
- a public `trails upgrade` command;
- package or registry mutation.

Those features may follow once there are real scaffold-to-scaffold migrations to design around. The overlay is the seed, not the upgrade system.

## Consequences

- Freshly generated apps are more reproducible during beta and stable release work.
- Release operators have one internal check/sync path for both third-party scaffold dependency versions and exact Trails package pins.
- Future migration tooling has a small, stable starting point through the lock's existing extension mechanism, without requiring a parallel manifest.
- Existing generated apps do not receive retroactive provenance unless a future migration tool chooses to add it.
- Existing `.trails/scaffold.json` files from earlier betas are inert legacy breadcrumbs. Apps may remove them after moving the same facts into an authored `scaffold` overlay and recompiling their app lock.
- Existing `src/cli.ts`, `src/mcp.ts`, and `src/http.ts` entrypoints remain runnable. New scaffolds and `trails add surface` writes use `bin/`; adopters may move an old entry and update the package `bin` path when they want the new layout.

## Non-Goals

- This is not trail versioning, and it does not amend ADR-0048's trail-only versioning doctrine.
- This does not add a second lock extension channel; it uses ADR-0052 overlays.
- This does not make generated source framework-owned after scaffolding. The app owns its source files.
- This does not define package publication or dist-tag policy beyond the exact pins emitted by the scaffolder.

## References

- [ADR-0010: Trails-Native Infrastructure](../0010-native-infrastructure.md)
- [ADR-0047: Stable Release Line Discipline](../0047-stable-release-line-discipline.md)
- [ADR-0048: Trail Versioning v3](../0048-trail-versioning-v3.md)
- [ADR-0052: Overlays Are the Lock's One Extension Mechanism](../0052-overlays-one-extension-mechanism.md)
- [ADR-0054: Project Substrate Names Its Truth](../0054-project-substrate-names-its-truth.md)
- [`trails create` scaffold implementation](../../../apps/trails/src/trails/create-scaffold.ts)
- [Stable Cutover Runbook](../../releases/stable-cutover.md)
- [Beta Channel Policy](../../releases/beta-channel-policy.md)
