/** Intent-based sampling rate configuration. */
export interface SamplingConfig {
  /** Sample rate for read operations (0.0 to 1.0). Default 0.05 (5%). */
  readonly read: number;
  /** Sample rate for write operations (0.0 to 1.0). Default 1.0 (100%). */
  readonly write: number;
  /** Sample rate for destroy operations (0.0 to 1.0). Default 1.0 (100%). */
  readonly destroy: number;
}

/** Default sampling rates: 5% reads, 100% writes and destroys. */
export const DEFAULT_SAMPLING: SamplingConfig = {
  destroy: 1,
  read: 0.05,
  write: 1,
};

/**
 * Decide whether to sample a trace based on intent.
 *
 * Undefined intent falls back to the write rate.
 */
export const shouldSample = (
  intent: 'read' | 'write' | 'destroy' | undefined,
  config?: Partial<SamplingConfig>
): boolean => {
  const merged = { ...DEFAULT_SAMPLING, ...config };
  const rate = merged[intent ?? 'write'];
  return Math.random() < rate;
};
