import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import {
  ConflictError,
  Result,
  createTrailContext,
  resource,
  signal,
  topo,
  trail,
} from '@ontrails/core';
import {
  deriveTopoGraph,
  deriveTopoGraphHash,
  createTopoSnapshot,
  writeLockManifest,
  writeTopoGraph,
} from '@ontrails/topographer';
import type {
  LockManifest,
  TopoGraph,
  TopoGraphEntry,
} from '@ontrails/topographer';

import {
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindDescribeTrail,
  wayfindDiffTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOverviewTrail,
  wayfindOutlineTrail,
  wayfindSearchTrail,
  wayfindSurfacesTrail,
  wayfindTrailsTrail,
  wayfindVersionsTrail,
  wayfinderTopo,
  resolveWayfinderPopulation,
  resolveWayfinderRelations,
} from '../index.js';

let tempDir: string;

const db = resource('db.main', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const userCreated = signal('user.created', {
  payload: z.object({ id: z.string() }),
});

const userShow = trail('user.show', {
  blaze: () => Result.ok({ id: 'u1' }),
  examples: [{ expected: { id: 'u1' }, input: {}, name: 'Basic' }],
  input: z.object({}),
  intent: 'read',
  output: z.object({ id: z.string() }),
  resources: [db],
});

const userCreate = trail('user.create', {
  blaze: () => Result.ok({ id: 'u1' }),
  cli: {
    aliases: ['add'],
  },
  fires: [userCreated],
  input: z.object({ name: z.string() }),
  intent: 'write',
  output: z.object({ id: z.string() }),
  resources: [db],
});

const auditRebuild = trail('audit.rebuild', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'destroy',
  on: [userCreated],
  output: z.object({ ok: z.boolean() }),
});

const inviteCreate = trail('invite.create', {
  blaze: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
  examples: [
    {
      expected: { greeting: 'Hello, Ada!' },
      input: { name: 'Ada' },
      name: 'Current greeting',
    },
  ],
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  version: 2,
  versions: {
    1: {
      blaze: (input) => Result.ok({ greeting: `Hi, ${input.name}.` }),
      examples: [
        {
          expected: { greeting: 'Hi, Ada.' },
          input: { name: 'Ada' },
          name: 'Legacy greeting',
        },
      ],
      input: z.object({ name: z.string() }),
      output: z.object({ greeting: z.string() }),
      resources: [db],
      status: { state: 'deprecated', successor: 2 },
    },
  },
});

const app = () =>
  topo('demo', {
    auditRebuild,
    db,
    inviteCreate,
    userCreate,
    userCreated,
    userShow,
  });

const withSurfaces = (topoGraph: TopoGraph): TopoGraph => ({
  ...topoGraph,
  entries: topoGraph.entries.map((entry): TopoGraphEntry => {
    if (entry.id === 'user.show') {
      return { ...entry, surfaces: ['mcp'] };
    }
    if (entry.id === 'user.create') {
      return { ...entry, surfaces: ['cli'] };
    }
    return entry;
  }),
  generatedAt: '2026-06-04T00:00:00.000Z',
});

const artifactsDir = () => join(tempDir, '.trails');

const artifactsDirFor = (rootDir: string) => join(rootDir, '.trails');

const countEntries = (
  topoGraph: TopoGraph,
  kind: TopoGraphEntry['kind']
): number => topoGraph.entries.filter((entry) => entry.kind === kind).length;

const lockManifestFor = (topoGraph: TopoGraph): LockManifest => ({
  artifacts: [
    {
      path: 'topo.lock',
      role: 'topo',
      sha256: deriveTopoGraphHash(topoGraph),
    },
  ],
  scope: { app: 'demo' },
  summary: {
    contours: countEntries(topoGraph, 'contour'),
    resources: countEntries(topoGraph, 'resource'),
    signals: countEntries(topoGraph, 'signal'),
    trails: countEntries(topoGraph, 'trail'),
  },
  version: 3,
});

const writeArtifactsAt = async (
  rootDir: string,
  transform?: (topoGraph: TopoGraph) => TopoGraph
): Promise<TopoGraph> => {
  const baseTopoGraph = withSurfaces(
    deriveTopoGraph(app(), {
      cliAliases: {
        'user.create': [['u', 'create']],
      },
      facets: [
        {
          description: 'User operations.',
          id: 'users',
          surfaces: ['mcp'],
          trails: 'user.*',
        },
      ],
    })
  );
  const topoGraph = transform?.(baseTopoGraph) ?? baseTopoGraph;
  await writeTopoGraph(topoGraph, { dir: artifactsDirFor(rootDir) });
  await writeLockManifest(lockManifestFor(topoGraph), {
    dir: artifactsDirFor(rootDir),
  });
  return topoGraph;
};

const writeArtifacts = async (
  transform?: (topoGraph: TopoGraph) => TopoGraph
): Promise<TopoGraph> => writeArtifactsAt(tempDir, transform);

const writePlainArtifactsAt = async (rootDir: string) => {
  const graph = app();
  const topoGraph = deriveTopoGraph(graph);
  await writeTopoGraph(topoGraph, { dir: artifactsDirFor(rootDir) });
  await writeLockManifest(lockManifestFor(topoGraph), {
    dir: artifactsDirFor(rootDir),
  });
  return graph;
};

const writeFile = async (
  rootDir: string,
  path: string,
  value: string
): Promise<void> => {
  const filePath = join(rootDir, path);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, value);
};

const writeJson = async (
  rootDir: string,
  path: string,
  value: Readonly<Record<string, unknown>>
): Promise<void> =>
  writeFile(rootDir, path, `${JSON.stringify(value, null, 2)}\n`);

const writeAdapterWorkspace = async (rootDir: string): Promise<void> => {
  await writeJson(rootDir, 'package.json', {
    name: 'fixture-root',
    workspaces: ['packages/*', 'adapters/*'],
  });
  await writeJson(rootDir, 'packages/http/package.json', {
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
      './testing': './src/testing.ts',
    },
    name: '@demo/http',
    trails: {
      adapterTargets: {
        http: {
          conformance: {
            adapterType: 'HttpAdapterConformanceAdapter',
            casesFactory: 'createHttpAdapterConformanceCases',
            runner: 'runConformance',
          },
          placements: ['extracted'],
          testingImport: '@demo/http/testing',
        },
      },
    },
  });
  await writeFile(
    rootDir,
    'packages/http/src/index.ts',
    'export const http = {};\n'
  );
  await writeFile(
    rootDir,
    'packages/http/src/testing.ts',
    [
      'export interface HttpAdapterConformanceAdapter {}',
      'export const createHttpAdapterConformanceCases = () => [];',
      'export const runConformance = () => undefined;',
      '',
    ].join('\n')
  );
  await writeJson(rootDir, 'adapters/hono/package.json', {
    dependencies: {
      '@ontrails/core': 'workspace:^',
      hono: '^4.7.0',
    },
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
    },
    name: '@demo/hono',
    peerDependencies: {
      '@demo/http': 'workspace:^',
    },
    trails: {
      adapter: {
        target: 'http',
      },
    },
  });
  await writeFile(
    rootDir,
    'adapters/hono/src/index.ts',
    'export const honoAdapter = {};\n'
  );
  await writeFile(
    rootDir,
    'adapters/hono/src/__tests__/conformance.test.ts',
    "import { createHttpAdapterConformanceCases, runConformance } from '@demo/http/testing';\n\nrunConformance({ name: '@demo/hono' }, createHttpAdapterConformanceCases());\n"
  );
};

const seedTopoStoreAt = (rootDir: string, graph = app()) => {
  const snapshot = createTopoSnapshot(graph, {
    createdAt: '2026-06-04T00:00:00.000Z',
    gitSha: 'abc123',
    rootDir,
  });
  if (snapshot.isErr()) {
    throw snapshot.error;
  }
  return snapshot.value;
};

const ctx = () => createTrailContext({ cwd: tempDir, workspaceRoot: tempDir });

const expectOk = async <TValue>(
  result: Promise<Result<TValue, unknown>>
): Promise<TValue> => {
  const awaited = await result;
  expect(awaited.isOk()).toBe(true);
  if (awaited.isErr()) {
    throw awaited.error;
  }
  return awaited.value;
};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'wayfinder-queries-test-'));
  await writeArtifacts();
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

describe('wayfinder graph-read query trails', () => {
  test('exports the v0 query catalog as a topo', () => {
    expect([...wayfinderTopo.ids()].toSorted()).toEqual([
      'wayfind.adapters',
      'wayfind.contours',
      'wayfind.contract',
      'wayfind.describe',
      'wayfind.diff',
      'wayfind.errors',
      'wayfind.examples',
      'wayfind.facets',
      'wayfind.impact',
      'wayfind.nearby',
      'wayfind.outline',
      'wayfind.overview',
      'wayfind.resources',
      'wayfind.search',
      'wayfind.signals',
      'wayfind.surfaces',
      'wayfind.trails',
      'wayfind.versions',
    ]);
  });

  test('outlines a source file and reconciles trail ids to saved graph facts', async () => {
    await writeFile(
      tempDir,
      'src/app.ts',
      [
        "import { Result, topo, trail } from '@ontrails/core';",
        "export const userCreateTrail = trail('user.create', {",
        '  blaze: () => Result.ok({ id: "u1" }),',
        '  input: z.object({ name: z.string() }),',
        '  output: z.object({ id: z.string() }),',
        '});',
        'export const app = topo("demo", { userCreateTrail });',
        '',
      ].join('\n')
    );

    const result = await expectOk(
      wayfindOutlineTrail.blaze({ file: 'src/app.ts' }, ctx())
    );

    expect(result.features).toMatchObject({
      included: ['trails', 'apps', 'surfaces', 'graph', 'diagnostics'],
      view: 'default',
    });
    expect(result.file).toBe('src/app.ts');
    expect(result.trails).toEqual([
      expect.objectContaining({
        graph: expect.objectContaining({
          exampleCount: 0,
          intent: 'write',
          surfaces: ['cli'],
        }),
        id: 'user.create',
      }),
    ]);
    expect(result.apps).toEqual([
      expect.objectContaining({ callee: 'topo', name: 'app' }),
    ]);
    expect(result.graph?.matchedTrailIds).toEqual(['user.create']);
    expect(result.surfaces).toEqual(['cli']);
    expect(result.counts).toMatchObject({
      apps: 1,
      declarations: 2,
      diagnostics: result.diagnostics?.length ?? 0,
      graphMatches: 1,
      trails: 1,
    });
    expect(result).not.toHaveProperty('summary');
  });

  test('outlines graph surfaces without requiring graph feature output', async () => {
    await writeFile(
      tempDir,
      'src/app.ts',
      [
        "import { Result, topo, trail } from '@ontrails/core';",
        "export const userCreateTrail = trail('user.create', {",
        '  blaze: () => Result.ok({ id: "u1" }),',
        '});',
        'export const app = topo("demo", { userCreateTrail });',
        '',
      ].join('\n')
    );

    const result = await expectOk(
      wayfindOutlineTrail.blaze(
        { features: 'surfaces', file: 'src/app.ts' },
        ctx()
      )
    );

    expect(result.features.included).toEqual(['surfaces']);
    expect(result.surfaces).toEqual(['cli']);
    expect(result.trails).toBeUndefined();
    expect(result.graph).toBeUndefined();
  });

  test('outlines source-only facts when graph artifacts are unavailable', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'wayfinder-outline-test-'));
    try {
      await writeFile(
        sourceRoot,
        'src/source.ts',
        [
          "import { Result, trail } from '@ontrails/core';",
          "import { sourceName as localName } from './dependency';",
          "export function helper() { return 'ok'; }",
          "export const localTrail = trail('local.read', {",
          '  blaze: () => Result.ok({ ok: true }),',
          '  input: z.object({}),',
          '});',
          '',
        ].join('\n')
      );

      const result = await expectOk(
        wayfindOutlineTrail.blaze(
          { file: 'src/source.ts', rootDir: sourceRoot, source: true },
          ctx()
        )
      );

      expect(result.features.view).toBe('source');
      expect(result.source?.declarations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'function', name: 'helper' }),
          expect.objectContaining({ kind: 'const', name: 'localTrail' }),
        ])
      );
      expect(result.source?.imports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            names: ['localName'],
            source: './dependency',
          }),
        ])
      );
      expect(result.trails).toBeUndefined();
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'graph.missing',
          message: expect.stringContaining('--module <app-module>'),
          severity: 'warn',
        }),
      ]);
      expect(result.diagnostics?.[0]?.message).toContain(
        '--root-dir <workspace-root>'
      );
      expect(result.diagnostics?.[0]?.message).toContain('--permit');
      expect(result.diagnostics?.[0]?.message).toContain(
        '"scopes":["topo:write"]'
      );
      expect(result.diagnostics?.[0]?.message).toContain('topo:write');
    } finally {
      await rm(sourceRoot, { force: true, recursive: true });
    }
  });

  test('lists adapter facts from workspace package evidence', async () => {
    await writeAdapterWorkspace(tempDir);

    const result = await expectOk(
      wayfindAdaptersTrail.blaze({ rootDir: tempDir }, ctx())
    );

    expect(result.counts).toEqual({
      available: 1,
      configured: 1,
      diagnostics: 0,
      observed: 0,
      used: 1,
    });
    expect(result.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: '@demo/http:http:available',
          kind: 'available',
          ownerPackage: '@demo/http',
          target: 'http',
          targetKey: '@demo/http:http',
        }),
        expect.objectContaining({
          key: '@demo/hono:http:configured',
          kind: 'configured',
          packageName: '@demo/hono',
          target: 'http',
          targetKey: '@demo/http:http',
        }),
        expect.objectContaining({
          key: '@demo/hono:http:used',
          kind: 'used',
          packageName: '@demo/hono',
          provenance: expect.objectContaining({
            paths: [
              expect.stringContaining(
                'adapters/hono/src/__tests__/conformance.test.ts'
              ),
            ],
            source: 'conformance-test',
          }),
          target: 'http',
          targetKey: '@demo/http:http',
        }),
      ])
    );
    expect(
      result.adapters.filter((entry) => entry.kind === 'configured')
    ).toHaveLength(1);
    const configured = await expectOk(
      wayfindAdaptersTrail.blaze(
        { filters: { kind: 'configured' }, rootDir: tempDir },
        ctx()
      )
    );
    expect(configured.adapters.map((entry) => entry.kind)).toEqual([
      'configured',
    ]);
  });

  test('summarizes saved graph shape and provenance', async () => {
    const overview = await expectOk(
      wayfindOverviewTrail.blaze({ rootDir: tempDir }, ctx())
    );

    expect(overview.source.kind).toBe('topoGraph');
    expect(overview.generatedAt).toBe('2026-06-04T00:00:00.000Z');
    expect(overview.counts).toMatchObject({
      examples: 3,
      facets: 1,
      resources: 1,
      signals: 1,
      surfaces: 2,
      trails: 4,
      versions: 2,
    });
  });

  test('returns schema drift errors instead of missing-artifact errors', async () => {
    await Bun.write(
      join(artifactsDir(), 'topo.lock'),
      `${JSON.stringify({
        activationGraph: {
          edgeCount: 0,
          edges: [],
          sourceCount: 0,
          sourceKeys: [],
          trailIds: [],
        },
        activationSources: {},
        entries: [],
        generatedAt: '2026-06-04T00:00:00.000Z',
        topoGraphSchemaVersion: -1,
      })}\n`
    );

    const result = await wayfindOverviewTrail.blaze(
      { rootDir: tempDir },
      ctx()
    );

    expect(result.isErr()).toBe(true);
    expect(result.isErr() ? result.error.name : '').toBe('DerivationError');
    expect(result.isErr() ? result.error.context : {}).toMatchObject({
      artifact: 'topoGraph',
      freshnessStatus: 'schema-version-drift',
    });
  });

  test('returns derivation errors for invalid artifact paths', async () => {
    const invalidDir = join(tempDir, 'not-a-directory');
    await Bun.write(invalidDir, 'plain file');

    const result = await wayfindOverviewTrail.blaze({ dir: invalidDir }, ctx());

    expect(result.isErr()).toBe(true);
    expect(result.isErr() ? result.error.name : '').toBe('DerivationError');
    expect(result.isErr() ? result.error.context : {}).toMatchObject({
      artifact: 'topoGraph',
      path: join(invalidDir, 'topo.lock'),
    });
  });

  test('keeps explicit artifact directories isolated from context cwd', async () => {
    const artifactRoot = join(tempDir, 'artifact-root');
    const cwdRoot = join(tempDir, 'cwd-root');
    await mkdir(artifactRoot, { recursive: true });
    await mkdir(cwdRoot, { recursive: true });
    seedTopoStoreAt(artifactRoot, await writePlainArtifactsAt(artifactRoot));

    const overview = await expectOk(
      wayfindOverviewTrail.blaze(
        { dir: artifactsDirFor(artifactRoot) },
        createTrailContext({ cwd: cwdRoot, workspaceRoot: cwdRoot })
      )
    );

    expect(overview.freshness).toEqual({ status: 'fresh' });
  });

  test('finds entities with typed filters', async () => {
    const search = await expectOk(
      wayfindSearchTrail.blaze(
        {
          filters: { kind: 'trail', surface: 'mcp' },
          limit: 100,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(search.matches.map((match) => match.id)).toEqual([
      'user.create',
      'user.show',
    ]);
  });

  test('resolves filtered populations through the navigation planner', async () => {
    const topoGraph = await writeArtifacts();

    const matches = resolveWayfinderPopulation(topoGraph, {
      filters: { surface: 'mcp' },
      kind: 'trail',
      limit: 100,
    });

    expect(matches.map((match) => match.id)).toEqual([
      'user.create',
      'user.show',
    ]);
  });

  test('finds current and historical versions with typed filters', async () => {
    const search = await expectOk(
      wayfindSearchTrail.blaze(
        {
          filters: { kind: 'version' },
          limit: 100,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(search.matches.map((match) => match.id)).toEqual([
      'invite.create@1',
      'invite.create@2',
    ]);
  });

  test('lists trail and surface summaries', async () => {
    const trails = await expectOk(
      wayfindTrailsTrail.blaze(
        { filters: { usesResource: 'db.main' }, limit: 100, rootDir: tempDir },
        ctx()
      )
    );
    const surfaces = await expectOk(
      wayfindSurfacesTrail.blaze(
        { filters: {}, limit: 100, rootDir: tempDir },
        ctx()
      )
    );

    expect(trails.trails.map((entry) => entry.id)).toEqual([
      'user.create',
      'user.show',
    ]);
    expect(trails.trails[0]?.cli).toMatchObject({
      path: ['user', 'create'],
      routes: [
        {
          kind: 'canonical',
          path: ['user', 'create'],
          source: 'derived',
          target: 'user.create',
        },
        {
          kind: 'alias',
          path: ['user', 'add'],
          source: 'trail',
          target: 'user.create',
        },
        {
          kind: 'alias',
          path: ['u', 'create'],
          source: 'surface',
          target: 'user.create',
        },
      ],
    });
    expect(surfaces.surfaces).toEqual([
      { facets: [], id: 'cli', trails: ['user.create'] },
      { facets: ['users'], id: 'mcp', trails: ['user.create', 'user.show'] },
    ]);
  });

  test('lists version and example records without executing trails', async () => {
    const versions = await expectOk(
      wayfindVersionsTrail.blaze(
        { filters: {}, limit: 100, rootDir: tempDir },
        ctx()
      )
    );
    const examples = await expectOk(
      wayfindExamplesTrail.blaze(
        { filters: {}, limit: 100, rootDir: tempDir },
        ctx()
      )
    );

    expect(versions.versions.map((version) => version.id)).toEqual([
      'invite.create@1',
      'invite.create@2',
    ]);
    expect(examples.examples.map((example) => example.targetId)).toEqual([
      'invite.create',
      'invite.create@1',
      'user.show',
    ]);
  });

  test('lists trail error facts without claiming exhaustive emitted errors', async () => {
    await writeArtifacts((topoGraph) => ({
      ...topoGraph,
      entries: topoGraph.entries.map((entry) =>
        entry.id === 'user.show'
          ? {
              ...entry,
              detours: [{ maxAttempts: 1, on: ConflictError.name }],
              examples: [
                ...(entry.examples ?? []),
                {
                  error: 'NotFoundError',
                  input: { id: 'missing' },
                  kind: 'error' as const,
                  name: 'Missing user',
                  provenance: { source: 'trail.examples' as const },
                },
              ],
            }
          : entry
      ),
    }));

    const errors = await expectOk(
      wayfindErrorsTrail.blaze(
        {
          filters: { id: 'user.show', kind: 'trail' },
          limit: 100,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(errors.errors).toHaveLength(1);
    expect(errors.errors[0]).toMatchObject({
      completeness: {
        emitted: {
          reason: 'no-exhaustive-emitted-error-contract',
          status: 'unknown',
        },
      },
      trailId: 'user.show',
    });
    expect(errors.errors[0]?.facts.map((fact) => fact.kind)).toEqual([
      'documented',
      'handled',
    ]);
    expect(errors.errors[0]?.facts.map((fact) => fact.taxonomy.name)).toEqual([
      'NotFoundError',
      'ConflictError',
    ]);
  });

  test('sorts version records by numeric version', async () => {
    await writeArtifacts((topoGraph) => ({
      ...topoGraph,
      entries: topoGraph.entries.map((entry) =>
        entry.id === 'invite.create'
          ? {
              ...entry,
              versions: {
                ...entry.versions,
                10: {
                  exampleCount: 0,
                  input: entry.input,
                  kind: 'revision',
                  marker: entry.marker,
                  output: entry.output,
                  status: { state: 'deprecated', successor: 2 },
                },
              },
            }
          : entry
      ),
    }));

    const versions = await expectOk(
      wayfindVersionsTrail.blaze(
        { filters: {}, limit: 100, rootDir: tempDir },
        ctx()
      )
    );

    expect(versions.versions.map((version) => version.id)).toEqual([
      'invite.create@1',
      'invite.create@2',
      'invite.create@10',
    ]);
  });

  test('filters examples through parent trails and exact versions', async () => {
    const byTrail = await expectOk(
      wayfindExamplesTrail.blaze(
        {
          filters: { id: 'invite.create', kind: 'trail' },
          limit: 100,
          rootDir: tempDir,
        },
        ctx()
      )
    );
    const byVersion = await expectOk(
      wayfindExamplesTrail.blaze(
        {
          filters: { id: 'invite.create@1', kind: 'version' },
          limit: 100,
          rootDir: tempDir,
        },
        ctx()
      )
    );
    const byCurrentVersion = await expectOk(
      wayfindExamplesTrail.blaze(
        {
          filters: { id: 'invite.create@2', kind: 'version' },
          limit: 100,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(byTrail.examples.map((example) => example.targetId)).toEqual([
      'invite.create',
      'invite.create@1',
    ]);
    expect(byVersion.examples.map((example) => example.targetId)).toEqual([
      'invite.create@1',
    ]);
    expect(
      byCurrentVersion.examples.map((example) => example.targetId)
    ).toEqual(['invite.create']);
  });

  test('does not widen examples through explicit non-trail kind filters', async () => {
    await writeArtifacts((topoGraph) => ({
      ...topoGraph,
      entries: topoGraph.entries.map((entry) =>
        entry.id === 'invite.create'
          ? { ...entry, resources: ['db.main'] }
          : entry
      ),
    }));

    const byResource = await expectOk(
      wayfindExamplesTrail.blaze(
        {
          filters: { kind: 'resource', usesResource: 'db.main' },
          limit: 100,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(byResource.examples).toEqual([]);
  });

  test('does not widen historical examples through exampleCoverage false', async () => {
    await writeArtifacts((topoGraph) => ({
      ...topoGraph,
      entries: topoGraph.entries.map((entry) =>
        entry.id === 'invite.create'
          ? {
              ...entry,
              exampleCount: 0,
              examples: [],
            }
          : entry
      ),
    }));

    const uncoveredTrail = await expectOk(
      wayfindExamplesTrail.blaze(
        {
          filters: {
            exampleCoverage: false,
            id: 'invite.create',
            kind: 'trail',
          },
          limit: 100,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(uncoveredTrail.examples).toEqual([]);
  });

  test('preserves trail ids containing @ when widening historical examples', async () => {
    await writeArtifacts((topoGraph) => ({
      ...topoGraph,
      entries: topoGraph.entries.map((entry) =>
        entry.id === 'invite.create'
          ? { ...entry, id: 'version.runtime.literal@alpha' }
          : entry
      ),
    }));

    const byTrail = await expectOk(
      wayfindExamplesTrail.blaze(
        {
          filters: { id: 'version.runtime.literal@alpha', kind: 'trail' },
          limit: 100,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(byTrail.examples.map((example) => example.targetId)).toEqual([
      'version.runtime.literal@alpha',
      'version.runtime.literal@alpha@1',
    ]);
  });

  test('does not widen current examples through non-version id collisions', async () => {
    await writeArtifacts((topoGraph) => ({
      ...topoGraph,
      entries: topoGraph.entries.map((entry) =>
        entry.id === 'db.main' ? { ...entry, id: 'invite.create@2' } : entry
      ),
    }));

    const byResource = await expectOk(
      wayfindExamplesTrail.blaze(
        {
          filters: { id: 'invite.create@2', kind: 'resource' },
          limit: 100,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(byResource.examples).toEqual([]);
  });

  test('describes entities and returns explicit not found results', async () => {
    const described = await expectOk(
      wayfindDescribeTrail.blaze(
        { id: 'users', kind: 'facet', rootDir: tempDir },
        ctx()
      )
    );
    const missing = await wayfindDescribeTrail.blaze(
      { id: 'missing.trail', kind: 'trail', rootDir: tempDir },
      ctx()
    );

    expect(described.entity).toMatchObject({
      id: 'users',
      kind: 'facet',
      memberIds: ['user.create', 'user.show'],
    });
    expect(missing.isErr()).toBe(true);
    expect(missing.isErr() ? missing.error.name : '').toBe('NotFoundError');
  });

  test('describes non-entry entities by id when the kind is omitted', async () => {
    const facet = await expectOk(
      wayfindDescribeTrail.blaze({ id: 'users', rootDir: tempDir }, ctx())
    );
    const surface = await expectOk(
      wayfindDescribeTrail.blaze({ id: 'cli', rootDir: tempDir }, ctx())
    );
    const version = await expectOk(
      wayfindDescribeTrail.blaze(
        { id: 'invite.create@1', rootDir: tempDir },
        ctx()
      )
    );

    expect(facet.entity).toMatchObject({ id: 'users', kind: 'facet' });
    expect(surface.entity).toMatchObject({ id: 'cli', kind: 'surface' });
    expect(version.entity).toMatchObject({
      id: 'invite.create@1',
      kind: 'version',
    });
  });

  test('returns ambiguous errors when id-only lookup matches multiple kinds', async () => {
    await writeArtifacts((topoGraph) => ({
      ...topoGraph,
      entries: topoGraph.entries.map((entry) =>
        entry.id === 'user.show'
          ? { ...entry, surfaces: [...entry.surfaces, 'user.show'] }
          : entry
      ),
    }));

    const described = await wayfindDescribeTrail.blaze(
      { id: 'user.show', rootDir: tempDir },
      ctx()
    );
    const contract = await wayfindContractTrail.blaze(
      { id: 'user.show', rootDir: tempDir },
      ctx()
    );

    expect(described.isErr()).toBe(true);
    expect(described.isErr() ? described.error.name : '').toBe(
      'AmbiguousError'
    );
    expect(contract.isErr()).toBe(true);
    expect(contract.isErr() ? contract.error.name : '').toBe('AmbiguousError');
  });

  test('returns contract details for current and historical trail versions', async () => {
    const current = await expectOk(
      wayfindContractTrail.blaze({ id: 'user.create', rootDir: tempDir }, ctx())
    );
    const historical = await expectOk(
      wayfindContractTrail.blaze(
        { id: 'invite.create', kind: 'version', rootDir: tempDir, version: 1 },
        ctx()
      )
    );

    expect(current.contract).toMatchObject({
      cli: {
        path: ['user', 'create'],
        routes: [
          {
            kind: 'canonical',
            path: ['user', 'create'],
            source: 'derived',
            target: 'user.create',
          },
          {
            kind: 'alias',
            path: ['user', 'add'],
            source: 'trail',
            target: 'user.create',
          },
          {
            kind: 'alias',
            path: ['u', 'create'],
            source: 'surface',
            target: 'user.create',
          },
        ],
      },
      id: 'user.create',
      kind: 'trail',
      resources: ['db.main'],
    });
    expect(historical.contract).toMatchObject({
      id: 'invite.create',
      kind: 'version',
      resources: ['db.main'],
      version: 1,
    });
  });

  test('returns contract details for non-entry entities by id when the kind is omitted', async () => {
    const surface = await expectOk(
      wayfindContractTrail.blaze({ id: 'cli', rootDir: tempDir }, ctx())
    );
    const version = await expectOk(
      wayfindContractTrail.blaze(
        { id: 'invite.create@1', rootDir: tempDir },
        ctx()
      )
    );

    expect(surface.contract).toMatchObject({ id: 'cli', kind: 'surface' });
    expect(version.contract).toMatchObject({
      id: 'invite.create',
      kind: 'version',
      version: 1,
    });
  });

  test('contract lookup honors explicit surface kind when IDs collide', async () => {
    await writeArtifacts((topoGraph) => ({
      ...topoGraph,
      entries: topoGraph.entries.map((entry) =>
        entry.id === 'user.show'
          ? { ...entry, surfaces: [...entry.surfaces, 'user.show'] }
          : entry
      ),
    }));

    const surface = await expectOk(
      wayfindContractTrail.blaze(
        { id: 'user.show', kind: 'surface', rootDir: tempDir },
        ctx()
      )
    );

    expect(surface.contract).toMatchObject({
      id: 'user.show',
      kind: 'surface',
      trails: ['user.show'],
    });
  });

  test('returns direct nearby graph relationships around an entity', async () => {
    const nearby = await expectOk(
      wayfindNearbyTrail.blaze(
        { id: 'user.create', kind: 'trail', rootDir: tempDir },
        ctx()
      )
    );

    expect(nearby.target).toEqual({ id: 'user.create', kind: 'trail' });
    expect(
      nearby.relations.map((relation) => ({
        direction: relation.direction,
        ids: relation.refs.map((ref) => ref.id),
        relation: relation.relation,
      }))
    ).toEqual([
      {
        direction: 'incoming',
        ids: ['users'],
        relation: 'facet-groups',
      },
      {
        direction: 'incoming',
        ids: ['user.created'],
        relation: 'fired-by',
      },
      {
        direction: 'incoming',
        ids: ['cli', 'mcp'],
        relation: 'surface-projects',
      },
      {
        direction: 'incoming',
        ids: ['db.main'],
        relation: 'used-by',
      },
    ]);
  });

  test('includes facet-projected trails in surface graph relationships', async () => {
    const nearby = await expectOk(
      wayfindNearbyTrail.blaze(
        { id: 'mcp', kind: 'surface', rootDir: tempDir },
        ctx()
      )
    );

    expect(
      nearby.relations.map((relation) => ({
        direction: relation.direction,
        ids: relation.refs.map((ref) => ref.id),
        relation: relation.relation,
      }))
    ).toEqual([
      {
        direction: 'outgoing',
        ids: ['user.create', 'user.show'],
        relation: 'surface-projects',
      },
    ]);
  });

  test('traverses directional impact from a graph entity', async () => {
    const impact = await expectOk(
      wayfindImpactTrail.blaze(
        {
          id: 'db.main',
          kind: 'resource',
          limit: 100,
          maxDepth: 2,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(impact.direction).toBe('downstream');
    expect(impact.nodes.map((node) => [node.id, node.depth, node.via])).toEqual(
      [
        ['user.create', 1, 'used-by'],
        ['user.show', 1, 'used-by'],
      ]
    );
  });

  test('resolves relation populations through from to around planners', async () => {
    const topoGraph = await writeArtifacts();

    const inbound = resolveWayfinderRelations(topoGraph, {
      id: 'user.create',
      kind: 'trail',
      limit: 100,
      maxDepth: 1,
      resolver: 'to',
    });
    const vicinity = resolveWayfinderRelations(topoGraph, {
      id: 'user.create',
      kind: 'trail',
      limit: 100,
      maxDepth: 1,
      resolver: 'around',
      view: 'groups',
    });

    expect(inbound.isOk()).toBe(true);
    expect(
      inbound.isOk() ? inbound.value.nodes.map((node) => node.id) : []
    ).toEqual(['users', 'db.main', 'user.created', 'cli', 'mcp']);
    expect(vicinity.isOk()).toBe(true);
    expect(
      vicinity.isOk()
        ? vicinity.value.groups.map((group) => [
            group.direction,
            group.relation,
            group.refs.map((ref) => ref.id),
          ])
        : []
    ).toEqual([
      ['incoming', 'facet-groups', ['users']],
      ['incoming', 'fired-by', ['user.created']],
      ['incoming', 'surface-projects', ['cli', 'mcp']],
      ['incoming', 'used-by', ['db.main']],
    ]);
  });

  test('traverses upstream and both-direction impact', async () => {
    const upstream = await expectOk(
      wayfindImpactTrail.blaze(
        {
          direction: 'upstream',
          id: 'invite.create@1',
          kind: 'version',
          limit: 100,
          maxDepth: 2,
          rootDir: tempDir,
        },
        ctx()
      )
    );
    const both = await expectOk(
      wayfindImpactTrail.blaze(
        {
          direction: 'both',
          id: 'user.create',
          kind: 'trail',
          limit: 100,
          maxDepth: 1,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(
      upstream.nodes.map((node) => [node.id, node.depth, node.via])
    ).toEqual([['invite.create', 1, 'has-version']]);
    expect(both.nodes.map((node) => [node.id, node.depth, node.via])).toEqual([
      ['users', 1, 'facet-groups'],
      ['db.main', 1, 'used-by'],
      ['user.created', 1, 'fired-by'],
      ['cli', 1, 'surface-projects'],
      ['mcp', 1, 'surface-projects'],
    ]);
  });

  test('applies impact depth and limit boundaries', async () => {
    const limited = await expectOk(
      wayfindImpactTrail.blaze(
        {
          id: 'invite.create',
          kind: 'trail',
          limit: 1,
          maxDepth: 2,
          rootDir: tempDir,
        },
        ctx()
      )
    );
    const depthOne = await expectOk(
      wayfindImpactTrail.blaze(
        {
          id: 'invite.create',
          kind: 'trail',
          limit: 100,
          maxDepth: 1,
          rootDir: tempDir,
        },
        ctx()
      )
    );

    expect(limited.nodes.map((node) => node.id)).toEqual(['invite.create@1']);
    expect(depthOne.nodes.map((node) => node.id)).toEqual([
      'invite.create@1',
      'invite.create@2',
    ]);
    expect(depthOne.nodes.every((node) => node.depth === 1)).toBe(true);
  });

  test('nearby and impact return explicit ambiguity and not-found errors', async () => {
    await writeArtifacts((topoGraph) => ({
      ...topoGraph,
      entries: topoGraph.entries.map((entry) =>
        entry.id === 'user.show'
          ? { ...entry, surfaces: [...entry.surfaces, 'user.show'] }
          : entry
      ),
    }));

    const ambiguousNearby = await wayfindNearbyTrail.blaze(
      { id: 'user.show', rootDir: tempDir },
      ctx()
    );
    const missingNearby = await wayfindNearbyTrail.blaze(
      { id: 'missing.trail', kind: 'trail', rootDir: tempDir },
      ctx()
    );
    const ambiguousImpact = await wayfindImpactTrail.blaze(
      { id: 'user.show', rootDir: tempDir },
      ctx()
    );
    const missingImpact = await wayfindImpactTrail.blaze(
      { id: 'missing.trail', kind: 'trail', rootDir: tempDir },
      ctx()
    );

    expect(ambiguousNearby.isErr()).toBe(true);
    expect(ambiguousNearby.isErr() ? ambiguousNearby.error.name : '').toBe(
      'AmbiguousError'
    );
    expect(missingNearby.isErr()).toBe(true);
    expect(missingNearby.isErr() ? missingNearby.error.name : '').toBe(
      'NotFoundError'
    );
    expect(ambiguousImpact.isErr()).toBe(true);
    expect(ambiguousImpact.isErr() ? ambiguousImpact.error.name : '').toBe(
      'AmbiguousError'
    );
    expect(missingImpact.isErr()).toBe(true);
    expect(missingImpact.isErr() ? missingImpact.error.name : '').toBe(
      'NotFoundError'
    );
  });

  test('diffs the current graph against a baseline artifact snapshot', async () => {
    const baselineRoot = join(tempDir, 'baseline');
    await mkdir(baselineRoot, { recursive: true });
    await writeArtifactsAt(baselineRoot, (topoGraph) => ({
      ...topoGraph,
      entries: topoGraph.entries.filter((entry) => entry.id !== 'user.create'),
      facets: topoGraph.facets?.map((facet) =>
        facet.id === 'users'
          ? {
              ...facet,
              memberIds: facet.memberIds.filter((id) => id !== 'user.create'),
            }
          : facet
      ),
    }));

    const diff = await expectOk(
      wayfindDiffTrail.blaze(
        { againstRootDir: baselineRoot, rootDir: tempDir },
        ctx()
      )
    );

    expect(diff.against.source.path).toBe(
      join(baselineRoot, '.trails', 'topo.lock')
    );
    expect(diff.diff.entries.some((entry) => entry.id === 'user.create')).toBe(
      true
    );
  });

  test('diff rejects missing and conflicting baselines through direct blaze calls', async () => {
    const missingBaseline = await wayfindDiffTrail.blaze(
      { rootDir: tempDir },
      ctx()
    );
    const conflictingBaseline = await wayfindDiffTrail.blaze(
      {
        againstDir: artifactsDir(),
        againstRootDir: tempDir,
        rootDir: tempDir,
      },
      ctx()
    );

    expect(missingBaseline.isErr()).toBe(true);
    expect(missingBaseline.isErr() ? missingBaseline.error.name : '').toBe(
      'ValidationError'
    );
    expect(conflictingBaseline.isErr()).toBe(true);
    expect(
      conflictingBaseline.isErr() ? conflictingBaseline.error.name : ''
    ).toBe('ValidationError');
  });
});
