# Assess: Milestone Review

Milestone review. Check the work against the plan. Trail posture applied to a body of work, not individual lines of code.

## What to Evaluate

### 1. Contract Fidelity

Did what was built match what was planned? Compare the implemented trails, schemas, and trailheads against the ADR, spec, or planning document that authorized the work.

- Are the trail IDs what was specified?
- Do the schemas match the agreed shapes?
- Are the error types from the taxonomy?
- Do examples cover the agreed happy paths and failure modes?
- Are `crosses` declarations accurate to actual composition?

Run `trails warden` and `trails survey --brief` to get the current state. Do not rely on memory of what the codebase looked like before.

### 2. Architectural Alignment

Does the implementation honor the hexagonal model?

- Implementations are pure. No trailhead-specific types in trail logic.
- Provisions accessed through declared dependencies, not ambient imports.
- Trailheads delegate to the execution pipeline. No reimplementation of `validate-resolve-execute`.
- New packages or subpaths follow the framework's port/adapter pattern.

### 3. Information Architecture

Apply the drift guard checklist to anything new:

- Is anything being authored that could be derived?
- Are declarations enforced at the right level (compile, test, lint, diff)?
- Did any new override get introduced? Is it justified?

### 4. Scope and Creep

Did the implementation stay within scope? Look for:

- Features that were not part of the plan but got added anyway.
- Abstractions that were introduced prematurely.
- Patterns that should be primitives (or primitives that should be patterns).

Scope creep during agent-driven sprints is common because agents optimize for completeness. The question is not "is this good code" but "was this the plan."

### 5. Test Coverage

- Does `testAll(app)` pass?
- Do examples cover the new trails?
- Are edge cases covered with `testTrail` scenarios?
- If composition was added, are cross chains tested?
- Does the warden report any new violations?

## Output

```markdown
## Assess: [milestone name]

### Summary
One paragraph: what was planned, what was built, overall alignment.

### Findings

#### Aligned
- [what matches the plan, briefly]

#### Drift
- [what diverged from the plan]
- [for each: is this intentional evolution or unplanned drift?]
- [for each: recommended action — accept and document, or correct]

#### Missing
- [what was planned but not implemented]
- [for each: is this deferred or dropped?]

#### Concerns
- [anything that worries you architecturally]
- [vocabulary issues spotted]
- [information architecture violations]

### Recommendations
Numbered list, most important first. Each actionable.
```

If findings warrant Linear issues, draft them with clear titles, descriptions, and suggested labels/priority.

## Reference

- The planning document, ADR, or spec that authorized this work (varies per milestone)
- `docs/adr/` — the relevant ADRs for this scope
- `AGENTS.md` — current conventions the implementation should follow
