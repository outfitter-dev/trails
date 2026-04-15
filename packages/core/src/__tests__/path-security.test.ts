import { describe, test, expect } from 'bun:test';
import { resolve, join } from 'node:path';

import { PermissionError } from '../errors.js';
import { securePath, isPathSafe, deriveSafePath } from '../path-security.js';

// ---------------------------------------------------------------------------
// securePath
// ---------------------------------------------------------------------------

describe('securePath', () => {
  const base = '/project/workspace';

  test('resolves a simple relative path', () => {
    const result = securePath(base, 'src/index.ts');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(resolve(base, 'src/index.ts'));
  });

  test('resolves nested paths', () => {
    const result = securePath(base, 'src/../lib/utils.ts');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(resolve(base, 'lib/utils.ts'));
  });

  test('accepts the base directory itself', () => {
    const result = securePath(base, '.');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(resolve(base));
  });

  test('rejects path traversal with ..', () => {
    const result = securePath(base, '../../etc/passwd');
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: PermissionError };
    expect(err.error).toBeInstanceOf(PermissionError);
    expect(err.error.message).toContain('Path traversal detected');
  });

  test('rejects absolute paths outside base', () => {
    const result = securePath(base, '/etc/passwd');
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: PermissionError };
    expect(err.error).toBeInstanceOf(PermissionError);
  });

  test('rejects sneaky traversal (subdir/../../..)', () => {
    const result = securePath(base, 'src/../../..');
    expect(result.isErr()).toBe(true);
  });

  test('allows paths that mention .. but stay inside', () => {
    const result = securePath(base, 'src/../src/file.ts');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(resolve(base, 'src/file.ts'));
  });
});

// ---------------------------------------------------------------------------
// isPathSafe
// ---------------------------------------------------------------------------

describe('isPathSafe', () => {
  const base = '/project/workspace';

  test('returns true for child paths', () => {
    expect(isPathSafe(base, 'src/index.ts')).toBe(true);
  });

  test('returns true for the base directory', () => {
    expect(isPathSafe(base, '.')).toBe(true);
  });

  test('returns false for traversal', () => {
    expect(isPathSafe(base, '../secret')).toBe(false);
  });

  test('returns false for absolute paths outside base', () => {
    expect(isPathSafe(base, '/tmp/evil')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveSafePath
// ---------------------------------------------------------------------------

describe('deriveSafePath', () => {
  const base = '/project/workspace';

  test('joins multiple segments safely', () => {
    const result = deriveSafePath(base, 'src', 'lib', 'utils.ts');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(join(resolve(base), 'src', 'lib', 'utils.ts'));
  });

  test('rejects when segments escape the base', () => {
    const result = deriveSafePath(base, 'src', '../../../etc');
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: PermissionError };
    expect(err.error).toBeInstanceOf(PermissionError);
  });

  test('handles single segment', () => {
    const result = deriveSafePath(base, 'file.txt');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(resolve(base, 'file.txt'));
  });

  test('handles empty segments', () => {
    const result = deriveSafePath(base);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(resolve(base));
  });
});
