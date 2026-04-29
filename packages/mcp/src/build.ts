/**
 * Build MCP tool definitions from a Trails graph.
 *
 * Iterates the topo, generates McpToolDefinition[] with handlers that
 * validate input, compose layers, execute the implementation, and map
 * Results to MCP responses.
 */

import {
  Result,
  TRAILHEAD_KEY,
  ValidationError,
  deriveStructuredTrailExamples,
  executeTrail,
  filterSurfaceTrails,
  isBlobRef,
  validateEstablishedTopo,
  zodToJsonSchema,
} from '@ontrails/core';
import type {
  BlobRef,
  Intent,
  Layer,
  ResourceOverrideMap,
  Topo,
  Trail,
  TrailContextInit,
} from '@ontrails/core';

import type { McpAnnotations } from './annotations.js';
import { deriveAnnotations } from './annotations.js';
import { createMcpProgressCallback } from './progress.js';
import { deriveToolName } from './tool-name.js';

export const MCP_TOOL_EXAMPLES_META_KEY = 'ontrails/examples';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DeriveMcpToolsOptions {
  /** Config values for resources that declare a `config` schema, keyed by resource ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
    | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly include?: readonly string[] | undefined;
  readonly intent?: readonly Intent[] | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  /** Set to `false` to skip topo validation while building tools. */
  readonly validate?: boolean | undefined;
}

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
  readonly progressToken?: string | number | undefined;
  readonly sendProgress?:
    | ((current: number, total: number) => Promise<void>)
    | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

export interface McpToolResult {
  readonly content: readonly McpContent[];
  readonly isError?: boolean | undefined;
  readonly structuredContent?: Record<string, unknown> | undefined;
}

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
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    totalLength += value.length;
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

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  // Use btoa with manual conversion for runtime-agnostic base64
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const blobToContent = async (blob: BlobRef): Promise<McpContent> => {
  const bytes = await resolveBlobData(blob);
  if (blob.mimeType.startsWith('image/')) {
    return {
      data: uint8ArrayToBase64(bytes),
      mimeType: blob.mimeType,
      type: 'image',
    };
  }

  return {
    mimeType: blob.mimeType,
    type: 'resource',
    uri: `blob://${blob.name}`,
  };
};

/** Separate blob fields from non-blob fields in an object. */
const separateBlobFields = async (
  obj: Record<string, unknown>
): Promise<{
  blobContents: McpContent[];
  hasBlobFields: boolean;
  textFields: Record<string, unknown>;
}> => {
  const blobContents: McpContent[] = [];
  const textFields: Record<string, unknown> = {};
  let hasBlobFields = false;
  for (const [key, val] of Object.entries(obj)) {
    if (isBlobRef(val)) {
      hasBlobFields = true;
      blobContents.push(await blobToContent(val));
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

const serializeOutput = async (
  value: unknown
): Promise<readonly McpContent[]> => {
  if (isBlobRef(value)) {
    return [await blobToContent(value)];
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const mixed = await serializeMixedObject(value as Record<string, unknown>);
    if (mixed) {
      return mixed;
    }
  }
  return [{ text: JSON.stringify(value), type: 'text' }];
};

const containsBlobRef = (
  value: unknown,
  seen = new WeakSet<object>()
): boolean => {
  if (isBlobRef(value)) {
    return true;
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => containsBlobRef(item, seen));
  }

  return Object.values(value as Record<string, unknown>).some((item) =>
    containsBlobRef(item, seen)
  );
};

const blobToStructuredValue = (
  blob: BlobRef
): Record<string, string | number> => ({
  mimeType: blob.mimeType,
  name: blob.name,
  size: blob.size,
  uri: `blob://${blob.name}`,
});

const toStructuredValue = (
  value: unknown,
  seen = new WeakSet<object>()
): unknown => {
  if (isBlobRef(value)) {
    return blobToStructuredValue(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => toStructuredValue(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      toStructuredValue(item, seen),
    ])
  );
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
// Handler factory
// ---------------------------------------------------------------------------

/** Create an error result for MCP responses. */
const mcpError = (message: string): McpToolResult => ({
  content: [{ text: message, type: 'text' }],
  isError: true,
});

/** Add the MCP trailhead marker while preserving any existing context extras. */
const withMcpTrailhead = (
  progressCb: TrailContextInit['progress']
): Partial<TrailContextInit> => ({
  ...(progressCb === undefined ? {} : { progress: progressCb }),
  extensions: {
    [TRAILHEAD_KEY]: 'mcp' as const,
  },
});

const createHandler =
  (
    graph: Topo,
    t: Trail<unknown, unknown, unknown>,
    layers: readonly Layer[],
    options: DeriveMcpToolsOptions,
    wrapAsData: boolean
  ): ((
    args: Record<string, unknown>,
    extra: McpExtra
  ) => Promise<McpToolResult>) =>
  async (args, extra): Promise<McpToolResult> => {
    const progressCb = createMcpProgressCallback(extra);
    const result = await executeTrail(t, args, {
      abortSignal: extra.abortSignal,
      configValues: options.configValues,
      createContext: options.createContext,
      ctx: withMcpTrailhead(progressCb),
      layers,
      resources: options.resources,
      topo: graph,
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
    return mcpError(result.error.message);
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
  return {
    _meta: buildMeta(trail),
    annotations,
    description: buildDescription(trail),
    handler: createHandler(
      graph,
      trail,
      layers,
      options,
      projection?.wrapAsData ?? false
    ),
    inputSchema: zodToJsonSchema(trail.input),
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
): Result<void, Error> => {
  if (options.validate === false) {
    return Result.ok();
  }

  const validated = validateEstablishedTopo(graph);
  return validated.isErr() ? Result.err(validated.error) : Result.ok();
};

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
