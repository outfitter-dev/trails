# switchback

Feature flags with deterministic, explainable evaluation — the Trails library-first showcase. A switchback is a turn in the trail: the same flag can send different subjects down different paths, and this app always tells you exactly why.

This is the app for "I don't want a server, I want a package." One authored trail contract is consumed three ways with zero divergence: as a typed in-process library, as CLI commands, and as MCP tools.

## What this showcases

| Capability | Where it appears |
| --- | --- |
| Library surface + rendering artifacts | [quickstart.ts](quickstart.ts) consumes the topo through `@ontrails/library`; the committed [trails.lock](trails.lock) embeds the collision-free rendering, and [governance.test.ts](src/__tests__/governance.test.ts) keeps `library-rendering-coherence` clean |
| Pure, deterministic implementations | [engine.ts](src/engine.ts) is a pure function of (flag definition, evaluation context) — no clock, no randomness; [engine.test.ts](src/__tests__/engine.test.ts) pins fixed hash vectors forever |
| Explainability | every `flag.evaluate` result carries a rule-by-rule `EvalTrace`; the CLI renders it with `--explain` ([evaluate.ts](src/trails/evaluate.ts)) |
| Percentage rollouts | seeded FNV-1a hashing buckets each flag+subject stably ([engine.ts](src/engine.ts)) |
| Non-DB resource | the `flags` resource is a JSON file reloaded on every read, deliberately not a database ([resources/flags.ts](src/resources/flags.ts)) |
| Surface parity | every trail example runs identically on CLI, MCP, and HTTP harnesses ([surface-parity.test.ts](src/__tests__/surface-parity.test.ts)) |
| Publishability | the example passes `bun pm pack --dry-run` cleanly, as scaffolding for real library packages |

## Quickstart

Every command below runs verbatim from a fresh checkout.

```bash
bun install        # from the repo root
cd examples/switchback
```

The library surface first — five lines to your first evaluation. This is the committed [quickstart.ts](quickstart.ts):

```ts
import { surface } from '@ontrails/library';
import { app } from 'switchback';

const lib = await surface(app);
console.log(await lib.call.flagEvaluate({ context: { subjectId: 'user-1' }, key: 'checkout-v2' }));
```

```bash
bun quickstart.ts
bun test           # examples, fixed vectors, parity, governance
```

## One contract, three surfaces

`flag.evaluate` is authored once in [src/trails/evaluate.ts](src/trails/evaluate.ts). The same trail, invoked three ways:

**Library import** (the hero):

```ts
const lib = await surface(app);
await lib.call.flagEvaluate({ context: { subjectId: 'user-1' }, key: 'checkout-v2' });
```

**CLI command:**

```bash
bun bin/switchback.ts flag evaluate checkout-v2 '{"context":{"subjectId":"user-1"}}' --explain
```

**MCP tool** — start the server with `bun src/mcp.ts` and the same trail is the `switchback_flag_evaluate` tool, trace included, so an agent can ask "is checkout-v2 on for this user, and why?":

```json
{ "name": "switchback_flag_evaluate", "arguments": { "key": "checkout-v2", "context": { "subjectId": "user-1" } } }
```

No divergence is possible: the CLI flags, the tool schema, and the library method are all rendered from the one authored input schema.

## Every answer explains itself

Evaluation never just returns a value — it returns the `EvalTrace` of how the value was chosen. Rules are checked in order; the trace records each one as `matched`, `skipped` (with the failing condition), or `percentage` (with the bucket):

```json
{
  "key": "checkout-v2",
  "value": "treatment",
  "variant": "treatment",
  "reason": {
    "reason": "percentage-rollout",
    "steps": [
      { "ruleId": "beta-users", "outcome": "skipped", "detail": "attribute \"plan\" is missing" },
      { "ruleId": "gradual-rollout", "outcome": "percentage", "bucket": 7, "served": "treatment" }
    ]
  }
}
```

Pass `explain: true` (the CLI `--explain` flag) and the result adds a human-readable rendering of the same trace.

## Deterministic rollouts: the hash contract

Percentage rollouts must be stable forever: a subject that sees the treatment today must see it tomorrow. `bucketFor` in [src/engine.ts](src/engine.ts) is standard FNV-1a 32-bit over the UTF-8 bytes of `"<flagKey>:<subjectId>"`:

```text
hash = 0x811c9dc5
for each byte b: hash = (hash XOR b) * 0x01000193  (mod 2^32)
bucket = hash mod 100
```

The bucket is stable per flag+subject and independent across flags. Fixed vectors are asserted in [engine.test.ts](src/__tests__/engine.test.ts) and must never change: `checkout-v2:user-1 → 7`, `checkout-v2:user-42 → 10`, `dark-mode:user-1 → 58`. `flag.evaluate` is a pure function of the flag definition and the evaluation context — no clock, no randomness, no I/O beyond reading the `flags` resource — which is why its examples can pin exact expected results and serve as the spec.

## The flags resource is a file on purpose

Flag definitions live in [switchback.flags.json](switchback.flags.json), reloaded on every read and rewritten by the mutation trails. Not every resource is a database; this one shows the resource contract carrying a plain file, with a mock factory that serves the same fixture definitions so `testAll(app)` runs with zero configuration. Point `SWITCHBACK_FLAGS_PATH` at another file to relocate it. The definitions file and [src/fixtures.ts](src/fixtures.ts) are kept in sync by a test; regenerate with `bun run scripts/generate-flags-file.ts`.

`flag.evaluate-all` produces the bootstrap payload (every live flag for one subject) and records it in the in-memory `audit` resource — the demo eval log behind `audit.list`, deliberately ephemeral and clock-free. Single-flag `flag.evaluate` stays hermetically pure.

## The trails

| Trail | Intent | Notes |
| --- | --- | --- |
| `flag.evaluate` | read | the hero: value + variant + `EvalTrace`, optional `explain` rendering |
| `flag.evaluate-all` | read | bootstrap payload for one subject; recorded in the demo audit log |
| `flag.create` / `flag.list` / `flag.get` / `flag.update` / `flag.archive` | write/read | definitions CRUD; duplicate keys conflict, archived flags retire from evaluation |
| `flag.enable` / `flag.disable` | write | idempotent lifecycle toggles |
| `rule.add` / `rule.remove` / `rule.reorder` | write | ordered rules; first full match wins, so position matters |
| `audit.list` | read | the in-memory demo eval log |

## Fork this as your package scaffold

If you are building a library-first Trails package, this example is the template:

- **Author trails, export the topo.** [src/index.ts](src/index.ts) is the package entry: the `app` topo plus the domain schemas and the pure engine.
- **The library rendering is governed.** `deriveLibraryApi(app)` derives one camelCase export per trail (`flag.evaluate` → `flagEvaluate`); the Warden rule `library-rendering-coherence` fails the build if two trails ever collide on an export name, and the resolved rendering is committed inside [trails.lock](trails.lock). When you want fully typed per-trail exports instead of the in-memory client, `compile(app, …)` from `@ontrails/library` emits a TypeScript package from the same rendering.
- **Packing is checked.** `bun pm pack --dry-run` packs source, bin, and demo data with no test files — the same shape a real published package needs. This example stays `private: true`; delete that field, name your package, and publish checks apply as-is.
- **Surfaces come free.** [bin/switchback.ts](bin/switchback.ts) and [src/mcp.ts](src/mcp.ts) are three lines each; CLI commands and MCP tools are renderings of the contract you already wrote.

## Governance

The committed [trails.lock](trails.lock) is the resolved story of the app: 13 trails, 2 resources, 28 examples, and the library rendering, all inspectable with Wayfinder (`bun ../../apps/trails/bin/trails.ts wayfind --overview --root-dir . --json`). [governance.test.ts](src/__tests__/governance.test.ts) runs Warden in CI: zero errors and no lock drift, or the suite fails.
