---
'@ontrails/mcp': minor
---

Network MCP surfaces never inherit a `createContext` permit. `deriveMcpTools` and the server options gain `credentialPosture`; `@ontrails/mcp/fetch` always builds on the `network` posture, where identity enters only through `resolvePermit`: a seeded `createContext` permit is discarded at runtime (one diagnostic names the migration) for tools and resource reads, `extra.permit` is ignored, a presented bearer with no resolver is an `AuthError` instead of absence, and a handler that exposes protected trails without a resolver is refused at build time with a `ValidationError` naming them. The stdio `host` posture is unchanged.

Migration: apps that seeded a permit through `createContext` on a network host move that credential into a verifier passed as `resolvePermit` (for example a JWKS or opaque adapter from `@ontrails/permits`) and keep `createContext` for the logger, extensions and resources it seeds. `--dev-permit` is not a migration path for network surfaces.
