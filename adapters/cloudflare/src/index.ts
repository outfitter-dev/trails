/**
 * `@ontrails/cloudflare` — the Cloudflare adapter collection.
 *
 * Service subpaths are the primary entry points:
 * - `@ontrails/cloudflare/workers` — HTTP surface materializer (fetch handler)
 * - `@ontrails/cloudflare/kv` — key-value resource
 *
 * The root export re-exports the subpaths for convenience and adapter tooling.
 */

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
