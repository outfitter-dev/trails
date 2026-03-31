import { TRACKS_API_KEY } from './tracks-api.js';
import type { TracksApi } from './tracks-api.js';

/** No-op TracksApi returned when the tracks layer is not active. */
const noopApi: TracksApi = {
  // oxlint-disable-next-line no-empty-function -- intentional no-op
  annotate: () => {},
  span: async <T>(_name: string, fn: () => T | Promise<T>): Promise<T> =>
    // oxlint-disable-next-line require-await -- no-op passthrough must return Promise
    fn(),
};

/**
 * Typed accessor for the TracksApi on a trail context.
 *
 * Returns a no-op implementation when the tracks layer is not active,
 * so callers never need null-checks.
 */
export const tracks = {
  from: (ctx: {
    readonly extensions?: Readonly<Record<string, unknown>> | undefined;
  }): TracksApi => {
    const api = ctx.extensions?.[TRACKS_API_KEY] as TracksApi | undefined;
    return api ?? noopApi;
  },
};
