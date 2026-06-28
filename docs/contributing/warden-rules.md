# Warden Rules

This guide explains how to author and audit Trails correctness rules so they survive framework evolution instead of encoding one audit incident. It applies to Warden rules, repo-local lint delivery, advisory guidance, and temporary hardening scanners.

Use it with [Warden](../warden.md), [ADR-0036](../adr/0036-warden-rules-ship-only-as-trails.md), and [ADR-0037](../adr/0037-owner-first-authority.md).

## Rule Home Doctrine

- Warden is the durable public correctness surface for Trails.
- Warden owns source-static, project-static, topo-aware, drift, and advisory
  checks when they enforce public Trails semantics.
- The private `@ontrails/oxlint-plugin` package is repo-local lint delivery and
  a possible future compiled destination for Warden-owned source checks. It is
  not the public framework correctness surface.
- Scratch scanners are prototypes. Proven checks graduate into Warden or retire.
- Owner-first authority is the v1 rule-data model. Rules import framework data
  from the natural owner module.
- Trails does not use `canonicalSource()`, TSDoc `@canonical` tags,
  topo-resident canonical tables, generic registries, loader APIs, or
  `derivedFrom` metadata as the default answer to duplicated framework facts.

The tier names here are authoring classifications. Built-in Warden rule metadata exposes them from `@ontrails/warden`; runtime tier filtering and advisory report shape build on that metadata rather than inventing another rule registry.

## Authority Model

Use the narrowest effective authority layer. Trails should make mistakes impossible by type when it can, catch them with tests when runtime behavior is the contract, and put durable semantic checks in Warden when the invariant needs source, project, topo, or drift context. Prose or repo-local lint can orient, coach, and clean up, but they should not become parallel authority for framework facts.

| Need | Authority | Notes |
| --- | --- | --- |
| Formatting | `oxfmt` / Ultracite | Style stays boring and mechanical. |
| General JS/TS lint | Upstream `oxlint` rules | Standard language hygiene, not Trails doctrine. |
| Repo-local JS/TS hygiene | Private `@ontrails/oxlint-plugin` | Console/process leakage, deep imports, barrels, Bun-native preference, retired source vocabulary, snapshot location, test naming, and temporary cleanup. |
| Syntax tripwires and codemods | `ast-grep` | Useful for audits and high-confidence syntax shapes. New durable Trails rules should graduate into Warden instead of living here. |
| Trails semantic correctness | Warden | The durable public correctness surface for trail/resource/signal/composition/permit/topo invariants. |
| Topology and resolved-graph drift | Warden + Topographer | Lock manifest drift, TopoGraph drift, and topo-aware checks. |
| Contract/runtime behavior | `testAll` and focused tests | Examples, output contracts, detours, and surface projection validation. |
| Impossible-by-type constraints | TypeScript | Output schemas, typed `ctx.compose()`, `resource.from(ctx)`, and other compile-time contracts. |
| Human and agent orientation | `AGENTS.md` | A map over the executable system, not the only enforcement point. |

When auditing `AGENTS.md`, map each rule to the strongest current authority layer and file focused follow-ups for any enforceable rule that remains prose-only. The audit is not itself the durable authority; it is a queueing step that either points at existing enforcement, explains why prose is intentional, or turns the gap into Warden, TypeScript, `testAll`, Oxlint, or ast-grep work.

Owner-first data beats duplicated rule lists. If Warden needs framework facts such as reserved lexicon terms, intent values, error categories, permit rules, or Result accessors, it should read them from the module that owns the fact. If the owner does not expose a clean typed value, strengthen that owner before hardcoding a second list in the rule.

Temporary repo-local rules are allowed when they have a clear lifecycle. TRL-575 is the precedent: a temporary audit scanner needs an owner, reason, baseline count, deletion or promotion trigger, and issue reference. Temporary rules are visible debt; durable framework semantics belong in Warden once the invariant is understood.

Project-local Warden rules live in `.trails/rules.ts` or direct `.trails/rules/*.ts` files at the project root. Warden loads those modules by default for command and API runs, so an adopting repo can enforce local migration or governance rules without shipping them from `@ontrails/warden`. The location is the ownership signal: a rule in that committed-control directory is project-local by placement, not by advisory metadata. Modules may export `rule`, `rules`, `sourceRule`, `sourceRules`, `topoRule`, or `topoRules`; rules without explicit metadata receive repo-local source-static or topo-aware execution metadata so short-lived migration rules do not need ceremony before they can run.

Warden does not recursively discover nested rule files. Keep the public project-local entrypoints at `.trails/rules.ts` or direct `.trails/rules/*.ts` children, and re-export helpers from nested directories when a rule grows large enough to split. Rule ids must be unique across every discovered module. The retired `trails/warden/rules` location fails with a migration diagnostic instead of being loaded.

Project-root discovery uses committed project markers such as `trails.config.*` or `trails.lock`, with source-shaped projects as fallback when no committed marker exists above them. A bare `.trails/` directory is not a root marker by itself. This lets Warden find root-local rules from nested cwd invocations without making every incidental `.trails/` folder look like a project boundary.

Use `warden.scope.exclude` in project config, or `trails warden --scope-exclude <glob>` for a single run, when Warden should exclude local notes, scratch space, generated state, or other root-relative paths from governance. Scope is a path-scope boundary for governance, not a rule skip-list: excluded files do not feed source diagnostics or project-derived facts. Keep durable skills, plugin assets, and source-owned agent guidance in scope unless the project has a concrete reason to exclude them.

Use `.trails/rules.ts` or direct `.trails/rules/*.ts` children when the invariant is real for this project but not yet a framework promise. Promote the rule into `@ontrails/warden` only after the survival tests show it belongs to Trails users broadly. Delete it when the migration or temporary hardening window closes.

## Core Principle

Express rules as invariants the framework holds, not as instances of bugs found during an audit.

Instance form:

```ts
{
  name: 'mcp-error-map-not-consumed',
  description: "MCP surface must call mapSurfaceError('mcp', err)",
}
```

Invariant form:

```ts
{
  name: 'registered-error-map-not-consumed',
  invariant:
    'Any surface that registers an error mapping must consume it in its error path.',
  readsFrom: 'codesByCategory',
}
```

The invariant form survives new surfaces, renamed helpers, and future extensions. Prefer it whenever deterministic detection is feasible.

## Survival Tests

Run these tests before landing a new rule or refactoring an old one.

### Mechanism-Renamed Test

If a helper gets renamed tomorrow, does the rule still enforce the same framework promise?

- Bad: the rule requires a specific helper call when the helper is only
  mechanism.
- Better: the rule detects the role, owner data, or structural obligation.
- Acceptable: exact symbol matching when the symbol itself is stable public
  contract, such as `Result.ok`, `Result.err`, or `ctx.compose()`.

### Family Test

Can you name three instances of the same shape today?

If yes, write the family-level rule. If no, either refuse the rule or give it a binding `retireWhen` clause with mechanical enforcement. A soft note is not an expiry plan.

### Data-Source Test

Does the rule duplicate framework data that an owner module already declares?

Read owner exports for error classes, surface code mappings, intent values, CRUD doctrine, detour caps, Result accessor names, adapter descriptors, and reserved lexicon terms. If the owner does not expose the data cleanly, strengthen the owner first.

### Surface-Extension Test

When a new surface, primitive, or extension lands, does the rule extend through owner data or do we need a sibling rule?

Sibling rules per surface or primitive usually mean the invariant is too low level.

### Context Test

Is the rule universal, extension-only, internal-only, repo-local, temporary, or advisory?

The limitation must be principled. "We only wrote the detector for one context" is not a principle.

## Owner-First Authority

Framework values live in the module that owns the concept.

| Owner Source | Authoritative For |
| --- | --- |
| `errorClasses`, `codesByCategory`, and `TrailsError` classes | Error taxonomy and surface error-code mappings |
| `intentValues` | Intent union values |
| Store doctrine exports | CRUD operation set and accessor expectations |
| `DETOUR_MAX_ATTEMPTS_CAP` | Detour retry limit |
| `resultAccessorNames` | Result accessors that imply sync assumptions |
| Lexicon reserved terms | Retired vocabulary for source-file checks |
| Adapter descriptors, once formalized | Extension and surface declarations |
| Capability matrix, once formalized | Primitive lifecycle expectations |

When a rule needs one of these values:

1. Import from the natural owner.
2. If the data is not exported, add a typed owner export.
3. Use rule-owned configuration only when the list itself is policy, not a
   projection of framework data.

Curated rule data is valid when it is policy. For example, `context-no-surface-types` can own its denylist until another independent consumer appears or drift proves the list belongs elsewhere.

Consumer apps do not author framework authority. Their topo is their local source of truth; framework rules read framework owners.

## Rule Shapes

Use recurring shapes to avoid writing the third sibling rule.

| Shape | Form | Examples |
| --- | --- | --- |
| Declarations-match-usage | Static declaration matches runtime call | `composes` and `ctx.compose`; `fires` and `ctx.fire`; `resources` and `db.from(ctx)` |
| Owner-projection-parity | Derived data keeps reading its owner | Error-code maps, CRUD operations, intent literals |
| Orphan-X | Primitive declared but never referenced | Orphan resource, signal, layer, contour |
| Cycle-in-X-graph | Directed graph must not cycle | Composition graph, activation graph, layer dependency graph |
| Collision-detection | Two declarations claim the same slot | HTTP route, webhook path, MCP tool name |
| Schema-compatibility | Source schema satisfies consumer schema | Compose input, signal payload |
| Vocabulary-banned-term | Source identifier uses retired vocabulary | Reserved terms in TS/JS source |
| Declaration-requires-companion | Declaration needs infrastructure to run | Source kind and materializer, resource and adapter |

Collapse only when data model, traversal, and diagnostic shape are genuinely shared. Similar English is not enough.

## Source-File Vocabulary Rules

Retired vocabulary checks apply to source files. Documentation vocabulary is an editorial review or docs-cutover concern.

When a rule fires on a word, import path, or literal symbol, scope it to the role the rule owns.

- Prefer AST positions over free-text matches.
- Exclude unrelated third-party or domain uses.
- List rule-owned roles explicitly when a word has legitimate meanings outside
  the Trails concept being retired.

The repo-local `no-retired-lexicon-terms` Oxlint rule is the source-file guard for retired lexicon terms. It reads retired terms from the `docs/lexicon.md` Reserved Terms table and checks source-owned symbol roles such as identifiers, local or `@ontrails/*` import paths, object keys, and literal member properties. It intentionally does not lint Markdown prose; docs and historical mention-class coverage stays in the vocabulary audit path so migration docs, changelogs, ADRs, and contrastive explanations can be classified instead of blindly rewritten. `bun run check` runs `bun run vocab:audit` so active docs, scripts, and package sources also fail when retired cutover vocabulary reappears outside explicit history, migration, or legacy-cleanup seams. The TopoGraph artifact-family guard uses this path for the retired artifact-family names listed in the lexicon's retired-vocabulary table, including legacy root DB paths and pre-M4b workspace directories.

## Ast-Grep Structural Rules

The `.ast-grep/` ruleset is repo-local structural lint, paired with Warden rather than replacing it. Use it for high-confidence syntax shapes where the invariant is already owned and named by Warden, such as direct `.blaze()` calls or `Result.err(new Error(...))`. Keep topo-aware, project-static, owner-projection, and scope-sensitive checks in Warden.

Experimental ast-grep queries may live outside `.ast-grep/rules/` so they are available for audits without blocking CI. Promote one into the blocking rule directory only after it is clean on the current tree and its false-positive profile is understood.

## Existing Rule Audit Checklist

For each existing rule:

1. Write a one-line invariant.
2. Run the survival tests.
3. Identify owner sources.
4. Classify the rule.

Use these classifications:

- **Durable:** keep as-is.
- **Refactor:** same invariant, better owner data or wording needed.
- **Replace:** instance-level rule must be promoted or retired.
- **Merge:** sibling of another rule; collapse when the shared shape is real.
- **Curated policy:** rule-owned data is the policy and should remain local for
  now.

## New Rule Checklist

- [ ] One-line invariant.
- [ ] Survival tests pass, or each failure has a principled reason.
- [ ] Owner sources identified.
- [ ] Family shape named.
- [ ] Context named: external, extension, internal, repo-local, temporary, or
  advisory.
- [ ] Retirement criterion added if the family test fails.
- [ ] Warden tier named: source-static, project-static, topo-aware, drift, or
  advisory.
- [ ] Private plugin delivery considered only as implementation plumbing.

## Anti-Patterns

- Rule name references one surface or helper when the invariant is broader.
- Description says "X must call Y" when Y is mechanism.
- Rule lists framework values inline instead of reading owner data.
- Sibling rules appear per surface or primitive.
- Single-file bug detector has no expiry.
- Public docs tell users to install a lint package for framework correctness.
- Scratch scanner becomes a permanent tool by inertia.
- Generic registry machinery appears as the default solution before owner
  modules are tested.

## Hardening Loop

When an audit produces a prevention candidate:

1. Convert the observed bug into a framework invariant.
2. Run the survival tests.
3. Name the owner data source.
4. Choose the narrowest Warden tier that can answer the question.
5. Use the private plugin only for repo-local cleanup or delivery mechanics.
6. Add tests that prove both accepted code and the diagnostic shape.
7. Record any temporary rule's deletion trigger.

Forward-looking skills, docs, and advisory reports can consume owner data and Warden findings. They do not become parallel authority.
