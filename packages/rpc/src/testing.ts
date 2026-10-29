import { describe, expect, test } from 'bun:test';

import {
  AuthError,
  CancelledError,
  NotFoundError,
  Result,
  topo,
  trail,
} from '@ontrails/core';
import type { BasePermit, Topo } from '@ontrails/core';
import { z } from 'zod';

import { createRpcHandler } from './kernel.js';
import { deriveRpcMethods } from './methods.js';
import { RPC_SUBPROTOCOL } from './protocol.js';
import type { ResolveRpcPermit } from './websocket.js';

/**
 * Shared conformance cases every RPC host runs.
 *
 * Mirrors `createHttpAdapterConformanceCases`: one case set, one topo, run
 * by the Bun WebSocket host today and by later hosts (Durable Object,
 * stdio) without Bun-specific assumptions. The host supplies how to start
 * a server and open a connection; the cases supply the protocol facts.
 */

export interface RpcConformanceHostOptions {
  readonly resolvePermit?: ResolveRpcPermit | undefined;
  /** Largest accepted text frame in bytes. */
  readonly maxFrameBytes?: number | undefined;
}

export interface RpcConformanceConnectInit {
  /** Subprotocols the client offers; defaults to `['trails.v1']`. */
  readonly protocols?: readonly string[] | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

export interface RpcConformanceConnection {
  /** The subprotocol the server selected, or an empty string. */
  readonly protocol: string;
  /** Resolves when the server closes the connection. */
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
  send(frame: string | Uint8Array<ArrayBuffer>): void;
  /** The next inbound message, parsed as JSON. */
  next(): Promise<unknown>;
  close(code?: number, reason?: string): void;
}

export interface RpcConformanceServer {
  connect(init?: RpcConformanceConnectInit): Promise<RpcConformanceConnection>;
  /** Announce draining to every connection and close them. */
  drain(): void;
  close(): Promise<void>;
}

export interface RpcConformanceHost {
  readonly name: string;
  start(
    graph: Topo,
    options?: RpcConformanceHostOptions
  ): Promise<RpcConformanceServer>;
}

export interface RpcConformanceCase {
  readonly name: string;
  readonly check: (host: RpcConformanceHost) => Promise<void>;
}

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

const waiting = trail('wait', {
  implementation: async (_input, ctx) => {
    const aborted = Promise.withResolvers<undefined>();
    ctx.abortSignal.addEventListener('abort', () => aborted.resolve(), {
      once: true,
    });
    await aborted.promise;
    return Result.err(new CancelledError('cancelled by client'));
  },
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});

/** The topo every conformance case runs against. */
export const createRpcConformanceTopo = (): Topo =>
  topo('rpc-conformance', { greet, guarded, missing, reporting, waiting });

const writer: BasePermit = { id: 'writer', scopes: ['record:write'] };

/** Resolver contract: absence answers null; a presented credential verifies or errors. */
const resolveBearer: ResolveRpcPermit = ({ bearerToken }) => {
  if (bearerToken === undefined) {
    return Result.ok(null);
  }
  return bearerToken === 'writer'
    ? Result.ok(writer)
    : Result.err(new AuthError('unknown token'));
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Read the trail ids a discover response carries, or an empty list. */
const discoveredTrailIds = (response: unknown): readonly string[] => {
  if (!isObject(response) || !isObject(response['result'])) {
    return [];
  }
  const { trails } = response['result'];
  if (!Array.isArray(trails)) {
    return [];
  }
  return trails.flatMap((entry: unknown) =>
    isObject(entry) && typeof entry['id'] === 'string' ? [entry['id']] : []
  );
};

const responseId = (entry: unknown): unknown =>
  isObject(entry) ? entry['id'] : undefined;

const call = async (
  connection: RpcConformanceConnection,
  request: unknown
): Promise<unknown> => {
  connection.send(JSON.stringify(request));
  return await connection.next();
};

const withServer = async (
  host: RpcConformanceHost,
  options: RpcConformanceHostOptions,
  body: (server: RpcConformanceServer) => Promise<void>
): Promise<void> => {
  const server = await host.start(createRpcConformanceTopo(), options);
  try {
    await body(server);
  } finally {
    await server.close();
  }
};

const closeCode = async (
  connection: RpcConformanceConnection
): Promise<number> => {
  const closed = await connection.closed;
  return closed.code;
};

const invocationCase = (host: RpcConformanceHost): Promise<void> =>
  withServer(host, {}, async (server) => {
    const connection = await server.connect();
    expect(connection.protocol).toBe(RPC_SUBPROTOCOL);
    expect(
      await call(connection, {
        id: 1,
        jsonrpc: '2.0',
        method: 'greet',
        params: { name: 'Ada' },
      })
    ).toEqual({ id: 1, jsonrpc: '2.0', result: { greeting: 'Hello, Ada!' } });
    expect(
      await call(connection, {
        id: 2,
        jsonrpc: '2.0',
        method: 'record.get',
        params: { id: 'x' },
      })
    ).toMatchObject({
      error: {
        code: -32_001,
        data: {
          category: 'not_found',
          name: 'NotFoundError',
          retryable: false,
        },
      },
      id: 2,
    });
    expect(
      await call(connection, {
        id: 3,
        jsonrpc: '2.0',
        method: 'greet',
        params: { name: 7 },
      })
    ).toMatchObject({
      error: { code: -32_602, data: { category: 'validation' } },
    });
    expect(
      await call(connection, {
        id: 4,
        jsonrpc: '2.0',
        method: 'record.update',
        params: {},
      })
    ).toMatchObject({ error: { data: { category: 'permission' } }, id: 4 });
    connection.close(1000, 'done');
    expect(await closeCode(connection)).toBe(1000);
  });

const batchCase = (host: RpcConformanceHost): Promise<void> =>
  withServer(host, {}, async (server) => {
    const connection = await server.connect();
    const responses = await call(connection, [
      { id: 1, jsonrpc: '2.0', method: 'greet', params: { name: 'Ada' } },
      { id: 2, jsonrpc: '2.0', method: 'rpc.ping' },
      { jsonrpc: '2.0', method: 'greet', params: { name: 'quiet' } },
      { id: 3, method: 'greet' },
    ]);
    expect(Array.isArray(responses)).toBe(true);
    if (!Array.isArray(responses)) {
      return;
    }
    expect(responses.map(responseId).toSorted()).toEqual([1, 2, 3]);
    expect(responses.find((entry) => responseId(entry) === 2)).toMatchObject({
      error: { code: -32_601 },
    });
    expect(responses.find((entry) => responseId(entry) === 3)).toMatchObject({
      error: { code: -32_600 },
    });
    connection.send('{');
    expect(await connection.next()).toMatchObject({
      error: { code: -32_700 },
      id: null,
    });
  });

const discoverCase = (host: RpcConformanceHost): Promise<void> =>
  withServer(host, { resolvePermit: resolveBearer }, async (server) => {
    const anonymous = await server.connect();
    const open = await call(anonymous, {
      id: 1,
      jsonrpc: '2.0',
      method: 'trails.discover',
    });
    expect(open).toMatchObject({
      result: {
        capabilities: { progress: true },
        methods: ['trails.discover', 'trails.cancel', 'trails.progress'],
        protocol: RPC_SUBPROTOCOL,
      },
    });
    expect(discoveredTrailIds(open)).not.toContain('record.update');

    const scoped = await server.connect({
      headers: { authorization: 'Bearer writer' },
    });
    const scopedDiscover = await call(scoped, {
      id: 1,
      jsonrpc: '2.0',
      method: 'trails.discover',
    });
    expect(discoveredTrailIds(scopedDiscover)).toContain('record.update');
  });

const identityCase = (host: RpcConformanceHost): Promise<void> =>
  withServer(host, { resolvePermit: resolveBearer }, async (server) => {
    const accepted = await server.connect({
      headers: { authorization: 'Bearer writer' },
    });
    expect(
      await call(accepted, {
        id: 1,
        jsonrpc: '2.0',
        method: 'record.update',
        params: {},
      })
    ).toEqual({ id: 1, jsonrpc: '2.0', result: { ok: true } });
    const refused = await server.connect({
      headers: { authorization: 'Bearer nope' },
    });
    expect(await closeCode(refused)).toBe(1008);
  });

const cancelCase = (host: RpcConformanceHost): Promise<void> =>
  withServer(host, {}, async (server) => {
    const connection = await server.connect();
    connection.send(
      JSON.stringify({ id: 'w', jsonrpc: '2.0', method: 'wait', params: {} })
    );
    connection.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'trails.cancel',
        params: { id: 'w' },
      })
    );
    expect(await connection.next()).toMatchObject({
      error: { data: { name: 'CancelledError' } },
      id: 'w',
    });
  });

const progressCase = (host: RpcConformanceHost): Promise<void> =>
  withServer(host, {}, async (server) => {
    const connection = await server.connect();
    connection.send(
      JSON.stringify({ id: 'p', jsonrpc: '2.0', method: 'report', params: {} })
    );
    expect(await connection.next()).toEqual({
      jsonrpc: '2.0',
      method: 'trails.progress',
      params: {
        event: { current: 1, total: 1, ts: 't', type: 'progress' },
        id: 'p',
      },
    });
    expect(await connection.next()).toMatchObject({
      id: 'p',
      result: { ok: true },
    });
  });

const closeCodesCase = (host: RpcConformanceHost): Promise<void> =>
  withServer(host, { maxFrameBytes: 256 }, async (server) => {
    const wrong = await server.connect({ protocols: ['other.v1'] });
    expect(await closeCode(wrong)).toBe(1002);

    const binary = await server.connect();
    binary.send(new Uint8Array([1, 2, 3]));
    expect(await closeCode(binary)).toBe(1002);

    const oversize = await server.connect();
    oversize.send(
      JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'greet',
        params: { name: 'x'.repeat(1024) },
      })
    );
    expect(await closeCode(oversize)).toBe(1009);

    const draining = await server.connect();
    server.drain();
    expect(await draining.next()).toEqual({
      jsonrpc: '2.0',
      method: 'trails.draining',
    });
    expect(await closeCode(draining)).toBe(1001);
  });

const recoveryCase = async (): Promise<void> => {
  const handler = createRpcHandler(createRpcConformanceTopo()).unwrap();
  let runs = 0;
  const counted = trail('count', {
    implementation: () => {
      runs += 1;
      return Result.ok({ runs });
    },
    input: z.object({}),
    output: z.object({ runs: z.number() }),
  });
  const counting = createRpcHandler(topo('recovery', { counted })).unwrap();
  const admitted = counting.admit(
    counting.createState(),
    JSON.stringify({ id: 'r1', jsonrpc: '2.0', method: 'count', params: {} })
  );
  expect(admitted.state.inFlight).toEqual(['r1']);
  const recovered = counting.recover(structuredClone(admitted.state));
  expect(recovered.state.inFlight).toEqual([]);
  expect(recovered.frames).toEqual([
    {
      error: {
        code: -32_603,
        data: { outcome: 'unknown' },
        message:
          'Request outcome unknown: the connection was interrupted before this request settled',
      },
      id: 'r1',
      jsonrpc: '2.0',
    },
  ]);
  expect(runs).toBe(0);
  expect(handler.methods.subprotocol).toBe(RPC_SUBPROTOCOL);
  await Promise.resolve();
};

const reservedPrefixCase = (): Promise<void> => {
  const reserved = trail('trails.ping', {
    implementation: () => Result.ok({ ok: true }),
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
  });
  const result = deriveRpcMethods(topo('reserved', { greet, reserved }));
  expect(result.isErr()).toBe(true);
  return Promise.resolve();
};

/**
 * The shared RPC conformance cases.
 *
 * @example
 * ```ts
 * import { createRpcConformanceCases, runRpcConformance } from '@ontrails/rpc/testing';
 *
 * runRpcConformance(myHost, createRpcConformanceCases());
 * ```
 */
export const createRpcConformanceCases = (): readonly RpcConformanceCase[] => [
  {
    check: invocationCase,
    name: 'runs trails as methods with HTTP-identical error facts',
  },
  {
    check: batchCase,
    name: 'answers batches, reserved rpc.* methods and parse failures per JSON-RPC 2.0',
  },
  {
    check: discoverCase,
    name: 'scopes trails.discover to the permit and the host capabilities',
  },
  {
    check: identityCase,
    name: 'resolves identity before upgrade and closes 1008 on failure',
  },
  { check: cancelCase, name: 'trails.cancel aborts an in-flight request' },
  {
    check: progressCase,
    name: 'pushes trails.progress before the response',
  },
  {
    check: closeCodesCase,
    name: 'closes 1002 on protocol errors, 1009 on oversize frames and 1001 after draining',
  },
  {
    check: reservedPrefixCase,
    name: 'rejects trail ids under the reserved trails. prefix',
  },
  {
    check: recoveryCase,
    name: 'answers in-flight ids after a wake with outcome unknown and never re-runs',
  },
];

/**
 * Register the conformance cases as a `bun:test` suite for one host.
 *
 * @example
 * ```ts
 * import { runRpcConformance } from '@ontrails/rpc/testing';
 *
 * runRpcConformance(myHost);
 * ```
 */
export const runRpcConformance = (
  host: RpcConformanceHost,
  cases: readonly RpcConformanceCase[] = createRpcConformanceCases()
): void => {
  describe(`${host.name} RPC host conformance`, () => {
    for (const conformanceCase of cases) {
      test(conformanceCase.name, async () => {
        await conformanceCase.check(host);
      });
    }
  });
};
