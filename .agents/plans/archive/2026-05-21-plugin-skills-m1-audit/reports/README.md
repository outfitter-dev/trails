---
created: 2026-05-21T21:29:29Z
updated: 2026-05-22T20:49:43Z
description: Template guide for M1 audit reports. Specifies the required sections for each report (issue ID, branch, scope, commands, findings table, unknowns, downstream changes, verification summary), the findings table shape with severity/evidence/finding/owner columns, and severity definitions (P0–P3).
impl_status: implemented
linear: []
references: []
---

# M1 Report Templates

Use these reports as evidence artifacts. Keep them source-backed and concise enough that a future implementation agent can act without rediscovering M1.

Each report should include:

- issue ID and branch name;
- scope inspected;
- commands run;
- findings table with severity, evidence, and owner issue;
- explicit unknowns;
- recommended downstream changes;
- verification summary.

For findings, use this shape:

```markdown
| Severity | Evidence | Finding | Owner |
| --- | --- | --- | --- |
| P2 | `path/to/file.md:42` - "<short quote>" | The plugin teaches stale trailhead vocabulary. | `TRL-746` |
```

Severity rules:

- P0: cannot proceed safely.
- P1: correctness, public contract, or doctrine contradiction.
- P2: documentation correctness, misleading examples, missing coverage, noisy hook risk, or stale tracker scope.
- P3: style-only or optional polish.

Documentation correctness is P2 by default.
