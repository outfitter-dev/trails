# Debrief: Retrospective

Not "is the code right" but "what did we learn?" Expedition posture applied to completed work. Reflective, honest, forward-looking.

## What to Reflect On

### 1. Patterns That Emerged

Did this sprint surface a recurring pattern that should be named?

- A composition pattern that multiple trails used the same way
- An error handling pattern that could become a framework utility
- A testing pattern that should be added to the testing guide
- A provision interaction pattern that suggests a new convenience

Apply the primitive-pattern-new-primitive hierarchy: is this a pattern that uses existing primitives well, or does it suggest a new primitive is warranted?

### 2. Friction Points

Where did agents or Matt (@galligan) fight the framework?

- APIs that were hard to use correctly
- Conventions that were frequently violated (possible sign the convention is wrong, not that agents are bad)
- Type errors that were confusing
- Boilerplate that felt redundant

Each friction point is either a documentation gap, a DX improvement opportunity, or evidence that a derivation rule is missing.

### 3. Vocabulary Health

Did any new terms creep in during the sprint? Did existing terms get used inconsistently? Calibrate catches specific violations. Debrief looks at the trend.

- Is the vocabulary holding up under real use?
- Are there concepts that need names but do not have them?
- Are any reserved terms ready to be locked?

### 4. ADR Implications

Does anything from this sprint warrant a new ADR or a superseding ADR?

Criteria for a new ADR:

- A decision was made that constrains future work
- A pattern emerged that should be standardized
- A tradeoff was accepted that should be documented

Criteria for superseding an existing ADR:

- The code has intentionally evolved past what the ADR describes
- The original decision's context has changed
- The consequences section needs updating based on real experience

### 5. Tenet Stress Test

Did any tenet get stressed during this sprint? Not about violation — about whether the work pushed up against the boundary of a principle in a way that revealed something.

If yes, note it. Do not propose an amendment in debrief unless the case is overwhelming. Most tenet observations are better as inputs to the next pathfinding session.

### 6. Horizon Updates

Did this sprint unlock or inform anything in `docs/horizons.md`?

- Did implementing a feature reveal that a horizon item is closer than expected?
- Did it reveal that a horizon item needs rethinking?
- Did a new horizon item emerge from the work?

## Output

```markdown
## Debrief: [sprint/milestone name]

### What We Built
Brief summary of the scope and what shipped.

### Patterns
- [pattern name]: [description, where it appeared, recommendation]

### Friction
- [friction point]: [what happened, recommended action]

### Vocabulary
- Health: [healthy / minor drift / concerning drift]
- New terms needed: [any, or none]
- Reserved terms ready to lock: [any, or none]

### ADR Recommendations
- [New ADR needed: topic and brief rationale]
- [Existing ADR needs update: which one, what changed]
- [None needed]

### Tenet Observations
- [Any tensions or stress points observed, for future pathfinding]

### Horizon Updates
- [Any changes to near/mid/long-term thinking]

### For Next Sprint
- [Carry-forward items, open questions, things to watch]
```

If ADR recommendations are concrete enough, draft the ADR outline (context, decision, consequences) as a starting point for the next pathfinding session.

## Reference

- `docs/horizons.md` — current future directions
- `docs/adr/` — existing ADRs to check for staleness
- `.trails/clark/decisions.md` — decisions made during this sprint
