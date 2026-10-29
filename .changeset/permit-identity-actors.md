---
"@ontrails/core": minor
"@ontrails/permits": minor
"@ontrails/observability": minor
"@ontrails/cli": minor
"@ontrails/testing": minor
"@ontrails/http": patch
"@ontrails/commander": patch
"@ontrails/trails": patch
---

Require explicitly authored actor evidence on execution permits, retain optional issuer and finite millisecond expiry, and derive collision-free issuer-qualified subject keys. This is a breaking 0.x shape migration: custom adapters, contexts and inline CLI permits must supply `actors`, including `[]` when no acting party is known.

Retain validated JWT attester, expiry and current-first actor chains without inventing actor namespaces or trusting caller provenance. Preserve full permits at existing authentication boundaries and update test factories and generated permit commands.

Carry identity evidence through traces, queries and OTel output. Upgrade version-2 developer trace stores without deleting records; preserve unknown historical actors separately from known empty chains. See the permit identity migration guide for compatibility details.
