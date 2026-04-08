---
slug: documentation-freshness
title: Documentation freshness SLAs
status: draft
created: 2026-04-06
updated: 2026-04-06
owners: ['[galligan](https://github.com/galligan)']
depends_on: ['documentation-structure']
---

# ADR: Documentation freshness SLAs

## Context

### Documentation rots

Documentation goes stale in two ways. Code changes and the docs don't follow — a function signature changes, a flag is renamed, a new primitive ships. Or time passes and the world moves — a competitor framework ships new features, a best practice evolves, an ADR's decision is quietly superseded in practice without a formal record. Both are invisible until a user hits the gap.

The standard approach is to hope reviewers catch it. They don't — not reliably, not at scale, and not when agents are producing code changes at sprint pace. Documentation freshness needs a contract, not goodwill.

### The principle

This follows directly from the core premise: author the freshness contract, derive the enforcement. The developer declares what code each document is sensitive to (`triggers`) and commits to a verification date (`last_checked`). The framework enforces the rest.

### Separation of policy and state

If SLA thresholds lived in document frontmatter alongside `last_checked`, a single commit could modify both — lowering the threshold while bumping the check date. The SLA must be governed separately from the documents it constrains. Same principle as why you don't let the code under test define its own pass criteria.

## Decision

### Two frontmatter fields per document

Every documentation file carries two freshness-related fields in its frontmatter:

**`last_checked`**: a date string (`YYYY-MM-DD`). Means "a human or agent verified this document is accurate as of this date." Updated only by editing the frontmatter and committing. The git history is the audit trail.

**`triggers`**: an optional array of file globs. Declares which source files this document is sensitive to. When those files change, the document needs human review.

```yaml
---
title: Resources
description: Resource patterns, lifecycle, and best practices
last_checked: 2026-04-06
triggers:
  - "packages/core/src/resource/**"
  - "packages/core/src/types/resource.ts"
---
```

### SLA policy in a config file

SLA thresholds are defined in `docs/.freshness.yml`, separate from the documents they govern. Rules are glob-based. The most specific glob match wins. Every document must be covered by at least one rule — uncovered documents are flagged as a check failure.

```yaml
# docs/.freshness.yml
#
# Freshness SLA rules. Most specific glob match wins.
# SLA is specified in days.
#
rules:
  # Constitutional
  - glob: "docs/tenets.md"
    sla: 90

  # Basecamp — first contact, must be current
  - glob: "docs/basecamp/**/*.md"
    sla: 30

  # Guides — changes with primitives and practices
  - glob: "docs/guides/**/*.md"
    sla: 60
  - glob: "docs/guides/migration/**/*.md"
    sla: 30

  # Workflow — changes with tooling
  - glob: "docs/workflow/**/*.md"
    sla: 60

  # Reference — must track API surface closely
  - glob: "docs/reference/**/*.md"
    sla: 30

  # Governance — slow-changing, not frozen
  - glob: "docs/governance/**/*.md"
    sla: 120

  # ADRs — decisions can quietly drift
  - glob: "docs/adr/**/*.md"
    sla: 120
  - glob: "docs/adr/drafts/**/*.md"
    sla: 60

  # Releases — historical but should stay accurate
  - glob: "releases/**/*.md"
    sla: 90
```

Changes to `.freshness.yml` are immediately visible in PR diffs as a single file, easy to review. `CODEOWNERS` or branch protection can restrict who modifies SLA policy.

### SLA summary

| Glob | SLA (days) | Rationale |
| --- | --- | --- |
| `docs/tenets.md` | 90 | Constitutional but not unchecked — quarterly review |
| `docs/basecamp/**/*.md` | 30 | First contact for new users; must be accurate and current |
| `docs/reference/**/*.md` | 30 | Developers trust reference to match the API exactly |
| `docs/guides/**/*.md` | 60 | Changes with primitives and practices |
| `docs/guides/migration/**/*.md` | 30 | Migration guides must stay tight |
| `docs/workflow/**/*.md` | 60 | Changes with tooling |
| `docs/governance/**/*.md` | 120 | Slow-changing by design, but not frozen |
| `docs/adr/**/*.md` | 120 | Decisions can quietly drift from reality |
| `docs/adr/drafts/**/*.md` | 60 | Forces triage: promote, update, or archive |
| `releases/**/*.md` | 90 | Historical but should remain accurate |

No document is exempt. Constitutional rarity is not a reason to skip verification — it's a reason the verification should be easy (the doc probably hasn't changed), not absent.

### Two enforcement mechanisms

Freshness is enforced through two complementary mechanisms: trigger-based checks that catch code-driven staleness precisely, and SLA-based checks that catch time-driven staleness as a backstop.

#### Trigger-based enforcement

The core loop: **changed code → matching doc → stale check → action required.**

When source files change, the tooling scans all docs with `triggers` globs in their frontmatter. If a staged or changed file matches any doc's triggers, that doc is flagged for review. The comparison is between the doc's `last_checked` date and the date of the triggering change. A doc checked yesterday is still stale if the code it documents changed today. This is the precise mechanism.

This runs at two points:

**Pre-commit (local, advisory).** A git hook scans staged files against trigger globs. If any doc's triggers match and its `last_checked` is before today, the hook prints a warning listing the affected docs and which staged files triggered them. The hook does not block the commit — it surfaces the information so the developer can act in the same commit if they choose.

The developer has three options:

1. **Update the doc and bump `last_checked`.** The doc needed changes. Include both in the commit.
2. **Bump `last_checked` only.** The doc is still accurate despite the code change. Bumping the date is an explicit acknowledgment: "I checked, it's fine."
3. **Ignore the warning.** CI will catch it on the PR. This is fine for draft work or rapid iteration where you'll clean up before merge.

**CI (PR-level, enforcing).** A check runs on the PR's changed files. For each doc whose triggers match, it compares `last_checked` against the base commit date of the PR (not today — the question is "was this doc reviewed after the code it documents last changed?"). If stale, CI posts a comment identifying the specific docs and the files that triggered them, and the check fails.

Example CI output:

```text
Docs freshness check: 2 documents need review

  docs/guides/resources.md
    last_checked: 2026-03-15
    triggered by:
      packages/core/src/resource/create.ts (changed in this PR)
      packages/core/src/types/resource.ts (changed in this PR)

  docs/reference/api.md
    last_checked: 2026-03-28
    triggered by:
      packages/core/src/resource/create.ts (changed in this PR)

To resolve: review each doc, then update last_checked in its frontmatter.
```

To pass the check, the developer updates `last_checked` on each flagged doc and pushes the change. This keeps the review commitment in the git history — you can't mark a doc as fresh without a commit.

#### SLA-based enforcement

Triggers catch code-driven staleness. SLAs catch everything else — docs without triggers, docs whose triggers don't cover every relevant file, and docs that rot from the passage of time rather than code changes (e.g., a comparison doc where a competitor framework has shipped new features, or a draft ADR that's been sitting untouched for months).

A scheduled CI job (nightly or weekly) scans all docs. For each doc, it resolves the applicable SLA from `.freshness.yml` (most specific glob match wins), then checks whether `last_checked` is older than that threshold. Any violations are flagged.

SLAs are the backstop. Triggers are the precise mechanism. Together they ensure that docs stay fresh both when code changes and when time passes.

### Draft ADR staleness

The 60-day SLA on draft ADRs serves a specific purpose beyond freshness. A draft that has exceeded its SLA without a `last_checked` bump should be triaged: promote it (even to `rejected` status, which preserves the reasoning), update it with current thinking, or archive it. Stale drafts that linger indefinitely create false signal about the project's direction.

### Tooling shape

The freshness checks are implemented as a `trails` CLI command that can run in pre-commit, CI, and manual contexts:

```bash
# Pre-commit: check staged files against trigger globs
trails docs check --staged

# CI: check PR changed files against trigger globs
trails docs check --changed <base-ref>

# SLA scan: check all docs against .freshness.yml thresholds
trails docs check --sla

# Combined: run both trigger and SLA checks
trails docs check --all
```

This is a CLI command, not a warden rule. Warden operates on source code AST; freshness operates on git diff state and frontmatter dates. Different domains, different tools.

The script:

1. Loads SLA rules from `docs/.freshness.yml`
2. Parses frontmatter from all docs to collect `triggers` and `last_checked`
3. Resolves the set of changed files (from `git diff --staged`, PR file list, or all files for SLA mode)
4. Matches changed files against trigger globs
5. Resolves each doc's SLA (most specific glob match from `.freshness.yml`)
6. Compares dates and reports results

Output is both human-readable (for terminal and CI comments) and machine-readable (JSON for downstream tooling or dashboards).

## Consequences

### Positive

- `last_checked` and `triggers` make freshness a first-class contract: author the SLA, derive the enforcement
- SLA policy lives in a separate config file from the documents it governs — `last_checked` can't be gamed alongside SLA changes in a single commit
- Glob-based SLA rules provide flexible targeting at any granularity, from individual files to entire sections
- Trigger-based checks catch code-driven staleness precisely; SLA-based checks catch time-driven staleness as a backstop
- No document is exempt — constitutional rarity makes verification easy, not absent
- Draft ADR staleness is surfaced, forcing a decision: promote, update, or archive
- The freshness workflow integrates into existing git habits — bumping `last_checked` is a committed, auditable action
- The tooling runs at two points (pre-commit and CI) with different enforcement levels, matching developer workflow expectations

### Tradeoffs

- The `triggers` globs in frontmatter require maintenance as the codebase evolves — a moved package breaks the trigger. Mitigation: the SLA check catches stale triggers when `last_checked` ages out, and stale globs that match nothing are detectable
- Tight SLAs on `basecamp/` and `reference/` (30 days) create real review overhead. This is intentional — these are the documents users trust most
- Pre-commit hooks add friction to the commit workflow. Mitigation: the hook is advisory (warns, doesn't block), and developers can defer to CI
- ADR freshness checks (120 days accepted, 60 days drafts) create review obligations for historical documents. This is intentional — unreviewed decisions quietly drift from practice
- SLA config in a separate file means two places to look (`.freshness.yml` for policy, frontmatter for state). This separation is the point — policy and state should not be co-located where they can be co-modified

### Risks

- Over-aggressive SLAs could create review fatigue where developers routinely bump `last_checked` without genuinely reviewing the document. Mitigation: start with the proposed thresholds and adjust based on observed behavior. If a doc is consistently bumped without changes, either the SLA is too tight or the triggers are too broad
- Trigger globs that are too broad (e.g., `packages/core/**`) will fire on every core change, creating noise. Mitigation: triggers should be specific to the files the document actually describes

## Non-decisions

- **Freshness notification delivery.** Whether SLA violations surface as GitHub issues, Slack messages, or a dashboard is an implementation choice. The ADR defines the contract and the check; the notification channel is deferred
- **Draft ADR archive mechanics.** How stale drafts are archived (deleted, moved to a graveyard directory, or promoted to `rejected`) is a process decision. The ADR establishes that stale drafts must be triaged; the specific archive mechanism is deferred
- **Automatic `last_checked` bumping.** Whether tooling should offer an interactive mode that bumps dates after confirmation is a UX decision for the CLI implementation

## References

- [ADR: Documentation structure](20260406-documentation-structure.md) — the section taxonomy and directory structure that SLA rules reference
- [ADR-0000: Core premise](../0000-core-premise.md) — "author what's new, derive what's known" applies to freshness: author the contract, derive the enforcement
