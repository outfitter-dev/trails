# Route Vocabulary Audit

Date: 2026-05-20
Branch: `trl-734-audit-route-vocabulary-across-packages-consider-reserving`
Issue: `TRL-734`

## Scope

Command used for the broad audit:

```bash
rg -n "\\broute\\b|\\broutes\\b|Route" packages apps docs README.md AGENTS.md .claude .agents
```

The cleanup pass focused on current-facing non-HTTP prose, comments, test names, and strings where `route` or `Route` was being used as an informal synonym for trail, path, mapping, writing, or forwarding.

## Changed

- Reworded Clark guidance so the Trail Posture metaphor says "path" rather than "route."
- Reworded demo and `apps/trails` comments, test names, and error messages from route/Route to trail/Trail where the object is a Trails trail.
- Reworded source comments and test descriptions that used route as a general verb for data flow, output writing, sink selection, or helper classification.
- Reworded store fixture comments from "shape-routed" to "shape-based."
- Reworded lint messages from "Route diagnostics/writes" to "Send diagnostics/writes."
- Reworded contributor prose in the outdoor `blaze` explanation from "route" to "path."

## Preserved

- HTTP route terminology in `@ontrails/http`, HTTP docs, HTTP harnesses, Warden's `webhook-route-collision` rule, and docs that explicitly describe HTTP route derivation.
- Explicit teaching mentions that flag `route` as wrong for composition or trail/blaze naming, such as Clark calibration and the language styleguide guardrails.
- Historical `.agents/plans/v1/**` material. Those files preserve pre-current planning vocabulary (`route`, `follow`, older surface grammar) and rewriting them would be historical churn rather than current-facing cleanup.
- Existing `routing` map identifiers in CLI/MCP layer projection internals. They describe parameter-to-layer-field data mapping and are outside the exact `route`/`routes` audit target. Renaming those internal types would be a broader API/code-shape change than this cleanup branch needs.

## Post-Cleanup Expected Hits

Remaining hits from the broad command should be one of:

- legitimate HTTP route docs or source;
- Warden rule names/messages for HTTP route collision;
- explicit vocabulary-teaching examples where `route` is named as a term to avoid;
- historical `.agents/plans/v1/**` references.

No current-facing demo/app trail should call itself a route after this pass.
