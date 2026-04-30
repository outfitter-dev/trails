import { Result } from './result.js';
import type { Intent } from './trail.js';
import type { Topo } from './topo.js';
import type { SurfaceName } from './transport-error-map.js';
import type { TrailContextInit } from './types.js';
import { TRAILHEAD_KEY } from './types.js';
import { validateEstablishedTopo } from './validate-established-topo.js';

export type SurfaceConfigValues = Readonly<
  Record<string, Record<string, unknown>>
>;

export interface SurfaceSelectionOptions {
  /** Glob patterns that remove matching trail IDs. */
  readonly exclude?: readonly string[] | undefined;
  /** Glob patterns that keep only matching trail IDs when provided. */
  readonly include?: readonly string[] | undefined;
  /** Allowed intents for exposed surfaces. Empty arrays act as no filter. */
  readonly intent?: readonly Intent[] | undefined;
}

export interface SurfaceValidationOptions {
  /** Set to `false` to skip established-topo validation during projection. */
  readonly validate?: boolean | undefined;
}

export interface BaseSurfaceOptions
  extends SurfaceSelectionOptions, SurfaceValidationOptions {
  /** Config values for resources that declare a `config` schema, keyed by resource ID. */
  readonly configValues?: SurfaceConfigValues | undefined;
}

export const shouldValidateSurfaceTopo = (
  options?: SurfaceValidationOptions
): boolean => options?.validate !== false;

export const validateSurfaceTopo = (
  graph: Topo,
  options?: SurfaceValidationOptions
): Result<void, Error> => {
  if (!shouldValidateSurfaceTopo(options)) {
    return Result.ok();
  }

  const validated = validateEstablishedTopo(graph);
  return validated.isErr() ? Result.err(validated.error) : Result.ok();
};

export type SurfaceMarkedContext = Partial<TrailContextInit> & {
  readonly extensions: Readonly<Record<string, unknown>>;
};

export const withSurfaceMarker = (
  surface: SurfaceName,
  ctx: Partial<TrailContextInit> = {}
): SurfaceMarkedContext => ({
  ...ctx,
  extensions: {
    ...ctx.extensions,
    [TRAILHEAD_KEY]: surface,
  },
});
