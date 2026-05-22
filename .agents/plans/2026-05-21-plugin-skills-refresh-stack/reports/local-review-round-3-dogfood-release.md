# Local Review Round 3: Dogfood And Release Readiness

Date: 2026-05-22
Stack tip: `trl-753-republish-trails-plugin-and-document-the-release-path`
Score: 4/5

## Summary

The dogfood report is candid and the release runbook carries the right stop rules. The disposable project smoke tested the refreshed guidance across CLI, MCP, HTTP, resource mocks, `testAllEstablished`, `testSurfaceParity`, Warden, and local compile/validate. The report does not hide the two important risks: raw scaffold output needed repair, and the currently published `@ontrails/trails@1.0.0-beta.18` CLI lacks `compile`/`validate` even though the current repo CLI exposes them. `TRL-757` through `TRL-760` remain tracked follow-ups, not silently absorbed into this stack.

## Evidence

- `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/trl-752-dogfood.md:35` records raw scaffold typecheck/lint/format failures.
- `.../trl-752-dogfood.md:69` records the repaired disposable app passing typecheck, test, build, lint, format, and CLI smoke.
- `.../trl-752-dogfood.md:87` records published Warden passing with expected warnings.
- `.../trl-752-dogfood.md:99` records published CLI missing `compile`/`validate`; `:101` records local CLI passing those commands.
- `docs/releases/plugin-release.md:14` defines stop rules for registry, marketplace, `npx skills`, and global installed-skill mutation.
- `docs/releases/plugin-release.md:64` carries the dogfood gate and `:75` warns not to imply published CLI support for repo-only commands.
- `docs/releases/plugin-release.md:120` requires merged PRs, green CI, clean reviews, `TRL-755`, and `TRL-757`-`TRL-760` disposition before external publication.
- `bun run publish:check` passed read-only pack checks; `bun run publish:registry-check` passed read-only registry/dist-tag probes.
- No publish, marketplace mutation, `npx skills`, global skill mutation, merge, merge queue label, or `gt absorb` was run.

## Findings

| Severity | Finding | Evidence | Prompt To Fix |
| --- | --- | --- | --- |
| P3 | Release readiness still depends on operator disposition of the documented dogfood risks and version-bump choice before actual marketplace publication. The stack correctly documents these as release handoff checks, so this is not a blocker for draft/ready PR review. | `docs/releases/plugin-release.md:75`, `:82`, `:120`; `trl-752-dogfood.md:156`. | If the release owner wants a fully deterministic publication script later, promote the version-bump decision and dogfood risk gates into a separate release issue or script after this stack lands. |

## P0/P1/P2 Result

No P0/P1/P2 findings.
