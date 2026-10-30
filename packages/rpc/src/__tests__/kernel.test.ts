import { describe, expect, test } from 'bun:test';

import {
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
      methods: ['trails.discover'],
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
});
