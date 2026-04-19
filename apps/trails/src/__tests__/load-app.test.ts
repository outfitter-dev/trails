import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { loadApp } from '../trails/load-app.js';

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
