// ---------------------------------------------------------------------------
// Health check types
// ---------------------------------------------------------------------------

/** Aggregate health status */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/** Individual component check result */
export interface HealthCheck {
  readonly status: HealthStatus;
  readonly message?: string | undefined;
  /** Latency in milliseconds */
  readonly latency?: number | undefined;
}

/** Full health report returned by a health endpoint */
export interface HealthResult {
  readonly status: HealthStatus;
  readonly checks: Readonly<Record<string, HealthCheck>>;
  readonly version?: string | undefined;
  /** Uptime in seconds */
  readonly uptime?: number | undefined;
}
