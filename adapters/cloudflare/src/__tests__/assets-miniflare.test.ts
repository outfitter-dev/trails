import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';

test('native assets binding serves only dispatcher misses with Worker-first routing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trails-assets-test-'));
  let runtime: Miniflare | undefined;
  try {
    await writeFile(join(directory, 'index.html'), '<h1>Static site</h1>');
    // These files would hide the authored routes if assets ran first.
    await writeFile(join(directory, 'ping'), 'wrong static ping');
    await writeFile(join(directory, 'missing'), 'wrong static missing');
    await writeFile(join(directory, 'mcp'), 'wrong static MCP');
    const build = await Bun.build({
      entrypoints: [
        new URL('fixtures/assets-worker.ts', import.meta.url).pathname,
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
      assets: {
        binding: 'ASSETS',
        directory,
        routerConfig: {
          has_user_worker: true,
          invoke_user_worker_ahead_of_assets: true,
        },
      },
      compatibilityDate: '2026-06-01',
      modules: true,
      script: await output.text(),
    });
    await runtime.ready;
    const asset = await runtime.dispatchFetch('http://localhost/');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('<h1>Static site</h1>');
    const ping = await runtime.dispatchFetch('http://localhost/ping');
    expect(await ping.json()).toEqual({ data: { reply: 'pong' } });
    const missing = await runtime.dispatchFetch('http://localhost/missing');
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('authored missing');
    const mcp = await runtime.dispatchFetch('http://localhost/mcp');
    expect(mcp.status).toBe(404);
    expect(await mcp.text()).toBe('MCP test double');
    const absent = await runtime.dispatchFetch('http://localhost/not-an-asset');
    expect(absent.status).toBe(404);
  } finally {
    await runtime?.dispose();
    await rm(directory, { force: true, recursive: true });
  }
}, 120_000);
