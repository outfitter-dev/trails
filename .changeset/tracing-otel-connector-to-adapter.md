---
---

BREAKING: rename the OpenTelemetry tracing connector API to adapter vocabulary.

- `createOtelConnector` -> `createOtelAdapter`
- `OtelConnectorOptions` -> `OtelAdapterOptions`

The `@ontrails/tracing/otel` subpath is unchanged. The internal OTel source path
moves from `src/connectors/otel.ts` to `src/adapters/otel.ts`.
