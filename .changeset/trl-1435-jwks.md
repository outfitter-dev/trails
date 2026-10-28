---
"@ontrails/permits": minor
---

Add issuer-backed JWT verification through OIDC discovery or explicit JWKS
endpoints using native WebCrypto for RS256, ES256 and EdDSA. Share bounded public
key caches across adapter instances, refresh rotated key IDs, enforce issuer,
audience and expiration, and reject unsupported sender-constrained tokens.
Existing secret-backed HS256 configuration remains supported.
