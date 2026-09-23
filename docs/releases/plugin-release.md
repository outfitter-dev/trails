# Skillset Plugin Release Runbook

This runbook covers both canonical plugin sources: adopter guidance at `.skillset/plugins/trails` and contributor guidance at `.skillset/plugins/trails-dev`. Skillset renders their Claude bundles under `plugin/` and `plugin-dev/`, their portable packages under `plugins/`, and the local marketplace manifest at `.claude-plugin/marketplace.json`. This path is separate from framework package publication in [Stable Cutover Runbook](./stable-cutover.md).

The current `trails` compatibility baseline is `0.3.4`; `trails-dev` starts at `0.1.0`. The bundled `trails` skill targets the current framework package version through `metadata.trails`. Plugin versions, the framework target, local output parity, marketplace state, and installed state are separate facts.

## Stop Rules

Do not run any of these without explicit operator approval:

- publish or mutate package registries;
- mutate Claude marketplace state;
- run `npx skills outfitter-dev/trails` against a real global install target;
- mutate `$HOME/.agents/skills/trails`, `$HOME/.config/claude/skills/trails`, `${CODEX_HOME:-$HOME/.codex}/skills/trails`, or the corresponding `trails-dev` paths.

If an installer or marketplace probe cannot be pointed at a disposable target, mark it externally/manual blocked instead of testing against a real profile.

## Preflight

Start from the stack tip or clean `main` after the plugin refresh stack merges.

```bash
git status --short --branch
bun run plugin:metadata:check
bun run warden:skills:check
bun run warden:agents:check
bun run skillset:check
bun test scripts/__tests__/sync-plugin-metadata.test.ts
bun test scripts/__tests__/check-installed-trails-skill.test.ts
bun test scripts/__tests__/detect-trails-hook.test.ts
bun run format:check
git diff --check
```

Run the installed-skill drift check, but interpret it as a release-readiness signal rather than an automatic sync command:

```bash
bun run plugin:installed-skill:check
```

Passing means local installed copies match the repo-bundled plugin skill. Failing means the plugin can still be released, but local/global skill copies must be treated as intentionally decoupled until an operator explicitly refreshes them.

## Dogfood Gate

Use the latest dogfood report from the active release packet before release. Every release packet should name fresh dogfood evidence. The report must cover:

- registry `bun install` succeeds for scaffolded package ranges;
- a repaired disposable app passes typecheck, tests, build, lint, format, CLI smoke, Warden, `testAllEstablished` from `@ontrails/testing/established`, `testSurfaceParity` from `@ontrails/testing/surface-parity`, and the CLI, MCP, and HTTP harness helpers from their matching testing subpaths;
- raw scaffold output findings are recorded, including any lint, format, typecheck, or Warden coaching needed before the disposable app is clean;
- published CLI command coverage is compared against current repo CLI command coverage.

The stable-RC refresh has newer framework evidence than the older beta.18 plugin refresh: generated apps install from the public registry, `trails release check --json` works in generated apps without workspace files, and the published beta line exposes top-level `compile`, `validate`, `diff`, `warden`, and release-check surfaces. Do not carry old beta.18 risk language forward without re-running the current dogfood gate.

## Bundle Contents

If either bundle needs a version change before publication, state the intended next version in the release PR and issue. Add pending Skillset change records only when `skillset release plan --json` can consume them from the repository's current state baseline; do not land an unusable pending stream. Treat the owning plugin config as a compatibility baseline until an authorized release applies the version. Then run:

```bash
bun run plugin:metadata:sync
bun run skillset:sync
bun run plugin:metadata:check
```

The adopter `trails` bundle includes:

- the adopter README;
- the `trails` skill with its references, templates, and examples;
- the `trails-error-format` skill;
- the Claude `trail-engineer` agent, lexicon and pattern rules, and read-only `SessionStart` project detection with non-mutating Warden guidance in the Claude package only.

The contributor `trails-dev` Claude and portable packages include framework doctrine, ADR and Regrade workflows, owner-first and dogfood review, the singular editorial workflow, bundled ADR scripts and editorial samples, and temporary compatibility names. They exclude project-only Clark/Lewis agents and host adapters for `goal-loop` and `local-review`.

Repository metadata tooling, installed-skill drift checks, release packets, and dogfood reports support the release process from the Trails checkout; they are not bundle contents.

## Manual / External Checks

These checks were not run in the refresh stack because they would mutate external state or require an approved runtime profile:

- Claude marketplace publish or republish.
- Claude runtime precedence when repo plugins and global installed skills provide the same names.
- `npx skills outfitter-dev/trails` installer behavior for either package against a real profile.
- Global installed skill refresh.

Run them only in an approved disposable target or operator-owned profile, then record the result in the release issue before marking release complete.

## Publication Handoff

Before any external publication:

1. Confirm the plugin release PRs are merged and CI is green.
2. Confirm local review and remote review have no unresolved P0/P1/P2 findings or bot errors.
3. Confirm the independent `trails` and `trails-dev` plugin versions, then rerun metadata and bundle-boundary checks.
4. Confirm `skillset release plan --json` succeeds for any pending Skillset release records.
5. Run the manual/external checks above only with explicit approval.

If any external step fails, stop and record the exact command, target profile, and failure in the release issue. Do not retry against a real global profile while guessing.
