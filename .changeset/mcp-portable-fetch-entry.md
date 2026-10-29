---
'@ontrails/mcp': minor
---

Add the portable `@ontrails/mcp/fetch` entry with a shared server factory for modern MCP and legacy stateless HTTP. Validate the authoritative request URL, optional Host authority and explicit HTTP(S) Origin allowlist before SDK dispatch. Forward actual request Authorization and per-request metadata to the existing permit resolver without synthesizing SDK auth information. Keep stdio imports outside the portable entry. HTTP challenge integration and real client interoperability retain separate acceptance gates.
