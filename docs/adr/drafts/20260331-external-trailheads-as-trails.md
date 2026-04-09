---
slug: external-trailheads-as-trails
title: External Trailheads as Trails
status: draft
created: 2026-03-31
updated: 2026-04-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [packs-namespace-boundaries]
---

# ADR: External Trailheads as Trails

## Context

### Trails goes one direction

Trails defines a contract (the trail) and projects it onto trailheads (CLI, MCP, HTTP). The flow is always inside-out: author a trail, derive the trailhead. This is the core of the framework and it works.

But the world is full of existing trailheads that developers want to compose with: CLI tools (`git`, `docker`, `kubectl`, `ffmpeg`, `gh`), MCP servers (GitHub, Slack, Linear), and HTTP APIs (REST endpoints, third-party services). These trailheads already exist. They have capabilities. They have implicit or explicit contracts. But they're not trails, so they can't participate in the Trails ecosystem: no typed composition via `ctx.cross()`, no cross-trailhead derivation, no `testExamples`, no warden governance, no survey introspection.

Developers bridge this gap today by writing ad-hoc wrappers: shell out to `git` in a trail implementation, call `fetch` against an API, instantiate an MCP client. The implementation works, but the bridge is invisible to the framework. The warden doesn't know the trail depends on `git 2.45`. Survey doesn't report external dependencies. `testExamples` can't run without the binary. The contract boundary between the trail and the external world is untracked.

### The inverse of derivation

Trails' core flow: **trail → trailhead.** Define a contract, derive the projection.

The inverse: **trailhead → trail.** Observe an existing trailhead, capture it as a contract.

This is not wrapping. Wrapping hides the external thing behind your code. Rigging captures the external thing's contract in the framework's terms. The external trailhead's shape (flags, tool schemas, API endpoints), its version, and its observed behavior become tracked, governed, testable artifacts.

### Three external trailhead types

**CLI tools** have the largest ecosystem and the least structure. Discovery is heuristic: parse `--help` output, infer flag types from descriptions, detect output formats. The shape is approximate. Parse functions are necessary to produce typed output.

**MCP servers** are already structured. `tools/list` returns tool names, input schemas (JSON Schema), and descriptions. Discovery is mechanical. Schema quality is high. Parsing is unnecessary because the output is already typed.

**HTTP APIs** vary. Those with OpenAPI specs are well-structured: endpoints, methods, request/response schemas. Those without require manual definition. Discovery ranges from fully automated (OpenAPI probe) to fully manual.

All three share the same destination: a trail contract with typed input, typed output, Result semantics, intent, examples, and governance.

### What "rigging" means

The word comes from preparing equipment for use. You rig a sailboat, a climbing wall, a stage. You take existing equipment and configure it to operate in your system. The equipment isn't yours. The rigging is.

A rigged trail is a trail whose implementation delegates to an external trailhead. The contract is yours. The capability is theirs. The rigging is the bridge.

## Decision

### `rig()` produces a Trail

`rig()` is a factory function that returns a Trail. Not a new primitive type. A real Trail that composes, tests, trailheads, and governs like any other. The implementation is generated: it delegates to the external trailhead, maps input to the trailhead's calling convention, and parses the output into the trail's output schema.

```typescript
import { rig, flag, positional } from '@ontrails/rig';

export const gitLog = rig('git.log', {
  source: {
    type: 'cli',
    command: 'git log',
    binary: 'git',
  },
  intent: 'read',
  input: z.object({
    branch: z.string().default('HEAD'),
    limit: z.number().default(10),
    author: z.string().optional(),
  }),
  flags: {
    branch: positional(),
    limit: flag('-n'),
    author: flag('--author'),
  },
  output: z.array(z.object({
    hash: z.string(),
    author: z.string(),
    date: z.string(),
    message: z.string(),
  })),
  parse: parseGitLog,
  mock: (input) => Result.ok([
    { hash: 'abc123', author: 'Test', date: '2026-01-01', message: 'test commit' },
  ]),
  examples: [
    {
      name: 'recent commits',
      input: { branch: 'main', limit: 3 },
      expected: [
        { hash: 'abc123', author: 'Test', date: '2026-01-01', message: 'test commit' },
      ],
    },
  ],
});
```

The returned object is a `Trail`. `topo('myapp', gitLog)` works. `ctx.cross('git.log', input)` works. `trailhead(app)` trailheads it on CLI, MCP, HTTP. `testExamples` tests it (using the mock in CI, using the real binary in integration).

### Rig source types

#### CLI rigs

```typescript
source: {
  type: 'cli',
  command: 'git log',
  binary: 'git',
}
```

The implementation is Bun-native. `Bun.which()` resolves the binary path at execution time, confirming the tool is installed. `Bun.spawn()` runs the command with native timeout support, mapped flags, and piped stdout/stderr. The `parse` function converts stdout to typed output. The full pipeline:

```typescript
// Generated implementation for a CLI rig (simplified)
async (input, ctx) => {
  const binPath = Bun.which(source.binary);
  if (!binPath) {
    return Result.err(new NotFoundError(`${source.binary} is not installed`));
  }

  const args = buildArgs(source.command, input, spec.flags);

  const proc = Bun.spawn([binPath, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: spec.timeout ?? 30_000,
    cwd: spec.cwd ?? process.cwd(),
    env: spec.env ? { ...process.env, ...spec.env } : undefined,
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    return mapExitCodeToError(exitCode, stderr, spec.errors);
  }

  try {
    return Result.ok(spec.parse(stdout));
  } catch (e) {
    return Result.err(new InternalError(`Failed to parse ${source.binary} output: ${e}`));
  }
};
```

`Bun.spawn()` provides native timeout (kills the process with configurable `killSignal` when exceeded), AbortSignal support (rigged trails can be cancelled via `ctx.signal`), and lazy stdout reading. No external process management libraries are needed.

Exit code 0 produces `Result.ok(parsed)`. Non-zero exit codes map to the error taxonomy via an optional `errors` mapping: exit 1 with stderr → `InternalError` by default, specific patterns can be mapped to `NotFoundError`, `PermissionError`, etc.

The `flags` declaration maps input fields to CLI arguments:

- `flag('-n')` produces `-n <value>`
- `flag('--author')` produces `--author <value>`
- `flag('--oneline')` on a boolean field produces `--oneline` when true, omitted when false
- `positional()` places the value as a positional argument
- `flag('--format', { fixed: 'json' })` injects a fixed flag not exposed in the input schema

#### MCP rigs

```typescript
source: {
  type: 'mcp',
  server: 'npx -y @anthropic/mcp-server-github',
  tool: 'search_repositories',
}
```

The implementation starts the MCP server (or connects to a running one), calls the named tool with the input, and returns the result. Input and output schemas can be derived from the MCP tool's JSON Schema definitions. No parse function needed unless the developer wants to reshape the output.

MCP rigs manage server lifecycle: start on first use, keep alive for subsequent calls, dispose on topo shutdown. This maps to the resource model: the MCP client connection is a resource with `create` (connect), `dispose` (disconnect), and `health` (ping).

#### HTTP rigs

```typescript
source: {
  type: 'http',
  method: 'GET',
  url: 'https://api.example.com/users/{id}',
}
```

The implementation calls `fetch` with the mapped URL, method, headers, and body. URL template parameters are extracted from the input schema. Response JSON is validated against the output schema.

An optional `headers` function derives request headers from context:

```typescript
headers: (ctx) => ({
  'Authorization': `Bearer ${ctx.permit?.token}`,
}),
```

This connects rigged HTTP trails to the permit model. The external API's auth mechanism is handled in the rig definition. Consumers of the trail never see it.

### Built-in parsers

The `parse` function on a rig is where raw output becomes typed data. For CLI rigs, this is the highest-effort authoring step. But the majority of CLI tools output in a handful of known formats. The `parse` namespace provides built-in parsers for common formats, reducing the typical rig definition to zero custom parsing code.

```typescript
import { rig, flag, positional, parse } from '@ontrails/rig';
```

#### `parse.json(mapper?)`

Parses stdout as a single JSON value. The most common structured format: `kubectl -o json`, `docker inspect`, `gh api`, anything with a `--format json` flag.

```typescript
const dockerInspect = rig('docker.inspect', {
  source: { type: 'cli', command: 'docker inspect', binary: 'docker' },
  intent: 'read',
  input: z.object({ container: z.string() }),
  flags: { container: positional() },
  output: ContainerSchema,
  parse: parse.json(),
});
```

With an optional mapper to extract or reshape:

```typescript
parse: parse.json(data => data.items),
```

#### `parse.jsonl(mapper?)`

Splits on newlines, parses each line as JSON, returns an array. For streaming log formats, event streams, and tools that emit one JSON object per line (`docker events --format json`, structured log output).

```typescript
const dockerEvents = rig('docker.events', {
  source: { type: 'cli', command: 'docker events', binary: 'docker' },
  intent: 'read',
  input: z.object({ since: z.string().optional() }),
  flags: {
    since: flag('--since'),
    format: flag('--format', { fixed: 'json' }),
  },
  output: z.array(DockerEventSchema),
  parse: parse.jsonl(),
});
```

#### `parse.text(mapper?)`

Trims stdout and optionally maps through a function. For single-value outputs like `git rev-parse HEAD` returning a SHA, or `which node` returning a path.

```typescript
const gitRevParse = rig('git.rev-parse', {
  source: { type: 'cli', command: 'git rev-parse', binary: 'git' },
  intent: 'read',
  input: z.object({ ref: z.string().default('HEAD') }),
  flags: { ref: positional() },
  output: z.object({ sha: z.string() }),
  parse: parse.text(line => ({ sha: line })),
});
```

Without a mapper, returns the raw trimmed string.

#### `parse.lines(mapper?)`

Splits on newlines, filters empties, optionally maps each line through a function. For list commands: `git branch`, `ls`, `find`, `grep`.

```typescript
const gitBranches = rig('git.branch.list', {
  source: { type: 'cli', command: 'git branch', binary: 'git' },
  intent: 'read',
  input: z.object({}),
  flags: {},
  output: z.array(z.object({ name: z.string(), current: z.boolean() })),
  parse: parse.lines(line => ({
    name: line.replace(/^\*?\s+/, ''),
    current: line.startsWith('*'),
  })),
});
```

#### `parse.table(options)`

Handles columnar text output with a header row. `ps aux`, `docker ps`, `kubectl get pods`. Detects column boundaries from the header and extracts typed rows.

```typescript
const kubePods = rig('k8s.pods.list', {
  source: { type: 'cli', command: 'kubectl get pods', binary: 'kubectl' },
  intent: 'read',
  input: z.object({ namespace: z.string().optional() }),
  flags: { namespace: flag('-n') },
  output: z.array(PodSchema),
  parse: parse.table({
    columns: {
      name: 'NAME',
      ready: 'READY',
      status: 'STATUS',
      restarts: { header: 'RESTARTS', type: 'number' },
      age: 'AGE',
    },
  }),
});
```

Column headers are matched by name. Types are inferred as strings by default, with explicit type overrides for numeric or boolean columns.

#### `parse.csv(options?)`

Parses CSV or TSV with configurable delimiter and optional header row. For tools that output tabular data in delimited format.

```typescript
parse: parse.csv({ delimiter: '\t', headers: true }),
```

#### `parse.regex(pattern, fields)`

Applies a regex to each line of output, extracts named groups or positional captures into typed fields.

```typescript
parse: parse.regex(
  /^(\w+)\s+(\d+)\s+(.+)$/,
  ['name', 'count', 'description'],
),
```

#### `parse.markdown(options)`

Extracts structured data from markdown-formatted CLI output. Tools like `gh` emit human-readable markdown for issues, PRs, and releases. The parser extracts headings, sections, lists, and frontmatter into typed fields.

```typescript
const ghIssueView = rig('gh.issue.show', {
  source: { type: 'cli', command: 'gh issue view', binary: 'gh' },
  intent: 'read',
  input: z.object({ number: z.number() }),
  flags: { number: positional() },
  output: IssueSchema,
  parse: parse.markdown({
    fields: {
      title: heading(1),
      body: section('body'),
      labels: list('Labels'),
      assignees: list('Assignees'),
    },
  }),
});
```

This is the most opinionated built-in. It handles a real pattern but extraction rules may need overriding for unusual formats.

#### Custom parse functions

The built-ins cover common formats. The escape hatch is always available:

```typescript
parse: (stdout: string) => {
  // whatever custom parsing you need
  return myCustomResult;
},
```

#### Composability

Parsers compose with mappers through function chaining:

```typescript
// Parse JSON, then extract a nested field
parse: parse.json(data => data.results.items),

// Parse lines, then transform each
parse: parse.lines(line => {
  const [name, version] = line.split('@');
  return { name, version };
}),
```

Each built-in parser accepts an optional mapper as its last argument. The mapper receives the parsed data in its native shape (object for json, array of strings for lines, array of objects for table) and returns the final typed output. TypeScript infers through the chain.

#### Probe integration

When the probe discovers a CLI tool, it looks for output format clues. If the tool has a `--format json` or `-o json` flag, the scaffold generates `parse.json()` with that flag injected as a fixed flag. If the tool has tabular output with a header row, it generates `parse.table()`. Otherwise it defaults to `parse.text()`.

```text
Discovered output modes for kubectl:
  -o json      → will scaffold with parse.json()
  -o yaml      → will scaffold with parse.text() (yaml support future)
  -o table     → will scaffold with parse.table()
  default      → will scaffold with parse.lines()
```

The scaffold picks the richest structured format available. JSON first (highest fidelity), then table (semi-structured), then lines (minimal structure), then text (raw). The developer can always change it.

#### No external dependencies

All built-in parsers use native APIs:

- `JSON.parse` for json and jsonl
- `Bun.JSONC` for JSON with comments (some CLI tools emit JSONC)
- `String.split` for lines, text, csv
- Column-width detection for table (pure implementation)
- `RegExp` for regex
- `Bun.markdown` for markdown (built-in CommonMark parser written in Zig)

The full parser set is roughly 200 lines of glue code. No parsing libraries needed.

### Rig meta

Every rigged trail carries meta (`meta`) that identifies it as a rig and records its external dependency:

```typescript
meta: {
  rig: {
    source: 'cli',
    binary: 'git',
    version: '2.45.0',
    command: 'git log',
  }
}
```

This meta propagates through the dependency chain. Survey reports rig dependencies:

```bash
$ trails survey --rigs
Rig dependencies:
  git 2.45.0         6 trails (git.log, git.branch, git.status, ...)
  kubectl 1.29.0     4 trails (k8s.pods.list, k8s.deploy.status, ...)
  mcp:github-server   3 trails (github.repos.search, ...)

Trails with rig dependencies: 18 direct, 7 via cross chains
```

Trails that cross into rigged trails inherit rig awareness in survey output:

```json
{
  "id": "repo.recent-activity",
  "crosses": ["git.log", "git.diff"],
  "rigDependencies": [
    { "binary": "git", "version": "2.45.0", "trails": ["git.log", "git.diff"] }
  ]
}
```

### Probe: automated discovery

The `probe` command discovers the shape of an external trailhead:

```bash
trails rig probe git                                       # CLI binary
trails rig probe mcp --url "npx -y @anthropic/mcp-server"  # MCP server
trails rig probe http --openapi https://api.example.com/openapi.json  # HTTP API
```

#### CLI probe

The probe uses `Bun.which()` to resolve the binary, then `Bun.spawnSync()` to walk the help tree. `spawnSync` is the right choice for probing: the work is sequential, blocking, and needs raw exit codes and stderr.

```typescript
const binPath = Bun.which('git');
if (!binPath) return Result.err(new NotFoundError('git is not installed'));

// Get version
const ver = Bun.spawnSync([binPath, '--version'], { stdout: 'pipe' });
const version = parseVersion(ver.stdout.toString());

// Walk help tree
const help = Bun.spawnSync([binPath, '--help'], { stdout: 'pipe' });
const subcommands = parseHelpOutput(help.stdout.toString());

for (const cmd of subcommands) {
  const cmdHelp = Bun.spawnSync([binPath, cmd, '--help'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (cmdHelp.success) {
    // parse flags, types, descriptions...
  }
}
```

Some CLIs render different output in non-TTY mode (abbreviated help, missing formatting). For these cases, the probe can use `Bun.Terminal` as a fallback to attach a pseudo-terminal and capture the full TTY-rendered output:

```typescript
let buffer = '';
const terminal = new Bun.Terminal({
  cols: 120,
  rows: 50,
  data(term, data) { buffer += data.toString(); },
});

const proc = Bun.spawn([binPath, cmd, '--help'], { terminal });
await proc.exited;
terminal.close();

// buffer has the full TTY output; clean ANSI codes with Bun.stripANSI()
const cleanOutput = Bun.stripANSI(buffer);
```

PTY probing is opt-in. The default probe uses `spawnSync` with piped stdout. If pipe mode produces incomplete results, the probe retries with PTY. Heuristic-based: works well for GNU-style CLIs, less well for non-standard help formats.

The probe is best-effort. It captures what it can discover mechanically. The developer refines the result.

#### MCP probe

Connects to the server, calls `tools/list`. Extracts tool names, input schemas, and descriptions directly. High fidelity because MCP tools are already structured.

#### HTTP probe

With OpenAPI: parses the spec. Endpoints become trail candidates. Request schemas become input schemas. Response schemas become output schemas. Methods map to intent.

Without OpenAPI: attempts well-known documentation paths (`/docs`, `/swagger.json`, `/openapi.json`). If nothing is found, reports that manual definition is needed.

#### Probe output: rig lock

The probe writes a rig lock file that captures the discovered shape:

```json
{
  "source": "cli",
  "binary": "git",
  "version": "2.45.0",
  "discoveredAt": "2026-03-31T15:00:00Z",
  "commands": {
    "log": {
      "description": "Show commit logs",
      "flags": {
        "-n": { "type": "number", "description": "Limit number of commits" },
        "--format": { "type": "string", "description": "Pretty-print format" },
        "--oneline": { "type": "boolean" },
        "--author": { "type": "string", "description": "Limit to commits by author" }
      },
      "positionals": ["revision"]
    }
  }
}
```

The rig lock is stored alongside the rig source code (`.trails/rigs/<name>/rig.lock` or within the pack directory). It records what the external trailhead looked like at discovery time. Re-probing and diffing detects version drift.

### Scaffold: code generation from probes

```bash
trails rig scaffold git --commands "log,branch,status,diff,show"
```

Generates trail files from the rig lock. Each selected command becomes a rigged trail with:

- Input schema derived from discovered flags (types inferred, descriptions preserved)
- Flag mapping generated from the discovered flag names
- Best available built-in parser (json if the tool supports `--format json` or `-o json`, table if header rows detected, lines otherwise)
- Placeholder mock function

The generated code is owned by the developer. They tighten the output schemas, swap or customize parsers, add mapper functions, author examples, and refine the input schemas. The scaffold is the starting point. Specify, satisfy, tighten applies.

### Capture: examples from real execution

```bash
trails rig capture git.log --input '{"branch": "main", "limit": 3}'
```

Runs the rigged trail against the real external trailhead. Captures the input and the parsed output as an example. The developer reviews and commits the example.

The capture implementation uses `Bun.$` (the shell API) for the full shell experience: environment variables, working directory control, and cross-platform compatibility with built-in injection protection:

```typescript
const output = await $`git log -n 3 main --format=json`
  .cwd(projectDir)
  .env({ GIT_TERMINAL_PROMPT: '0' })
  .quiet()
  .text();
```

`Bun.$` escapes all interpolated values by default, preventing injection during capture. The `.quiet()` method suppresses stdout echoing. The captured output feeds through the rig's parse function and is written as a structured example.

Captured examples serve two purposes:

**Mock examples** (authored, deterministic) use the mock function. They run in CI without the external binary. They validate the contract shape.

**Integration examples** (captured, environment-dependent) use the real binary. They run in integration test environments. They validate that the parse function still produces correct output for the current version of the external trailhead.

The distinction is tracked. `testExamples` in standard mode uses mocks. `testExamples --integration` (or `trails rig test --integration`) uses the real external trailhead.

### Version drift detection

```bash
trails rig probe git --diff
```

Re-probes the binary and diffs against the rig lock:

```text
git version: 2.44.0 → 2.45.0
Changes:
  log:
    + --mailmap (new flag)
    ~ --format: added 'reference' as valid format
  branch:
    ~ --sort: default changed from refname to -committerdate
```

The rig lock updates. Integration examples can then be re-run to detect behavioral drift:

```bash
trails rig test --integration
```

Failing integration examples mean the external trailhead's behavior changed in ways the parse function doesn't handle. The failures are the update checklist.

CI can run drift detection as a scheduled check:

```bash
# In CI (scheduled, not on every push)
trails rig check
```

Probes every rigged source. Diffs against rig locks. Reports staleness. Does not auto-update (the developer decides when to absorb changes).

### Warden rules for rigs

The warden gains rig-aware governance:

- **Missing mock.** A rigged trail without a mock function cannot run in `testExamples` without the external binary. Warning.
- **Stale rig lock.** The rig lock's binary version doesn't match the installed binary version. Warning.
- **Captured example staleness.** Integration examples were captured against version X but the rig lock now records version Y. Warning: re-capture recommended.
- **Rig chain depth.** A trail crosses a rigged trail that crosses another rigged trail. Each hop adds latency and failure surface. Informational.
- **Rig without integration examples.** A rigged trail has mock examples but no captured integration examples. Coaching suggestion: captured examples validate the parse function against real output.
- **Impure intent.** A rigged CLI trail with `intent: 'read'` shells out to a command that may have side effects (the warden can't verify purity of external binaries). Informational: rig trails inherently can't guarantee purity.

### Package structure

Rig ships as `@ontrails/rig`, separate from core:

```text
@ontrails/rig
├── rig()           — factory function, returns Trail
├── flag()          — flag mapping helper
├── positional()    — positional arg helper
├── parse/          — built-in output parsers
│   ├── json        — single JSON value
│   ├── jsonl       — newline-delimited JSON
│   ├── text        — trimmed string with optional mapper
│   ├── lines       — line-separated with optional mapper
│   ├── table       — columnar text with header detection
│   ├── csv         — delimited values (CSV, TSV)
│   ├── regex       — pattern extraction
│   └── markdown    — structured markdown field extraction
├── probe/
│   ├── cli         — CLI help parser (Bun.spawnSync, Bun.Terminal)
│   ├── mcp         — MCP tools/list client
│   └── http        — OpenAPI parser
├── capture         — example generation from real execution (Bun.$)
└── check           — rig lock drift detection
```

No dependency on trailhead packages. Rig produces trails. What happens to those trails (CLI, MCP, HTTP trailheads) is the topo's concern.

### Zero external dependencies via Bun

The entire probe, execute, capture, and check pipeline is built on Bun-native APIs. No external process management, shell, or parsing libraries are needed:

| Concern | Bun API | Replaces |
| --- | --- | --- |
| Binary resolution | `Bun.which()` | `which` npm package |
| Process execution (async) | `Bun.spawn()` | `execa`, `child_process` wrappers |
| Process execution (sync) | `Bun.spawnSync()` | `execSync` wrappers |
| Shell scripting (capture) | `Bun.$` template literal | `zx`, `shelljs` |
| Native timeout | `Bun.spawn({ timeout })` | Manual `setTimeout` + `kill()` |
| PTY for probe fallback | `Bun.Terminal` | `node-pty` |
| ANSI stripping | `Bun.stripANSI()` | `strip-ansi` npm package |
| Markdown parsing | `Bun.markdown` | `marked`, `remark` |
| JSONC parsing | `Bun.JSONC` | `jsonc-parser` |
| Rig lock storage | `Bun.file()`, `Bun.write()` | `fs-extra` |

This follows ADR-0000: Bun-native, universally consumable. The rig package is Bun-native. The trails it produces are universally consumable on any trailhead.

### Interaction with packs and resources

Rigged trails compose into packs normally:

```typescript
const gitCore = pack('git.core', {
  visibility: 'internal',
  trails: [gitLog, gitBranch, gitStatus, gitDiff, gitShow],
});

const gitPorcelain = pack('git.porcelain', {
  requires: [gitCore],
  trails: [stageAndCommit, interactiveRebase, smartLog],
});
```

The `git.core` pack wraps the binary. The `git.porcelain` pack composes raw git operations into higher-level workflows. Same layering pattern as SDK wrapping: internal capability pack, public domain pack on top.

Rig packs distribute as resources:

```bash
trails resources add @community/trails-rig-git      # dependency mode
trails resources scaffold @community/trails-rig-git  # scaffold mode
```

The resource includes the rig lock alongside the source. Consumers get the rig lock for version tracking. The scaffold-and-upgrade workflow handles rig packs the same as any other resource.

### Interaction with events and triggers

Rigged trails can signal and declare fires like any other trail:

```typescript
const gitStatus = rig('git.status', {
  source: { type: 'cli', command: 'git status', binary: 'git' },
  intent: 'read',
  on: [{ schedule: '*/5 * * * *' }],
  signals: [uncommittedChangesDetected],
  input: z.object({}),
  output: GitStatusSchema,
  parse: parse.lines(parseStatusLine),
  blaze: async (input, ctx) => {
    const status = await runRig(input);
    if (status.isOk() && status.value.length > 0) {
      ctx.signal(uncommittedChangesDetected, { files: status.value });
    }
    return status;
  },
});
```

A rigged trail with a schedule trigger becomes a periodic monitoring probe. The rig captures the command output. The trigger activates it on a schedule. The parse function structures the output. `ctx.signal()` announces what was observed. Other trails trigger on the event. Tracing records every execution.

This is the "observe the external world and announce what you found" pattern. Rig provides the observation. Events provide the announcement. Triggers provide the activation. Each is a separate primitive. Together they form a monitoring pipeline from external command through typed observation through reactive response.

### Rig locks in `trails.lock`

Rig lock state rolls up into the `rigs` section of `trails.lock`:

```json
{
  "rigs": {
    "git": {
      "source": "cli",
      "binary": "git",
      "version": "2.45.0",
      "lockHash": "sha256:abc123",
      "trails": ["git.log", "git.branch", "git.status", "git.diff", "git.show"]
    },
    "mcp-github": {
      "source": "mcp",
      "server": "npx -y @anthropic/mcp-server-github",
      "toolCount": 12,
      "lockHash": "sha256:def456",
      "trails": ["github.repos.search", "github.file.show", "github.commits.list"]
    }
  }
}
```

`trails topo verify` validates rig lock hashes. CI catches untracked rig lock changes.

## Consequences

### Positive

- **Existing trailheads become composable.** CLI tools, MCP servers, and HTTP APIs participate in `cross` chains, `testExamples`, survey, and warden governance. The entire Trails ecosystem opens to external capability.
- **No new primitive type.** `rig()` returns a Trail. The topo, trailheads, testing, and governance don't need to learn a new concept. A rigged trail is a trail.
- **Version drift is tracked.** Rig locks record the external trailhead's shape at a point in time. Probes detect drift. Integration examples verify behavior. CI catches staleness. External dependencies become governed artifacts.
- **The contract is the firewall.** When the external trailhead changes, the rig's parse function and examples absorb the change. Consumers of the rigged trail see a stable contract. The rig isolates the instability.
- **Zero external dependencies.** The entire rig implementation (probe, execute, capture, check) uses Bun-native APIs: `Bun.which()`, `Bun.spawn()`, `Bun.$`, `Bun.Terminal`, `Bun.stripANSI()`. On Node the same functionality would require six or more npm packages. This keeps the supply chain trailhead minimal.
- **Community rig packs are valuable.** A well-maintained `git` rig pack saves every Trails developer from writing git parsing. Resources handle distribution. The contract-level upgrade workflow handles version changes.
- **Progressive refinement.** Probe gives a raw discovery. Scaffold gives working code with the best available built-in parser (json if the tool supports it, table or lines otherwise). The developer tightens schemas, swaps parsers, adds mappers, authors examples. The same specify-satisfy-tighten cycle.

### Tradeoffs

- **Rigged trails are inherently impure.** The implementation shells out, connects to servers, or calls APIs. The framework can't verify purity, idempotency, or side-effect freedom. The warden adjusts its expectations, but governance is weaker than for pure trails.
- **CLI probing is heuristic.** `--help` parsing works for well-behaved CLIs (GNU-style flags, consistent formatting). Unusual help formats produce incomplete or incorrect discoveries. `Bun.Terminal` provides a PTY fallback for tools that render differently in non-TTY mode, but the probe remains best-effort. The scaffold is a starting point, not a guarantee.
- **External binary availability.** Integration tests require the actual binary, MCP server, or API. CI environments need the tools installed. Mock examples provide a fallback but don't validate parse functions.
- **Parse functions are manual for non-standard formats.** The built-in parsers (json, jsonl, lines, table, csv, regex, markdown) cover the majority of CLI output patterns. For tools with unusual output formats, the developer authors a custom parse function. Community rig packs amortize this effort for popular tools.
- **Rig meta adds weight.** Every rigged trail carries rig meta. Cross chains accumulate rig dependency information. Survey output grows. This is informational overhead in exchange for dependency visibility.

### What this does NOT decide

- **Auto-generation of custom parse functions.** Built-in parsers handle standard formats (JSON, JSONL, lines, table, CSV, regex, markdown). For non-standard output, an agent could plausibly generate a custom parse function from a schema and sample output. This is a valuable future capability but not part of the rig primitive.
- **Binary sandboxing.** Rigged CLI trails trust the binary. They run it in the same context as the Trails process. Sandboxing (containers, permissions, resource limits) is an operational concern, not a framework decision.
- **MCP server lifecycle management.** Whether rigged MCP connections are singletons, pooled, or per-request is a resource-level decision. The rig declares the server. The resource model manages the lifecycle.
- **HTTP authentication patterns beyond permits.** OAuth flows, API key rotation, token refresh: these are concerns of the HTTP rig's `headers` function and potentially a resource. The rig framework provides the hook, not the implementation.
- **A standard library of rig packs.** Which tools get official rig packs (`git`, `docker`, `kubectl`) is an ecosystem decision. The framework provides the tooling. The community (or the outfitter-dev org) provides the packs.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) -- "the trail is the product"; rig makes external trailheads into trails. Decision 11 ("Bun-native, universally consumable") governs the implementation: Bun APIs for the rig internals, standard trails for the output.
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) -- `rig()` returns a Trail, not a new primitive
- [ADR-0004: Intent as a First-Class Property](../0004-intent-as-first-class-property.md) -- rigged trails declare intent; HTTP method mapping and MCP annotations work identically
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md) -- rigged trails execute through the same pipeline
- [ADR-0008: Deterministic Trailhead Derivation](../0008-deterministic-trailhead-derivation.md) -- rigged trails get trailhead derivation for free
- [ADR: Trail Visibility and Trailhead Filtering](20260331-visibility-and-filtering.md) (draft) -- rigged SDK wrapper packs use `visibility: 'internal'`
- [ADR: `deriveTrail()` and Trail Factories](20260409-derivetrail-and-trail-factories.md) (draft) -- `deriveTrail()` and `ingest()` factory that produces trails from external input shapes
- [ADR: Connector Extraction and the `with-*` Packaging Model](20260409-connector-extraction-and-the-with-packaging-model.md) (draft) -- the packaging model for connector-contributed capabilities that rig packs may use
- ADR: Packs as Namespace Boundaries (draft) -- rigged trails compose into packs with the same layering pattern
- ADR: Pack Provisioning (draft) -- rig packs distribute as resources with the same lifecycle
- ADR: Typed Signal Emission (draft) -- rigged trails can emit events via `ctx.signal()`; the "observe and announce" pattern
- ADR: Reactive Trail Activation (draft) -- rigged trails with schedule triggers become periodic monitoring probes
- [ADR-0017: The Serialized Topo Graph](../0017-serialized-topo-graph.md) -- rig state captured in the lockfile graph; rig lock state occupies a section in `trails.lock`
- [ADR-0013: Tracing](../0013-tracing.md) -- rigged trail executions are recorded via tracing for observability
