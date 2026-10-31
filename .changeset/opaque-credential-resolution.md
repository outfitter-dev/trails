---
"@ontrails/permits": minor
"@ontrails/http": minor
---

Add a token-callback adapter and shared nullable credential boundary for opaque lookup, preserving strict Bearer-helper behavior. Normalize API-key and raw Authorization candidates for configured HTTP policies, including public trails and requests without Bearer credentials. Resolvers must handle optional credentials and return errors for selected invalid credentials or lookup misses. The JWT adapter rejects malformed presented Bearer and selected empty tokens instead of treating them as absent.
