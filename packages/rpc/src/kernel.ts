import {
  executeTrail,
  renderJsonRpcError,
  Result,
  withSurfaceLayerNames,
} from '@ontrails/core';
import type {
  BasePermit,
  Layer,
  PermitRequirement,
  ProgressCallback,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
  TrailVersionReference,
} from '@ontrails/core';

import { deriveRpcMethods, RPC_META_PARAM } from './methods.js';
import type {
  DeriveRpcMethodsOptions,
  RpcLayerInputRendering,
  RpcMethodTable,
  RpcTrailMethod,
} from './methods.js';
import {
  isReservedRpcMethod,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_METHOD_NOT_FOUND,
  jsonRpcFailure,
  jsonRpcSuccess,
  parseJsonRpcFrame,
  RPC_SUBPROTOCOL,
} from './protocol.js';
import type {
  JsonRpcFrame,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
} from './protocol.js';

/** Request ids the kernel tracks between admission and completion. */
export type RpcInFlightId = Exclude<JsonRpcId, null>;

/**
 * Plain, serializable per-connection state.
 *
 * Hosts own where it lives: Bun keeps it in memory, a hibernatable Durable
 * Object persists it. It records metadata, never payloads or full permits.
 */
export interface RpcConnectionState {
  readonly protocol: typeof RPC_SUBPROTOCOL;
  /** Host-unique connection identity; scopes in-flight work and cancellation. */
  readonly connectionId: string;
  /** The permit the host resolved before upgrade; absent for anonymous connections. */
  readonly permit?: BasePermit | undefined;
  /** Request ids admitted but not yet answered. */
  readonly inFlight: readonly RpcInFlightId[];
}

/** Plain data describing something the host must do; the kernel never does it. */
export interface RpcEffect {
  readonly type: 'close';
  readonly code: number;
  readonly reason: string;
}

export interface RpcStepResult {
  readonly state: RpcConnectionState;
  readonly frames: readonly JsonRpcFrame[];
  readonly effects: readonly RpcEffect[];
}

/** Work admitted from one inbound frame, ready to run. */
export interface RpcAdmission {
  readonly state: RpcConnectionState;
  /** Responses available before any trail runs (parse and shape failures). */
  readonly frames: readonly JsonRpcFrame[];
  readonly work: RpcAdmittedWork | undefined;
}

export interface RpcAdmittedWork {
  readonly batch: boolean;
  readonly requests: readonly JsonRpcRequest[];
  /** Responses already settled for batch entries that failed validation. */
  readonly settled: readonly JsonRpcResponse[];
}

/** Host capabilities advertised by `trails.discover`; false until a host implements the push side. */
export interface RpcHostCapabilities {
  readonly progress: boolean;
  readonly subscribe: boolean;
  readonly input: boolean;
}

/**
 * What a host offers the kernel while work runs.
 *
 * `send` pushes a server-to-client notification mid-flight (progress today).
 * A host that cannot push omits it and must not advertise `progress`.
 */
export interface RpcRunHost {
  readonly send?: ((frame: JsonRpcFrame) => void) | undefined;
}

export interface CreateRpcHandlerOptions extends DeriveRpcMethodsOptions {
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  /** What the mounting host can do; the kernel advertises exactly this. */
  readonly capabilities?: Partial<RpcHostCapabilities> | undefined;
}

export interface RpcDiscoverResult {
  readonly protocol: typeof RPC_SUBPROTOCOL;
  readonly capabilities: RpcHostCapabilities;
  readonly methods: readonly string[];
  readonly trails: readonly RpcDiscoveredTrail[];
  readonly signals: readonly {
    readonly id: string;
    readonly description?: string | undefined;
  }[];
}

export interface RpcDiscoveredTrail {
  readonly id: string;
  readonly intent: RpcTrailMethod['intent'];
  readonly description?: string | undefined;
  readonly input: Record<string, unknown>;
  readonly output?: Record<string, unknown> | undefined;
  readonly examples?: RpcTrailMethod['examples'];
}

/** The host-independent kernel: pure data in, pure data out. */
export interface RpcHandler {
  readonly methods: RpcMethodTable;
  /** Build the initial state for a connection the host has already authenticated. */
  createState(init?: {
    readonly permit?: BasePermit | undefined;
    readonly connectionId?: string | undefined;
  }): RpcConnectionState;
  /** Parse and validate one inbound frame; records request ids as in flight. */
  admit(state: RpcConnectionState, frame: string): RpcAdmission;
  /** Run admitted work and settle every in-flight id it covers. */
  run(
    state: RpcConnectionState,
    work: RpcAdmittedWork,
    host?: RpcRunHost
  ): Promise<RpcStepResult>;
  /** `admit` followed by `run` for hosts that keep state in memory. */
  handle(
    state: RpcConnectionState,
    frame: string,
    host?: RpcRunHost
  ): Promise<RpcStepResult>;
  /**
   * Answer every id still in flight after a wake with `data.outcome: 'unknown'`.
   * Never re-runs the trail.
   */
  recover(state: RpcConnectionState): RpcStepResult;
}

const DEFAULT_CAPABILITIES: RpcHostCapabilities = {
  input: false,
  progress: false,
  subscribe: false,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const inFlightIds = (requests: readonly JsonRpcRequest[]): RpcInFlightId[] =>
  requests.flatMap((request) =>
    request.id === undefined || request.id === null ? [] : [request.id]
  );

const withoutIds = (
  state: RpcConnectionState,
  ids: readonly RpcInFlightId[]
): RpcConnectionState => ({
  ...state,
  inFlight: state.inFlight.filter((id) => !ids.includes(id)),
});

const permitCovers = (
  requirement: PermitRequirement | undefined,
  permit: BasePermit | undefined
): boolean => {
  if (requirement === undefined || requirement === 'public') {
    return true;
  }
  if (permit === undefined) {
    return false;
  }
  return requirement.scopes.every((scope) => permit.scopes.includes(scope));
};

interface SplitParams {
  readonly trailInput: Record<string, unknown>;
  readonly layerInputs: Record<string, unknown>;
  readonly version: TrailVersionReference | undefined;
}

type SplitParamsResult =
  | { readonly kind: 'split'; readonly params: SplitParams }
  | { readonly kind: 'invalid'; readonly message: string };

/** Read `_meta.version`; a present value that is not a version reference is invalid, never ignored. */
const readMetaVersion = (
  meta: unknown
): SplitParamsResult | TrailVersionReference | undefined => {
  if (meta === undefined) {
    return undefined;
  }
  if (!isObject(meta)) {
    return { kind: 'invalid', message: `${RPC_META_PARAM} must be an object` };
  }
  const rawVersion = meta['version'];
  if (rawVersion === undefined) {
    return undefined;
  }
  if (typeof rawVersion === 'string' || typeof rawVersion === 'number') {
    return rawVersion;
  }
  return {
    kind: 'invalid',
    message: `${RPC_META_PARAM}.version must be a string or number`,
  };
};

const splitParams = (
  params: Record<string, unknown>,
  renderings: readonly RpcLayerInputRendering[]
): SplitParamsResult => {
  const { [RPC_META_PARAM]: meta, ...rest } = params;
  const version = readMetaVersion(meta);
  if (isObject(version)) {
    return version;
  }
  const claimed = new Set<string>();
  const layerInputs: Record<string, unknown> = {};
  for (const rendering of renderings) {
    const layerInput: Record<string, unknown> = {};
    let received = false;
    for (const [paramName, fieldName] of rendering.routing) {
      claimed.add(paramName);
      const value = rest[paramName];
      if (value === undefined) {
        continue;
      }
      layerInput[fieldName] = value;
      received = true;
    }
    if (received) {
      layerInputs[rendering.layerName] = layerInput;
    }
  }
  const trailInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (!claimed.has(key)) {
      trailInput[key] = value;
    }
  }
  return { kind: 'split', params: { layerInputs, trailInput, version } };
};

/** A batch answers with an array; a single request answers with one message; no responses means no frame. */
const frameFor = (
  batch: boolean,
  responses: readonly JsonRpcResponse[]
): readonly JsonRpcFrame[] => {
  const [first] = responses;
  if (first === undefined) {
    return [];
  }
  return batch ? [responses] : [first];
};

/** What routing one request produced, before it becomes a JSON-RPC message. */
type RouteOutcome =
  | { readonly kind: 'method-missing' }
  | { readonly kind: 'invalid-params'; readonly message: string }
  | { readonly kind: 'result'; readonly result: Result<unknown, Error> };

const inFlightKey = (connectionId: string, id: RpcInFlightId): string =>
  `${connectionId}\u0000${typeof id === 'number' ? `n:${id}` : `s:${id}`}`;

const cancelTargetId = (params: unknown): RpcInFlightId | undefined => {
  if (!isObject(params)) {
    return undefined;
  }
  const { id } = params;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
};

const progressNotification = (
  id: RpcInFlightId,
  event: Parameters<ProgressCallback>[0]
): JsonRpcRequest => ({
  jsonrpc: '2.0',
  method: 'trails.progress',
  params: { event, id },
});

const createConnectionId = (): string => {
  const randomUUID = globalThis.crypto?.randomUUID;
  return typeof randomUUID === 'function'
    ? randomUUID.call(globalThis.crypto)
    : `rpc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

const unknownOutcome = (id: RpcInFlightId): JsonRpcResponse =>
  jsonRpcFailure(
    id,
    JSON_RPC_INTERNAL_ERROR,
    'Request outcome unknown: the connection was interrupted before this request settled',
    { outcome: 'unknown' }
  );

/**
 * Create the host-agnostic JSON-RPC kernel for a topo.
 *
 * The kernel maps `(connection state, inbound frame)` to `(new state,
 * outbound frames, effects)`. Trails run through the shared execution
 * pipeline with `params` as input; failures render as JSON-RPC errors with
 * core's codes and `data.category`, `data.retryable`, `data.name`.
 *
 * @example
 * ```ts
 * import { Result, topo, trail } from '@ontrails/core';
 * import { createRpcHandler } from '@ontrails/rpc';
 * import { z } from 'zod';
 *
 * const greet = trail('greet', {
 *   implementation: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
 *   input: z.object({ name: z.string() }),
 *   output: z.object({ greeting: z.string() }),
 * });
 * const handler = createRpcHandler(topo('app', { greet })).unwrap();
 * const step = await handler.handle(
 *   handler.createState(),
 *   '{"jsonrpc":"2.0","id":1,"method":"greet","params":{"name":"Ada"}}'
 * );
 * // step.frames[0] → { jsonrpc: '2.0', id: 1, result: { greeting: 'Hello, Ada!' } }
 * ```
 */
export const createRpcHandler = (
  graph: Topo,
  options: CreateRpcHandlerOptions = {}
): Result<RpcHandler, Error> => {
  const derived = deriveRpcMethods(graph, options);
  if (derived.isErr()) {
    return derived;
  }
  const methods = derived.value;
  const byMethod = new Map(
    methods.trails.map((entry) => [entry.method, entry])
  );
  const layers: readonly Layer[] = options.layers ?? [];
  const capabilities: RpcHostCapabilities = {
    ...DEFAULT_CAPABILITIES,
    ...options.capabilities,
  };

  // Runtime cancellation handles live only in the host process; after a
  // wake there is nothing to cancel and `recover` already answered the id.
  const aborts = new Map<string, AbortController>();

  const discover = (state: RpcConnectionState): RpcDiscoverResult => ({
    capabilities,
    methods: methods.framework
      .filter(
        (entry) =>
          entry.capability === undefined || capabilities[entry.capability]
      )
      .map((entry) => entry.method),
    protocol: RPC_SUBPROTOCOL,
    signals: methods.signals,
    trails: methods.trails
      .filter((entry) => permitCovers(entry.permit, state.permit))
      .map((entry) => ({
        description: entry.description,
        examples: entry.examples,
        id: entry.trailId,
        input: entry.inputSchema,
        intent: entry.intent,
        output: entry.outputSchema,
      })),
  });

  const invokeTrail = async (
    state: RpcConnectionState,
    entry: RpcTrailMethod,
    request: JsonRpcRequest,
    host: RpcRunHost | undefined
  ): Promise<RouteOutcome> => {
    const params = request.params ?? {};
    if (!isObject(params)) {
      return {
        kind: 'invalid-params',
        message: 'params must be an object of trail input fields',
      };
    }
    const trail = graph.get(entry.trailId);
    if (trail === undefined) {
      return { kind: 'method-missing' };
    }
    const split = splitParams(params, entry.layerRenderings);
    if (split.kind === 'invalid') {
      return { kind: 'invalid-params', message: split.message };
    }
    const { layerInputs, trailInput, version } = split.params;
    const id =
      request.id === undefined || request.id === null ? undefined : request.id;
    const send = host?.send;
    const progress: ProgressCallback | undefined =
      id === undefined || send === undefined || !capabilities.progress
        ? undefined
        : (event) => {
            send(progressNotification(id, event));
          };
    const controller = new AbortController();
    const key =
      id === undefined ? undefined : inFlightKey(state.connectionId, id);
    if (key !== undefined) {
      aborts.set(key, controller);
    }
    try {
      const result = await executeTrail(trail, trailInput, {
        abortSignal: controller.signal,
        configValues: options.configValues,
        createContext: options.createContext,
        ctx: withSurfaceLayerNames(
          'jsonRpc',
          layers,
          progress === undefined ? {} : { progress }
        ),
        ...(Object.keys(layerInputs).length === 0 ? {} : { layerInputs }),
        ...(state.permit === undefined ? {} : { permit: state.permit }),
        resources: options.resources,
        surfaceLayers: layers,
        topo: graph,
        ...(version === undefined ? {} : { version }),
      });
      return { kind: 'result', result };
    } finally {
      if (key !== undefined) {
        aborts.delete(key);
      }
    }
  };

  const respond = (
    request: JsonRpcRequest,
    outcome: RouteOutcome
  ): JsonRpcResponse | undefined => {
    if (request.id === undefined) {
      return undefined;
    }
    switch (outcome.kind) {
      case 'method-missing': {
        return jsonRpcFailure(
          request.id,
          JSON_RPC_METHOD_NOT_FOUND,
          `Method not found: ${request.method}`
        );
      }
      case 'invalid-params': {
        return jsonRpcFailure(
          request.id,
          JSON_RPC_INVALID_PARAMS,
          `Invalid params: ${outcome.message}`
        );
      }
      case 'result': {
        if (outcome.result.isOk()) {
          return jsonRpcSuccess(request.id, outcome.result.value);
        }
        const rendering = renderJsonRpcError('jsonRpc', outcome.result.error);
        return jsonRpcFailure(
          request.id,
          rendering.code,
          rendering.message,
          rendering.data
        );
      }
      default: {
        return undefined;
      }
    }
  };

  const cancel = (
    state: RpcConnectionState,
    request: JsonRpcRequest
  ): RouteOutcome => {
    const target = cancelTargetId(request.params);
    if (target === undefined) {
      return {
        kind: 'invalid-params',
        message: 'trails.cancel expects { id } naming an in-flight request',
      };
    }
    const controller = aborts.get(inFlightKey(state.connectionId, target));
    controller?.abort();
    return {
      kind: 'result',
      result: Result.ok({ cancelled: controller !== undefined, id: target }),
    };
  };

  const route = async (
    state: RpcConnectionState,
    request: JsonRpcRequest,
    host: RpcRunHost | undefined
  ): Promise<JsonRpcResponse | undefined> => {
    if (request.method === 'trails.discover') {
      return respond(request, {
        kind: 'result',
        result: Result.ok(discover(state)),
      });
    }
    if (request.method === 'trails.cancel') {
      return respond(request, cancel(state, request));
    }
    const entry = isReservedRpcMethod(request.method)
      ? undefined
      : byMethod.get(request.method);
    if (entry === undefined) {
      return respond(request, { kind: 'method-missing' });
    }
    return respond(request, await invokeTrail(state, entry, request, host));
  };

  const createState: RpcHandler['createState'] = (init) => ({
    connectionId: init?.connectionId ?? createConnectionId(),
    inFlight: [],
    permit: init?.permit,
    protocol: RPC_SUBPROTOCOL,
  });

  const admit: RpcHandler['admit'] = (state, frame) => {
    const parsed = parseJsonRpcFrame(frame);
    if (parsed.kind === 'error') {
      return { frames: [parsed.response], state, work: undefined };
    }
    const requests: JsonRpcRequest[] = [];
    const settled: JsonRpcResponse[] = [];
    for (const item of parsed.frame.requests) {
      if (item.kind === 'request') {
        requests.push(item.request);
      } else {
        settled.push(item.response);
      }
    }
    if (requests.length === 0) {
      return {
        frames: frameFor(parsed.frame.batch, settled),
        state,
        work: undefined,
      };
    }
    return {
      frames: [],
      state: {
        ...state,
        inFlight: [...state.inFlight, ...inFlightIds(requests)],
      },
      work: { batch: parsed.frame.batch, requests, settled },
    };
  };

  const run: RpcHandler['run'] = async (state, work, host) => {
    const responses = [...work.settled];
    for (const request of work.requests) {
      const response = await route(state, request, host);
      if (response !== undefined) {
        responses.push(response);
      }
    }
    return {
      effects: [],
      frames: frameFor(work.batch, responses),
      state: withoutIds(state, inFlightIds(work.requests)),
    };
  };

  const handle: RpcHandler['handle'] = async (state, frame, host) => {
    const admitted = admit(state, frame);
    if (admitted.work === undefined) {
      return { effects: [], frames: admitted.frames, state: admitted.state };
    }
    return await run(admitted.state, admitted.work, host);
  };

  const recover: RpcHandler['recover'] = (state) => ({
    effects: [],
    frames: state.inFlight.map((id) => unknownOutcome(id)),
    state: { ...state, inFlight: [] },
  });

  return Result.ok({ admit, createState, handle, methods, recover, run });
};
