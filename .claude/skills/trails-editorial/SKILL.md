---
name: trails-editorial
description: 'Complete Trails editorial review workflow. Use when reviewing docs, ADRs, README changes, release notes, agent guidance, or docs-heavy PRs for voice, style, structure, correctness, and readiness.'
metadata:
  version: '0.1.0'
  author: trails
  category: documentation
---

# Trails Editorial

The v1 vocabulary families are live. Use `derive` for contract-owned fact production and `render` for surface presentation.

Run a complete editorial review for Trails documentation and prose-heavy changes. This is a workflow skill. It should work in Claude, Codex, or any agent harness that can read skills, inspect files, and run commands.

## Load First

Before reviewing, load:

1. `trails-writing-voice`
2. `trails-writing-style`
3. `trails-writing-docs`

If one is unavailable, continue only after reading the corresponding `.agents/skills/<name>/SKILL.md` file directly. If the file is missing, report that as part of the review.

## Inputs

The target can be:

- one file;
- a directory;
- a PR diff;
- a stack;
- an ADR draft;
- a release note;
- agent guidance;
- a question such as "is this ready to merge?"

If no target is supplied, infer the smallest relevant target from the current conversation or working tree.

## Workflow

### 1. Establish Scope

Identify:

- target files;
- source-of-truth docs or ADRs;
- current branch and dirty state when working in a repo;
- whether the review is read-only or may edit.

Do not expand beyond the target unless a nearby file must change to keep the docs truthful.

### 2. Classify The Document

Classify each target as one of:

- guide;
- reference;
- ADR;
- release doc;
- README;
- agent guidance;
- issue or PR prose;
- working note.

Use that classification to decide what "good" means. A reference page should not sound like a blog post. A working note can preserve uncertainty. An ADR must state the decision.

### 3. Voice Review

Check against `trails-writing-voice`:

- Does it state decisions clearly?
- Does it respect both human and agent readers?
- Are claims evidence-backed?
- Is the tone right for the container?
- Does theme clarify rather than decorate?
- Does the document preserve distribution-ready done?

### 4. Style And Vocabulary Review

Check against `trails-writing-style`:

- Are terms current and consistent?
- Are ratified future terms distinguished from live code when needed?
- Are paragraphs focused?
- Are examples concrete?
- Does the prose use the live v1 vocabulary and confine retired terms to
  explicit historical evidence?
- Are old synonyms or retired terms creeping in?

### 5. Structure Review

Check against `trails-writing-docs`:

- Does the information live in the right current repo location?
- Is there one canonical home?
- Are links, references, and examples current?
- Does the doc include the sections its document type needs?
- Does it avoid duplicating information that should be linked?

### 6. Technical Verification

Run the smallest useful checks for the target.

Possible checks:

```bash
bun run docs:wrap-check
bun scripts/adr.ts check
bun scripts/adr.ts map
bun run plugin:metadata:check
bun run warden:agents:check
bun run check
git diff --check
```

Do not run broad checks just for ceremony. Choose the checks that prove the target.

For claims about code behavior, inspect source or run targeted tests. For claims about CLI output, run the command or state that it was not verified.

### 7. Findings

Report findings by severity:

- **P0:** materially false, unsafe, or blocks release correctness.
- **P1:** likely to mislead users or agents into wrong behavior.
- **P2:** vocabulary, structure, or missing-doc gap that will cause drift.
- **P3:** polish, clarity, minor duplication, or optional tightening.

Lead with P0-P2 findings. Include file paths and line numbers when possible. Keep P3s selective.

### 8. Fix Loop

If edits are allowed:

1. Fix P0-P2 issues.
2. Fix relevant P3 issues when they are nearby and low-risk.
3. Re-run targeted verification.
4. Repeat until the target is ready or blocked.

If edits are not allowed, produce a concise review with exact recommended changes.

### 9. Outcome

End with one of:

- `ready`;
- `ready with nits`;
- `needs fixes`;
- `blocked`;
- `wrong target`.

Include:

- files reviewed;
- files changed, if any;
- checks run and results;
- unresolved risks;
- exact next action.

## Goal Invocation Shape

For a larger editorial pass, use this generic goal shape:

```markdown
Goal: Bring [target docs/change/PR/stack] to Trails editorial readiness.

Done when:

- P0-P2 editorial, vocabulary, structure, and correctness issues are fixed or explicitly deferred with rationale.
- Relevant P3s are handled when they improve clarity without expanding scope.
- Required docs, skills, release notes, ADRs, and agent guidance are updated or marked not applicable.
- Verification commands pass or failures are explained with evidence.
- The final report lists changed files, checks, remaining risks, and exact next action.

Constraints:

- Follow `trails-writing-voice`, `trails-writing-style`, and `trails-writing-docs`.
- Keep changes scoped to the target and necessary nearby truth.
- Do not rewrite stable doctrine without an ADR or explicit approval.
- Distinguish current live code from ratified future vocabulary.
```

## Report Template

```markdown
State: ready | ready with nits | needs fixes | blocked | wrong target

Reviewed:

- path
- path

Findings:

- [P2] path:line - Issue and recommended fix.

Changed:

- path - Summary.

Verification:

- command - pass/fail/not run, with reason.

Remaining:

- Risk, decision, or follow-up.

Next:

- Exact next action.
```
