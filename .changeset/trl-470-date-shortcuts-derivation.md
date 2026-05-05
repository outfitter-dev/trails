---
'@ontrails/cli': minor
---

Absorb `dateShortcutsLayer` behavior into CLI surface derivation. Trails with date input fields (`z.iso.datetime()`, `z.iso.date()`, `z.string().datetime()`, `z.date()`, plus optional/default wrappers) now auto-accept shortcuts on the CLI: `today`, `yesterday`, `Nd` (N days ago), `this-week` (start-of-week Monday UTC), `this-month` (first-of-this-month UTC). Shortcuts expand to UTC ISO before Zod validation. Plain ISO strings pass through unchanged. Digit-led typos like `7day`/`3w` surface a `ValidationError`. Detection lives in `packages/cli/src/date-shortcuts.ts`. The legacy `dateShortcutsLayer` export is kept through Phase 2–7 for back-compat; removal lands in TRL-475 (Phase 8).
