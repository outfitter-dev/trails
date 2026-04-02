import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { trail, topo, Result } from '@ontrails/core';
import { hashSurfaceMap, generateSurfaceMap } from '@ontrails/schema';
import { z } from 'zod';

import { checkDrift } from '../drift.js';

const makeTopo = () => {
  const t = trail('test.hello', {
    blaze: () => Result.ok({ greeting: 'hi' }),
    input: z.object({ name: z.string() }),
    output: z.object({ greeting: z.string() }),
  });
  return topo('test-app', { t });
};

const createTempDir = (): string => {
  const dir = join(tmpdir(), `drift-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe('checkDrift', () => {
  test('returns stale: false when no topo is provided', async () => {
    const result = await checkDrift('/tmp');
    expect(result.stale).toBe(false);
    expect(result.currentHash).toBe('unknown');
  });

  test('returns stale: false when no lock file exists', async () => {
    const dir = createTempDir();
    try {
      const result = await checkDrift(dir, makeTopo());
      expect(result.stale).toBe(false);
      expect(result.committedHash).toBeNull();
      expect(result.currentHash.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('returns stale: false when lock matches current hash', async () => {
    const dir = createTempDir();
    try {
      const tp = makeTopo();
      const hash = hashSurfaceMap(generateSurfaceMap(tp));
      writeFileSync(join(dir, 'surface.lock'), `${hash}\n`);

      const result = await checkDrift(dir, tp);
      expect(result.stale).toBe(false);
      expect(result.committedHash).toBe(hash);
      expect(result.currentHash).toBe(hash);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('returns stale: true when lock does not match', async () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, 'surface.lock'), 'outdated-hash\n');

      const result = await checkDrift(dir, makeTopo());
      expect(result.stale).toBe(true);
      expect(result.committedHash).toBe('outdated-hash');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
