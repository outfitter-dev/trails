/**
 * Derive MCP tool annotations from trail spec markers.
 */

import type { Trail } from '@ontrails/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpAnnotations {
  readonly readOnlyHint?: boolean | undefined;
  readonly destructiveHint?: boolean | undefined;
  readonly idempotentHint?: boolean | undefined;
  readonly openWorldHint?: boolean | undefined;
  readonly title?: string | undefined;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Map trail spec fields to MCP tool annotations.
 *
 * Only sets hints that are explicitly declared on the trail.
 * Omitted hints let the MCP SDK use its defaults.
 */
export const deriveAnnotations = (
  trail: Pick<
    Trail<unknown, unknown>,
    'readOnly' | 'destructive' | 'idempotent' | 'description'
  >
): McpAnnotations => {
  const annotations: Record<string, unknown> = {};

  if (trail.readOnly === true) {
    annotations['readOnlyHint'] = true;
  }
  if (trail.destructive === true) {
    annotations['destructiveHint'] = true;
  }
  if (trail.idempotent === true) {
    annotations['idempotentHint'] = true;
  }
  if (trail.description !== undefined) {
    annotations['title'] = trail.description;
  }

  return annotations as McpAnnotations;
};
