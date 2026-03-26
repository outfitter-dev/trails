import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { loadApp } from '../trails/load-app.js';

describe('loadApp', () => {
  test('resolves relative module paths from cwd', async () => {
    // import.meta.dir is src/__tests__/, go up two to get apps/trails/
    const cwd = resolve(import.meta.dir, '../..');
    const app = await loadApp('./src/app.ts', cwd);

    expect(app.name).toBe('trails');
    expect(app.get('survey')).toBeDefined();
  });
});
