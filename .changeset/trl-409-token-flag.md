---
'@ontrails/cli': minor
---

Add `--token <token>` to `trails run` for permit resolution via the topo's auth connector. New `tokenPreset()` exposes the flag; `'token'` is added to `META_FLAG_CANDIDATES`. The CLI resolves the `auth` resource through the shared permit-boundary helper, calls `connector.authenticate({ surface: 'cli', bearerToken, requestId })`, and projects the resolved `Permit` into `ExecuteTrailOptions.permit` (added in TRL-408) so it reaches `ctx.permit`. Failures: missing connector → `ValidationError` (exit 1); connector returns `Err(AuthError)` or `Ok(null)` → `AuthError` (category `'auth'`, exit 9, with the connector's code preserved on `error.context.code`). `--token` and `--permit` are mutually exclusive — supplying both yields `ValidationError`.
