import { test } from 'bun:test';
import { createBlobContractCases } from '@ontrails/blob/testing';
import { Miniflare } from 'miniflare';

import { createCloudflareBlobBinding } from '../index.js';
import type {
  CloudflareR2ListOptions,
  CloudflareR2PutOptions,
} from '../index.js';

// Bun cannot transfer this Miniflare Node proxy's R2 streams (DataCloneError).
// Perform native operations/body reads inside a Worker; never substitute memory storage.
const nativeWorker = `
const info = object => object === null ? null : ({key:object.key,size:object.size,httpMetadata:object.httpMetadata});
export default { async fetch(request, env) {
  const input = await request.json();
  const operation = new URL(request.url).pathname;
  try {
    if (operation === '/put') return Response.json(info(await env.BUCKET.put(input.key,new Uint8Array(input.bytes),input.options)));
    if (operation === '/get') {
      const object = await env.BUCKET.get(input.key);
      return Response.json(object === null ? null : {info:info(object),bytes:[...new Uint8Array(await object.arrayBuffer())]});
    }
    if (operation === '/head') return Response.json(info(await env.BUCKET.head(input.key)));
    if (operation === '/delete') { await env.BUCKET.delete(input.key); return Response.json(null); }
    const page = await env.BUCKET.list(input.options);
    return Response.json({objects:page.objects.map(info),truncated:page.truncated,cursor:page.cursor});
  } catch { return new Response('Native R2 operation failed', {status:500}); }
}};`;
interface NativeRead {
  readonly bytes: number[];
  readonly info: {
    key: string;
    size: number;
    httpMetadata: { contentType?: string };
  };
}

for (const example of createBlobContractCases({
  createSubject: async () => {
    const runtime = new Miniflare({
      compatibilityDate: '2026-06-01',
      modules: true,
      r2Buckets: ['BUCKET'],
      script: nativeWorker,
    });
    try {
      await runtime.ready;
      const invoke = async <T>(
        operation: string,
        input: unknown
      ): Promise<T> => {
        const response = await runtime.dispatchFetch(
          `http://localhost/${operation}`,
          {
            body: JSON.stringify(input),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          }
        );
        if (!response.ok) {
          throw new Error(await response.text());
        }
        // The test-owned bridge returns native facts; the production client validates them.
        return response.json() as Promise<T>;
      };
      const native = {
        delete: (key: string) => invoke('delete', { key }),
        get: async (key: string) => {
          const value = await invoke<NativeRead | null>('get', { key });
          return value === null
            ? null
            : {
                ...value.info,
                body: new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(new Uint8Array(value.bytes));
                    controller.close();
                  },
                }),
              };
        },
        head: (key: string) => invoke('head', { key }),
        list: (options: CloudflareR2ListOptions) => invoke('list', { options }),
        put: (key: string, data: Uint8Array, options: CloudflareR2PutOptions) =>
          invoke('put', { bytes: [...data], key, options }),
      };
      return {
        client: createCloudflareBlobBinding(native, { maxBufferedBytes: 5 }),
        dispose: () => runtime.dispose(),
      };
    } catch (error) {
      await runtime.dispose();
      throw error;
    }
  },
})) {
  test(`native Cloudflare ${example.name}`, example.check, 30_000);
}
