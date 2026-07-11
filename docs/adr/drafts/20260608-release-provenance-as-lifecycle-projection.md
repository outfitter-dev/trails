---
slug: release-provenance-as-lifecycle-projection
title: Release Provenance as Lifecycle Projection
status: draft
created: 2026-06-08
updated: 2026-06-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [47, 48]
---

# ADR: Release Provenance as Lifecycle Projection

## Context

Trails already treats package releases as part of the framework contract. ADR-0047 decides that public `@ontrails/*` packages stay lockstep for the 1.x line, Changesets computes version and changelog output, Bun publishes, and a release PR carries evidence. The repo also has a branch-local Changeset check: if a PR changes publishable package contents, the PR must include a matching changeset unless the branch explicitly explains why no user-visible package output exists.

That check is useful, but it still sees package files more readily than Trails contracts. A branch can change the public input or output schema of an exposed trail, or expose a trail on a new surface, while leaving the release story to reviewer memory. That fights the premise. The trail is the product, so public trail contract movement must be evaluated by release rules before a branch leaves draft.

There is also a naming risk. It is tempting to promote "release" into a new primitive alongside trails, surfaces, resources, and entities. That would add concept count without improving the authored model. Release is not something a trail runs through. It is a lifecycle phase that reads resolved facts and emits human and machine outputs.

## Decision

### Release is a lifecycle projection

Trails models release work as a lifecycle projection over existing facts:

- package changes and publishable workspace membership;
- source diffs in the owning branch;
- resolved topo facts, including trail contracts, surfaces, trailheads, resources, signals, examples, and versions;
- configured release rules and positive release intent;
- emitted release outputs.

Release is not a surface. A CLI command or future MCP tool may inspect release facts, but the release itself is not a user-facing transport rendering of a trail. It is also not a new framework primitive for authors to define by hand. It is a lifecycle phase that derives facts from the trail graph, applies configured rules, and asks for explicit human intent only when a rule says the fact matters to distribution.

### Vocabulary

A **release fact** is a deterministic lower-case view over package, topo, and source diffs. Release facts are evidence, not authored primitives. Examples: "`@ontrails/trails` has package-affecting source changes", "`wayfind.contract` output changed", or "`create` gained CLI exposure". A release fact may be derived from source-static inspection in early checks and from Topography or Wayfinder graph diffs as that substrate becomes cheap enough for CI.

A **release rule** is a configured policy that decides which release facts require positive intent. Rules are project policy, not one-off branch paperwork. A rule may say that public trail input/output changes require a Changeset, that package docs changes require a package note, or that a certain source-only fact is advisory.

**Release intent** is the authored evidence that satisfies a matching rule. A `.changeset/*.md` entry is the default intent source today: it names the package, semver intent, and changelog prose that should flow into package history. A no-release override such as `release:none` can remain as compatibility escape hatch only when it carries a reason; it is not the normal path and not the primitive.

A **release output** is an emitted artifact. Changeset files and package changelogs are the first concrete output family. Future emitters may produce release notes, migration packets, reviewer summaries, or downstream upgrade guidance, but they should read the same facts, rules, and intent sources rather than invent their own parallel release model.

A **release target** is a deferred named scope for future release planning: package, app, surface, trailhead, channel, or stack segment. Release targets are not implemented in the first slice. The current branch-local check operates at PR and package scope and records enough evidence to leave room for target-aware release planning later.

### Trail versions and package semver stay distinct

ADR-0048 decides trail-only contract versioning. Package semver describes npm distribution compatibility. Trail version entries describe capability compatibility inside a topo. A public trail contract change can be a release fact even when the trail's own `version` field does not change, and a trail version entry can preserve old runtime compatibility inside a package release.

The release projection must keep those axes visible:

- package semver answers "what public framework bits are being distributed?";
- trail versions answer "which contract versions can this topo resolve?";
- release facts, rules, and intent answer "what changed, does it matter to distribution, and how should it be explained to consumers?".

### First enforceable wedge

The first implementation wedge is branch-local:

1. CI receives the PR file list for the current Graphite branch.
2. The release check keeps enforcing package-file coverage through release rules.
3. The same check also derives slice-one public trail contract facts from changed source files.
4. A public trail addition, removal, visibility transition, input schema change, output schema change, or surface exposure change fails loudly when a configured rule requires intent and the branch has no covering Changeset or explicit no-release reason.

This is intentionally narrower than full changelog automation. It makes the missing-release-story failure impossible to miss without asking the framework to write prose or choose semver intent by itself.

### Governance joins stay staged

Release checks, Warden, and Wayfinder support the same story without owning the same facts.

`release.check` owns branch-local release-rule evaluation. It reads the PR file list, compares a branch to its immediate Graphite base, loads release rules, and decides whether release intent is missing. Warden should not duplicate GitHub or Graphite adapter shape.

Warden may later add advisory release hygiene when the fact is answerable from source, topo, or owner-held data without PR metadata. Good candidates include missing release config, docs that contradict release rules, or stale generated release guidance. A Warden error rule should wait for a durable invariant that Warden alone can evaluate.

Wayfinder remains a graph-read first slice. It helps reviewers inspect impact, nearby trails, and contracts during release review, but `release.check` does not require Wayfinder artifacts today. Future `wayfind.implications` queries may join graph facts with named Warden diagnostics, release-check output, or Distribution-Ready Done checklist facts, but those joins must cite their sources.

### Graphite branch locality is part of the contract

Stacked branches make release provenance easy to smear. A top cleanup branch can add one changeset that appears to cover lower package-affecting work, but that destroys the owning-branch story. The check therefore uses the PR file list and the branch's immediate base. Reviewers and agents should fix missing release intent on the owning branch, then restack upward.

## Consequences

### Positive

- Public trail contract movement becomes visible to release review at the same time package file movement is already visible.
- Changesets remains the concrete version and changelog mechanism instead of being replaced by a speculative release system.
- Future Wayfinder, Topography, and release-note tooling can share vocabulary: facts are deterministic, rules are configured, intent is authored, outputs are emitted.
- Graphite stacks keep one issue or reason per branch, including release provenance.

### Tradeoffs

- The first check is conservative and source-static. It will not catch every contract fact that a full before/after topo diff could catch.
- Some branches that were previously package-covered only by accident now need clearer release intent. That is intentional friction.
- `release:none` can remain as a compatibility override, but it is a claim that needs a reason, not a way to make release review disappear.

### Risks

- If the source-static detector becomes too broad, developers may add noisy changesets for internal movement. The mitigation is to keep slice one scoped to public/exposed trail add/remove, visibility, input, output, and surface exposure facts, and to log unrelated P3 detector ideas instead of overfitting the first implementation.
- If future emitters treat Changesets output as the only release output, Trails may lose the richer contract facts it can derive. The mitigation is to keep release facts, rules, and intent independent of the first emitter.

## Non-goals

- Replacing Changesets.
- Generating changelog prose automatically.
- Implementing per-surface, per-facet, per-channel, or per-stack-segment release targets.
- Computing stack-cumulative release plans.
- Inferring error-taxonomy or permit changes as release facts in the first slice.
- Implementing a Warden release-rule error rule before Warden has a durable non-PR-metadata invariant to own.
- Requiring Wayfinder artifacts before release-rule usage proves a graph-read or rule-join need.
- Promoting this draft ADR to accepted status in the same implementation stack.

## Non-decisions

- Whether future release targets become a first-class query API.
- Whether Wayfinder becomes the default release fact substrate once baseline and current topo materialization are cheap enough in PR CI.
- How release notes, migration packets, and downstream upgrade helpers should be emitted after Changesets has computed package versions.
- Whether no-release overrides remain GitHub labels, move into config-backed intent metadata, or stay as a CI adapter concern.

## References

- [ADR-0047: Stable Release Line Discipline](../0047-stable-release-line-discipline.md)
  - release line, Changesets, Bun publish, and stable preflight doctrine.
- [ADR-0048: Trail Versioning v3](../0048-trail-versioning-v3.md) - trail contract versions are separate from package semver.
- [Stable Cutover Runbook](../../releases/stable-cutover.md) - operator sequence for version PRs and publication.
- [Beta Channel Policy](../../releases/beta-channel-policy.md) - branch-local changesets, `release:none`, and beta publication posture.
