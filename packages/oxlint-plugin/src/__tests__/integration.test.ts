import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const decoder = new TextDecoder();

describe('@ontrails/oxlint-plugin integration', () => {
  test('loads from the root oxlint config', () => {
    const repoRoot = join(import.meta.dirname, '../../../..');
    const fixtureRoot = join(
      repoRoot,
      '.tmp-tests',
      `oxlint-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const fixtureDir = join(fixtureRoot, 'packages', 'example', 'src');
    const fixtureSource = join(fixtureDir, 'smoke.ts');

    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      fixtureSource,
      '// oxlint-local-plugin-smoke\nexport const loaded = true;\n'
    );

    try {
      const result = Bun.spawnSync(
        ['bunx', 'oxlint', fixtureSource, '--config', 'oxlint.config.ts'],
        {
          cwd: repoRoot,
          stderr: 'pipe',
          stdout: 'pipe',
        }
      );

      const output = [
        decoder.decode(result.stdout).trim(),
        decoder.decode(result.stderr).trim(),
      ]
        .filter(Boolean)
        .join('\n');

      expect(result.exitCode).not.toBe(0);
      expect(output).toContain('The Trails repo-local oxlint plugin is loaded');
      expect(output).not.toContain('Failed to load JS plugin');
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
