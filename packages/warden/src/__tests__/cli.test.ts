import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConflictError,
  deriveTrailsDir,
  Result,
  topo,
  trail,
} from '@ontrails/core';
import {
  deriveTopoGraph,
  deriveTopoGraphHash,
  writeLockManifest,
} from '@ontrails/topographer';
import { z } from 'zod';

import { formatWardenReport, runWarden } from '../cli.js';
import type { TopoAwareWardenRule, WardenDiagnostic } from '../rules/types.js';

const DEV_PERMIT_FLAG = ['--dev', '-permit'].join('');

const isDraftFileMarking = (rule: string): boolean =>
  rule === 'draft-file-marking';

const isDraftFileMarkingError = (diagnostic: {
  rule: string;
  severity?: string;
}): boolean =>
  isDraftFileMarking(diagnostic.rule) && diagnostic.severity === 'error';

const isDraftFileMarkingWarn = (diagnostic: {
  rule: string;
  severity?: string;
}): boolean =>
  isDraftFileMarking(diagnostic.rule) && diagnostic.severity === 'warn';

const isDraftVisibleDebt = (rule: string): boolean =>
  rule === 'draft-visible-debt';

const makeTempDir = (): string => {
  const dir = join(
    tmpdir(),
    `warden-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const writeManifest = (rootDir: string, hash: string): Promise<string> =>
  writeLockManifest(
    {
      artifacts: [{ path: 'topo.lock', role: 'topo', sha256: hash }],
      scope: { app: 'fixture.primary' },
      summary: { contours: 0, resources: 0, signals: 0, trails: 1 },
      version: 3,
    },
    { dir: deriveTrailsDir({ rootDir }) }
  );

const buildFixtureTopo = (name = 'fixture') => {
  const echo = trail('fixture.echo', {
    blaze: (input: { value: string }) => Result.ok({ value: input.value }),
    input: z.object({ value: z.string() }),
    intent: 'read',
    output: z.object({ value: z.string() }),
  });
  return topo(name, { echo });
};

const PLACEHOLDER_TOPO_FINDING: WardenDiagnostic = {
  filePath: '<topo>',
  line: 1,
  message: 'synthetic topo-level finding',
  rule: 'placeholder-topo-aware',
  severity: 'warn',
};

const buildPlaceholderTopoRule = (seen: string[]): TopoAwareWardenRule => ({
  checkTopo: (inspectedTopo) => {
    seen.push(inspectedTopo.name);
    return [PLACEHOLDER_TOPO_FINDING];
  },
  description: 'placeholder rule returning one diagnostic',
  name: 'placeholder-topo-aware',
  severity: 'warn',
});

const throwDiagnosticFilePaths = (
  report: Awaited<ReturnType<typeof runWarden>>
): readonly string[] =>
  report.diagnostics
    .filter((diagnostic) => diagnostic.rule === 'no-throw-in-implementation')
    .map((diagnostic) => diagnostic.filePath)
    .toSorted();

describe('runWarden basics', () => {
  test('produces a report with diagnostics for bad code', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail("entity.show", {
  blaze: async (input, ctx) => {
    throw new Error("boom");
  }
})`
      );

      const report = await runWarden({ rootDir: dir });
      expect(report.errorCount).toBeGreaterThan(0);
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('passes for clean code', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'good.ts'),
        `trail("entity.show", {
  blaze: async (input, ctx) => {
    return Result.ok(data);
  }
})`
      );

      const report = await runWarden({ rootDir: dir });
      expect(report.errorCount).toBe(0);
      expect(report.passed).toBe(true);
      expect(report.topoNames).toBeUndefined();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('lintOnly skips drift check', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'empty.ts'), 'export {}');
      const report = await runWarden({ lintOnly: true, rootDir: dir });
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('driftOnly skips lint', async () => {
    const dir = makeTempDir();
    try {
      // Even with bad code, driftOnly should produce 0 diagnostics
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail("x", { blaze: async () => { throw new Error("x"); } })`
      );
      const report = await runWarden({ driftOnly: true, rootDir: dir });
      expect(report.diagnostics.length).toBe(0);
      expect(report.drift).not.toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('source-static tier runs source rules and skips project rules plus drift', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'mixed.ts'),
        `trail('entity.show', {
  on: ['entity.changed'],
  blaze: async () => {
    throw new Error('boom');
  },
});`
      );

      const report = await runWarden({
        rootDir: dir,
        tier: 'source-static',
      });
      const rules = new Set(report.diagnostics.map((d) => d.rule));

      expect(rules.has('no-throw-in-implementation')).toBe(true);
      expect(rules.has('on-references-exist')).toBe(false);
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('source-static tier scans package manifests for dev permit usage', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
          {
            scripts: {
              seed: `trails run seed ${DEV_PERMIT_FLAG}`,
            },
          },
          null,
          2
        )
      );

      const report = await runWarden({
        rootDir: dir,
        tier: 'source-static',
      });
      const diagnostics = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'no-dev-permit-in-source'
      );

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.filePath).toBe(join(dir, 'package.json'));
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('applies default rule guidance to diagnostics from guided rules', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'trail.ts'),
        `import { Result, trail } from '@ontrails/core';

export const badTrail = trail('bad.throw', {
  blaze: async () => {
    throw new Error('boom');
  },
});
`
      );

      const report = await runWarden({
        rootDir: dir,
        tier: 'source-static',
      });
      const diagnostic = report.diagnostics.find(
        (entry) => entry.rule === 'no-throw-in-implementation'
      );

      expect(diagnostic?.guidance).toEqual(
        expect.objectContaining({
          relatedRules: [
            'implementation-returns-result',
            'no-native-error-result',
          ],
          summary:
            'Convert thrown implementation failures into explicit Result.err() outcomes.',
        })
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('leaves diagnostics from unguided rules unguided', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'contours.ts'),
        `import { contour } from '@ontrails/core';
import { z } from 'zod';

export const first = contour('first', {
  secondId: second.id(),
  id: z.string().uuid(),
}, { identity: 'id' });

export const second = contour('second', {
  firstId: first.id(),
  id: z.string().uuid(),
}, { identity: 'id' });
`
      );

      const report = await runWarden({
        rootDir: dir,
        tier: 'project-static',
      });
      const diagnostic = report.diagnostics.find(
        (entry) => entry.rule === 'circular-refs'
      );

      expect(diagnostic).toBeDefined();
      expect(diagnostic?.guidance).toBeUndefined();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('source-static tier scans CI YAML and shell scripts for dev permit usage', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        ['steps:', `  - run: bun trails run ci ${DEV_PERMIT_FLAG}`].join('\n')
      );
      writeFileSync(
        join(dir, 'scripts', 'seed.sh'),
        ['#!/usr/bin/env bash', `bun trails run seed ${DEV_PERMIT_FLAG}`].join(
          '\n'
        )
      );

      const report = await runWarden({
        rootDir: dir,
        tier: 'source-static',
      });
      const diagnostics = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'no-dev-permit-in-source'
      );

      expect(
        diagnostics.map((diagnostic) => diagnostic.filePath).toSorted()
      ).toEqual(
        [
          join(dir, '.github', 'workflows', 'ci.yml'),
          join(dir, 'scripts', 'seed.sh'),
        ].toSorted()
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('source-static tier scans test TypeScript files for dev permit usage', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'seed.test.ts'),
        `const command = "trails run seed ${DEV_PERMIT_FLAG}";`
      );

      const report = await runWarden({
        rootDir: dir,
        tier: 'source-static',
      });
      const diagnostics = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'no-dev-permit-in-source'
      );

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.filePath).toBe(join(dir, 'seed.test.ts'));
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('project-static tier runs project rules and skips source rules plus drift', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'mixed.ts'),
        `trail('entity.show', {
  on: ['entity.changed'],
  blaze: async () => {
    throw new Error('boom');
  },
});`
      );

      const report = await runWarden({
        rootDir: dir,
        tier: 'project-static',
      });
      const rules = new Set(report.diagnostics.map((d) => d.rule));

      expect(rules.has('no-throw-in-implementation')).toBe(false);
      expect(rules.has('on-references-exist')).toBe(true);
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('drift tier skips lint and runs drift', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail('x', { blaze: async () => { throw new Error('x'); } })`
      );

      const report = await runWarden({ rootDir: dir, tier: 'drift' });

      expect(report.diagnostics).toHaveLength(0);
      expect(report.drift).not.toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('tier takes precedence over legacy driftOnly for source-static', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail('x', { blaze: async () => { throw new Error('x'); } })`
      );

      const report = await runWarden({
        driftOnly: true,
        rootDir: dir,
        tier: 'source-static',
      });
      const rules = new Set(report.diagnostics.map((d) => d.rule));

      expect(rules.has('no-throw-in-implementation')).toBe(true);
      expect(report.drift).toBeNull();
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('tier takes precedence over legacy lintOnly for drift', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail('x', { blaze: async () => { throw new Error('x'); } })`
      );

      const report = await runWarden({
        lintOnly: true,
        rootDir: dir,
        tier: 'drift',
      });

      expect(report.diagnostics).toHaveLength(0);
      expect(report.drift).not.toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('legacy lintOnly and driftOnly together fail visibly', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'empty.ts'), 'export {}');

      const report = await runWarden({
        driftOnly: true,
        lintOnly: true,
        rootDir: dir,
      });

      expect(report.diagnostics).toEqual([
        {
          filePath: '<warden-options>',
          line: 1,
          message:
            'lintOnly and driftOnly cannot both be true. Use tier to select a single Warden mode.',
          rule: 'warden-options',
          severity: 'error',
        },
      ]);
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('advisory tier runs advisory-scoped rules only', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'advisory.ts'),
        `trail("entity.show", {
  input: z.object({ firstName: z.string() }),
  fields: {
    firstName: { label: "First Name" },
  },
  blaze: async () => {
    throw new Error("boom");
  },
})`
      );

      const report = await runWarden({
        rootDir: dir,
        tier: 'advisory',
      });
      const rules = new Set(report.diagnostics.map((d) => d.rule));

      expect(rules.has('prefer-schema-inference')).toBe(true);
      expect(rules.has('no-throw-in-implementation')).toBe(false);
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('depth project runs source and project rules but skips topo and drift', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'mixed.ts'),
        `trail('entity.show', {
  on: ['entity.changed'],
  blaze: async () => {
    throw new Error('boom');
  },
});`
      );
      const seen: string[] = [];
      const report = await runWarden({
        depth: 'project',
        extraTopoRules: [buildPlaceholderTopoRule(seen)],
        rootDir: dir,
        topo: buildFixtureTopo(),
      });
      const rules = new Set(report.diagnostics.map((d) => d.rule));

      expect(rules.has('no-throw-in-implementation')).toBe(true);
      expect(rules.has('on-references-exist')).toBe(true);
      expect(rules.has('placeholder-topo-aware')).toBe(false);
      expect(seen).toEqual([]);
      expect(report.drift).toBeNull();
      expect(report.effectiveConfig?.depth).toBe('project');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('depth source ignores deeper project findings', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'source-only.ts'),
        `trail('entity.show', {
  on: ['entity.changed'],
  blaze: async () => Result.ok({ ok: true }),
});`
      );
      const report = await runWarden({
        depth: 'source',
        rootDir: dir,
      });
      const rules = new Set(report.diagnostics.map((d) => d.rule));

      expect(rules.has('on-references-exist')).toBe(false);
      expect(report.errorCount).toBe(0);
      expect(report.passed).toBe(true);
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('failOn warning turns warning-only reports into failures', async () => {
    const dir = makeTempDir();
    try {
      const seen: string[] = [];
      const report = await runWarden({
        depth: 'topo',
        extraTopoRules: [buildPlaceholderTopoRule(seen)],
        failOn: 'warning',
        rootDir: dir,
        topo: buildFixtureTopo(),
      });

      expect(seen).toEqual(['fixture']);
      expect(report.errorCount).toBe(0);
      expect(report.warnCount).toBeGreaterThan(0);
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('multi-topo runs tag topo-aware diagnostics', async () => {
    const dir = makeTempDir();
    try {
      const seen: string[] = [];
      const report = await runWarden({
        depth: 'topo',
        extraTopoRules: [buildPlaceholderTopoRule(seen)],
        rootDir: dir,
        topos: [
          { name: 'primary', topo: buildFixtureTopo('fixture.primary') },
          { name: 'admin', topo: buildFixtureTopo('fixture.admin') },
        ],
      });

      const emitted = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'placeholder-topo-aware'
      );

      expect(seen).toEqual(['fixture.primary', 'fixture.admin']);
      expect(emitted.map((diagnostic) => diagnostic.topoName)).toEqual([
        'primary',
        'admin',
      ]);
      expect(report.topoNames).toEqual(['primary', 'admin']);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('multi-topo drift compares every supplied topo when no stored hash exists', async () => {
    const dir = makeTempDir();
    try {
      const primary = buildFixtureTopo('fixture.primary');
      const adminTrail = trail('admin.echo', {
        blaze: (input: { value: string }) => Result.ok({ value: input.value }),
        input: z.object({ value: z.string() }),
        intent: 'read',
        output: z.object({ value: z.string() }),
      });
      const admin = topo('fixture.admin', { adminTrail });
      const primaryHash = deriveTopoGraphHash(deriveTopoGraph(primary));
      await writeManifest(dir, primaryHash);

      const report = await runWarden({
        depth: 'all',
        rootDir: dir,
        topos: [
          { name: 'primary', topo: primary },
          { name: 'admin', topo: admin },
        ],
      });

      expect(report.drift?.committedHash).toBe(primaryHash);
      expect(report.drift?.currentHash).not.toBe(primaryHash);
      expect(report.drift?.stale).toBe(true);
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('multi-topo runs do not multiply source-scoped diagnostics', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad-source.ts'),
        `trail("entity.show", {
  blaze: async () => {
    throw new Error("boom");
  },
});`
      );
      const seen: string[] = [];
      const report = await runWarden({
        depth: 'topo',
        extraTopoRules: [buildPlaceholderTopoRule(seen)],
        rootDir: dir,
        topos: [
          { name: 'primary', topo: buildFixtureTopo('fixture.primary') },
          { name: 'admin', topo: buildFixtureTopo('fixture.admin') },
        ],
      });

      const sourceDiagnostics = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'no-throw-in-implementation'
      );
      const topoDiagnostics = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'placeholder-topo-aware'
      );

      expect(seen).toEqual(['fixture.primary', 'fixture.admin']);
      expect(sourceDiagnostics).toHaveLength(1);
      expect(sourceDiagnostics[0]?.topoName).toBeUndefined();
      expect(topoDiagnostics).toHaveLength(2);
      expect(topoDiagnostics.map((diagnostic) => diagnostic.topoName)).toEqual([
        'primary',
        'admin',
      ]);
      expect(report.topoNames).toEqual(['primary', 'admin']);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('runWarden project context', () => {
  test('reports throw inside detour recover functions', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'recover.ts'),
        `trail("entity.show", {
  detours: [
    {
      on: ConflictError,
      recover: async () => {
        throw new Error("boom");
      },
    },
  ],
  blaze: () => Result.err(new ConflictError("conflict")),
})`
      );

      const report = await runWarden({ rootDir: dir });
      const detourRecoverErrors = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'no-throw-in-detour-recover'
      );

      expect(detourRecoverErrors).toHaveLength(1);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reports detours shadowed by earlier broader on: types', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'shadowed.ts'),
        `import { ConflictError, Result, TrailsError, trail } from '@ontrails/core';

trail("entity.save", {
  detours: [
    { on: TrailsError, recover: async () => Result.ok({ winner: "broad" }) },
    { on: ConflictError, recover: async () => Result.ok({ winner: "specific" }) },
  ],
  blaze: () => Result.err(new ConflictError("boom")),
});`
      );

      const report = await runWarden({ rootDir: dir });
      const shadowRules = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'unreachable-detour-shadowing'
      );

      expect(shadowRules).toHaveLength(1);
      expect(shadowRules[0]?.message).toContain('TrailsError');
      expect(shadowRules[0]?.message).toContain('ConflictError');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('includes topo-aware detour contract diagnostics when topo is supplied', async () => {
    const validTrail = trail('entity.save', {
      blaze: () => Result.ok({ ok: true }),
      detours: [
        {
          on: ConflictError,
          recover: () => Result.ok({ ok: true }),
        },
      ],
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });

    const malformed = {
      ...validTrail,
      detours: [
        {
          on: 'ConflictError',
          recover: 'not callable',
        },
      ],
    } as typeof validTrail;

    const report = await runWarden({
      topo: topo('invalid-detour-contract', {
        malformed,
      } as Record<string, unknown>),
    });

    const contractDiagnostics = report.diagnostics.filter(
      (diagnostic) => diagnostic.rule === 'valid-detour-contract'
    );

    expect(contractDiagnostics).toHaveLength(2);
  });

  test('uses project context for contour references across files', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'user.ts'),
        `import { contour } from '@ontrails/core';
import { z } from 'zod';

export const user = contour('user', {
  id: z.string().uuid(),
}, { identity: 'id' });`
      );
      writeFileSync(
        join(dir, 'gist.ts'),
        `import { contour } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

export const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });`
      );

      const report = await runWarden({ rootDir: dir });
      const referenceErrors = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'reference-exists'
      );

      expect(referenceErrors).toHaveLength(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('preserves empty topo resource sets instead of falling back to file-local ids', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'entity.ts'),
        `import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});`
      );

      const report = await runWarden({ rootDir: dir, topo: topo('empty-app') });
      const resourceErrors = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'resource-exists'
      );

      expect(resourceErrors).toHaveLength(1);
      expect(resourceErrors[0]?.message).toContain('db.main');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('warns on contour cycles declared across files', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'user.ts'),
        `import { contour } from '@ontrails/core';
import { z } from 'zod';
import { gist } from './gist';

export const user = contour('user', {
  gistId: gist.id(),
  id: z.string().uuid(),
}, { identity: 'id' });`
      );
      writeFileSync(
        join(dir, 'gist.ts'),
        `import { contour } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

export const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });`
      );

      const report = await runWarden({ rootDir: dir });
      const circularWarnings = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'circular-refs'
      );

      expect(circularWarnings.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('uses project context for store factory completeness across files', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'store.ts'),
        `import { Result, resource } from '@ontrails/core';
import { store } from '@ontrails/store';
import { crud } from '@ontrails/store/trails';
import { z } from 'zod';

export const definition = store({
  notes: {
    identity: 'id',
    schema: z.object({
      id: z.string(),
      title: z.string(),
    }),
    versioned: true,
  },
});

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const noteTrails = crud(definition.tables.notes, notesResource);`
      );
      writeFileSync(
        join(dir, 'reconcile.ts'),
        `import { Result, resource } from '@ontrails/core';
import { reconcile } from '@ontrails/store/trails';
import { definition } from './store';

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const reconcileNotes = reconcile({
  resource: notesResource,
  table: definition.tables.notes,
});`
      );
      writeFileSync(
        join(dir, 'listener.ts'),
        `import { Result, trail } from '@ontrails/core';
import { definition } from './store';
import { z } from 'zod';

trail('notes.notify', {
  on: [
    definition.tables.notes.signals.created,
    definition.tables.notes.signals.updated,
    definition.tables.notes.signals.removed,
  ],
  blaze: async () => Result.ok({ ok: true }),
  output: z.object({ ok: z.boolean() }),
});`
      );

      const report = await runWarden({ rootDir: dir });

      expect(
        report.diagnostics.filter(
          (diagnostic) => diagnostic.rule === 'missing-reconcile'
        )
      ).toHaveLength(0);
      expect(
        report.diagnostics.filter(
          (diagnostic) => diagnostic.rule === 'orphaned-signal'
        )
      ).toHaveLength(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('runWarden draft markers', () => {
  test('requires draft-bearing files to be visibly marked', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'draft-id.ts'),
        `trail("_draft.entity.prepare", {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({})
})`
      );

      const report = await runWarden({ rootDir: dir });

      const hasDraftFileMarking = report.diagnostics.some((diagnostic) =>
        isDraftFileMarking(diagnostic.rule)
      );
      const hasDraftVisibleDebt = report.diagnostics.some((diagnostic) =>
        isDraftVisibleDebt(diagnostic.rule)
      );

      expect(hasDraftFileMarking).toBe(true);
      expect(hasDraftVisibleDebt).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('allows correctly marked draft files while keeping the debt visible', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, '_draft.entity.ts'),
        `trail("_draft.entity.prepare", {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({})
})`
      );

      const report = await runWarden({ rootDir: dir });

      const hasDraftFileMarkingError = report.diagnostics.some((diagnostic) =>
        isDraftFileMarkingError(diagnostic)
      );
      const hasDraftVisibleDebt = report.diagnostics.some((diagnostic) =>
        isDraftVisibleDebt(diagnostic.rule)
      );

      expect(hasDraftFileMarkingError).toBe(false);
      expect(hasDraftVisibleDebt).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('filters source files by draft mode', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, '_draft.entity.ts'),
        `trail("_draft.entity.prepare", {
  blaze: async () => {
    throw new Error("draft boom");
  },
})`
      );
      writeFileSync(
        join(dir, 'entity.ts'),
        `trail("entity.show", {
  blaze: async () => {
    throw new Error("established boom");
  },
})`
      );

      const includeReport = await runWarden({
        drafts: 'include',
        rootDir: dir,
      });
      const excludeReport = await runWarden({
        drafts: 'exclude',
        rootDir: dir,
      });
      const onlyReport = await runWarden({ drafts: 'only', rootDir: dir });

      expect(throwDiagnosticFilePaths(includeReport)).toEqual([
        join(dir, '_draft.entity.ts'),
        join(dir, 'entity.ts'),
      ]);
      expect(throwDiagnosticFilePaths(excludeReport)).toEqual([
        join(dir, 'entity.ts'),
      ]);
      expect(throwDiagnosticFilePaths(onlyReport)).toEqual([
        join(dir, '_draft.entity.ts'),
      ]);
      expect(
        excludeReport.diagnostics.some((diagnostic) =>
          isDraftVisibleDebt(diagnostic.rule)
        )
      ).toBe(false);
      expect(
        onlyReport.diagnostics.some((diagnostic) =>
          isDraftVisibleDebt(diagnostic.rule)
        )
      ).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('warns when a draft-marked file no longer contains draft ids', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'entity.draft.ts'),
        `trail("entity.prepare", {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({})
})`
      );

      const report = await runWarden({ rootDir: dir });

      const hasDraftFileMarkingWarn = report.diagnostics.some((diagnostic) =>
        isDraftFileMarkingWarn(diagnostic)
      );

      expect(hasDraftFileMarkingWarn).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('formatWardenReport', () => {
  test('formats a clean report', () => {
    const output = formatWardenReport({
      diagnostics: [],
      drift: { committedHash: null, currentHash: 'stub', stale: false },
      errorCount: 0,
      passed: true,
      warnCount: 0,
    });
    expect(output).toContain('Warden Report');
    expect(output).toContain('Lint: clean');
    expect(output).toContain('Drift: clean');
    expect(output).toContain('Result: PASS');
  });

  test('formats a report with errors', () => {
    const output = formatWardenReport({
      diagnostics: [
        {
          filePath: 'src/trails/entity.ts',
          line: 3,
          message: 'Do not throw inside implementation.',
          rule: 'no-throw-in-implementation',
          severity: 'error',
        },
      ],
      drift: { committedHash: null, currentHash: 'stub', stale: false },
      errorCount: 1,
      passed: false,
      warnCount: 0,
    });
    expect(output).toContain('1 errors');
    expect(output).toContain('Result: FAIL');
    expect(output).toContain('entity.ts:3');
  });

  test('formats related guidance rules in the lint section', () => {
    const output = formatWardenReport({
      diagnostics: [
        {
          filePath: 'src/trails/entity.ts',
          guidance: {
            relatedRules: [
              'implementation-returns-result',
              'no-native-error-result',
            ],
            summary: 'Convert thrown failures into Result.err().',
          },
          line: 3,
          message: 'Do not throw inside implementation.',
          rule: 'no-throw-in-implementation',
          severity: 'error',
        },
      ],
      drift: { committedHash: null, currentHash: 'stub', stale: false },
      errorCount: 1,
      passed: false,
      warnCount: 0,
    });

    expect(output).toContain(
      'Related: implementation-returns-result, no-native-error-result'
    );
  });

  test('formats a report with stale drift', () => {
    const output = formatWardenReport({
      diagnostics: [],
      drift: { committedHash: 'abc', currentHash: 'def', stale: true },
      errorCount: 0,
      passed: false,
      warnCount: 0,
    });
    expect(output).toContain('trails.lock is stale');
    expect(output).toContain('Result: FAIL');
  });

  test('formats a report with blocked established exports', () => {
    const output = formatWardenReport({
      diagnostics: [],
      drift: {
        blockedReason:
          'Established topo validation failed with 1 draft issue(s)',
        committedHash: null,
        currentHash: 'blocked',
        stale: true,
      },
      errorCount: 0,
      passed: false,
      warnCount: 0,
    });
    expect(output).toContain('Drift: blocked');
    expect(output).toContain('established exports blocked');
  });
});
