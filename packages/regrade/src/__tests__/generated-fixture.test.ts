import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

test('package consumer can run literal Regrade examples from a generated fixture', () => {
  const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
  // Keep the generated fixture under the package root so the consumer resolves
  // `@ontrails/regrade` via self-reference and `@ontrails/testing` via the
  // package's node_modules. Nest it under `.tmp-tests/` — already covered by the
  // root `.gitignore` `.tmp-tests/` rule — so an interrupted run leaves no
  // visible untracked debris under `packages/regrade`.
  const tmpRoot = join(packageRoot, '.tmp-tests');
  mkdirSync(tmpRoot, { recursive: true });
  const dir = mkdtempSync(join(tmpRoot, 'fixture-'));
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
