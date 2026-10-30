# Turbo 2.11 qualification

[TRL-1403](https://linear.app/outfitter/issue/TRL-1403) qualifies Turbo `2.11.10` on Bun `1.4.4+38afee6c8`. Its base is `3cb861758b897562c7e32d9ad01a6d6f217d780d`, which includes the Adapter Kit peer-plus-development validation fix. The root lock remains version 1. Only Turbo and its six platform package resolutions change; other package resolutions, catalogs, trust, install topology, task policy, and the consumer floor `>=1.4.0` remain unchanged.

## Workspace inputs

Turbo 2.11 intentionally [excludes pure peer relationships](https://github.com/vercel/turborepo/blob/v2.11.10/crates/turborepo-repository/src/package_graph/builder.rs#L995-L1005) from task ordering. Seventeen workspace peers are also declared as local development inputs in eleven packages. Their public peer ranges and optional metadata remain unchanged. These are compiler, type, and conformance-test inputs; Trails packages ship source, so this is not a new runtime dependency on built artifacts.

| Workspace | Development inputs retained as peers |
| --- | --- |
| Cloudflare | HTTP, Store |
| Config | Core |
| Drizzle | Store |
| Hono | HTTP |
| LogTape | Observability |
| Observability | Core |
| Permits | Core |
| Pino | Observability |
| Testing | CLI, Core, HTTP, MCP, Observability |
| Topography | Core |
| Warden | Core, Topography |

Use supported Bun workspace commands when adding these declarations. Do not compensate with package-specific Turbo dependency overrides. Existing publication ordering already includes development and peer relationships.

## Graph and cache checks

The current four-task census is 132 tasks across 33 workspaces, compared with the historical 120-task census across 30 workspaces. A fresh main snapshot on Turbo 2.8.20 provides the baseline. Upgrading that snapshot with supported Bun commands but without the mirrors removes 51 task edges across 33 task lists. The candidate with mirrors restores exactly the baseline dependency lists. The [Testing graph regression](../../packages/testing/src/__tests__/workspace-task-graph.test.ts) invokes the actual installed Turbo and rejects workspace or lock-parser fallback diagnostics.

Qualification uses an empty owned local cache for actual build, typecheck, and test execution, then repeats the command against that cache. Source witnesses in CLI, HTTP, and MCP must invalidate Testing's build, typecheck, and test tasks. A witness in the existing global `oxlint.config.ts` input must invalidate the full selected closure. Each witness is restored byte-for-byte with its mode preserved before the next scenario. The test-cache setting remains enabled; the separate cache-policy and install-topology decisions are outside this change.

The full three-task run passed all 99 tasks with zero cold hits. Its first warm run passed all 99 with 95 hits: Adapter Kit, Library, Warden, and operator tests reran because their existing broad root input globs admitted newly generated cross-workspace `tsconfig.tsbuildinfo` files. The native 2.8.20 and 2.11.10 controls both included the same 25 incremental files in the operator input set. This qualification records that existing input behavior without changing cache policy or exclusions.

The selected 18-task Testing/provider closure returned 18 warm hits after source restoration. Each CLI, HTTP, and MCP source witness produced misses for the provider's and Testing's build, typecheck, and test tasks, with 12 other hits. The global witness produced 18 misses. In the fresh unfixed control, the CLI's three tasks missed while Testing's three tasks retained their previous hashes and hit the cache; the development declarations correct that stale-cache behavior.

The complete optional Testing test-source TypeScript configuration still reports 42 diagnostics, byte-identical to the fresh baseline after normalizing root paths. None names the new graph regression. A scoped TypeScript program for that file using the inherited test compiler options has zero diagnostics. All production typechecks passed in the 99-task run; the broader optional test-source configuration is not claimed green.

## Bun v2 control

A fresh disposable two-workspace fixture uses Bun's generated version-2 lock, a catalog-resolved Turbo, and an optional peer with its development declaration. Qualification resolves the installed native Turbo binary before running it, with no missing-binary repair. The graph must parse without fallback. Actual build, TypeScript, and Bun test tasks produce six cold misses, six warm hits, and six misses after a provider source change. Replacing a cached output symlink with a stale target proves that a warm cache hit restores the original target. The fixture uses the repository's real ignore patterns so generated logs and outputs cannot become new inputs.

This control establishes parser and cache compatibility for a real Bun-generated v2 lock. It does not migrate the repository lock or complete [TRL-1307](https://linear.app/outfitter/issue/TRL-1307).

## Packed consumer and release intent

Run `bun run publish:check` and inspect actual Core, Observability, and Testing tarballs. Packed workspace/catalog dependency ranges must be rewritten in every dependency section; Testing's optional peer flags must match its source manifest. Its development-only Store and Drizzle ranges must also be rewritten. Install only those three local tarballs and the locked Zod version into a new consumer. Root imports and `testAll` must work while CLI, HTTP, MCP, Store, and Drizzle remain unresolvable, and installed packages must resolve inside the consumer rather than back into the source workspace.

This upper layer is development dependency metadata, root tooling, a regression test, and contributor teaching: `release:none`. The published Adapter Kit behavior fix and patch changeset landed separately. Check upper release intent against that actual main base with an explicit no-release reason; do not combine an override with a changed changeset. There is no new trail, schema, surface exposure, generated Trails lock, agent rule, or migration command, so changesets, Skillset/Warden regeneration, Wayfinder dogfood, and lock round-trip are not applicable to this layer. The existing [peer and development input guidance](./code-standards.md#workspace-peers-and-development-inputs) teaches the declaration rule.
