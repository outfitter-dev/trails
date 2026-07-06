import { describe, expect, test } from 'bun:test';
import { createSourceEdit, getNodeName } from '@ontrails/warden/ast';
import { getGovernedVocabularyTransition } from '@ontrails/warden';

import {
  createAstIdentifierRenameClass,
  createAstRewriteClass,
  createGovernedAstIdentifierRenameClasses,
} from '../ast-rewrite.js';

describe('createAstRewriteClass', () => {
  test('rewrites AST-backed source-span edits', () => {
    const cls = createAstRewriteClass({
      describe: 'Rename exported sourceTerm identifiers.',
      id: 'ast-test:sourceTerm',
      visit: (node) => {
        if (node.type !== 'Identifier') {
          return null;
        }
        const name = getNodeName(node);
        return name === 'sourceTerm'
          ? {
              edit: createSourceEdit(node.start, node.end, 'targetTerm'),
              kind: 'edit',
              note: 'Renamed sourceTerm identifier.',
            }
          : null;
      },
    });

    const result = cls.apply(
      'export const sourceTerm = sourceTermFactory();\n',
      {
        path: 'src/sourceTerm.ts',
      }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      'export const targetTerm = sourceTermFactory();\n'
    );
    expect(result.notes).toEqual(['Renamed sourceTerm identifier.']);
  });

  test('routes parser failures to review', () => {
    const cls = createAstRewriteClass({
      describe: 'Parse failure fixture.',
      id: 'ast-test:parse',
      visit: () => null,
    });

    const result = cls.apply('export const = ;', { path: 'src/broken.ts' });

    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('ast-rewrite-parse-failed');
    expect(result.nextSource).toBeUndefined();
  });

  test('routes overlapping source edits to review', () => {
    const cls = createAstRewriteClass({
      describe: 'Invalid edit fixture.',
      id: 'ast-test:overlap',
      visit: (node) =>
        node.type === 'Program'
          ? [
              {
                edit: createSourceEdit(0, 6, 'targetTerm'),
                kind: 'edit',
              },
              {
                edit: createSourceEdit(4, 11, 'newTerm'),
                kind: 'edit',
              },
            ]
          : null,
    });

    const result = cls.apply('const sourceTerm = 1;\n', {
      path: 'src/sourceTerm.ts',
    });

    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('ast-rewrite-invalid-edits');
    expect(result.nextSource).toBeUndefined();
  });

  test('routes visitor failures to review', () => {
    const cls = createAstRewriteClass({
      describe: 'Throwing visitor fixture.',
      id: 'ast-test:visitor-failure',
      visit: () => {
        throw new Error('visitor boom');
      },
    });

    const result = cls.apply('export const value = 1;\n', {
      path: 'src/value.ts',
    });

    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('ast-rewrite-visitor-failed');
    expect(result.notes.join('\n')).toContain('visitor boom');
    expect(result.nextSource).toBeUndefined();
  });

  test('routes scan predicate failures to review', () => {
    const cls = createAstRewriteClass({
      describe: 'Throwing scan predicate fixture.',
      id: 'ast-test:scan-failure',
      shouldScan: () => {
        throw new Error('scan boom');
      },
      visit: () => null,
    });

    const result = cls.apply('export const value = 1;\n', {
      path: 'src/value.ts',
    });

    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('ast-rewrite-scan-target-failed');
    expect(result.notes.join('\n')).toContain('scan boom');
    expect(result.nextSource).toBeUndefined();
  });
});

describe('createAstIdentifierRenameClass', () => {
  test('renames imports, exports, properties, and references by exact identifier', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'sourceTerm',
      to: 'targetTerm',
    });
    const result = cls.apply(
      [
        "import { sourceTerm } from './sourceTerms';",
        'export const sourceTerm = { sourceTerm, nested: { sourceTerm } };',
        'const value = obj.sourceTerm + sourceTerm;',
        '',
      ].join('\n'),
      { path: 'src/sourceTerm.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        "import { targetTerm } from './sourceTerms';",
        'export const targetTerm = { targetTerm, nested: { targetTerm } };',
        'const value = obj.targetTerm + targetTerm;',
        '',
      ].join('\n')
    );
  });

  test('renames representative type-position symbols', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'SourceType',
      to: 'TargetType',
    });
    const result = cls.apply(
      [
        'type SourceAlias = SourceType;',
        'interface Box extends SourceType {',
        '  value: SourceType;',
        '}',
        'const value = {} as SourceType;',
        '',
      ].join('\n'),
      { path: 'src/types.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        'type SourceAlias = TargetType;',
        'interface Box extends TargetType {',
        '  value: TargetType;',
        '}',
        'const value = {} as TargetType;',
        '',
      ].join('\n')
    );
  });

  test('does not rewrite comments or string literal text', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'sourceTerm',
      to: 'targetTerm',
    });
    const result = cls.apply(
      [
        '// sourceTerm remains prose',
        'const label = "sourceTerm remains a string";',
        'const sourceTerm = 1;',
        '',
      ].join('\n'),
      { path: 'src/sourceTerm.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        '// sourceTerm remains prose',
        'const label = "sourceTerm remains a string";',
        'const targetTerm = 1;',
        '',
      ].join('\n')
    );
  });

  test('preserves individual identifier occurrences when requested', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'sourceTerm',
      shouldPreserve: (occurrence) =>
        occurrence.path === 'src/sourceTerm.ts' &&
        occurrence.start < occurrence.source.indexOf('other'),
      to: 'targetTerm',
    });
    const result = cls.apply(
      [
        'export const sourceTerm = 1;',
        'export const other = sourceTerm;',
        '',
      ].join('\n'),
      { path: 'src/sourceTerm.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        'export const sourceTerm = 1;',
        'export const other = targetTerm;',
        '',
      ].join('\n')
    );
  });

  test('routes configured shadowed declarations to review', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'sourceTerm',
      reviewDeclarationTypes: new Set(['FunctionParam']),
      to: 'targetTerm',
    });

    const result = cls.apply(
      [
        "import { sourceTerm } from './sourceTerms';",
        'export const current = sourceTerm();',
        'function local(sourceTerm: () => void) {',
        '  return sourceTerm();',
        '}',
        '',
      ].join('\n'),
      { path: 'src/sourceTerm.ts' }
    );

    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('ast-identifier-review-declaration');
    expect(result.nextSource).toBeUndefined();
    expect(result.notes.join('\n')).toContain('FunctionParam');
    expect(result.reviewDetails).toEqual([
      {
        candidateReplacement: 'targetTerm',
        classId: 'ast-identifier-rename:sourceTerm->targetTerm',
        expectedTarget: 'Rename identifier "sourceTerm" to "targetTerm".',
        judgment: 'unresolved',
        matchedForm: 'sourceTerm',
        nodeKind: 'Identifier',
        preserveCautions: [
          'Identifier "sourceTerm" resolves to FunctionParam; routed to review.',
        ],
        reason: 'ast-identifier-review-declaration',
        signals: ['ast:identifier-rename'],
        span: { column: 16, end: 106, line: 3, start: 96 },
        suggestedValidation: 'bun run typecheck',
        symbol: 'sourceTerm',
      },
      {
        candidateReplacement: 'targetTerm',
        classId: 'ast-identifier-rename:sourceTerm->targetTerm',
        expectedTarget: 'Rename identifier "sourceTerm" to "targetTerm".',
        judgment: 'unresolved',
        matchedForm: 'sourceTerm',
        nodeKind: 'Identifier',
        preserveCautions: [
          'Identifier "sourceTerm" resolves to FunctionParam; routed to review.',
        ],
        reason: 'ast-identifier-review-declaration',
        signals: ['ast:identifier-rename'],
        span: { column: 10, end: 141, line: 4, start: 131 },
        suggestedValidation: 'bun run typecheck',
        symbol: 'sourceTerm',
      },
    ]);
  });

  test('creates governed identifier rename classes from registry symbols', () => {
    const transition = getGovernedVocabularyTransition('v1-facet-trailhead');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected facet vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const facetIdClass = classes.find((cls) =>
      cls.id.includes('facetId->trailheadId')
    );
    expect(facetIdClass).toBeDefined();
    if (facetIdClass === undefined) {
      throw new Error('Expected facetId rename class.');
    }

    const result = facetIdClass.apply(
      [
        'export interface FacetRecord { facetId: string }',
        'export const current = { facetId: "manual" };',
        '',
      ].join('\n'),
      { path: 'src/facets.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        'export interface FacetRecord { trailheadId: string }',
        'export const current = { trailheadId: "manual" };',
        '',
      ].join('\n')
    );

    const trailIdClass = classes.find((cls) =>
      cls.id.includes('wayfind.facets->wayfind.trailheads')
    );
    expect(trailIdClass).toBeDefined();
    if (trailIdClass === undefined) {
      throw new Error('Expected wayfind.facets literal rename class.');
    }

    const trailIdResult = trailIdClass.apply(
      [
        "ctx.compose('wayfind.facets', { facets });",
        'const text = "wayfind.facets";',
        '',
      ].join('\n'),
      { path: 'src/wayfind.ts' }
    );

    expect(trailIdResult.kind).toBe('rewrite');
    expect(trailIdResult.nextSource).toBe(
      [
        "ctx.compose('wayfind.trailheads', { facets });",
        'const text = "wayfind.trailheads";',
        '',
      ].join('\n')
    );
  });

  test('routes governed registry shadow declarations to review', () => {
    const transition = getGovernedVocabularyTransition('cross-compose');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected cross vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const crossInputClass = classes.find((cls) =>
      cls.id.includes('crossInput->composeInput')
    );
    expect(crossInputClass).toBeDefined();
    if (crossInputClass === undefined) {
      throw new Error('Expected crossInput rename class.');
    }

    const result = crossInputClass.apply(
      [
        "import { crossInput } from './composition';",
        'export const current = crossInput;',
        'function local(crossInput: string) {',
        '  return crossInput;',
        '}',
        '',
      ].join('\n'),
      { path: 'src/composition.ts' }
    );

    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('ast-identifier-review-declaration');
    expect(result.nextSource).toBeUndefined();
    expect(result.reviewDetails).toEqual([
      {
        candidateReplacement: 'composeInput',
        classId: 'ast-symbol-rename:cross-compose:crossInput->composeInput',
        expectedTarget: 'Rename identifier "crossInput" to "composeInput".',
        judgment: 'unresolved',
        matchedForm: 'crossInput',
        nodeKind: 'Identifier',
        preserveCautions: [
          'Identifier "crossInput" resolves to FunctionParam; routed to review.',
        ],
        reason: 'ast-identifier-review-declaration',
        signals: ['ast:identifier-rename'],
        span: { column: 16, end: 104, line: 3, start: 94 },
        suggestedValidation: 'bun run typecheck',
        symbol: 'crossInput',
      },
      {
        candidateReplacement: 'composeInput',
        classId: 'ast-symbol-rename:cross-compose:crossInput->composeInput',
        expectedTarget: 'Rename identifier "crossInput" to "composeInput".',
        judgment: 'unresolved',
        matchedForm: 'crossInput',
        nodeKind: 'Identifier',
        preserveCautions: [
          'Identifier "crossInput" resolves to FunctionParam; routed to review.',
        ],
        reason: 'ast-identifier-review-declaration',
        signals: ['ast:identifier-rename'],
        span: { column: 10, end: 135, line: 4, start: 125 },
        suggestedValidation: 'bun run typecheck',
        symbol: 'crossInput',
      },
    ]);
  });
});
