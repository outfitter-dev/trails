/**
 * Miniflare integration lane: bundles the demo Worker fixture and executes it
 * under workerd. This is the local-first integration proof — no Cloudflare
 * account is required — covering HTTP routes, a webhook route, and the KV
 * resource served through the env bridge.
 */

import type { BunPlugin } from 'bun';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Miniflare } from 'miniflare';

const fixtureEntrypoint = new URL('fixtures/demo-worker.ts', import.meta.url)
  .pathname;

/**
 * Runtime-constraint audit workaround (TRL: bun:sqlite in the core barrel):
 * `@ontrails/core` re-exports `trails-db.js`, whose top-level
 * `import { Database } from 'bun:sqlite'` survives bundling even though the
 * Worker never touches it. workerd refuses module graphs that import
 * `bun:sqlite`, so Worker bundles must stub it — the same aliasing a wrangler
 * consumer would configure. Filed as a fix-or-document issue; remove this
 * stub once core stops importing bun:sqlite eagerly on the barrel path.
 */
const bunSqliteStub: BunPlugin = {
  name: 'stub-bun-sqlite',
  setup(build) {
    build.onResolve({ filter: /^bun:sqlite$/ }, () => ({
      namespace: 'bun-sqlite-stub',
      path: 'bun:sqlite',
    }));
    build.onLoad({ filter: /.*/, namespace: 'bun-sqlite-stub' }, () => ({
      contents:
        'export class Database { constructor() { throw new Error("bun:sqlite is unavailable on Cloudflare Workers"); } }',
      loader: 'js',
    }));
  },
};

const bundleWorkerScript = async (): Promise<string> => {
  const build = await Bun.build({
    entrypoints: [fixtureEntrypoint],
    external: ['node:*'],
    format: 'esm',
    minify: false,
    plugins: [bunSqliteStub],
    target: 'browser',
  });
  if (!build.success) {
    throw new Error(
      `Worker bundle failed: ${build.logs.map((log) => log.message).join('\n')}`
    );
  }
  const [output] = build.outputs;
  if (output === undefined) {
    throw new Error('Worker bundle produced no output');
  }
  return await output.text();
};

describe('demo worker under miniflare', () => {
  let mf: Miniflare;

  beforeAll(async () => {
    const script = await bundleWorkerScript();
    mf = new Miniflare({
      compatibilityDate: '2026-06-01',
      compatibilityFlags: ['nodejs_compat'],
      kvNamespaces: ['FLAGS'],
      modules: true,
      script,
    });
    await mf.ready;
  }, 120_000);

  afterAll(async () => {
    await mf.dispose();
  });

  test('serves a read trail over HTTP', async () => {
    const response = await mf.dispatchFetch('http://localhost/ping?message=hi');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { reply: 'pong:hi' } });
  });

  test('serves KV-backed write and read trails through the env bridge', async () => {
    const saved = await mf.dispatchFetch('http://localhost/flag/save', {
      body: JSON.stringify({ key: 'color', value: 'red' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ data: { saved: true } });

    const shown = await mf.dispatchFetch(
      'http://localhost/flag/show?key=color'
    );
    expect(shown.status).toBe(200);
    expect(await shown.json()).toEqual({ data: { value: 'red' } });
  });

  test('serves a webhook route with verification', async () => {
    const accepted = await mf.dispatchFetch(
      'http://localhost/webhooks/deploy',
      {
        body: JSON.stringify({ deployId: 'dep_1' }),
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': 'demo-secret',
        },
        method: 'POST',
      }
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ data: { deployId: 'dep_1' } });

    const recorded = await mf.dispatchFetch(
      'http://localhost/flag/show?key=deploy/dep_1'
    );
    expect(await recorded.json()).toEqual({ data: { value: 'finished' } });

    const denied = await mf.dispatchFetch('http://localhost/webhooks/deploy', {
      body: JSON.stringify({ deployId: 'dep_2' }),
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': 'wrong',
      },
      method: 'POST',
    });
    expect(denied.status).toBe(403);
  });

  test('returns the projected 404 for unknown routes', async () => {
    const response = await mf.dispatchFetch('http://localhost/nope');
    expect(response.status).toBe(404);
  });
});
