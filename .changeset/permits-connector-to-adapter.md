---
"@ontrails/permits": major
"@ontrails/trails": patch
---

BREAKING: rename auth connector vocabulary to adapter.

This stays on the current `1.0.0-beta` prerelease line: the package is part of
the fixed `@ontrails/*` beta group, so beta-breaking API renames advance the
next beta rather than opening a stable-major release line.

- `AuthConnector` -> `AuthAdapter`
- `authConnectorSchema` -> `authAdapterSchema`
- `JwtConnectorOptions` -> `JwtAdapterOptions`
- `createJwtConnector` -> `createJwtAdapter`
- auth resource config discriminant `{ connector: 'jwt' | 'none' }` -> `{ adapter: 'jwt' | 'none' }`

The `@ontrails/permits/jwt` subpath is unchanged. The internal `connectors/`
source directory becomes `adapters/`. See
`docs/migration/connector-to-adapter.md` for the full rename map.

The Trails CLI package updates its generated auth-resource configuration to use
the new `adapter` discriminant.
