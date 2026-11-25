# Source map

- [TRL-1320](https://linear.app/outfitter/issue/TRL-1320/record-evaluated-app-identity-in-warden-results-executedappid): acceptance and scope.
- [TRL-1321](https://linear.app/outfitter/issue/TRL-1321/thread-configpath-through-the-shared-operator-project-context-resolver): landed prerequisite, verified ancestry.
- `docs/adr/0054-project-substrate-names-its-truth.md`: shared selection and one-app/workspace result contract.
- `apps/trails/src/trails/warden.ts`: owning output and JSON rendering.
- `packages/warden/src/cli.ts`: existing report.topoNames derivation from actual evaluated targets.
- `apps/trails/src/__tests__/warden.test.ts`: actual runner and subprocess fixtures.
- `apps/trails/src/trails/run.ts` and `run-examples.ts`: established executedAppId vocabulary.

Ignored `/tmp/trl-1320-{red,green}.log` capture the local runs; their load-bearing outcomes are summarized in RETRO.md. No tracked claim depends on those logs remaining available.
