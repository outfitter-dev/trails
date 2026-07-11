/**
 * Env bridge regression tests.
 *
 * The load-bearing guarantee: Worker bindings arrive per-request on `env`,
 * and no resource instance may serve a request with a stale env. A request
 * carrying a new env object must re-resolve every env-bound resource.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { cloudflareKv, createMemoryKv } from '../../kv/index.js';
import { createWorkersHandler } from '../index.js';

const flags = cloudflareKv('flags', { binding: 'FLAGS' });

const showFlag = trail('flag.show', {
  implementation: async (input, ctx) => {
    const value = await flags.from(ctx).get(input.key);
    return Result.ok({ value });
  },
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string().nullable() }),
  resources: [flags],
});

const buildGraph = () => topo('cf-env-bridge', { flags, showFlag });

const flagRequest = (): Request =>
  new Request('http://localhost/flag/show?key=color');

const readValue = async (response: Response): Promise<unknown> => {
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { value: unknown } };
  return body.data.value;
};

let originalConsoleError = console.error;

beforeEach(() => {
  originalConsoleError = console.error;
  console.error = mock(() => {});
});

afterEach(() => {
  console.error = originalConsoleError;
});

describe('workers env bridge', () => {
  test('resolves env-bound resources from the per-request env, never a stale one', async () => {
    const worker = createWorkersHandler(buildGraph());

    const kvA = createMemoryKv();
    await kvA.put('color', 'red');
    const envA = { FLAGS: kvA };

    const kvB = createMemoryKv();
    await kvB.put('color', 'blue');
    const envB = { FLAGS: kvB };

    expect(await readValue(await worker.fetch(flagRequest(), envA))).toBe(
      'red'
    );
    // A new env object must re-resolve the binding — regression guard for
    // per-request binding freshness.
    expect(await readValue(await worker.fetch(flagRequest(), envB))).toBe(
      'blue'
    );
    // Flipping back proves neither materialization captured the other's env.
    expect(await readValue(await worker.fetch(flagRequest(), envA))).toBe(
      'red'
    );
  });

  test('reuses one materialization while the env identity is stable', async () => {
    let overrideCalls = 0;
    const kv = createMemoryKv();
    await kv.put('color', 'green');
    const env = { FLAGS: kv };
    const worker = createWorkersHandler(buildGraph(), {
      resources: () => {
        overrideCalls += 1;
        return {};
      },
    });

    expect(await readValue(await worker.fetch(flagRequest(), env))).toBe(
      'green'
    );
    expect(await readValue(await worker.fetch(flagRequest(), env))).toBe(
      'green'
    );
    expect(overrideCalls).toBe(1);

    await worker.fetch(flagRequest(), { FLAGS: createMemoryKv() });
    expect(overrideCalls).toBe(2);
  });

  test('maps a missing binding to a redacted 500 with diagnostics logged', async () => {
    const worker = createWorkersHandler(buildGraph());

    const response = await worker.fetch(flagRequest(), {});

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error: { category: string; code: string };
    };
    expect(body.error.category).toBe('internal');
    expect(console.error).toHaveBeenCalled();
  });

  test('rejects an env binding that is not a KV namespace', async () => {
    const worker = createWorkersHandler(buildGraph());

    const response = await worker.fetch(flagRequest(), { FLAGS: 'not-a-kv' });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { category: string } };
    expect(body.error.category).toBe('internal');
  });

  test('explicit resource overrides win over env-bound resolution', async () => {
    const envKv = createMemoryKv();
    await envKv.put('color', 'env');
    const overrideKv = createMemoryKv();
    await overrideKv.put('color', 'override');
    const worker = createWorkersHandler(buildGraph(), {
      resources: { flags: overrideKv },
    });

    const value = await readValue(
      await worker.fetch(flagRequest(), { FLAGS: envKv })
    );
    expect(value).toBe('override');
  });

  test('an explicit override satisfies the resource when the env binding is absent', async () => {
    const overrideKv = createMemoryKv();
    await overrideKv.put('color', 'override');
    const worker = createWorkersHandler(buildGraph(), {
      resources: { flags: overrideKv },
    });

    // The documented escape hatch: no FLAGS binding on env, but the resource
    // is provided explicitly, so no missing-binding error may surface.
    const value = await readValue(await worker.fetch(flagRequest(), {}));
    expect(value).toBe('override');
  });

  test('trails filtered off the surface never require their env bindings', async () => {
    const ping = trail('ping', {
      implementation: (input) => Result.ok({ reply: input.message }),
      input: z.object({ message: z.string() }),
      intent: 'read',
      output: z.object({ reply: z.string() }),
    });
    const graph = topo('cf-env-bridge-filtered', { flags, ping, showFlag });
    const worker = createWorkersHandler(graph, { include: ['ping'] });

    // Only /ping is exposed; the KV-backed trail is filtered out, so the
    // missing FLAGS binding must not fail materialization.
    const response = await worker.fetch(
      new Request('http://localhost/ping?message=hi'),
      {}
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { reply: 'hi' } });

    const filteredOut = await worker.fetch(flagRequest(), {});
    expect(filteredOut.status).toBe(404);
  });

  test('resolves env bindings declared only by fork version entries', async () => {
    const versionedFlag = trail('flag.versioned', {
      implementation: (input) => Result.ok({ value: `static:${input.key}` }),
      input: z.object({ key: z.string() }),
      intent: 'read',
      output: z.object({ value: z.string().nullable() }),
      version: 2,
      versions: {
        1: {
          implementation: async (_input, ctx) => {
            const value = await flags.from(ctx).get('color');
            return Result.ok({ value });
          },
          input: z.object({ key: z.string() }),
          output: z.object({ value: z.string().nullable() }),
          resources: [flags],
        },
      },
    });
    const graph = topo('cf-env-bridge-versions', { flags, versionedFlag });
    const worker = createWorkersHandler(graph);
    const kv = createMemoryKv();
    await kv.put('color', 'from-kv');

    // The current contract declares no resources; only the fork entry does.
    // Selecting the historical version must still receive the env binding.
    const forkResponse = await worker.fetch(
      new Request('http://localhost/flag/versioned?key=color', {
        headers: { 'X-Trails-Version': '1' },
      }),
      { FLAGS: kv }
    );
    expect(await readValue(forkResponse)).toBe('from-kv');

    const currentResponse = await worker.fetch(
      new Request('http://localhost/flag/versioned?key=color'),
      { FLAGS: kv }
    );
    expect(await readValue(currentResponse)).toBe('static:color');
  });
});
