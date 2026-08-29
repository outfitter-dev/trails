import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { InternalError, Result, ValidationError, topo } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topography';
import ts from 'typescript';

import { addSurface } from '../trails/add-surface.js';
import {
  addVerify,
  resolveCanonicalHookDir,
  resolveVerifyHookDir,
} from '../trails/add-verify.js';
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
const repoNodeModules = join(repoRoot, 'node_modules');
const trailsPackageNodeModules = join(repoRoot, 'apps/trails/node_modules');
const formatterTimeoutMs = 30_000;

const linkGeneratedProjectDependencies = (dir: string): void => {
  const target = join(dir, 'node_modules');
  if (existsSync(target)) {
    return;
  }

  mkdirSync(target, { recursive: true });
  const sources = [trailsPackageNodeModules, repoNodeModules];
  for (const source of sources) {
    for (const entry of readdirSync(source)) {
      if (entry === '.bin' || entry === '@ontrails') {
        continue;
      }
      const destination = join(target, entry);
      if (!existsSync(destination)) {
        symlinkSync(join(source, entry), destination, 'dir');
      }
    }
  }

  const ontrailsTarget = join(target, '@ontrails');
  mkdirSync(ontrailsTarget);
  for (const sourceDir of sources.map((entry) => join(entry, '@ontrails'))) {
    if (!existsSync(sourceDir)) {
      continue;
    }
    for (const entry of readdirSync(sourceDir)) {
      const destination = join(ontrailsTarget, entry);
      if (!existsSync(destination)) {
        symlinkSync(join(sourceDir, entry), destination, 'dir');
      }
    }
  }

  const binTarget = join(target, '.bin');
  mkdirSync(binTarget);
  for (const sourceDir of sources.map((entry) => join(entry, '.bin'))) {
    for (const entry of readdirSync(sourceDir)) {
      const destination = join(binTarget, entry);
      if (!existsSync(destination)) {
        symlinkSync(join(sourceDir, entry), destination, 'file');
      }
    }
  }
};

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

const readEffectiveTypeScriptFiles = (
  dir: string,
  configFile = 'tsconfig.json'
): string[] => {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(dir, configFile),
    {},
    ts.sys
  );
  if (parsed === undefined || parsed.errors.length > 0) {
    throw new Error(
      parsed === undefined
        ? 'Unable to parse generated TypeScript config.'
        : ts.formatDiagnostics(parsed.errors, {
            getCanonicalFileName: (fileName) => fileName,
            getCurrentDirectory: () => dir,
            getNewLine: () => '\n',
          })
    );
  }
  return parsed.fileNames.map((fileName) => relative(dir, fileName));
};

const probeTypeScriptMatcherGuard = (input: {
  readonly shape: 'audited' | 'incompatible' | 'missing';
  readonly version: string;
}): { readonly context: Record<string, unknown>; readonly message: string } => {
  const script = String.raw`
import { mock } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const input = JSON.parse(process.env.TRAILS_MATCHER_PROBE);
const actual = (await import('typescript')).default;
const runtime = { ...actual, version: input.version };
if (input.shape === 'missing') runtime.matchFiles = undefined;
if (input.shape === 'incompatible') runtime.matchFiles = () => [];
mock.module('typescript', () => ({ default: runtime }));

const { resolveSurfaceEntryFile } = await import(
  './apps/trails/src/trails/add-surface.ts?matcher-guard-probe'
);
const dir = mkdtempSync(join(tmpdir(), 'trails-matcher-guard-'));
try {
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/app.ts'), 'export {};\n');
  writeFileSync(join(dir, 'tsconfig.json'), '{"include":["src"]}\n');
  const result = resolveSurfaceEntryFile(dir, 'mcp');
  if (result.isOk()) throw new Error('Expected matcher guard rejection.');
  console.log(JSON.stringify({
    context: result.error.context,
    message: result.error.message,
  }));
} finally {
  rmSync(dir, { force: true, recursive: true });
}
`;
  const proc = Bun.spawnSync({
    cmd: [process.execPath, '-e', script],
    cwd: repoRoot,
    env: {
      ...process.env,
      TRAILS_MATCHER_PROBE: JSON.stringify(input),
    } as Record<string, string>,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString());
  }
  return JSON.parse(proc.stdout.toString()) as {
    readonly context: Record<string, unknown>;
    readonly message: string;
  };
};

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

const expectGeneratedProjectLintCheck = (dir: string): void => {
  linkGeneratedProjectDependencies(dir);
  const command = ['bun', 'run', 'lint'];
  const proc = Bun.spawnSync({
    cmd: command,
    cwd: dir,
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
        'Generated Trails scaffold did not pass its Oxlint contract.',
        `command: ${command.join(' ')}`,
        `cwd: ${dir}`,
        `exitCode: ${proc.exitCode ?? 'null'}`,
        `signal: ${signalCode ?? 'null'}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join('\n')
    );
  }
};

const expectGeneratedProjectTypecheck = (dir: string): void => {
  linkGeneratedProjectDependencies(dir);
  const command = ['bunx', 'tsc', '--noEmit', '-p', 'tsconfig.json'];
  const proc = Bun.spawnSync({
    cmd: command,
    cwd: dir,
    env: { ...process.env, NO_COLOR: '1' } as Record<string, string>,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: formatterTimeoutMs,
  });
  if (proc.exitCode !== 0 || proc.exitedDueToTimeout) {
    throw new Error(
      [
        'Generated Trails project did not typecheck.',
        `command: ${command.join(' ')}`,
        `cwd: ${dir}`,
        `exitCode: ${proc.exitCode ?? 'null'}`,
        `stdout: ${proc.stdout.toString()}`,
        `stderr: ${proc.stderr.toString()}`,
      ].join('\n')
    );
  }
};

const expectGeneratedStandaloneCompile = (dir: string): void => {
  if (!existsSync(join(dir, 'node_modules'))) {
    symlinkSync(
      join(repoRoot, 'node_modules'),
      join(dir, 'node_modules'),
      'dir'
    );
  }
  const command = [
    'bun',
    'run',
    'compile',
    '--permit',
    '{"id":"local-dev","scopes":["topo:write"]}',
  ];
  const proc = Bun.spawnSync({
    cmd: command,
    cwd: dir,
    env: {
      ...process.env,
      NO_COLOR: '1',
      TRAILS_STATE_HOME: join(dir, '.test-state'),
    } as Record<string, string>,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: formatterTimeoutMs,
  });
  if (proc.exitCode !== 0 || proc.exitedDueToTimeout) {
    throw new Error(
      [
        'Generated standalone compile guidance did not succeed.',
        `command: ${command.join(' ')}`,
        `cwd: ${dir}`,
        `exitCode: ${proc.exitCode ?? 'null'}`,
        `stdout: ${proc.stdout.toString()}`,
        `stderr: ${proc.stderr.toString()}`,
      ].join('\n')
    );
  }
  expectPaths(dir, ['trails.lock'], true);
};

const readGeneratedSurfaceOverlayParity = (
  dir: string
): {
  readonly cliAlias: boolean;
  readonly mcpTrailhead: boolean;
} => {
  linkGeneratedProjectDependencies(dir);
  const script = String.raw`
import { mock } from 'bun:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const commander = await import('@ontrails/commander');
const mcp = await import('@ontrails/mcp');
const proof = { cliAlias: false, mcpTrailhead: false };

mock.module('@ontrails/commander', () => ({
  ...commander,
  surface: async (graph, options) => {
    const program = commander.createProgram(graph, options);
    proof.cliAlias = program.commands.some((command) => command.name() === 'hi');
  },
}));
mock.module('@ontrails/mcp', () => ({
  ...mcp,
  surface: async (graph, options) => {
    const tools = mcp.deriveMcpTools(graph, options);
    if (tools.isErr()) throw tools.error;
    proof.mcpTrailhead = tools.value.some(
      (tool) => tool.trailheadId === 'hello_group'
    );
  },
}));

const dir = process.env.TRAILS_OVERLAY_PARITY_DIR;
await import(pathToFileURL(join(dir, 'bin/cli.ts')).href);
await import(pathToFileURL(join(dir, 'bin/mcp.ts')).href);
console.log(JSON.stringify(proof));
`;
  const proc = Bun.spawnSync({
    cmd: [process.execPath, '-e', script],
    cwd: dir,
    env: {
      ...process.env,
      TRAILS_OVERLAY_PARITY_DIR: dir,
    } as Record<string, string>,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString());
  }
  return JSON.parse(proc.stdout.toString()) as {
    readonly cliAlias: boolean;
    readonly mcpTrailhead: boolean;
  };
};

const runCompose = async (
  id: string,
  input: unknown
): Promise<Result<unknown, Error>> => {
  switch (id) {
    case 'create.scaffold': {
      return await createScaffold.implementation(input as never, {} as never);
    }
    case 'add.surface': {
      return await addSurface.implementation(input as never, {} as never);
    }
    case 'add.verify': {
      return await addVerify.implementation(input as never, {} as never);
    }
    default: {
      return Result.err(new Error(`Unknown compose target: ${id}`));
    }
  }
};

const runCreate = (
  projectDir: string,
  overrides?: Partial<{
    dryRun: boolean;
    starter: Starter;
    surfaces: readonly Surface[];
    verify: boolean;
    workspace: boolean;
  }>
) =>
  createTrail.implementation(
    {
      dir: dirname(projectDir),
      name: basename(projectDir),
      starter: overrides?.starter ?? 'hello',
      surfaces: [...(overrides?.surfaces ?? ['cli'])],
      verify: overrides?.verify ?? true,
      workspace: overrides?.workspace ?? false,
    },
    {
      compose: runCompose,
      dryRun: overrides?.dryRun ?? false,
    } as never
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
      'bin/cli.ts',
      'src/trails/hello.ts',
      '__tests__/examples.test.ts',
      'lefthook.yml',
    ],
    true
  );
};

const assertGitignore = (dir: string): void => {
  expectContainsAll(readText(dir, '.gitignore'), [
    'node_modules/',
    'dist/',
    '*.tsbuildinfo',
    'trails.config.local.*',
  ]);
  expect(readText(dir, '.gitignore')).not.toContain('.trails/');
};

const assertNoDisposableTrailsState = (dir: string): void => {
  expectPaths(
    dir,
    [
      '.trails/cache',
      '.trails/state',
      '.trails/trails.db',
      '.trails/trails.db-shm',
      '.trails/trails.db-wal',
      '.trails',
      'trails.lock',
    ],
    false
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
  expectContainsAll(readText(dir, 'src/app.ts'), [
    'export const trailsOverlays = [',
    "namespace: 'scaffold'",
    `scaffoldVersion: '${trailsPackageVersion}'`,
    'schemaVersion: 1',
    `template: '${starter}'`,
  ]);
  expect(readText(dir, 'src/app.ts')).not.toContain('generatedAt');
};

const assertAgentGuidance = (dir: string): void => {
  expectContainsAll(readText(dir, 'AGENTS.md'), [
    'This is a Trails project.',
    'agent-native, contract-first TypeScript framework',
    '`trail`, not action or handler',
    '`implementation`, not handler or impl',
    '`topo`, not registry or collection',
    '`compose`, not follow',
    '`surface`, not transport',
    '`resource`, not service or dependency',
    '`layer`, for cross-cutting trail wrapping',
    'Implementations return `Result`; never throw',
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
    `bun run compile --permit '{"id":"local-dev","scopes":["topo:write"]}'`,
    'bun run warden',
    'bun run survey',
    'bun run guide',
    '`src/app.ts` - the side-effect-free topo entry',
    '`src/trails/` - trail definitions',
    '`AGENTS.md` - project guidance',
    'Add a trail with `bun run add`',
  ]);
  for (const surface of surfaces) {
    const file = surface === 'cli' ? 'bin/cli.ts' : `bin/${surface}.ts`;
    expect(content).toContain(`\`${file}\` -`);
  }
  if (!surfaces.includes('cli')) {
    expect(content).not.toContain('`bin/cli.ts` -');
  }
  if (!surfaces.includes('mcp')) {
    expect(content).not.toContain('`bin/mcp.ts` -');
  }
  if (!surfaces.includes('http')) {
    expect(content).not.toContain('`bin/http.ts` -');
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
  expectContainsAll(readText(dir, 'bin/cli.ts'), [
    "import { resolveTrailsOverlays } from '@ontrails/adapter-kit'",
    "import { devPermitPreset, permitPreset } from '@ontrails/cli'",
    "import { surface } from '@ontrails/commander'",
    "import * as appModule from '../src/app.js'",
    "resolveTrailsOverlays(appModule, '../src/app.js')",
    'overlays,',
    'presets: [permitPreset(), devPermitPreset()]',
    'await surface(app, {',
  ]);

  const deps = pkg['dependencies'] as Record<string, string>;
  expect(pkg['bin']).toEqual({ [basename(dir)]: './bin/cli.ts' });
  expectExactOntrailsPin(deps['@ontrails/core']);
  expectExactOntrailsPin(deps['@ontrails/adapter-kit']);
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

const assertWorkspaceOperatorDeps = (dir: string): void => {
  const pkg = readJson(dir, 'package.json');
  const devDeps = pkg['devDependencies'] as Record<string, string>;
  expectExactOntrailsPin(devDeps['@ontrails/trails']);
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
    lint: 'oxlint ./src ./bin',
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
    'implementation: () => Result.ok({ results: [] })',
  ]);
  expectContainsAll(readText(dir, 'src/trails/onboard.ts'), [
    "import { Result, trail } from '@ontrails/core'",
    'return Result.ok({ onboarded: true })',
  ]);
};

const assertMcpSurface = (dir: string): void => {
  expectPaths(dir, ['bin/mcp.ts'], true);
  expectPaths(dir, ['bin/cli.ts'], false);
  expectContainsAll(readText(dir, 'bin/mcp.ts'), [
    "import { resolveTrailsOverlays } from '@ontrails/adapter-kit'",
    "import { surface } from '@ontrails/mcp'",
    "import * as appModule from '../src/app.js'",
    "resolveTrailsOverlays(appModule, '../src/app.js')",
    'await surface(app, { overlays })',
  ]);

  const deps = readJson(dir, 'package.json')['dependencies'] as Record<
    string,
    string
  >;
  expectExactOntrailsPin(deps['@ontrails/adapter-kit']);
  expectExactOntrailsPin(deps['@ontrails/mcp']);
  expect(deps['@ontrails/cli']).toBeUndefined();
};

const assertHttpSurface = (dir: string): void => {
  expectPaths(dir, ['bin/http.ts'], true);
  expectContainsAll(readText(dir, 'bin/http.ts'), [
    "import { surface } from '@ontrails/hono'",
    "import { app } from '../src/app.js'",
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
        expect(result.appDir).toBe(dir);
        expect(result.dryRun).toBe(false);
        expect(result.layout).toBe('standalone');
        expect(result.guidance[0]).toBe(
          'Install dependencies, then run `bun run compile --permit \'{"id":"local-dev","scopes":["topo:write"]}\'` from the app root to derive trails.lock.'
        );
        expectCreatedPaths(result.created, [
          'AGENTS.md',
          'CLAUDE.md',
          'README.md',
          'tsconfig.tests.json',
        ]);
        assertDefaultProjectFiles(dir);
        assertGitignore(dir);
        assertNoDisposableTrailsState(dir);
        assertAgentGuidance(dir);
        assertReadme(dir);
        expectGeneratedStandaloneCompile(dir);
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

    test('generates an explicit configured workspace with one lock-owning app', async () => {
      await withTempProject(async (dir) => {
        const name = basename(dir);
        const appDir = join(dir, 'apps', name);
        const result = expectOk(await runCreate(dir, { workspace: true }));

        expect(result.layout).toBe('workspace');
        expect(result.appDir).toBe(appDir);
        expectCreatedPaths(result.created, [
          'package.json',
          'trails.config.ts',
          'tsconfig.base.json',
          `apps/${name}/package.json`,
          `apps/${name}/src/app.ts`,
          `apps/${name}/bin/cli.ts`,
          `apps/${name}/__tests__/examples.test.ts`,
          'lefthook.yml',
          'README.md',
        ]);
        expectPaths(
          dir,
          [
            'package.json',
            'trails.config.ts',
            'tsconfig.base.json',
            'lefthook.yml',
            `apps/${name}/package.json`,
            `apps/${name}/tsconfig.json`,
            `apps/${name}/src/app.ts`,
            `apps/${name}/bin/cli.ts`,
            `apps/${name}/__tests__/examples.test.ts`,
          ],
          true
        );
        expectPaths(dir, ['trails.lock', '.trails', 'trails'], false);
        expectPaths(
          appDir,
          ['trails.lock', '.trails', 'trails', 'lefthook.yml'],
          false
        );
        expect(readText(dir, 'lefthook.yml')).toContain('bunx trails warden');

        expect(readJson(dir, 'package.json')['workspaces']).toEqual([
          'apps/*',
          'packages/*',
        ]);
        expectContainsAll(readText(dir, 'trails.config.ts'), [
          'workspace:',
          'apps:',
          `'${name}': {`,
          `root: 'apps/${name}'`,
        ]);
        expect(readText(dir, 'trails.config.ts')).not.toContain('process.env');
        expectContainsAll(readText(appDir, 'src/app.ts'), [
          `topo('${name}'`,
          "namespace: 'scaffold'",
        ]);
        expectContainsAll(readText(dir, 'README.md'), [
          `bunx trails compile --app ${name} --permit '{"id":"local-dev","scopes":["topo:write"]}'`,
          `bunx trails validate --app ${name}`,
          `bunx trails run hello --app ${name}`,
          `bunx trails warden --app ${name}`,
          `bunx trails wayfind --overview --app ${name}`,
          `apps/${name}/trails.lock`,
          'never creates a root aggregate lock',
          'global per-user cache and state homes',
        ]);
        assertCliPackage(appDir);
        assertGeneratedToolingDeps(appDir);
        assertScaffoldProvenance(appDir);
        assertNoDisposableTrailsState(dir);
        assertWorkspaceOperatorDeps(dir);
        expectGeneratedProjectFormatCheck(dir);
      });
    });

    test('reconciles an existing workspace manifest before scaffolding', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(dir, { recursive: true });
        const bunfig = '[install]\nlinker = "isolated"\n';
        writeFileSync(join(dir, 'bunfig.toml'), bunfig);
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(
            {
              devDependencies: { custom: '1.0.0' },
              name: 'existing-root',
              scripts: { custom: 'echo custom' },
              workspaces: ['services/*'],
            },
            null,
            2
          )}\n`
        );

        const result = expectOk(await runCreate(dir, { workspace: true }));
        const manifest = readJson(dir, 'package.json');
        const devDependencies = manifest['devDependencies'] as Record<
          string,
          string
        >;

        expect(result.created).toContain('package.json');
        expect(readText(dir, 'bunfig.toml')).toBe(bunfig);
        expect(devDependencies['custom']).toBe('1.0.0');
        expectExactOntrailsPin(devDependencies['@ontrails/trails']);
        expect(manifest).toMatchObject({
          name: 'existing-root',
          private: true,
          scripts: {
            build: 'bun run --filter "*" build',
            custom: 'echo custom',
            test: 'bun run --filter "*" test',
            typecheck: 'bun run --filter "*" typecheck',
          },
          workspaces: ['services/*', 'apps/*', 'packages/*'],
        });
      });
    });

    test('reconciles the generated app contract into an existing standalone manifest', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(
            {
              bin: { admin: './src/admin.ts' },
              custom: 'keep',
              dependencies: { custom: '1.0.0' },
              devDependencies: { 'custom-dev': '1.0.0' },
              name: basename(dir),
              scripts: { custom: 'echo custom' },
            },
            null,
            2
          )}\n`
        );

        const result = expectOk(await runCreate(dir, { verify: false }));
        const manifest = readJson(dir, 'package.json');
        const dependencies = manifest['dependencies'] as Record<string, string>;

        expect(result.created).toContain('package.json');
        expect(manifest).toMatchObject({
          bin: { admin: './src/admin.ts', [basename(dir)]: './bin/cli.ts' },
          custom: 'keep',
          type: 'module',
        });
        expect(dependencies['custom']).toBe('1.0.0');
        expectExactOntrailsPin(dependencies['@ontrails/core']);
        expect(dependencies['zod']).toBe(scaffoldDependencyVersions.zod);
        expect(
          (manifest['devDependencies'] as Record<string, string>)['custom-dev']
        ).toBe('1.0.0');
        expect((manifest['scripts'] as Record<string, string>)['custom']).toBe(
          'echo custom'
        );
        assertGeneratedToolingDeps(dir);
        assertFrameworkCliScripts(dir);
      });
    });

    test('upgrades prior generated standalone ontrails pins on rerun', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(
            {
              dependencies: { '@ontrails/core': '1.0.0-beta.1' },
              devDependencies: { '@ontrails/trails': '1.0.0-beta.1' },
              name: basename(dir),
            },
            null,
            2
          )}\n`
        );

        const result = expectOk(await runCreate(dir, { verify: false }));
        const manifest = readJson(dir, 'package.json');
        const dependencies = manifest['dependencies'] as Record<string, string>;

        expect(result.created).toContain('package.json');
        expectExactOntrailsPin(dependencies['@ontrails/core']);
        assertGeneratedToolingDeps(dir);
      });
    });

    test.each([
      ['script', { scripts: { build: 'echo incompatible' } }],
      [
        'customized core dependency',
        { dependencies: { '@ontrails/core': 'workspace:*' } },
      ],
      ['zod dependency', { dependencies: { zod: '1.0.0' } }],
      ['module type', { type: 'commonjs' }],
    ] as const)(
      'rejects a conflicting standalone %s before writing',
      async (_kind, conflict) => {
        await withTempProject(async (dir) => {
          mkdirSync(dir, { recursive: true });
          const manifest = `${JSON.stringify(
            { name: basename(dir), ...conflict },
            null,
            2
          )}\n`;
          writeFileSync(join(dir, 'package.json'), manifest);

          const error = expectErr(await runCreate(dir, { verify: false }));

          expect(error).toBeInstanceOf(ValidationError);
          expect(error.message).toContain(
            'Cannot reconcile the existing app package.json'
          );
          expect(readText(dir, 'package.json')).toBe(manifest);
          expectPaths(dir, ['src', 'bin', 'README.md', 'tsconfig.json'], false);
        });
      }
    );

    test.each([
      ['hello', 'hello'],
      ['entity', 'entity.list'],
    ] as const)(
      'omits %s run guidance when preserving an established workspace topo',
      async (starter, trailId) => {
        await withTempProject(async (dir) => {
          const name = basename(dir);
          const appDir = join(dir, 'apps', name);
          const appSource = `import { topo } from '@ontrails/core';\nexport const app = topo('${name}');\n`;
          mkdirSync(join(appDir, 'src'), { recursive: true });
          writeFileSync(join(appDir, 'src/app.ts'), appSource);
          writeFileSync(
            join(dir, 'trails.config.ts'),
            `export default { workspace: { apps: { '${name}': { root: 'apps/${name}' } } } };\n`
          );

          expectOk(
            await runCreate(dir, { starter, verify: false, workspace: true })
          );

          expect(readText(appDir, 'src/app.ts')).toBe(appSource);
          expect(readText(dir, 'README.md')).not.toContain(
            `bunx trails run ${trailId} --app ${name}`
          );
          linkGeneratedProjectDependencies(dir);
          const compile = Bun.spawnSync({
            cmd: [
              process.execPath,
              join(repoRoot, 'apps/trails/bin/trails.ts'),
              'compile',
              '--app',
              name,
              '--root-dir',
              dir,
              '--permit',
              '{"id":"test","scopes":["topo:write"]}',
            ],
            cwd: dir,
            env: {
              ...process.env,
              NO_COLOR: '1',
              TRAILS_STATE_HOME: join(dir, '.test-state'),
            } as Record<string, string>,
            stderr: 'pipe',
            stdout: 'pipe',
            timeout: formatterTimeoutMs,
          });
          expect(compile.exitCode).toBe(0);
        });
      },
      15_000
    );

    test('plans and applies the same standalone manifest reconciliation', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(dir, { recursive: true });
        const manifest = `${JSON.stringify(
          { custom: 'keep', name: basename(dir) },
          null,
          2
        )}\n`;
        writeFileSync(join(dir, 'package.json'), manifest);
        const input = {
          dir: dirname(dir),
          name: basename(dir),
          starter: 'hello' as const,
        };

        const dryRun = expectOk(
          await createScaffold.implementation(
            { ...input, dryRun: true },
            {} as never
          )
        );
        expect(readText(dir, 'package.json')).toBe(manifest);

        const applied = expectOk(
          await createScaffold.implementation(input, {} as never)
        );
        expect(applied.plannedOperations).toEqual(dryRun.plannedOperations);
        expect(dryRun.plannedOperations).toContainEqual({
          kind: 'write',
          path: 'package.json',
        });
        expect(readJson(dir, 'package.json')['custom']).toBe('keep');

        const unchanged = expectOk(
          await createScaffold.implementation(
            { ...input, dryRun: true },
            {} as never
          )
        );
        expect(unchanged.plannedOperations).not.toContainEqual({
          kind: 'write',
          path: 'package.json',
        });
      });
    });

    test('isolates a generated app from an existing TypeScript base', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(dir, { recursive: true });
        const base = `${JSON.stringify(
          {
            compilerOptions: { module: 'CommonJS', target: 'ES2022' },
          },
          null,
          2
        )}\n`;
        writeFileSync(join(dir, 'tsconfig.base.json'), base);

        const result = expectOk(await runCreate(dir, { workspace: true }));
        const appConfig = readJson(result.appDir, 'tsconfig.json');

        expect(readText(dir, 'tsconfig.base.json')).toBe(base);
        expect(appConfig).not.toHaveProperty('extends');
        expect(appConfig['compilerOptions']).toMatchObject({
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ESNext',
        });
        expectGeneratedProjectTypecheck(result.appDir);
      });
    });

    test('rejects a customized root workspace operator pin before writing', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(dir, { recursive: true });
        const manifest = `${JSON.stringify(
          {
            devDependencies: { '@ontrails/trails': 'workspace:*' },
            name: 'existing-root',
          },
          null,
          2
        )}\n`;
        const bunfig = '[install]\nlinker = "isolated"\n';
        writeFileSync(join(dir, 'package.json'), manifest);
        writeFileSync(join(dir, 'bunfig.toml'), bunfig);

        const error = expectErr(await runCreate(dir, { workspace: true }));

        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain(
          'Cannot reconcile the existing workspace package.json'
        );
        expect(readText(dir, 'package.json')).toBe(manifest);
        expect(readText(dir, 'bunfig.toml')).toBe(bunfig);
        expectPaths(
          dir,
          ['apps', 'trails.config.ts', 'tsconfig.base.json', 'README.md'],
          false
        );
      });
    });

    test('reconciles required fields into an existing workspace app manifest', async () => {
      await withTempProject(async (dir) => {
        const name = basename(dir);
        const appDir = join(dir, 'apps', name);
        mkdirSync(appDir, { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify({ name: 'existing-root' }, null, 2)}\n`
        );
        writeFileSync(
          join(appDir, 'package.json'),
          `${JSON.stringify(
            {
              bin: {
                admin: './src/admin.ts',
                worker: './src/worker.ts',
              },
              custom: 'keep',
              dependencies: { custom: '1.0.0' },
              devDependencies: { 'custom-dev': '1.0.0' },
              name,
              scripts: { custom: 'echo custom' },
            },
            null,
            2
          )}\n`
        );

        const result = expectOk(await runCreate(dir, { workspace: true }));
        const manifest = readJson(appDir, 'package.json');
        const dependencies = manifest['dependencies'] as Record<string, string>;
        const devDependencies = manifest['devDependencies'] as Record<
          string,
          string
        >;

        expect(result.created).toContain(`apps/${name}/package.json`);
        expect(manifest['custom']).toBe('keep');
        expect(manifest['bin']).toEqual({
          admin: './src/admin.ts',
          [name]: './bin/cli.ts',
          worker: './src/worker.ts',
        });
        expect(manifest['type']).toBe('module');
        expect(dependencies['custom']).toBe('1.0.0');
        expectExactOntrailsPin(dependencies['@ontrails/core']);
        expect(dependencies['zod']).toBe(scaffoldDependencyVersions.zod);
        expect(devDependencies['custom-dev']).toBe('1.0.0');
        assertGeneratedToolingDeps(appDir);
        assertFrameworkCliScripts(appDir);
        expect((manifest['scripts'] as Record<string, string>)['custom']).toBe(
          'echo custom'
        );
      });
    });

    test('upgrades prior generated workspace ontrails pins on rerun', async () => {
      await withTempProject(async (dir) => {
        const name = basename(dir);
        const appDir = join(dir, 'apps', name);
        mkdirSync(appDir, { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(
            {
              devDependencies: { '@ontrails/trails': '1.0.0-beta.1' },
              name: 'existing-root',
            },
            null,
            2
          )}\n`
        );
        writeFileSync(
          join(appDir, 'package.json'),
          `${JSON.stringify(
            {
              dependencies: { '@ontrails/core': '1.0.0-beta.1' },
              devDependencies: { '@ontrails/trails': '1.0.0-beta.1' },
              name,
            },
            null,
            2
          )}\n`
        );

        const result = expectOk(await runCreate(dir, { workspace: true }));
        const dependencies = readJson(appDir, 'package.json')[
          'dependencies'
        ] as Record<string, string>;

        expect(result.created).toContain('package.json');
        expectExactOntrailsPin(dependencies['@ontrails/core']);
        assertGeneratedToolingDeps(appDir);
        assertWorkspaceOperatorDeps(dir);
      });
    });

    test.each([
      ['script', { scripts: { build: 'echo custom-build' } }],
      [
        'customized dependency',
        { dependencies: { '@ontrails/core': '^1.0.0' } },
      ],
    ] as const)(
      'rejects a conflicting workspace app %s before writing',
      async (_kind, conflict) => {
        await withTempProject(async (dir) => {
          const name = basename(dir);
          const appDir = join(dir, 'apps', name);
          mkdirSync(appDir, { recursive: true });
          const rootManifest = `${JSON.stringify(
            { name: 'existing-root' },
            null,
            2
          )}\n`;
          const appManifest = `${JSON.stringify(
            { name, ...conflict },
            null,
            2
          )}\n`;
          writeFileSync(join(dir, 'package.json'), rootManifest);
          writeFileSync(join(appDir, 'package.json'), appManifest);

          const error = expectErr(await runCreate(dir, { workspace: true }));

          expect(error).toBeInstanceOf(ValidationError);
          expect(error.message).toContain(
            'Cannot reconcile the existing app package.json'
          );
          expect(readText(dir, 'package.json')).toBe(rootManifest);
          expect(readText(appDir, 'package.json')).toBe(appManifest);
          expectPaths(
            dir,
            ['trails.config.ts', 'tsconfig.base.json', 'README.md'],
            false
          );
          expectPaths(appDir, ['src', 'bin', 'tsconfig.json'], false);
        });
      }
    );

    test('plans and applies the same existing workspace app manifest merge', async () => {
      await withTempProject(async (dir) => {
        const name = basename(dir);
        const appDir = join(dir, 'apps', name);
        mkdirSync(appDir, { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify({ name: 'existing-root' }, null, 2)}\n`
        );
        const appManifest = `${JSON.stringify(
          { custom: 'keep', name },
          null,
          2
        )}\n`;
        writeFileSync(join(appDir, 'package.json'), appManifest);
        const input = {
          dir: dirname(dir),
          name,
          starter: 'hello' as const,
          workspace: true,
        };

        const dryRun = expectOk(
          await createScaffold.implementation(
            { ...input, dryRun: true },
            {} as never
          )
        );
        expect(readText(appDir, 'package.json')).toBe(appManifest);

        const applied = expectOk(
          await createScaffold.implementation(
            { ...input, dryRun: false },
            {} as never
          )
        );
        expect(applied.plannedOperations).toEqual(dryRun.plannedOperations);
        expect(dryRun.plannedOperations).toEqual(
          expect.arrayContaining([
            { kind: 'write', path: `apps/${name}/package.json` },
          ])
        );
        expect(readJson(appDir, 'package.json')['custom']).toBe('keep');

        const unchanged = expectOk(
          await createScaffold.implementation(
            { ...input, dryRun: true },
            {} as never
          )
        );
        expect(unchanged.plannedOperations).not.toEqual(
          expect.arrayContaining([
            { kind: 'write', path: `apps/${name}/package.json` },
          ])
        );
      });
    });

    test('rejects conflicting workspace orchestration scripts before writing', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(dir, { recursive: true });
        const manifest = `${JSON.stringify(
          { name: 'existing-root', scripts: { build: 'echo user-build' } },
          null,
          2
        )}\n`;
        writeFileSync(join(dir, 'package.json'), manifest);

        const error = expectErr(await runCreate(dir, { workspace: true }));

        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain(
          'Cannot reconcile the existing workspace package.json'
        );
        expect(readText(dir, 'package.json')).toBe(manifest);
        expectPaths(dir, ['apps', 'trails.config.ts', 'README.md'], false);
      });
    });

    test('rejects incompatible existing Config before writing workspace files', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(dir, { recursive: true });
        const config = 'export default {};\n';
        writeFileSync(join(dir, 'trails.config.ts'), config);

        const result = await runCreate(dir, { workspace: true });

        const error = expectErr(result);
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain(
          'Cannot reconcile existing Trails Config'
        );
        expect(readText(dir, 'trails.config.ts')).toBe(config);
        expectPaths(
          dir,
          ['package.json', 'apps', 'README.md', 'tsconfig.base.json'],
          false
        );
      });
    });

    test('rejects a configured workspace app entry the scaffold cannot own', async () => {
      await withTempProject(async (dir) => {
        const name = basename(dir);
        mkdirSync(join(dir, 'apps', name), { recursive: true });
        const config = `export default {
  workspace: {
    apps: {
      '${name}': { root: 'apps/${name}', entry: 'custom.ts' },
    },
  },
};
`;
        writeFileSync(join(dir, 'trails.config.ts'), config);

        const dryRunError = expectErr(
          await runCreate(dir, {
            dryRun: true,
            verify: false,
            workspace: true,
          })
        );
        const error = expectErr(
          await runCreate(dir, { verify: false, workspace: true })
        );

        expect(dryRunError.message).toBe(error.message);
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain('entry "src/app.ts"');
        expect(readText(dir, 'trails.config.ts')).toBe(config);
        expectPaths(
          dir,
          ['package.json', 'README.md', 'tsconfig.base.json'],
          false
        );
        expectPaths(
          join(dir, 'apps', name),
          ['package.json', 'src', 'bin', 'tsconfig.json'],
          false
        );
      });
    });

    test('accepts the canonical explicit workspace app entry', async () => {
      await withTempProject(async (dir) => {
        const name = basename(dir);
        mkdirSync(join(dir, 'apps', name), { recursive: true });
        writeFileSync(
          join(dir, 'trails.config.ts'),
          `export default {
  workspace: {
    apps: {
      '${name}': { root: 'apps/${name}', entry: './src/app.ts' },
    },
  },
};
`
        );

        expectOk(await runCreate(dir, { verify: false, workspace: true }));

        expectPaths(
          dir,
          [`apps/${name}/src/app.ts`, `apps/${name}/bin/cli.ts`],
          true
        );
      });
    });

    test.each([
      ['hello', 'hello'],
      ['entity', 'entity.list'],
      ['empty', null],
    ] as const)(
      'renders starter-aware workspace run guidance for %s',
      async (starter, expectedTrail) => {
        await withTempProject(async (dir) => {
          const name = basename(dir);
          expectOk(
            await runCreate(dir, { starter, verify: false, workspace: true })
          );

          const readme = readText(dir, 'README.md');
          if (expectedTrail === null) {
            expect(readme).not.toContain('bunx trails run ');
          } else {
            expect(readme).toContain(
              `bunx trails run ${expectedTrail} --app ${name}`
            );
            const trailSource = readText(
              dir,
              `apps/${name}/src/trails/${starter === 'hello' ? 'hello' : 'entity'}.ts`
            );
            expect(trailSource).toContain('.default({})');
          }
        });
      }
    );

    test('keeps standalone hooks inside projects nested under package workspaces', async () => {
      await withTempProject(async (outerDir) => {
        mkdirSync(outerDir, { recursive: true });
        writeFileSync(
          join(outerDir, 'package.json'),
          `${JSON.stringify({ name: 'outer', workspaces: ['apps/*'] }, null, 2)}\n`
        );
        const dir = join(outerDir, 'apps', 'standalone');

        const result = expectOk(await runCreate(dir));

        expect(result.layout).toBe('standalone');
        expectCreatedPaths(result.created, ['lefthook.yml']);
        expectPaths(dir, ['lefthook.yml'], true);
        expectPaths(outerDir, ['lefthook.yml'], false);
        expect(result.plannedOperations).toEqual(
          expect.arrayContaining([{ kind: 'write', path: 'lefthook.yml' }])
        );
      });
    });

    test('preflights verification context before standalone scaffold writes', async () => {
      await withTempProject(async (workspaceRoot) => {
        mkdirSync(join(workspaceRoot, 'apps', 'demo'), { recursive: true });
        writeFileSync(
          join(workspaceRoot, 'trails.config.ts'),
          `export default {
  workspace: {
    apps: {
      demo: { root: 'apps/demo' },
    },
  },
};
`
        );
        const projectDir = join(workspaceRoot, 'packages', 'outside');

        expectErr(await runCreate(projectDir));

        expect(existsSync(projectDir)).toBe(false);
        expectPaths(workspaceRoot, ['lefthook.yml'], false);
      });
    });

    test('plans and reports configured-app hooks at the workspace root', async () => {
      await withTempProject(async (workspaceRoot) => {
        const appDir = join(workspaceRoot, 'apps', 'demo');
        mkdirSync(appDir, { recursive: true });
        writeFileSync(
          join(workspaceRoot, 'trails.config.ts'),
          `export default {
  workspace: {
    apps: {
      demo: { root: 'apps/demo' },
    },
  },
};
`
        );

        const dryRun = expectOk(await runCreate(appDir, { dryRun: true }));
        const applied = expectOk(await runCreate(appDir));

        expect(dryRun.plannedOperations).toEqual(applied.plannedOperations);
        expect(dryRun.plannedOperations).toEqual(
          expect.arrayContaining([
            { kind: 'write', path: '../../lefthook.yml' },
          ])
        );
        expect(applied.created).toContain('../../lefthook.yml');
        expectPaths(workspaceRoot, ['lefthook.yml'], true);
        expectPaths(appDir, ['lefthook.yml'], false);
      });
    });

    test('resolves configured-app hooks through a symlink to the canonical workspace root', async () => {
      await withTempProject(async (workspaceRoot) => {
        const appDir = join(workspaceRoot, 'apps', 'demo');
        const linkedRoot = join(workspaceRoot, 'linked');
        const linkedAppDir = join(linkedRoot, 'apps', 'demo');
        mkdirSync(appDir, { recursive: true });
        mkdirSync(dirname(linkedAppDir), { recursive: true });
        writeFileSync(
          join(workspaceRoot, 'trails.config.ts'),
          `export default {
  workspace: {
    apps: {
      demo: { root: 'apps/demo' },
    },
  },
};
`
        );
        symlinkSync(appDir, linkedAppDir, 'dir');

        expect(
          expectOk(resolveCanonicalHookDir(linkedAppDir, appDir, workspaceRoot))
        ).toBe(realpathSync(workspaceRoot));
        expect(expectOk(await resolveVerifyHookDir(linkedAppDir))).toBe(
          realpathSync(workspaceRoot)
        );

        const dryRun = expectOk(
          await runCreate(linkedAppDir, { dryRun: true })
        );
        const applied = expectOk(await runCreate(linkedAppDir));

        expect(dryRun.plannedOperations).toEqual(applied.plannedOperations);
        expect(dryRun.plannedOperations).toEqual(
          expect.arrayContaining([
            { kind: 'write', path: '../../lefthook.yml' },
          ])
        );
        expect(applied.created).toContain('../../lefthook.yml');
        expectPaths(workspaceRoot, ['lefthook.yml'], true);
        expectPaths(appDir, ['lefthook.yml'], false);
        expectPaths(linkedRoot, ['lefthook.yml'], false);
      });
    });

    test('dry-run plans the complete workspace without writing it', async () => {
      await withTempProject(async (dir) => {
        const name = basename(dir);
        const result = expectOk(
          await runCreate(dir, {
            dryRun: true,
            surfaces: ['cli', 'mcp'],
            workspace: true,
          })
        );

        expect(result.dryRun).toBe(true);
        expect(result.created).toEqual([]);
        expect(result.layout).toBe('workspace');
        expect(result.plannedOperations).toEqual(
          expect.arrayContaining([
            { kind: 'write', path: 'package.json' },
            { kind: 'write', path: 'trails.config.ts' },
            { kind: 'write', path: 'tsconfig.base.json' },
            { kind: 'write', path: `apps/${name}/package.json` },
            { kind: 'write', path: `apps/${name}/src/app.ts` },
            { kind: 'write', path: `apps/${name}/bin/cli.ts` },
            { kind: 'write', path: `apps/${name}/bin/mcp.ts` },
            {
              kind: 'write',
              path: `apps/${name}/__tests__/examples.test.ts`,
            },
            { kind: 'write', path: 'lefthook.yml' },
            { kind: 'write', path: 'README.md' },
          ])
        );
        expect(result.plannedOperations).not.toEqual(
          expect.arrayContaining([
            { kind: 'write', path: 'trails.lock' },
            { kind: 'write', path: '.trails/scaffold.json' },
            { kind: 'write', path: `apps/${name}/lefthook.yml` },
          ])
        );
        expect(result.guidance[0]).toBe(
          `Install dependencies, then run \`bunx trails compile --app ${name} --permit '{"id":"local-dev","scopes":["topo:write"]}'\` from the workspace root to derive apps/${name}/trails.lock.`
        );
        expect(result.guidance.join('\n')).toContain('no root aggregate lock');
        expect(existsSync(dir)).toBe(false);
      });
    });

    test('preflights unsupported surface placement before scaffold writes', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(join(dir, 'src'), { recursive: true });
        const tsconfig = `{
  "compilerOptions": { "rootDir": "src" },
  "files": ["src/app.ts"]
}
`;
        const app = 'export {};\n';
        writeFileSync(join(dir, 'tsconfig.json'), tsconfig);
        writeFileSync(join(dir, 'src', 'app.ts'), app);

        const dryRunError = expectErr(
          await runCreate(dir, {
            dryRun: true,
            surfaces: ['mcp'],
            verify: false,
          })
        );
        const error = expectErr(
          await runCreate(dir, { surfaces: ['mcp'], verify: false })
        );

        expect(dryRunError.message).toBe(error.message);
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain(
          'TypeScript config does not include a supported mcp surface entry path'
        );
        expect(readText(dir, 'tsconfig.json')).toBe(tsconfig);
        expect(readText(dir, 'src/app.ts')).toBe(app);
        expectPaths(
          dir,
          [
            '.gitignore',
            '.oxfmtrc.jsonc',
            'AGENTS.md',
            'CLAUDE.md',
            'README.md',
            'oxlint.config.ts',
            'package.json',
            'src/trails/hello.ts',
            'tsconfig.tests.json',
          ],
          false
        );
      });
    });

    test('preflights inherited CommonJS surface syntax before scaffold writes', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(join(dir, 'src'), { recursive: true });
        const manifest = `${JSON.stringify(
          { name: basename(dir) },
          null,
          2
        )}\n`;
        const base =
          '{"compilerOptions":{"module":"CommonJS","target":"ES2022"}}\n';
        const tsconfig =
          '{"extends":"./tsconfig.base.json","include":["bin","src"]}\n';
        const app = 'export {};\n';
        writeFileSync(join(dir, 'package.json'), manifest);
        writeFileSync(join(dir, 'tsconfig.base.json'), base);
        writeFileSync(join(dir, 'tsconfig.json'), tsconfig);
        writeFileSync(join(dir, 'src', 'app.ts'), app);

        const dryRunError = expectErr(
          await runCreate(dir, {
            dryRun: true,
            surfaces: ['cli'],
            verify: false,
          })
        );
        const error = expectErr(
          await runCreate(dir, { surfaces: ['cli'], verify: false })
        );

        expect(error.message).toBe(dryRunError.message);
        expect(error.context).toMatchObject({
          reason: 'typescript-surface-syntax-incompatible',
        });
        expect(readText(dir, 'package.json')).toBe(manifest);
        expect(readText(dir, 'tsconfig.base.json')).toBe(base);
        expect(readText(dir, 'tsconfig.json')).toBe(tsconfig);
        expect(readText(dir, 'src/app.ts')).toBe(app);
        expectPaths(dir, ['bin/cli.ts', 'README.md'], false);
      });
    });

    test('projects the generated module package for a preserved NodeNext config', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(join(dir, 'src'), { recursive: true });
        const tsconfig =
          '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","skipLibCheck":true,"strict":true,"target":"ES2022"},"include":["bin","src"]}\n';
        writeFileSync(join(dir, 'tsconfig.json'), tsconfig);
        writeFileSync(join(dir, 'src', 'app.ts'), 'export {};\n');

        const result = expectOk(
          await runCreate(dir, { surfaces: ['cli'], verify: false })
        );

        expect(result.created).toContain('bin/cli.ts');
        expect(readJson(dir, 'package.json')['type']).toBe('module');
        expect(readText(dir, 'tsconfig.json')).toBe(tsconfig);
      });
    });

    test('reconciles a legacy generated standalone lint contract', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(join(dir, 'src', 'app.ts'), 'export {};\n');
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(
            {
              name: basename(dir),
              scripts: { lint: 'oxlint ./src' },
            },
            null,
            2
          )}\n`
        );
        const result = expectOk(
          await runCreate(dir, { surfaces: ['mcp'], verify: false })
        );

        expect(result.created).toContain('src/mcp.ts');
        expect(readJson(dir, 'package.json')['scripts']).toMatchObject({
          lint: 'oxlint ./src',
          typecheck: 'tsc --noEmit',
        });
        expectPaths(dir, ['tsconfig.json', 'src/mcp.ts', 'README.md'], true);
        expectPaths(dir, ['bin/mcp.ts'], false);
      });
    });

    test('rejects a customized standalone lint contract before projecting files', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(join(dir, 'src', 'app.ts'), 'export {};\n');
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(
            {
              name: basename(dir),
              scripts: { lint: 'eslint .' },
            },
            null,
            2
          )}\n`
        );
        const error = expectErr(
          await runCreate(dir, { surfaces: ['mcp'], verify: false })
        );

        expect(error.message).toContain(
          'Cannot reconcile the existing app package.json'
        );
        expect(readJson(dir, 'package.json')['scripts']).toEqual({
          lint: 'eslint .',
        });
        expectPaths(dir, ['tsconfig.json', 'src/mcp.ts', 'README.md'], false);
      });
    });

    test('reconciles a legacy generated workspace app lint contract', async () => {
      await withTempProject(async (dir) => {
        const name = basename(dir);
        mkdirSync(join(dir, 'apps', name, 'src'), { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify({ name, private: true }, null, 2)}\n`
        );
        writeFileSync(
          join(dir, 'apps', name, 'package.json'),
          `${JSON.stringify(
            { name, scripts: { lint: 'oxlint ./src' } },
            null,
            2
          )}\n`
        );
        writeFileSync(join(dir, 'apps', name, 'src', 'app.ts'), 'export {};\n');

        const result = expectOk(
          await runCreate(dir, {
            surfaces: ['mcp'],
            verify: false,
            workspace: true,
          })
        );

        expect(result.created).toContain(`apps/${name}/src/mcp.ts`);
        expect(
          readJson(dir, `apps/${name}/package.json`)['scripts']
        ).toMatchObject({ lint: 'oxlint ./src' });
        expectPaths(dir, [`apps/${name}/src/mcp.ts`], true);
        expectPaths(dir, [`apps/${name}/bin/mcp.ts`], false);
      });
    });

    test('projects a fresh local tsconfig before resolving workspace surfaces', async () => {
      await withTempProject(async (dir) => {
        const name = basename(dir);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"files":[],"references":[]}\n'
        );
        const input = {
          surfaces: ['cli', 'mcp'] as const,
          verify: false,
          workspace: true,
        };

        const dryRun = expectOk(
          await runCreate(dir, { ...input, dryRun: true })
        );
        expectPaths(dir, ['apps', 'trails.config.ts'], false);
        expect(dryRun.plannedOperations).toEqual(
          expect.arrayContaining([
            { kind: 'write', path: `apps/${name}/bin/cli.ts` },
            { kind: 'write', path: `apps/${name}/bin/mcp.ts` },
          ])
        );

        const applied = expectOk(await runCreate(dir, input));

        expect(applied.plannedOperations).toEqual(dryRun.plannedOperations);
        expectPaths(
          dir,
          [`apps/${name}/bin/cli.ts`, `apps/${name}/bin/mcp.ts`],
          true
        );
      });
    });

    test('dry-run reruns report only writes the real rerun performs', async () => {
      await withTempProject(async (dir) => {
        const name = basename(dir);
        const input = {
          surfaces: ['cli', 'mcp'] as const,
          workspace: true,
        };
        expectOk(await runCreate(dir, input));
        const readme = readText(dir, 'README.md');
        const cli = readText(dir, `apps/${name}/bin/cli.ts`);
        const testFile = readText(
          dir,
          `apps/${name}/__tests__/examples.test.ts`
        );

        const dryRun = expectOk(
          await runCreate(dir, { ...input, dryRun: true })
        );

        expect(dryRun.created).toEqual([]);
        expect(dryRun.plannedOperations).toEqual([
          { kind: 'write', path: `apps/${name}/package.json` },
        ]);
        expect(readText(dir, 'README.md')).toBe(readme);
        expect(readText(dir, `apps/${name}/bin/cli.ts`)).toBe(cli);
        expect(readText(dir, `apps/${name}/__tests__/examples.test.ts`)).toBe(
          testFile
        );

        const applied = expectOk(await runCreate(dir, input));
        expect(applied.created).toEqual([]);
        expect(applied.plannedOperations).toEqual(dryRun.plannedOperations);
      });
    });

    test('dry-run preserves legacy src surface paths used by reconciliation', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        writeFileSync(join(dir, 'src', 'cli.ts'), 'existing cli\n');

        const input = {
          surfaces: ['cli', 'mcp'] as const,
          verify: false,
        };
        const dryRun = expectOk(
          await runCreate(dir, { ...input, dryRun: true })
        );
        const applied = expectOk(await runCreate(dir, input));

        expect(dryRun.plannedOperations).toEqual(applied.plannedOperations);
        expect(dryRun.plannedOperations).toEqual(
          expect.arrayContaining([{ kind: 'write', path: 'src/mcp.ts' }])
        );
        expect(dryRun.plannedOperations).not.toEqual(
          expect.arrayContaining([
            { kind: 'write', path: 'bin/cli.ts' },
            { kind: 'write', path: 'bin/mcp.ts' },
          ])
        );
        expectPaths(dir, ['src/cli.ts', 'src/mcp.ts'], true);
        expectPaths(dir, ['bin/cli.ts', 'bin/mcp.ts'], false);
        expectContainsAll(readText(dir, 'README.md'), [
          '`src/cli.ts` - CLI surface entry point',
          '`src/mcp.ts` - MCP surface entry point',
        ]);
        expect(readText(dir, 'README.md')).not.toContain('`bin/cli.ts`');
        expect(readText(dir, 'README.md')).not.toContain('`bin/mcp.ts`');
      });
    });

    test('dry-run preserves an explicit legacy lint contract', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const pkg = readJson(dir, 'package.json');
        pkg['scripts'] = { lint: 'oxlint ./src' };
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(pkg, null, 2)}\n`
        );
        writeFileSync(join(dir, 'src', 'cli.ts'), 'existing cli\n');

        const input = {
          surfaces: ['cli', 'mcp'] as const,
          verify: false,
        };
        const dryRun = expectOk(
          await runCreate(dir, { ...input, dryRun: true })
        );
        const applied = expectOk(await runCreate(dir, input));

        expect(dryRun.plannedOperations).toEqual(applied.plannedOperations);
        expect(dryRun.plannedOperations).toEqual(
          expect.arrayContaining([{ kind: 'write', path: 'src/mcp.ts' }])
        );
        expectPaths(dir, ['src/cli.ts', 'src/mcp.ts'], true);
        expectPaths(dir, ['bin/cli.ts', 'bin/mcp.ts'], false);
        expect(readJson(dir, 'package.json')['scripts']).toMatchObject({
          lint: 'oxlint ./src',
        });
      });
    });

    test('plans scaffold writes without touching disk and applies the same operations', async () => {
      await withTempProject(async (dir) => {
        const dryRun = expectOk(
          await createScaffold.implementation(
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
            { kind: 'write', path: 'tsconfig.tests.json' },
          ])
        );
        expect(existsSync(dir)).toBe(false);

        const applied = expectOk(
          await createScaffold.implementation(
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
            'src/trails/hello.ts',
          ],
          true
        );
        assertNoDisposableTrailsState(dir);
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

    test('teaches scoped local permits only for protected CLI starters', async () => {
      const permit =
        '--permit \'{"id":"local-dev","scopes":["entity:write"]}\'';
      const runPermit =
        '--permit \'{"id":"local-dev","scopes":["trails:run"]}\'';
      const compilePermit =
        '--permit \'{"id":"local-dev","scopes":["topo:write"]}\'';
      const forbiddenShortcut = `--dev${'-permit'}`;

      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { starter: 'entity' }));
        const readme = readText(dir, 'README.md');
        expect(readme).toContain(
          'Protected starter writes require an explicit scoped permit.'
        );
        expect(readme).toContain(
          `bun bin/cli.ts entity add --name New ${permit}`
        );
        expect(readme).not.toContain(forbiddenShortcut);

        linkGeneratedProjectDependencies(dir);
        const documentedCommand = Bun.spawnSync({
          cmd: [
            process.execPath,
            'bin/cli.ts',
            'entity',
            'add',
            '--name',
            'New',
            '--permit',
            '{"id":"local-dev","scopes":["entity:write"]}',
          ],
          cwd: dir,
          env: { ...process.env, NO_COLOR: '1' } as Record<string, string>,
          stderr: 'pipe',
          stdout: 'pipe',
        });
        expect(documentedCommand.exitCode).toBe(0);
      });

      for (const preservedPath of ['src/trails/entity.ts', 'src/store.ts']) {
        await withTempProject(async (dir) => {
          const preserved = 'export {};\n';
          mkdirSync(dirname(join(dir, preservedPath)), { recursive: true });
          writeFileSync(join(dir, preservedPath), preserved);

          expectOk(await runCreate(dir, { starter: 'entity', verify: false }));

          expect(readText(dir, preservedPath)).toBe(preserved);
          const readme = readText(dir, 'README.md');
          expect(readme).not.toContain(
            'Protected starter writes require an explicit scoped permit.'
          );
          expect(readme).not.toContain('entity add --name New --permit');
        });
      }

      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        writeFileSync(
          join(dir, 'src', 'cli.ts'),
          `import { surface } from '@ontrails/commander';

import { app } from './app.js';

await surface(app);
`
        );
        expectOk(await runCreate(dir, { starter: 'entity', verify: false }));
        const readme = readText(dir, 'README.md');
        expect(readme).not.toContain(
          'Protected starter writes require an explicit scoped permit.'
        );
        expect(readme).not.toContain('entity add --name New --permit');

        linkGeneratedProjectDependencies(dir);
        const legacyCli = Bun.spawnSync({
          cmd: [
            process.execPath,
            'src/cli.ts',
            'entity',
            'add',
            '--permit',
            '{"id":"local-dev","scopes":["entity:write"]}',
          ],
          cwd: dir,
          env: { ...process.env, NO_COLOR: '1' } as Record<string, string>,
          stderr: 'pipe',
          stdout: 'pipe',
        });
        expect(legacyCli.exitCode).toBe(1);
        expect(legacyCli.stderr.toString()).toContain(
          "unknown option '--permit'"
        );
      });

      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        writeFileSync(
          join(dir, 'src', 'app.ts'),
          "import { topo } from '@ontrails/core';\nexport const app = topo('preserved');\n"
        );

        expectOk(await runCreate(dir, { starter: 'entity', verify: false }));
        const readme = readText(dir, 'README.md');
        expect(readme).not.toContain(
          'Protected starter writes require an explicit scoped permit.'
        );
        expect(readme).not.toContain('entity add --name New --permit');
      });

      await withTempProject(async (dir) => {
        const name = basename(dir);
        expectOk(await runCreate(dir, { starter: 'entity', workspace: true }));
        const readme = readText(dir, 'README.md');
        expect(readme).toContain(
          `bun apps/${name}/bin/cli.ts entity add --name New ${permit}`
        );
        expect(readme).toContain(
          `bunx trails run entity.list --app ${name} ${runPermit}`
        );
        expect(readme).toContain(
          `bunx trails compile --app ${name} ${compilePermit}`
        );
        expect(readme).not.toContain(`bunx trails run hello --app ${name}`);
        expect(readme).not.toContain(forbiddenShortcut);
      });

      await withTempProject(async (dir) => {
        expectOk(
          await runCreate(dir, {
            starter: 'entity',
            surfaces: ['mcp'],
            workspace: true,
          })
        );
        const name = basename(dir);
        const readme = readText(dir, 'README.md');
        expect(readme).toContain(
          `bunx trails run entity.list --app ${name} ${runPermit}`
        );
        expect(readme).not.toContain(
          'Protected starter writes require an explicit scoped permit.'
        );
      });

      await withTempProject(async (dir) => {
        const name = basename(dir);
        expectOk(await runCreate(dir, { workspace: true }));
        expect(readText(dir, 'README.md')).toContain(
          `bunx trails run hello --app ${name} ${runPermit}`
        );
        expect(readText(dir, 'README.md')).toContain(
          `bunx trails compile --app ${name} ${compilePermit}`
        );
      });

      await withTempProject(async (dir) => {
        expectOk(await runCreate(dir, { starter: 'empty', workspace: true }));
        expect(readText(dir, 'README.md')).not.toContain('bunx trails run ');
      });
    }, 15_000);

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
        expectPaths(dir, ['bin/cli.ts', 'bin/mcp.ts', 'bin/http.ts'], true);
        assertCliPackage(dir);
        assertHttpSurface(dir);
        expectContainsAll(readText(dir, 'bin/mcp.ts'), [
          "import { surface } from '@ontrails/mcp'",
          'await surface(app, { overlays })',
        ]);
        const deps = readJson(dir, 'package.json')['dependencies'] as Record<
          string,
          string
        >;
        expectExactOntrailsPin(deps['@ontrails/mcp']);
        assertReadme(dir, { surfaces: ['cli', 'mcp', 'http'] });
      });
    });

    test('passes authored overlays to generated CLI and MCP runtimes', async () => {
      await withTempProject(async (dir) => {
        expectOk(
          await runCreate(dir, {
            surfaces: ['cli', 'mcp'],
            verify: false,
          })
        );
        writeFileSync(
          join(dir, 'src', 'app.ts'),
          `import { Result, surfaceOverlay, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const hello = trail('hello', {
  implementation: () => Result.ok({ message: 'hello' }),
  input: z.object({}).default({}),
  output: z.object({ message: z.string() }),
});

export const app = topo('runtime-parity', { hello });
export const trailsOverlays = [
  surfaceOverlay({
    cli: { hi: 'hello' },
    mcp: { hello_group: ['hello'] },
  }),
];
`
        );

        expectGeneratedProjectTypecheck(dir);
        expect(readGeneratedSurfaceOverlayParity(dir)).toEqual({
          cliAlias: true,
          mcpTrailhead: true,
        });
      });
    }, 15_000);

    test('generates formatter- and lint-clean project files', async () => {
      await withTempProject(async (dir) => {
        expectOk(
          await runCreate(dir, {
            starter: 'entity',
            surfaces: ['cli', 'mcp', 'http'],
            verify: true,
          })
        );

        expectGeneratedProjectFormatCheck(dir);
        expectGeneratedProjectLintCheck(dir);
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
        mkdirSync(join(dir, 'bin'), { recursive: true });
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
        const tsconfig =
          '{"compilerOptions":{"module":"ESNext","target":"ESNext"},"custom":true}\n';
        writeFileSync(join(dir, 'tsconfig.json'), tsconfig);
        writeFileSync(join(dir, 'README.md'), '# Existing README\n');
        writeFileSync(
          join(dir, 'src', 'app.ts'),
          "import { topo } from '@ontrails/core';\nexport const app = topo('existing');\n"
        );
        writeFileSync(join(dir, 'bin', 'cli.ts'), 'existing cli\n');

        const result = expectOk(
          await runCreate(dir, { surfaces: ['cli', 'mcp'] })
        );

        expectCreatedPaths(result.created, [
          'package.json',
          'bin/mcp.ts',
          'src/trails/hello.ts',
          '__tests__/examples.test.ts',
          'lefthook.yml',
        ]);
        expect(result.created).not.toContain('bin/cli.ts');
        expect(readText(dir, 'bin/cli.ts')).toBe('existing cli\n');
        expect(readText(dir, 'src/app.ts')).toContain("topo('existing')");
        expect(readText(dir, 'tsconfig.json')).toBe(tsconfig);
        expect(readText(dir, 'README.md')).toBe('# Existing README\n');
        expectPaths(dir, ['bin/mcp.ts', 'src/trails/hello.ts'], true);

        const pkg = readJson(dir, 'package.json');
        expect(pkg['workspaceNote']).toBe('preserve me');
        expect((pkg['scripts'] as Record<string, string>)['keep']).toBe(
          'echo keep'
        );
        assertFrameworkCliScripts(dir);
        const deps = pkg['dependencies'] as Record<string, string>;
        expectExactOntrailsPin(deps['@ontrails/cli']);
        expectExactOntrailsPin(deps['@ontrails/commander']);
        expectExactOntrailsPin(deps['@ontrails/mcp']);
        const devDeps = pkg['devDependencies'] as Record<string, string>;
        assertGeneratedToolingDeps(dir);
        expectExactOntrailsPin(devDeps['@ontrails/testing']);
        expectExactOntrailsPin(devDeps['@ontrails/warden']);
      });
    });

    test('rejects path-shaped project names before writing', async () => {
      await withTempProject(async (dir) => {
        const error = expectErr(
          await createScaffold.implementation(
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

    test('declares dry-run capability on the derived contract', () => {
      const graph = deriveTopoGraph(
        topo('trails-create-contract', {
          addSurface,
          addVerify,
          createScaffold,
          createTrail,
        })
      );
      const entry = graph.entries.find(
        (candidate) => candidate.id === 'create'
      );

      expect(entry?.dryRunCapable).toBe(true);
    });
  });

  describe('add-surface mode', () => {
    test('pins the audited TypeScript prospective matcher runtime', () => {
      const manifest = readJson(repoRoot, 'apps/trails/package.json');
      const dependencies = manifest['dependencies'] as Record<string, string>;
      const matcher = (
        ts as typeof ts & {
          readonly matchFiles?: (...args: never[]) => unknown;
        }
      ).matchFiles;

      expect(dependencies['typescript']).toBe('5.9.3');
      expect(ts.version).toBe('5.9.3');
      expect(typeof matcher).toBe('function');
      expect(matcher?.length).toBe(9);
    });

    test.each([
      [
        'an unaudited version',
        { shape: 'audited', version: '5.9.4' },
        'typescript-prospective-matcher-version-mismatch',
      ],
      [
        'a missing matcher',
        { shape: 'missing', version: '5.9.3' },
        'typescript-prospective-matcher-unavailable',
      ],
      [
        'an incompatible matcher',
        { shape: 'incompatible', version: '5.9.3' },
        'typescript-prospective-matcher-incompatible',
      ],
    ] as const)(
      'fails closed for %s runtime',
      (_name, input, expectedReason) => {
        const probe = probeTypeScriptMatcherGuard(input);

        expect(probe.context['reason']).toBe(expectedReason);
      }
    );

    test('adds MCP to existing project', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('bin/mcp.ts');
        expect(result.dependency).toBe('@ontrails/mcp');
        expectPaths(dir, ['bin/mcp.ts'], true);
        expectContainsAll(readText(dir, 'bin/mcp.ts'), [
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
          await addSurface.implementation({ dir, surface: 'http' }, {} as never)
        );

        expect(result.created).toBe('bin/http.ts');
        expect(result.dependency).toBe('@ontrails/hono');
        assertHttpSurface(dir);
      });
    });

    test('adds the CLI command without replacing unrelated bin mappings', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const pkg = readJson(dir, 'package.json');
        pkg['bin'] = {
          admin: './src/admin.ts',
          test: './src/legacy-cli.ts',
          worker: './src/worker.ts',
        };
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(pkg, null, 2)}\n`
        );

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'cli' }, {} as never)
        );

        expect(result.created).toBe('bin/cli.ts');
        expect(readJson(dir, 'package.json')['bin']).toEqual({
          admin: './src/admin.ts',
          test: './bin/cli.ts',
          worker: './src/worker.ts',
        });
      });
    });

    test('rejects inherited CommonJS before direct surface writes', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const manifest = readText(dir, 'package.json');
        const base =
          '{"compilerOptions":{"module":"CommonJS","target":"ES2022"}}\n';
        const tsconfig =
          '{"extends":"./tsconfig.base.json","include":["bin","src"]}\n';
        writeFileSync(join(dir, 'tsconfig.base.json'), base);
        writeFileSync(join(dir, 'tsconfig.json'), tsconfig);

        const error = expectErr(
          await addSurface.implementation({ dir, surface: 'cli' }, {} as never)
        );

        expect(error.context).toMatchObject({
          reason: 'typescript-surface-syntax-incompatible',
        });
        expect(readText(dir, 'package.json')).toBe(manifest);
        expect(readText(dir, 'tsconfig.base.json')).toBe(base);
        expect(readText(dir, 'tsconfig.json')).toBe(tsconfig);
        expectPaths(dir, ['bin/cli.ts', 'src/cli.ts'], false);
      });
    });

    test('accepts an app-local ESNext override of an inherited CommonJS base', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        writeFileSync(
          join(dir, 'tsconfig.base.json'),
          '{"compilerOptions":{"module":"CommonJS","target":"ES2022"}}\n'
        );
        const tsconfig =
          '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler","noUncheckedIndexedAccess":true,"skipLibCheck":true,"strict":true,"target":"ESNext","verbatimModuleSyntax":true},"extends":"./tsconfig.base.json","include":["bin","src"]}\n';
        writeFileSync(join(dir, 'tsconfig.json'), tsconfig);

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'cli' }, {} as never)
        );

        expect(result.created).toBe('bin/cli.ts');
        expect(readText(dir, 'tsconfig.json')).toBe(tsconfig);
        expectGeneratedProjectTypecheck(dir);
      });
    });

    test('uses the actual package type for NodeNext surface syntax', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const tsconfig =
          '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"},"include":["bin","src"]}\n';
        writeFileSync(join(dir, 'tsconfig.json'), tsconfig);

        const commonJsError = expectErr(
          await addSurface.implementation({ dir, surface: 'cli' }, {} as never)
        );
        expect(commonJsError.context).toMatchObject({
          reason: 'typescript-surface-syntax-incompatible',
        });
        expectPaths(dir, ['bin/cli.ts', 'src/cli.ts'], false);

        const pkg = readJson(dir, 'package.json');
        pkg['type'] = 'module';
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(pkg, null, 2)}\n`
        );
        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'cli' }, {} as never)
        );

        expect(result.created).toBe('bin/cli.ts');
        expect(readText(dir, 'tsconfig.json')).toBe(tsconfig);
      });
    });

    test('loads overlays optionally for a legacy app without the export', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler","noUncheckedIndexedAccess":true,"rootDir":"src","skipLibCheck":true,"strict":true,"target":"ESNext","verbatimModuleSyntax":true},"include":["src"]}\n'
        );

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('src/mcp.ts');
        expect(readText(dir, 'src/app.ts')).not.toContain('trailsOverlays');
        expectContainsAll(readText(dir, 'src/mcp.ts'), [
          "import * as appModule from './app.js'",
          "resolveTrailsOverlays(appModule, './app.js')",
          'await surface(app, { overlays })',
        ]);
        expectGeneratedProjectTypecheck(dir);
      });
    });

    test('preserves the legacy src surface layout without rewriting tooling', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const pkg = readJson(dir, 'package.json');
        pkg['scripts'] = { keep: 'echo keep', lint: 'oxlint ./src' };
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(pkg, null, 2)}\n`
        );
        const tsconfig = `{
  "compilerOptions": { "module": "ESNext", "rootDir": "src", "target": "ESNext" },
  "include": ["src"]
}\n`;
        writeFileSync(join(dir, 'tsconfig.json'), tsconfig);
        writeFileSync(join(dir, 'src', 'cli.ts'), 'existing cli\n');

        const mcp = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );
        const cli = expectOk(
          await addSurface.implementation({ dir, surface: 'cli' }, {} as never)
        );

        expect(mcp.created).toBe('src/mcp.ts');
        expect(cli.created).toBeNull();
        expectPaths(dir, ['src/mcp.ts', 'src/cli.ts'], true);
        expectPaths(dir, ['bin/mcp.ts', 'bin/cli.ts'], false);
        expect(readText(dir, 'src/mcp.ts')).toContain("from './app.js'");
        expect(readText(dir, 'src/cli.ts')).toBe('existing cli\n');
        expect(readText(dir, 'tsconfig.json')).toBe(tsconfig);
        const updated = readJson(dir, 'package.json');
        expect(updated['scripts']).toEqual({
          keep: 'echo keep',
          lint: 'oxlint ./src',
        });
        expect(updated['bin']).toEqual({ test: './src/cli.ts' });
      });
    });

    test.each([
      ['bin', 'src'],
      ['src', 'bin'],
    ] as const)(
      'rejects an established %s surface root excluded by a %s-only TypeScript config',
      async (establishedRoot, configuredRoot) => {
        await withTempProject(async (dir) => {
          setupMinimalProject(dir);
          mkdirSync(join(dir, establishedRoot), { recursive: true });
          writeFileSync(join(dir, establishedRoot, 'cli.ts'), 'existing cli\n');
          writeFileSync(
            join(dir, 'tsconfig.json'),
            `{"compilerOptions":{"module":"ESNext","strict":true,"target":"ESNext"},"include":["${configuredRoot}"]}\n`
          );
          const manifest = readText(dir, 'package.json');

          const error = expectErr(
            await addSurface.implementation(
              { dir, surface: 'mcp' },
              {} as never
            )
          );

          expect(error.context).toMatchObject({
            entryFile: `${establishedRoot}/mcp.ts`,
            reason: 'typescript-established-surface-root-excluded',
          });
          expect(readText(dir, 'package.json')).toBe(manifest);
          expectPaths(dir, ['src/mcp.ts', 'bin/mcp.ts'], false);
        });
      }
    );

    test.each([
      ['bin', 'src'],
      ['src', 'bin'],
    ] as const)(
      'rejects an established %s surface root excluded by %s-only lint',
      async (establishedRoot, lintRoot) => {
        await withTempProject(async (dir) => {
          setupMinimalProject(dir);
          mkdirSync(join(dir, establishedRoot), { recursive: true });
          const establishedEntry = `${establishedRoot}/cli.ts`;
          writeFileSync(join(dir, establishedEntry), 'existing cli\n');
          writeFileSync(
            join(dir, 'tsconfig.json'),
            '{"compilerOptions":{"module":"ESNext","strict":true,"target":"ESNext"},"include":["bin","src"]}\n'
          );
          const pkg = readJson(dir, 'package.json');
          pkg['scripts'] = { lint: `oxlint ./${lintRoot}` };
          writeFileSync(
            join(dir, 'package.json'),
            `${JSON.stringify(pkg, null, 2)}\n`
          );
          const manifest = readText(dir, 'package.json');

          const error = expectErr(
            await addSurface.implementation(
              { dir, surface: 'mcp' },
              {} as never
            )
          );

          expect(error.context).toMatchObject({
            entryFile: `${establishedRoot}/mcp.ts`,
            reason: 'lint-established-surface-root-excluded',
          });
          expect(readText(dir, 'package.json')).toBe(manifest);
          expect(readText(dir, establishedEntry)).toBe('existing cli\n');
          expectPaths(dir, ['src/mcp.ts', 'bin/mcp.ts'], false);
        });
      }
    );

    test('uses established src-only tooling before any surface entry exists', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const pkg = readJson(dir, 'package.json');
        pkg['scripts'] = { lint: 'oxlint ./src' };
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(pkg, null, 2)}\n`
        );
        writeFileSync(
          join(dir, 'tsconfig.base.json'),
          '{"compilerOptions":{"module":"ESNext","rootDir":"src","target":"ESNext"}}\n'
        );
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"extends":"./tsconfig.base.json","include":["src"]}\n'
        );

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('src/mcp.ts');
        expectPaths(dir, ['src/mcp.ts'], true);
        expectPaths(dir, ['bin/mcp.ts'], false);
        expect(readEffectiveTypeScriptFiles(dir)).toContain('src/mcp.ts');
      });
    });

    test('uses src when an include-only TypeScript config excludes bin', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"compilerOptions":{"module":"ESNext","strict":true,"target":"ESNext"},"include":["src"]}\n'
        );

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('src/mcp.ts');
        expectPaths(dir, ['src/mcp.ts'], true);
        expectPaths(dir, ['bin/mcp.ts'], false);
        const effectiveFiles = readEffectiveTypeScriptFiles(dir);
        expect(effectiveFiles).toContain('src/mcp.ts');
        expect(effectiveFiles).not.toContain('bin/mcp.ts');
      });
    });

    test('uses src when preserved lint scope excludes bin', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const pkg = readJson(dir, 'package.json');
        pkg['scripts'] = { lint: 'oxlint ./src' };
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(pkg, null, 2)}\n`
        );
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"compilerOptions":{"module":"ESNext","strict":true,"target":"ESNext"},"include":["bin","src"]}\n'
        );

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('src/mcp.ts');
        expectPaths(dir, ['src/mcp.ts'], true);
        expectPaths(dir, ['bin/mcp.ts'], false);
        expect(readJson(dir, 'package.json')['scripts']).toEqual({
          lint: 'oxlint ./src',
        });
      });
    });

    test('uses src-only lint scope when no TypeScript config exists', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const pkg = readJson(dir, 'package.json');
        pkg['scripts'] = { lint: 'oxlint ./src' };
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(pkg, null, 2)}\n`
        );

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('src/mcp.ts');
        expectPaths(dir, ['src/mcp.ts'], true);
        expectPaths(dir, ['bin/mcp.ts'], false);
      });
    });

    test('fails without writes when TypeScript and lint scopes do not overlap', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const pkg = readJson(dir, 'package.json');
        pkg['scripts'] = { lint: 'oxlint ./src' };
        const manifest = `${JSON.stringify(pkg, null, 2)}\n`;
        writeFileSync(join(dir, 'package.json'), manifest);
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"compilerOptions":{"module":"ESNext","strict":true,"target":"ESNext"},"include":["bin"]}\n'
        );

        const error = expectErr(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain(
          'TypeScript and lint configuration do not share a supported mcp surface entry path'
        );
        expect(readText(dir, 'package.json')).toBe(manifest);
        expectPaths(dir, ['src/mcp.ts', 'bin/mcp.ts'], false);
      });
    });

    test('uses bin when TypeScript and lint cover both surface roots', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const pkg = readJson(dir, 'package.json');
        pkg['scripts'] = { lint: 'oxlint ./src ./bin' };
        writeFileSync(
          join(dir, 'package.json'),
          `${JSON.stringify(pkg, null, 2)}\n`
        );
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"compilerOptions":{"module":"ESNext","strict":true,"target":"ESNext"},"include":["bin","src"]}\n'
        );

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('bin/mcp.ts');
        expectPaths(dir, ['bin/mcp.ts'], true);
        expectPaths(dir, ['src/mcp.ts'], false);
        expect(readEffectiveTypeScriptFiles(dir)).toContain('bin/mcp.ts');
        expect(readJson(dir, 'package.json')['scripts']).toEqual({
          lint: 'oxlint ./src ./bin',
        });
      });
    });

    test('honors inherited TypeScript include scope without rootDir', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        writeFileSync(
          join(dir, 'tsconfig.base.json'),
          '{"compilerOptions":{"module":"ESNext","strict":true,"target":"ESNext"},"include":["src"]}\n'
        );
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"extends":"./tsconfig.base.json"}\n'
        );

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('src/mcp.ts');
        expectPaths(dir, ['src/mcp.ts'], true);
        expectPaths(dir, ['bin/mcp.ts'], false);
        expect(readEffectiveTypeScriptFiles(dir)).toContain('src/mcp.ts');
      });
    });

    test('honors solution-style referenced TypeScript project scope', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}\n'
        );
        writeFileSync(
          join(dir, 'tsconfig.app.json'),
          '{"compilerOptions":{"module":"ESNext","rootDir":"src","target":"ESNext"},"include":["src"]}\n'
        );

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('src/mcp.ts');
        expectPaths(dir, ['src/mcp.ts'], true);
        expectPaths(dir, ['bin/mcp.ts'], false);
        expect(
          readEffectiveTypeScriptFiles(dir, 'tsconfig.app.json')
        ).toContain('src/mcp.ts');
      });
    });

    test('rejects a CommonJS project reference before surface writes', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const manifest = readText(dir, 'package.json');
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}\n'
        );
        const appConfig =
          '{"compilerOptions":{"module":"CommonJS","rootDir":"src","target":"ES2022"},"include":["src"]}\n';
        writeFileSync(join(dir, 'tsconfig.app.json'), appConfig);

        const error = expectErr(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(error.context).toMatchObject({
          reason: 'typescript-surface-syntax-incompatible',
        });
        expect(readText(dir, 'package.json')).toBe(manifest);
        expect(readText(dir, 'tsconfig.app.json')).toBe(appConfig);
        expectPaths(dir, ['src/mcp.ts', 'bin/mcp.ts'], false);
      });
    });

    test('honors TypeScript exclusions when choosing a new surface root', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"compilerOptions":{"module":"ESNext","strict":true,"target":"ESNext"},"exclude":["bin"],"include":["**/*.ts"]}\n'
        );

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBe('src/mcp.ts');
        expectPaths(dir, ['src/mcp.ts'], true);
        expectPaths(dir, ['bin/mcp.ts'], false);
        const effectiveFiles = readEffectiveTypeScriptFiles(dir);
        expect(effectiveFiles).toContain('src/mcp.ts');
        expect(effectiveFiles).not.toContain('bin/mcp.ts');
      });
    });

    test('fails without writes when TypeScript excludes both surface roots', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        const manifest = readText(dir, 'package.json');
        writeFileSync(
          join(dir, 'tsconfig.json'),
          '{"compilerOptions":{"strict":true},"files":["src/app.ts"]}\n'
        );

        const error = expectErr(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain(
          'TypeScript config does not include a supported mcp surface entry path'
        );
        expect(readText(dir, 'package.json')).toBe(manifest);
        expectPaths(dir, ['src/mcp.ts', 'bin/mcp.ts'], false);
      });
    });

    test('reconciles an existing legacy surface in a mixed layout', async () => {
      await withTempProject(async (dir) => {
        setupMinimalProject(dir);
        mkdirSync(join(dir, 'bin'), { recursive: true });
        writeFileSync(join(dir, 'bin', 'cli.ts'), 'new-layout cli\n');
        writeFileSync(join(dir, 'src', 'mcp.ts'), 'legacy mcp\n');

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );

        expect(result.created).toBeNull();
        expect(readText(dir, 'src/mcp.ts')).toBe('legacy mcp\n');
        expectPaths(dir, ['bin/mcp.ts'], false);
      });
    });

    test('reconciles existing surface entrypoint', async () => {
      await withTempProject(async (dir) => {
        mkdirSync(join(dir, 'src'), { recursive: true });
        mkdirSync(join(dir, 'bin'), { recursive: true });
        mkdirSync(join(dir, '.trails'), { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({ name: basename(dir) }, null, 2)
        );
        writeFileSync(join(dir, 'bin', 'mcp.ts'), 'existing content');

        const result = expectOk(
          await addSurface.implementation({ dir, surface: 'mcp' }, {} as never)
        );
        expect(result.created).toBeNull();
        expect(readText(dir, 'bin/mcp.ts')).toBe('existing content');
        const deps = readJson(dir, 'package.json')['dependencies'] as Record<
          string,
          string
        >;
        expectExactOntrailsPin(deps['@ontrails/mcp']);
      });
    });
  });

  test('keeps workspace hook ownership out of the add.verify input', () => {
    expect('hookDir' in addVerify.input.shape).toBe(false);
  });

  test('returns project-context failures before add.verify writes', async () => {
    await withTempProject(async (dir) => {
      const appRoot = join(dir, 'apps', 'demo');
      mkdirSync(appRoot, { recursive: true });
      writeFileSync(
        join(dir, 'trails.config.ts'),
        [
          `const apps = { demo: { root: 'apps/demo' } };`,
          `export default { workspace: { apps } };`,
          '',
        ].join('\n')
      );

      const result = await addVerify.implementation(
        { dir: join(dir, 'apps'), name: 'demo' },
        {} as never
      );

      const error = expectErr(result);
      expect(error.context).toMatchObject({
        reason: 'dynamic-expression',
        section: 'workspace.apps',
      });
      expectPaths(
        appRoot,
        ['__tests__/examples.test.ts', 'lefthook.yml'],
        false
      );
      expectPaths(dir, ['lefthook.yml'], false);
    });
  });

  test('returns a Result when hook ownership cannot be canonicalized', () => {
    const missingRoot = join(
      tmpdir(),
      `trails-add-verify-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    const error = expectErr(
      resolveCanonicalHookDir(
        missingRoot,
        join(missingRoot, 'app'),
        join(missingRoot, 'workspace')
      )
    );

    expect(error.message).toBe('Failed to resolve add.verify hook ownership.');
    expect(error).toBeInstanceOf(InternalError);
    if (!(error instanceof InternalError)) {
      throw error;
    }
    expect(error.context).toEqual({
      appRoot: join(missingRoot, 'app'),
      projectDir: missingRoot,
      workspaceRoot: join(missingRoot, 'workspace'),
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
