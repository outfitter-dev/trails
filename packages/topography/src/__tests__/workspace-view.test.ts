import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';

import type {
  ReadTrailsProjectIdentityResult,
  ResolvedTrailsWorkspaceApp,
} from '@ontrails/config';

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

  test('rejects unconfigured selections, duplicate selections, and malformed current hashes', async () => {
    const appGraph = graph([entry('one.read')]);
    await writeAppLock(join(rootDir, 'one'), 'one', appGraph);
    const project = identity(rootDir, [{ id: 'one', root: 'one' }]);

    await expect(
      deriveWorkspaceView({ identity: project, selectedAppIds: ['other'] })
    ).rejects.toThrow('unconfigured IDs');
    await expect(
      deriveWorkspaceView({ identity: project, selectedAppIds: ['one', 'one'] })
    ).rejects.toThrow('duplicate IDs');
    await expect(
      deriveWorkspaceView({
        currentAppGraphHashes: { one: 'not-a-hash' },
        identity: project,
      })
    ).rejects.toThrow('lowercase SHA-256');
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

  test('distinguishes default ignored directories from scope exclusions', async () => {
    await writeAppLock(join(rootDir, 'node_modules'), 'dependency', graph([]));

    const view = await deriveWorkspaceView({
      identity: identity(rootDir, [{ id: 'dependency', root: 'node_modules' }]),
    });

    expect(view.evidence.collectionSkips).toContainEqual({
      path: 'node_modules',
      provenance: 'source-collection',
      reason: 'ignored-directory',
    });
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
