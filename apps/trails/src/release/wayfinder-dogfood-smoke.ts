import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = resolve(process.cwd());
const trailsBin = join(repoRoot, 'apps/trails/bin/trails.ts');

type JsonObject = Record<string, unknown>;

export interface WayfinderDogfoodSmokeResult {
  readonly check: 'wayfinder-dogfood';
  readonly message: string;
  readonly passed: true;
  readonly trailCount: number;
}

const assertObject = (value: unknown, label: string): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} did not return a JSON object`);
  }
  return value as JsonObject;
};

const assertAlignedSource = (value: JsonObject, label: string): void => {
  const drift = assertObject(value['drift'], `${label}.drift`);
  if (drift['status'] !== 'aligned') {
    throw new Error(`${label} did not read fresh artifacts`);
  }
  const source = assertObject(value['source'], `${label}.source`);
  if (source['kind'] !== 'topoGraph') {
    throw new Error(`${label} did not read the TopoGraph source`);
  }
};

const parseJson = (stdout: string, label: string): JsonObject => {
  try {
    return assertObject(JSON.parse(stdout) as unknown, label);
  } catch (error) {
    throw new Error(`${label} did not produce valid JSON`, { cause: error });
  }
};

const runCommand = (command: readonly string[], label: string): JsonObject => {
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: '1' } as Record<
      string,
      string | undefined
    >,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `Wayfinder dogfood command failed: ${command.join(' ')}`,
        `exitCode: ${result.exitCode}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join('\n')
    );
  }
  return parseJson(stdout, label);
};

const runTrails = (tempRoot: string, args: readonly string[]): JsonObject => {
  const command = [
    process.execPath,
    trailsBin,
    ...args,
    '--root-dir',
    tempRoot,
    '--json',
  ];
  return runCommand(command, `trails ${args.join(' ')}`);
};

const runWayfind = (tempRoot: string, args: readonly string[]): JsonObject =>
  runTrails(tempRoot, ['wayfind', ...args]);

const runSchema = (args: readonly string[]): JsonObject =>
  runCommand([process.execPath, trailsBin, 'schema', ...args], 'trails schema');

const writeOperatorAppWrapper = async (tempRoot: string): Promise<void> => {
  const srcDir = join(tempRoot, 'src');
  await mkdir(srcDir, { recursive: true });
  const appModuleUrl = pathToFileURL(join(repoRoot, 'apps/trails/src/app.ts'));
  await writeFile(
    join(srcDir, 'app.ts'),
    `export { app, trailsCliAliases } from ${JSON.stringify(appModuleUrl.href)};\n`
  );
};

const writeJson = async (
  path: string,
  value: Readonly<Record<string, unknown>>
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const writeAdapterWorkspace = async (tempRoot: string): Promise<void> => {
  await writeJson(join(tempRoot, 'package.json'), {
    name: 'wayfinder-dogfood-root',
    workspaces: ['packages/*', 'adapters/*'],
  });
  await writeJson(join(tempRoot, 'packages/http/package.json'), {
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
      './testing': './src/testing.ts',
    },
    name: '@ontrails/http',
    trails: {
      adapterTargets: {
        http: {
          conformance: {
            adapterType: 'HttpAdapterConformanceAdapter',
            casesFactory: 'createHttpAdapterConformanceCases',
            runner: 'runConformance',
          },
          placements: ['extracted'],
          testingImport: '@ontrails/http/testing',
        },
      },
    },
  });
  await mkdir(join(tempRoot, 'packages/http/src'), { recursive: true });
  await writeFile(
    join(tempRoot, 'packages/http/src/index.ts'),
    'export const http = {};\n'
  );
  await writeFile(
    join(tempRoot, 'packages/http/src/testing.ts'),
    [
      'export interface HttpAdapterConformanceAdapter {}',
      'export const createHttpAdapterConformanceCases = () => [];',
      'export const runConformance = () => undefined;',
      '',
    ].join('\n')
  );
  await writeJson(join(tempRoot, 'adapters/hono/package.json'), {
    dependencies: {
      '@ontrails/core': 'workspace:^',
      hono: '^4.7.0',
    },
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
    },
    name: '@ontrails/hono',
    peerDependencies: {
      '@ontrails/http': 'workspace:^',
    },
    trails: {
      adapter: {
        target: 'http',
      },
    },
  });
  await mkdir(join(tempRoot, 'adapters/hono/src/__tests__'), {
    recursive: true,
  });
  await writeFile(
    join(tempRoot, 'adapters/hono/src/index.ts'),
    'export const honoAdapter = {};\n'
  );
  await writeFile(
    join(tempRoot, 'adapters/hono/src/__tests__/conformance.test.ts'),
    [
      "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';",
      '',
      "runConformance({ name: '@ontrails/hono' }, createHttpAdapterConformanceCases());",
      '',
    ].join('\n')
  );
};

const assertSearchFindsWayfinder = (search: JsonObject): void => {
  const { matches } = search;
  if (!Array.isArray(matches)) {
    throw new TypeError('wayfind search did not return matches');
  }
  const ids = matches
    .map((match) => assertObject(match, 'wayfind search match')['id'])
    .filter((id): id is string => typeof id === 'string');
  if (!ids.includes('wayfind.search')) {
    throw new Error('wayfind search did not find wayfind.search');
  }
};

const assertDiffIsEmpty = (diffResult: JsonObject): void => {
  const diff = assertObject(diffResult['diff'], 'wayfind diff');
  if (diff['hasBreaking'] !== false) {
    throw new Error(
      'wayfind diff reported breaking changes for same-root diff'
    );
  }
};

const assertTrailsFindsWayfinder = (trailsResult: JsonObject): void => {
  const { trails } = trailsResult;
  if (!Array.isArray(trails)) {
    throw new TypeError('wayfind --trails did not return trails');
  }
  const ids = trails
    .map((entry) => assertObject(entry, 'wayfind trail entry')['id'])
    .filter((id): id is string => typeof id === 'string');
  if (!ids.includes('wayfind.search')) {
    throw new Error('wayfind --trails did not find wayfind.search');
  }
};

const assertRoutePaths = (
  routes: unknown,
  label: string,
  expected: readonly string[]
): void => {
  if (!Array.isArray(routes)) {
    throw new TypeError(`${label} did not return command routes`);
  }
  const routePaths = new Set(
    routes
      .map((route) => assertObject(route, `${label} route`)['path'])
      .filter(
        (path): path is string[] =>
          Array.isArray(path) &&
          path.every((segment) => typeof segment === 'string')
      )
      .map((path) => path.join(' '))
  );
  for (const expectedPath of expected) {
    if (!routePaths.has(expectedPath)) {
      throw new Error(`${label} did not include ${expectedPath}`);
    }
  }
};

const assertSchemaForWayfind = (schema: JsonObject): void => {
  const command = assertObject(schema['command'], 'schema command');
  if (command['trailId'] !== 'wayfind.navigate') {
    throw new Error('schema did not inspect wayfind.navigate');
  }
  assertRoutePaths(command['routes'], 'schema', ['wayfind']);
};

const assertErrorsFindWayfinder = (errorsResult: JsonObject): void => {
  const { errors } = errorsResult;
  if (!Array.isArray(errors)) {
    throw new TypeError('wayfind errors did not return errors');
  }
  const searchEntry = errors
    .map((entry) => assertObject(entry, 'wayfind errors entry'))
    .find((entry) => entry['trailId'] === 'wayfind.search');
  if (searchEntry === undefined) {
    throw new Error('wayfind errors did not include wayfind.search');
  }
  const completeness = assertObject(
    searchEntry['completeness'],
    'wayfind errors completeness'
  );
  const emitted = assertObject(
    completeness['emitted'],
    'wayfind errors emitted completeness'
  );
  if (emitted['status'] !== 'unknown') {
    throw new Error('wayfind errors overclaimed emitted-error completeness');
  }
};

const assertAdapterPredicateWayfind = (wayfindResult: JsonObject): void => {
  const result = assertObject(wayfindResult['result'], 'wayfind --adapter');
  const { matches } = result;
  if (!Array.isArray(matches)) {
    throw new TypeError('wayfind --adapter did not return matches');
  }
  const includes = assertObject(wayfindResult['includes'], 'adapter includes');
  const adaptersResult = assertObject(includes['adapters'], 'include adapters');
  const { adapters } = adaptersResult;
  if (!Array.isArray(adapters)) {
    throw new TypeError('wayfind --include adapters did not return adapters');
  }
  const configuredHono = adapters
    .map((adapter) => assertObject(adapter, 'wayfind adapter fact'))
    .some(
      (adapter) =>
        adapter['kind'] === 'configured' &&
        adapter['packageName'] === '@ontrails/hono' &&
        adapter['target'] === 'http'
    );
  if (!configuredHono) {
    throw new Error('wayfind --adapter did not include Hono adapter facts');
  }
};

const assertContractForSearch = (contractResult: JsonObject): void => {
  const contract = assertObject(contractResult['contract'], 'contract');
  if (contract['id'] !== 'wayfind.search') {
    throw new Error('wayfind contract did not inspect wayfind.search');
  }
};

const unwrapWayfindResult = (value: JsonObject, label: string): JsonObject =>
  assertObject(value['result'], `${label}.result`);

const assertResolvedTarget = (value: JsonObject, label: string): void => {
  const target = assertObject(value['target'], `${label}.target`);
  if (target['id'] !== 'wayfind.search') {
    throw new Error(`${label} did not resolve wayfind.search`);
  }
};

const assertLiveSourceFindsWayfinder = (value: JsonObject): void => {
  const { matches } = value;
  if (!Array.isArray(matches)) {
    throw new TypeError('wayfind --source live did not return matches');
  }
  const found = matches
    .map((match) => assertObject(match, 'wayfind --source live match'))
    .some((match) => {
      const detail = assertObject(
        match['detail'],
        'wayfind --source live match detail'
      );
      return detail['id'] === 'wayfind.search';
    });
  if (!found) {
    throw new Error('wayfind --source live did not resolve wayfind.search');
  }
};

const assertOutlineFindsOperatorApp = (outline: JsonObject): void => {
  const features = assertObject(
    outline['features'],
    'wayfind outline features'
  );
  if (features['view'] !== 'default') {
    throw new Error('wayfind outline did not echo the default feature view');
  }
  const { apps } = outline;
  if (!Array.isArray(apps)) {
    throw new TypeError('wayfind outline did not return app facts');
  }
  const appNames = apps
    .map((entry) => assertObject(entry, 'wayfind outline app')['name'])
    .filter((name): name is string => typeof name === 'string');
  if (!appNames.includes('operatorApp')) {
    throw new Error('wayfind outline did not find the operator app export');
  }
  if (outline['file'] !== 'apps/trails/src/app.ts') {
    throw new Error('wayfind outline did not preserve the source file path');
  }
  const counts = assertObject(outline['counts'], 'wayfind outline counts');
  if (counts['apps'] !== apps.length) {
    throw new Error('wayfind outline counts diverged from app facts');
  }
};

export const runWayfinderDogfoodSmoke =
  async (): Promise<WayfinderDogfoodSmokeResult> => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'trails-wayfinder-dogfood-'));

    try {
      await writeOperatorAppWrapper(tempRoot);
      await writeAdapterWorkspace(tempRoot);
      runTrails(tempRoot, [
        'compile',
        '--module',
        './src/app.ts',
        '--permit',
        '{"id":"wayfinder-dogfood","scopes":["topo:write"]}',
      ]);

      const overview = unwrapWayfindResult(
        runWayfind(tempRoot, ['--overview']),
        'wayfind overview'
      );
      assertAlignedSource(overview, 'wayfind overview');
      const counts = assertObject(
        overview['counts'],
        'wayfind overview counts'
      );
      const trailCount = counts['trails'];
      if (typeof trailCount !== 'number' || trailCount < 1) {
        throw new Error('wayfind overview did not report trail counts');
      }

      const trails = unwrapWayfindResult(
        runWayfind(tempRoot, ['--trails', '--intent', 'read']),
        'wayfind --trails'
      );
      assertAlignedSource(trails, 'wayfind --trails');
      assertTrailsFindsWayfinder(trails);

      assertSchemaForWayfind(runSchema(['wayfind']));

      const search = unwrapWayfindResult(
        runWayfind(tempRoot, ['pattern', 'wayfind.*']),
        'wayfind pattern'
      );
      assertAlignedSource(search, 'wayfind pattern');
      assertSearchFindsWayfinder(search);

      const live = unwrapWayfindResult(
        runWayfind(tempRoot, ['wayfind.search', '--source', 'live']),
        'wayfind --source live'
      );
      assertLiveSourceFindsWayfinder(live);

      const resources = unwrapWayfindResult(
        runWayfind(tempRoot, ['--resources']),
        'wayfind --resources'
      );
      assertAlignedSource(resources, 'wayfind --resources');

      const errors = unwrapWayfindResult(
        runWayfind(tempRoot, ['--errors']),
        'wayfind --errors'
      );
      assertAlignedSource(errors, 'wayfind --errors');
      assertErrorsFindWayfinder(errors);

      const adapterFiltered = runWayfind(tempRoot, [
        '--adapter',
        '@ontrails/hono',
        '--include',
        'adapters',
      ]);
      assertAdapterPredicateWayfind(adapterFiltered);

      const contract = unwrapWayfindResult(
        runWayfind(tempRoot, ['wayfind.search', '--contract']),
        'wayfind contract'
      );
      assertAlignedSource(contract, 'wayfind contract');
      assertContractForSearch(contract);

      const nearby = unwrapWayfindResult(
        runWayfind(tempRoot, ['wayfind.search']),
        'wayfind nearby'
      );
      assertAlignedSource(nearby, 'wayfind nearby');
      assertResolvedTarget(nearby, 'wayfind nearby');

      const impact = unwrapWayfindResult(
        runWayfind(tempRoot, ['wayfind.search', '--impact']),
        'wayfind impact'
      );
      assertAlignedSource(impact, 'wayfind impact');
      assertResolvedTarget(impact, 'wayfind impact');

      const deps = unwrapWayfindResult(
        runWayfind(tempRoot, ['wayfind.search', '--deps']),
        'wayfind deps'
      );
      assertAlignedSource(deps, 'wayfind deps');
      assertResolvedTarget(deps, 'wayfind deps');

      const diff = runWayfind(tempRoot, [
        'diff',
        '--against-root-dir',
        tempRoot,
      ]);
      assertAlignedSource(diff, 'wayfind diff');
      assertDiffIsEmpty(diff);

      const outline = runCommand(
        [
          process.execPath,
          trailsBin,
          'wayfind',
          'file',
          'apps/trails/src/app.ts',
          '--root-dir',
          repoRoot,
          '--outline',
          '--json',
        ],
        'trails wayfind file'
      );
      assertOutlineFindsOperatorApp(unwrapWayfindResult(outline, 'outline'));

      return {
        check: 'wayfinder-dogfood',
        message: `Wayfinder dogfood smoke passed: ${String(trailCount)} trails inspected from saved operator topo artifacts.`,
        passed: true,
        trailCount,
      };
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  };

if (import.meta.main) {
  const result = await runWayfinderDogfoodSmoke();
  console.log(result.message);
}
