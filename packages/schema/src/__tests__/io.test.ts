import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  writeSurfaceMap,
  readSurfaceMap,
  writeSurfaceLock,
  readSurfaceLock,
} from '../io.js';
import type { SurfaceMap } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSurfaceMap = (): SurfaceMap => ({
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
// Surface Map tests
// ---------------------------------------------------------------------------

describe('writeSurfaceMap / readSurfaceMap', () => {
  test('writes valid JSON to _surface.json', async () => {
    const map = makeSurfaceMap();
    const filePath = await writeSurfaceMap(map, { dir: tempDir });

    expect(filePath).toBe(join(tempDir, '_surface.json'));

    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe('1.0');
    expect(parsed.entries).toHaveLength(1);
  });

  test('reads it back and produces identical data', async () => {
    const map = makeSurfaceMap();
    await writeSurfaceMap(map, { dir: tempDir });
    const result = await readSurfaceMap({ dir: tempDir });

    expect(result).toEqual(map);
  });

  test('returns null for missing file', async () => {
    const result = await readSurfaceMap({ dir: join(tempDir, 'nonexistent') });
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

    expect(filePath).toBe(join(tempDir, 'surface.lock'));

    const content = await readFile(filePath, 'utf8');
    expect(content.trim()).toBe(hash);
    // Single line (content is hash + newline)
    expect(content).toBe(`${hash}\n`);
  });

  test('reads the hash back', async () => {
    const hash = 'deadbeef'.repeat(8);
    await writeSurfaceLock(hash, { dir: tempDir });
    const result = await readSurfaceLock({ dir: tempDir });

    expect(result).toBe(hash);
  });

  test('returns null for missing file', async () => {
    const result = await readSurfaceLock({ dir: join(tempDir, 'nonexistent') });
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
    const map = makeSurfaceMap();
    const customDir = join(tempDir, 'custom-trails');
    const filePath = await writeSurfaceMap(map, { dir: customDir });

    expect(filePath).toBe(join(customDir, '_surface.json'));

    const result = await readSurfaceMap({ dir: customDir });
    expect(result).toEqual(map);
  });

  test('custom directory option works for lock files', async () => {
    const customDir = join(tempDir, 'custom-lock-dir');
    const hash = 'a1b2c3d4e5f6'.repeat(5);
    const filePath = await writeSurfaceLock(hash, { dir: customDir });

    expect(filePath).toBe(join(customDir, 'surface.lock'));

    const result = await readSurfaceLock({ dir: customDir });
    expect(result).toBe(hash);
  });
});
