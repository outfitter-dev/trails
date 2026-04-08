/**
 * Build MCP tool definitions from a Trails App.
 *
 * Iterates the topo, generates McpToolDefinition[] with handlers that
 * validate input, compose layers, execute the implementation, and map
 * Results to MCP responses.
 */

import {
  Result,
  TRAILHEAD_KEY,
  ValidationError,
  executeTrail,
  isBlobRef,
  validateEstablishedTopo,
  zodToJsonSchema,
} from '@ontrails/core';
import type {
  BlobRef,
  Layer,
  ProvisionOverrideMap,
  Topo,
  Trail,
  TrailContextInit,
} from '@ontrails/core';

import type { McpAnnotations } from './annotations.js';
import { deriveAnnotations } from './annotations.js';
import { createMcpProgressCallback } from './progress.js';
import { deriveToolName } from './tool-name.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BuildMcpToolsOptions {
  /** Config values for resources that declare a `config` schema, keyed by resource ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
    | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly excludeTrails?: readonly string[] | undefined;
  readonly includeTrails?: readonly string[] | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly resources?: ProvisionOverrideMap | undefined;
  /** Set to `false` to skip topo validation while building tools. */
  readonly validate?: boolean | undefined;
}

export interface McpToolDefinition {
  readonly annotations: McpAnnotations | undefined;
  readonly description: string | undefined;
  readonly handler: (
    args: Record<string, unknown>,
    extra: McpExtra
  ) => Promise<McpToolResult>;
  readonly inputSchema: Record<string, unknown>;
  readonly name: string;
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
    t: Trail<unknown, unknown>,
    layers: readonly Layer[],
    options: BuildMcpToolsOptions
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
    });
    if (result.isOk()) {
      return { content: await serializeOutput(result.value) };
    }
    return mcpError(result.error.message);
  };

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build MCP tool definitions from an App's topology.
 *
 * Each trail in the topo becomes an McpToolDefinition with:
 * - A derived tool name (app-prefixed, underscore-delimited)
 * - JSON Schema input from zodToJsonSchema
 * - MCP annotations from trail meta
 * - A handler that validates, composes layers, executes, and maps results
 */
/** Check if a trail should be included based on meta and filters. */
const shouldInclude = (
  trail: Trail<unknown, unknown>,
  options: BuildMcpToolsOptions
): boolean => {
  if (trail.meta?.['internal'] === true) {
    return false;
  }
  if (options.includeTrails !== undefined && options.includeTrails.length > 0) {
    return options.includeTrails.includes(trail.id);
  }
  if (
    options.excludeTrails !== undefined &&
    options.excludeTrails.includes(trail.id)
  ) {
    return false;
  }
  return true;
};

/** Build a description with optional example input appended. */
const buildDescription = (
  trail: Trail<unknown, unknown>
): string | undefined => {
  let { description } = trail;
  if (
    description !== undefined &&
    trail.examples !== undefined &&
    trail.examples.length > 0
  ) {
    const [firstExample] = trail.examples;
    if (firstExample !== undefined) {
      description = `${description}\n\nExample input: ${JSON.stringify(firstExample.input)}`;
    }
  }
  return description;
};

/** Build a single MCP tool definition from a trail. */
const buildToolDefinition = (
  app: Topo,
  trail: Trail<unknown, unknown>,
  layers: readonly Layer[],
  options: BuildMcpToolsOptions
): McpToolDefinition => {
  const rawAnnotations = deriveAnnotations(trail);
  const annotations =
    Object.keys(rawAnnotations).length > 0 ? rawAnnotations : undefined;
  return {
    annotations,
    description: buildDescription(trail),
    handler: createHandler(trail, layers, options),
    inputSchema: zodToJsonSchema(trail.input),
    name: deriveToolName(app.name, trail.id),
    trailId: trail.id,
  };
};

/** Register a trail as an MCP tool, checking for name collisions. */
const registerTool = (
  app: Topo,
  trailItem: Trail<unknown, unknown>,
  layers: readonly Layer[],
  options: BuildMcpToolsOptions,
  nameToTrailId: Map<string, string>,
  tools: McpToolDefinition[]
): Result<void, Error> => {
  const toolName = deriveToolName(app.name, trailItem.id);
  const existingId = nameToTrailId.get(toolName);
  if (existingId !== undefined) {
    return Result.err(
      new ValidationError(
        `MCP tool-name collision: trails "${existingId}" and "${trailItem.id}" both derive the tool name "${toolName}"`
      )
    );
  }
  nameToTrailId.set(toolName, trailItem.id);
  tools.push(buildToolDefinition(app, trailItem, layers, options));
  return Result.ok();
};

/** Filter topo items to eligible trails. */
const eligibleTrails = (
  app: Topo,
  options: BuildMcpToolsOptions
): Trail<unknown, unknown>[] =>
  app.list().filter((trail) => shouldInclude(trail, options));

const validateToolBuild = (
  app: Topo,
  options: BuildMcpToolsOptions
): Result<void, Error> => {
  if (options.validate === false) {
    return Result.ok();
  }

  const validated = validateEstablishedTopo(app);
  return validated.isErr() ? Result.err(validated.error) : Result.ok();
};

const registerTools = (
  app: Topo,
  options: BuildMcpToolsOptions,
  layers: readonly Layer[]
): Result<McpToolDefinition[], Error> => {
  const tools: McpToolDefinition[] = [];
  const nameToTrailId = new Map<string, string>();

  for (const trailItem of eligibleTrails(app, options)) {
    const registered = registerTool(
      app,
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

export const buildMcpTools = (
  app: Topo,
  options: BuildMcpToolsOptions = {}
): Result<McpToolDefinition[], Error> => {
  const validation = validateToolBuild(app, options);
  if (validation.isErr()) {
    return validation;
  }

  return registerTools(app, options, options.layers ?? []);
};
