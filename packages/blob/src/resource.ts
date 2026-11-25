import { Result, ValidationError, resource } from '@ontrails/core';
import type { Resource } from '@ontrails/core';

import { createBlobMock } from './memory.js';
import type { BlobStorage } from './types.js';

/** An ordinary resource with a fixed, live-inspectable infrastructure role. */
export interface BlobResource extends Resource<BlobStorage> {
  readonly role: 'blob';
}

/** Resource annotations; provider binding selection belongs to profiles. */
export interface BlobResourceOptions {
  readonly description?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Declare blob storage with an isolated default test mock. Production creation
 * requires an ordinary resource override and never silently uses the mock.
 *
 * @example
 * ```ts
 * const uploads = blob('uploads');
 * // Trails declare resources: [uploads] and use uploads.from(ctx).
 * ```
 */
export const blob = (
  id: string,
  options: BlobResourceOptions = {}
): BlobResource => {
  const definition = resource<BlobStorage>(id, {
    create: () =>
      Result.err(
        new ValidationError(
          `Blob resource "${id}" has no binding. Supply a provider binding through resource overrides; testAll uses the memory mock automatically.`,
          { context: { resourceId: id } }
        )
      ),
    description: options.description ?? 'Provider-neutral blob resource',
    meta: options.meta,
    mock: () => createBlobMock(),
  });
  return Object.freeze({ ...definition, role: 'blob' as const });
};
