/**
 * RPC integration test harness.
 *
 * Drives the host-agnostic JSON-RPC kernel from `@ontrails/rpc` in process,
 * without a WebSocket or a listening server, the way the HTTP harness drives
 * derived routes without Hono. One harness is one connection: it keeps the
 * kernel's serializable connection state between calls, so in-flight ids,
 * cancellation and the connection permit behave as they do on a socket.
 */

import type {
  BasePermit,
  Topo,
  TrailContext,
  TrailContextInit,
} from '@ontrails/core';
import { createRpcHandler } from '@ontrails/rpc';
import type {
  CreateRpcHandlerOptions,
  JsonRpcErrorObject,
  JsonRpcFrame,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcResponse,
  RpcConnectionState,
  RpcDiscoverResult,
  RpcHandler,
} from '@ontrails/rpc';

import { mergeTestContext } from './context.js';

/** Options for creating an RPC harness. */
export interface RpcHarnessOptions extends CreateRpcHandlerOptions {
  readonly ctx?: Partial<TrailContext> | undefined;
  readonly graph: Topo;
  /** The permit the host would have resolved before upgrade. */
  readonly permit?: BasePermit | undefined;
}

/** The result of one harness request. */
export interface RpcHarnessResult {
  readonly error?: JsonRpcErrorObject | undefined;
  readonly id: JsonRpcId;
  readonly ok: boolean;
  readonly response: JsonRpcResponse;
  readonly result?: unknown;
}

/** A test harness for the RPC surface rendering. */
export interface RpcHarness {
  /** Send one request frame and return its response. */
  call(method: string, params?: unknown): Promise<RpcHarnessResult>;
  /** Send a notification; resolves once the kernel settled it. */
  notify(method: string, params?: unknown): Promise<void>;
  /** Send a raw frame (single or batch) and return every outbound frame. */
  send(
    frame: JsonRpcMessage | readonly JsonRpcMessage[]
  ): Promise<readonly JsonRpcFrame[]>;
  /** Call `trails.discover` and return its typed result. */
  discover(): Promise<RpcDiscoverResult>;
  /** Every server-to-client notification pushed so far (progress, draining). */
  readonly pushed: readonly JsonRpcMessage[];
  /** The kernel state after the last frame, for persistence assertions. */
  readonly state: RpcConnectionState;
  readonly handler: RpcHandler;
}

const mergeContextInit = (
  base: TrailContextInit | undefined,
  ctx: Partial<TrailContext> | undefined
): TrailContextInit => ({
  ...base,
  ...mergeTestContext({ ...base, ...ctx }),
});

const createHarnessContextFactory = (
  options: RpcHarnessOptions
): (() => TrailContextInit | Promise<TrailContextInit>) => {
  const { createContext, ctx } = options;
  return async () => {
    const base = await createContext?.();
    return mergeContextInit(base, ctx);
  };
};

const isResponse = (message: JsonRpcMessage): message is JsonRpcResponse =>
  'result' in message || 'error' in message;

const isBatchFrame = (
  frame: JsonRpcFrame
): frame is readonly JsonRpcMessage[] => Array.isArray(frame);

const isDiscoverResult = (value: unknown): value is RpcDiscoverResult =>
  typeof value === 'object' &&
  value !== null &&
  'protocol' in value &&
  'trails' in value &&
  Array.isArray(value.trails);

let nextId = 0;

/**
 * Every outbound frame passes through the same JSON wire boundary the WebSocket host
 * uses (`JSON.stringify` per frame), so a test sees what a client receives: a
 * Date becomes its ISO string and undefined fields disappear. `structuredClone`
 * would keep the Date, which is exactly the difference this hides.
 */
const overWire = <T>(frame: T): T =>
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON round trip is the point
  JSON.parse(JSON.stringify(frame)) as T;

/**
 * Create an in-process harness over the RPC kernel.
 *
 * @example
 * ```ts
 * import { createRpcHarness } from '@ontrails/testing/rpc';
 *
 * const rpc = createRpcHarness({ graph });
 * const greeted = await rpc.call('greet', { name: 'Ada' });
 * // greeted.ok === true && greeted.result → { greeting: 'Hello, Ada!' }
 * const missing = await rpc.call('record.get', { id: 'x' });
 * // missing.error?.code === -32001
 * ```
 */
export const createRpcHarness = (
  harnessOptions: RpcHarnessOptions
): RpcHarness => {
  const { ctx: _ctx, graph, permit, ...kernelOptions } = harnessOptions;
  const created = createRpcHandler(graph, {
    ...kernelOptions,
    capabilities: { progress: true, ...kernelOptions.capabilities },
    createContext: createHarnessContextFactory(harnessOptions),
  });
  if (created.isErr()) {
    throw created.error;
  }
  const handler = created.value;
  const pushed: JsonRpcMessage[] = [];
  let state = handler.createState({ connectionId: 'harness', permit });

  const send: RpcHarness['send'] = async (frame) => {
    const admitted = handler.admit(state, JSON.stringify(frame));
    // Publish admission before running, so `state` shows in-flight ids (and
    // `handler.recover(state)` can answer them) while a request is still running.
    ({ state } = admitted);
    if (admitted.work === undefined) {
      return admitted.frames.map((outbound) => overWire(outbound));
    }
    const step = await handler.run(admitted.state, admitted.work, {
      send: (message) => {
        const wired = overWire(message);
        if (isBatchFrame(wired)) {
          pushed.push(...wired);
        } else {
          pushed.push(wired);
        }
      },
    });
    // Other requests may have been admitted during the run; settle only this
    // step's ids against the current state.
    const settled = new Set(
      admitted.state.inFlight.filter((id) => !step.state.inFlight.includes(id))
    );
    state = {
      ...step.state,
      inFlight: state.inFlight.filter((id) => !settled.has(id)),
    };
    return step.frames.map((outbound) => overWire(outbound));
  };

  const call: RpcHarness['call'] = async (method, params) => {
    nextId += 1;
    const id = `harness-${nextId}`;
    const frames = await send({
      id,
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    });
    const [first] = frames;
    if (first === undefined || isBatchFrame(first) || !isResponse(first)) {
      throw new Error(`RPC harness: no response for ${method}`);
    }
    const response = first;
    if ('error' in response) {
      return { error: response.error, id: response.id, ok: false, response };
    }
    return { id: response.id, ok: true, response, result: response.result };
  };

  const notify: RpcHarness['notify'] = async (method, params) => {
    await send({
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    });
  };

  const discover: RpcHarness['discover'] = async () => {
    const answered = await call('trails.discover');
    if (!answered.ok || !isDiscoverResult(answered.result)) {
      throw new Error(
        'RPC harness: trails.discover did not answer with a discover result'
      );
    }
    return answered.result;
  };

  return {
    call,
    discover,
    handler,
    notify,
    get pushed() {
      return pushed;
    },
    send,
    get state() {
      return state;
    },
  };
};
