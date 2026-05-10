---
'@ontrails/cli': minor
---

Add `--token <token>` to `trails run` for permit resolution via the topo's auth adapter. New `tokenPreset()` exposes the flag; `'token'` is added to `META_FLAG_CANDIDATES`. The CLI resolves the `auth` resource through the shared permit-boundary helper, calls `adapter.authenticate({ surface: 'cli', bearerToken, requestId })`, and projects the resolved `Permit` into `ExecuteTrailOptions.permit` (added in TRL-408) so it reaches `ctx.permit`. Failures: missing adapter → `ValidationError` (exit 1); adapter returns `Err(AuthError)` or `Ok(null)` → `AuthError` (category `'auth'`, exit 9, with the adapter's code preserved on `error.context.code`). `--token` and `--permit` are mutually exclusive — supplying both yields `ValidationError`.
