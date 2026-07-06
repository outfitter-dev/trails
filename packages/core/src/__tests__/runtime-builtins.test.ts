import { describe, expect, test } from 'bun:test';

import { loadRuntimeBuiltin } from '../runtime-builtins.js';

describe('loadRuntimeBuiltin', () => {
  test('loads node builtins lazily and returns the live module', () => {
    const fs = loadRuntimeBuiltin('node:fs');
    expect(typeof fs.existsSync).toBe('function');
    const nodePath = loadRuntimeBuiltin('node:path');
    expect(nodePath.join('a', 'b')).toBe('a/b');
  });

  test('loads bun:sqlite through the same loader', () => {
    const sqlite = loadRuntimeBuiltin('bun:sqlite');
    expect(typeof sqlite.Database).toBe('function');
  });

  test('caches loaded modules by name', () => {
    expect(loadRuntimeBuiltin('node:fs')).toBe(loadRuntimeBuiltin('node:fs'));
  });
});
