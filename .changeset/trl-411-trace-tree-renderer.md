---
'@ontrails/observe': minor
---

Add `renderTraceTree(records: readonly TraceRecord[]): string` — a pure post-execution renderer that builds a readable execution tree from `TraceRecord` entries. Renders root spans with `●`, children with `├──`/`└──`, status glyphs (`✓`/`✗`/`⊘`), durations, and parallel-branch detection (overlapping siblings render as a bracketed group with wall-vs-total summary). Tolerates forward-compatible record shapes (signal/activation kinds, `attrs.layer` from upcoming layer composition) without crashing — unknown kinds fall through to a generic span renderer. No live streaming; the tree is drawn once after the trail completes.
