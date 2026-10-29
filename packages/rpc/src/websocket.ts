import { AuthError, Result } from '@ontrails/core';
import type { BasePermit, Topo } from '@ontrails/core';

import { createRpcHandler } from './kernel.js';
import type {
  CreateRpcHandlerOptions,
  RpcConnectionState,
  RpcHandler,
} from './kernel.js';
import { RPC_SUBPROTOCOL } from './protocol.js';
import type { JsonRpcFrame } from './protocol.js';

/**
 * WebSocket close codes for connection-level failures.
 *
 * Trail failures never close the socket; they answer as JSON-RPC errors.
 * These codes settle the connection mapping that ADR-0026 deferred.
 */
export const RPC_CLOSE_CODES = {
  /** Server draining, sent after `trails.draining`. */
  draining: 1001,
  /** Internal failure in the connection kernel. */
  internal: 1011,
  /** Normal close, including client hangup. */
  normal: 1000,
  /** Backpressure or overload; resume from the cursor. */
  overload: 1013,
  /** Authentication or policy failure. */
  policy: 1008,
  /** Unparseable frame (binary, wrong subprotocol). */
  protocol: 1002,
  /** Frame over the configured size limit. */
  tooLarge: 1009,
} as const;

export type RpcCloseCode =
  (typeof RPC_CLOSE_CODES)[keyof typeof RPC_CLOSE_CODES];

/** Credentials the host read before upgrade; verification belongs to the resolver. */
export interface ResolveRpcPermitInput {
  readonly authorization?: string | undefined;
  readonly bearerToken?: string | undefined;
  readonly headers: Headers;
  readonly requestId?: string | undefined;
}

export type ResolveRpcPermit = (
  input: ResolveRpcPermitInput
) =>
  | Promise<Result<BasePermit | null | undefined, Error>>
  | Result<BasePermit | null | undefined, Error>;

export interface RpcWebSocketOptions extends CreateRpcHandlerOptions {
  /** Request path that accepts upgrades. Defaults to `/rpc`. */
  readonly path?: string | undefined;
  /** Resolve the connection permit from the upgrade request. */
  readonly resolvePermit?: ResolveRpcPermit | undefined;
  /** Largest accepted text frame in bytes. Defaults to 1 MiB. */
  readonly maxFrameBytes?: number | undefined;
  /** Buffered outbound bytes past which the host closes 1013. Defaults to 16 MiB. */
  readonly backpressureHardLimitBytes?: number | undefined;
}

/** Per-socket data Bun carries on `ws.data`. */
export interface RpcSocketData {
  state: RpcConnectionState;
  /** Why the upgrade must close immediately in `open`, if at all. */
  readonly refusal?:
    | { readonly code: RpcCloseCode; readonly reason: string }
    | undefined;
}

export interface RpcWebSocketHost {
  readonly handler: RpcHandler;
  /**
   * Attempt the upgrade for one request; returns `undefined` when the
   * request is not for this host's path so the caller can serve it.
   */
  upgrade(
    request: Request,
    server: Bun.Server<RpcSocketData>
  ): Promise<Response | undefined>;
  /** The Bun `websocket` handler to spread into `Bun.serve`. */
  readonly websocket: Bun.WebSocketHandler<RpcSocketData>;
  /** Announce `trails.draining` to every open socket and close them 1001. */
  drain(): void;
}

export interface SurfaceRpcWebSocketOptions extends RpcWebSocketOptions {
  readonly hostname?: string | undefined;
  readonly port?: number | undefined;
}

export interface SurfaceRpcWebSocketResult {
  readonly close: () => Promise<void>;
  readonly url: string;
}

const DEFAULT_PATH = '/rpc';
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_BACKPRESSURE_HARD_LIMIT = 16 * 1024 * 1024;

const parseBearerAuthorization = (
  authorization: string | undefined
): Result<string | undefined, Error> => {
  if (authorization === undefined || authorization.length === 0) {
    return Result.ok();
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (token === undefined || token.length === 0) {
    return Result.err(
      new AuthError('Malformed Authorization header; expected Bearer token', {
        context: { code: 'invalid_authorization_header' },
      })
    );
  }
  return Result.ok(token);
};

const offersSubprotocol = (request: Request): boolean =>
  (request.headers.get('sec-websocket-protocol') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .includes(RPC_SUBPROTOCOL);

const resolveUpgradePermit = async (
  options: RpcWebSocketOptions,
  request: Request
): Promise<Result<BasePermit | undefined, Error>> => {
  const authorization = request.headers.get('authorization') ?? undefined;
  const token = parseBearerAuthorization(authorization);
  if (token.isErr()) {
    return token;
  }
  if (options.resolvePermit === undefined) {
    return Result.ok();
  }
  const resolved = await options.resolvePermit({
    authorization,
    bearerToken: token.value,
    headers: request.headers,
    requestId: request.headers.get('x-request-id') ?? undefined,
  });
  if (resolved.isErr()) {
    return resolved;
  }
  return Result.ok(resolved.value ?? undefined);
};

const drainingNotification = (): JsonRpcFrame => ({
  jsonrpc: '2.0',
  method: 'trails.draining',
});

/**
 * Build the Bun WebSocket host for the RPC kernel without starting a server.
 *
 * Identity is resolved before upgrade from `Authorization`; the socket
 * negotiates exactly `trails.v1`; one JSON-RPC message or batch rides per
 * text frame. Connection failures use {@link RPC_CLOSE_CODES}; trail
 * failures stay JSON-RPC errors.
 *
 * @example
 * ```ts
 * import { createRpcWebSocketHost } from '@ontrails/rpc/websocket';
 *
 * const host = createRpcWebSocketHost(graph).unwrap();
 * Bun.serve({
 *   fetch: (request, server) =>
 *     host.upgrade(request, server).then((upgraded) => upgraded ?? new Response('ok')),
 *   websocket: host.websocket,
 * });
 * ```
 */
export const createRpcWebSocketHost = (
  graph: Topo,
  options: RpcWebSocketOptions = {}
): Result<RpcWebSocketHost, Error> => {
  const created = createRpcHandler(graph, {
    ...options,
    capabilities: { progress: true, ...options.capabilities },
  });
  if (created.isErr()) {
    return created;
  }
  const handler = created.value;
  const path = options.path ?? DEFAULT_PATH;
  const hardLimit =
    options.backpressureHardLimitBytes ?? DEFAULT_BACKPRESSURE_HARD_LIMIT;
  const sockets = new Set<Bun.ServerWebSocket<RpcSocketData>>();

  const send = (
    ws: Bun.ServerWebSocket<RpcSocketData>,
    frame: JsonRpcFrame
  ): void => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(frame));
    if (ws.getBufferedAmount() > hardLimit) {
      ws.close(RPC_CLOSE_CODES.overload, 'backpressure limit exceeded');
    }
  };

  const socketData = async (request: Request): Promise<RpcSocketData> => {
    const permit = await resolveUpgradePermit(options, request);
    if (permit.isErr()) {
      return {
        refusal: {
          code: RPC_CLOSE_CODES.policy,
          reason: 'authentication failed',
        },
        state: handler.createState(),
      };
    }
    if (!offersSubprotocol(request)) {
      return {
        refusal: {
          code: RPC_CLOSE_CODES.protocol,
          reason: `expected subprotocol ${RPC_SUBPROTOCOL}`,
        },
        state: handler.createState(),
      };
    }
    return { state: handler.createState({ permit: permit.value }) };
  };

  const upgrade: RpcWebSocketHost['upgrade'] = async (request, server) => {
    const url = new URL(request.url);
    if (url.pathname !== path) {
      return;
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const data = await socketData(request);
    const accepted = server.upgrade(request, {
      data,
      headers: offersSubprotocol(request)
        ? { 'Sec-WebSocket-Protocol': RPC_SUBPROTOCOL }
        : {},
    });
    return accepted
      ? undefined
      : new Response('WebSocket upgrade failed', { status: 400 });
  };

  const websocket: Bun.WebSocketHandler<RpcSocketData> = {
    close(ws) {
      sockets.delete(ws);
    },
    maxPayloadLength: options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
    async message(ws, message) {
      if (typeof message !== 'string') {
        ws.close(RPC_CLOSE_CODES.protocol, 'binary frames are not accepted');
        return;
      }
      try {
        const step = await handler.handle(ws.data.state, message, {
          send: (frame) => send(ws, frame),
        });
        ws.data.state = step.state;
        for (const frame of step.frames) {
          send(ws, frame);
        }
        for (const effect of step.effects) {
          if (effect.type === 'close') {
            ws.close(effect.code, effect.reason);
          }
        }
      } catch {
        ws.close(RPC_CLOSE_CODES.internal, 'connection kernel failure');
      }
    },
    open(ws) {
      if (ws.data.refusal !== undefined) {
        ws.close(ws.data.refusal.code, ws.data.refusal.reason);
        return;
      }
      sockets.add(ws);
    },
  };

  const drain: RpcWebSocketHost['drain'] = () => {
    for (const ws of sockets) {
      send(ws, drainingNotification());
      ws.close(RPC_CLOSE_CODES.draining, 'server draining');
    }
    sockets.clear();
  };

  return Result.ok({ drain, handler, upgrade, websocket });
};

/**
 * Start a Bun server that hosts the RPC surface over WebSocket.
 *
 * @example
 * ```ts
 * import { surface } from '@ontrails/rpc/websocket';
 *
 * const running = await surface(graph, { port: 0 });
 * // connect with new WebSocket(running.url, ['trails.v1'])
 * await running.close();
 * ```
 */
export const surface = async (
  graph: Topo,
  options: SurfaceRpcWebSocketOptions = {}
): Promise<SurfaceRpcWebSocketResult> => {
  const host = createRpcWebSocketHost(graph, options).unwrap();
  const server = Bun.serve<RpcSocketData>({
    fetch: async (request, bunServer) =>
      (await host.upgrade(request, bunServer)) ??
      new Response('Not found', { status: 404 }),
    hostname: options.hostname ?? '0.0.0.0',
    port: options.port ?? 3000,
    websocket: host.websocket,
  });
  const url = new URL(options.path ?? DEFAULT_PATH, server.url);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    close: async () => {
      host.drain();
      await server.stop(true);
    },
    url: String(url),
  };
};
