/**
 * Derive MCP-safe tool names from app name + trail ID.
 *
 * MCP tool names must be [a-z0-9_]+. We prefix with the app name,
 * replace dots and hyphens with underscores, and lowercase everything.
 */

/**
 * Convert app name + trail ID to an MCP-safe tool name.
 *
 * @example
 * deriveToolName("myapp", "entity.show") // "myapp_entity_show"
 * deriveToolName("dispatch", "patch.search") // "dispatch_patch_search"
 */
export const deriveToolName = (appName: string, trailId: string): string => {
  const prefix = appName.toLowerCase().replaceAll(/[.-]/g, '_');
  const suffix = trailId.toLowerCase().replaceAll(/[.-]/g, '_');
  return `${prefix}_${suffix}`;
};
