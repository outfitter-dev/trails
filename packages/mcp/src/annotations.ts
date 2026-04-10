/**
 * Derive MCP tool annotations from trail spec fields.
 */

import type { Intent, Trail } from '@ontrails/core';

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
    Trail<unknown, unknown, unknown>,
    'intent' | 'idempotent' | 'description'
  >
): McpAnnotations => {
  const annotations: Record<string, unknown> = {};

  const intentToHint: Partial<Record<Intent, string>> = {
    destroy: 'destructiveHint',
    read: 'readOnlyHint',
  };

  const hint = intentToHint[trail.intent];
  if (hint) {
    annotations[hint] = true;
  }
  if (trail.idempotent === true) {
    annotations['idempotentHint'] = true;
  }
  if (trail.description !== undefined) {
    annotations['title'] = trail.description;
  }

  return annotations as McpAnnotations;
};
