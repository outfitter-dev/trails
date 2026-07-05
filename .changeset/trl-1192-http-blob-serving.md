---
"@ontrails/http": patch
---

Serve `BlobRef` trail outputs as bytes on HTTP (TRL-1192). When a trail's output schema is `blobRefSchema`, the route handler streams the blob's data with `Content-Type` from its `mimeType` and a `Content-Length` from its `size` — for both `Uint8Array` and `ReadableStream` payloads — instead of wrapping the value in the JSON envelope. Error results keep the JSON error envelope, and non-blob trails are unchanged. Apps no longer need to hand-mount raw-byte routes beside the derived surface.
