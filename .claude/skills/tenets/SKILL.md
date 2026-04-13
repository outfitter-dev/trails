---
name: tenets
description: "Trails framework design tenets — the foundational beliefs, promises, primitives, and patterns that govern the framework. Use when evaluating architectural decisions, reviewing feature proposals, checking alignment with framework principles, or when tenets, principles, or design philosophy are mentioned."
---

# Trails Design Tenets

These are the constitutional layer of the Trails framework. They govern. Where the repo drifts from these tenets, it's the repo that should be brought into alignment, not the tenets.

When evaluating any feature, API, or pattern against these tenets, treat them as the highest authority after the core premise (ADR-0000). They change only when the framework's model of the world changes, which should be rare.

Use these tenets to:

- **Evaluate proposals.** Does a new feature reinforce or fragment the existing story?
- **Resolve ambiguity.** When two approaches seem equivalent, the one more aligned with these tenets wins.
- **Challenge drift.** If code or convention contradicts a tenet, the code is what needs to change.
- **Ground decisions.** Every architectural ruling should trace back to a principle here.

For deeper architectural judgment, vocabulary enforcement, or to challenge a tenet itself, consult the `clark` agent. Clark is the framework's co-architect and constitutional guardian.

---

!`cat "$(pwd)/docs/tenets.md"`

---

!`cat "$(pwd)/docs/adr/0000-core-premise.md"`
