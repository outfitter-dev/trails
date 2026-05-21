# TRL-743 Distribution Surface Audit

Date: 2026-05-21
Branch: `trl-743-audit-installed-and-distributed-trails-skill-surfaces`
Scope: repo plugin source, manifests, local installed Trails skill paths, Claude/Codex-visible skill roots, and version metadata. Global skill paths were inspected read-only only.

> Note: filesystem paths in this report are specific to the auditing machine and are preserved as point-in-time evidence. The branch field names the Graphite feature branch where the audit belongs; stacked PR base branches may differ because the branch sits above `TRL-742`.

## Executive Summary

The repo plugin source is newer than the installed global skill copies, but the distribution story is split across multiple surfaces:

- Repo plugin source lives at `plugin/skills/trails/**` and carries `metadata.trails.version: 1.0.0-beta.18`.
- Claude plugin marketplace metadata and plugin manifest both say plugin version `0.3.0`.
- Local `/Users/mg/.agents/skills/trails` is a stale independent directory with trailhead-era guidance.
- `/Users/mg/.config/claude/skills/trails` is a symlink to that stale `/Users/mg/.agents/skills/trails` directory.
- `/Users/mg/.config/codex/skills/trails` is absent; this session sees the stale skill through the `.agents` skill root, not a Codex-home copy.
- Claude settings show the repo plugin enabled from `/Users/mg/Developer/outfitter/trails`, but runtime precedence between repo plugin skill and global skill was not verified.

The strongest M2/M3 routing is:

- `TRL-750`: add a check-first local installed skill drift command/path. It should compare repo plugin source with local installed skill roots and report symlink/copy/version state without mutating globals by default.
- `TRL-749`: define plugin metadata policy. It may be fine for plugin semver `0.3.0` to differ from Trails framework target `1.0.0-beta.18`, but the policy and drift check are currently missing.
- `TRL-753`: clarify release/install docs so Claude plugin install, generic `npx skills`, and local check/sync paths do not imply the same update mechanism.

## Evidence Commands

- `ls -ld plugin/skills/trails /Users/mg/.agents/skills/trails /Users/mg/.config/claude/skills/trails` showed repo source and local agents skill as directories, and Claude global skill as a symlink to `../../../.agents/skills/trails`.
- `readlink /Users/mg/.agents/skills/trails` returned no target and exit code 1, confirming it is not a symlink.
- `readlink /Users/mg/.config/claude/skills/trails` returned `../../../.agents/skills/trails`.
- `realpath /Users/mg/.agents/skills/trails /Users/mg/.config/claude/skills/trails` resolved both to `/Users/mg/.agents/skills/trails`.
- `diff -qr plugin/skills/trails /Users/mg/.agents/skills/trails` found every main skill/reference/example/template differing and `warden-guide.md` only in repo source.
- `du -sh plugin/skills/trails /Users/mg/.agents/skills/trails /Users/mg/.config/claude/skills/trails` reported repo source `132K`, installed agents skill `108K`, and Claude symlink `0B`.
- `fd '^trails$' /Users/mg/.agents/skills /Users/mg/.config/claude/skills /Users/mg/.config/codex/skills -t d -t l 2>/dev/null` found only `/Users/mg/.agents/skills/trails/` and `/Users/mg/.config/claude/skills/trails`.
- `ls -ld /Users/mg/.config/codex/skills/trails 2>&1 || true` returned `No such file or directory`.
- `rg -n "installed|currentness|drift|sync|~/.agents|\\.agents/skills|\\.config/claude/skills|npx skills|skills outfitter" README.md plugin/README.md plugin/skills/trails plugin/hooks .claude-plugin plugin/.claude-plugin` found install commands and generic drift language, but no installed-skill currentness check guidance for local agents/Claude skill paths.

## Distribution Matrix

| Surface | Path or source | Version | Currentness | Evidence | Owner |
| --- | --- | --- | --- | --- | --- |
| Repo plugin skill source | `plugin/skills/trails/**` | `metadata.trails.version: 1.0.0-beta.18` | Canonical repo source, but content needs TRL-742/745 refresh | `plugin/skills/trails/SKILL.md:4-6` records the version; `plugin/skills/trails/SKILL.md:102-108` teaches `surface()` | `TRL-746`, `TRL-747` |
| Marketplace manifest | `.claude-plugin/marketplace.json` | `0.3.0` | Version policy unclear | `.claude-plugin/marketplace.json:7-17` sets metadata and plugin version to `0.3.0` | `TRL-749` |
| Plugin manifest | `plugin/.claude-plugin/plugin.json` | `0.3.0` | Version policy unclear | `plugin/.claude-plugin/plugin.json:1-4` sets plugin `version` to `0.3.0` | `TRL-749` |
| Repo plugin README | `plugin/README.md` | none | Claude-focused only | `plugin/README.md:1-9` says "Trails Plugin for Claude Code" and gives Claude marketplace install commands | `TRL-753` |
| Root AI install docs | `README.md` | none | Partial | `README.md:13-24` gives Claude plugin install and generic `npx skills outfitter-dev/trails` for Codex/Cursor/others | `TRL-750`, `TRL-753` |
| Local agents skill | `/Users/mg/.agents/skills/trails` | none found | Stale | `/Users/mg/.agents/skills/trails/SKILL.md:3-8` says "trailheads" and "trailhead it"; `diff -qr` shows widespread drift from repo source | `TRL-750` |
| Local Claude skill path | `/Users/mg/.config/claude/skills/trails` | same stale content | Stale via symlink | `readlink` resolves to `../../../.agents/skills/trails`; `realpath` resolves both paths to `/Users/mg/.agents/skills/trails` | `TRL-750` |
| Codex home skill path | `/Users/mg/.config/codex/skills/trails` | absent | Unknown/not present | `ls -ld` returned `No such file or directory`; `fd` found no Codex-home `trails` skill | `TRL-750` |
| Claude plugin activation | `/Users/mg/.config/claude/settings.json` | repo directory source | Enabled, precedence unverified | `settings.json:90` enables `trails@trails`; `settings.json:104-108` points marketplace source to `/Users/mg/Developer/outfitter/trails` | `TRL-753` |
| Package/framework version baseline | packages/adapters/apps | `1.0.0-beta.18` | Current local source baseline | `packages/core/package.json:1-3` and `apps/trails/package.json:1-3` show beta.18; package command summary found all local `@ontrails/*` packages at beta.18 | `TRL-749` |

## Findings

### P1 - Global installed `trails` skill is stale and Claude-global path points at it

Evidence:

- `/Users/mg/.agents/skills/trails/SKILL.md:3` says the skill wires "CLI/MCP trailheads" and is used when "adding trailheads".
- `/Users/mg/.agents/skills/trails/SKILL.md:8` says "then trailhead it".
- `/Users/mg/.agents/skills/trails/SKILL.md:25-27` says "Blaze on trailheads" and uses `trailhead(app)`.
- `/Users/mg/.agents/skills/trails/SKILL.md:101-116` imports `trailhead` from old package names including `@ontrails/cli/commander` and `@ontrails/with-hono`.
- Repo source instead teaches `surface()` and current packages at `plugin/skills/trails/SKILL.md:100-123`.
- `readlink /Users/mg/.config/claude/skills/trails` returned `../../../.agents/skills/trails`, so Claude-global skill path shares the stale agents skill.
- `diff -qr plugin/skills/trails /Users/mg/.agents/skills/trails` found all main files differing and `references/warden-guide.md` only in repo source.

Recommended owner issue: `TRL-750`.

Prompt to fix with AI:

> Implement `TRL-750` as a check-first local skill drift tool. Compare `plugin/skills/trails` to portable installed roots such as `~/.agents/skills/trails` and `$HOME/.config/claude/skills/trails`, report symlink/copy state, missing files, stale frontmatter/version metadata, and top stale vocabulary hits. Do not auto-mutate globals unless the user explicitly asks for a sync command.

### P1 - Plugin metadata version policy is undefined

Evidence:

- `.claude-plugin/marketplace.json:7-17` sets marketplace metadata and plugin version to `0.3.0`.
- `plugin/.claude-plugin/plugin.json:1-4` sets plugin `version` to `0.3.0`.
- `plugin/skills/trails/SKILL.md:4-6` sets `metadata.trails.version: 1.0.0-beta.18`.
- `packages/core/package.json:1-3` and `apps/trails/package.json:1-3` show the framework/package line at `1.0.0-beta.18`.
- `rg -n "metadata.trails" plugin .claude-plugin .agents .claude` found no existing drift checker outside the plan packet and skill metadata.

Recommended owner issue: `TRL-749`.

Prompt to fix with AI:

> Decide and document whether Claude plugin semver is independent from Trails package semver. Add a metadata drift check that compares marketplace/plugin manifest version, skill `metadata.trails.version`, and local package versions, warning only on defined policy violations.

### P2 - Install docs do not explain installed-path currentness checks

Evidence:

- `README.md:13-24` tells Claude users to install the plugin and Codex/Cursor/others to run `npx skills outfitter-dev/trails`.
- `plugin/README.md:1-9` is Claude-only.
- The `rg` evidence command above found no command in repo docs telling the user how to verify whether `/Users/mg/.agents/skills/trails` or `/Users/mg/.config/claude/skills/trails` matches repo plugin source.
- The local installed skill is demonstrably stale, so this absence is not theoretical.

Recommended owner issue: `TRL-750` for the check path, `TRL-753` for release/install documentation.

Prompt to fix with AI:

> Add a non-mutating install/currentness check to the plugin refresh flow and document how Claude plugin, generic skill install, local agents skill, and Claude-global skill paths relate. Keep sync/mutation as an explicit operator command, not a startup hook side effect.

### P2 - Runtime precedence between repo plugin and global skill remains unverified

Evidence:

- `/Users/mg/.config/claude/settings.json:90` enables `trails@trails`.
- `/Users/mg/.config/claude/settings.json:104-108` points the `trails` marketplace source at `/Users/mg/Developer/outfitter/trails`.
- `/Users/mg/.config/claude/skills/trails` still points to the stale global agents skill.
- I did not run Claude runtime resolution probes; this goal should not mutate or depend on global skill state.

Recommended owner issue: `TRL-753`, with a supporting check in `TRL-750`.

Prompt to fix with AI:

> In the release/install issue, verify Claude runtime precedence for a repo plugin skill named `trails` when a global `trails` skill also exists. Record the result in release docs and make the local drift checker report ambiguity instead of assuming precedence.

### P3 - Codex hook/skill root assumptions need explicit wording

Evidence:

- `fd '^trails$' /Users/mg/.agents/skills /Users/mg/.config/claude/skills /Users/mg/.config/codex/skills -t d -t l` found only `.agents` and `.config/claude` paths.
- `/Users/mg/.config/codex/skills/trails` does not exist.
- The current session listed the stale `/Users/mg/.agents/skills/trails` skill as available, so Codex visibility can come from `.agents` roots even without a Codex-home copy.

Recommended owner issue: `TRL-750`.

Prompt to fix with AI:

> Document actual Codex-visible roots as observed by the local environment. Do not assume `~/.config/codex/skills/trails` exists; the checker should report missing, symlinked, copied, and session-visible roots separately.

## Current-Good Areas To Preserve

- The repo plugin source has current Trails target metadata at `plugin/skills/trails/SKILL.md:4-6`.
- The repo source includes `plugin/skills/trails/references/warden-guide.md`, which the installed global copy lacks.
- Root README already distinguishes Claude plugin install from generic skills install at `README.md:13-24`.
- Claude settings point the plugin marketplace source at the repo path, which is useful for local plugin development. Do not replace that with a global skill mutation as part of this audit.

## Unable To Verify

- I did not run `npx skills outfitter-dev/trails`; it may use network and/or mutate global skill paths.
- I did not mutate, reinstall, or sync any global installed skill path.
- I did not verify Claude runtime resolution order between repo plugin `plugin/skills/trails` and `/Users/mg/.config/claude/skills/trails`.
- I did not inspect marketplace publication state or any remote plugin registry.
- The current Codex app/session may include skill roots beyond filesystem checks; this report records local paths visible from the filesystem, not a full Codex loader trace.
