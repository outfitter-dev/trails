import { zodToJsonSchema } from '@ontrails/core';

import type { McpToolDefinition, McpToolResult } from './build.js';

/** Canonical output facts and the compatibility rendering, derived together. */
export interface McpOutputRendering {
  readonly schema: Record<string, unknown>;
  readonly legacySchema: Record<string, unknown>;
  readonly legacyWrapAsData: boolean;
}

/** Internal runtime values may be any structured JSON value on the modern era. */
export interface McpRuntimeResult extends Omit<
  McpToolResult,
  'structuredContent'
> {
  readonly structuredContent?: unknown;
}

export interface McpRuntimeTool extends Omit<McpToolDefinition, 'handler'> {
  readonly handler: (
    args: Record<string, unknown>,
    extra: Parameters<McpToolDefinition['handler']>[1]
  ) => Promise<McpRuntimeResult>;
}

/** Package-private views share one authored execution and schema derivation. */
export interface McpToolRecord {
  readonly legacy: McpToolDefinition;
  readonly modern: McpRuntimeTool;
}

export const deriveMcpOutputRendering = (
  output: Parameters<typeof zodToJsonSchema>[0]
): McpOutputRendering => {
  const schema = zodToJsonSchema(output);
  const legacyWrapAsData = schema['type'] !== 'object';
  return {
    legacySchema: legacyWrapAsData
      ? { properties: { data: schema }, required: ['data'], type: 'object' }
      : schema,
    legacyWrapAsData,
    schema,
  };
};

export const renderLegacyMcpResult = (
  result: McpRuntimeResult,
  rendering?: McpOutputRendering
): McpToolResult => {
  if (result.isError === true) {
    const { structuredContent: _omitted, ...error } = result;
    return error;
  }
  const value = result.structuredContent;
  let structuredContent: Record<string, unknown> | undefined;
  if (rendering?.legacyWrapAsData === true) {
    structuredContent = { data: value };
  } else if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    structuredContent = value as Record<string, unknown>;
  }
  return { ...result, structuredContent };
};
