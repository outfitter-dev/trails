# Sources

- [TRL-1518](https://linear.app/outfitter/issue/TRL-1518): current source contract and October 28 separate runtime owner decision.
- [TRL-1519](https://linear.app/outfitter/issue/TRL-1519): actual Cloudflare binding conformance and migration/integration gate.
- Core `packages/core/src/queue.ts` and `activation-source.ts`: existing consumer source and parse/output ownership.
- `adapters/cloudflare/src/queues/index.ts`: existing producer modes and consumer materializer; its shallow old mock is not the new snapshot contract.
- Current installed Zod JSON schema rejects ordinary unsupported values but its record parser skips **proto** keys and their value validation (src/v4/core/schemas.ts:2250). Direct probe proved silent key loss; local JSON property validation plus structuredClone preserves those keys and rejects unsupported values without a codec framework.
- Astra's October 28 bounded recommendation in campaign chat, completely summarized in PLAN and README: producer naming, JSON wire domain, per-entry delays, snapshot and whole-batch validation, uncertain provider outcomes, fixture observation limits and consumer integration seam.
- `AGENTS.md`, `.agents/plans/PLANNING.md`, tenets, lexicon, code standards and ADR-0031/0051 govern ownership/delivery.
- Foundation `d26c3ff88a843e45c8a505cd614963f11ca471e8`, [#1095](https://github.com/outfitter-dev/trails/pull/1095): genuine hook prerequisite, operator-owned integration. Independent pushed siblings: KV e8d2a50 and blob 764ad2b.
