import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { AmbiguousError, NotFoundError } from '@ontrails/core';

import { findAppModuleCandidates, findAppModule } from '../discover.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTempDir = (): string => {
  const dir = join(
    tmpdir(),
    `trails-discover-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const touchFile = (dir: string, relativePath: string): void => {
  const fullPath = join(dir, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, '// stub');
};

// ---------------------------------------------------------------------------
// findAppModuleCandidates
// ---------------------------------------------------------------------------

describe('findAppModuleCandidates', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  test('finds src/app.ts in single-app layout', () => {
    touchFile(tempDir, 'src/app.ts');

    const result = findAppModuleCandidates(tempDir);

    expect(result).toEqual(['src/app.ts']);
  });

  test('finds apps/*/src/app.ts in monorepo layout', () => {
    touchFile(tempDir, 'apps/myapp/src/app.ts');

    const result = findAppModuleCandidates(tempDir);

    expect(result).toEqual(['apps/myapp/src/app.ts']);
  });

  test('returns empty array when nothing found', () => {
    const result = findAppModuleCandidates(tempDir);

    expect(result).toEqual([]);
  });

  test('finds both single-app and monorepo candidates', () => {
    touchFile(tempDir, 'src/app.ts');
    touchFile(tempDir, 'apps/alpha/src/app.ts');
    touchFile(tempDir, 'apps/beta/src/app.ts');

    const result = findAppModuleCandidates(tempDir);

    expect(result).toHaveLength(3);
    expect(result).toContain('src/app.ts');
    expect(result).toContain('apps/alpha/src/app.ts');
    expect(result).toContain('apps/beta/src/app.ts');
  });

  test('returns single-app candidate first', () => {
    touchFile(tempDir, 'src/app.ts');
    touchFile(tempDir, 'apps/myapp/src/app.ts');

    const result = findAppModuleCandidates(tempDir);

    expect(result[0]).toBe('src/app.ts');
  });
});

// ---------------------------------------------------------------------------
// findAppModule
// ---------------------------------------------------------------------------

describe('findAppModule', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  test('returns explicit module path when provided', () => {
    const result = findAppModule(tempDir, './custom/entry.ts');

    expect(result).toBe('./custom/entry.ts');
  });

  test('returns single discovered module', () => {
    touchFile(tempDir, 'src/app.ts');

    const result = findAppModule(tempDir);

    expect(result).toBe('src/app.ts');
  });

  test('throws AmbiguousError for multiple candidates', () => {
    touchFile(tempDir, 'src/app.ts');
    touchFile(tempDir, 'apps/alpha/src/app.ts');

    expect(() => findAppModule(tempDir)).toThrow(AmbiguousError);
  });

  test('ambiguous error message lists candidates and suggests --module', () => {
    touchFile(tempDir, 'src/app.ts');
    touchFile(tempDir, 'apps/alpha/src/app.ts');

    try {
      findAppModule(tempDir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AmbiguousError);
      const { message } = error as AmbiguousError;
      expect(message).toContain('--module');
      expect(message).toContain('src/app.ts');
      expect(message).toContain('apps/alpha/src/app.ts');
    }
  });

  test('throws NotFoundError when no candidates found', () => {
    expect(() => findAppModule(tempDir)).toThrow(NotFoundError);
  });

  test('not-found error message is helpful', () => {
    try {
      findAppModule(tempDir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      const { message } = error as NotFoundError;
      expect(message).toContain('src/app.ts');
    }
  });
});
