import { describe, expect, test } from 'bun:test';

import {
  CancelledError,
  LAYER_INPUTS_KEY,
  NotFoundError,
  Result,
  topo,
  trail,
} from '@ontrails/core';
import type { Implementation, Layer } from '@ontrails/core';
import { z } from 'zod';

import { createRpcHandler } from '../kernel.js';
import type { RpcHandler } from '../kernel.js';
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
} from '../protocol.js';
import type {
  JsonRpcFrame,
  JsonRpcMessage,
  JsonRpcResponse,
} from '../protocol.js';

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

const frame = (value: unknown): string => JSON.stringify(value);

const isResponse = (message: JsonRpcMessage): message is JsonRpcResponse =>
  'result' in message || 'error' in message;

const isBatchFrame = (
  value: JsonRpcFrame
): value is readonly JsonRpcMessage[] => Array.isArray(value);

const single = (frames: readonly JsonRpcFrame[]): JsonRpcResponse => {
  const [first] = frames;
  if (first === undefined || isBatchFrame(first) || !isResponse(first)) {
    throw new Error('expected one response frame');
  }
  return first;
};

const batch = (frames: readonly JsonRpcFrame[]): readonly JsonRpcResponse[] => {
  const [first] = frames;
  if (first === undefined || !isBatchFrame(first)) {
    throw new Error('expected one batch frame');
  }
  return first.filter(isResponse);
};

const isConnectionState = (
  value: unknown
): value is ReturnType<RpcHandler['createState']> =>
  typeof value === 'object' &&
  value !== null &&
  'protocol' in value &&
  'inFlight' in value &&
  Array.isArray(value.inFlight);

const handlerFor = (
  options?: Parameters<typeof createRpcHandler>[1]
): RpcHandler =>
  createRpcHandler(topo('app', { greet, guarded, missing }), options).unwrap();

describe('createRpcHandler', () => {
  test('runs a trail as a method and answers with its result', async () => {
    const handler = handlerFor();
    const step = await handler.handle(
      handler.createState(),
      frame({ id: 1, jsonrpc: '2.0', method: 'greet', params: { name: 'Ada' } })
    );
    expect(step.effects).toEqual([]);
    expect(step.state.inFlight).toEqual([]);
    expect(single(step.frames)).toEqual({
      id: 1,
      jsonrpc: '2.0',
      result: { greeting: 'Hello, Ada!' },
    });
  });

  test('renders trail failures with core codes and taxonomy data', async () => {
    const handler = handlerFor();
    const step = await handler.handle(
      handler.createState(),
      frame({
        id: 'r1',
        jsonrpc: '2.0',
        method: 'record.get',
        params: { id: 'x' },
      })
    );
    const response = single(step.frames);
    expect('error' in response).toBe(true);
    if (!('error' in response)) {
      return;
    }
    expect(response.error.code).toBe(-32_001);
    expect(response.error.data).toEqual({
      category: 'not_found',
      name: 'NotFoundError',
      retryable: false,
    });
  });

  test('validation failures use the trail input schema and the -32602 code', async () => {
    const handler = handlerFor();
    const step = await handler.handle(
      handler.createState(),
      frame({ id: 2, jsonrpc: '2.0', method: 'greet', params: { name: 3 } })
    );
    const response = single(step.frames);
    if (!('error' in response)) {
      throw new Error('expected a failure');
    }
    expect(response.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    expect(response.error.data).toMatchObject({ category: 'validation' });
  });

  test('array params are rejected before the trail runs', async () => {
    const handler = handlerFor();
    const step = await handler.handle(
      handler.createState(),
      frame({ id: 3, jsonrpc: '2.0', method: 'greet', params: ['Ada'] })
    );
    const response = single(step.frames);
    if (!('error' in response)) {
      throw new Error('expected a failure');
    }
    expect(response.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    expect(response.error.data).toBeUndefined();
  });

  test('unknown, reserved and internal-looking methods answer method-not-found', async () => {
    const handler = handlerFor();
    for (const method of ['nope', 'rpc.ping', 'trails.subscribe']) {
      const step = await handler.handle(
        handler.createState(),
        frame({ id: method, jsonrpc: '2.0', method })
      );
      const response = single(step.frames);
      if (!('error' in response)) {
        throw new Error(`expected a failure for ${method}`);
      }
      expect(response.error.code).toBe(JSON_RPC_METHOD_NOT_FOUND);
    }
  });

  test('notifications run but never answer', async () => {
    let ran = false;
    const ping = trail('ping', {
      implementation: () => {
        ran = true;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createRpcHandler(topo('app', { ping })).unwrap();
    const step = await handler.handle(
      handler.createState(),
      frame({ jsonrpc: '2.0', method: 'ping' })
    );
    expect(ran).toBe(true);
    expect(step.frames).toEqual([]);
  });

  test('batches answer entry by entry, keeping invalid members in place', async () => {
    const handler = handlerFor();
    const step = await handler.handle(
      handler.createState(),
      frame([
        { id: 1, jsonrpc: '2.0', method: 'greet', params: { name: 'Ada' } },
        { id: 2, method: 'greet' },
        { jsonrpc: '2.0', method: 'greet', params: { name: 'quiet' } },
        { id: 3, jsonrpc: '2.0', method: 'nope' },
      ])
    );
    const responses = batch(step.frames);
    expect(responses.map((response) => response.id).toSorted()).toEqual([
      1, 2, 3,
    ]);
    const invalid = responses.find((response) => response.id === 2);
    expect(
      invalid !== undefined && 'error' in invalid && invalid.error.code
    ).toBe(JSON_RPC_INVALID_REQUEST);
  });

  test('parse errors answer with a single null-id error frame', async () => {
    const handler = handlerFor();
    const step = await handler.handle(handler.createState(), '{');
    const response = single(step.frames);
    expect(response.id).toBeNull();
    if (!('error' in response)) {
      throw new Error('expected a failure');
    }
    expect(response.error.code).toBe(JSON_RPC_PARSE_ERROR);
  });

  test('the connection permit reaches the pipeline and guards protected trails', async () => {
    const handler = handlerFor();
    const anonymous = await handler.handle(
      handler.createState(),
      frame({ id: 1, jsonrpc: '2.0', method: 'record.update', params: {} })
    );
    const denied = single(anonymous.frames);
    if (!('error' in denied)) {
      throw new Error('expected a permit failure');
    }
    expect(denied.error.data).toMatchObject({ category: 'permission' });

    const allowed = await handler.handle(
      handler.createState({ permit: { id: 'u1', scopes: ['record:write'] } }),
      frame({ id: 2, jsonrpc: '2.0', method: 'record.update', params: {} })
    );
    expect(single(allowed.frames)).toEqual({
      id: 2,
      jsonrpc: '2.0',
      result: { ok: true },
    });
  });

  test('trails.discover scopes trails to the permit and advertises host capabilities', async () => {
    const handler = handlerFor({ capabilities: { progress: true } });
    const anonymous = await handler.handle(
      handler.createState(),
      frame({ id: 1, jsonrpc: '2.0', method: 'trails.discover' })
    );
    const response = single(anonymous.frames);
    if (!('result' in response)) {
      throw new Error('expected a discover result');
    }
    expect(response.result).toMatchObject({
      capabilities: { input: false, progress: true, subscribe: false },
      methods: ['trails.discover', 'trails.cancel', 'trails.progress'],
      protocol: 'trails.v1',
    });
    const result = response.result as { trails: readonly { id: string }[] };
    expect(result.trails.map((entry) => entry.id)).toEqual([
      'greet',
      'record.get',
    ]);

    const scoped = await handler.handle(
      handler.createState({ permit: { id: 'u1', scopes: ['record:write'] } }),
      frame({ id: 2, jsonrpc: '2.0', method: 'trails.discover' })
    );
    const scopedResponse = single(scoped.frames);
    if (!('result' in scopedResponse)) {
      throw new Error('expected a discover result');
    }
    const scopedResult = scopedResponse.result as {
      trails: readonly { id: string }[];
    };
    expect(scopedResult.trails.map((entry) => entry.id)).toEqual([
      'greet',
      'record.get',
      'record.update',
    ]);
  });

  test('layer inputs ride in params under their rendered names', async () => {
    let seen: unknown;
    const tenant: Layer = {
      input: z.object({ tenant: z.string() }),
      name: 'tenancy',
      wrap<I, O>(
        _t: unknown,
        impl: Implementation<I, O>
      ): Implementation<I, O> {
        return async (input, ctx) => {
          seen = ctx.extensions?.[LAYER_INPUTS_KEY];
          return await impl(input, ctx);
        };
      },
    };
    const handler = createRpcHandler(topo('app', { greet }), {
      layers: [tenant],
    }).unwrap();
    const [entry] = handler.methods.trails;
    expect(entry?.layerRenderings[0]?.routing.get('tenant')).toBe('tenant');
    const step = await handler.handle(
      handler.createState(),
      frame({
        id: 1,
        jsonrpc: '2.0',
        method: 'greet',
        params: { name: 'Ada', tenant: 'acme' },
      })
    );
    expect(single(step.frames)).toMatchObject({
      result: { greeting: 'Hello, Ada!' },
    });
    expect(seen).toEqual({ tenancy: { tenant: 'acme' } });
  });

  test('admit records in-flight ids and recover answers them with outcome unknown', async () => {
    const handler = handlerFor();
    const admitted = handler.admit(
      handler.createState(),
      frame([
        { id: 'a', jsonrpc: '2.0', method: 'greet', params: { name: 'Ada' } },
        { jsonrpc: '2.0', method: 'greet', params: { name: 'quiet' } },
      ])
    );
    expect(admitted.state.inFlight).toEqual(['a']);
    expect(admitted.frames).toEqual([]);

    const recovered = handler.recover(admitted.state);
    expect(recovered.state.inFlight).toEqual([]);
    const [response] = batch([recovered.frames.flat()]);
    expect(response).toMatchObject({
      error: { code: JSON_RPC_INTERNAL_ERROR, data: { outcome: 'unknown' } },
      id: 'a',
    });

    if (admitted.work === undefined) {
      throw new Error('expected admitted work');
    }
    const ran = await handler.run(admitted.state, admitted.work);
    expect(ran.state.inFlight).toEqual([]);
    expect(batch(ran.frames).map((entry) => entry.id)).toEqual(['a']);
  });

  test('state round-trips through JSON text', async () => {
    const handler = handlerFor();
    const admitted = handler.admit(
      handler.createState({ permit: { id: 'u1', scopes: ['record:write'] } }),
      frame({
        id: 'r1',
        jsonrpc: '2.0',
        method: 'greet',
        params: { name: 'Ada' },
      })
    );
    const text = JSON.stringify(admitted.state);
    const parsed: unknown = JSON.parse(text);
    if (!isConnectionState(parsed)) {
      throw new Error('expected a connection state');
    }
    expect(parsed).toEqual(admitted.state);
    expect(handler.recover(parsed).frames).toHaveLength(1);
    const step = await handler.handle(
      parsed,
      frame({ id: 1, jsonrpc: '2.0', method: 'record.update', params: {} })
    );
    expect(single(step.frames)).toMatchObject({ result: { ok: true } });
  });

  test('a present _meta.version that is not a version reference is invalid params', async () => {
    const handler = handlerFor();
    for (const version of [true, { v: 1 }, null]) {
      const step = await handler.handle(
        handler.createState(),
        frame({
          id: 1,
          jsonrpc: '2.0',
          method: 'greet',
          params: { _meta: { version }, name: 'Ada' },
        })
      );
      const response = single(step.frames);
      if (!('error' in response)) {
        throw new Error('expected a failure');
      }
      expect(response.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    }
    const badMeta = await handler.handle(
      handler.createState(),
      frame({
        id: 2,
        jsonrpc: '2.0',
        method: 'greet',
        params: { _meta: 'x', name: 'Ada' },
      })
    );
    const response = single(badMeta.frames);
    expect('error' in response && response.error.code).toBe(
      JSON_RPC_INVALID_PARAMS
    );
  });

  test('a null request id is rejected instead of tracked', async () => {
    const handler = handlerFor();
    const step = await handler.handle(
      handler.createState(),
      frame({
        id: null,
        jsonrpc: '2.0',
        method: 'greet',
        params: { name: 'Ada' },
      })
    );
    const response = single(step.frames);
    expect(response.id).toBeNull();
    expect('error' in response && response.error.code).toBe(
      JSON_RPC_INVALID_REQUEST
    );
    expect(step.state.inFlight).toEqual([]);
  });

  test('discover omits trails.progress when the host cannot push', async () => {
    const handler = handlerFor();
    const step = await handler.handle(
      handler.createState(),
      frame({ id: 1, jsonrpc: '2.0', method: 'trails.discover' })
    );
    const response = single(step.frames);
    if (!('result' in response)) {
      throw new Error('expected a discover result');
    }
    expect(response.result).toMatchObject({
      methods: ['trails.discover', 'trails.cancel'],
    });
  });

  test('trails.progress notifications reach the host while a trail runs', async () => {
    const reporting = trail('report', {
      implementation: (_input, ctx) => {
        ctx.progress?.({ current: 1, total: 2, ts: 't', type: 'progress' });
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const pushed: unknown[] = [];
    const handler = createRpcHandler(topo('app', { reporting }), {
      capabilities: { progress: true },
    }).unwrap();
    const step = await handler.handle(
      handler.createState(),
      frame({ id: 'p1', jsonrpc: '2.0', method: 'report', params: {} }),
      { send: (message) => pushed.push(message) }
    );
    expect(single(step.frames)).toMatchObject({ result: { ok: true } });
    expect(pushed).toEqual([
      {
        jsonrpc: '2.0',
        method: 'trails.progress',
        params: {
          event: { current: 1, total: 2, ts: 't', type: 'progress' },
          id: 'p1',
        },
      },
    ]);
  });

  test('progress stays silent without the capability or a push seam', async () => {
    let offered = false;
    const reporting = trail('report', {
      implementation: (_input, ctx) => {
        offered = ctx.progress !== undefined;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const pushed: unknown[] = [];
    const silent = createRpcHandler(topo('app', { reporting })).unwrap();
    await silent.handle(
      silent.createState(),
      frame({ id: 1, jsonrpc: '2.0', method: 'report', params: {} }),
      { send: (message) => pushed.push(message) }
    );
    expect(offered).toBe(false);
    expect(pushed).toEqual([]);

    const capable = createRpcHandler(topo('app', { reporting }), {
      capabilities: { progress: true },
    }).unwrap();
    await capable.handle(
      capable.createState(),
      frame({ id: 1, jsonrpc: '2.0', method: 'report', params: {} })
    );
    expect(offered).toBe(false);
  });

  test('trails.cancel aborts the in-flight request on the same connection', async () => {
    const waiting = trail('wait', {
      implementation: (_input, ctx) => {
        const settled = Promise.withResolvers<Result<{ ok: boolean }, Error>>();
        ctx.abortSignal.addEventListener('abort', () => {
          settled.resolve(
            Result.err(new CancelledError('cancelled by client'))
          );
        });
        return settled.promise;
      },
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createRpcHandler(topo('app', { waiting })).unwrap();
    const state = handler.createState();
    const pending = handler.handle(
      state,
      frame({ id: 'w1', jsonrpc: '2.0', method: 'wait', params: {} })
    );
    await Bun.sleep(0);
    const other = await handler.handle(
      handler.createState(),
      frame({
        id: 'c0',
        jsonrpc: '2.0',
        method: 'trails.cancel',
        params: { id: 'w1' },
      })
    );
    expect(single(other.frames)).toMatchObject({
      result: { cancelled: false, id: 'w1' },
    });
    const cancelled = await handler.handle(
      state,
      frame({ jsonrpc: '2.0', method: 'trails.cancel', params: { id: 'w1' } })
    );
    expect(cancelled.frames).toEqual([]);
    const finished = await pending;
    const settled = single(finished.frames);
    if (!('error' in settled)) {
      throw new Error('expected the cancelled request to fail');
    }
    expect(settled.error.data).toMatchObject({ name: 'CancelledError' });
  });

  test('trails.cancel without an id is an invalid-params failure', async () => {
    const handler = handlerFor();
    const step = await handler.handle(
      handler.createState(),
      frame({ id: 1, jsonrpc: '2.0', method: 'trails.cancel', params: {} })
    );
    const response = single(step.frames);
    if (!('error' in response)) {
      throw new Error('expected a failure');
    }
    expect(response.error.code).toBe(JSON_RPC_INVALID_PARAMS);
  });

  test('a failing progress push never replaces the trail result', async () => {
    const reporting = trail('report', {
      implementation: (_input, ctx) => {
        ctx.progress?.({ current: 1, total: 1, ts: 't', type: 'progress' });
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createRpcHandler(topo('app', { reporting }), {
      capabilities: { progress: true },
    }).unwrap();
    const step = await handler.handle(
      handler.createState(),
      frame({ id: 1, jsonrpc: '2.0', method: 'report', params: {} }),
      {
        send: () => {
          throw new Error('socket closed');
        },
      }
    );
    expect(single(step.frames)).toEqual({
      id: 1,
      jsonrpc: '2.0',
      result: { ok: true },
    });
  });

  test('a batch can cancel a waiting member that precedes it', async () => {
    const waiting = trail('wait', {
      implementation: async (_input, ctx) => {
        if (!ctx.abortSignal.aborted) {
          const aborted = Promise.withResolvers<undefined>();
          ctx.abortSignal.addEventListener('abort', () => aborted.resolve(), {
            once: true,
          });
          await aborted.promise;
        }
        return Result.err(new CancelledError('cancelled by client'));
      },
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createRpcHandler(topo('app', { waiting })).unwrap();
    const step = await handler.handle(
      handler.createState(),
      frame([
        { id: 'w', jsonrpc: '2.0', method: 'wait', params: {} },
        { jsonrpc: '2.0', method: 'trails.cancel', params: { id: 'w' } },
      ])
    );
    expect(batch(step.frames)).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({
          data: expect.objectContaining({ name: 'CancelledError' }),
        }),
        id: 'w',
      }),
    ]);
    expect(step.state.inFlight).toEqual([]);
  });
});
