export interface VocabAuditAllowedMatch {
  readonly line: number;
  readonly path: string;
}

export interface VocabAuditRule {
  readonly id: string;
  readonly allowMatches?: readonly VocabAuditAllowedMatch[];
  readonly description: string;
  readonly excludePaths?: readonly string[];
  readonly pattern: string;
}

export const auditRoots = [
  'AGENTS.md',
  'README.md',
  'apps/',
  'docs/',
  'packages/',
  'plugin/',
  'scripts/',
] as const;

const scriptSelfExclusions = [
  'scripts/vocab-cutover-audit.ts',
  'scripts/vocab-cutover-map.ts',
  'scripts/vocab-cutover-rewrite.ts',
  'scripts/vocab-cutover-utils.ts',
] as const;

const changelogHistoryPaths = [
  'adapters/commander/CHANGELOG.md',
  'adapters/drizzle/CHANGELOG.md',
  'adapters/hono/CHANGELOG.md',
  'adapters/vite/CHANGELOG.md',
  'apps/trails-demo/CHANGELOG.md',
  'apps/trails/CHANGELOG.md',
  'packages/cli/CHANGELOG.md',
  'packages/config/CHANGELOG.md',
  'packages/core/CHANGELOG.md',
  'packages/http/CHANGELOG.md',
  'packages/logtape/CHANGELOG.md',
  'packages/logging/CHANGELOG.md',
  'packages/mcp/CHANGELOG.md',
  'packages/observe/CHANGELOG.md',
  'packages/oxlint-plugin/CHANGELOG.md',
  'packages/permits/CHANGELOG.md',
  'packages/store/CHANGELOG.md',
  'packages/testing/CHANGELOG.md',
  'packages/topographer/CHANGELOG.md',
  'packages/tracing/CHANGELOG.md',
  'packages/warden/CHANGELOG.md',
  'packages/wayfinder/CHANGELOG.md',
] as const;

const adrReviewedMentionPaths = [
  'docs/adr/0001-naming-conventions.md',
  'docs/adr/0004-intent-as-first-class-property.md',
  'docs/adr/0005-framework-agnostic-http-route-model.md',
  'docs/adr/0006-shared-execution-pipeline.md',
  'docs/adr/0007-governance-as-trails.md',
  'docs/adr/0008-deterministic-trailhead-derivation.md',
  'docs/adr/0009-first-class-resources.md',
  'docs/adr/0011-schema-driven-config.md',
  'docs/adr/0013-tracing.md',
  'docs/adr/0014-core-database-primitive.md',
  'docs/adr/0015-topo-store.md',
  'docs/adr/0016-schema-derived-persistence.md',
  'docs/adr/0017-serialized-topo-graph.md',
  'docs/adr/0018-signal-driven-governance.md',
  'docs/adr/0019-hierarchical-command-trees-from-trail-ids.md',
  'docs/adr/0020-flags-for-fields-structured-input-on-the-cli.md',
  'docs/adr/0023-simplifying-the-trails-lexicon.md',
  'docs/adr/0027-visibility-and-filtering.md',
  'docs/adr/0029-connector-extraction-and-the-with-packaging-model.md',
  'docs/adr/0035-surface-apis-render-the-graph.md',
  'docs/adr/0038-typed-signal-emission.md',
  'docs/adr/0041-unified-observability.md',
  'docs/adr/0043-layer-evolution.md',
  'docs/adr/0044-trail-versioning.md',
  'docs/adr/README.md',
  'docs/adr/decision-map.json',
  'docs/adr/drafts/20260331-direct-invocation.md',
  'docs/adr/drafts/20260331-external-trailheads-as-trails.md',
  'docs/adr/drafts/20260331-pack-resources.md',
  'docs/adr/drafts/20260331-packs-namespace-boundaries.md',
  'docs/adr/drafts/20260331-websocket-trailhead.md',
  'docs/adr/drafts/20260401-compiled-pack-trailhead.md',
  'docs/adr/drafts/20260401-declarative-search.md',
  'docs/adr/drafts/20260406-documentation-structure.md',
  'docs/adr/drafts/20260409-trail-versioning.md',
  'docs/adr/drafts/20260503-wayfinding.md',
  'docs/adr/drafts/README.md',
  'docs/adr/drafts/decision-map.json',
] as const;

const historicalMentionPaths = [
  ...changelogHistoryPaths,
  ...adrReviewedMentionPaths,
  'docs/migration',
  'docs/releases',
] as const;

const reviewedSurfaceMentionPaths = [
  ...historicalMentionPaths,
  'docs/api-reference.md',
  'docs/index.md',
  'docs/lexicon.md',
  'packages/http/README.md',
  'packages/oxlint-plugin/src/__tests__/rules.test.ts',
  'packages/store/.agents',
  'packages/store/src/__tests__/sync-reconcile.test.ts',
  'packages/topographer/src/__tests__/topo-store.test.ts',
  'scripts/rename-audit.sh',
] as const;

const surfaceTermAllowedMatches = [
  {
    line: 266,
    path: 'docs/adr/0048-trail-versioning-v3.md',
  },
  {
    line: 278,
    path: 'docs/adr/drafts/20260613-cli-command-routes.md',
  },
  {
    line: 279,
    path: 'docs/adr/drafts/20260613-cli-command-routes.md',
  },
  {
    line: 287,
    path: 'docs/adr/drafts/20260613-cli-command-routes.md',
  },
] as const;

const reviewedRetiredTaxonomyMentionPaths = [
  ...changelogHistoryPaths,
  'docs/adr',
  'docs/index.md',
  'docs/lexicon.md',
  'docs/migration',
  'docs/releases',
  'packages/oxlint-plugin/src/__tests__/rules.test.ts',
  'plugin/rules/lexicon.md',
] as const;

const legacyExtractedAdapterSubpathMentionPaths = [
  ...historicalMentionPaths,
  'adapters/commander/README.md',
  'adapters/drizzle/README.md',
  'adapters/hono/README.md',
  'docs/adr/0022-drizzle-store-connector.md',
  'packages/http/README.md',
  'packages/store/README.md',
] as const;

const topographArtifactFamilyRetiredMentionPaths = [
  ...historicalMentionPaths,
  'docs/adr/0042-core-topographer-boundary-doctrine.md',
  'docs/adr/0046-lock-v3-artifact-family.md',
  'docs/lexicon.md',
] as const;

const legacyBootstrapCleanupMatches = [
  { line: 71, path: 'scripts/bootstrap/config.toml' },
  { line: 72, path: 'scripts/bootstrap/config.toml' },
  { line: 73, path: 'scripts/bootstrap/config.toml' },
  { line: 74, path: 'scripts/bootstrap/config.toml' },
  { line: 75, path: 'scripts/bootstrap/config.toml' },
  { line: 76, path: 'scripts/bootstrap/config.toml' },
  { line: 77, path: 'scripts/bootstrap/config.toml' },
  { line: 78, path: 'scripts/bootstrap/config.toml' },
  { line: 79, path: 'scripts/bootstrap/config.toml' },
  { line: 80, path: 'scripts/bootstrap/config.toml' },
  { line: 81, path: 'scripts/bootstrap/config.toml' },
  { line: 82, path: 'scripts/bootstrap/config.toml' },
] as const;

const topographArtifactFamilyRetiredMatches = [
  ...legacyBootstrapCleanupMatches,
  // Legacy root DB and dev-state sidecars are still removed by dev.reset/dev.clean
  // so upgraded workspaces do not leave stale local files behind.
  { line: 265, path: 'apps/trails/src/trails/dev-support.ts' },
  { line: 266, path: 'apps/trails/src/trails/dev-support.ts' },
  { line: 267, path: 'apps/trails/src/trails/dev-support.ts' },
  { line: 268, path: 'apps/trails/src/trails/dev-support.ts' },
  { line: 269, path: 'apps/trails/src/trails/dev-support.ts' },
  { line: 270, path: 'apps/trails/src/trails/dev-support.ts' },
  // The topo-store migration and fixture must name pre-v12 columns exactly.
  {
    line: 345,
    path: 'packages/topographer/src/internal/topo-snapshots.ts',
  },
  {
    line: 355,
    path: 'packages/topographer/src/internal/topo-snapshots.ts',
  },
  {
    line: 1423,
    path: 'packages/topographer/src/__tests__/topo-store.test.ts',
  },
  {
    line: 1425,
    path: 'packages/topographer/src/__tests__/topo-store.test.ts',
  },
  {
    line: 1439,
    path: 'packages/topographer/src/__tests__/topo-store.test.ts',
  },
  {
    line: 1441,
    path: 'packages/topographer/src/__tests__/topo-store.test.ts',
  },
] as const;

export const auditRules: readonly VocabAuditRule[] = [
  {
    description:
      'Old trail implementation field still uses run: arrow/function bodies instead of blaze:',
    excludePaths: [
      'apps/trails/src/__tests__/run-watch-compose.test.ts',
      'apps/trails/src/run-watch.ts',
      'adapters/commander/src/__tests__/to-commander.test.ts',
      'packages/store/src/__tests__/jsonfile.test.ts',
      'packages/store/src/testing.ts',
      'packages/testing/src/harness-cli.ts',
      'packages/topographer/src/__tests__/topo-store.test.ts',
      'packages/topographer/src/topo-store.ts',
      'packages/tracing/src/internal/dev-state.ts',
    ],
    id: 'run-field',
    pattern: String.raw`\brun\s*:\s*(?:(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|function\s*\()`,
  },
  {
    description: 'Old direct execution helper still uses dispatch(...)',
    excludePaths: historicalMentionPaths,
    id: 'dispatch-call',
    pattern: String.raw`\bdispatch\(`,
  },
  {
    description: 'Old composition declaration still uses follow: [...]',
    excludePaths: historicalMentionPaths,
    id: 'composes-field',
    pattern: String.raw`\bfollow\s*:`,
  },
  {
    description: 'Old composition runtime still uses ctx.follow(...)',
    excludePaths: historicalMentionPaths,
    id: 'compose-call',
    pattern: String.raw`\bctx\.follow\(`,
  },
  {
    description:
      'Old infrastructure primitive still uses service(...) instead of resource(...)',
    id: 'service-factory',
    pattern: String.raw`\bservice\(`,
  },
  {
    description:
      'Old infrastructure declarations still use services: [...] instead of resources: [...]',
    excludePaths: historicalMentionPaths,
    id: 'services-field',
    pattern: String.raw`\bservices\s*:`,
  },
  {
    description:
      'Old notification primitive still uses event(...) instead of signal(...)',
    excludePaths: ['packages/warden/src/__tests__/valid-describe-refs.test.ts'],
    id: 'event-factory',
    pattern: String.raw`\bevent\(`,
  },
  {
    description:
      'Old notification runtime still uses ctx.emit(...) instead of ctx.fire(...)',
    excludePaths: historicalMentionPaths,
    id: 'emit-call',
    pattern: String.raw`\bctx\.emit\(`,
  },
  {
    // The noun is "signal"; the declaration field is `fires: [...]` (verb-form,
    // matching the runtime call `ctx.fire(...)`). Map rewrites the old
    // `emits: [...]` field name to the current `fires: [...]` field name.
    description:
      'Old notification declarations still use emits: [...] instead of fires: [...]',
    excludePaths: historicalMentionPaths,
    id: 'emits-field',
    pattern: String.raw`\bemits\s*:`,
  },
  {
    description:
      'Old activation syntax still uses trigger(...) instead of fires: [...]',
    excludePaths: ['packages/core/src/__tests__/schedule-runtime.test.ts'],
    id: 'trigger-call',
    pattern: String.raw`\btrigger\(`,
  },
  {
    description:
      'Semantic split from legacy consumer-side `fires:` to current `on:` requires manual review; mechanical matching is disabled.',
    excludePaths: ['docs/adr/drafts/20260401-entity-trail-factories.md'],
    id: 'on-field',
    pattern: String.raw`(?!)`,
  },
  {
    description:
      'Old domain factory still uses entity(...) instead of contour(...)',
    id: 'entity-factory',
    pattern: String.raw`\bentity\(`,
  },
  {
    description:
      'Old trailhead entrypoint still imports or calls the top-level blaze helper',
    id: 'blaze-call',
    pattern: String.raw`from\s+['"][^'"]*/blaze(?:\.js)?['"]|\bimport\s*{[^}]*\bblaze\b[^}]*}|\bexport\s*{[^}]*\bblaze\b[^}]*}`,
  },
  {
    description: 'Old telemetry package name still references crumbs',
    excludePaths: historicalMentionPaths,
    id: 'crumbs-term',
    pattern: String.raw`\bcrumbs\b|@ontrails/crumbs`,
  },
  {
    description: 'Old wrapper primitive still uses Gate instead of Layer',
    excludePaths: historicalMentionPaths,
    id: 'layer-type',
    pattern: String.raw`\bGate\b(?!\s+\d)`,
  },
  {
    description:
      'Old wrapper collections still use gates or middleware instead of layers',
    excludePaths: [
      ...historicalMentionPaths,
      'AGENTS.md',
      'docs/architecture.md',
      'plugin/rules/lexicon.md',
      'plugin/rules/vocabulary.md',
    ],
    id: 'layers-term',
    pattern: String.raw`\bgates\b|\bmiddleware\b`,
  },
  {
    allowMatches: surfaceTermAllowedMatches,
    description:
      'Old boundary terminology still uses trailhead instead of surface',
    excludePaths: reviewedSurfaceMentionPaths,
    id: 'surface-term',
    pattern: String.raw`\b[Tt]railhead(s)?\b|TRAILHEAD_KEY|__trails_trailhead`,
  },
  {
    description:
      'Retired package-boundary terminology still uses connector instead of adapter.',
    excludePaths: reviewedRetiredTaxonomyMentionPaths,
    id: 'connector-term',
    pattern: String.raw`\b[Cc]onnector(s)?\b|[A-Za-z_$][\w$]*[Cc]onnector[A-Za-z_$\d]*|(?:^|/)connectors/`,
  },
  {
    description:
      'Legacy extracted adapter subpaths still appear outside history and migration notes.',
    excludePaths: legacyExtractedAdapterSubpathMentionPaths,
    id: 'legacy-extracted-adapter-subpath',
    pattern: String.raw`@ontrails/(?:http/hono|store/drizzle|cli/commander)`,
  },
  {
    allowMatches: topographArtifactFamilyRetiredMatches,
    description:
      'Retired TopoGraph artifact-family vocabulary still appears outside history, migration notes, and legacy cleanup seams.',
    excludePaths: topographArtifactFamilyRetiredMentionPaths,
    id: 'topograph-artifact-family-retired-term',
    pattern: String.raw`\bSurfaceMap(?:Entry)?\b|_surface\.json|\bsurface_map\b|\bserialized_lock\b|\.trails/config/local(?:\.[tj]s)?|\.trails/trails\.db(?:-(?:shm|wal))?|\.trails/dev/|\.trails/generated/`,
  },
  {
    description:
      'Abort propagation still uses TrailContext.signal instead of abortSignal',
    excludePaths: ['packages/core/src/__tests__/execute.test.ts'],
    id: 'abort-signal-field',
    pattern: String.raw`\bsignal\s*:\s*AbortSignal|readonly signal: AbortSignal`,
  },
] as const;

export const auditSelfExclusions = scriptSelfExclusions;
