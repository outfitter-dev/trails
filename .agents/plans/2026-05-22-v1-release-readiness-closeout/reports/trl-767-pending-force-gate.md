---
created: "2026-05-23T21:40:48Z"
updated: "2026-05-23T21:40:48Z"
description: "Audit report for TRL-767. Verdict: gate needs docs. Hard zero-pending-force rule is usable today via Warden pending-force, trails diff --forces, and lock artifact. trails doctor is aggregate-only and may miss graph-level removed-entry forces. Stable cutover runbook does not name the gate. Follow-ups TRL-769, TRL-770, and TRL-771 filed."
impl_status: implemented
linear:
  - TRL-767
  - TRL-769
  - TRL-770
  - TRL-771
references:
  - apps/trails/src/trails/topo-store-support.ts
  - apps/trails/src/trails/compile.ts
  - packages/topographer/src/types.ts
  - packages/topographer/src/forces.ts
  - apps/trails/src/trails/topo-read-support.ts
  - packages/topographer/src/diff.ts
  - apps/trails/src/trails/survey.ts
  - packages/warden/src/rules/trail-versioning-topo.ts
  - docs/adr/0048-trail-versioning-v3.md
  - docs/lexicon.md
  - docs/topo-store.md
  - docs/releases/stable-cutover.md
  - apps/trails/src/__tests__/survey.test.ts
  - packages/topographer/src/__tests__/forces.test.ts
  - packages/topographer/src/__tests__/diff.test.ts
  - packages/warden/src/__tests__/trail-versioning-rules.test.ts
  - apps/trails/src/__tests__/version-lifecycle.test.ts
---

# TRL-767 Audit: Pending Force Events As A V1 Stable Cutover Gate

Date: 2026-05-22
Branch: `trl-767-audit-pending-force-events-as-a-v1-stable-cutover-gate`
Issue: `TRL-767`

## Summary Verdict

Verdict: `gate needs docs`

The hard release rule is usable today: stable cutover can require zero pending
force events before the version PR leaves draft. The implementation already
blocks unforced breaking topo changes, records graph-only force events on
`trails compile --force`, preserves forced graph hashes in `.trails/trails.lock`,
keeps `trails validate` non-stale for force-only hash differences, exposes
`trails diff --forces`, and reports graph-only force events through Warden's
`pending-force` rule.

The softer proposed exception rule is not fully tool-backed yet. `trails doctor`
does not currently provide enough detail to be a standalone release gate and
appears to count only entry-attached force events, not graph-level removed-entry
force events. Warden also treats every attached force event as pending; there is
no structured accepted-exception or resolved-historical state. The stable
cutover runbook does not yet name the pending-force gate.

Recommended v1 rule:

> Stable cutover may proceed only when Warden `pending-force`, `trails diff
> --forces`, and `trails doctor` show zero pending force events. If the project
> wants accepted exceptions, those exceptions need a follow-up artifact and
> Warden policy before they become more than PR prose.

This does not block the current seven-issue closeout stack. It does block using
a named-exception policy as an automated v1 gate until follow-ups land.

## Evidence Map

### Source Behavior

- `apps/trails/src/trails/topo-store-support.ts:100-119` reads the previous
  TopoGraph, diffs it, rejects breaking changes without `force`, carries
  previous force metadata forward, and annotates breaking diffs as force events.
- `apps/trails/src/trails/compile.ts:47-54` exposes the `force` input flag with
  the description "Record graph-only force events for breaking changes".
- `packages/topographer/src/types.ts:116-125` defines `TopoGraphForceEntry` with
  `acceptedAt`, `change`, `detail`, `id`, `kind`, optional `reason`,
  `severity`, and `source`.
- `packages/topographer/src/types.ts:249-260` validates force entries in the
  TopoGraph schema; `packages/topographer/src/types.ts:262-288` allows
  graph-level `forces`.
- `packages/topographer/src/forces.ts:43-79` attaches modified force events to
  the affected entry and removed force events to graph-level `forces`.
- `packages/topographer/src/forces.ts:81-118` carries force events forward and
  strips them for live graph comparison.
- `apps/trails/src/trails/topo-read-support.ts:270-288` treats a committed
  forced graph as non-stale when the committed hash matches the force-bearing
  artifact and the force-stripped graph matches the live current hash.
- `packages/topographer/src/diff.ts:637-721` reports entry and graph-level
  force-event additions/removals as audit warnings.
- `apps/trails/src/trails/survey.ts:306-345` preserves force-event details when
  `--forces` is used, including with version-range targets.
- `packages/warden/src/rules/trail-versioning-topo.ts:154-172` reports
  entry-level and graph-level force entries as `pending-force`.

### Docs

- `docs/adr/0048-trail-versioning-v3.md:219-240` says `forces` are graph-only
  audit debt, not source, not authored version entries, and never runtime
  resolution targets.
- `docs/lexicon.md:469-473` says `forces:` appears only in the resolved graph,
  not source, and is not a version entry.
- `docs/topo-store.md` — the `### trails diff` section documents
  `trails diff --forces` (lines 107-118 at the TRL-767 audit snapshot; later
  TRL-758 documentation edits shift the exact line range, so navigate by
  heading rather than line).
- `docs/topo-store.md` — the `### trails doctor` section says `trails doctor`
  summarizes deprecated, archived, and forced topo break audit state (lines
  142-149 at the TRL-767 audit snapshot; same heading-anchored navigation note
  applies).
- `docs/releases/stable-cutover.md:27-76` lists stable cutover preconditions but
  does not mention pending-force, `trails diff --forces`, `trails doctor`, or
  Warden `pending-force`.

### Tests

- `apps/trails/src/__tests__/survey.test.ts:1472-1546` proves unforced breaking
  changes fail, forced compile records force events in `.trails/topo.lock`, the
  lock manifest points at the forced graph hash, validate is non-stale, and
  recompilation preserves the forced hash.
- `apps/trails/src/__tests__/survey.test.ts:1548-1610` proves removed trails are
  recorded as graph-level force events and survive recompilation.
- `apps/trails/src/__tests__/survey.test.ts:1618-1624` proves the top-level
  `diff` command exposes a `forces` flag.
- `apps/trails/src/__tests__/survey.test.ts:1745-1797` proves `diff --forces`
  exposes graph-only force audit events even with a version-range target.
- `packages/topographer/src/__tests__/forces.test.ts:30-112` covers modified,
  removed, and force-stripping behavior.
- `packages/topographer/src/__tests__/diff.test.ts:573-637` covers force event
  warnings for entry-level and graph-level forces.
- `packages/warden/src/__tests__/trail-versioning-rules.test.ts:295-383`
  covers `pending-force` for entry-level forces, graph-level removed forces, and
  deduplication.
- `apps/trails/src/__tests__/version-lifecycle.test.ts:511-538` covers doctor
  lifecycle counts, but not force-event counts or force-event details.

## Command Snippets

```text
$ bun test packages/topographer/src/__tests__/forces.test.ts \
>   packages/topographer/src/__tests__/diff.test.ts \
>   packages/warden/src/__tests__/trail-versioning-rules.test.ts
41 pass
0 fail
Ran 41 tests across 3 files.
```

```text
$ bun test apps/trails/src/__tests__/survey.test.ts -t force
(pass) trails compile > blocks breaking topo changes unless forced and records force events
(pass) trails compile > forced removed trails are recorded as graph force events
(pass) trails survey diff > top-level diff filters graph-only force audit events
4 pass
0 fail
```

```text
$ bun apps/trails/bin/trails.ts diff --help
Options:
  --forces              Only show graph force audit events (default: false)
```

```text
$ bun apps/trails/bin/trails.ts doctor --help
Usage: trails doctor [options]
Diagnose trail versioning lifecycle state
```

```text
$ bun apps/trails/bin/trails.ts doctor --json
Error: Found multiple Trails app entry points:
  - apps/trails-demo/src/app.ts
  - apps/trails/src/app.ts
Use --module to select one explicitly.
```

The default command failure is expected in this monorepo because multiple app
entry points exist. Follow-up command attempts with `--module apps/trails/src/app.ts`
returned the generic `Error: Internal server error`; no `.trails` artifacts were
created. The targeted tests above are the reliable workflow proof for this
audit.

## Current Behavior Matrix

| Surface | Current Behavior | Evidence | Verdict |
| --- | --- | --- | --- |
| `trails compile` | Rejects breaking diffs unless `force` is true; forced compile writes force-bearing graph artifacts. | `apps/trails/src/trails/topo-store-support.ts:100-119`; `apps/trails/src/__tests__/survey.test.ts:1472-1546` | Ready for hard zero-pending gate. |
| `.trails/topo.lock` / `.trails/trails.lock` | Force events live in TopoGraph; lock manifest stores the forced graph hash. | `apps/trails/src/__tests__/survey.test.ts:1500-1513`; `packages/topographer/src/types.ts:116-125` | Ready. |
| `trails validate` | Accepts force-only committed graph differences when the force-stripped graph matches current. | `apps/trails/src/trails/topo-read-support.ts:270-288`; `apps/trails/src/__tests__/survey.test.ts:1514-1523` | Ready. |
| `trails diff --forces` | Exposes and filters graph force audit events. | `apps/trails/src/trails/survey.ts:306-345`; `apps/trails/src/__tests__/survey.test.ts:1745-1797` | Ready. |
| `trails doctor` | Exposes `forceEvents` count, but aggregate-only and appears to miss graph-level forces. | `apps/trails/src/trails/doctor.ts:20-27`; `apps/trails/src/trails/version-lifecycle-support.ts:826-865` | Needs implementation polish before standalone gate use. |
| Warden `pending-force` | Warns for entry-level and graph-level force events and deduplicates overlaps. | `packages/warden/src/rules/trail-versioning-topo.ts:154-172`; `packages/warden/src/__tests__/trail-versioning-rules.test.ts:295-383` | Ready for hard zero-pending gate. |
| Stable cutover docs | Runbook does not mention pending-force gate yet. | `docs/releases/stable-cutover.md:27-76` | Needs docs. |

## Audit Questions

### Are forced break events persisted only in the derived graph, not source contracts?

Yes. ADR-0048 and the lexicon both define force events as graph-only, and the
implementation annotates `TopoGraph` entries or graph-level `forces` during
artifact writing. The source search found force literals in docs, tests, and
Topographer implementation, not authored trail source.

### Can an agent tell which trail/version/marker changed and why it was forced?

Partially. A force entry carries `id`, `kind`, `change`, `detail`,
`acceptedAt`, optional `reason`, `severity`, and `source`. That is enough to see
the affected entity and diff text. It does not carry structured `version`,
`marker`, `owner`, `plannedResolution`, or `resolved` fields, so version/marker
semantics depend on the free-form diff detail and surrounding TopoGraph context.

### Does the audit event carry enough metadata for release review?

Enough for a hard zero-pending rule, not enough for a named exception rule. A
release reviewer can identify pending force debt through Warden and diff output,
but cannot encode an accepted exception or resolution lifecycle in the artifact
itself.

### Can `pending-force` distinguish new/active debt from accepted historical force events?

No. Warden reports every attached force entry as pending, with deduplication for
overlapping entry/graph records. There is no accepted or resolved state in
`TopoGraphForceEntry`.

### Does the stable cutover runbook mention pending force events?

No. It should.

### Should v1 require zero pending force events unless the version PR documents an accepted exception?

Use the stricter first half for v1: require zero pending force events. If an
exception path is desired, land follow-up semantics first so the exception is
structured and Warden-visible rather than only PR prose.

## Follow-Up Issues

- `TRL-769`: Document pending-force stable cutover gate.
- `TRL-770`: Make `trails doctor` pending-force output complete and actionable.
- `TRL-771`: Define accepted-exception semantics for pending force events.

## Stable Cutover Checklist Item

Proposed immediate checklist text for the stable version PR:

```markdown
- [ ] Pending-force gate is clean: Warden reports no `pending-force`
      diagnostics, `trails diff --forces` shows no force events, and
      `trails doctor` reports `forceEvents: 0`.
```

If `TRL-771` later defines structured exceptions, extend the checklist with:

```markdown
- [ ] Any accepted force exception is named in the PR body with owner, reason,
      planned resolution, and the corresponding Warden/doctor output.
```

## Blocker Assessment

No large stable-cutover blocker was found for the hard zero-pending-force rule.
The current system can enforce "no force events" through Warden and diff output.

There is a blocker for the softer exception policy: accepted exceptions are not
artifact-backed. That is filed as `TRL-771` and should be resolved before v1
relies on exceptions as a routine release path.
