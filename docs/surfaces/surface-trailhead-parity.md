# Trailhead Parity

Trailheads start with MCP because MCP pays the tool-count and schema-context cost first. CLI and HTTP remain peer surfaces, but peer-ness does not mean every surface gets the same projection at the same time.

## Current Verdict

CLI and HTTP trailhead parity are deferred. The MCP implementation should not be weakened to make other surfaces easier, and no CLI or HTTP trailhead behavior ships with this decision.

The same trailhead declaration may remain the conceptual source for future parity, but each surface must earn its own materialization:

- CLI parity should be evaluated as command-group consolidation.
- HTTP parity should be evaluated as route-group projection or explicitly rejected as a non-fit.
- Per-surface overrides are allowed only when the surface economics differ in a way the shared declaration cannot express honestly.

Use the surface-accommodation vocabulary from [ADR-0050](../adr/0050-surface-accommodations-preserve-trail-identity.md) when evaluating parity. Trailheads live on the entry axis: one grouped surface entry over multiple trails. CLI aliases and future input mappings live on the approach axis: multiple ways to reach one trail. Do not use trailheads to solve a problem that is really an alternate approach to one trail, and do not use aliases to hide a grouped affordance.

## CLI Evaluation

MCP trailheads group many trails into one tool because agent clients pay for every tool schema they inspect. CLI already has a hierarchical command tree from dotted trail IDs, so a raw copy of MCP grouping would be awkward:

```text
trails governance --trail warden --input-json '{}'
```

That shape hides the command affordance a CLI user expects. A credible CLI trailhead would instead consolidate command groups while preserving normal command help and shell completion:

```text
trails governance warden --apps apps/trails/src/app.ts
trails governance guide
```

Open questions before CLI parity:

- Does the grouped command path reduce discoverability cost beyond the existing dotted ID command tree?
- Can command aliases or help grouping solve the problem without a trailhead materialization?
- How do positional args, structured input, and completions project when a group is editorial rather than ID-derived?

## HTTP Evaluation

HTTP does not pay MCP's schema-context cost, and route names are externally stable API contracts. A raw MCP-style route such as the following would be a poor fit:

```http
POST /trailheads/governance
{ "trail": "warden", "input": {} }
```

That shape turns ordinary HTTP routes into a generic RPC envelope. A credible HTTP trailhead would need to be route-group projection, documentation grouping, or OpenAPI organization rather than a replacement for direct trail routes:

```text
/governance/warden
/governance/guide
```

Open questions before HTTP parity:

- Is there a route-grouping benefit that is not already handled by trail ID namespaces and `basePath`?
- Does OpenAPI tag grouping provide the intended affordance without changing runtime routes?
- Can a grouped route preserve stable URLs, verbs, request parsing, and error projection without inventing an HTTP-specific action envelope?

## Shared Declaration And Overrides

The preferred future path is one trailhead declaration interpreted by each surface that chooses to support it. Surface-specific hints may be added under surface-qualified keys such as `mcp`, `cli`, or `http` only when real evidence shows the shared declaration is insufficient.

Do not add generic `overlapsWith`, `facet()`, or adapter-kit-owned trailhead configuration to make parity easier.

## Follow-Up Trigger

Create CLI or HTTP implementation issues only after one of these is true:

- the MCP field notes show repeated agent wins that map cleanly to CLI or HTTP;
- downstream apps ask for grouped surface affordances outside MCP;
- Warden or Topographer evidence shows a durable projection pattern that surfaces can consume without weakening trail identity.
