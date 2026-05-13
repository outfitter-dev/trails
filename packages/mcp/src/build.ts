/**
 * Build MCP tool definitions from a Trails graph.
 *
 * Iterates the topo, generates McpToolDefinition[] with handlers that
 * validate input, compose layers, execute the implementation, and map
 * Results to MCP responses.
 */

import {
  AuthError,
  Result,
  ValidationError,
  collectAttachedTypedLayers,
  deriveStructuredTrailExamples,
  executeTrail,
  filterSurfaceTrails,
  isBlobRef,
  isTrailsError,
  LAYER_FIELD_RESERVED_NAMES,
  projectLayerFieldName,
  projectPublicSurfaceError,
  toBlobRefDescriptor,
  validateSurfaceTopo,
  withSurfaceLayerNames,
  zodToJsonSchema,
} from '@ontrails/core';
import type {
  AttachedTypedLayer,
  BasePermit,
  BaseSurfaceOptions,
  BlobRef,
  Layer,
  ResourceOverrideMap,
  SurfaceErrorProjection,
  Topo,
  Trail,
  TrailContextInit,
} from '@ontrails/core';

import type { McpAnnotations } from './annotations.js';
import { deriveAnnotations } from './annotations.js';
import { createMcpProgressCallback } from './progress.js';
import { deriveToolName } from './tool-name.js';

export const MCP_TOOL_EXAMPLES_META_KEY = 'ontrails/examples';

export const MCP_TOOL_ERROR_META_KEY = 'ontrails/error';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DeriveMcpToolsOptions extends BaseSurfaceOptions {
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  readonly resolvePermit?: ResolveMcpPermit | undefined;
}

export interface ResolveMcpPermitInput {
  readonly authorization?: string | undefined;
  readonly bearerToken?: string | undefined;
  readonly sessionId?: string | undefined;
}

export type ResolveMcpPermit = (
  input: ResolveMcpPermitInput
) =>
  | Promise<Result<BasePermit | null | undefined, Error>>
  | Result<BasePermit | null | undefined, Error>;

export interface McpToolDefinition {
  readonly _meta?: Record<string, unknown> | undefined;
  readonly annotations: McpAnnotations | undefined;
  readonly description: string | undefined;
  readonly handler: (
    args: Record<string, unknown>,
    extra: McpExtra
  ) => Promise<McpToolResult>;
  readonly inputSchema: Record<string, unknown>;
  readonly name: string;
  readonly outputSchema?: Record<string, unknown> | undefined;
  /** The trail ID this tool was derived from. */
  readonly trailId: string;
}

export interface McpExtra {
  readonly authorization?: string | undefined;
  readonly progressToken?: string | number | undefined;
  readonly sendProgress?:
    | ((current: number, total: number) => Promise<void>)
    | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly permit?: BasePermit | undefined;
  readonly sessionId?: string | undefined;
}

export interface McpToolResult {
  readonly _meta?: Record<string, unknown> | undefined;
  readonly content: readonly McpContent[];
  readonly isError?: boolean | undefined;
  readonly structuredContent?: Record<string, unknown> | undefined;
}

export type McpToolErrorMeta = Omit<SurfaceErrorProjection, 'surface'> & {
  readonly surface: 'mcp';
};

export interface McpContent {
  readonly data?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly text?: string | undefined;
  readonly type: 'text' | 'image' | 'resource';
  readonly uri?: string | undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers (defined before use)
// ---------------------------------------------------------------------------

/** Concatenate an array of Uint8Array chunks into a single Uint8Array. */
const concatChunks = (
  chunks: Uint8Array[],
  totalLength: number
): Uint8Array => {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

/** Collect a ReadableStream into a single Uint8Array. */
const collectStream = async (
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      totalLength += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  return concatChunks(chunks, totalLength);
};

/** Resolve BlobRef data to Uint8Array (handles ReadableStream). */
const resolveBlobData = (blob: BlobRef): Promise<Uint8Array> | Uint8Array => {
  if (blob.data instanceof ReadableStream) {
    return collectStream(blob.data);
  }
  return blob.data;
};

type BlobDataResolver = (blob: BlobRef) => Promise<Uint8Array> | Uint8Array;

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  // Use btoa with manual conversion for runtime-agnostic base64
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const blobToContent = async (
  blob: BlobRef,
  resolveData: BlobDataResolver = resolveBlobData
): Promise<McpContent> => {
  if (!blob.mimeType.startsWith('image/')) {
    return {
      mimeType: blob.mimeType,
      type: 'resource',
      uri: `blob://${blob.name}`,
    };
  }

  const bytes = await resolveData(blob);
  return {
    data: uint8ArrayToBase64(bytes),
    mimeType: blob.mimeType,
    type: 'image',
  };
};

type BlobContentResolver = (blob: BlobRef) => Promise<McpContent>;

const createBlobContentResolver = (): BlobContentResolver => {
  const contentByBlob = new WeakMap<BlobRef, Promise<McpContent>>();
  const dataByStream = new WeakMap<
    ReadableStream<Uint8Array>,
    Promise<Uint8Array>
  >();

  const resolveData: BlobDataResolver = (blob) => {
    if (!(blob.data instanceof ReadableStream)) {
      return blob.data;
    }

    let data = dataByStream.get(blob.data);
    if (data === undefined) {
      data = collectStream(blob.data);
      dataByStream.set(blob.data, data);
    }
    return data;
  };

  return (blob) => {
    let content = contentByBlob.get(blob);
    if (content === undefined) {
      content = blobToContent(blob, resolveData);
      contentByBlob.set(blob, content);
    }
    return content;
  };
};

const containsBlobRef = (
  value: unknown,
  path = new WeakSet<object>()
): boolean => {
  if (isBlobRef(value)) {
    return true;
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (path.has(value)) {
    return false;
  }
  path.add(value);

  try {
    if (Array.isArray(value)) {
      return value.some((item) => containsBlobRef(item, path));
    }

    return Object.values(value as Record<string, unknown>).some((item) =>
      containsBlobRef(item, path)
    );
  } finally {
    path.delete(value);
  }
};

const toStructuredValue = (
  value: unknown,
  path = new WeakSet<object>()
): unknown => {
  if (isBlobRef(value)) {
    return toBlobRefDescriptor(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (path.has(value)) {
    return undefined;
  }
  path.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => toStructuredValue(item, path));
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        toStructuredValue(item, path),
      ])
    );
  } finally {
    path.delete(value);
  }
};

const collectBlobRefs = (
  value: unknown,
  path = new WeakSet<object>()
): BlobRef[] => {
  if (isBlobRef(value)) {
    return [value];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  if (path.has(value)) {
    return [];
  }
  path.add(value);

  try {
    const items = Array.isArray(value)
      ? value
      : Object.values(value as Record<string, unknown>);
    return items.flatMap((item) => collectBlobRefs(item, path));
  } finally {
    path.delete(value);
  }
};

const collectBlobContents = async (
  value: unknown,
  resolveContent: BlobContentResolver
): Promise<McpContent[]> =>
  Promise.all(collectBlobRefs(value).map(resolveContent));

/** Separate blob fields from non-blob fields in an object. */
const separateBlobFields = async (
  obj: Record<string, unknown>
): Promise<{
  blobContents: McpContent[];
  hasBlobFields: boolean;
  textFields: Record<string, unknown>;
}> => {
  const resolveContent = createBlobContentResolver();
  const blobContents: McpContent[] = [];
  const textFields: Record<string, unknown> = {};
  let hasBlobFields = false;
  for (const [key, val] of Object.entries(obj)) {
    if (isBlobRef(val)) {
      hasBlobFields = true;
      blobContents.push(await resolveContent(val));
    } else if (containsBlobRef(val)) {
      hasBlobFields = true;
      blobContents.push(...(await collectBlobContents(val, resolveContent)));
      textFields[key] = toStructuredValue(val);
    } else {
      textFields[key] = val;
    }
  }
  return { blobContents, hasBlobFields, textFields };
};

/** Serialize a mixed blob/text object to MCP content. */
const serializeMixedObject = async (
  obj: Record<string, unknown>
): Promise<readonly McpContent[] | undefined> => {
  const { blobContents, hasBlobFields, textFields } =
    await separateBlobFields(obj);
  if (!hasBlobFields) {
    return undefined;
  }
  if (Object.keys(textFields).length > 0) {
    blobContents.unshift({ text: JSON.stringify(textFields), type: 'text' });
  }
  return blobContents;
};

const serializeBlobArray = async (
  value: readonly unknown[]
): Promise<readonly McpContent[] | undefined> => {
  if (!containsBlobRef(value)) {
    return undefined;
  }
  const blobContents = await collectBlobContents(
    value,
    createBlobContentResolver()
  );
  return [
    { text: JSON.stringify(toStructuredValue(value)), type: 'text' },
    ...blobContents,
  ];
};

const serializeOutput = async (
  value: unknown
): Promise<readonly McpContent[]> => {
  if (isBlobRef(value)) {
    return [await blobToContent(value)];
  }
  if (Array.isArray(value)) {
    const mixed = await serializeBlobArray(value);
    if (mixed) {
      return mixed;
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const mixed = await serializeMixedObject(value as Record<string, unknown>);
    if (mixed) {
      return mixed;
    }
  }
  return [{ text: JSON.stringify(value), type: 'text' }];
};

// `wrapAsData` is decided at build time from the schema shape (see
// `buildOutputSchemaProjection`). It must be threaded through to the runtime
// because the schema's wrap decision and the runtime value's wrap decision
// can diverge — e.g. for `z.union([z.object(...), z.string()])` or
// `z.any()`, the schema declares a `{ data: ... }` envelope but a runtime
// object value would otherwise be returned unwrapped, breaking the
// outputSchema/structuredContent contract.
const toStructuredContent = (
  value: unknown,
  wrapAsData: boolean
): Record<string, unknown> | undefined => {
  const structuredValue = containsBlobRef(value)
    ? toStructuredValue(value)
    : value;
  if (wrapAsData) {
    return { data: structuredValue };
  }
  if (
    structuredValue !== null &&
    typeof structuredValue === 'object' &&
    !Array.isArray(structuredValue)
  ) {
    return structuredValue as Record<string, unknown>;
  }
  // When wrapAsData is false the schema's top-level type is `'object'`, and
  // output validation has already constrained the runtime value to that
  // shape — a primitive or array reaching this branch indicates the
  // validation contract was bypassed. Return `undefined` so any future
  // bypass surfaces as a missing `structuredContent` rather than a silently
  // wrapped envelope that contradicts the published `outputSchema`.
  return undefined;
};

// ---------------------------------------------------------------------------
// Layer input projection (TRL-474)
// ---------------------------------------------------------------------------

/**
 * Per-layer projection onto an MCP tool's input schema.
 *
 * `routing` maps the parameter name a consumer sees on the tool to the
 * authored field name on the layer's input schema. When no rename was
 * required the two are the same; on collision the parameter name carries
 * the layer prefix while the routing target preserves the original field.
 */
interface McpLayerInputProjection {
  readonly layerName: string;
  /** parameterName → originalFieldName for this layer. */
  readonly routing: ReadonlyMap<string, string>;
  /** Fragment merged into the top-level input schema's `properties`. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** Field names appended to the top-level `required` list. */
  readonly required: readonly string[];
}

/**
 * Build the camelCase rename target for a layer field collision.
 *
 * The CLI projection uses `kebab-case` (`<layerName>-<field>`); MCP exposes
 * fields as JSON properties so the corresponding shape is camelCase
 * (`<layerName><FieldCapitalized>`). The shared collision policy lives in
 * `projectLayerFieldName`; this helper just supplies the surface-specific
 * fallback name.
 */
const buildMcpRenameTarget = (
  layerName: string,
  originalName: string
): string => {
  if (originalName.length === 0) {
    return layerName;
  }
  const [head, ...rest] = originalName;
  if (head === undefined) {
    return layerName;
  }
  return `${layerName}${head.toUpperCase()}${rest.join('')}`;
};

const isJsonObjectSchema = (
  value: unknown
): value is { properties?: Record<string, unknown>; required?: string[] } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Project a single layer's input schema into MCP-shaped property and
 * required fragments, applying the deterministic collision rename rule.
 */
const projectMcpLayerInput = (
  layer: Layer,
  claimedNames: Set<string>
): McpLayerInputProjection => {
  if (layer.input === undefined) {
    return {
      layerName: layer.name,
      properties: {},
      required: [],
      routing: new Map(),
    };
  }

  const layerSchema = zodToJsonSchema(layer.input);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const routing = new Map<string, string>();

  if (
    !isJsonObjectSchema(layerSchema) ||
    layerSchema.properties === undefined
  ) {
    return {
      layerName: layer.name,
      properties,
      required,
      routing,
    };
  }

  const requiredSet = new Set<string>(layerSchema.required);
  for (const [fieldName, fieldSchema] of Object.entries(
    layerSchema.properties
  )) {
    const renamed = buildMcpRenameTarget(layer.name, fieldName);
    const projection = projectLayerFieldName(
      layer.name,
      fieldName,
      fieldName,
      renamed,
      claimedNames,
      LAYER_FIELD_RESERVED_NAMES
    );
    properties[projection.claimedName] = fieldSchema;
    if (requiredSet.has(fieldName)) {
      required.push(projection.claimedName);
    }
    routing.set(projection.claimedName, projection.routingTarget);
  }

  return { layerName: layer.name, properties, required, routing };
};

interface McpInputProjection {
  readonly schema: Record<string, unknown>;
  readonly projections: readonly McpLayerInputProjection[];
}

/**
 * Merge typed layer input schemas into the trail's input schema.
 *
 * Returns the merged input schema published on the MCP tool plus the
 * per-layer routing tables consumed by the handler when partitioning
 * incoming parameters.
 */
const projectMcpInputSchema = (
  trail: Trail<unknown, unknown, unknown>,
  attachedLayers: readonly AttachedTypedLayer[]
): McpInputProjection => {
  const baseSchema = zodToJsonSchema(trail.input);
  if (attachedLayers.length === 0) {
    return { projections: [], schema: baseSchema };
  }

  const baseProperties =
    isJsonObjectSchema(baseSchema) && baseSchema.properties !== undefined
      ? baseSchema.properties
      : undefined;
  const baseRequired =
    isJsonObjectSchema(baseSchema) && Array.isArray(baseSchema.required)
      ? baseSchema.required
      : [];

  const claimedNames = new Set<string>(
    baseProperties === undefined ? [] : Object.keys(baseProperties)
  );

  const mergedProperties: Record<string, unknown> = {
    ...baseProperties,
  };
  const mergedRequired = [...baseRequired];
  const projections: McpLayerInputProjection[] = [];

  for (const { layer } of attachedLayers) {
    const projection = projectMcpLayerInput(layer, claimedNames);
    if (projection.routing.size === 0) {
      continue;
    }
    Object.assign(mergedProperties, projection.properties);
    mergedRequired.push(...projection.required);
    projections.push(projection);
  }

  if (projections.length === 0) {
    return { projections: [], schema: baseSchema };
  }

  const mergedSchema: Record<string, unknown> = isJsonObjectSchema(baseSchema)
    ? { ...baseSchema, properties: mergedProperties, type: 'object' }
    : { properties: mergedProperties, type: 'object' };
  if (mergedRequired.length > 0) {
    mergedSchema['required'] = mergedRequired;
  } else if ('required' in mergedSchema) {
    delete mergedSchema['required'];
  }

  return { projections, schema: mergedSchema };
};

/**
 * Partition a parsed MCP `args` record into the trail input plus per-layer
 * inputs, using each layer's routing table.
 *
 * Layer-projected parameter names are stripped from the trail input so the
 * trail's schema validation only ever sees its own fields. A layer that
 * received no parameters is omitted from `layerInputs` so consumers can
 * cleanly assert which layers were activated by the request.
 */
const partitionMcpArgs = (
  args: Record<string, unknown>,
  projections: readonly McpLayerInputProjection[]
): {
  readonly trailInput: Record<string, unknown>;
  readonly layerInputs: Record<string, unknown>;
} => {
  if (projections.length === 0) {
    return { layerInputs: {}, trailInput: { ...args } };
  }
  const claimedKeys = new Set<string>();
  const layerInputs: Record<string, unknown> = {};
  for (const projection of projections) {
    const layerInput: Record<string, unknown> = {};
    let received = false;
    for (const [paramName, fieldName] of projection.routing) {
      claimedKeys.add(paramName);
      const value = args[paramName];
      if (value === undefined) {
        continue;
      }
      layerInput[fieldName] = value;
      received = true;
    }
    if (received) {
      layerInputs[projection.layerName] = layerInput;
    }
  }
  const trailInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (claimedKeys.has(key)) {
      continue;
    }
    trailInput[key] = value;
  }
  return { layerInputs, trailInput };
};

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

const buildMcpErrorMeta = (
  error: Error,
  projection: SurfaceErrorProjection
): Record<string, McpToolErrorMeta> | undefined => {
  if (!isTrailsError(error)) {
    return undefined;
  }
  return {
    [MCP_TOOL_ERROR_META_KEY]: {
      ...projection,
      surface: 'mcp',
    },
  };
};

/** Create an error result for MCP responses. */
const mcpError = (error: Error): McpToolResult => {
  const projection = projectPublicSurfaceError('mcp', error);
  const meta = buildMcpErrorMeta(error, projection);
  return {
    ...(meta === undefined ? {} : { _meta: meta }),
    content: [{ text: projection.message, type: 'text' }],
    isError: true,
  };
};

/** Add the MCP surface marker while preserving any existing context extras. */
const withMcpSurface = (
  progressCb: TrailContextInit['progress'],
  layers: readonly Layer[]
): Partial<TrailContextInit> =>
  withSurfaceLayerNames(
    'mcp',
    layers,
    progressCb === undefined ? {} : { progress: progressCb }
  );

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
      new AuthError('Malformed MCP authorization; expected Bearer token', {
        context: { code: 'invalid_authorization_header' },
      })
    );
  }
  return Result.ok(token);
};

const resolveMcpPermit = async (
  options: DeriveMcpToolsOptions,
  extra: McpExtra
): Promise<Result<BasePermit | undefined, Error>> => {
  if (extra.permit !== undefined) {
    return Result.ok(extra.permit);
  }
  const token = parseBearerAuthorization(extra.authorization);
  if (token.isErr()) {
    return token;
  }
  if (token.value === undefined) {
    return Result.ok();
  }
  if (options.resolvePermit === undefined) {
    return Result.ok();
  }
  const resolved = await options.resolvePermit({
    authorization: extra.authorization,
    bearerToken: token.value,
    sessionId: extra.sessionId,
  });
  if (resolved.isErr()) {
    return resolved;
  }
  return Result.ok(resolved.value ?? undefined);
};

const createHandler =
  (
    graph: Topo,
    t: Trail<unknown, unknown, unknown>,
    layers: readonly Layer[],
    options: DeriveMcpToolsOptions,
    wrapAsData: boolean,
    layerProjections: readonly McpLayerInputProjection[]
  ): ((
    args: Record<string, unknown>,
    extra: McpExtra
  ) => Promise<McpToolResult>) =>
  async (args, extra): Promise<McpToolResult> => {
    const progressCb = createMcpProgressCallback(extra);
    const { trailInput, layerInputs } = partitionMcpArgs(
      args,
      layerProjections
    );
    const permitResolution = await resolveMcpPermit(options, extra);
    if (permitResolution.isErr()) {
      return mcpError(permitResolution.error);
    }
    const permit = permitResolution.value;
    const result = await executeTrail(t, trailInput, {
      abortSignal: extra.abortSignal,
      configValues: options.configValues,
      createContext: options.createContext,
      ctx: withMcpSurface(progressCb, layers),
      ...(Object.keys(layerInputs).length === 0 ? {} : { layerInputs }),
      ...(permit === undefined ? {} : { permit }),
      resources: options.resources,
      surfaceLayers: layers,
      topo: graph,
      topoLayers: graph.layers,
    });
    if (result.isOk()) {
      return {
        content: await serializeOutput(result.value),
        structuredContent:
          t.output === undefined
            ? undefined
            : toStructuredContent(result.value, wrapAsData),
      };
    }
    return mcpError(result.error);
  };

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build MCP tool definitions from a graph's topology.
 *
 * Each trail in the topo becomes an McpToolDefinition with:
 * - A derived tool name (topo-name-prefixed, underscore-delimited)
 * - JSON Schema input from zodToJsonSchema
 * - MCP annotations from trail meta
 * - A handler that validates, composes layers, executes, and maps results
 */

const buildDescription = (
  trail: Trail<unknown, unknown, unknown>
): string | undefined => trail.description;

// MCP requires `outputSchema` to have literal `type: "object"` at the root
// (see `@modelcontextprotocol/sdk` Tool schema — `outputSchema: z.object({
// type: z.literal('object'), ... })`). Object-shaped unions like
// `z.discriminatedUnion(...)` emit as `{ anyOf: [...] }` from
// `zodToJsonSchema` with no top-level `type`, so we publish them under the
// data envelope. The shape of `structuredContent` then flows from the
// `wrapAsData` flag, keeping the runtime aligned with what the schema
// declares.
const isMcpStructuredObjectSchema = (
  schema: Record<string, unknown>
): boolean => schema['type'] === 'object';

interface OutputSchemaProjection {
  readonly schema: Record<string, unknown>;
  readonly wrapAsData: boolean;
}

const projectMcpOutputSchema = (
  schema: Parameters<typeof zodToJsonSchema>[0]
): OutputSchemaProjection => {
  const raw = zodToJsonSchema(schema);
  if (isMcpStructuredObjectSchema(raw)) {
    return { schema: raw, wrapAsData: false };
  }
  return {
    schema: {
      properties: { data: raw },
      required: ['data'],
      type: 'object',
    },
    wrapAsData: true,
  };
};

const buildOutputSchemaProjection = (
  trail: Trail<unknown, unknown, unknown>
): OutputSchemaProjection | undefined =>
  trail.output === undefined ? undefined : projectMcpOutputSchema(trail.output);

const buildMeta = (
  trail: Trail<unknown, unknown, unknown>
): Record<string, unknown> | undefined => {
  const examples = deriveStructuredTrailExamples(trail.examples);
  if (examples === undefined) {
    return undefined;
  }
  return { [MCP_TOOL_EXAMPLES_META_KEY]: examples };
};

/** Build a single MCP tool definition from a trail. */
const buildToolDefinition = (
  graph: Topo,
  trail: Trail<unknown, unknown, unknown>,
  layers: readonly Layer[],
  options: DeriveMcpToolsOptions
): McpToolDefinition => {
  const rawAnnotations = deriveAnnotations(trail);
  const annotations =
    Object.keys(rawAnnotations).length > 0 ? rawAnnotations : undefined;
  const projection = buildOutputSchemaProjection(trail);
  const attachedLayers = collectAttachedTypedLayers(
    graph,
    trail,
    options.layers
  );
  const inputProjection = projectMcpInputSchema(trail, attachedLayers);
  return {
    _meta: buildMeta(trail),
    annotations,
    description: buildDescription(trail),
    handler: createHandler(
      graph,
      trail,
      layers,
      options,
      projection?.wrapAsData ?? false,
      inputProjection.projections
    ),
    inputSchema: inputProjection.schema,
    name: deriveToolName(graph.name, trail.id),
    outputSchema: projection?.schema,
    trailId: trail.id,
  };
};

/** Register a trail as an MCP tool, checking for name collisions. */
const registerTool = (
  graph: Topo,
  trailItem: Trail<unknown, unknown, unknown>,
  layers: readonly Layer[],
  options: DeriveMcpToolsOptions,
  nameToTrailId: Map<string, string>,
  tools: McpToolDefinition[]
): Result<void, Error> => {
  const toolName = deriveToolName(graph.name, trailItem.id);
  const existingId = nameToTrailId.get(toolName);
  if (existingId !== undefined) {
    return Result.err(
      new ValidationError(
        `MCP tool-name collision: trails "${existingId}" and "${trailItem.id}" both derive the tool name "${toolName}"`
      )
    );
  }
  nameToTrailId.set(toolName, trailItem.id);
  tools.push(buildToolDefinition(graph, trailItem, layers, options));
  return Result.ok();
};

/** Filter topo items to eligible trails. */
const eligibleTrails = (
  graph: Topo,
  options: DeriveMcpToolsOptions
): Trail<unknown, unknown, unknown>[] =>
  filterSurfaceTrails(graph.list(), {
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
  });

const validateToolBuild = (
  graph: Topo,
  options: DeriveMcpToolsOptions
): Result<void, Error> => validateSurfaceTopo(graph, options);

const registerTools = (
  graph: Topo,
  options: DeriveMcpToolsOptions,
  layers: readonly Layer[]
): Result<McpToolDefinition[], Error> => {
  const tools: McpToolDefinition[] = [];
  const nameToTrailId = new Map<string, string>();

  for (const trailItem of eligibleTrails(graph, options)) {
    const registered = registerTool(
      graph,
      trailItem,
      layers,
      options,
      nameToTrailId,
      tools
    );
    if (registered.isErr()) {
      return registered;
    }
  }

  return Result.ok(tools);
};

/**
 * Build MCP tool definitions from a topo without opening a transport.
 *
 * @example
 * ```ts
 * import { deriveMcpTools } from '@ontrails/mcp';
 *
 * const tools = deriveMcpTools(graph, { include: ['entity.**'] });
 * if (tools.isErr()) throw tools.error;
 *
 * for (const tool of tools.value) {
 *   console.log(tool.name);
 * }
 * ```
 */
export const deriveMcpTools = (
  graph: Topo,
  options: DeriveMcpToolsOptions = {}
): Result<McpToolDefinition[], Error> => {
  const validation = validateToolBuild(graph, options);
  if (validation.isErr()) {
    return validation;
  }

  return registerTools(graph, options, options.layers ?? []);
};
