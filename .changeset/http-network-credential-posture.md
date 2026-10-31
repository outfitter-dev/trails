---
'@ontrails/http': minor
'@ontrails/hono': minor
'@ontrails/cloudflare': minor
---

HTTP network surfaces never inherit a `createContext` permit. `deriveHttpRoutes` gains `credentialPosture` (`host` by default for in-process callers; the Web Fetch kernel, `@ontrails/http/bun`, `@ontrails/hono` and `@ontrails/cloudflare/workers` always build on `network`). On the network posture identity enters only through `resolvePermit`: a seeded `createContext` permit is discarded at runtime with one diagnostic through the seed's logger, a presented credential (`Authorization`, `x-api-key`, `x-auth-token`) with no resolver answers an `AuthError` instead of absence, and a surface that exposes protected trails without a resolver is refused at build time with a `ValidationError` naming them.

Migration: apps that seeded a permit through `createContext` on an HTTP host move that credential into a verifier passed as `resolvePermit` (for example a JWKS or opaque adapter from `@ontrails/permits`) and keep `createContext` for the logger, extensions and resources it seeds. `--dev-permit` is not a migration path for network surfaces.
