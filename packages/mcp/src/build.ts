/**
 * Build MCP tool definitions from a Trails graph.
 *
 * Iterates the topo, generates McpToolDefinition[] with handlers that
 * validate input, compose layers, execute the implementation, and map
 * Results to MCP responses.
 */

import type {
  EmbeddedResource,
  ImageContent,
  TextContent,
} from '@modelcontextprotocol/server';
import {
  AuthError,
  InternalError,
  Result,
  ValidationError,
  collectAttachedTypedLayers,
  deriveMcpTrailheadDescription,
  deriveSurfaceTrailVersionRenderings,
  deriveStructuredTrailExamples,
  executeTrail,
  expandMcpSurfaceBindings,
  filterSurfaceTrails,
  isBlobRef,
  isTrailsError,
  LAYER_FIELD_RESERVED_NAMES,
  matchesTrailPattern,
  renderLayerFieldName,
  renderPublicSurfaceError,
  resolveSurfaceOverlayBindings,
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
  McpSurfaceBindingExpansion,
  OverlayEnvelopeLike,
  ResourceOverrideMap,
  SurfaceErrorRendering,
  SurfaceTrailVersionRendering,
  Topo,
  Trail,
  TrailContextInit,
  TrailVersionReference,
} from '@ontrails/core';

import type { McpAnnotations } from './annotations.js';
import { deriveAnnotations } from './annotations.js';
import { createMcpProgressCallback } from './progress.js';
import { deriveToolName } from './tool-name.js';
import {
  deriveMcpOutputRendering,
  renderLegacyMcpResult,
} from './output-rendering.js';
import type {
  McpOutputRendering,
  McpRuntimeResult,
  McpToolRecord,
} from './output-rendering.js';

/**
 * Metadata key used for structured trail examples on derived MCP tools.
 *
 * @example
 * ```ts
 * import { MCP_TOOL_EXAMPLES_META_KEY } from '@ontrails/mcp';
 *
 * const examples = tool._meta?.[MCP_TOOL_EXAMPLES_META_KEY];
 * ```
 */
export const MCP_TOOL_EXAMPLES_META_KEY = 'ontrails/examples';

/**
 * Metadata key used for public Trails error renderings on MCP tool errors.
 *
 * @example
 * ```ts
 * import { MCP_TOOL_ERROR_META_KEY } from '@ontrails/mcp';
 *
 * const error = result._meta?.[MCP_TOOL_ERROR_META_KEY];
 * ```
 */
export const MCP_TOOL_ERROR_META_KEY = 'ontrails/error';

/**
 * Metadata key used to identify MCP tools derived from surface trailheads.
 *
 * Surface trailheads preserve member trail identity rather than merging member
 * contracts. The metadata names the trailhead and its member trail IDs so clients
 * can inspect the grouped entry before choosing a selected trail.
 *
 * @example
 * ```ts
 * import { MCP_TOOL_TRAILHEAD_META_KEY } from '@ontrails/mcp';
 *
 * const trailhead = tool._meta?.[MCP_TOOL_TRAILHEAD_META_KEY];
 * ```
 */
export const MCP_TOOL_TRAILHEAD_META_KEY = 'ontrails/trailhead';

/**
 * Metadata key used as a compatibility hint for clients that support
 * deferred MCP tool loading.
 *
 * @example
 * ```ts
 * import { MCP_TOOL_DEFERRED_META_KEY } from '@ontrails/mcp';
 *
 * const isDeferred = tool._meta?.[MCP_TOOL_DEFERRED_META_KEY] === true;
 * ```
 */
export const MCP_TOOL_DEFERRED_META_KEY = 'ontrails/deferred';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DeriveMcpToolsOptions extends BaseSurfaceOptions {
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  /**
   * App-authored overlay envelopes (the same collection compile embeds in
   * `trails.lock`). The `surfaces` overlay's `mcp` bindings are the authored,
   * lockable default: list bindings become grouped trailhead tools and scalar
   * bindings become tool synonyms.
   */
  readonly overlays?: readonly OverlayEnvelopeLike[] | undefined;
  /**
   * Call-site trailhead map. Override-in-context by design: when both this
   * map and overlay `mcp` list bindings are present, the call-site map wins
   * at runtime.
   */
  readonly trailheads?: McpSurfaceTrailheadMap | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  readonly resolvePermit?: ResolveMcpPermit | undefined;
}

export type McpSurfaceTrailheadTrailSelector = string | readonly string[];

/** Surface-side grouped entry over existing trails. */
export interface McpSurfaceTrailheadDefinition {
  readonly trails: McpSurfaceTrailheadTrailSelector;
  readonly description: string;
  readonly visibility?: 'public' | 'internal' | undefined;
  readonly descriptionStableThrough?: string | undefined;
  readonly visibilityWideningAccepted?: true | undefined;
  readonly mcp?:
    | {
        readonly loading?: 'deferred' | undefined;
      }
    | undefined;
}

export type McpSurfaceTrailheadMap = Readonly<
  Record<string, McpSurfaceTrailheadDefinition>
>;

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
  readonly trailheadId?: string | undefined;
  readonly handler: (
    args: Record<string, unknown>,
    extra: McpExtra
  ) => Promise<McpToolResult>;
  readonly inputSchema: Record<string, unknown>;
  readonly memberTrailIds?: readonly string[] | undefined;
  readonly name: string;
  readonly outputSchema?: Record<string, unknown> | undefined;
  /** The trail ID this tool was derived from. */
  readonly trailId?: string | undefined;
  readonly versions?: readonly SurfaceTrailVersionRendering[] | undefined;
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

export type McpToolErrorMeta = Omit<SurfaceErrorRendering, 'surface'> & {
  readonly surface: 'mcp';
};

/** MCP content emitted from trail results, validated by the SDK wire boundary. */
export type McpContent = TextContent | ImageContent | EmbeddedResource;

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
  const bytes = await resolveData(blob);
  const data = uint8ArrayToBase64(bytes);
  if (!blob.mimeType.startsWith('image/')) {
    return {
      resource: {
        blob: data,
        mimeType: blob.mimeType,
        uri: `blob://${blob.name}`,
      },
      type: 'resource',
    };
  }

  return { data, mimeType: blob.mimeType, type: 'image' };
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

// ---------------------------------------------------------------------------
// Layer input rendering (TRL-474)
// ---------------------------------------------------------------------------

/**
 * Per-layer rendering onto an MCP tool's input schema.
 *
 * `routing` maps the parameter name a consumer sees on the tool to the
 * authored field name on the layer's input schema. When no rename was
 * required the two are the same; on collision the parameter name carries
 * the layer prefix while the routing target preserves the original field.
 */
interface McpLayerInputRendering {
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
 * The CLI rendering uses `kebab-case` (`<layerName>-<field>`); MCP exposes
 * fields as JSON properties so the corresponding shape is camelCase
 * (`<layerName><FieldCapitalized>`). The shared collision policy lives in
 * `renderLayerFieldName`; this helper just supplies the surface-specific
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
 * Render a single layer's input schema into MCP-shaped property and
 * required fragments, applying the deterministic collision rename rule.
 */
const renderMcpLayerInput = (
  layer: Layer,
  claimedNames: Set<string>
): McpLayerInputRendering => {
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
    const rendering = renderLayerFieldName(
      layer.name,
      fieldName,
      fieldName,
      renamed,
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

interface McpInputRendering {
  readonly schema: Record<string, unknown>;
  readonly renderings: readonly McpLayerInputRendering[];
}

/**
 * Merge typed layer input schemas into the trail's input schema.
 *
 * Returns the merged input schema published on the MCP tool plus the
 * per-layer routing tables consumed by the handler when partitioning
 * incoming parameters.
 */
const renderMcpInputSchema = (
  trail: Trail<unknown, unknown, unknown>,
  attachedLayers: readonly AttachedTypedLayer[]
): McpInputRendering => {
  const baseSchema = zodToJsonSchema(trail.input);
  if (attachedLayers.length === 0) {
    return { renderings: [], schema: baseSchema };
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
  const renderings: McpLayerInputRendering[] = [];

  for (const { layer } of attachedLayers) {
    const rendering = renderMcpLayerInput(layer, claimedNames);
    if (rendering.routing.size === 0) {
      continue;
    }
    Object.assign(mergedProperties, rendering.properties);
    mergedRequired.push(...rendering.required);
    renderings.push(rendering);
  }

  if (renderings.length === 0) {
    return { renderings: [], schema: baseSchema };
  }

  const mergedSchema: Record<string, unknown> = isJsonObjectSchema(baseSchema)
    ? { ...baseSchema, properties: mergedProperties, type: 'object' }
    : { properties: mergedProperties, type: 'object' };
  if (mergedRequired.length > 0) {
    mergedSchema['required'] = mergedRequired;
  } else if ('required' in mergedSchema) {
    delete mergedSchema['required'];
  }

  return { renderings, schema: mergedSchema };
};

const TRAIL_VERSION_PARAM = 'trailVersion';

const addMcpVersionInputSchema = (
  trail: Trail<unknown, unknown, unknown>,
  schema: Record<string, unknown>
): Record<string, unknown> => {
  if (trail.version === undefined) {
    return schema;
  }
  const properties =
    isJsonObjectSchema(schema) && schema.properties !== undefined
      ? schema.properties
      : undefined;
  return {
    ...schema,
    properties: {
      ...properties,
      [TRAIL_VERSION_PARAM]: {
        description: 'Live trail version number or marker prefix',
        type: 'string',
      },
    },
    type: 'object',
  };
};

const splitMcpSurfaceVersion = (
  args: Record<string, unknown>
): {
  readonly args: Record<string, unknown>;
  readonly version: TrailVersionReference | undefined;
} => {
  const { [TRAIL_VERSION_PARAM]: rawVersion, ...rest } = args;
  return {
    args: rest,
    version:
      typeof rawVersion === 'string' || typeof rawVersion === 'number'
        ? rawVersion
        : undefined,
  };
};

/**
 * Partition a parsed MCP `args` record into the trail input plus per-layer
 * inputs, using each layer's routing table.
 *
 * Layer-rendered parameter names are stripped from the trail input so the
 * trail's schema validation only ever sees its own fields. A layer that
 * received no parameters is omitted from `layerInputs` so consumers can
 * cleanly assert which layers were activated by the request.
 */
const partitionMcpArgs = (
  args: Record<string, unknown>,
  renderings: readonly McpLayerInputRendering[]
): {
  readonly trailInput: Record<string, unknown>;
  readonly layerInputs: Record<string, unknown>;
} => {
  if (renderings.length === 0) {
    return { layerInputs: {}, trailInput: { ...args } };
  }
  const claimedKeys = new Set<string>();
  const layerInputs: Record<string, unknown> = {};
  for (const rendering of renderings) {
    const layerInput: Record<string, unknown> = {};
    let received = false;
    for (const [paramName, fieldName] of rendering.routing) {
      claimedKeys.add(paramName);
      const value = args[paramName];
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
  rendering: SurfaceErrorRendering
): Record<string, McpToolErrorMeta> | undefined => {
  if (!isTrailsError(error)) {
    return undefined;
  }
  return {
    [MCP_TOOL_ERROR_META_KEY]: {
      ...rendering,
      surface: 'mcp',
    },
  };
};

/** Create an error result for MCP responses. */
const mcpError = (error: Error): McpToolResult => {
  const rendering = renderPublicSurfaceError('mcp', error);
  const meta = buildMcpErrorMeta(error, rendering);
  return {
    ...(meta === undefined ? {} : { _meta: meta }),
    content: [{ text: rendering.message, type: 'text' }],
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
    layerRenderings: readonly McpLayerInputRendering[]
  ): ((
    args: Record<string, unknown>,
    extra: McpExtra
  ) => Promise<McpRuntimeResult>) =>
  async (args, extra): Promise<McpRuntimeResult> => {
    const progressCb = createMcpProgressCallback(extra);
    const versionedArgs =
      t.version === undefined
        ? { args, version: undefined }
        : splitMcpSurfaceVersion(args);
    const { trailInput, layerInputs } = partitionMcpArgs(
      versionedArgs.args,
      layerRenderings
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
      ...(versionedArgs.version === undefined
        ? {}
        : { version: versionedArgs.version }),
    });
    if (result.isOk()) {
      let structuredContent: unknown;
      if (t.output !== undefined) {
        structuredContent = containsBlobRef(result.value)
          ? toStructuredValue(result.value)
          : result.value;
      }
      return {
        content: await serializeOutput(result.value),
        structuredContent,
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

const buildMcpOutputSchemaRendering = (
  trail: Trail<unknown, unknown, unknown>
): McpOutputRendering | undefined =>
  trail.output === undefined
    ? undefined
    : deriveMcpOutputRendering(trail.output);

const buildMeta = (
  trail: Trail<unknown, unknown, unknown>
): Record<string, unknown> | undefined => {
  const examples = deriveStructuredTrailExamples(trail.examples);
  if (examples === undefined) {
    return undefined;
  }
  return { [MCP_TOOL_EXAMPLES_META_KEY]: examples };
};

const mergeMeta = (
  ...entries: readonly (Record<string, unknown> | undefined)[]
): Record<string, unknown> | undefined => {
  const merged = Object.assign(
    {},
    ...(entries.filter(Boolean) as Record<string, unknown>[])
  );
  return Object.keys(merged).length > 0 ? merged : undefined;
};

/** Derive one authored trail's shared execution and protocol renderings. */
const buildToolRecord = (
  graph: Topo,
  trail: Trail<unknown, unknown, unknown>,
  layers: readonly Layer[],
  options: DeriveMcpToolsOptions
): McpToolRecord => {
  const rawAnnotations = deriveAnnotations(trail);
  const annotations =
    Object.keys(rawAnnotations).length > 0 ? rawAnnotations : undefined;
  const rendering = buildMcpOutputSchemaRendering(trail);
  const attachedLayers = collectAttachedTypedLayers(
    graph,
    trail,
    options.layers
  );
  const inputRendering = renderMcpInputSchema(trail, attachedLayers);
  const inputSchema = addMcpVersionInputSchema(trail, inputRendering.schema);
  const versions = deriveSurfaceTrailVersionRenderings(trail);
  const common = {
    _meta: buildMeta(trail),
    annotations,
    description: buildDescription(trail),
    inputSchema,
    name: deriveToolName(graph.name, trail.id),
    trailId: trail.id,
    ...(versions === undefined ? {} : { versions }),
  };
  const execute = createHandler(
    graph,
    trail,
    layers,
    options,
    inputRendering.renderings
  );
  return {
    legacy: {
      ...common,
      handler: async (args, extra) =>
        renderLegacyMcpResult(await execute(args, extra), rendering),
      outputSchema: rendering?.legacySchema,
    },
    modern: { ...common, handler: execute, outputSchema: rendering?.schema },
  };
};

type ToolRecordFor = (trail: Trail<unknown, unknown, unknown>) => McpToolRecord;

const trailheadSelectors = (
  selector: McpSurfaceTrailheadTrailSelector
): readonly string[] => (typeof selector === 'string' ? [selector] : selector);

const matchesTrailheadSelector = (
  trailId: string,
  selector: McpSurfaceTrailheadTrailSelector
): boolean =>
  trailheadSelectors(selector).some((pattern) =>
    matchesTrailPattern(trailId, pattern)
  );

interface TrailheadMemberTool {
  readonly record: McpToolRecord;
  readonly trail: Trail<unknown, unknown, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const buildTrailheadInputSchema = (
  members: readonly TrailheadMemberTool[]
): Record<string, unknown> => ({
  anyOf: members.map(({ record, trail }) => ({
    properties: {
      input: record.legacy.inputSchema,
      trail: { const: trail.id },
    },
    required: ['trail', 'input'],
    type: 'object',
  })),
  properties: {
    input: { type: 'object' },
    trail: {
      enum: members.map(({ trail }) => trail.id),
      type: 'string',
    },
  },
  required: ['trail', 'input'],
  type: 'object',
});

const buildTrailheadOutputSchema = (
  members: readonly TrailheadMemberTool[],
  view: keyof McpToolRecord
): Record<string, unknown> => {
  const outputSchemas = members.map(
    ({ record }) => record[view].outputSchema ?? {}
  );
  return {
    properties: {
      output:
        outputSchemas.length === 1
          ? (outputSchemas[0] ?? {})
          : { anyOf: outputSchemas },
      trail: {
        enum: members.map(({ trail }) => trail.id),
        type: 'string',
      },
    },
    required: ['trail', 'output'],
    type: 'object',
  };
};

const parseJsonTextContent = (
  content: readonly McpContent[]
): unknown | undefined => {
  const text = content.find((item) => item.type === 'text')?.text;
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const wrapTrailheadResult = (
  trailId: string,
  result: McpRuntimeResult
): McpToolResult => {
  if (result.isError === true) {
    return renderLegacyMcpResult(result);
  }
  const output =
    result.structuredContent === undefined
      ? (parseJsonTextContent(result.content) ?? null)
      : result.structuredContent;
  const envelope = { output, trail: trailId };
  return {
    ...(result._meta === undefined ? {} : { _meta: result._meta }),
    content: [
      { text: JSON.stringify(envelope), type: 'text' },
      ...result.content.filter((item) => item.type !== 'text'),
    ],
    structuredContent: envelope,
  };
};

const createTrailheadHandler = (
  trailheadId: string,
  members: readonly TrailheadMemberTool[],
  view: keyof McpToolRecord
): McpToolDefinition['handler'] => {
  const byTrailId = new Map(
    members.map((member) => [member.trail.id, member.record[view]])
  );

  return async (args, extra): Promise<McpToolResult> => {
    const trailId = typeof args['trail'] === 'string' ? args['trail'] : '';
    const tool = byTrailId.get(trailId);
    if (tool === undefined) {
      return mcpError(
        new ValidationError(
          `MCP trailhead "${trailheadId}" received unknown trail selector "${trailId || '(missing)'}"`
        )
      );
    }

    const { input } = args;
    if (!isRecord(input)) {
      return mcpError(
        new ValidationError(
          `MCP trailhead "${trailheadId}" expects an object input for trail "${trailId}"`
        )
      );
    }

    return wrapTrailheadResult(trailId, await tool.handler(input, extra));
  };
};

const deriveTrailheadIntent = (
  members: readonly TrailheadMemberTool[]
): Pick<Trail<unknown, unknown, unknown>, 'intent'>['intent'] => {
  if (members.every(({ trail }) => trail.intent === 'read')) {
    return 'read';
  }
  if (members.some(({ trail }) => trail.intent === 'destroy')) {
    return 'destroy';
  }
  return 'write';
};

const deriveTrailheadAnnotations = (
  definition: McpSurfaceTrailheadDefinition,
  members: readonly TrailheadMemberTool[]
): McpAnnotations | undefined => {
  const annotations = deriveAnnotations({
    description: definition.description,
    idempotent: false,
    intent: deriveTrailheadIntent(members),
  } as Pick<
    Trail<unknown, unknown, unknown>,
    'description' | 'idempotent' | 'intent'
  >);
  return Object.keys(annotations).length > 0 ? annotations : undefined;
};

const buildTrailheadMeta = (
  trailheadId: string,
  definition: McpSurfaceTrailheadDefinition,
  memberTrailIds: readonly string[]
): Record<string, unknown> | undefined =>
  mergeMeta(
    {
      [MCP_TOOL_TRAILHEAD_META_KEY]: {
        id: trailheadId,
        memberTrailIds,
      },
    },
    definition.mcp?.loading === 'deferred'
      ? { [MCP_TOOL_DEFERRED_META_KEY]: true }
      : undefined
  );

const buildTrailheadToolRecord = (
  graph: Topo,
  trailheadId: string,
  definition: McpSurfaceTrailheadDefinition,
  members: readonly TrailheadMemberTool[]
): McpToolRecord => {
  const memberTrailIds = members.map(({ trail }) => trail.id);
  const common = {
    _meta: buildTrailheadMeta(trailheadId, definition, memberTrailIds),
    annotations: deriveTrailheadAnnotations(definition, members),
    description: definition.description,
    inputSchema: buildTrailheadInputSchema(members),
    memberTrailIds,
    name: deriveToolName(graph.name, trailheadId),
    trailheadId,
  };
  return {
    legacy: {
      ...common,
      handler: createTrailheadHandler(trailheadId, members, 'legacy'),
      outputSchema: buildTrailheadOutputSchema(members, 'legacy'),
    },
    modern: {
      ...common,
      handler: createTrailheadHandler(trailheadId, members, 'modern'),
      outputSchema: buildTrailheadOutputSchema(members, 'modern'),
    },
  };
};

/** Register a trail as an MCP tool, checking for name collisions. */
const registerTool = (
  graph: Topo,
  trailItem: Trail<unknown, unknown, unknown>,
  recordFor: ToolRecordFor,
  nameToSourceId: Map<string, string>,
  tools: McpToolRecord[]
): Result<void, Error> => {
  const toolName = deriveToolName(graph.name, trailItem.id);
  const existingId = nameToSourceId.get(toolName);
  if (existingId !== undefined) {
    return Result.err(
      new ValidationError(
        `MCP tool-name collision: "${existingId}" and "trail:${trailItem.id}" both derive the tool name "${toolName}"`
      )
    );
  }
  nameToSourceId.set(toolName, `trail:${trailItem.id}`);
  tools.push(recordFor(trailItem));
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

const collectTrailheadMembers = (
  definition: McpSurfaceTrailheadDefinition,
  availableTrails: readonly Trail<unknown, unknown, unknown>[],
  recordFor: ToolRecordFor
): readonly TrailheadMemberTool[] =>
  availableTrails
    .filter((trailItem) =>
      matchesTrailheadSelector(trailItem.id, definition.trails)
    )
    .map((trailItem) => ({
      record: recordFor(trailItem),
      trail: trailItem,
    }));

const registerTrailhead = (
  graph: Topo,
  trailheadId: string,
  definition: McpSurfaceTrailheadDefinition,
  members: readonly TrailheadMemberTool[],
  nameToSourceId: Map<string, string>,
  tools: McpToolRecord[]
): Result<void, Error> => {
  if (members.length === 0) {
    return Result.err(
      new ValidationError(
        `MCP trailhead "${trailheadId}" did not match any surface-eligible trails`
      )
    );
  }

  const toolName = deriveToolName(graph.name, trailheadId);
  const existingId = nameToSourceId.get(toolName);
  if (existingId !== undefined) {
    return Result.err(
      new ValidationError(
        `MCP tool-name collision: "${existingId}" and "trailhead:${trailheadId}" both derive the tool name "${toolName}"`
      )
    );
  }

  nameToSourceId.set(toolName, `trailhead:${trailheadId}`);
  tools.push(buildTrailheadToolRecord(graph, trailheadId, definition, members));
  return Result.ok();
};

/**
 * Resolve the `surfaces` overlay's `mcp` bindings against the
 * surface-eligible trails.
 *
 * Framework overlay/binding validation failures are represented as
 * `Result.err` so `deriveMcpTools` keeps its no-throw contract.
 */
const resolveOverlayBindingExpansion = (
  options: DeriveMcpToolsOptions,
  availableTrails: readonly Trail<unknown, unknown, unknown>[]
): Result<McpSurfaceBindingExpansion | undefined, Error> => {
  try {
    const bindings = resolveSurfaceOverlayBindings(options.overlays);
    return Result.ok(
      expandMcpSurfaceBindings(
        bindings?.mcp,
        availableTrails.map((trailItem) => trailItem.id)
      )
    );
  } catch (error) {
    return Result.err(
      error instanceof Error
        ? error
        : new InternalError(
            `MCP surface overlay resolution failed: ${String(error)}`
          )
    );
  }
};

/**
 * Construct call-site-equivalent trailhead definitions from the overlay's
 * `mcp` list bindings.
 *
 * Each grouped binding becomes one definition with the expanded member trail
 * ids as exact selectors and the shared derived default description, so the
 * existing trailhead machinery builds the tool exactly as a call-site map
 * would.
 */
const trailheadDefinitionsFromOverlay = (
  expansion: McpSurfaceBindingExpansion | undefined
): McpSurfaceTrailheadMap | undefined => {
  if (expansion === undefined) {
    return undefined;
  }
  const groups = Object.entries(expansion.groups);
  if (groups.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    groups.map(([name, memberIds]) => [
      name,
      {
        description: deriveMcpTrailheadDescription(memberIds),
        trails: memberIds,
      },
    ])
  );
};

const registerTrailheads = (
  graph: Topo,
  trailheads: McpSurfaceTrailheadMap | undefined,
  recordFor: ToolRecordFor,
  availableTrails: readonly Trail<unknown, unknown, unknown>[],
  nameToSourceId: Map<string, string>,
  tools: McpToolRecord[]
): Result<ReadonlySet<string>, Error> => {
  const consumedTrailIds = new Set<string>();
  const ownerByTrailId = new Map<string, string>();

  if (trailheads === undefined || Object.keys(trailheads).length === 0) {
    return Result.ok(consumedTrailIds);
  }

  for (const [trailheadId, definition] of Object.entries(
    trailheads
  ).toSorted()) {
    const members = collectTrailheadMembers(
      definition,
      availableTrails,
      recordFor
    );
    for (const { trail: memberTrail } of members) {
      const previous = ownerByTrailId.get(memberTrail.id);
      if (previous !== undefined) {
        return Result.err(
          new ValidationError(
            `MCP trailhead overlap: trail "${memberTrail.id}" is selected by trailheads "${previous}" and "${trailheadId}"`
          )
        );
      }
      ownerByTrailId.set(memberTrail.id, trailheadId);
      consumedTrailIds.add(memberTrail.id);
    }

    const registered = registerTrailhead(
      graph,
      trailheadId,
      definition,
      members,
      nameToSourceId,
      tools
    );
    if (registered.isErr()) {
      return registered;
    }
  }

  return Result.ok(consumedTrailIds);
};

/**
 * Register overlay tool synonyms: additional MCP tools whose names are the
 * scalar binding names, sharing the target trail's schema, annotations, and
 * handler.
 */
const registerSynonymTools = (
  recordFor: ToolRecordFor,
  availableTrails: readonly Trail<unknown, unknown, unknown>[],
  synonyms: Readonly<Record<string, string>>,
  nameToSourceId: Map<string, string>,
  tools: McpToolRecord[]
): Result<void, Error> => {
  const trailById = new Map(
    availableTrails.map((trailItem) => [trailItem.id, trailItem])
  );
  for (const [name, trailId] of Object.entries(synonyms)) {
    const trailItem = trailById.get(trailId);
    if (trailItem === undefined) {
      return Result.err(
        new ValidationError(
          `MCP overlay binding "${name}" targets trail "${trailId}", which is not surface-eligible`
        )
      );
    }
    const existingId = nameToSourceId.get(name);
    if (existingId !== undefined) {
      return Result.err(
        new ValidationError(
          `MCP tool-name collision: "${existingId}" and "binding:${name}" both use the tool name "${name}"`
        )
      );
    }
    nameToSourceId.set(name, `binding:${name}`);
    const record = recordFor(trailItem);
    tools.push({
      legacy: { ...record.legacy, name },
      modern: { ...record.modern, name },
    });
  }
  return Result.ok();
};

const registerTools = (
  graph: Topo,
  options: DeriveMcpToolsOptions,
  layers: readonly Layer[]
): Result<McpToolRecord[], Error> => {
  const tools: McpToolRecord[] = [];
  const nameToSourceId = new Map<string, string>();
  const recordsByTrail = new Map<string, McpToolRecord>();
  const recordFor: ToolRecordFor = (trail) => {
    const existing = recordsByTrail.get(trail.id);
    if (existing !== undefined) {
      return existing;
    }
    const record = buildToolRecord(graph, trail, layers, options);
    recordsByTrail.set(trail.id, record);
    return record;
  };
  const availableTrails = eligibleTrails(graph, options);
  const expansion = resolveOverlayBindingExpansion(options, availableTrails);
  if (expansion.isErr()) {
    return expansion;
  }
  // Override-in-context: the call-site trailhead map wins over the authored
  // overlay default whenever the caller supplies one.
  const trailheads =
    options.trailheads ?? trailheadDefinitionsFromOverlay(expansion.value);
  const registeredTrailheads = registerTrailheads(
    graph,
    trailheads,
    recordFor,
    availableTrails,
    nameToSourceId,
    tools
  );
  if (registeredTrailheads.isErr()) {
    return registeredTrailheads;
  }
  const consumedTrailIds = registeredTrailheads.value;

  for (const trailItem of availableTrails) {
    if (consumedTrailIds.has(trailItem.id)) {
      continue;
    }
    const registered = registerTool(
      graph,
      trailItem,
      recordFor,
      nameToSourceId,
      tools
    );
    if (registered.isErr()) {
      return registered;
    }
  }

  const registeredSynonyms = registerSynonymTools(
    recordFor,
    availableTrails,
    expansion.value?.synonyms ?? {},
    nameToSourceId,
    tools
  );
  if (registeredSynonyms.isErr()) {
    return registeredSynonyms;
  }

  return Result.ok(tools);
};

/** Derive package-private protocol views from one canonical tool build. @internal */
export const deriveMcpToolRecords = (
  graph: Topo,
  options: DeriveMcpToolsOptions = {}
): Result<McpToolRecord[], Error> => {
  const validation = validateToolBuild(graph, options);
  if (validation.isErr()) {
    return validation;
  }
  return registerTools(graph, options, options.layers ?? []);
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
  const records = deriveMcpToolRecords(graph, options);
  return records.isErr()
    ? records
    : Result.ok(records.value.map((record) => record.legacy));
};
