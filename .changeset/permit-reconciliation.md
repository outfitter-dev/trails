---
"@ontrails/core": minor
"@ontrails/permits": minor
"@ontrails/cli": minor
---

Add the shared permit reconciliation. `BasePermit` gains optional `admission` evidence (`{ kind: 'verified' | 'asserted' | 'synthetic', by }`) validated by `permitAdmissionSchema`. `@ontrails/permits` exports `reconcilePermit`, the one reconciliation every surface calls with its credential candidates and posture: conflicts are a `ValidationError`, a presented credential with no verifier is a `ValidationError` in process and an `AuthError` (`no_permit_resolver`) on the network, asserted kinds are refused on the network and admitted in process only under an `AssertedKindsPolicy` derived from the topo (allowed with no `auth` resource, denied once one exists) or declared explicitly with a `maxScopes` ceiling, and admitted permits carry `admission` with an unverified actor chain for asserted kinds.

The CLI's `--permit`, `--token` and `--dev-permit` reconciliation now runs through it, so `@ontrails/cli` depends on `@ontrails/permits` and `deriveCliCommands` accepts `assertedKinds`. Behavior change: an app whose topo declares an `auth` resource now refuses `--permit` and `--dev-permit` unless it passes `assertedKinds: { allow: true, ... }` from its own config; apps without an auth resource are unchanged. Permits admitted through the CLI carry `admission`.
