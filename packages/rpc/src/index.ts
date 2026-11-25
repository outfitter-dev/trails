/**
 * Derive the JSON-RPC method and channel table from a topo.
 * @example
 * ```ts
 * import { deriveRpcMethods } from '@ontrails/rpc';
 * const table = deriveRpcMethods(graph).unwrap();
 * ```
 */
export {
  deriveRpcMethods,
  RPC_FRAMEWORK_METHODS,
  RPC_META_PARAM,
} from './methods.js';
/**
 * Method table shapes a host renders or mounts.
 * @example
 * ```ts
 * import type { RpcMethodTable } from '@ontrails/rpc';
 * const names = (table: RpcMethodTable) => table.trails.map((entry) => entry.method);
 * ```
 */
export type {
  DeriveRpcMethodsOptions,
  RpcFrameworkMethod,
  RpcFrameworkMethodName,
  RpcLayerInputRendering,
  RpcMethodTable,
  RpcSignalChannel,
  RpcTrailMethod,
} from './methods.js';
/**
 * Create the host-agnostic JSON-RPC kernel.
 * @example
 * ```ts
 * import { createRpcHandler } from '@ontrails/rpc';
 * const handler = createRpcHandler(graph).unwrap();
 * ```
 */
export { createRpcHandler } from './kernel.js';
/**
 * Kernel state, work, and effect shapes hosts persist and execute.
 * @example
 * ```ts
 * import type { RpcConnectionState } from '@ontrails/rpc';
 * const pending = (state: RpcConnectionState) => state.inFlight.length;
 * ```
 */
export type {
  CreateRpcHandlerOptions,
  RpcAdmission,
  RpcAdmittedWork,
  RpcConnectionState,
  RpcDiscoveredTrail,
  RpcDiscoverResult,
  RpcEffect,
  RpcHandler,
  RpcHostCapabilities,
  RpcInFlightId,
  RpcRunHost,
  RpcStepResult,
} from './kernel.js';
/**
 * JSON-RPC 2.0 wire constants and frame parsing shared by every host.
 * @example
 * ```ts
 * import { RPC_SUBPROTOCOL, parseJsonRpcFrame } from '@ontrails/rpc';
 * const accepted = RPC_SUBPROTOCOL === 'trails.v1';
 * const parsed = parseJsonRpcFrame('{"jsonrpc":"2.0","method":"trails.discover","id":1}');
 * ```
 */
export {
  isReservedRpcMethod,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_RESERVED_PREFIX,
  jsonRpcFailure,
  jsonRpcSuccess,
  parseJsonRpcFrame,
  RPC_FRAMEWORK_PREFIX,
  RPC_SUBPROTOCOL,
} from './protocol.js';
/**
 * JSON-RPC 2.0 message shapes.
 * @example
 * ```ts
 * import type { JsonRpcResponse } from '@ontrails/rpc';
 * const isFailure = (response: JsonRpcResponse) => 'error' in response;
 * ```
 */
export type {
  JsonRpcErrorObject,
  JsonRpcFailure,
  JsonRpcFrame,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccess,
  ParsedJsonRpcFrame,
  ParsedJsonRpcRequest,
  ParseJsonRpcFrameResult,
} from './protocol.js';
