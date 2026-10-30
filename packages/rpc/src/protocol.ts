/**
 * JSON-RPC 2.0 wire vocabulary for the Trails RPC surface.
 *
 * One WebSocket text frame (or one host message) carries one JSON-RPC
 * message or one batch. Parsing stays host-agnostic: hosts hand the kernel
 * the frame text and receive plain messages back.
 */

/** The WebSocket subprotocol every RPC host negotiates. */
export const RPC_SUBPROTOCOL = 'trails.v1';

/** Methods under this prefix belong to the framework, never to a trail id. */
export const RPC_FRAMEWORK_PREFIX = 'trails.';

/** JSON-RPC 2.0 reserves this prefix for protocol extensions. */
export const JSON_RPC_RESERVED_PREFIX = 'rpc.';

export const JSON_RPC_PARSE_ERROR = -32_700;
export const JSON_RPC_INVALID_REQUEST = -32_600;
export const JSON_RPC_METHOD_NOT_FOUND = -32_601;
export const JSON_RPC_INVALID_PARAMS = -32_602;
export const JSON_RPC_INTERNAL_ERROR = -32_603;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  /** Absent for notifications, which never receive a response. */
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** Anything the kernel can emit toward a client. */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse;

/** One outbound frame: a single message or a batch of them. */
export type JsonRpcFrame = JsonRpcMessage | readonly JsonRpcMessage[];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonRpcId = (value: unknown): value is JsonRpcId =>
  value === null || typeof value === 'string' || typeof value === 'number';

export const jsonRpcFailure = (
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcFailure => ({
  error: data === undefined ? { code, message } : { code, data, message },
  id,
  jsonrpc: '2.0',
});

export const jsonRpcSuccess = (
  id: JsonRpcId,
  result: unknown
): JsonRpcSuccess => ({ id, jsonrpc: '2.0', result });

/** A request whose shape failed validation, with the best id we could salvage. */
export interface InvalidJsonRpcRequest {
  readonly kind: 'invalid';
  readonly response: JsonRpcFailure;
}

export interface ValidJsonRpcRequest {
  readonly kind: 'request';
  readonly request: JsonRpcRequest;
}

export type ParsedJsonRpcRequest = ValidJsonRpcRequest | InvalidJsonRpcRequest;

export interface ParsedJsonRpcFrame {
  /** Batches answer with an array even when a single entry responds. */
  readonly batch: boolean;
  readonly requests: readonly ParsedJsonRpcRequest[];
}

export type ParseJsonRpcFrameResult =
  | { readonly kind: 'parsed'; readonly frame: ParsedJsonRpcFrame }
  | { readonly kind: 'error'; readonly response: JsonRpcFailure };

const validateRequest = (value: unknown): ParsedJsonRpcRequest => {
  if (!isObject(value)) {
    return {
      kind: 'invalid',
      response: jsonRpcFailure(
        null,
        JSON_RPC_INVALID_REQUEST,
        'Invalid Request: expected a JSON-RPC request object'
      ),
    };
  }
  const id = isJsonRpcId(value['id']) ? value['id'] : null;
  if (value['jsonrpc'] !== '2.0') {
    return {
      kind: 'invalid',
      response: jsonRpcFailure(
        id,
        JSON_RPC_INVALID_REQUEST,
        'Invalid Request: jsonrpc must be "2.0"'
      ),
    };
  }
  if ('id' in value && !isJsonRpcId(value['id'])) {
    return {
      kind: 'invalid',
      response: jsonRpcFailure(
        null,
        JSON_RPC_INVALID_REQUEST,
        'Invalid Request: id must be a string or number'
      ),
    };
  }
  // A null id cannot be tracked in flight or answered after a wake, and the
  // specification reserves it for responses to unparseable requests.
  if ('id' in value && value['id'] === null) {
    return {
      kind: 'invalid',
      response: jsonRpcFailure(
        null,
        JSON_RPC_INVALID_REQUEST,
        'Invalid Request: id must not be null; omit it for a notification'
      ),
    };
  }
  const { method } = value;
  if (typeof method !== 'string' || method.length === 0) {
    return {
      kind: 'invalid',
      response: jsonRpcFailure(
        id,
        JSON_RPC_INVALID_REQUEST,
        'Invalid Request: method must be a non-empty string'
      ),
    };
  }
  const { params } = value;
  if (params !== undefined && !isObject(params) && !Array.isArray(params)) {
    return {
      kind: 'invalid',
      response: jsonRpcFailure(
        id,
        JSON_RPC_INVALID_REQUEST,
        'Invalid Request: params must be an object or an array'
      ),
    };
  }
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    ...('id' in value ? { id } : {}),
    ...(params === undefined ? {} : { params }),
  };
  return { kind: 'request', request };
};

/**
 * Parse one inbound frame into validated requests.
 *
 * Parse failures and an empty batch answer with a single error response, as
 * the JSON-RPC 2.0 specification requires. Shape failures inside a batch
 * keep their position so each entry still answers individually.
 *
 * @example
 * ```ts
 * import { parseJsonRpcFrame } from '@ontrails/rpc';
 *
 * const parsed = parseJsonRpcFrame('{"jsonrpc":"2.0","id":1,"method":"greet","params":{"name":"Ada"}}');
 * // parsed.kind === 'parsed' && parsed.frame.requests[0]?.kind === 'request'
 * ```
 */
export const parseJsonRpcFrame = (text: string): ParseJsonRpcFrameResult => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      kind: 'error',
      response: jsonRpcFailure(
        null,
        JSON_RPC_PARSE_ERROR,
        'Parse error: frame is not valid JSON'
      ),
    };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {
        kind: 'error',
        response: jsonRpcFailure(
          null,
          JSON_RPC_INVALID_REQUEST,
          'Invalid Request: batch must not be empty'
        ),
      };
    }
    return {
      frame: { batch: true, requests: value.map(validateRequest) },
      kind: 'parsed',
    };
  }
  return {
    frame: { batch: false, requests: [validateRequest(value)] },
    kind: 'parsed',
  };
};

/** Whether a method name is reserved by JSON-RPC itself or by Trails. */
export const isReservedRpcMethod = (method: string): boolean =>
  method.startsWith(RPC_FRAMEWORK_PREFIX) ||
  method.startsWith(JSON_RPC_RESERVED_PREFIX);
