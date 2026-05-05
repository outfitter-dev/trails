---
'@ontrails/cli': minor
'@ontrails/trails': minor
---

Unify structured CLI input around `--input <path|->` and `--input-json`.
`--input` reads JSON from a file path or from stdin when the value is `-`;
`--input-file`, `--stdin`, and the `structuredInputFieldByTrail` routing
option are removed. Structured payloads now merge directly into each trail's
typed input object, so `trails run` callers provide the inner trail payload
under the run trail's `input` field.
