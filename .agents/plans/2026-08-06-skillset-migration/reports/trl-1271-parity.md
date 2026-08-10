---
created: "2026-08-06T21:08:00Z"
updated: "2026-08-06T21:08:00Z"
description: Reproducible standalone Skillset parity classification against the accepted PR 991 oracle.
linear:
  - TRL-1271
  - SET-394
  - SET-395
  - SET-396
impl_status: verified
references:
  - ../PLAN.md
  - ../GOAL.md
  - ../RETRO.md
---

# TRL-1271 standalone Skillset parity

## Verdict

The standalone-skill slice is parity-capable on exact npm `skillset@0.22.0`: selective import, both provider outputs, all companions, provider-specific skill frontmatter, modes, locks, drift detection, Lewis, maintainer, and both Codex persona agents are reproducible in a hermetic workspace.

TRL-1272 is not yet unblocked. [SET-396](https://linear.app/outfitter/issue/SET-396/preserve-provider-native-project-agent-references-to-unmanaged-skills) records one blocking Clark/Claude project-agent gap: portable source rejects Clark's provider-installed `trails` skill, while the target-native Markdown island fallback strips `model: fable`.

This report distinguishes the npm release from the compiler protocol marker. The repo pin and `bun.lock` prove `0.22.0`; generated metadata and locks currently report `skillset@0.1.0` and cannot independently attest the npm release.

## Hermetic proof

Run:

```bash
bun run skillset:parity
```

The harness creates a new operating-system temporary root and places the full workspace, import source, live temporary outputs, HOME, TMPDIR, XDG config, XDG cache, XDG data, and XDG state beneath it. It invokes only the repository-local pinned binary, uses the reviewed selective Claude import, and removes the temporary root after the suite. Child processes receive only required PATH/locale values plus those temporary roots; inherited `NODE_ENV`, `SKILLSET_*`, and unrelated parent state are excluded. It never addresses live `.claude`, `.agents`, `.codex`, HOME provider configuration, or a user-level Skillset index.

Current focused result:

```text
9 pass
0 fail
412 expect() calls
```

## Complete classification

| Surface | Classification | Evidence and disposition |
| --- | --- | --- |
| Canonical inventory | Equivalent | Selective import reports exactly 16 skills and 39 files. Both generated skill roots contain the same 39 managed paths plus their command-owned lock. |
| Skill bodies | Equivalent | Every Claude body equals the canonical body; every Codex body equals the accepted legacy body. |
| Companions | Equivalent | Non-`openai.yaml` companions are byte-identical. `agents/openai.yaml` files are YAML-semantic equivalents with deterministic key/quote formatting changes. |
| Current file modes | Equivalent | The harness compares every canonical file mode with both 39-file temporary projections. All 39 canonical files and both projections are `0644`. |
| Claude-only `context` / `agent` | Equivalent after deliberate provider expression | Moving the two keys to `claude.frontmatter` on `clark-decision` and `clark-survey` preserves them in Claude and omits them from Codex. Leaving them top-level would incorrectly leak them into both targets. |
| Legacy target replacements | Equivalent because dormant | All seven configured source phrases are absent from the complete canonical corpus. The harness fails if any becomes live and therefore needs a new target-adaptation review. |
| Codex skill provenance | Intentional migration difference | Legacy `metadata.skillset` points at `scripts/codex/skillset.ts`; standalone output carries Skillset-generated metadata plus per-root lock ownership. Portable content remains semantically equal after removing generator-only metadata. |
| Managed locks | Intentional addition | `.claude/skills/skillset.lock` and `.agents/skills/skillset.lock` each own exactly 16 items/39 files with exact per-skill kind, name, source, output, and file mapping. Root `skillset.lock` exactly maps the five project-agent/native-island outputs with build mode and unique ownership. |
| Exact release provenance | Intentional caveat | `package.json` and `bun.lock` pin npm `skillset@0.22.0`; locks say `generatedBy: skillset@0.1.0`, the bundled compiler/protocol marker. Review must use both sources. |
| Drift detection | Equivalent and stronger for bytes | After a clean temporary build, `skillset check --only outputs` passes; a temporary target-side byte edit fails and restoring the bytes passes. |
| Mode drift detection | Blocking outside current slice | A separate hermetic fixture imports a `0755` companion, observes a generated `0644` file, changes the output back to `0755`, and proves `check --only outputs` still passes. Current 0644 skills are unaffected; SET-394 blocks TRL-1274. |
| Codex Clark/Lewis | Equivalent | Standalone project-agent rendering preserves names, descriptions, models, reasoning effort, sandbox mode, nicknames, and developer instructions. Header comments and surrounding TOML-string whitespace are non-semantic. |
| Claude Lewis | Equivalent | Portable project-agent source reproduces provider frontmatter and body, with only generated provenance metadata added. |
| Claude maintainer | Equivalent | Claude-only portable project-agent source reproduces provider frontmatter and body, with only generated provenance metadata added. |
| Claude Clark | Blocking | A separate fixture attempts the exact portable profile and asserts the unmanaged provider skill `trails` rejection. The accepted target-native Markdown island fallback then preserves the remaining profile but strips `model: fable`. SET-396 blocks source adoption until a released Skillset path preserves both. |
| Project-agent adoption | Intentional manual work | The mixed-root adoption fixture records Skillset's explicit project-agent survey skip and proves `.skillset/agents` remains unpopulated. Clark/Lewis/maintainer sources must be authored deliberately after SET-396 is resolved. |
| `init --adopt all` | Blocking workflow, safe bypass proven | A temporary mixed-root fixture proves `.agents/skills` is selected before `.claude/skills`, is partially written, and then collides with the canonical root. SET-395 remains open. Selective `import <path> --kind skills --from claude` succeeds completely. |

## Safety and scope

- No live generated provider tree was written by the harness.
- No global Skillset activation or HOME provider configuration was touched.
- No executable-mode workaround was added.
- No plugin projection was adopted or generated.
- No Warden fact interpretation moved into Skillset.
- PRs #990 and #991 were not edited or rewritten.

## Readiness consequence

TRL-1271 can proceed as a completed parity proof once its local/hosted review gates pass. TRL-1272 must remain dependency-blocked on a published SET-396 fix and a refreshed exact pin; TRL-1274 independently remains blocked on a published SET-394 fix.
