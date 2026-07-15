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

export const governedVocabularyTransitionSchema = z.object({
  codeIdentifiers: z.array(z.string().min(1)).default([]),
  docs: z.object({
    guidance: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1),
  }),
  from: z.string().min(1),
  id: z.string().min(1),
  intent: z.string().min(1),
  kind: z.literal('vocabulary'),
  oldForms: z.array(z.string().min(1)).min(1),
  overrides: z.record(z.string().min(1), z.string().min(1)).default({}),
  preserve: z.array(governedVocabularyPreserveRuleSchema).default([]),
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
  '.trails/regrade/**',
  '**/.trails/regrade/**',
  '**/CHANGELOG.md',
  'docs/adr/0*.md',
  'docs/adr/decision-map.json',
  'docs/migration/**',
  'docs/releases/beta*.md',
  'docs/releases/v1-vocabulary-reset.md',
  'docs/releases/v1-vocabulary-transition-workflow.md',
  'packages/warden/src/__tests__/retired-vocabulary.test.ts',
  'packages/warden/src/rules/retired-vocabulary.ts',
  'scripts/vocab-cutover-*.ts',
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
      codeIdentifiers: [],
      docs: {
        guidance: [
          'Use derive for contract-owned fact production.',
          'Use render for surface- or operator-facing presentation.',
          'Route every occurrence to review until the stage is classified.',
        ],
        summary: 'Projection vocabulary splits by stage into derive or render.',
      },
      from: 'projection',
      id: 'v1-projection-derive-render',
      intent:
        'Split projection vocabulary into derive/render by lifecycle stage for v1.',
      kind: 'vocabulary',
      oldForms: ['projection', 'projections', 'project', 'projected'],
      reviewForms: ['projection', 'projections', 'project', 'projected'],
      safeRewriteForms: {},
      scope: {
        policyClassified: [
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
      status: 'planned',
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
        `  - Safe rewrites: ${Object.keys(transition.safeRewriteForms).length}`,
        `  - Review forms: ${transition.reviewForms.join(', ') || 'none'}`,
      ];
      return lines.join('\n');
    })
    .join('\n');
