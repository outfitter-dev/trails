---
description: The working-on-Trails doctrine digest — what governs the framework, the decision tools for framework work, and where truth lives. Use at the start of any session that changes Trails itself (framework code, docs, vocabulary, governance), when orienting a new agent or persona, or when deciding which governing source answers a question. Not for building apps with Trails; the trails skill covers consuming the framework.
metadata:
  generated: skillset@0.1.0
  version: 0.1.0
name: building-trails
---

# Building Trails

Trails is built contract-first, and the contract for how Trails is worked on is itself layered and governed. This skill is the digest: the governing order, the drift guard, the scoped evaluation hierarchy, and the map of where truth lives. It points at the full sources rather than copying them — when this digest and a governing source disagree, the source wins.

## What governs, in order

1. **The core premise** (ADR-0000): author what's new, derive what's known, override what's wrong.
2. **Tenets** (`docs/tenets.md`; digest in the `tenets` skill): the constitutional layer. Where the repo drifts from the tenets, the repo changes.
3. **Accepted ADRs** (`docs/adr/`): the human-readable contracts for what Trails is and is not. Drafts are direction, not law.
4. **Lexicon** (`docs/lexicon.md`): current framework language. Describe live reality with live terms; use the applicable typed transition registry and accepted release plan when moving vocabulary.
5. **Contribution guides** (`docs/contributing/`): language styleguide, code standards, Warden rules, codebase navigation, script graduation.
6. **`AGENTS.md`** and the nearest scoped guidance: current commands, workflow, and discipline.
7. **Decision history** (`.agents/memory/decisions.md`): prior rulings with their reasoning, for judging edge cases.

## Decision tools for framework work

**The drift guard** — for any proposed feature or fact, prefer the highest rung that honestly holds it:

1. Can the framework derive it instead of requiring authoring?
2. If authored, does the compiler catch inconsistency?
3. If not, does testing against examples catch it?
4. If not, does Warden catch it?
5. If not, does diffing the resolved graph catch it?
6. Freeform is acceptable only for meta.

If a change requires authoring information the framework already has, that is a framework bug. If authored information can drift from reality and nothing catches it, the feature needs redesign.

**The evaluation hierarchy** — when a recurring structural pattern starts demanding machinery, walk in order and stop at the first rung that fits: strengthen an existing primitive, codify a pattern, introduce a new primitive (ironclad justification only), broaden built-in capability (net win across the system, never a convenience in one spot). Most "new primitives" are an option on an existing surface one rung down.

## Vocabulary discipline

The closed grammar governs module exports; methods and trail ids follow colloquial conventions; prose teaches with the live lexicon. Renames are cheap now (Regrade, governed transitions, committed evidence) — which raises the bar for speculative renames and lowers it for principled ones. Route word-level decisions through Clark for architectural judgment; Matt retains final ratification. Never leave a vocabulary change half-applied.

## Evidence discipline

- Checkpoint probabilistic steps through deterministic artifacts: the lock is the story of the system. Generated and rendered evidence must be reproducible and never hand-edited. Regrade ownership stays split: the active plan owns authored intent; Git owns changed content; compact history receipts retain reproducibility keys, durable judgments, and completion facts; reports and audits derive detailed occurrence views.
- An agent-produced stack does not merge without a fresh-context verification pass against written acceptance from the request, plan, issue, ADR, or specification: quoted evidence with file and line, "unable to verify" acceptable, invented citations a hard failure.
- Apply the same rigor to your own reconnaissance: an empty search is a claim, not a fact. Verify whether main already delivers an ask before implementing it — verified already-done, with evidence, is a valid completion.

## Done means shipped whole

Feature work carries its distribution story: docs and examples, agent guidance, governance, release intent, migration path (`AGENTS.md` § Distribution-Ready Done). Internal-only work marks those surfaces not applicable visibly. A milestone is done when a usable end-to-end path exists, not when each part compiles.

## Where to go deeper

- Framework consumption (building apps *with* Trails): the `trails` skill.
- Architectural judgment, vocabulary rulings, tenet questions: `be-clark`, or `ask-trails-crew` for a separate judgment.
- Execution shape, stacks, runs, review loops: `be-lewis`.
- Graph navigation: Wayfinder first (`AGENTS.md` § Wayfinder First).
