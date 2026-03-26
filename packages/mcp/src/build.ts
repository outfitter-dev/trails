/**
 * Build MCP tool definitions from a Trails App.
 *
 * Iterates the topo, generates McpToolDefinition[] with handlers that
 * validate input, compose layers, execute the implementation, and map
 * Results to MCP responses.
 */

import {
  composeLayers,
  createTrailContext,
  validateInput,
  zodToJsonSchema,
} from '@ontrails/core';
import type { Layer, Topo, Trail, TrailContext } from '@ontrails/core';

import type { McpAnnotations } from './annotations.js';
import { deriveAnnotations } from './annotations.js';
import { createMcpProgressCallback } from './progress.js';
import { deriveToolName } from './tool-name.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BuildMcpToolsOptions {
  readonly createContext?:
    | (() => TrailContext | Promise<TrailContext>)
    | undefined;
  readonly excludeTrails?: readonly string[] | undefined;
  readonly includeTrails?: readonly string[] | undefined;
  readonly layers?: readonly Layer[] | undefined;
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
}

export interface McpExtra {
  readonly progressToken?: string | number | undefined;
  readonly sendProgress?:
    | ((current: number, total: number) => Promise<void>)
    | undefined;
  readonly signal?: AbortSignal | undefined;
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

interface BlobRef {
  readonly data: Uint8Array;
  readonly kind: 'blob';
  readonly mimeType: string;
  readonly name?: string | undefined;
}

const isBlobRef = (value: unknown): value is BlobRef => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    obj['kind'] === 'blob' &&
    obj['data'] instanceof Uint8Array &&
    typeof obj['mimeType'] === 'string'
  );
};

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  // Use btoa with manual conversion for runtime-agnostic base64
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const blobToContent = (blob: BlobRef): McpContent => {
  if (blob.mimeType.startsWith('image/')) {
    return {
      data: uint8ArrayToBase64(blob.data),
      mimeType: blob.mimeType,
      type: 'image',
    };
  }

  return {
    mimeType: blob.mimeType,
    type: 'resource',
    uri: `blob://${blob.name ?? 'unnamed'}`,
  };
};

/** Separate blob fields from non-blob fields in an object. */
const separateBlobFields = (
  obj: Record<string, unknown>
): {
  blobContents: McpContent[];
  hasBlobFields: boolean;
  textFields: Record<string, unknown>;
} => {
  const blobContents: McpContent[] = [];
  const textFields: Record<string, unknown> = {};
  let hasBlobFields = false;
  for (const [key, val] of Object.entries(obj)) {
    if (isBlobRef(val)) {
      hasBlobFields = true;
      blobContents.push(blobToContent(val));
    } else {
      textFields[key] = val;
    }
  }
  return { blobContents, hasBlobFields, textFields };
};

/** Serialize a mixed blob/text object to MCP content. */
const serializeMixedObject = (
  obj: Record<string, unknown>
): readonly McpContent[] | undefined => {
  const { blobContents, hasBlobFields, textFields } = separateBlobFields(obj);
  if (!hasBlobFields) {
    return undefined;
  }
  if (Object.keys(textFields).length > 0) {
    blobContents.unshift({ text: JSON.stringify(textFields), type: 'text' });
  }
  return blobContents;
};

const serializeOutput = (value: unknown): readonly McpContent[] => {
  if (isBlobRef(value)) {
    return [blobToContent(value)];
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const mixed = serializeMixedObject(value as Record<string, unknown>);
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

/** Build a TrailContext from options and MCP extra. */
const buildTrailContext = async (
  options: BuildMcpToolsOptions,
  extra: McpExtra
): Promise<TrailContext> => {
  const baseContext =
    options.createContext !== undefined && options.createContext !== null
      ? await options.createContext()
      : createTrailContext();

  const signal = extra.signal ?? baseContext.signal;
  const progressCb = createMcpProgressCallback(extra);

  return {
    ...baseContext,
    signal,
    ...(progressCb === undefined ? {} : { progress: progressCb }),
  };
};

/** Execute a trail and map the result to an MCP response. */
const executeAndMap = async (
  trail: Trail<unknown, unknown>,
  validatedInput: unknown,
  ctx: TrailContext,
  layers: readonly Layer[]
): Promise<McpToolResult> => {
  const impl = composeLayers([...layers], trail, trail.implementation);
  try {
    const result = await impl(validatedInput, ctx);
    if (result.isOk()) {
      return { content: serializeOutput(result.value) };
    }
    return mcpError(result.error.message);
  } catch (error: unknown) {
    return mcpError(error instanceof Error ? error.message : String(error));
  }
};

const createHandler =
  (
    trail: Trail<unknown, unknown>,
    layers: readonly Layer[],
    options: BuildMcpToolsOptions
  ): ((
    args: Record<string, unknown>,
    extra: McpExtra
  ) => Promise<McpToolResult>) =>
  async (args, extra): Promise<McpToolResult> => {
    const validated = validateInput(trail.input, args);
    if (validated.isErr()) {
      return mcpError(validated.error.message);
    }
    const ctx = await buildTrailContext(options, extra);
    return executeAndMap(trail, validated.value, ctx, layers);
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
 * - MCP annotations from trail markers
 * - A handler that validates, composes layers, executes, and maps results
 */
/** Check if a trail should be included based on filters. */
const shouldInclude = (id: string, options: BuildMcpToolsOptions): boolean => {
  if (options.includeTrails !== undefined && options.includeTrails.length > 0) {
    return options.includeTrails.includes(id);
  }
  if (
    options.excludeTrails !== undefined &&
    options.excludeTrails.includes(id)
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
  };
};

export const buildMcpTools = (
  app: Topo,
  options: BuildMcpToolsOptions = {}
): McpToolDefinition[] => {
  const layers = options.layers ?? [];
  const tools: McpToolDefinition[] = [];

  for (const item of app.list()) {
    if (item.kind !== 'trail' && item.kind !== 'hike') {
      continue;
    }
    if (!shouldInclude(item.id, options)) {
      continue;
    }
    tools.push(
      buildToolDefinition(app, item as Trail<unknown, unknown>, layers, options)
    );
  }

  return tools;
};
