// Build
export {
  deriveMcpTools,
  buildMcpTools,
  type DeriveMcpToolsOptions,
  type McpToolDefinition,
  type McpToolResult,
  type McpContent,
  type McpExtra,
} from './build.js';

// Tool naming
export { deriveToolName } from './tool-name.js';

// Annotations
export { deriveAnnotations, type McpAnnotations } from './annotations.js';

// Progress
export { createMcpProgressCallback } from './progress.js';

// Trailhead
export {
  createServer,
  surface,
  trailhead,
  type CreateServerOptions,
  type SurfaceMcpResult,
  type TrailheadMcpOptions,
} from './surface.js';

// Transport
export { connectStdio } from './stdio.js';
