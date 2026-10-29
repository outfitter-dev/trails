import { Result, ValidationError, resource } from '@ontrails/core';
import type { Resource } from '@ontrails/core';

import { createKvMock } from './memory.js';
import type { Kv } from './types.js';

/** An ordinary resource with a fixed, live-inspectable infrastructure role. */
export interface KvResource extends Resource<Kv> {
  readonly role: 'kv';
}

/** Provider-neutral resource annotations; binding selection belongs to profiles. */
export interface KvResourceOptions {
  readonly description?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Declare a provider-neutral KV resource with an isolated default test mock.
 * Production creation requires a binding supplied through ordinary resource
 * overrides. The mock is never silently used as a production binding.
 *
 * @example
 * ```ts
 * const flags = kv('flags');
 * // Trails declare resources: [flags] and use flags.from(ctx).
 * ```
 */
export const kv = (id: string, options: KvResourceOptions = {}): KvResource => {
  const definition = resource<Kv>(id, {
    create: () =>
      Result.err(
        new ValidationError(
          `KV resource "${id}" has no binding. Supply a provider binding through resource overrides; testAll uses the memory mock automatically.`,
          { context: { resourceId: id } }
        )
      ),
    description: options.description ?? 'Provider-neutral key-value resource',
    meta: options.meta,
    mock: () => createKvMock(),
  });
  return Object.freeze({ ...definition, role: 'kv' as const });
};
