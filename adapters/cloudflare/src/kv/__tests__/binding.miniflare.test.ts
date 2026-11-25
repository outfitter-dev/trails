import { test } from 'bun:test';
import { createKvContractCases } from '@ontrails/kv/testing';
import { Miniflare } from 'miniflare';

import { createCloudflareKvBinding } from '../index.js';

for (const example of createKvContractCases({
  createSubject: async () => {
    const runtime = new Miniflare({
      compatibilityDate: '2026-06-01',
      kvNamespaces: ['FLAGS'],
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } };',
    });
    try {
      const native = await runtime.getKVNamespace('FLAGS');
      return {
        advanceTime: async (milliseconds: number) => {
          // Real expiry, including the native store's whole-second boundary.
          await Bun.sleep(milliseconds + 1000);
        },
        client: createCloudflareKvBinding(native),
        dispose: () => runtime.dispose(),
      };
    } catch (error) {
      await runtime.dispose();
      throw error;
    }
  },
})) {
  test(`native Cloudflare ${example.name}`, example.check, 120_000);
}
