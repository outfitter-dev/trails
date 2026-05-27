---
id: 47
slug: stable-release-line-discipline
title: Stable Release Line Discipline
status: accepted
created: 2026-05-13
updated: 2026-05-13
owners: ['[galligan](https://github.com/galligan)']
depends_on: [29, 35, 37, 44, 46]
---

# ADR-0047: Stable Release Line Discipline

## Context

### Stable changes the meaning of a release

During the beta line, Trails could use each release to finish the shape of the framework. Package boundaries moved, `connector` became `adapter`, surface APIs settled into the `derive` -> `create` -> `surface` ladder, and generated apps tracked those moves.

The 1.x line has a different promise. A stable release is not just "the next publish." It is the public distribution contract for the framework family. Developers should be able to create a fresh app, install the generated dependencies from the registry, and trust that the packages they received belong to the same release story.

### The package graph is one framework family

Trails now ships pure contract packages, extracted adapters, tooling packages, and the `trails` CLI. ADR-0029 keeps adapter package boundaries sharp, and ADR-0035 keeps surface projection, materialization, and ownership layers distinct.

Those boundaries are architectural. They do not require independent public version numbers in the first stable line. In fact, the beta.16 unblock showed the opposite risk: if a generated app can see one package version while another public package is missing or stale, the user experiences the framework as broken even though each local package may pack cleanly.

### Release mechanics exist, but doctrine was implicit

The repo already has a workable release mechanism:

- Changesets computes versions and changelogs.
- `.changeset/config.json` fixes `@ontrails/*` packages together.
- `bun run publish:check` packs public workspaces and rejects unresolved
  `workspace:` or `catalog:` ranges.
- `bun run publish:packages` publishes through Bun and derives the dist-tag
  from `.changeset/pre.json`.
- `bun run publish:registry-check` and
  `bun run publish:registry-check:published` verify registry availability and
  dist-tag posture without mutating the registry.

What was missing was the stable-line decision those tools enforce. Without an ADR, release docs can drift back toward operator memory: "run the right thing, publish the right packages, recover carefully." Stable needs that memory turned into a contract.

## Decision

### The 1.x package line stays lockstep

All non-private public `@ontrails/*` packages remain fixed together for the 1.x line.

This means:

- one stable release version names the whole public framework family;
- generated apps may depend on multiple `@ontrails/*` packages without solving
  a compatibility puzzle;
- adapter package extraction still owns dependency and responsibility
  boundaries, but not independent 1.x version numbers;
- moving an adapter to an independent cadence requires a future ADR amendment.

The test: if a public `@ontrails/*` package ships as part of the stable framework family, a release PR should make it available at the same version as the rest of that family or explicitly document why it is not part of the published set.

### Package semver and trail versioning answer different questions

Package semver describes distribution compatibility for npm consumers. ADR-0044 trail versioning describes capability compatibility inside a topo.

Do not use package versions as a substitute for trail versions. A package minor may add new framework APIs. A trail version may preserve an old contract inside the same package version. The release line carries the framework bits; the trail contract carries the app capability.

### Stable uses `latest`; prereleases use explicit channels

The stable 1.x channel publishes to `latest`.

Prereleases after 1.0 use explicit prerelease dist-tags such as `beta`, `next`, or `canary`. A prerelease must not fall through to `latest` because a tag was omitted.

The publish script is the authority for this default:

- while Changesets prerelease mode is active, use `.changeset/pre.json`'s
  explicit tag;
- after prerelease mode exits, default to `latest`;
- if prerelease mode is active but no usable tag exists, fail loudly.

Release PRs and runbooks should verify the intended dist-tag before publish and verify the actual dist-tag after publish.

### Breaking changes after 1.0 are major-line decisions

After 1.0, a breaking public API change requires one of these:

- a new major release line;
- an accepted ADR that defines a narrower exception and its migration path.

Public API includes package exports, generated app dependencies and imports, surface helper contracts, stable CLI command grammar, documented runtime behavior, and generated artifact contracts promised by accepted ADRs.

Pre-1.0 cleanup can still land before the stable cut. Once 1.0 is published, the stable line stops using "we are still in beta" as the migration plan.

### Package retirement is visible and migratable

A public package rename, retirement, or extraction must include a migration posture before the stable line can depend on it.

This means:

- generated scaffolds stop referencing the retired name before release;
- docs and release notes name the replacement;
- old packages already published to npm are deprecated with a visible message
  when that package name should not be used anymore;
- package removal from the public set is called out in the release PR;
- the release preflight distinguishes "intentionally retired" from "missing or
  inaccessible."

Retiring a package silently is a release failure. It makes drift visible only to the next person who tries a fresh install.

### Fresh generated apps are a release gate

The current stable scaffold must install from the public registry with a clean package-manager cache.

For a release that changes generated app dependencies or public surface packages, the release evidence must include a fresh-start smoke outside the monorepo:

```bash
tmp=$(mktemp -d /tmp/trails-docs-smoke.XXXXXX)
bun apps/trails/bin/trails.ts create docs-smoke \
  --dir "$tmp" \
  --surfaces cli mcp http \
  --verify \
  --output json

cache=$(mktemp -d /tmp/bun-cache.XXXXXX)
cd "$tmp/docs-smoke"
BUN_INSTALL_CACHE_DIR="$cache" bun install
bun run typecheck
bun test
```

The point is not just that the scaffold command runs. The generated `package.json`, selected lockfile versions, typecheck, and tests together prove that a new user can consume the published framework family.

### Changesets computes; Bun publishes

Changesets owns version and changelog calculation. Bun owns publication.

The stable flow keeps these responsibilities separate:

- use `bunx changeset add` or an equivalent changeset file for package-facing
  changes;
- use `bunx changeset version` to update package versions and changelogs;
- use `bun run publish:check` to prove the package tarballs are clean;
- use `bun run publish:packages` to publish.

Do not use `changeset publish`, `npm publish`, or ad hoc package publication for the normal release path. If an emergency requires a different operation, that operation is an incident with written evidence, not a new default.

### Changelogs and release notes are part of the contract

Every package-facing change needs a truthful changeset unless the PR is explicitly `release:none` and the issue or PR explains why no user-visible package content changed.

Package changelogs should name user-visible API, package, surface, and generated-app changes in the package that ships them. Release notes should explain the framework-family story: new packages, retired names, scaffold changes, known migrations, and release preflight results.

### Partial publish recovery is explicit

If publication fails after one or more packages have been published, stop.

Recovery requires:

- the failed command and output;
- the target version and intended dist-tag;
- the list of packages already published at that version;
- registry verification for those packages;
- an explicit resume set for any retry.

Do not rerun the whole publish matrix blindly. Do not mutate dist-tags to hide an incomplete release. A partial publish is a release incident until the public package set and dist-tags are coherent again.

### Release PRs carry preflight evidence

A release PR that changes package versions or prepares a stable cutover should cite this ADR and include the relevant evidence:

- `bunx changeset status --verbose`;
- `bun run publish:check`;
- `bun run publish:registry-check`;
- fresh-start generated app smoke when scaffolds or generated dependencies are
  in scope;
- ADR and runbook checks when release doctrine or procedure changes.

The review question is not "does this diff look plausible?" It is "does the evidence prove the public release line will be coherent?"

## Consequences

### Positive

- A stable version names a coherent framework family instead of a loose set of
  packages that happen to share a scope.
- Generated apps become a first-class release signal, matching the "one write,
  many reads" doctrine: scaffold metadata, package manifests, registry state,
  and tests all have to agree.
- The runbook can stay procedural because this ADR owns the policy.
- Registry preflight failures become actionable: missing package, wrong tag,
  intentional retirement, or partial-publish incident.
- Adapter extraction keeps its architectural value without forcing
  independent package cadence before the stable line is ready for it.

### Tradeoffs

- Lockstep versioning publishes packages that did not materially change in a
  given release. That is acceptable for 1.x because coherence is more valuable
  than granular package history at this stage.
- Independent adapter cadence is deferred. Adapter packages have clean
  dependency boundaries, but their public versions stay tied to the framework
  family until a future ADR changes the line policy.
- Release PRs carry more evidence. The added ceremony is intentional: stable
  releases are externally visible operations, not local build checks.

### Risks

- A broad lockstep line can hide which package actually changed. Changesets
  and package changelogs mitigate this by keeping package-local release notes.
- `release:none` can be abused to bypass package evidence. CI and review
  should treat it as a claim requiring explanation, not as a shortcut.
- Partial-publish recovery remains operator-sensitive. The mitigation is to
  make the stop-and-resume protocol explicit and to keep improving read-only
  registry probes.

## Non-goals

- This ADR does not execute the 1.0 cutover.
- This ADR does not choose the exact calendar support window for 1.x.
- This ADR does not make adapter packages independently versioned.
- This ADR does not define customer support policy outside package and
  generated-app compatibility.

## Non-decisions

- Whether a future 2.x line keeps lockstep or lets some adapters use an
  independent cadence.
- Whether Trails eventually publishes additional prerelease channels beyond
  `beta`.
- Whether package provenance, signing, or npm ownership automation becomes a
  first-party release primitive.

## References

- [ADR-0029: Adapter Extraction and Composition Around Core Contracts](0029-connector-extraction-and-the-with-packaging-model.md)
  — package boundaries and adapter extraction remain intact under lockstep 1.x
  versioning
- [ADR-0035: Surface APIs Render the Graph](0035-surface-apis-render-the-graph.md)
  — generated apps and surface packages consume the shared projection ladder
- [ADR-0037: Owner-First Authority](0037-owner-first-authority.md) — release
  tools should read package and framework facts from their natural owners
- [ADR-0044: Trail Versioning](0044-trail-versioning.md) — trail contract
  versions are separate from package semver
- [ADR-0046: Lock v3 Artifact Family](0046-lock-v3-artifact-family.md) — stable
  artifact contracts are part of the public release line
- Release Process And Beta-To-1.0 Cutover Audit — archived local planning
  artifact that identified the missing doctrine
- [Releasing](../../AGENTS.md#releasing) — current repo release commands and
  publish posture
