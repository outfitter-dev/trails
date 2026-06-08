---
slug: release-provenance-as-lifecycle-projection
title: Release Provenance as Lifecycle Projection
status: draft
created: 2026-06-08
updated: 2026-06-08
owners: ['[galligan](https://github.com/galligan)']
depends_on: [47, 48]
---

# ADR: Release Provenance as Lifecycle Projection

## Context

Trails already treats package releases as part of the framework contract. ADR-0047 decides that public `@ontrails/*` packages stay lockstep for the 1.x line, Changesets computes version and changelog output, Bun publishes, and a release PR carries evidence. The repo also has a branch-local release disposition check: if a PR changes publishable package contents, the PR must include a matching changeset unless it is explicitly labeled `release:none` with a rationale in the PR body.

That check is useful, but it still sees package files more readily than Trails contracts. A branch can change the public input or output schema of an exposed trail, or expose a trail on a new surface, while leaving the release story to reviewer memory. That fights the premise. The trail is the product, so public trail contract movement must be visible in release disposition before a branch leaves draft.

There is also a naming risk. It is tempting to promote "release" into a new primitive alongside trails, surfaces, resources, and contours. That would add concept count without improving the authored model. Release is not something a trail runs through. It is a lifecycle phase that reads resolved facts and emits human and machine outputs.

## Decision

### Release is a lifecycle projection

Trails models release work as a lifecycle projection over existing facts:

- package changes and publishable workspace membership;
- source diffs in the owning branch;
- resolved topo facts, including trail contracts, surfaces, facets, resources, signals, examples, and versions;
- authored release dispositions;
- emitted release outputs.

Release is not a surface. A CLI command or future MCP tool may inspect release facts, but the release itself is not a user-facing transport rendering of a trail. It is also not a new framework primitive for authors to define by hand. It is a phase that derives facts from the trail graph and asks for a small amount of explicit human intent where deterministic derivation cannot know the reason.

### Vocabulary

A **release fact** is a deterministic lower-case view over package, topo, and source diffs. Release facts are evidence, not authored primitives. Examples: "`@ontrails/trails` has package-affecting source changes", "`wayfind.contract` output changed", or "`create` gained CLI exposure". A release fact may be derived from source-static inspection in early checks and from Topographer or Wayfinder graph diffs as that substrate becomes cheap enough for CI.

A **release disposition** is the authored decision that explains what a release fact means for users. Supported dispositions include:

- `include`: ship the change with semver intent, changelog prose, and any docs or migration notes that should travel with it;
- `defer`: acknowledge the fact but keep it out of the current release plan, with a reason and follow-up owner;
- `not-user-visible`: explain why the fact does not change user-visible package content even though deterministic detection found movement;
- `none`: the explicit `release:none` posture, with a reason that makes the absence of release output reviewable.

A **release output** is an emitted artifact. Changeset files and package changelogs are the first concrete output family. Future emitters may produce release notes, migration packets, reviewer summaries, or downstream upgrade guidance, but they should read the same facts and dispositions rather than invent their own parallel release model.

A **release target** is a deferred named scope for future release planning: package, app, surface, facet, channel, or stack segment. Release targets are not implemented in the first slice. The current branch-local check operates at PR and package scope and records enough evidence to leave room for target-aware release planning later.

### Trail versions and package semver stay distinct

ADR-0048 decides trail-only contract versioning. Package semver describes npm distribution compatibility. Trail version entries describe capability compatibility inside a topo. A public trail contract change can be a release fact even when the trail's own `version` field does not change, and a trail version entry can preserve old runtime compatibility inside a package release.

The release projection must keep those axes visible:

- package semver answers "what public framework bits are being distributed?";
- trail versions answer "which contract versions can this topo resolve?";
- release facts and dispositions answer "what changed, why, and how should it be explained to consumers?".

### First enforceable wedge

The first implementation wedge is branch-local:

1. CI receives the PR file list for the current Graphite branch.
2. The release disposition check keeps enforcing package-file coverage.
3. The same check also derives slice-one public trail contract facts from changed source files.
4. A public trail addition, removal, visibility transition, input schema change, output schema change, or surface exposure change fails loudly unless the branch has a covering changeset or an explicit `release:none` disposition.

This is intentionally narrower than full changelog automation. It makes the missing-release-story failure impossible to miss without asking the framework to write prose or choose semver intent by itself.

### Graphite branch locality is part of the contract

Stacked branches make release provenance easy to smear. A top cleanup branch can add one changeset that appears to cover lower package-affecting work, but that destroys the owning-branch story. The check therefore uses the PR file list and the branch's immediate base. Reviewers and agents should fix missing release dispositions on the owning branch, then restack upward.

## Consequences

### Positive

- Public trail contract movement becomes visible to release review at the same time package file movement is already visible.
- Changesets remains the concrete version and changelog mechanism instead of being replaced by a speculative release system.
- Future Wayfinder, Topographer, and release-note tooling can share vocabulary: facts are deterministic, dispositions are authored, outputs are emitted.
- Graphite stacks keep one issue or reason per branch, including release provenance.

### Tradeoffs

- The first check is conservative and source-static. It will not catch every contract fact that a full before/after topo diff could catch.
- Some branches that were previously package-covered only by accident now need a clearer release disposition. That is intentional friction.
- `release:none` remains available, but it becomes a claim that needs a reason, not a way to make release review disappear.

### Risks

- If the source-static detector becomes too broad, developers may add noisy changesets for internal movement. The mitigation is to keep slice one scoped to public/exposed trail add/remove, visibility, input, output, and surface exposure facts, and to log unrelated P3 detector ideas instead of overfitting the first implementation.
- If future emitters treat Changesets output as the only release output, Trails may lose the richer contract facts it can derive. The mitigation is to keep release fact and disposition vocabulary independent of the first emitter.

## Non-goals

- Replacing Changesets.
- Generating changelog prose automatically.
- Implementing per-surface, per-facet, per-channel, or per-stack-segment release targets.
- Computing stack-cumulative release plans.
- Inferring error-taxonomy or permit changes as release facts in the first slice.
- Promoting this draft ADR to accepted status in the same implementation stack.

## Non-decisions

- Whether future release targets become a first-class query API.
- Whether Wayfinder becomes the default release fact substrate once baseline and current topo materialization are cheap enough in PR CI.
- How release notes, migration packets, and downstream upgrade helpers should be emitted after Changesets has computed package versions.

## References

- [ADR-0047: Stable Release Line Discipline](../0047-stable-release-line-discipline.md)
  - release line, Changesets, Bun publish, and stable preflight doctrine.
- [ADR-0048: Trail Versioning v3](../0048-trail-versioning-v3.md) - trail contract versions are separate from package semver.
- [Stable Cutover Runbook](../../releases/stable-cutover.md) - operator sequence for version PRs and publication.
- [Beta Channel Policy](../../releases/beta-channel-policy.md) - branch-local changesets, `release:none`, and beta publication posture.
