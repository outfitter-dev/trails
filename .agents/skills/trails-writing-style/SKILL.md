---
name: trails-writing-style
description: "Trails prose craft and lexicon style. Use when writing or reviewing docs, ADRs, examples, release notes, agent prompts, comments, PR descriptions, or issue language for rhythm, clarity, and vocabulary precision."
metadata:
  version: 0.1.0
  author: trails
  category: content
  skillset:
    generator: scripts/codex/skillset.ts
    target: codex
    version: 1
    source: .claude/skills/trails-writing-style
    source-file: .claude/skills/trails-writing-style/SKILL.md
---

# Trails Writing Style

> **Vocabulary is mid-cutover toward the v1 reset.** Describe current code with current-live terms; see `docs/lexicon-pending.md` for terms ratified to change, and do not adopt the targets early.

This skill covers how Trails prose should read: sentence rhythm, structural patterns, examples, and vocabulary discipline.

For the larger stance, load `trails-writing-voice`. For document placement and required sections, load `trails-writing-docs`.

## Start From The Contract

Trails writing should follow the same shape as Trails itself:

1. **Define** the authored truth.
2. **Derive** facts the framework already knows.
3. **Render** the right surface, doc, example, check, or report.

This is both architecture and writing style. Avoid asking readers to reconcile three versions of the same idea.

## Sentence Rhythm

Use a mix of:

- **Claim:** one sentence that can stand alone.
- **Reason:** why the claim matters.
- **Consequence:** what breaks or gets easier.
- **Example:** code, command, or concrete output.

Short sentences carry decisions. Longer sentences are allowed when they earn their room by explaining a real tradeoff.

Avoid uniform paragraph sludge. If a paragraph has more than one job, split it.

## Headers

Headers should help the reader navigate.

Prefer headers that name the work:

- `Fresh App Loading`
- `Release Intent`
- `Surface Accommodations`
- `What This Does Not Decide`

Avoid decorative or vague headers:

- `Overview`
- `Background`
- `More Details`
- `Things To Consider`

`Overview` and `Background` are acceptable only when the document template requires them. Even then, make the first sentence do real work.

## Examples Are Primary Evidence

An agent or developer should often understand the rule from the example before they read the prose.

Good examples:

- include imports when imports matter;
- show the authored contract and the resulting surface or behavior;
- include expected output for commands;
- show failure cases when failure behavior is part of the contract;
- are runnable or clearly marked as abridged.

Avoid examples that hide the important part behind `...`.

For worked good-and-bad samples across docs and narrative containers, see `assets/SAMPLES.md`.

## Voice Mechanics

Prefer:

- active voice;
- concrete nouns;
- direct verbs;
- exact file paths, commands, issue IDs, or ADR links when relevant;
- "this means" lists after dense claims;
- "the test:" heuristics when a reviewer needs to apply a rule.

Avoid:

- hedging settled decisions;
- inventing synonyms for variety;
- corporate filler;
- marketing superlatives;
- unexplained jargon;
- clever metaphors that require decoding;
- passive voice that hides who acts.

## Vocabulary Discipline

Use the current project vocabulary from `docs/lexicon.md`, `AGENTS.md`, ADRs, and `docs/lexicon-pending.md`.

Current high-signal direction (stable terms; for terms mid-cutover see `docs/lexicon-pending.md`):

- `trail`, not action, endpoint, handler, or route for the unit of work.
- `surface`, not transport, when naming the outside boundary.
- `topo` for the assembled Trails graph primitive.
- `compose`, not cross, follow, call, invoke, route, or workflow for trail-to-trail composition.
- `implementation` for the authored behavior field.
- `resource` for declared infrastructure dependencies.
- `layer` for typed execution wrappers.

Grouped surface entries and the derive/render split are mid-cutover. Describe current code in current terms and follow `docs/lexicon-pending.md`. Preserve retired terms only in explicitly historical release, migration, or decision evidence.

`docs/lexicon-pending.md` is the transition control surface. Its Current column describes live reality; its Target column describes ratified reset direction. Do not adopt target terms in code, docs, examples, or plugin guidance before the cutover unless the work is explicitly part of that reset.

## Theme Is Not A Checklist

Outdoor language belongs when it clarifies official concepts. It does not belong as decorative prose.

Good:

> A `detour` names a recovery strategy for a failed trail, not general control flow.

Bad:

> Pack your gear before trekking into the terrain of release configuration.

Use plain words unless the themed word carries the concept better.

## Replacement Patterns

| Weak phrasing | Stronger phrasing |
| --- | --- |
| "This is a flexible way to expose functionality." | "This renders the same trail contract on CLI and MCP without re-authoring behavior." |
| "We might want to consider adding checks." | "Add a Warden rule when drift can be detected from authored facts." |
| "The handler processes the request." | "The trail receives validated input; its implementation returns a `Result`." |
| "Run the implementation directly." | "Run the trail through the shared execution pipeline." |
| "The CLI route has different behavior." | "This needs a distinct trail unless the input normalizes into the same contract without lying." |

## Review Checklist

When reviewing Trails prose:

- Is the first claim clear enough to quote?
- Does each paragraph have one job?
- Are examples concrete and aligned with current source?
- Are themed terms official or genuinely clarifying?
- Are ratified future terms distinguished from current live code when needed?
- Are `derive` and `render` used with distinct meanings?
- Does the text avoid synonym drift?
- Does the document teach the check or heuristic an agent should apply later?
