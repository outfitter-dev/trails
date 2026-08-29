import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';

import type {
  ReadTrailsProjectIdentityResult,
  ResolvedTrailsWorkspaceApp,
} from '@ontrails/config';
import { readTrailsProjectIdentity } from '@ontrails/config';

import { deriveTopoGraphHash } from '../hash.js';
import { writeTrailsLock } from '../io.js';
import { TOPO_GRAPH_SCHEMA_VERSION } from '../types.js';
import type { TopoGraph, TopoGraphEntry, TrailsLock } from '../types.js';
import {
  deriveWorkspaceView,
  WORKSPACE_VIEW_SCHEMA_VERSION,
} from '../workspace-view.js';

const EMPTY_ACTIVATION_GRAPH = {
  edgeCount: 0,
  edges: [],
  sourceCount: 0,
  sourceKeys: [],
  trailIds: [],
} as const;

const entry = (
  id: string,
  kind: TopoGraphEntry['kind'] = 'trail',
  extra: Partial<TopoGraphEntry> = {}
): TopoGraphEntry => ({
  exampleCount: 0,
  id,
  kind,
  surfaces: [],
  ...extra,
});

const graph = (
  entries: readonly TopoGraphEntry[],
  extra: Partial<TopoGraph> = {}
): TopoGraph => ({
  activationGraph: EMPTY_ACTIVATION_GRAPH,
  activationSources: {},
  entries,
  topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
  ...extra,
});

const appIdentity = (
  rootDir: string,
  id: string,
  root: string
): ResolvedTrailsWorkspaceApp => {
  const entryPath = 'src/app.ts';
  return {
    entry: entryPath,
    entryPath: join(rootDir, root, entryPath),
    entrySource: 'convention',
    id,
    modulePath: root === '.' ? entryPath : posix.join(root, entryPath),
    root,
    rootDir: join(rootDir, root),
  };
};

const identity = (
  rootDir: string,
  appSpecs: readonly { readonly id: string; readonly root: string }[]
): ReadTrailsProjectIdentityResult => ({
  apps: appSpecs.map((app) => appIdentity(rootDir, app.id, app.root)),
  configPath: join(rootDir, 'trails.config.ts'),
  rootDir,
  workspace: {
    apps: Object.fromEntries(
      appSpecs.map((app) => [app.id, { root: app.root }])
    ),
  },
});

interface WriteAppLockOptions {
  readonly hash?: string | undefined;
  readonly scopeApp?: string | undefined;
  readonly summary?: TrailsLock['summary'] | undefined;
}

const writeAppLock = async (
  appRoot: string,
  appId: string,
  topoGraph: TopoGraph,
  options: WriteAppLockOptions = {}
): Promise<void> => {
  const lock: TrailsLock = {
    scope:
      options.scopeApp === undefined
        ? { app: appId }
        : { app: options.scopeApp },
    summary: options.summary ?? {
      entities: topoGraph.entries.filter((item) => item.kind === 'entity')
        .length,
      resources: topoGraph.entries.filter((item) => item.kind === 'resource')
        .length,
      signals: topoGraph.entries.filter((item) => item.kind === 'signal')
        .length,
      trails: topoGraph.entries.filter((item) => item.kind === 'trail').length,
    },
    topoGraph,
    topoGraphHash: options.hash ?? deriveTopoGraphHash(topoGraph),
    version: 5,
  };
  await writeTrailsLock(lock, { dir: appRoot });
};

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'trails-workspace-view-'));
});

afterEach(async () => {
  await rm(rootDir, { force: true, recursive: true });
});

describe('deriveWorkspaceView canonical content', () => {
  test('preserves complete graphs by configured app and records collisions', async () => {
    const project = identity(rootDir, [
      { id: 'zebra', root: 'apps/zebra' },
      { id: 'alpha', root: 'apps/alpha' },
    ]);
    await writeAppLock(
      join(rootDir, 'apps/zebra'),
      'zebra',
      graph([entry('shared.read', 'trail'), entry('zebra.signal', 'signal')])
    );
    await writeAppLock(
      join(rootDir, 'apps/alpha'),
      'alpha',
      graph([
        entry('shared.read', 'trail', { composes: ['zebra.write'] }),
        entry('shared.read', 'resource'),
      ])
    );

    const view = await deriveWorkspaceView({ identity: project });

    expect(view.content.workspaceViewSchemaVersion).toBe(
      WORKSPACE_VIEW_SCHEMA_VERSION
    );
    expect(view.content.apps.map((app) => app.id)).toEqual(['alpha', 'zebra']);
    expect(view.content.apps[0]?.topoGraph.entries[0]?.composes).toEqual([
      'zebra.write',
    ]);
    expect(view.content.collisions).toEqual([
      { appIds: ['alpha', 'zebra'], id: 'shared.read', kind: 'trail' },
    ]);
    expect(view.evidence.configuredCompleteness).toBe('complete');
    expect(view.workspaceViewHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic across input order, checkout location, and observation evidence', async () => {
    const otherRoot = await mkdtemp(join(tmpdir(), 'trails-workspace-view-'));
    try {
      const appGraph = graph([entry('same.read')]);
      await writeAppLock(join(rootDir, 'apps/one'), 'one', appGraph);
      await writeAppLock(join(rootDir, 'apps/two'), 'two', appGraph);
      await writeAppLock(join(otherRoot, 'apps/one'), 'one', appGraph);
      await writeAppLock(join(otherRoot, 'apps/two'), 'two', appGraph);
      await Bun.write(join(rootDir, 'stray', 'trails.lock'), '{}\n');

      const first = await deriveWorkspaceView({
        currentAppGraphHashes: { one: deriveTopoGraphHash(appGraph) },
        identity: identity(rootDir, [
          { id: 'two', root: 'apps/two' },
          { id: 'one', root: 'apps/one' },
        ]),
        selectedAppIds: ['one'],
      });
      const second = await deriveWorkspaceView({
        identity: identity(otherRoot, [
          { id: 'one', root: 'apps/one' },
          { id: 'two', root: 'apps/two' },
        ]),
        selectedAppIds: ['two', 'one'],
      });

      expect(first.workspaceViewHash).toBe(second.workspaceViewHash);
      expect(first.evidence).not.toEqual(second.evidence);
      expect(first.evidence.unownedLocks).toEqual([
        expect.objectContaining({
          kind: 'unconfigured-app-lock',
          path: 'stray/trails.lock',
        }),
      ]);
    } finally {
      await rm(otherRoot, { force: true, recursive: true });
    }
  });

  test('removes generatedAt provenance without changing a valid graph hash', async () => {
    const appGraph = graph([entry('clock.read')], {
      generatedAt: '2026-08-21T12:00:00.000Z',
    });
    await writeAppLock(join(rootDir, 'apps/clock'), 'clock', appGraph);

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'clock', root: 'apps/clock' }]),
    });

    expect(view.content.apps[0]?.topoGraph.generatedAt).toBeUndefined();
    expect(view.content.apps[0]?.topoGraphHash).toBe(
      deriveTopoGraphHash(appGraph)
    );
  });
});

describe('deriveWorkspaceView app-lock evidence', () => {
  test('keeps a missing configured lock visible and withholds the canonical hash', async () => {
    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [
        { id: 'present', root: 'apps/present' },
        { id: 'missing', root: 'apps/missing' },
      ]),
    });

    expect(view.content.apps).toEqual([]);
    expect(view.workspaceViewHash).toBeNull();
    expect(view.evidence.configuredCompleteness).toBe('partial');
    expect(view.evidence.apps).toContainEqual(
      expect.objectContaining({
        id: 'missing',
        lockPath: 'apps/missing/trails.lock',
        status: 'missing',
      })
    );
  });

  test('classifies an existing zero-byte lock as invalid', async () => {
    await mkdir(join(rootDir, 'apps/empty'), { recursive: true });
    await Bun.write(join(rootDir, 'apps/empty/trails.lock'), '');

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'empty', root: 'apps/empty' }]),
    });

    expect(view.content.apps).toEqual([]);
    expect(view.workspaceViewHash).toBeNull();
    expect(view.evidence.configuredCompleteness).toBe('partial');
    expect(view.evidence.apps).toContainEqual(
      expect.objectContaining({
        binding: 'unavailable',
        coaching:
          'Regenerate apps/empty/trails.lock by compiling configured app empty.',
        detail: expect.stringContaining('Invalid JSON'),
        freshness: 'unavailable',
        id: 'empty',
        status: 'invalid',
      })
    );
  });

  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'classifies an unreadable configured lock as unavailable',
    async () => {
      const appRoot = join(rootDir, 'apps/blocked');
      const lockPath = join(appRoot, 'trails.lock');
      await writeAppLock(appRoot, 'blocked', graph([entry('blocked.read')]));
      await chmod(lockPath, 0o000);

      try {
        const view = await deriveWorkspaceView({
          identity: identity(rootDir, [
            { id: 'blocked', root: 'apps/blocked' },
          ]),
        });

        expect(view.content.apps).toEqual([]);
        expect(view.workspaceViewHash).toBeNull();
        expect(view.evidence.configuredCompleteness).toBe('partial');
        expect(view.evidence.apps).toContainEqual(
          expect.objectContaining({
            binding: 'unavailable',
            coaching:
              'Restore access to apps/blocked/trails.lock, then inspect configured app blocked again.',
            detail: expect.stringContaining('EACCES'),
            freshness: 'unavailable',
            id: 'blocked',
            status: 'unavailable',
          })
        );
      } finally {
        await chmod(lockPath, 0o600);
      }
    }
  );

  test('distinguishes invalid JSON, hash-integrity failure, and app binding mismatch', async () => {
    await Bun.write(join(rootDir, 'apps/json/trails.lock'), '{nope}\n');
    await writeAppLock(
      join(rootDir, 'apps/hash'),
      'hash',
      graph([entry('hash.read')]),
      { hash: '0'.repeat(64) }
    );
    await writeAppLock(
      join(rootDir, 'apps/bound'),
      'bound',
      graph([entry('bound.read')]),
      { scopeApp: 'somewhere-else' }
    );

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [
        { id: 'json', root: 'apps/json' },
        { id: 'hash', root: 'apps/hash' },
        { id: 'bound', root: 'apps/bound' },
      ]),
    });

    expect(view.content.apps).toEqual([]);
    expect(view.evidence.apps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'json', status: 'invalid' }),
        expect.objectContaining({
          binding: 'matched',
          id: 'hash',
          status: 'invalid',
        }),
        expect.objectContaining({
          actualAppId: 'somewhere-else',
          binding: 'mismatched',
          id: 'bound',
          status: 'available',
        }),
      ])
    );
    expect(view.workspaceViewHash).toBeNull();
  });

  test('reports fresh, stale, and unknown app graphs independently', async () => {
    const freshGraph = graph([entry('fresh.read')]);
    const staleGraph = graph([entry('stale.read')]);
    const unknownGraph = graph([entry('unknown.read')]);
    await writeAppLock(join(rootDir, 'fresh'), 'fresh', freshGraph);
    await writeAppLock(join(rootDir, 'stale'), 'stale', staleGraph);
    await writeAppLock(join(rootDir, 'unknown'), 'unknown', unknownGraph);

    const view = await deriveWorkspaceView({
      currentAppGraphHashes: {
        fresh: deriveTopoGraphHash(freshGraph),
        stale: 'f'.repeat(64),
      },
      identity: identity(rootDir, [
        { id: 'fresh', root: 'fresh' },
        { id: 'stale', root: 'stale' },
        { id: 'unknown', root: 'unknown' },
      ]),
    });

    expect(view.evidence.apps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ freshness: 'fresh', id: 'fresh' }),
        expect.objectContaining({ freshness: 'stale', id: 'stale' }),
        expect.objectContaining({ freshness: 'unknown', id: 'unknown' }),
      ])
    );
    expect(view.evidence.configuredCompleteness).toBe('complete');
    expect(view.workspaceViewHash).not.toBeNull();
  });

  test('rejects a lock summary that contradicts its saved graph', async () => {
    await writeAppLock(
      join(rootDir, 'summary'),
      'summary',
      graph([entry('summary.read')]),
      {
        summary: { entities: 0, resources: 0, signals: 0, trails: 0 },
      }
    );

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'summary', root: 'summary' }]),
    });

    expect(view.content.apps).toEqual([]);
    expect(view.evidence.apps[0]).toEqual(
      expect.objectContaining({
        binding: 'matched',
        detail: expect.stringContaining('summary does not match'),
        status: 'invalid',
      })
    );
  });

  test('rejects unconfigured and duplicate selections', async () => {
    const appGraph = graph([entry('one.read')]);
    await writeAppLock(join(rootDir, 'one'), 'one', appGraph);
    const project = identity(rootDir, [{ id: 'one', root: 'one' }]);

    await expect(
      deriveWorkspaceView({
        identity: identity(join(rootDir, 'missing-workspace'), [
          { id: 'one', root: 'missing' },
        ]),
        selectedAppIds: [],
      })
    ).rejects.toThrow(
      'Workspace app selection must contain at least one configured app ID.'
    );
    await expect(
      deriveWorkspaceView({ identity: project, selectedAppIds: ['other'] })
    ).rejects.toThrow('unconfigured IDs');
    await expect(
      deriveWorkspaceView({ identity: project, selectedAppIds: ['one', 'one'] })
    ).rejects.toThrow('duplicate IDs');
  });

  test('validates configured current hashes before observing lock posture', async () => {
    const appGraph = graph([entry('one.read')]);
    await mkdir(join(rootDir, 'cases/invalid'), { recursive: true });
    await Bun.write(join(rootDir, 'cases/invalid/trails.lock'), '');
    await writeAppLock(join(rootDir, 'cases/mismatched'), 'one', appGraph, {
      scopeApp: 'somewhere-else',
    });
    await writeAppLock(join(rootDir, 'cases/scoped'), 'one', appGraph);
    await writeAppLock(join(rootDir, 'cases/integrity'), 'one', appGraph, {
      hash: '0'.repeat(64),
    });
    await writeAppLock(join(rootDir, 'cases/valid'), 'one', appGraph);

    const cases = [
      { root: 'cases/missing' },
      { root: 'cases/invalid' },
      { root: 'cases/mismatched' },
      {
        lockScope: { exclude: ['cases/scoped/trails.lock'] },
        root: 'cases/scoped',
      },
      { root: 'cases/integrity' },
      { root: 'cases/valid' },
    ] as const;

    for (const fixture of cases) {
      await expect(
        deriveWorkspaceView({
          currentAppGraphHashes: { one: 'not-a-hash' },
          identity: identity(rootDir, [{ id: 'one', root: fixture.root }]),
          ...('lockScope' in fixture ? { lockScope: fixture.lockScope } : {}),
        })
      ).rejects.toThrow(
        'Current graph hash for app one must be a lowercase SHA-256 digest.'
      );
    }

    const view = await deriveWorkspaceView({
      currentAppGraphHashes: { unconfigured: 'not-a-hash' },
      identity: identity(rootDir, [{ id: 'one', root: 'cases/valid' }]),
    });
    expect(view.evidence.apps[0]?.freshness).toBe('unknown');
    expect(view.evidence.configuredCompleteness).toBe('complete');
  });

  test('rejects legacy workspace metadata inside an app-local lock', async () => {
    const appGraph = graph([entry('legacy.read')], {
      workspace: { trails: {} },
    });
    await writeAppLock(join(rootDir, 'legacy'), 'legacy', appGraph);

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'legacy', root: 'legacy' }]),
    });

    expect(view.content.apps).toEqual([]);
    expect(view.evidence.apps[0]).toEqual(
      expect.objectContaining({
        binding: 'matched',
        detail: expect.stringContaining('legacy aggregate workspace metadata'),
        status: 'invalid',
      })
    );
  });
});

describe('deriveWorkspaceView lock census', () => {
  test('reconciles a Config-approved app alias to the workspace root', async () => {
    await writeAppLock(rootDir, 'demo', graph([entry('demo.read')]));
    await Bun.write(join(rootDir, 'src/app.ts'), 'export default {};\n');
    await mkdir(join(rootDir, 'apps'), { recursive: true });
    await symlink('..', join(rootDir, 'apps/demo'), 'dir');
    await Bun.write(
      join(rootDir, 'trails.config.json'),
      JSON.stringify({
        workspace: { apps: { demo: { root: 'apps/demo' } } },
      })
    );
    const project = await readTrailsProjectIdentity({
      boundaryDir: rootDir,
      startDir: rootDir,
    });

    expect(project.apps[0]).toMatchObject({
      id: 'demo',
      root: 'apps/demo',
    });

    const view = await deriveWorkspaceView({ identity: project });
    const physicalExcluded = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['trails.lock'] },
    });
    const authoredExcluded = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['apps/demo/trails.lock'] },
    });

    expect(view.content.apps).toEqual([
      expect.objectContaining({ id: 'demo', root: 'apps/demo' }),
    ]);
    expect(view.evidence.apps).toEqual([
      expect.objectContaining({
        binding: 'matched',
        id: 'demo',
        status: 'available',
      }),
    ]);
    expect(view.evidence.collectionSkips).not.toContainEqual(
      expect.objectContaining({ path: 'apps/demo' })
    );
    expect(view.evidence.configuredCompleteness).toBe('complete');
    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.workspaceViewHash).toMatch(/^[0-9a-f]{64}$/);

    for (const excluded of [physicalExcluded, authoredExcluded]) {
      expect(excluded.content.apps).toEqual([]);
      expect(excluded.evidence.apps[0]).toEqual(
        expect.objectContaining({
          binding: 'unavailable',
          status: 'unavailable',
        })
      );
      expect(excluded.evidence.unownedLocks).toEqual([]);
      expect(excluded.workspaceViewHash).toBeNull();
    }
  });

  test('does not probe an absent internal-alias lock excluded by physical path', async () => {
    const physicalRoot = join(rootDir, 'internal/demo');
    await Bun.write(join(physicalRoot, 'src/app.ts'), 'export default {};\n');
    await mkdir(join(rootDir, 'apps'), { recursive: true });
    await symlink(physicalRoot, join(rootDir, 'apps/demo'), 'dir');
    await Bun.write(
      join(rootDir, 'trails.config.json'),
      JSON.stringify({
        workspace: { apps: { demo: { root: 'apps/demo' } } },
      })
    );
    const project = await readTrailsProjectIdentity({
      boundaryDir: rootDir,
      startDir: rootDir,
    });

    const view = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['internal/demo/trails.lock'] },
    });

    expect(view.content.apps).toEqual([]);
    expect(view.evidence.collectionSkips).toEqual(
      expect.arrayContaining([
        {
          path: 'apps/demo/trails.lock',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
        {
          path: 'internal/demo/trails.lock',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
      ])
    );
    expect(view.evidence.apps[0]).toEqual(
      expect.objectContaining({
        binding: 'unavailable',
        coaching: expect.stringContaining('Include apps/demo/trails.lock'),
        status: 'unavailable',
      })
    );
    expect(view.evidence.apps[0]?.coaching).not.toContain('Create');
    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.workspaceViewHash).toBeNull();
  });

  test('does not probe an absent workspace-root-alias lock excluded by physical path', async () => {
    await Bun.write(join(rootDir, 'src/app.ts'), 'export default {};\n');
    await mkdir(join(rootDir, 'apps'), { recursive: true });
    await symlink('..', join(rootDir, 'apps/demo'), 'dir');
    await Bun.write(
      join(rootDir, 'trails.config.json'),
      JSON.stringify({
        workspace: { apps: { demo: { root: 'apps/demo' } } },
      })
    );
    const project = await readTrailsProjectIdentity({
      boundaryDir: rootDir,
      startDir: rootDir,
    });

    const view = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['trails.lock'] },
    });

    expect(view.content.apps).toEqual([]);
    expect(view.evidence.collectionSkips).toEqual(
      expect.arrayContaining([
        {
          path: 'apps/demo/trails.lock',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
        {
          path: 'trails.lock',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
      ])
    );
    expect(view.evidence.apps[0]).toEqual(
      expect.objectContaining({
        binding: 'unavailable',
        coaching: expect.stringContaining('Include apps/demo/trails.lock'),
        status: 'unavailable',
      })
    );
    expect(view.evidence.apps[0]?.coaching).not.toContain('Create');
    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.workspaceViewHash).toBeNull();
  });

  test('reconciles a Config-approved internal app-root alias', async () => {
    const physicalRoot = join(rootDir, 'internal/demo');
    await writeAppLock(physicalRoot, 'demo', graph([entry('demo.read')]));
    await Bun.write(join(physicalRoot, 'src/app.ts'), 'export default {};\n');
    await mkdir(join(rootDir, 'apps'), { recursive: true });
    await symlink(physicalRoot, join(rootDir, 'apps/demo'), 'dir');
    await Bun.write(
      join(rootDir, 'trails.config.json'),
      JSON.stringify({
        workspace: { apps: { demo: { root: 'apps/demo' } } },
      })
    );
    const project = await readTrailsProjectIdentity({
      boundaryDir: rootDir,
      startDir: rootDir,
    });

    const view = await deriveWorkspaceView({ identity: project });

    expect(view.content.apps).toEqual([
      expect.objectContaining({ id: 'demo', root: 'apps/demo' }),
    ]);
    expect(view.evidence.apps).toEqual([
      expect.objectContaining({
        binding: 'matched',
        id: 'demo',
        status: 'available',
      }),
    ]);
    expect(view.evidence.collectionSkips).not.toContainEqual(
      expect.objectContaining({ path: 'apps/demo' })
    );
    expect(view.evidence.configuredCompleteness).toBe('complete');
    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.workspaceViewHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('reconciles every internal alias along a multi-hop configured root', async () => {
    const physicalRoot = join(rootDir, 'internal/second');
    await writeAppLock(physicalRoot, 'demo', graph([entry('demo.read')]));
    await Bun.write(join(physicalRoot, 'src/app.ts'), 'export default {};\n');
    await mkdir(join(rootDir, 'internal/first'), { recursive: true });
    await symlink('../second', join(rootDir, 'internal/first/demo'), 'dir');
    await symlink(
      join(rootDir, 'internal/first'),
      join(rootDir, 'apps'),
      'dir'
    );
    await Bun.write(
      join(rootDir, 'trails.config.json'),
      JSON.stringify({
        workspace: { apps: { demo: { root: 'apps/demo' } } },
      })
    );
    const project = await readTrailsProjectIdentity({
      boundaryDir: rootDir,
      startDir: rootDir,
    });

    const view = await deriveWorkspaceView({ identity: project });
    const excluded = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['internal/first/demo'] },
    });
    const intermediateLockExcluded = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['internal/first/demo/trails.lock'] },
    });

    expect(view.content.apps).toEqual([
      expect.objectContaining({ id: 'demo', root: 'apps/demo' }),
    ]);
    expect(view.evidence.apps).toEqual([
      expect.objectContaining({
        binding: 'matched',
        id: 'demo',
        status: 'available',
      }),
    ]);
    expect(view.evidence.collectionSkips).not.toContainEqual(
      expect.objectContaining({ path: 'apps' })
    );
    expect(view.evidence.collectionSkips).not.toContainEqual(
      expect.objectContaining({ path: 'apps/demo' })
    );
    expect(view.evidence.configuredCompleteness).toBe('complete');
    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.evidence.collectionSkips).not.toContainEqual({
      path: 'internal/first/demo',
      provenance: 'source-collection',
      reason: 'unsupported-entry',
    });
    expect(excluded.content.apps).toEqual([]);
    expect(excluded.evidence.collectionSkips).toEqual(
      expect.arrayContaining([
        {
          path: 'apps/demo',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
        {
          path: 'internal/first/demo',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
      ])
    );
    expect(excluded.evidence.apps[0]).toEqual(
      expect.objectContaining({ binding: 'unavailable', status: 'unavailable' })
    );
    expect(excluded.evidence.unownedLocks).toEqual([]);
    expect(excluded.workspaceViewHash).toBeNull();
    expect(intermediateLockExcluded.content.apps).toEqual([]);
    expect(intermediateLockExcluded.evidence.collectionSkips).toEqual(
      expect.arrayContaining([
        {
          path: 'apps/demo/trails.lock',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
        {
          path: 'internal/first/demo/trails.lock',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
      ])
    );
    expect(intermediateLockExcluded.evidence.apps[0]).toEqual(
      expect.objectContaining({ binding: 'unavailable', status: 'unavailable' })
    );
    expect(intermediateLockExcluded.evidence.unownedLocks).toEqual([]);
    expect(intermediateLockExcluded.workspaceViewHash).toBeNull();
  });

  test('reconciles every alias in a configured leaf-target chain', async () => {
    const physicalRoot = join(rootDir, 'internal/second');
    await writeAppLock(physicalRoot, 'demo', graph([entry('demo.read')]));
    await Bun.write(join(physicalRoot, 'src/app.ts'), 'export default {};\n');
    await mkdir(join(rootDir, 'apps'), { recursive: true });
    await mkdir(join(rootDir, 'internal'), { recursive: true });
    await symlink('second', join(rootDir, 'internal/first'), 'dir');
    await symlink('../internal/first', join(rootDir, 'apps/demo'), 'dir');
    await Bun.write(
      join(rootDir, 'trails.config.json'),
      JSON.stringify({
        workspace: { apps: { demo: { root: 'apps/demo' } } },
      })
    );
    const project = await readTrailsProjectIdentity({
      boundaryDir: rootDir,
      startDir: rootDir,
    });

    const view = await deriveWorkspaceView({ identity: project });
    const excluded = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['internal/first/trails.lock'] },
    });

    expect(view.content.apps).toEqual([
      expect.objectContaining({ id: 'demo', root: 'apps/demo' }),
    ]);
    expect(view.evidence.collectionSkips).not.toContainEqual({
      path: 'internal/first',
      provenance: 'source-collection',
      reason: 'unsupported-entry',
    });
    expect(excluded.content.apps).toEqual([]);
    expect(excluded.evidence.collectionSkips).toEqual(
      expect.arrayContaining([
        {
          path: 'apps/demo/trails.lock',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
        {
          path: 'internal/first/trails.lock',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
      ])
    );
    expect(excluded.evidence.apps[0]).toEqual(
      expect.objectContaining({ binding: 'unavailable', status: 'unavailable' })
    );
    expect(excluded.evidence.unownedLocks).toEqual([]);
    expect(excluded.workspaceViewHash).toBeNull();
  });

  test('reconciles a parent alias hop inside a configured target path', async () => {
    const physicalRoot = join(rootDir, 'internal/second/demo');
    await writeAppLock(physicalRoot, 'demo', graph([entry('demo.read')]));
    await Bun.write(join(physicalRoot, 'src/app.ts'), 'export default {};\n');
    await mkdir(join(rootDir, 'apps'), { recursive: true });
    await symlink('second', join(rootDir, 'internal/first'), 'dir');
    await symlink('../internal/first/demo', join(rootDir, 'apps/demo'), 'dir');
    await Bun.write(
      join(rootDir, 'trails.config.json'),
      JSON.stringify({
        workspace: { apps: { demo: { root: 'apps/demo' } } },
      })
    );
    const project = await readTrailsProjectIdentity({
      boundaryDir: rootDir,
      startDir: rootDir,
    });

    const view = await deriveWorkspaceView({ identity: project });
    const parentExcluded = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['internal/first'] },
    });
    const parentLockExcluded = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['internal/first/demo/trails.lock'] },
    });

    expect(view.content.apps).toEqual([
      expect.objectContaining({ id: 'demo', root: 'apps/demo' }),
    ]);
    expect(view.evidence.apps).toEqual([
      expect.objectContaining({
        binding: 'matched',
        id: 'demo',
        status: 'available',
      }),
    ]);
    expect(view.evidence.collectionSkips).not.toContainEqual({
      path: 'internal/first',
      provenance: 'source-collection',
      reason: 'unsupported-entry',
    });
    expect(view.evidence.configuredCompleteness).toBe('complete');
    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.workspaceViewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parentExcluded.content.apps).toEqual([]);
    expect(parentExcluded.evidence.collectionSkips).toEqual(
      expect.arrayContaining([
        {
          path: 'apps/demo',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
        {
          path: 'internal/first',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
      ])
    );
    expect(parentExcluded.evidence.apps[0]).toEqual(
      expect.objectContaining({ binding: 'unavailable', status: 'unavailable' })
    );
    expect(parentExcluded.evidence.unownedLocks).toEqual([]);
    expect(parentExcluded.workspaceViewHash).toBeNull();
    expect(parentLockExcluded.content.apps).toEqual([]);
    expect(parentLockExcluded.evidence.collectionSkips).toEqual(
      expect.arrayContaining([
        {
          path: 'apps/demo/trails.lock',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
        {
          path: 'internal/first/demo/trails.lock',
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
      ])
    );
    expect(parentLockExcluded.evidence.apps[0]).toEqual(
      expect.objectContaining({ binding: 'unavailable', status: 'unavailable' })
    );
    expect(parentLockExcluded.evidence.unownedLocks).toEqual([]);
    expect(parentLockExcluded.workspaceViewHash).toBeNull();
  });

  test('applies authored PathScope to an internal app-root alias', async () => {
    const physicalRoot = join(rootDir, 'internal/demo');
    await writeAppLock(physicalRoot, 'demo', graph([]));
    await mkdir(join(rootDir, 'apps'), { recursive: true });
    await symlink(physicalRoot, join(rootDir, 'apps/demo'), 'dir');
    const project = identity(rootDir, [{ id: 'demo', root: 'apps/demo' }]);

    const included = await deriveWorkspaceView({
      identity: project,
      lockScope: { include: ['apps/**'] },
    });
    const excluded = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['apps/**'] },
    });
    const physicalTargetExcluded = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['internal/**'] },
    });
    const physicalLockExcluded = await deriveWorkspaceView({
      identity: project,
      lockScope: { exclude: ['internal/demo/trails.lock'] },
    });

    expect(included.content.apps).toEqual([
      expect.objectContaining({ id: 'demo', root: 'apps/demo' }),
    ]);
    expect(included.evidence.unownedLocks).toEqual([]);
    expect(included.workspaceViewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(excluded.content.apps).toEqual([]);
    expect(excluded.evidence.apps[0]).toEqual(
      expect.objectContaining({ binding: 'unavailable', status: 'unavailable' })
    );
    expect(excluded.workspaceViewHash).toBeNull();
    expect(physicalTargetExcluded.evidence.collectionSkips).toContainEqual({
      path: 'apps/demo',
      provenance: 'source-collection',
      reason: 'scope-excluded',
    });
    expect(physicalTargetExcluded.evidence.apps[0]).toEqual(
      expect.objectContaining({ binding: 'unavailable', status: 'unavailable' })
    );
    expect(physicalLockExcluded.evidence.collectionSkips).toContainEqual({
      path: 'apps/demo/trails.lock',
      provenance: 'source-collection',
      reason: 'scope-excluded',
    });
    expect(physicalLockExcluded.evidence.apps[0]).toEqual(
      expect.objectContaining({ binding: 'unavailable', status: 'unavailable' })
    );
    expect(physicalLockExcluded.workspaceViewHash).toBeNull();
  });

  test('reconciles an internal alias ancestor without widening unsafe siblings', async () => {
    const physicalAppsRoot = join(rootDir, 'internal/apps');
    const externalRoot = await mkdtemp(
      join(tmpdir(), 'trails-workspace-view-external-')
    );
    try {
      await writeAppLock(
        join(physicalAppsRoot, 'demo'),
        'demo',
        graph([entry('demo.read')])
      );
      await writeAppLock(externalRoot, 'unsafe', graph([]));
      await symlink(externalRoot, join(physicalAppsRoot, 'unsafe'), 'dir');
      await symlink(physicalAppsRoot, join(rootDir, 'apps'), 'dir');

      const view = await deriveWorkspaceView({
        identity: identity(rootDir, [
          { id: 'demo', root: 'apps/demo' },
          { id: 'unsafe', root: 'apps/unsafe' },
        ]),
        selectedAppIds: ['demo'],
      });

      expect(view.content.apps).toEqual([
        expect.objectContaining({ id: 'demo', root: 'apps/demo' }),
      ]);
      expect(view.evidence.apps).toEqual([
        expect.objectContaining({ id: 'demo', status: 'available' }),
        expect.objectContaining({ id: 'unsafe', status: 'unavailable' }),
      ]);
      expect(view.evidence.collectionSkips).toContainEqual({
        path: 'apps/unsafe',
        provenance: 'source-collection',
        reason: 'unsupported-entry',
      });
      expect(view.workspaceViewHash).toBeNull();
    } finally {
      await rm(externalRoot, { force: true, recursive: true });
    }
  });

  test.each([
    {
      arrange: async (physicalRoot: string) => {
        await mkdir(join(physicalRoot, '.git/objects'), { recursive: true });
        await Bun.write(
          join(physicalRoot, '.git/HEAD'),
          'ref: refs/heads/main\n'
        );
      },
      reason: 'nested-repository',
      title: 'nested repository',
    },
    {
      arrange: async (physicalRoot: string) => {
        const gitDir = join(rootDir, 'worktree-git-dir');
        await mkdir(gitDir, { recursive: true });
        await Bun.write(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
        await Bun.write(join(physicalRoot, '.git'), `gitdir: ${gitDir}\n`);
      },
      reason: 'nested-worktree',
      title: 'linked worktree',
    },
    {
      arrange: async (_physicalRoot: string) => {
        await Bun.write(
          join(rootDir, '.gitmodules'),
          '[submodule "demo"]\n\tpath = internal/demo\n\turl = ../demo\n'
        );
      },
      reason: 'submodule-boundary',
      title: 'submodule',
    },
  ])(
    'does not let a fabricated alias identity bypass a physical $title boundary',
    async ({ arrange, reason }) => {
      const physicalRoot = join(rootDir, 'internal/demo');
      await writeAppLock(physicalRoot, 'demo', graph([]));
      await arrange(physicalRoot);
      await mkdir(join(rootDir, 'apps'), { recursive: true });
      await symlink(physicalRoot, join(rootDir, 'apps/demo'), 'dir');

      const view = await deriveWorkspaceView({
        identity: identity(rootDir, [{ id: 'demo', root: 'apps/demo' }]),
      });

      expect(view.content.apps).toEqual([]);
      expect(view.evidence.apps[0]).toEqual(
        expect.objectContaining({
          binding: 'unavailable',
          status: 'unavailable',
        })
      );
      expect(view.evidence.collectionSkips).toContainEqual({
        path: 'apps/demo',
        provenance: 'source-collection',
        reason,
      });
      expect(view.workspaceViewHash).toBeNull();
    }
  );

  test('classifies root aggregate and nested unconfigured locks without deriving app identity', async () => {
    const appGraph = graph([entry('owned.read')]);
    await writeAppLock(join(rootDir, 'apps/owned'), 'owned', appGraph);
    await Bun.write(join(rootDir, 'trails.lock'), '{}\n');
    await Bun.write(join(rootDir, 'apps/ghost/trails.lock'), '{}\n');

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'owned', root: 'apps/owned' }]),
    });

    expect(view.content.apps.map((app) => app.id)).toEqual(['owned']);
    expect(view.evidence.unownedLocks).toHaveLength(2);
    expect(view.evidence.unownedLocks).toEqual(
      expect.arrayContaining([
        {
          coaching:
            'Remove the workspace-root trails.lock; configured workspaces use app-root locks only.',
          kind: 'forbidden-workspace-aggregate',
          path: 'trails.lock',
          provenance: 'source-collection',
        },
        expect.objectContaining({
          coaching: expect.stringContaining('workspace.apps'),
          kind: 'unconfigured-app-lock',
          path: 'apps/ghost/trails.lock',
          provenance: 'source-collection',
        }),
      ])
    );
  });

  test('treats a root lock as app-owned when Config declares root dot', async () => {
    await writeAppLock(rootDir, 'root-app', graph([entry('root.read')]));

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'root-app', root: '.' }]),
    });

    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.content.apps.map((app) => app.id)).toEqual(['root-app']);
  });

  test('prunes nested repositories and reports the typed collection edge', async () => {
    await writeAppLock(join(rootDir, 'owned'), 'owned', graph([]));
    await mkdir(join(rootDir, 'vendor/repo/.git/objects'), { recursive: true });
    await Bun.write(
      join(rootDir, 'vendor/repo/.git/HEAD'),
      'ref: refs/heads/main\n'
    );
    await Bun.write(join(rootDir, 'vendor/repo/trails.lock'), '{}\n');

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'owned', root: 'owned' }]),
    });

    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.evidence.collectionSkips).toContainEqual({
      path: 'vendor/repo',
      provenance: 'source-collection',
      reason: 'nested-repository',
    });
  });

  test('does not directly read a configured app through a collection edge', async () => {
    await mkdir(join(rootDir, 'vendor/repo/.git/objects'), { recursive: true });
    await Bun.write(
      join(rootDir, 'vendor/repo/.git/HEAD'),
      'ref: refs/heads/main\n'
    );
    await writeAppLock(
      join(rootDir, 'vendor/repo'),
      'nested',
      graph([entry('nested.read')])
    );

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'nested', root: 'vendor/repo' }]),
    });

    expect(view.content.apps).toEqual([]);
    expect(view.workspaceViewHash).toBeNull();
    expect(view.evidence.apps[0]).toEqual(
      expect.objectContaining({
        binding: 'unavailable',
        detail: expect.stringContaining('not observable'),
        status: 'unavailable',
      })
    );
  });

  test('does not directly read a configured app through a symlink edge', async () => {
    const externalRoot = await mkdtemp(
      join(tmpdir(), 'trails-workspace-view-external-')
    );
    try {
      await writeAppLock(externalRoot, 'linked', graph([entry('linked.read')]));
      await symlink(externalRoot, join(rootDir, 'linked'), 'dir');

      const view = await deriveWorkspaceView({
        identity: identity(rootDir, [{ id: 'linked', root: 'linked' }]),
      });

      expect(view.content.apps).toEqual([]);
      expect(view.workspaceViewHash).toBeNull();
      expect(view.evidence.collectionSkips).toContainEqual({
        path: 'linked',
        provenance: 'source-collection',
        reason: 'unsupported-entry',
      });
      expect(view.evidence.apps[0]).toEqual(
        expect.objectContaining({
          binding: 'unavailable',
          detail: expect.stringContaining('not observable'),
          status: 'unavailable',
        })
      );
    } finally {
      await rm(externalRoot, { force: true, recursive: true });
    }
  });

  test('reads a configured app root nested below a default ignored directory', async () => {
    await writeAppLock(
      join(rootDir, 'node_modules/demo'),
      'demo',
      graph([entry('demo.read')])
    );

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'demo', root: 'node_modules/demo' }]),
    });

    expect(view.content.apps).toEqual([
      expect.objectContaining({ id: 'demo', root: 'node_modules/demo' }),
    ]);
    expect(view.evidence.apps).toEqual([
      expect.objectContaining({
        binding: 'matched',
        id: 'demo',
        status: 'available',
      }),
    ]);
    expect(view.evidence.collectionSkips).not.toContainEqual(
      expect.objectContaining({ path: 'node_modules' })
    );
    expect(view.evidence.configuredCompleteness).toBe('complete');
    expect(view.workspaceViewHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('reads a configured app root nested below a build output directory', async () => {
    await writeAppLock(
      join(rootDir, 'dist/demo'),
      'demo',
      graph([entry('demo.read')])
    );

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'demo', root: 'dist/demo' }]),
    });

    expect(view.evidence.apps).toEqual([
      expect.objectContaining({
        binding: 'matched',
        id: 'demo',
        status: 'available',
      }),
    ]);
    expect(view.evidence.configuredCompleteness).toBe('complete');
    expect(view.workspaceViewHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('reads a configured app rooted at a default ignored directory', async () => {
    await writeAppLock(
      join(rootDir, 'node_modules'),
      'dependency',
      graph([entry('dependency.read')])
    );

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'dependency', root: 'node_modules' }]),
    });

    expect(view.evidence.collectionSkips).not.toContainEqual(
      expect.objectContaining({ path: 'node_modules' })
    );
    expect(view.evidence.apps[0]).toEqual(
      expect.objectContaining({
        binding: 'matched',
        id: 'dependency',
        status: 'available',
      })
    );
    expect(view.workspaceViewHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('does not directly read a configured app inside an ignored directory', async () => {
    await writeAppLock(join(rootDir, '.git'), 'metadata', graph([]));

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'metadata', root: '.git' }]),
    });

    expect(view.content.apps).toEqual([]);
    expect(view.workspaceViewHash).toBeNull();
    expect(view.evidence.collectionSkips).toContainEqual({
      path: '.git',
      provenance: 'source-collection',
      reason: 'ignored-directory',
    });
    expect(view.evidence.apps[0]).toEqual(
      expect.objectContaining({
        binding: 'unavailable',
        detail: expect.stringContaining('not observable'),
        status: 'unavailable',
      })
    );
  });

  test('prunes ignored directories nested inside a configured app root', async () => {
    await writeAppLock(
      join(rootDir, 'apps/demo'),
      'demo',
      graph([entry('demo.read')])
    );
    await Bun.write(
      join(rootDir, 'apps/demo/node_modules/some-pkg/trails.lock'),
      '{}\n'
    );

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'demo', root: 'apps/demo' }]),
    });

    expect(view.evidence.collectionSkips).toContainEqual({
      path: 'apps/demo/node_modules',
      provenance: 'source-collection',
      reason: 'ignored-directory',
    });
    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.evidence.apps).toEqual([
      expect.objectContaining({
        binding: 'matched',
        id: 'demo',
        status: 'available',
      }),
    ]);
    expect(view.content.apps).toEqual([
      expect.objectContaining({ id: 'demo', root: 'apps/demo' }),
    ]);
    expect(view.evidence.configuredCompleteness).toBe('complete');
  });

  test('distinguishes default ignored directories from scope exclusions', async () => {
    await writeAppLock(
      join(rootDir, 'apps/demo'),
      'demo',
      graph([entry('demo.read')])
    );
    await Bun.write(join(rootDir, 'node_modules/other/trails.lock'), '{}\n');
    await Bun.write(join(rootDir, 'vendored/trails.lock'), '{}\n');

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'demo', root: 'apps/demo' }]),
      lockScope: { exclude: ['vendored/**'] },
    });

    expect(view.evidence.collectionSkips).toContainEqual({
      path: 'node_modules',
      provenance: 'source-collection',
      reason: 'ignored-directory',
    });
    expect(view.evidence.collectionSkips).toContainEqual({
      path: 'vendored',
      provenance: 'source-collection',
      reason: 'scope-excluded',
    });
    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.evidence.configuredCompleteness).toBe('complete');
  });

  test('applies PathScope excludes only to observation census', async () => {
    await writeAppLock(join(rootDir, 'owned'), 'owned', graph([]));
    await Bun.write(join(rootDir, 'ignored/trails.lock'), '{}\n');

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'owned', root: 'owned' }]),
      lockScope: { exclude: ['ignored/**'] },
    });

    expect(view.evidence.unownedLocks).toEqual([]);
    expect(view.evidence.collectionSkips).toContainEqual({
      path: 'ignored',
      provenance: 'source-collection',
      reason: 'scope-excluded',
    });
    expect(view.evidence.configuredCompleteness).toBe('complete');
  });

  test('does not directly read a configured app excluded from lock scope', async () => {
    await writeAppLock(join(rootDir, 'owned'), 'owned', graph([]));

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'owned', root: 'owned' }]),
      lockScope: { exclude: ['owned/**'] },
    });

    expect(view.content.apps).toEqual([]);
    expect(view.workspaceViewHash).toBeNull();
    expect(view.evidence.configuredAppIds).toEqual(['owned']);
    expect(view.evidence.configuredCompleteness).toBe('partial');
    expect(view.evidence.apps[0]).toEqual(
      expect.objectContaining({
        binding: 'unavailable',
        detail: expect.stringContaining('outside the active lock census scope'),
        status: 'unavailable',
      })
    );
  });

  test('keeps configured apps outside an include scope visible as partial identity', async () => {
    await writeAppLock(join(rootDir, 'included'), 'included', graph([]));
    await writeAppLock(join(rootDir, 'omitted'), 'omitted', graph([]));

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [
        { id: 'included', root: 'included' },
        { id: 'omitted', root: 'omitted' },
      ]),
      lockScope: { include: ['included/**'] },
    });

    expect(view.content.apps.map((app) => app.id)).toEqual(['included']);
    expect(view.workspaceViewHash).toBeNull();
    expect(view.evidence.configuredAppIds).toEqual(['included', 'omitted']);
    expect(view.evidence.configuredCompleteness).toBe('partial');
    expect(view.evidence.apps).toContainEqual(
      expect.objectContaining({ id: 'omitted', status: 'unavailable' })
    );
  });

  test('does not probe absent configured locks outside lock scope', async () => {
    const cases = [
      {
        expectedSkipPath: 'absent/exact/trails.lock',
        id: 'exact',
        lockScope: { exclude: ['absent/exact/trails.lock'] },
        root: 'absent/exact',
      },
      {
        expectedSkipPath: 'absent/include/trails.lock',
        id: 'include',
        lockScope: { include: ['somewhere/**'] },
        root: 'absent/include',
      },
      {
        expectedSkipPath: 'absent/extensions/trails.lock',
        id: 'extensions',
        lockScope: { extensions: ['.ts'] },
        root: 'absent/extensions',
      },
      {
        expectedSkipPath: 'absent/ancestor',
        id: 'ancestor',
        lockScope: { exclude: ['absent/ancestor'] },
        root: 'absent/ancestor',
      },
    ] as const;

    for (const fixture of cases) {
      const view = await deriveWorkspaceView({
        identity: identity(rootDir, [fixture]),
        lockScope: fixture.lockScope,
      });

      expect(view.content.apps).toEqual([]);
      expect(view.workspaceViewHash).toBeNull();
      expect(view.evidence.configuredCompleteness).toBe('partial');
      expect(view.evidence.selectedCompleteness).toBe('partial');
      expect(view.evidence.collectionSkips).toContainEqual({
        path: fixture.expectedSkipPath,
        provenance: 'source-collection',
        reason: 'scope-excluded',
      });
      expect(view.evidence.apps[0]).toEqual(
        expect.objectContaining({
          binding: 'unavailable',
          detail: expect.stringContaining(
            'outside the active lock census scope'
          ),
          id: fixture.id,
          status: 'unavailable',
        })
      );
      expect(view.evidence.apps[0]?.coaching).not.toContain('Create');
    }

    const sharedAncestorView = await deriveWorkspaceView({
      identity: identity(rootDir, [
        { id: 'first', root: 'absent/shared/first' },
        { id: 'second', root: 'absent/shared/second' },
      ]),
      lockScope: { exclude: ['absent/shared'] },
    });
    expect(sharedAncestorView.evidence.collectionSkips).toEqual([
      {
        path: 'absent/shared',
        provenance: 'source-collection',
        reason: 'scope-excluded',
      },
    ]);
    expect(sharedAncestorView.evidence.apps).toEqual([
      expect.objectContaining({ id: 'first', status: 'unavailable' }),
      expect.objectContaining({ id: 'second', status: 'unavailable' }),
    ]);
  });

  test('does not bypass a root-dot lock exclusion', async () => {
    await writeAppLock(rootDir, 'root-app', graph([]));

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'root-app', root: '.' }]),
      lockScope: { exclude: ['trails.lock'] },
    });

    expect(view.content.apps).toEqual([]);
    expect(view.workspaceViewHash).toBeNull();
    expect(view.evidence.configuredAppIds).toEqual(['root-app']);
    expect(view.evidence.configuredCompleteness).toBe('partial');
    expect(view.evidence.apps[0]).toEqual(
      expect.objectContaining({
        id: 'root-app',
        status: 'unavailable',
      })
    );
  });

  test('never writes a workspace-root aggregate lock', async () => {
    await writeAppLock(join(rootDir, 'owned'), 'owned', graph([]));
    const rootLock = Bun.file(join(rootDir, 'trails.lock'));
    expect(await rootLock.exists()).toBe(false);

    await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'owned', root: 'owned' }]),
    });

    expect(await rootLock.exists()).toBe(false);
  });
});
