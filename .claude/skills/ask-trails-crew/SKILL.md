---
description: Route a Trails question to native Clark and/or Lewis subagents and synthesize their distinct judgments. Use when the user asks the Trails crew, asks Clark or Lewis, requests an architectural or execution second opinion, wants both co-architects to review a question, or delegates a Trails judgment to the appropriate persona. Do not use when the current agent should embody Clark or Lewis inline; use be-clark or be-lewis instead.
metadata:
  generated: skillset@0.1.0
  version: 0.1.0
name: ask-trails-crew
---

# Ask Trails Crew

Remain the coordinating agent. Consult Clark, Lewis, or both through the current host's native subagent tools; do not imitate the selected persona in the parent session and do not launch a separate CLI process.

## Route By Ownership

Choose the smallest consultation that covers the question:

| Question shape | Route |
| --- | --- |
| Constitutional fit, primitives, tenets, vocabulary, ADR-level direction, framework coherence, or a delegated architectural ruling | Clark |
| Goal shape, issue or branch ownership, Graphite stack design, coordination, review, verification, release settlement, or execution learning | Lewis |
| A direction whose architectural ruling and landing strategy are both material | Clark and Lewis |
| A request to embody a persona in the current session | Do not consult; invoke `be-clark` or `be-lewis` inline |

When consulting both, choose the dependency shape deliberately:

- Run them in parallel when each can assess the same grounded question independently and disagreement is useful evidence.
- Run Clark first and pass the ruling to Lewis when execution planning depends on a constitutional decision.
- Run Lewis first and pass concrete execution evidence to Clark when the question is whether lived implementation pressure warrants reconsidering doctrine.

Do not summon both by default. A second subagent should add a distinct owned judgment, not ceremonial consensus.

Clark provides delegated architectural judgment; Matt remains the final decision owner. Once ADR direction is settled, route drafting and artifact maintenance to the maintainer agent or `trails-adrs` skill rather than asking Clark to own the mechanics.

## Ground The Consultation

Before dispatch:

1. State the exact question and the decision or next action it informs.
2. Gather the minimum current anchors: files, ADRs, tenets, issue or PR identifiers, branch facts, runtime evidence, or a concise conversation constraint.
3. Separate verified context from assumptions and unknowns.
4. State the authority boundary, preserved state, and prohibited side effects.
5. Decide whether the consultation is independent, sequential, or genuinely parallel.

Load only the host-specific reference needed for the current runtime:

- Claude Code: `references/claude-subagents.md`
- Codex: `references/codex-subagents.md`

## Dispatch Contract

Give each subagent a bounded, self-contained brief containing:

- the selected persona and owned question;
- the exact question, success criterion, and why the answer matters;
- required source anchors and any freshness checks;
- scope fences, preserved state, and current authority;
- an explicit statement that “unable to verify” is acceptable and invented evidence is not;
- the requested return shape: call, evidence, tradeoffs, confidence, unknowns, and next consequence;
- repository constraints and whether file or source-control writes are read-only or explicitly delegated, including the exact worktree, branch or stack, scope, and permitted operations when applicable.

Ask for evidence at the altitude of the claim. Require exact paths and tight line ranges for source claims, live-state evidence for runtime claims, and an explicit unknown when the evidence is unavailable.

Consultation is normally read-only because its output is judgment. The coordinating agent may delegate editing or source-control work when the task genuinely includes it; the brief, not the persona, owns that authority.

## Synthesize Without Flattening

Wait for every result that the user's next step depends on. Present each voice distinctly as **Clark** and/or **Lewis** before giving the coordinator's synthesis.

Do not manufacture agreement. When the judgments differ, name the disagreement, explain whether it is constitutional, evidentiary, or execution-shaped, and identify the decision owner. Distinguish advice from an authoritative decision and say whether any required decision entry remains unrecorded.

If native subagent dispatch is unavailable, report that limitation plainly. Return a ready-to-send consultation brief or, only when the user wants inline embodiment, route to `be-clark` or `be-lewis`; do not silently emulate a separate consultation.
