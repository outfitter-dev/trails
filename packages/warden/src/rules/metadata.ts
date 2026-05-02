import type {
  WardenRule,
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

export const wardenRuleLifecycleStates = [
  'durable',
  'temporary',
  'deprecated',
] as const satisfies readonly WardenRuleLifecycleState[];

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

export const builtinWardenRuleMetadata = {
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
  'cross-declarations': {
    ...durableExternal,
    invariant: 'Declared crosses stay aligned with ctx.cross() usage.',
    tier: 'source-static',
  },
  'dead-internal-trail': {
    ...durableExternal,
    invariant: 'Internal trails should be reachable through declared crosses.',
    tier: 'project-static',
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
    invariant: 'Trail examples remain valid against their authored schema.',
    tier: 'source-static',
  },
  'fires-declarations': {
    ...durableExternal,
    invariant: 'Declared fires stay aligned with signal firing usage.',
    tier: 'source-static',
  },
  'implementation-returns-result': {
    ...durableExternal,
    invariant: 'Trail implementations return Result values.',
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
    invariant: 'Composite trail intent cannot be safer than crossed trails.',
    tier: 'project-static',
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
  'no-direct-implementation-call': {
    ...durableExternal,
    invariant: 'Application code composes trails through ctx.cross().',
    tier: 'source-static',
  },
  'no-native-error-result': {
    ...durableExternal,
    invariant: 'Result error boundaries carry specific TrailsError subclasses.',
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
    invariant: 'Trail implementations return Result.err() instead of throwing.',
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
  'permit-governance': {
    ...durableExternal,
    invariant: 'Destroy trails declare explicit permit requirements.',
    tier: 'topo-aware',
  },
  'prefer-schema-inference': {
    invariant: 'Trail schemas should be inferred unless overrides add meaning.',
    lifecycle: { state: 'durable' },
    scope: 'advisory',
    tier: 'source-static',
  },
  'public-internal-deep-imports': {
    invariant: 'Cross-package imports stay on package-owned public exports.',
    lifecycle: { state: 'durable' },
    scope: 'internal',
    tier: 'source-static',
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
  'resource-declarations': {
    ...durableExternal,
    invariant: 'Resource usage is declared on the trail contract.',
    tier: 'source-static',
  },
  'resource-exists': {
    ...durableExternal,
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
} as const satisfies Record<string, WardenRuleMetadata>;

export type BuiltinWardenRuleName = keyof typeof builtinWardenRuleMetadata;

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
