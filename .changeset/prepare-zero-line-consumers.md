---
"@ontrails/adapter-kit": patch
"@ontrails/cli": patch
"@ontrails/cloudflare": patch
"@ontrails/commander": patch
"@ontrails/config": patch
"@ontrails/core": patch
"@ontrails/drizzle": patch
"@ontrails/hono": patch
"@ontrails/http": patch
"@ontrails/library": patch
"@ontrails/logtape": patch
"@ontrails/mcp": patch
"@ontrails/observability": patch
"@ontrails/permits": patch
"@ontrails/pino": patch
"@ontrails/regrade": patch
"@ontrails/source": patch
"@ontrails/store": patch
"@ontrails/testing": patch
"@ontrails/topography": patch
"@ontrails/trails": patch
"@ontrails/vite": patch
"@ontrails/warden": patch
---

Prepare the first normal Trails release at `0.2.0` on `latest`, replacing the unpublished 1.0.0 source release. The target advances the original `0.1.0` source minor, which was never published under the current package names. Public packages remain in lockstep. Update consumer installation guidance and provide a temporary manifest bridge for old 1.0 beta sources. Published beta versions remain unchanged; minor 0.x releases may carry documented breaking changes.

The `1.0.0` section retained below records an unpublished preparation, not an npm release. Its accumulated changes are included in `0.2.0`; the section remains as source history alongside the published beta entries.
