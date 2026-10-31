---
"@ontrails/http": minor
---

HTTP routes resolve credentials through the shared reconciliation in `@ontrails/permits` (`reconcilePermit`), so `@ontrails/http` now depends on `@ontrails/permits`. Resolved permits carry `admission: { kind: 'verified', by: 'resolvePermit' }`. Behavior change on the default `host` posture: a presented credential (`Authorization`, `x-api-key`, `x-auth-token`) with no `resolvePermit` is refused with a `ValidationError` instead of falling through as absence, matching the CLI; the `network` posture keeps answering an `AuthError`. A configured resolver still runs for every request because it owns credential selection.
