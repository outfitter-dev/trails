# Bugbot Review Rules

Use these repository rules when reviewing Trails pull requests.

## Finding Format

Format each actionable finding heading as:

```markdown
### [P2] Short finding title
```

Do not use a separate severity label such as `**Medium Severity**`.
Do not include confidence scores on individual findings.

Use the Trails severity scale:

- `P0`: Cannot proceed. Security, data loss, secret exposure, broken release path, destructive behavior, or a required gate made impossible.
- `P1`: Correctness or contract regression. Runtime bug, broken public API, migration corruption, lost audit trail, or contradiction of an issue, spec, ADR, or documented contract.
- `P2`: Important quality issue to fix before handoff or ready. Missing or wrong docs, misleading help, missing test coverage, false diagnostics, brittle plausible user breakage, or maintainability issue with clear future cost.
- `P3`: Style, naming taste, optional refactor, minor formatting, or polish with no correctness, docs, API, or release impact.

## PR-Level Confidence

Include one confidence score in the review summary, not on each finding:

```markdown
**Confidence:** 4/5
```

Use the confidence score as a PR-level merge-readiness signal: how confident
you are that the PR accomplishes its intended job and is safe to move forward.

- `5/5`: merge-ready. The PR's intent is clear, the implementation matches it,
  required checks/evidence are present, review found no unresolved blockers, and
  remaining risk is negligible.
- `4/5`: likely ready after a small explicit follow-up, such as one pending
  check, one low-risk assumption, or a minor non-blocking clarification.
- `3/5`: not ready yet. The direction looks plausible, but there is a material
  open question, missing proof, or unresolved review item that should be handled
  before merge.
- `1/5` or `2/5`: do not treat the PR as mergeable. Use these when the PR is
  missing core evidence, has unclear intent, or contains unresolved high-risk
  concerns.

When the confidence is below `5/5`, say what would raise it. Do not use `5/5`
unless you would be comfortable with the PR merging after required hosted checks
and review threads are clean.

Update the PR-level confidence when reviewing a new push. Raise it when new
evidence resolves uncertainty; lower it when the PR changes in ways the review
did not fully inspect.

Documentation correctness is `P2` by default. Reserve `P3` for style-only wording.

## Trails Review Focus

- Prefer repo scripts and hooks over one-off commands. For environment bootstrap, favor reproducible installs (`bun install --frozen-lockfile`) unless the change intentionally refreshes dependency metadata.
- Do not recommend adding provider-specific operational instructions to `AGENTS.md` when the behavior can live in provider config or shared lifecycle scripts.
- For publishable package changes, check release intent: changesets or an explicit `release:none` reason must live on the owning branch.
- Treat generated artifacts as regenerated. Do not suggest hand-editing generated files unless the repo explicitly owns them.
- Keep Trails vocabulary precise. Current live terms are `trail`, `implementation`, `topo`, `compose`, `surface`, `resource`, and `layer`; pending v1 vocabulary belongs only where the repo already documents the cutover.
- Trail logic should remain surface-agnostic: no `Request`, `Response`, MCP session, or CLI-specific types inside implementations or shared trail code.
- Implementations return `Result` values and should not throw for expected failures.
- Trails that compose other trails should use `ctx.compose()` and keep `composes` declarations aligned.
- Public MCP/HTTP surface trails need output schemas, and examples/docs should stay aligned with authored schemas.
