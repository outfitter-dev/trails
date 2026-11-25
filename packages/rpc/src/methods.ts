import {
  collectAttachedTypedLayers,
  deriveStructuredTrailExamples,
  filterSurfaceTrails,
  LAYER_FIELD_RESERVED_NAMES,
  renderLayerFieldName,
  Result,
  validateSurfaceTopo,
  ValidationError,
  zodToJsonSchema,
} from '@ontrails/core';
import type {
  AnyTrail,
  AttachedTypedLayer,
  BaseSurfaceOptions,
  Intent,
  Layer,
  PermitRequirement,
  StructuredTrailExample,
  Topo,
} from '@ontrails/core';

import { isReservedRpcMethod, RPC_SUBPROTOCOL } from './protocol.js';

/** Reserved `params` key carrying per-request framework fields. */
export const RPC_META_PARAM = '_meta';

export interface DeriveRpcMethodsOptions extends BaseSurfaceOptions {
  /** Typed layers attached at surface scope; their inputs render into every trail method. */
  readonly layers?: readonly Layer[] | undefined;
}

/** How one typed layer's input fields ride inside a trail method's `params`. */
export interface RpcLayerInputRendering {
  readonly layerName: string;
  /** rendered parameter name → original layer field name. */
  readonly routing: ReadonlyMap<string, string>;
  /** JSON Schema fragment merged into the method's `params` properties. */
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}

/** One trail rendered as a JSON-RPC method: the trail id is the method name. */
export interface RpcTrailMethod {
  readonly kind: 'trail';
  readonly method: string;
  readonly trailId: string;
  readonly intent: Intent;
  readonly description?: string | undefined;
  /** JSON Schema for `params`, including rendered layer inputs. */
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown> | undefined;
  readonly examples?: readonly StructuredTrailExample[] | undefined;
  readonly permit?: PermitRequirement | undefined;
  readonly layerRenderings: readonly RpcLayerInputRendering[];
}

export type RpcFrameworkMethodName =
  | 'trails.discover'
  | 'trails.cancel'
  | 'trails.progress';

/** A `trails.*` method the kernel implements and advertises. */
export interface RpcFrameworkMethod {
  readonly kind: 'framework';
  readonly method: RpcFrameworkMethodName;
  readonly direction: 'client-to-server' | 'server-to-client';
  readonly messageKind: 'request' | 'notification';
  /** Advertised only when the mounting host declares this capability. */
  readonly capability?: 'progress' | undefined;
}

export interface RpcSignalChannel {
  readonly id: string;
  readonly description?: string | undefined;
}

/** The derived method and channel table a host mounts. */
export interface RpcMethodTable {
  readonly subprotocol: typeof RPC_SUBPROTOCOL;
  readonly trails: readonly RpcTrailMethod[];
  readonly framework: readonly RpcFrameworkMethod[];
  /** Signal ids that a later subscription rendering can name as channels. */
  readonly signals: readonly RpcSignalChannel[];
}

/** Framework methods implemented by the kernel today; never advertise ahead of implementation. */
export const RPC_FRAMEWORK_METHODS: readonly RpcFrameworkMethod[] = [
  {
    direction: 'client-to-server',
    kind: 'framework',
    messageKind: 'request',
    method: 'trails.discover',
  },
  {
    direction: 'client-to-server',
    kind: 'framework',
    messageKind: 'notification',
    method: 'trails.cancel',
  },
  {
    capability: 'progress',
    direction: 'server-to-client',
    kind: 'framework',
    messageKind: 'notification',
    method: 'trails.progress',
  },
];

const isJsonObjectSchema = (
  value: unknown
): value is { properties?: Record<string, unknown>; required?: string[] } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const renameTarget = (layerName: string, fieldName: string): string => {
  const [head, ...rest] = fieldName;
  return head === undefined
    ? layerName
    : `${layerName}${head.toUpperCase()}${rest.join('')}`;
};

/**
 * Render one typed layer's input fields into `params` properties.
 *
 * Mirrors the MCP rendering in `packages/mcp/src/build.ts` (`renderMcpLayerInput`,
 * lines 577-632 at 00cb0249c): same JSON Schema walk, same camelCase rename
 * target and the shared `renderLayerFieldName` collision policy, so a layer
 * field keeps one name across MCP and RPC. Change both when the policy moves.
 */
const renderLayerInput = (
  layer: Layer,
  claimedNames: Set<string>
): RpcLayerInputRendering => {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const routing = new Map<string, string>();
  if (layer.input === undefined) {
    return { layerName: layer.name, properties, required, routing };
  }
  const schema = zodToJsonSchema(layer.input);
  if (!isJsonObjectSchema(schema) || schema.properties === undefined) {
    return { layerName: layer.name, properties, required, routing };
  }
  const requiredSet = new Set(schema.required);
  for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
    const rendering = renderLayerFieldName(
      layer.name,
      fieldName,
      fieldName,
      renameTarget(layer.name, fieldName),
      claimedNames,
      LAYER_FIELD_RESERVED_NAMES
    );
    properties[rendering.claimedName] = fieldSchema;
    if (requiredSet.has(fieldName)) {
      required.push(rendering.claimedName);
    }
    routing.set(rendering.claimedName, rendering.routingTarget);
  }
  return { layerName: layer.name, properties, required, routing };
};

interface ParamsRendering {
  readonly schema: Record<string, unknown>;
  readonly renderings: readonly RpcLayerInputRendering[];
}

const renderParamsSchema = (
  trail: AnyTrail,
  attached: readonly AttachedTypedLayer[]
): ParamsRendering => {
  const base = zodToJsonSchema(trail.input);
  if (attached.length === 0) {
    return { renderings: [], schema: base };
  }
  const baseProperties = isJsonObjectSchema(base) ? base.properties : undefined;
  const baseRequired =
    isJsonObjectSchema(base) && Array.isArray(base.required)
      ? base.required
      : [];
  const claimedNames = new Set<string>([
    ...(baseProperties === undefined ? [] : Object.keys(baseProperties)),
    RPC_META_PARAM,
  ]);
  const properties: Record<string, unknown> = { ...baseProperties };
  const required = [...baseRequired];
  const renderings: RpcLayerInputRendering[] = [];
  for (const { layer } of attached) {
    const rendering = renderLayerInput(layer, claimedNames);
    if (rendering.routing.size === 0) {
      continue;
    }
    Object.assign(properties, rendering.properties);
    required.push(...rendering.required);
    renderings.push(rendering);
  }
  if (renderings.length === 0) {
    return { renderings: [], schema: base };
  }
  const schema: Record<string, unknown> = isJsonObjectSchema(base)
    ? { ...base, properties, type: 'object' }
    : { properties, type: 'object' };
  if (required.length > 0) {
    schema['required'] = required;
  } else {
    delete schema['required'];
  }
  return { renderings, schema };
};

const renderTrailMethod = (
  graph: Topo,
  trail: AnyTrail,
  surfaceLayers: readonly Layer[]
): RpcTrailMethod => {
  const params = renderParamsSchema(
    trail,
    collectAttachedTypedLayers(graph, trail, surfaceLayers)
  );
  const examples = deriveStructuredTrailExamples(trail.examples);
  return {
    description: trail.description,
    examples,
    inputSchema: params.schema,
    intent: trail.intent,
    kind: 'trail',
    layerRenderings: params.renderings,
    method: trail.id,
    outputSchema:
      trail.output === undefined ? undefined : zodToJsonSchema(trail.output),
    permit: trail.permit,
    trailId: trail.id,
  };
};

const reservedTrailIds = (graph: Topo): readonly string[] =>
  graph
    .ids()
    .filter((id) => isReservedRpcMethod(id))
    .toSorted();

/**
 * Derive the JSON-RPC method and channel table from a topo without opening
 * anything.
 *
 * Trail ids are the method names, so ids under the reserved `trails.` and
 * `rpc.` prefixes are rejected for the whole topo, not just the surface
 * selection. Visibility, intent and `_draft.` exclusion follow the shared
 * surface selection grammar.
 *
 * @example
 * ```ts
 * import { Result, topo, trail } from '@ontrails/core';
 * import { deriveRpcMethods } from '@ontrails/rpc';
 * import { z } from 'zod';
 *
 * const greet = trail('greet', {
 *   implementation: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
 *   input: z.object({ name: z.string() }),
 *   output: z.object({ greeting: z.string() }),
 * });
 * const table = deriveRpcMethods(topo('app', { greet })).unwrap();
 * // table.trails[0]?.method === 'greet'
 * ```
 */
export const deriveRpcMethods = (
  graph: Topo,
  options: DeriveRpcMethodsOptions = {}
): Result<RpcMethodTable, Error> => {
  const validated = validateSurfaceTopo(graph, options);
  if (validated.isErr()) {
    return validated;
  }
  const reserved = reservedTrailIds(graph);
  if (reserved.length > 0) {
    return Result.err(
      new ValidationError(
        `Trail ids cannot use the reserved RPC method prefixes "trails." or "rpc.": ${reserved.join(', ')}. Rename the trail so its id stays a plain JSON-RPC method name.`
      )
    );
  }
  const surfaceLayers = options.layers ?? [];
  const trails = filterSurfaceTrails(graph.list(), {
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
  })
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .map((trail) => renderTrailMethod(graph, trail, surfaceLayers));
  const signals = graph
    .listSignals()
    .map((signal) => ({ description: signal.description, id: signal.id }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  return Result.ok({
    framework: RPC_FRAMEWORK_METHODS,
    signals,
    subprotocol: RPC_SUBPROTOCOL,
    trails,
  });
};
