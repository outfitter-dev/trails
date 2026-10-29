// Build
export {
  MCP_TOOL_ERROR_META_KEY,
  MCP_TOOL_EXAMPLES_META_KEY,
  MCP_TOOL_DEFERRED_META_KEY,
  MCP_TOOL_TRAILHEAD_META_KEY,
  deriveMcpTools,
  type DeriveMcpToolsOptions,
  type McpSurfaceTrailheadDefinition,
  type McpSurfaceTrailheadMap,
  type McpSurfaceTrailheadTrailSelector,
  type McpToolDefinition,
  type McpToolResult,
  type McpToolErrorMeta,
  type McpContent,
  type McpExtra,
  type ResolveMcpPermit,
  type ResolveMcpPermitInput,
} from './build.js';

// MCP resources
export {
  MCP_EXAMPLES_RESOURCE_PREFIX,
  MCP_SURFACE_MAP_RESOURCE_URI,
  MCP_TRAIL_RESOURCE_PREFIX,
  buildMcpResources,
  isMcpTrailheadTool,
  type BuiltMcpResources,
  type McpResourceContent,
  type McpResourceDefinition,
  type McpResourcesConfig,
} from './resources.js';

/**
 * Policy over verified callers and canonical MCP resource descriptors.
 *
 * @example
 * ```ts
 * const options: CreateServerOptions = {
 *   authorizeResourceRead: ({ permit }) => permit
 *     ? Result.ok()
 *     : Result.err(new PermissionError('Sign in to read resources')),
 * };
 * ```
 */
export type {
  AuthorizeMcpResourceRead,
  AuthorizeMcpResourceReadInput,
} from './resource-access.js';

// Tool naming
export { deriveToolName } from './tool-name.js';

// Annotations
export { deriveAnnotations, type McpAnnotations } from './annotations.js';

// Progress
export { createMcpProgressCallback } from './progress.js';

// Server
export { createServer, type CreateServerOptions } from './server.js';

// Surface
export { surface, type SurfaceMcpResult } from './surface.js';

// Transport
export { connectStdio } from './stdio.js';
