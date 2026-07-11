/**
 * `@ontrails/cloudflare` — the Cloudflare adapter collection.
 *
 * Service subpaths are the primary entry points:
 * - `@ontrails/cloudflare/workers` — HTTP surface materializer (fetch handler)
 * - `@ontrails/cloudflare/kv` — key-value resource
 * - `@ontrails/cloudflare/d1` — D1-backed store resource
 *
 * The root export re-exports the subpaths for convenience and adapter
 * tooling, and owns the adapter's `trails.lock` overlay overlay
 * (`cloudflareOverlay`).
 */

export { cloudflareOverlay } from './facts.js';
export type { CloudflareLockFacts } from './facts.js';
export { cloudflareD1, connectD1 } from './d1/index.js';
export type {
  CloudflareD1AllResult,
  CloudflareD1Connection,
  CloudflareD1Database,
  CloudflareD1Options,
  CloudflareD1PreparedStatement,
  CloudflareD1Resource,
  CloudflareD1RunResult,
  ConnectD1Options,
} from './d1/index.js';
export {
  buildEnvResourceOverrides,
  getEnvBinding,
  registerEnvBinding,
} from './env.js';
export type {
  BuildEnvResourceOverridesOptions,
  EnvBindingSpec,
  WorkersEnv,
} from './env.js';
export { cloudflareKv, createMemoryKv } from './kv/index.js';
export type {
  CloudflareKv,
  CloudflareKvListKey,
  CloudflareKvListOptions,
  CloudflareKvListResult,
  CloudflareKvOptions,
  CloudflareKvPutOptions,
  CreateMemoryKvOptions,
} from './kv/index.js';
export { createWorkersHandler } from './workers/index.js';
export type {
  CloudflareWorker,
  CreateWorkersHandlerOptions,
  WorkersExecutionContext,
  WorkersResourceOverrides,
} from './workers/index.js';
