# Local Review Round 2: Tooling And Hook Safety

Date: 2026-05-22
Stack tip: `trl-753-republish-trails-plugin-and-document-the-release-path`
Score: 4/5

## Summary

The metadata checker, installed-skill drift checker, and Claude `SessionStart` hook are scoped and non-mutating by default. Metadata sync has a clear two-source policy: plugin manifest version owns plugin semver, `packages/core/package.json` owns the framework target, and derived marketplace/skill copies are checked or synchronized. The installed-skill checker reports copy/symlink/missing state, file drift, stale vocabulary, and `metadata.trails.version` drift without changing global files. The hook stays silent outside likely Trails projects and suggests only Warden probes with `--lock cached --no-lock-mutation`.

## Evidence

- `scripts/sync-plugin-metadata.ts:257` checks marketplace metadata/plugin versions against the plugin manifest and skill target against `packages/core/package.json`.
- `scripts/sync-plugin-metadata.ts:317` writes only `.claude-plugin/marketplace.json` and `plugin/skills/trails/SKILL.md` during explicit sync mode.
- `scripts/check-installed-trails-skill.ts:461` prints "Read-only check: no installed skill files were changed."
- `plugin/hooks/detect-trails.sh:13` starts with empty reason and exits silently when no Trails signal is found.
- `plugin/hooks/detect-trails.sh:48` suggests project-local `trails warden --lock cached --no-lock-mutation` when available.
- `plugin/hooks/detect-trails.sh:62` points operators to `bun run plugin:installed-skill:check` instead of syncing or editing installed skills.
- `plugin/README.md:13` documents metadata policy and `:24` documents read-only installed-skill drift checking.
- `bun test scripts/__tests__/sync-plugin-metadata.test.ts scripts/__tests__/check-installed-trails-skill.test.ts scripts/__tests__/detect-trails-hook.test.ts` passed 16 tests / 47 assertions.
- `bun run plugin:metadata:check` passed.
- `bun run plugin:installed-skill:check` expected-failed read-only on the current machine and reported stale local/global skill copies without mutation.

## Findings

| Severity | Finding | Evidence | Prompt To Fix |
| --- | --- | --- | --- |
| P3 | The installed-skill checker splits stale vocabulary literals into fragments so the repo-wide vocabulary audit can remain strict while the checker still detects those terms in installed copies. This is readable enough, but slightly indirect. | `scripts/check-installed-trails-skill.ts:53`; `scripts/__tests__/check-installed-trails-skill.test.ts:147`; `bun run vocab:audit` passed inside `bun run check`. | If this gets expanded, add an explicit vocab-audit fixture/allowlist mechanism so stale-term detector tests can keep plain literals without weakening the repo-wide audit. |

## P0/P1/P2 Result

No P0/P1/P2 findings.
