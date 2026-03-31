/**
 * Lazy config reference markers for trail input defaults.
 *
 * A `ConfigRef` is a marker object that can be embedded as a trail input
 * default. The resolution stack detects it at invocation time and replaces
 * it with the live config value at the given path.
 */

/** Marker object representing a lazy reference to a config field. */
export interface ConfigRef {
  readonly __configRef: true;
  readonly path: string;
}

/**
 * Create a lazy reference to a config field for use as a trail input default.
 *
 * The reference is resolved at invocation time, not at declaration time.
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
