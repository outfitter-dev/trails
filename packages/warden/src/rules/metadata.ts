import type {
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
  'composes-declarations': 'composition',
  'context-no-surface-types': 'composition',
  'dead-internal-trail': 'composition',
  'deprecation-without-guidance': 'lifecycle',
  'draft-file-marking': 'lifecycle',
  'draft-visible-debt': 'lifecycle',
  'error-mapping-completeness': 'results',
  'fires-declarations': 'signals',
  'fork-without-preserved-blaze': 'lifecycle',
  'implementation-returns-result': 'results',
  'intent-propagation': 'composition',
  'marker-schema-unsupported': 'lifecycle',
  'missing-reconcile': 'resources',
  'missing-visibility': 'composition',
  'no-destructured-compose': 'composition',
  'no-dev-permit-in-source': 'permits',
  'no-direct-implementation-call': 'composition',
  'no-native-error-result': 'results',
  'no-redundant-result-error-wrap': 'results',
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
  'scheduled-destroy-intent': 'lifecycle',
  'signal-graph-coaching': 'signals',
  'static-resource-accessor-preference': 'resources',
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
    invariant: 'Warden source rules use AST helpers instead of ad hoc parsing.',
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

const withFacetDefaults = (
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
    withFacetDefaults(name, metadata),
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
