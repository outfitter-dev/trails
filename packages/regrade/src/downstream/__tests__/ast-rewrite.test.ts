import { describe, expect, test } from 'bun:test';
import { createSourceEdit, getNodeName } from '@ontrails/source';
import {
  getGovernedVocabularyTransition,
  governedVocabularyTransitionSchema,
} from '@ontrails/warden';

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
  test('renames declarations, properties, and references by exact identifier', () => {
    const cls = createAstIdentifierRenameClass({
      from: 'sourceTerm',
      to: 'targetTerm',
    });
    const result = cls.apply(
      [
        'const sourceTermSeed = 1;',
        'export const sourceTerm = { sourceTerm, nested: { sourceTerm } };',
        'const value = obj.sourceTerm + sourceTerm + sourceTermSeed;',
        '',
      ].join('\n'),
      { path: 'src/sourceTerm.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        'const sourceTermSeed = 1;',
        'export const targetTerm = { targetTerm, nested: { targetTerm } };',
        'const value = obj.targetTerm + targetTerm + sourceTermSeed;',
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
        "import { otherValue } from './sourceTerms';",
        'export const current = otherValue();',
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
        "import { otherInput } from './runtime';",
        'export const current = otherInput();',
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

  test('uses identifier-segment mode for governed contour symbols', () => {
    const transition = getGovernedVocabularyTransition('v1-contour-entity');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected contour vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const entitySymbolClass = classes.find((cls) =>
      cls.id.includes('ast-symbol-rename:v1-contour-entity:contour->entity')
    );
    expect(entitySymbolClass).toBeDefined();
    if (entitySymbolClass === undefined) {
      throw new Error('Expected contour symbol rename class.');
    }

    const result = entitySymbolClass.apply(
      [
        'const contour = createContour();',
        'const createTableContour = (value: unknown) => value;',
        'export type ContourRecord = { contour: typeof contour };',
        'const contourSummarySchema = contour;',
        'const contourToEntry = createTableContour(contourSummarySchema);',
        'const CONTOUR_ID_METADATA = contourToEntry;',
        'const countercontour = CONTOUR_ID_METADATA;',
        'const contoured = countercontour;',
        'const contouring = contoured;',
        '',
      ].join('\n'),
      { path: 'src/contour.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        'const entity = createEntity();',
        'const createTableEntity = (value: unknown) => value;',
        'export type EntityRecord = { entity: typeof entity };',
        'const entitySummarySchema = entity;',
        'const entityToEntry = createTableEntity(entitySummarySchema);',
        'const ENTITY_ID_METADATA = entityToEntry;',
        'const countercontour = ENTITY_ID_METADATA;',
        'const contoured = countercontour;',
        'const contouring = contoured;',
        '',
      ].join('\n')
    );
  });

  test('routes identifiers that already contain the contour target segment to review', () => {
    const transition = getGovernedVocabularyTransition('v1-contour-entity');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected contour vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const entitySymbolClass = classes.find((cls) =>
      cls.id.includes('ast-symbol-rename:v1-contour-entity:contour->entity')
    );
    expect(entitySymbolClass).toBeDefined();
    if (entitySymbolClass === undefined) {
      throw new Error('Expected contour symbol rename class.');
    }

    const source = [
      'const entityContour = 1;',
      'const ENTITY_CONTOUR = entityContour;',
      '',
    ].join('\n');
    const result = entitySymbolClass.apply(source, {
      path: 'src/entity-contour.ts',
    });

    expect(result.kind).toBe('needs-review');
    expect(result.nextSource).toBeUndefined();
    expect(result.reviewDetails).toEqual([
      expect.objectContaining({
        candidateReplacement: 'entityEntity',
        reason: 'ast-identifier-target-segment-present',
        symbol: 'entityContour',
      }),
      expect.objectContaining({
        candidateReplacement: 'ENTITY_ENTITY',
        reason: 'ast-identifier-target-segment-present',
        symbol: 'ENTITY_CONTOUR',
      }),
      expect.objectContaining({
        candidateReplacement: 'entityEntity',
        reason: 'ast-identifier-target-segment-present',
        symbol: 'entityContour',
      }),
    ]);
  });

  test('routes governed import and export names to review', () => {
    const transition = getGovernedVocabularyTransition('v1-contour-entity');
    if (transition === undefined) {
      throw new Error('Expected contour vocabulary transition.');
    }
    const entitySymbolClass = createGovernedAstIdentifierRenameClasses(
      transition
    ).find((cls) =>
      cls.id.includes('ast-symbol-rename:v1-contour-entity:contour->entity')
    );
    if (entitySymbolClass === undefined) {
      throw new Error('Expected contour symbol rename class.');
    }

    for (const source of [
      "import { contourId } from 'external';",
      "import contourId from 'external';",
      "import * as contourId from 'external';",
      'export { localContourId as contourId };',
    ]) {
      const result = entitySymbolClass.apply(source, {
        path: 'src/module-boundary.ts',
      });
      expect(result).toMatchObject({
        kind: 'needs-review',
        reason: 'ast-identifier-module-boundary',
        reviewDetails: expect.arrayContaining([
          expect.objectContaining({
            reason: 'ast-identifier-module-boundary',
          }),
        ]),
      });
      expect(result.nextSource).toBeUndefined();
    }
  });

  test('uses identifier-segment mode for governed contours symbols', () => {
    const transition = getGovernedVocabularyTransition('v1-contour-entity');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected contour vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const entitiesSymbolClass = classes.find((cls) =>
      cls.id.includes('ast-symbol-rename:v1-contour-entity:contours->entities')
    );
    expect(entitiesSymbolClass).toBeDefined();
    if (entitiesSymbolClass === undefined) {
      throw new Error('Expected contours symbol rename class.');
    }

    const result = entitiesSymbolClass.apply(
      [
        'const contours = listContoursSource();',
        'const listContours = (value: unknown) => value;',
        'export type ContoursRecord = { contours: typeof contours };',
        'const contoursSummarySchema = contours;',
        'const CONTOURS_ROUTE = listContours(contoursSummarySchema);',
        'const countercontours = CONTOURS_ROUTE;',
        '',
      ].join('\n'),
      { path: 'src/contours.ts' }
    );

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        'const entities = listEntitiesSource();',
        'const listEntities = (value: unknown) => value;',
        'export type EntitiesRecord = { entities: typeof entities };',
        'const entitiesSummarySchema = entities;',
        'const ENTITIES_ROUTE = listEntities(entitiesSummarySchema);',
        'const countercontours = ENTITIES_ROUTE;',
        '',
      ].join('\n')
    );

    const mixedTargetResult = entitiesSymbolClass.apply(
      'const entityContours = 1;\n',
      { path: 'src/entity-contours.ts' }
    );
    expect(mixedTargetResult.kind).toBe('needs-review');
    expect(mixedTargetResult.nextSource).toBeUndefined();
    expect(mixedTargetResult.reviewDetails).toEqual([
      expect.objectContaining({
        candidateReplacement: 'entityEntities',
        reason: 'ast-identifier-target-segment-present',
        symbol: 'entityContours',
      }),
    ]);
  });

  test('proves the public contour census replacements for the hard v1 cut', () => {
    const transition = getGovernedVocabularyTransition('v1-contour-entity');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected contour vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const entitySymbolClass = classes.find((cls) =>
      cls.id.includes('ast-symbol-rename:v1-contour-entity:contour->entity')
    );
    const entitiesSymbolClass = classes.find((cls) =>
      cls.id.includes('ast-symbol-rename:v1-contour-entity:contours->entities')
    );
    expect(entitySymbolClass).toBeDefined();
    expect(entitiesSymbolClass).toBeDefined();
    if (entitySymbolClass === undefined || entitiesSymbolClass === undefined) {
      throw new Error('Expected contour symbol rename classes.');
    }

    const source = [
      'export interface ContourOptions {}',
      'export type AnyContour = ContourOptions;',
      'export type ContourReference = AnyContour;',
      'export const getContourIdMetadata = () => undefined;',
      'export interface TopoGraphContourReference {}',
      'export interface TopoStoreContourRecord {}',
      'export type TableContour = AnyContour;',
      'export const wayfindContoursTrail = undefined;',
      'export const getContour = () => undefined;',
      'export const listContours = () => [];',
      'export const contourIds = () => [];',
      'export const contourCount = 0;',
      '',
    ].join('\n');

    const singularResult = entitySymbolClass.apply(source, {
      path: 'src/public-api.ts',
    });
    expect(singularResult.kind).toBe('rewrite');
    const pluralResult = entitiesSymbolClass.apply(
      singularResult.nextSource ?? '',
      { path: 'src/public-api.ts' }
    );

    expect(pluralResult.kind).toBe('rewrite');
    expect(pluralResult.nextSource).toBe(
      [
        'export interface EntityOptions {}',
        'export type AnyEntity = EntityOptions;',
        'export type EntityReference = AnyEntity;',
        'export const getEntityIdMetadata = () => undefined;',
        'export interface TopoGraphEntityReference {}',
        'export interface TopoStoreEntityRecord {}',
        'export type TableEntity = AnyEntity;',
        'export const wayfindEntitiesTrail = undefined;',
        'export const getEntity = () => undefined;',
        'export const listEntities = () => [];',
        'export const entityIds = () => [];',
        'export const entityCount = 0;',
        '',
      ].join('\n')
    );
  });

  test('routes governed contour FunctionParam shadows to review', () => {
    const transition = getGovernedVocabularyTransition('v1-contour-entity');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected contour vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const entitySymbolClass = classes.find((cls) =>
      cls.id.includes('ast-symbol-rename:v1-contour-entity:contour->entity')
    );
    expect(entitySymbolClass).toBeDefined();
    if (entitySymbolClass === undefined) {
      throw new Error('Expected contour symbol rename class.');
    }

    const result = entitySymbolClass.apply(
      [
        "import { subject } from './domain';",
        'export const current = subject();',
        'function local(contour: () => void) {',
        '  return contour();',
        '}',
        '',
      ].join('\n'),
      { path: 'src/contour.ts' }
    );

    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('ast-identifier-review-declaration');
    expect(result.nextSource).toBeUndefined();
    expect(result.reviewDetails).toEqual([
      expect.objectContaining({
        candidateReplacement: 'entity',
        classId: 'ast-symbol-rename:v1-contour-entity:contour->entity',
        matchedForm: 'contour',
        preserveCautions: [
          'Identifier "contour" resolves to FunctionParam; routed to review.',
        ],
        reason: 'ast-identifier-review-declaration',
        symbol: 'contour',
      }),
      expect.objectContaining({
        candidateReplacement: 'entity',
        classId: 'ast-symbol-rename:v1-contour-entity:contour->entity',
        matchedForm: 'contour',
        preserveCautions: [
          'Identifier "contour" resolves to FunctionParam; routed to review.',
        ],
        reason: 'ast-identifier-review-declaration',
        symbol: 'contour',
      }),
    ]);
  });

  test('rewrites governed contour string literals exactly', () => {
    const transition = getGovernedVocabularyTransition('v1-contour-entity');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected contour vocabulary transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const literalClasses = new Map(classes.map((cls) => [cls.id, cls]));
    const entityLiteralClass = literalClasses.get(
      'ast-string-literal-rename:v1-contour-entity:contour->entity'
    );
    const entitiesLiteralClass = literalClasses.get(
      'ast-string-literal-rename:v1-contour-entity:contours->entities'
    );
    const wayfindLiteralClass = literalClasses.get(
      'ast-string-literal-rename:v1-contour-entity:wayfind.contours->wayfind.entities'
    );
    expect(entityLiteralClass).toBeDefined();
    expect(entitiesLiteralClass).toBeDefined();
    expect(wayfindLiteralClass).toBeDefined();
    if (
      entityLiteralClass === undefined ||
      entitiesLiteralClass === undefined ||
      wayfindLiteralClass === undefined
    ) {
      throw new Error('Expected contour literal rename classes.');
    }

    const source = [
      'const singular = "contour";',
      "const plural = 'contours';",
      "ctx.compose('wayfind.contours', { contours });",
      'const prose = "contourSummarySchema contoursList wayfind.contours.extra";',
      'const idioms = ["counter-contour", "contoured", "contouring", "Contour"];',
      '',
    ].join('\n');

    const singularResult = entityLiteralClass.apply(source, {
      path: 'src/contour.ts',
    });
    expect(singularResult).toMatchObject({
      kind: 'needs-review',
      reason: 'ast-string-literal-review-position',
    });
    const pluralResult = entitiesLiteralClass.apply(source, {
      path: 'src/contour.ts',
    });
    expect(pluralResult).toMatchObject({
      kind: 'needs-review',
      reason: 'ast-string-literal-review-position',
    });
    const payloadResult = entityLiteralClass.apply(
      'const apiPayload = { kind: "contour" };',
      { path: 'src/api.ts' }
    );
    expect(payloadResult).toMatchObject({
      kind: 'needs-review',
      reason: 'ast-string-literal-review-position',
    });
    const wayfindResult = wayfindLiteralClass.apply(source, {
      path: 'src/contour.ts',
    });

    expect(wayfindResult.kind).toBe('rewrite');
    expect(wayfindResult.nextSource).toBe(
      [
        'const singular = "contour";',
        "const plural = 'contours';",
        "ctx.compose('wayfind.entities', { contours });",
        'const prose = "contourSummarySchema contoursList wayfind.contours.extra";',
        'const idioms = ["counter-contour", "contoured", "contouring", "Contour"];',
        '',
      ].join('\n')
    );

    expect(
      wayfindLiteralClass.apply(
        'const resolved = require.resolve("wayfind.contours");',
        { path: 'src/module-route.ts' }
      )
    ).toMatchObject({
      kind: 'needs-review',
      reason: 'ast-string-literal-module-specifier',
    });

    for (const mockSource of [
      'jest.createMockFromModule("wayfind.contours");',
      'jest.doMock("wayfind.contours");',
      'jest.genMockFromModule("wayfind.contours");',
      'jest.mock("wayfind.contours");',
      'jest.requireActual("wayfind.contours");',
      'jest.requireMock("wayfind.contours");',
      'jest.unmock("wayfind.contours");',
      'vi.doMock("wayfind.contours");',
      'vi.doUnmock("wayfind.contours");',
      'vi.importActual("wayfind.contours");',
      'vi.importMock("wayfind.contours");',
      'vi.mock("wayfind.contours");',
      'vi.unmock("wayfind.contours");',
      'mock.module("wayfind.contours");',
      'Bun.mock.module("wayfind.contours");',
    ]) {
      expect(
        wayfindLiteralClass.apply(mockSource, {
          path: 'src/module-mock.ts',
        })
      ).toMatchObject({
        kind: 'needs-review',
        reason: 'ast-string-literal-module-specifier',
      });
    }

    for (const moduleSource of [
      'import { contour } from "contour";',
      'export { contour } from "contour";',
      "type ContourModule = import('contour').Contour;",
      "type ContourModule = typeof import('contour');",
      'declare module "contour" {}',
      'import contourModule = require("contour");',
      'const contourModule = require("contour");',
    ]) {
      expect(
        entityLiteralClass.apply(moduleSource, {
          path: 'src/module-route.ts',
        })
      ).toMatchObject({
        kind: 'needs-review',
        reason: 'ast-string-literal-module-specifier',
      });
    }
  });

  test('rewrites governed package route import specifiers and exact strings only', () => {
    const transition = getGovernedVocabularyTransition('v1-warden-ast-source');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected warden ast package route transition.');
    }

    const classes = createGovernedAstIdentifierRenameClasses(transition);
    const routeLiteralClass = classes.find((cls) =>
      cls.id.includes(
        'ast-string-literal-rename:v1-warden-ast-source:@ontrails/warden/ast->@ontrails/source'
      )
    );
    expect(routeLiteralClass).toBeDefined();
    if (routeLiteralClass === undefined) {
      throw new Error('Expected warden ast route literal rename class.');
    }

    const source = [
      "import { parse } from '@ontrails/warden/ast';",
      "export { walk } from '@ontrails/warden/ast';",
      'const route = "@ontrails/warden/ast";',
      'const near = "@ontrails/warden/ast-extra";',
      'const larger = "use @ontrails/warden/ast here";',
      "import { parse as parseSource } from '@ontrails/source';",
      '',
    ].join('\n');

    const result = routeLiteralClass.apply(source, {
      package: {
        dependencies: ['@ontrails/source'],
        name: 'consumer',
        path: 'package.json',
      },
      path: 'src/source.ts',
    });

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        "import { parse } from '@ontrails/source';",
        "export { walk } from '@ontrails/source';",
        'const route = "@ontrails/source";',
        'const near = "@ontrails/warden/ast-extra";',
        'const larger = "use @ontrails/warden/ast here";',
        "import { parse as parseSource } from '@ontrails/source';",
        '',
      ].join('\n')
    );

    const templateResult = routeLiteralClass.apply(
      [
        'const route = `@ontrails/warden/ast`;',
        'const loaded = import(`@ontrails/warden/ast`);',
        '',
      ].join('\n'),
      {
        package: {
          dependencies: ['@ontrails/source'],
          name: 'consumer',
          path: 'package.json',
          runtimeDependencies: ['@ontrails/source'],
        },
        path: 'src/templates.ts',
      }
    );
    expect(templateResult.kind).toBe('rewrite');
    expect(templateResult.nextSource).toBe(
      [
        'const route = `@ontrails/source`;',
        'const loaded = import(`@ontrails/source`);',
        '',
      ].join('\n')
    );

    for (const adjacentRoute of [
      '@ontrails/warden/ast/utils',
      '@ontrails/warden/ast.js',
      '@ontrails/warden/ast.utils',
    ]) {
      const adjacentResult = routeLiteralClass.apply(
        `import value from '${adjacentRoute}';`,
        {
          package: {
            dependencies: ['@ontrails/source'],
            name: 'consumer',
            path: 'package.json',
          },
          path: 'src/source.ts',
        }
      );
      expect(adjacentResult).toMatchObject({
        kind: 'needs-review',
        reason: 'ast-string-literal-adjacent-module-route',
      });
      expect(adjacentResult.reviewDetails?.[0]).toMatchObject({
        matchedForm: adjacentRoute,
      });
    }

    for (const helperSource of [
      "require.resolve('@ontrails/warden/ast/utils');",
      "jest.mock('@ontrails/warden/ast/utils');",
      "vi.mock('@ontrails/warden/ast/utils');",
    ]) {
      expect(
        routeLiteralClass.apply(helperSource, {
          package: {
            dependencies: ['@ontrails/source'],
            name: 'consumer',
            path: 'package.json',
          },
          path: 'src/source.ts',
        })
      ).toMatchObject({
        kind: 'needs-review',
        reason: 'ast-string-literal-adjacent-module-route',
      });
    }

    const inventedPlural = routeLiteralClass.apply(
      "import value from '@ontrails/warden/asts';",
      {
        package: {
          dependencies: ['@ontrails/source'],
          name: 'consumer',
          path: 'package.json',
        },
        path: 'src/source.ts',
      }
    );
    expect(inventedPlural.kind).toBe('no-op');

    const missingDependency = routeLiteralClass.apply(source, {
      package: {
        dependencies: ['@ontrails/warden'],
        name: 'consumer',
        path: 'package.json',
      },
      path: 'src/source.ts',
    });
    expect(missingDependency).toMatchObject({
      kind: 'needs-review',
      reason: 'package-route-target-dependency-unverified',
    });
    expect(missingDependency.reviewDetails?.[0]).toMatchObject({
      candidateReplacement: '@ontrails/source',
      expectedTarget: expect.stringContaining(
        'Declare "@ontrails/source" in package.json'
      ),
    });

    const devOnlyDependency = routeLiteralClass.apply(
      "import { parse } from '@ontrails/warden/ast';",
      {
        package: {
          dependencies: ['@ontrails/source'],
          name: 'consumer',
          path: 'package.json',
          runtimeDependencies: [],
        },
        path: 'src/source.ts',
      }
    );
    expect(devOnlyDependency).toMatchObject({
      kind: 'needs-review',
      reason: 'package-route-target-dependency-unverified',
    });

    const testOnlyDependency = routeLiteralClass.apply(
      "import { parse } from '@ontrails/warden/ast';",
      {
        package: {
          dependencies: ['@ontrails/source'],
          name: 'consumer',
          path: 'package.json',
          runtimeDependencies: [],
        },
        path: 'src/__tests__/source.test.ts',
      }
    );
    expect(testOnlyDependency.kind).toBe('rewrite');

    const preservingClasses = createGovernedAstIdentifierRenameClasses(
      transition,
      {
        shouldPreserve: (occurrence) =>
          occurrence.path === 'src/preserved.ts' &&
          occurrence.from === '@ontrails/warden/ast',
      }
    );
    const preservingRouteClass = preservingClasses.find((cls) =>
      cls.id.includes(
        'ast-string-literal-rename:v1-warden-ast-source:@ontrails/warden/ast->@ontrails/source'
      )
    );
    expect(preservingRouteClass).toBeDefined();
    if (preservingRouteClass === undefined) {
      throw new Error('Expected preserving package route rename class.');
    }
    const preservedMissingDependency = preservingRouteClass.apply(
      "import { parse } from '@ontrails/warden/ast';",
      {
        package: {
          dependencies: ['@ontrails/warden'],
          name: 'consumer',
          path: 'package.json',
        },
        path: 'src/preserved.ts',
      }
    );
    expect(preservedMissingDependency.kind).toBe('no-op');

    const adjacentInPreservedPath = preservingRouteClass.apply(
      "import value from '@ontrails/warden/ast/utils';",
      {
        package: {
          dependencies: ['@ontrails/source'],
          name: 'consumer',
          path: 'package.json',
        },
        path: 'src/preserved.ts',
      }
    );
    expect(adjacentInPreservedPath).toMatchObject({
      kind: 'needs-review',
      reason: 'ast-string-literal-adjacent-module-route',
    });
    expect(adjacentInPreservedPath.reviewDetails?.[0]).toMatchObject({
      matchedForm: '@ontrails/warden/ast/utils',
    });

    const invalidManifest = routeLiteralClass.apply(
      "import { parse } from '@ontrails/warden/ast';",
      {
        package: {
          dependencies: [],
          manifestState: 'invalid',
          path: 'package.json',
        },
        path: 'src/source.ts',
      }
    );
    expect(invalidManifest).toMatchObject({
      kind: 'needs-review',
      reason: 'package-route-target-dependency-unverified',
    });
    expect(invalidManifest.reviewDetails?.[0]).toMatchObject({
      expectedTarget: expect.stringContaining(
        'Fix invalid package manifest package.json'
      ),
      signals: expect.arrayContaining(['package:manifest-invalid']),
    });
  });

  test('requires explicit governed package route intent for scoped literals', () => {
    const transition = governedVocabularyTransitionSchema.parse({
      docs: {
        summary: 'A scoped label changes without owning a package route.',
      },
      from: '@example/internal-label',
      id: 'scoped-label-transition',
      intent: 'Rename a scoped label without changing module routes.',
      kind: 'vocabulary',
      oldForms: ['@example/internal-label'],
      status: 'active',
      stringLiteralRenames: [
        { from: '@example/internal-label', to: '@example/new-label' },
      ],
      target: { kind: 'single', to: '@example/new-label' },
    });
    const literalClass = createGovernedAstIdentifierRenameClasses(
      transition
    ).find((cls) => cls.id.startsWith('ast-string-literal-rename:'));

    expect(literalClass).toBeDefined();
    expect(
      literalClass?.apply("import value from '@example/internal-label';", {
        path: 'src/label.ts',
      })
    ).toMatchObject({
      kind: 'needs-review',
      reason: 'ast-string-literal-module-specifier',
    });
  });

  test('orders exact package subpath rewrites before package roots', () => {
    const transition = governedVocabularyTransitionSchema.parse({
      docs: { summary: 'Move one package and its public subpath.' },
      from: '@example/old',
      id: 'package-route-order',
      intent: 'Move exact package routes without losing subpath rewrites.',
      kind: 'vocabulary',
      oldForms: ['@example/old', '@example/old/support'],
      status: 'active',
      stringLiteralRenames: [
        {
          from: '@example/old',
          moduleSpecifier: { targetPackage: '@example/new' },
          to: '@example/new',
        },
        {
          from: '@example/old/support',
          moduleSpecifier: { targetPackage: '@example/new' },
          to: '@example/new/support',
        },
      ],
      target: { kind: 'single', to: '@example/new' },
    });
    const literalClasses = createGovernedAstIdentifierRenameClasses(
      transition
    ).filter((cls) => cls.id.startsWith('ast-string-literal-rename:'));

    expect(literalClasses.map((cls) => cls.id)).toEqual([
      'ast-string-literal-rename:package-route-order:@example/old/support->@example/new/support',
      'ast-string-literal-rename:package-route-order:@example/old->@example/new',
    ]);
    expect(
      literalClasses[0]?.apply("import value from '@example/old/support';", {
        package: {
          dependencies: ['@example/new'],
          path: 'package.json',
        },
        path: 'src/source.ts',
      })
    ).toMatchObject({
      kind: 'rewrite',
      nextSource: "import value from '@example/new/support';",
    });
  });

  test('rewrites the retired Wayfinder package route in module specifiers only', () => {
    const transition = getGovernedVocabularyTransition(
      'v1-wayfinder-topography'
    );
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected Wayfinder package route transition.');
    }

    const routeLiteralClass = createGovernedAstIdentifierRenameClasses(
      transition
    ).find((cls) =>
      cls.id.includes(
        'ast-string-literal-rename:v1-wayfinder-topography:@ontrails/wayfinder->@ontrails/topography'
      )
    );
    if (routeLiteralClass === undefined) {
      throw new Error('Expected Wayfinder route literal rename class.');
    }

    const source = [
      "import { wayfindOverviewTrail } from '@ontrails/wayfinder';",
      "export * from '@ontrails/wayfinder';",
      "const product = 'Wayfinder remains Wayfind';",
      '',
    ].join('\n');
    const result = routeLiteralClass.apply(source, {
      package: {
        dependencies: ['@ontrails/topography'],
        name: 'consumer',
        path: 'package.json',
      },
      path: 'src/wayfind.ts',
    });

    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe(
      [
        "import { wayfindOverviewTrail } from '@ontrails/topography';",
        "export * from '@ontrails/topography';",
        "const product = 'Wayfinder remains Wayfind';",
        '',
      ].join('\n')
    );

    const adjacentResult = routeLiteralClass.apply(
      "const internal = '@ontrails/wayfinder/internal';",
      {
        package: {
          dependencies: ['@ontrails/topography'],
          name: 'consumer',
          path: 'package.json',
        },
        path: 'src/wayfind.ts',
      }
    );
    expect(adjacentResult).toMatchObject({
      kind: 'needs-review',
      reason: 'ast-string-literal-adjacent-module-route',
    });
    expect(adjacentResult.reviewDetails?.[0]).toMatchObject({
      matchedForm: '@ontrails/wayfinder/internal',
    });
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
        "import { composeRef } from './composition';",
        'export const current = composeRef;',
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
