import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';
import { wardenTopo } from '@ontrails/warden';

import { compile } from '../compile.js';
import type { CompileResult } from '../compile.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const writePlan = async (
  packageRoot: string,
  result: CompileResult
): Promise<void> => {
  for (const file of result.files) {
    const target = join(packageRoot, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
};

const linkPackage = async ({
  name,
  packageRoot,
  source,
}: {
  readonly name: string;
  readonly packageRoot: string;
  readonly source: string;
}): Promise<void> => {
  const target = join(packageRoot, 'node_modules', ...name.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await symlink(source, target, 'dir');
};

const run = async (
  cmd: readonly string[],
  cwd: string
): Promise<{ readonly stderr: string; readonly stdout: string }> => {
  const proc = Bun.spawn(cmd as string[], {
    cwd,
    env: {
      ...process.env,
      PATH: `${join(repoRoot, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${cmd.join(' ')} failed with exit ${exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
    );
  }
  return { stderr, stdout };
};

describe('Warden-as-library dogfood', () => {
  test('generated Warden package typechecks, packs, and runs through library subpaths', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'trails-warden-library-'));
    try {
      const packageRoot = join(tempRoot, 'generated-warden');
      await mkdir(packageRoot, { recursive: true });
      for (const [name, source] of [
        ['@ontrails/adapter-kit', 'packages/adapter-kit'],
        ['@ontrails/cli', 'packages/cli'],
        ['@ontrails/config', 'packages/config'],
        ['@ontrails/core', 'packages/core'],
        ['@ontrails/library', 'packages/library'],
        ['@ontrails/permits', 'packages/permits'],
        ['@ontrails/store', 'packages/store'],
        ['@ontrails/testing', 'packages/testing'],
        ['@ontrails/topographer', 'packages/topographer'],
        ['@ontrails/warden', 'packages/warden'],
        ['@types', 'node_modules/@types'],
        ['oxc-parser', 'node_modules/oxc-parser'],
        ['oxc-resolver', 'node_modules/oxc-resolver'],
        ['zod', 'node_modules/zod'],
      ] as const) {
        await linkPackage({
          name,
          packageRoot,
          source: join(repoRoot, source),
        });
      }
      await writeFile(
        join(packageRoot, 'fixture-warden-app.ts'),
        "export { wardenTopo as app } from '@ontrails/warden';\n"
      );
      await writeFile(
        join(packageRoot, 'fixture-warden-trails.ts'),
        "export { noThrowInImplementationTrail } from '@ontrails/warden';\n"
      );

      const result = compile(wardenTopo, {
        appExportName: 'app',
        appImportPath: '../fixture-warden-app',
        packageName: '@fixture/generated-warden',
        trailTypeExports: {
          'warden.rule.no-throw-in-implementation':
            'noThrowInImplementationTrail',
        },
        typeImportPath: '../fixture-warden-trails',
        version: '0.0.0-smoke',
      });
      await writePlan(packageRoot, result);

      await mkdir(join(packageRoot, '__tests__'), { recursive: true });
      await writeFile(
        join(packageRoot, '__tests__/dogfood.test.ts'),
        [
          "import { describe, expect, test } from 'bun:test';",
          "import type { WardenRuleNoThrowInImplementationInput, WardenRuleNoThrowInImplementationOutput } from '../src/schemas.js';",
          "import { wardenRuleNoThrowInImplementation } from '../src/index.js';",
          "import { wardenRuleNoThrowInImplementation as resultRule } from '../src/result.js';",
          "import { schemas } from '../src/schemas.js';",
          "import { app } from '../src/trails.js';",
          '',
          'const sourceCode = \'export const run = trail("sample", { blaze: () => { throw new Error("boom"); } });\';',
          '',
          "describe('generated Warden library', () => {",
          "  test('root, result, schemas, and trails subpaths work', async () => {",
          "    const input: WardenRuleNoThrowInImplementationInput = { filePath: 'src/sample.ts', sourceCode };",
          '    const rootOutput = await wardenRuleNoThrowInImplementation(input);',
          '    const typedRootOutput: WardenRuleNoThrowInImplementationOutput = rootOutput;',
          '    expect(typedRootOutput.diagnostics.length).toBeGreaterThan(0);',
          '    expect(rootOutput.diagnostics.some((item) => item.rule === "no-throw-in-implementation")).toBe(true);',
          '',
          '    const resultOutput = await resultRule(input);',
          '    expect(resultOutput.isOk()).toBe(true);',
          '    expect(resultOutput.value.diagnostics.some((item) => item.rule === "no-throw-in-implementation")).toBe(true);',
          '',
          '    expect(schemas.wardenRuleNoThrowInImplementation.input).toBeTruthy();',
          '    expect(schemas.wardenRuleNoThrowInImplementation.output).toBeTruthy();',
          "    expect(app.name).toBe('warden');",
          '  });',
          '});',
          '',
        ].join('\n')
      );

      await run(['tsc', '-p', 'tsconfig.json', '--noEmit'], packageRoot);
      await run(['bun', 'test', '__tests__/dogfood.test.ts'], packageRoot);
      const pack = await run(['bun', 'pm', 'pack', '--dry-run'], packageRoot);
      expect(pack.stdout).toContain('fixture-generated-warden-0.0.0-smoke.tgz');
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});
