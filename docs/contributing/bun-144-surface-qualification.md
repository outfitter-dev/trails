# Bun 1.4.4 surface qualification

[TRL-1433](https://linear.app/outfitter/issue/TRL-1433) qualifies the HTTP, CLI, MCP, and Drizzle paths on Bun `1.4.4+38afee6c8`. The base was `2ea62daed2819060453e55135a00d2b1f347e79b`. The change adds regression tests and this record; production behavior, dependencies, locks, and the consumer floor `>=1.4.0` remain unchanged.

## HTTP

The live Bun test uses loopback and an ephemeral port. Its native control has only a `GET` route: Bun answers `HEAD` by entering that GET function once and suppressing its body. The Trails route uses the actual `createApp`-derived GET and HEAD functions with entry counters. Its HEAD request enters the explicit derived HEAD once, enters neither the GET function nor fallback, executes the trail once, and returns an empty body.

The observation is that Bun's implicit HEAD fallback does not shadow or double-invoke Trails' explicit derived HEAD. The existing [derived handler](../../packages/http/src/bun.ts) remains the contract; no new HEAD policy is introduced.

Additional regression cases prove:

- A `node:http` client sends duplicate physical `X-Tenant-ID` header lines to the live Trails server. The permit resolver observes `tenant-1, tenant-2` and the request succeeds.
- An actual connection attempt after closing an ephemeral loopback server becomes `NetworkError` through `Result.fromFetch`, preserving native `TypeError` as its cause.
- The Hono `createApp` responds to HEAD on a derived GET route with an empty body and one trail execution. This exercises Hono's dispatch under Bun without adding a second authored HEAD route.

The owning tests are [Bun HTTP](../../packages/http/src/__tests__/bun.test.ts), [fetch errors](../../packages/core/src/__tests__/fetch.test.ts), and [Hono](../../adapters/hono/src/__tests__/surface.test.ts).

The production HTTP, Hono, and core sources contain no `Request.clone()` or `Response.clone()` calls. Hono reconstructs a request after reading its body; it does not clone a consumed request. Invalid-port validation remains delegated to Bun. The Bun surface closes with explicit `server.stop(true)`, so this record makes no new guarantee about the runtime's default in-flight stop behavior.

## CLI and saved Wayfinder artifacts

The [CLI integration test](../../apps/trails/src/__tests__/bun-144-cli-protocol.integration.test.ts) starts the actual TypeScript CLI in a subprocess with non-TTY pipes. A temporary preload emits a Node-style warning. The command reads the committed operator lock:

```bash
bun apps/trails/bin/trails.ts wayfind --overview --root-dir apps/trails --json
```

The subprocess exits successfully. The warning appears on stderr only; stdout contains plain, parseable JSON with no warning or ANSI escape. Wayfinder reports `source: "locked"`, `view: "overview"`, a `topoGraph` source at `apps/trails/trails.lock`, and a positive saved trail population.

The scoped CLI, Commander, and operator audit found no tracked snapshot files, snapshot matcher calls, or `styleText()` calls to update. This proof runs the TypeScript entrypoint under Bun; compiled-executable autoload behavior is outside this qualification.

## MCP stdio and SDK resolution

The [stdio regression](../../packages/mcp/src/__tests__/stdio.test.ts) starts the shipped MCP surface in a Bun subprocess. It exchanges real initialization, tool-list, and tool-call messages. Raw stdout contains exactly the three JSON-RPC responses with IDs 1, 2, and 3. Startup and invocation warnings both appear on stderr. The test bounds the subprocess lifetime and closes it during teardown.

The fresh installation resolved MCP SDK `1.28.0`. A runtime probe resolved Express from the SDK's actual `server/express.js` location to Express `5.2.1`, matching the SDK's dependency range `^5.2.1`. Importing the SDK's Express app factory produced an app with a callable `handle`. Trails' stdio path does not require a new Express peer or dependency override.

## Drizzle migrations and affected rows

The [migration tests](../../adapters/drizzle/src/__tests__/migration.test.ts) create a new temporary physical SQLite file and authored temporary journal/SQL files. They invoke the installed official `drizzle-orm/bun-sqlite/migrator` through the adapter's existing `connection.query()` escape hatch.

The success case applies a schema change, data update, and trigger; rerunning leaves one migration ledger entry and does not repeat the data change. SQL `changes()` reports one directly updated row while a separately inspected trigger audit records its own row. A later update still reports one direct change while adding another audit row. Closing and reopening through the evolved store preserves the migrated value.

The failure case puts invalid SQL between otherwise valid statements. The migration rejects through `connection.query()`. After close and reopen, the original row is restored, the partial table and later trigger are absent, and the migration ledger has no applied entry. Teardown tracks every active connection and closes it before removing temporary files, including after assertion or setup failures.

These results qualify the official synchronous migrator's explicit transaction and its rollback/rethrow path. `connection.query()` awaits its callback but does not create a transaction. The tests do not establish support for asynchronous `drizzle.transaction()` callbacks or introduce a public migration API.

The [shipped CRUD implementation](../../adapters/drizzle/src/runtime.ts) uses `RETURNING` rows to determine insert, update, and delete outcomes, rather than `Changes.changes`. The public Drizzle `run()` type returns `void`, so the regression reads affected rows with supported SQL instead of assuming a driver-specific return object. This adapter uses `bun:sqlite`, not `Bun.SQL`; the latter's `PASSWORD` environment handling does not apply.

## Verification and distribution

With the owned Bun 1.4.4 runtime first on `PATH`, the affected-suite command was:

```bash
bun test packages/core packages/http adapters/hono packages/cli adapters/commander packages/mcp packages/store adapters/drizzle apps/trails/src/__tests__/bun-144-cli-protocol.integration.test.ts
```

It passed 2,146 tests across 106 files, with zero failures and 5,942 assertions. This includes all tests in those eight packages and the focused operator subprocess test; it does not claim the full operator suite or a new canonical root test run. The previous [test qualification](./bun-144-test-qualification.md) records the separate full canonical serial, bounded parallel, and coverage scenarios.

Affected production typechecks passed 18 uncached Turbo tasks, including dependencies. The broader optional test-source configurations reported diagnostics outside the changed test files; they are not claimed green. Scoped test-source checks, lint, and documentation checks are recorded in the handoff evidence.

This is tests and contributor documentation only: `release:none`. No published source behavior, surface contract, topo exposure, generated lock, agent rule, or migration command changes. Changesets, governance generation, Skillset regeneration, a new Wayfinder dogfood run, lock round-trip, and publication checks are not applicable to this patch. This layer does not perform the separate lock/release work or a live database migration.
