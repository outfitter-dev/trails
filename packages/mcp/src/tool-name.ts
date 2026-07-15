/**
 * Derive MCP-safe tool names from app name + trail ID.
 *
 * The derivation itself lives in `@ontrails/core` (`deriveMcpToolName`) so
 * governance readers such as Warden's `surface-overlay-coherence` rule check
 * collisions against the exact rendering the MCP surface renders.
 */

import { deriveMcpToolName } from '@ontrails/core';

/**
 * Convert app name + trail ID to an MCP-safe tool name.
 *
 * @example
 * deriveToolName("myapp", "entity.show") // "myapp_entity_show"
 * deriveToolName("dispatch", "patch.search") // "dispatch_patch_search"
 */
export const deriveToolName = deriveMcpToolName;
