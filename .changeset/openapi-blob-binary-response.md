---
'@ontrails/http': patch
---

The OpenAPI projection now documents BlobRef routes as binary responses (`content: { '*/*': { schema: { type: 'string', format: 'binary' } } }`) instead of a JSON data envelope, matching the raw bytes the runtime serves with the blob's declared mimeType. Error responses keep the JSON error envelope. Both the fetch handler and the OpenAPI projection now share one BlobRef output recognition helper.
