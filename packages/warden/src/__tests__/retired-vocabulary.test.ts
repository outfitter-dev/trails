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
      'v1-facet-trailhead',
      'v1-warden-ast-source',
      'v1-projection-derive-render',
    ]);
    expect(transitions.map((transition) => transition.from)).toEqual([
      'cross',
      'blaze',
      'contour',
      'facet',
      '@ontrails/warden/ast',
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
          'docs/api-reference.md',
          'packages/regrade/src/downstream/__tests__/ast-rewrite.test.ts',
          'packages/regrade/src/downstream/__tests__/vocabulary.test.ts',
          'packages/warden/README.md',
          'packages/warden/src/__tests__/ast-export-contract.test.ts',
          'packages/warden/src/__tests__/public-api.test.ts',
          'packages/warden/src/__tests__/retired-vocabulary.test.ts',
          'scripts/verify-oxc-resolver-published.ts',
        ]),
        pattern: '^@ontrails/warden/ast$',
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
