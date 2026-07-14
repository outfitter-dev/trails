import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';

import {
  formatGovernedVocabularyTransitionGuide,
  getGovernedVocabularyTransition,
  governedVocabularyRegistrySchema,
  governedVocabularySymbolRenameSchema,
  governedVocabularyTransitions,
  listGovernedVocabularyTransitions,
} from '../rules/retired-vocabulary.js';

describe('governed vocabulary registry', () => {
  test('accounts for current pending v1 lexicon families', () => {
    const transitions = listGovernedVocabularyTransitions();

    expect(transitions.map((transition) => transition.id)).toEqual([
      'cross-compose',
      'v1-blaze-implementation',
      'v1-contour-entity',
      'v1-observe-observability',
      'v1-observability-logtape-extraction',
      'v1-observability-pino-extraction',
      'v1-tracing-owner-fold',
      'v1-tracing-otel-observability-otel',
      'v1-topographer-topography',
      'v1-facet-trailhead',
      'v1-warden-ast-source',
      'v1-wayfinder-topography',
      'v1-projection-derive-render',
    ]);
    expect(transitions.map((transition) => transition.from)).toEqual([
      'cross',
      'blaze',
      'contour',
      '@ontrails/observe',
      '@ontrails/observability/logtape',
      '@ontrails/observability/pino',
      '@ontrails/tracing',
      '@ontrails/tracing/otel',
      'topographer',
      'facet',
      '@ontrails/warden/ast',
      '@ontrails/wayfinder',
      'projection',
    ]);

    const projection = getGovernedVocabularyTransition(
      'v1-projection-derive-render'
    );
    expect(projection?.oldForms).toContain('project');
    expect(projection?.target.kind).toBe('classified');

    const facet = getGovernedVocabularyTransition('v1-facet-trailhead');
    expect(facet?.status).toBe('complete');

    const implementation = getGovernedVocabularyTransition(
      'v1-blaze-implementation'
    );
    expect(implementation?.status).toBe('complete');

    const topography = getGovernedVocabularyTransition(
      'v1-topographer-topography'
    );
    expect(topography?.status).toBe('complete');

    const observability = getGovernedVocabularyTransition(
      'v1-observe-observability'
    );
    expect(observability?.status).toBe('complete');

    expect(
      getGovernedVocabularyTransition('v1-observability-logtape-extraction')
        ?.target
    ).toEqual({ kind: 'single', to: '@ontrails/logtape' });
    expect(
      getGovernedVocabularyTransition('v1-observability-pino-extraction')
        ?.target
    ).toEqual({ kind: 'single', to: '@ontrails/pino' });

    const tracing = getGovernedVocabularyTransition('v1-tracing-owner-fold');
    expect(tracing?.target.kind).toBe('classified');

    const otel = getGovernedVocabularyTransition(
      'v1-tracing-otel-observability-otel'
    );
    expect(otel?.target).toEqual({
      kind: 'single',
      to: '@ontrails/observability/otel',
    });
  });

  test('validates registry shape and rejects incomplete entries', () => {
    expect(() =>
      governedVocabularyRegistrySchema.parse([
        {
          docs: { summary: 'missing target' },
          from: 'old',
          id: 'bad',
          intent: 'bad entry',
          kind: 'vocabulary',
          oldForms: ['old'],
          status: 'planned',
        },
      ])
    ).toThrow(ZodError);
  });

  test('defaults governed symbol rename matching to exact identifiers', () => {
    expect(
      governedVocabularySymbolRenameSchema.parse({
        from: 'sourceTerm',
        to: 'targetTerm',
      })
    ).toEqual({
      from: 'sourceTerm',
      match: 'exact',
      reviewDeclarationTypes: [],
      to: 'targetTerm',
    });

    expect(
      governedVocabularySymbolRenameSchema.parse({
        from: 'sourceTerm',
        match: 'identifier-segment',
        reviewDeclarationTypes: ['FunctionParam'],
        to: 'targetTerm',
      })
    ).toEqual({
      from: 'sourceTerm',
      match: 'identifier-segment',
      reviewDeclarationTypes: ['FunctionParam'],
      to: 'targetTerm',
    });
  });

  test('keeps v1 vocabulary transitions from rewriting the registry itself', () => {
    const v1Transitions = listGovernedVocabularyTransitions().filter(
      (transition) => transition.id.startsWith('v1-')
    );

    expect(v1Transitions.length).toBeGreaterThan(0);
    for (const transition of v1Transitions) {
      expect(transition.scope?.exclude).toContain(
        'packages/warden/src/rules/retired-vocabulary.ts'
      );
    }
  });

  test('separates ignored state from scanned historical evidence', () => {
    const v1Transitions = listGovernedVocabularyTransitions().filter(
      (transition) => transition.id.startsWith('v1-')
    );

    for (const transition of v1Transitions) {
      expect(transition.scope?.exclude).toContain('.scratch/**');
      expect(transition.scope?.exclude).toContain('.agents/goals/**');
      expect(transition.scope?.exclude).toContain('**/.agents/goals/**');
      expect(transition.scope?.exclude).toContain('.agents/notes/**');
      expect(transition.scope?.exclude).toContain('**/.agents/notes/**');
      expect(transition.scope?.exclude).toContain('.claude/agent-memory/**');
      expect(transition.scope?.exclude).toContain('**/.claude/agent-memory/**');
      expect(transition.scope?.exclude).toContain('**/.tmp-tests/**');

      const historical = transition.preserve.find((rule) =>
        rule.paths?.includes('docs/adr/0*.md')
      );
      expect(historical?.paths).toContain('.agents/plans/**');
      expect(historical?.paths).toContain('**/.agents/plans/**');
      expect(historical?.paths).toContain('docs/adr/decision-map.json');
      expect(historical?.paths).toContain('docs/migration/**');
      expect(historical?.paths).toContain('docs/releases/beta*.md');
      expect(historical?.paths).toContain('scripts/vocab-cutover-*.ts');
      expect(historical?.pattern).toBeDefined();
    }
  });

  test('preserves historical compounds with escaped old-form patterns', () => {
    const implementation = getGovernedVocabularyTransition(
      'v1-blaze-implementation'
    );

    const implementationHistorical = implementation?.preserve.find((rule) =>
      rule.paths?.includes('.agents/plans/**')
    );

    expect(implementationHistorical?.pattern).toBe(
      '(?:blaze|blazes|Blaze|blazing|blazed|trailblaze)'
    );
    expect('blazeBody').toMatch(
      new RegExp(implementationHistorical?.pattern ?? '')
    );
  });

  test('governs exact blaze string literals without inflected literal rewrites', () => {
    const implementation = getGovernedVocabularyTransition(
      'v1-blaze-implementation'
    );

    expect(implementation?.status).toBe('complete');
    expect(implementation?.stringLiteralRenames).toEqual([
      { from: 'blaze', match: 'property-key', to: 'implementation' },
    ]);

    const literalSources =
      implementation?.stringLiteralRenames.map((rename) => rename.from) ?? [];
    expect(literalSources).not.toContain('Blaze');
    expect(literalSources).not.toContain('blazes');
    expect(literalSources).not.toContain('blazing');
    expect(literalSources).not.toContain('blazed');
    expect(literalSources).not.toContain('trailblaze');
  });

  test('opts singular blaze symbols into segment matching without changing status', () => {
    const implementation = getGovernedVocabularyTransition(
      'v1-blaze-implementation'
    );

    expect(implementation?.status).toBe('complete');
    expect(implementation?.symbolRenames).toEqual([
      {
        from: 'blaze',
        match: 'identifier-segment',
        reviewDeclarationTypes: ['FunctionParam'],
        to: 'implementation',
      },
      {
        from: 'blazes',
        match: 'exact',
        reviewDeclarationTypes: ['FunctionParam'],
        to: 'implementations',
      },
    ]);
  });

  test('makes contour transition code-fact complete for apply readiness', () => {
    const entity = getGovernedVocabularyTransition('v1-contour-entity');

    expect(entity?.status).toBe('complete');
    expect(entity?.codeIdentifiers).toEqual(
      expect.arrayContaining(['contour', 'contours', 'wayfind.contours'])
    );
    expect(entity?.safeRewriteForms).toMatchObject({
      contour: 'entity',
      contours: 'entities',
    });
    expect(entity?.stringLiteralRenames).toEqual([
      { from: 'contour', match: 'review', to: 'entity' },
      { from: 'contours', match: 'review', to: 'entities' },
      { from: 'wayfind.contours', to: 'wayfind.entities' },
    ]);
    expect(entity?.symbolRenames).toEqual([
      {
        from: 'contour',
        match: 'identifier-segment',
        reviewDeclarationTypes: ['FunctionParam'],
        to: 'entity',
      },
      {
        from: 'contours',
        match: 'identifier-segment',
        reviewDeclarationTypes: ['FunctionParam'],
        to: 'entities',
      },
    ]);

    const literalSources =
      entity?.stringLiteralRenames.map((rename) => rename.from) ?? [];
    expect(literalSources).not.toContain('Contour');
    expect(literalSources).not.toContain('Contours');
    expect(literalSources).not.toContain('contoured');
    expect(literalSources).not.toContain('contouring');
    expect(literalSources).not.toContain('counter-contour');
  });

  test('governs topographer identifier segments for topography migration', () => {
    const topography = getGovernedVocabularyTransition(
      'v1-topographer-topography'
    );

    expect(topography).toMatchObject({
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
      from: 'topographer',
      status: 'complete',
      target: { kind: 'single', to: 'topography' },
    });
    expect(topography?.safeRewriteForms).toMatchObject({
      '0042-core-topographer-boundary-doctrine':
        '0042-core-topography-boundary-doctrine',
      'Topographer-owned': 'Topography-owned',
      'core-topographer-boundary-doctrine': 'core-topography-boundary-doctrine',
      'packages/topographer': 'packages/topography',
      topographer: 'topography',
      topographers: 'topographies',
    });
    expect(topography?.symbolRenames).toEqual([
      {
        from: 'topographer',
        match: 'identifier-segment',
        reviewDeclarationTypes: ['FunctionParam'],
        to: 'topography',
      },
      {
        from: 'topographers',
        match: 'identifier-segment',
        reviewDeclarationTypes: ['FunctionParam'],
        to: 'topographies',
      },
    ]);
  });

  test('governs topographer package routes as exact literals only', () => {
    const topography = getGovernedVocabularyTransition(
      'v1-topographer-topography'
    );

    expect(topography?.safeRewriteForms).toMatchObject({
      '@ontrails/topographer': '@ontrails/topography',
      '@ontrails/topographer/backend-support':
        '@ontrails/topography/backend-support',
    });
    expect(topography?.stringLiteralRenames).toEqual([
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
    ]);
    expect(topography?.reviewForms).toEqual(['Topographer']);

    const rewriteSources = new Set([
      ...Object.keys(topography?.safeRewriteForms ?? {}),
      ...(topography?.stringLiteralRenames.map((rename) => rename.from) ?? []),
    ]);
    expect(rewriteSources).not.toContain('Topographer');
    expect(rewriteSources).not.toContain('Topographers-owned');
    expect(rewriteSources).not.toContain('@ontrails/topographers');
    expect(rewriteSources).not.toContain('@ontrails/topographer-extra');
    expect(rewriteSources).not.toContain(
      '@ontrails/topographer/backend-support-extra'
    );
    expect(rewriteSources).not.toContain('packages/topographers');
    expect(rewriteSources).not.toContain('packages/topographer-extra');
    expect(rewriteSources).not.toContain(
      '0042-core-topographer-boundary-doctrines'
    );
    expect(rewriteSources).not.toContain(
      '0042-core-topographer-boundary-doctrine-extra'
    );
    expect(rewriteSources).not.toContain('core-topographer-boundary-doctrines');
    expect(rewriteSources).not.toContain(
      'core-topographer-boundary-doctrine-extra'
    );
  });

  test('keeps topographer historical paths protected through v1 transition scope', () => {
    const topography = getGovernedVocabularyTransition(
      'v1-topographer-topography'
    );

    expect(topography?.scope?.exclude).toContain(
      'packages/warden/src/rules/retired-vocabulary.ts'
    );
    expect(topography?.scope?.exclude).toContain(
      'packages/warden/src/__tests__/retired-vocabulary.test.ts'
    );
    expect(topography?.scope?.exclude).toContain('.scratch/**');
    expect(topography?.scope?.exclude).toContain('.agents/memory/**');
    expect(topography?.scope?.exclude).toContain('**/.agents/memory/**');

    const historical = topography?.preserve.find((rule) =>
      rule.paths?.includes('docs/adr/0*.md')
    );
    expect(historical?.paths).toContain('.agents/plans/**');
    expect(historical?.paths).toContain('docs/releases/v1-vocabulary-reset.md');
    expect(historical?.pattern).toBe(
      '(?:@ontrails/topographer|@ontrails/topographer/backend-support|0042-core-topographer-boundary-doctrine|core-topographer-boundary-doctrine|Topographer-owned|packages/topographer|topographer|topographers|Topographer)'
    );
  });

  test('governs the warden ast package route as an exact code string only', () => {
    const source = getGovernedVocabularyTransition('v1-warden-ast-source');

    expect(source).toMatchObject({
      codeIdentifiers: ['@ontrails/warden/ast'],
      from: '@ontrails/warden/ast',
      status: 'complete',
      target: { kind: 'single', to: '@ontrails/source' },
    });
    expect(source?.safeRewriteForms).toEqual({
      '@ontrails/warden/ast': '@ontrails/source',
    });
    expect(source?.preserve).toContainEqual(
      expect.objectContaining({
        paths: expect.arrayContaining([
          'adapters/commander/src/__tests__/to-commander.test.ts',
          'apps/trails/src/__tests__/mcp.test.ts',
          'apps/trails/src/__tests__/regrade.test.ts',
          'packages/regrade/src/downstream/__tests__/ast-rewrite.test.ts',
          'packages/regrade/src/downstream/__tests__/vocabulary.test.ts',
          'packages/warden/src/__tests__/retired-vocabulary.test.ts',
          'scripts/verify-oxc-resolver-published.ts',
        ]),
        pattern: '^@ontrails/warden/ast$',
      })
    );
    expect(source?.preserve).not.toContainEqual(
      expect.objectContaining({
        paths: expect.arrayContaining([
          'docs/api-reference.md',
          'packages/warden/README.md',
          'packages/warden/src/__tests__/ast-export-contract.test.ts',
          'packages/warden/src/__tests__/public-api.test.ts',
        ]),
      })
    );
    expect(source?.stringLiteralRenames).toEqual([
      {
        from: '@ontrails/warden/ast',
        moduleSpecifier: { targetPackage: '@ontrails/source' },
        to: '@ontrails/source',
      },
    ]);
    expect(source?.symbolRenames).toEqual([]);
    expect(source?.reviewForms).toEqual([]);
  });

  test('governs the retired Wayfinder package route without renaming the product', () => {
    const wayfinder = getGovernedVocabularyTransition(
      'v1-wayfinder-topography'
    );

    expect(wayfinder).toMatchObject({
      codeIdentifiers: ['@ontrails/wayfinder'],
      from: '@ontrails/wayfinder',
      status: 'complete',
      target: { kind: 'single', to: '@ontrails/topography' },
    });
    expect(wayfinder?.safeRewriteForms).toEqual({
      '@ontrails/wayfinder': '@ontrails/topography',
    });
    expect(wayfinder?.stringLiteralRenames).toEqual([
      {
        from: '@ontrails/wayfinder',
        moduleSpecifier: { targetPackage: '@ontrails/topography' },
        to: '@ontrails/topography',
      },
    ]);
    expect(wayfinder?.symbolRenames).toEqual([]);
  });

  test('rejects duplicate ids and duplicate source terms', () => {
    const [transition] = governedVocabularyTransitions;
    if (transition === undefined) {
      throw new Error('Expected governed vocabulary registry fixture.');
    }

    expect(() =>
      governedVocabularyRegistrySchema.parse([transition, transition])
    ).toThrow(ZodError);
  });

  test('renders a documentation guide without making markdown the source of truth', () => {
    const guide = formatGovernedVocabularyTransitionGuide();

    expect(guide).toContain('v1-facet-trailhead: facet -> trailhead');
    expect(guide).toContain('v1-projection-derive-render: projection ->');
    expect(guide).toContain('Status: planned');
  });
});
