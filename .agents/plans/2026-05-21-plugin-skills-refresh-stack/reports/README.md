# Reports

Expected execution reports:

- `local-review-round-1-skill-docs.md`
- `local-review-round-2-tooling-hooks.md`
- `local-review-round-3-dogfood-release.md`
- `trl-752-dogfood.md`

Local review reports should use:

```markdown
Overall score: n/5

Summary:
<short prose judgment>

Findings:
- P0/P1/P2/P3 - <path:line or artifact> - <finding>
  Prompt To Fix With AI:
  <concise fix prompt>
```

Severity reminder:

- P0: cannot proceed.
- P1: correctness, public contract, or doctrine contradiction.
- P2: documentation correctness, misleading examples, missing tests/checks, noisy hooks, or release safety issues.
- P3: style-only polish.

Documentation correctness is P2 by default.
