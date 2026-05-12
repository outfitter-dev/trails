import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { topo } from '@ontrails/core';
import type { Topo } from '@ontrails/core';

import { writeTopoGraph } from '../io.js';
import { TOPO_GRAPH_SCHEMA_VERSION } from '../types.js';
import type { WorkspaceTrailCollision, WorkspaceTrailIndex } from '../types.js';
import { buildWorkspaceTrailIndex } from '../workspace-topos.js';
import type { WorkspaceTopoLoader } from '../workspace-topos.js';

const TOPO_LOCK_FALLBACK_WARNING = 'No workspace topo.lock found';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface AppFixture {
  readonly name: string;
  readonly trailIds: readonly string[];
  /**
   * Optional declaration field controlling which file the loader resolves.
   * Defaults to omitted (convention: `src/app.ts`).
   */
  readonly entry?: string | undefined;
  /** When true, the loader throws when invoked for this app. */
  readonly loadFails?: boolean | undefined;
}

interface WorkspaceFixture {
  readonly root: string;
  readonly appPaths: ReadonlyMap<string, string>;
}

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeWorkspaceTopoGraph = (
  dir: string,
  workspaceIndex: WorkspaceTrailIndex,
  collisions?: readonly WorkspaceTrailCollision[]
): Promise<string> =>
  writeTopoGraph(
    {
      activationGraph: {
        edgeCount: 0,
        edges: [],
        sourceCount: 0,
        sourceKeys: [],
        trailIds: [],
      },
      activationSources: {},
      entries: [],
      generatedAt: '2026-05-11T12:00:00.000Z',
      topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
      workspace: { collisions, trails: workspaceIndex },
    },
    { dir }
  );

const writeWorkspace = async (
  root: string,
  apps: readonly AppFixture[]
): Promise<WorkspaceFixture> => {
  await writeJson(join(root, 'package.json'), {
    name: 'workspace-fixture',
    private: true,
    type: 'module',
    workspaces: ['apps/*'],
  });

  const appPaths = new Map<string, string>();
  for (const app of apps) {
    const appDir = join(root, 'apps', app.name);
    appPaths.set(app.name, appDir);

    const pkg: Record<string, unknown> = {
      name: app.name,
      private: true,
      // The fixture loader is injected, so the entry file does not need to
      // exist on disk — but the discovery layer must still recognize this
      // member as a Trails app, so we declare `trails.module` explicitly.
      trails: { module: app.entry ?? 'src/app.ts' },
      type: 'module',
    };
    await writeJson(join(appDir, 'package.json'), pkg);
  }

  return { appPaths, root };
};

const buildTopo = (name: string, ids: readonly string[]): Topo => {
  // Construct a fake trail-shaped object for each id. The loader pipeline only
  // calls topo.ids(), so we never actually invoke a blaze; the shape just has
  // to satisfy the registrable kind discriminant.
  const trailModules = ids.map((id, index) => ({
    [`trail_${index}`]: {
      // biome-ignore lint/suspicious/useAwait: trail blaze placeholder
      blaze: async () => {
        throw new Error(`fixture trail ${id} should never run`);
      },
      crosses: [],
      examples: [],
      id,
      input: undefined,
      kind: 'trail' as const,
      output: undefined,
    },
  }));
  return topo({ name }, ...trailModules);
};

const makeLoader =
  (registry: ReadonlyMap<string, AppFixture>): WorkspaceTopoLoader =>
  async (appDir: string, _root: string, _entryRelative?: string) => {
    const segments = appDir.split('/');
    const lastIndex = segments.length - 1;
    const appName = segments[lastIndex];
    if (appName === undefined || appName === '') {
      throw new Error('app name missing');
    }
    const fixture = registry.get(appName);
    if (fixture === undefined) {
      throw new Error(`no fixture for ${appName}`);
    }
    if (fixture.loadFails === true) {
      throw new Error('synthetic load failure');
    }
    return buildTopo(appName, fixture.trailIds);
  };

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'trails-workspace-topos-'));
});

afterEach(async () => {
  await rm(workspaceRoot, { force: true, recursive: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildWorkspaceTrailIndex (discovery path)', () => {
  test('indexes trail ids across two apps to their owning app names', async () => {
    const fixtures = [
      { name: 'app-a', trailIds: ['a.create', 'a.read'] },
      { name: 'app-b', trailIds: ['b.write'] },
    ];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: makeLoader(registry),
    });

    expect(result.source).toBe('discovery');
    expect(result.index).toEqual({
      'a.create': {
        appName: 'app-a',
        modulePath: 'apps/app-a/src/app.ts',
        trailId: 'a.create',
      },
      'a.read': {
        appName: 'app-a',
        modulePath: 'apps/app-a/src/app.ts',
        trailId: 'a.read',
      },
      'b.write': {
        appName: 'app-b',
        modulePath: 'apps/app-b/src/app.ts',
        trailId: 'b.write',
      },
    });
    expect(result.apps).toEqual(expect.arrayContaining(['app-a', 'app-b']));
    expect(result.apps.length).toBe(2);
    expect(result.warnings).toEqual([
      expect.stringContaining(TOPO_LOCK_FALLBACK_WARNING),
    ]);
    expect(result.collisions).toEqual([]);
  });

  test('indexes a single-app workspace', async () => {
    const fixtures = [{ name: 'only-app', trailIds: ['only.ping'] }];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: makeLoader(registry),
    });

    expect(result.source).toBe('discovery');
    expect(result.index).toEqual({
      'only.ping': {
        appName: 'only-app',
        modulePath: 'apps/only-app/src/app.ts',
        trailId: 'only.ping',
      },
    });
    expect(result.apps).toEqual(['only-app']);
    expect(result.warnings).toEqual([
      expect.stringContaining(TOPO_LOCK_FALLBACK_WARNING),
    ]);
  });

  test('passes the already-resolved entry path to the loader', async () => {
    const fixtures = [
      {
        entry: 'src/custom-app.ts',
        name: 'custom-entry',
        trailIds: ['custom.run'],
      },
    ];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);
    const entries: string[] = [];
    const trackingLoader: WorkspaceTopoLoader = async (
      appDir,
      root,
      entryRelative
    ) => {
      entries.push(entryRelative ?? '');
      return makeLoader(registry)(appDir, root, entryRelative);
    };

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: trackingLoader,
    });

    expect(result.index['custom.run']).toEqual({
      appName: 'custom-entry',
      modulePath: 'apps/custom-entry/src/custom-app.ts',
      trailId: 'custom.run',
    });
    expect(entries).toEqual(['src/custom-app.ts']);
    expect(result.collisions).toEqual([]);
  });

  test('returns an empty index for a workspace with no apps', async () => {
    await writeWorkspace(workspaceRoot, []);

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: makeLoader(new Map()),
    });

    expect(result.source).toBe('discovery');
    expect(result.index).toEqual({});
    expect(result.apps).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining(TOPO_LOCK_FALLBACK_WARNING),
    ]);
  });

  test('does not list apps that load but expose zero trail ids', async () => {
    const fixtures: readonly AppFixture[] = [
      { name: 'empty-app', trailIds: [] },
    ];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: makeLoader(registry),
    });

    expect(result.source).toBe('discovery');
    expect(result.index).toEqual({});
    expect(result.apps).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining(TOPO_LOCK_FALLBACK_WARNING),
    ]);
    expect(result.collisions).toEqual([]);
  });

  test('records a warning and partial index when one app fails to load', async () => {
    const fixtures: readonly AppFixture[] = [
      { name: 'good-app', trailIds: ['good.run'] },
      { loadFails: true, name: 'broken-app', trailIds: [] },
    ];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: makeLoader(registry),
    });

    expect(result.source).toBe('discovery');
    expect(result.index).toEqual({
      'good.run': {
        appName: 'good-app',
        modulePath: 'apps/good-app/src/app.ts',
        trailId: 'good.run',
      },
    });
    expect(result.apps).toEqual(['good-app']);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain(TOPO_LOCK_FALLBACK_WARNING);
    expect(result.warnings[1]).toContain('broken-app');
    expect(result.collisions).toEqual([]);
  });

  test('records a structured collision and omits the colliding id from the index', async () => {
    const fixtures = [
      { name: 'app-a', trailIds: ['shared.id', 'a.only'] },
      { name: 'app-b', trailIds: ['shared.id', 'b.only'] },
    ];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: makeLoader(registry),
    });

    expect(result.source).toBe('discovery');
    // Colliding ids are NOT in the index — callers must resolve via collisions.
    expect(result.index).toEqual({
      'a.only': {
        appName: 'app-a',
        modulePath: 'apps/app-a/src/app.ts',
        trailId: 'a.only',
      },
      'b.only': {
        appName: 'app-b',
        modulePath: 'apps/app-b/src/app.ts',
        trailId: 'b.only',
      },
    });
    expect(result.collisions).toEqual([
      {
        apps: ['app-a', 'app-b'],
        owners: [
          {
            appName: 'app-a',
            modulePath: 'apps/app-a/src/app.ts',
            trailId: 'shared.id',
          },
          {
            appName: 'app-b',
            modulePath: 'apps/app-b/src/app.ts',
            trailId: 'shared.id',
          },
        ],
        trailId: 'shared.id',
      },
    ]);
    // Collisions are reported via the structured field, not the warnings list.
    expect(result.warnings).toEqual([
      expect.stringContaining(TOPO_LOCK_FALLBACK_WARNING),
    ]);
  });

  test('records a 3-way collision with all owning apps sorted', async () => {
    const fixtures = [
      { name: 'app-a', trailIds: ['triple'] },
      { name: 'app-b', trailIds: ['triple'] },
      { name: 'app-c', trailIds: ['triple'] },
    ];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: makeLoader(registry),
    });

    expect(result.source).toBe('discovery');
    expect(result.index).toEqual({});
    expect(result.collisions).toHaveLength(1);
    const [collision] = result.collisions;
    expect(collision).toBeDefined();
    if (collision === undefined) {
      throw new Error('expected at least one collision');
    }
    expect(collision.trailId).toBe('triple');
    expect(collision.apps).toEqual(['app-a', 'app-b', 'app-c']);
    expect(collision.owners).toEqual([
      {
        appName: 'app-a',
        modulePath: 'apps/app-a/src/app.ts',
        trailId: 'triple',
      },
      {
        appName: 'app-b',
        modulePath: 'apps/app-b/src/app.ts',
        trailId: 'triple',
      },
      {
        appName: 'app-c',
        modulePath: 'apps/app-c/src/app.ts',
        trailId: 'triple',
      },
    ]);
    expect(result.warnings).toEqual([
      expect.stringContaining(TOPO_LOCK_FALLBACK_WARNING),
    ]);
  });
});

describe('buildWorkspaceTrailIndex (topo.lock path)', () => {
  test('reads the index from a fresh workspace topo.lock without loading apps', async () => {
    const fixtures = [{ name: 'lock-app', trailIds: ['lock.read'] }];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);

    await writeWorkspaceTopoGraph(join(workspaceRoot, '.trails'), {
      'lock.entry': {
        appName: 'lock-app',
        modulePath: 'apps/lock-app/src/app.ts',
        trailId: 'lock.entry',
      },
    });

    let loaderCalls = 0;
    const trackingLoader: WorkspaceTopoLoader = async (
      appDir: string,
      root: string
    ) => {
      loaderCalls += 1;
      return makeLoader(registry)(appDir, root);
    };

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: trackingLoader,
    });

    expect(result.source).toBe('topo-lock');
    expect(result.index).toEqual({
      'lock.entry': {
        appName: 'lock-app',
        modulePath: 'apps/lock-app/src/app.ts',
        trailId: 'lock.entry',
      },
    });
    expect(loaderCalls).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(Object.isFrozen(result.index)).toBe(true);
    expect(result.collisions).toEqual([]);
    // apps reflect what the topo.lock workspace index asserts.
    expect(result.apps).toEqual(['lock-app']);
  });

  test('reads collision ownership from a workspace topo.lock without loading apps', async () => {
    const fixtures = [
      { name: 'app-a', trailIds: ['shared.id'] },
      { name: 'app-b', trailIds: ['shared.id'] },
    ];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);

    await writeWorkspaceTopoGraph(join(workspaceRoot, '.trails'), {}, [
      {
        apps: ['app-a', 'app-b'],
        owners: [
          {
            appName: 'app-a',
            modulePath: 'apps/app-a/src/app.ts',
            trailId: 'shared.id',
          },
          {
            appName: 'app-b',
            modulePath: 'apps/app-b/src/app.ts',
            trailId: 'shared.id',
          },
        ],
        trailId: 'shared.id',
      },
    ]);

    let loaderCalls = 0;
    const trackingLoader: WorkspaceTopoLoader = async (
      appDir: string,
      root: string
    ) => {
      loaderCalls += 1;
      return makeLoader(registry)(appDir, root);
    };

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: trackingLoader,
    });

    expect(result.source).toBe('topo-lock');
    expect(result.index).toEqual({});
    expect(result.collisions).toEqual([
      {
        apps: ['app-a', 'app-b'],
        owners: [
          {
            appName: 'app-a',
            modulePath: 'apps/app-a/src/app.ts',
            trailId: 'shared.id',
          },
          {
            appName: 'app-b',
            modulePath: 'apps/app-b/src/app.ts',
            trailId: 'shared.id',
          },
        ],
        trailId: 'shared.id',
      },
    ]);
    expect(result.apps).toEqual(['app-a', 'app-b']);
    expect(loaderCalls).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  test('resolves a relative artifactDir against cwd', async () => {
    const fixtures = [{ name: 'lock-app', trailIds: ['lock.read'] }];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);

    await writeWorkspaceTopoGraph(join(workspaceRoot, '.custom-trails'), {
      'relative.lock': {
        appName: 'lock-app',
        modulePath: 'apps/lock-app/src/app.ts',
        trailId: 'relative.lock',
      },
    });

    let loaderCalls = 0;
    const trackingLoader: WorkspaceTopoLoader = async (
      appDir: string,
      root: string,
      entryRelative?: string
    ) => {
      loaderCalls += 1;
      return makeLoader(registry)(appDir, root, entryRelative);
    };

    const result = await buildWorkspaceTrailIndex({
      artifactDir: '.custom-trails',
      cwd: workspaceRoot,
      loadTopo: trackingLoader,
    });

    expect(result.source).toBe('topo-lock');
    expect(result.index['relative.lock']).toEqual({
      appName: 'lock-app',
      modulePath: 'apps/lock-app/src/app.ts',
      trailId: 'relative.lock',
    });
    expect(loaderCalls).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  test('falls back to discovery when no workspace topo.lock is present', async () => {
    const fixtures = [{ name: 'app-only', trailIds: ['only.go'] }];
    const registry = new Map(fixtures.map((f) => [f.name, f]));
    await writeWorkspace(workspaceRoot, fixtures);

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: makeLoader(registry),
    });

    expect(result.source).toBe('discovery');
    expect(result.warnings).toEqual([
      expect.stringContaining(TOPO_LOCK_FALLBACK_WARNING),
    ]);
    expect(result.index).toEqual({
      'only.go': {
        appName: 'app-only',
        modulePath: 'apps/app-only/src/app.ts',
        trailId: 'only.go',
      },
    });
  });

  test('preserves topo.lock fallback warning when discovery has no workspace globs', async () => {
    await writeJson(join(workspaceRoot, 'package.json'), {
      name: 'no-workspaces',
      private: true,
      type: 'module',
    });

    const result = await buildWorkspaceTrailIndex({
      cwd: workspaceRoot,
      loadTopo: makeLoader(new Map()),
    });

    expect(result.source).toBe('discovery');
    expect(result.apps).toEqual([]);
    expect(result.index).toEqual({});
    expect(result.warnings).toEqual([
      expect.stringContaining(TOPO_LOCK_FALLBACK_WARNING),
    ]);
  });
});
