import { describe, expect, test } from 'bun:test';

import { NotFoundError, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { createRpcHarness } from '../rpc.js';

const greet = trail('greet', {
  implementation: (input: { name: string }) =>
    Result.ok({ greeting: `Hello, ${input.name}!` }),
  input: z.object({ name: z.string() }),
  intent: 'read',
  output: z.object({ greeting: z.string() }),
});

const missing = trail('record.get', {
  implementation: (input: { id: string }) =>
    Result.err(new NotFoundError(`record ${input.id} missing`)),
  input: z.object({ id: z.string() }),
  intent: 'read',
  output: z.object({ id: z.string() }),
});

const guarded = trail('record.update', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'write',
  output: z.object({ ok: z.boolean() }),
  permit: { scopes: ['record:write'] },
});

const reporting = trail('report', {
  implementation: (_input, ctx) => {
    ctx.progress?.({ current: 1, total: 1, ts: 't', type: 'progress' });
    return Result.ok({ ok: true });
  },
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});

const graph = topo('rpc-harness', { greet, guarded, missing, reporting });

describe('createRpcHarness', () => {
  test('calls trails as methods and reports results and core error facts', async () => {
    const rpc = createRpcHarness({ graph });
    const greeted = await rpc.call('greet', { name: 'Ada' });
    expect(greeted.ok).toBe(true);
    expect(greeted.result).toEqual({ greeting: 'Hello, Ada!' });

    const lost = await rpc.call('record.get', { id: 'x' });
    expect(lost.ok).toBe(false);
    expect(lost.error).toMatchObject({
      code: -32_001,
      data: { category: 'not_found', name: 'NotFoundError', retryable: false },
    });
  });

  test('carries the connection permit into the pipeline', async () => {
    const anonymous = createRpcHarness({ graph });
    const denied = await anonymous.call('record.update', {});
    expect(denied.error).toMatchObject({ data: { category: 'permission' } });
    const writer = createRpcHarness({
      graph,
      permit: { actors: [], id: 'u1', scopes: ['record:write'] },
    });
    const allowed = await writer.call('record.update', {});
    expect(allowed.result).toEqual({ ok: true });
  });

  test('discover and pushed progress are observable', async () => {
    const rpc = createRpcHarness({ graph });
    const discovered = await rpc.discover();
    expect(discovered.trails.map((entry) => entry.id)).toEqual([
      'greet',
      'record.get',
      'report',
    ]);
    const reported = await rpc.call('report', {});
    expect(reported.ok).toBe(true);
    expect(rpc.pushed).toEqual([
      {
        jsonrpc: '2.0',
        method: 'trails.progress',
        params: {
          event: { current: 1, total: 1, ts: 't', type: 'progress' },
          id: reported.id,
        },
      },
    ]);
  });

  test('results and pushes cross the JSON wire boundary', async () => {
    const stamped = trail('stamp', {
      implementation: (_input, ctx) => {
        ctx.progress?.({
          current: 1,
          total: 1,
          ts: new Date('2026-10-29T00:00:00Z') as unknown as string,
          type: 'progress',
        });
        return Result.ok({
          at: new Date('2026-10-29T00:00:00Z'),
          gone: undefined,
        });
      },
      input: z.object({}),
      output: z.object({ at: z.date(), gone: z.undefined() }),
    });
    const rpc = createRpcHarness({
      graph: topo('rpc-harness-wire', { stamped }),
    });
    const result = await rpc.call('stamp', {});
    expect(result.result).toEqual({ at: '2026-10-29T00:00:00.000Z' });
    expect(rpc.pushed[0]).toMatchObject({
      params: { event: { ts: '2026-10-29T00:00:00.000Z' } },
    });
  });

  test('publishes admitted ids while a request is running', async () => {
    const release = Promise.withResolvers<undefined>();
    const started = Promise.withResolvers<undefined>();
    const slow = trail('slow', {
      implementation: async () => {
        started.resolve();
        await release.promise;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      intent: 'read',
      output: z.object({ ok: z.boolean() }),
    });
    const rpc = createRpcHarness({
      graph: topo('rpc-harness-inflight', { greet, slow }),
    });

    const pending = rpc.send({
      id: 'slow-1',
      jsonrpc: '2.0',
      method: 'slow',
      params: {},
    });
    await started.promise;
    expect(rpc.state.inFlight).toEqual(['slow-1']);
    expect(rpc.handler.recover(rpc.state).frames).toHaveLength(1);

    // A request settling meanwhile must not drop the running one's id.
    await rpc.call('greet', { name: 'Ada' });
    expect(rpc.state.inFlight).toEqual(['slow-1']);

    release.resolve();
    await pending;
    expect(rpc.state.inFlight).toEqual([]);
  });

  test('test context merges into every call', async () => {
    const seen: string[] = [];
    const observing = trail('observe', {
      implementation: (_input, ctx) => {
        seen.push(ctx.requestId);
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const rpc = createRpcHarness({
      ctx: { requestId: 'req-harness' },
      graph: topo('rpc-harness-ctx', { observing }),
    });
    await rpc.notify('observe', {});
    expect(seen).toEqual(['req-harness']);
    expect(rpc.state.inFlight).toEqual([]);
  });
});
