import { afterEach, describe, expect, test } from 'bun:test';

import { AuthError, NotFoundError, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  createRpcWebSocketHost,
  RPC_CLOSE_CODES,
  surface,
} from '../websocket.js';
import type { RpcSocketData, SurfaceRpcWebSocketResult } from '../websocket.js';

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

const graph = topo('ws-app', { greet, guarded, missing, reporting });

type BunWebSocketConstructor = new (
  url: string,
  options: Bun.WebSocketOptions
) => WebSocket;

/** Bun's client constructor accepts headers; the DOM lib signature does not. */
const isBunWebSocketConstructor = (
  value: unknown
): value is BunWebSocketConstructor => typeof value === 'function';

const bunWebSocket = (): BunWebSocketConstructor => {
  if (!isBunWebSocketConstructor(WebSocket)) {
    throw new Error('Bun WebSocket constructor unavailable');
  }
  return WebSocket;
};

interface Session {
  readonly socket: WebSocket;
  readonly messages: unknown[];
  readonly closed: Promise<{ code: number; reason: string }>;
  next(): Promise<unknown>;
}

const connect = async (
  url: string,
  init?: {
    readonly protocols?: string[];
    readonly headers?: Record<string, string>;
  }
): Promise<Session> => {
  const opened = Promise.withResolvers<Session>();
  const messages: unknown[] = [];
  const waiters: ((value: unknown) => void)[] = [];
  const closed = Promise.withResolvers<{ code: number; reason: string }>();
  const clientOptions: Bun.WebSocketOptions = {
    headers: init?.headers ?? {},
    protocols: init?.protocols ?? ['trails.v1'],
  };
  const socket = new (bunWebSocket())(url, clientOptions);
  socket.addEventListener('message', (event) => {
    const value: unknown = JSON.parse(String(event.data));
    const waiter = waiters.shift();
    if (waiter === undefined) {
      messages.push(value);
    } else {
      waiter(value);
    }
  });
  socket.addEventListener('close', (event) => {
    closed.resolve({ code: event.code, reason: event.reason });
  });
  socket.addEventListener('error', () => {
    opened.reject(new Error('socket error'));
  });
  const session: Session = {
    closed: closed.promise,
    messages,
    next: () => {
      const queued = messages.shift();
      if (queued !== undefined) {
        return Promise.resolve(queued);
      }
      const pending = Promise.withResolvers<unknown>();
      waiters.push(pending.resolve);
      return pending.promise;
    },
    socket,
  };
  socket.addEventListener('open', () => opened.resolve(session));
  void closed.promise.then(() => opened.resolve(session));
  return await opened.promise;
};

const closeCode = async (session: Session): Promise<number> => {
  const closed = await session.closed;
  return closed.code;
};

const call = async (session: Session, request: unknown): Promise<unknown> => {
  session.socket.send(JSON.stringify(request));
  return await session.next();
};

describe('RPC over Bun WebSocket', () => {
  let running: SurfaceRpcWebSocketResult | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  test('negotiates trails.v1 and runs trails with HTTP-identical error facts', async () => {
    running = await surface(graph, { port: 0 });
    const session = await connect(running.url);
    expect(session.socket.protocol).toBe('trails.v1');

    expect(
      await call(session, {
        id: 1,
        jsonrpc: '2.0',
        method: 'greet',
        params: { name: 'Ada' },
      })
    ).toEqual({ id: 1, jsonrpc: '2.0', result: { greeting: 'Hello, Ada!' } });

    expect(
      await call(session, {
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
      await call(session, {
        id: 3,
        jsonrpc: '2.0',
        method: 'record.update',
        params: {},
      })
    ).toMatchObject({ error: { data: { category: 'permission' } }, id: 3 });
    session.socket.close(RPC_CLOSE_CODES.normal, 'done');
    expect(await closeCode(session)).toBe(RPC_CLOSE_CODES.normal);
  });

  test('resolves identity before upgrade from the Authorization header', async () => {
    running = await surface(graph, {
      port: 0,
      resolvePermit: ({ bearerToken }) =>
        bearerToken === 'good'
          ? Result.ok({ actors: [], id: 'u1', scopes: ['record:write'] })
          : Result.err(new AuthError('bad token')),
    });
    const session = await connect(running.url, {
      headers: { authorization: 'Bearer good' },
    });
    expect(
      await call(session, {
        id: 1,
        jsonrpc: '2.0',
        method: 'record.update',
        params: {},
      })
    ).toEqual({ id: 1, jsonrpc: '2.0', result: { ok: true } });

    const refused = await connect(running.url, {
      headers: { authorization: 'Bearer nope' },
    });
    expect(await closeCode(refused)).toBe(RPC_CLOSE_CODES.policy);
  });

  test('wrong subprotocol closes 1002 and binary frames close 1002', async () => {
    running = await surface(graph, { port: 0 });
    const wrong = await connect(running.url, { protocols: ['other.v9'] });
    expect(await closeCode(wrong)).toBe(RPC_CLOSE_CODES.protocol);

    const binary = await connect(running.url);
    binary.socket.send(new Uint8Array([1, 2, 3]));
    expect(await closeCode(binary)).toBe(RPC_CLOSE_CODES.protocol);
  });

  test('oversize frames close 1009', async () => {
    running = await surface(graph, { maxFrameBytes: 256, port: 0 });
    const session = await connect(running.url);
    session.socket.send(
      JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'greet',
        params: { name: 'x'.repeat(1024) },
      })
    );
    expect(await closeCode(session)).toBe(RPC_CLOSE_CODES.tooLarge);
  });

  test('buffered output past the hard limit closes 1013', async () => {
    // Drive the handler with a socket whose buffered amount never drains, so
    // the check is deterministic instead of depending on OS socket buffers.
    const host = createRpcWebSocketHost(graph, {
      backpressureHardLimitBytes: 16,
    }).unwrap();
    const closed: { code: number; reason: string }[] = [];
    const sent: string[] = [];
    const socket = {
      close: (code: number, reason: string) => {
        closed.push({ code, reason });
      },
      data: { state: host.handler.createState({ connectionId: 'c1' }) },
      getBufferedAmount: () => sent.reduce((total, s) => total + s.length, 0),
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent.push(payload);
      },
    };
    await host.websocket.message?.(
      // The handler only touches these members; the full Bun socket surface is irrelevant here.
      socket as unknown as Bun.ServerWebSocket<RpcSocketData>,
      JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'greet',
        params: { name: 'Ada' },
      })
    );
    expect(sent).toHaveLength(1);
    expect(closed).toEqual([
      { code: RPC_CLOSE_CODES.overload, reason: 'backpressure limit exceeded' },
    ]);
  });

  test('progress notifications are pushed before the response', async () => {
    running = await surface(graph, { port: 0 });
    const session = await connect(running.url);
    session.socket.send(
      JSON.stringify({ id: 'p', jsonrpc: '2.0', method: 'report', params: {} })
    );
    expect(await session.next()).toEqual({
      jsonrpc: '2.0',
      method: 'trails.progress',
      params: {
        event: { current: 1, total: 1, ts: 't', type: 'progress' },
        id: 'p',
      },
    });
    expect(await session.next()).toEqual({
      id: 'p',
      jsonrpc: '2.0',
      result: { ok: true },
    });
  });

  test('closing the surface announces trails.draining and closes 1001', async () => {
    running = await surface(graph, { port: 0 });
    const session = await connect(running.url);
    const closing = running.close();
    running = undefined;
    expect(await session.next()).toEqual({
      jsonrpc: '2.0',
      method: 'trails.draining',
    });
    expect(await closeCode(session)).toBe(RPC_CLOSE_CODES.draining);
    await closing;
  });

  test('non-upgrade requests on the path answer 426 and other paths 404', async () => {
    running = await surface(graph, { port: 0 });
    const http = running.url.replace(/^ws/, 'http');
    const onPath = await fetch(http);
    expect(onPath.status).toBe(426);
    const elsewhere = await fetch(new URL('/other', http));
    expect(elsewhere.status).toBe(404);
  });
});
