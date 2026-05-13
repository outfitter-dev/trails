# M3 Cross-Surface Parity Audit

Date: 2026-05-12
Issue: TRL-634
Branch: `trl-634-audit-cross-surface-parity-coverage-gaps`

## Summary

The current resolved workspace exposes 37 trails across two app topos:

- `@ontrails/trails`: 29 stored trails, 27 public surface-eligible trails
  projected on CLI, MCP, and HTTP.
- `trails-demo`: 8 stored trails, 7 public surface-eligible trails projected on
  CLI, MCP, and HTTP.

The projection posture is structurally aligned for the three shipped surfaces.
Every public, surface-eligible trail in both app topos derives a CLI command,
MCP tool, and HTTP route. The non-projected trails are either intentionally
internal or activation-source consumers that are not callable surface trails:

- `@ontrails/trails:create.scaffold`
- `@ontrails/trails:add.verify`
- `trails-demo:entity.notify-updated`

Execution parity is not yet proven. The repo has strong per-surface package tests and example/contract tests, but no first-party runner that executes the same trail example through CLI, MCP, and HTTP and compares normalized Result/error semantics.

WebSocket is excluded from the v1 parity gate because it is planned but not shipped. Active docs say the shipped surfaces are CLI, MCP, and HTTP, while WebSocket has no public package or API yet.

## Method

This audit used the live stack tip and resolved workspace/topo APIs, not a hand-built source list.

Commands and probes:

```bash
bun --eval 'import { buildWorkspaceTrailIndex } from "./packages/topographer/src/index.ts"; const result = await buildWorkspaceTrailIndex({ cwd: process.cwd() }); console.log(JSON.stringify(result, null, 2));'
```

Result: `apps` was `["@ontrails/trails","trails-demo"]`, `collisions` was empty, the index contained 37 trails, and `source` was `discovery` because no workspace `.trails/topo.lock` was present at audit time.

```bash
bun --eval '
import { app } from "./apps/trails/src/app.ts";
import { graph as demo } from "./apps/trails-demo/src/app.ts";
import { deriveCliCommands } from "./packages/cli/src/index.ts";
import { deriveMcpTools } from "./packages/mcp/src/index.ts";
import { deriveHttpRoutes } from "./packages/http/src/index.ts";

const unwrap = (result) =>
  result.isOk() ? result.value : (() => { throw result.error; })();

for (const [name, topo] of [["@ontrails/trails", app], ["trails-demo", demo]]) {
  const trails = topo.list();
  const cli = unwrap(deriveCliCommands(topo));
  const mcp = unwrap(deriveMcpTools(topo));
  const http = unwrap(deriveHttpRoutes(topo));
  const cliIds = new Set(cli.map((command) => command.trail.id));
  const mcpIds = new Set(mcp.map((tool) => tool.trailId));
  const httpIds = new Set(http.map((route) => route.trailId));
  console.log(JSON.stringify({
    name,
    storedTrails: trails.length,
    cli: cli.length,
    mcp: mcp.length,
    http: http.length,
    nonProjected: trails
      .filter((trail) =>
        !cliIds.has(trail.id) &&
        !mcpIds.has(trail.id) &&
        !httpIds.has(trail.id)
      )
      .map((trail) => ({
        activationSources: trail.activationSources.length,
        id: trail.id,
        on: trail.on.length,
        visibility: trail.visibility,
      })),
  }, null, 2));
}'
```

Result:

- `@ontrails/trails`: `storedTrails: 29`, `cli: 27`, `mcp: 27`, `http: 27`.
- `trails-demo`: `storedTrails: 8`, `cli: 7`, `mcp: 7`, `http: 7`.

Source checks:

- `packages/core/src/surface-filter.ts:150-169` is the common eligibility predicate. It excludes activation-source trails, internal trails unless explicitly included, excluded patterns, and intent-filtered trails.
- `packages/cli/src/build.ts:1186-1194`, `packages/mcp/src/build.ts:912-921`, and `packages/http/src/build.ts:773-782` all build from `filterSurfaceTrails(...)`.
- `packages/testing/src/all.ts:164-177` validates only CLI and MCP projections in `testAllEstablished()`.
- `packages/testing/src/index.ts:33-35` exports CLI and MCP harnesses, with no HTTP harness export.
- `docs/api-reference.md:149` says WebSocket is planned and has no public package or API.
- `docs/index.md:28-31` lists CLI, MCP, and HTTP as shipped today and WebSocket as planned.

## Coverage Matrix

Status legend:

- `projected`: a public trail derives on CLI, MCP, and HTTP.
- `internal`: intentionally absent from public surfaces.
- `activation consumer`: public trail excluded from callable surfaces because it
  is activated by a source.
- `execution parity`: not proven unless a test executes the same trail behavior across shipped surfaces and compares normalized results.

### `@ontrails/trails`

| Trail | Intent | CLI | MCP | HTTP | WebSocket | Projection Status | Execution Parity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `add.surface` | write | `add surface` | `trails_add_surface` | `POST /add/surface` | not shipped | projected | unverified |
| `add.trail` | write | `add trail` | `trails_add_trail` | `POST /add/trail` | not shipped | projected | unverified |
| `add.verify` | write | - | - | - | not shipped | internal | n/a |
| `completions` | read | `completions` | `trails_completions` | `GET /completions` | not shipped | projected | unverified |
| `completions.__complete` | read | `completions __complete` | `trails_completions___complete` | `GET /completions/__complete` | not shipped | projected | unverified |
| `create` | write | `create` | `trails_create` | `POST /create` | not shipped | projected | unverified |
| `create.scaffold` | write | - | - | - | not shipped | internal | n/a |
| `dev.clean` | destroy | `dev clean` | `trails_dev_clean` | `DELETE /dev/clean` | not shipped | projected | unverified |
| `dev.reset` | destroy | `dev reset` | `trails_dev_reset` | `DELETE /dev/reset` | not shipped | projected | unverified |
| `dev.stats` | read | `dev stats` | `trails_dev_stats` | `GET /dev/stats` | not shipped | projected | unverified |
| `draft.promote` | write | `draft promote` | `trails_draft_promote` | `POST /draft/promote` | not shipped | projected | unverified |
| `guide` | read | `guide` | `trails_guide` | `GET /guide` | not shipped | projected | unverified |
| `run` | write | `run` | `trails_run` | `POST /run` | not shipped | projected | unverified |
| `run.example` | write | `run example` | `trails_run_example` | `POST /run/example` | not shipped | projected | unverified |
| `run.examples` | read | `run examples` | `trails_run_examples` | `GET /run/examples` | not shipped | projected | unverified |
| `survey` | read | `survey` | `trails_survey` | `GET /survey` | not shipped | projected | unverified |
| `survey.brief` | read | `survey brief` | `trails_survey_brief` | `GET /survey/brief` | not shipped | projected | unverified |
| `survey.diff` | read | `survey diff` | `trails_survey_diff` | `GET /survey/diff` | not shipped | projected | unverified |
| `survey.resource` | read | `survey resource` | `trails_survey_resource` | `GET /survey/resource` | not shipped | projected | unverified |
| `survey.signal` | read | `survey signal` | `trails_survey_signal` | `GET /survey/signal` | not shipped | projected | unverified |
| `survey.trail` | read | `survey trail` | `trails_survey_trail` | `GET /survey/trail` | not shipped | projected | unverified |
| `topo` | read | `topo` | `trails_topo` | `GET /topo` | not shipped | projected | unverified |
| `topo.compile` | write | `topo compile` | `trails_topo_compile` | `POST /topo/compile` | not shipped | projected | unverified |
| `topo.history` | read | `topo history` | `trails_topo_history` | `GET /topo/history` | not shipped | projected | unverified |
| `topo.pin` | write | `topo pin` | `trails_topo_pin` | `POST /topo/pin` | not shipped | projected | unverified |
| `topo.unpin` | destroy | `topo unpin` | `trails_topo_unpin` | `DELETE /topo/unpin` | not shipped | projected | unverified |
| `topo.verify` | read | `topo verify` | `trails_topo_verify` | `GET /topo/verify` | not shipped | projected | unverified |
| `warden` | read | `warden` | `trails_warden` | `GET /warden` | not shipped | projected | unverified |
| `warden.guide` | read | `warden guide` | `trails_warden_guide` | `GET /warden/guide` | not shipped | projected | unverified |

### `trails-demo`

| Trail | Intent | CLI | MCP | HTTP | WebSocket | Projection Status | Execution Parity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `demo.upsert` | write | `demo upsert` | `demo_demo_upsert` | `POST /demo/upsert` | not shipped | projected | unverified |
| `entity.add` | write | `entity add` | `demo_entity_add` | `POST /entity/add` | not shipped | projected | unverified |
| `entity.delete` | destroy | `entity delete` | `demo_entity_delete` | `DELETE /entity/delete` | not shipped | projected | unverified |
| `entity.list` | read | `entity list` | `demo_entity_list` | `GET /entity/list` | not shipped | projected | unverified |
| `entity.notify-updated` | write | - | - | - | not shipped | public activation consumer | n/a |
| `entity.onboard` | write | `entity onboard` | `demo_entity_onboard` | `POST /entity/onboard` | not shipped | projected | unverified |
| `entity.show` | read | `entity show` | `demo_entity_show` | `GET /entity/show` | not shipped | projected | unverified |
| `search` | read | `search` | `demo_search` | `GET /search` | not shipped | projected | unverified |

## Intentional Surface Differences

The following differences are expected and should be preserved by any parity runner:

- Envelopes differ by surface. CLI reports exit code/stdout/stderr, MCP returns tool content plus `isError`, and HTTP returns a `Result` from route `execute()` that adapters map to status/body.
- HTTP maps `intent` to method: `read -> GET`, `write -> POST`, `destroy -> DELETE`.
- MCP maps trail IDs to tool names with the app prefix and underscore separators.
- CLI maps trail IDs to command segments and has CLI-only operational flags such as output mode and safety controls.
- Internal trails remain absent from public surfaces unless explicitly included.
  This matches `create.scaffold` and `add.verify`.
- Public activation consumers remain absent from callable surfaces because
  `filterSurfaceTrails()` excludes trails with activation sources. This matches
  `entity.notify-updated`.
- WebSocket is not part of v1 parity because no public surface package/API exists.

## Gap Analysis

### G1: HTTP harness is missing from `@ontrails/testing`

`@ontrails/testing` provides `createCliHarness()` and `createMcpHarness()`, but no matching `createHttpHarness()`. `testAllEstablished()` therefore validates CLI/MCP projection builds and omits the shipped HTTP projection from the established surface suite.

Impact: the project can ship an HTTP projection regression while `testAllEstablished()` stays green.

Follow-up: TRL-704.

### G2: No example-driven parity runner exists

Package tests validate CLI, MCP, and HTTP behavior separately. They do not execute the same trail example across all shipped surfaces and compare normalized success/error semantics.

Impact: the central doctrine "same trail, many surfaces" is structurally true but not enforced by a single M3 gate.

Follow-up: TRL-705.

### G3: Blind agents cannot query a complete shipped-surface projection inventory from one artifact-backed view

`topoStore.trails.get()` and `survey.trail` expose rich contract detail, but current `surfaceProjections` are not a complete CLI/MCP/HTTP exposure inventory. The audit had to combine `createTopoStore()`/`topoStore.trails.list()` with `deriveCliCommands()`, `deriveMcpTools()`, and `deriveHttpRoutes()` to build this matrix.

Impact: a blind agent can inspect rich trail contracts but still needs package-specific derivation knowledge to answer "where is this public trail exposed?"

Follow-up: TRL-706.

## Recommended M3 Gate

Add a parity helper after TRL-704 lands:

1. Build the authoritative trail list from the resolved TopoGraph/topo-store snapshot.
2. Filter to public trails eligible for shipped surfaces.
3. For each trail with examples, execute the same example through CLI, MCP, and HTTP harnesses.
4. Normalize each surface envelope into:
   - `ok`/`err`
   - output JSON payload for success
   - TrailsError category/code/retryability for failure
5. Compare normalized results.
6. Support explicit per-trail/per-surface exclusions for intentional differences.
7. Run the gate at least for `trails-demo` before requiring it across every app topo.

## Filed Follow-Ups

| Issue | Priority | Purpose |
| --- | --- | --- |
| [TRL-704](https://linear.app/outfitter/issue/TRL-704/add-http-surface-harness-and-include-it-in-testallestablished) | High | Add a first-party HTTP harness and include HTTP projection validation in `testAllEstablished()`. |
| [TRL-705](https://linear.app/outfitter/issue/TRL-705/add-example-driven-climcphttp-parity-runner-and-ci-gate) | High | Add example-driven CLI/MCP/HTTP parity execution and CI gate. |
| [TRL-706](https://linear.app/outfitter/issue/TRL-706/expose-complete-shipped-surface-projection-inventory-for-blind-parity) | Medium | Expose a complete shipped-surface projection inventory for blind agents and future parity gates. |

## Acceptance Check

- Trail x surface coverage matrix: complete for the two resolved app topos discovered in the workspace.
- Per-trail parity status: projection is complete for shipped surfaces; execution parity is unverified until TRL-704/TRL-705 land.
- Intentional divergences: documented above.
- Harness design sketch: documented above.
- CI gate recommendation: documented above.
- Follow-up issues: TRL-704, TRL-705, TRL-706.
