---
"@ontrails/mcp": minor
---

Pass raw Authorization and best-effort Bearer candidates to configured MCP permit policies without requiring a successful Bearer parse. Share request permit resolution internally while preserving trusted host permit precedence and unconfigured parser behavior. Configured policies must distinguish absent credentials from selected invalid credentials; metadata and tool arguments are not synthesized into headers.
