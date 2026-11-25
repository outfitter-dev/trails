# Permit identity and actor migration

Execution permits now require `actors: readonly PermitActor[]`. This is a breaking 0.x contract change in Core and Permits. Update custom adapters, host-injected contexts, inline CLI JSON, and test fixtures together. There is no validation default or compatibility mode for omitted actors.

```typescript
const localPermit = { actors: [], id: 'operator', scopes: ['topo:write'] };
```

```bash
trails compile --module ./src/app.ts --permit '{"actors":[],"id":"operator","scopes":["topo:write"]}'
```

An explicit empty chain means no known acting-party evidence. Only trusted adapter evidence can support `verified: true`; do not copy caller assertions into that field. Each actor has a nonempty `id` and `kind`, a boolean `verified`, and an optional nonempty issuer naming its own identity namespace. Permit issuer names the attester and does not implicitly supply any actor's namespace. The first actor is current; remaining entries preserve nearest-to-oldest delegation history.

Optional permit `expiresAt` is finite Unix epoch milliseconds. JWT `exp` is converted from seconds once, preserving fractional values and rejecting overflow; clock tolerance never extends the recorded deadline. Missing expiry remains unknown. This change does not add execution-time expiry enforcement or long-lived credential refresh.

For global subject routing or shared cross-issuer persistence, use `derivePermitIdentityKey` from `@ontrails/permits` and handle its `Result`. The key preserves exact issuer, subject and optional tenant as a JSON tuple. Issuerless local permits are valid for local execution but cannot produce this global key. Do not silently rekey existing app records. Stash remains a single-local-authority example with local foreign keys and no invented issuer; federation requires an explicit issuer binding and a separately authored data migration.

JWT mappings retain validated attester and expiry, derive current-first `act` chains, and use `client_id`/`azp` only when `act` is absent. The bounded stock profile and namespace limitations are documented in the [Permits fieldguide](../../packages/permits/README.md#permits-and-scopes). Existing custom adapters must explicitly author their own actor evidence. Test permit factories construct `actors: []` for new synthetic permits; they do not repair incoming data.

New traces carry complete identity evidence through execution, manual spans, signal lifecycle records and parented activations. Parentless activations can remain identity-unknown. Historical `TraceRecord.permit.actors` remains optional so old records retain uncertainty. Developer SQLite version-2 stores upgrade in place by adding nullable columns within the existing schema transaction; old rows retain unknown actors, distinct from newly stored `[]`. Do not fabricate historical actor evidence. Invalid stored JSON fails on read. Existing version-1 reset behavior is unchanged.

OTel actor evidence is an ordered JSON string at `trails.permit.actors`; attester is `trails.permit.issuer`. Consumers that previously assumed only subject and tenant should accept these additional fields. The query trail exposes the same Core-derived trace identity schema. No live database migration command or external identity-provider change is required by this guide.
