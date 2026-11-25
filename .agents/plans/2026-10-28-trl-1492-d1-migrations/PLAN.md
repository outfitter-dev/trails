# D1 migrations

Independent exact Linear branch from actual main69d34aeb43d36a36541ea3f611d3457ef359446f. Prior1459/1456 stack frozen and handed to operator; no dependent ancestry or rewrite. Coordinator recorded Astra's mechanism/compatibility ruling in1492 and granted D source ownership; D also owns related1490, with no index writer.

1. Add red deterministic rendering/default-zero-DDL/native migration regressions.
2. Extract only one physical naming/quoting/DDL owner; add pure renderer and explicit autoCreate bootstrap/seed validation.
3. Update legacy bootstrap tests/fixtures to explicit opt-in, preserve mocks and run native baseline/additive/compatible-adoption/missing-schema checks.
4. Teach Wrangler migration workflow and existing-installation adoption, add minor compatibility release intent, independently review, run normal gates and open independent draft.

Success: default accessor never executes schema/seed writes; only explicit autoCreate enables old dev bootstrap; configured runtime seed without opt-in rejects with ValidationError. Pure initial SQL preserves physical id/entity/version contract, stable order and exact prefix/quoting used by resource runtime. Applying SQL locally enables CRUD and a later authored additive migration; adopting a verified compatible old schema preserves data. IF NOT EXISTS does not prove schema compatibility; JSON entity evolution needs explicit data work. No migration engine or index framework.
