import { describe, expect, test } from 'bun:test';
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

describe('loadApp', () => {
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
});
