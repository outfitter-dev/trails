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

const v1VocabularyHistoricalExcludes = [
  '.agents/goals/**',
  '**/.agents/goals/**',
  '.agents/memory/**',
  '**/.agents/memory/**',
  '.agents/notes/**',
  '**/.agents/notes/**',
  '.claude/agent-memory/**',
  '**/.claude/agent-memory/**',
  '.agents/plans/archive/**',
  '**/.agents/plans/archive/**',
  '.changeset/**',
  '**/.changeset/**',
  '.scratch/**',
  '**/.scratch/**',
  '.trails/regrade/history/**',
  '**/.trails/regrade/history/**',
  '**/CHANGELOG.md',
  '**/.tmp-tests/**',
];

const v1VocabularyHistoricalPreservePaths = [
  '.agents/plans/**',
  '**/.agents/plans/**',
  'docs/adr/0*.md',
  'docs/adr/decision-map.json',
  'docs/migration/**',
  'docs/releases/beta*.md',
  'docs/releases/v1-vocabulary-reset.md',
  'docs/releases/v1-vocabulary-transition-workflow.md',
  'scripts/vocab-cutover-*.ts',
];

const v1VocabularySelfExcludes = [
  'packages/warden/src/rules/retired-vocabulary.ts',
];

const unique = (values: readonly string[]): string[] => [...new Set(values)];

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formsPattern = (forms: readonly string[]): string =>
  `(?:${forms.map(escapeRegExp).join('|')})`;

const defineV1Transition = (
  input: GovernedVocabularyTransitionInput
): GovernedVocabularyTransition =>
  defineTransition({
    ...input,
    preserve: [
      {
        paths: v1VocabularyHistoricalPreservePaths,
        pattern: formsPattern(
          unique([...(input.oldForms ?? []), ...(input.reviewForms ?? [])])
        ),
        reason:
          'Preserve authored migration plans and historical decision/release evidence while keeping occurrences visible to the run ledger.',
      },
      ...(input.preserve ?? []),
    ],
    scope: {
      ...input.scope,
      exclude: unique([
        ...v1VocabularyHistoricalExcludes,
        ...v1VocabularySelfExcludes,
        ...(input.scope?.exclude ?? []),
      ]),
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
      status: 'planned',
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
