import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

test('package consumer can run literal Regrade examples from a generated fixture', () => {
  const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
  const dir = mkdtempSync(join(packageRoot, '.tmp-fixture-'));
  const fixture = join(dir, 'literal-regrade-fixture.test.ts');

  try {
    writeFileSync(
      fixture,
      `import { testExamples } from '@ontrails/testing';
import { literalRegradeTopo } from '@ontrails/regrade';

testExamples(literalRegradeTopo);
`
    );

    const proc = Bun.spawnSync(['bun', 'test', fixture], {
      cwd: packageRoot,
      stderr: 'pipe',
      stdout: 'pipe',
    });

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();
    expect(proc.exitCode, `${stdout}\n${stderr}`).toBe(0);
    expect(`${stdout}\n${stderr}`).toMatch(/\d+ pass/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
