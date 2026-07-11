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

  test('keeps exact mode from rewriting identifier segments', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'blaze',
      to: 'implementation',
    });
    const result = cls.apply(
      [
        'const blaze = 1;',
        'const blazeInput = blaze;',
        'type BlazeInput = { value: typeof blazeInput };',
        'const findBlazeBodies = () => blazeInput;',
        'const _blaze = blaze;',
        'const FORK_WITHOUT_PRESERVED_BLAZE = blaze;',
        '',
      ].join('\n'),
      { path: 'src/blaze.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        'const implementation = 1;',
        'const blazeInput = implementation;',
        'type BlazeInput = { value: typeof blazeInput };',
        'const findBlazeBodies = () => blazeInput;',
        'const _blaze = implementation;',
        'const FORK_WITHOUT_PRESERVED_BLAZE = implementation;',
        '',
      ].join('\n')
    );
  });

  test('renames identifier segments across supported identifier shapes', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'blaze',
      match: 'identifier-segment',
      to: 'implementation',
    });
    const result = cls.apply(
      [
        'const blaze = 1;',
        'const blazeInput = blaze;',
        'type BlazeInput = { value: typeof blazeInput };',
        'const findBlazeBodies = () => blazeInput;',
        'const _blaze = findBlazeBodies;',
        'const BLAZE = _blaze;',
        'const _BLAZE = BLAZE;',
        'const FORK_WITHOUT_PRESERVED_BLAZE = _blaze;',
        'const _BLAZE_INPUT = FORK_WITHOUT_PRESERVED_BLAZE;',
        '',
      ].join('\n'),
      { path: 'src/blaze.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        'const implementation = 1;',
        'const implementationInput = implementation;',
        'type ImplementationInput = { value: typeof implementationInput };',
        'const findImplementationBodies = () => implementationInput;',
        'const _implementation = findImplementationBodies;',
        'const IMPLEMENTATION = _implementation;',
        'const _IMPLEMENTATION = IMPLEMENTATION;',
        'const FORK_WITHOUT_PRESERVED_IMPLEMENTATION = _implementation;',
        'const _IMPLEMENTATION_INPUT = FORK_WITHOUT_PRESERVED_IMPLEMENTATION;',
        '',
      ].join('\n')
    );
  });

  test('does not treat substrings or inflections as identifier segments', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'blaze',
      match: 'identifier-segment',
      to: 'implementation',
    });
    const source = [
      'const trailblaze = 1;',
      'const blazed = trailblaze;',
      'const blazing = blazed;',
      'const bblaze = blazing;',
      'const nblazed = bblaze;',
      'const TRAILBLAZE = nblazed;',
      'const BLAZED = TRAILBLAZE;',
      '',
    ].join('\n');

    const result = cls.apply(source, { path: 'src/blaze.ts' });

    expect(result.kind).toBe('no-op');
    expect(result.nextSource).toBeUndefined();
  });

  test('does not rewrite comments or string literal text in segment mode', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'blaze',
      match: 'identifier-segment',
      to: 'implementation',
    });
    const result = cls.apply(
      [
        '// blazeInput, BlazeInput, findBlazeBodies, and _blaze stay prose',
        'const label = "blazeInput BlazeInput findBlazeBodies _blaze";',
        'const blazeInput = 1;',
        '',
      ].join('\n'),
      { path: 'src/blaze.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        '// blazeInput, BlazeInput, findBlazeBodies, and _blaze stay prose',
        'const label = "blazeInput BlazeInput findBlazeBodies _blaze";',
        'const implementationInput = 1;',
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

  test('preserves one concrete identifier-segment occurrence when requested', () => {
    const preservedOccurrences: { from: string; to: string }[] = [];
    const cls = createAstIdentifierRenameClass({
      from: 'blaze',
      match: 'identifier-segment',
      shouldPreserve: (occurrence) => {
        if (
          occurrence.from === 'blazeInput' &&
          preservedOccurrences.length === 0
        ) {
          preservedOccurrences.push({
            from: occurrence.from,
            to: occurrence.to,
          });
          return true;
        }
        return false;
      },
      to: 'implementation',
    });
    const result = cls.apply(
      [
        'const blazeInput = 1;',
        'const current = blazeInput;',
        'const findBlazeBodies = blazeInput;',
        '',
      ].join('\n'),
      { path: 'src/blaze.ts' }
    );

    expect(preservedOccurrences).toEqual([
      { from: 'blazeInput', to: 'implementationInput' },
    ]);
    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        'const blazeInput = 1;',
        'const current = implementationInput;',
        'const findImplementationBodies = implementationInput;',
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

  test('routes shadowed identifier-segment declarations to review with concrete details', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'blaze',
      match: 'identifier-segment',
      reviewDeclarationTypes: new Set(['FunctionParam']),
      to: 'implementation',
    });

    const result = cls.apply(
      [
        "import { blazeInput } from './runtime';",
        'export const current = blazeInput();',
        'function local(blazeInput: () => void) {',
        '  return blazeInput();',
        '}',
        '',
      ].join('\n'),
      { path: 'src/blaze.ts' }
    );

    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('ast-identifier-review-declaration');
    expect(result.nextSource).toBeUndefined();
    expect(result.notes.join('\n')).toContain(
      'Identifier "blazeInput" resolves to FunctionParam; routed to review.'
    );
    const details = result.reviewDetails ?? [];
    expect(details).toHaveLength(2);
    for (const detail of details) {
      expect(detail.candidateReplacement).toBe('implementationInput');
      expect(detail.expectedTarget).toBe(
        'Rename identifier "blazeInput" to "implementationInput".'
      );
      expect(detail.matchedForm).toBe('blazeInput');
      expect(detail.symbol).toBe('blazeInput');
      expect(detail.preserveCautions).toEqual([
        'Identifier "blazeInput" resolves to FunctionParam; routed to review.',
      ]);
    }
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

  test('rewrites governed blaze string literal keys exactly', () => {
    const transition = getGovernedVocabularyTransition(
      'v1-blaze-implementation'
    );
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected blaze vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const implementationLiteralClass = classes.find((cls) =>
      cls.id.includes(
        'ast-string-literal-rename:v1-blaze-implementation:blaze->implementation'
      )
    );
    expect(implementationLiteralClass).toBeDefined();
    if (implementationLiteralClass === undefined) {
      throw new Error('Expected blaze literal rename class.');
    }

    const result = implementationLiteralClass.apply(
      [
        "const authored = { ['blaze']: implementation };",
        'const keyed = { "blaze": implementation };',
        'const idiomatic = ["blazing", "trailblaze"];',
        '',
      ].join('\n'),
      { path: 'src/trails.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        "const authored = { ['implementation']: implementation };",
        'const keyed = { "implementation": implementation };',
        'const idiomatic = ["blazing", "trailblaze"];',
        '',
      ].join('\n')
    );

    for (const source of [
      'type Runtime = Pick<TrailContract, "blaze">;',
      'const label = "blaze";',
    ]) {
      expect(
        implementationLiteralClass.apply(source, { path: 'src/trails.ts' })
      ).toMatchObject({
        kind: 'needs-review',
        reason: 'ast-string-literal-review-position',
      });
    }

    const preservingClasses = createGovernedAstIdentifierRenameClasses(
      transition,
      {
        shouldPreserve: (occurrence) =>
          occurrence.path === 'scripts/vocab-cutover-map.ts',
      }
    );
    const preservingLiteralClass = preservingClasses.find((cls) =>
      cls.id.includes(
        'ast-string-literal-rename:v1-blaze-implementation:blaze->implementation'
      )
    );
    expect(preservingLiteralClass).toBeDefined();
    if (preservingLiteralClass === undefined) {
      throw new Error('Expected preserving blaze literal rename class.');
    }
    expect(
      preservingLiteralClass.apply("const historical = 'blaze';", {
        path: 'scripts/vocab-cutover-map.ts',
      })
    ).toMatchObject({ kind: 'no-op' });
  });

  test('uses identifier-segment mode for the governed blaze symbol rename', () => {
    const transition = getGovernedVocabularyTransition(
      'v1-blaze-implementation'
    );
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected blaze vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const implementationSymbolClass = classes.find((cls) =>
      cls.id.includes(
        'ast-symbol-rename:v1-blaze-implementation:blaze->implementation'
      )
    );
    expect(implementationSymbolClass).toBeDefined();
    if (implementationSymbolClass === undefined) {
      throw new Error('Expected blaze symbol rename class.');
    }

    const result = implementationSymbolClass.apply(
      [
        '// findBlazeBodies stays prose in identifier rewriting',
        'const label = "blazeInput stays a string";',
        'const blaze = 1;',
        'const blazeInput = blaze;',
        'type BlazeInput = { value: typeof blazeInput };',
        'const findBlazeBodies = () => blazeInput;',
        'const _blaze = findBlazeBodies;',
        'const FORK_WITHOUT_PRESERVED_BLAZE = _blaze;',
        'const trailblaze = 1;',
        'const blazed = trailblaze;',
        'const blazing = blazed;',
        'const bblaze = blazing;',
        'const nblazed = bblaze;',
        '',
      ].join('\n'),
      { path: 'src/blaze.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        '// findBlazeBodies stays prose in identifier rewriting',
        'const label = "blazeInput stays a string";',
        'const implementation = 1;',
        'const implementationInput = implementation;',
        'type ImplementationInput = { value: typeof implementationInput };',
        'const findImplementationBodies = () => implementationInput;',
        'const _implementation = findImplementationBodies;',
        'const FORK_WITHOUT_PRESERVED_IMPLEMENTATION = _implementation;',
        'const trailblaze = 1;',
        'const blazed = trailblaze;',
        'const blazing = blazed;',
        'const bblaze = blazing;',
        'const nblazed = bblaze;',
        '',
      ].join('\n')
    );
  });

  test('keeps the governed blazes symbol rename exact', () => {
    const transition = getGovernedVocabularyTransition(
      'v1-blaze-implementation'
    );
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected blaze vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const blazesSymbolClass = classes.find((cls) =>
      cls.id.includes(
        'ast-symbol-rename:v1-blaze-implementation:blazes->implementations'
      )
    );
    expect(blazesSymbolClass).toBeDefined();
    if (blazesSymbolClass === undefined) {
      throw new Error('Expected blazes symbol rename class.');
    }

    const result = blazesSymbolClass.apply(
      [
        'const blazes = 1;',
        'const blazesInput = blazes;',
        'const BlazeInput = blazesInput;',
        '',
      ].join('\n'),
      { path: 'src/blazes.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        'const implementations = 1;',
        'const blazesInput = implementations;',
        'const BlazeInput = blazesInput;',
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
