---
'@ontrails/cloudflare': minor
---

Change D1 connections to require pre-applied schema by default: connectD1 and cloudflareD1 no longer create tables or seed data implicitly during request access. Add renderD1SchemaSql for deterministic create-only baseline SQL managed through Wrangler migrations. Existing apps must apply/adopt reviewed schema migrations before runtime use, or explicitly set autoCreate: true for development/test bootstrap. Runtime seed now requires that opt-in and otherwise throws ValidationError; in-memory fixtures/mockSeed retain their behavior. Preserve the resolved table prefix when adopting existing data. See the D1 migration guide for upgrade and baseline-adoption steps; IF NOT EXISTS is not schema validation or a data migration.
