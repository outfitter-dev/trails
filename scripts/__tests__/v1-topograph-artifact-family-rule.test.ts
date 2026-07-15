import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWarden } from '@ontrails/warden';

import { v1TopographArtifactFamily } from '../../.trails/rules/v1-topograph-artifact-family.js';

describe('v1 TopoGraph artifact-family rule', () => {
  test('reports every retired artifact-family form', () => {
    const source = [
      'SurfaceMap SurfaceMapEntry _surface.json surface_map serialized_lock',
      '.trails/config/local.ts .trails/config.local.js',
      '.trails/trails.db .trails/trails.db-wal .trails/dev/ .trails/generated/',
    ].join('\n');

    const diagnostics = v1TopographArtifactFamily.check(
      source,
      'src/current.ts'
    );

    expect(diagnostics).toHaveLength(11);
    expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual([
      1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 3,
    ]);
  });

  test('allows documented history and narrow cleanup seams', () => {
    expect(
      v1TopographArtifactFamily.check(
        'SurfaceMap .trails/trails.db',
        'docs/migration/topograph-artifact-family.md'
      )
    ).toEqual([]);
    expect(
      v1TopographArtifactFamily.check(
        "join(rootDir, '.trails/trails.db')",
        'apps/trails/src/trails/dev-support.ts'
      )
    ).toEqual([]);
  });

  test('runs against current documentation and text files', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'warden-artifact-family-'));
    try {
      mkdirSync(join(rootDir, 'docs'), { recursive: true });
      mkdirSync(join(rootDir, 'apps'), { recursive: true });
      mkdirSync(join(rootDir, 'packages'), { recursive: true });
      mkdirSync(join(rootDir, 'plugin'), { recursive: true });
      mkdirSync(join(rootDir, 'scripts'), { recursive: true });
      writeFileSync(join(rootDir, 'AGENTS.md'), 'Use _surface.json.\n');
      writeFileSync(join(rootDir, 'apps/AGENTS.md'), 'Use _surface.json.\n');
      writeFileSync(join(rootDir, 'docs/current.md'), 'Use _surface.json.\n');
      writeFileSync(
        join(rootDir, 'plugin/current.md'),
        'Use .trails/trails.db.\n'
      );
      writeFileSync(
        join(rootDir, 'packages/AGENTS.md'),
        'Use .trails/trails.db.\n'
      );
      writeFileSync(
        join(rootDir, 'scripts/current.sh'),
        'rm .trails/trails.db\n'
      );

      const report = await runWarden({
        extraSourceRules: [v1TopographArtifactFamily],
        lock: 'skip',
        rootDir,
      });

      expect(
        report.diagnostics
          .filter((entry) => entry.rule === 'v1-topograph-artifact-family')
          .map((entry) => entry.filePath)
          .toSorted()
      ).toEqual([
        join(rootDir, 'AGENTS.md'),
        join(rootDir, 'apps/AGENTS.md'),
        join(rootDir, 'docs/current.md'),
        join(rootDir, 'packages/AGENTS.md'),
        join(rootDir, 'plugin/current.md'),
        join(rootDir, 'scripts/current.sh'),
      ]);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
