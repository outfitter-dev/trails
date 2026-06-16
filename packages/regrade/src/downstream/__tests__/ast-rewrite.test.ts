import { describe, expect, test } from 'bun:test';
import { createSourceEdit } from '@ontrails/warden/ast';

import {
  createAstIdentifierRenameClass,
  createAstRewriteClass,
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
        const { name } = node as unknown as { readonly name?: string };
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
        classId: 'ast-identifier-rename:sourceTerm->targetTerm',
        expectedTarget: 'Rename identifier "sourceTerm" to "targetTerm".',
        nodeKind: 'Identifier',
        reason: 'ast-identifier-review-declaration',
        span: { column: 16, end: 118, line: 3, start: 96 },
        suggestedValidation: 'bun run typecheck',
        symbol: 'sourceTerm',
      },
      {
        classId: 'ast-identifier-rename:sourceTerm->targetTerm',
        expectedTarget: 'Rename identifier "sourceTerm" to "targetTerm".',
        nodeKind: 'Identifier',
        reason: 'ast-identifier-review-declaration',
        span: { column: 10, end: 141, line: 4, start: 131 },
        suggestedValidation: 'bun run typecheck',
        symbol: 'sourceTerm',
      },
    ]);
  });
});
