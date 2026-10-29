# Contributing to Trails

These guides are for people and agents working on the Trails repository itself. They describe how to preserve the framework's doctrine, code shape, and maintenance discipline while changing the project.

If you are building an app with Trails, start with the user-facing docs in [`docs/`](../index.md). If you are changing Trails, use these house guides:

- [Language Styleguide](./language-styleguide.md) — how to write about Trails
  concepts precisely.
- [Code Standards](./code-standards.md) — TSDoc, source anchors, escape-hatch
  criteria, and code shape conventions.
- [Codebase Navigation](./codebase-navigation.md) — repository orientation,
  source-of-truth locations, generated files, and symbol navigation.
- [Agent Guidance Ownership](./agent-guidance-ownership.md) — canonical owners,
  audiences, compatibility names, and generated Skillset package boundaries.
- [Package Ownership Map](./package-ownership.md) — current natural-altitude
  map for cross-cutting capabilities and proposed extractions.
- [Warden Rules](./warden-rules.md) — how to author and audit durable Warden
  and repo-local correctness rules.
- [Script Graduation](./script-graduation.md) — when root-script behavior must
  graduate into a Trails concept, and the binding vocabulary (native binding,
  adapter binding, adapter seam).
- [Stable Cutover Runbook](../releases/stable-cutover.md) and
  [Release Rules Check](../releases/release-rules-check.md) — release rules,
  branch-local release intent, and public trail contract release facts.

The split is intentional: framework concepts stay in the public docs, while repo maintenance standards live here.

## Bun setup

The package consumer engine floor is Bun 1.4.0 (`engines.bun >=1.4.0`). Repository checkouts use the `.bun-version` pin, currently 1.4.4, also declared by the root `packageManager`. Remote bootstrap uses strict mode and requires that exact version. Local compatible mode accepts the pinned patch or a newer patch in the same major/minor line; it does not accept older 1.4 patches against the 1.4.4 pin.

Run `./scripts/bootstrap.sh repo` to prepare a checkout. The shell entrypoint repairs a missing or incompatible Bun to the pin before dispatch; the repo bootstrap then enforces the host's policy and installs dependencies with the frozen lockfile. Repairing 1.4.0 to 1.4.4 is not direct acceptance of 1.4.0. `./scripts/bootstrap.sh doctor` diagnoses the environment without installing or repairing Bun.

Root `@types/bun` and generated scaffold dependency metadata use the Bun 1.4 type line. After changing dependency versions, run `bun run scaffold-versions:sync`, then `bun run scaffold-versions:check`.

Rerunning `trails create` upgrades the prior generated `@types/bun` range `^1.4.3` to the current scaffold default in standalone and workspace apps. Dry-run previews leave the project unchanged. Customized ranges and other historical pins remain conflicts; review those choices explicitly before rerunning.

See [Bun 1.4.4 Test Qualification](./bun-144-test-qualification.md) for the measured serial, bounded parallel, compatibility-pattern, and coverage results.

See [Bun 1.4.4 Surface Qualification](./bun-144-surface-qualification.md) for HTTP, CLI, MCP stdio, and disposable SQLite migration regression evidence.
