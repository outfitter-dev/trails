# Source map

- Full acceptance: <https://linear.app/outfitter/issue/TRL-1417/recognize-result-provenance-from-typed-resource-methods-in>
- Campaign: <https://linear.app/outfitter/document/trails-six-lane-campaign-operating-plan-and-decisions-2026-10-28-54fec3988899>
- Current AGENTS.md, .agents/plans/PLANNING.md, trails-goal-loop and trails-local-review govern execution.
- Warden-private result-method-provenance.ts owns explicit core import/type/class/method/context/scope/await witnesses. result-provenance-imports.ts owns reused relative import resolution and direct declaration binding, bounded to resource/class import edges.
- implementation-returns-result.ts owns shared Result expression/local annotation tracking and return coaching; no-redundant-result-error-wrap.ts consumes exactly those witnesses and local annotations.
- source/nodes.ts owns fact-only getNodeTypeArguments/getNodeTypeName/getNodeStatic/getNodeOptional. source/index.ts already re-exports nodes through its public facade; public-api and generic-node-accessors tests pin the contract.
- result-method-provenance.test.ts covers imported resource/class aliases, direct/rewrapped and async Results, raw shapes, receiver/context identity, reassignment, optional/static/computed/missing-generic/non-core/overloaded exclusions. Existing no-sync-result-assumption tests remain a separate retained guard.
- Actual consumer source: <https://github.com/outfitter-dev/dispatch-next/blob/0fab8a683821c4901078a7f25b2b443eac777e29/src/trails/observation-import.ts> and its services/identity.ts, store/identity/store.ts. Reports copy the relevant evidence so tracked handoff does not depend on ignored preflight notes.
