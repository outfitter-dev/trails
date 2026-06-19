import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

const assertFreshSource = (value: JsonObject, label: string): void => {
  const freshness = assertObject(value['freshness'], `${label}.freshness`);
  if (freshness['status'] !== 'fresh') {
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

const assertAdaptersFindHono = (adaptersResult: JsonObject): void => {
  const counts = assertObject(
    adaptersResult['counts'],
    'wayfind adapters counts'
  );
  if (counts['configured'] !== 1 || counts['used'] !== 1) {
    throw new Error(
      'wayfind adapters did not report configured/used adapter facts'
    );
  }
  if (counts['observed'] !== 0) {
    throw new Error('wayfind adapters reported unsupported observed facts');
  }
  const { adapters } = adaptersResult;
  if (!Array.isArray(adapters)) {
    throw new TypeError('wayfind adapters did not return adapters');
  }
  const ids = adapters
    .map((adapter) => assertObject(adapter, 'wayfind adapters fact')['key'])
    .filter((key): key is string => typeof key === 'string');
  if (!ids.includes('@ontrails/hono:http:used')) {
    throw new Error('wayfind adapters did not find Hono conformance usage');
  }
};

const assertContractForSearch = (contractResult: JsonObject): void => {
  const contract = assertObject(contractResult['contract'], 'contract');
  if (contract['id'] !== 'wayfind.search') {
    throw new Error('wayfind contract did not inspect wayfind.search');
  }
  const cli = assertObject(contract['cli'], 'contract.cli');
  assertRoutePaths(cli['routes'], 'contract', ['wayfind search']);
};

const unwrapWayfindResult = (value: JsonObject, label: string): JsonObject =>
  assertObject(value['result'], `${label}.result`);

const assertResolvedTarget = (value: JsonObject, label: string): void => {
  const target = assertObject(value['target'], `${label}.target`);
  if (target['id'] !== 'wayfind.search') {
    throw new Error(`${label} did not resolve wayfind.search`);
  }
};

const assertOutlineFindsOperatorApp = (outline: JsonObject): void => {
  const features = assertObject(
    outline['features'],
    'wayfind outline features'
  );
  if (features['view'] !== 'all') {
    throw new Error('wayfind outline did not echo the all feature view');
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
      runTrails(tempRoot, [
        'compile',
        '--module',
        './src/app.ts',
        '--permit',
        '{"id":"wayfinder-dogfood","scopes":["topo:write"]}',
      ]);

      const overview = unwrapWayfindResult(
        runWayfind(tempRoot, ['--view', 'overview']),
        'wayfind overview'
      );
      assertFreshSource(overview, 'wayfind overview');
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
      assertFreshSource(trails, 'wayfind --trails');
      assertTrailsFindsWayfinder(trails);

      assertSchemaForWayfind(runSchema(['wayfind']));

      const search = runWayfind(tempRoot, [
        'search',
        '--input-json',
        '{"filters":{"kind":"trail","idPrefix":"wayfind."}}',
      ]);
      assertFreshSource(search, 'wayfind search');
      assertSearchFindsWayfinder(search);

      const errors = unwrapWayfindResult(
        runWayfind(tempRoot, ['--errors']),
        'wayfind --errors'
      );
      assertFreshSource(errors, 'wayfind --errors');
      assertErrorsFindWayfinder(errors);

      const adapters = unwrapWayfindResult(
        runWayfind(repoRoot, ['--adapters']),
        'wayfind --adapters'
      );
      assertAdaptersFindHono(adapters);

      const contract = unwrapWayfindResult(
        runWayfind(tempRoot, ['wayfind.search', '--view', 'contract']),
        'wayfind contract'
      );
      assertFreshSource(contract, 'wayfind contract');
      assertContractForSearch(contract);

      const nearby = unwrapWayfindResult(
        runWayfind(tempRoot, ['--around', 'wayfind.search']),
        'wayfind nearby'
      );
      assertFreshSource(nearby, 'wayfind nearby');
      assertResolvedTarget(nearby, 'wayfind nearby');

      const impact = unwrapWayfindResult(
        runWayfind(tempRoot, ['--from', 'wayfind.search', '--view', 'map']),
        'wayfind impact'
      );
      assertFreshSource(impact, 'wayfind impact');
      assertResolvedTarget(impact, 'wayfind impact');

      const outline = runCommand(
        [
          process.execPath,
          trailsBin,
          'wayfind',
          'outline',
          'apps/trails/src/app.ts',
          '--root-dir',
          repoRoot,
          '--all',
          '--json',
        ],
        'trails wayfind outline'
      );
      assertOutlineFindsOperatorApp(outline);

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
