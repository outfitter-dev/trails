import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  wayfindContractTrail,
  wayfindDescribeTrail,
  wayfindDiffTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOverviewTrail,
  wayfindSearchTrail,
  wayfindSurfacesTrail,
  wayfindTrailsTrail,
  wayfindVersionsTrail,
  wayfinderTopo,
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
      'wayfind.contours',
      'wayfind.contract',
      'wayfind.describe',
      'wayfind.diff',
      'wayfind.errors',
      'wayfind.examples',
      'wayfind.facets',
      'wayfind.impact',
      'wayfind.nearby',
      'wayfind.overview',
      'wayfind.resources',
      'wayfind.search',
      'wayfind.signals',
      'wayfind.surfaces',
      'wayfind.trails',
      'wayfind.versions',
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
      wayfindContractTrail.blaze({ id: 'user.show', rootDir: tempDir }, ctx())
    );
    const historical = await expectOk(
      wayfindContractTrail.blaze(
        { id: 'invite.create', kind: 'version', rootDir: tempDir, version: 1 },
        ctx()
      )
    );

    expect(current.contract).toMatchObject({
      id: 'user.show',
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
