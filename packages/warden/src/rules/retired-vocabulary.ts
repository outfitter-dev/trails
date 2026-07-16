import { z } from 'zod';

export const governedVocabularyTransitionStatuses = [
  'planned',
  'active',
  'complete',
] as const;

const governedVocabularySingleTargetSchema = z.object({
  kind: z.literal('single'),
  to: z.string().min(1),
});

const governedVocabularyClassifiedTargetSchema = z.object({
  guidance: z.string().min(1),
  kind: z.literal('classified'),
  options: z
    .array(
      z.object({
        to: z.string().min(1),
        when: z.string().min(1),
      })
    )
    .min(1),
});

export const governedVocabularyTargetSchema = z.discriminatedUnion('kind', [
  governedVocabularySingleTargetSchema,
  governedVocabularyClassifiedTargetSchema,
]);

export const governedVocabularyPreserveRuleSchema = z.object({
  paths: z.array(z.string().min(1)).optional(),
  pattern: z.string().min(1),
  reason: z.string().min(1),
});

export const governedVocabularyScopeSchema = z.object({
  exclude: z.array(z.string().min(1)).optional(),
  extensions: z.array(z.string().min(1)).optional(),
  ignoredDirectories: z.array(z.string().min(1)).optional(),
  include: z.array(z.string().min(1)).optional(),
  policyClassified: z
    .array(
      z.object({
        disposition: z.enum(['explicit-preserve', 'historical-by-policy']),
        expectMatches: z.boolean().optional(),
        paths: z.array(z.string().min(1)).min(1),
        reason: z.string().min(1),
      })
    )
    .optional(),
  teachingSurfaces: z.array(z.string().min(1)).optional(),
});

export const governedVocabularySymbolRenameMatchModes = [
  'exact',
  'identifier-segment',
] as const;

export const governedVocabularySymbolRenameSchema = z.object({
  from: z.string().min(1),
  match: z.enum(governedVocabularySymbolRenameMatchModes).default('exact'),
  reviewDeclarationTypes: z.array(z.string().min(1)).default([]),
  safety: z.enum(['safe', 'review']).optional(),
  to: z.string().min(1),
});

export const governedVocabularyLiteralRenameSchema = z.object({
  from: z.string().min(1),
  match: z.enum(['exact', 'property-key', 'review']).optional(),
  moduleSpecifier: z
    .object({
      targetPackage: z.string().min(1),
    })
    .optional(),
  to: z.string().min(1),
});

export const governedVocabularyFileRenameSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const governedVocabularyProvenancePolicySchema = z.discriminatedUnion(
  'mode',
  [
    z.object({ mode: z.literal('regrade-history') }),
    z.object({
      mode: z.literal('legacy'),
      reason: z.string().min(1),
    }),
  ]
);

export const governedVocabularyHistoryProvenanceSchema = z
  .object({
    disposition: z.enum(['applied-clean', 'review-follow-up']),
    kind: z.literal('governed-vocabulary'),
    planContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    reviewPending: z.number().int().nonnegative(),
    safeApplied: z.number().int().nonnegative(),
    sourceHashAfter: z.string().regex(/^[0-9a-f]{64}$/),
    sourceHashBefore: z.string().regex(/^[0-9a-f]{64}$/),
    transitionId: z.string().min(1),
  })
  .strict();

export const governedVocabularyTransitionSchema = z.object({
  codeIdentifiers: z.array(z.string().min(1)).default([]),
  docs: z.object({
    guidance: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1),
  }),
  fileRenames: z.array(governedVocabularyFileRenameSchema).default([]),
  from: z.string().min(1),
  id: z.string().min(1),
  intent: z.string().min(1),
  kind: z.literal('vocabulary'),
  oldForms: z.array(z.string().min(1)).min(1),
  overrides: z.record(z.string().min(1), z.string().min(1)).default({}),
  preserve: z.array(governedVocabularyPreserveRuleSchema).default([]),
  provenance: governedVocabularyProvenancePolicySchema.default({
    mode: 'legacy',
    reason:
      'Transition completed before committed Regrade history provenance became enforceable.',
  }),
  reviewForms: z.array(z.string().min(1)).default([]),
  safeRewriteForms: z.record(z.string().min(1), z.string().min(1)).default({}),
  scope: governedVocabularyScopeSchema.optional(),
  status: z.enum(governedVocabularyTransitionStatuses),
  stringLiteralRenames: z
    .array(governedVocabularyLiteralRenameSchema)
    .default([]),
  symbolRenames: z.array(governedVocabularySymbolRenameSchema).default([]),
  target: governedVocabularyTargetSchema,
});

export const governedVocabularyRegistrySchema = z
  .array(governedVocabularyTransitionSchema)
  .superRefine((transitions, ctx) => {
    const seenIds = new Set<string>();
    const seenFrom = new Set<string>();

    for (const [index, transition] of transitions.entries()) {
      if (seenIds.has(transition.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate governed vocabulary transition id "${transition.id}".`,
          path: [index, 'id'],
        });
      }
      seenIds.add(transition.id);

      if (seenFrom.has(transition.from)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate governed vocabulary source "${transition.from}".`,
          path: [index, 'from'],
        });
      }
      seenFrom.add(transition.from);

      if (
        transition.status === 'planned' &&
        transition.provenance.mode !== 'regrade-history'
      ) {
        ctx.addIssue({
          code: 'custom',
          message:
            'Planned governed transitions must require committed Regrade history provenance.',
          path: [index, 'provenance'],
        });
      }
    }
  });

export type GovernedVocabularyPreserveRule = z.output<
  typeof governedVocabularyPreserveRuleSchema
>;
export type GovernedVocabularyScope = z.output<
  typeof governedVocabularyScopeSchema
>;
export type GovernedVocabularyTarget = z.output<
  typeof governedVocabularyTargetSchema
>;
export type GovernedVocabularySymbolRename = z.output<
  typeof governedVocabularySymbolRenameSchema
>;
export type GovernedVocabularyLiteralRename = z.output<
  typeof governedVocabularyLiteralRenameSchema
>;
export type GovernedVocabularyTransition = z.output<
  typeof governedVocabularyTransitionSchema
>;
export type GovernedVocabularyHistoryProvenance = z.output<
  typeof governedVocabularyHistoryProvenanceSchema
>;
export type GovernedVocabularyProvenancePolicy = z.output<
  typeof governedVocabularyProvenancePolicySchema
>;
export type GovernedVocabularyTransitionInput = z.input<
  typeof governedVocabularyTransitionSchema
>;

const defineTransition = (
  input: GovernedVocabularyTransitionInput
): GovernedVocabularyTransition =>
  governedVocabularyTransitionSchema.parse(input);

const reviewFunctionParamDeclarations = {
  reviewDeclarationTypes: ['FunctionParam'],
};

const v1VocabularyHardExcludes = [
  '.scratch/**',
  '**/.scratch/**',
  '**/.tmp-tests/**',
];

const v1VocabularyHistoricalPaths = [
  '.agents/goals/**',
  '**/.agents/goals/**',
  '.agents/memory/**',
  '**/.agents/memory/**',
  '.agents/notes/**',
  '**/.agents/notes/**',
  '.agents/plans/**',
  '**/.agents/plans/**',
  '.claude/agent-memory/**',
  '**/.claude/agent-memory/**',
  '.changeset/**',
  '**/.changeset/**',
  '.trails/regrade/*.json',
  '**/.trails/regrade/*.json',
  '**/CHANGELOG.md',
  'docs/adr/0*.md',
  'docs/adr/decision-map.json',
  'docs/migration/*-to-adapter.md',
  'docs/migration/*-to-compose.md',
  'docs/migration/trailhead-to-surface.md',
  'docs/releases/beta*.md',
  'docs/releases/v1-vocabulary-reset.md',
  'docs/releases/v1-vocabulary-transition-workflow.md',
  'packages/warden/src/__tests__/retired-vocabulary.test.ts',
  'packages/warden/src/rules/retired-vocabulary.ts',
];

const unique = (values: readonly string[]): string[] => [...new Set(values)];

const defineV1Transition = (
  input: GovernedVocabularyTransitionInput
): GovernedVocabularyTransition =>
  defineTransition({
    ...input,
    preserve: input.preserve ?? [],
    scope: {
      ...input.scope,
      exclude: unique([
        ...v1VocabularyHardExcludes,
        ...(input.scope?.exclude ?? []),
      ]),
      policyClassified: [
        {
          disposition: 'historical-by-policy',
          paths: v1VocabularyHistoricalPaths,
          reason:
            'Preserve authored migration plans and historical decision/release evidence while keeping occurrences visible to the run ledger.',
        },
        ...(input.scope?.policyClassified ?? []),
      ],
      ...(input.scope?.teachingSurfaces === undefined
        ? {}
        : { teachingSurfaces: input.scope.teachingSurfaces }),
    },
  });

export const governedVocabularyTransitions =
  governedVocabularyRegistrySchema.parse([
    defineTransition({
      codeIdentifiers: ['ctx.cross', 'crossInput', 'crosses'],
      docs: {
        guidance: [
          'Exact ctx.cross, crossInput, and crosses forms are mechanically rewritten.',
          'Broader cross or Cross forms route to review because a text rule cannot prove the intended symbol boundary.',
        ],
        summary:
          'Beta.19 retired cross composition vocabulary in favor of compose.',
      },
      from: 'cross',
      id: 'cross-compose',
      intent:
        'Retire beta.19 cross composition vocabulary in favor of compose.',
      kind: 'vocabulary',
      oldForms: ['cross', 'Cross', 'crosses', 'crossInput', 'ctx.cross'],
      reviewForms: ['Cross', 'cross'],
      safeRewriteForms: {
        crossInput: 'composeInput',
        crosses: 'composes',
        'ctx.cross': 'ctx.compose',
      },
      status: 'complete',
      symbolRenames: [
        { ...reviewFunctionParamDeclarations, from: 'cross', to: 'compose' },
        {
          ...reviewFunctionParamDeclarations,
          from: 'crossInput',
          to: 'composeInput',
        },
        { ...reviewFunctionParamDeclarations, from: 'crosses', to: 'composes' },
      ],
      target: { kind: 'single', to: 'compose' },
    }),
    defineV1Transition({
      codeIdentifiers: ['blaze', 'blazes'],
      docs: {
        guidance: [
          'Treat code/API identifiers as governed symbols, not prose-only vocabulary.',
          'Review inflected forms such as blazed or blazing instead of forcing a mechanical rewrite.',
        ],
        summary:
          'The authored trail behavior field is moving from blaze to implementation.',
      },
      from: 'blaze',
      id: 'v1-blaze-implementation',
      intent:
        'Move the authored trail behavior field from blaze to implementation for v1.',
      kind: 'vocabulary',
      oldForms: ['blaze', 'blazes', 'Blaze'],
      reviewForms: ['Blaze', 'blazing', 'blazed', 'trailblaze'],
      safeRewriteForms: {
        blaze: 'implementation',
        blazes: 'implementations',
      },
      status: 'complete',
      stringLiteralRenames: [
        { from: 'blaze', match: 'property-key', to: 'implementation' },
      ],
      symbolRenames: [
        {
          ...reviewFunctionParamDeclarations,
          from: 'blaze',
          match: 'identifier-segment',
          to: 'implementation',
        },
        {
          ...reviewFunctionParamDeclarations,
          from: 'blazes',
          to: 'implementations',
        },
      ],
      target: { kind: 'single', to: 'implementation' },
    }),
    defineV1Transition({
      codeIdentifiers: ['contour', 'contours', 'wayfind.contours'],
      docs: {
        guidance: [
          'Keep domain-object semantics distinct from entities in app data until the occurrence is classified.',
          'Treat contour code/API identifiers as governed symbols, with FunctionParam shadows routed to review.',
          'Rewrite exact framework string literals only; prose, substrings, and inflections stay outside mechanical apply.',
        ],
        summary:
          'The domain object declaration term is moving from contour to entity.',
      },
      from: 'contour',
      id: 'v1-contour-entity',
      intent:
        'Move the domain object declaration vocabulary from contour to entity for v1.',
      kind: 'vocabulary',
      oldForms: ['contour', 'contours', 'Contour'],
      reviewForms: ['Contour', 'Contours', 'contoured', 'contouring'],
      safeRewriteForms: {
        contour: 'entity',
        contours: 'entities',
      },
      status: 'complete',
      stringLiteralRenames: [
        { from: 'contour', match: 'review', to: 'entity' },
        { from: 'contours', match: 'review', to: 'entities' },
        { from: 'wayfind.contours', to: 'wayfind.entities' },
      ],
      symbolRenames: [
        {
          ...reviewFunctionParamDeclarations,
          from: 'contour',
          match: 'identifier-segment',
          to: 'entity',
        },
        {
          ...reviewFunctionParamDeclarations,
          from: 'contours',
          match: 'identifier-segment',
          to: 'entities',
        },
      ],
      target: { kind: 'single', to: 'entity' },
    }),
    defineV1Transition({
      codeIdentifiers: [
        '@ontrails/observe',
        '@ontrails/observe/logtape',
        '@ontrails/observe/pino',
        'packages/observe',
      ],
      docs: {
        guidance: [
          'Treat the public package routes as exact code strings and module specifiers, not as general observability vocabulary.',
          'Rewrite the temporary Pino and LogTape subpaths only to their renamed temporary owner; their extraction to top-level adapters is a later transition.',
        ],
        summary:
          'The dependency-light observability owner moved from @ontrails/observe to @ontrails/observability.',
      },
      from: '@ontrails/observe',
      id: 'v1-observe-observability',
      intent:
        'Rename the dependency-light observability owner and its temporary adapter subpaths for v1.',
      kind: 'vocabulary',
      oldForms: [
        '@ontrails/observe',
        '@ontrails/observe/logtape',
        '@ontrails/observe/pino',
        'packages/observe',
      ],
      reviewForms: [],
      safeRewriteForms: {
        '@ontrails/observe': '@ontrails/observability',
        '@ontrails/observe/logtape': '@ontrails/observability/logtape',
        '@ontrails/observe/pino': '@ontrails/observability/pino',
        'packages/observe': 'packages/observability',
      },
      status: 'complete',
      stringLiteralRenames: [
        {
          from: '@ontrails/observe',
          moduleSpecifier: { targetPackage: '@ontrails/observability' },
          to: '@ontrails/observability',
        },
        {
          from: '@ontrails/observe/logtape',
          moduleSpecifier: { targetPackage: '@ontrails/observability' },
          to: '@ontrails/observability/logtape',
        },
        {
          from: '@ontrails/observe/pino',
          moduleSpecifier: { targetPackage: '@ontrails/observability' },
          to: '@ontrails/observability/pino',
        },
        { from: 'packages/observe', to: 'packages/observability' },
      ],
      target: { kind: 'single', to: '@ontrails/observability' },
    }),
    defineV1Transition({
      codeIdentifiers: ['@ontrails/observability/logtape'],
      docs: {
        guidance: [
          'Move the temporary observability subpath to the extracted LogTape adapter package.',
          'Do not retain a compatibility subpath: the extracted package owns the real LogTape dependency boundary.',
        ],
        summary:
          'The temporary LogTape forwarding subpath was extracted into a real top-level adapter package.',
      },
      from: '@ontrails/observability/logtape',
      id: 'v1-observability-logtape-extraction',
      intent:
        'Replace the temporary LogTape forwarding subpath with the extracted @ontrails/logtape adapter.',
      kind: 'vocabulary',
      oldForms: ['@ontrails/observability/logtape'],
      reviewForms: [],
      safeRewriteForms: {
        '@ontrails/observability/logtape': '@ontrails/logtape',
      },
      status: 'complete',
      stringLiteralRenames: [
        {
          from: '@ontrails/observability/logtape',
          moduleSpecifier: { targetPackage: '@ontrails/logtape' },
          to: '@ontrails/logtape',
        },
      ],
      target: { kind: 'single', to: '@ontrails/logtape' },
    }),
    defineV1Transition({
      codeIdentifiers: ['@ontrails/observability/pino'],
      docs: {
        guidance: [
          'Move the temporary observability subpath to the extracted Pino adapter package.',
          'Do not retain a compatibility subpath: the extracted package owns the real Pino dependency boundary.',
        ],
        summary:
          'The temporary Pino forwarding subpath was extracted into a real top-level adapter package.',
      },
      from: '@ontrails/observability/pino',
      id: 'v1-observability-pino-extraction',
      intent:
        'Replace the temporary Pino forwarding subpath with the extracted @ontrails/pino adapter.',
      kind: 'vocabulary',
      oldForms: ['@ontrails/observability/pino'],
      reviewForms: [],
      safeRewriteForms: {
        '@ontrails/observability/pino': '@ontrails/pino',
      },
      status: 'complete',
      stringLiteralRenames: [
        {
          from: '@ontrails/observability/pino',
          moduleSpecifier: { targetPackage: '@ontrails/pino' },
          to: '@ontrails/pino',
        },
      ],
      target: { kind: 'single', to: '@ontrails/pino' },
    }),
    defineV1Transition({
      codeIdentifiers: ['@ontrails/tracing', 'packages/tracing'],
      docs: {
        guidance: [
          'Classify root imports by ownership: intrinsic trace contracts belong to @ontrails/core and developer-state APIs belong to @ontrails/observability/dev.',
          'Do not mechanically redirect the tracing root because it formerly combined more than one owner.',
        ],
        summary:
          'The former tracing root was folded into core and the observability developer-state subpath.',
      },
      from: '@ontrails/tracing',
      id: 'v1-tracing-owner-fold',
      intent:
        'Remove the multi-owner tracing package without inventing a false one-to-one package redirect.',
      kind: 'vocabulary',
      oldForms: ['@ontrails/tracing', 'packages/tracing'],
      reviewForms: [],
      safeRewriteForms: {},
      status: 'complete',
      target: {
        guidance:
          'Root tracing imports require ownership classification; use @ontrails/core for intrinsic contracts and @ontrails/observability/dev for developer-state APIs.',
        kind: 'classified',
        options: [
          {
            to: '@ontrails/core',
            when: 'The imported symbol is an intrinsic trace record, context, or sink registry contract.',
          },
          {
            to: '@ontrails/observability/dev',
            when: 'The imported symbol is developer-state storage, sampling, or tracing query/status tooling.',
          },
        ],
      },
    }),
    defineV1Transition({
      codeIdentifiers: ['@ontrails/tracing/otel'],
      docs: {
        guidance: [
          'Rewrite the exact OTel adapter subpath after the observability package declares its /otel export.',
        ],
        summary:
          'The supported OTel adapter moved to the observability package.',
      },
      from: '@ontrails/tracing/otel',
      id: 'v1-tracing-otel-observability-otel',
      intent:
        'Move the dependency-light OTel adapter from the removed tracing package to @ontrails/observability/otel.',
      kind: 'vocabulary',
      oldForms: ['@ontrails/tracing/otel'],
      reviewForms: [],
      safeRewriteForms: {
        '@ontrails/tracing/otel': '@ontrails/observability/otel',
      },
      status: 'complete',
      stringLiteralRenames: [
        {
          from: '@ontrails/tracing/otel',
          moduleSpecifier: { targetPackage: '@ontrails/observability' },
          to: '@ontrails/observability/otel',
        },
      ],
      target: { kind: 'single', to: '@ontrails/observability/otel' },
    }),
    defineV1Transition({
      codeIdentifiers: [
        '@ontrails/topographer',
        '@ontrails/topographer/backend-support',
        '0042-core-topographer-boundary-doctrine',
        'core-topographer-boundary-doctrine',
        'Topographer-owned',
        'packages/topographer',
        'topographer',
        'topographers',
      ],
      docs: {
        guidance: [
          'Treat topographer code/API identifiers as governed symbols, with case and compound forms handled by identifier-segment matching.',
          'Rewrite only exact package route/module-specifier occurrences; near routes and larger route strings stay untouched.',
        ],
        summary:
          'The graph artifact package and vocabulary moved from topographer to topography.',
      },
      from: 'topographer',
      id: 'v1-topographer-topography',
      intent:
        'Move graph artifact package routes and code vocabulary from topographer to topography for v1.',
      kind: 'vocabulary',
      oldForms: [
        '@ontrails/topographer',
        '@ontrails/topographer/backend-support',
        '0042-core-topographer-boundary-doctrine',
        'core-topographer-boundary-doctrine',
        'Topographer-owned',
        'packages/topographer',
        'topographer',
        'topographers',
        'Topographer',
      ],
      reviewForms: ['Topographer'],
      safeRewriteForms: {
        '0042-core-topographer-boundary-doctrine':
          '0042-core-topography-boundary-doctrine',
        '@ontrails/topographer': '@ontrails/topography',
        '@ontrails/topographer/backend-support':
          '@ontrails/topography/backend-support',
        'Topographer-owned': 'Topography-owned',
        'core-topographer-boundary-doctrine':
          'core-topography-boundary-doctrine',
        'packages/topographer': 'packages/topography',
        topographer: 'topography',
        topographers: 'topographies',
      },
      status: 'complete',
      stringLiteralRenames: [
        {
          from: '@ontrails/topographer',
          moduleSpecifier: { targetPackage: '@ontrails/topography' },
          to: '@ontrails/topography',
        },
        {
          from: '@ontrails/topographer/backend-support',
          moduleSpecifier: { targetPackage: '@ontrails/topography' },
          to: '@ontrails/topography/backend-support',
        },
        {
          from: '0042-core-topographer-boundary-doctrine',
          to: '0042-core-topography-boundary-doctrine',
        },
        {
          from: 'core-topographer-boundary-doctrine',
          to: 'core-topography-boundary-doctrine',
        },
        { from: 'Topographer-owned', to: 'Topography-owned' },
        { from: 'packages/topographer', to: 'packages/topography' },
      ],
      symbolRenames: [
        {
          ...reviewFunctionParamDeclarations,
          from: 'topographer',
          match: 'identifier-segment',
          to: 'topography',
        },
        {
          ...reviewFunctionParamDeclarations,
          from: 'topographers',
          match: 'identifier-segment',
          to: 'topographies',
        },
      ],
      target: { kind: 'single', to: 'topography' },
    }),
    defineV1Transition({
      codeIdentifiers: [
        'facets',
        'facetId',
        'McpSurfaceFacetMap',
        'surface-facet-coherence',
        'wayfind.facets',
      ],
      docs: {
        guidance: [
          'A trailhead is one grouped surface entry fronting several trails while preserving member identity.',
          'Code/API identifiers remain governed symbols and need structured preservation before broad application.',
        ],
        summary:
          'The grouped surface entry term is moving from facet to trailhead.',
      },
      from: 'facet',
      id: 'v1-facet-trailhead',
      intent:
        'Move grouped surface entry vocabulary from facet to trailhead for v1.',
      kind: 'vocabulary',
      oldForms: ['facet', 'facets', 'Facet'],
      reviewForms: ['Facet'],
      safeRewriteForms: {
        facet: 'trailhead',
        facets: 'trailheads',
      },
      status: 'complete',
      stringLiteralRenames: [
        { from: 'surface-facet-coherence', to: 'surface-trailhead-coherence' },
        { from: 'wayfind.facets', to: 'wayfind.trailheads' },
      ],
      symbolRenames: [
        { ...reviewFunctionParamDeclarations, from: 'facet', to: 'trailhead' },
        {
          ...reviewFunctionParamDeclarations,
          from: 'facets',
          to: 'trailheads',
        },
        {
          ...reviewFunctionParamDeclarations,
          from: 'facetId',
          to: 'trailheadId',
        },
        {
          ...reviewFunctionParamDeclarations,
          from: 'McpSurfaceFacetMap',
          to: 'McpSurfaceTrailheadMap',
        },
      ],
      target: { kind: 'single', to: 'trailhead' },
    }),
    defineV1Transition({
      codeIdentifiers: ['@ontrails/warden/ast'],
      docs: {
        guidance: [
          'Treat the package route as an exact code string and module specifier, not as vocabulary prose or an identifier segment.',
          'Rewrite only exact string literal/module-specifier occurrences; near routes and larger strings stay untouched.',
        ],
        summary:
          'The reusable AST helper route moved from @ontrails/warden/ast to @ontrails/source.',
      },
      from: '@ontrails/warden/ast',
      id: 'v1-warden-ast-source',
      intent:
        'Move reusable AST helper imports from @ontrails/warden/ast to @ontrails/source for v1.',
      kind: 'vocabulary',
      oldForms: ['@ontrails/warden/ast'],
      preserve: [
        {
          paths: [
            'adapters/commander/src/__tests__/to-commander.test.ts',
            'apps/trails/src/__tests__/mcp.test.ts',
            'apps/trails/src/__tests__/regrade.test.ts',
            'packages/regrade/src/downstream/__tests__/ast-rewrite.test.ts',
            'packages/regrade/src/downstream/__tests__/vocabulary.test.ts',
            'packages/warden/src/__tests__/retired-vocabulary.test.ts',
            'scripts/verify-oxc-resolver-published.ts',
          ],
          pattern: '^@ontrails/warden/ast$',
          reason:
            'Preserve transition regression fixtures and the intentional negative resolver assertion after the public route is retired.',
        },
      ],
      reviewForms: [],
      safeRewriteForms: {
        '@ontrails/warden/ast': '@ontrails/source',
      },
      status: 'complete',
      stringLiteralRenames: [
        {
          from: '@ontrails/warden/ast',
          moduleSpecifier: { targetPackage: '@ontrails/source' },
          to: '@ontrails/source',
        },
      ],
      target: { kind: 'single', to: '@ontrails/source' },
    }),
    defineV1Transition({
      codeIdentifiers: ['@ontrails/wayfinder'],
      docs: {
        guidance: [
          'Treat the package route as an exact code string and module specifier, not as Wayfind product vocabulary.',
          'Rewrite only the exact package route; subpaths, near routes, and larger strings stay untouched for review.',
        ],
        summary:
          'The Wayfinder package API moved into @ontrails/topography while Wayfind remains the operator-facing product name.',
      },
      from: '@ontrails/wayfinder',
      id: 'v1-wayfinder-topography',
      intent:
        'Move programmatic Wayfinder imports into @ontrails/topography while preserving Wayfind surface vocabulary.',
      kind: 'vocabulary',
      oldForms: ['@ontrails/wayfinder'],
      reviewForms: [],
      safeRewriteForms: {
        '@ontrails/wayfinder': '@ontrails/topography',
      },
      status: 'complete',
      stringLiteralRenames: [
        {
          from: '@ontrails/wayfinder',
          moduleSpecifier: { targetPackage: '@ontrails/topography' },
          to: '@ontrails/topography',
        },
      ],
      target: { kind: 'single', to: '@ontrails/topography' },
    }),
    defineV1Transition({
      codeIdentifiers: [
        'ActivationSourceProjection',
        'AstFieldProjection',
        'DeriveTrailCliCommandProjectionOptions',
        'ErrorClassSurfaceProjection',
        'ErrorDiagnosticsProjection',
        'HTTP_METHOD_PROJECTION_PATH',
        'HttpInputProjection',
        'HttpLayerInputProjection',
        'LayerFieldProjection',
        'LayerFlagProjection',
        'LibraryInputProjection',
        'LibraryLayerFieldProjection',
        'LibraryLayerInputProjection',
        'LibraryProjection',
        'McpInputProjection',
        'McpLayerInputProjection',
        'NormalizedTopoProjection',
        'OutputSchemaProjection',
        'PROJECTION_BLOCKING_RULES',
        'ProjectionMap',
        'ProjectedLayerField',
        'ProjectedPermitRequirement',
        'RenamedLayerFieldProjection',
        'ShippedSurfaceProjection',
        'SurfaceErrorProjection',
        'SurfaceProjectionSource',
        'SurfaceTrailVersionProjection',
        'TopoGraphLibraryProjection',
        'TopoStoreSurfaceProjectionRecord',
        'TopoSurfaceProjectionRow',
        'TrailCliCommandProjection',
        'TrailCliProjection',
        'TrailCliProjectionInput',
        'TrailErrorTaxonomyProjection',
        'buildOutputSchemaProjection',
        'buildProjectionDiagnostic',
        'cliProjection',
        'cliProjectionSchema',
        'collectLibraryProjection',
        'collectionExtensionProjectionForFileRenames',
        'extensionProjection',
        'filterProjectedTargetExtensions',
        'projectActivationEdge',
        'projectActivationSource',
        'projectActivationSourceDeclaration',
        'projectActual',
        'projectAstFields',
        'projectErrorClassSurface',
        'projectErrorDiagnostics',
        'projectExample',
        'projectHttpInputSchema',
        'projectHttpLayerInput',
        'projectInputForSchema',
        'projectLayerFieldName',
        'projectLayerFlags',
        'projectLayerInputFields',
        'projectLibraryInput',
        'projectMcpInputSchema',
        'projectMcpLayerInput',
        'projectMcpOutputSchema',
        'projectPermitRequirement',
        'projectPublicSurfaceError',
        'projectSchema',
        'projectSignalAssertion',
        'projectSignalAssertions',
        'projectSignalExample',
        'projectSingleLayerFlags',
        'projectSurfaceError',
        'projectSurfaceMapTool',
        'projectTrailVersionEntry',
        'projectTrailVersions',
        'projectVersionDetours',
        'projectVersionRuntimeRefs',
        'projectVocabularyText',
        'projected',
        'projectedEvidence',
        'projectedFileInScopeCount',
        'projectedTargetPaths',
        'SchemaProjector',
        'deriveShippedSurfaceProjectionInventory',
        'deriveTrailCliCommandProjection',
        'errorSurfaceProjectionSchema',
        'errorTaxonomyProjectionSchema',
        'expectProjectionCounts',
        'inputProjection',
        'isProjectionBlockingIssue',
        'isTrailCliProjection',
        'keepProjectionBlockingIssues',
        'layerProjection',
        'libraryProjectionCoherence',
        'libraryProjectionCoherenceTrail',
        'normalizeTopoProjection',
        'ownerProjectionParity',
        'ownerProjectionParityTrail',
        'projectionDb',
        'projectionKeys',
        'projectionSource',
        'seedLegacyProjectionStore',
        'simpleProjectionApp',
        'surfaceProjectionBaseOutput',
        'surfaceProjectionOutput',
        'taxonomyProjection',
        'topoGraphLibraryProjectionSchema',
        'trailCliProjectionFor',
        'withProjectionDb',
      ],
      docs: {
        guidance: [
          'Use derive for contract-owned fact production.',
          'Use render for surface- or operator-facing presentation.',
          'Route every occurrence to review until the stage is classified.',
        ],
        summary: 'Projection vocabulary splits by stage into derive or render.',
      },
      fileRenames: [
        {
          from: 'docs/adr/drafts/20260608-release-provenance-as-lifecycle-projection.md',
          to: 'docs/adr/drafts/20260608-release-provenance-as-lifecycle-derivation.md',
        },
        {
          from: 'packages/cli/src/__tests__/layer-input-projection.test.ts',
          to: 'packages/cli/src/__tests__/layer-input-rendering.test.ts',
        },
        {
          from: 'packages/core/src/__tests__/activation-source-projection.test.ts',
          to: 'packages/core/src/__tests__/activation-source-derivation.test.ts',
        },
        {
          from: 'packages/core/src/__tests__/error-projection.test.ts',
          to: 'packages/core/src/__tests__/error-rendering.test.ts',
        },
        {
          from: 'packages/core/src/activation-source-projection.ts',
          to: 'packages/core/src/activation-source-derivation.ts',
        },
        {
          from: 'packages/core/src/error-projection.ts',
          to: 'packages/core/src/error-rendering.ts',
        },
        {
          from: 'packages/core/src/layer-projection.ts',
          to: 'packages/core/src/layer-field-rendering.ts',
        },
        {
          from: 'packages/http/src/__tests__/layer-input-projection.test.ts',
          to: 'packages/http/src/__tests__/layer-input-rendering.test.ts',
        },
        {
          from: 'packages/mcp/src/__tests__/layer-input-projection.test.ts',
          to: 'packages/mcp/src/__tests__/layer-input-rendering.test.ts',
        },
        {
          from: 'packages/topography/src/library-projection.ts',
          to: 'packages/topography/src/library-derivation.ts',
        },
        {
          from: 'packages/warden/src/__tests__/library-projection-coherence.test.ts',
          to: 'packages/warden/src/__tests__/library-render-coherence.test.ts',
        },
        {
          from: 'packages/warden/src/__tests__/owner-projection-parity.test.ts',
          to: 'packages/warden/src/__tests__/owner-render-parity.test.ts',
        },
        {
          from: 'packages/warden/src/rules/library-projection-coherence.ts',
          to: 'packages/warden/src/rules/library-render-coherence.ts',
        },
        {
          from: 'packages/warden/src/rules/owner-projection-parity.ts',
          to: 'packages/warden/src/rules/owner-render-parity.ts',
        },
        {
          from: 'packages/warden/src/trails/library-projection-coherence.trail.ts',
          to: 'packages/warden/src/trails/library-render-coherence.trail.ts',
        },
        {
          from: 'packages/warden/src/trails/owner-projection-parity.trail.ts',
          to: 'packages/warden/src/trails/owner-render-parity.trail.ts',
        },
      ],
      from: 'projection',
      id: 'v1-projection-derive-render',
      intent:
        'Split projection vocabulary into derive/render by lifecycle stage for v1.',
      kind: 'vocabulary',
      oldForms: [
        'projection',
        'projections',
        'project',
        'projects',
        'Projects',
        'projecting',
        'Projecting',
        'projected',
        'Projected',
      ],
      preserve: [
        {
          pattern: "\\b[Pp]roject(?:[-/:]|['’]s\\b)",
          reason:
            'Preserve compound project-domain nouns, permit scopes, paths, and possessives without suppressing the standalone retired verb.',
        },
        {
          pattern:
            '\\b[Pp]roject\\s+(?:root|directory|files?|paths?|state|scripts?|guidance|structure|name|marker|context|conventions?|vocabulary|rules?|findings?|operations?|key|source|config|metadata|policy|package|scope|entities|resources|diagnostics|history|update|control|instructions?|overview|documentation|boundary|helpers?|shape|dependencies|dependency|detection|substrate|truth|work|writing|management|settings?|skills?|issue|ids?)\\b',
          reason:
            'Preserve project as an attributive noun before established repository and workspace concepts.',
        },
        {
          pattern:
            '\\b(?:A|An|The|This|That|a|an|the|this|that|each|entire|every|existing|new|current|same|target|nested|downstream|Trails|Linear|Node|UX|logical|adopting|generated|scaffolded|source-shaped|first-party|temp)\\s+project\\b',
          reason:
            'Preserve project as an ordinary count noun selected by a determiner or domain adjective.',
        },
        {
          pattern:
            "\\b(?:Trails|Matt[’']s|Vite|ADR|adopting|application|consumer|customer|developer|framework|package|software|source|workspace|generated|scaffolded|new|existing|source-shaped|first-party|downstream|most|large|all|many|multiple|other|our|several|their|these|those|your)\\s+projects\\b",
          reason:
            'Preserve projects as an ordinary plural repository or application noun selected by an established domain modifier.',
        },
        {
          pattern:
            '\\b(?:across|among|between|for|from|in|inside|of|outside|under|within|with|without)\\s+(?:the\\s+)?projects\\b',
          reason:
            'Preserve projects as the object of a repository or application preposition.',
        },
        {
          pattern:
            '(?:[\'"`/.][Pp]rojects(?:[\'"`/]|\\b)|\\b[Pp]rojects\\b\\s*(?:=|[):;,]))',
          reason:
            'Preserve exact projects domain literals, member accesses, route segments, and enum values.',
        },
        {
          pattern:
            '\\b(?:in|for|within|across|under|outside|inside|from|of|with|without|per|before|after)\\s+(?:the\\s+)?project\\b',
          reason:
            'Preserve project as the object of a repository or workspace preposition.',
        },
        {
          pattern:
            '(?:[\'"`/]project(?:[\'"`/]|\\b)|\\bproject\\b\\s*(?:=|[);,]))',
          reason:
            'Preserve exact project domain literals, example variables, route segments, and enum values.',
        },
        {
          pattern:
            '(?:\\bmemory:\\s*project\\b|\\bproject\\b(?=\\s+(?:from|health-check|show)\\b))',
          reason:
            'Preserve project as an exact metadata value, import alias, or domain command segment.',
        },
        {
          pattern:
            '(?:\\bA Node project\\b|\\ba non-trivial UX project\\b|\\bproject\\s+`warden\\.)',
          reason:
            'Preserve established multiword project nouns and project-scoped Warden configuration prose.',
        },
      ],
      provenance: { mode: 'regrade-history' },
      reviewForms: [
        'projection',
        'projections',
        'project',
        'projects',
        'Projects',
        'projecting',
        'Projecting',
        'projected',
        'Projected',
      ],
      safeRewriteForms: {},
      scope: {
        policyClassified: [
          {
            disposition: 'explicit-preserve',
            expectMatches: true,
            paths: [
              'apps/trails/src/__tests__/mcp.test.ts',
              'apps/trails/src/__tests__/regrade.test.ts',
              'packages/regrade/src/downstream/__tests__/**/*.test.ts',
            ],
            reason:
              'Preserve exact old/new vocabulary fixtures that prove CLI, MCP, registry, and rewrite behavior without treating them as current teaching or API residue.',
          },
          {
            disposition: 'historical-by-policy',
            expectMatches: true,
            paths: ['docs/adr/0*.md'],
            reason:
              'The Trails projection census records accepted ADR history that must remain visible during the v1 split.',
          },
        ],
        teachingSurfaces: ['docs/**'],
      },
      status: 'complete',
      stringLiteralRenames: [
        {
          from: 'library-projection-coherence',
          to: 'library-render-coherence',
        },
        { from: 'owner-projection-parity', to: 'owner-render-parity' },
        { from: 'surface-projects', to: 'surface-renders' },
      ],
      symbolRenames: [
        { from: 'ActivationSourceProjection', to: 'ActivationSourceFacts' },
        { from: 'AstFieldProjection', to: 'AstFieldView' },
        {
          from: 'DeriveTrailCliCommandProjectionOptions',
          to: 'DeriveTrailCliCommandOptions',
        },
        {
          from: 'ErrorClassSurfaceProjection',
          to: 'ErrorClassSurfaceRendering',
        },
        {
          from: 'ErrorDiagnosticsProjection',
          to: 'ErrorDiagnosticsRendering',
        },
        {
          from: 'HTTP_METHOD_PROJECTION_PATH',
          to: 'HTTP_METHOD_DERIVATION_PATH',
        },
        { from: 'HttpInputProjection', to: 'HttpInputRendering' },
        {
          from: 'HttpLayerInputProjection',
          to: 'HttpLayerInputRendering',
        },
        { from: 'LayerFieldProjection', to: 'LayerFieldRendering' },
        { from: 'LayerFlagProjection', to: 'LayerFlagRendering' },
        { from: 'LibraryInputProjection', to: 'LibraryInputRendering' },
        {
          from: 'LibraryLayerFieldProjection',
          to: 'LibraryLayerFieldRendering',
        },
        {
          from: 'LibraryLayerInputProjection',
          to: 'LibraryLayerInputRendering',
        },
        { from: 'LibraryProjection', to: 'LibraryRenderingPlan' },
        { from: 'McpInputProjection', to: 'McpInputRendering' },
        {
          from: 'McpLayerInputProjection',
          to: 'McpLayerInputRendering',
        },
        { from: 'NormalizedTopoProjection', to: 'NormalizedTopoFacts' },
        {
          from: 'OutputSchemaProjection',
          to: 'McpOutputSchemaRendering',
        },
        {
          from: 'PROJECTION_BLOCKING_RULES',
          to: 'DERIVATION_BLOCKING_RULES',
        },
        { from: 'ProjectionMap', to: 'IntentKeyMap' },
        { from: 'ProjectedLayerField', to: 'RenderedLayerField' },
        {
          from: 'ProjectedPermitRequirement',
          to: 'DerivedPermitRequirement',
        },
        {
          from: 'RenamedLayerFieldProjection',
          to: 'RenamedLayerFieldRendering',
        },
        { from: 'ShippedSurfaceProjection', to: 'ShippedSurfaceDerived' },
        { from: 'SurfaceErrorProjection', to: 'SurfaceErrorRendering' },
        { from: 'SurfaceProjectionSource', to: 'SurfaceDerivedSource' },
        {
          from: 'SurfaceTrailVersionProjection',
          to: 'SurfaceTrailVersionRendering',
        },
        {
          from: 'TopoGraphLibraryProjection',
          to: 'TopoGraphLibraryDerived',
        },
        {
          from: 'TopoStoreSurfaceProjectionRecord',
          to: 'TopoStoreSurfaceDerivedRecord',
        },
        {
          from: 'TopoSurfaceProjectionRow',
          to: 'TopoSurfaceDerivedRow',
        },
        {
          from: 'TrailCliCommandProjection',
          to: 'TrailCliCommandRendering',
        },
        { from: 'TrailCliProjection', to: 'TrailCliRendering' },
        {
          from: 'TrailCliProjectionInput',
          to: 'TrailCliRenderingInput',
        },
        {
          from: 'TrailErrorTaxonomyProjection',
          to: 'TrailErrorTaxonomyFacts',
        },
        {
          from: 'buildOutputSchemaProjection',
          to: 'buildMcpOutputSchemaRendering',
        },
        {
          from: 'buildProjectionDiagnostic',
          to: 'buildDerivationDiagnostic',
        },
        { from: 'cliProjection', to: 'cliRendering' },
        { from: 'cliProjectionSchema', to: 'cliDerivedSchema' },
        {
          from: 'collectLibraryProjection',
          to: 'deriveTopoGraphLibrary',
        },
        {
          from: 'collectionExtensionProjectionForFileRenames',
          to: 'deriveCollectionExtensionsForFileRenames',
        },
        { from: 'extensionProjection', to: 'derivedExtensions' },
        {
          from: 'filterProjectedTargetExtensions',
          to: 'filterDerivedTargetExtensions',
        },
        { from: 'projectActivationEdge', to: 'deriveActivationEdge' },
        { from: 'projectActivationSource', to: 'deriveActivationSource' },
        {
          from: 'projectActivationSourceDeclaration',
          to: 'deriveActivationSourceFacts',
        },
        { from: 'projectActual', to: 'deriveActualOutcome' },
        { from: 'projectAstFields', to: 'deriveAstFieldView' },
        {
          from: 'projectErrorClassSurface',
          to: 'renderErrorClassSurface',
        },
        { from: 'projectErrorDiagnostics', to: 'renderErrorDiagnostics' },
        { from: 'projectExample', to: 'deriveExample' },
        { from: 'projectHttpInputSchema', to: 'renderHttpInputSchema' },
        { from: 'projectHttpLayerInput', to: 'renderHttpLayerInput' },
        { from: 'projectInputForSchema', to: 'deriveInputForSchema' },
        { from: 'projectLayerFieldName', to: 'renderLayerFieldName' },
        { from: 'projectLayerFlags', to: 'renderLayerFlags' },
        { from: 'projectLayerInputFields', to: 'renderLayerInputFields' },
        { from: 'projectLibraryInput', to: 'renderLibraryInput' },
        { from: 'projectMcpInputSchema', to: 'renderMcpInputSchema' },
        { from: 'projectMcpLayerInput', to: 'renderMcpLayerInput' },
        { from: 'projectMcpOutputSchema', to: 'renderMcpOutputSchema' },
        { from: 'projectPermitRequirement', to: 'derivePermitRequirement' },
        {
          from: 'projectPublicSurfaceError',
          to: 'renderPublicSurfaceError',
        },
        { from: 'projectSchema', to: 'deriveSchema' },
        { from: 'projectSignalAssertion', to: 'deriveSignalAssertion' },
        { from: 'projectSignalAssertions', to: 'deriveSignalAssertions' },
        { from: 'projectSignalExample', to: 'deriveSignalExample' },
        { from: 'projectSingleLayerFlags', to: 'renderSingleLayerFlags' },
        { from: 'projectSurfaceError', to: 'renderSurfaceError' },
        { from: 'projectSurfaceMapTool', to: 'renderSurfaceMapTool' },
        { from: 'projectTrailVersionEntry', to: 'deriveTrailVersionEntry' },
        { from: 'projectTrailVersions', to: 'deriveTrailVersions' },
        { from: 'projectVersionDetours', to: 'deriveVersionDetours' },
        {
          from: 'projectVersionRuntimeRefs',
          to: 'deriveVersionRuntimeRefs',
        },
        { from: 'projectVocabularyText', to: 'deriveVocabularyText' },
        {
          from: 'projected',
          safety: 'review',
          to: 'derived',
        },
        { from: 'projectedEvidence', to: 'derivedEvidence' },
        {
          from: 'projectedFileInScopeCount',
          to: 'derivedFileInScopeCount',
        },
        { from: 'projectedTargetPaths', to: 'derivedTargetPaths' },
        { from: 'SchemaProjector', to: 'SchemaDeriver' },
        {
          from: 'deriveShippedSurfaceProjectionInventory',
          to: 'deriveShippedSurfaceInventory',
        },
        {
          from: 'deriveTrailCliCommandProjection',
          to: 'deriveTrailCliCommandRendering',
        },
        {
          from: 'errorSurfaceProjectionSchema',
          to: 'errorSurfaceDerivedSchema',
        },
        {
          from: 'errorTaxonomyProjectionSchema',
          to: 'errorTaxonomyDerivedSchema',
        },
        { from: 'expectProjectionCounts', to: 'expectDerivedRowCounts' },
        { from: 'inputProjection', to: 'inputRendering' },
        {
          from: 'isProjectionBlockingIssue',
          to: 'isDerivationBlockingIssue',
        },
        { from: 'isTrailCliProjection', to: 'isTrailCliRendering' },
        {
          from: 'keepProjectionBlockingIssues',
          to: 'keepDerivationBlockingIssues',
        },
        { from: 'layerProjection', to: 'layerRendering' },
        {
          from: 'libraryProjectionCoherence',
          to: 'libraryRenderCoherence',
        },
        {
          from: 'libraryProjectionCoherenceTrail',
          to: 'libraryRenderCoherenceTrail',
        },
        {
          from: 'normalizeTopoProjection',
          to: 'deriveNormalizedTopoRows',
        },
        { from: 'ownerProjectionParity', to: 'ownerRenderParity' },
        {
          from: 'ownerProjectionParityTrail',
          to: 'ownerRenderParityTrail',
        },
        { from: 'projectionDb', to: 'derivedDb' },
        { from: 'projectionKeys', to: 'derivedKeys' },
        { from: 'projectionSource', to: 'derivedSource' },
        {
          from: 'seedLegacyProjectionStore',
          to: 'seedLegacyDerivedStore',
        },
        { from: 'simpleProjectionApp', to: 'simpleDerivedRowsApp' },
        {
          from: 'surfaceProjectionBaseOutput',
          to: 'surfaceDerivedBaseOutput',
        },
        {
          from: 'surfaceProjectionOutput',
          to: 'surfaceDerivedOutput',
        },
        { from: 'taxonomyProjection', to: 'deriveTaxonomyFacts' },
        {
          from: 'topoGraphLibraryProjectionSchema',
          to: 'topoGraphLibraryDerivedSchema',
        },
        { from: 'trailCliProjectionFor', to: 'trailCliRenderingFor' },
        { from: 'withProjectionDb', to: 'withDerivedDb' },
      ],
      target: {
        guidance:
          'No single replacement is safe. Classify by whether the occurrence produces contract facts or presents derived facts.',
        kind: 'classified',
        options: [
          {
            to: 'derive',
            when: 'The occurrence describes producing contract-owned facts or inferred data from authored inputs.',
          },
          {
            to: 'render',
            when: 'The occurrence describes presenting derived facts through a surface, report, guide, or operator output.',
          },
        ],
      },
    }),
  ]);

export const listGovernedVocabularyTransitions =
  (): readonly GovernedVocabularyTransition[] => governedVocabularyTransitions;

export const getGovernedVocabularyTransition = (
  id: string
): GovernedVocabularyTransition | undefined =>
  governedVocabularyTransitions.find((transition) => transition.id === id);

export const requireGovernedVocabularyTransition = (
  id: string
): GovernedVocabularyTransition => {
  const transition = getGovernedVocabularyTransition(id);
  if (transition === undefined) {
    throw new Error(`Unknown governed vocabulary transition "${id}".`);
  }
  return transition;
};

export const formatGovernedVocabularyTransitionGuide = (
  transitions: readonly GovernedVocabularyTransition[] = governedVocabularyTransitions
): string =>
  transitions
    .map((transition) => {
      const target =
        transition.target.kind === 'single'
          ? transition.target.to
          : transition.target.options
              .map((option) => `${option.to} (${option.when})`)
              .join(' or ');
      const lines = [
        `- ${transition.id}: ${transition.from} -> ${target}`,
        `  - Status: ${transition.status}`,
        `  - Intent: ${transition.intent}`,
        `  - Provenance: ${
          transition.provenance.mode === 'regrade-history'
            ? 'committed Regrade history required'
            : `legacy (${transition.provenance.reason})`
        }`,
        `  - Safe rewrites: ${Object.keys(transition.safeRewriteForms).length}`,
        `  - Review forms: ${transition.reviewForms.join(', ') || 'none'}`,
      ];
      return lines.join('\n');
    })
    .join('\n');
