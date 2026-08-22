import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { loadFreshAppLease } from '../trails/load-app.js';
import { deriveCurrentTopoExport } from '../trails/topo-store-support.js';

const appRoot = resolve(import.meta.dir, '../..');

const deriveFreshOperatorExport = async () => {
  const lease = await loadFreshAppLease('./src/app.ts', appRoot);
  try {
    const derived = deriveCurrentTopoExport(lease.app, {
      overlays: lease.overlays,
      rootDir: appRoot,
    });
    if (derived.isErr()) {
      throw derived.error;
    }
    return derived.value;
  } finally {
    lease.release();
  }
};

describe('operator lock determinism', () => {
  test('fresh imports derive identical graph bytes without temp-path examples', async () => {
    const first = await deriveFreshOperatorExport();
    const second = await deriveFreshOperatorExport();

    expect(second.topoGraphHash).toBe(first.topoGraphHash);
    expect(second.topoGraphJson).not.toContain('ontrails-trails-examples');
  });
});
