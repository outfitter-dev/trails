---
slug: packs-namespace-boundaries
title: Packs as Namespace Boundaries
status: draft
created: 2026-03-31
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [3, 9]
---

# ADR: Packs as Namespace Boundaries

## Context

### The gap between trails and apps

Trails has two compositional units: the trail (atomic operation) and the topo (the app). A trail defines typed input-to-Result behavior. A topo collects trails, events, and services into a queryable topology that trailheads can render.

Between these two, there's a missing layer. Real applications organize capability into domains: GitHub operations, inbox management, billing, notifications. Each domain has its own trails, services, config requirements, and events. Today, these domains are plain TypeScript modules passed to `topo()`. The framework discovers trails and events via module scanning. It works, but the module has no identity, no boundary, and no metadata. The framework doesn't know "these 12 trails and 2 services belong together as the GitHub capability."

This matters because:

1. **Config composition implies boundaries.** The config ADR's env prefix scoping behaves like a namespace boundary — a pack's config schema gets prefixed when composed into a topo. That pattern implies a boundary that doesn't yet exist at the trail/service level. The boundary is real; the primitive to express it is not.

2. **Visibility needs a scope.** The visibility ADR introduces `internal` trails that aren't surfaced. But an SDK wrapper pack should default all its trails to `internal`. Without pack-level defaults, every trail must individually declare `visibility: 'internal'`.

3. **Service collision is namespace-dependent.** Two modules that both define a `db` service collide. Developers avoid this by namespacing (`github.client`, `linear.client`), but the framework doesn't enforce or validate the boundary. Packs make the namespace real.

4. **Testing and governance want boundaries.** `testExamples(pack)` testing a capability in isolation. The warden enforcing that external code doesn't follow internal trails. Survey reporting capability boundaries. None of these work without a formal boundary.

5. **Reuse across apps needs more than modules.** A module is a bag of exports. A pack is a capability with declared dependencies, config requirements, and a public API. The difference matters when the same capability is consumed by multiple apps.

### What other frameworks do

NestJS has modules with providers, controllers, imports, and exports. Angular has NgModules. Rust has crates. Each provides a boundary with explicit public/private API and dependency declaration. The common pattern: a named container with declared contents and explicit edges.

Trails should have the same, but shaped by Trails principles: definition over configuration, derive what's known, progressive adoption.

### The SDK wrapping pattern

A common real-world pattern: wrapping an external SDK (GitHub, Stripe, Linear) as Trails-native capability. The SDK wrapper has 20-30 trails that are 1:1 with API methods. Most are internal composition targets. A domain pack on top curates and enhances them into public verbs, sometimes thin passthroughs, sometimes opinionated compositions.

This pattern (from the Graphite/Git analogy) requires two things from packs:

1. **Pack-level default visibility.** An SDK wrapper pack defaults to `internal`. Every trail inherits the default. A few are promoted to `public` by explicit override.
2. **Pack-level dependency.** The domain pack declares `requires: [sdkCorePack]`. The topo validates that the SDK pack is present when the domain pack is composed.

### Why `pack()` now

Config composition, visibility defaults, service namespacing, event ownership, and testing boundaries all point to the same missing concept: a named container between trail and topo that carries identity and metadata. Each of these patterns has emerged independently — developers namespace services by convention, config schemas scope by prefix, visibility annotations repeat across related trails. This ADR introduces `pack()` as a new primitive to formalize the boundary these patterns already imply.

## Decision

### `pack()` as a definition function

`pack()` is a definition function, like `trail()`, `provision()`, and `signal()`. It returns a Pack. The topo accepts Packs alongside bare trail modules.

```typescript
import { pack } from '@ontrails/core';

export const githubCore = pack('github.core', {
  visibility: 'internal',
  config: githubConfigSchema,
  provisions: [githubClient],
  trails: [authenticate, verifyWebhook, listRepos, getUser],
  events: [webhookReceived],
});
```

The first argument is the pack name, following the dotted namespace convention. The second is the pack spec.

### Pack spec fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `visibility` | `'public' \| 'internal'` | `'public'` | Default visibility for trails in the pack. Trails override individually. |
| `config` | `ZodObject` | `undefined` | Pack-level config schema. Composed into app config under the pack name. |
| `services` | `Service[]` | `[]` | Services this pack provides. |
| `trails` | `Trail[]` | `[]` | Trails this pack contains. |
| `events` | `Event[]` | `[]` | Events this pack declares. |
| `requires` | `Pack[]` | `[]` | Other packs this pack depends on. Validated at topo construction. |

All fields except the name are optional. A minimal pack is just a name and some trails:

```typescript
export const entityPack = pack('entity', {
  trails: [show, add, remove, list],
});
```

Progressive adoption: an existing module that exports trails can become a pack by wrapping it in `pack()`. The trails don't change.

### Visibility inheritance

A pack's `visibility` sets the default for its trails. Trails override individually.

```typescript
const githubCore = pack('github.core', {
  visibility: 'internal',  // all trails default to internal
  trails: [
    authenticate,           // internal (inherits pack default)
    verifyWebhook,          // internal (inherits pack default)
    listRepos,              // internal (inherits pack default)
  ],
});
```

A trail that needs to be public in an internal pack overrides explicitly:

```typescript
const listRepos = trail('github.repos.list', {
  visibility: 'public',    // overrides pack default
  intent: 'read',
  input: z.object({ org: z.string().optional() }),
  output: z.object({ repos: z.array(RepoSchema) }),
  blaze: async (input, ctx) => { /* ... */ },
});
```

The override is visible in the trail definition. Survey reports both the pack default and per-trail overrides. The warden can flag a pack where every trail overrides the default (the default is wrong).

### The `requires` declaration

A pack declares which other packs it depends on:

```typescript
const githubPullRequests = pack('github.pull-requests', {
  requires: [githubCore],
  trails: [listPRs, showPR, submitReview],
});
```

`requires` is validated at topo construction. If `githubPullRequests` is composed into a topo without `githubCore`, the topo constructor returns an error describing the unmet dependency: which pack requires what, and what's missing.

The dependency is by pack identity (the Pack object), not by name string. This is type-safe and import-checked at compile time.

`requires` supports two patterns:

**Self-contained packs** provide their own services and have no requires. They compose into any topo independently.

**Layered packs** require a foundation pack. The domain pack `github.pull-requests` requires the SDK pack `github.core` for its client service. The product pack `firewatch.inbox` requires domain packs for its cross-provider composition. Each layer adds its opinion on top of the previous layer's capability.

### Config composition

A pack's `config` schema composes into the app-level config under the pack name. The config ADR established env prefix scoping as a composition pattern; `pack()` gives that pattern a proper container:

```typescript
const githubCore = pack('github.core', {
  config: z.object({
    appId: z.string().env('GITHUB_APP_ID'),
    privateKey: z.string().env('GITHUB_PRIVATE_KEY').secret(),
    webhookSecret: z.string().env('GITHUB_WEBHOOK_SECRET').secret(),
  }),
});
```

When composed into a topo, the config resolves under the pack's namespace. Env variables get the pack's prefix. The generated `.env.example` includes them with pack attribution.

### Service scoping

Services within a pack are namespaced by the pack. The pack name provides the namespace boundary:

```typescript
// In github.core pack
const githubClient = provision('github.client', { /* ... */ });

// In linear.core pack
const linearClient = provision('linear.client', { /* ... */ });
```

The namespacing convention is already established (developers namespace by hand today). Packs formalize it. The warden can warn when a service ID doesn't match its pack's namespace.

### Topo composition

`topo()` accepts Packs alongside bare trail modules:

```typescript
const app = topo('firewatch',
  githubCore,
  githubPullRequests,
  githubIssues,
  linearCore,
  linearIssues,
  firewatchInbox,
  firewatchReviewOps,
);
```

Internally, `topo()` unpacks each Pack: registers its trails, services, and events, composes its config schema, and validates its `requires`. The resulting Topo is the same flat topology that trailheads, survey, and the warden operate on. Packs are a composition-time concept, not a runtime concept.

However, the topo retains pack membership metadata. Survey can report "this trail belongs to the `github.core` pack." The warden can enforce pack boundaries. CLI help can group by pack. The information is preserved for introspection without changing the runtime model.

### Pack-level trigger overrides

A pack's trails may declare `on` triggers as authored defaults. When a consuming app provisions a pack into its topo, it can override the `on` field for any trail within that pack -- adding, suppressing, or replacing triggers. This follows the "authored defaults, overridable in context" pattern that visibility inheritance already establishes.

```typescript
const app = topo('firewatch',
  githubCore,
  githubPullRequests.provision({
    fires: {
      'github.pr.list': { fires: ['cron:every-5m'] },       // replace authored fire sources
      'github.pr.show': { fires: [] },                       // suppress all fire sources
      'github.pr.submit-review': { fires: { add: ['event:review.requested'] } }, // add to existing
    },
  }),
);
```

The pack author provides sensible defaults. The consuming app adapts activation to its operational context without forking the pack. Survey reports which triggers are overridden and by whom.

### Event ownership and namespace scoping

Events are pack-scoped. A pack owns events in its namespace. This is non-negotiable — it's what makes packs portable and self-contained.

The `billing` pack owns `billing.*` events. The `notification` pack owns `notification.*` events. Composing both into a topo cannot produce namespace collisions because each pack owns its vocabulary. If a consuming app needs to map an event to a different name, that's an override at the app level, not a reason to hoist events out of the pack.

Events within a pack follow the same progressive disclosure as everything else:

```typescript
// Stage 1: Event is derived from the emitting trail
// The schema is captured from the typed payload in ctx.signal()
const processWebhook = trail('github.webhook.process', {
  signals: ['github.webhook.received'],
  blaze: async (input, ctx) => {
    ctx.signal('github.webhook.received', { action: input.action, payload: input.body });
    return Result.ok({ processed: true });
  },
});

// Stage 2: Event promoted to pack-level declaration
// The schema is now explicit, queryable, and part of the pack's public contract
const webhookReceived = signal('github.webhook.received', {
  schema: z.object({ action: z.string(), payload: z.unknown() }),
});

const githubCore = pack('github.core', {
  events: [webhookReceived],
  trails: [processWebhook],
});
```

Pack-level `signal()` declarations signal "this event is part of the pack's public contract" the same way trail visibility signals "this trail is part of the pack's public API." Events that are only emitted and consumed within the pack don't need extraction — they're internal implementation details.

### The SDK wrapping pattern

A layered pack composition for wrapping an external SDK:

```typescript
// Layer 1: SDK wrapper (internal by default)
const githubCore = pack('github.core', {
  visibility: 'internal',
  config: githubConfigSchema,
  provisions: [githubClient],
  trails: [
    authenticate, verifyWebhook,
    rawListRepos, rawGetUser, rawListPRs, rawGetPR,
    rawCreateReview, rawListChecks,
  ],
});

// Layer 2: Domain pack (public, curates the raw SDK)
const githubPullRequests = pack('github.pull-requests', {
  requires: [githubCore],
  trails: [
    listPRs,       // thin wrapper: simplifies input, adds defaults
    showPR,        // thin wrapper: enriches output
    submitReview,  // opinionated: adds validation, defaults, logging
  ],
});

// Layer 3: Product pack (app-specific)
const firewatchInbox = pack('firewatch.inbox', {
  requires: [githubPullRequests, linearIssues],
  provisions: [inboxStore],
  trails: [showInbox, triageItem, archiveItem],
});
```

Layer 1 trails are internal: composition targets only. Layer 2 trails are public: the domain's API. Layer 3 trails are the product's verbs. Each layer adds its opinion without reaching into the previous layer's internals.

A thin passthrough trail in layer 2:

```typescript
const listPRs = trail('github.pr.list', {
  intent: 'read',
  crosses: ['github.core.raw-list-prs'],
  input: z.object({
    repo: z.string().describe('owner/repo format'),
    state: z.enum(['open', 'closed', 'all']).default('open'),
  }),
  blaze: async (input, ctx) => {
    const [owner, repo] = input.repo.split('/');
    return ctx.cross('github.core.raw-list-prs', { owner, repo, state: input.state });
  },
});
```

The domain pack owns the contract. The SDK wrapper absorbs API changes. Consumers depend on the domain pack's schema, not the SDK's.

### Testing

Packs are testable in isolation:

```typescript
import { testExamples } from '@ontrails/testing';

testExamples(githubCore);         // tests the SDK wrapper pack
testExamples(githubPullRequests); // tests the domain pack (mock services from required packs)
testExamples(firewatchInbox);     // tests the product pack
```

A pack's `requires` are resolved with mock services during testing. The SDK wrapper's mock factory provides a mock GitHub client. The domain pack gets the mock client without knowing it's mocked. `testExamples` on a pack validates the pack's own trails with its own mock services and its required packs' mocks.

### Survey and governance

`survey` reports pack membership:

```bash
$ trails survey --packs
Packs:
  github.core          4 services, 8 trails (all internal)
  github.pull-requests 0 services, 3 trails (3 public), requires: github.core
  firewatch.inbox      1 service,  3 trails (3 public), requires: github.pull-requests
```

The warden enforces pack boundaries:

- **Cross-pack internal access.** A trail outside `github.core` follows an internal `github.core` trail. Error. Internal trails are internal to their pack.
- **Unmet requires.** A pack in the topo has a `requires` that isn't satisfied by another pack in the topo. Error at topo construction.
- **Unused requires.** A pack declares `requires: [githubCore]` but no trail in the pack follows any trail in `githubCore` or uses any service from `githubCore`. Warning.
- **Namespace mismatch.** A trail in the `github.core` pack has an ID like `linear.something`. Warning: trail ID doesn't match pack namespace.

## Consequences

### Positive

- **Formal capability boundaries.** Packs give the framework a compositional unit between trail and app. Survey, warden, testing, and trailheads all benefit from knowing "these things belong together."
- **Progressive adoption.** A bare module still works. `topo('myapp', myModule)` keeps working. Packs are opt-in. Wrapping a module in `pack()` adds boundary semantics without changing the trails.
- **Visibility defaults compound.** An SDK wrapper pack with `visibility: 'internal'` eliminates per-trail annotation for the common case. The visibility ADR and the pack ADR multiply each other's value.
- **Config composition is formalized.** The pack-level config scoping from the config ADR gains a proper container. Config schemas, env prefixes, and generated artifacts all key off the pack boundary.
- **Reuse is realistic.** A pack carries everything needed for independent use: trails, services, config, events, requires. Publishing a pack (as an npm package or a scaffoldable provision) is publishing capability, not just code.
- **Events decouple packs.** Packs that need to communicate don't need direct `follow` dependencies. A billing pack emits `billing.payment-completed`. A notification pack triggers on it. Neither imports the other. They're connected by the event contract in the topo. The Events Runtime provides the emission and routing. Packs provide the boundaries.
- **The SDK wrapping pattern is clean.** Internal SDK trails, public domain trails, and product-level composition all have natural homes. Each layer adds opinion without ceremony.

### Tradeoffs

- **A new primitive.** `pack()` joins `trail()`, `provision()`, `signal()`, and `topo()` in the framework's definition vocabulary. Every new primitive is a concept to learn. The justification: the gap between trail and topo is real, and developers are already building ad-hoc boundaries with modules.
- **`requires` validation adds a startup cost.** Topo construction now validates pack dependencies. This is a one-time cost at startup and is negligible for any realistic topo size.
- **Pack boundaries are advisory for `dispatch`.** `run()` can invoke any trail regardless of pack boundaries and visibility. This is intentional (programmatic invocation should not be constrained by trailhead-level concerns) but means pack boundaries are not a security mechanism.

### What this does NOT decide

- **How packs are distributed.** npm packages, GitHub repos, scaffolded source, monorepo packages: all valid. The pack primitive is distribution-agnostic. The provisions ADR addresses distribution.
- **Whether packs can re-export trails from required packs.** A domain pack might want to include an SDK trail in its public API without a passthrough wrapper. This is a possible future convenience.
- **Whether `requires` can specify version constraints.** Currently, `requires` is by pack identity (the imported Pack object). Version compatibility is a distribution concern, not a composition concern.
- **The `depot` or registry concept.** Pack discovery and ecosystem tooling are separate from the pack primitive. The pack definition must carry enough information for distribution, but the distribution mechanism is a separate decision.
- **Whether packs support sub-packs or nesting.** A pack is flat: it contains trails, services, and events. A pack can require other packs, but it doesn't contain them. Nesting would add complexity without clear benefit.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) -- "the trail is the product"; packs group trails into capability boundaries
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) -- the trail definition that packs contain
- [ADR-0009: Services](../0009-first-class-provisions.md) -- the provision primitive that packs scope and compose
- ADR: Trail Visibility and Trailhead Filtering (draft) -- packs set default visibility; this ADR depends on it
- ADR: Pack Provisioning (draft) -- distribution mechanism for packs; depends on this ADR
- ADR: Typed Signal Emission (draft) -- events are the primary decoupling mechanism between packs
- ADR: Reactive Trail Activation (draft) -- packs carry trigger declarations; activation registers when the pack composes into a topo
- ADR: External Trailheads as Trail Contracts (draft) -- rigged trails compose into packs with the same layering pattern
- [ADR-0013: Tracker](../0013-tracker.md) -- observability primitive; packs scope crumb emission boundaries
- ADR: The Serialized Topo Graph (draft) -- lockfile records pack membership and trailhead bindings
- [docs/vocabulary.md](../../vocabulary.md) -- `pack` reserved term
- [docs/horizons.md](../../horizons.md) -- packs listed as mid-term direction
