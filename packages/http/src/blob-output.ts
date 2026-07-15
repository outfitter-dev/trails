/**
 * Shared recognition for BlobRef trail output schemas.
 *
 * The runtime handler (`fetch.ts`) and the OpenAPI derivation
 * (`openapi.ts`) must agree on which routes serve raw bytes, so both
 * read the same authored fact: the BlobRef marker meta on the trail's
 * output schema.
 */

import { BLOB_REF_SCHEMA_META_KEY } from '@ontrails/core';

/**
 * True when a trail output schema carries the BlobRef marker meta — the
 * authored fact that selects byte streaming over the JSON envelope on
 * the HTTP surface and a binary response body in the OpenAPI derivation.
 */
export const isBlobOutputSchema = (output: unknown): boolean => {
  if (typeof output !== 'object' || output === null) {
    return false;
  }
  const maybeMeta = (output as { meta?: () => unknown }).meta;
  if (typeof maybeMeta !== 'function') {
    return false;
  }
  const meta = maybeMeta.call(output);
  return (
    typeof meta === 'object' &&
    meta !== null &&
    (meta as Record<string, unknown>)[BLOB_REF_SCHEMA_META_KEY] === true
  );
};
