# lookout

Uptime monitor with a public status page — the fire-lookout tower for your services, and the showcase app that proves Trails is a runtime, not just a router.

## What this showcases

| Capability | Where to look |
| --- | --- |
| Activation sources (cron) | [`src/trails/sweep.ts`](src/trails/sweep.ts) — `schedule.probe.sweep` ticks `probe.sweep`, which probes every due enabled check; [`src/dev.ts`](src/dev.ts) materializes the source with a cron factory |
| Detours — real retry/recovery | [`src/trails/probe.ts`](src/trails/probe.ts) — timeout, connection-reset, and 502/503 replies recover through detour contracts with bounded retries and backoff, never inline retry loops |
| The honest middle state | `probe.run` records `recovered-after-retry` when a retry saves the probe — visible in history instead of pretending the blip never happened |
| Signals (`fires` / `on`) | [`src/signals/probe-signals.ts`](src/signals/probe-signals.ts) — up→down fires `probe.failed`, down→up fires `probe.recovered`; [`src/trails/incident.ts`](src/trails/incident.ts) consumes them with `on:` |
| Transition-deduped incidents | [`src/trails/incident.ts`](src/trails/incident.ts) — one outage is one incident, no matter how many probes fail while it lasts ([`__tests__/incident-lifecycle.test.ts`](__tests__/incident-lifecycle.test.ts) proves it) |
| Compose chains | `incident.open`/`incident.resolve` compose `notify.dispatch`; `status.summary` → `uptime.report` → `probe.history` is a three-level read chain ([`src/trails/status.ts`](src/trails/status.ts)) |
| Observe / tracing | [`src/observe.ts`](src/observe.ts) — memory trace store + console log sink at topo scope; `tracing.query` answers "what ran and why did it fail" from the same records |
| Scriptable resource mocks | [`src/resources/probe-http.ts`](src/resources/probe-http.ts) — the http mock plays per-URL reply sequences (fail, fail, succeed), which is what makes the detour tests possible offline |
| Public + private surface split | Status reads declare `permit: 'public'`; check management, acknowledge, and prune carry the `lookout:admin` permit ([`src/permits.ts`](src/permits.ts)) |
| Maintenance / retention | `probe.prune` reconciles stored probe volume against a retention cap, with real `--dry-run` support |
| Store + reactive fixtures | [`src/store.ts`](src/store.ts) — four tables authored once, bound to SQLite through `@ontrails/drizzle`, mocked in memory for tests |

22 trails, 3 surfaces (CLI, HTTP, MCP), `testAll(app)` green offline, committed `trails.lock`.

## Quickstart

From `examples/lookout/` in the Trails repo (`bun install` at the repo root first):

Terminal 1 — the provided flaky local test server:

```bash
bun run flaky-server
```

Terminal 2 — add two checks, then start the fast-mode loop:

```bash
bun bin/lookout.ts check create --name steady --url http://localhost:4090/steady --interval-seconds 30
bun bin/lookout.ts check create --name flaky --url http://localhost:4090/flaky --interval-seconds 30
bun bin/lookout.ts dev --fast
```

`dev --fast` runs the probe intervals at seconds-scale. Within one terminal minute you will watch the entire reactive loop:

```text
[lookout dev] status page: http://0.0.0.0:4091/status/summary
[lookout dev] schedule runtime running (fast, 2s tick) — ctrl-c to stop
[lookout dev] probed 019f…ece -> up
[lookout dev] probed 019f…8ba -> up
[lookout dev] probed 019f…8ba -> recovered-after-retry        ← a 503 blip, saved by the detour retry
{"…","message":"lookout notification: check \"flaky\" is down (upstream answered 503)","kind":"opened"}
[lookout dev] probed 019f…8ba -> down                          ← retries exhausted, incident opened
[lookout dev] probed 019f…8ba -> down                          ← still down: no new signal, no second incident
{"…","message":"lookout notification: check \"flaky\" recovered","kind":"resolved"}
[lookout dev] probed 019f…8ba -> recovered-after-retry         ← back up, incident resolved
```

While it runs, the status page updates live:

```bash
curl -s localhost:4091/status/summary
# {"data":{"checks":[{"name":"steady","state":"up","uptime7d":100,…},
#                    {"name":"flaky","state":"up","uptime7d":71.43,…}],
#          "openIncidents":0,…}}
```

Poke around afterwards:

```bash
bun bin/lookout.ts status            # the same summary on the CLI
bun bin/lookout.ts incident list
bun bin/lookout.ts probe history --check-id <id>
bun bin/lookout.ts probe prune --keep-per-check 100 --dry-run
```

The local CLI runs as the operator, so admin trails work directly. The HTTP and MCP surfaces keep admin behind a bearer token: set `LOOKOUT_ADMIN_TOKEN` and send `Authorization: Bearer <token>`; public status reads need no auth at all.

## The activation model, plainly

Trails declare *what* activates them; a runtime materializes *how*. `probe.sweep` declares `on: [schedule('schedule.probe.sweep', { cron: '* * * * *' })]` — that declaration is contract data, visible in the topo and the lock. `lookout dev` materializes it with `createScheduleRuntime(graph, { cron })`, handing in an interval-based cron factory (2s ticks in fast mode, 60s otherwise). The sweep then reads each enabled check's own `intervalSeconds` and composes `probe.run` for every check that is due — so pausing a check (`check pause`) flips `enabled` and removes it from scheduling without touching the schedule source, and `check resume` puts it back. Swap the materializer (say, Cloudflare Cron Triggers) and the same trails run unchanged.

## MCP: "why did api.example.com fail last night?"

Start the MCP surface with `bun src/mcp.ts` (stdio). An agent connecting to it sees `lookout_status_summary`, `lookout_probe_history`, `lookout_incident_list`, `lookout_incident_get`, `lookout_uptime_report`, `lookout_tracing_query`, and friends — enough to answer the question from incident, probe, and trace data. A real transcript against the demo run above:

> **User:** why did the flaky check go down last night?
>
> **Agent:** *calls `lookout_incident_list {}`*
>
> ```json
> {"incidents":[{"id":"019f2f6d-d44e-…","checkId":"019f2f6d-6462-…",
>   "openedAt":"2026-07-04T23:19:14.756Z","resolvedAt":"2026-07-04T23:19:22.759Z",
>   "status":"resolved","acknowledgedBy":null}],"total":1}
> ```
>
> **Agent:** *calls `lookout_probe_history {"checkId":"019f2f6d-6462-…","sinceHours":24}`*
>
> ```json
> {"probes":[
>   {"outcome":"recovered-after-retry","attempts":2,"failureReason":null},
>   {"outcome":"down","attempts":3,"failureReason":"upstream answered 503"},
>   {"outcome":"down","attempts":3,"failureReason":"upstream answered 503"},
>   {"outcome":"recovered-after-retry","attempts":2,"failureReason":null},
>   …]}
> ```
>
> **Agent:** *optionally calls `lookout_tracing_query {"errorsOnly":true}` for the runtime spans of the failing runs*
>
> **Agent:** The flaky check had one incident, open from 23:19:14 to 23:19:22 UTC. The upstream answered 503 on three consecutive attempts (initial probe plus two detour retries), so the check was marked down and the incident opened; the earlier and later 503 blips were absorbed by a single retry each and recorded as `recovered-after-retry` without ever opening an incident. The check recovered on its next probe and the incident auto-resolved.

## Surfaces

| Surface | Entry | Notes |
| --- | --- | --- |
| CLI | `bun bin/lookout.ts …` | Commands derive from trail ids (`check create`, `incident list`); `status` is the authored CLI path for `status.summary`; `dev [--fast]` is the runtime orchestrator |
| HTTP | `bun src/http.ts` (or `bun run http`) | `GET /status/summary`, `GET /status/badge?checkId=…`, `GET /incident/list`, `GET /probe/history?checkId=…` public; admin routes behind `LOOKOUT_ADMIN_TOKEN` |
| MCP | `bun src/mcp.ts` | Tools derive from the public trail contracts; same bearer token gates admin tools |

## Testing

```bash
bun test
```

Everything runs offline: `testAll(app)` drives every trail example against the in-memory store mock and the scripted http mock, and the focused suites prove the detour money paths (fail-fail-succeed → `recovered-after-retry`; fail×3 → `down` + incident + notification; recovery → resolve), incident transition dedupe, uptime fixed vectors, and the HTTP public/admin split.

## Storage

SQLite via `@ontrails/drizzle`, at `lookout.sqlite` in the working directory (override with `LOOKOUT_DB`, including `:memory:`). The file is gitignored.
