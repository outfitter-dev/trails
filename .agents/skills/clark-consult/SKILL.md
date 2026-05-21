---
name: clark-consult
description: Dispatch the Codex custom subagent `clark` for Trails architectural decisions, vocabulary enforcement, sprint reviews, tenet checks, or any request to "ask Clark", "consult Clark", "let Clark decide", or get a CTO ruling.
---

# Clark Consult

Use this skill when the user wants Clark's judgment as a separate Codex agent rather than the main agent imitating Clark inline.

## Invocation Shape

Clark is skill-first.

- If the user asks the current agent to "be Clark", "personify Clark", "answer as Clark", or otherwise embody Clark inline, load the `clark` skill directly and answer in that posture.
- If the user asks to "ask Clark", "consult Clark", "have Clark review", "let Clark decide", or otherwise wants a separate judgment from Clark, use this `clark-consult` skill and dispatch the custom agent.
- If the user asks for Clark pathfinding, do not use the custom-agent dispatch path. Load the `clark` skill inline, then use the `clark-pathfinding` playbook in the same session.
- The canonical Clark identity lives in `.agents/skills/clark/SKILL.md`, which is symlinked to the Claude Clark skill. `.codex/agents/clark.toml` is a generated custom-agent wrapper, not a second source of truth.
- After changing the Clark skill, regenerate the custom-agent wrapper with `.agents/skills/clark-consult/scripts/render-clark-agent`.

## Workflow

1. Identify the mode:
   - **Compass:** quick gut check.
   - **Decision:** one concrete ruling.
   - **Pathfinding:** open-ended architectural exploration. This is inline Clark plus the `clark-pathfinding` playbook, not custom-agent dispatch.
   - **Survey:** broad health scan.
   - **Assessment/calibration/debrief:** review against plan, vocabulary precision, or sprint retrospective.
2. Gather the minimum concrete anchors Clark needs: files, ADRs, tenets, Linear issue IDs, PR numbers, scratch notes, or the exact question.
3. For non-pathfinding modes, spawn the custom agent named `clark`. Fork context when the current conversation contains relevant constraints; otherwise pass a self-contained brief.
4. Ask Clark for a ruling with evidence and confidence. Say that "unable to verify" is acceptable and invented references are not.
5. Wait for Clark's result before presenting the final answer when the user's next step depends on it.
6. Preserve Clark's judgment distinctly in the response. Clark's own instructions own decision logging for authoritative decisions; if Clark cannot write the log entry in the current runtime, preserve the ready-to-log entry verbatim and say that it still needs to be appended to `.agents/memory/clark-decisions.md`.

## Dispatch Template

```text
You are Clark for Trails. Mode: <compass | decision | survey | assessment | calibration | debrief>.

Question:
<exact question>

Required anchors:
<files, ADRs, issue IDs, PRs, or scratch notes>

Return:
- Ruling or recommendation
- Basis in the constitutional hierarchy
- Confidence
- Alternatives considered
- Confirmation that an authoritative decision was logged, or a ready-to-log decision entry if logging was not possible

Do not run git or Graphite write operations. Do not invent citations; mark unknowns explicitly.
```

## Local Surfaces

- Custom agent: `.codex/agents/clark.toml`
- Optional direct-session helper: `.agents/skills/clark-consult/scripts/ask-clark`
- Canonical Clark skill: `.agents/skills/clark/SKILL.md` (symlinked to `.claude/skills/clark/SKILL.md`)
- Claude agent profile: `.claude/agents/clark.md`
- Clark skills: `.agents/skills/clark`, `.agents/skills/clark-decision`, `.agents/skills/clark-pathfinding`, `.agents/skills/clark-survey`
- Tenets skill: `.agents/skills/tenets`
- Decision log: `.agents/memory/clark-decisions.md`
