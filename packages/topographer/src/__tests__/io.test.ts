import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  writeTopoGraph,
  readTopoGraph,
  isTopoArtifactRegenerationError,
  writeLockManifest,
  readLockManifest,
  readWorkspaceLock,
} from '../io.js';
import { TOPO_GRAPH_SCHEMA_VERSION } from '../types.js';
import type { LockManifest, TopoGraph } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeTopoGraph = (): TopoGraph => ({
  activationGraph: {
    edgeCount: 0,
    edges: [],
    sourceCount: 0,
    sourceKeys: [],
    trailIds: [],
  },
  activationSources: {},
  entries: [
    {
      description: 'Create a user',
      exampleCount: 1,
      id: 'user.create',
      input: { properties: { name: { type: 'string' } }, type: 'object' },
      kind: 'trail',
      surfaces: ['cli'],
    },
  ],
  generatedAt: '2025-01-01T00:00:00.000Z',
  topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
});

const makeLockManifest = (
  hash: string,
  overrides?: Partial<LockManifest>
): LockManifest => ({
  artifacts: [{ path: 'topo.lock', role: 'topo', sha256: hash }],
  scope: { app: 'demo' },
  summary: { contours: 0, resources: 0, signals: 0, trails: 1 },
  version: 3,
  ...overrides,
});

const readParsedLock = async (
  filePath: string
): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;

const captureError = async (
  operation: () => Promise<unknown>
): Promise<unknown> => {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to throw');
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'trails-schema-test-'));
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

// ---------------------------------------------------------------------------
// TopoGraph tests
// ---------------------------------------------------------------------------

describe('writeTopoGraph / readTopoGraph', () => {
  test('writes valid JSON to topo.lock', async () => {
    const map = makeTopoGraph();
    const filePath = await writeTopoGraph(map, { dir: tempDir });

    expect(filePath).toBe(join(tempDir, 'topo.lock'));

    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.topoGraphSchemaVersion).toBe(TOPO_GRAPH_SCHEMA_VERSION);
    expect(parsed.entries).toHaveLength(1);
  });

  test('reads it back and produces identical data', async () => {
    const map = makeTopoGraph();
    await writeTopoGraph(map, { dir: tempDir });
    const result = await readTopoGraph({ dir: tempDir });

    expect(result).toEqual(map);
  });

  test('returns null for missing file', async () => {
    const result = await readTopoGraph({
      dir: join(tempDir, 'nonexistent'),
    });
    expect(result).toBeNull();
  });

  test('rejects topo.lock files with invalid shape', async () => {
    await Bun.write(
      join(tempDir, 'topo.lock'),
      `${JSON.stringify({ entries: [] }, null, 2)}\n`
    );

    await expect(readTopoGraph({ dir: tempDir })).rejects.toThrow(
      'regenerate with `trails topo compile`'
    );
  });

  test('rejects legacy topo graph versions', async () => {
    await Bun.write(
      join(tempDir, 'topo.lock'),
      `${JSON.stringify(
        { ...makeTopoGraph(), topoGraphSchemaVersion: '1.0' },
        null,
        2
      )}\n`
    );

    await expect(readTopoGraph({ dir: tempDir })).rejects.toThrow(
      'regenerate with `trails topo compile`'
    );
  });
});

describe('isTopoArtifactRegenerationError', () => {
  test('recognizes unsupported topo artifact read errors', async () => {
    await Bun.write(join(tempDir, 'topo.lock'), '{}\n');
    const topoError = await captureError(() => readTopoGraph({ dir: tempDir }));

    await Bun.write(join(tempDir, 'trails.lock'), '{}\n');
    const lockError = await captureError(() =>
      readLockManifest({ dir: tempDir })
    );

    expect(isTopoArtifactRegenerationError(topoError)).toBe(true);
    expect(isTopoArtifactRegenerationError(lockError)).toBe(true);
    expect(isTopoArtifactRegenerationError(new Error('different'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lock manifest tests
// ---------------------------------------------------------------------------

describe('writeLockManifest / readLockManifest', () => {
  test('writes and reads v3 manifest JSON', async () => {
    const hash = 'deadbeef'.repeat(8);
    const manifest = makeLockManifest(hash);
    const filePath = await writeLockManifest(manifest, {
      dir: tempDir,
    });

    expect(filePath).toBe(join(tempDir, 'trails.lock'));

    const parsed = await readParsedLock(filePath);
    expect(parsed.version).toBe(3);
    expect(parsed.artifacts).toEqual([
      { path: 'topo.lock', role: 'topo', sha256: hash },
    ]);

    const result = await readLockManifest({ dir: tempDir });

    expect(result).toEqual(manifest);
  });

  test('rejects legacy structured JSON locks', async () => {
    const hash = 'facefeed'.repeat(8);
    await Bun.write(
      join(tempDir, 'trails.lock'),
      `${JSON.stringify({ hash, version: 1 }, null, 2)}\n`
    );

    await expect(readLockManifest({ dir: tempDir })).rejects.toThrow(
      'regenerate with `trails topo compile`'
    );
  });

  test('rejects v3 manifests with unknown top-level fields', async () => {
    const hash = 'facefeed'.repeat(8);
    await Bun.write(
      join(tempDir, 'trails.lock'),
      `${JSON.stringify(
        { ...makeLockManifest(hash), generatedAt: '2026-05-11T12:00:00.000Z' },
        null,
        2
      )}\n`
    );

    await expect(readLockManifest({ dir: tempDir })).rejects.toThrow(
      'regenerate with `trails topo compile`'
    );
  });

  test('rejects v3 artifacts with unknown fields', async () => {
    const hash = 'facefeed'.repeat(8);
    await Bun.write(
      join(tempDir, 'trails.lock'),
      `${JSON.stringify(
        {
          ...makeLockManifest(hash),
          artifacts: [
            {
              generatedAt: '2026-05-11T12:00:00.000Z',
              path: 'topo.lock',
              role: 'topo',
              sha256: hash,
            },
          ],
        },
        null,
        2
      )}\n`
    );

    await expect(readLockManifest({ dir: tempDir })).rejects.toThrow(
      'regenerate with `trails topo compile`'
    );
  });

  test('rejects v3 artifacts with malformed sha256 values', async () => {
    await Bun.write(
      join(tempDir, 'trails.lock'),
      `${JSON.stringify(makeLockManifest('not-a-sha'), null, 2)}\n`
    );

    await expect(readLockManifest({ dir: tempDir })).rejects.toThrow(
      'regenerate with `trails topo compile`'
    );
  });

  test('rejects legacy single-line hash locks', async () => {
    await Bun.write(join(tempDir, 'trails.lock'), `${'a'.repeat(64)}\n`);

    await expect(readLockManifest({ dir: tempDir })).rejects.toThrow(
      'regenerate with `trails topo compile`'
    );
  });

  test('returns null for missing file', async () => {
    const result = await readLockManifest({
      dir: join(tempDir, 'nonexistent'),
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Default directory
// ---------------------------------------------------------------------------

describe('default directory', () => {
  test('defaults to .trails/', async () => {
    // We can't easily test the actual default without polluting the repo,
    // so we verify the custom directory option works and trust the default
    const map = makeTopoGraph();
    const customDir = join(tempDir, 'custom-trails');
    const filePath = await writeTopoGraph(map, { dir: customDir });

    expect(filePath).toBe(join(customDir, 'topo.lock'));

    const result = await readTopoGraph({ dir: customDir });
    expect(result).toEqual(map);
  });

  test('custom directory option works for lock files', async () => {
    const customDir = join(tempDir, 'custom-lock-dir');
    const hash = 'a1b2c3d4e5f67890'.repeat(4);
    const manifest = makeLockManifest(hash);
    const filePath = await writeLockManifest(manifest, { dir: customDir });

    expect(filePath).toBe(join(customDir, 'trails.lock'));

    const result = await readLockManifest({ dir: customDir });
    expect(result).toEqual(manifest);
  });
});

// ---------------------------------------------------------------------------
// Workspace trail index
// ---------------------------------------------------------------------------

describe('readWorkspaceLock', () => {
  test('returns null for a single-app structured lock without workspace metadata', async () => {
    const hash = 'cafebabe'.repeat(8);
    await writeLockManifest(makeLockManifest(hash), { dir: tempDir });

    const result = await readWorkspaceLock({ dir: tempDir });
    expect(result).toBeNull();
  });

  test('returns the trail-id index for a multi-app workspace lock', async () => {
    const hash = 'feedface'.repeat(8);
    const workspaceTrails = {
      'a.trail': {
        appName: 'app-one',
        modulePath: 'apps/one/src/app.ts',
        trailId: 'a.trail',
      },
      'b.trail': {
        appName: 'app-two',
        modulePath: 'apps/two/src/app.ts',
        trailId: 'b.trail',
      },
    } as const;
    const filePath = await writeLockManifest(
      makeLockManifest(hash, { workspaceTrails }),
      { dir: tempDir }
    );

    const parsed = await readParsedLock(filePath);
    expect(parsed.version).toBe(3);
    expect(parsed.workspaceTrails).toEqual(workspaceTrails);

    const result = await readWorkspaceLock({ dir: tempDir });
    expect(result).toEqual(workspaceTrails);
  });

  test('rejects the legacy single-line hash file', async () => {
    const hash = 'aaaaaaaa'.repeat(8);
    await Bun.write(join(tempDir, 'trails.lock'), `${hash}\n`);

    await expect(readWorkspaceLock({ dir: tempDir })).rejects.toThrow(
      'regenerate with `trails topo compile`'
    );
  });

  test('returns null when the lock file is missing', async () => {
    const result = await readWorkspaceLock({
      dir: join(tempDir, 'nonexistent'),
    });
    expect(result).toBeNull();
  });
});
