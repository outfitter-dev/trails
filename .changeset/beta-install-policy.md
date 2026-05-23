---
"@ontrails/core": patch
"@ontrails/cli": patch
"@ontrails/commander": patch
"@ontrails/hono": patch
"@ontrails/drizzle": patch
"@ontrails/http": patch
"@ontrails/mcp": patch
"@ontrails/store": patch
"@ontrails/testing": patch
"@ontrails/trails": patch
---

Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
