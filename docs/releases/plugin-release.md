# Plugin Release Runbook

This runbook covers the Trails Claude plugin and bundled skills under `plugin/` plus the marketplace manifest at `.claude-plugin/marketplace.json`. It is separate from the framework package publish path in [Stable Cutover Runbook](./stable-cutover.md).

The current plugin manifest version is `0.3.2`. The bundled `trails` skill targets the current Trails framework package version through `metadata.trails.version`. Those versions are intentionally independent: plugin version names the Claude plugin bundle, while the skill target names the framework package line the guidance was refreshed against.

## Stop Rules

Do not run any of these without explicit operator approval:

- publish or mutate package registries;
- mutate Claude marketplace state;
- run `npx skills outfitter-dev/trails` against a real global install target;
- mutate `$HOME/.agents/skills/trails`, `$HOME/.config/claude/skills/trails`,
  or `$HOME/.config/codex/skills/trails`.

If an installer or marketplace probe cannot be pointed at a disposable target, mark it externally/manual blocked instead of testing against a real profile.

## Preflight

Start from the stack tip or clean `main` after the plugin refresh stack merges.

```bash
git status --short --branch
bun run plugin:metadata:check
bun run warden:skills:check
bun run warden:agents:check
bun run clark:check
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

## Plugin 0.3.2 Bundle

The refreshed bundle is recorded as plugin manifest version `0.3.2`. If the marketplace requires another version bump before publication, update `plugin/.claude-plugin/plugin.json`, then run:

```bash
bun run plugin:metadata:sync
bun run plugin:metadata:check
```

The `0.3.2` bundle includes:

- public README/API docs drift fixes and M1 packet archive;
- refreshed main `trails` skill for CLI, MCP, Hono HTTP, Bun-native HTTP,
  testing harnesses, resource mocks, and current error taxonomy;
- refreshed skill references, templates, examples, plugin agent, rules,
  advisory skill wording, hook copy, and Clark calibration;
- plugin metadata sync/check tooling;
- installed-skill drift checker;
- tested Claude `SessionStart` project detection and non-mutating Warden
  guidance;
- stable-RC refreshes for release rules, Wayfinder-first navigation, current
  skill metadata, and binding vocabulary;
- Trails writing/editorial skills and the compatibility pointer from the older
  language styleguide skill;
- disposable dogfood report and release-risk findings.

## Manual / External Checks

These checks were not run in the refresh stack because they would mutate external state or require an approved runtime profile:

- Claude marketplace publish or republish.
- Claude runtime precedence when the repo plugin and a global installed skill both provide `trails`.
- `npx skills outfitter-dev/trails` installer behavior against a real profile.
- Global installed skill refresh.

Run them only in an approved disposable target or operator-owned profile, then record the result in the release issue before marking release complete.

## Publication Handoff

Before any external publication:

1. Confirm all plugin refresh PRs are merged and CI is green.
2. Confirm local review and remote review have no unresolved P0/P1/P2 findings
   or bot errors.
3. Confirm `TRL-755` public-docs cleanup and M1 archive are included.
4. Confirm `TRL-757` through `TRL-760` are either accepted deferred follow-ups
   or explicitly promoted into the release gate.
5. Confirm whether plugin version remains `0.3.2` or is bumped again, then rerun
   metadata checks.
6. Run the manual/external checks above only with explicit approval.

If any external step fails, stop and record the exact command, target profile, and failure in the release issue. Do not retry against a real global profile while guessing.
