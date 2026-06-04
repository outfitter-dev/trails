// Build
export {
  MCP_TOOL_ERROR_META_KEY,
  MCP_TOOL_EXAMPLES_META_KEY,
  MCP_TOOL_DEFERRED_META_KEY,
  MCP_TOOL_FACET_META_KEY,
  deriveMcpTools,
  type DeriveMcpToolsOptions,
  type McpSurfaceFacetDefinition,
  type McpSurfaceFacetMap,
  type McpSurfaceFacetTrailSelector,
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
  buildMcpResources,
  isMcpFacetTool,
  type BuiltMcpResources,
  type McpResourceContent,
  type McpResourceDefinition,
  type McpResourcesConfig,
} from './resources.js';

// Tool naming
export { deriveToolName } from './tool-name.js';

// Annotations
export { deriveAnnotations, type McpAnnotations } from './annotations.js';

// Progress
export { createMcpProgressCallback } from './progress.js';

// Surface
export {
  createServer,
  surface,
  type CreateServerOptions,
  type SurfaceMcpResult,
} from './surface.js';

// Transport
export { connectStdio } from './stdio.js';
