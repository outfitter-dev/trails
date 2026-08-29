import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeTrail, ValidationError } from '@ontrails/core';

import {
  renderAppIdCompletions,
  renderCompletionScript,
  renderTrailIdCompletions,
} from '../completions.js';
import { completionsTrail } from '../trails/completions.js';
import { completionsCompleteTrail } from '../trails/completions-complete.js';

const fishExecutable = Bun.which('fish');

interface AppSpec {
  readonly examplesByTrail?: Readonly<Record<string, readonly string[]>>;
  readonly name: string;
  readonly trailIds: readonly string[];
}

const writeFile = (filePath: string, contents: string): void => {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
};

const writeWorkspace = (root: string, apps: readonly AppSpec[]): void => {
  writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'completions-test-fixture',
        private: true,
        type: 'module',
        workspaces: ['apps/*'],
      },
      null,
      2
    )}\n`
  );
  writeFile(
    join(root, 'trails.config.json'),
    `${JSON.stringify(
      {
        workspace: {
          apps: Object.fromEntries(
            apps.map((app) => [app.name, { root: `apps/${app.name}` }])
          ),
        },
      },
      null,
      2
    )}\n`
  );
  for (const spec of apps) {
    const appDir = join(root, 'apps', spec.name);
    writeFile(
      join(appDir, 'package.json'),
      `${JSON.stringify(
        {
          name: spec.name,
          private: true,
          trails: { module: 'src/app.ts' },
          type: 'module',
        },
        null,
        2
      )}\n`
    );
    writeFile(
      join(appDir, 'src/app.ts'),
      [
        `const trailIds = ${JSON.stringify(spec.trailIds)};`,
        `const examplesByTrail = ${JSON.stringify(spec.examplesByTrail ?? {})};`,
        `export const app = {`,
        `  name: '${spec.name}',`,
        `  trails: new Map(trailIds.map((id) => [id, { id, examples: (examplesByTrail[id] ?? []).map((name) => ({ input: {}, name })) }])),`,
        `  ids: () => trailIds,`,
        `  get: (id) => trailIds.includes(id) ? { id, examples: (examplesByTrail[id] ?? []).map((name) => ({ input: {}, name })) } : undefined,`,
        `};`,
        '',
      ].join('\n')
    );
  }
};

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `completions-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { force: true, recursive: true });
});

describe('renderCompletionScript', () => {
  test('emits a bash completion script that registers a complete handler', () => {
    const script = renderCompletionScript('bash', 'trails').unwrap();
    expect(script).toContain('_trails_complete');
    expect(script).toContain('complete -F');
    expect(script).toContain('trails');
    expect(script).toContain('completions __complete');
    expect(script).toContain('while IFS= read -r suggestion');
    expect(script).toContain('completion_args+=("--args=$word")');
    expect(script).toMatch(/"\$\{completion_args\[@\]\}"/u);
    expect(script).not.toContain('readarray');
  });

  test('emits a zsh completion script with a compdef handler', () => {
    const script = renderCompletionScript('zsh', 'trails').unwrap();
    expect(script).toContain('#compdef trails');
    expect(script).toContain('_trails_complete');
    expect(script).toContain('completions __complete');
    expect(script).toContain('trail_words');
    expect(script).toContain('completion_args+=("--args=$trail_word")');
    expect(script).toMatch(/"\$\{completion_args\[@\]\}"/u);
    expect(script).toContain('if [[ -n "$output" ]]');
  });

  test('emits a fish completion script that uses complete -c', () => {
    const script = renderCompletionScript('fish', 'trails').unwrap();
    expect(script).toContain('complete -c trails');
    expect(script).toContain('completions __complete');
    expect(script).toContain('set -l prior_tokens (commandline -opc)');
    expect(script).toContain('set -a completion_args "--args=$token"');
    expect(script).toContain('set -l current_token (commandline -ct)');
    expect(script).toContain('set -a completion_args --args=');
    expect(script).toContain(
      'set -a completion_args "--args=$current_token[1]"'
    );
    expect(script).toContain('completions __complete $completion_args');
  });

  test.skipIf(fishExecutable === null)(
    'executes the generated fish boundary with distinct prior and current tokens (requires fish)',
    async () => {
      if (fishExecutable === null) {
        throw new Error('fish executable is unavailable');
      }
      const cases = [
        { current: undefined, expected: '--args=' },
        { current: 'value with space', expected: '--args=value with space' },
        { current: '--app=alpha', expected: '--args=--app=alpha' },
      ] as const;

      for (const [index, fixture] of cases.entries()) {
        const scriptPath = join(workspaceRoot, `fish-boundary-${index}.fish`);
        const generated = renderCompletionScript('fish', 'capture').unwrap();
        writeFile(
          scriptPath,
          [
            'function commandline',
            '  switch $argv[1]',
            '    case -opc',
            "      printf '%s\\n' capture run",
            '    case -ct',
            ...(fixture.current === undefined
              ? []
              : [`      printf '%s\\n' ${JSON.stringify(fixture.current)}`]),
            '  end',
            'end',
            'function capture',
            '  for argument in $argv',
            '    printf \'<%s>\\n\' "$argument"',
            '  end',
            'end',
            generated,
            '__capture_complete',
            '',
          ].join('\n')
        );
        const child = Bun.spawn({
          cmd: [fishExecutable, scriptPath],
          stderr: 'pipe',
          stdout: 'pipe',
        });
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);

        expect(stderr).toBe('');
        expect(exitCode).toBe(0);
        expect(stdout.trim().split('\n')).toEqual([
          '<completions>',
          '<__complete>',
          '<--args=run>',
          `<${fixture.expected}>`,
        ]);
      }
    }
  );

  test('substitutes the bin name into bash idioms', () => {
    const script = renderCompletionScript('bash', 'mybin').unwrap();
    expect(script).toContain('complete -F _mybin_complete mybin');
  });

  test('returns a validation error for unsafe bin names', () => {
    const result = renderCompletionScript('bash', 'trails;rm');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain('binName must match');
    }
  });
});

describe('renderTrailIdCompletions', () => {
  test('returns trail ids matching the prefix, sorted', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read', 'book.write', 'guide.list'],
      },
    ]);

    const matches = await renderTrailIdCompletions(workspaceRoot, 'book');
    expect(matches).toEqual(['book.read', 'book.write']);
  });

  test('empty prefix returns all trail ids sorted', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['guide.list', 'book.read'],
      },
    ]);

    const matches = await renderTrailIdCompletions(workspaceRoot, '');
    expect(matches).toEqual(['book.read', 'guide.list']);
  });

  test('unknown prefix returns an empty list', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read', 'guide.list'],
      },
    ]);

    const matches = await renderTrailIdCompletions(workspaceRoot, 'xyz');
    expect(matches).toEqual([]);
  });

  test('indexing failures degrade to an empty suggestion list', async () => {
    const matches = await renderTrailIdCompletions(
      join(workspaceRoot, 'missing'),
      ''
    );
    expect(matches).toEqual([]);
  });

  test('includes ids from collisions across multiple apps', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['shared.id', 'a.only'] },
      { name: 'app-b', trailIds: ['shared.id', 'b.only'] },
    ]);

    const matches = await renderTrailIdCompletions(workspaceRoot, '');
    expect(matches).toEqual(['a.only', 'b.only', 'shared.id']);
  });

  test('keeps healthy app ids when configured siblings are unavailable', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'healthy', trailIds: ['healthy.id'] },
      { name: 'broken', trailIds: ['broken.id'] },
      { name: 'mismatch', trailIds: ['mismatch.id'] },
    ]);
    writeFile(
      join(workspaceRoot, 'apps/broken/src/app.ts'),
      `throw new Error('broken boot');\n`
    );
    const mismatchPath = join(workspaceRoot, 'apps/mismatch/src/app.ts');
    writeFile(
      mismatchPath,
      readFileSync(mismatchPath, 'utf8').replace(
        "name: 'mismatch'",
        "name: 'other'"
      )
    );

    expect(await renderTrailIdCompletions(workspaceRoot, '')).toEqual([
      'healthy.id',
    ]);
  });

  test('rejects live topos whose names do not match Config app IDs', async () => {
    writeWorkspace(workspaceRoot, [{ name: 'docs', trailIds: ['book.read'] }]);
    const appPath = join(workspaceRoot, 'apps/docs/src/app.ts');
    writeFileSync(
      appPath,
      readFileSync(appPath, 'utf8').replace("name: 'docs'", "name: 'other'")
    );

    expect(await renderTrailIdCompletions(workspaceRoot, '')).toEqual([]);
  });
});

describe('renderAppIdCompletions', () => {
  test('returns matching Config-owned IDs without loading app modules', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'alpha', trailIds: [] },
      { name: 'beta', trailIds: [] },
    ]);

    expect(await renderAppIdCompletions(workspaceRoot, 'a')).toEqual(['alpha']);
  });
});

describe('completionsTrail', () => {
  test('returns a bash script for shell=bash', async () => {
    const result = await executeTrail(completionsTrail, { shell: 'bash' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('_trails_complete');
      expect(result.value).toContain('complete -F');
    }
  });

  test('returns a zsh script for shell=zsh', async () => {
    const result = await executeTrail(completionsTrail, { shell: 'zsh' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('#compdef trails');
    }
  });

  test('returns a fish script for shell=fish', async () => {
    const result = await executeTrail(completionsTrail, { shell: 'fish' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('complete -c trails');
    }
  });
});

describe('completionsCompleteTrail', () => {
  test('completes separated and inline --app values', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'alpha', trailIds: [] },
      { name: 'beta', trailIds: [] },
    ]);

    const separated = await executeTrail(completionsCompleteTrail, {
      args: ['wayfind', '--app', 'a'],
      rootDir: workspaceRoot,
    });
    const inline = await executeTrail(completionsCompleteTrail, {
      args: ['warden', '--app=b'],
      rootDir: workspaceRoot,
    });

    expect(separated.unwrap()).toBe('alpha');
    expect(inline.unwrap()).toBe('--app=beta');
  });

  test('finds Config-owned app IDs from a nested app working directory', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'alpha', trailIds: [] },
      { name: 'beta', trailIds: [] },
    ]);

    const result = await completionsCompleteTrail.implementation(
      completionsCompleteTrail.input.parse({
        args: ['wayfind', '--app', 'a'],
      }),
      { cwd: join(workspaceRoot, 'apps/alpha/src') } as never
    );

    expect(result.unwrap()).toBe('alpha');
  });

  test.each([
    [
      'separated root and app',
      (root: string) => ['wayfind', '--root-dir', root, '--app', 'a'],
    ],
    [
      'inline root and separated app',
      (root: string) => ['wayfind', `--root-dir=${root}`, '--app', 'a'],
    ],
    [
      'separated root and inline app',
      (root: string) => ['wayfind', '--root-dir', root, '--app=a'],
    ],
    [
      'inline root and app',
      (root: string) => ['wayfind', `--root-dir=${root}`, '--app=a'],
    ],
  ] as const)(
    'uses a typed cross-project root for non-run app completion: %s',
    async (_name, argsForRoot) => {
      const sourceRoot = join(workspaceRoot, 'source');
      const targetRoot = join(workspaceRoot, 'target');
      writeWorkspace(sourceRoot, [
        { name: 'gamma', trailIds: [] },
        { name: 'theta', trailIds: [] },
      ]);
      writeWorkspace(targetRoot, [
        { name: 'alpha', trailIds: [] },
        { name: 'beta', trailIds: [] },
      ]);

      const result = await completionsCompleteTrail.implementation(
        completionsCompleteTrail.input.parse({ args: argsForRoot(targetRoot) }),
        { cwd: join(sourceRoot, 'apps/gamma/src') } as never
      );

      expect(result.unwrap()).toBe(
        argsForRoot(targetRoot).at(-1)?.startsWith('--app=') === true
          ? '--app=alpha'
          : 'alpha'
      );
    }
  );

  test.each([
    [
      'separated root, module, and app',
      (root: string) => [
        'wayfind',
        '--root-dir',
        root,
        '--module',
        'src/missing.ts',
        '--app',
        'a',
      ],
    ],
    [
      'inline root and module with separated app',
      (root: string) => [
        'wayfind',
        `--root-dir=${root}`,
        '--module=src/missing.ts',
        '--app',
        'a',
      ],
    ],
    [
      'separated root and module with inline app',
      (root: string) => [
        'wayfind',
        '--root-dir',
        root,
        '--module',
        'src/missing.ts',
        '--app=a',
      ],
    ],
    [
      'module after an earlier partial app',
      (root: string) => [
        'wayfind',
        `--root-dir=${root}`,
        '--app=a',
        '--module=src/missing.ts',
        '--app=a',
      ],
    ],
  ] as const)(
    'defers module selection while completing an app: %s',
    async (_name, argsForRoot) => {
      const sourceRoot = join(workspaceRoot, 'source');
      const targetRoot = join(workspaceRoot, 'target');
      writeWorkspace(sourceRoot, [{ name: 'gamma', trailIds: [] }]);
      writeWorkspace(targetRoot, [{ name: 'alpha', trailIds: [] }]);
      const args = argsForRoot(targetRoot);

      const result = await completionsCompleteTrail.implementation(
        completionsCompleteTrail.input.parse({ args }),
        { cwd: join(sourceRoot, 'apps/gamma/src') } as never
      );

      expect(result.unwrap()).toBe(
        args.at(-1)?.startsWith('--app=') === true ? '--app=alpha' : 'alpha'
      );
    }
  );

  test('preserves completed app and module selection outside app-value completion', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'alpha', trailIds: ['alpha.read'] },
    ]);
    writeFile(
      join(workspaceRoot, 'apps/alpha/src/alternate.ts'),
      [
        `const trail = { id: 'alternate.read', examples: [{ input: {}, name: 'Alternate example' }] };`,
        `export const app = {`,
        `  name: 'alpha',`,
        `  trails: new Map([[trail.id, trail]]),`,
        `  ids: () => [trail.id],`,
        `  get: (id) => id === trail.id ? trail : undefined,`,
        `};`,
        '',
      ].join('\n')
    );

    const completedApp = await executeTrail(completionsCompleteTrail, {
      args: ['run', '--app=alpha', '--module', 'src/alternate.ts', 'alternate'],
      rootDir: workspaceRoot,
    });
    const completedExample = await executeTrail(completionsCompleteTrail, {
      args: [
        'run',
        'example',
        'alternate.read',
        '--app=alpha',
        '--module=src/alternate.ts',
        'Alternate',
      ],
      rootDir: workspaceRoot,
    });
    const moduleWithoutApp = await executeTrail(completionsCompleteTrail, {
      args: ['run', '--module', 'src/app.ts', 'alpha'],
      rootDir: workspaceRoot,
    });

    expect(completedApp.unwrap()).toBe('alternate.read');
    expect(completedExample.unwrap()).toBe('Alternate example');
    expect(moduleWithoutApp.isErr()).toBe(true);
  });

  test.each([
    [
      'trail ID with separated module',
      ['run', '--module', 'src/alternate.ts', 'alternate'],
      'alternate.read',
    ],
    [
      'trail ID with inline module',
      ['run', '--module=src/alternate.ts', 'alternate'],
      'alternate.read',
    ],
    [
      'example name with separated module',
      [
        'run',
        'example',
        'alternate.read',
        '--module',
        'src/alternate.ts',
        'Alternate',
      ],
      'Alternate example',
    ],
    [
      'example name with inline module',
      [
        'run',
        'example',
        'alternate.read',
        '--module=src/alternate.ts',
        'Alternate',
      ],
      'Alternate example',
    ],
  ] as const)(
    'preserves standalone module selection for %s',
    async (_name, args, expected) => {
      writeFile(
        join(workspaceRoot, 'package.json'),
        `${JSON.stringify({ name: 'standalone', private: true, type: 'module' }, null, 2)}\n`
      );
      writeFile(
        join(workspaceRoot, 'src/alternate.ts'),
        [
          `const trail = { id: 'alternate.read', examples: [{ input: {}, name: 'Alternate example' }] };`,
          `export const app = {`,
          `  name: 'standalone',`,
          `  trails: new Map([[trail.id, trail]]),`,
          `  ids: () => [trail.id],`,
          `  get: (id) => id === trail.id ? trail : undefined,`,
          `};`,
          '',
        ].join('\n')
      );

      const result = await executeTrail(completionsCompleteTrail, {
        args: [...args],
        rootDir: workspaceRoot,
      });

      expect(result.unwrap()).toBe(expected);
    }
  );

  test('uses the same typed root contract for another non-run app-aware command', async () => {
    const sourceRoot = join(workspaceRoot, 'source');
    const targetRoot = join(workspaceRoot, 'target');
    writeWorkspace(sourceRoot, [{ name: 'gamma', trailIds: [] }]);
    writeWorkspace(targetRoot, [{ name: 'alpha', trailIds: [] }]);

    const result = await completionsCompleteTrail.implementation(
      completionsCompleteTrail.input.parse({
        args: ['warden', `--root-dir=${targetRoot}`, '--app', 'a'],
      }),
      { cwd: join(sourceRoot, 'apps/gamma/src') } as never
    );

    expect(result.unwrap()).toBe('alpha');
  });

  test('retains CWD and completion-input root fallbacks when argv has no typed root', async () => {
    const sourceRoot = join(workspaceRoot, 'source');
    const targetRoot = join(workspaceRoot, 'target');
    writeWorkspace(sourceRoot, [{ name: 'gamma', trailIds: [] }]);
    writeWorkspace(targetRoot, [{ name: 'alpha', trailIds: [] }]);

    const fromCwd = await completionsCompleteTrail.implementation(
      completionsCompleteTrail.input.parse({
        args: ['wayfind', '--app', 'g'],
      }),
      { cwd: join(sourceRoot, 'apps/gamma/src') } as never
    );
    const fromInputRoot = await completionsCompleteTrail.implementation(
      completionsCompleteTrail.input.parse({
        args: ['wayfind', '--app', 'a'],
        rootDir: targetRoot,
      }),
      { cwd: join(sourceRoot, 'apps/gamma/src') } as never
    );

    expect(fromCwd.unwrap()).toBe('gamma');
    expect(fromInputRoot.unwrap()).toBe('alpha');
  });

  test('real CLI honors a root carried inside repeated completion args', async () => {
    const sourceRoot = join(workspaceRoot, 'source');
    const targetRoot = join(workspaceRoot, 'target');
    writeWorkspace(sourceRoot, [{ name: 'gamma', trailIds: [] }]);
    writeWorkspace(targetRoot, [{ name: 'alpha', trailIds: [] }]);
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        join(import.meta.dir, '../../bin/trails.ts'),
        'completions',
        '__complete',
        '--args=wayfind',
        '--args=--root-dir',
        `--args=${targetRoot}`,
        '--args=--app',
        '--args=a',
      ],
      cwd: sourceRoot,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('alpha');
  });

  test('real CLI defers a repeated module arg while completing an app', async () => {
    const sourceRoot = join(workspaceRoot, 'source');
    const targetRoot = join(workspaceRoot, 'target');
    writeWorkspace(sourceRoot, [{ name: 'gamma', trailIds: [] }]);
    writeWorkspace(targetRoot, [{ name: 'alpha', trailIds: [] }]);
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        join(import.meta.dir, '../../bin/trails.ts'),
        'completions',
        '__complete',
        '--args=wayfind',
        '--args=--root-dir',
        `--args=${targetRoot}`,
        '--args=--module',
        '--args=src/missing.ts',
        '--args=--app',
        '--args=a',
      ],
      cwd: sourceRoot,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('alpha');
  });

  test('returns trail-id suggestions for `trails run <prefix>`', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read', 'book.write', 'guide.list'],
      },
    ]);

    const result = await executeTrail(completionsCompleteTrail, {
      args: ['run', 'book'],
      rootDir: workspaceRoot,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('book.read\nbook.write');
    }
  });

  test('returns all ids when prefix is empty after `run`', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read', 'guide.list'],
      },
    ]);

    const result = await executeTrail(completionsCompleteTrail, {
      args: ['run', ''],
      rootDir: workspaceRoot,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('book.read\nguide.list');
    }
  });

  test('keeps trail-id suggestions inside the configured app selected by nested CWD', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'alpha', trailIds: ['alpha.only', 'shared.id'] },
      { name: 'beta', trailIds: ['beta.only', 'shared.id'] },
    ]);

    const result = await completionsCompleteTrail.implementation(
      completionsCompleteTrail.input.parse({ args: ['run', ''] }),
      { cwd: join(workspaceRoot, 'apps/alpha/src') } as never
    );

    expect(result.unwrap()).toBe('alpha.only\nshared.id');
  });

  test('keeps example suggestions inside the configured app selected by nested CWD', async () => {
    writeWorkspace(workspaceRoot, [
      {
        examplesByTrail: { 'shared.id': ['Alpha example'] },
        name: 'alpha',
        trailIds: ['shared.id'],
      },
      {
        examplesByTrail: { 'shared.id': ['Beta example'] },
        name: 'beta',
        trailIds: ['shared.id'],
      },
    ]);

    const result = await completionsCompleteTrail.implementation(
      completionsCompleteTrail.input.parse({
        args: ['run', 'example', 'shared.id', ''],
      }),
      { cwd: join(workspaceRoot, 'apps/alpha/src') } as never
    );

    expect(result.unwrap()).toBe('Alpha example');
  });

  test.each([
    ['separated before value', ['run', '--app', 'alpha', '']],
    ['inline before value', ['run', '--app=alpha', '']],
  ] as const)(
    'honors a completed app selector for trail IDs: %s',
    async (_name, args) => {
      writeWorkspace(workspaceRoot, [
        { name: 'alpha', trailIds: ['alpha.only', 'shared.id'] },
        { name: 'beta', trailIds: ['beta.only', 'shared.id'] },
      ]);

      const result = await completionsCompleteTrail.implementation(
        completionsCompleteTrail.input.parse({ args }),
        { cwd: join(workspaceRoot, 'apps/beta/src') } as never
      );

      expect(result.unwrap()).toBe('alpha.only\nshared.id');
    }
  );

  test.each([
    ['before example', ['run', '--app', 'alpha', 'example', 'shared.id', '']],
    [
      'between example and trail',
      ['run', 'example', '--app=alpha', 'shared.id', ''],
    ],
    [
      'between trail and prefix',
      ['run', 'example', 'shared.id', '--app', 'alpha', ''],
    ],
  ] as const)(
    'honors a completed app selector for examples: %s',
    async (_name, args) => {
      writeWorkspace(workspaceRoot, [
        {
          examplesByTrail: { 'shared.id': ['Alpha example'] },
          name: 'alpha',
          trailIds: ['shared.id'],
        },
        {
          examplesByTrail: { 'shared.id': ['Beta example'] },
          name: 'beta',
          trailIds: ['shared.id'],
        },
      ]);

      const result = await completionsCompleteTrail.implementation(
        completionsCompleteTrail.input.parse({ args }),
        { cwd: join(workspaceRoot, 'apps/beta/src') } as never
      );

      expect(result.unwrap()).toBe('Alpha example');
    }
  );

  test('keeps unknown completed app selection typed', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'alpha', trailIds: ['alpha.only'] },
      { name: 'beta', trailIds: ['beta.only'] },
    ]);

    const result = await executeTrail(completionsCompleteTrail, {
      args: ['run', '--app=missing', ''],
      rootDir: workspaceRoot,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain('Unknown app "missing"');
    }
  });

  test('real CLI accepts repeated inline args including flags, spaces, and the empty token', async () => {
    writeWorkspace(workspaceRoot, [
      {
        examplesByTrail: { 'alpha.only': ['Alpha example'] },
        name: 'alpha',
        trailIds: ['alpha.only'],
      },
      { name: 'beta', trailIds: ['beta.only'] },
    ]);
    const emptyTokenProcess = Bun.spawn({
      cmd: [
        process.execPath,
        join(import.meta.dir, '../../bin/trails.ts'),
        'completions',
        '__complete',
        '--args=run',
        '--args=--app=alpha',
        '--args=',
        `--root-dir=${workspaceRoot}`,
      ],
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      emptyTokenProcess.exited,
      new Response(emptyTokenProcess.stdout).text(),
      new Response(emptyTokenProcess.stderr).text(),
    ]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('alpha.only');

    const spacedTokenProcess = Bun.spawn({
      cmd: [
        process.execPath,
        join(import.meta.dir, '../../bin/trails.ts'),
        'completions',
        '__complete',
        '--args=run',
        '--args=--app',
        '--args=alpha',
        '--args=example',
        '--args=alpha.only',
        '--args=Alpha ',
        `--root-dir=${workspaceRoot}`,
      ],
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const [spacedExitCode, spacedStdout, spacedStderr] = await Promise.all([
      spacedTokenProcess.exited,
      new Response(spacedTokenProcess.stdout).text(),
      new Response(spacedTokenProcess.stderr).text(),
    ]);
    expect(spacedStderr).toBe('');
    expect(spacedExitCode).toBe(0);
    expect(spacedStdout.trim()).toBe('Alpha example');
  });

  test('does not suggest trail ids when cursor is past the trail-id slot', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read', 'guide.list'],
      },
    ]);

    const result = await executeTrail(completionsCompleteTrail, {
      args: ['run', 'book.read', ''],
      rootDir: workspaceRoot,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('');
    }
  });

  test('returns no suggestions when args do not target a known position', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read'],
      },
    ]);

    const result = await executeTrail(completionsCompleteTrail, {
      args: ['unknown-subcommand'],
      rootDir: workspaceRoot,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('');
    }
  });
});
