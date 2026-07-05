/**
 * switchback — feature flags, library-first.
 *
 * The same authored trail contract is consumable three ways with zero
 * divergence: as a typed in-process library, as CLI commands, and as MCP
 * tools. This barrel is the library entry.
 */

/**
 * The switchback topo. Open it on any surface, or hand it to the library
 * surface for typed in-process calls.
 *
 * @example
 * ```ts
 * import { surface } from '@ontrails/library';
 * import { app } from 'switchback';
 *
 * const lib = await surface(app);
 * const evaluation = await lib.call.flagEvaluate({
 *   context: { attributes: { plan: 'beta' }, subjectId: 'user-1' },
 *   key: 'checkout-v2',
 * });
 * ```
 */
export { app } from './app.js';

/**
 * Deterministic bucketing and the pure evaluation engine.
 *
 * @example
 * ```ts
 * import { bucketFor } from 'switchback';
 *
 * bucketFor('checkout-v2', 'user-1'); // 7, forever
 * ```
 */
export { bucketFor, evaluateFlag } from './engine.js';

/**
 * Domain schemas and types for flag definitions and evaluation results.
 *
 * @example
 * ```ts
 * import { flagSchema } from 'switchback';
 *
 * const flag = flagSchema.parse(JSON.parse(raw));
 * ```
 */
export {
  conditionSchema,
  evalContextSchema,
  evalTraceSchema,
  evaluationSchema,
  flagSchema,
  flagValueSchema,
  ruleSchema,
} from './model.js';
export type {
  Condition,
  EvalContext,
  EvalTrace,
  Evaluation,
  Flag,
  FlagValue,
  Rule,
  TraceStep,
} from './model.js';

/**
 * The file-backed flags resource and its store contract, for forkers who
 * want to swap the definition source while keeping the trail contract.
 *
 * @example
 * ```ts
 * import { createMemoryFlagStore, flagsResource } from 'switchback';
 *
 * const store = createMemoryFlagStore();
 * ```
 */
export {
  createFileFlagStore,
  createMemoryFlagStore,
  flagsResource,
} from './resources/flags.js';
export type { FlagStore } from './resources/flags.js';
