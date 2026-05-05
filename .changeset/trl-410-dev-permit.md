---
'@ontrails/cli': minor
'@ontrails/warden': minor
---

Add `--dev-permit` for local-development synthetic full-access. New `devPermitPreset()` exposes a boolean flag; when set, the CLI synthesizes a `BasePermit` (`id: 'dev-permit'`, scopes enumerated from every declared scope across the topo) and overlays it on `ctx.permit`. Mutually exclusive with `--permit` and `--token` — any combination fails with `ValidationError` listing the conflicting flags. New Warden rule `no-dev-permit-in-source` flags any committed source file containing `--dev-permit` as an error, with a tight allow-list (`packages/cli/src/flags.ts`, `packages/cli/src/build.ts`, the rule itself). The Warden runner still scans test TypeScript files for this literal while keeping unrelated source rules filtered out of tests. Apps that import `authResource`/`authLayer` are unaffected.
