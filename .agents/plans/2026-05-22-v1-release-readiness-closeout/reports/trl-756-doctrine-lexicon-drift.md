---
created: "2026-05-23T21:40:49Z"
updated: "2026-05-23T21:40:49Z"
description: "Audit report for TRL-756. Verdict: minor drift. Enforced vocab gates (vocab:audit, lint:ast-grep, warden:skills:check) are clean. Two follow-ups filed: TRL-774 for resource factory svc/service/provision naming residue in public TSDoc and skills, and TRL-775 for the stale .trails/clark/survey-latest.md snapshot. Neither blocks stable cutover."
impl_status: implemented
linear:
  - TRL-756
  - TRL-774
  - TRL-775
references:
  - docs/lexicon.md
  - docs/adr/0001-naming-conventions.md
  - docs/contributing/warden-rules.md
  - docs/releases/stable-cutover.md
  - scripts/vocab-cutover-audit.ts
  - scripts/check-installed-trails-skill.ts
  - packages/core/src/resource.ts
  - packages/testing/src/__tests__/crosses.test.ts
  - plugin/skills/trails/SKILL.md
  - plugin/skills/trails/references/common-pitfalls.md
  - .trails/clark/survey-latest.md
---

# TRL-756 Audit: Doctrine And Lexicon Drift After Versioning M3

Date: 2026-05-22
Branch: `trl-756-audit-v1-doctrine-and-lexicon-drift-after-versioning-m3`
Issue: `TRL-756`

## Summary Verdict

Verdict: `minor drift`

The active repo doctrine is mostly aligned with the post-versioning-M3 lexicon.
The enforced gates are clean: `bun run vocab:audit`, `bun run
vocab:audit:json`, `bun run lint:ast-grep`, `bun run warden:skills:check`, and
`bun run warden:agents:check` all pass for the checked-out repo source.

The audit did find two real follow-ups:

- `TRL-774`: public resource factory docs and examples still use the `svc`
  parameter name, and some test fixture names still use `provision*`.
- `TRL-775`: the committed `.trails/clark/survey-latest.md` snapshot is stale
  while still being named "latest".

Neither is a stable-cutover blocker under the current release gate because the
source vocabulary checks are clean and the remaining drift is narrow,
classifiable, and tracked. If v1 stable adopts a stricter "zero known active
lexicon residue in public TSDoc and agent skills" rule, then `TRL-774` should
land before stable.

The local installed Trails skill copy is also stale, but that is external
operator state rather than branch source. The repo already has a read-only check
for this path; refreshing local installed copies should remain an explicit
operator action, not a hidden side effect of this audit branch.

## Evidence Map

### Governing Doctrine

- `docs/lexicon.md:1-7` defines the lexicon as the contract and says code is
  brought into alignment when the two diverge.
- `docs/lexicon.md:136-156` allows retired names in historical release notes,
  old migrations, accepted ADR history, and clearly marked legacy context.
- `docs/lexicon.md:547-559` reserves `trailhead` and `connector` as historical
  boundary/package terms and directs active docs, examples, and APIs to use
  `surface` and `adapter`.
- `docs/lexicon.md:605-612` says active writing should use the lexicon
  consistently and prefer lexicon nouns for architecture explanations.
- `docs/adr/0001-naming-conventions.md:57-63` lists the current branded and
  plain terms, including `surface`, `resource`, `layer`, `tracing`, and `meta`.
- `docs/adr/0001-naming-conventions.md:97-100` now teaches `resource()` and
  `topo()` as frozen definitions, plus `createTrailContext()`, `createLogger()`,
  and `createProgram()` as runtime instances.
- `docs/adr/0001-naming-conventions.md:115-128` gives the current progression:
  `trail()` to `blaze:` to `signal()` to `topo()` to `surface()` to `run()`.
- `docs/adr/0001-naming-conventions.md:216-217` names the current vocabulary
  family as trail, blaze, topo, surface, cross, resource, signal, layer,
  tracing, and warden.

### Enforcement And Classification Rules

- `docs/contributing/warden-rules.md:194-219` explicitly scopes retired
  vocabulary source rules to source-owned symbols and sends docs/history
  classification through `bun run vocab:audit`.
- `scripts/vocab-cutover-audit.ts:137-145` is the text-mode pass/fail gate for
  the vocabulary audit.
- `scripts/check-installed-trails-skill.ts:321-338` intentionally reports
  installed-skill stale vocabulary as a read-only finding.

## Command Snippets

The required search pattern was checked with `git grep -nE`. Because Git's ERE
handling of `\b` did not produce useful word-boundary matches in this checkout,
the audit re-ran the same term set with `-P` and classified the resulting hits.

```text
$ git grep -nP '\b(trailhead|trailheads|provision|provisions|gate|gates|loadout|tracker|tracks|vocabulary)\b' -- ':!bun.lock' | wc -l
1063
```

The active-target Markdown/package/skill subset, excluding changelogs, is much
smaller and mostly historical or false-positive prose:

```text
$ rg -n 'trailhead|trailheads|provision|provisions|loadout|tracker|tracks|\bgate\b|\bgates\b|vocabulary' packages/*/README.md adapters/*/README.md apps/*/README.md README.md docs/*.md docs/releases/*.md plugin/skills .claude/skills .agents/skills --glob '!**/CHANGELOG.md' | wc -l
69
```

```text
$ bun run vocab:audit
vocab-cutover audit passed for entire repo target set: no legacy patterns found.
```

```text
$ bun run vocab:audit:json
[
  {"id":"run-field","total":0},
  {"id":"service-factory","total":0},
  {"id":"services-field","total":0},
  {"id":"event-factory","total":0},
  {"id":"surface-term","total":0},
  {"id":"connector-term","total":0},
  {"id":"topograph-artifact-family-retired-term","total":0}
]
```

```text
$ rg -n '\bsvc\b|provisionLeafTrail|provisionRootTrail|provisionTrailsMap|service-config|service.test|tracing-provision' packages plugin/skills --glob '!**/CHANGELOG.md' | head -80
plugin/skills/trails/SKILL.md:151:  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
plugin/skills/trails/references/common-pitfalls.md:160:**Fix:** Keep resource factories surface-agnostic. Use `svc.config` for declared resource config or `svc.env` for one-off environment values:
packages/topographer/src/topo-store.ts:705:  create: (svc) =>
packages/permits/src/auth-resource.ts:85:  create: (svc) => Result.ok(createAdapter(svc.config as AuthResourceConfig)),
packages/testing/src/__tests__/crosses.test.ts:236:const provisionLeafTrail = trail('resource.leaf', {
packages/testing/src/__tests__/crosses.test.ts:245:const provisionRootTrail = trail('resource.root', {
packages/testing/src/__tests__/crosses.test.ts:271:const provisionTrailsMap = new Map<string, AnyTrail>([
packages/core/src/resource.ts:12: * the validated config is passed as `svc.config`.
packages/core/src/resource.ts:35:    svc: ResourceContext<C>
packages/core/src/__tests__/service-config.test.ts:52:  test('resource with config schema receives validated config in svc.config', async () => {
```

```text
$ git ls-files packages/tracker .trails/clark/survey-latest.md
.trails/clark/survey-latest.md
```

```text
$ bun run plugin:installed-skill:check
Installed Trails skill drift report
[error] agents-shared: <user-home>/.agents/skills/trails (copy)
  - content-drift: 13 file drift item(s)
  - stale-vocabulary: 5 stale vocabulary hit(s)
[error] claude-home: <user-home>/.config/claude/skills/trails
  - content-drift: 13 file drift item(s)
  - stale-vocabulary: 5 stale vocabulary hit(s)
[info] codex-home: <user-home>/.config/codex/skills/trails (missing)
Read-only check: no installed skill files were changed.
```

## Classification Matrix

| Class | Representative Hits | Evidence | Verdict |
| --- | --- | --- | --- |
| Allowed historical context | Beta.15 release note migration map for `trailhead`, `provision`, `gate`, `loadout`, and `tracker`. | `docs/releases/beta15.md:57-85`, `docs/releases/beta15.md:223-248` | Allowed; clearly migration/history. |
| Allowed migration docs | Hono and HTTP READMEs contrast old `trailhead` imports with current `surface` imports. | `adapters/hono/README.md:43-50`, `packages/http/README.md:153-159` | Allowed; warden-ignore annotated migration prose. |
| Allowed ADR/index history | ADR index keeps the historical ADR-0008 slug and names the vocabulary-to-lexicon ADR. | `docs/index.md:58-79` | Allowed; accepted history and migration links. |
| False positive prose | `gate` as a release/test gate and `tracker` as an issue tracker concept. | `docs/releases/stable-cutover.md`, `packages/testing/README.md`, packet docs | False positive; not Trails lexicon target-state drift. |
| Code/API compatibility surface | Legacy topo-store schema/table names such as `topo_trailheads` in migration tests. | `packages/topographer/src/__tests__/topo-store.test.ts` | Allowed compatibility coverage. |
| Active guidance drift | Resource factory examples and TSDoc use `svc`; resource tests use `service*` and `provision*` names. | `packages/core/src/resource.ts:7-36`, `plugin/skills/trails/SKILL.md:149-158`, `packages/testing/src/__tests__/crosses.test.ts:236-273` | Real follow-up: `TRL-774`. |
| Active operational artifact drift | `.trails/clark/survey-latest.md` still reports already-fixed ADR/source findings. | `.trails/clark/survey-latest.md:7-44` versus `docs/adr/0001-naming-conventions.md:97-100` | Real follow-up: `TRL-775`. |
| External installed-copy drift | Local installed Trails skill copies differ from repo plugin source and include stale vocabulary findings. | `bun run plugin:installed-skill:check` | External/operator action; not branch source. |

## Audit Questions

### Do current docs teach the current lexicon?

Yes for the primary docs inspected. `docs/lexicon.md`, `docs/architecture.md`,
`docs/index.md`, `docs/why-trails.md`, `docs/getting-started.md`,
`docs/horizons.md`, release docs, public package READMEs, ADR index material,
and the repo plugin skill source mostly teach `trail`, `blaze`, `topo`,
`surface`, `cross`, `resource`, `layer`, `signal`, `tracing`, and `meta`.

Remaining retired-term hits in those paths are either migration/history, ordinary
English false positives, or the narrow `svc`/resource-factory residue filed as
`TRL-774`.

### Is there active code/API compatibility drift?

Only minor drift. `ResourceSpec.create` exposes a public callback parameter named
`svc`, and public TSDoc says config is passed as `svc.config`. That does not
change runtime behavior, but it is visible in IDE hovers and copied into agent
skill examples. The fix is mechanical but cross-cutting enough to keep out of
the report-only audit branch.

### Are committed agent artifacts current?

Not completely. The repo plugin skill source is current enough for the checked
audit, but `.trails/clark/survey-latest.md` is stale and committed. It still
claims ADR-0001 teaches `provision()` and `createTrackerGate()` even though the
current ADR is updated, and it references `packages/tracker/` even though no
tracked files remain there. Because the file is named `latest`, agents can treat
outdated conclusions as live evidence. This is filed as `TRL-775`.

### Did the installed global skill state match the repo source?

No. `bun run plugin:installed-skill:check` reports content drift and stale
vocabulary in `<user-home>/.agents/skills/trails` and the symlinked
`<user-home>/.config/claude/skills/trails`. The command is read-only and made
no changes. This should be refreshed through an explicit operator action, not
by this branch.

## Follow-Up Issues

- `TRL-774`: Rename Resource factory `svc` residue to current resource context
  naming.
- `TRL-775`: Refresh or archive stale committed Clark survey snapshot.

## Stable Cutover Recommendation

For the v1 stable cutover lexicon gate:

```markdown
- [ ] Doctrine/lexicon gate is clean: `bun run vocab:audit`, `bun run
      vocab:audit:json` (machine-readable output for CI graders),
      `bun run lint:ast-grep`, `bun run warden:skills:check`, and `bun run
      warden:agents:check` pass, and any active public docs/API/agent guidance
      retired-term hits are either fixed or filed as explicitly accepted
      non-blocking release follow-ups.
```

Current state: pass with minor drift, assuming `TRL-774` and `TRL-775` are
accepted as post-audit follow-ups rather than release blockers.
