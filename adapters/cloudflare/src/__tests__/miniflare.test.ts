/**
 * Miniflare integration lane: bundles the demo Worker fixture and executes it
 * under workerd. This is the local-first integration proof — no Cloudflare
 * account is required — covering HTTP routes, a webhook route, and the KV
 * resource served through the env bridge.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Miniflare } from 'miniflare';

const fixtureEntrypoint = new URL('fixtures/demo-worker.ts', import.meta.url)
  .pathname;

/**
 * Portability gate (TRL-1198): the bundle is built with no `bun:sqlite`
 * stub, no `node:*` externals, and executed without `nodejs_compat`. Core
 * loads runtime builtins lazily, so the execution-path module graph must
 * be free of `bun:`/`node:` imports — an eager builtin import regressing
 * onto the barrel fails this bundle or the workerd boot below,
 * structurally, without an audit.
 */
const bundleWorkerScript = async (): Promise<string> => {
  const build = await Bun.build({
    entrypoints: [fixtureEntrypoint],
    format: 'esm',
    minify: false,
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
