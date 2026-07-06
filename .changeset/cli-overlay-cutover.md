---
"@ontrails/core": patch
"@ontrails/topographer": patch
"@ontrails/cli": patch
"@ontrails/commander": patch
"@ontrails/warden": patch
"@ontrails/trails": patch
---

Hard cutover: the CLI consumes `cli` bindings from the app-authored surfaces overlay. Scalar bindings behave identically to the removed cliAliases (parity-tested) — the binding name splits on `.` into a transparent synonym command path for exactly one trail. List bindings arrive as command groups: each expanded member trail gets a group-prefixed route that dispatches the member trail with its identity preserved, and a singleton list stays a group. Expansion is fail-fast boundary validation: a scalar binding resolving to zero or multiple trails, or a group with an empty member union, is a `ValidationError` naming the binding. `DeriveTopoGraphOptions.cliAliases`, the `cliAliases`/`trailsCliAliases` app-module export convention, and the per-kind compile lift are deleted; `deriveCliCommands`/`createProgram` take `overlays` instead of `aliases`, and both topo-graph derivation pipelines expand the same bindings through one shared helper so runtime CLI routes and lock routes come from one semantic. A leftover legacy export is now a Warden error (`no-legacy-cli-alias-export`) naming the `surfaceOverlay({ cli: { ... } })` rewrite.

This is a breaking API removal shipped under the lockstep beta patch convention (pre-1.0 hard-cutover posture, zero external adoption); the removed options have no deprecation window by design.
