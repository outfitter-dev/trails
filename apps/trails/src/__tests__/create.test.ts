import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { Result } from '@ontrails/core';

import { addSurface } from '../trails/add-surface.js';
import { addVerify } from '../trails/add-verify.js';
import { createRoute } from '../trails/create.js';
import { createScaffold } from '../trails/create-scaffold.js';
import { isInsideProject } from '../trails/project.js';

type Starter = 'empty' | 'entity' | 'hello';
type Surface = 'cli' | 'mcp';

const makeTempProject = (): string =>
  join(
    tmpdir(),
    `trails-create-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

const readJson = (dir: string, relativePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, relativePath), 'utf8')) as Record<
    string,
    unknown
  >;

const readText = (dir: string, relativePath: string): string =>
  readFileSync(join(dir, relativePath), 'utf8');

const expectPaths = (
  dir: string,
  relativePaths: readonly string[],
  expected: boolean
): void => {
  for (const relativePath of relativePaths) {
    expect(existsSync(join(dir, relativePath))).toBe(expected);
  }
};

const expectContainsAll = (
  content: string,
  snippets: readonly string[]
): void => {
  for (const snippet of snippets) {
    expect(content).toContain(snippet);
  }
};

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const expectErr = <T>(result: Result<T, Error>): Error => {
  if (result.isOk()) {
    throw new Error('Expected error result');
  }
  return result.error;
};

const runFollow = async (
  id: string,
  input: unknown
): Promise<Result<unknown, Error>> => {
  switch (id) {
    case 'create.scaffold': {
      return await createScaffold.blaze(input as never, {} as never);
    }
    case 'add.surface': {
      return await addSurface.blaze(input as never, {} as never);
    }
    case 'add.verify': {
      return await addVerify.blaze(input as never, {} as never);
    }
    default: {
      return Result.err(new Error(`Unknown follow target: ${id}`));
    }
  }
};

const runCreate = (
  projectDir: string,
  overrides?: Partial<{
    starter: Starter;
    surfaces: readonly Surface[];
    verify: boolean;
  }>
) =>
  createRoute.blaze(
    {
      dir: dirname(projectDir),
      name: basename(projectDir),
      starter: overrides?.starter ?? 'hello',
      surfaces: [...(overrides?.surfaces ?? ['cli'])],
      verify: overrides?.verify ?? true,
    },
    { follow: runFollow } as never
  );

const setupMinimalProject = (dir: string): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, '.trails'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    "import { topo } from '@ontrails/core';\nexport const app = topo('test');\n"
  );
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      { dependencies: { '@ontrails/core': 'workspace:*' }, name: 'test' },
      null,
      2
    )
  );
};

const assertDefaultProjectFiles = (dir: string): void => {
  expectPaths(
    dir,
    [
      'package.json',
      'tsconfig.json',
      '.gitignore',
      '.oxlintrc.json',
      '.oxfmtrc.jsonc',
      'src/app.ts',
      '.trails',
      'src/cli.ts',
      'src/trails/hello.ts',
      '__tests__/examples.test.ts',
      'lefthook.yml',
    ],
    true
  );
};

const assertCliPackage = (dir: string): void => {
  const pkg = readJson(dir, 'package.json');
  expect(pkg['name']).toBe(basename(dir));

  const deps = pkg['dependencies'] as Record<string, string>;
  expect(deps['@ontrails/core']).toBe('workspace:*');
  expect(deps['@ontrails/cli']).toBe('workspace:*');
  expect(deps['commander']).toBeDefined();

  const devDeps = pkg['devDependencies'] as Record<string, string>;
  expect(devDeps['@ontrails/testing']).toBe('workspace:*');
  expect(devDeps['@ontrails/warden']).toBe('workspace:*');
};

const assertHelloApp = (dir: string): void => {
  expectContainsAll(readText(dir, 'src/app.ts'), [
    'topo',
    `'${basename(dir)}'`,
    'hello',
  ]);
  expectContainsAll(readText(dir, 'src/trails/hello.ts'), [
    "import { Result, trail } from '@ontrails/core'",
    'return Result.ok({ message:',
  ]);
};

const assertEntityStarter = (dir: string): void => {
  expectPaths(
    dir,
    [
      'src/trails/entity.ts',
      'src/trails/search.ts',
      'src/trails/onboard.ts',
      'src/events/entity-events.ts',
      'src/store.ts',
    ],
    true
  );
  expectPaths(dir, ['src/trails/hello.ts'], false);
  expectContainsAll(readText(dir, 'src/app.ts'), [
    "import * as entity from './trails/entity.js'",
    "import * as search from './trails/search.js'",
    "import * as onboard from './trails/onboard.js'",
    "import * as entityEvents from './events/entity-events.js'",
  ]);
  expectContainsAll(readText(dir, 'src/trails/entity.ts'), [
    "import { Result, trail } from '@ontrails/core'",
    'return Result.ok({ id: input.id, name:',
    "return Result.ok({ id: '1', name: input.name })",
  ]);
  expectContainsAll(readText(dir, 'src/trails/search.ts'), [
    "import { Result, trail } from '@ontrails/core'",
    'return Result.ok({ results: [] })',
  ]);
  expectContainsAll(readText(dir, 'src/trails/onboard.ts'), [
    "import { Result, trail } from '@ontrails/core'",
    'return Result.ok({ onboarded: true })',
  ]);
};

const assertMcpSurface = (dir: string): void => {
  expectPaths(dir, ['src/mcp.ts'], true);
  expectPaths(dir, ['src/cli.ts'], false);
  expectContainsAll(readText(dir, 'src/mcp.ts'), [
    "import { trailhead } from '@ontrails/mcp'",
    'await trailhead(app)',
  ]);

  const deps = readJson(dir, 'package.json')['dependencies'] as Record<
    string,
    string
  >;
  expect(deps['@ontrails/mcp']).toBe('workspace:*');
  expect(deps['@ontrails/cli']).toBeUndefined();
};

const assertVerifySkipped = (dir: string): void => {
  expectPaths(dir, ['__tests__/examples.test.ts', 'lefthook.yml'], false);
  expect(readJson(dir, 'package.json')['devDependencies']).toBeUndefined();
};

const assertEmptyStarter = (dir: string): void => {
  expectPaths(dir, ['src/trails/.gitkeep'], true);
  expectPaths(dir, ['src/trails/hello.ts'], false);
  const appContent = readText(dir, 'src/app.ts');
  expect(appContent).toContain(`topo('${basename(dir)}')`);
  expect(appContent).not.toContain('import * as');
};

const withTempProject = async (
  assertion: (dir: string) => Promise<void>
): Promise<void> => {
  const dir = makeTempProject();
  try {
    await assertion(dir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

describe('trails create', () => {
  describe('create mode', () => {
    test('generates project structure with defaults', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir));
        assertDefaultProjectFiles(dir);
        assertCliPackage(dir);
        assertHelloApp(dir);
      });
    });

    test('generates with entity starter', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { starter: 'entity' }));
        assertEntityStarter(dir);
      });
    });

    test('generates with MCP surface', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { surfaces: ['mcp'] }));
        assertMcpSurface(dir);
      });
    });

    test('skips verification when verify is false', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { verify: false }));
        assertVerifySkipped(dir);
      });
    });

    test('generates with empty starter', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { starter: 'empty' }));
        assertEmptyStarter(dir);
      });
    });
  });

  describe('add-surface mode', () => {
    test('adds MCP to existing project', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const result = expectOk(
          await addSurface.blaze({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('src/mcp.ts');
        expect(result.dependency).toBe('@ontrails/mcp');
        expectPaths(dir, ['src/mcp.ts'], true);
        expectContainsAll(readText(dir, 'src/mcp.ts'), [
          "import { trailhead } from '@ontrails/mcp'",
        ]);
        const deps = readJson(dir, 'package.json')['dependencies'] as Record<
          string,
          string
        >;
        expect(deps['@ontrails/mcp']).toBe('workspace:*');
      });
    });

    test('detects existing trailhead entrypoint', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(join(dir, 'src'), { recursive: true });
        mkdirSync(join(dir, '.trails'), { recursive: true });
        writeFileSync(join(dir, 'src', 'mcp.ts'), 'existing content');

        const error = expectErr(
          await addSurface.blaze({ dir, surface: 'mcp' }, {} as never)
        );
        expect(error.message).toBe(
          'MCP trailhead already exists. Nothing to do.'
        );
      });
    });
  });
});

describe('isInsideProject', () => {
  test('detects .trails directory', async () => {
    await withTempProject(async (dir) => {
      mkdirSync(join(dir, '.trails'), { recursive: true });
      expect(await isInsideProject(dir)).toBe(true);
    });
  });

  test('detects topo in src/', async () => {
    await withTempProject(async (dir) => {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'src', 'app.ts'),
        "import { topo } from '@ontrails/core';\nexport const app = topo('app');\n"
      );
      expect(await isInsideProject(dir)).toBe(true);
    });
  });

  test('returns false for empty directory', async () => {
    await withTempProject(async (dir) => {
      mkdirSync(dir, { recursive: true });
      expect(await isInsideProject(dir)).toBe(false);
    });
  });
});
