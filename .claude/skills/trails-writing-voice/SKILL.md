---
name: trails-writing-voice
description: 'Trails writing voice and values. Use when drafting or reviewing Trails docs, ADRs, README content, release notes, agent guidance, or public explanations for stance, audience, and tone.'
metadata:
  version: '0.1.0'
  author: trails
  category: content
---

# Trails Writing Voice

The v1 vocabulary families are live. Use `derive` for contract-owned fact production and `render` for surface presentation.

Trails writes like a framework with a spine.

We are opinionated because drift is expensive. We explain those opinions because agents and developers need to trust the path, not memorize it. The voice should feel calm, direct, practical, and awake to tradeoffs.

## Core Stance

| Principle | In practice |
| --- | --- |
| Contract-first | Lead from authored contracts and what they make possible. |
| Agent-native | Structure for agents and humans at the same time. |
| Drift-resistant | Explain how the framework makes consistency easier than divergence. |
| Evidence-backed | Anchor claims in code, checks, examples, ADRs, or measured behavior. |
| Plain by default | Use ordinary words when they carry the concept. Use Trails terms only when they earn the slot. |
| Teachable | A good paragraph should make the next correct action easier. |
| Distribution-aware | Feature work is not done until docs, examples, guidance, governance, and release posture are handled or explicitly not applicable. |

## Audience

Write for three readers at once:

- **Developers** deciding whether the framework helps them ship.
- **Contributors** trying to preserve the shape of the framework.
- **Agents** navigating the repo, deriving behavior, and avoiding drift.

This does not mean writing more. It means writing with structure:

- clear headings;
- concrete examples;
- explicit inputs, outputs, and failure modes;
- exact commands when commands are the point;
- links to source-of-truth docs instead of repeated doctrine.

## Voice

Trails voice is:

- **Confident, not inflated.** State decisions clearly. Do not market them.
- **Precise, not brittle.** Name the concept, the boundary, and the exception.
- **Warm, not chatty.** Help the reader feel oriented without adding filler.
- **Practical, not abstract.** Show how the idea changes code, checks, or workflow.
- **Curious, not tentative.** It is fine to name open questions. Do not hedge settled decisions.

Prefer:

> Define the trail once. Derive what the framework already knows. Render each surface from that shared contract.

Avoid:

> Trails aims to provide a flexible and potentially powerful way to create multiple integrations.

## Tone By Container

| Container          | Tone                                                           |
| ------------------ | -------------------------------------------------------------- |
| README quick start | Fast, concrete, copy-pasteable.                                |
| Guide              | Practical and explanatory. Show patterns and failure modes.    |
| Reference          | Dense and exact. Personality gets out of the way.              |
| ADR                | Declarative and reasoned. Tell the tension, then the decision. |
| Release note       | Operator-focused. What changed, why it matters, what to do.    |
| Agent guidance     | Direct. Give rules, stop conditions, and verification.         |
| Blog or narrative  | More room for voice, but claims still need evidence.           |

## The Theme Rule

Trails can use outdoor and wayfinding language when it clarifies the mental model. Theme is not a writing quota.

Use themed terms when they are official vocabulary or carry the concept better than a plain word: `trail`, `topo`, `surface`, `warden`, `wayfinder`, and `detour`.

Do not decorate ordinary prose with theme language when a plain word is clearer.

The test:

> Does the word reduce translation effort for a new agent or developer?

If yes, keep it. If no, say it plainly.

## Earned Confidence

Trails docs can be strongly worded when the claim is backed by proof.

Good sources of proof:

- runnable examples;
- type signatures;
- Warden rules;
- tests;
- CLI output;
- ADRs;
- fresh consumer smoke tests;
- repository commands and generated artifacts.

Weak sources:

- vibes;
- future promises;
- "should be easy";
- claims about other tools without citations;
- unverified memory of older branches.

## Ownership

Use "we" when speaking as the project. Use direct imperatives when giving instructions.

Prefer:

> Add a changeset on the branch that changes the publishable package.

Avoid:

> It is recommended that a changeset should be considered.

## Review Checklist

When reviewing a Trails document for voice:

- Does it state the decision or instruction without hedging?
- Does it explain the why enough for an agent to preserve the behavior later?
- Does it use Trails vocabulary because it helps, not because it sounds themed?
- Are claims backed by source, command, test, ADR, or example evidence?
- Does the container shape match the reader's job?
- Does it avoid marketing language and corporate filler?
- Does it make the next correct action clearer?
