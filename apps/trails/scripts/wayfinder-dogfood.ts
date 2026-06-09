import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trailsMcpApp } from '../src/mcp-app.js';
import { exportCurrentTopo } from '../src/trails/topo-store-support.js';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const trailsBin = join(repoRoot, 'apps/trails/bin/trails.ts');

type JsonObject = Record<string, unknown>;

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

const runWayfind = (tempRoot: string, args: readonly string[]): JsonObject => {
  const command = [
    process.execPath,
    trailsBin,
    'wayfind',
    ...args,
    '--root-dir',
    tempRoot,
    '--json',
  ];
  const result = Bun.spawnSync({
    cmd: command,
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
  return parseJson(stdout, `trails ${args.join(' ')}`);
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
};

const assertResolvedTarget = (value: JsonObject, label: string): void => {
  const target = assertObject(value['target'], `${label}.target`);
  if (target['id'] !== 'wayfind.search') {
    throw new Error(`${label} did not resolve wayfind.search`);
  }
};

const main = async (): Promise<void> => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'trails-wayfinder-dogfood-'));

  try {
    const exported = await exportCurrentTopo(trailsMcpApp, {
      rootDir: tempRoot,
    });
    if (exported.isErr()) {
      throw exported.error;
    }

    const overview = runWayfind(tempRoot, ['overview']);
    assertFreshSource(overview, 'wayfind overview');
    const counts = assertObject(overview['counts'], 'wayfind overview counts');
    if (typeof counts['trails'] !== 'number' || counts['trails'] < 1) {
      throw new Error('wayfind overview did not report trail counts');
    }

    const search = runWayfind(tempRoot, [
      'search',
      '--input-json',
      '{"filters":{"kind":"trail","idPrefix":"wayfind."}}',
    ]);
    assertFreshSource(search, 'wayfind search');
    assertSearchFindsWayfinder(search);

    const errors = runWayfind(tempRoot, [
      'errors',
      '--input-json',
      '{"filters":{"kind":"trail","idPrefix":"wayfind."}}',
    ]);
    assertFreshSource(errors, 'wayfind errors');
    assertErrorsFindWayfinder(errors);

    const adapters = runWayfind(repoRoot, ['adapters']);
    assertAdaptersFindHono(adapters);

    const contract = runWayfind(tempRoot, ['contract', 'wayfind.search']);
    assertFreshSource(contract, 'wayfind contract');
    assertContractForSearch(contract);

    const nearby = runWayfind(tempRoot, ['nearby', 'wayfind.search']);
    assertFreshSource(nearby, 'wayfind nearby');
    assertResolvedTarget(nearby, 'wayfind nearby');

    const impact = runWayfind(tempRoot, ['impact', 'wayfind.search']);
    assertFreshSource(impact, 'wayfind impact');
    assertResolvedTarget(impact, 'wayfind impact');

    console.log(
      `Wayfinder dogfood smoke passed: ${String(counts['trails'])} trails inspected from saved operator topo artifacts.`
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
};

await main();
