---
"@ontrails/testing": minor
"@ontrails/trails": patch
---

Move CLI, MCP, HTTP, established-surface, and surface-parity helpers behind explicit subpaths so root contract testing imports no longer require optional surface peers. The Trails CLI scaffolder now emits `import { testAllEstablished } from '@ontrails/testing/established'` for generated verification.
