import { expect, test } from 'bun:test';
import * as api from '@ontrails/kv';
import type { Kv, KvListPage, KvResource } from '@ontrails/kv';

test('public exports expose the canonical contract and schemas', () => {
  expect(Object.keys(api).toSorted()).toEqual([
    'createKvMock',
    'kv',
    'kvListOptionsSchema',
    'kvListPageSchema',
    'kvPutOptionsSchema',
  ]);
  const resource: KvResource = api.kv('flags');
  const client: Kv = api.createKvMock();
  const page: KvListPage = { complete: false, cursor: 'opaque', keys: [] };
  expect(resource.role).toBe('kv');
  expect(typeof client.get).toBe('function');
  expect(api.kvListPageSchema.safeParse(page).success).toBe(true);
});

test('runtime root bundles for Workers without test-runner or Bun dependencies', async () => {
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
