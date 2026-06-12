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
import { fileURLToPath } from 'node:url';

import { Result, ValidationError } from '@ontrails/core';

import { addSurface } from '../trails/add-surface.js';
import { addVerify } from '../trails/add-verify.js';
import { createTrail } from '../trails/create.js';
import { createScaffold } from '../trails/create-scaffold.js';
import { isInsideProject } from '../trails/project.js';
import { PROJECT_NAME_MESSAGE } from '../project-writes.js';
import {
  ontrailsPackageRange,
  scaffoldDependencyVersions,
  trailsPackageVersion,
} from '../versions.js';

type Starter = 'empty' | 'entity' | 'hello';
type Surface = 'cli' | 'http' | 'mcp';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const formatterTimeoutMs = 30_000;

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

const expectCreatedPaths = (
  created: readonly string[],
  relativePaths: readonly string[]
): void => {
  expect(created).toEqual(expect.arrayContaining(relativePaths));
};

const expectExactOntrailsPin = (value: string | undefined): void => {
  expect(value).toBe(ontrailsPackageRange);
  expect(value?.startsWith('^')).toBe(false);
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

const expectGeneratedProjectFormatCheck = (dir: string): void => {
  const command = ['bunx', 'oxfmt', '--check', dir];
  const proc = Bun.spawnSync({
    cmd: command,
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: '1' } as Record<string, string>,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: formatterTimeoutMs,
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  const signalCode = proc.signalCode ?? undefined;
  if (
    proc.exitCode !== 0 ||
    proc.exitedDueToTimeout ||
    signalCode !== undefined
  ) {
    throw new Error(
      [
        'Generated Trails scaffold did not pass its Oxfmt contract.',
        `command: ${command.join(' ')}`,
        `cwd: ${repoRoot}`,
        `target: ${dir}`,
        `exitCode: ${proc.exitCode ?? 'null'}`,
        `signal: ${signalCode ?? 'null'}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join('\n')
    );
  }
};

const runCompose = async (
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
      return Result.err(new Error(`Unknown compose target: ${id}`));
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
  createTrail.blaze(
    {
      dir: dirname(projectDir),
      name: basename(projectDir),
      starter: overrides?.starter ?? 'hello',
      surfaces: [...(overrides?.surfaces ?? ['cli'])],
      verify: overrides?.verify ?? true,
    },
    { compose: runCompose } as never
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
      {
        dependencies: { '@ontrails/core': ontrailsPackageRange },
        name: 'test',
      },
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
      'AGENTS.md',
      'CLAUDE.md',
      'README.md',
      'tsconfig.json',
      'tsconfig.tests.json',
      '.gitignore',
      'oxlint.config.ts',
      '.oxfmtrc.jsonc',
      'src/app.ts',
      '.trails',
      '.trails/scaffold.json',
      'src/cli.ts',
      'src/trails/hello.ts',
      '__tests__/examples.test.ts',
      'lefthook.yml',
    ],
    true
  );
};

const assertTsconfigTests = (dir: string): void => {
  const tsconfig = readJson(dir, 'tsconfig.tests.json');
  expect(tsconfig['extends']).toBe('./tsconfig.json');
  expect(tsconfig['include']).toEqual(['src', '__tests__']);
  expect(tsconfig['exclude']).toEqual([]);

  const compilerOptions = tsconfig['compilerOptions'] as Record<
    string,
    unknown
  >;
  expect(compilerOptions['noEmit']).toBe(true);
  expect(compilerOptions['rootDir']).toBe('.');
  expect(compilerOptions['types']).toEqual(['bun']);
};

const assertScaffoldProvenance = (
  dir: string,
  starter: Starter = 'hello'
): void => {
  const provenance = readJson(dir, '.trails/scaffold.json');
  expect(provenance['schemaVersion']).toBe(1);
  expect(provenance['scaffoldVersion']).toBe(trailsPackageVersion);
  expect(provenance['template']).toBe(starter);

  const { generatedAt } = provenance;
  expect(typeof generatedAt).toBe('string');
  expect(Number.isNaN(Date.parse(generatedAt as string))).toBe(false);
  expect(new Date(generatedAt as string).toISOString()).toBe(generatedAt);
};

const assertAgentGuidance = (dir: string): void => {
  expectContainsAll(readText(dir, 'AGENTS.md'), [
    'This is a Trails project.',
    'agent-native, contract-first TypeScript framework',
    '`trail`, not action or handler',
    '`blaze`, not handler or impl',
    '`topo`, not registry or collection',
    '`compose`, not follow',
    '`surface`, not transport',
    '`resource`, not service or dependency',
    '`layer`, for cross-cutting trail wrapping',
    'Blazes return `Result`; never throw',
    '`Result.ok()` and `Result.err()`',
    '`ctx.compose(...)`',
    '`resources: [...]`',
    'bun run warden',
    'bun run survey',
    'bun run guide',
  ]);
  expectContainsAll(readText(dir, 'CLAUDE.md'), [
    '# CLAUDE.md',
    'Compatibility Shim',
    'Keep shared project guidance in `./AGENTS.md`.',
    '@AGENTS.md',
  ]);
};

const assertReadme = (
  dir: string,
  options?: Partial<{
    starter: Starter;
    surfaces: readonly Surface[];
    verify: boolean;
  }>
): void => {
  const starter = options?.starter ?? 'hello';
  const surfaces = options?.surfaces ?? ['cli'];
  const verify = options?.verify ?? true;
  const content = readText(dir, 'README.md');

  expectContainsAll(content, [
    `# ${basename(dir)}`,
    'A Trails project.',
    'bun install',
    'bun run warden',
    'bun run survey',
    'bun run guide',
    '`src/app.ts` - the topo',
    '`src/trails/` - trail definitions',
    '`AGENTS.md` - project guidance',
    'Add a trail with `bun run add`',
  ]);
  for (const surface of surfaces) {
    const file = surface === 'cli' ? 'src/cli.ts' : `src/${surface}.ts`;
    expect(content).toContain(`\`${file}\` -`);
  }
  if (!surfaces.includes('cli')) {
    expect(content).not.toContain('`src/cli.ts` -');
  }
  if (!surfaces.includes('mcp')) {
    expect(content).not.toContain('`src/mcp.ts` -');
  }
  if (!surfaces.includes('http')) {
    expect(content).not.toContain('`src/http.ts` -');
  }

  if (verify) {
    expect(content).toContain('bun test');
    expect(content).toContain('`__tests__/examples.test.ts` -');
  } else {
    expect(content).not.toContain('bun test');
    expect(content).toContain('Verification files were not generated');
  }

  const starterSnippets = {
    empty: 'authoring from scratch',
    entity: 'sample entity trails',
    hello: '`hello` trail',
  } satisfies Record<Starter, string>;
  expect(content).toContain(starterSnippets[starter]);
};

const assertCliPackage = (dir: string): void => {
  const pkg = readJson(dir, 'package.json');
  expect(pkg['name']).toBe(basename(dir));
  expectContainsAll(readText(dir, 'src/cli.ts'), [
    "import { devPermitPreset, permitPreset } from '@ontrails/cli'",
    "import { surface } from '@ontrails/commander'",
    'presets: [permitPreset(), devPermitPreset()]',
    'await surface(app, {',
  ]);

  const deps = pkg['dependencies'] as Record<string, string>;
  expectExactOntrailsPin(deps['@ontrails/core']);
  expectExactOntrailsPin(deps['@ontrails/cli']);
  expectExactOntrailsPin(deps['@ontrails/commander']);
  expect(deps['commander']).toBeUndefined();
};

const assertVerifyPackage = (dir: string): void => {
  const pkg = readJson(dir, 'package.json');
  const devDeps = pkg['devDependencies'] as Record<string, string>;
  expectExactOntrailsPin(devDeps['@ontrails/testing']);
  expectExactOntrailsPin(devDeps['@ontrails/warden']);
  expect(devDeps['lefthook']).toBe(scaffoldDependencyVersions.lefthook);
  expect(readText(dir, 'lefthook.yml')).toContain('bunx trails warden');
  expect(readText(dir, 'lefthook.yml')).not.toContain('--exit-code');
};

const assertGeneratedToolingDeps = (dir: string): void => {
  const pkg = readJson(dir, 'package.json');
  const devDeps = pkg['devDependencies'] as Record<string, string>;
  expectExactOntrailsPin(devDeps['@ontrails/trails']);
  expect(devDeps['@types/bun']).toBe(scaffoldDependencyVersions.bunTypes);
  expect(devDeps['oxfmt']).toBe(scaffoldDependencyVersions.oxfmt);
  expect(devDeps['oxlint']).toBe(scaffoldDependencyVersions.oxlint);
  expect(devDeps['typescript']).toBe(scaffoldDependencyVersions.typescript);
  expect(devDeps['ultracite']).toBe(scaffoldDependencyVersions.ultracite);
};

const assertFieldworkLintMarkers = (dir: string): void => {
  expectContainsAll(readText(dir, 'oxlint.config.ts'), [
    "location: 'start'",
    "terms: ['todo:', 'fixme', 'xxx']",
  ]);
};

const assertFrameworkCliScripts = (dir: string): void => {
  const pkg = readJson(dir, 'package.json');
  const scripts = pkg['scripts'] as Record<string, string>;
  expect(scripts).toMatchObject({
    add: 'trails add',
    build: 'tsc -b',
    compile: 'trails compile',
    completions: 'trails completions',
    deprecate: 'trails deprecate',
    diff: 'trails diff',
    doctor: 'trails doctor',
    'format:check': 'bunx ultracite check .',
    'format:fix': 'bunx ultracite fix .',
    guide: 'trails guide',
    lint: 'oxlint ./src',
    revise: 'trails revise',
    run: 'trails run',
    survey: 'trails survey',
    test: 'bun test',
    topo: 'trails topo',
    typecheck: 'tsc --noEmit',
    validate: 'trails validate',
    warden: 'trails warden',
  });
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
      'src/signals/entity-signals.ts',
      'src/store.ts',
    ],
    true
  );
  expectPaths(dir, ['src/trails/hello.ts'], false);
  expectContainsAll(readText(dir, 'src/app.ts'), [
    "import * as entity from './trails/entity.js'",
    "import * as search from './trails/search.js'",
    "import * as onboard from './trails/onboard.js'",
    "import * as entitySignals from './signals/entity-signals.js'",
    "import * as store from './store.js'",
  ]);
  expectContainsAll(readText(dir, 'src/trails/entity.ts'), [
    "import { randomUUID } from 'node:crypto'",
    "import { NotFoundError, Result, trail } from '@ontrails/core'",
    "import { entityStore } from '../store.js'",
    "trail('entity.show'",
    "trail('entity.add'",
    "trail('entity.list'",
    "trail('entity.delete'",
    'const store = entityStore.from(ctx)',
    'const entity = store.get(input.id)',
    'new NotFoundError',
    "expectedMatch: { name: 'New' }",
    'const entity = { id: randomUUID(), name: input.name }',
    'store.add(entity)',
    'return Result.ok(entity)',
    'resources: [entityStore]',
    "expected: { entities: [{ id: '1', name: 'Example' }] }",
    'return Result.ok({ entities: store.list() })',
    'const deleted = store.delete(input.id)',
    'return Result.ok({ deleted, id: input.id })',
    "permit: { scopes: ['entity:write'] }",
  ]);
  expectContainsAll(readText(dir, 'src/store.ts'), [
    "import { Result, resource } from '@ontrails/core'",
    'export interface EntityStore',
    "const defaultEntities: readonly Entity[] = [{ id: '1', name: 'Example' }]",
    'export const createEntityStore = (',
    "export const entityStore = resource('entity.store'",
    'mock: createEntityStore',
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
    "import { surface } from '@ontrails/mcp'",
    'await surface(app)',
  ]);

  const deps = readJson(dir, 'package.json')['dependencies'] as Record<
    string,
    string
  >;
  expectExactOntrailsPin(deps['@ontrails/mcp']);
  expect(deps['@ontrails/cli']).toBeUndefined();
};

const assertHttpSurface = (dir: string): void => {
  expectPaths(dir, ['src/http.ts'], true);
  expectContainsAll(readText(dir, 'src/http.ts'), [
    "import { surface } from '@ontrails/hono'",
    'await surface(app, { port: 3000 })',
  ]);

  const deps = readJson(dir, 'package.json')['dependencies'] as Record<
    string,
    string
  >;
  expectExactOntrailsPin(deps['@ontrails/hono']);
  expectExactOntrailsPin(deps['@ontrails/http']);
};

const assertVerifySkipped = (dir: string): void => {
  expectPaths(dir, ['__tests__/examples.test.ts', 'lefthook.yml'], false);
  const devDeps = readJson(dir, 'package.json')['devDependencies'] as Record<
    string,
    string
  >;
  expect(devDeps['@ontrails/testing']).toBeUndefined();
  expect(devDeps['@ontrails/warden']).toBeUndefined();
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
        const result = expectOk(await runCreate(dir));
        expectCreatedPaths(result.created, [
          'AGENTS.md',
          'CLAUDE.md',
          'README.md',
          '.trails/scaffold.json',
          'tsconfig.tests.json',
        ]);
        assertDefaultProjectFiles(dir);
        assertAgentGuidance(dir);
        assertReadme(dir);
        assertScaffoldProvenance(dir);
        assertTsconfigTests(dir);
        assertCliPackage(dir);
        assertVerifyPackage(dir);
        assertGeneratedToolingDeps(dir);
        assertFieldworkLintMarkers(dir);
        assertFrameworkCliScripts(dir);
        assertHelloApp(dir);
      });
    });

    test('plans scaffold writes without touching disk and applies the same operations', async () => {
      await withTempProject(async (dir) => {
        const dryRun = expectOk(
          await createScaffold.blaze(
            {
              dir: dirname(dir),
              dryRun: true,
              name: basename(dir),
              starter: 'hello',
            },
            {} as never
          )
        );

        expect(dryRun.dryRun).toBe(true);
        expect(dryRun.created).toEqual([]);
        expect(dryRun.plannedOperations).toEqual(
          expect.arrayContaining([
            { kind: 'write', path: 'package.json' },
            { kind: 'write', path: 'AGENTS.md' },
            { kind: 'write', path: 'CLAUDE.md' },
            { kind: 'write', path: 'src/app.ts' },
            { kind: 'write', path: '.trails/.gitignore' },
            { kind: 'write', path: '.trails/scaffold.json' },
            { kind: 'write', path: 'tsconfig.tests.json' },
          ])
        );
        expect(existsSync(dir)).toBe(false);

        const applied = expectOk(
          await createScaffold.blaze(
            {
              dir: dirname(dir),
              name: basename(dir),
              starter: 'hello',
            },
            {} as never
          )
        );

        expect(applied.dryRun).toBe(false);
        expect(applied.plannedOperations).toEqual(dryRun.plannedOperations);
        expectPaths(
          dir,
          [
            'package.json',
            'AGENTS.md',
            'CLAUDE.md',
            'tsconfig.json',
            'tsconfig.tests.json',
            '.gitignore',
            'oxlint.config.ts',
            '.oxfmtrc.jsonc',
            'src/app.ts',
            '.trails',
            '.trails/scaffold.json',
            'src/trails/hello.ts',
          ],
          true
        );
      });
    });

    test('generates with entity starter', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { starter: 'entity' }));
        assertScaffoldProvenance(dir, 'entity');
        assertEntityStarter(dir);
        assertReadme(dir, { starter: 'entity' });
      });
    });

    test('generates with MCP surface', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { surfaces: ['mcp'] }));
        assertMcpSurface(dir);
        assertReadme(dir, { surfaces: ['mcp'] });
      });
    });

    test('generates with HTTP surface', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { surfaces: ['http'] }));
        assertHttpSurface(dir);
        assertReadme(dir, { surfaces: ['http'] });
      });
    });

    test('generates with CLI, MCP, and HTTP surfaces', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { surfaces: ['cli', 'mcp', 'http'] }));
        expectPaths(dir, ['src/cli.ts', 'src/mcp.ts', 'src/http.ts'], true);
        assertCliPackage(dir);
        assertHttpSurface(dir);
        expectContainsAll(readText(dir, 'src/mcp.ts'), [
          "import { surface } from '@ontrails/mcp'",
          'await surface(app)',
        ]);
        const deps = readJson(dir, 'package.json')['dependencies'] as Record<
          string,
          string
        >;
        expectExactOntrailsPin(deps['@ontrails/mcp']);
        assertReadme(dir, { surfaces: ['cli', 'mcp', 'http'] });
      });
    });

    test('generates formatter-clean project files', async () => {
      await withTempProject(async (dir) => {
        expectOk(
          await runCreate(dir, {
            starter: 'entity',
            surfaces: ['cli', 'mcp', 'http'],
            verify: true,
          })
        );

        expectGeneratedProjectFormatCheck(dir);
      });
    });

    test('skips verification when verify is false', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { verify: false }));
        assertVerifySkipped(dir);
        assertAgentGuidance(dir);
        assertReadme(dir, { verify: false });
        assertTsconfigTests(dir);
        assertScaffoldProvenance(dir);
        assertGeneratedToolingDeps(dir);
        assertFieldworkLintMarkers(dir);
        assertFrameworkCliScripts(dir);
      });
    });

    test('generates with empty starter', async () => {
      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { starter: 'empty' }));
        assertScaffoldProvenance(dir, 'empty');
        assertEmptyStarter(dir);
        assertReadme(dir, { starter: 'empty' });
      });
    });

    test('reruns reconcile missing scaffold pieces without overwriting existing files', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(join(dir, 'src'), { recursive: true });
        mkdirSync(join(dir, '.trails'), { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify(
            {
              dependencies: { '@ontrails/core': ontrailsPackageRange },
              name: basename(dir),
              scripts: { keep: 'echo keep' },
              workspaceNote: 'preserve me',
            },
            null,
            2
          )
        );
        writeFileSync(join(dir, 'tsconfig.json'), '{"custom":true}\n');
        writeFileSync(join(dir, 'README.md'), '# Existing README\n');
        writeFileSync(
          join(dir, 'src', 'app.ts'),
          "import { topo } from '@ontrails/core';\nexport const app = topo('existing');\n"
        );
        writeFileSync(join(dir, 'src', 'cli.ts'), 'existing cli\n');

        const result = expectOk(
          await runCreate(dir, { surfaces: ['cli', 'mcp'] })
        );

        expectCreatedPaths(result.created, [
          'src/mcp.ts',
          'src/trails/hello.ts',
          '__tests__/examples.test.ts',
          'lefthook.yml',
        ]);
        expect(result.created).not.toContain('src/cli.ts');
        expect(readText(dir, 'src/cli.ts')).toBe('existing cli\n');
        expect(readText(dir, 'src/app.ts')).toContain("topo('existing')");
        expect(readText(dir, 'tsconfig.json')).toBe('{"custom":true}\n');
        expect(readText(dir, 'README.md')).toBe('# Existing README\n');
        expectPaths(dir, ['src/mcp.ts', 'src/trails/hello.ts'], true);

        const pkg = readJson(dir, 'package.json');
        expect(pkg['workspaceNote']).toBe('preserve me');
        expect(pkg['scripts']).toEqual({ keep: 'echo keep' });
        const deps = pkg['dependencies'] as Record<string, string>;
        expectExactOntrailsPin(deps['@ontrails/cli']);
        expectExactOntrailsPin(deps['@ontrails/commander']);
        expectExactOntrailsPin(deps['@ontrails/mcp']);
        const devDeps = pkg['devDependencies'] as Record<string, string>;
        expectExactOntrailsPin(devDeps['@ontrails/testing']);
        expectExactOntrailsPin(devDeps['@ontrails/warden']);
      });
    });

    test('rejects path-shaped project names before writing', async () => {
      await withTempProject(async (dir) => {
        const error = expectErr(
          await createScaffold.blaze(
            { dir: dirname(dir), name: '../escape', starter: 'hello' },
            {} as never
          )
        );

        expect(error).toBeInstanceOf(ValidationError);
        expect(existsSync(join(dirname(dir), 'escape'))).toBe(false);
      });
    });

    test('rejects path-shaped project names at the create trail boundary', () => {
      const result = createTrail.input.safeParse({
        dir: tmpdir(),
        name: '../escape',
        starter: 'hello',
        surfaces: ['cli'],
        verify: true,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(PROJECT_NAME_MESSAGE);
      }
    });

    test('rejects empty surface lists at the create trail boundary', () => {
      const result = createTrail.input.safeParse({
        dir: tmpdir(),
        name: 'empty-surfaces',
        starter: 'hello',
        surfaces: [],
        verify: true,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(['surfaces']);
      }
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
          "import { surface } from '@ontrails/mcp'",
        ]);
        const deps = readJson(dir, 'package.json')['dependencies'] as Record<
          string,
          string
        >;
        expectExactOntrailsPin(deps['@ontrails/mcp']);
      });
    });

    test('adds HTTP to existing project', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const result = expectOk(
          await addSurface.blaze({ dir, surface: 'http' }, {} as never)
        );

        expect(result.created).toBe('src/http.ts');
        expect(result.dependency).toBe('@ontrails/hono');
        assertHttpSurface(dir);
      });
    });

    test('reconciles existing surface entrypoint', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(join(dir, 'src'), { recursive: true });
        mkdirSync(join(dir, '.trails'), { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({ name: basename(dir) }, null, 2)
        );
        writeFileSync(join(dir, 'src', 'mcp.ts'), 'existing content');

        const result = expectOk(
          await addSurface.blaze({ dir, surface: 'mcp' }, {} as never)
        );
        expect(result.created).toBeNull();
        expect(readText(dir, 'src/mcp.ts')).toBe('existing content');
        const deps = readJson(dir, 'package.json')['dependencies'] as Record<
          string,
          string
        >;
        expectExactOntrailsPin(deps['@ontrails/mcp']);
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
