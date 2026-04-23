import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { loadApp, loadFreshAppLease } from '../trails/load-app.js';

const writeLoadAppFixture = (cwd: string, name: string): void => {
  writeFileSync(
    resolve(cwd, 'src/app.ts'),
    `export const app = {
  name: '${name}',
  trails: new Map(),
  signals: new Map(),
  resources: new Map()
};`
  );
};

const assertLoadAppCaching = async (cwd: string): Promise<void> => {
  writeLoadAppFixture(cwd, 'first');

  const first = await loadApp('./src/app.ts', cwd);

  writeLoadAppFixture(cwd, 'second');

  const cached = await loadApp('./src/app.ts', cwd);
  const fresh = await loadApp('./src/app.ts', cwd, { fresh: true });

  expect(first.name).toBe('first');
  expect(cached.name).toBe('first');
  expect(fresh.name).toBe('second');
};

const writeDependentLoadAppFixture = (cwd: string, name: string): void => {
  writeFileSync(resolve(cwd, 'src/name.ts'), `export const name = '${name}';`);
  writeFileSync(
    resolve(cwd, 'src/app.ts'),
    `import { name } from './name.ts';

export const app = {
  name,
  trails: new Map(),
  signals: new Map(),
  resources: new Map()
};`
  );
};

const writeJsSpecifierLoadAppFixture = (cwd: string, name: string): void => {
  writeFileSync(resolve(cwd, 'src/name.ts'), `export const name = '${name}';`);
  writeFileSync(
    resolve(cwd, 'src/app.ts'),
    `import { name } from './name.js';

export const app = {
  name,
  trails: new Map(),
  signals: new Map(),
  resources: new Map()
};`
  );
};

const assertLoadAppDependencyCaching = async (cwd: string): Promise<void> => {
  writeDependentLoadAppFixture(cwd, 'first');

  const first = await loadApp('./src/app.ts', cwd);

  writeDependentLoadAppFixture(cwd, 'second');

  const cached = await loadApp('./src/app.ts', cwd);
  const fresh = await loadApp('./src/app.ts', cwd, { fresh: true });

  expect(first.name).toBe('first');
  expect(cached.name).toBe('first');
  expect(fresh.name).toBe('second');
};

const assertLoadAppJsSpecifierCaching = async (cwd: string): Promise<void> => {
  writeJsSpecifierLoadAppFixture(cwd, 'first');

  const first = await loadApp('./src/app.ts', cwd);

  writeJsSpecifierLoadAppFixture(cwd, 'second');

  const cached = await loadApp('./src/app.ts', cwd);
  const fresh = await loadApp('./src/app.ts', cwd, { fresh: true });

  expect(first.name).toBe('first');
  expect(cached.name).toBe('first');
  expect(fresh.name).toBe('second');
};

const writeGraphFixture = (cwd: string, name: string): void => {
  writeFileSync(
    resolve(cwd, 'src/app.ts'),
    `export const graph = {
  name: '${name}',
  trails: new Map(),
  signals: new Map(),
  resources: new Map()
};`
  );
};

const writeWorkspaceDependencyFixture = (cwd: string): void => {
  writeFileSync(
    resolve(cwd, 'src/app.ts'),
    `import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const sample = trail('sample', {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

export const app = topo('fixture', { sample });
`
  );
};

// Bytes that are intentionally not valid UTF-8. Decoding then re-encoding
// would replace them with U+FFFD and corrupt the file.
const BINARY_SIBLING_BYTES = new Uint8Array([
  0, 1, 2, 255, 254, 253, 192, 193, 245, 255, 128, 129,
]);

const BINARY_SIBLING_APP_SOURCE = `import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bytes = readFileSync(resolve(here, 'blob.bin'));

export const app = {
  name: Array.from(bytes).join(','),
  trails: new Map(),
  signals: new Map(),
  resources: new Map()
};`;

const assertLoadAppPreservesBinarySiblings = async (
  cwd: string
): Promise<void> => {
  mkdirSync(resolve(cwd, 'src'), { recursive: true });
  writeFileSync(resolve(cwd, 'src/blob.bin'), BINARY_SIBLING_BYTES);
  writeFileSync(resolve(cwd, 'src/app.ts'), BINARY_SIBLING_APP_SOURCE);

  const fresh = await loadApp('./src/app.ts', cwd, { fresh: true });
  const originalBytes = readFileSync(resolve(cwd, 'src/blob.bin'));
  const expected = [...originalBytes].join(',');
  expect(fresh.name).toBe(expected);
};

/**
 * Seed a stale mirror dir under `.trails-tmp/` with an mtime well past the
 * 10-minute freshness threshold, simulating a directory abandoned by a
 * signal-killed process.
 */
const seedStaleMirrorDir = (cwd: string): string => {
  mkdirSync(resolve(cwd, 'src'), { recursive: true });
  writeLoadAppFixture(cwd, 'stale-cleanup');
  const mirrorParent = resolve(cwd, '.trails-tmp');
  const staleDir = resolve(mirrorParent, 'load-app-fresh-stale-fixture');
  mkdirSync(staleDir, { recursive: true });
  writeFileSync(resolve(staleDir, 'marker'), 'stale');
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(staleDir, oneHourAgo, oneHourAgo);
  return staleDir;
};

const assertStaleDirCleaned = (cwd: string, staleDir: string): void => {
  expect(existsSync(staleDir)).toBe(false);
  const mirrorParent = resolve(cwd, '.trails-tmp');
  const remaining = readdirSync(mirrorParent).filter((entry) =>
    entry.startsWith('load-app-fresh-')
  );
  expect(remaining.length).toBeGreaterThan(0);
};

const countFreshMirrorRoots = (cwd: string): number => {
  const mirrorParent = resolve(cwd, '.trails-tmp');
  if (!existsSync(mirrorParent)) {
    return 0;
  }

  return readdirSync(mirrorParent).filter((entry) =>
    entry.startsWith('load-app-fresh-')
  ).length;
};

const workspaceTmpRoot = resolve(import.meta.dir, '../..', '.tmp-tests');

describe('loadApp', () => {
  afterAll(() => {
    rmSync(workspaceTmpRoot, { force: true, recursive: true });
  });

  test('resolves named graph export', async () => {
    const cwd = resolve(
      tmpdir(),
      `trails-load-graph-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    try {
      mkdirSync(resolve(cwd, 'src'), { recursive: true });
      writeGraphFixture(cwd, 'graph-test');
      const loaded = await loadApp('./src/app.ts', cwd);
      expect(loaded.name).toBe('graph-test');
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test('resolves relative module paths from cwd', async () => {
    // import.meta.dir is src/__tests__/, go up two to get apps/trails/
    const cwd = resolve(import.meta.dir, '../..');
    const app = await loadApp('./src/app.ts', cwd);

    expect(app.name).toBe('trails');
    expect(app.get('survey')).toBeDefined();
  });

  test('can bypass module caching with fresh loading', async () => {
    const cwd = resolve(
      tmpdir(),
      `trails-load-app-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    try {
      mkdirSync(resolve(cwd, 'src'), { recursive: true });
      await assertLoadAppCaching(cwd);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test('fresh loading reloads transitive local imports', async () => {
    const cwd = resolve(
      tmpdir(),
      `trails-load-app-deps-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    try {
      mkdirSync(resolve(cwd, 'src'), { recursive: true });
      await assertLoadAppDependencyCaching(cwd);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test('fresh loading resolves .js specifiers to local .ts sources', async () => {
    const cwd = resolve(
      tmpdir(),
      `trails-load-app-js-specifier-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
    );

    try {
      mkdirSync(resolve(cwd, 'src'), { recursive: true });
      await assertLoadAppJsSpecifierCaching(cwd);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test('fresh loading mirrors siblings reached via computed dynamic imports', async () => {
    const cwd = resolve(
      tmpdir(),
      `trails-load-app-dynamic-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
    );

    try {
      mkdirSync(resolve(cwd, 'src/parts'), { recursive: true });
      writeFileSync(
        resolve(cwd, 'src/parts/alpha.ts'),
        `export const label = 'alpha';`
      );
      writeFileSync(
        resolve(cwd, 'src/parts/beta.ts'),
        `export const label = 'beta';`
      );
      writeFileSync(
        resolve(cwd, 'src/app.ts'),
        `const which = 'beta';
const mod = await import(\`./parts/\${which}.ts\`);

export const app = {
  name: mod.label,
  trails: new Map(),
  signals: new Map(),
  resources: new Map()
};`
      );

      const fresh = await loadApp('./src/app.ts', cwd, { fresh: true });
      expect(fresh.name).toBe('beta');
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test('fresh loading preserves binary sibling bytes in the mirror', async () => {
    const cwd = resolve(
      tmpdir(),
      `trails-load-app-binary-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
    );

    try {
      await assertLoadAppPreservesBinarySiblings(cwd);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test('fresh loading opportunistically cleans up stale mirror roots', async () => {
    const cwd = resolve(
      tmpdir(),
      `trails-load-app-stale-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
    );

    try {
      const staleDir = seedStaleMirrorDir(cwd);
      await loadApp('./src/app.ts', cwd, { fresh: true });
      assertStaleDirCleaned(cwd, staleDir);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});

describe('loadApp fresh lifecycle', () => {
  test('leased fresh loads remove their mirror root when released', async () => {
    const cwd = resolve(
      tmpdir(),
      `trails-load-app-lease-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
    );

    try {
      mkdirSync(resolve(cwd, 'src'), { recursive: true });
      writeLoadAppFixture(cwd, 'leased');

      const lease = await loadFreshAppLease('./src/app.ts', cwd);

      expect(lease.app.name).toBe('leased');
      expect(existsSync(lease.mirrorRoot)).toBe(true);

      lease.release();

      expect(existsSync(lease.mirrorRoot)).toBe(false);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test('fresh loading retains mirrors so deferred imports from earlier apps still resolve', async () => {
    const cwd = resolve(
      tmpdir(),
      `trails-load-app-retained-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
    );

    try {
      mkdirSync(resolve(cwd, 'src'), { recursive: true });

      for (let index = 0; index < 6; index += 1) {
        writeLoadAppFixture(cwd, `retained-${String(index)}`);
        await loadApp('./src/app.ts', cwd, { fresh: true });
      }

      // All fresh mirrors stay on disk for the lifetime of the process so a
      // previously returned Topo can still resolve deferred relative
      // `import()` calls. Cleanup happens on process exit, not by LRU age.
      expect(countFreshMirrorRoots(cwd)).toBe(6);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test('fresh loading preserves workspace package resolution for mirrored apps', async () => {
    const cwd = resolve(
      workspaceTmpRoot,
      `trails-load-app-workspace-deps-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
    );

    try {
      mkdirSync(resolve(cwd, 'src'), { recursive: true });
      writeWorkspaceDependencyFixture(cwd);

      const app = await loadApp('./src/app.ts', cwd, { fresh: true });

      expect(app.name).toBe('fixture');
      expect(app.get('sample')).toBeDefined();
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
