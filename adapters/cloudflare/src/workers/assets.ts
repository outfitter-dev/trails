import { ValidationError } from '@ontrails/core';

import type { WorkersEnv } from '../env.js';
import type { WorkersHostConfig } from './host.js';

interface AssetsBinding {
  fetch(request: Request): Response | Promise<Response>;
}

const isAssetsBinding = (value: unknown): value is AssetsBinding =>
  typeof value === 'object' &&
  value !== null &&
  'fetch' in value &&
  typeof value.fetch === 'function';

/** Resolve only on a route miss so matched trails do not require an assets binding. */
export const createAssetsFallback = (
  assets: WorkersHostConfig['assets'],
  env: WorkersEnv | undefined
): ((request: Request) => Response | Promise<Response>) | undefined => {
  if (assets === undefined) {
    return undefined;
  }
  return (request) => {
    const binding = env?.[assets.binding];
    if (!isAssetsBinding(binding)) {
      throw new ValidationError(
        `Worker assets binding "${assets.binding}" must provide fetch(request)`,
        { context: { binding: assets.binding } }
      );
    }
    // Native bindings can require their receiver; never detach fetch.
    return binding.fetch(request);
  };
};
