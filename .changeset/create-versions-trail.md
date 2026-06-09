---
"@ontrails/trails": minor
---

Add the public `create.versions` trail (`trails create versions`). Scaffold dependency version derivation graduates from `scripts/sync-scaffold-versions.ts` into the `create` surface: check mode verifies `apps/trails/src/scaffold-versions.generated.ts` is current, write mode regenerates it, and the root script remains as a thin compatibility wrapper.
