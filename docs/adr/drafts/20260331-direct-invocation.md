---
slug: direct-invocation
title: Direct Trail Invocation (`trails run`)
status: draft
created: 2026-03-31
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [17]
---

# ADR: Direct Trail Invocation (`trails run`)

## Context

### The missing inner loop

A developer authors a trail. To see it work, they have three options:

1. **Write a test.** `testExamples(app)` runs examples. Good for validation. Not good for exploration. The developer wants to throw arbitrary input at the trail and see what happens, not write a test case first.
1. **Blaze a trailhead.** Set up Commander, run the CLI binary, pass flags. Or start the MCP server, connect a client, call the tool. Or start the HTTP server, curl the endpoint. Each requires infrastructure: a bin entry, a blaze call, a running server. The developer wants to run one trail, not boot an application.
1. **Write a script.** Import the topo, call `run()`, console.log the result. Works, but it's throwaway code. A new file for every ad-hoc invocation. Friction that discourages exploration.

Every other runtime has a direct invocation path. `bun run script.ts`. `python -c "..."`. `ruby -e "..."`. Even build tools have it: `make target`, `cargo run`. The pattern is universal: point at a thing, run it, see the result.

Trails has `run()` as a programmatic API. It doesn't have a direct CLI command for it. The gap is small but the friction is real: the developer must write code to run code.

### `run()` is already the universal pipeline

Every invocation path converges on `run()` which calls `executeTrail()`: validate input, resolve context, compose layers, run implementation, return Result. CLI trailheads call it. MCP trailheads call it. HTTP trailheads call it. Crossings call it. Triggers call it.

`trails run` is `run()` wired to stdin/stdout. The infrastructure is already there. The execution semantics are identical to every other invocation path. The trail doesn't know it's being run from `trails run` vs a blazed CLI trailhead vs an MCP tool call. The pipeline is the pipeline.

### What the examples teach us

A trail's examples are structured input/output pairs. They're already the closest thing to "here's how to call this trail." `trails run` makes them directly executable:

```bash
# Run the trail with example input
trails run entity.show --example "Found"
```

The example named "Found" has `input: { id: 'p_1' }`. `trails run` feeds that input to the trail and shows the result alongside the expected output. Did the actual result match? The developer sees immediately. No test harness needed.

## Decision

### `trails run` invokes a trail by ID

```bash
trails run <trail-id> [input]
```

The command resolves the topo, finds the trail by ID, validates the input, executes through the full pipeline, and prints the Result.

```bash
$ trails run entity.show '{"name": "Alpha"}'
{
  "ok": true,
  "value": {
    "name": "Alpha",
    "type": "concept",
    "tags": ["core"]
  }
}
```

On error:

```bash
$ trails run entity.show '{"name": "nonexistent"}'
{
  "ok": false,
  "error": {
    "code": "NotFoundError",
    "category": "not_found",
    "message": "Entity not found: nonexistent"
  }
}
```

Exit codes follow the same error taxonomy mapping as the CLI trailhead: 0 for success, category-mapped codes for errors. The output is JSON by default (machine-readable, pipeable). Human-readable formatting is opt-in.

### Input sources

Input can come from multiple sources, in priority order:

**Inline JSON argument:**

```bash
trails run entity.show '{"name": "Alpha"}'
```

**Named example:**

```bash
trails run entity.show --example "Found"
# Uses the example's input, shows actual vs expected
```

**Piped stdin:**

```bash
echo '{"name": "Alpha"}' | trails run entity.show
cat input.json | trails run entity.show
```

**File reference:**

```bash
trails run entity.show --input ./fixtures/alpha.json
```

**No input (for trails with empty or fully-defaulted schemas):**

```bash
trails run health.check
trails run booking.send-reminders
```

### Output flags

Two standard axes that every developer already has muscle memory for, plus one dimension that's uniquely Trails.

#### Format axis (how the result looks)

```bash
(default)   # pretty-printed for humans in a terminal
--json      # compact machine-readable JSON, single object
--jsonl     # one JSON record per line, for streaming
```

#### Verbosity axis (how much result context)

```bash
--quiet     # just the value (success) or error message (failure). No Result wrapper.
(default)   # the Result object. Enough to know what happened.
--verbose   # the Result + execution metadata: duration, resources, permit, events.
```

These compose naturally:

```bash
# Pipe-friendly: just the value as compact JSON
trails run entity.show '{"name": "Alpha"}' --quiet
# {"name":"Alpha","type":"concept"}

# Human-friendly: the full Result, formatted
trails run entity.show '{"name": "Alpha"}'
# {
#   "ok": true,
#   "value": { "name": "Alpha", "type": "concept" }
# }

# Diagnostic: the Result + everything about the execution
trails run booking.confirm '{"slotId": "slot_1"}' --verbose
# Result: ok
# Value: { bookingId: "bk_123", status: "confirmed" }
# Duration: 380ms
# Resources: bookingStore, billingService, emailService
# Events: booking.confirmed (1 trigger, 0 subscriptions)
# Permit: none (direct invocation)
```

Standard stuff. Every developer knows these patterns from other tools. No new concepts.

#### The tracing dimension (the journey, not just the destination)

`--tracing` is not a verbosity level. It's a different kind of output entirely.

The format and verbosity flags control the *result*: what the trail returned, and how much context to show around it. `--tracing` adds the *journey*: the live execution narrative as the system works.

```bash
trails run booking.confirm '{"slotId": "slot_1"}' --tracing
```

The tracing stream to stderr. The result goes to stdout. They don't interfere:

```bash
# Tracing stream to stderr, result pipes cleanly to jq
trails run booking.confirm '{"slotId": "slot_1"}' --tracing | jq '.bookingId'
```

Same pattern as progress bars and log lines: narrative to stderr, data to stdout. Unix convention.

**What the tracing stream looks like:**

```bash
$ trails run booking.confirm '{"slotId": "slot_1"}' --tracing

● booking.confirm
  ├── availability.reserve (slot_1)
  │   └─ ✓ 45ms
  ├── billing.charge ($50.00)
  │   └─ ✓ 120ms
  ├── ↑ emit booking.confirmed
  │   └─ → notify.booking-confirmed (triggered)
  │      ├── email.send (user_1@example.com)
  │      │   └─ ✓ 200ms
  │      └─ ✓ 210ms
  └─ ✓ 380ms

{"ok": true, "value": {"bookingId": "bk_123", "status": "confirmed"}}
```

The tree renders in real time. Each step appears when it starts. The checkmark and timing appear when it completes. Event emissions show as they fire. Triggered trails appear when activation starts. The tree grows as you watch. When everything is done, the final result prints to stdout.

**Tracing composes with every standard flag:**

```bash
# Tracing + quiet: the journey, then just the value
trails run booking.confirm '{"slotId": "slot_1"}' --tracing --quiet

● booking.confirm
  ├── availability.reserve ✓ 45ms
  ├── billing.charge ✓ 120ms
  ├── ↑ booking.confirmed → notify.booking-confirmed ✓ 210ms
  └─ ✓ 380ms

{"bookingId": "bk_123", "status": "confirmed"}
```

```bash
# Tracing + verbose: the journey AND the detailed summary
trails run booking.confirm '{"slotId": "slot_1"}' --tracing --verbose

● booking.confirm
  ├── availability.reserve ✓ 45ms
  ├── billing.charge ✓ 120ms
  ├── ↑ booking.confirmed → notify.booking-confirmed ✓ 210ms
  └─ ✓ 380ms

Result: ok
Value: {"bookingId": "bk_123", "status": "confirmed"}
Duration: 380ms
Resources: bookingStore, billingService, emailService
Events: booking.confirmed (1 trigger, 0 subscriptions)
```

```bash
# Tracing + json: tree streams to stderr, structured tracing in JSON to stdout
trails run booking.confirm '{"slotId": "slot_1"}' --tracing --json
# stderr: the tree visualization (human-readable, real-time)
# stdout: {"ok":true,"value":{...},"tracing":[...]}
```

`--tracing --json` includes the tracing as structured data in the JSON output while also streaming the human-readable tree to stderr. The machine gets structured tracing data. The human sees the real-time tree. Both from one invocation.

**What tracing reveals that result output can't:**

Timing between steps and framework overhead:

```bash
● onboarding.complete
  ├── user.create ✓ 45ms
  ├── (12ms)
  ├── billing.setup ✓ 120ms
  ├── (3ms)
  └── notify.welcome ✓ 210ms
```

Parallel execution:

```bash
● post-booking
  ├── ┌ notify.email ✓ 150ms
  ├── ├ notify.sms ✓ 180ms
  ├── └ notify.push ✓ 120ms
  │   (parallel: 180ms wall, 450ms total)
  └─ ✓ 185ms
```

Failure cascades and compensation:

```bash
● booking.confirm
  ├── availability.reserve ✓ 45ms
  ├── billing.charge ✗ ConflictError (90ms)
  │   "Duplicate charge for slot_1"
  ├── ↑ emit trail.failed.conflict
  │   └─ → billing.conflict-resolve (triggered)
  │      └─ ✓ 30ms
  └─ ✗ ConflictError (140ms)
```

The developer sees the failure, the error propagation, the compensating trigger, all in one view.

Event delivery across trailheads:

```bash
  ├── ↑ emit booking.confirmed
  │   ├─ → notify.booking-confirmed (triggered, ✓ 210ms)
  │   ├─ → ws: 2 subscribers delivered
  │   └─ → ws: 1 subscriber failed (disconnected)
```

Events show their full delivery: which triggers fired, which WebSocket subscribers received it, which failed. The reactive graph executing in real time.

**The relationship between `trails run --tracing` and `trails tracing`:**

`trails run --tracing` shows tracing in real time during a live execution. You're watching the tracing drop as the trail is walked.

`trails tracing` queries historical tracing from the tracing store. You're following tracing that were left behind earlier.

Same data. Same vocabulary. Different time dimension. One is live. One is retrospective.

```bash
# Live: watch the tracing drop
trails run booking.confirm '{"slotId": "slot_1"}' --tracing

# Historical: follow tracing from the last execution
trails tracing --last

# Historical: follow the chain for a specific execution
trails tracing --chain exec_abc
```

### Example-driven execution

Running a trail with `--example` feeds the example's input and compares the result:

```bash
$ trails run entity.show --example "Found"
Input (from example "Found"):
  { "name": "Alpha" }

Expected:
  { "name": "Alpha", "type": "concept", "tags": ["core"] }

Actual:
  { "name": "Alpha", "type": "concept", "tags": ["core"] }

✓ Match
```

On mismatch:

```bash
$ trails run entity.show --example "Found"
Input (from example "Found"):
  { "name": "Alpha" }

Expected:
  { "name": "Alpha", "type": "concept", "tags": ["core"] }

Actual:
  { "name": "Alpha", "type": "concept", "tags": ["core", "new"] }

✗ Mismatch
  value.tags: expected ["core"], got ["core", "new"]
```

For error examples:

```bash
$ trails run entity.show --example "Missing"
Input (from example "Missing"):
  { "name": "nonexistent" }

Expected error: NotFoundError

Actual error: NotFoundError
  message: "Entity not found: nonexistent"

✓ Match
```

This bridges the gap between ad-hoc exploration and structured testing. The developer runs a specific example against real resources (not mocks) to see if behavior matches. It's a single-example test outside the test harness.

**List available examples:**

```bash
$ trails run entity.show --examples
Available examples for entity.show:
  Found     input: { name: "Alpha" }           expects: ok
  Missing   input: { name: "nonexistent" }     expects: NotFoundError
  Filtered  input: { name: "Al", fuzzy: true } expects: ok
```

### Chaining and composition

Trails produce JSON. Unix pipes compose JSON. `trails run` naturally chains:

```bash
# Run one trail, feed its output to another
trails run entity.show '{"name": "Alpha"}' --quiet | trails run entity.update --stdin

# Extract a field with jq, feed to next trail
trails run entity.list '{"limit": 5}' --quiet | jq '.[0].id' | xargs -I {} trails run entity.show '{"id": "{}"}'

# Fan out with xargs
trails run entity.list '{}' --quiet | jq -c '.[]' | xargs -I {} trails run entity.process '{}'
```

The `--quiet` flag drops the Result wrapper, outputting just the value. This makes `trails run` a well-behaved Unix citizen: it produces clean JSON on stdout, accepts JSON on stdin, and uses exit codes for error signaling.

**JSONL mode for streaming composition:**

```bash
trails run entity.list '{}' --jsonl
# {"id":"1","name":"Alpha"}
# {"id":"2","name":"Beta"}
# {"id":"3","name":"Gamma"}
```

Each output item is a separate JSON line. Pipeable to `jq`, `grep`, another `trails run`, or any JSONL-aware tool.

### Resource resolution

`trails run` resolves resources the same way any invocation does. In development, mock resources resolve by default (from the `mock` factory on the resource definition). The developer gets production-equivalent behavior without production infrastructure.

### Permit context

By default, `trails run` executes with no permit (undefined). For trails that require permits:

```bash
# Run with a specific permit scope
trails run admin.reset-cache --permit '{"id": "dev", "scopes": ["admin:write"]}'

# Run with a permit from a token (resolved through the auth connector)
trails run booking.confirm '{"slotId": "slot_1"}' --token "eyJhbG..."

# Run with the dev permit (full access, development only)
trails run booking.confirm '{"slotId": "slot_1"}' --dev-permit
```

`--dev-permit` is a development convenience that provides a synthetic permit with all scopes. The warden flags `--dev-permit` usage in CI as an error. It's for local exploration, not for scripts.

### Watch mode

```bash
trails run entity.show '{"name": "Alpha"}' --watch
```

Reruns the trail whenever the trail's source file, schema definitions, or resource implementations change. The developer edits the trail's `run` function, saves, and sees the new result immediately. Same hot-reload loop as `bun --watch` but scoped to one trail's execution.

Combined with `--example`:

```bash
trails run entity.show --example "Found" --watch
```

Edit the implementation, save, the example reruns, match/mismatch updates instantly. This is TDD without leaving the terminal. The example is the assertion. The watch loop is the runner.

Combined with `--tracing`:

```bash
trails run booking.confirm '{"slotId": "slot_1"}' --watch --tracing
```

Edit, save, and the full execution tree re-renders. The tracing shows whether a change in the implementation affected timing, crossing behavior, or event emission. The developer sees the ripple effects of every edit.

### Dry run

For trails with `intent: 'write'` or `intent: 'destroy'`:

```bash
trails run booking.cancel '{"bookingId": "bk_123"}' --dry-run
```

Passes `ctx.dryRun = true` to the implementation. The same flag the CLI trailhead adds automatically for destroy trails. The trail's implementation decides what dry-run means (preview the changes, validate without committing, etc.).

### Topo resolution

`trails run` resolves the topo through `trails.lock`, the workspace-wide lockfile. The lockfile catalogs every trail ID across every app in the workspace. Resolution is by trail ID, not by app.

```bash
# The lockfile knows booking.confirm lives in trails-api
trails run booking.confirm '{"slotId": "slot_1"}'
```

Most trail IDs are unique across the workspace — one ID, one app, no ambiguity. The developer doesn't need to know which app owns a trail to run it.

When a trail ID exists in multiple apps, the system prompts:

```bash
$ trails run health.check
? health.check exists in multiple apps:
  › trails-api (packages/api)
  › trails-admin (packages/admin)
```

The `--app` flag is an override for the collision case, not a required parameter:

```bash
trails run health.check --app trails-api
```

In watch mode, the topo reloads on file changes. The lockfile is the source of truth for resolution; `trails run` does not scan for entry points or apply convention-based discovery.

### Interaction with tracing

Every `trails run` invocation leaves a tracing record with `type: 'direct'`. The record captures:

```json
{
  "trailId": "entity.show",
  "executionId": "exec_abc",
  "type": "direct",
  "source": {
    "command": "trails run",
    "input_source": "inline"
  },
  "duration": 12,
  "result": "ok"
}
```

In verbose mode, the record is displayed inline. In normal mode, it's recorded silently. Either way, `trails tracing --last` shows the most recent execution, including `trails run` invocations.

This means the development workflow has full observability:

```bash
# Run a trail
trails run booking.confirm '{"slotId": "slot_1"}'

# Something went wrong, check the tracing
trails tracing --last
# Shows the full execution chain including crossings, events, and timing

# Deep dive on a specific execution
trails tracing --chain exec_abc
# Shows the full causal chain from this invocation through all crossings and triggers
```

### Interaction with events and triggers

When `trails run` invokes a trail that emits events, the events flow through the normal routing pipeline. If triggers are registered (in the topo), they fire. This means:

```bash
trails run booking.confirm '{"slotId": "slot_1"}'
```

Could trigger `notify.booking-confirmed`, which could trigger `audit.log-write`, which could emit more events. The full reactive chain executes. With `--tracing`, the triggered trails appear in the execution tree as they fire.

This is intentional. `trails run` is not an isolated sandbox. It's a direct invocation through the real pipeline. Mock resources (the default) provide isolation. With `--tracing`, the triggered trails appear in the execution tree as they fire.

### Autocomplete

`trails run` supports shell completion:

```bash
# Tab-complete trail IDs
trails run book<TAB>
booking.confirm    booking.cancel    booking.show    booking.send-reminders

# Tab-complete example names
trails run entity.show --example <TAB>
Found    Missing    Filtered
```

Trail IDs are completed from the topo. Example names are completed from the trail's examples. Completions are generated from the contract, not from a static list. If the trail changes, the completions change.

## Consequences

### Positive

- **Zero-ceremony invocation.** Run any trail from the terminal with one command. No trailhead setup, no bin entry, no server. The topo is the interface.
- **Examples become directly executable.** `--example` bridges exploration and testing. The developer runs a specific example, sees actual vs expected, adjusts the implementation. TDD in the terminal.
- **Unix-native composition.** JSON in, JSON out, exit codes, pipes. `trails run` composes with `jq`, `xargs`, other `trails run` invocations, and any JSONL-aware tool. Trails become first-class Unix citizens.
- **Full pipeline execution.** Validation, layers, resources, events, triggers, tracing. Everything fires. The developer sees production-equivalent behavior without production infrastructure (via mock resources).
- **Watch mode tightens the loop.** Edit, save, see the result. Combined with `--example`, it's TDD without a test framework. The example is the assertion. The file system is the trigger.
- **`--tracing` makes composition visible.** The live execution tree shows crossings, events, triggers, parallel branches, and timing as they happen. The developer understands the reactive chain without reading code. Tracing stream to stderr while the result goes to stdout, composing cleanly with standard flags and Unix pipes.

### Tradeoffs

- **Depends on the lockfile.** `trails run` resolves trails through `trails.lock`. The lockfile must be current. A stale lockfile could point to a trail that's been renamed or removed. `trails topo export` (or a pin-driven export workflow) becomes a prerequisite for accurate resolution.
- **Reactive chains can cascade.** `trails run` with triggers enabled means one invocation could trigger a chain of trail executions. With `--tracing` this is visible. Without it, the cascading triggers are silent. A developer exploring a trail might not expect their invocation to trigger five downstream trails.
- **Watch mode requires file watching.** Adds a dependency on file system watching (Bun handles this natively). For large projects, file watching can be resource-intensive, though scoping to the trail's source file and its dependencies mitigates this.

### What this does NOT decide

- **REPL mode.** An interactive session where the developer can call multiple trails, inspect results, modify input, and retry without restarting. `trails run` is single-invocation. A REPL (`trails console` or `trails repl`) is a future extension that could use `Bun.repl` or a custom prompt backed by `run()`.
- **Remote execution.** `trails run` invokes locally. Running a trail on a remote topo (via mount) would need `trails run --remote <url> <trail-id>`. That's tied to the mount ADR.
- **Scheduled or delayed execution.** `trails run` is immediate. "Run this trail in 5 minutes" or "run this trail every hour" is the trigger system's job.
- **Output formatting beyond JSON.** Tables, CSV, custom formats. The default is JSON. `--verbose` and `--tracing` are human-readable. If someone needs `trails run entity.list --format table`, that's a future enhancement.
- **Batch execution.** Running a trail against multiple inputs from a JSONL file. Sequential and parallel batch modes. A future extension that builds on the same pipeline.
- **Interactive prompting.** Deriving an interactive input form from the trail's Zod schema (`--prompt`). A non-trivial UX project that can follow once the core invocation path is stable.
- **Live resource resolution.** A `--live` or `--no-mocks` flag to bypass mock resources and run against real infrastructure. Requires careful footgun guards (especially combined with batch mode).

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) -- "the trail is the product"; `trails run` makes every trail directly invocable without trailhead ceremony
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) -- every trail is runnable, whether atomic or composite
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md) -- `trails run` executes through the pipeline, the same as every trailhead
- ADR: Typed Signal Emission (draft) -- events emitted during `trails run` flow through normal routing, triggers fire
- ADR: Concurrent Cross Composition (draft) -- `--tracing` renders concurrent crossings as parallel branches in the execution tree
- ADR: Trail Visibility and Trailhead Filtering (draft) -- `trails run` can invoke internal trails (it's programmatic, like `run()`)
- ADR: Packs as Namespace Boundaries (draft) -- `trails run` can invoke any trail in any pack, regardless of visibility
- [ADR-0013: Tracing](../0013-tracing.md) -- `--tracing` uses the tracing vocabulary; live tracing during `trails run`, historical tracing via `trails tracing`
