---
id: 60
slug: cli-credentials-and-app-login
title: CLIs Sign In Through the App's Provider
status: accepted
created: 2026-10-28
updated: 2026-10-28
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 12, 35, 50, 52, 54, 56]
---

# ADR-0060: CLIs Sign In Through the App's Provider

## Context

A local CLI invocation already receives its permit through flags or the environment. Calling a deployed app adds a different need: sign in through the app's provider, retain the credential, and request a scoped token for another context without repeatedly copying the current token.

[ADR-0056](0056-permits-as-oauth-resource-server.md#decision) keeps Trails an OAuth resource server. The CLI can be an OAuth client of that server without making Trails a token issuer. This decision ratifies [TRL-1496] and the revision-7 CLI credentials draft, including the choices Matt settled on October 27.[^draft] It amends ADR-0012's bearer-only CLI stance. It does not claim the login family or its derivation support already ships.

## Decision

### Permits owns one remote-login family

`@ontrails/permits` contributes ordinary factory-built `auth.login`, `auth.logout`, `auth.status`, `auth.token`, and `auth.exec` trails. The factory follows the store's existing reconcile pattern. The auth resource owns issuer, audience, client identity and token-default policy once; applications do not duplicate trail definitions or maintain a second auth configuration.

Deploy profiles may supply values into that same resolved auth resource configuration. They do not create another issuer list or login registry, and a CLI does not need a deploy installation to sign in. Exact profile binding syntax remains the deploy/config implementation's work.

The family exists only when resolved declarative auth configuration names an issuer and client for remote login. The factory determines eligibility before graph derivation, so topo membership, the lock, help and Wayfinder agree. An ineligible app has no family or shortcuts. Saved credentials, a keychain read, browser availability, discovery success and live provider probes do not determine graph membership. A configured issuer with no usable grant remains eligible and returns the specified error at login.

Compile, fresh derivation and execution must use one consistent configuration context. A runtime profile cannot silently add trails missing from the committed graph or leave a different graph falsely fresh. [ADR-0054](0054-project-substrate-names-its-truth.md) continues to own app identity and one app-owned lock. Profile-dependent eligibility must fit that ownership before shipping; this decision creates no profile locks or second graph channel. No token, secret or credential content enters graph facts to establish eligibility.

### CLI-only exposure is part of the resolved contract

Permits owns the family contract and eligibility. Shared graph and surface derivation carries and enforces its CLI-only exposure; `@ontrails/cli` renders it. HTTP, MCP and RPC discovery and invocation must not expose the family, including through broad includes or expanded app bindings.

Visibility alone is insufficient. Internal trails plus a CLI include, help-only hiding, or an `auth.*` name-prefix filter do not establish this restriction. Effective exposure is inspectable through existing graph and overlay ownership and remains outside surface-agnostic implementations. The exposure representation is implementation work, with the same invariant enforced in fresh derivation and stored facts.

### CLI derivation supplies fixed login shortcuts

Eligible apps receive `<app> login` and `<app> logout` as fixed default routes to `auth.login` and `auth.logout`. These are the same trails and retain their identity under [ADR-0050](0050-surface-accommodations-preserve-trail-identity.md#two-axes). An app can opt out of the default shortcuts while retaining canonical `<app> auth login` and `<app> auth logout`.

CLI derivation owns those fixed defaults. Permits and provider adapters do not inject binding maps or relabel package-derived bindings as app-authored. Authored accommodations continue through ADR-0052's sole `surfaces` overlay channel. Shortcut opt-out is CLI rendering configuration through the existing app-authored surface/config mechanism; its exact field belongs to TRL-1514. It does not introduce negative bindings, tombstones or another alias export channel.

Defaults, opt-out and authored bindings feed one effective route derivation shared by runtime, lock, Warden and fresh reads. `cli-command-route-coherence` reports collisions with app commands rather than silently shadowing them.

### Login selects an issuer-supported grant

`auth.login` reads issuer metadata and selects a usable grant for the configured client:

1. Authorization code with PKCE and a loopback redirect when the client and issuer support that flow and a browser can be opened.[^native]
2. Device authorization when there is no usable local browser or the caller selects `--device`, provided the issuer advertises the device grant and endpoint. The CLI displays the user code and verification URL, then polls within the provider's expiration and interval rules.[^device]
3. Provider delegation when an adapter declares a supported path. Cloudflare Access delegation through a structured next command to `cloudflared` is later work.

No supported path yields a `PermitError` that names what the issuer lacks. Provider support is discovered and qualified; this ADR makes no universal grant, version or advisory claim.

### Credentials live behind a resource

Tokens and refresh tokens live in a `credentials` resource. Its default uses `Bun.secrets` behind the resource boundary, with a mock so tests do not access the real OS credential store. The resource isolates the API's experimental status and platform requirements.[^secrets]

A 0600 file fallback is allowed only when the OS credential-store service is positively unavailable. A missing entry is not an unavailable keychain. A locked keychain, denied unlock or permission error must surface instead of silently selecting file storage. `auth.status` identifies the active store, including file fallback. Other stores are credentials adapters selected through configuration; 1Password is the first named later adapter.

Refresh reads and writes through this resource before credential expiration. Logout attempts provider revocation where supported, then clears stored credentials. After login, remote CLI calls use the stored credential. Local in-process runs keep their existing permit flags and environment behavior.

### Token requests preserve provider authority

`auth.token` requests a provider-issued token for another context. With no flags, it requests the app's audience, the configured token-default scope set or the caller's scopes when none is configured, and a short lifetime. The fallback scope set can equal the caller's set; no-flags behavior is not guaranteed to be a strict subset.

`--scope`, `--audience` and `--ttl` override those defaults within the provider's policy and the caller's grant. The requested TTL is not a promise. The provider chooses actual expiration, which the CLI reports. TRL-1511 chooses, documents and tests the concrete short requested default; this ADR does not fix a duration unit or configuration field spelling.

Initially, obtaining another token uses a fresh scoped sign-in for the requested audience and scopes. Silent token exchange is later work, even when issuer metadata already advertises it. A fresh sign-in produces an ordinary token for the subject. Only actual provider token exchange can supply an `act` delegation link; Trails does not manufacture it. Output and tracing distinguish the path that produced the token. Trails never mints the token.

### Exec passes credentials through the environment

`auth.exec` obtains a token through the same policy, then runs a command with the token in a configurable environment variable. The default name is app-prefixed, such as `<APP>_TOKEN`. Trails does not print the token or place it in the command's arguments. The child process remains responsible for its output and treatment of its environment. This is the recommended handoff for local tools; `auth.token` explicitly prints its result for callers that need token output.

### Machines use their own credentials

CI and autonomous agents do not run interactive login. They present their own short-lived workload OIDC token through ADR-0056's verification path, or an API key exchanged by the provider where supported. `auth.status` identifies the current credential source: login, environment, flag or workload.

### Implementation coverage stays explicit

Initial work includes loopback PKCE and device login, status, logout, default shortcuts and opt-out, the credentials resource and mock, and token/exec through fresh scoped sign-in. Silent token exchange, Cloudflare Access delegation, `auth curl` and additional credential adapters are later work.

TRL-1502 owns the factory's conditional contribution and derivation integration. Shared graph/surface and CLI owners must implement effective CLI-only exposure and one derivation context before claiming the family is available. TRL-1514 owns coherent default routes and opt-out; TRL-1511 owns concrete token defaults; TRL-1498 owns storage, fallback classification and mock coverage. Missing current schema or filter support is implementation debt, not evidence these boundaries already exist.

Acceptance must prove:

- Without eligible declarative config, the family and shortcuts are absent from topo, help, lock and Wayfinder. Saved credentials, keychain reads, browser state, discovery success and live provider probes cannot change eligibility.
- HTTP, MCP and RPC discovery and invocation do not expose an eligible family, including through broad includes and expanded app bindings.
- Defaults, shortcut opt-out, authored bindings and collision handling resolve identically across runtime, stored lock, Warden and fresh reads. Opt-out preserves canonical routes; collisions produce coherence findings.
- Initial token requests use fresh scoped sign-in without attempting exchange even when metadata advertises it.
- Missing entries and locked or denied stores do not trigger fallback. A positively unavailable service permits a 0600 file fallback disclosed by status.

Provider-specific grant and advisory qualification remains with the implementation and support owners.

## Consequences

Applications gain one inspectable sign-in and credential handoff model without implementing their own auth commands. Existing local permit use remains available, while remote calls can use stored credentials.

The CLI takes on OAuth client lifecycle work: browser/loopback handling, polling, refresh and credential storage. Those responsibilities stay in permits, credentials and CLI ownership rather than core trail implementations. Fresh scoped sign-in can require an additional approval until exchange support ships. The file fallback is an explicit, disclosed storage tradeoff when the OS credential-store service is positively unavailable.

## What This Does Not Decide

This decision does not add hosted sign-in UI, settle enterprise-managed SSO/authorization policy, or map the Trails operator's own commands onto scopes. It does not choose exact client-id or token-default field spellings, a concrete default TTL, profile binding syntax, or a new overlay mechanism. Those implementation details must satisfy the invariants above.

## References

- [ADR-0009](0009-first-class-resources.md) — credentials are a resource with a mock.
- [ADR-0012](0012-connector-agnostic-permits.md) — amended CLI credential acquisition boundary.
- [ADR-0035](0035-surface-apis-render-the-graph.md) — surface derivation and runtime ownership.
- [ADR-0050](0050-surface-accommodations-preserve-trail-identity.md) — shortcuts preserve trail identity.
- [ADR-0052](0052-overlays-one-extension-mechanism.md) — app-authored bindings and overlay provenance.
- [ADR-0054](0054-project-substrate-names-its-truth.md) — one app identity and app-owned lock; deployment configuration is a separate concern.
- [ADR-0056](0056-permits-as-oauth-resource-server.md) — external issuance, verification and actor authority.

[TRL-1496]: https://linear.app/outfitter/issue/TRL-1496

[^draft]: [CLI credentials and app login, revision-7 source copy](https://app.notion.com/p/4061b36f46cb81cdbe91cc9c85cd0d3a), including the October 27 settled choices.
[^native]: [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html) — OAuth for native apps, external browser and loopback redirects.
[^device]: [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html) — device authorization, discovery and polling.
[^secrets]: [Bun secrets documentation](https://bun.sh/docs/runtime/secrets) — OS credential stores, missing-entry result and platform service requirements.
