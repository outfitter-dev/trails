/**
 * `@ontrails/cloudflare` — the Cloudflare adapter collection.
 *
 * Service subpaths are the primary entry points:
 * - `@ontrails/cloudflare/workers` — HTTP surface materializer (fetch handler)
 * - `@ontrails/cloudflare/kv` — key-value resource
 * - `@ontrails/cloudflare/d1` — D1-backed store resource
 * - `@ontrails/cloudflare/r2` — R2 blob/object resource
 * - `@ontrails/cloudflare/queues` — Queue producer resource and consumer
 *   materializer
 *
 * The root export re-exports the subpaths for convenience and adapter
 * tooling, and owns the adapter's `trails.lock` overlay overlay
 * (`cloudflareOverlay`).
 */

export { cloudflareOverlay } from './facts.js';
export type { CloudflareLockFacts } from './facts.js';
export { cloudflareD1, connectD1 } from './d1/index.js';
/**
 * Render a deterministic physical D1 baseline for reviewed migrations.
 * @example
 * ```ts
 * const sql = renderD1SchemaSql(definition, { tablePrefix: db.id });
 * ```
 */
export { renderD1SchemaSql } from './d1/schema.js';
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
export { cloudflareR2, createMemoryR2, r2ObjectToBlobRef } from './r2/index.js';
export type {
  CloudflareR2Bucket,
  CloudflareR2Conditional,
  CloudflareR2GetOptions,
  CloudflareR2HttpMetadata,
  CloudflareR2ListOptions,
  CloudflareR2Object,
  CloudflareR2ObjectBody,
  CloudflareR2Objects,
  CloudflareR2Options,
  CloudflareR2PutBody,
  CloudflareR2PutOptions,
  CloudflareR2Range,
  CloudflareR2StorageClass,
  MemoryCloudflareR2Bucket,
  R2ObjectToBlobRefOptions,
} from './r2/index.js';
export {
  cloudflareQueue,
  createMemoryQueue,
  createQueueHandler,
} from './queues/index.js';
export type {
  CloudflareQueue,
  CloudflareQueueBatch,
  CloudflareQueueHandler,
  CloudflareQueueMessage,
  CloudflareQueueMetrics,
  CloudflareQueueOptions,
  CloudflareQueueRetryOptions,
  CloudflareQueueSendBatchOptions,
  CloudflareQueueSendOptions,
  CloudflareQueueSendRequest,
  CloudflareQueueSendResult,
  CloudflareQueuesContentType,
  CreateQueueHandlerOptions,
  MemoryCloudflareQueue,
  MemoryQueueMessage,
} from './queues/index.js';
/**
 * Cron Triggers materializer for core schedule() sources.
 * @example
 * ```ts
 * import { createScheduledHandler } from '@ontrails/cloudflare';
 * export const scheduled = createScheduledHandler(graph);
 * ```
 */
export {
  CLOUDFLARE_CRON_UTC_ONLY,
  createScheduledHandler,
} from './schedules/index.js';
/**
 * Scheduled handler shapes.
 * @example
 * ```ts
 * import type { CloudflareScheduledController } from '@ontrails/cloudflare';
 * const cronOf = (controller: CloudflareScheduledController) => controller.cron;
 * ```
 */
export type {
  CloudflareScheduledController,
  CloudflareScheduledHandler,
  CreateScheduledHandlerOptions,
} from './schedules/index.js';
export { createWorkersHandler } from './workers/index.js';
export type {
  CloudflareWorker,
  CreateWorkersHandlerOptions,
  WorkersExecutionContext,
  WorkersResourceOverrides,
} from './workers/index.js';

/**
 * Bind portable KV resources through ordinary Worker resource overrides.
 * @example
 * ```ts
 * const client = createCloudflareKvBinding(env['FLAGS']);
 * ```
 */
export { createCloudflareKvBinding } from './kv/binding.js';

/**
 * Bind portable JSON producers to native Cloudflare Queues.
 * @example
 * ```ts
 * const client = createCloudflareQueueBinding(env['JOBS']);
 * await client.send({ id: 'job-1' });
 * ```
 */
export { createCloudflareQueueBinding } from './queues/binding.js';

/**
 * Bind portable blob storage to native R2 with an explicit stream buffering cap.
 * @example
 * ```ts
 * const client = createCloudflareBlobBinding(env['BUCKET'], { maxBufferedBytes: 1_048_576 });
 * ```
 */
export { createCloudflareBlobBinding } from './r2/binding.js';
/**
 * Required stream-write payload budget in bytes.
 * @example
 * ```ts
 * const options: CloudflareBlobBindingOptions = { maxBufferedBytes: 1_048_576 };
 * ```
 */
export type { CloudflareBlobBindingOptions } from './r2/binding.js';
