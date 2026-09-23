---
description: Draft or review Trails docs, ADRs, README content, release notes, examples, agent guidance, and prose-heavy changes with one contributor editorial workflow. Use for writing, restructuring, or editorial readiness checks.
license: MIT
metadata:
  author: trails
  category: documentation
  skillset.schema: "1"
  version: 0.1.0
name: trails-editorial
---

# Trails Editorial

Use one workflow for drafting and reviewing Trails prose. The governing sources stay in the Trails checkout; this skill carries the method and a small set of worked craft samples, not a second copy of the project doctrine.

## Establish The Task

Identify the target, document type, audience, current source of truth, and whether the task is read-only or may write. If no target is named, choose the smallest target supported by the conversation or current diff.

Classify the document before writing:

- guides teach a task and its failure modes;
- reference pages provide exact lookup;
- ADRs state a consequential decision and its tradeoffs;
- release notes tell operators what changed and what to do;
- READMEs orient quickly and link deeper;
- agent guidance gives triggers, rules, stop conditions, and proof;
- working notes may preserve uncertainty and are not doctrine.

## Load Current Owners

When working in the Trails repository, read only the owners needed for the target:

1. `AGENTS.md` and the nearest scoped guidance.
2. `docs/tenets.md`, accepted ADRs, and `docs/lexicon.md` when doctrine or vocabulary is material.
3. `docs/contributing/language-styleguide.md` for current contributor prose rules.
4. `docs/contributing/code-standards.md` for code and example shape.
5. The nearest current guide, reference page, runbook, or package source for technical claims.
6. `assets/SAMPLES.md` when worked prose examples would help.

Do not treat generated copies under `.agents`, `.claude`, `plugin`, or `plugins` as authoring sources. Outside the Trails checkout, ask for or locate the target checkout before claiming repository facts.

## Draft

1. State the decision, instruction, or user-visible change early.
2. Explain why it matters and what the reader should do next.
3. Use one canonical home and link to other owners instead of repeating them.
4. Add concrete code, commands, expected output, or failure examples when they are the best evidence.
5. Match the container: concise and runnable for a README, dense for reference, declarative for an ADR, and operator focused for release prose.
6. Mark abridged examples and distinguish live behavior from proposed work.

## Review

Review the target across five dimensions.

### Truth

- Verify code, CLI, package, and compatibility claims from current source or a command.
- Separate observed behavior, inference, proposal, and historical context.
- Require evidence before using confident language.

### Voice

- Write calmly, directly, and practically.
- Explain opinions because drift is expensive.
- Prefer ordinary words; use Trails terms when they carry a real distinction.
- Avoid marketing claims, corporate filler, and hedging settled decisions.

### Craft

- Give each paragraph one job.
- Use short sentences for decisions and longer sentences for real tradeoffs.
- Prefer active voice, concrete nouns, direct verbs, and exact paths or commands.
- Use headers that name the work. Use `Overview` or `Background` only when a required template calls for them.

### Vocabulary

- Use `trail`, `implementation`, `topo`, `compose`, `surface`, `resource`, `layer`, `derive`, and `render` with their current project meanings.
- Preserve retired terms only in explicit migration, release, or historical evidence.
- Use outdoor language when it clarifies an official concept, not as decoration.

### Structure And Distribution

- Keep one canonical owner for each fact.
- Put public and contributor docs under the nearest existing `docs/` section; keep agent guidance in canonical Skillset source.
- Update examples, governance, agent guidance, migration notes, and release intent when the affected behavior requires them, or record why each is not applicable.
- Verify links and companion files from the canonical source and from the generated bundle when the change affects distribution.

## Commands And Side Effects

Choose the smallest check that proves the target. Common read-only checks are:

```bash
bun run docs:links
bun run docs:wrap-check
bun scripts/adr.ts check
bun run plugin:metadata:check
bun run skillset:check
git diff --check
```

`bun scripts/adr.ts map` writes ADR map artifacts. Run it only when the task is authorized to update those artifacts, then inspect and stage its exact output. `bun run skillset:sync` also writes managed outputs and locks; edit canonical `.skillset` source first and inspect the generated diff.

For technical claims, run a focused test or command. Do not run a broad gate only to make the report look complete.

## Findings And Fix Loop

Classify review findings:

- **P0:** materially false or unsafe.
- **P1:** likely to make a user or agent take the wrong action.
- **P2:** vocabulary, ownership, structure, or missing distribution guidance that will cause drift.
- **P3:** selective polish or clarity improvement.

When writes are authorized, fix P0-P2 and nearby useful P3 findings, rerun the focused checks, and repeat. For a read-only task, report the smallest exact change that would resolve each finding.

Finish with `ready`, `ready with nits`, `needs fixes`, `blocked`, or `wrong target`, followed by reviewed files, changes, checks, remaining risks, and the next action.

## Report

```markdown
State: ready | ready with nits | needs fixes | blocked | wrong target

Reviewed:
- path

Findings:
- [P2] path:line - Issue and smallest fix.

Changed:
- path - Summary.

Verification:
- command - pass | fail | not run, with evidence.

Remaining:
- Risk, decision, or follow-up.

Next:
- Exact next action.
```
