import type {
  WardenFixClass,
  WardenFixSafety,
  WardenRule,
  WardenRuleConcern,
  WardenRuleLifecycleState,
  WardenRuleMetadata,
  WardenRuleScope,
  WardenRuleTier,
} from './types.js';

export const wardenRuleTiers = [
  'source-static',
  'project-static',
  'topo-aware',
  'drift',
  'advisory',
] as const satisfies readonly WardenRuleTier[];

export const wardenRuleScopes = [
  'external',
  'extension',
  'internal',
  'repo-local',
  'temporary',
  'advisory',
] as const satisfies readonly WardenRuleScope[];

export const wardenRuleConcerns = [
  'composition',
  'general',
  'lifecycle',
  'meta',
  'permits',
  'resources',
  'results',
  'signals',
] as const satisfies readonly WardenRuleConcern[];

export const wardenRuleLifecycleStates = [
  'durable',
  'temporary',
  'deprecated',
] as const satisfies readonly WardenRuleLifecycleState[];

export const wardenFixClasses = [
  'term-rewrite',
] as const satisfies readonly WardenFixClass[];

export const wardenFixSafeties = [
  'review',
  'safe',
] as const satisfies readonly WardenFixSafety[];

type BuiltinWardenRuleMetadataInput = Omit<
  WardenRuleMetadata,
  'concern' | 'depth'
> &
  Partial<Pick<WardenRuleMetadata, 'concern' | 'depth'>>;

const depthByTier = {
  advisory: 'all',
  drift: 'all',
  'project-static': 'project',
  'source-static': 'source',
  'topo-aware': 'topo',
} as const satisfies Record<WardenRuleTier, WardenRuleMetadata['depth']>;

const concernByRuleName: Partial<Record<string, WardenRuleConcern>> = {
  'activation-orphan': 'signals',
  'cli-command-route-coherence': 'meta',
  'composes-declarations': 'composition',
  'context-no-surface-types': 'composition',
  'dead-internal-trail': 'composition',
  'dead-public-trail': 'composition',
  'deprecation-without-guidance': 'lifecycle',
  'draft-file-marking': 'lifecycle',
  'draft-visible-debt': 'lifecycle',
  'duplicate-exported-symbol': 'general',
  'duplicate-public-contract': 'meta',
  'error-mapping-completeness': 'results',
  'fires-declarations': 'signals',
  'fork-without-preserved-blaze': 'lifecycle',
  'governed-symbol-residue': 'lifecycle',
  'implementation-returns-result': 'results',
  'intent-propagation': 'composition',
  'library-projection-coherence': 'meta',
  'marker-schema-unsupported': 'lifecycle',
  'missing-reconcile': 'resources',
  'missing-visibility': 'composition',
  'no-destructured-compose': 'composition',
  'no-dev-permit-in-source': 'permits',
  'no-direct-implementation-call': 'composition',
  'no-native-error-result': 'results',
  'no-redundant-result-error-wrap': 'results',
  'no-retired-cross-vocabulary': 'composition',
  'no-sync-result-assumption': 'results',
  'no-throw-in-detour-recover': 'results',
  'no-throw-in-implementation': 'results',
  'on-references-exist': 'signals',
  'orphaned-signal': 'signals',
  'pending-force': 'lifecycle',
  'permit-governance': 'permits',
  'public-output-schema': 'results',
  'read-intent-fires': 'signals',
  'resolved-import-boundary': 'composition',
  'resource-declarations': 'resources',
  'resource-exists': 'resources',
  'resource-id-grammar': 'resources',
  'resource-mock-coverage': 'resources',
  'scheduled-destroy-intent': 'lifecycle',
  'signal-graph-coaching': 'signals',
  'static-resource-accessor-preference': 'resources',
  'surface-overlay-coherence': 'meta',
  'surface-trailhead-coherence': 'meta',
  'trail-fork-coaching': 'meta',
  'unmaterialized-activation-source': 'lifecycle',
  'valid-detour-contract': 'results',
  'version-gap': 'lifecycle',
  'version-pinned-compose': 'composition',
  'version-without-examples': 'lifecycle',
  'webhook-route-collision': 'composition',
};

const durableExternal = {
  lifecycle: { state: 'durable' },
  scope: 'external',
} as const;

const durableExtension = {
  lifecycle: { state: 'durable' },
  scope: 'extension',
} as const;

const durableRepoLocal = {
  lifecycle: { state: 'durable' },
  scope: 'repo-local',
} as const;

const trailContractDocs = {
  label: 'Trail Rules',
  path: 'AGENTS.md#trail-rules',
} as const;

const wardenDocs = {
  label: 'Warden',
  path: 'docs/warden.md',
} as const;

const builtinWardenRuleMetadataInput = {
  'activation-orphan': {
    ...durableExternal,
    invariant:
      'Signal activation consumers reference sources with producer declarations.',
    tier: 'topo-aware',
  },
  'circular-refs': {
    ...durableExternal,
    invariant: 'Contour reference graphs must be acyclic.',
    tier: 'project-static',
  },
  'cli-command-route-coherence': {
    ...durableExternal,
    guidance: {
      docs: [
        {
          label: 'CLI command routes ADR',
          path: 'docs/adr/drafts/20260613-cli-command-routes.md',
        },
      ],
      relatedRules: ['webhook-route-collision'],
      summary:
        'Keep every CLI command route and alias normalized into one trail contract.',
    },
    invariant:
      'CLI command routes and aliases resolve to one coherent trail contract.',
    tier: 'topo-aware',
  },
  'composes-declarations': {
    ...durableExternal,
    invariant: 'Declared composes stay aligned with ctx.compose() usage.',
    tier: 'source-static',
  },
  'context-no-surface-types': {
    ...durableExternal,
    invariant: 'Trail logic stays surface-agnostic.',
    tier: 'source-static',
  },
  'contour-exists': {
    ...durableExternal,
    invariant: 'Declared contour references resolve to known contours.',
    tier: 'project-static',
  },
  'dead-internal-trail': {
    ...durableExternal,
    invariant: 'Internal trails should be reachable through declared composes.',
    tier: 'project-static',
  },
  'dead-public-trail': {
    ...durableExternal,
    guidance: {
      relatedRules: ['dead-internal-trail', 'duplicate-public-contract'],
      summary:
        'Anchor exported public trails in a topo, composition edge, or activation source.',
    },
    invariant:
      'Exported public trails are anchored in configured app topos, composition, or activation.',
    tier: 'project-static',
  },
  'deprecation-without-guidance': {
    ...durableExternal,
    invariant:
      'Deprecated trail version entries carry successor, migration, or note guidance.',
    tier: 'topo-aware',
  },
  'draft-file-marking': {
    ...durableExternal,
    invariant: 'Draft-authored state is visibly marked in filenames.',
    tier: 'source-static',
  },
  'draft-visible-debt': {
    ...durableExternal,
    invariant: 'Draft-authored IDs remain visible debt.',
    tier: 'source-static',
  },
  'duplicate-exported-symbol': {
    ...durableRepoLocal,
    guidance: {
      docs: [
        {
          label: 'Package ownership',
          path: 'docs/contributing/package-ownership.md',
        },
      ],
      relatedRules: [
        'resolved-import-boundary',
        'public-internal-deep-imports',
      ],
      summary:
        'Keep exported symbol ownership from drifting across first-party packages.',
    },
    invariant:
      'First-party packages should not define the same exported symbol name in parallel.',
    tier: 'project-static',
  },
  'duplicate-public-contract': {
    ...durableExternal,
    guidance: {
      docs: [
        {
          label: 'Surface accommodations',
          path: 'docs/surfaces/surface-accommodations.md',
        },
      ],
      relatedRules: ['cli-command-route-coherence', 'trail-fork-coaching'],
      summary:
        'Keep duplicate public contract facts from drifting into separate capabilities.',
    },
    invariant:
      'Public surface trails should not expose duplicate normalized contract facts.',
    tier: 'topo-aware',
  },
  'error-mapping-completeness': {
    ...durableExtension,
    invariant: 'Registered surface error mappers cover every error category.',
    tier: 'source-static',
  },
  'example-valid': {
    ...durableExternal,
    guidance: {
      docs: [trailContractDocs],
      steps: [
        'Update the example input, expected output, or schema so they describe the same contract.',
        'Run the package tests that exercise the affected trail examples.',
      ],
      summary: 'Keep trail examples synchronized with their authored schemas.',
    },
    invariant: 'Trail examples remain valid against their authored schema.',
    tier: 'source-static',
  },
  'fires-declarations': {
    ...durableExternal,
    invariant: 'Declared fires stay aligned with signal firing usage.',
    tier: 'source-static',
  },
  'fork-without-preserved-blaze': {
    ...durableExternal,
    invariant: 'Fork version entries preserve their historical blaze.',
    tier: 'source-static',
  },
  'governed-symbol-residue': {
    ...durableExternal,
    fix: { class: 'term-rewrite', safety: 'safe' },
    invariant:
      'Active governed vocabulary symbol renames do not leave retired identifiers in source.',
    tier: 'source-static',
  },
  'implementation-returns-result': {
    ...durableExternal,
    invariant: 'Blazes return Result values.',
    tier: 'source-static',
  },
  'incomplete-accessor-for-standard-op': {
    ...durableExternal,
    invariant: 'Standard CRUD operations expose the expected accessor shape.',
    tier: 'topo-aware',
  },
  'incomplete-crud': {
    ...durableExternal,
    invariant: 'Versioned CRUD entities expose complete operation coverage.',
    tier: 'project-static',
  },
  'intent-propagation': {
    ...durableExternal,
    invariant: 'Composite trail intent cannot be safer than composed trails.',
    tier: 'project-static',
  },
  'layer-field-name-drift': {
    ...durableExternal,
    invariant:
      'Layer input field reserved names are shared across surface projections.',
    tier: 'source-static',
  },
  'library-projection-coherence': {
    ...durableExternal,
    guidance: {
      docs: [
        {
          label: 'Library Surface ADR',
          path: 'docs/adr/drafts/20260612-library-surface-and-compiler.md',
        },
      ],
      relatedRules: [
        'cli-command-route-coherence',
        'surface-trailhead-coherence',
      ],
      steps: [
        'Rename one source trail or add an explicit library export override before generating a package.',
        'Keep serialized library projection exports attached to existing trail IDs.',
        'Run the generated-package smoke after repairing projection drift.',
      ],
      summary:
        'Keep resolved library projection exports collision-free and attached to one trail contract.',
    },
    invariant:
      'Resolved library projection exports are collision-free and target existing trails.',
    tier: 'topo-aware',
  },
  'marker-schema-unsupported': {
    ...durableExternal,
    invariant:
      'Versioned schemas stay inside the supported marker projection subset.',
    tier: 'source-static',
  },
  'missing-reconcile': {
    ...durableExternal,
    invariant: 'Versioned CRUD store tables provide reconcile coverage.',
    tier: 'project-static',
  },
  'missing-visibility': {
    ...durableExternal,
    invariant: 'Composition-only trails declare internal visibility.',
    tier: 'project-static',
  },
  'no-destructured-compose': {
    ...durableExternal,
    invariant:
      'Trail blazes compose through ctx.compose() directly instead of destructuring compose from the context.',
    tier: 'source-static',
  },
  'no-dev-permit-in-source': {
    ...durableExternal,
    invariant:
      'The `--dev-permit` CLI flag string never appears in committed source.',
    tier: 'source-static',
  },
  'no-direct-implementation-call': {
    ...durableExternal,
    invariant: 'Application code composes trails through ctx.compose().',
    tier: 'source-static',
  },
  'no-legacy-layer-imports': {
    fix: { class: 'term-rewrite', safety: 'review' },
    invariant:
      'Legacy layer exports removed across TRL-475/TRL-476 (authLayer, autoIterateLayer, dateShortcutsLayer) do not reappear in committed source.',
    lifecycle: {
      retireWhen:
        'Layer Evolution legacy layer migration window closes (one minor release after the legacy exports are removed).',
      state: 'temporary',
    },
    scope: 'external',
    tier: 'source-static',
  },
  'no-native-error-result': {
    ...durableExternal,
    invariant: 'Result error boundaries carry specific TrailsError subclasses.',
    tier: 'source-static',
  },
  'no-redundant-result-error-wrap': {
    ...durableExternal,
    invariant:
      'Result error pass-throughs preserve the original Result boundary.',
    tier: 'source-static',
  },
  'no-retired-cross-vocabulary': {
    fix: { class: 'term-rewrite', safety: 'safe' },
    invariant:
      'Retired cross composition vocabulary does not remain in downstream source after the beta.19 compose cutover.',
    lifecycle: {
      retireWhen:
        'Downstream beta.19 cross-to-compose migration window closes and supported apps have adopted compose vocabulary.',
      state: 'temporary',
    },
    scope: 'external',
    tier: 'source-static',
  },
  'no-sync-result-assumption': {
    ...durableExternal,
    invariant:
      'Result accessors are not used before async results are awaited.',
    tier: 'source-static',
  },
  'no-throw-in-detour-recover': {
    ...durableExternal,
    invariant: 'Detour recovery returns Result instead of throwing.',
    tier: 'source-static',
  },
  'no-throw-in-implementation': {
    ...durableExternal,
    guidance: {
      docs: [trailContractDocs],
      relatedRules: ['implementation-returns-result', 'no-native-error-result'],
      steps: [
        'Return Result.err() with the most specific TrailsError subclass available.',
        'Use detours for recoverable runtime strategies instead of throwing inside the blaze.',
      ],
      summary:
        'Convert thrown failures in blazes into explicit Result.err() outcomes.',
    },
    invariant: 'Blazes return Result.err() instead of throwing.',
    tier: 'source-static',
  },
  'no-top-level-surface': {
    ...durableExternal,
    guidance: {
      docs: [{ label: 'Architecture', path: 'docs/architecture.md' }],
      relatedRules: ['context-no-surface-types'],
      steps: [
        'Keep the topo-export module focused on exporting `topo(...)` as `default`, `graph`, or `app`.',
        'Move `surface(...)`, `connectStdio(...)`, server start, or `.listen(...)` calls into a separate entry or bin module.',
      ],
      summary:
        'Keep topo entry modules side-effect-free for survey, guide, compile, and lock generation.',
    },
    invariant: 'Topo export modules do not open surfaces at module top level.',
    tier: 'source-static',
  },
  'on-references-exist': {
    ...durableExternal,
    invariant: 'Trail on: declarations resolve to known signals.',
    tier: 'project-static',
  },
  'orphaned-signal': {
    ...durableExternal,
    invariant:
      'Derived store signals are consumed by matching trail on: consumers.',
    tier: 'project-static',
  },
  'owner-projection-parity': {
    invariant: 'Framework projections stay aligned with owner exports.',
    lifecycle: { state: 'durable' },
    scope: 'internal',
    tier: 'source-static',
  },
  'pending-force': {
    ...durableExternal,
    invariant:
      'Forced topo break audit events do not remain pending indefinitely.',
    tier: 'topo-aware',
  },
  'permit-governance': {
    ...durableExternal,
    guidance: {
      docs: [
        trailContractDocs,
        { label: 'Permits', path: 'packages/permits/README.md' },
      ],
      steps: [
        'Declare the permit required for the destructive trail.',
        'If the write is intentionally development-only, keep the dev permit out of committed runtime source.',
      ],
      summary:
        'Make destructive trail authorization visible on the trail contract.',
    },
    invariant: 'Destroy trails declare explicit permit requirements.',
    tier: 'topo-aware',
  },
  'prefer-schema-inference': {
    guidance: {
      docs: [trailContractDocs],
      steps: [
        'Remove field overrides that only repeat labels or enum options already inferable from the schema.',
        'Keep field metadata only when it adds meaning the schema cannot derive.',
      ],
      summary:
        'Let schemas remain the owner for field metadata unless an override adds new information.',
    },
    invariant: 'Trail schemas should be inferred unless overrides add meaning.',
    lifecycle: { state: 'durable' },
    scope: 'advisory',
    tier: 'source-static',
  },
  'public-export-example-coverage': {
    ...durableRepoLocal,
    invariant:
      'Public API barrel exports carry leading @example TSDoc coverage.',
    tier: 'source-static',
  },
  'public-internal-deep-imports': {
    invariant: 'Cross-package imports stay on package-owned public exports.',
    lifecycle: { state: 'durable' },
    scope: 'internal',
    tier: 'project-static',
  },
  'public-output-schema': {
    ...durableExternal,
    guidance: {
      docs: [trailContractDocs, wardenDocs],
      relatedRules: ['public-union-output-discriminants'],
      steps: [
        'Add an explicit output schema to public trails that can be projected onto MCP or HTTP surfaces.',
        'If the trail is composition-only, mark it visibility: "internal" instead of exposing it by default.',
      ],
      summary:
        'Make public surface result contracts explicit before MCP/HTTP projection.',
    },
    invariant: 'Public MCP/HTTP surface trails declare output schemas.',
    tier: 'topo-aware',
  },
  'public-union-output-discriminants': {
    ...durableExternal,
    invariant: 'Public output object unions expose branch discriminants.',
    tier: 'topo-aware',
  },
  'read-intent-fires': {
    ...durableExternal,
    invariant: 'Read trails should not declare signal fires side effects.',
    tier: 'source-static',
  },
  'reference-exists': {
    ...durableExternal,
    invariant: 'Reference declarations resolve to known contours.',
    tier: 'project-static',
  },
  'resolved-import-boundary': {
    ...durableExternal,
    invariant: 'Cross-package imports resolve through public export maps.',
    tier: 'project-static',
  },
  'resource-declarations': {
    ...durableExternal,
    guidance: {
      docs: [trailContractDocs],
      relatedRules: ['resource-exists'],
      steps: [
        'Declare each external dependency in the trail resources array.',
        'Access statically known resources through the resource definition helper rather than constructing dependencies inline.',
      ],
      summary:
        'Keep infrastructure dependencies declared on the trail contract.',
    },
    invariant: 'Resource usage is declared on the trail contract.',
    tier: 'source-static',
  },
  'resource-exists': {
    ...durableExternal,
    guidance: {
      docs: [trailContractDocs, wardenDocs],
      relatedRules: ['resource-declarations'],
      steps: [
        'Define the referenced resource in project source or import the existing resource definition.',
        'When a resource is testable, include a mock factory so contract tests can run without real infrastructure.',
      ],
      summary:
        'Make declared resources resolve to authored resource definitions.',
    },
    invariant: 'Declared resources resolve to known resource definitions.',
    tier: 'project-static',
  },
  'resource-id-grammar': {
    ...durableExternal,
    invariant: 'Resource identifiers stay out of the scope separator grammar.',
    tier: 'source-static',
  },
  'resource-mock-coverage': {
    ...durableExternal,
    guidance: {
      docs: [trailContractDocs],
      relatedRules: ['resource-declarations', 'resource-exists'],
      steps: [
        'Add a mock() factory so testAll(app) can provision the resource without production configuration.',
        'If the resource genuinely cannot be mocked, declare unmockable: { reason } to record that intent.',
      ],
      summary:
        'Make each resource declare a test mock or an explicit unmockable reason.',
    },
    invariant:
      'Resource definitions declare a mock factory or an explicit unmockable reason.',
    tier: 'source-static',
  },
  'scheduled-destroy-intent': {
    ...durableExternal,
    invariant:
      'Schedule-activated destroy trails make unattended destructive work visible for review.',
    tier: 'topo-aware',
  },
  'signal-graph-coaching': {
    ...durableExternal,
    invariant:
      'Typed signal contracts either declare a producer or participate in reactive consumption.',
    tier: 'topo-aware',
  },
  'static-resource-accessor-preference': {
    ...durableExternal,
    guidance: {
      docs: [trailContractDocs],
      relatedRules: ['resource-declarations', 'resource-exists'],
      steps: [
        'Replace ctx.resource(db) or ctx.resource("id") with db.from(ctx) when the resource definition is statically in scope.',
        'Move external client construction behind resource() and declare that resource on the trail contract.',
        'Keep ctx.resource(...) for dynamic IDs, generic framework code, or cases where the definition is not statically available.',
      ],
      summary:
        'Use statically scoped resource helpers when the resource definition is already available.',
    },
    invariant:
      'Trail logic should prefer static resource helpers over dynamic accessors.',
    scope: 'advisory',
    tier: 'source-static',
  },
  'surface-overlay-coherence': {
    ...durableExternal,
    guidance: {
      relatedRules: [
        'cli-command-route-coherence',
        'surface-trailhead-coherence',
      ],
      steps: [
        'Point every binding selector at an existing trail id or dotted trail-id glob.',
        'Narrow overlapping grouped bindings so each trail has one grouped owner per surface.',
        'Rename bindings that shadow canonical CLI command paths or derived MCP tool names.',
      ],
      summary:
        'Keep surface overlay bindings pointed at real trails without shadowing canonical surface entries.',
    },
    invariant:
      'Surface overlay bindings resolve to real trails without group overlap or canonical-entry shadowing.',
    tier: 'topo-aware',
  },
  'surface-trailhead-coherence': {
    ...durableExternal,
    guidance: {
      docs: [
        {
          label: 'Trailheads ADR',
          path: 'docs/adr/drafts/20260603-surface-trailheads-shape-dense-topos.md',
        },
      ],
      steps: [
        'Keep trailhead selectors as explicit string literals or literal arrays when possible.',
        'Ensure each public trail belongs to one trailhead owner.',
        'Record explicit visibility-widening acceptance and stable-description metadata when a trailhead intentionally widens visibility.',
      ],
      summary:
        'Keep trailhead maps reviewable before they reach MCP projection.',
    },
    invariant:
      'Trailhead maps avoid selector overlap, hidden visibility widening, and drift-prone dynamic selectors.',
    tier: 'source-static',
  },
  'trail-fork-coaching': {
    ...durableExternal,
    guidance: {
      docs: [
        {
          label: 'ADR-0050 Surface Accommodations',
          path: 'docs/adr/0050-surface-accommodations-preserve-trail-identity.md',
        },
        {
          label: 'Surface Accommodations',
          path: 'docs/surfaces/surface-accommodations.md',
        },
      ],
      relatedRules: [
        'surface-trailhead-coherence',
        'cli-command-route-coherence',
      ],
      steps: [
        'Check the semantic fork boundary: intent, permits, outputs, errors, lifecycle, and side effects.',
        'Check the structural fork boundary: selected trail identity stays visible instead of hiding behind action vocabulary.',
        'Split real capability forks into distinct trails or a composing trail.',
        'Use a trailhead only when one surface entry needs to group multiple trails while preserving selected member identity.',
      ],
      summary:
        'Keep surface accommodations from hiding several capabilities behind one branching trail input.',
    },
    invariant:
      'Trails avoid hiding distinct capabilities behind branching action or operation inputs.',
    scope: 'advisory',
    tier: 'source-static',
  },
  'unmaterialized-activation-source': {
    ...durableExternal,
    invariant:
      'Activation sources have an available runtime materializer before runtime delivery is assumed.',
    tier: 'topo-aware',
  },
  'unreachable-detour-shadowing': {
    ...durableExternal,
    invariant: 'Specific detours are not shadowed by earlier broader detours.',
    tier: 'source-static',
  },
  'valid-describe-refs': {
    invariant: 'Describe references point at known Trails concepts.',
    lifecycle: { state: 'durable' },
    scope: 'advisory',
    tier: 'project-static',
  },
  'valid-detour-contract': {
    ...durableExternal,
    invariant:
      'Runtime detour contracts use error constructors and recover functions.',
    tier: 'topo-aware',
  },
  'version-gap': {
    ...durableExternal,
    invariant:
      'Trail version coverage remains contiguous through the current version.',
    tier: 'topo-aware',
  },
  'version-pinned-compose': {
    ...durableExternal,
    invariant:
      'Version-pinned ctx.compose() calls stay visible migration debt.',
    tier: 'source-static',
  },
  'version-without-examples': {
    ...durableExternal,
    invariant: 'Live historical version entries include examples.',
    tier: 'topo-aware',
  },
  'warden-export-symmetry': {
    ...durableRepoLocal,
    invariant: 'The Warden package exports trail wrappers, not raw rules.',
    tier: 'source-static',
  },
  'warden-rules-use-ast': {
    ...durableRepoLocal,
    invariant:
      'Warden source rules use AST helpers instead of ad hoc parsing or raw node-field casts.',
    tier: 'source-static',
  },
  'webhook-route-collision': {
    ...durableExternal,
    invariant:
      'Webhook routes do not collide with each other or direct HTTP trail routes.',
    tier: 'topo-aware',
  },
} as const satisfies Record<string, BuiltinWardenRuleMetadataInput>;

export type BuiltinWardenRuleName = keyof typeof builtinWardenRuleMetadataInput;

const withRuleDefaults = (
  name: string,
  metadata: BuiltinWardenRuleMetadataInput
): WardenRuleMetadata => ({
  concern: concernByRuleName[name] ?? 'general',
  depth: metadata.scope === 'advisory' ? 'all' : depthByTier[metadata.tier],
  ...metadata,
});

export const builtinWardenRuleMetadata = Object.fromEntries(
  Object.entries(builtinWardenRuleMetadataInput).map(([name, metadata]) => [
    name,
    withRuleDefaults(name, metadata),
  ])
) as Readonly<Record<BuiltinWardenRuleName, WardenRuleMetadata>>;

const metadataByName: Readonly<Record<string, WardenRuleMetadata>> =
  builtinWardenRuleMetadata;

export const getWardenRuleMetadata = (
  rule: Pick<WardenRule, 'metadata' | 'name'> | string
): WardenRuleMetadata | null => {
  if (typeof rule !== 'string' && rule.metadata) {
    return rule.metadata;
  }

  const name = typeof rule === 'string' ? rule : rule.name;
  return metadataByName[name] ?? null;
};

export const listWardenRuleMetadata = (): readonly (readonly [
  BuiltinWardenRuleName,
  WardenRuleMetadata,
])[] =>
  Object.entries(builtinWardenRuleMetadata) as readonly (readonly [
    BuiltinWardenRuleName,
    WardenRuleMetadata,
  ])[];
