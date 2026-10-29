import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Miniflare } from 'miniflare';

let runtime: Miniflare;
const post = (path: string, body: unknown) =>
  runtime.dispatchFetch(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
const eventually = async (
  key: string,
  accept: (value: string | null) => boolean
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await runtime.dispatchFetch(
      `http://localhost/flag/read?key=${key}`
    );
    const value = (await response.json()) as { data: { value: string | null } };
    if (accept(value.data.value)) {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`No matching native consumer receipt for ${key}`);
};

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: [
      new URL('fixtures/role-bindings-worker.ts', import.meta.url).pathname,
    ],
    format: 'esm',
    target: 'browser',
  });
  expect(build.success).toBe(true);
  const [output] = build.outputs;
  if (output === undefined) {
    throw new Error('Missing Worker bundle');
  }
  runtime = new Miniflare({
    compatibilityDate: '2026-06-01',
    kvNamespaces: ['FLAGS'],
    modules: true,
    queueConsumers: {
      failures: { maxBatchSize: 1, maxRetries: 1, retryDelay: 0 },
      jobs: { maxBatchSize: 1 },
    },
    queueProducers: { FAILURES: 'failures', JOBS: 'jobs' },
    r2Buckets: ['BUCKET'],
    script: await output.text(),
  });
  await runtime.ready;
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
});

test('portable resources use actual Worker KV and R2 bindings with native byte streaming', async () => {
  const written = await post('/flag/write', { key: 'color', value: 'blue' });
  expect(written.status).toBe(200);
  const read = await runtime.dispatchFetch(
    'http://localhost/flag/read?key=color'
  );
  expect(await read.json()).toEqual({ data: { value: 'blue' } });
  const stored = await post('/file/write', { key: 'file' });
  expect(await stored.json()).toEqual({
    data: { key: 'file', mimeType: 'application/x-test', size: 3 },
  });
  const body = await runtime.dispatchFetch(
    'http://localhost/file/read?key=file'
  );
  expect(body.headers.get('Content-Type')).toBe('application/x-test');
  // workerd controls Content-Length for streams; stored metadata and received bytes prove size.
  expect([...new Uint8Array(await body.arrayBuffer())]).toEqual([1, 2, 3]);
});

test('native producer reaches core consumer parsing and env-resolved role resources', async () => {
  const response = await post('/job/submit', { count: '7' });
  expect(response.status).toBe(200);
  await eventually('received', (value) => value === '8');
}, 10_000);

test('composed producer failure remains retryable through actual native core-consumer delivery', async () => {
  const response = await post('/failure/submit', { id: 'retry' });
  expect(response.status).toBe(200);
  await eventually('failure-attempts', (value) => Number(value) >= 2);
}, 10_000);
