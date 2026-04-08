import { TRACKER_API_KEY } from './tracing-api.js';
import type { TrackerApi } from './tracing-api.js';

/** No-op TrackerApi returned when the tracing layer is not active. */
const noopApi: TrackerApi = {
  // oxlint-disable-next-line no-empty-function -- intentional no-op
  annotate: () => {},
  span: async <T>(_name: string, fn: () => T | Promise<T>): Promise<T> =>
    // oxlint-disable-next-line require-await -- no-op passthrough must return Promise
    fn(),
};

/**
 * Typed accessor for the TrackerApi on a trail context.
 *
 * Returns a no-op implementation when the tracing layer is not active,
 * so callers never need null-checks.
 */
export const tracing = {
  from: (ctx: {
    readonly extensions?: Readonly<Record<string, unknown>> | undefined;
  }): TrackerApi => {
    const api = ctx.extensions?.[TRACKER_API_KEY] as TrackerApi | undefined;
    return api ?? noopApi;
  },
};
