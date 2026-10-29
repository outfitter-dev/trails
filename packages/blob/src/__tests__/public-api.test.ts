import { expect, test } from 'bun:test';
import * as api from '@ontrails/blob';
import type { BlobResource, BlobStorage } from '@ontrails/blob';

test('public root exposes portable runtime APIs', () => {
  expect(Object.keys(api).toSorted()).toEqual([
    'blob',
    'blobInfoSchema',
    'blobListOptionsSchema',
    'blobListPageSchema',
    'blobPutOptionsSchema',
    'createBlobMock',
  ]);
  const definition: BlobResource = api.blob('uploads');
  const client: BlobStorage = api.createBlobMock();
  expect(definition.role).toBe('blob');
  expect(typeof client.put).toBe('function');
});

test('runtime root bundles for Workers without a Bun test runtime', async () => {
  const built = await Bun.build({
    entrypoints: [new URL('../index.ts', import.meta.url).pathname],
    format: 'esm',
    target: 'browser',
  });
  expect(built.success).toBe(true);
  const content = await built.outputs[0]?.text();
  expect(content).toBeDefined();
  expect(content).not.toContain('bun:test');
});
