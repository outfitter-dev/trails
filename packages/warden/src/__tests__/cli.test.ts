import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
  LOCK_MANIFEST_SCHEMA_VERSION,
  writeLockManifest,
} from '@ontrails/topography';
import { z } from 'zod';

import {
  applySafeFixesToFiles,
  formatWardenReport,
  runWarden,
} from '../cli.js';
import type {
  TopoAwareWardenRule,
  WardenDiagnostic,
  WardenRule,
} from '../rules/types.js';

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

const writeAdapterCheckFixture = (rootDir: string): void => {
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-root',
        workspaces: ['adapters/*'],
      },
      null,
      2
    )
  );
  mkdirSync(join(rootDir, 'adapters/hono/src'), { recursive: true });
  writeFileSync(
    join(rootDir, 'adapters/hono/package.json'),
    JSON.stringify(
      {
        exports: {
          '.': './src/index.ts',
          './package.json': './package.json',
        },
        name: '@ontrails/hono',
        trails: {
          adapter: true,
        },
      },
      null,
      2
    )
  );
  writeFileSync(
    join(rootDir, 'adapters/hono/src/index.ts'),
    'export const honoAdapter = {};\n'
  );
};

const writeProjectSourceRule = (
  rootDir: string,
  options: {
    readonly directory?: boolean;
    readonly marker?: string;
    readonly name?: string;
    readonly severity?: 'error' | 'warn';
  } = {}
): string => {
  const rulePath = options.directory
    ? join(rootDir, '.trails', 'rules', 'project-local-rule.ts')
    : join(rootDir, '.trails', 'rules.ts');
  mkdirSync(dirname(rulePath), { recursive: true });
  const marker = options.marker ?? 'projectLocalProblem';
  const ruleName = options.name ?? 'project-local-rule';
  const severity = options.severity ?? 'error';
  writeFileSync(
    rulePath,
    `export const rule = {
  name: '${ruleName}',
  severity: '${severity}',
  description: 'Project-local fixture rule.',
  check(sourceCode, filePath) {
    const marker = ${JSON.stringify(marker.split(/(?=[A-Z])/))}.join('');
    return sourceCode.includes(marker)
      ? [{
          filePath,
          line: 1,
          message: 'Project-local fixture marker found.',
          rule: '${ruleName}',
          severity: '${severity}',
        }]
      : [];
  },
};
`
  );
  return rulePath;
};

const writeProjectAwareRule = (rootDir: string): string => {
  const ruleDir = join(rootDir, '.trails', 'rules');
  mkdirSync(ruleDir, { recursive: true });
  const rulePath = join(ruleDir, 'project-aware-rule.ts');
  writeFileSync(
    rulePath,
    `export const rule = {
  name: 'project-aware-rule',
  severity: 'error',
  description: 'Project-aware fixture rule.',
  check() {
    return [];
  },
  checkWithContext(sourceCode, filePath) {
    return sourceCode.includes('projectAwareProblem')
      ? [{
          filePath,
          line: 1,
          message: 'Project-aware fixture marker found.',
          rule: 'project-aware-rule',
          severity: 'error',
        }]
      : [];
  },
};
`
  );
  return rulePath;
};

const writeManifest = (rootDir: string, hash: string): Promise<string> =>
  writeLockManifest(
    {
      artifacts: [{ path: 'topo.lock', role: 'topo', sha256: hash }],
      scope: { app: 'fixture.primary' },
      summary: { entities: 0, resources: 0, signals: 0, trails: 1 },
      version: LOCK_MANIFEST_SCHEMA_VERSION,
    },
    { dir: deriveTrailsDir({ rootDir }) }
  );

const buildFixtureTopo = (name = 'fixture') => {
  const echo = trail('fixture.echo', {
    implementation: (input: { value: string }) =>
      Result.ok({ value: input.value }),
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

const safeRenameDiagnostic = (filePath: string): WardenDiagnostic => ({
  filePath,
  fix: {
    class: 'term-rewrite',
    edits: [{ end: 12, replacement: 'ping', start: 6 }],
    reason: 'safe rename',
    safety: 'safe',
  },
  line: 1,
  message: 'safe rename',
  rule: 'synthetic-safe-fix',
  severity: 'warn',
});

const buildSyntheticSafeSourceRule = (): WardenRule => ({
  check: (sourceCode, filePath) => {
    const start = sourceCode.indexOf('signal');
    if (start === -1) {
      return [];
    }
    return [
      {
        filePath,
        fix: {
          class: 'term-rewrite',
          edits: [
            {
              end: start + 'signal'.length,
              replacement: 'ping',
              start,
            },
          ],
          reason: 'safe rename',
          safety: 'safe',
        },
        line: 1,
        message: 'safe rename',
        rule: 'synthetic-safe-fix',
        severity: 'warn',
      },
    ];
  },
  description: 'synthetic safe source fix rule',
  metadata: {
    concern: 'general',
    depth: 'source',
    invariant: 'synthetic safe source fix test hook',
    lifecycle: { retireWhen: 'test helper', state: 'temporary' },
    scope: 'temporary',
    tier: 'source-static',
  },
  name: 'synthetic-safe-fix',
  severity: 'warn',
});

describe('runWarden basics', () => {
  test('produces a report with diagnostics for bad code', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail("entity.show", {
  implementation: async (input, ctx) => {
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
  implementation: async (input, ctx) => {
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
        `trail("x", { implementation: async () => { throw new Error("x"); } })`
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
  implementation: async () => {
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
  implementation: async () => {
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
            'Convert thrown failures in implementations into explicit Result.err() outcomes.',
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
        join(dir, 'entities.ts'),
        `import { entity } from '@ontrails/core';
import { z } from 'zod';

export const first = entity('first', {
  secondId: second.id(),
  id: z.string().uuid(),
}, { identity: 'id' });

export const second = entity('second', {
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
  implementation: async () => {
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
        `trail('x', { implementation: async () => { throw new Error('x'); } })`
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
        `trail('x', { implementation: async () => { throw new Error('x'); } })`
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
        `trail('x', { implementation: async () => { throw new Error('x'); } })`
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
  implementation: async () => {
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

  test('advisory tier runs adapter checks only when opted in', async () => {
    const dir = makeTempDir();
    try {
      writeAdapterCheckFixture(dir);

      const advisoryOnly = await runWarden({
        rootDir: dir,
        tier: 'advisory',
      });
      const optedIn = await runWarden({
        adapterCheck: true,
        rootDir: dir,
        tier: 'advisory',
      });

      expect(advisoryOnly.diagnostics.map((entry) => entry.rule)).not.toContain(
        'adapter-check'
      );
      expect(optedIn.diagnostics.map((entry) => entry.rule)).toContain(
        'adapter-check'
      );
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
  implementation: async () => {
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
  implementation: async () => Result.ok({ ok: true }),
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
        implementation: (input: { value: string }) =>
          Result.ok({ value: input.value }),
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
  implementation: async () => {
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
  test('keeps governed residue detection in source-only runs', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'residue.ts'), 'export const facet = true;\n');

      const report = await runWarden({ depth: 'source', rootDir: dir });

      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({
          filePath: join(dir, 'residue.ts'),
          rule: 'governed-symbol-residue',
        })
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('skips governed history validation in source-only runs', async () => {
    const dir = makeTempDir();
    try {
      const historyDirectory = join(dir, '.trails', 'regrade', 'history');
      mkdirSync(historyDirectory, { recursive: true });
      writeFileSync(join(historyDirectory, 'invalid.json'), '{not-json}\n');
      writeFileSync(join(dir, 'index.ts'), 'export const clean = true;\n');

      const reports = await Promise.all([
        runWarden({ depth: 'source', rootDir: dir }),
        runWarden({ rootDir: dir, tier: 'source-static' }),
      ]);

      for (const report of reports) {
        expect(report.diagnostics).not.toContainEqual(
          expect.objectContaining({
            filePath: '.trails/regrade/history/invalid.json',
            rule: 'governed-symbol-residue',
          })
        );
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('runs governed history validation once for project-capable selectors', async () => {
    const dir = makeTempDir();
    try {
      const historyDirectory = join(dir, '.trails', 'regrade', 'history');
      mkdirSync(historyDirectory, { recursive: true });
      writeFileSync(join(historyDirectory, 'invalid.json'), '{not-json}\n');
      writeFileSync(join(dir, 'index.ts'), 'export const clean = true;\n');

      const reports = await Promise.all([
        runWarden({ rootDir: dir }),
        runWarden({ rootDir: dir, tier: 'project-static' }),
      ]);
      for (const report of reports) {
        const diagnostics = report.diagnostics.filter(
          (diagnostic) => diagnostic.rule === 'governed-symbol-residue'
        );
        expect(diagnostics).toEqual([
          expect.objectContaining({
            filePath: '.trails/regrade/history/invalid.json',
            message: 'Committed Regrade history is not valid JSON.',
          }),
        ]);
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

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
  implementation: () => Result.err(new ConflictError("conflict")),
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
  implementation: () => Result.err(new ConflictError("boom")),
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
      detours: [
        {
          on: ConflictError,
          recover: async () => Result.ok({ ok: true }),
        },
      ],
      implementation: () => Result.ok({ ok: true }),
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
    } as unknown as typeof validTrail;

    const report = await runWarden({
      tier: 'topo-aware',
      topo: topo('invalid-detour-contract', {
        malformed,
      } as Record<string, unknown>),
    });

    const contractDiagnostics = report.diagnostics.filter(
      (diagnostic) => diagnostic.rule === 'valid-detour-contract'
    );

    expect(contractDiagnostics).toHaveLength(2);
  });

  test('uses project context for entity references across files', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'user.ts'),
        `import { entity } from '@ontrails/core';
import { z } from 'zod';

export const user = entity('user', {
  id: z.string().uuid(),
}, { identity: 'id' });`
      );
      writeFileSync(
        join(dir, 'gist.ts'),
        `import { entity } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

export const gist = entity('gist', {
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
  implementation: async (_input, ctx) => Result.ok(db.from(ctx)),
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

  test('warns on entity cycles declared across files', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'user.ts'),
        `import { entity } from '@ontrails/core';
import { z } from 'zod';
import { gist } from './gist';

export const user = entity('user', {
  gistId: gist.id(),
  id: z.string().uuid(),
}, { identity: 'id' });`
      );
      writeFileSync(
        join(dir, 'gist.ts'),
        `import { entity } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

export const gist = entity('gist', {
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
  implementation: async () => Result.ok({ ok: true }),
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
  implementation: async () => Result.ok({ ok: true }),
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
  implementation: async () => Result.ok({ ok: true }),
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
  implementation: async () => {
    throw new Error("draft boom");
  },
})`
      );
      writeFileSync(
        join(dir, 'entity.ts'),
        `trail("entity.show", {
  implementation: async () => {
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
  implementation: async () => Result.ok({ ok: true }),
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

describe('applySafeFixesToFiles', () => {
  test('rewrites a file with a safe edit and reports applied counts', async () => {
    const dir = makeTempDir();
    try {
      const filePath = join(dir, 'entity.ts');
      writeFileSync(filePath, 'const signal = 1;');
      const diagnostic: WardenDiagnostic = {
        filePath,
        fix: {
          class: 'term-rewrite',
          edits: [{ end: 12, replacement: 'ping', start: 6 }],
          reason: 'rename signal to ping',
          safety: 'safe',
        },
        line: 1,
        message: 'rename signal',
        rule: 'synthetic-safe-fix',
        severity: 'warn',
      };

      const summary = await applySafeFixesToFiles([diagnostic], {
        allowedFilePaths: [filePath],
        rootDir: dir,
      });

      expect(summary).toMatchObject({
        applied: 1,
        filesChanged: 1,
        skipped: 0,
      });
      expect(summary.appliedDiagnostics).toEqual([diagnostic]);
      expect(readFileSync(filePath, 'utf8')).toBe('const ping = 1;');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('dedupes identical safe edits from multiple diagnostics', async () => {
    const dir = makeTempDir();
    try {
      const filePath = join(dir, 'entity.ts');
      writeFileSync(filePath, 'const signal = 1;');
      const first: WardenDiagnostic = {
        filePath,
        fix: {
          class: 'term-rewrite',
          edits: [{ end: 12, replacement: 'ping', start: 6 }],
          reason: 'rename signal to ping',
          safety: 'safe',
        },
        line: 1,
        message: 'rename signal',
        rule: 'synthetic-safe-fix',
        severity: 'warn',
      };
      const second: WardenDiagnostic = {
        ...first,
        message: 'rename signal from another rule',
        rule: 'synthetic-overlapping-safe-fix',
      };

      const summary = await applySafeFixesToFiles([first, second], {
        allowedFilePaths: [filePath],
        rootDir: dir,
      });

      expect(summary).toMatchObject({
        applied: 2,
        filesChanged: 1,
        skipped: 0,
      });
      expect(summary.appliedDiagnostics).toEqual([first, second]);
      expect(readFileSync(filePath, 'utf8')).toBe('const ping = 1;');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('leaves review-only and edit-less fixes unapplied and counted as skipped', async () => {
    const dir = makeTempDir();
    try {
      const safePath = join(dir, 'safe.ts');
      const reviewPath = join(dir, 'review.ts');
      writeFileSync(safePath, 'const signal = 1;');
      writeFileSync(reviewPath, 'const legacy = 1;');

      const safe: WardenDiagnostic = {
        filePath: safePath,
        fix: {
          class: 'term-rewrite',
          edits: [{ end: 12, replacement: 'ping', start: 6 }],
          reason: 'safe rename',
          safety: 'safe',
        },
        line: 1,
        message: 'safe rename',
        rule: 'synthetic-safe-fix',
        severity: 'warn',
      };
      const review: WardenDiagnostic = {
        filePath: reviewPath,
        fix: {
          class: 'term-rewrite',
          reason: 'needs human migration',
          safety: 'review',
        },
        line: 1,
        message: 'needs review',
        rule: 'synthetic-review-fix',
        severity: 'error',
      };
      const noFix: WardenDiagnostic = {
        filePath: reviewPath,
        line: 1,
        message: 'no fix metadata',
        rule: 'synthetic-no-fix',
        severity: 'warn',
      };

      const summary = await applySafeFixesToFiles([safe, review, noFix], {
        allowedFilePaths: [safePath, reviewPath],
        rootDir: dir,
      });

      expect(summary).toMatchObject({
        applied: 1,
        filesChanged: 1,
        skipped: 1,
      });
      expect(summary.appliedDiagnostics).toEqual([safe]);
      // The review-targeted file is never read or written.
      expect(readFileSync(reviewPath, 'utf8')).toBe('const legacy = 1;');
      expect(readFileSync(safePath, 'utf8')).toBe('const ping = 1;');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('skips safe diagnostics outside the root and scan set', async () => {
    const dir = makeTempDir();
    const outside = makeTempDir();
    try {
      const safePath = join(dir, 'safe.ts');
      const unscannedPath = join(dir, 'unscanned.ts');
      const outsidePath = join(outside, 'outside.ts');
      writeFileSync(safePath, 'const signal = 1;');
      writeFileSync(unscannedPath, 'const signal = 1;');
      writeFileSync(outsidePath, 'const signal = 1;');

      const summary = await applySafeFixesToFiles(
        [
          safeRenameDiagnostic(safePath),
          safeRenameDiagnostic(unscannedPath),
          safeRenameDiagnostic(outsidePath),
        ],
        {
          allowedFilePaths: [safePath],
          rootDir: dir,
        }
      );

      expect(summary).toMatchObject({
        applied: 1,
        filesChanged: 1,
        skipped: 2,
      });
      expect(summary.appliedDiagnostics).toEqual([
        safeRenameDiagnostic(safePath),
      ]);
      expect(readFileSync(safePath, 'utf8')).toBe('const ping = 1;');
      expect(readFileSync(unscannedPath, 'utf8')).toBe('const signal = 1;');
      expect(readFileSync(outsidePath, 'utf8')).toBe('const signal = 1;');
    } finally {
      rmSync(dir, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });
});

describe('runWarden --fix wiring', () => {
  test('omits the fix summary when fix is not requested', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'legacy.ts'),
        '// references authLayer in a note'
      );

      const report = await runWarden({ rootDir: dir, tier: 'source-static' });

      expect(report.fixes).toBeUndefined();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('removes applied safe diagnostics from the final report', async () => {
    const dir = makeTempDir();
    try {
      const filePath = join(dir, 'safe.ts');
      writeFileSync(filePath, 'const signal = 1;');

      const report = await runWarden({
        extraSourceRules: [buildSyntheticSafeSourceRule()],
        fix: true,
        lock: 'skip',
        rootDir: dir,
      });

      expect(readFileSync(filePath, 'utf8')).toBe('const ping = 1;');
      expect(report.fixes).toEqual({
        applied: 1,
        filesChanged: 1,
        skipped: 0,
      });
      expect(report.diagnostics.map((entry) => entry.rule)).not.toContain(
        'synthetic-safe-fix'
      );
      expect(report.warnCount).toBe(0);
      expect(report.errorCount).toBe(0);
      expect(report.passed).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('blocks drift evidence after safe fixes change source', async () => {
    const dir = makeTempDir();
    try {
      const filePath = join(dir, 'safe.ts');
      writeFileSync(filePath, 'const signal = 1;');

      const report = await runWarden({
        extraSourceRules: [buildSyntheticSafeSourceRule()],
        fix: true,
        rootDir: dir,
      });

      expect(readFileSync(filePath, 'utf8')).toBe('const ping = 1;');
      expect(report.diagnostics.map((entry) => entry.rule)).not.toContain(
        'synthetic-safe-fix'
      );
      expect(report.drift?.blockedReason).toBe(
        'Source fixes were applied; rerun Warden to refresh drift evidence.'
      );
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reports review-only legacy fixes as skipped without touching source', async () => {
    const dir = makeTempDir();
    try {
      const filePath = join(dir, 'legacy.ts');
      const source = '// references authLayer in a note';
      writeFileSync(filePath, source);

      const report = await runWarden({
        fix: true,
        rootDir: dir,
        tier: 'source-static',
      });

      const legacyDiagnostics = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'no-legacy-layer-imports'
      );
      expect(legacyDiagnostics.length).toBeGreaterThan(0);
      expect(report.fixes).toBeDefined();
      expect(report.fixes?.applied).toBe(0);
      expect(report.fixes?.filesChanged).toBe(0);
      expect(report.fixes?.skipped).toBeGreaterThanOrEqual(1);
      // Review-only fixes never rewrite source.
      expect(readFileSync(filePath, 'utf8')).toBe(source);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('project-local Warden rules', () => {
  test('loads a source rule from .trails/rules.ts by default', async () => {
    const dir = makeTempDir();
    try {
      writeProjectSourceRule(dir);
      writeFileSync(join(dir, 'fixture.ts'), 'const projectLocalProblem = 1;');

      const report = await runWarden({
        lock: 'skip',
        rootDir: dir,
        tier: 'source-static',
      });

      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({
          filePath: join(dir, 'fixture.ts'),
          message: 'Project-local fixture marker found.',
          rule: 'project-local-rule',
        })
      );
      expect(report.errorCount).toBe(1);
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('loads source rules from .trails/rules by default', async () => {
    const dir = makeTempDir();
    try {
      writeProjectSourceRule(dir, { directory: true });
      writeFileSync(join(dir, 'fixture.ts'), 'const projectLocalProblem = 1;');

      const report = await runWarden({
        lock: 'skip',
        rootDir: dir,
        tier: 'source-static',
      });

      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({
          filePath: join(dir, 'fixture.ts'),
          message: 'Project-local fixture marker found.',
          rule: 'project-local-rule',
        })
      );
      expect(report.errorCount).toBe(1);
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('only discovers direct .trails/rules TypeScript children', async () => {
    const dir = makeTempDir();
    try {
      const nestedDir = join(dir, '.trails', 'rules', 'nested');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(
        join(nestedDir, 'nested-rule.ts'),
        `export const rule = {
  name: 'nested-project-rule',
  severity: 'error',
  description: 'Nested project-local fixture rule.',
  check(sourceCode, filePath) {
    return sourceCode.includes('nestedProjectProblem')
      ? [{
          filePath,
          line: 1,
          message: 'Nested project-local fixture marker found.',
          rule: 'nested-project-rule',
          severity: 'error',
        }]
      : [];
  },
};
`
      );
      writeFileSync(join(dir, 'fixture.ts'), 'const nestedProjectProblem = 1;');

      const report = await runWarden({
        lock: 'skip',
        rootDir: dir,
        tier: 'source-static',
      });

      expect(report.diagnostics.map((entry) => entry.rule)).not.toContain(
        'nested-project-rule'
      );
      expect(report.passed).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reports duplicate project-local rule ids', async () => {
    const dir = makeTempDir();
    try {
      writeProjectSourceRule(dir, {
        marker: 'firstProjectProblem',
        name: 'duplicate-project-rule',
      });
      writeProjectSourceRule(dir, {
        directory: true,
        marker: 'secondProjectProblem',
        name: 'duplicate-project-rule',
      });

      const report = await runWarden({
        lock: 'skip',
        rootDir: dir,
        tier: 'source-static',
      });

      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Duplicate project Warden rule id "duplicate-project-rule"'
          ),
          rule: 'project-warden-rules',
          severity: 'error',
        })
      );
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reports the retired trails/warden/rules location', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, 'trails', 'warden', 'rules'), { recursive: true });

      const report = await runWarden({
        lock: 'skip',
        rootDir: dir,
        tier: 'source-static',
      });

      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({
          filePath: join(dir, 'trails', 'warden', 'rules'),
          message:
            'Project Warden rules moved from trails/warden/rules to .trails/rules.ts or direct .trails/rules/*.ts files.',
          rule: 'project-warden-rules',
          severity: 'error',
        })
      );
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('can disable project-local rule loading for narrow embedders', async () => {
    const dir = makeTempDir();
    try {
      writeProjectSourceRule(dir);
      writeFileSync(join(dir, 'fixture.ts'), 'const projectLocalProblem = 1;');

      const report = await runWarden({
        lock: 'skip',
        projectRules: false,
        rootDir: dir,
        tier: 'source-static',
      });

      expect(report.diagnostics.map((entry) => entry.rule)).not.toContain(
        'project-local-rule'
      );
      expect(report.passed).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('does not import project-local rules for drift-only runs', async () => {
    const dir = makeTempDir();
    try {
      const ruleDir = join(dir, '.trails', 'rules');
      mkdirSync(ruleDir, { recursive: true });
      writeFileSync(
        join(ruleDir, 'bad.ts'),
        "throw new Error('drift should not import me');\n"
      );

      const report = await runWarden({
        lock: 'skip',
        rootDir: dir,
        tier: 'drift',
      });

      expect(report.diagnostics.map((entry) => entry.rule)).not.toContain(
        'project-warden-rules'
      );
      expect(report.passed).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defaults project-aware local rules to project-static metadata', async () => {
    const dir = makeTempDir();
    try {
      writeProjectAwareRule(dir);
      writeFileSync(join(dir, 'fixture.ts'), 'const projectAwareProblem = 1;');

      const sourceReport = await runWarden({
        lock: 'skip',
        rootDir: dir,
        tier: 'source-static',
      });
      expect(sourceReport.diagnostics.map((entry) => entry.rule)).not.toContain(
        'project-aware-rule'
      );

      const projectReport = await runWarden({
        lock: 'skip',
        rootDir: dir,
        tier: 'project-static',
      });
      expect(projectReport.diagnostics).toContainEqual(
        expect.objectContaining({
          filePath: join(dir, 'fixture.ts'),
          message: 'Project-aware fixture marker found.',
          rule: 'project-aware-rule',
        })
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reports invalid project-local rule modules as Warden diagnostics', async () => {
    const dir = makeTempDir();
    try {
      const ruleDir = join(dir, '.trails', 'rules');
      mkdirSync(ruleDir, { recursive: true });
      const rulePath = join(ruleDir, 'empty.ts');
      writeFileSync(rulePath, 'export const nothing = true;\n');

      const report = await runWarden({
        lock: 'skip',
        rootDir: dir,
        tier: 'source-static',
      });

      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({
          filePath: rulePath,
          message:
            'Project Warden rule module must export a WardenRule or TopoAwareWardenRule.',
          rule: 'project-warden-rules',
          severity: 'error',
        })
      );
      expect(report.passed).toBe(false);
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
          message: 'Do not throw inside the implementation.',
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
          message: 'Do not throw inside the implementation.',
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

  test('formats guidance docs with labels and copyable targets in the lint section', () => {
    const output = formatWardenReport({
      diagnostics: [
        {
          filePath: 'src/trails/entity.ts',
          guidance: {
            docs: [
              { label: 'Trail Rules', path: 'AGENTS.md#trail-rules' },
              {
                label: 'Warden docs',
                url: 'https://docs.example.test/warden',
              },
              { label: 'Label-only reference' },
            ],
            summary: 'Use the Warden guidance.',
          },
          line: 3,
          message: 'Do not throw inside the implementation.',
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
      'Docs: Trail Rules (AGENTS.md#trail-rules), Warden docs (https://docs.example.test/warden), Label-only reference'
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
