# Store Signal Identity Migration

Store-derived change signals now get their canonical identity from the resource
that binds the store. Authored store definitions still expose typed pre-bind
handles, but those handles are references. They are not the final external
signal ids.

## What Changed

Before binding, a table signal handle still looks table-local:

```typescript
const created = definition.tables.users.signals.created;

created.id;
// "users.created"
```

After a connector binds the store to a resource, the canonical id includes the
resource scope:

```typescript
const identity = connectDrizzle(definition, {
  id: 'identity',
  url: ':memory:',
});

identity.store.tables.users.signals.created.id;
// "identity:users.created"
```

The scoped form is the only stable external identity for topo output, signal
lookups, persisted graph rows, and string-based `on:` declarations.

## How To Migrate

If a trail uses the typed pre-bind handle and the store is bound once in the
same topo, no code change is needed:

```typescript
trail('users.notify', {
  on: [definition.tables.users.signals.created],
  blaze: (input) => Result.ok(input),
});
```

Topo assembly resolves that handle to the bound signal id.

If the same store definition is bound more than once, update the trail to use
the scoped id that names the intended resource:

```typescript
trail('users.notify-identity', {
  on: ['identity:users.created'],
  blaze: (input) => Result.ok(input),
});
```

If an app wraps a connector resource in a custom resource, carry the connector
signals onto the wrapper so the topo can see the scoped store signals:

```typescript
const bound = connectDrizzle(definition, {
  id: 'demo.entity-store',
  url: ':memory:',
});

export const entityStoreResource = resource('demo.entity-store', {
  create: () => Result.ok(createConnection()),
  mock: () => createMockConnection(),
  signals: bound.signals,
});
```

Update tests, fixtures, and documentation that assert signal ids from bare
`table.change` strings to scoped `<resource>:<table>.<change>` strings once the
store is bound.

## Validation Notes

Resource ids used as store signal scopes cannot contain `:` or whitespace. A
store definition bound twice cannot resolve a pre-bind handle implicitly; Trails
rejects the ambiguity and asks for an explicit scoped id.

## References

- [ADR-0040: Resource-Scoped Store Signal Identity](./adr/0040-resource-scoped-store-signal-identity.md)
- [Store Guide](../packages/store/README.md)
