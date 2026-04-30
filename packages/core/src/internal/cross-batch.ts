/**
 * Shared helpers for `ctx.cross([...])` batch execution.
 *
 * These helpers normalize batch options, produce validation results, and
 * implement the unlimited/limited worker-pool execution strategies used by
 * both the real executor (`packages/core/src/execute.ts`) and the scenario
 * runner in `@ontrails/testing`. Extracting them here keeps the validation
 * rule, error message, and worker-pool semantics authored in one place so
 * the two call sites cannot drift.
 */

import { ValidationError } from '../errors.js';
import { Result } from '../result.js';
import type { CrossBatchOptions } from '../types.js';

/**
 * Validate the `concurrency` option on a batch `ctx.cross()` call.
 *
 * Returns `Ok(undefined)` when no limit is requested, `Ok(n)` when a
 * positive integer is supplied, and `Err(ValidationError)` for any other
 * value. The error message is load-bearing: callers and tests depend on
 * the exact string.
 */
export const normalizeCrossBatchConcurrency = (
  options: CrossBatchOptions | undefined
): Result<number | undefined, Error> => {
  const concurrency = options?.concurrency;
  if (concurrency === undefined) {
    return Result.ok();
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    return Result.err(
      new ValidationError(
        'ctx.cross() batch concurrency must be a positive integer'
      )
    );
  }

  return Result.ok(concurrency);
};

/**
 * Produce one validation-error result per call, preserving the original
 * call order. Used when `normalizeCrossBatchConcurrency` fails so the caller
 * can surface a uniform batch shape to the trail implementation.
 */
export const createCrossBatchValidationResults = <TCall>(
  calls: readonly TCall[],
  error: Error
): Result<unknown, Error>[] => calls.map(() => Result.err(error));

/**
 * Claim the next branch index from a shared counter. Safe to call from
 * multiple worker coroutines because JavaScript is single-threaded between
 * awaits — the read/increment pair runs without interleaving.
 */
export const claimNextCrossBatchIndex = <TCall>(
  nextIndex: { value: number },
  calls: readonly TCall[]
): number | undefined => {
  if (nextIndex.value >= calls.length) {
    return undefined;
  }

  const branchIndex = nextIndex.value;
  nextIndex.value += 1;
  return branchIndex;
};
