import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getGovernedVocabularyTransition } from '@ontrails/warden';

import {
  deriveVocabularyFormProposals,
  readVocabularyTransitionRecord,
  runVocabularyRegrade,
  transitionRecordReportWithSummary,
  vocabularyRegradePlanSchema,
  vocabularyTransitionRecordPath,
  writeVocabularyTransitionRecord,
} from '../vocabulary.js';
import {
  listVocabularyRegradePlansFromRegistry,
  vocabularyRegradePlanFromTransition,
  vocabularyRegradePlanForInput,
} from '../vocabulary-registry.js';

const makeTempDir = (): string =>
  mkdtempSync(join(tmpdir(), `trails-vocabulary-regrade-${Date.now()}-`));

const writeFile = (root: string, path: string, value: string): void => {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
};

describe('runVocabularyRegrade', () => {
  test('derives case-insensitive defers with runtime form identity', () => {
    const proposals = deriveVocabularyFormProposals({
      deferForms: ['Users'],
      from: 'user',
      kind: 'vocabulary',
      to: 'account',
    });

    expect(
      proposals.find((proposal) => proposal.from === 'users')
    ).toBeUndefined();
    expect(proposals.find((proposal) => proposal.from === 'Users')?.kind).toBe(
      'review'
    );
  });

  test('derives deterministic safe and review morphology from a minimal seed', () => {
    expect(
      deriveVocabularyFormProposals({
        deferForms: ['facetized'],
        from: 'facet',
        kind: 'vocabulary',
        overrides: { faceting: 'trailheading' },
        to: 'trailhead',
      })
    ).toEqual([
      {
        from: 'facet',
        kind: 'safe-rewrite',
        reason: 'minimal-seed',
        source: 'seed',
        to: 'trailhead',
      },
      {
        from: 'Facet',
        kind: 'review',
        reason: 'uncertain-casing-or-public-name',
        source: 'default-morphology',
        to: 'Trailhead',
      },
      {
        from: 'faceted',
        kind: 'review',
        reason: 'uncertain-morphology',
        source: 'default-morphology',
      },
      {
        from: 'faceting',
        kind: 'safe-rewrite',
        reason: 'authored-or-governed-override',
        source: 'plan-override',
        to: 'trailheading',
      },
      {
        from: 'facetized',
        kind: 'review',
        reason: 'authored-or-governed-defer',
        source: 'plan-defer',
      },
      {
        from: 'facets',
        kind: 'safe-rewrite',
        reason: 'default-morphology',
        source: 'default-morphology',
        to: 'trailheads',
      },
    ]);
  });

  test('runs single-target governed vocabulary transitions from the registry', () => {
    const transition = getGovernedVocabularyTransition('v1-facet-trailhead');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected facet vocabulary transition.');
    }
    const plan = vocabularyRegradePlanFromTransition(transition);
    expect(plan).toMatchObject({
      from: 'facet',
      id: 'v1-facet-trailhead',
      kind: 'vocabulary',
      preserve: [],
      scope: {
        exclude: expect.arrayContaining([
          '.scratch/**',
          '**/.scratch/**',
          '**/.tmp-tests/**',
        ]),
        policyClassified: [
          expect.objectContaining({
            disposition: 'historical-by-policy',
            paths: expect.arrayContaining([
              '.agents/plans/**',
              '.agents/goals/**',
              '.agents/memory/**',
              '.agents/notes/**',
              '.changeset/**',
              '.trails/regrade/*.json',
              '**/CHANGELOG.md',
              'docs/adr/0*.md',
              'packages/warden/src/rules/retired-vocabulary.ts',
            ]),
          }),
        ],
      },
      to: 'trailhead',
    });
    if (plan === null) {
      throw new Error('Expected single-target transition to produce a plan.');
    }

    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'export const facets = ["facet"];\nexport const Facet = "review";\nexport const facetId = "manual";\n'
      );

      const result = runVocabularyRegrade({
        plan: { ...plan, scope: { include: ['src/**/*.ts'] } },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.run.ledger.forms).toMatchObject({
        Facet: 'deferred',
        facet: 'modified',
        facetId: 'deferred',
        facets: 'modified',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps non-word governed sources exact instead of inventing plural forms', () => {
    const transition = getGovernedVocabularyTransition('v1-warden-ast-source');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected Warden AST package route transition.');
    }

    const plan = vocabularyRegradePlanFromTransition(transition);
    expect(plan).toMatchObject({
      from: '@ontrails/warden/ast',
      id: 'v1-warden-ast-source',
      kind: 'vocabulary',
      overrides: {
        '@ontrails/warden/ast': '@ontrails/source',
      },
      scope: {
        exclude: expect.arrayContaining(['.scratch/**']),
        policyClassified: [
          expect.objectContaining({
            disposition: 'historical-by-policy',
            paths: expect.arrayContaining([
              '.changeset/**',
              'packages/warden/src/rules/retired-vocabulary.ts',
            ]),
          }),
        ],
      },
      to: '@ontrails/source',
    });
    expect(plan?.overrides).not.toHaveProperty('@ontrails/warden/asts');
    if (plan === null) {
      throw new Error('Expected package route transition to produce a plan.');
    }

    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/route.md',
        'Use @ontrails/warden/ast for the shared source helpers. Then use @ontrails/warden/ast.\n'
      );
      writeFile(dir, 'docs/root-route.md', '@ontrails/warden/ast');
      writeFile(
        dir,
        'docs/api-reference.md',
        'The @ontrails/warden/ast helpers remain documented here.\n'
      );
      writeFile(
        dir,
        'docs/invented.md',
        'The invented @ontrails/warden/asts route must stay untouched.\n'
      );
      writeFile(
        dir,
        'scripts/verify-oxc-resolver-published.ts',
        "assertResolved(check, '@ontrails/warden/ast');\n"
      );
      writeFile(
        dir,
        'docs/suffixed.md',
        'Use @ontrails/warden/ast/utils for private helpers.\n'
      );
      writeFile(
        dir,
        'docs/dotted.md',
        'Keep @ontrails/warden/ast.js and @ontrails/warden/ast.utils untouched.\n'
      );
      writeFile(
        dir,
        'src/source.ts',
        "import { parse } from '@ontrails/warden/ast';\n"
      );
      writeFile(
        dir,
        'apps/trails/src/__tests__/regrade.test.ts',
        "const legacyRoute = '@ontrails/warden/ast';\n"
      );
      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          ...plan,
          scope: {
            include: ['apps/**', 'docs/**', 'scripts/**', 'src/**'],
          },
        },
        root: dir,
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.run.ledger.forms).toMatchObject({
        '@ontrails/warden/ast.js': 'deferred',
        '@ontrails/warden/ast.utils': 'deferred',
        '@ontrails/warden/ast/utils': 'deferred',
        '@ontrails/warden/asts': 'deferred',
      });
      expect(readFileSync(join(dir, 'docs', 'route.md'), 'utf8')).toBe(
        'Use @ontrails/source for the shared source helpers. Then use @ontrails/source.\n'
      );
      expect(readFileSync(join(dir, 'docs', 'root-route.md'), 'utf8')).toBe(
        '@ontrails/source'
      );
      expect(readFileSync(join(dir, 'docs', 'api-reference.md'), 'utf8')).toBe(
        'The @ontrails/source helpers remain documented here.\n'
      );
      expect(
        readFileSync(
          join(dir, 'scripts', 'verify-oxc-resolver-published.ts'),
          'utf8'
        )
      ).toBe("assertResolved(check, '@ontrails/warden/ast');\n");
      expect(readFileSync(join(dir, 'docs', 'invented.md'), 'utf8')).toBe(
        'The invented @ontrails/warden/asts route must stay untouched.\n'
      );
      expect(readFileSync(join(dir, 'docs', 'suffixed.md'), 'utf8')).toBe(
        'Use @ontrails/warden/ast/utils for private helpers.\n'
      );
      expect(readFileSync(join(dir, 'docs', 'dotted.md'), 'utf8')).toBe(
        'Keep @ontrails/warden/ast.js and @ontrails/warden/ast.utils untouched.\n'
      );
      expect(readFileSync(join(dir, 'src', 'source.ts'), 'utf8')).toBe(
        "import { parse } from '@ontrails/warden/ast';\n"
      );
      expect(result.value.entries).toContainEqual(
        expect.objectContaining({
          outcome: 'needs-review',
          path: 'src/source.ts',
          reviewDetails: expect.arrayContaining([
            expect.objectContaining({
              reason: 'package-route-ast-required',
              symbol: '@ontrails/warden/ast',
            }),
          ]),
        })
      );
      expect(result.value.run.ledger.occurrences).toContainEqual(
        expect.objectContaining({
          disposition: 'explicit-preserve',
          path: 'apps/trails/src/__tests__/regrade.test.ts',
          verdict: 'skipped',
        })
      );
      expect(result.value.entries).not.toContainEqual(
        expect.objectContaining({
          path: 'apps/trails/src/__tests__/regrade.test.ts',
        })
      );
      expect(
        readFileSync(
          join(dir, 'apps/trails/src/__tests__/regrade.test.ts'),
          'utf8'
        )
      ).toBe("const legacyRoute = '@ontrails/warden/ast';\n");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers package routes across the full JS and TS extension family', () => {
    const transition = getGovernedVocabularyTransition('v1-warden-ast-source');
    const plan =
      transition === undefined
        ? null
        : vocabularyRegradePlanFromTransition(transition);
    if (plan === null) {
      throw new Error('Expected package route transition to produce a plan.');
    }

    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/config.cts',
        "const source = require('@ontrails/warden/ast');\n"
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          ...plan,
          scope: { extensions: ['.cts'], include: ['src/**'] },
        },
        root: dir,
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      expect(result.value.entries).toContainEqual(
        expect.objectContaining({
          outcome: 'needs-review',
          path: 'src/config.cts',
          reviewDetails: expect.arrayContaining([
            expect.objectContaining({
              reason: 'package-route-ast-required',
              symbol: '@ontrails/warden/ast',
            }),
          ]),
        })
      );
      expect(readFileSync(join(dir, 'src/config.cts'), 'utf8')).toBe(
        "const source = require('@ontrails/warden/ast');\n"
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('moves the exact Wayfinder package route without rewriting near routes', () => {
    const transition = getGovernedVocabularyTransition(
      'v1-wayfinder-topography'
    );
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected Wayfinder package route transition.');
    }

    const plan = vocabularyRegradePlanFromTransition(transition);
    expect(plan).toMatchObject({
      from: '@ontrails/wayfinder',
      id: 'v1-wayfinder-topography',
      overrides: {
        '@ontrails/wayfinder': '@ontrails/topography',
      },
      to: '@ontrails/topography',
    });
    expect(plan?.overrides).not.toHaveProperty('@ontrails/wayfinders');
    if (plan === null) {
      throw new Error('Expected package route transition to produce a plan.');
    }

    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/routes.md',
        [
          'Move @ontrails/wayfinder to its new package.',
          'Keep @ontrails/wayfinder/internal for review.',
          'Keep @ontrails/wayfinders untouched.',
          '',
        ].join('\n')
      );
      const result = runVocabularyRegrade({
        apply: true,
        plan: { ...plan, scope: { include: ['docs/**'] } },
        root: dir,
      });
      if (result.isErr()) {
        throw result.error;
      }

      expect(readFileSync(join(dir, 'docs', 'routes.md'), 'utf8')).toBe(
        [
          'Move @ontrails/topography to its new package.',
          'Keep @ontrails/wayfinder/internal for review.',
          'Keep @ontrails/wayfinders untouched.',
          '',
        ].join('\n')
      );
      expect(result.value.run.ledger.forms).toMatchObject({
        '@ontrails/wayfinder/internal': 'deferred',
        '@ontrails/wayfinders': 'deferred',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('routes package manifest vocabulary rewrites to structured review', () => {
    const plan = {
      from: '@ontrails/wayfinder',
      id: 'test-package-route',
      kind: 'vocabulary' as const,
      overrides: {
        '@ontrails/wayfinder': '@ontrails/topographer',
      },
      to: '@ontrails/topographer',
    };

    const dir = makeTempDir();
    const manifest = `${JSON.stringify(
      {
        dependencies: {
          '@ontrails/topographer': 'workspace:^',
          '@ontrails/wayfinder': 'workspace:^',
        },
        name: 'consumer',
      },
      null,
      2
    )}\n`;
    try {
      writeFile(dir, 'packages/consumer/package.json', manifest);
      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          ...plan,
          scope: { include: ['packages/**/package.json'] },
        },
        root: dir,
      });
      if (result.isErr()) {
        throw result.error;
      }

      expect(
        readFileSync(join(dir, 'packages/consumer/package.json'), 'utf8')
      ).toBe(manifest);
      expect(result.value.entries).toContainEqual(
        expect.objectContaining({
          outcome: 'needs-review',
          path: 'packages/consumer/package.json',
          reviewDetails: expect.arrayContaining([
            expect.objectContaining({
              reason: 'package-manifest-structured-edit-required',
              symbol: '@ontrails/wayfinder',
            }),
          ]),
        })
      );
      expect(result.value.run.report).toMatchObject({
        applied: 0,
        deferred: 1,
        filesChanged: 0,
        gate: { status: 'open' },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('does not turn classified vocabulary transitions into unsafe plans', () => {
    const transition = getGovernedVocabularyTransition(
      'v1-projection-derive-render'
    );
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected projection vocabulary transition.');
    }

    expect(vocabularyRegradePlanFromTransition(transition)).toBeNull();
  });

  test('seeds classified registry transitions as review-only plans', () => {
    expect(vocabularyRegradePlanForInput('projection', 'derive')).toMatchObject(
      {
        deferForms: [
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
        from: 'projection',
        id: 'v1-projection-derive-render',
        intent:
          'Split projection vocabulary into derive/render by lifecycle stage for v1.',
        kind: 'vocabulary',
        scope: {
          policyClassified: expect.arrayContaining([
            expect.objectContaining({ paths: ['docs/adr/0*.md'] }),
          ]),
          teachingSurfaces: ['docs/**'],
        },
        to: 'derive',
      }
    );
    expect(
      vocabularyRegradePlanForInput('projection', 'derive')?.overrides
    ).toBeUndefined();
    expect(vocabularyRegradePlanForInput('projection', 'unknown')).toBeNull();

    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/category.md',
        [
          'Projected facts are presented.',
          'Use the project root consistently.',
          'The tooling runs within the project.',
          'The project metadata remains authored.',
          'How do completions project when a group is editorial?',
        ].join('\n')
      );
      const plan = vocabularyRegradePlanForInput('projection', 'derive');
      if (plan === null) {
        throw new Error('Expected classified projection plan.');
      }
      const report = runVocabularyRegrade({
        plan: { ...plan, scope: { include: ['docs/**'] } },
        root: dir,
      });
      expect(report.isOk()).toBe(true);
      if (report.isErr()) {
        throw report.error;
      }
      expect(report.value.run.ledger.occurrences).toContainEqual(
        expect.objectContaining({ form: 'Projected', verdict: 'deferred' })
      );
      expect(
        report.value.run.ledger.occurrences
          .filter((occurrence) => occurrence.form === 'project')
          .map((occurrence) => ({
            disposition: occurrence.disposition,
            verdict: occurrence.verdict,
          }))
      ).toEqual([
        { disposition: 'explicit-preserve', verdict: 'skipped' },
        { disposition: 'explicit-preserve', verdict: 'skipped' },
        { disposition: 'explicit-preserve', verdict: 'skipped' },
        { disposition: 'in-family-unresolved', verdict: 'deferred' },
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('does not turn review-only registry defaults into unsafe plans', () => {
    const transition = getGovernedVocabularyTransition('cross-compose');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected cross vocabulary transition.');
    }

    expect(vocabularyRegradePlanFromTransition(transition)).toBeNull();
    expect(
      listVocabularyRegradePlansFromRegistry().map((plan) => plan.id)
    ).not.toContain('cross-compose');
  });

  test('keeps active migration guide vocabulary inside the completion gate', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/migration/layer-evolution.md',
        'Layer input schemas project automatically onto every surface.\n'
      );
      const plan = vocabularyRegradePlanForInput('projection', 'derive');
      if (plan === null) {
        throw new Error('Expected classified projection plan.');
      }

      const report = runVocabularyRegrade({ plan, root: dir });
      expect(report.isOk()).toBe(true);
      if (report.isErr()) {
        throw report.error;
      }

      expect(report.value.run.ledger.occurrences).toContainEqual(
        expect.objectContaining({
          disposition: 'in-family-unresolved',
          form: 'project',
          path: 'docs/migration/layer-evolution.md',
          scopeTier: 'in-scope',
          verdict: 'deferred',
        })
      );
      expect(report.value.run.report.gate.status).toBe('open');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('registry-generated plans preserve review forms as deferred inventory', () => {
    const transition = getGovernedVocabularyTransition(
      'v1-blaze-implementation'
    );
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected blaze vocabulary transition.');
    }
    const plan = vocabularyRegradePlanFromTransition(transition);
    if (plan === null) {
      throw new Error(
        'Expected blaze vocabulary transition to produce a plan.'
      );
    }
    expect(plan).toMatchObject({
      from: 'blaze',
      id: 'v1-blaze-implementation',
      kind: 'vocabulary',
      scope: {
        exclude: expect.arrayContaining(['.scratch/**']),
        policyClassified: [
          expect.objectContaining({
            paths: expect.arrayContaining([
              'packages/warden/src/rules/retired-vocabulary.ts',
            ]),
          }),
        ],
      },
      to: 'implementation',
    });
    expect(plan.deferForms).toContain('blazing');

    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/blaze.ts',
        'export const blaze = "safe";\nexport const blazing = "review";\n'
      );

      const result = runVocabularyRegrade({
        plan: { ...plan, scope: { include: ['src/**/*.ts'] } },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.run.ledger.forms).toMatchObject({
        blaze: 'modified',
        blazing: 'deferred',
      });
      expect(result.value.run.report.gate.status).toBe('open');
      expect(result.value.run.report.gate.reasons).toContain(
        'deferred-forms-or-occurrences'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('registry historical preserves hide compounds only in historical paths', () => {
    const transition = getGovernedVocabularyTransition(
      'v1-blaze-implementation'
    );
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected blaze vocabulary transition.');
    }
    const plan = vocabularyRegradePlanFromTransition(transition);
    if (plan === null) {
      throw new Error(
        'Expected blaze vocabulary transition to produce a plan.'
      );
    }

    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        '.agents/plans/v1-vocabulary-plan.md',
        'Preserve blazeBody as authored historical planning evidence.\n'
      );
      writeFile(
        dir,
        'docs/live.md',
        'Current docs must still review blazeBody before migration closes.\n'
      );
      writeFile(
        dir,
        'packages/store/.agents/notes/history.md',
        'Nested agent notes keep the historical blazeBody untouched.\n'
      );

      const result = runVocabularyRegrade({
        plan: { ...plan, scope: { ...plan.scope, extensions: ['.md'] } },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.run.ledger.occurrences).toMatchObject([
        {
          form: 'blazeBody',
          path: '.agents/plans/v1-vocabulary-plan.md',
          verdict: 'skipped',
        },
        {
          form: 'blazeBody',
          path: 'docs/live.md',
          verdict: 'deferred',
        },
        {
          form: 'blazeBody',
          path: 'packages/store/.agents/notes/history.md',
          verdict: 'skipped',
        },
      ]);
      expect(result.value.run.report).toMatchObject({
        deferred: 1,
        gate: { status: 'open' },
        open: 1,
        skipped: 2,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('lets deferred forms take precedence over safe rewrite targets', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'export const facet = "facet";\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          deferForms: ['facet'],
          from: 'facet',
          kind: 'vocabulary',
          scope: { include: ['src/**/*.ts'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.run.ledger.forms).toEqual({ facet: 'deferred' });
      expect(
        result.value.run.ledger.occurrences.every(
          (occurrence) => occurrence.verdict === 'deferred'
        )
      ).toBe(true);
      expect(result.value.run.report).toMatchObject({
        deferred: 2,
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remaining: 2,
          status: 'open',
        },
        modified: 0,
        open: 2,
      });
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'export const facet = "facet";\n'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('dry-runs authored vocabulary plans into plan ledger report shape', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'export const facets = ["facet"];\nexport const facetId = "manual";\n'
      );

      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { include: ['src/**/*.ts'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.run?.plan).toMatchObject({
        from: 'facet',
        kind: 'vocabulary',
        to: 'trailhead',
      });
      expect(result.value?.run?.ledger.forms).toEqual({
        facet: 'modified',
        facetId: 'deferred',
        facets: 'modified',
      });
      expect(result.value?.run?.report).toMatchObject({
        applied: 0,
        deferred: 1,
        gate: {
          reasons: [
            'safe-modifications-not-yet-applied',
            'deferred-forms-or-occurrences',
          ],
          remaining: 3,
          status: 'open',
        },
        modified: 2,
        open: 3,
        skipped: 0,
      });
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'facet'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('writes transition records as stable history evidence', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'export const facet = "facet";\nexport const facetId = "manual";\n'
      );

      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          id: 'v1-facet-trailhead',
          kind: 'vocabulary',
          scope: { include: ['src/**/*.ts'] },
          to: 'trailhead',
        },
        root: dir,
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const recordPath = vocabularyTransitionRecordPath({
        root: dir,
        run: result.value.run,
      });
      expect(recordPath).toMatch(
        /^\.trails\/regrade\/history\/facet-to-trailhead-[a-f0-9]{7}\.json$/
      );

      const writeResult = writeVocabularyTransitionRecord({
        report: result.value,
        root: dir,
        status: 'candidate',
      });
      expect(writeResult.isOk()).toBe(true);
      if (writeResult.isErr()) {
        throw writeResult.error;
      }
      expect(writeResult.value.summary).toEqual({
        path: recordPath,
        schemaVersion: 1,
        status: 'candidate',
      });

      const readResult = readVocabularyTransitionRecord(
        join(dir, writeResult.value.summary.path)
      );
      expect(readResult.isOk()).toBe(true);
      if (readResult.isErr()) {
        throw readResult.error;
      }
      expect(readResult.value).toMatchObject({
        kind: 'vocabulary-transition-record',
        recordPath,
        schemaVersion: 1,
        transition: {
          from: 'facet',
          id: 'v1-facet-trailhead',
          to: 'trailhead',
        },
      });
      expect(readResult.value.report.record).toBeUndefined();

      const recordFile = join(dir, writeResult.value.summary.path);
      const legacyRecord = JSON.parse(readFileSync(recordFile, 'utf8')) as {
        report: {
          run: {
            ledger: { occurrences: Record<string, unknown>[] };
            report: Record<string, unknown>;
          };
        };
      };
      for (const occurrence of legacyRecord.report.run.ledger.occurrences) {
        delete occurrence.scopeTier;
      }
      delete legacyRecord.report.run.report.scopeTiers;
      delete legacyRecord.report.run.report.teachingSurfaces;
      writeFileSync(recordFile, `${JSON.stringify(legacyRecord, null, 2)}\n`);

      const legacyReadResult = readVocabularyTransitionRecord(recordFile);
      expect(legacyReadResult.isOk()).toBe(true);
      if (legacyReadResult.isErr()) {
        throw legacyReadResult.error;
      }
      expect(legacyReadResult.value.report.run?.ledger.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ scopeTier: 'in-scope' }),
        ])
      );
      expect(legacyReadResult.value.report.run?.report).toMatchObject({
        scopeTiers: { 'in-scope': 3, 'policy-classified': 0 },
        teachingSurfaces: { expected: [], missing: [], touched: [] },
      });

      expect(
        transitionRecordReportWithSummary(
          result.value,
          writeResult.value.summary
        ).record
      ).toEqual(writeResult.value.summary);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('rejects transition records with parallel report evidence', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'export const facet = "facet";\n');
      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { include: ['src/**/*.ts'] },
          to: 'trailhead',
        },
        root: dir,
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      const writeResult = writeVocabularyTransitionRecord({
        report: result.value,
        root: dir,
        status: 'candidate',
      });
      expect(writeResult.isOk()).toBe(true);
      if (writeResult.isErr()) {
        throw writeResult.error;
      }
      const recordFile = join(dir, writeResult.value.summary.path);
      const record = JSON.parse(readFileSync(recordFile, 'utf8')) as Record<
        string,
        unknown
      >;
      record.report = {
        ...(record.report as Record<string, unknown>),
        ledger: { competing: true },
      };
      writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);

      const readResult = readVocabularyTransitionRecord(recordFile);
      expect(readResult.isErr()).toBe(true);
      if (readResult.isErr()) {
        expect(readResult.error.constructor.name).toBe('ValidationError');
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('rejects transition record paths outside the root', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'export const facet = "facet";\n');
      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { include: ['src/**/*.ts'] },
          to: 'trailhead',
        },
        root: dir,
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const relativeEscape = writeVocabularyTransitionRecord({
        recordPath: '../outside.json',
        report: result.value,
        root: dir,
        status: 'candidate',
      });
      expect(relativeEscape.isErr()).toBe(true);
      const absoluteEscape = writeVocabularyTransitionRecord({
        recordPath: join(dirname(dir), 'outside.json'),
        report: result.value,
        root: dir,
        status: 'candidate',
      });
      expect(absoluteEscape.isErr()).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('discovers obvious prose morphology as deferred review inventory', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/blaze.md', 'blaze blazes blazed blazing\n');

      const result = runVocabularyRegrade({
        plan: {
          from: 'blaze',
          kind: 'vocabulary',
          scope: { extensions: ['.md'] },
          to: 'implementation',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.run?.ledger.forms).toEqual({
        blaze: 'modified',
        blazed: 'deferred',
        blazes: 'modified',
        blazing: 'deferred',
      });
      expect(
        result.value?.run?.ledger.occurrences.map((occurrence) => ({
          form: occurrence.form,
          reason: occurrence.reason,
          verdict: occurrence.verdict,
        }))
      ).toEqual([
        {
          form: 'blaze',
          reason: 'captured-form',
          verdict: 'modified',
        },
        { form: 'blazes', reason: 'captured-form', verdict: 'modified' },
        { form: 'blazed', reason: 'deferred-form', verdict: 'deferred' },
        { form: 'blazing', reason: 'deferred-form', verdict: 'deferred' },
      ]);
      expect(result.value?.run?.report).toMatchObject({
        deferred: 2,
        gate: {
          reasons: [
            'safe-modifications-not-yet-applied',
            'deferred-forms-or-occurrences',
          ],
          status: 'open',
        },
        modified: 2,
        open: 4,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('discovers derived morphology case-insensitively', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/blaze.md', 'Blaze Blazes Blazed Blazing\n');

      const result = runVocabularyRegrade({
        plan: {
          from: 'Blaze',
          kind: 'vocabulary',
          scope: { extensions: ['.md'] },
          to: 'Implementation',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.run?.ledger.forms).toEqual({
        Blaze: 'modified',
        Blazed: 'deferred',
        Blazes: 'modified',
        Blazing: 'deferred',
      });
      expect(result.value?.run?.report.gate.status).toBe('open');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('discovers stem-changing prose morphology as deferred review inventory', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/try.md', 'try tries tried trying\n');
      writeFile(dir, 'docs/die.md', 'die dies died dying\n');

      const tryResult = runVocabularyRegrade({
        plan: {
          from: 'try',
          kind: 'vocabulary',
          scope: { include: ['docs/try.md'] },
          to: 'attempt',
        },
        root: dir,
      });
      const dieResult = runVocabularyRegrade({
        plan: {
          from: 'die',
          kind: 'vocabulary',
          scope: { include: ['docs/die.md'] },
          to: 'expire',
        },
        root: dir,
      });

      expect(tryResult.isOk()).toBe(true);
      expect(dieResult.isOk()).toBe(true);
      if (tryResult.isErr()) {
        throw tryResult.error;
      }
      if (dieResult.isErr()) {
        throw dieResult.error;
      }
      expect(tryResult.value.run.ledger.forms).toEqual({
        tried: 'deferred',
        tries: 'modified',
        try: 'modified',
        trying: 'deferred',
      });
      expect(dieResult.value.run.ledger.forms).toEqual({
        die: 'modified',
        died: 'deferred',
        dies: 'modified',
        dying: 'deferred',
      });
      expect(tryResult.value.run.report.gate.status).toBe('open');
      expect(dieResult.value.run.report.gate.status).toBe('open');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('lets explicit overrides resolve derived deferred morphology', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/blaze.md',
        'blaze belongs here\nblazed belongs here\nblazing needs review\n'
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'blaze',
          kind: 'vocabulary',
          overrides: { blazed: 'implemented' },
          scope: { extensions: ['.md'] },
          to: 'implementation',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.apply).toMatchObject({
        applied: 2,
        filesChanged: 1,
        review: 1,
      });
      expect(result.value?.run?.ledger.forms).toEqual({
        blazing: 'deferred',
      });
      expect(
        result.value?.run?.ledger.occurrences.map((occurrence) => ({
          form: occurrence.form,
          verdict: occurrence.verdict,
        }))
      ).toEqual([
        { form: 'blaze', verdict: 'applied' },
        { form: 'blazed', verdict: 'applied' },
        { form: 'blazing', verdict: 'deferred' },
      ]);
      expect(readFileSync(join(dir, 'docs', 'blaze.md'), 'utf8')).toBe(
        'implementation belongs here\nimplemented belongs here\nblazing needs review\n'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('matches override forms case-insensitively when removing derived defers', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/blaze.md',
        'blaze belongs here\nblazed belongs here\nblazing needs review\n'
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'blaze',
          kind: 'vocabulary',
          overrides: { Blazed: 'implemented' },
          scope: { extensions: ['.md'] },
          to: 'implementation',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.apply).toMatchObject({
        applied: 2,
        filesChanged: 1,
        review: 1,
      });
      expect(result.value?.run?.ledger.forms).toEqual({
        blazing: 'deferred',
      });
      expect(readFileSync(join(dir, 'docs', 'blaze.md'), 'utf8')).toBe(
        'implementation belongs here\nimplemented belongs here\nblazing needs review\n'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('lets longer explicit overrides outrank overlapping derived defers', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/blaze.md',
        'the blazing trail is clear\nstandalone blazing needs review\n'
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'blaze',
          kind: 'vocabulary',
          overrides: { 'blazing trail': 'implementation trail' },
          scope: { extensions: ['.md'] },
          to: 'implementation',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
        review: 1,
      });
      expect(result.value?.run?.ledger.forms).toEqual({
        blazing: 'deferred',
      });
      expect(readFileSync(join(dir, 'docs', 'blaze.md'), 'utf8')).toBe(
        'the implementation trail is clear\nstandalone blazing needs review\n'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('honors include globs when collecting vocabulary sources', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/keep.md', 'facet\n');
      writeFile(dir, 'docs/skip.md', 'facet\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { extensions: ['.md'], include: ['docs/keep.*'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.skipsByReason).toMatchObject({
        'not-included-glob': 1,
      });
      expect(readFileSync(join(dir, 'docs', 'keep.md'), 'utf8')).toBe(
        'trailhead\n'
      );
      expect(readFileSync(join(dir, 'docs', 'skip.md'), 'utf8')).toBe(
        'facet\n'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('applies safe captures and preserves authored contexts', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/surface.md',
        'facet belongs here\nlegacy facet stays here\n'
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [
            { pattern: 'legacy facet', reason: 'documented old example' },
          ],
          scope: { extensions: ['.md'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
        review: 0,
        skipped: 1,
      });
      expect(result.value?.run?.report).toMatchObject({
        applied: 1,
        gate: { status: 'green' },
        modified: 0,
        open: 0,
        skipped: 1,
      });
      expect(
        result.value?.run?.ledger.occurrences.find(
          (occurrence) => occurrence.verdict === 'skipped'
        )
      ).not.toHaveProperty('replacement');
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        'trailhead belongs here\nlegacy facet stays here\n'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers markdown code contexts instead of treating them as safe prose', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/surface.md',
        [
          'facet prose should move.',
          'Inline `facet` should be reviewed.',
          '',
          '```ts',
          'facets: {',
          '  inspect: ["facet"],',
          '}',
          '```',
          '',
        ].join('\n')
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { extensions: ['.md'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        [
          'trailhead prose should move.',
          'Inline `facet` should be reviewed.',
          '',
          '```ts',
          'facets: {',
          '  inspect: ["facet"],',
          '}',
          '```',
          '',
        ].join('\n')
      );
      expect(
        result.value?.run?.ledger.occurrences.map((occurrence) => ({
          form: occurrence.form,
          reason: occurrence.reason,
          replacement: occurrence.replacement,
          verdict: occurrence.verdict,
        }))
      ).toEqual([
        {
          form: 'facet',
          reason: 'captured-form',
          replacement: 'trailhead',
          verdict: 'applied',
        },
        {
          form: 'facet',
          reason: 'markdown-code-context',
          replacement: undefined,
          verdict: 'deferred',
        },
        {
          form: 'facets',
          reason: 'markdown-code-context',
          replacement: undefined,
          verdict: 'deferred',
        },
        {
          form: 'facet',
          reason: 'markdown-code-context',
          replacement: undefined,
          verdict: 'deferred',
        },
      ]);
      expect(result.value?.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
        review: 1,
      });
      expect(result.value?.run?.report).toMatchObject({
        applied: 1,
        deferred: 3,
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remaining: 3,
          status: 'open',
        },
        modified: 0,
        open: 3,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers multi-backtick and blockquoted markdown code contexts', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/surface.md',
        [
          'Use ``facet`` as a literal.',
          '',
          '> ```ts',
          '> facet',
          '> ```',
          '',
        ].join('\n')
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { extensions: ['.md'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        [
          'Use ``facet`` as a literal.',
          '',
          '> ```ts',
          '> facet',
          '> ```',
          '',
        ].join('\n')
      );
      expect(
        result.value?.run?.ledger.occurrences.map((occurrence) => ({
          form: occurrence.form,
          reason: occurrence.reason,
          verdict: occurrence.verdict,
        }))
      ).toEqual([
        {
          form: 'facet',
          reason: 'markdown-code-context',
          verdict: 'deferred',
        },
        {
          form: 'facet',
          reason: 'markdown-code-context',
          verdict: 'deferred',
        },
      ]);
      expect(result.value?.run?.report).toMatchObject({
        applied: 0,
        deferred: 2,
        gate: { status: 'open' },
        modified: 0,
        open: 2,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('scopes path discovery before judging occurrences', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/keep.ts', 'export const facet = "facet";\n');
      writeFile(dir, 'test/skip.ts', 'export const facet = "facet";\n');

      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { exclude: ['test/**'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.scanned).toBe(1);
      expect(result.value?.skipsByReason).toMatchObject({
        'ignored-glob': 1,
      });
      expect(result.value?.run?.ledger.occurrences.map((o) => o.path)).toEqual([
        'src/keep.ts',
        'src/keep.ts',
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('scans and counts policy-classified changelog evidence without rewriting it', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'CHANGELOG.md', 'The facet API shipped in beta.\n');
      writeFile(dir, 'docs/current.md', 'Use the facet API.\n');
      writeFile(dir, '.trails/regrade/active.json', '{"from":"facet"}\n');
      writeFile(
        dir,
        '.trails/regrade/history/prior.json',
        '{"from":"facet"}\n'
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: {
            policyClassified: [
              {
                disposition: 'historical-by-policy',
                expectMatches: true,
                paths: [
                  '**/CHANGELOG.md',
                  'CHANGELOG.md',
                  '.trails/regrade/**',
                ],
                reason: 'Published changelog entries are immutable history.',
              },
            ],
            teachingSurfaces: ['docs/current.md'],
          },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).toBe(
        'The facet API shipped in beta.\n'
      );
      expect(readFileSync(join(dir, 'docs/current.md'), 'utf8')).toBe(
        'Use the trailhead API.\n'
      );
      expect(result.value?.run?.ledger.occurrences).toEqual([
        expect.objectContaining({
          disposition: 'historical-by-policy',
          path: '.trails/regrade/active.json',
          scopeTier: 'policy-classified',
          verdict: 'skipped',
        }),
        expect.objectContaining({
          disposition: 'historical-by-policy',
          path: 'CHANGELOG.md',
          scopeTier: 'policy-classified',
          verdict: 'skipped',
        }),
        expect.objectContaining({
          disposition: 'in-family-modified',
          path: 'docs/current.md',
          scopeTier: 'in-scope',
          verdict: 'applied',
        }),
      ]);
      expect(result.value?.run?.report).toMatchObject({
        dispositions: {
          'historical-by-policy': 2,
          'in-family-modified': 1,
        },
        gate: { status: 'green' },
        scopeTiers: { 'in-scope': 1, 'policy-classified': 2 },
        teachingSurfaces: {
          expected: ['docs/current.md'],
          missing: [],
          touched: ['docs/current.md'],
        },
      });
      const occurrenceCount = result.value?.run?.ledger.occurrences.length;
      const dispositionCount = Object.values(
        result.value?.run?.report.dispositions ?? {}
      ).reduce((total, count) => total + count, 0);
      const scopeTierCount = Object.values(
        result.value?.run?.report.scopeTiers ?? {}
      ).reduce((total, count) => total + count, 0);
      expect(dispositionCount).toBe(occurrenceCount);
      expect(scopeTierCount).toBe(occurrenceCount);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('does not count historical policy evidence as a touched teaching surface', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/adr/0050.md', 'The facet API is historical.\n');

      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: {
            policyClassified: [
              {
                disposition: 'historical-by-policy',
                paths: ['docs/adr/**'],
                reason: 'Published decisions are immutable history.',
              },
            ],
            teachingSurfaces: ['docs/**'],
          },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.run?.report).toMatchObject({
        gate: {
          reasons: ['expected-teaching-surfaces-missing'],
          status: 'open',
        },
        teachingSurfaces: {
          expected: ['docs/**'],
          missing: ['docs/**'],
          touched: [],
        },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps an explicit occurrence disposition inside a policy-classified path', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'CHANGELOG.md', 'The legacy facet API shipped.\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [
            {
              disposition: 'explicit-preserve',
              paths: ['CHANGELOG.md'],
              pattern: 'legacy facet',
              reason: 'This occurrence is a quoted historical API name.',
            },
          ],
          scope: {
            policyClassified: [
              {
                disposition: 'historical-by-policy',
                paths: ['CHANGELOG.md'],
                reason: 'Published changelog entries are immutable history.',
              },
            ],
          },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).toBe(
        'The legacy facet API shipped.\n'
      );
      expect(result.value?.run?.ledger.occurrences).toEqual([
        expect.objectContaining({
          disposition: 'explicit-preserve',
          path: 'CHANGELOG.md',
          scopeTier: 'policy-classified',
          verdict: 'skipped',
        }),
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('fails the gate when expected policy or teaching evidence is missing', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/current.md', 'No governed term appears here.\n');

      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: {
            policyClassified: [
              {
                disposition: 'historical-by-policy',
                expectMatches: true,
                paths: ['**/CHANGELOG.md'],
                reason: 'A prior census proved historical matches exist.',
              },
            ],
            teachingSurfaces: ['docs/current.md'],
          },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.run?.report.gate).toEqual({
        reasons: [
          'expected-policy-classified-evidence-missing',
          'expected-teaching-surfaces-missing',
        ],
        remaining: 0,
        remainingByDisposition: {},
        status: 'open',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('ignores path globs before reading vocabulary occurrences', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, '.agents/notes/history.ts', 'export const facet = 1;\n');
      writeFile(
        dir,
        '.agents/skills/trails/SKILL.ts',
        'export const facet = 1;\n'
      );
      writeFile(dir, '.scratch/history.ts', 'export const facet = 1;\n');
      writeFile(
        dir,
        'plugin/skills/trails/SKILL.ts',
        'export const facet = 1;\n'
      );

      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: {
            exclude: ['.scratch/**', '.agents/notes/**'],
          },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.run?.ledger.occurrences.map((o) => o.path)).toEqual([
        '.agents/skills/trails/SKILL.ts',
        'plugin/skills/trails/SKILL.ts',
      ]);
      expect(result.value?.skipsByReason).toMatchObject({
        'ignored-glob': 2,
      });
      expect(result.value?.scan).toEqual({
        byDirectory: [
          { files: 1, occurrences: 1, path: '.agents' },
          { files: 1, occurrences: 1, path: 'plugin' },
        ],
        byExtension: [{ extension: '.ts', files: 2, occurrences: 2 }],
        files: { matched: 2, scanned: 2, skipped: 2 },
        skippedByReason: { 'ignored-glob': 2 },
      });
      expect(result.value?.scanned).toBe(2);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('preserves legacy ignored-directory overrides during collection', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'dist/generated.md', 'facet in generated output\n');
      const plan = vocabularyRegradePlanSchema.parse({
        from: 'facet',
        kind: 'vocabulary',
        scope: { ignoredDirectories: [] },
        to: 'trailhead',
      });

      const result = runVocabularyRegrade({
        plan,
        root: dir,
      });

      expect(plan.scope?.ignoredDirectories).toEqual([]);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.scanned).toBe(1);
      expect(result.value?.run?.ledger.occurrences.map((o) => o.path)).toEqual([
        'dist/generated.md',
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reopens explicitly ignored directories for classified policy paths', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'archive/history/record.md', 'facet history\n');
      writeFile(dir, 'archive/generated.md', 'facet generated\n');
      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: {
            ignoredDirectories: ['archive'],
            policyClassified: [
              {
                disposition: 'historical-by-policy',
                expectMatches: true,
                paths: ['archive/history/**'],
                reason: 'Retain immutable transition history.',
              },
            ],
          },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.run?.ledger.occurrences).toEqual([
        expect.objectContaining({
          path: 'archive/history/record.md',
          scopeTier: 'policy-classified',
        }),
      ]);
      expect(result.value.run?.report.gate.reasons).not.toContain(
        'expected-policy-classified-evidence-missing'
      );
      expect(result.value.skipsByReason).toMatchObject({
        'ignored-directory': 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('prefers longer override captures over overlapping defaults', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'facet-like\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          overrides: { 'facet-like': 'trailhead-like' },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'trailhead-like\n'
      );
      expect(result.value?.run?.report).toMatchObject({
        applied: 1,
        gate: { status: 'green' },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers hyphenated neighbor forms unless explicitly overridden', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'facet-like\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: { from: 'facet', kind: 'vocabulary', to: 'trailhead' },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'facet-like\n'
      );
      expect(result.value?.run?.ledger.forms).toMatchObject({
        'facet-like': 'deferred',
      });
      expect(result.value?.run?.report).toMatchObject({
        deferred: 1,
        gate: { status: 'open' },
        modified: 0,
        open: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers dollar identifier neighbors instead of partial rewrites', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'const facet$Id = $facet;\nconst _facet = 1;\n'
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: { from: 'facet', kind: 'vocabulary', to: 'trailhead' },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'const facet$Id = $facet;\nconst _facet = 1;\n'
      );
      expect(result.value?.run?.ledger.forms).toEqual({
        $facet: 'deferred',
        _facet: 'deferred',
        facet$Id: 'deferred',
      });
      expect(result.value?.run?.report).toMatchObject({
        deferred: 3,
        gate: { status: 'open' },
        modified: 0,
        open: 3,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers phrase neighbors instead of reporting green', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'export const label = "old termsId";\n');

      const result = runVocabularyRegrade({
        plan: { from: 'old term', kind: 'vocabulary', to: 'new term' },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'export const label = "old termsId";\n'
      );
      expect(result.value?.run?.ledger.forms).toEqual({
        'old termsId': 'deferred',
      });
      expect(result.value?.run?.ledger.occurrences).toHaveLength(1);
      expect(result.value?.run?.report).toMatchObject({
        deferred: 1,
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remaining: 1,
          status: 'open',
        },
        modified: 0,
        open: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('lets preserve rules skip unclassified neighbor forms', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'facetId\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ pattern: 'facetId', reason: 'intentional API name' }],
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'facetId\n'
      );
      expect(result.value?.run?.ledger.forms).toMatchObject({
        facetId: 'skipped',
      });
      expect(result.value?.run?.report).toMatchObject({
        deferred: 0,
        gate: { status: 'green' },
        modified: 0,
        open: 0,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps context-only preserve markers effective for captured forms', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'const facet = 1; // no-rewrite\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ pattern: 'no-rewrite', reason: 'operator marker' }],
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'const facet = 1; // no-rewrite\n'
      );
      expect(result.value.run.ledger.occurrences).toMatchObject([
        {
          form: 'facet',
          reason: 'operator marker',
          verdict: 'skipped',
        },
      ]);
      expect(result.value.run.report).toMatchObject({
        modified: 0,
        open: 0,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reports form verdicts from observed occurrences only', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'legacy facet\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ pattern: 'legacy facet', reason: 'documented name' }],
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.run?.ledger.forms).toEqual({
        facet: 'skipped',
      });
      expect(result.value?.run?.report).toMatchObject({
        modified: 0,
        open: 0,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps repeated neighbor occurrences reviewable after contextual preserve', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'legacy facetId\nactive facetId\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [
            { pattern: '^legacy facetId$', reason: 'legacy API name' },
          ],
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'legacy facetId\nactive facetId\n'
      );
      expect(result.value?.run?.ledger.occurrences).toMatchObject([
        {
          disposition: 'explicit-preserve',
          form: 'facetId',
          reason: 'legacy API name',
          verdict: 'skipped',
        },
        {
          disposition: 'in-family-unresolved',
          form: 'facetId',
          reason: 'unclassified-neighbor',
          verdict: 'deferred',
        },
      ]);
      expect(result.value?.run?.report).toMatchObject({
        deferred: 1,
        dispositions: {
          'explicit-preserve': 1,
          'in-family-unresolved': 1,
        },
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remainingByDisposition: { 'in-family-unresolved': 1 },
          status: 'open',
        },
        open: 1,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps post-apply source forms open when the target contains the source', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'const label = "API";\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: { from: 'API', kind: 'vocabulary', to: 'REST API' },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'const label = "REST API";\n'
      );
      expect(result.value?.run?.report).toMatchObject({
        applied: 1,
        gate: {
          reasons: ['source-forms-remain-after-apply'],
          status: 'open',
        },
        modified: 1,
        open: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps the compatibility apply summary file-oriented', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'facetId facetName facetOther facet\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ pattern: '^facetName$', reason: 'public symbol' }],
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
        review: 1,
        skipped: 1,
      });
      expect(result.value?.run?.report).toMatchObject({
        applied: 1,
        deferred: 2,
        filesChanged: 1,
        modified: 0,
        open: 2,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('rejects empty source, override, or preserve forms before scanning', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'facet\n');

      const emptySource = runVocabularyRegrade({
        plan: { from: '', kind: 'vocabulary', to: 'trailhead' },
        root: dir,
      });
      expect(emptySource.isErr()).toBe(true);
      if (emptySource.isErr()) {
        expect(emptySource.error.constructor.name).toBe('ValidationError');
      }

      const emptyOverride = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          overrides: { '': 'trailhead' },
          to: 'trailhead',
        },
        root: dir,
      });
      expect(emptyOverride.isErr()).toBe(true);
      if (emptyOverride.isErr()) {
        expect(emptyOverride.error.constructor.name).toBe('ValidationError');
      }

      const emptyPreserve = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ pattern: '' }],
          to: 'trailhead',
        },
        root: dir,
      });
      expect(emptyPreserve.isErr()).toBe(true);
      if (emptyPreserve.isErr()) {
        expect(emptyPreserve.error.constructor.name).toBe('ValidationError');
      }

      const excludedDocs = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { exclude: ['docs/**'] },
          to: 'trailhead',
        },
        root: dir,
      });
      expect(excludedDocs.isErr()).toBe(true);
      if (excludedDocs.isErr()) {
        expect(excludedDocs.error.constructor.name).toBe('ValidationError');
        expect(excludedDocs.error.message).toContain(
          'cannot hard-exclude docs'
        );
      }

      const excludedDocsByExtension = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { exclude: ['**/*.md'] },
          to: 'trailhead',
        },
        root: dir,
      });
      expect(excludedDocsByExtension.isErr()).toBe(true);
      if (excludedDocsByExtension.isErr()) {
        expect(excludedDocsByExtension.error.message).toContain(
          'cannot hard-exclude docs'
        );
      }

      const excludedPolicyPath = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: {
            exclude: ['CHANGELOG.md'],
            policyClassified: [
              {
                disposition: 'historical-by-policy',
                paths: ['CHANGELOG.md'],
                reason: 'Published history is immutable.',
              },
            ],
          },
          to: 'trailhead',
        },
        root: dir,
      });
      expect(excludedPolicyPath.isErr()).toBe(true);
      if (excludedPolicyPath.isErr()) {
        expect(excludedPolicyPath.error.message).toContain(
          'cannot both exclude and policy-classify "CHANGELOG.md"'
        );
      }

      const invalidDisposition = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ disposition: 'bogus', pattern: 'facet' }],
          to: 'trailhead',
        } as Parameters<typeof runVocabularyRegrade>[0]['plan'],
        root: dir,
      });
      expect(invalidDisposition.isErr()).toBe(true);
      if (invalidDisposition.isErr()) {
        expect(invalidDisposition.error.constructor.name).toBe(
          'ValidationError'
        );
        expect(invalidDisposition.error.message).toContain(
          'preserve disposition "bogus" is not supported'
        );
      }

      const invalidInventoryDisposition = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          to: 'trailhead',
        },
        preserveInventory: [
          {
            disposition: 'bogus',
            evidence: ['derived proof'],
            pattern: 'facet',
            source: 'derived-live-api',
          },
        ] as Parameters<typeof runVocabularyRegrade>[0]['preserveInventory'],
        root: dir,
      });
      expect(invalidInventoryDisposition.isErr()).toBe(true);
      if (invalidInventoryDisposition.isErr()) {
        expect(invalidInventoryDisposition.error.constructor.name).toBe(
          'ValidationError'
        );
        expect(invalidInventoryDisposition.error.message).toContain(
          'preserve inventory disposition "bogus" is not supported'
        );
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
