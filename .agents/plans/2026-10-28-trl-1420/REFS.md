# Sources

- [TRL-1420](https://linear.app/outfitter/issue/TRL-1420/preserve-authored-trail-meta-in-topograph-for-duplicate): corrected attribution and full acceptance; [DIS-109](https://linear.app/outfitter/issue/DIS-109) owns downstream authored read/ACK facts.
- topography/derive.ts canonicalize owns deterministic fact serialization; addMetadata now projects trail meta.
- topography/internal/topo-store.ts stable relational trail metadata existed; addExtendedMetadata now also projects it into serialized graph records used by real compile.
- Warden duplicate-public-contract.ts contractFingerprint already includes meta and stays unchanged. Only diagnostic teaching and corresponding trail example expected message change.
- Focused derive/io/topo-store tests and duplicate-public-contract tests own canonicalization, generated root-lock/force/readback, same/different semantic facts, actual runWarden dispatch, inverse/CRUD regressions.
- Generated artifact commands were copied from actual lock-roundtrip failure output; artifacts were never hand-edited. tests/cold consumer state is disposable.
- Current AGENTS.md, PLANNING.md, trails-goal-loop/local-review and shared campaign operating plan govern authority and completion horizon.
