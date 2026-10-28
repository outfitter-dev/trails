---
id: 61
slug: skills-as-a-served-guidance-surface
title: Skills Are a Served Guidance Surface
status: accepted
created: 2026-10-28
updated: 2026-10-28
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 35, 50, 52, 54, 55]
---

# ADR-0061: Skills Are a Served Guidance Surface

## Context

A trail's contract makes its schemas, examples, errors and composition inspectable. An agent also needs workflow guidance: which capability to start with, how to combine calls, and where an app's conventions matter. Keeping that guidance in a second, manually maintained description of the API would work against [ADR-0000](0000-core-premise.md#the-contract-is-queryable).

The approved MCP catch-up plan chooses three skill sources and one rendering. SEP-2640 is now Final; its stable Skills extension is the protocol binding. [ADR-0055](0055-mcp-stateless-core-on-sdk-v2.md#decision) supplies the SDK v2 and stateless MCP direction. Those decisions establish intent; they do not prove that a Trails skill server, an upstream Skillset target, or any particular client integration is implemented.[^plan][^extension]

## Decision

### Serve the Skills extension and its underlying resources

Trails binds served guidance to `io.modelcontextprotocol/skills`: `skills/list`, `skills/get`, and ordinary MCP resource reads for skill files. Extension support is declared through the SDK's capability model. The current stable extension specification, rather than an archived SEP draft, owns the wire contract. Optional directory listing is advertised only when it is implemented and covered by the same access policy.[^extension]

The Trails URI shape is `skill://<app>/<skill>/<file>`. `<app>` is the selected canonical app ID; `<skill>` is the validated skill name; `<file>` is the validated path relative to that skill's directory. This permits a supporting path such as `references/USAGE.md` without losing skill identity. The app prefix is an organizational namespace, not a DNS destination. Invalid names, escaping paths and path aliases fail validation; serving does not silently case-fold or slug them. The canonical entry is the URI ending in `/SKILL.md`; a display name alone does not identify a skill across paths or servers.[^extension]

`skill://` remains separate from `trails://` graph facts. A skill teaches how to use the app; a graph resource reports its contract. Lookup resolves canonical URIs against the validated catalog, rather than joining arbitrary client paths onto a filesystem root. Serving a script file makes its bytes available and does not execute it.

### Three sources feed one rendering

| Source | Ownership and behavior |
| --- | --- |
| Skillset projection and lock | The paved path reads the app's existing projection and hashed `skillset.lock`. A first-class Skillset `mcp` target is the upstream direction; until it exists, Trails consumes the existing projection and lock. |
| Plain skills root | Apps without Skillset supply a folder of Agent Skills. The same validation and MCP rendering apply. Invalid skills fail with an actionable error. |
| Derived guidance | Trails renders the contract-owned guidance used by `trails guide` as a generated skill. Authors do not repeat schema, example or graph facts in a second manifest. |

Agent Skills owns the skill file format and its validation. Trails preserves authored guidance and derives known contract facts, following [ADR-0035](0035-surface-apis-render-the-graph.md#decision). One source tree can continue to feed terminal agents from disk and MCP clients from the server.[^format]

### Locate authored input in static app configuration

An explicit authored source is declared as one `skills.root` in config-owned **static project configuration**, relative to the selected app root under [ADR-0054](0054-project-substrate-names-its-truth.md#decision). It is not a runtime `base`, profile, local or environment override under `defineConfig`. [TRL-1474] must extend the existing static project loader and validation with equivalent data-format support; the field is a planned addition, not an option the current helper already implements. Source location belongs in config; the lock overlay carries derived facts.

A Skillset default is used only when validated projection/lock evidence unambiguously owns that app and source. A directory named `.agents/skills` is insufficient. With no such evidence, there is no implicit authored source; a plain root is explicit. A malformed or mismatched Skillset lock fails rather than falling back to a plain-folder interpretation, including when the projection was selected explicitly. Legitimate Skillset projection links are validated against their ownership boundary; arbitrary request paths are never followed.

Config-owned location feeds one source reader/validator and one materialized served catalog. Compile, validation/Warden and runtime materialization consume the same fresh collection. The portable renderer receives that catalog, with no second directory option or filesystem import. Physical paths remain tooling provenance, not portable URI identity or absolute workstation paths in the lock. Neither the process working directory nor a guessed workspace root selects the source.

The generated skill has the stable name `trails-guide`. It derives from the selected app's graph/guide owner and does not merge authored prose into generated output. Its bytes depend on stable pre-guidance contract facts, without timestamps or the hash of a catalog that includes the guide itself. This keeps cold compilation from recursively hashing its own output.

Canonical URI collisions between source owners, including an authored `trails-guide`, fail before listing or serving a partial catalog—even if the bytes match. The error names both owners. There is no source priority, automatic renaming or content merge; an authored skill can be renamed at its source.

### Keep storage loading outside portable serving

The portable MCP handler consumes a prepared catalog and storage interface. Filesystem discovery belongs to a host/build adapter. SDK 2.4.0 exposes portable `SkillFiles` and memory storage, while `loadSkills` is exported from its Node-specific skills entry point. The Node loader must not become a transitive import of the Web-standard fetch handler.[^sdk]

The SDK's skills attachment currently accepts its high-level `McpServer`; Trails' SDK migration currently uses the low-level `Server`. That is an integration constraint for [TRL-1341], not proof that calling `loadSkills().attach(...)` is a drop-in. Implementation must preserve the existing `trails://` resource families and route skill reads through the shared access boundary. It may adapt internal materialization while keeping the public Trails surface independent of SDK objects.

### Verify credentials per request and authorize resource reads

Every skill file and skill discovery/retrieval path uses the shared per-request credential boundary from [ADR-0055](0055-mcp-stateless-core-on-sdk-v2.md#authorization-is-resolved-for-every-request) and [TRL-1339]. Bearer credentials and application `_meta` are candidates for verification; neither metadata nor a protocol session establishes identity. Stdio remains outside OAuth.

Resource-read policy receives the verified permit and a catalog-resolved target. It does not re-verify raw credentials or inherit a referenced trail's execution scopes. A write-protected trail can have publicly readable guidance while its invocation remains protected. Credential verification failures deny access even when public introspection is otherwise allowed.

The default policy is public introspection within the app's authored MCP population. Apps with private guidance supply explicit resource-read policy. Lists, direct URI reads, manifests and the fallback path must honor that policy without remembering a previous caller's decision. A URI denial alone does not hide the same information from tool descriptions or the independently authorized surface-map aggregate. Per-permit tool population, partial trailhead projection and structured-link filtering remain separate work; this ADR does not promise that confidentiality model.

A complete accessible skill is the advertisement unit. If policy denies any file in the canonical manifest, omit that skill from `skills/list` and deny `skills/get`; also honor any explicit skill-operation policy. Never publish a caller-trimmed manifest or digest. Resolve credentials once per request, then evaluate the actual file descriptors against that permit without reading every file or authenticating once per file. Policy errors or unknown outcomes do not count as permission.

Each later direct file read rechecks its own request. A prior list/get result grants no future access. Withholding a complete advertisement does not transitively deny another individually permitted file: direct reachability follows its own policy without revealing an unauthorized manifest or neighboring file. [TRL-1341] must test these distinctions, full unchanged manifests for allowed callers, and alternating-caller isolation.

### Digests describe the served bytes

Compilation derives each served file's canonical URI, byte length and SEP-2640 SHA-256 digest across all three sources. The manifest and the subsequent read must describe the same bytes; changed files cannot retain a stale advertised digest. The extension's dynamic-content form does not establish immutable lock-backed content.[^extension]

These facts enter `trails.lock` through the existing overlay mechanism in [ADR-0052](0052-overlays-one-extension-mechanism.md#decision). [TRL-1478] owns the concrete narrow namespace/schema with [TRL-1424] as a design input. This decision does not adopt lock schema v6, add a second lock channel, or merge `skillset.lock` into Trails' lock. [TRL-1480] owns the drift rule, and cold lock round-trips remain byte-identical.

Freshness and audience remain separate. A matching digest can support freshness; it does not make private guidance public. The caching implementation in [TRL-1463] must preserve authorization-sensitive `cacheScope` for skill lists, entries and reads. Until those facts are proven, conservative SDK defaults remain appropriate.

### Preserve a fallback without inventing host support

Hosts without the extension can read the same ordinary `skill://` resources through an `instructions` pointer that preserves existing server instructions. The fallback uses the same bytes, digests and read policy. Terminal clients can consume the original folder from disk. Extension installation and a pointer do not prove that a host discovers, loads or follows the guidance.

[TRL-1341] must demonstrate ChatGPT and MCP Inspector listing the served skills and Claude Code consuming the same folder from disk, plus the applicable conformance cases. No specific host's extension support is established by accepting this ADR.

## Consequences

### Positive

- Authored workflows and derived contract guidance share one served format and can reach both disk and MCP consumers.
- File manifests make content identity inspectable and drift governable.
- The ordinary-resource fallback and shared read policy avoid a separate access path for lagging hosts.

### Tradeoffs

- Strict validation and URI collision errors require source cleanup instead of silently publishing a partial catalog.
- Skillset's first-class target needs upstream work; the existing projection/lock path must remain usable until that work is accepted and implemented.
- Internal SDK attachment and portable storage boundaries require integration tests; a package upgrade alone is insufficient.

### Implementation and proof

[TRL-1341] owns rendering, generated guidance and client proof; [TRL-1474] owns the two authored source adapters; [TRL-1342] owns the upstream Skillset proposal; [TRL-1478] and [TRL-1480] own lock facts and drift governance. Existing issue scopes must stay aligned with this decision. The proposal is not upstream acceptance, and source tests are not live client proof.

This is a documentation-only decision with no package changeset. Runtime implementation carries its own changesets, agent guidance, migration notes, conformance, publication checks and Wayfinder dogfood proof. No runtime, lock-schema migration, publication or upstream mutation is performed by this ADR.

## References

- [ADR-0000](0000-core-premise.md#the-contract-is-queryable) — contract facts remain inspectable and derived.
- [ADR-0035](0035-surface-apis-render-the-graph.md#decision) — rendering and host materialization remain separate.
- [ADR-0050](0050-surface-accommodations-preserve-trail-identity.md#core-rule) — guidance does not obscure the invoked trail's identity.
- [ADR-0052](0052-overlays-one-extension-mechanism.md#decision) — skill lock facts use the existing extension mechanism.
- [ADR-0054](0054-project-substrate-names-its-truth.md#decision) — static app identity and source ownership.
- [ADR-0055](0055-mcp-stateless-core-on-sdk-v2.md#decision) — shared stateless MCP and authorization direction.
- [TRL-1338] — accepted skills design and downstream alignment.

[^plan]: [MCP catch-up plan](https://app.notion.com/p/4061b36f46cb81129d35c2812931a17a), connected copy identifying Claude artifact EFMnjkqV7Lji7j2A7b28jW revision 46. Its copy is source material, not an independent live-Claude verification.
[^extension]: [Stable Skills extension specification](https://github.com/modelcontextprotocol/ext-skills/blob/main/specification/stable/skills.mdx); [SEP-2640](https://modelcontextprotocol.io/seps/2640-skills-extension) records the accepted proposal.
[^format]: [Agent Skills specification](https://agentskills.io/specification).
[^sdk]: [SDK 2.4.0 server package](https://www.npmjs.com/package/@modelcontextprotocol/server/v/2.4.0), public `ext/skills` and `ext/skills/node` declarations. `loadSkills` and high-level attachment availability do not establish Trails integration.

[TRL-1338]: https://linear.app/outfitter/issue/TRL-1338
[TRL-1339]: https://linear.app/outfitter/issue/TRL-1339
[TRL-1341]: https://linear.app/outfitter/issue/TRL-1341
[TRL-1342]: https://linear.app/outfitter/issue/TRL-1342
[TRL-1424]: https://linear.app/outfitter/issue/TRL-1424
[TRL-1463]: https://linear.app/outfitter/issue/TRL-1463
[TRL-1474]: https://linear.app/outfitter/issue/TRL-1474
[TRL-1478]: https://linear.app/outfitter/issue/TRL-1478
[TRL-1480]: https://linear.app/outfitter/issue/TRL-1480
