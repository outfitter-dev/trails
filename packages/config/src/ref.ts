/**
 * Lazy config reference markers for trail input defaults.
 *
 * A `ConfigRef` is a marker object that can be embedded as a trail input
 * default. When resolution is wired into the execution pipeline, it will
 * be replaced with the live config value at the given path.
 *
 * Note: resolution is not yet wired into the execution pipeline.
 * Currently this module provides the marker type and type guard only.
 * Trail input defaults using `configRef()` will not be resolved
 * automatically until the execution pipeline integration ships.
 */

/** Marker object representing a lazy reference to a config field. */
export interface ConfigRef {
  readonly __configRef: true;
  readonly path: string;
}

/**
 * Create a lazy reference to a config field for use as a trail input default.
 *
 * Note: resolution is not yet automatic. See module-level docs.
 *
 */
export const configRef = (path: string): ConfigRef => ({
  __configRef: true,
  path,
});

/**
 * Type guard: detect whether an unknown value is a `ConfigRef` marker.
 */
export const isConfigRef = (value?: unknown): value is ConfigRef =>
  typeof value === 'object' &&
  value !== null &&
  '__configRef' in value &&
  (value as Record<string, unknown>)['__configRef'] === true;
