---
"@ontrails/core": patch
"@ontrails/http": patch
"@ontrails/warden": patch
---

Webhook ingress v2 (TRL-1194, absorbing TRL-1174 and TRL-1175): store-verified, per-endpoint webhook ingress becomes framework-expressible. `webhook()` accepts dynamic path segments (`path: '/hooks/:endpoint'`) whose values are delivered as envelope fields, opt-in `rawBody: true` delivery (a non-JSON body is no longer a surface-level failure — the trail owns payload interpretation), an allowlisted `headers` list delivered lowercased, and `resources` that make `verify` resource-capable: the HTTP surface resolves the declared resources into a context for the verifier and releases them afterwards, so signature checks can reach stores holding per-endpoint secrets. Envelope-mode ingress responds 202 Accepted; classic static webhooks keep their exact-match, JSON-gated, 200 behavior. Core exports `parseWebhookPathParams`, `matchWebhookPath`, `webhookPathPatternsOverlap`, and `createResources`. The `webhook-route-collision` Warden rule now also flags dynamic patterns that overlap other webhook or derived routes, not just exact method/path duplicates.
