import { createRpcConformanceCases, runRpcConformance } from './testing.js';
import type {
  RpcConformanceConnection,
  RpcConformanceHost,
  RpcConformanceServer,
} from './testing.js';
import { createRpcWebSocketHost } from './websocket.js';
import type { RpcSocketData } from './websocket.js';

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

const openConnection = async (
  url: string,
  init: Parameters<RpcConformanceServer['connect']>[0]
): Promise<RpcConformanceConnection> => {
  const opened = Promise.withResolvers<RpcConformanceConnection>();
  const closed = Promise.withResolvers<{ code: number; reason: string }>();
  const queued: unknown[] = [];
  const waiters: ((value: unknown) => void)[] = [];
  const clientOptions: Bun.WebSocketOptions = {
    headers: { ...init?.headers },
    protocols: [...(init?.protocols ?? ['trails.v1'])],
  };
  const socket = new (bunWebSocket())(url, clientOptions);
  socket.addEventListener('message', (event) => {
    const value: unknown = JSON.parse(String(event.data));
    const waiter = waiters.shift();
    if (waiter === undefined) {
      queued.push(value);
    } else {
      waiter(value);
    }
  });
  socket.addEventListener('close', (event) => {
    closed.resolve({ code: event.code, reason: event.reason });
  });
  const connection: RpcConformanceConnection = {
    close: (code, reason) => socket.close(code, reason),
    closed: closed.promise,
    next: () => {
      const value = queued.shift();
      if (value !== undefined) {
        return Promise.resolve(value);
      }
      const pending = Promise.withResolvers<unknown>();
      waiters.push(pending.resolve);
      return pending.promise;
    },
    get protocol() {
      return socket.protocol;
    },
    send: (frame) => {
      socket.send(frame);
    },
  };
  socket.addEventListener('open', () => opened.resolve(connection));
  void closed.promise.then(() => opened.resolve(connection));
  return await opened.promise;
};

const bunHost: RpcConformanceHost = {
  name: '@ontrails/rpc/websocket',
  start: (graph, options) => {
    const host = createRpcWebSocketHost(graph, options).unwrap();
    const server = Bun.serve<RpcSocketData>({
      fetch: async (request, bunServer) =>
        (await host.upgrade(request, bunServer)) ??
        new Response('Not found', { status: 404 }),
      hostname: '127.0.0.1',
      port: 0,
      websocket: host.websocket,
    });
    const url = new URL('/rpc', server.url);
    url.protocol = 'ws:';
    return Promise.resolve({
      close: async () => {
        host.drain();
        await server.stop(true);
      },
      connect: (init) => openConnection(String(url), init),
      drain: () => host.drain(),
    });
  },
};

runRpcConformance(bunHost, createRpcConformanceCases());
