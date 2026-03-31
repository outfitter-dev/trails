import { CRUMBS_API_KEY } from './crumbs-api.js';
import type { CrumbsApi } from './crumbs-api.js';

/** No-op CrumbsApi returned when the crumbs layer is not active. */
const noopApi: CrumbsApi = {
  // oxlint-disable-next-line no-empty-function -- intentional no-op
  annotate: () => {},
  span: async <T>(_name: string, fn: () => T | Promise<T>): Promise<T> =>
    // oxlint-disable-next-line require-await -- no-op passthrough must return Promise
    fn(),
};

/**
 * Typed accessor for the CrumbsApi on a trail context.
 *
 * Returns a no-op implementation when the crumbs layer is not active,
 * so callers never need null-checks.
 */
export const crumbs = {
  from: (ctx: {
    readonly extensions?: Readonly<Record<string, unknown>> | undefined;
  }): CrumbsApi => {
    const api = ctx.extensions?.[CRUMBS_API_KEY] as CrumbsApi | undefined;
    return api ?? noopApi;
  },
};
