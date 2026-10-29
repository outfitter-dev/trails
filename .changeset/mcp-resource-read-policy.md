---
'@ontrails/mcp': minor
---

Resolve permits for every MCP resource list and read request, and add `authorizeResourceRead` over the verified permit and canonical resource descriptor. Permission denials omit listed resources and reject direct reads; credential and operational failures remain terminal. Resolvers now receive resource requests, including requests without bearer credentials, and must return absence only when no accepted credential was selected. Resource policy preserves trusted local-host permits after absence and never after a verification error. This does not establish the separate fetch-shaped MCP host or private tool discovery.
