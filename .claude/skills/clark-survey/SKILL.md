---
name: clark-survey
description: "Autonomous codebase health scan for vocabulary drift, naming convention violations, structural anti-patterns, documentation staleness, and test health. Produces prioritized findings as Linear issues. Use for health checks, scheduled scans, or after heavy unreviewed agent work."
context: fork
agent: clark
---

# Clark: Survey

Autonomous scan. Broad, pattern-oriented. Not reviewing any single PR or milestone, but looking across the codebase for accumulating drift, emerging patterns, and opportunities to tighten.

Designed to run on a schedule (nightly, weekly) or on-demand when a general health check is needed. Produces actionable findings as Linear issues.

## What to Scan

### 1. Vocabulary Drift

Search the codebase for terms that do not belong. Same vocabulary check as calibrate, but applied to the entire codebase rather than a specific changeset.

```bash
# Example searches to run (adapt as needed)
rg -i "handler|middleware|endpoint|controller" --type ts -g '!node_modules'
rg -i "registry|collection|manifest" --type ts -g '!node_modules' -g '!package.json'
rg -i '"serve"|"mount"|"wire"' --type ts -g '!node_modules'
```

Not every match is a violation. Context matters. But every match is worth examining.

### 2. Naming Convention Drift

Look at recent exports and public API additions. Do they follow ADR-0001?

```bash
rg "^export " --type ts -g '!node_modules' -g '!*.test.*' -g '!*.spec.*'
```

Check for: factories without `create*`, derivations without `derive*`, test helpers without `test*`, validators without `validate*`.

### 3. Structural Patterns

Look for code smells that indicate architectural drift:

- **Surface types in blazes:** imports of `Request`, `Response`, `McpSession` in trail files
- **Direct throws:** `throw` statements in blaze code (should be `Result.err()`)
- **Console usage:** `console.log`, `console.error` in non-surface code
- **Direct `.run()` calls:** should be `ctx.cross()`

```bash
rg "throw " --type ts -g '*/trails/*' -g '!*.test.*'
rg "console\." --type ts -g '!node_modules' -g '!*.test.*'
rg "\.run\(" --type ts -g '*/trails/*'
```

### 4. Documentation Staleness

Compare the docs against the code:

- Do the ADRs reflect the current state? Check status fields.
- Does `lexicon.md` cover all exported terms?
- Does `architecture.md` match the actual package structure?
- Is `horizons.md` current? Have any horizon items shipped without being moved to "shipped"?

### 5. Test Health

- Does `bun run test` pass cleanly?
- Are there trails without examples?
- Are there examples that are stale (would fail if re-evaluated)?
- Does `trails warden` report violations?

```bash
bun run test
bun run typecheck
trails warden
trails survey --brief
```

### 6. Growth Without Governance

Look for quantitative signals:

- Packages or directories that have grown significantly without corresponding ADRs
- New error classes that do not fit the taxonomy
- New trail IDs that do not follow naming conventions
- New dependencies added without clear justification

## Output

```markdown
## Survey: [date]

### Critical (file immediately)
- [finding]: [specific files/lines, what is wrong, recommended fix]

### Important (file this week)
- [finding]: [description, impact, recommendation]

### Minor (file for backlog)
- [finding]: [description, low urgency but worth tracking]

### Healthy
- [areas that look good, briefly]

### Trends
- [patterns across multiple findings]
- [things getting better or worse over time]
```

### Linear Issue Format

For each finding that warrants an issue:

```markdown
**Title:** [Clark: brief description]
**Labels:** clark-survey, [area: vocabulary | architecture | naming | testing | docs]
**Priority:** [urgent | high | medium | low]
**Description:**
[What was found]
[Where it was found (files, lines)]
[Why it matters (which principle/convention)]
[Recommended fix]
```

## State Between Runs

If a previous survey exists at `.trails/clark/survey-latest.md`, read it before running. Note:

- Findings that were filed and resolved (mark as cleared)
- Findings that were filed but not resolved (note persistence)
- Findings that are new since last survey
- Trends over time

After the survey, write the current findings to `.trails/clark/survey-latest.md` so the next run has context.

## Reference

- `docs/lexicon.md` — lexicon to enforce
- `docs/adr/001-naming-conventions.md` — naming conventions to check
- `docs/architecture.md` — structural expectations
- `AGENTS.md` — current conventions
- `.trails/clark/survey-latest.md` — previous survey results (if exists)
