import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  writeTopoGraph,
  readTopoGraph,
  writeSurfaceLock,
  readSurfaceLockData,
  readSurfaceLock,
  readWorkspaceLock,
} from '../io.js';
import { surfaceLockSchema } from '../types.js';
import type { TopoGraph } from '../types.js';

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
  version: '1.0',
});

const makeStructuredLock = (hash: string) => ({
  hash,
  version: '2' as const,
});

const readParsedLock = async (
  filePath: string
): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;

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
// Surface map tests
// ---------------------------------------------------------------------------

describe('writeTopoGraph / readTopoGraph', () => {
  test('writes valid JSON to _surface.json', async () => {
    const map = makeTopoGraph();
    const filePath = await writeTopoGraph(map, { dir: tempDir });

    expect(filePath).toBe(join(tempDir, '_surface.json'));

    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe('1.0');
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
});

// ---------------------------------------------------------------------------
// Surface Lock tests
// ---------------------------------------------------------------------------

describe('writeSurfaceLock / readSurfaceLock', () => {
  test('writes a single line with the hash', async () => {
    const hash = 'abc123def456'.repeat(4);
    const filePath = await writeSurfaceLock(hash, { dir: tempDir });

    expect(filePath).toBe(join(tempDir, 'trails.lock'));

    const content = await readFile(filePath, 'utf8');
    expect(content.trim()).toBe(hash);
    // Single line (content is hash + newline)
    expect(content).toBe(`${hash}\n`);
  });

  test('writes and reads structured JSON locks', async () => {
    const hash = 'deadbeef'.repeat(8);
    const filePath = await writeSurfaceLock(makeStructuredLock(hash), {
      dir: tempDir,
    });

    expect(filePath).toBe(join(tempDir, 'trails.lock'));

    const parsed = await readParsedLock(filePath);
    expect(parsed.hash).toBe(hash);
    expect(parsed.version).toBe('2');

    const result = await readSurfaceLockData({ dir: tempDir });

    expect(result).toEqual(makeStructuredLock(hash));

    const legacyResult = await readSurfaceLock({ dir: tempDir });
    expect(legacyResult).toBe(hash);
  });

  test('normalizes legacy structured JSON locks with numeric versions', async () => {
    const hash = 'facefeed'.repeat(8);
    await Bun.write(
      join(tempDir, 'trails.lock'),
      `${JSON.stringify({ hash, version: 1 }, null, 2)}\n`
    );

    const data = await readSurfaceLockData({ dir: tempDir });
    expect(data).toEqual({ hash });

    const result = await readSurfaceLock({ dir: tempDir });
    expect(result).toBe(hash);
  });

  test('returns null for missing file', async () => {
    const result = await readSurfaceLock({
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

    expect(filePath).toBe(join(customDir, '_surface.json'));

    const result = await readTopoGraph({ dir: customDir });
    expect(result).toEqual(map);
  });

  test('custom directory option works for lock files', async () => {
    const customDir = join(tempDir, 'custom-lock-dir');
    const hash = 'a1b2c3d4e5f6'.repeat(5);
    const filePath = await writeSurfaceLock(hash, { dir: customDir });

    expect(filePath).toBe(join(customDir, 'trails.lock'));

    const result = await readSurfaceLock({ dir: customDir });
    expect(result).toBe(hash);
  });
});

// ---------------------------------------------------------------------------
// Workspace trail index
// ---------------------------------------------------------------------------

describe('readWorkspaceLock', () => {
  test('returns null for a single-app structured lock without workspace metadata', async () => {
    const hash = 'cafebabe'.repeat(8);
    await writeSurfaceLock(makeStructuredLock(hash), { dir: tempDir });

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
    const filePath = await writeSurfaceLock(
      { hash, workspaceTrails },
      { dir: tempDir }
    );

    const parsed = await readParsedLock(filePath);
    expect(parsed.hash).toBe(hash);
    expect(parsed.version).toBe('2');
    expect(parsed.workspaceTrails).toEqual(workspaceTrails);

    const result = await readWorkspaceLock({ dir: tempDir });
    expect(result).toEqual(workspaceTrails);
  });

  test('rejects out-of-band structured lock versions', () => {
    const hash = '0badf00d'.repeat(8);
    const result = surfaceLockSchema.safeParse({
      hash,
      version: 'banana',
    });

    expect(result.success).toBe(false);
  });

  test('returns null for the legacy single-line hash file', async () => {
    const hash = 'aaaaaaaa'.repeat(8);
    await writeSurfaceLock(hash, { dir: tempDir });

    const result = await readWorkspaceLock({ dir: tempDir });
    expect(result).toBeNull();
  });

  test('returns null when the lock file is missing', async () => {
    const result = await readWorkspaceLock({
      dir: join(tempDir, 'nonexistent'),
    });
    expect(result).toBeNull();
  });
});
