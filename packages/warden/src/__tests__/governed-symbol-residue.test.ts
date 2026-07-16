import { describe, expect, test } from 'bun:test';

import { governedSymbolResidue } from '../rules/governed-symbol-residue.js';
import type { ProjectContext } from '../rules/types.js';

const check = (sourceCode: string) =>
  governedSymbolResidue.check(sourceCode, '/repo/src/example.ts');

const projectContext = (
  overrides: Partial<ProjectContext> = {}
): ProjectContext => ({
  knownTrailIds: new Set(),
  ...overrides,
});

describe('governed-symbol-residue', () => {
  test('cites committed history when a governed symbol is reintroduced', () => {
    const diagnostics = governedSymbolResidue.checkWithContext(
      'const contourId = "invoice";\n',
      '/repo/src/example.ts',
      projectContext({
        governedVocabularyHistoryByTransitionId: new Map([
          [
            'v1-contour-entity',
            {
              caseSensitive: true,
              id: 'history-id',
              latestFormObservations: [],
              path: '.trails/regrade/history/contour-to-entity.json',
              runCount: 2,
              transitionId: 'v1-contour-entity',
            },
          ],
        ]),
      })
    );

    expect(diagnostics[0]?.message).toContain(
      "governed transition 'v1-contour-entity'"
    );
    expect(diagnostics[0]?.message).toContain(
      '.trails/regrade/history/contour-to-entity.json'
    );
    expect(diagnostics[0]?.message).toContain('history-id');
  });

  test('fails invalid committed provenance once at the project boundary', () => {
    const diagnostics = governedSymbolResidue.checkProject?.(
      projectContext({
        governedVocabularyHistoryIssues: [
          {
            message:
              'Committed Regrade history lacks required governed provenance.',
            path: '.trails/regrade/history/projection-to-derive.json',
            transitionId: 'v1-projection-derive-render',
          },
        ],
      })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '.trails/regrade/history/projection-to-derive.json',
        line: 1,
        message:
          'Committed Regrade history lacks required governed provenance.',
        rule: 'governed-symbol-residue',
        severity: 'error',
      },
    ]);
  });

  test('requires missing migration proof only in the registry-owning workspace', () => {
    const downstream = governedSymbolResidue.checkProject?.(
      projectContext({
        governedVocabularyHistoryByTransitionId: new Map(),
        governedVocabularyHistoryRequired: false,
      })
    );
    const owner = governedSymbolResidue.checkProject?.(
      projectContext({
        governedVocabularyHistoryByTransitionId: new Map(),
        governedVocabularyHistoryRequired: true,
      })
    );

    expect(downstream).toEqual([]);
    expect(owner).toEqual([
      expect.objectContaining({
        filePath: '<governed-vocabulary-history>',
        message: expect.stringContaining('v1-projection-derive-render'),
        rule: 'governed-symbol-residue',
        severity: 'error',
      }),
    ]);
  });

  test('does not duplicate cross-compose fixes owned by the beta.19 rule', () => {
    const diagnostics = check(
      [
        'const crossInput = { id: "track" };',
        'export const run = () => ctx.cross(loadTrack, crossInput);',
        '',
      ].join('\n')
    );

    expect(diagnostics).toEqual([]);
  });

  test('flags completed v1 symbols without flagging prose or strings', () => {
    const diagnostics = check(
      [
        'const message = "crossInput and ctx.cross in prose";',
        'const facet = "retired but string-safe";',
        'const facets = ["retired but string-safe"];',
        '',
      ].join('\n')
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        fix: expect.objectContaining({
          class: 'term-rewrite',
          edits: [{ end: 64, replacement: 'trailhead', start: 59 }],
          safety: 'safe',
        }),
        line: 2,
        message:
          "Retired governed symbol 'facet' should migrate to 'trailhead'.",
        rule: 'governed-symbol-residue',
        severity: 'error',
      }),
      expect.objectContaining({
        fix: expect.objectContaining({
          class: 'term-rewrite',
          edits: [{ end: 106, replacement: 'trailheads', start: 100 }],
          safety: 'safe',
        }),
        line: 3,
        message:
          "Retired governed symbol 'facets' should migrate to 'trailheads'.",
        rule: 'governed-symbol-residue',
        severity: 'error',
      }),
    ]);
  });

  test('preserves exact rename behavior for non-segment transitions', () => {
    const source = [
      'const facetId = "trailhead-1";',
      'const surfaceFacetId = "not a configured exact rename";',
      '',
    ].join('\n');
    const diagnostics = check(source);
    const start = source.indexOf('facetId');

    expect(diagnostics).toEqual([
      expect.objectContaining({
        fix: expect.objectContaining({
          class: 'term-rewrite',
          edits: [
            {
              end: start + 'facetId'.length,
              replacement: 'trailheadId',
              start,
            },
          ],
          safety: 'safe',
        }),
        line: 1,
        message:
          "Retired governed symbol 'facetId' should migrate to 'trailheadId'.",
        rule: 'governed-symbol-residue',
        severity: 'error',
      }),
    ]);
  });

  test('flags identifier-segment governed symbols with whole-identifier fixes', () => {
    const source = [
      'const contourId = "invoice";',
      'const wayfindContoursTrail = () => contourId;',
      'const CONTOUR_STATE = true;',
      'const CONTOURS_STATE = true;',
      '',
    ].join('\n');
    const diagnostics = check(source);
    const contourIdStart = source.indexOf('contourId');
    const wayfindStart = source.indexOf('wayfindContoursTrail');
    const contourStateStart = source.indexOf('CONTOUR_STATE');
    const contoursStateStart = source.indexOf('CONTOURS_STATE');

    expect(diagnostics).toEqual([
      expect.objectContaining({
        fix: expect.objectContaining({
          edits: [
            {
              end: contourIdStart + 'contourId'.length,
              replacement: 'entityId',
              start: contourIdStart,
            },
          ],
          safety: 'safe',
        }),
        line: 1,
        message:
          "Retired governed symbol 'contourId' should migrate to 'entityId'.",
      }),
      expect.objectContaining({
        fix: expect.objectContaining({
          edits: [
            {
              end: wayfindStart + 'wayfindContoursTrail'.length,
              replacement: 'wayfindEntitiesTrail',
              start: wayfindStart,
            },
          ],
          safety: 'safe',
        }),
        line: 2,
        message:
          "Retired governed symbol 'wayfindContoursTrail' should migrate to 'wayfindEntitiesTrail'.",
      }),
      expect.objectContaining({
        fix: expect.objectContaining({
          edits: [
            {
              end: source.lastIndexOf('contourId') + 'contourId'.length,
              replacement: 'entityId',
              start: source.lastIndexOf('contourId'),
            },
          ],
          safety: 'safe',
        }),
        line: 2,
        message:
          "Retired governed symbol 'contourId' should migrate to 'entityId'.",
      }),
      expect.objectContaining({
        fix: expect.objectContaining({
          edits: [
            {
              end: contourStateStart + 'CONTOUR_STATE'.length,
              replacement: 'ENTITY_STATE',
              start: contourStateStart,
            },
          ],
          safety: 'safe',
        }),
        line: 3,
        message:
          "Retired governed symbol 'CONTOUR_STATE' should migrate to 'ENTITY_STATE'.",
      }),
      expect.objectContaining({
        fix: expect.objectContaining({
          edits: [
            {
              end: contoursStateStart + 'CONTOURS_STATE'.length,
              replacement: 'ENTITIES_STATE',
              start: contoursStateStart,
            },
          ],
          safety: 'safe',
        }),
        line: 4,
        message:
          "Retired governed symbol 'CONTOURS_STATE' should migrate to 'ENTITIES_STATE'.",
      }),
    ]);
  });

  test('does not flag identifier substrings or inflected review forms', () => {
    const diagnostics = check(
      [
        'const discontour = true;',
        'const contouring = true;',
        'const contoured = true;',
        'const precontours = true;',
        '',
      ].join('\n')
    );

    expect(diagnostics).toEqual([]);
  });

  test('routes identifiers that already contain the target segment to review', () => {
    const diagnostics = check(
      [
        'const entityContour = true;',
        'const ENTITY_CONTOUR = entityContour;',
        '',
      ].join('\n')
    );

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.safety)).toEqual([
      'review',
      'review',
      'review',
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.edits)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(diagnostics[0]?.fix?.reason).toContain(
      "already contains target segment 'entity'"
    );
  });

  test('checks every target segment in a governed rename family', () => {
    const diagnostics = check('const entityContours = true;\n');

    expect(diagnostics).toEqual([
      expect.objectContaining({
        fix: expect.objectContaining({
          reason: expect.stringContaining(
            "already contains target segment 'entity'"
          ),
          safety: 'review',
        }),
        message:
          "Retired governed symbol 'entityContours' should migrate to 'entityEntities'.",
      }),
    ]);
    expect(diagnostics[0]?.fix?.edits).toBeUndefined();
  });

  test('routes FunctionParam identifier-segment declarations to review', () => {
    const source = [
      'function render(contourId: string) {',
      '  return contourId;',
      '}',
      '',
    ].join('\n');
    const diagnostics = check(source);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        fix: expect.objectContaining({
          class: 'term-rewrite',
          safety: 'review',
        }),
        line: 1,
        message:
          "Retired governed symbol 'contourId' should migrate to 'entityId'.",
      }),
      expect.objectContaining({
        fix: expect.objectContaining({
          class: 'term-rewrite',
          safety: 'review',
        }),
        line: 2,
        message:
          "Retired governed symbol 'contourId' should migrate to 'entityId'.",
      }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.fix?.edits)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test('routes every lifecycle-ambiguous bare projection symbol to review', () => {
    const diagnostics = check(
      [
        'export function projected() {',
        '  return projected();',
        '}',
        'const value = projected;',
        '',
      ].join('\n')
    );

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.safety)).toEqual([
      'review',
      'review',
      'review',
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.edits)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(
      diagnostics.every((diagnostic) =>
        diagnostic.fix?.reason.includes('requires semantic classification')
      )
    ).toBe(true);
  });

  test('routes lifecycle-ambiguous projection parameters to review', () => {
    const diagnostics = check(
      [
        'function consume(projected: string) {',
        '  return projected;',
        '}',
        '',
      ].join('\n')
    );

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.safety)).toEqual([
      'review',
      'review',
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.edits)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test('routes import and export boundary names to review', () => {
    for (const source of [
      "import { contourId } from 'external';\n",
      "import contourId from 'external';\n",
      "import * as contourId from 'external';\n",
      'export { localContourId as contourId };\n',
    ]) {
      const diagnostics = check(source);

      expect(diagnostics.length).toBeGreaterThan(0);
      expect(
        diagnostics.every(
          (diagnostic) =>
            diagnostic.fix?.safety === 'review' &&
            diagnostic.fix.edits === undefined &&
            diagnostic.fix.reason.includes('names an import or export boundary')
        )
      ).toBe(true);
    }
  });

  test('routes object keys and member properties to review', () => {
    const source = [
      'const contourId = "invoice";',
      'const payload = { contourId };',
      'const explicit = { contourId: contourId };',
      'export const current = payload.contourId;',
      '',
    ].join('\n');
    const diagnostics = check(source);
    const propertyDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.line !== 1
    );

    expect(diagnostics).toHaveLength(5);
    expect(
      diagnostics.every((diagnostic) => diagnostic.fix?.safety === 'review')
    ).toBe(true);
    expect(propertyDiagnostics).toHaveLength(4);
    expect(
      propertyDiagnostics.map((diagnostic) => diagnostic.fix?.safety)
    ).toEqual(['review', 'review', 'review', 'review']);
    expect(
      propertyDiagnostics.map((diagnostic) => diagnostic.fix?.reason)
    ).toEqual(
      Array.from({ length: 4 }, () =>
        expect.stringContaining(
          'participates in an authored shorthand property'
        )
      )
    );
  });

  test('routes standalone static member properties to review', () => {
    const diagnostics = check('export const current = payload.contourId;\n');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      fix: {
        class: 'term-rewrite',
        safety: 'review',
      },
    });
    expect(diagnostics[0]?.fix?.edits).toBeUndefined();
    expect(diagnostics[0]?.fix?.reason).toContain(
      'is a member property with no governed declaration'
    );
  });

  test('routes TypeScript property and method signatures to review', () => {
    const diagnostics = check(
      [
        'interface Payload {',
        '  contourId: string;',
        '  contourSummary(): string;',
        '}',
        '',
      ].join('\n')
    );

    expect(diagnostics).toHaveLength(2);
    expect(
      diagnostics.every((diagnostic) => diagnostic.fix?.safety === 'review')
    ).toBe(true);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.edits)).toEqual([
      undefined,
      undefined,
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.reason)).toEqual([
      expect.stringContaining('is an authored property key'),
      expect.stringContaining('is an authored property key'),
    ]);
  });

  test('routes accessor and abstract class member keys to review', () => {
    const diagnostics = check(
      [
        'abstract class Payload {',
        '  accessor contourAccessor: string;',
        '  abstract contourSummary(): string;',
        '  abstract contourValue: string;',
        '}',
        '',
      ].join('\n')
    );

    expect(diagnostics).toHaveLength(3);
    expect(
      diagnostics.every((diagnostic) => diagnostic.fix?.safety === 'review')
    ).toBe(true);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.edits)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.reason)).toEqual(
      Array.from({ length: 3 }, () =>
        expect.stringContaining('is an authored property key')
      )
    );
  });

  test('routes TypeScript constructor parameter properties to review', () => {
    const diagnostics = check(
      'class Payload { constructor(public contourParam: string) {} }\n'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.fix).toEqual(
      expect.objectContaining({
        reason: expect.stringContaining('is an authored property key'),
        safety: 'review',
      })
    );
    expect(diagnostics[0]?.fix?.edits).toBeUndefined();
  });

  test('allows the governed vocabulary registry to name retired symbols', () => {
    const diagnostics = governedSymbolResidue.check(
      [
        'const safeRewriteForms = [{ from: "crossInput", to: "composeInput" }];',
        'const reviewForms = [{ from: "crosses", to: "composes" }];',
        '',
      ].join('\n'),
      '/repo/packages/warden/src/rules/retired-vocabulary.ts'
    );

    expect(diagnostics).toEqual([]);
  });

  test('ignores parse failures because parser diagnostics belong elsewhere', () => {
    expect(check('export const = ;')).toEqual([]);
  });
});
