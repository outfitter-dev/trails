---
created: 2026-05-21T21:29:29Z
updated: 2026-05-22T20:49:43Z
description: Audit of current and potential Trails plugin hook opportunities. Documents the Claude SessionStart hook (too narrow, misuses blaze vocabulary, no Codex story), proposes detection predicates, Warden nudges, version drift warnings, and installed-skill drift checks. Proposed hook stack splits ownership across TRL-748/749/750/751/753 with do-not-do constraints for M2/M3.
impl_status: implemented
linear:
  - TRL-744
  - TRL-748
  - TRL-749
  - TRL-750
  - TRL-751
  - TRL-753
references:
  - plugin/hooks/detect-trails.sh
  - plugin/hooks/hooks.json
  - apps/trails/src/trails/project.ts
  - packages/topographer/src/workspace-topos.ts
  - docs/contributing/language-styleguide.md
  - trails.config.ts
---

# TRL-744 Hook Opportunities Audit

Date: 2026-05-21
Branch: `trl-744-audit-trails-plugin-hook-opportunities-and-integration`
Scope: project detection, version drift warnings, Warden nudges, command suggestions, and Claude/Codex integration differences for the Trails plugin. No hook implementation changes were made.

## Executive Summary

The current plugin hook is intentionally small and read-only, but too narrow for the one-stop-shop target:

- It is a Claude `SessionStart` hook only.
- It detects a Trails project only by grepping root `package.json` for `@ontrails`.
- It emits a global skill-loading suggestion and a CLI-missing message.
- Its CLI-missing message says `blaze: bun add -g @ontrails/trails`, which misuses Trails lexicon and recommends a global install even when the local repo CLI works.
- It has no version drift check, installed-skill drift check, Warden nudge, or Codex hook story.

The right implementation path is additive and check-first:

- `TRL-751` should own detection predicates, Warden/command suggestions, version warnings shown at startup, and Claude/Codex hook separation.
- `TRL-748` should own exact hook message copy and adjacent agent/rules wording.
- `TRL-749` should own metadata/version policy used by any warning.
- `TRL-750` should own installed-skill drift checking so a hook does not mutate globals.
- `TRL-753` should own release/install docs and runtime precedence verification.

## Current Hook Facts

| Area | Current state | Evidence | Recommendation |
| --- | --- | --- | --- |
| Hook type | Claude plugin `SessionStart` only | `plugin/hooks/hooks.json:2-10` registers `SessionStart` with matcher `startup` | Keep Claude hook explicit; do not imply Codex parity. |
| Detection predicate | Root `package.json` contains `@ontrails` | `plugin/hooks/detect-trails.sh:7-9` uses `pkg="$CLAUDE_PROJECT_DIR/package.json"` and `grep -q '@ontrails'` | Add `trails.config.*`, `.trails/`, `package.json.trails.module`, and topo-source signals. |
| Startup message | "Load the `trails` skill" | `plugin/hooks/detect-trails.sh:11` | Keep the hint, but name repo-bundled skill context where possible and avoid stale global skill ambiguity. |
| CLI missing copy | Global install hint with `blaze:` | `plugin/hooks/detect-trails.sh:13-16` | Replace with plain command wording and local CLI fallback guidance. |
| Non-mutating Warden suggestion | None | `detect-trails.sh` has no Warden command suggestion | Add quiet/actionable suggestion only when likely useful. |
| Version drift warning | None | `rg -n "metadata.trails" plugin .claude-plugin .agents .claude` found no checker outside metadata/plans | Define policy in `TRL-749` before warning. |
| Installed skill drift | None | `TRL-743` proved local agents/Claude global skill drift | Use a separate check-first command; do not auto-sync from hook. |
| Codex integration | No repo plugin Codex hook manifest | Global `/Users/mg/.config/codex/hooks.json:1-3` has empty hooks; `.codex/environments/environment.toml:5-16` is setup/cleanup lifecycle, not plugin hook parity | Document unknown/unsupported parity until Codex plugin hook surface is verified. |

## Evidence Commands

- `nl -ba plugin/hooks/detect-trails.sh` showed the full hook script: root package grep, skill load message, and CLI install hint.
- `nl -ba plugin/hooks/hooks.json` showed only `SessionStart`.
- `command -v trails || true` produced no output in this shell, while `bun apps/trails/bin/trails.ts warden --help` works locally. The hook would therefore warn about a missing global CLI in this repo even though the repo CLI entrypoint is available.
- `bun apps/trails/bin/trails.ts warden --help` lists non-mutating flags that are good hook suggestions: `--lock cached`, `--no-lock-mutation`, `--root-dir`, and `--config-path`.
- `nl -ba trails.config.ts` showed repo Warden config at `trails.config.ts:5-13`.
- `nl -ba apps/trails/src/trails/project.ts | sed -n '59,64p'` showed the CLI helper treats `.trails` or a topo path as project signals.
- `nl -ba packages/topographer/src/workspace-topos.ts | sed -n '185,217p'` showed workspace candidate detection uses `package.json.trails.module` or default `src/app.ts`.

## Proposed Hook Stack

### `TRL-751`: project detection and contextual suggestions

Targets:

- `plugin/hooks/detect-trails.sh`
- tests or documented probe commands for the shell script
- optional helper script under `plugin/hooks/` or `scripts/` if the shell script becomes too large

Detection predicates, in low-noise order:

1. `package.json` dependency/devDependency/peerDependency keys containing `@ontrails/*`.
2. `package.json.trails.module`.
3. Root `trails.config.ts`, `trails.config.js`, or `trails.config.mjs`.
4. Root `.trails/` directory.
5. Lightweight topo-source convention such as `src/app.ts` only when a nearby package manifest or import indicates Trails.

Suggested output behavior:

- Stay silent when none of the predicates match.
- If Trails is detected, remind the operator to use the repo-bundled/current `trails` skill.
- If the global `trails` binary is missing, prefer local command wording such as `bun apps/trails/bin/trails.ts ...` when inside this repo, or "install/use the project-local @ontrails/trails CLI" in consumers.
- Offer one non-mutating Warden probe only when actionable, for example `trails warden --lock cached --no-lock-mutation` or the local equivalent.

Noise risk:

- Medium if `src/app.ts` alone triggers the hook in non-Trails TypeScript repos.
- Low if detection requires `@ontrails`, `trails.config.*`, `.trails/`, or `package.json.trails.module`.

### `TRL-748`: message copy and adjacent agent/rule refresh

Targets:

- `plugin/hooks/detect-trails.sh` message text
- `plugin/agents/trail-engineer.md`
- `plugin/rules/**`
- advisory skills that repeat hook or command language

Required copy fixes:

- Replace `blaze:` as a command prefix. `blaze` is the authored implementation field, not an imperative shell verb.
- Do not imply a stale global skill is the correct source of doctrine. `TRL-743` shows the local global skill is stale.
- Update stale Warden rule names in the agent profile per `TRL-742`.

### `TRL-749`: metadata policy for version drift warnings

Targets:

- metadata check script or package/script chosen by implementation
- `.claude-plugin/marketplace.json`
- `plugin/.claude-plugin/plugin.json`
- `plugin/skills/trails/SKILL.md`
- package manifests used as target-version source

Policy needed before implementation:

- Decide whether plugin version `0.3.0` is independent product semver or should move with Trails package beta versions.
- Keep both values visible if they are intentionally independent: plugin package version and Trails framework target version.
- Warn only on defined policy violations, not merely on different version numbers.

### `TRL-750`: installed skill drift checker, not hook mutation

Targets:

- new check-only script or command under `plugin/` or `scripts/`
- documentation for local agents/Claude/Codex skill roots

Requirements:

- Compare `plugin/skills/trails` against portable installed roots such as `~/.agents/skills/trails` and `$HOME/.config/claude/skills/trails` when present.
- Report symlink versus copy state, missing files, stale vocabulary hits, and metadata/version drift.
- Treat `$HOME/.config/codex/skills/trails` as optional/absent, not assumed.
- Do not auto-mutate global paths from startup hooks.

### `TRL-753`: release/install and runtime precedence

Targets:

- root README install section
- `plugin/README.md`
- release checklist or plugin publish docs chosen by implementation

Questions to close:

- Does Claude prefer the enabled repo plugin skill over a global skill with the same name?
- What exactly does `npx skills outfitter-dev/trails` install and where?
- How should an operator verify local installed skill freshness after publishing?

## Findings

### P1 - Hook can direct operators toward stale global skill state

Evidence:

- `plugin/hooks/detect-trails.sh:11` says to load the `trails` skill.
- `/Users/mg/.agents/skills/trails/SKILL.md:3-8` says the installed global skill wires "trailheads" and "trailhead it".
- `readlink /Users/mg/.config/claude/skills/trails` returned `../../../.agents/skills/trails`, and `realpath /Users/mg/.agents/skills/trails /Users/mg/.config/claude/skills/trails` resolved both paths to `/Users/mg/.agents/skills/trails`.
- `/Users/mg/.config/claude/settings.json:90` enables `trails@trails`; `/Users/mg/.config/claude/settings.json:104-108` points the `trails` marketplace source at `/Users/mg/Developer/outfitter/trails`.
- Runtime precedence between repo plugin skill and global skill remains unverified.

Recommended owner issue: `TRL-750` for local drift check, `TRL-753` for runtime precedence and install docs, `TRL-748` for hook wording.

Prompt to fix with AI:

> Update hook and install guidance so "load the `trails` skill" does not silently select stale global guidance. Add a check-first path that reports whether the visible global skill matches `plugin/skills/trails`, and document runtime precedence after verifying Claude behavior.

### P1 - CLI-missing message misuses `blaze` and suggests global install

Evidence:

- `plugin/hooks/detect-trails.sh:13-16` checks `which trails` and appends "The `trails` CLI is not installed -- blaze: bun add -g @ontrails/trails".
- `command -v trails || true` produced no output in the repo shell.
- `bun apps/trails/bin/trails.ts warden --help` works locally and lists the Warden command.
- `docs/contributing/language-styleguide.md:13-14` says a blaze establishes how a trail runs; it is not a command prefix.

Recommended owner issue: `TRL-748` for copy and `TRL-751` for command suggestion behavior.

Prompt to fix with AI:

> Rewrite the hook's CLI-missing message. Avoid `blaze:` as an install verb, prefer project-local CLI guidance inside this repo, and avoid recommending a global install when a consumer project may have a local `@ontrails/trails` binary.

### P2 - Project detection is too narrow

Evidence:

- `plugin/hooks/detect-trails.sh:7-9` only greps root `package.json` for `@ontrails`.
- This repo has `trails.config.ts:5-13` with Warden config.
- CLI project detection treats `.trails` or topo path as project signals at `apps/trails/src/trails/project.ts:59-64`.
- Topographer workspace detection uses `package.json.trails.module` or default `src/app.ts` at `packages/topographer/src/workspace-topos.ts:185-217`.

Recommended owner issue: `TRL-751`.

Prompt to fix with AI:

> Expand `detect-trails.sh` to detect likely Trails projects through package dependency keys, `package.json.trails.module`, `trails.config.*`, `.trails/`, and guarded topo-source conventions. Keep the hook silent outside likely projects.

### P2 - No non-mutating Warden nudge exists

Evidence:

- `plugin/hooks/detect-trails.sh` only emits skill and CLI presence text.
- `bun apps/trails/bin/trails.ts warden --help` lists `--lock cached`, `--no-lock-mutation`, `--root-dir`, and `--config-path`.
- The M1 plan specifically asks to audit Warden nudges and command suggestions.

Recommended owner issue: `TRL-751`.

Prompt to fix with AI:

> Add an optional, quiet Warden suggestion to the hook output when a Trails project is detected. Prefer non-mutating forms such as `trails warden --lock cached --no-lock-mutation`, and include local command variants only when discoverable.

### P2 - No version drift warning exists yet

Evidence:

- `plugin/skills/trails/SKILL.md:4-6` has `metadata.trails.version: 1.0.0-beta.18`.
- `.claude-plugin/marketplace.json:7-17` and `plugin/.claude-plugin/plugin.json:1-4` both use plugin version `0.3.0`.
- Package manifests such as `packages/core/package.json:1-3` show framework version `1.0.0-beta.18`.
- `rg -n "metadata.trails"` found no checker beyond metadata and plan references.

Recommended owner issue: `TRL-749`, with hook consumption in `TRL-751`.

Prompt to fix with AI:

> Define plugin-versus-framework version policy first, then add a read-only drift warning that compares manifest plugin version, skill target framework version, and local package version. The hook should consume that policy rather than inventing version logic inline.

### P3 - Codex hook parity is unknown and should not be promised

Evidence:

- Claude plugin hook exists at `plugin/hooks/hooks.json:2-10`.
- Global Codex hooks are empty at `/Users/mg/.config/codex/hooks.json:1-3`.
- Repo Codex environment lifecycle exists at `.codex/environments/environment.toml:5-16`, but that is setup/cleanup, not a plugin `SessionStart` equivalent.

Recommended owner issue: `TRL-751`; possible follow-up if implementation discovers a real Codex plugin hook surface.

Prompt to fix with AI:

> Document Claude `SessionStart` support separately from Codex. Do not promise Codex hook behavior until the Codex plugin hook surface is verified; if needed, file a small spike for Codex plugin hook packaging.

## Do Not Do In M2/M3

- Do not auto-sync or rewrite installed skill roots such as `~/.agents/skills/trails` from a startup hook.
- Do not publish plugin packages or mutate registries.
- Do not make a hook warning noisy in non-Trails TypeScript projects.
- Do not treat plugin version `0.3.0` as wrong until `TRL-749` defines the policy.
- Do not promise Codex hook parity from the Claude `hooks.json` alone.

## Unable To Verify

- Claude runtime resolution order between repo plugin skill and global skill was not verified.
- `npx skills outfitter-dev/trails` install behavior was not run because it may use network and mutate global state.
- Codex plugin hook support was not verified beyond local filesystem evidence. The only confirmed hook file in this repo is Claude plugin `hooks.json`.
